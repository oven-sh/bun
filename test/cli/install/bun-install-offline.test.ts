import { spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { rm, writeFile } from "fs/promises";
import { bunExe, bunEnv as env, readdirSorted, tempDir } from "harness";
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

let cache_dir: string;
// temp dirs created by a test; removed after it
let dirs: { [Symbol.dispose](): void }[] = [];
function mkdtemp(): string {
  const d = tempDir("offline", {});
  dirs.push(d);
  return String(d);
}

beforeEach(async () => {
  await dummyBeforeEach({ linker: "hoisted" });
  cache_dir = mkdtemp();
  // dummyBeforeEach disables the cache; these tests are about the cache
  await writeFile(
    join(package_dir, "bunfig.toml"),
    Bun.TOML.stringify({
      install: { cache: { dir: cache_dir }, registry: root_url + "/", saveTextLockfile: true, linker: "hoisted" },
    }),
  );
});
afterEach(async () => {
  await dummyAfterEach();
  for (const d of dirs) d[Symbol.dispose]();
  dirs = [];
});

// the CI runner exports BUN_INSTALL_CACHE_DIR, which would override the per-project
// bunfig cache dirs these tests populate and inspect
const { BUN_INSTALL_CACHE_DIR: _ciCacheDir, ...installEnv } = env;

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

async function newProject(deps: Record<string, string>, cache = cache_dir, linker: "hoisted" | "isolated" = "hoisted") {
  const dir = mkdtemp();
  await writeFile(
    join(dir, "bunfig.toml"),
    Bun.TOML.stringify({
      install: { cache: { dir: cache }, registry: root_url + "/", saveTextLockfile: true, linker },
    }),
  );
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "app", version: "1.0.0", dependencies: deps }));
  return dir;
}

it("--prefer-offline resolves from cached manifests without touching the network", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls, { "0.0.3": {}, "0.0.5": {} }));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { baz: "0.0.3" } }),
  );
  // 1. online install populates the manifest + tarball cache
  let r = await install(package_dir, []);
  expect(r.err).not.toContain("error:");
  expect(r.code).toBe(0);
  const before = urls.length;
  expect(before).toBeGreaterThan(0);

  // 2. a fresh project without a lockfile: the (possibly stale) cached manifest satisfies
  //    the range and the tarball comes from the cache: zero requests
  const dir2 = await newProject({ baz: "<=0.0.3" });
  r = await install(dir2, ["--prefer-offline"]);
  expect(r.err).not.toContain("error:");
  expect(r.code).toBe(0);
  expect(urls.slice(before)).toEqual([]);
  expect(await readdirSorted(join(dir2, "node_modules", "baz"))).toContain("package.json");
});

describe.each(["hoisted", "isolated"] as const)("--offline (%s linker)", linker => {
  it("never issues a request and fails cleanly on a cache miss", async () => {
    const urls: string[] = [];
    setHandler(dummyRegistry(urls, { "0.0.3": {}, "0.0.5": {} }));
    await writeFile(
      join(package_dir, "package.json"),
      JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { baz: "0.0.3" } }),
    );
    let r = await install(package_dir, []);
    expect(r.code).toBe(0);
    const before = urls.length;

    // everything cached → works
    const dir2 = await newProject({ baz: "0.0.3" }, cache_dir, linker);
    r = await install(dir2, ["--offline"]);
    expect(r.err).not.toContain("error:");
    expect(r.code).toBe(0);
    expect(urls.length).toBe(before);

    // manifest for `bar` was never fetched → clean error, still no request
    const dir3 = await newProject({ bar: "0.0.2" }, cache_dir, linker);
    r = await install(dir3, ["--offline"]);
    expect(r.err).toContain("--offline");
    expect(r.code).not.toBe(0);
    expect(urls.length).toBe(before);

    // manifest cached but that version's tarball evicted → clean error, no request
    for (const entry of await readdirSorted(cache_dir)) {
      if (entry.startsWith("baz@0.0.3")) await rm(join(cache_dir, entry), { recursive: true, force: true });
    }
    const dir4 = await newProject({ baz: "0.0.3" }, cache_dir, linker);
    r = await install(dir4, ["--offline"]);
    expect(r.err).toContain("--offline");
    expect(r.code).not.toBe(0);
    expect(urls.length).toBe(before);
  });
});

