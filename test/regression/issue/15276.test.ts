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

  // The 404 fails the request, so it is the only error, as for `bunx another-bun@1.0.0`.
  expect(stderr.toString()).toContain("error: GET https://registry.npmjs.org/another-bun - 404");
  expect(stderr.toString()).not.toContain("failed to resolve");
  expect(stdout.toString()).toBe("");
  expect(exitCode).toBe(1);
});
