import { test, expect } from "bun:test";
import { join } from "path";
import { bunExe, bunEnv } from "harness";

test("should not crash on abort", async () => {
  for (let i = 0; i < 2; i++) {
    const { exited } = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "node-http-uaf-fixture.ts")],
      env: bunEnv,
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
    });
    const exitCode = await exited;
    expect(exitCode).not.toBeNull();
    expect(exitCode).toBe(0);
  }
});
