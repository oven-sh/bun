import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/26919
// When setupIOBeforeRun() fails in runFromJS (e.g., because stdout is closed),
// the error path used to call #deinitFromExec() which freed the interpreter struct.
// The GC would later finalize the already-freed JSShellInterpreter wrapper,
// causing a use-after-free / segfault.
test("issue #26919 - shell interpreter should not segfault when stdout is closed", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const fs = require("fs");
      // Close stdout so that the shell interpreter's setupIOBeforeRun() will fail
      // when it tries to dup() stdout.
      fs.closeSync(1);
      try {
        // This should throw an error (not segfault) because stdout is closed
        await Bun.$\`echo hello\`;
      } catch (e) {
        // Write to stderr since stdout is closed
        fs.writeSync(2, "caught: " + e.constructor.name + "\\n");
      }
      // Force GC to run - this would trigger the use-after-free crash before the fix
      Bun.gc(true);
      fs.writeSync(2, "done\\n");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The process should not crash (segfault would give non-zero exit and no "done" message)
  expect(stderr).toContain("done");
  expect(exitCode).toBe(0);
});
