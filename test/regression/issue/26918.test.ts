import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/26918
// When setupIOBeforeRun() fails (e.g., stdout handle unavailable on Windows),
// the shell interpreter's error path used to call deinitFromExec() which
// directly freed the GC-managed object. When the GC later finalized the
// already-freed object, it caused a segfault (use-after-free).
//
// The fix replaces deinitFromExec() with derefRootShellAndIOIfNeeded() in the
// runFromJS error path, which cleans up runtime resources while leaving final
// destruction to the GC finalizer.
//
// Note: The crash is primarily reproducible on Windows where stdout handles can
// be truly unavailable. On Linux, this test serves as a smoke test to verify
// the shell interpreter handles closed stdio gracefully.
test("shell does not segfault when stdout fd is closed", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const fs = require("fs");
      fs.closeSync(1);
      async function main() {
        const { $ } = require("bun");
        try {
          await $\`echo hello\`;
        } catch (e) {
          process.stderr.write("caught error\\n");
        }
        Bun.gc(true);
        process.stderr.write("done\\n");
      }
      main();
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The process must not crash with a segfault
  expect(exitCode).not.toBe(139); // SIGSEGV on Linux
  expect(stderr).toContain("done");
});
