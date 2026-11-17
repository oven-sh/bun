import { $, spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { exists, mkdir, readdir, rm, writeFile } from "fs/promises";
import { bunExe, bunEnv as env, githubTarball, normalizeBunSnapshot, tempDir } from "harness";
import { join } from "path";
import { pathToFileURL } from "url";
import {
  dummyAfterAll,
  dummyAfterEach,
  dummyBeforeAll,
  dummyBeforeEach,
  dummyRegistry,
  package_dir,
  root_url,
  setHandler,
} from "./dummy.registry";

beforeAll(dummyBeforeAll);
afterAll(dummyAfterAll);
beforeEach(async () => {
  await dummyBeforeEach();
});
afterEach(dummyAfterEach);

const packageJson = JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { bar: "^0.0.2" } });

// `package_dir` is created per test by dummyBeforeEach, so derive paths lazily.
const bunfigPath = () => join(package_dir, "bunfig.toml");
const cacheDir = () => join(package_dir, ".bun-cache");

const binaryLockfile = "saveTextLockfile = false\n";
const textLockfile = "saveTextLockfile = true\n";
const defaultLockfileFormat = "";

// The default dummy.registry bunfig disables the global cache; override it
// so `bun pm fetch` uses BUN_INSTALL_CACHE_DIR.
async function writeBunfig(lockfileSetting: string) {
  await writeFile(bunfigPath(), `[install]\nregistry = "${root_url}/"\n${lockfileSetting}`);
}

async function writeProject(lockfileSetting = binaryLockfile) {
  await writeBunfig(lockfileSetting);
  await writeFile(join(package_dir, "package.json"), packageJson);
}

/** Everything in the project directory except the cache the test points BUN_INSTALL_CACHE_DIR at. */
async function projectFiles() {
  return (await readdir(package_dir)).filter(name => name !== ".bun-cache").sort();
}

