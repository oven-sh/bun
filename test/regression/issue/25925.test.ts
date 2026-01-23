import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "../../harness.js";

// https://github.com/oven-sh/bun/issues/25925
// `bun bun` was incorrectly aliased to `bun build`, which caused confusion
// when users accidentally passed "bun" as the first argument (e.g., in Docker setups)
describe("issue/25925", () => {
  it("'bun bun' should not trigger build command", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "bun", "index.js"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    // The old behavior would run `bun build index.js` and produce errors like:
    // "ModuleNotFound resolving "index.js" (entry point)"
    // The new behavior should try to run a script named "bun" from package.json
    // and fail with: "Script not found "bun""

    // Verify it's NOT treating "bun" as an alias for "build"
    // Build command errors would mention "entry point" or "resolving"
    expect(stderr).not.toContain("entry point");
    expect(stderr).not.toContain("ModuleNotFound");

    // It should look for a script named "bun" instead
    expect(stderr).toContain('Script not found "bun"');

    // It should fail since there's no "bun" script
    expect(exitCode).not.toBe(0);
  });

  it("'bun build' should still work", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--help"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    // The build command help should still work
    expect(stdout).toContain("bun build");
    expect(exitCode).toBe(0);
  });
});
