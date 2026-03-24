import { expect, test } from "bun:test";
import { bunExe, bunEnv } from "harness";

// Regression test: mock.module with a non-string specifier (e.g. Intl.Segmenter)
// used to cause a stack-buffer-overflow because the PackageManager singleton could
// capture a dangling pointer to a stack-local Log during module resolution.
test("mock.module with non-string specifier does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `
      const { mock } = require("bun:test");
      try {
        mock.module(Intl.Segmenter, () => ({ default: 1 }));
      } catch (e) {
        // Expected to throw - we just need it not to crash
      }
      console.log("ok");
    `],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stdout).toContain("ok");
  expect(exitCode).toBe(0);
});
