import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, githubCacheEntry, githubTarball, isDebug, tempDir, textLockfile } from "harness";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

// GHSA-pfwx-36v6-832x: bun.lock records the sha512 of a GitHub dependency's tarball next
// to its resolved commit, and an install that downloads the tarball again rejects
// different bytes.
//
// `owner/repo#ref` is fetched from `${GITHUB_API_URL}/repos/owner/repo/tarball/ref`, so
// each test serves the tarball built below from its own local server; nothing in this
// file talks to api.github.com.

// A test here runs up to four `bun` commands. A debug build of Bun takes about ten times as long
// for each as a release build. CI does not run debug builds and gives each test its time with `--timeout`.
if (isDebug) setDefaultTimeout(30_000);

const name = "gh-dep";
const owner = "gh-owner";
const repo = "gh-repo";
const ref = "0badc0d";
const spec = `${owner}/${repo}#${ref}`;
// GitHub's tarballs unpack into `<owner>-<repo>-<short sha>`; bun records that directory
// name in the lockfile as the resolved commit.
const resolved = `${owner}-${repo}-${ref}`;
const tarballPath = `/repos/${owner}/${repo}/tarball/${ref}`;

// Pseudo-random bytes (xorshift32) so gzip cannot shrink them.
function incompressible(bytes: number): Uint8Array {
  const words = new Uint32Array(bytes / 4);
  let x = 0x2545f491;
  for (let i = 0; i < words.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    words[i] = x;
  }
  return new Uint8Array(words.buffer);
}

const tarball = await githubTarball(resolved, {
  "package.json": JSON.stringify({ name, version: "1.0.0" }),
  "index.js": "module.exports = 1;\n",
  // The HTTP client reads at most 512 KiB (LIBUS_RECV_BUFFER_LENGTH) per socket read, so a
  // larger tarball always arrives in several chunks. That is what lets the streaming variant
  // below commit to streaming extraction on every run instead of falling back to buffering
  // when the whole body happens to arrive at once.
  "filler.bin": incompressible(600 * 1024),
});
expect(tarball.length).toBeGreaterThan(512 * 1024);

const integrity = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
const wrongIntegrity = `sha512-${Buffer.alloc(64).toString("base64")}`;
const lockedPackage = `${name}@github:${spec}`;

function project(files: Record<string, string> = {}) {
  return tempDir("github-integrity", {
    "package.json": JSON.stringify({ name: "app", dependencies: { [name]: spec } }),
    ...files,
  });
}

function lockfileWith(entry: unknown[]) {
  return textLockfile(1, {
    workspaces: { "": { name: "app", dependencies: { [name]: spec } } },
    packages: { [name]: entry },
  });
}

async function lockedEntry(dir: string) {
  const { packages } = Bun.JSONC.parse(await Bun.file(join(dir, "bun.lock")).text()) as {
    packages: Record<string, unknown[]>;
  };
  return packages[name];
}

// Tarballs smaller than BUN_INSTALL_STREAMING_MIN_SIZE (2 MiB by default) are extracted
// once the whole body has been buffered; larger ones are streamed into libarchive while
// they download. The two extractors hash and verify the tarball independently, so every
// test runs against both. `--verbose` output names the extractor that ran.
const variants = [
  { variant: "buffered", variantEnv: {}, extracted: `[${name}] Extract ` },
  { variant: "streaming", variantEnv: { BUN_INSTALL_STREAMING_MIN_SIZE: "1" }, extracted: `[${name}] Streamed ` },
];

describe.each(variants)("GitHub tarball integrity ($variant extraction)", ({ variantEnv, extracted }) => {
  function serveTarball(dir: string) {
    const requests: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const { pathname } = new URL(request.url);
        requests.push(pathname);
        return pathname === tarballPath ? new Response(tarball) : new Response("Not Found", { status: 404 });
      },
    });
    return {
      requests,
      async install() {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "install", "--verbose"],
          cwd: dir,
          env: {
            ...bunEnv,
            ...variantEnv,
            GITHUB_API_URL: server.url.origin,
            BUN_INSTALL_CACHE_DIR: join(dir, ".bun-cache"),
          },
          stdout: "ignore",
          stderr: "pipe",
        });
        const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
        return { stderr, exitCode };
      },
      [Symbol.asyncDispose]: () => server.stop(),
    };
  }

  test.concurrent("stores the tarball's integrity in the lockfile", async () => {
    using dir = project();
    await using github = serveTarball(String(dir));

    const { stderr, exitCode } = await github.install();
    expect(stderr).toContain(extracted);
    expect(stderr).not.toContain("error:");
    expect(stderr).toContain("Saved lockfile");
    expect(exitCode).toBe(0);

    expect(github.requests).toEqual([tarballPath]);
    expect(await lockedEntry(String(dir))).toEqual([lockedPackage, {}, resolved, integrity]);
    expect(existsSync(join(String(dir), "node_modules", name, "index.js"))).toBeTrue();
  });

  test.concurrent("re-downloading a tarball that matches the locked integrity succeeds", async () => {
    using dir = project();
    await using github = serveTarball(String(dir));

    const first = await github.install();
    expect(first.stderr).not.toContain("error:");
    expect(first.exitCode).toBe(0);
    expect(await lockedEntry(String(dir))).toEqual([lockedPackage, {}, resolved, integrity]);

    await rm(join(String(dir), ".bun-cache"), { recursive: true, force: true });
    await rm(join(String(dir), "node_modules"), { recursive: true, force: true });

    const second = await github.install();
    expect(second.stderr).toContain(extracted);
    expect(second.stderr).not.toContain("error:");
    expect(second.exitCode).toBe(0);

    expect(github.requests).toEqual([tarballPath, tarballPath]);
    expect(await lockedEntry(String(dir))).toEqual([lockedPackage, {}, resolved, integrity]);
    expect(existsSync(join(String(dir), "node_modules", name, "index.js"))).toBeTrue();
  });

  test.concurrent("rejects a tarball that does not match the locked integrity", async () => {
    using dir = project({ "bun.lock": lockfileWith([lockedPackage, {}, resolved, wrongIntegrity]) });
    await using github = serveTarball(String(dir));

    // Both extractors report the mismatch before they log which one ran, so unlike the
    // other tests this one cannot check `extracted`; the download is shaped exactly like
    // theirs, so it goes through the same extractor they prove is in use.
    const { stderr, exitCode } = await github.install();
    expect(stderr).toContain(`Integrity check failed for tarball: ${name}`);
    expect(exitCode).not.toBe(0);

    expect(github.requests).toEqual([tarballPath]);
    expect(existsSync(join(String(dir), "node_modules", name))).toBeFalse();
    expect(await lockedEntry(String(dir))).toEqual([lockedPackage, {}, resolved, wrongIntegrity]);
  });

  test.concurrent("adds the integrity to a lockfile written before it was recorded", async () => {
    using dir = project({ "bun.lock": lockfileWith([lockedPackage, {}, resolved]) });
    await using github = serveTarball(String(dir));

    const { stderr, exitCode } = await github.install();
    expect(stderr).toContain(extracted);
    expect(stderr).not.toContain("error:");
    expect(stderr).toContain("Saved lockfile");
    expect(exitCode).toBe(0);

    expect(github.requests).toEqual([tarballPath]);
    expect(await lockedEntry(String(dir))).toEqual([lockedPackage, {}, resolved, integrity]);
    expect(existsSync(join(String(dir), "node_modules", name, "index.js"))).toBeTrue();
  });

  // A cache entry is named after the integrity, so a lockfile without one does not name it: the
  // package is downloaded for that lockfile and pinned again, like a `file:` or URL tarball.
  test.concurrent("downloads again, and records the integrity again, when the lockfile has lost it", async () => {
    using dir = project();
    await using github = serveTarball(String(dir));

    const first = await github.install();
    expect(first.stderr).toContain(extracted);
    expect(first.stderr).not.toContain("error:");
    expect(first.exitCode).toBe(0);

    await rm(join(String(dir), "node_modules"), { recursive: true, force: true });
    const lockfile = join(String(dir), "bun.lock");
    await Bun.write(lockfile, (await Bun.file(lockfile).text()).replace(`, "${integrity}"`, ""));
    expect(await lockedEntry(String(dir))).toEqual([lockedPackage, {}, resolved]);

    const second = await github.install();
    expect(second.stderr).toContain(extracted);
    expect(second.stderr).not.toContain("error:");
    expect(second.exitCode).toBe(0);

    expect(github.requests).toEqual([tarballPath, tarballPath]);
    expect(await lockedEntry(String(dir))).toEqual([lockedPackage, {}, resolved, integrity]);
    expect(existsSync(join(String(dir), "node_modules", name, "index.js"))).toBeTrue();
  });
});

// The sha512 is also part of where a GitHub package lives in the install cache: its folder is
// `@GH@<resolved>+sha512-<first 16 digest bytes as hex>@@@1`, and a row of bun.lock that pins a
// sha512 is installed from that folder only. Bytes that no sha512 was compared with have a folder
// of their own, `@GH@<resolved>@@@1`: what `--no-verify` downloads for a pinned row, and what an
// install that cannot save bun.lock reads and downloads for a row without an integrity.

/**
 * One build of the repository at the commit. Its postinstall writes which build it is into the package's folder.
 * `files` makes it large enough to be extracted while it downloads. `root` is the directory the archive unpacks into.
 */
async function build(says: string, packageName = name, files: Record<string, Uint8Array> = {}, root = resolved) {
  const bytes = await githubTarball(root, {
    "package.json": JSON.stringify({
      name: packageName,
      version: "1.0.0",
      scripts: { postinstall: `echo ${says} > ran.txt` },
    }),
    "index.js": `module.exports = ${JSON.stringify(says)};\n`,
    ...files,
  });
  return {
    says,
    bytes,
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    entry: githubCacheEntry(root, bytes),
  };
}
type Build = Awaited<ReturnType<typeof build>>;
const [pinned, other, renamed] = await Promise.all([build("pinned"), build("other"), build("renamed", "renamed-dep")]);
const filler = { "filler.bin": incompressible(600 * 1024) };
const [largePinned, largeOther] = await Promise.all([build("pinned", name, filler), build("other", name, filler)]);

