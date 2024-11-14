import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

test("CommonJS entry point with no exports", () => {
  const { stdout, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "run", "--bun", join(import.meta.dir, "commonjs-no-exports-fixture.js")],
    env: bunEnv,
    stderr: "inherit",
  });

  expect(stdout.toString().trim().endsWith("--pass--")).toBe(true);
  expect(exitCode).toBe(0);
});