async function runBun(args: string[], extraEnv: Record<string, string> = {}) {
  await using proc = spawn({
    cmd: [bunExe(), ...args],
    cwd: package_dir,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: { ...env, ...extraEnv },
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

async function fetchIntoCache(cache: string, extraArgs: string[] = [], extraEnv: Record<string, string> = {}) {
  const { stdout, stderr, exitCode } = await runBun(["pm", ...extraArgs, "fetch"], {
    ...extraEnv,
    BUN_INSTALL_CACHE_DIR: cache,
  });
  // The cache path is asserted through the cache's contents instead.
  return { stdout: normalizeBunSnapshot(stdout.replace(/^Cache: .*$/m, "Cache: <cache>")), stderr, exitCode };
}

async function cachedPackages(cache: string) {
  return (await readdir(cache)).filter(name => name.startsWith("bar@0.0.2")).length;
}

it("should fetch dependencies into the cache without installing", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeProject();

  const { stdout, stderr, exitCode } = await fetchIntoCache(cacheDir());
  expect(stdout).toMatchInlineSnapshot(`
    "bun pm fetch <version> (<revision>)

    Fetched 1 package into cache
    Cache: <cache>"
  `);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(urls).toEqual([`${root_url}/bar`, `${root_url}/bar-0.0.2.tgz`]);
  expect(await cachedPackages(cacheDir())).toBe(1);
  expect(
    await Promise.all(["node_modules", "bun.lock", "bun.lockb"].map(name => exists(join(package_dir, name)))),
  ).toEqual([false, false, false]);

  // The point of the command: a following install is served entirely from the cache.
  urls.length = 0;
  const install = await runBun(["install"], { BUN_INSTALL_CACHE_DIR: cacheDir() });
  expect(install.stderr).toContain("Saved lockfile");
  expect(install.exitCode).toBe(0);
  expect(urls).toEqual([]);
  expect(await exists(join(package_dir, "node_modules", "bar", "package.json"))).toBe(true);
});

it("should fetch packages missing from cache when lockfile exists", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeProject();

  {
    const { stderr, exitCode } = await runBun(["install"], { BUN_INSTALL_CACHE_DIR: cacheDir() });
    expect(stderr).toContain("Saved lockfile");
    expect(exitCode).toBe(0);
  }
  await rm(cacheDir(), { recursive: true, force: true });
  await rm(join(package_dir, "node_modules"), { recursive: true, force: true });
  urls.length = 0;

  const { stdout, stderr, exitCode } = await fetchIntoCache(cacheDir());
  expect(stdout).toMatchInlineSnapshot(`
    "bun pm fetch <version> (<revision>)

    Fetched 1 package into cache
    Cache: <cache>"
  `);
  // Nothing had to be resolved, so only the second pass (the one that walks the lockfile) printed anything.
  expect(stderr).toBe("Fetching packages\n");
  expect(exitCode).toBe(0);

  // Downloaded straight from the URL stored in the lockfile, no manifest request.
  expect(urls).toEqual([`${root_url}/bar-0.0.2.tgz`]);
  expect(await cachedPackages(cacheDir())).toBe(1);
  expect(await exists(join(package_dir, "node_modules"))).toBe(false);
});

// Simulates a Docker layer: `COPY package.json bun.lock ./` followed by `RUN bun pm fetch`.
it.each(["packages/*", "packages/web"])(
  "should fetch the dependencies of a workspace in %s that isn't on disk yet",
  async workspace => {
    const urls: string[] = [];
    setHandler(dummyRegistry(urls));
    await writeBunfig(textLockfile);
    await writeFile(join(package_dir, "package.json"), JSON.stringify({ name: "foo", workspaces: [workspace] }));
    await mkdir(join(package_dir, "packages", "web"), { recursive: true });
    await writeFile(
      join(package_dir, "packages", "web", "package.json"),
      JSON.stringify({ name: "web", dependencies: { bar: "^0.0.2" } }),
    );
    {
      const { stderr, exitCode } = await runBun(["install"], { BUN_INSTALL_CACHE_DIR: cacheDir() });
      expect(stderr).toContain("Saved lockfile");
      expect(exitCode).toBe(0);
    }
    for (const name of [".bun-cache", "node_modules", "packages"]) {
      await rm(join(package_dir, name), { recursive: true, force: true });
    }
    urls.length = 0;

    const { stdout, stderr, exitCode } = await fetchIntoCache(cacheDir());
    expect(stdout).toMatchInlineSnapshot(`
    "bun pm fetch <version> (<revision>)

    Fetched 1 package into cache
    Cache: <cache>"
  `);
    expect(stderr).toContain('skipped 1 workspace listed in bun.lock but not on disk: "web"');
    expect(urls).toEqual([`${root_url}/bar-0.0.2.tgz`]);
    expect(await cachedPackages(cacheDir())).toBe(1);
    expect(exitCode).toBe(0);
  },
);

it.each(["*", "^1.0.0", "workspace:*"])(
  "should not look up a missing workspace in the registry when the root depends on it as %s",
  async range => {
    const urls: string[] = [];
    setHandler(dummyRegistry(urls));
    await writeBunfig(textLockfile);
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({ name: "foo", workspaces: ["packages/*"], dependencies: { lib: range } }),
    );
    await mkdir(join(package_dir, "packages", "lib"), { recursive: true });
    await writeFile(
      join(package_dir, "packages", "lib", "package.json"),
      JSON.stringify({ name: "lib", version: "1.0.0" }),
    );
    {
      const { stderr, exitCode } = await runBun(["install"], { BUN_INSTALL_CACHE_DIR: cacheDir() });
      expect(stderr).toContain("Saved lockfile");
      expect(exitCode).toBe(0);
    }
    for (const name of [".bun-cache", "node_modules", "packages"]) {
      await rm(join(package_dir, name), { recursive: true, force: true });
    }
    urls.length = 0;

    const { stderr, exitCode } = await fetchIntoCache(cacheDir());
    expect(stderr).toContain(
      'error: the root package depends on workspace "lib" (packages/lib), which is listed in bun.lock but not on disk',
    );
    expect(urls).toEqual([]);
    expect(exitCode).toBe(1);
  },
);

