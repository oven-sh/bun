import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

// This also tests __dirname and __filename
test("require.cache", () => {
  const { stdout, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "run", join(import.meta.dir, "require-cache-fixture.cjs")],
    env: bunEnv,
    stderr: "inherit",
  });

  expect(stdout.toString().trim().endsWith("--pass--")).toBe(true);
  expect(exitCode).toBe(0);
});