// Regression: with an *expired* cached manifest (here forced via --force, which turns off
// the max-age check) --prefer-offline / --offline must still resolve from it, not spin.
describe.each(["--prefer-offline", "--offline"])("%s with an expired cached manifest", flag => {
  it("resolves a range from it instead of spinning", async () => {
    const urls: string[] = [];
    setHandler(dummyRegistry(urls, { "0.0.3": {}, "0.0.5": {} }));
    // each mode gets its own warmed cache so one cannot pre-fetch for the other
    const cache = mkdtemp();
    const warm = await newProject({ baz: "0.0.3" }, cache);
    const w = await install(warm, []);
    expect(w.err).not.toContain("error:");
    expect(w.code).toBe(0);
    const before = urls.length;
    const dir = await newProject({ baz: "^0.0.3" }, cache);
    const r = await install(dir, ["--force", flag]);
    expect(r.err).not.toContain("error:");
    expect(r.code).toBe(0);
    if (flag === "--offline") {
      // never any request
      expect(urls.slice(before)).toEqual([]);
    } else {
      // resolved the range from the cached manifest: no *manifest* request (a missing
      // tarball may still be fetched in this mode)
      expect(urls.slice(before).filter(u => !u.endsWith(".tgz"))).toEqual([]);
    }
  });
});

it("--offline skips an optional dependency that is not in the cache", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls, { "0.0.3": {}, "0.0.5": {} }));
  const warm = await newProject({ baz: "0.0.3" });
  const w = await install(warm, []);
  expect(w.err).not.toContain("error:");
  expect(w.code).toBe(0);
  const before = urls.length;
  // `bar` was never fetched: as an optionalDependency it is skipped, not an error
  const dir = mkdtemp();
  await writeFile(
    join(dir, "bunfig.toml"),
    Bun.TOML.stringify({
      install: { cache: { dir: cache_dir }, registry: root_url + "/", saveTextLockfile: true, linker: "hoisted" },
    }),
  );
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      name: "app",
      version: "1.0.0",
      dependencies: { baz: "0.0.3" },
      optionalDependencies: { bar: "0.0.2" },
    }),
  );
  const r = await install(dir, ["--offline"]);
  expect(r.err).not.toContain("error:");
  expect(r.code).toBe(0);
  expect(urls.slice(before)).toEqual([]);
  expect(await readdirSorted(join(dir, "node_modules"))).toContain("baz");
});

it("--offline refuses an uncached git dependency without running git", async () => {
  const dir = await newProject({ dep: `git+${pathToFileURL(join(cache_dir, "no-such-repo.git"))}#deadbeef` });
  const r = await install(dir, ["--offline"]);
  expect(r.err).toContain("--offline");
  expect(r.err).not.toContain('"git clone"');
  expect(r.code).not.toBe(0);

  // …but an *optional* uncached git dependency is just skipped
  const dir2 = mkdtemp();
  await writeFile(
    join(dir2, "bunfig.toml"),
    Bun.TOML.stringify({
      install: { cache: { dir: cache_dir }, registry: root_url + "/", saveTextLockfile: true, linker: "hoisted" },
    }),
  );
  await writeFile(
    join(dir2, "package.json"),
    JSON.stringify({
      name: "app",
      version: "1.0.0",
      optionalDependencies: { dep: `git+${pathToFileURL(join(cache_dir, "no-such-repo.git"))}#deadbeef` },
    }),
  );
  const r2 = await install(dir2, ["--offline"]);
  expect(r2.err).not.toContain("error:");
  expect(r2.code).toBe(0);
});

it("--offline reports an uncached tarball-URL / github dependency once, and skips optional ones", async () => {
  const req = await newProject({ dep: `${root_url}/never-fetched-1.0.0.tgz` });
  const r = await install(req, ["--offline"]);
  expect(r.err).toContain("--offline");
  expect(r.err).not.toContain("TarballFailedToDownload");
  expect(r.code).not.toBe(0);

  const opt = mkdtemp();
  await writeFile(
    join(opt, "bunfig.toml"),
    Bun.TOML.stringify({
      install: { cache: { dir: cache_dir }, registry: root_url + "/", saveTextLockfile: true, linker: "hoisted" },
    }),
  );
  await writeFile(
    join(opt, "package.json"),
    JSON.stringify({
      name: "app",
      version: "1.0.0",
      optionalDependencies: { dep: `${root_url}/never-fetched-1.0.0.tgz`, gh: "github:nobody-xyz/nothing#deadbeef" },
    }),
  );
  const r2 = await install(opt, ["--offline"]);
  expect(r2.err).not.toContain("error:");
  expect(r2.code).toBe(0);
});