it("should not write bun.lock when the lockfile comes from package-lock.json", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeProject(defaultLockfileFormat);
  await writeFile(
    join(package_dir, "package-lock.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": { name: "foo", version: "0.0.1", dependencies: { bar: "^0.0.2" } },
        "node_modules/bar": { version: "0.0.2", resolved: `${root_url}/bar-0.0.2.tgz` },
      },
    }),
  );
  const before = await projectFiles();

  const { stdout, stderr, exitCode } = await fetchIntoCache(cacheDir());
  expect(stdout).toMatchInlineSnapshot(`
    "bun pm fetch <version> (<revision>)

    Fetched 1 package into cache
    Cache: <cache>"
  `);
  expect(stderr).not.toContain("Saved lockfile");
  expect(exitCode).toBe(0);

  // Resolved from package-lock.json, so only the tarball was requested.
  expect(urls).toEqual([`${root_url}/bar-0.0.2.tgz`]);
  expect(await cachedPackages(cacheDir())).toBe(1);
  expect(await projectFiles()).toEqual(before);
});

it("should not migrate bun.lockb to bun.lock even when saveTextLockfile is set", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeProject(binaryLockfile);
  {
    const { stderr, exitCode } = await runBun(["install"], { BUN_INSTALL_CACHE_DIR: cacheDir() });
    expect(stderr).toContain("Saved lockfile");
    expect(exitCode).toBe(0);
  }
  await rm(join(package_dir, "node_modules"), { recursive: true, force: true });
  await writeBunfig(textLockfile);
  const before = await projectFiles();
  expect(before).toContain("bun.lockb");

  const { stdout, stderr, exitCode } = await fetchIntoCache(cacheDir());
  expect(stdout).toMatchInlineSnapshot(`
    "bun pm fetch <version> (<revision>)

    Done! 1 package already in cache
    Cache: <cache>"
  `);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(await projectFiles()).toEqual(before);
});

it("should ignore --lockfile-only", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeProject();
  const before = await projectFiles();

  const { stdout, stderr, exitCode } = await fetchIntoCache(cacheDir(), ["--lockfile-only"]);
  expect(stdout).toMatchInlineSnapshot(`
    "bun pm fetch <version> (<revision>)

    Fetched 1 package into cache
    Cache: <cache>"
  `);
  expect(stderr).not.toContain("Saved lockfile");
  expect(exitCode).toBe(0);

  expect(urls).toEqual([`${root_url}/bar`, `${root_url}/bar-0.0.2.tgz`]);
  expect(await cachedPackages(cacheDir())).toBe(1);
  expect(await projectFiles()).toEqual(before);
});

it("should report when all packages are already cached", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeProject();

  expect((await fetchIntoCache(cacheDir())).exitCode).toBe(0);
  urls.length = 0;

  const { stdout, stderr, exitCode } = await fetchIntoCache(cacheDir());
  expect(stdout).toMatchInlineSnapshot(`
    "bun pm fetch <version> (<revision>)

    Done! 1 package already in cache
    Cache: <cache>"
  `);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  expect(urls).toEqual([]);
  expect(await exists(join(package_dir, "node_modules"))).toBe(false);
});

describe.each([
  { title: "--dry-run", flags: ["--dry-run"], bunfig: "" },
  { title: "dryRun = true in bunfig.toml", flags: [], bunfig: "dryRun = true\n" },
])("$title", ({ flags, bunfig }) => {
  it.each(["with", "without"])(
    "counts the packages that are missing from the cache and downloads none of them, %s a lockfile",
    async lockfile => {
      const urls: string[] = [];
      setHandler(dummyRegistry(urls));
      await writeProject();
      if (lockfile === "with") {
        expect((await runBun(["install"], { BUN_INSTALL_CACHE_DIR: cacheDir() })).exitCode).toBe(0);
        await rm(cacheDir(), { recursive: true, force: true });
        await rm(join(package_dir, "node_modules"), { recursive: true, force: true });
      }
      await writeBunfig(binaryLockfile + bunfig);
      const before = await projectFiles();
      urls.length = 0;

      const { stdout, stderr, exitCode } = await fetchIntoCache(cacheDir(), flags);
      expect(stdout).toMatchInlineSnapshot(`
        "bun pm fetch <version> (<revision>)

        Would fetch 1 package into cache
        Cache: <cache>"
      `);
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);

      expect(urls).toEqual(lockfile === "with" ? [] : [`${root_url}/bar`]);
      expect(await cachedPackages(cacheDir())).toBe(0);
      expect(await projectFiles()).toEqual(before);
    },
  );
});

