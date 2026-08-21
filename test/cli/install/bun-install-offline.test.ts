import { spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "bun:test";
import { rm, writeFile } from "fs/promises";
import { bunExe, bunEnv as env, readdirSorted, tempDir } from "harness";
import { join } from "path";
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

async function newProject(deps: Record<string, string>, cache = cache_dir) {
  const dir = mkdtemp();
  await writeFile(
    join(dir, "bunfig.toml"),
    Bun.TOML.stringify({
      install: { cache: { dir: cache }, registry: root_url + "/", saveTextLockfile: true, linker: "hoisted" },
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

it("--offline never issues a request and fails cleanly on a cache miss", async () => {
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
  const dir2 = await newProject({ baz: "0.0.3" });
  r = await install(dir2, ["--offline"]);
  expect(r.err).not.toContain("error:");
  expect(r.code).toBe(0);
  expect(urls.length).toBe(before);

  // manifest for `bar` was never fetched → clean error, still no request
  const dir3 = await newProject({ bar: "0.0.2" });
  r = await install(dir3, ["--offline"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("--offline");
  expect(urls.length).toBe(before);

  // manifest cached but that version's tarball evicted → clean error, no request
  for (const entry of await readdirSorted(cache_dir)) {
    if (entry.startsWith("baz@0.0.3")) await rm(join(cache_dir, entry), { recursive: true, force: true });
  }
  const dir4 = await newProject({ baz: "0.0.3" });
  r = await install(dir4, ["--offline"]);
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("--offline");
  expect(urls.length).toBe(before);
});

// Regression: with an *expired* cached manifest (here forced via --force, which turns off
// the max-age check) --prefer-offline / --offline must still resolve from it, not spin.
it("--prefer-offline and --offline use an expired cached manifest", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls, { "0.0.3": {}, "0.0.5": {} }));
  for (const flag of ["--prefer-offline", "--offline"]) {
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
    // resolved the range from the cached manifest (0.0.5 is listed there too, but its
    // tarball was never downloaded; 0.0.3's was) — no manifest request either way
    expect(urls.slice(before).filter(u => !u.endsWith(".tgz"))).toEqual([]);
  }
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
  expect(r.code).not.toBe(0);
  expect(r.err).toContain("--offline");
  expect(urls.length).toBe(before);
});
