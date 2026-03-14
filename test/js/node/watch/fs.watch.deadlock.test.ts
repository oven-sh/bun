import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("fs.watch deadlock", () => {
  test("rapid create/close of recursive watchers should not hang", async () => {
    // Create a deep directory tree to ensure DirectoryRegisterTask runs on
    // the work pool, increasing the chance of the close() racing with it.
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

    // Spawn a subprocess that rapidly creates and closes recursive watchers.
    // Before the fix, this could deadlock when:
    // 1. unregisterWatcher() called deinit() while holding this.mutex
    //    (deinit re-acquires the same non-recursive mutex → self-deadlock)
    // 2. unrefPendingTask() called deinit() while holding mutex → UAF
    // 3. processWatcher held watcher.mutex while calling _decrementPathRef
    //    which acquires manager.mutex → AB/BA with unregisterWatcher
    //
    // The subprocess has a 10s timeout: if it hangs, it's a deadlock.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const fs = require("fs");
        const dir = process.argv[1];

        // Timeout: if we hang for 10s, it's a deadlock
        const timer = setTimeout(() => {
          process.stderr.write("DEADLOCK: hung for 10 seconds\\n");
          process.exit(1);
        }, 10000);
        timer.unref();

        let done = 0;
        const total = 50;

        for (let i = 0; i < total; i++) {
          // Stagger slightly to increase thread interleaving
          const w = fs.watch(dir, { recursive: true }, () => {});
          // Close immediately — racing with directory scanning on worker thread
          w.close();
          done++;
        }

        // If we reach here without deadlocking, success
        console.log("OK " + done);
        `,
        String(dir),
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr.replace(/^WARNING: ASAN.*\n?/gm, "")).toBe("");
    expect(stdout).toStartWith("OK");
    expect(exitCode).toBe(0);
  });
});