it.each([
  ["--no-summary", expect.not.stringContaining("error:")],
  ["--silent", ""],
])("should still fetch but print nothing to stdout with %s", async (flag, stderr) => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeProject();

  expect(await fetchIntoCache(cacheDir(), [flag])).toEqual({ stdout: "", stderr, exitCode: 0 });
  expect(urls).toEqual([`${root_url}/bar`, `${root_url}/bar-0.0.2.tgz`]);
  expect(await cachedPackages(cacheDir())).toBe(1);
});

it("should fetch the global install's dependencies with -g", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeProject();
  const bunInstall = join(package_dir, "global-install");
  const globalDir = join(bunInstall, "install", "global");
  await mkdir(globalDir, { recursive: true });
  await writeFile(join(globalDir, "package.json"), packageJson);

  const { stdout, stderr, exitCode } = await fetchIntoCache(cacheDir(), ["-g", `--config=${bunfigPath()}`], {
    BUN_INSTALL: bunInstall,
  });
  expect(stdout).toMatchInlineSnapshot(`
    "bun pm fetch <version> (<revision>)

    Fetched 1 package into cache
    Cache: <cache>"
  `);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);

  expect(urls).toEqual([`${root_url}/bar`, `${root_url}/bar-0.0.2.tgz`]);
  expect(await cachedPackages(cacheDir())).toBe(1);
  expect(await readdir(globalDir)).toEqual(["package.json"]);
});

it.each([[[]], [["--help"]]])("should appear in bun pm help (%j)", async extraArgs => {
  await writeFile(join(package_dir, "package.json"), packageJson);

  const { stdout, exitCode } = await runBun(["pm", ...extraArgs]);
  expect(stdout).toMatch(/^\s*bun pm fetch\s+download all dependencies into the cache without installing$/m);
  expect(exitCode).toBe(0);
});

// Every kind of dependency that has a cache entry. All but `npm` depend on the registry package `dep` in turn.
const kinds = ["npm", "github", "url", "file", "git"] as const;
type Kind = (typeof kinds)[number];

const packed = (name: string, dependencies?: Record<string, string>) =>
  new Bun.Archive(
    { "package/package.json": JSON.stringify({ name, version: "1.0.0", dependencies }) },
    { compress: "gzip" },
  ).bytes();

