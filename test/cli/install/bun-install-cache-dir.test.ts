import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { symlinkSync } from "node:fs";
import { join } from "node:path";

describe.skipIf(isWindows)("BUN_INSTALL_CACHE_DIR inside a dangling symlink", () => {
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
    const cacheDir = join(root, "dangling", "cache");
    return {
      dir,
      cacheDir,
      env: {
        ...bunEnv,
        BUN_INSTALL_CACHE_DIR: cacheDir,
        BUN_CONFIG_REGISTRY: "http://127.0.0.1:1/",
      },
      cwd: join(root, "proj"),
    };
  }

  test.concurrent("bun install exits with a cache-directory error instead of spinning in mkdirat", async () => {
    const ctx = setup();
    using _dir = ctx.dir;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: ctx.cwd,
      env: ctx.env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15_000,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ signalCode: proc.signalCode, stdout, stderr }).toMatchObject({
      signalCode: null,
      stderr: expect.stringContaining(`cache directory "${ctx.cacheDir}" is not creatable: ENOENT`),
    });
    expect(stderr).not.toContain("ConnectionRefused");
    expect(exitCode).not.toBe(0);
  });

  test.concurrent("runtime auto-install exits with a cache-directory error instead of spinning", async () => {
    const ctx = setup();
    using _dir = ctx.dir;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `require("any-pkg")`],
      cwd: ctx.cwd,
      env: ctx.env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15_000,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ signalCode: proc.signalCode, stdout, stderr }).toMatchObject({
      signalCode: null,
      stderr: expect.stringContaining(`cache directory "${ctx.cacheDir}" is not creatable: ENOENT`),
    });
    expect(exitCode).not.toBe(0);
  });
});
