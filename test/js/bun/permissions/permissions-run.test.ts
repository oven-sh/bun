import { test, expect, describe } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("Subprocess permissions", () => {
  test("Bun.spawn denied in secure mode without --allow-run", async () => {
    using dir = tempDir("perm-run-test", {
      "test.ts": `
        try {
          const proc = Bun.spawnSync(["echo", "hello"]);
          console.log("SUCCESS:", proc.stdout.toString());
        } catch (e) {
          console.log("ERROR:", e.message);
          process.exit(1);
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--secure", "--no-prompt", "test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(stdout + stderr).toContain("PermissionDenied");
    expect(exitCode).not.toBe(0);
  });

  test("Bun.spawn allowed with --allow-run", async () => {
    using dir = tempDir("perm-run-allow", {
      "test.ts": `
        const proc = Bun.spawnSync(["echo", "hello"]);
        console.log("OUTPUT:", proc.stdout.toString().trim());
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--secure", "--allow-run", "test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(stdout).toContain("OUTPUT: hello");
    expect(exitCode).toBe(0);
  });

  test("granular --allow-run=<cmd> works", async () => {
    using dir = tempDir("perm-run-granular", {
      "test.ts": `
        const proc = Bun.spawnSync(["echo", "hello"]);
        console.log("OUTPUT:", proc.stdout.toString().trim());
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--secure", "--allow-run=echo", "test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(stdout).toContain("OUTPUT: hello");
    expect(exitCode).toBe(0);
  });
});
