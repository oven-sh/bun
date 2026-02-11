import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for #26907: use-after-free in shell interpreter's runFromJS error path.
// When setupIOBeforeRun() fails (e.g., stdout handle is invalid on Windows), the interpreter
// must NOT call allocator.destroy(this) directly, since the GC finalizer will later try to
// access the freed memory. Instead, it should clean up runtime resources via
// derefRootShellAndIOIfNeeded and let the GC handle destruction.
//
// The bug is most reliably triggered on Windows where stdout can be unavailable,
// causing setupIOBeforeRun() -> dup(stdout) to fail. On Linux, dup rarely fails.
test("shell interpreter does not crash on GC after shell error", async () => {
  // Run many shell commands and force GC to stress the interpreter lifecycle.
  // On Windows with the bug, this would segfault during GC sweep when the
  // finalizer accesses already-freed interpreter memory.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      async function main() {
        const promises = [];
        for (let i = 0; i < 50; i++) {
          promises.push(Bun.$\`echo hello\`.quiet().catch(() => {}));
        }
        await Promise.all(promises);
        // Force GC multiple times to trigger finalizers
        Bun.gc(true);
        Bun.gc(true);
        process.stderr.write("OK\\n");
      }
      main();
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [_stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("OK");
  expect(exitCode).toBe(0);
});

test("shell interpreter handles closed stdout without crashing", async () => {
  // Close stdout before running shell commands to trigger setupIOBeforeRun failure.
  // On Windows this reliably triggers the error path; on Linux dup may still succeed.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const fs = require("fs");
      fs.closeSync(1);
      async function main() {
        try {
          await Bun.$\`echo hello\`;
        } catch (e) {
          // Error is expected when stdout is unavailable
        }
        // Force GC to trigger finalizer - this would segfault before the fix on Windows
        Bun.gc(true);
        Bun.gc(true);
        process.stderr.write("OK\\n");
      }
      main();
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [_stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("OK");
  // Process must not segfault (exit code 139 on Linux, non-zero on Windows)
  expect(exitCode).toBe(0);
});