/** The folder of bytes that no sha512 was compared with. Versions before this naming used it for every GitHub package. */
const uncheckedEntry = `@GH@${resolved}@@@1`;
const pinnedSpec = `github:${spec}`;
const fullSha = `${ref}${Buffer.alloc(33, "0").toString()}`;
/** Other ways to write a dependency on the commit. bun learns the commit of each from the tarball it downloads. */
const otherSpellings = [
  ["a tag", `github:${owner}/${repo}#v1`, "v1"],
  ["a full sha", `github:${owner}/${repo}#${fullSha}`, fullSha],
  ["no ref", `github:${owner}/${repo}`, ""],
] as const;
const [, tagSpec, tag] = otherSpellings[0];
const refPath = (ref: string) => `/repos/${owner}/${repo}/tarball/${ref}`;

// Packages that depend on the tag of the repository: from the registry, and from another repository.
const dependsOnTheTag = { name: "host", version: "1.0.0", dependencies: { b: tagSpec } };
const declarerSpec = `github:${owner}/declarer#1234567`;
const declarerTarball = await githubTarball(`${owner}-declarer-1234567`, {
  "package.json": JSON.stringify({ ...dependsOnTheTag, name: "declarer" }),
});
/** `<owner>-<repo>-<short sha>` of this repository is the same string as of the one above. */
const twinSpec = `github:gh/owner-${repo}#${ref}`;

/** What a project holds of one dependency: the three always agree, or the dependency is not installed. */
const holds = (build: Build | null, locked: Build | null = build) => ({
  installed: build?.says ?? null,
  ran: build?.says ?? null,
  locked: locked?.integrity ?? null,
});

/**
 * Projects next to each other that share `cache/`. Every ref of the repository answers with `source`,
 * unless `refs` has other bytes for the ref or `status` an error.
 */
function sandbox(linker: "hoisted" | "isolated", extraEnv: Record<string, string> = {}) {
  /** The requests for an archive of the repository. */
  const requests: string[] = [];
  const box = {
    source: pinned as Build,
    refs: {} as Record<string, Build>,
    status: {} as Record<string, number>,
    /** What the repository `twinSpec` answers with. */
    twin: other as Build,
    /** The packages of the registry: the dependencies of each version. */
    registry: { host: { "1.0.0": dependsOnTheTag.dependencies } } as Record<
      string,
      Record<string, Record<string, string>>
    >,
    requests,
    root: "",
    bunfig: {} as Record<string, unknown>,
    async write(
      project: string,
      dependencies: Record<string, string>,
      { trustedDependencies = ["a", "b"], ...more }: Record<string, unknown> & { trustedDependencies?: string[] } = {},
    ) {
      await Bun.write(
        join(box.root, project, "package.json"),
        JSON.stringify({ name: project, dependencies, trustedDependencies, ...more }),
      );
      await Bun.write(
        join(box.root, project, "bunfig.toml"),
        Bun.TOML.stringify({ install: { linker, registry: `${server.url.origin}/`, ...box.bunfig } }),
      );
    },
    async run(project: string, ...args: string[]) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...args],
        cwd: join(box.root, project),
        env: {
          ...bunEnv,
          ...extraEnv,
          GITHUB_API_URL: server.url.origin,
          BUN_INSTALL_CACHE_DIR: join(box.root, "cache"),
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    },
    async ok(project: string, ...args: string[]) {
      const result = await box.run(project, ...args);
      expect(result.stderr).not.toContain("error:");
      expect(result.exitCode).toBe(0);
      return result;
    },
    /** A project whose bun.lock pins `a` to `build`, installed, with that build in the cache. */
    async pin(project: string, build = pinned) {
      box.source = build;
      await box.write(project, { a: pinnedSpec });
      await box.ok(project, "install");
      expect(await box.state(project, "a")).toEqual(holds(build));
      requests.length = 0;
      return await box.lockfile(project);
    },
    /** The same project with nothing installed: its bun.lock, and the pinned build in the cache if `cached`. */
    async locked(project: string, { cached = false } = {}) {
      await box.write(project, { a: pinnedSpec });
      const lockfile = installedOnce.lockfile.replace(`"name": "app"`, `"name": "${project}"`);
      await Bun.write(join(box.root, project, "bun.lock"), lockfile);
      for (const entry of cached ? await installedOnce.box.cacheEntries() : []) {
        await cp(join(installedOnce.root, "cache", entry), join(box.root, "cache", entry), { recursive: true });
      }
      return lockfile;
    },
    /** The same with the integrity removed from bun.lock, and nothing installed or cached. */
    async unpin(project: string) {
      const lockfile = await box.locked(project);
      const unpinned = lockfile.replace(`, "${pinned.integrity}"`, "");
      expect(unpinned).not.toBe(lockfile);
      await Bun.write(join(box.root, project, "bun.lock"), unpinned);
      return { lockfile, unpinned };
    },
    lockfile: (project: string) => Bun.file(join(box.root, project, "bun.lock")).text(),
    async state(project: string, alias: string) {
      const read = (file: string) =>
        Bun.file(join(box.root, project, "node_modules", alias, file))
          .text()
          .catch(() => null);
      const [index, ran, lockfile] = await Promise.all([
        read("index.js"),
        read("ran.txt"),
        box.lockfile(project).catch(() => "{}"),
      ]);
      const row = (Bun.JSONC.parse(lockfile) as { packages?: Record<string, unknown[]> }).packages?.[alias];
      const locked = row?.at(-1);
      return {
        installed: index === null ? null : (JSON.parse(index.slice("module.exports = ".length, -2)) as string),
        ran: ran === null ? null : ran.trim(),
        locked: typeof locked === "string" && locked.startsWith("sha512-") ? locked : null,
      };
    },
    /** Leaves what a version before this naming left: the folder of the commit alone, and a copy that names the commit. */
    async asOlderVersion(project: string, entry = pinned.entry) {
      const folder = join(box.root, "cache", uncheckedEntry);
      await rename(join(box.root, "cache", entry), folder);
      for (const tagged of [folder, join(box.root, project, "node_modules", "a")]) {
        if (!existsSync(tagged)) continue;
        // Not in place: the copy can be a hard link of the file in the cache.
        await rm(join(tagged, ".bun-tag"));
        await Bun.write(join(tagged, ".bun-tag"), resolved);
      }
    },
    removeModules: (project: string) => rm(join(box.root, project, "node_modules"), { recursive: true, force: true }),
    removeCache: () => rm(join(box.root, "cache"), { recursive: true, force: true }),
    cacheEntries: async () =>
      (await readdir(join(box.root, "cache")).catch(() => [])).filter(entry => entry.startsWith("@GH@")).sort(),
    [Symbol.dispose]() {
      server.stop(true);
      dir[Symbol.dispose]();
    },
  };
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url);
      const [, packageName, , file] = pathname.split("/");
      const versions = box.registry[packageName];
      if (versions && file) {
        const version = file.slice(packageName.length + 1, -".tgz".length);
        const manifest = { name: packageName, version, dependencies: versions[version] };
        return new Bun.Archive({ "package/package.json": JSON.stringify(manifest) }, { compress: "gzip" })
          .bytes()
          .then(bytes => new Response(bytes));
      }
      if (versions) {
        const tarball = (version: string) => `${server.url.origin}/${packageName}/-/${packageName}-${version}.tgz`;
        return Response.json({
          name: packageName,
          "dist-tags": { latest: Object.keys(versions).at(-1) },
          versions: Object.fromEntries(
            Object.entries(versions).map(([version, dependencies]) => [
              version,
              { name: packageName, version, dependencies, dist: { tarball: tarball(version) } },
            ]),
          ),
        });
      }
      if (pathname.startsWith(`/repos/${owner}/declarer/tarball/`)) return new Response(declarerTarball);
      if (pathname.startsWith(`/repos/gh/owner-${repo}/tarball/`)) return new Response(box.twin.bytes);
      if (!pathname.startsWith(refPath(""))) return new Response("Not Found", { status: 404 });
      requests.push(pathname);
      const asked = pathname.slice(refPath("").length);
      if (box.status[asked]) return new Response("", { status: box.status[asked] });
      return new Response((box.refs[asked] ?? box.source).bytes);
    },
  });
  const dir = tempDir("github-pin", {});
  box.root = String(dir);
  return box;
}

/** What one install of a project that pins `a` leaves: `locked` copies its bun.lock and its cache entry. */
const installedOnce = await (async () => {
  const box = sandbox("hoisted");
  const lockfile = await box.pin("app");
  return { box, lockfile, root: box.root };
})();
afterAll(() => installedOnce.box[Symbol.dispose]());

const changed = (from: Build, to: Build) =>
  `warn: "${name}" has changed: bun.lock recorded ${from.integrity}, now ${to.integrity}`;
const mismatch = `Integrity check failed for tarball: ${name}`;

