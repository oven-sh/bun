import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("running a missing script should return non zero exit code", () => {
  const { stdout, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "run", "missing.ts"],
    env: bunEnv,
    stderr: "inherit",
  });

  expect(exitCode).toBe(1);
});