/** A project with one dependency of `kind`, and a server that is its registry, its GitHub API and its tarball host. */
async function projectWith(kind: Kind, bunfigTail = "") {
  const needsDep = { dep: "^1.0.0" };
  const bodies: Record<string, Uint8Array> = {
    "/dep-1.0.0.tgz": await packed("dep"),
    "/files/url-dep-1.0.0.tgz": await packed("url-dep", needsDep),
  };
  const repository = await githubTarball("owner-repo-abc1234", {
    "package.json": JSON.stringify({ name: "github-dep", version: "1.0.0", dependencies: needsDep }),
  });
  const requests: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const { pathname, origin } = new URL(req.url);
      requests.push(pathname);
      if (pathname === "/dep") {
        const version = { name: "dep", version: "1.0.0", dist: { tarball: `${origin}/dep-1.0.0.tgz` } };
        return Response.json({ name: "dep", "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": version } });
      }
      if (pathname.startsWith("/repos/owner/repo/tarball/")) return new Response(repository);
      return pathname in bodies ? new Response(bodies[pathname]) : new Response(null, { status: 404 });
    },
  });
  const origin = server.url.origin;
  const dir = tempDir(`pm-fetch-${kind}`, {
    "repo/package.json": JSON.stringify({ name: "git-dep", version: "1.0.0", dependencies: needsDep }),
    "project/vendor/file-dep-1.0.0.tgz": await packed("file-dep", needsDep),
    "project/bunfig.toml": `[install]\nregistry = "${origin}/"\n${bunfigTail}`,
  });
  const root = String(dir);
  if (kind === "git") {
    const author = { GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.com" };
    await $`git init -q && git add -A && git commit -q -m init --no-gpg-sign`
      .cwd(join(root, "repo"))
      .env({ ...env, ...author, GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.com" })
      .quiet();
  }
  const [name, spec] = {
    npm: ["dep", "1.0.0"],
    github: ["github-dep", "owner/repo#v1"],
    url: ["url-dep", `${origin}/files/url-dep-1.0.0.tgz`],
    file: ["file-dep", "file:./vendor/file-dep-1.0.0.tgz"],
    git: ["git-dep", `git+${pathToFileURL(join(root, "repo")).href}`],
  }[kind];
  const project = join(root, "project");
  await writeFile(join(project, "package.json"), JSON.stringify({ name: "project", dependencies: { [name]: spec } }));

  return {
    name,
    project,
    /** The paths requested since the last call, sorted: downloads run side by side. */
    requested: () => requests.splice(0).sort(),
    /** Runs `bun <args>` in the project, with the cache directory `cache`. */
    async bun(cache: string, ...args: string[]) {
      await using proc = spawn({
        cmd: [bunExe(), ...args],
        cwd: project,
        env: { ...env, GITHUB_API_URL: origin, BUN_INSTALL_CACHE_DIR: join(root, cache) },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout: normalizeBunSnapshot(stdout.replace(/^Cache: .*$/m, "Cache: <cache>")), stderr, exitCode };
    },
    files: async () => (await readdir(project)).sort(),
    [Symbol.asyncDispose]: async () => {
      await server.stop(true);
      dir[Symbol.dispose]();
    },
  };
}

const summary = (line: string) => `bun pm fetch <version> (<revision>)\n\n${line}\nCache: <cache>`;

describe.each(kinds)("a %s dependency", kind => {
  const packages = kind === "npm" ? 1 : 2;
  const plural = packages === 1 ? "package" : "packages";

  it("pinned by bun.lock is fetched as pinned, and then installs offline under both linkers", async () => {
    await using fixture = await projectWith(kind);
    const { bun, requested, files, project, name } = fixture;
    expect(await bun("other-cache", "install", "--lockfile-only")).toMatchObject({ exitCode: 0 });
    const before = await files();
    const lockfile = await Bun.file(join(project, "bun.lock")).text();
    requested();

    expect(await bun("cache", "pm", "fetch", "--frozen-lockfile")).toEqual({
      stdout: summary(`Fetched ${packages} ${plural} into cache`),
      stderr: "Fetching packages\n",
      exitCode: 0,
    });
    // No manifest, and the commit the lockfile has: not the ref in package.json, which may have moved.
    expect(requested()).toEqual(
      {
        npm: ["/dep-1.0.0.tgz"],
        github: ["/dep-1.0.0.tgz", "/repos/owner/repo/tarball/abc1234"],
        url: ["/dep-1.0.0.tgz", "/files/url-dep-1.0.0.tgz"],
        file: ["/dep-1.0.0.tgz"],
        git: ["/dep-1.0.0.tgz"],
      }[kind],
    );
    expect(await files()).toEqual(before);
    expect(await Bun.file(join(project, "bun.lock")).text()).toBe(lockfile);

    for (const linker of ["hoisted", "isolated"]) {
      const install = await bun("cache", "install", "--offline", "--frozen-lockfile", `--linker=${linker}`);
      expect(install.stderr).not.toContain("error:");
      expect(install.exitCode).toBe(0);
      expect(await Bun.file(join(project, "node_modules", name, "package.json")).json()).toMatchObject({ name });
      await rm(join(project, "node_modules"), { recursive: true });
    }
    expect(requested()).toEqual([]);

    expect(await bun("cache", "pm", "fetch")).toEqual({
      stdout: summary(`Done! ${packages} ${plural} already in cache`),
      stderr: "",
      exitCode: 0,
    });
    expect(requested()).toEqual([]);
  });

  it("without a lockfile is resolved and fetched, and nothing is written", async () => {
    await using fixture = await projectWith(kind);
    const { bun, requested, files, project, name } = fixture;
    const before = await files();

    const fetched = await bun("cache", "pm", "fetch");
    expect(fetched.stdout).toBe(summary(`Fetched ${packages} ${plural} into cache`));
    expect(fetched.stderr).not.toContain("error:");
    expect(fetched.exitCode).toBe(0);
    expect(await files()).toEqual(before);
    requested();

    // There's no way to know what a `github:` ref or a URL points to without a request, so without a lockfile
    // `--offline` can't find their entries. Everything below them comes from the cache.
    const again = { github: ["/repos/owner/repo/tarball/v1"], url: ["/files/url-dep-1.0.0.tgz"] }[kind as string];
    const install = await bun("cache", "install", ...(again ? [] : ["--offline"]));
    expect(install.stderr).not.toContain("error:");
    expect(install.exitCode).toBe(0);
    expect(requested()).toEqual(again ?? []);
    expect(await Bun.file(join(project, "node_modules", name, "package.json")).json()).toMatchObject({ name });
  });
});

it("--frozen-lockfile fails like bun install when package.json has moved on", async () => {
  await using fixture = await projectWith("npm");
  const { bun, files, project } = fixture;
  expect(await bun("other-cache", "install", "--lockfile-only")).toMatchObject({ exitCode: 0 });
  const dependencies = { dep: "1.0.0", "file-dep": "file:./vendor/file-dep-1.0.0.tgz" };
  await writeFile(join(project, "package.json"), JSON.stringify({ name: "project", dependencies }));
  const before = await files();
  const lockfile = await Bun.file(join(project, "bun.lock")).text();

  const { stdout, stderr, exitCode } = await bun("cache", "pm", "fetch", "--frozen-lockfile");
  expect(stderr).toContain("error: lockfile had changes, but lockfile is frozen");
  expect(stdout).toBe("bun pm fetch <version> (<revision>)");
  expect(exitCode).toBe(1);
  expect(await files()).toEqual(before);
  expect(await Bun.file(join(project, "bun.lock")).text()).toBe(lockfile);
});

it("--offline reports the packages that are missing from the cache and requests nothing", async () => {
  await using fixture = await projectWith("npm");
  const { bun, requested } = fixture;
  expect(await bun("other-cache", "install", "--lockfile-only")).toMatchObject({ exitCode: 0 });
  requested();

  const { stdout, stderr, exitCode } = await bun("cache", "pm", "fetch", "--offline");
  expect(stderr).toBe('error: --offline: "dep" is not in the cache\n');
  expect(stdout).toBe("bun pm fetch <version> (<revision>)");
  expect(exitCode).toBe(1);
  expect(requested()).toEqual([]);
});

it("a tarball that cannot be downloaded fails the command", async () => {
  await using fixture = await projectWith("npm");
  const { bun, project } = fixture;
  expect(await bun("other-cache", "install", "--lockfile-only")).toMatchObject({ exitCode: 0 });
  const lockfile = join(project, "bun.lock");
  await writeFile(lockfile, (await Bun.file(lockfile).text()).replace("/dep-1.0.0.tgz", "/gone-1.0.0.tgz"));

  const { stdout, stderr, exitCode } = await bun("cache", "pm", "fetch");
  expect(stderr).toContain("/gone-1.0.0.tgz");
  expect(stderr).toContain("404");
  expect(stdout).toBe("bun pm fetch <version> (<revision>)");
  expect(exitCode).toBe(1);
});

// Nothing is linked or run, so the scan is left to the install. --verbose says so.
it("does not run the security scanner", async () => {
  await using fixture = await projectWith("npm", `[install.security]\nscanner = "./scanner.ts"\n`);
  const { bun, requested, project } = fixture;
  await writeFile(
    join(project, "scanner.ts"),
    `import { writeFileSync } from "node:fs";
    export const scanner = {
      version: "1",
      async scan({ packages }) {
        writeFileSync("scanned.json", JSON.stringify(packages.map(p => p.name)));
        return [];
      },
    };`,
  );
  const note = "note: packages are not scanned until bun install runs the security scanner\n";

  const fetched = await bun("cache", "pm", "fetch");
  expect(fetched.stderr).not.toContain(note);
  expect(fetched.stdout).toBe(summary("Fetched 1 package into cache"));
  expect(fetched.exitCode).toBe(0);
  expect(requested()).toEqual(["/dep", "/dep-1.0.0.tgz"]);
  expect(await exists(join(project, "scanned.json"))).toBe(false);

  expect(await bun("cache", "pm", "fetch", "--silent")).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  expect((await bun("cache", "pm", "fetch", "--verbose")).stderr).toContain(note);

  expect(await bun("cache", "install")).toMatchObject({ exitCode: 0 });
  expect(await Bun.file(join(project, "scanned.json")).json()).toEqual(["dep"]);
  expect(requested()).toEqual([]);
});
