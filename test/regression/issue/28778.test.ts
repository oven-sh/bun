// https://github.com/oven-sh/bun/issues/28778
import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

describe.concurrent("bun add without package.json", () => {
  test("warns when creating package.json in non-TTY mode", async () => {
    using dir = tempDir("bun-add-no-pkg", {
      ".gitkeep": "",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "add", "is-number"],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
      env: bunEnv,
    });

    proc.stdin.end();

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    // Should warn about missing package.json
    expect(stderr).toContain("no package.json found, creating one in");
    expect(stderr).toContain(String(dir));

    // Should still succeed and install the package
    expect(existsSync(join(String(dir), "package.json"))).toBe(true);
    expect(existsSync(join(String(dir), "node_modules", "is-number"))).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("bun install without package.json also warns", async () => {
    using dir = tempDir("bun-install-no-pkg", {
      ".gitkeep": "",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "install", "is-number"],
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
      env: bunEnv,
    });

    proc.stdin.end();

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    // Should warn about missing package.json
    expect(stderr).toContain("no package.json found, creating one in");
    expect(stderr).toContain(String(dir));

    // Should still succeed and install the package
    expect(existsSync(join(String(dir), "package.json"))).toBe(true);
    expect(existsSync(join(String(dir), "node_modules", "is-number"))).toBe(true);
    expect(exitCode).toBe(0);
  });
});
