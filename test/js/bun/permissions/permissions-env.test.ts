import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("Environment variable permissions", () => {
  test("process.env access denied in secure mode without --allow-env", async () => {
    using dir = tempDir("perm-env-test", {
      "test.ts": `
        try {
          console.log("TEST_VAR:", process.env.BUN_TEST_ENV_VAR);
        } catch (e) {
          console.log("ERROR:", e.message);
          process.exit(1);
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--secure", "--no-prompt", "test.ts"],
      cwd: String(dir),
      env: { ...bunEnv, BUN_TEST_ENV_VAR: "test_value" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout + stderr).toContain("PermissionDenied");
    expect(exitCode).not.toBe(0);
  });

  test("process.env access allowed with --allow-env", async () => {
    using dir = tempDir("perm-env-allow", {
      "test.ts": `
        console.log("TEST_VAR:", process.env.BUN_TEST_ENV_VAR);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--secure", "--allow-env", "test.ts"],
      cwd: String(dir),
      env: { ...bunEnv, BUN_TEST_ENV_VAR: "allowed_value" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("TEST_VAR: allowed_value");
    expect(exitCode).toBe(0);
  });

  test("granular --allow-env=<var> works", async () => {
    using dir = tempDir("perm-env-granular", {
      "test.ts": `
        console.log("GRANULAR_VAR:", process.env.BUN_GRANULAR_VAR);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--secure", "--allow-env=BUN_GRANULAR_VAR", "test.ts"],
      cwd: String(dir),
      env: { ...bunEnv, BUN_GRANULAR_VAR: "granular_value" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("GRANULAR_VAR: granular_value");
    expect(exitCode).toBe(0);
  });
});
