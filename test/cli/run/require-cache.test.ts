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

  expect(stdout.toString().trim()).toEndWith("--pass--");
  expect(exitCode).toBe(0);
});

// https://github.com/oven-sh/bun/issues/5188
test("require.cache does not include unevaluated modules", () => {
  const { stdout, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "run", join(import.meta.dir, "require-cache-bug-5188.js")],
    env: bunEnv,
    stderr: "inherit",
  });

  expect(stdout.toString().trim()).toEndWith("--pass--");
  expect(exitCode).toBe(0);
});
