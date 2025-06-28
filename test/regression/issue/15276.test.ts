import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("parsing npm aliases without package manager does not crash", () => {
  // Easiest way to repro this regression with `bunx bunbunbunbunbun@npm:another-bun@1.0.0`. The package
  // doesn't need to exist, we just need `bunx` to parse the package version.
  const { stdout, stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "x", "bunbunbunbunbun@npm:another-bun@1.0.0"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  expect(exitCode).toBe(1);
  expect(stderr.toString()).toContain("error: bunbunbunbunbun@npm:another-bun@1.0.0 failed to resolve");
  expect(stdout.toString()).toBe("");
});