async function lockedPackages(dir: string) {
  const lock = Bun.JSONC.parse(await Bun.file(join(dir, "bun.lock")).text()) as { packages: Record<string, unknown[]> };
  return lock.packages;
}

describe.each(["hoisted", "isolated"] as const)(
  "--offline with a cached tarball-URL dependency (%s linker)",
  linker => {
    it("installs it from the cache when bun.lock does not have it", async () => {
      const urls: string[] = [];
      setHandler(dummyRegistry(urls));
      const tarball = `${root_url}/baz-0.0.3.tgz`;
      const info = { bin: { "baz-run": "index.js" } };

      // online: the download gives the package its name and bun.lock the hash of the tarball
      const warm = await newProject({ baz: tarball }, cache_dir, linker);
      const w = await install(warm, []);
      expect(w.err).not.toContain("error:");
      expect(await lockedPackages(warm)).toEqual({ baz: [`baz@${tarball}`, info, expect.stringMatching(/^sha512-/)] });
      expect(w.code).toBe(0);
      const before = urls.length;

      // no bun.lock: the package is read from the extraction in the cache
      const dir = await newProject({ baz: tarball }, cache_dir, linker);
      const r = await install(dir, ["--offline"]);
      expect(r.err).not.toContain("error:");
      expect(urls.slice(before)).toEqual([]);
      expect(await readdirSorted(join(dir, "node_modules", "baz"))).toContain("package.json");
      // the cache keeps no tarball to hash, so this entry has no integrity
      expect(await lockedPackages(dir)).toEqual({ baz: [`baz@${tarball}`, info] });
      expect(r.code).toBe(0);
    });
  },
);

it("--offline resolves what a cached tarball-URL dependency depends on, also when it is optional", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls, { "0.0.2": {}, "0.0.3": {}, latest: "0.0.3" }));
  // the package in this tarball is `@barn/moo`; it depends on bar@0.0.2 and baz@latest
  const tarball = `${root_url}/moo-0.1.0.tgz`;
  const warm = await newProject({ moo: tarball });
  const w = await install(warm, []);
  expect(w.err).not.toContain("error:");
  expect(w.code).toBe(0);
  const before = urls.length;

  const dir = mkdtemp();
  await writeFile(join(dir, "bunfig.toml"), await Bun.file(join(warm, "bunfig.toml")).text());
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: "app", version: "1.0.0", optionalDependencies: { moo: tarball } }),
  );
  const r = await install(dir, ["--offline"]);
  expect(r.err).not.toContain("error:");
  expect(urls.slice(before)).toEqual([]);
  expect(Object.keys(await lockedPackages(dir)).sort()).toEqual(["bar", "baz", "moo"]);
  expect(await readdirSorted(join(dir, "node_modules"))).toEqual(["bar", "baz", "moo"]);
  expect(r.code).toBe(0);
});

