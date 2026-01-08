import { test, expect, describe } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("Environment variable permissions", () => {
  test("process.env access denied in secure mode without --allow-env", async () => {
    using dir = tempDir("perm-env-test", {
      "test.ts": `
        try {
          console.log("PATH:", process.env.PATH);
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

  test("process.env access allowed with --allow-env", async () => {
    using dir = tempDir("perm-env-allow", {
      "test.ts": `
        console.log("PATH exists:", process.env.PATH !== undefined);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--secure", "--allow-env", "test.ts"],
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

    expect(stdout).toContain("PATH exists: true");
    expect(exitCode).toBe(0);
  });

  test("granular --allow-env=<var> works", async () => {
    using dir = tempDir("perm-env-granular", {
      "test.ts": `
        console.log("HOME:", process.env.HOME);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--secure", "--allow-env=HOME", "test.ts"],
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

    expect(stdout).toContain("HOME:");
    expect(exitCode).toBe(0);
  });
});