describe.concurrent.each(["hoisted", "isolated"] as const)("bytes that bun.lock does not pin (%s)", linker => {
  describe.each(otherSpellings)("another dependency on the commit, written with %s", (_, otherSpec, otherRef) => {
    test("fails a clean install when the source sends other bytes", async () => {
      using box = sandbox(linker);
      const lockfile = await box.locked("app");

      box.source = other;
      await box.write("app", { a: pinnedSpec, b: otherSpec });
      const { stderr, exitCode } = await box.run("app", "install");
      expect(stderr).toContain(mismatch);
      expect(await box.state("app", "a")).toEqual(holds(null, pinned));
      expect(await box.state("app", "b")).toMatchObject({ installed: null, ran: null });
      expect(exitCode).toBe(1);
      // What `b` downloaded, then what bun.lock pins for the commit.
      expect(box.requests).toEqual([refPath(otherRef), refPath(ref)]);

      // The other bytes have a folder of their own: the project as it was fails too.
      await box.write("app", { a: pinnedSpec });
      await Bun.write(join(box.root, "app", "bun.lock"), lockfile);
      const frozen = await box.run("app", "install", "--frozen-lockfile");
      expect(frozen.stderr).toContain(mismatch);
      expect(await box.state("app", "a")).toEqual(holds(null, pinned));
      expect(frozen.exitCode).toBe(1);
      expect(await box.cacheEntries()).toEqual([other.entry]);
    });
  });

  test("another ref of the commit gets the pinned bytes when the cache has them", async () => {
    using box = sandbox(linker);
    const lockfile = await box.locked("app", { cached: true });

    box.source = other;
    await box.write("app", { a: pinnedSpec, b: tagSpec });
    const { stderr } = await box.ok("app", "install");
    expect(stderr).not.toContain("has changed");
    expect(await box.state("app", "a")).toEqual(holds(pinned));
    expect(await box.state("app", "b")).toEqual(holds(pinned));
    expect(box.requests).toEqual([refPath(tag)]);
    expect(await box.cacheEntries()).toEqual([other.entry, pinned.entry].sort());
    expect(await box.lockfile("app")).toContain(lockfile.match(/^ +"a": \[.*$/m)![0]);
  });

  test("another ref of the commit with the pinned bytes is one download", async () => {
    using box = sandbox(linker);
    await box.locked("app");

    await box.write("app", { a: pinnedSpec, b: tagSpec });
    await box.ok("app", "install");
    expect(await box.state("app", "a")).toEqual(holds(pinned));
    expect(await box.state("app", "b")).toEqual(holds(pinned));
    expect(box.requests).toEqual([refPath(tag)]);
    expect(await box.cacheEntries()).toEqual([pinned.entry]);
  });

  test("another ref whose bytes carry another package name is a package of its own", async () => {
    using box = sandbox(linker);
    await box.locked("app", { cached: true });

    box.source = renamed;
    await box.write("app", { a: pinnedSpec, b: tagSpec });
    await box.ok("app", "install");
    expect(await box.state("app", "a")).toEqual(holds(pinned));
    expect(await box.state("app", "b")).toEqual(holds(renamed));
    expect(await box.cacheEntries()).toEqual([pinned.entry, renamed.entry].sort());

    await box.removeModules("app");
    await box.removeCache();
    const { stderr, exitCode } = await box.run("app", "install");
    expect(stderr).toContain(mismatch);
    expect(await box.state("app", "a")).toEqual(holds(null, pinned));
    expect(exitCode).toBe(1);
  });

  // The project does not have to name the other ref itself.
  describe.each(["a registry package", "a workspace member", "a GitHub dependency"] as const)(
    "when %s depends on another ref of the commit",
    declarer => {
      async function declare(box: ReturnType<typeof sandbox>) {
        if (declarer === "a registry package") return box.write("app", { a: pinnedSpec, host: "1.0.0" });
        if (declarer === "a GitHub dependency") return box.write("app", { a: pinnedSpec, c: declarerSpec });
        await box.write("app", { a: pinnedSpec }, { workspaces: ["member"] });
        await Bun.write(join(box.root, "app", "member", "package.json"), JSON.stringify(dependsOnTheTag));
      }

      test("a clean install fails when the source sends other bytes", async () => {
        using box = sandbox(linker);
        await box.locked("app");

        box.source = other;
        await declare(box);
        const { stderr, exitCode } = await box.run("app", "install");
        expect(stderr).toContain(mismatch);
        expect(await box.state("app", "a")).toEqual(holds(null, pinned));
        expect(exitCode).toBe(1);
        expect(box.requests).toEqual([refPath(tag), refPath(ref)]);
      });

      test("the project keeps the pinned bytes when the cache has them", async () => {
        using box = sandbox(linker);
        await box.locked("app", { cached: true });

        box.source = other;
        await declare(box);
        await box.ok("app", "install");
        expect(await box.state("app", "a")).toEqual(holds(pinned));
        expect(box.requests).toEqual([refPath(tag)]);
      });
    },
  );

  // `bun add` downloads what it is given. Only `bun update` moves a GitHub row of bun.lock to other bytes.
  describe.each([
    ["the same spec", pinnedSpec, ref],
    ["another ref", tagSpec, tag],
  ] as const)("bun add of %s", (_, addedSpec, addedRef) => {
    test("keeps what bun.lock pins when the cache has it", async () => {
      using box = sandbox(linker);
      await box.locked("app", { cached: true });

      box.source = other;
      const { stderr } = await box.ok("app", "add", `b@${addedSpec}`);
      expect(stderr).not.toContain("has changed");
      expect(await box.state("app", "a")).toEqual(holds(pinned));
      expect(await box.state("app", "b")).toEqual(holds(pinned));
      expect(box.requests).toEqual([refPath(addedRef)]);
    });

    test("fails when nothing is cached or installed and the source sends other bytes", async () => {
      using box = sandbox(linker);
      await box.locked("app");

      box.source = other;
      const { stderr, exitCode } = await box.run("app", "add", `b@${addedSpec}`);
      expect(stderr).toContain(mismatch);
      expect(await box.state("app", "a")).toEqual(holds(null, pinned));
      expect(await box.state("app", "b")).toMatchObject({ installed: null, ran: null });
      expect(exitCode).toBe(1);
      // What `b` downloaded, then what bun.lock pins for the commit.
      expect(box.requests).toEqual([refPath(addedRef), refPath(ref)]);
    });
  });

  test.each(["the cache has the pinned bytes", "the cache is empty"])(
    "bun install --force with another ref of the commit keeps what bun.lock pins when %s",
    async cache => {
      using box = sandbox(linker);
      await box.locked("app", { cached: cache !== "the cache is empty" });

      box.source = other;
      await box.write("app", { a: pinnedSpec, b: tagSpec });
      if (cache === "the cache is empty") {
        const { stderr, exitCode } = await box.run("app", "install", "--force");
        expect(stderr).toContain(mismatch);
        expect(exitCode).toBe(1);
        expect(box.requests).toEqual([refPath(tag), refPath(ref)]);
        return;
      }
      const { stderr } = await box.ok("app", "install", "--force");
      expect(stderr).not.toContain("has changed");
      expect(await box.state("app", "a")).toEqual(holds(pinned));
      expect(await box.state("app", "b")).toEqual(holds(pinned));
      expect(box.requests).toEqual([refPath(tag)]);
    },
  );

  describe.each([
    ["bun update", ["update"]],
    ["bun update <name>", ["update", "a"]],
  ] as const)("%s", (_, command) => {
    test.each(["the cache has the pinned bytes", "the cache is empty"])(
      "takes the bytes of the source when %s",
      async cache => {
        using box = sandbox(linker);
        await box.pin("app");

        box.source = other;
        if (cache === "the cache is empty") await box.removeCache();
        const { stderr } = await box.ok("app", ...command);
        expect(stderr).toContain(changed(pinned, other));
        // The copy was of the pinned bytes, and is laid again.
        expect(await box.state("app", "a")).toEqual(holds(other));
        expect(box.requests).toEqual([refPath(ref)]);

        // bun.lock describes what the source has, so a machine with nothing cached can install it.
        await box.removeModules("app");
        await box.removeCache();
        await box.ok("app", "install", "--frozen-lockfile");
        expect(await box.state("app", "a")).toEqual(holds(other));
      },
    );
  });

  test("bun update <name> does not move the row for a dependency that it does not name", async () => {
    using box = sandbox(linker);
    await box.locked("app", { cached: true });
    await Bun.write(join(box.root, "app", "z", "package.json"), JSON.stringify({ name: "z", version: "1.0.0" }));

    box.source = other;
    await box.write("app", { a: pinnedSpec, b: tagSpec, z: "file:./z" });
    const { stderr } = await box.ok("app", "update", "z");
    expect(stderr).not.toContain("has changed");
    expect(await box.state("app", "a")).toEqual(holds(pinned));
    expect(await box.state("app", "b")).toEqual(holds(pinned));
  });

  test("bun update --no-save keeps what bun.lock pins", async () => {
    using box = sandbox(linker);
    const lockfile = await box.locked("app", { cached: true });

    box.source = other;
    const { stderr } = await box.ok("app", "update", "--no-save");
    expect(stderr).not.toContain("has changed");
    expect(await box.state("app", "a")).toEqual(holds(pinned));
    expect(await box.lockfile("app")).toBe(lockfile);
  });

  // bun learns the commit of a ref from the archive that the ref answers with. `a` and `b` are one
  // row of bun.lock, and `b` is written with a tag that now answers with other bytes for the commit.
  describe("bun update with a ref that sends other bytes than the commit's own URL", () => {
    async function twoRefs(box: ReturnType<typeof sandbox>, { integrity = true } = {}) {
      const lockfile = Bun.JSONC.parse(await box.locked("app", { cached: integrity })) as {
        workspaces: Record<string, { dependencies: Record<string, string> }>;
        packages: Record<string, unknown[]>;
      };
      lockfile.workspaces[""].dependencies.b = tagSpec;
      if (!integrity) lockfile.packages.a.pop();
      lockfile.packages.b = lockfile.packages.a;
      await Bun.write(join(box.root, "app", "bun.lock"), JSON.stringify(lockfile));
      await box.write("app", { a: pinnedSpec, b: tagSpec });
      await box.ok("app", "install", "--frozen-lockfile");
      expect(await box.state("app", "b")).toEqual(holds(pinned, integrity ? pinned : null));
      box.refs = { [tag]: other };
      box.requests.length = 0;
    }
    /** A machine with nothing cached asks the commit's own URL, which still sends the pinned bytes. */
    async function clean(box: ReturnType<typeof sandbox>) {
      await box.removeModules("app");
      await box.removeCache();
      box.requests.length = 0;
      return box.run("app", "ci");
    }

    test("bun update <name> of that dependency moves the row, with a warning", async () => {
      using box = sandbox(linker);
      await twoRefs(box);

      const { stderr } = await box.ok("app", "update", "b");
      expect(stderr).toContain(changed(pinned, other));
      expect(await box.state("app", "a")).toEqual(holds(other));
      expect(await box.state("app", "b")).toEqual(holds(other));
      expect(box.requests).toEqual([refPath(tag)]);

      const { stderr: cold, exitCode } = await clean(box);
      expect(cold).toContain(mismatch);
      expect(exitCode).toBe(1);
    });

    test("bun update keeps the row on what the first dependency gets, without a warning", async () => {
      using box = sandbox(linker);
      await twoRefs(box);

      for (const _ of [1, 2]) {
        const { stderr } = await box.ok("app", "update");
        expect(stderr).not.toContain("has changed");
        expect(await box.state("app", "a")).toEqual(holds(pinned));
        expect(await box.state("app", "b")).toEqual(holds(pinned));
      }
      expect(box.requests.toSorted()).toEqual([refPath(ref), refPath(ref), refPath(tag), refPath(tag)]);

      const { exitCode } = await clean(box);
      expect(await box.state("app", "a")).toEqual(holds(pinned));
      expect(exitCode).toBe(0);
      expect(box.requests).toEqual([refPath(ref)]);
    });

    test("bun update <name> of that dependency gives a row without an integrity its first", async () => {
      using box = sandbox(linker);
      await twoRefs(box, { integrity: false });

      const { stderr } = await box.ok("app", "update", "b");
      expect(stderr).not.toContain("has changed");
      expect(await box.state("app", "a")).toEqual(holds(other));
      expect(await box.state("app", "b")).toEqual(holds(other));

      const { stderr: cold, exitCode } = await clean(box);
      expect(cold).toContain(mismatch);
      expect(exitCode).toBe(1);
    });

    test("bun update keeps the row when a registry package depends on that ref", async () => {
      using box = sandbox(linker);
      await box.locked("app", { cached: true });
      await box.write("app", { a: pinnedSpec, host: "1.0.0" });
      await box.ok("app", "install");
      // `b` is a dependency of `host`, and the same row of bun.lock as `a`.
      const sameRow = { a: holds(pinned), b: pinned.integrity };
      const rows = async () => ({ a: await box.state("app", "a"), b: (await box.state("app", "b")).locked });
      expect(await rows()).toEqual(sameRow);
      box.refs = { [tag]: other };

      for (const command of [["update"], ["update", "host"]]) {
        const { stderr } = await box.ok("app", ...command);
        expect(stderr).not.toContain("has changed");
        expect(await rows()).toEqual(sameRow);
      }

      const { exitCode } = await clean(box);
      expect(await rows()).toEqual(sameRow);
      expect(exitCode).toBe(0);
    });
  });

  // A rule of `overrides` that the rows of bun.lock do not follow yet is resolved after the
  // lockfile is cleaned, and the clean numbers the rows again.
  test("bun update <name> moves the row once when another ref joins after the lockfile is cleaned", async () => {
    using box = sandbox(linker);
    box.registry = {
      w: { "1.0.0": { p: "^1.0.0" } },
      p: { "1.0.0": {}, "2.0.0": { z: `github:${owner}/${repo}#v2` } },
    };
    const project = (rule: string) =>
      box.write(
        "app",
        { z: tagSpec },
        { devDependencies: { w: "1.0.0" }, overrides: { p: rule }, trustedDependencies: ["z"] },
      );
    await project("1.0.0");
    await box.ok("app", "install");
    // As after a merge: the rule is of one branch, the rows are of the other.
    await project("2.0.0");
    const lockfile = join(box.root, "app", "bun.lock");
    await Bun.write(
      lockfile,
      (await Bun.file(lockfile).text()).replace(/("overrides": \{\s*"p": )"1\.0\.0"/, '$1"2.0.0"'),
    );
    box.refs = { [tag]: other, v2: await build("third") };

    const { stderr } = await box.ok("app", "update", "z");
    expect(stderr.split("\n").filter(line => line.includes("has changed"))).toEqual([changed(pinned, other)]);
    expect(await box.state("app", "z")).toEqual(holds(other));
  });

  // github.com roots the archive of two commits at one name when their ids start with the same 7 digits.
  test("refs that send other bytes under one commit name are one row, of the first dependency's bytes", async () => {
    using box = sandbox(linker);
    box.refs = { [ref]: pinned, [tag]: other };
    await box.write("app", { a: pinnedSpec, b: tagSpec });
    await box.ok("app", "install");
    expect(await box.state("app", "a")).toEqual(holds(pinned));
    expect(await box.state("app", "b")).toEqual(holds(pinned));
    expect(await box.cacheEntries()).toEqual([other.entry, pinned.entry].sort());

    // The row is of what its own URL sends, so a machine with nothing cached can install bun.lock.
    await box.removeModules("app");
    await box.removeCache();
    box.requests.length = 0;
    await box.ok("app", "ci");
    expect(await box.state("app", "a")).toEqual(holds(pinned));
    expect(await box.state("app", "b")).toEqual(holds(pinned));
    expect(box.requests).toEqual([refPath(ref)]);
  });

  test("a second project on the same cache gets what its own bun.lock records", async () => {
    using box = sandbox(linker);
    const lockfile = await box.locked("one", { cached: true });

    box.source = other;
    await box.write("two", { a: pinnedSpec });
    await box.ok("two", "install");
    expect(await box.state("two", "a")).toEqual(holds(other));
    expect(await box.cacheEntries()).toEqual([other.entry, pinned.entry].sort());

    box.requests.length = 0;
    await box.ok("one", "ci");
    expect(await box.state("one", "a")).toEqual(holds(pinned));
    expect(await box.lockfile("one")).toBe(lockfile);
    expect(box.requests).toEqual([]);
  });

  test.each([["ci"], ["install", "--frozen-lockfile"], ["install"]])(
    "bun %s does not take what a second project left in an empty cache",
    async (...command) => {
      using box = sandbox(linker);
      await box.locked("one");

      box.source = other;
      await box.write("two", { a: pinnedSpec });
      await box.ok("two", "install");
      expect(await box.state("two", "a")).toEqual(holds(other));

      box.requests.length = 0;
      const { stderr, exitCode } = await box.run("one", ...command);
      expect(stderr).toContain(mismatch);
      expect(await box.state("one", "a")).toEqual(holds(null, pinned));
      expect(exitCode).toBe(1);
      expect(box.requests).toEqual([refPath(ref)]);
      expect(await box.cacheEntries()).toEqual([other.entry]);
    },
  );

  test("a project downloads what its bun.lock pins next to what a second project cached first", async () => {
    using box = sandbox(linker);
    const lockfile = await box.locked("one");

    box.source = other;
    await box.write("two", { a: pinnedSpec });
    await box.ok("two", "install");

    box.source = pinned;
    box.requests.length = 0;
    await box.ok("one", "install", "--frozen-lockfile");
    expect(await box.state("one", "a")).toEqual(holds(pinned));
    expect(await box.lockfile("one")).toBe(lockfile);
    expect(box.requests).toEqual([refPath(ref)]);
    expect(await box.cacheEntries()).toEqual([other.entry, pinned.entry].sort());

    await box.removeModules("two");
    await box.ok("two", "install", "--frozen-lockfile");
    expect(await box.state("two", "a")).toEqual(holds(other));
    expect(box.requests).toEqual([refPath(ref)]);
  });

  test("two repositories whose archives have one root name do not share a folder", async () => {
    using box = sandbox(linker);
    await box.locked("one", { cached: true });

    await box.write("two", { a: twinSpec });
    await box.ok("two", "install");
    expect(await box.state("two", "a")).toEqual(holds(other));
    expect(await box.cacheEntries()).toEqual([other.entry, pinned.entry].sort());

    await box.ok("one", "ci");
    expect(await box.state("one", "a")).toEqual(holds(pinned));
  });

  test("bun pm fetch downloads what bun.lock pins when a second project cached other bytes", async () => {
    using box = sandbox(linker);
    await box.locked("one");

    box.source = other;
    await box.write("two", { a: pinnedSpec });
    await box.ok("two", "install");

    box.requests.length = 0;
    const { stderr, exitCode } = await box.run("one", "pm", "fetch");
    expect(stderr).toContain(mismatch);
    expect(exitCode).toBe(1);
    expect(box.requests).toEqual([refPath(ref)]);

    box.source = pinned;
    const { stdout } = await box.ok("one", "pm", "fetch");
    expect(stdout).toContain("Fetched 1 package into cache");
    expect(await box.cacheEntries()).toEqual([other.entry, pinned.entry].sort());
  });

  test("a patched dependency is made from the bytes that bun.lock pins", async () => {
    using box = sandbox(linker);
    const patched = () => existsSync(join(box.root, "one", "node_modules", "a", "patched.js"));
    await box.write(
      "one",
      { a: pinnedSpec },
      // Not trusted: the global store test below relies on the same.
      { trustedDependencies: [], patchedDependencies: { [`${name}@${pinnedSpec}`]: "a.patch" } },
    );
    const addsFile = "diff --git a/patched.js b/patched.js\nnew file mode 100644\nindex 0000000..d00491f\n";
    await Bun.write(
      join(box.root, "one", "a.patch"),
      `${addsFile}--- /dev/null\n+++ b/patched.js\n@@ -0,0 +1 @@\n+1\n`,
    );
    await box.ok("one", "install");
    expect(await box.state("one", "a")).toEqual({ ...holds(pinned), ran: null });
    expect(patched()).toBeTrue();
    await box.removeModules("one");
    await box.removeCache();

    box.source = other;
    await box.write("two", { a: pinnedSpec }, { trustedDependencies: [] });
    await box.ok("two", "install");

    box.requests.length = 0;
    const { stderr, exitCode } = await box.run("one", "install", "--frozen-lockfile");
    expect(stderr).toContain(mismatch);
    expect(await box.state("one", "a")).toEqual(holds(null, pinned));
    expect(exitCode).toBe(1);
    expect(box.requests).toEqual([refPath(ref)]);
    expect(await box.cacheEntries()).toEqual([other.entry]);
  });

  // bun.lock does not record lifecycle scripts: they are read from the folder, which the patch changed.
  test("bun update does not run a postinstall that a patch removed", async () => {
    const manifest = (scripts?: object) => `${JSON.stringify({ name, version: "1.0.0", scripts })}\n`;
    const scripted = manifest({ postinstall: "echo scripted > ran.txt" });
    const bytes = await githubTarball(resolved, {
      "package.json": scripted,
      "index.js": `module.exports = "scripted";\n`,
    });
    using box = sandbox(linker);
    box.source = {
      says: "scripted",
      bytes,
      integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
      entry: githubCacheEntry(resolved, bytes),
    };
    await box.write("app", { a: pinnedSpec }, { patchedDependencies: { [`${name}@${pinnedSpec}`]: "a.patch" } });
    await Bun.write(
      join(box.root, "app", "a.patch"),
      `diff --git a/package.json b/package.json\nindex 0000000..1111111 100644\n--- a/package.json\n+++ b/package.json\n@@ -1 +1 @@\n-${scripted}+${manifest()}`,
    );
    await box.ok("app", "install");

    for (const command of ["install", "update"]) {
      await box.removeModules("app");
      await box.ok("app", command);
      expect(await box.state("app", "a")).toMatchObject({ installed: "scripted", ran: null });
    }
  });

  test.each(["a pinned row", "a row without an integrity"])(
    "bun pm cache pack and unpack carry the folder that %s reads",
    async row => {
      using box = sandbox(linker);
      const isPinned = row === "a pinned row";
      await (isPinned ? box.locked("app", { cached: true }) : box.unpin("app"));
      await box.ok("app", "install", "--frozen-lockfile");
      const entries = await box.cacheEntries();
      expect(entries).toEqual([isPinned ? pinned.entry : uncheckedEntry]);

      await box.ok("app", "pm", "cache", "pack", "cache.pack");
      await box.removeCache();
      await box.removeModules("app");
      box.requests.length = 0;
      await box.ok("app", "pm", "cache", "unpack", "cache.pack");
      expect(await box.cacheEntries()).toEqual(entries);

      await box.ok("app", "install", "--frozen-lockfile", "--offline");
      expect(await box.state("app", "a")).toEqual(holds(pinned, isPinned ? pinned : null));
      expect(box.requests).toEqual([]);
    },
  );

  // With nothing cached, an install that can save bun.lock downloads the package of a row without
  // an integrity, and the row is pinned to what was downloaded.
  test("a row without an integrity is downloaded once, and pinned", async () => {
    using box = sandbox(linker);
    const { lockfile } = await box.unpin("app");

    await box.ok("app", "install");
    expect(await box.state("app", "a")).toEqual(holds(pinned));
    expect(await box.lockfile("app")).toBe(lockfile);
    expect(box.requests).toEqual([refPath(ref)]);
    expect(await box.cacheEntries()).toEqual([pinned.entry]);

    // The copy says which bytes it holds. Laid again, its postinstall would run again.
    await rm(join(box.root, "app", "node_modules", "a", "ran.txt"));
    await box.ok("app", "install");
    expect(await box.state("app", "a")).toEqual({ ...holds(pinned), ran: null });

    await box.removeModules("app");
    await box.ok("app", "install", "--frozen-lockfile");
    expect(await box.state("app", "a")).toEqual(holds(pinned));
    expect(box.requests).toEqual([refPath(ref)]);
  });

  test.each(["--frozen-lockfile", "--no-save"])(
    "bun install %s leaves a row without an integrity as it is, and reads the folder of unchecked bytes",
    async flag => {
      using box = sandbox(linker);
      const { unpinned } = await box.unpin("app");

      await box.ok("app", "install", flag);
      expect(await box.state("app", "a")).toEqual(holds(pinned, null));
      expect(await box.lockfile("app")).toBe(unpinned);
      expect(box.requests).toEqual([refPath(ref)]);
      expect(await box.cacheEntries()).toEqual([uncheckedEntry]);

      await box.removeModules("app");
      await box.ok("app", "install", flag);
      expect(await box.state("app", "a")).toEqual(holds(pinned, null));
      expect(box.requests).toEqual([refPath(ref)]);
    },
  );

  // The copy names the commit, which is all that such a row records.
  test("the installed copy of a row without an integrity is kept", async () => {
    using box = sandbox(linker);
    const { unpinned } = await box.unpin("app");
    await box.ok("app", "install", "--frozen-lockfile");
    await rm(join(box.root, "app", "node_modules", "a", "ran.txt"));

    await box.ok("app", "install");
    expect(await box.state("app", "a")).toEqual({ ...holds(pinned, null), ran: null });
    expect(await box.lockfile("app")).toBe(unpinned);
    expect(box.requests).toEqual([refPath(ref)]);
  });

  test("bun patch reads a row without an integrity from the folder of unchecked bytes, and fills it", async () => {
    using box = sandbox(linker);
    await box.unpin("app");
    await box.ok("app", "install", "--frozen-lockfile");
    await box.removeCache();

    const { stdout } = await box.ok("app", "patch", "a");
    expect(stdout).toContain(`To patch ${name}, edit the following folder:`);
    expect(await box.state("app", "a")).toMatchObject({ installed: "pinned", locked: null });
    expect(box.requests).toEqual([refPath(ref), refPath(ref)]);
    expect(await box.cacheEntries()).toEqual([uncheckedEntry]);
  });

  // A download with no pin can fill the folder of a hash too, so a row without an integrity does not read it.
  test("a lockfile without the integrity does not read the folder of the hash that a pinning install cached", async () => {
    using box = sandbox(linker);
    const { unpinned } = await box.unpin("app");
    await box.ok("app", "install");
    // bun.lock as it was committed.
    await Bun.write(join(box.root, "app", "bun.lock"), unpinned);
    await box.removeModules("app");
    box.requests.length = 0;

    const offline = await box.run("app", "install", "--frozen-lockfile", "--offline");
    expect(offline.stderr).toContain("is not in the cache");
    expect(offline.exitCode).toBe(1);

    await box.ok("app", "install", "--frozen-lockfile");
    expect(await box.state("app", "a")).toEqual(holds(pinned, null));
    expect(box.requests).toEqual([refPath(ref)]);
    expect(await box.cacheEntries()).toEqual([pinned.entry, uncheckedEntry].sort());
  });

  test("bun patch --commit downloads a row without an integrity when the cache has lost it", async () => {
    using box = sandbox(linker);
    await box.unpin("app");
    await box.ok("app", "install", "--frozen-lockfile");
    await box.ok("app", "patch", "a");
    await Bun.write(join(box.root, "app", "node_modules", "a", "index.js"), `module.exports = "patched";\n`);
    await box.removeCache();
    box.requests.length = 0;

    await box.ok("app", "patch", "--commit", "node_modules/a");
    expect(await box.state("app", "a")).toMatchObject({ installed: "patched", locked: null });
    expect(box.requests).toEqual([refPath(ref)]);
    expect((await box.cacheEntries()).filter(entry => !entry.includes("_patch_hash="))).toEqual([uncheckedEntry]);
  });

  test("a pinned install does not take what was downloaded for a row without an integrity of other bytes", async () => {
    using box = sandbox(linker);
    const lockfile = await box.locked("one");

    box.source = other;
    await box.write("two", { a: pinnedSpec });
    const unpinned = lockfile.replace(`, "${pinned.integrity}"`, "").replace(`"name": "one"`, `"name": "two"`);
    await Bun.write(join(box.root, "two", "bun.lock"), unpinned);
    await box.ok("two", "install");
    expect(await box.state("two", "a")).toEqual(holds(other));
    expect(await box.cacheEntries()).toEqual([other.entry]);

    box.requests.length = 0;
    const { stderr, exitCode } = await box.run("one", "ci");
    expect(stderr).toContain(mismatch);
    expect(await box.state("one", "a")).toEqual(holds(null, pinned));
    expect(exitCode).toBe(1);
    expect(box.requests).toEqual([refPath(ref)]);
    expect(await box.cacheEntries()).toEqual([other.entry]);
  });

  test("a row without an integrity is pinned to what its own URL sends, not to what another ref sends", async () => {
    using box = sandbox(linker);
    const { lockfile } = await box.unpin("app");

    box.refs = { [tag]: other };
    await box.write("app", { a: pinnedSpec, b: tagSpec });
    await box.ok("app", "install");
    expect(await box.state("app", "a")).toEqual(holds(pinned));
    expect(await box.state("app", "b")).toEqual(holds(pinned));
    expect((Bun.JSONC.parse(await box.lockfile("app")) as any).packages.a).toEqual(
      (Bun.JSONC.parse(lockfile) as any).packages.a,
    );
    expect(box.requests).toEqual([refPath(tag), refPath(ref)]);
    expect(await box.cacheEntries()).toEqual([other.entry, pinned.entry].sort());
  });

  // `x/y-z` and `x-y/z` have one archive root. Each row is of its own download.
  test("rows without an integrity of two repositories with one archive root do not share a folder", async () => {
    using box = sandbox(linker);
    await box.unpin("one");
    await box.ok("one", "install");

    const twinLockfile = textLockfile(1, {
      workspaces: { "": { name: "two", dependencies: { a: twinSpec } } },
      packages: { a: [`${name}@${twinSpec}`, {}, resolved] },
    });
    await box.write("two", { a: twinSpec });
    await Bun.write(join(box.root, "two", "bun.lock"), twinLockfile);
    await box.ok("two", "install");
    expect(await box.state("two", "a")).toEqual(holds(other));
    expect(await box.state("one", "a")).toEqual(holds(pinned));
    expect(await box.cacheEntries()).toEqual([other.entry, pinned.entry].sort());
  });

  test("what an install that cannot record an integrity caches is not what a pinned install takes", async () => {
    using box = sandbox(linker);
    const { lockfile, unpinned } = await box.unpin("app");

    box.source = other;
    await box.ok("app", "install", "--frozen-lockfile");
    expect(await box.state("app", "a")).toEqual(holds(other, null));
    expect(await box.lockfile("app")).toBe(unpinned);
    expect(await box.cacheEntries()).toEqual([uncheckedEntry]);

    // With the copy of the other bytes still in node_modules.
    await Bun.write(join(box.root, "app", "bun.lock"), lockfile);
    const { stderr, exitCode } = await box.run("app", "install", "--frozen-lockfile");
    expect(stderr).toContain(mismatch);
    expect(exitCode).toBe(1);

    box.source = pinned;
    await box.ok("app", "install", "--frozen-lockfile");
    expect(await box.state("app", "a")).toEqual(holds(pinned));
  });

  test("what --no-verify caches is not what a verifying install takes", async () => {
    using box = sandbox(linker);
    const lockfile = await box.locked("app");

    box.source = other;
    await box.ok("app", "install", "--no-verify");
    expect(await box.state("app", "a")).toEqual(holds(other, pinned));
    expect(await box.lockfile("app")).toBe(lockfile);
    expect(await box.cacheEntries()).toEqual([uncheckedEntry]);

    // With the copy of the other bytes still in node_modules.
    const { stderr, exitCode } = await box.run("app", "install", "--frozen-lockfile");
    expect(stderr).toContain(mismatch);
    expect(exitCode).toBe(1);

    box.source = pinned;
    await box.ok("app", "install", "--frozen-lockfile");
    expect(await box.state("app", "a")).toEqual(holds(pinned));
  });

  test("--no-verify takes what it cached before, and keeps its copy", async () => {
    using box = sandbox(linker);
    await box.locked("app");

    box.source = other;
    await box.ok("app", "install", "--no-verify");
    await rm(join(box.root, "app", "node_modules", "a", "ran.txt"));
    await box.ok("app", "install", "--no-verify");
    expect(await box.state("app", "a")).toEqual({ ...holds(other, pinned), ran: null });

    await box.removeModules("app");
    await box.ok("app", "install", "--no-verify");
    expect(await box.state("app", "a")).toEqual(holds(other, pinned));
    expect(box.requests).toEqual([refPath(ref)]);
  });

  // `--no-verify` links a pinned row from checked or unchecked bytes, so a copy of either is current for it.
  describe("--no-verify keeps a copy of the commit", () => {
    const keeps = async (box: ReturnType<typeof sandbox>, build: Build) => {
      await rm(join(box.root, "app", "node_modules", "a", "ran.txt"));
      await box.ok("app", "install", "--no-verify");
      expect(await box.state("app", "a")).toEqual({ installed: build.says, ran: null, locked: pinned.integrity });
    };

    test("of the pinned bytes that a verified install laid", async () => {
      using box = sandbox(linker);
      await box.pin("app");
      await keeps(box, pinned);
    });

    test("that was laid for another integrity of the commit", async () => {
      using box = sandbox(linker);
      await box.pin("app", other);
      await box.locked("app", { cached: true });
      await keeps(box, other);
      expect(await box.cacheEntries()).toEqual([other.entry, pinned.entry].sort());
    });

    test("of unchecked bytes, until an install that verifies replaces it", async () => {
      using box = sandbox(linker);
      await box.locked("app");
      box.source = other;
      await box.ok("app", "install", "--no-verify");
      expect(await box.cacheEntries()).toEqual([uncheckedEntry]);

      // The cache has the pinned bytes since.
      await cp(join(installedOnce.root, "cache", pinned.entry), join(box.root, "cache", pinned.entry), {
        recursive: true,
      });
      await keeps(box, other);
      expect(box.requests).toEqual([refPath(ref)]);

      await box.ok("app", "install");
      expect(await box.state("app", "a")).toEqual(holds(pinned));
      expect(box.requests).toEqual([refPath(ref)]);
    });
  });

  test("--no-verify takes the folder that a verified install cached", async () => {
    using box = sandbox(linker);
    await box.locked("app", { cached: true });

    box.source = other;
    await box.ok("app", "install", "--no-verify");
    expect(await box.state("app", "a")).toEqual(holds(pinned));
    expect(box.requests).toEqual([]);
    expect(await box.cacheEntries()).toEqual([pinned.entry]);
  });

  // Both ask for the name of the entry before an install has opened the cache.
  test("bun pm cache pack and bun patch --commit take the verified folder under --no-verify", async () => {
    using box = sandbox(linker);
    await box.locked("app", { cached: true });
    await box.ok("app", "install");
    box.source = other;
    box.requests.length = 0;

    const { stdout } = await box.ok("app", "pm", "cache", "pack", "cache.pack", "--no-verify");
    expect(stdout).toContain("Packed 1 package");

    await box.ok("app", "patch", "a");
    await Bun.write(join(box.root, "app", "node_modules", "a", "index.js"), `module.exports = "patched";\n`);
    await box.ok("app", "patch", "--commit", "node_modules/a", "--no-verify");
    expect(await box.state("app", "a")).toMatchObject({ installed: "patched", locked: pinned.integrity });
    expect(box.requests).toEqual([]);
    expect(await box.cacheEntries()).not.toContain(uncheckedEntry);
  });

  test("a new dependency that --no-verify installs is pinned to what was downloaded", async () => {
    using box = sandbox(linker);
    await box.write("app", { a: pinnedSpec });
    await box.ok("app", "install", "--no-verify");
    expect(await box.state("app", "a")).toEqual(holds(pinned));
    expect(await box.cacheEntries()).toEqual([pinned.entry]);

    await box.removeModules("app");
    await box.ok("app", "install", "--frozen-lockfile");
    expect(await box.state("app", "a")).toEqual(holds(pinned));
    expect(box.requests).toEqual([refPath(ref)]);
  });

  // Versions before this naming kept every GitHub package under the commit alone, whatever bytes it was made from.
  describe("over the cache of an older version", () => {
    async function olderCache(box: ReturnType<typeof sandbox>, optionalDependencies?: Record<string, string>) {
      let lockfile: string;
      if (optionalDependencies) {
        await box.write("app", {}, { optionalDependencies });
        await box.ok("app", "install");
        lockfile = await box.lockfile("app");
        await box.removeModules("app");
      } else {
        lockfile = await box.locked("app", { cached: true });
      }
      await box.asOlderVersion("app");
      await Bun.write(join(box.root, "cache", uncheckedEntry, "index.js"), `module.exports = "other";\n`);
      box.requests.length = 0;
      return lockfile;
    }

    test("a pinned install downloads once", async () => {
      using box = sandbox(linker);
      const lockfile = await olderCache(box);

      await box.ok("app", "install");
      expect(await box.state("app", "a")).toEqual(holds(pinned));
      expect(await box.lockfile("app")).toBe(lockfile);
      expect(box.requests).toEqual([refPath(ref)]);
      expect(await box.cacheEntries()).toEqual([pinned.entry, uncheckedEntry].sort());

      await box.removeModules("app");
      await box.ok("app", "install", "--offline");
      expect(await box.state("app", "a")).toEqual(holds(pinned));
      expect(box.requests).toEqual([refPath(ref)]);
    });

    test.each([
      ["--offline", 0],
      ["a source that answers 404", 404],
      ["a source that answers 403", 403],
    ] as const)("a pinned install fails with %s", async (_, status) => {
      using box = sandbox(linker);
      await olderCache(box);

      if (status) box.status[ref] = status;
      const { stderr, exitCode } = await box.run("app", "install", ...(status ? [] : ["--offline"]));
      expect(stderr).toContain("error:");
      expect(await box.state("app", "a")).toEqual(holds(null, pinned));
      expect(exitCode).toBe(1);
      expect(box.requests).toEqual(status ? [refPath(ref)] : []);
    });

    // As for every optional dependency that cannot be downloaded.
    test.each([
      ["--offline", 0],
      ["a source that answers 404", 404],
    ] as const)("an optional dependency is left out with %s, until an install can download it", async (_, status) => {
      using box = sandbox(linker);
      await olderCache(box, { a: pinnedSpec });

      if (status) box.status[ref] = status;
      const { exitCode } = await box.run("app", "install", ...(status ? [] : ["--offline"]));
      expect(await box.state("app", "a")).toEqual(holds(null, pinned));
      expect(exitCode).toBe(0);

      box.status = {};
      await box.ok("app", "install");
      expect(await box.state("app", "a")).toEqual(holds(pinned));
    });

    test("a copy in node_modules is laid again for a row that pins its bytes", async () => {
      using box = sandbox(linker);
      const lockfile = await box.pin("app");
      await box.asOlderVersion("app");
      await rm(join(box.root, "app", "node_modules", "a", "ran.txt"));

      await box.ok("app", "install");
      expect(await box.state("app", "a")).toEqual(holds(pinned));
      expect(await box.lockfile("app")).toBe(lockfile);
      expect(box.requests).toEqual([refPath(ref)]);

      await rm(join(box.root, "app", "node_modules", "a", "ran.txt"));
      await box.ok("app", "install");
      expect(await box.state("app", "a")).toEqual({ ...holds(pinned), ran: null });
      expect(box.requests).toEqual([refPath(ref)]);
    });

    test("a copy in node_modules is kept for a row without an integrity", async () => {
      using box = sandbox(linker);
      const lockfile = await box.pin("app");
      await box.asOlderVersion("app");
      await rm(join(box.root, "app", "node_modules", "a", "ran.txt"));
      const unpinned = lockfile.replace(`, "${pinned.integrity}"`, "");
      await Bun.write(join(box.root, "app", "bun.lock"), unpinned);

      await box.ok("app", "install");
      expect(await box.state("app", "a")).toEqual({ ...holds(pinned, null), ran: null });
      expect(await box.lockfile("app")).toBe(unpinned);
      expect(box.requests).toEqual([]);
    });
  });

  // The archive of a repository that was renamed or transferred is rooted at the new name: other bytes.
  describe("when the source roots the archive at another name", () => {
    async function renamedRepository(box: ReturnType<typeof sandbox>, movedRoot: string) {
      const moved = await build("moved", name, {}, movedRoot);
      await box.locked("app");

      box.source = moved;
      const { stderr, exitCode } = await box.run("app", "install");
      expect(stderr).toContain(mismatch);
      expect(exitCode).toBe(1);
      return async () => {
        expect(await box.state("app", "a")).toEqual(holds(moved));
        expect((Bun.JSONC.parse(await box.lockfile("app")) as any).packages.a[2]).toBe(movedRoot);
      };
    }

    test("a clean install fails, and bun update <name> takes the new archive", async () => {
      using box = sandbox(linker);
      const takesIt = await renamedRepository(box, `new-${resolved}`);

      await box.ok("app", "update", "a");
      await takesIt();
    });

    test("a clean install fails, and bun remove then bun add take the new archive", async () => {
      using box = sandbox(linker);
      const takesIt = await renamedRepository(box, `a-${resolved}`);

      await box.ok("app", "remove", "a");
      await box.ok("app", "add", `a@${pinnedSpec}`);
      await takesIt();
    });
  });
});

describe.concurrent.each(["hoisted", "isolated"] as const)("with a binary lockfile (%s)", linker => {
  const bytesOf = async (box: ReturnType<typeof sandbox>, project: string) => {
    const { installed, ran } = await box.state(project, "a");
    return { installed, ran };
  };
  async function pinBinary(box: ReturnType<typeof sandbox>) {
    box.bunfig = { saveTextLockfile: false };
    await box.write("one", { a: pinnedSpec });
    await box.ok("one", "install");
    expect(existsSync(join(box.root, "one", "bun.lockb"))).toBeTrue();
    box.requests.length = 0;
  }

  test("another ref of the commit that sends other bytes fails a clean install", async () => {
    using box = sandbox(linker);
    await pinBinary(box);

    box.source = other;
    await box.write("one", { a: pinnedSpec, b: tagSpec });
    await box.removeModules("one");
    await box.removeCache();
    const { stderr, exitCode } = await box.run("one", "install");
    expect(stderr).toContain(mismatch);
    expect(await bytesOf(box, "one")).toEqual({ installed: null, ran: null });
    expect(exitCode).toBe(1);
    expect(box.requests).toEqual([refPath(tag), refPath(ref)]);
  });

  // bun.lockb keeps the branch as it is written. The download for its row asks for the commit, so
  // a branch that moved since the pin does not make the miss over an older cache fail.
  test("a row whose branch moved is downloaded by its commit over the cache of an older version", async () => {
    using box = sandbox(linker);
    box.bunfig = { saveTextLockfile: false };
    await box.write("one", { a: `github:${owner}/${repo}#main` });
    await box.ok("one", "install");
    await box.asOlderVersion("one");
    await box.removeModules("one");

    box.refs = { main: await build("moved", name, {}, `${owner}-${repo}-fffffff`) };
    box.requests.length = 0;
    await box.ok("one", "install");
    expect(await bytesOf(box, "one")).toEqual({ installed: "pinned", ran: "pinned" });
    expect(box.requests).toEqual([refPath(ref)]);
  });

  test("a second project's bytes are not taken, and bun update takes the bytes of the source", async () => {
    using box = sandbox(linker);
    await pinBinary(box);
    await box.removeModules("one");
    await box.removeCache();

    box.source = other;
    await box.write("two", { a: pinnedSpec });
    await box.ok("two", "install");
    box.requests.length = 0;
    const { stderr, exitCode } = await box.run("one", "ci");
    expect(stderr).toContain(mismatch);
    expect(await bytesOf(box, "one")).toEqual({ installed: null, ran: null });
    expect(exitCode).toBe(1);
    expect(box.requests).toEqual([refPath(ref)]);

    const update = await box.ok("one", "update");
    expect(update.stderr).toContain(changed(pinned, other));
    expect(await bytesOf(box, "one")).toEqual({ installed: other.says, ran: other.says });
  });
});

// The row that a GitHub dependency of a yarn.lock is migrated to has a commit and no integrity.
describe.concurrent.each(["hoisted", "isolated"] as const)("a GitHub row of a migrated yarn.lock (%s)", linker => {
  const gitSpec = `git+https://github.com/${owner}/${repo}.git`;
  const yarnLock = (commit: string) =>
    `# yarn lockfile v1\n\n\n"a@${gitSpec}":\n  version "1.0.0"\n  resolved "${gitSpec}#${commit}"\n`;

  test("is installed and pinned, and its bun.lock installs on a machine with nothing cached", async () => {
    using box = sandbox(linker);
    await box.write("app", { a: gitSpec });
    await Bun.write(join(box.root, "app", "yarn.lock"), yarnLock(fullSha));
    await box.ok("app", "install");
    expect(await box.state("app", "a")).toEqual(holds(pinned));
    expect((Bun.JSONC.parse(await box.lockfile("app")) as any).packages.a.slice(2)).toEqual([
      resolved,
      pinned.integrity,
    ]);

    await box.ok("app", "update");
    await box.removeModules("app");
    await box.removeCache();
    await box.ok("app", "ci");
    expect(await box.state("app", "a")).toEqual(holds(pinned));
  });

  test("is not linked from a folder that its commit spells", async () => {
    using box = sandbox(linker);
    await box.write("app", { a: gitSpec });
    // `@GH@<owner>-<repo>-x/../y@@@1` is `y@@@1`, another entry of the cache.
    await Bun.write(join(box.root, "app", "yarn.lock"), yarnLock("x/../y"));
    await Bun.write(join(box.root, "cache", `@GH@${owner}-${repo}-x`, ".keep"), "");
    await Bun.write(join(box.root, "cache", "y@@@1", "package.json"), JSON.stringify({ name, version: "1.0.0" }));
    await Bun.write(join(box.root, "cache", "y@@@1", "index.js"), `module.exports = "another entry";\n`);

    const { exitCode } = await box.run("app", "install");
    expect(await box.state("app", "a")).toMatchObject({ installed: null, ran: null });
    expect(exitCode).toBe(1);
  });
});

// The tarballs above are small enough to be buffered whole. Both extractors name the folder.
describe.concurrent.each(variants)(
  "bytes that bun.lock does not pin ($variant extraction)",
  ({ variantEnv, extracted }) => {
    test("another ref of the commit that sends other bytes fails a clean install", async () => {
      using box = sandbox("hoisted", variantEnv);
      const lockfile = await box.pin("app", largePinned);

      box.source = largeOther;
      await box.write("app", { a: pinnedSpec, b: tagSpec });
      await box.removeModules("app");
      await box.removeCache();
      const { stderr, exitCode } = await box.run("app", "install", "--verbose");
      // The download of `b`, which no integrity is compared with.
      expect(stderr).toContain(extracted.replace(name, "b"));
      expect(stderr).toContain(mismatch);
      expect(await box.state("app", "a")).toEqual(holds(null, largePinned));
      expect(await box.lockfile("app")).toBe(lockfile);
      expect(exitCode).toBe(1);
      expect(await box.cacheEntries()).toEqual([largeOther.entry]);
    });

    test("a pinned install does not take what a second project left in an empty cache", async () => {
      using box = sandbox("hoisted", variantEnv);
      await box.pin("one", largePinned);
      await box.removeModules("one");
      await box.removeCache();

      box.source = largeOther;
      await box.write("two", { a: pinnedSpec });
      const two = await box.ok("two", "install", "--verbose");
      expect(two.stderr).toContain(extracted.replace(name, "a"));
      expect(await box.state("two", "a")).toEqual(holds(largeOther));

      const { stderr, exitCode } = await box.run("one", "install", "--frozen-lockfile");
      expect(stderr).toContain(mismatch);
      expect(await box.state("one", "a")).toEqual(holds(null, largePinned));
      expect(exitCode).toBe(1);
      expect(await box.cacheEntries()).toEqual([largeOther.entry]);
    });

    // `.bun-tag` is the commit alone there, as every version before this naming wrote it.
    test.each([
      ["is downloaded to the folder of its integrity, and pinned", [] as string[]],
      ["is downloaded to the folder of unchecked bytes by an install that cannot pin it", ["--frozen-lockfile"]],
    ])("a row without an integrity %s", async (_, flags) => {
      using box = sandbox("hoisted", variantEnv);
      const lockfile = await box.pin("app", largePinned);
      const unpinned = lockfile.replace(`, "${largePinned.integrity}"`, "");
      await Bun.write(join(box.root, "app", "bun.lock"), unpinned);
      await box.removeModules("app");
      await box.removeCache();

      const { stderr } = await box.ok("app", "install", "--verbose", ...flags);
      expect(stderr).toContain(extracted);
      const pins = flags.length === 0;
      expect(await box.state("app", "a")).toEqual(holds(largePinned, pins ? largePinned : null));
      expect(await box.lockfile("app")).toBe(pins ? lockfile : unpinned);
      expect(await box.cacheEntries()).toEqual([pins ? largePinned.entry : uncheckedEntry]);
      expect(await Bun.file(join(box.root, "app", "node_modules", "a", ".bun-tag")).text()).toBe(
        pins ? `${resolved}+${largePinned.integrity}` : resolved,
      );
    });
  },
);

// `bun prune` removes a nested copy once the copy at the root is of the commit that bun.lock has.
test("bun prune reads the commit of a copy whose .bun-tag names its integrity too", async () => {
  using box = sandbox("hoisted");
  await box.locked("app", { cached: true });
  await box.write("app", { a: pinnedSpec, host: "1.0.0" });
  await box.ok("app", "install");
  const nested = join(box.root, "app", "node_modules", "host", "node_modules", "a");
  const plant = () => Bun.write(join(nested, "package.json"), JSON.stringify({ name: "a" }));
  const rootTag = join(box.root, "app", "node_modules", "a", ".bun-tag");
  const tag = await Bun.file(rootTag).text();
  expect(tag).toBe(`${resolved}+${pinned.integrity}`);

  // Not in place: the copy can be a hard link of the file in the cache.
  await rm(rootTag);
  await Bun.write(rootTag, `${owner}-${repo}-fffffff+${pinned.integrity}`);
  await plant();
  const stale = await box.ok("app", "prune");
  expect(stale.stderr).toContain("is not the version bun.lock expects");
  expect(existsSync(nested)).toBeTrue();

  await Bun.write(rootTag, tag);
  const { stdout, stderr } = await box.ok("app", "prune");
  expect(stderr).not.toContain("warn:");
  expect(stdout).toContain("1 package removed");
  expect(existsSync(nested)).toBeFalse();
});

// Without node_modules, `bun run` resolves an import of a locked package to its folder in the cache.
describe("auto-install", () => {
  async function imports(box: ReturnType<typeof sandbox>) {
    await Bun.write(join(box.root, "app", "index.js"), `console.log(require("a"));\n`);
    box.requests.length = 0;
    return box.run("app", "--install=force", "index.js");
  }

  test("reads a pinned row from the folder of its integrity", async () => {
    using box = sandbox("hoisted");
    await box.locked("app", { cached: true });
    expect(await imports(box)).toMatchObject({ stdout: "pinned\n", exitCode: 0 });

    // What an older version, or a project without the integrity, cached for the commit is not read.
    await box.asOlderVersion("app");
    const { stdout, stderr, exitCode } = await imports(box);
    expect(stderr).toContain("not in cache, run `bun install`");
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
    expect(box.requests).toEqual([]);
  });

  test("reads a row without an integrity from the folder of unchecked bytes", async () => {
    using box = sandbox("hoisted");
    await box.unpin("app");
    await box.ok("app", "install", "--frozen-lockfile");
    await box.removeModules("app");
    expect(await imports(box)).toMatchObject({ stdout: "pinned\n", exitCode: 0 });
    expect(box.requests).toEqual([]);
  });
});

// An entry of the global virtual store is shared by projects too. A package with trusted scripts has none.
test("the global virtual store does not hand a pinned project what a second project cached", async () => {
  using box = sandbox("isolated", { BUN_INSTALL_GLOBAL_STORE: "1" });
  box.source = pinned;
  await box.write("one", { a: pinnedSpec }, { trustedDependencies: [] });
  await box.ok("one", "install");
  expect(await box.state("one", "a")).toEqual({ ...holds(pinned), ran: null });
  expect(await readdir(join(box.root, "cache", "links"))).toHaveLength(1);
  await box.removeModules("one");
  await box.removeCache();

  box.source = other;
  await box.write("two", { a: pinnedSpec }, { trustedDependencies: [] });
  await box.ok("two", "install");
  expect(await box.state("two", "a")).toEqual({ ...holds(other), ran: null });

  const { stderr, exitCode } = await box.run("one", "ci");
  expect(stderr).toContain(mismatch);
  expect(await box.state("one", "a")).toEqual(holds(null, pinned));
  expect(exitCode).toBe(1);

  box.source = pinned;
  await box.ok("one", "ci");
  expect(await box.state("one", "a")).toEqual({ ...holds(pinned), ran: null });
  expect(await readdir(join(box.root, "cache", "links"))).toHaveLength(2);
});

// A version before this naming made the entry of a pinned row from the folder of the commit alone.
test("an entry of the global virtual store from before the integrity named the folder is not reused", async () => {
  using box = sandbox("isolated", { BUN_INSTALL_GLOBAL_STORE: "1" });
  await box.write("one", { a: pinnedSpec }, { trustedDependencies: [] });
  await box.ok("one", "install");
  const links = join(box.root, "cache", "links");
  const [entry] = await readdir(links);
  // The name ends in a hash of `[layout, flags]`, the store path, a NUL, and the integrity as bun.lock has it.
  const storePath = entry.slice(0, entry.lastIndexOf("-"));
  const entryWith = (flags: number) => {
    const digest = createHash("sha512").update(pinned.bytes).digest();
    const hashed = Buffer.concat([Buffer.from([1, flags]), Buffer.from(storePath), Buffer.from([0, 4]), digest]);
    return `${storePath}-${Bun.hash.wyhash(hashed, 0x9e3779b97f4a7c15n).toString(16).padStart(16, "0")}`;
  };
  expect(entry).toBe(entryWith(2));

  // What that version left: the entry without the flag of a pinned GitHub row, of other bytes.
  await box.removeModules("one");
  const older = join(links, entryWith(0));
  await rename(join(links, entry), older);
  await rm(join(older, "node_modules", name, "index.js"));
  await Bun.write(join(older, "node_modules", name, "index.js"), `module.exports = "other";\n`);

  await box.ok("one", "ci");
  expect(await box.state("one", "a")).toEqual({ ...holds(pinned), ran: null });
  expect((await readdir(links)).sort()).toEqual([entryWith(0), entryWith(2)].sort());
});

// `<owner>-<repo>-<short sha>` is at most 39 + 1 + 100 + 1 + 7 bytes on github.com. The 40 bytes of the
// integrity, and the 28 of a patch hash, leave the folder name under the 255 a file name can have.
test("the cache folder of the longest repository name fits a file name", async () => {
  const longOwner = Buffer.alloc(39, "o").toString();
  const longRepo = Buffer.alloc(100, "r").toString();
  const root = `${longOwner}-${longRepo}-${ref}`;
  const bytes = await githubTarball(root, {
    "package.json": JSON.stringify({ name, version: "1.0.0" }),
    "index.js": "module.exports = 1;\n",
  });
  using dir = tempDir("github-long-name", {
    "package.json": JSON.stringify({ name: "app", dependencies: { [name]: `github:${longOwner}/${longRepo}#${ref}` } }),
  });
  await using server = Bun.serve({ port: 0, fetch: () => new Response(bytes) });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: String(dir),
    env: { ...bunEnv, GITHUB_API_URL: server.url.origin, BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache") },
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("error:");
  const entry = githubCacheEntry(root, bytes);
  expect(entry).toHaveLength(196);
  expect((await readdir(join(String(dir), ".bun-cache"))).filter(found => found.startsWith("@GH@"))).toEqual([entry]);
  expect(existsSync(join(String(dir), "node_modules", name, "index.js"))).toBeTrue();
  expect(exitCode).toBe(0);
});

// A package of bun.lock is downloaded for itself and checked against its own integrity, also
// when something else in the same command asks for its URL.
describe.each(["hoisted", "isolated"] as const)("one URL, asked for twice (%s linker)", linker => {
  const build = (root: string, name: string) =>
    githubTarball(root, { "package.json": JSON.stringify({ name, version: "1.0.0" }), "index.js": "" });
  const sri = (bytes: Uint8Array) => `sha512-${createHash("sha512").update(bytes).digest("base64")}`;

  /**
   * Runs `bun <args>` in a project whose bun.lock has `locked`, with nothing cached. GitHub answers
   * with `served`: an archive, or a status. `more` is added to package.json.
   */
  async function run(locked: Record<string, unknown[]>, served: Uint8Array | number, args: string[], more = {}) {
    const dependencies = Object.fromEntries(Object.keys(locked).map(alias => [alias, spec]));
    using dir = tempDir("github-one-url", {
      "package.json": JSON.stringify({ name: "app", dependencies, ...more }),
      "bun.lock": textLockfile(1, { workspaces: { "": { name: "app", dependencies } }, packages: locked }),
      "bunfig.toml": `[install]\nlinker = "${linker}"\n`,
    });
    const requests: string[] = [];
    using server = Bun.serve({
      port: 0,
      fetch(request) {
        requests.push(new URL(request.url).pathname);
        return typeof served === "number" ? new Response("", { status: served }) : new Response(served);
      },
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd: String(dir),
      env: { ...bunEnv, GITHUB_API_URL: server.url.origin, BUN_INSTALL_CACHE_DIR: join(String(dir), ".bun-cache") },
      stdout: "ignore",
      stderr: "pipe",
      // For a command that does not end: that is how the first test failed with the isolated linker.
      timeout: 25_000,
      killSignal: "SIGKILL",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    return { stderr, exitCode, requests };
  }

  test.concurrent("bun add <another name>@<the locked spec> fails when GitHub now sends another commit", async () => {
    // The archive of another commit is not the locked package, so that package is still to download.
    const otherCommit = await build(`${owner}-${repo}-fffffff`, name);
    const locked = { [name]: [lockedPackage, {}, resolved, integrity] };

    const { stderr, exitCode, requests } = await run(locked, otherCommit, ["add", `alias@github:${spec}`]);
    expect(stderr).toContain(`Integrity check failed for tarball: ${name}`);
    expect(exitCode).toBe(1);
    expect(requests).toEqual([tarballPath, tarballPath]);
  });

  test.concurrent("two packages of bun.lock that pin other bytes of one URL are each checked", async () => {
    const renamed = await build(resolved, "renamed");
    const locked = {
      [name]: [lockedPackage, {}, resolved, integrity],
      alias: [`renamed@github:${spec}`, {}, resolved, sri(renamed)],
    };

    // One download used to serve both: `gh-dep` got the bytes that `alias` pins.
    const { stderr, exitCode, requests } = await run(locked, renamed, ["install", "--frozen-lockfile"]);
    expect(stderr).toContain(`Integrity check failed for tarball: ${name}`);
    expect(exitCode).toBe(1);
    expect(requests).toEqual([tarballPath, tarballPath]);
  });

  test.concurrent("a URL that failed for a new dependency is not asked again for the locked package", async () => {
    const locked = { [name]: [lockedPackage, {}, resolved, integrity] };
    // `--force` reads the URL for the new optional dependency, which can fail, before the linker needs the package.
    const more = { optionalDependencies: { alias: spec } };

    const { stderr, exitCode, requests } = await run(locked, 404, ["install", "--force"], more);
    expect(stderr).toContain(`error: failed to download ${lockedPackage}`);
    expect(exitCode).toBe(1);
    expect(requests).toEqual([tarballPath]);
  });
});
