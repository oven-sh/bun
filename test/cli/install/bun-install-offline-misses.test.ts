import { spawn } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { rm, writeFile } from "fs/promises";
import { bunExe, bunEnv as env, readdirSorted, tempDir } from "harness";
import { join } from "path";
import { pathToFileURL } from "url";

// The CI runner exports BUN_INSTALL_CACHE_DIR, which would override the cache of each project.
const { BUN_INSTALL_CACHE_DIR: _ciCacheDir, ...installEnv } = env;

const gitEnv = {
  ...installEnv,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

async function install(cwd: string, args: string[]) {
  await using proc = spawn({
    cmd: [bunExe(), "install", ...args],
    cwd,
    env: installEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { out, err, code };
}

// The install phase of `bun install --offline` can meet an optional dependency that is not in the
// cache: the lockfile resolves it, but no earlier install placed it (it is for another platform),
// or the cache lost it. --offline skips it. What is below it is then not required by anything that
// is installed, so a cache miss there is not an error. A package that an installed package requires
// still is. Every install here reads bun.lock, so no case depends on the manifest cache, which an
// install does not flush before it exits.
describe.concurrent("--offline with an optional dependency that is not in the cache", () => {
  const otherCpu = process.arch === "arm64" ? "x64" : "arm64";
  const otherOs = process.platform === "linux" ? "darwin" : "linux";
  // name -> version -> the rest of its package.json
  const packages: Record<string, Record<string, object>> = {
    "host": { "1.0.0": { optionalDependencies: { native: "1.0.0" } } },
    "native": { "1.0.0": { dependencies: { leaf: "1.0.0" } } },
    "host-other-cpu": { "1.0.0": { optionalDependencies: { "native-other-cpu": "1.0.0" } } },
    "native-other-cpu": { "1.0.0": { cpu: [otherCpu], dependencies: { leaf: "1.0.0" } } },
    "uses-leaf": { "1.0.0": { dependencies: { leaf: "1.0.0" } } },
    "uses-leaf-2": { "1.0.0": { dependencies: { leaf: "2.0.0" } } },
    "uses-native": { "1.0.0": { dependencies: { native: "1.0.0" } } },
    "optional-peer-native": {
      "1.0.0": { peerDependencies: { native: "1.0.0" }, peerDependenciesMeta: { native: { optional: true } } },
    },
    "peer-leaf": { "1.0.0": { peerDependencies: { leaf: "1.0.0" } } },
    "mid": { "1.0.0": { dependencies: { leaf: "1.0.0" } }, "2.0.0": {} },
    "host-two-natives": {
      "1.0.0": { optionalDependencies: { "native-leaf-other-cpu": "1.0.0", "native-mid-other-os": "1.0.0" } },
    },
    "native-leaf-other-cpu": { "1.0.0": { cpu: [otherCpu], optionalDependencies: { leaf: "1.0.0" } } },
    "native-mid-other-os": { "1.0.0": { os: [otherOs], dependencies: { mid: "1.0.0" } } },
    "peer-mid": { "1.0.0": { peerDependencies: { mid: "1.0.0" } } },
    "dup": { "1.0.0": { dependencies: { leaf: "1.0.0" } }, "2.0.0": {} },
    "optional-dup-a": { "1.0.0": { optionalDependencies: { dup: "1.0.0" } } },
    "optional-dup-b": { "1.0.0": { optionalDependencies: { dup: "1.0.0" } } },
    "scanner": { "1.0.0": { main: "index.js" } },
    "scanner-with-native": { "1.0.0": { main: "index.js", optionalDependencies: { native: "1.0.0" } } },
    "leaf": { "1.0.0": {}, "2.0.0": {} },
    "plain": { "1.0.0": {} },
  };
  const tarballs: Record<string, Uint8Array> = {};
  // A git dependency that depends on leaf.
  const hasGit = !!Bun.which("git");
  let gitDir: ReturnType<typeof tempDir> | undefined;
  let gitNative = "";

  beforeAll(async () => {
    for (const [name, versions] of Object.entries(packages)) {
      for (const [version, rest] of Object.entries(versions)) {
        const manifest = JSON.stringify({ name, version, ...rest });
        tarballs[`${name}-${version}.tgz`] = await new Bun.Archive(
          {
            "package/package.json": manifest,
            "package/index.js": `exports.scanner = { version: "1", scan: async () => [] };`,
          },
          { compress: "gzip" },
        ).bytes();
      }
    }
    if (!hasGit) return;
    gitDir = tempDir("offline-optional-git", {
      work: {
        "package.json": JSON.stringify({ name: "git-native", version: "1.0.0", dependencies: { leaf: "1.0.0" } }),
      },
    });
    const bare = join(String(gitDir), "repo.git");
    for (const cmd of [
      ["init", "-q"],
      ["add", "-A"],
      ["commit", "-q", "-m", "init", "--no-gpg-sign"],
      ["clone", "-q", "--bare", ".", bare],
    ]) {
      await using p = spawn({
        cmd: ["git", ...cmd],
        cwd: join(String(gitDir), "work"),
        env: gitEnv,
        stdout: "ignore",
        stderr: "pipe",
      });
      const [gitErr, gitCode] = await Promise.all([p.stderr.text(), p.exited]);
      expect(gitErr).not.toContain("fatal:");
      expect(gitCode).toBe(0);
    }
    gitNative = `git+${pathToFileURL(bare)}`;
  });
  afterAll(() => gitDir?.[Symbol.dispose]());

  function serveRegistry(requests: string[]) {
    return Bun.serve({
      port: 0,
      fetch(request) {
        const { origin, pathname } = new URL(request.url);
        requests.push(pathname);
        const name = pathname.slice(1);
        if (name in tarballs) return new Response(tarballs[name]);
        if (!(name in packages)) return new Response("not found", { status: 404 });
        const versions: Record<string, object> = {};
        for (const [version, rest] of Object.entries(packages[name])) {
          versions[version] = { name, version, ...rest, dist: { tarball: `${origin}/${name}-${version}.tgz` } };
        }
        return Response.json({ name, "dist-tags": { latest: Object.keys(versions).at(-1) }, versions });
      },
    });
  }

  /** The names of the packages in node_modules, whatever the linker. */
  async function installedPackages(cwd: string, linker: "hoisted" | "isolated") {
    if (linker === "hoisted") {
      return (await readdirSorted(join(cwd, "node_modules"))).filter(entry => !entry.startsWith("."));
    }
    return (await readdirSorted(join(cwd, "node_modules", ".bun")))
      .filter(entry => entry !== "node_modules")
      .map(entry => entry.slice(0, entry.lastIndexOf("@")));
  }

  const cacheEntriesOf =
    (...names: string[]) =>
    (entry: string) =>
      names.some(name => entry === name || entry.startsWith(name + "@"));
  const gitCacheEntries = (entry: string) => entry.endsWith(".git") || entry.startsWith("@G@");

  /**
   * Installs online, removes the `evict` entries from the cache, then installs again with
   * --offline, without node_modules unless `keepNodeModules` is set.
   */
  async function installOfflineAfterOnline(
    linker: "hoisted" | "isolated",
    project: {
      manifest: object;
      evict?: (cacheEntry: string) => boolean;
      offlineArgs?: string[];
      keepNodeModules?: boolean;
      /** Folders below node_modules to remove before the --offline install. */
      removeFolders?: string[];
      /** The `install.security.scanner` of bunfig.toml, for the --offline install only. */
      scanner?: string;
      /** Folders below node_modules to return the installed version of. */
      versionsOf?: string[];
    },
  ) {
    const requests: string[] = [];
    await using registry = serveRegistry(requests);
    using dir = tempDir("offline-optional", {
      "package.json": JSON.stringify({ name: "app", version: "1.0.0", ...project.manifest }),
    });
    const cwd = String(dir);
    const cache = join(cwd, ".cache");
    const installConfig = { cache: { dir: cache }, registry: registry.url.href, saveTextLockfile: true, linker };
    await writeFile(join(cwd, "bunfig.toml"), Bun.TOML.stringify({ install: installConfig }));

    const online = await install(cwd, []);
    expect(online.err).not.toContain("error:");
    expect(online.code).toBe(0);
    const lockfile = await Bun.file(join(cwd, "bun.lock")).text();

    for (const entry of await readdirSorted(cache)) {
      if (project.evict?.(entry)) await rm(join(cache, entry), { recursive: true, force: true });
    }
    if (!project.keepNodeModules) await rm(join(cwd, "node_modules"), { recursive: true, force: true });
    for (const folder of project.removeFolders ?? []) {
      await rm(join(cwd, "node_modules", folder), { recursive: true });
    }
    if (project.scanner) {
      await writeFile(
        join(cwd, "bunfig.toml"),
        Bun.TOML.stringify({ install: { ...installConfig, security: { scanner: project.scanner } } }),
      );
    }

    const before = requests.length;
    const offline = await install(cwd, ["--offline", ...(project.offlineArgs ?? [])]);
    const versions: Record<string, string> = {};
    for (const folder of project.versionsOf ?? []) {
      versions[folder] = (await Bun.file(join(cwd, "node_modules", folder, "package.json")).json()).version;
    }
    return {
      err: offline.err,
      code: offline.code,
      installed: await installedPackages(cwd, linker),
      requests: requests.slice(before),
      lockfileChanged: lockfile !== (await Bun.file(join(cwd, "bun.lock")).text()),
      versions,
    };
  }

  describe.each(["hoisted", "isolated"] as const)("%s linker", linker => {
    it("installs from the cache of an install for another cpu", async () => {
      // The online install does not place native-other-cpu, so it caches neither that package nor leaf.
      const { err, code, ...result } = await installOfflineAfterOnline(linker, {
        manifest: { dependencies: { "host-other-cpu": "1.0.0" } },
        offlineArgs: [`--cpu=${otherCpu}`],
      });
      expect(err).not.toContain("error:");
      expect(result).toEqual({ installed: ["host-other-cpu"], requests: [], lockfileChanged: false, versions: {} });
      expect(code).toBe(0);
    });

    it("skips an optional dependency that has no dependencies", async () => {
      const { err, code, ...result } = await installOfflineAfterOnline(linker, {
        manifest: { dependencies: { "uses-leaf": "1.0.0" }, optionalDependencies: { plain: "1.0.0" } },
        evict: cacheEntriesOf("plain"),
      });
      expect(err).not.toContain("error:");
      expect(result).toEqual({
        installed: ["leaf", "uses-leaf"],
        requests: [],
        lockfileChanged: false,
        versions: {},
      });
      expect(code).toBe(0);
    });

    it("does not report what is below the optional dependency", async () => {
      const { err, code, ...result } = await installOfflineAfterOnline(linker, {
        manifest: { dependencies: { host: "1.0.0" } },
        evict: cacheEntriesOf("native", "leaf"),
      });
      expect(err).not.toContain("error:");
      expect(result).toEqual({ installed: ["host"], requests: [], lockfileChanged: false, versions: {} });
      expect(code).toBe(0);
    });

    it.skipIf(!hasGit)("does not report what is below an optional git dependency", async () => {
      const { err, code, ...result } = await installOfflineAfterOnline(linker, {
        manifest: { dependencies: { plain: "1.0.0" }, optionalDependencies: { "git-native": gitNative } },
        evict: entry => gitCacheEntries(entry) || cacheEntriesOf("leaf")(entry),
      });
      expect(err).not.toContain("error:");
      expect(result).toEqual({ installed: ["plain"], requests: [], lockfileChanged: false, versions: {} });
      expect(code).toBe(0);
    });

    it.skipIf(!hasGit)("checks out an optional git dependency from the clone in the cache", async () => {
      const { err, code, ...result } = await installOfflineAfterOnline(linker, {
        manifest: { dependencies: { plain: "1.0.0" }, optionalDependencies: { "git-native": gitNative } },
        evict: entry => entry.startsWith("@G@"),
      });
      expect(err).not.toContain("error:");
      expect(result).toEqual({
        installed: ["git-native", "leaf", "plain"],
        requests: [],
        lockfileChanged: false,
        versions: {},
      });
      expect(code).toBe(0);
    });

    it.each([
      {
        title: "below it that another installed package requires",
        dependencies: { host: "1.0.0", "uses-leaf": "1.0.0" },
        evict: ["native", "leaf"],
        missing: "leaf",
      },
      {
        title: "below it when the optional dependency itself is in the cache",
        dependencies: { host: "1.0.0" },
        evict: ["leaf"],
        missing: "leaf",
      },
      {
        // Nothing but native lists leaf, so the peer dependency of peer-leaf is what installs it.
        title: "below it that an installed package has a peer dependency on",
        optionalDependencies: { native: "1.0.0" },
        dependencies: { "peer-leaf": "1.0.0" },
        evict: ["native", "leaf"],
        missing: "leaf",
      },
      {
        // The peer dependency of peer-mid installs mid, which is in the cache and requires leaf.
        title: "below it that a package installed for a peer dependency requires",
        optionalDependencies: { native: "1.0.0" },
        dependencies: { "peer-mid": "1.0.0" },
        evict: ["native", "leaf"],
        missing: "leaf",
      },
      {
        // host is placed first, so the folder of native carries the optional dependency.
        title: "that is optional for one installed package and required by another",
        dependencies: { host: "1.0.0", "uses-native": "1.0.0" },
        evict: ["native"],
        missing: "native",
      },
    ])("still reports a package $title", async ({ dependencies, optionalDependencies, evict, missing }) => {
      const r = await installOfflineAfterOnline(linker, {
        manifest: { dependencies, optionalDependencies },
        evict: cacheEntriesOf(...evict),
      });
      expect(r.err).toContain(`error: --offline: "${missing}" is not in the cache`);
      expect(r.requests).toEqual([]);
      expect(r.code).toBe(1);
    });

    it("names every required package that an empty cache lacks", async () => {
      const r = await installOfflineAfterOnline(linker, {
        manifest: { dependencies: { host: "1.0.0", "uses-leaf": "1.0.0" } },
        evict: () => true,
      });
      // native is optional for host. leaf is below it, but uses-leaf requires leaf too.
      expect(Array.from(r.err.matchAll(/--offline: "(.+)" is not in the cache/g), match => match[1]).sort()).toEqual([
        "host",
        "leaf",
        "uses-leaf",
      ]);
      expect(r.requests).toEqual([]);
      expect(r.code).toBe(1);
    });

    it("does not require what is below a package that a peer resolves to but no linker places", async () => {
      // The lockfile resolves the peer of peer-mid to mid@1.0.0, which only native-mid-other-os lists.
      // The linkers bind it to mid@2.0.0 of the root, so nothing places mid@1.0.0 or requires leaf.
      const { err, code, ...result } = await installOfflineAfterOnline(linker, {
        manifest: { dependencies: { mid: "2.0.0", "peer-mid": "1.0.0", "host-two-natives": "1.0.0" } },
        offlineArgs: [`--cpu=${otherCpu}`],
      });
      expect(err).not.toContain("error:");
      expect(result).toEqual({
        installed: ["host-two-natives", "mid", "peer-mid"],
        requests: [],
        lockfileChanged: false,
        versions: {},
      });
      expect(code).toBe(0);
    });

    it("skips a package that is optional for one package and an optional peer of another", async () => {
      const { err, code, ...result } = await installOfflineAfterOnline(linker, {
        manifest: { optionalDependencies: { native: "1.0.0" }, dependencies: { "optional-peer-native": "1.0.0" } },
        evict: cacheEntriesOf("native", "leaf"),
      });
      expect(err).not.toContain("error:");
      expect(result).toEqual({
        installed: ["optional-peer-native"],
        requests: [],
        lockfileChanged: false,
        versions: {},
      });
      expect(code).toBe(0);
    });

    it("still reports a package that the install of a security scanner skipped", async () => {
      // The scanner is installed first, on its own. That install skips native and leaf.
      const r = await installOfflineAfterOnline(linker, {
        manifest: { devDependencies: { "scanner-with-native": "1.0.0" }, dependencies: { "uses-leaf": "1.0.0" } },
        scanner: "scanner-with-native",
        evict: cacheEntriesOf("native", "leaf"),
      });
      expect(r.err).toContain('error: --offline: "leaf" is not in the cache');
      expect(r.requests).toEqual([]);
      expect(r.code).toBe(1);
    });

    it("fails the install of a security scanner that is not in the cache", async () => {
      const r = await installOfflineAfterOnline(linker, {
        manifest: { devDependencies: { scanner: "1.0.0" } },
        scanner: "scanner",
        evict: cacheEntriesOf("scanner"),
      });
      expect(r.err).toContain(
        linker === "isolated"
          ? "error: failed to install security scanner package"
          : "error: no packages were installed during security scanner installation",
      );
      expect(r.requests).toEqual([]);
      expect(r.code).toBe(1);
    });

    // The hoisted linker nests dup@1.0.0 twice, because the root holds dup@2.0.0. One folder stays in place.
    it.if(linker === "hoisted")("still reports what a package requires if one of its folders is in place", async () => {
      const r = await installOfflineAfterOnline(linker, {
        manifest: { dependencies: { dup: "2.0.0", "optional-dup-a": "1.0.0", "optional-dup-b": "1.0.0" } },
        evict: () => true,
        keepNodeModules: true,
        removeFolders: ["optional-dup-b/node_modules/dup", "leaf"],
      });
      expect(r.err).toContain('error: --offline: "leaf" is not in the cache');
      expect(r.requests).toEqual([]);
      expect(r.code).toBe(1);
    });

    it("leaves an installed node_modules alone when the cache is gone", async () => {
      // The root's optional dependency is placed first, so leaf@1.0.0 below it takes the root
      // folder and leaf@2.0.0 nests. The layout must not depend on what is in the cache.
      const { err, code, ...result } = await installOfflineAfterOnline(linker, {
        manifest: { optionalDependencies: { native: "1.0.0" }, dependencies: { "uses-leaf-2": "1.0.0" } },
        evict: () => true,
        keepNodeModules: true,
        versionsOf: linker === "hoisted" ? ["leaf", "uses-leaf-2/node_modules/leaf"] : [],
      });
      expect(err).not.toContain("error:");
      expect(result).toEqual({
        installed: ["leaf", ...(linker === "isolated" ? ["leaf"] : []), "native", "uses-leaf-2"],
        requests: [],
        lockfileChanged: false,
        versions: linker === "hoisted" ? { "leaf": "1.0.0", "uses-leaf-2/node_modules/leaf": "2.0.0" } : {},
      });
      expect(code).toBe(0);
    });
  });
});
