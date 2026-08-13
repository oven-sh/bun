import { spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "bun:test";
import { exists, mkdir, readdir, rm, writeFile } from "fs/promises";
import { bunExe, bunEnv as env, normalizeBunSnapshot } from "harness";
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
beforeEach(async () => {
  await dummyBeforeEach();
});
afterEach(dummyAfterEach);

const packageJson = JSON.stringify({ name: "foo", version: "0.0.1", dependencies: { bar: "^0.0.2" } });

// `package_dir` is created per test by dummyBeforeEach, so derive paths lazily.
const bunfigPath = () => join(package_dir, "bunfig.toml");
const cacheDir = () => join(package_dir, ".bun-cache");

async function writeProject() {
  // The default dummy.registry bunfig disables the global cache; override it
  // so `bun pm fetch` uses BUN_INSTALL_CACHE_DIR.
  await writeFile(bunfigPath(), `[install]\nregistry = "${root_url}/"\nsaveTextLockfile = false\n`);
  await writeFile(join(package_dir, "package.json"), packageJson);
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
}, 30_000);

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
  // Nothing needed resolving, so only the second pass (the one that walks the
  // lockfile) printed anything.
  expect(stderr).toBe("Fetching packages\n");
  expect(exitCode).toBe(0);

  // Downloaded straight from the URL stored in the lockfile, no manifest request.
  expect(urls).toEqual([`${root_url}/bar-0.0.2.tgz`]);
  expect(await cachedPackages(cacheDir())).toBe(1);
  expect(await exists(join(package_dir, "node_modules"))).toBe(false);
}, 30_000);

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
}, 30_000);

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
}, 30_000);

// A bare `bun pm` and `bun pm --help` print separate copies of the subcommand list.
it.each([[[]], [["--help"]]])("should appear in bun pm help (%j)", async extraArgs => {
  await writeFile(join(package_dir, "package.json"), packageJson);

  const { stdout, exitCode } = await runBun(["pm", ...extraArgs]);
  expect(stdout).toMatch(/^\s*bun pm fetch\s+fetch all dependencies into the cache without installing$/m);
  expect(exitCode).toBe(0);
});
