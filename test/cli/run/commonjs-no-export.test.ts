import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

describe.concurrent("commonjs-no-export", () => {
  test("CommonJS entry point with no exports", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--bun", join(import.meta.dir, "commonjs-no-exports-fixture.js")],
      env: bunEnv,
      stderr: "inherit",
      stdout: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout.trim().endsWith("--pass--")).toBe(true);
    expect(exitCode).toBe(0);
  });
});
