import { spawn } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "bun:test";
import { exists, readdir, rm, writeFile } from "fs/promises";
import { bunExe, bunEnv as env } from "harness";
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

async function writeBunfig(dir: string) {
  // The default dummy.registry bunfig disables the global cache; override it
  // so `bun pm fetch` uses BUN_INSTALL_CACHE_DIR.
  await writeFile(
    join(dir, "bunfig.toml"),
    `
[install]
registry = "${root_url}/"
saveTextLockfile = false
`,
  );
}

it("should fetch dependencies into the cache without installing", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeBunfig(package_dir);
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        bar: "^0.0.2",
      },
    }),
  );

  const cache_dir = join(package_dir, ".bun-cache");
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "pm", "fetch"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      BUN_INSTALL_CACHE_DIR: cache_dir,
    },
  });
  const out = await stdout.text();
  const err = await stderr.text();

  expect(err).not.toContain("error:");
  expect(out).toContain("bun pm fetch");
  expect(out).toContain("Fetched 1 package");
  expect(out).toContain("Cache:");
  expect(await exited).toBe(0);

  // The tarball was requested and downloaded.
  expect(urls.sort()).toEqual([`${root_url}/bar`, `${root_url}/bar-0.0.2.tgz`]);

  // The package was extracted into the cache.
  const cache_contents = await readdir(cache_dir);
  expect(cache_contents.some(name => name.startsWith("bar@0.0.2"))).toBe(true);

  // node_modules was NOT created.
  expect(await exists(join(package_dir, "node_modules"))).toBe(false);
});

it("should fetch packages missing from cache when lockfile exists", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeBunfig(package_dir);
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        bar: "^0.0.2",
      },
    }),
  );

  const cache_dir = join(package_dir, ".bun-cache");

  // First: install normally to generate a lockfile and populate the cache.
  {
    const { stderr, exited } = spawn({
      cmd: [bunExe(), "install"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env: {
        ...env,
        BUN_INSTALL_CACHE_DIR: cache_dir,
      },
    });
    const err = await stderr.text();
    expect(err).not.toContain("error:");
    expect(err).toContain("Saved lockfile");
    expect(await exited).toBe(0);
  }

  // Wipe the cache and node_modules, but keep the lockfile.
  await rm(cache_dir, { recursive: true, force: true });
  await rm(join(package_dir, "node_modules"), { recursive: true, force: true });
  urls.length = 0;

  // Now: fetch should repopulate the cache from the existing lockfile.
  {
    const { stdout, stderr, exited } = spawn({
      cmd: [bunExe(), "pm", "fetch"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env: {
        ...env,
        BUN_INSTALL_CACHE_DIR: cache_dir,
      },
    });
    const out = await stdout.text();
    const err = await stderr.text();

    expect(err).not.toContain("error:");
    expect(out).toContain("Fetched 1 package");
    expect(await exited).toBe(0);
  }

  // The tarball was downloaded directly from the URL stored in the lockfile.
  expect(urls).toEqual([`${root_url}/bar-0.0.2.tgz`]);

  // The package was extracted into the cache.
  const cache_contents = await readdir(cache_dir);
  expect(cache_contents.some(name => name.startsWith("bar@0.0.2"))).toBe(true);

  // node_modules was NOT created.
  expect(await exists(join(package_dir, "node_modules"))).toBe(false);
});

it("should report when all packages are already cached", async () => {
  const urls: string[] = [];
  setHandler(dummyRegistry(urls));
  await writeBunfig(package_dir);
  await writeFile(
    join(package_dir, "package.json"),
    JSON.stringify({
      name: "foo",
      version: "0.0.1",
      dependencies: {
        bar: "^0.0.2",
      },
    }),
  );

  const cache_dir = join(package_dir, ".bun-cache");

  // First fetch: populates cache.
  {
    const { exited, stderr } = spawn({
      cmd: [bunExe(), "pm", "fetch"],
      cwd: package_dir,
      stdout: "pipe",
      stdin: "pipe",
      stderr: "pipe",
      env: {
        ...env,
        BUN_INSTALL_CACHE_DIR: cache_dir,
      },
    });
    const err = await stderr.text();
    expect(err).not.toContain("error:");
    expect(await exited).toBe(0);
  }

  urls.length = 0;

  // Second fetch: everything already cached.
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "pm", "fetch"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      BUN_INSTALL_CACHE_DIR: cache_dir,
    },
  });
  const out = await stdout.text();
  const err = await stderr.text();

  expect(err).not.toContain("error:");
  expect(out).toContain("already in cache");
  expect(await exited).toBe(0);

  // No network requests at all on the second run.
  expect(urls).toEqual([]);

  // node_modules still not created.
  expect(await exists(join(package_dir, "node_modules"))).toBe(false);
});

it("should appear in bun pm help", async () => {
  await writeFile(join(package_dir, "package.json"), JSON.stringify({ name: "foo", version: "0.0.1" }));
  const { stdout, exited } = spawn({
    cmd: [bunExe(), "pm"],
    cwd: package_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  const out = await stdout.text();
  expect(out).toContain("bun pm fetch");
  expect(await exited).toBe(0);
});
