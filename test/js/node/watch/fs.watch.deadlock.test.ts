import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Regression test for PathWatcherManager self-deadlock / UAF.
//
// Before the fix, unregisterWatcher() and unrefPendingDirectory() could
// call deinit() while still holding this.mutex. Since deinit() re-acquires
// the same non-recursive mutex (and may destroy `this`), this either
// self-deadlocked in __ulock_wait2 or UAF'd on the deferred unlock().
//
// Field report stack trace:
//   FSWatcher.close → PathWatcher.deinit → PathWatcherManager.unregisterWatcher
//     → _decrementPathRefNoLock → _os_unfair_lock_lock_slow → __ulock_wait2
//
// The trigger is race-condition dependent (close() racing with the work-pool
// directory scan), so this test exercises the code path repeatedly but may
// not deadlock on every unpatched run.
test("rapid create/close of recursive fs.watch does not deadlock", async () => {
  // Deep directory tree ensures DirectoryRegisterTask runs on the work pool
  // long enough for close() to race with it.
  using dir = tempDir("watch-deadlock", {
    "a/b/c/d/e/f1.txt": "x",
    "a/b/c/d/e/f2.txt": "x",
    "a/b/c/d/f3.txt": "x",
    "a/b/c/f4.txt": "x",
    "a/b/f5.txt": "x",
    "g/h/i/j/f6.txt": "x",
    "g/h/i/f7.txt": "x",
    "g/h/f8.txt": "x",
    "k/l/m/f9.txt": "x",
    "k/l/f10.txt": "x",
  });

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const fs = require("fs");
      const dir = process.argv[1];

      // If we hang, it's a deadlock. Bail after 10s.
      const timer = setTimeout(() => {
        process.stderr.write("DEADLOCK: hung for 10 seconds\\n");
        process.exit(1);
      }, 10000);
      timer.unref();

      const total = 50;
      for (let i = 0; i < total; i++) {
        const w = fs.watch(dir, { recursive: true }, () => {});
        // Close immediately — racing with the work-pool directory scan.
        w.close();
      }

      console.log("OK " + total);
      `,
      String(dir),
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("DEADLOCK");
  expect(stdout).toStartWith("OK");
  expect(exitCode).toBe(0);
}, 30000);