it("bun add --offline takes a cached tarball URL that the project does not have", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  const tarball = `${root_url}/baz-0.0.3.tgz`;
  const warm = await newProject({ baz: tarball });
  const w = await install(warm, []);
  expect(w.err).not.toContain("error:");
  expect(w.code).toBe(0);
  const before = urls.length;

  const dir = await newProject({});
  await using proc = spawn({
    cmd: [bunExe(), "add", "--offline", tarball],
    cwd: dir,
    env: installEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(err).not.toContain("error:");
  expect(urls.slice(before)).toEqual([]);
  expect(await Bun.file(join(dir, "package.json")).json()).toEqual({
    name: "app",
    version: "1.0.0",
    dependencies: { baz: tarball },
  });
  expect(await readdirSorted(join(dir, "node_modules", "baz"))).toContain("package.json");
  expect(code).toBe(0);
});

it('install.prefer = "offline" and install.offline = true in bunfig.toml behave like the flags', async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls, { "0.0.3": {} }));
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { baz: "0.0.3" } }),
  );
  {
    const w = await install(package_dir, []);
    expect(w.err).not.toContain("error:");
    expect(w.code).toBe(0);
  }
  const before = urls.length;
  const dir2 = mkdtemp();
  await writeFile(
    join(dir2, "bunfig.toml"),
    Bun.TOML.stringify({
      install: { cache: { dir: cache_dir }, registry: root_url + "/", prefer: "offline", linker: "hoisted" },
    }),
  );
  await writeFile(join(dir2, "package.json"), JSON.stringify({ name: "app", dependencies: { baz: "^0.0.3" } }));
  let r = await install(dir2, []);
  expect(r.err).not.toContain("error:");
  expect(r.code).toBe(0);
  expect(urls.length).toBe(before);

  const dir3 = mkdtemp();
  await writeFile(
    join(dir3, "bunfig.toml"),
    Bun.TOML.stringify({
      install: { cache: { dir: cache_dir }, registry: root_url + "/", offline: true, linker: "hoisted" },
    }),
  );
  await writeFile(join(dir3, "package.json"), JSON.stringify({ name: "app", dependencies: { bar: "0.0.2" } }));
  r = await install(dir3, []);
  expect(r.err).toContain("--offline");
  expect(r.code).not.toBe(0);
  expect(urls.length).toBe(before);
});

const gitEnv = {
  ...installEnv,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

it.skipIf(!Bun.which("git"))(
  "--offline installs a git dependency from the cached clone without touching the repository",
  async () => {
    // a local bare repository with one package
    const work = mkdtemp();
    const bare = join(mkdtemp(), "repo.git");
    await writeFile(join(work, "package.json"), JSON.stringify({ name: "gitpkg", version: "1.0.0" }));
    await writeFile(join(work, "index.js"), "module.exports = 1;");
    for (const cmd of [
      ["init", "-q"],
      ["add", "-A"],
      ["commit", "-q", "-m", "init", "--no-gpg-sign"],
      ["clone", "-q", "--bare", ".", bare],
    ]) {
      await using p = spawn({ cmd: ["git", ...cmd], cwd: work, env: gitEnv, stdout: "ignore", stderr: "pipe" });
      const [gitErr, gitCode] = await Promise.all([p.stderr.text(), p.exited]);
      expect(gitErr).not.toContain("fatal:");
      expect(gitCode).toBe(0);
    }
    const url = `git+${pathToFileURL(bare)}`;
    // online install populates the git cache
    const warm = await newProject({ gitpkg: url });
    const w = await install(warm, []);
    expect(w.err).not.toContain("error:");
    expect(w.code).toBe(0);
    // the repository disappears; --offline must use the cached clone (no fetch) and succeed
    await rm(bare, { recursive: true, force: true });
    const dir = await newProject({ gitpkg: url });
    const r = await install(dir, ["--offline"]);
    expect(r.err).not.toContain("error:");
    expect(r.code).toBe(0);
    expect(await readdirSorted(join(dir, "node_modules", "gitpkg"))).toContain("index.js");

    // and from an existing lockfile with the git cache gone: a required one errors, an
    // optional one is skipped — either way the install finishes (no queued-forever task)
    for (const entry of await readdirSorted(cache_dir)) {
      if (entry.endsWith(".git") || entry.startsWith("@G@"))
        await rm(join(cache_dir, entry), { recursive: true, force: true });
    }
    await rm(join(dir, "node_modules"), { recursive: true, force: true });
    const again = await install(dir, ["--offline"]);
    expect(again.err).toContain("--offline");
    expect(again.code).not.toBe(0);
    const opt = mkdtemp();
    await writeFile(join(opt, "bunfig.toml"), await Bun.file(join(dir, "bunfig.toml")).text());
    await writeFile(
      join(opt, "package.json"),
      JSON.stringify({ name: "app", version: "1.0.0", optionalDependencies: { gitpkg: url } }),
    );
    await writeFile(join(opt, "bun.lock"), await Bun.file(join(dir, "bun.lock")).text());
    const optr = await install(opt, ["--offline"]);
    expect(optr.err).not.toContain("error:");
    expect(optr.code).toBe(0);
  },
);
