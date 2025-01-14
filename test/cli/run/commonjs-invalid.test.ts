import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

test("Loading an invalid commonjs module", () => {
  const { stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "run", join(import.meta.dir, "cjs-fixture-bad.cjs")],
    env: bunEnv,
    stdout: "inherit",
    stderr: "pipe",
    stdin: "inherit",
  });

  expect(stderr.toString().trim()).toContain("Expected CommonJS module to have a function wrapper");
  expect(exitCode).toBe(1);
});
