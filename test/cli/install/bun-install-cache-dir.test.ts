import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { symlinkSync } from "node:fs";
import { join } from "node:path";

describe.skipIf(isWindows)("BUN_INSTALL_CACHE_DIR inside a dangling symlink", () => {
  test("bun install exits instead of spinning in mkdirat", async () => {
    using dir = tempDir("cache-dir-dangling", {
      "proj/package.json": JSON.stringify({
        name: "x",
        version: "1.0.0",
        dependencies: { "any-pkg": "1.0.0" },
      }),
    });
    const root = String(dir);
    symlinkSync(join(root, "does-not-exist"), join(root, "dangling"));

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      cwd: join(root, "proj"),
      env: {
        ...bunEnv,
        BUN_INSTALL_CACHE_DIR: join(root, "dangling", "cache"),
        BUN_CONFIG_REGISTRY: "http://127.0.0.1:1/",
      },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15_000,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ signalCode: proc.signalCode, stdout, stderr }).toMatchObject({
      signalCode: null,
    });
    expect(stderr).toContain("error");
    expect(exitCode).not.toBe(0);
  });
});
