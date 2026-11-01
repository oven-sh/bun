import { expect, test } from "bun:test";
import { bunEnv, bunExe, isArm64 } from "harness";

// simdutf treats an unknown implementation name like a CPU that none of its kernels supports.
// arm64 builds have a single kernel and ignore the variable.
test.skipIf(isArm64)("fails fast with a clear error when simdutf has no supported implementation", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log('unreachable')"],
    env: { ...bunEnv, SIMDUTF_FORCE_IMPLEMENTATION: "none" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("which Bun requires");
  expect(stderr).toContain("SIMDUTF_FORCE_IMPLEMENTATION");
  expect(stdout).toBe("");
  expect(exitCode).toBe(134);
});
