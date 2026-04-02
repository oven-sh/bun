import { expect, test, describe } from "bun:test";
import { bunExe, bunEnv, tempDir } from "harness";
import { existsSync } from "fs";
import { join } from "path";

describe("bun add without package.json", () => {
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

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    // Should warn about missing package.json
    expect(stderr).toContain("no package.json found, creating one in");
    expect(stderr).toContain(String(dir));

    // Should still succeed and create files
    expect(exitCode).toBe(0);
    expect(existsSync(join(String(dir), "package.json"))).toBe(true);
    expect(existsSync(join(String(dir), "node_modules"))).toBe(true);
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

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    // Should warn about missing package.json
    expect(stderr).toContain("no package.json found, creating one in");
    expect(stderr).toContain(String(dir));

    // Should still succeed
    expect(exitCode).toBe(0);
    expect(existsSync(join(String(dir), "package.json"))).toBe(true);
  });
});
