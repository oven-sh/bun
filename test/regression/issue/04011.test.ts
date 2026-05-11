import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe.concurrent("issue/04011", () => {
  test("running a missing script should return non zero exit code", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "missing.ts"],
      env: bunEnv,
      stderr: "inherit",
      stdout: "pipe",
    });

    expect(await proc.exited).toBe(1);
  });
});
