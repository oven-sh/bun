import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/26894
// When setupIOBeforeRun() fails (e.g., stdout dup fails), the shell interpreter
// would free itself via #deinitFromExec, but the GC still held a reference to
// the JS wrapper object. When the GC later finalized it, it would access freed memory.
test("shell interpreter does not crash when stdout is closed", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const fs = require("fs");
      // Close stdout so that the shell's dup(stdout) fails in setupIOBeforeRun
      fs.closeSync(1);
      try {
        // This should throw a shell error, not segfault
        await Bun.$\`echo hello\`;
      } catch (e) {
        // Expected: shell error due to failed dup of stdout
      }
      // Force GC to trigger finalization of the shell interpreter object.
      // Before the fix, this would segfault due to use-after-free.
      Bun.gc(true);
      Bun.gc(true);
      // Write to stderr to signal success (stdout is closed)
      fs.writeSync(2, "OK\\n");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("OK");
  expect(exitCode).toBe(0);
});
