import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";

describe.skipIf(isWindows)("install cache directory inside a dangling symlink", () => {
  function setup() {
    const dir = tempDir("cache-dir-dangling", {
      "proj/package.json": JSON.stringify({
        name: "x",
        version: "1.0.0",
        dependencies: { "any-pkg": "1.0.0" },
      }),
    });
    const root = String(dir);
    symlinkSync(join(root, "does-not-exist"), join(root, "dangling"));
    return { dir, root, dangling: join(root, "dangling"), cwd: join(root, "proj") };
  }

  function explicitEnv(cacheDir: string) {
    return {
      ...bunEnv,
      BUN_INSTALL_CACHE_DIR: cacheDir,
      BUN_CONFIG_REGISTRY: "http://127.0.0.1:1/",
    };
  }

  test.concurrent("bun install exits with a cache-directory error instead of spinning in mkdirat", async () => {
    const ctx = setup();
    using _dir = ctx.dir;
    const cacheDir = join(ctx.dangling, "cache");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: ctx.cwd,
      env: explicitEnv(cacheDir),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15_000,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ signalCode: proc.signalCode, stdout, stderr }).toMatchObject({
      signalCode: null,
      stderr: expect.stringContaining(`error: cache directory "${cacheDir}" is not creatable: ENOENT`),
    });
    expect(stderr).not.toContain("ConnectionRefused");
    expect(exitCode).not.toBe(0);
  });

  test.concurrent("bunfig install.cache.dir exits with a cache-directory error instead of spinning", async () => {
    using dir = tempDir("cache-dir-dangling-bunfig", {
      "proj/package.json": JSON.stringify({ name: "x", version: "1.0.0", dependencies: { "any-pkg": "1.0.0" } }),
    });
    const root = String(dir);
    symlinkSync(join(root, "does-not-exist"), join(root, "dangling"));
    const cacheDir = join(root, "dangling", "cache");
    await Bun.write(
      join(root, "proj", "bunfig.toml"),
      `[install]\nregistry = "http://127.0.0.1:1/"\n[install.cache]\ndir = ${JSON.stringify(cacheDir)}\n`,
    );
    const env = { ...bunEnv };
    delete env.BUN_INSTALL_CACHE_DIR;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: join(root, "proj"),
      env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15_000,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ signalCode: proc.signalCode, stdout, stderr }).toMatchObject({
      signalCode: null,
      stderr: expect.stringContaining(`error: cache directory "${cacheDir}" is not creatable: ENOENT`),
    });
    expect(stderr).not.toContain("ConnectionRefused");
    expect(exitCode).not.toBe(0);
  });

  test.concurrent("runtime auto-install exits with a cache-directory error instead of spinning", async () => {
    const ctx = setup();
    using _dir = ctx.dir;
    const cacheDir = join(ctx.dangling, "cache");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `require("any-pkg")`],
      cwd: ctx.cwd,
      env: explicitEnv(cacheDir),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15_000,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ signalCode: proc.signalCode, stdout, stderr }).toMatchObject({
      signalCode: null,
      stderr: expect.stringContaining(`error: cache directory "${cacheDir}" is not creatable: ENOENT`),
    });
    expect(exitCode).not.toBe(0);
  });

  test.concurrent("implicit $HOME-derived cache dir warns and falls back to node_modules/.cache", async () => {
    const ctx = setup();
    using _dir = ctx.dir;
    const env = { ...bunEnv, BUN_CONFIG_REGISTRY: "http://127.0.0.1:1/" };
    delete env.BUN_INSTALL_CACHE_DIR;
    delete env.BUN_INSTALL;
    delete env.XDG_CACHE_HOME;
    env.HOME = ctx.dangling;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: ctx.cwd,
      env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15_000,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ signalCode: proc.signalCode, stdout, stderr }).toMatchObject({
      signalCode: null,
      stderr: expect.stringContaining(`is not creatable: ENOENT, falling back to node_modules/.cache`),
    });
    expect(stderr).toContain("warn: cache directory");
    expect(stderr).toContain("ConnectionRefused");
    expect(existsSync(join(ctx.cwd, "node_modules", ".cache"))).toBe(true);
    expect(exitCode).not.toBe(0);
  });
});
