import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

test("require.cache", () => {
  const { stdout, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "run", join(import.meta.dir, "require-cache-fixture.cjs")],
    env: bunEnv,
  });

  expect(stdout.toString().trim().endsWith("--pass--")).toBe(true);
  expect(exitCode).toBe(0);
});
