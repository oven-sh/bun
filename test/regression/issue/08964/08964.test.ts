import { spawnSync } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

test("issue 8964", async () => {
  const { exitCode, signalCode, stdout } = spawnSync({
    cmd: [bunExe(), "test", join(import.meta.dirname, "08964.fixture.ts")],
    env: bunEnv,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const stdtext = stdout.toString();
  const [actual, expected] = stdout.toString().split("\n");
  expect(actual.replace("EXPECTED:", "ACTUAL:")).toBe(expected);
  expect(exitCode).toBe(0);
  expect(signalCode).toBeUndefined();
});
