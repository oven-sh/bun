import { expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows, tempDir } from "harness";

// Regression test for a PathWatcher double-free when `fs.watch(dir).close()`
// races the work-pool directory scan.
//
// On Linux/FreeBSD, watching a directory schedules a `DirectoryRegisterTask`
// on the work pool (refPendingDirectory → pending_directories = 1,
// has_pending_directories = true). When the watcher is closed:
//
//   main:   PathWatcher.deinit()
//             setClosed()                    // lock; closed = true; unlock
//             if (hasPendingDirectories())   // ← lock-free atomic load
//               return;
//             ...destroy(this)
//
//   worker: unrefPendingDirectory()          // lock; pending = 0;
//             if (closed && pending == 0)    //   sees closed == true
//               has_pending = false          //   (store)
//               should_deinit = true         // unlock
//           → deinit() → ...destroy(this)
//
// If the worker's critical section lands between main's setClosed() unlock
// and main's hasPendingDirectories() load, main observes has_pending == false
// and *also* proceeds to destroy — two `bun.default_allocator.destroy()` on
// the same PathWatcher. In release builds this corrupts mimalloc's
// cross-thread free list; on alpine aarch64 CI it surfaced as a segfault at
// address 0x75622F706D742F (ASCII `/tmp/bu`) inside `PathWatcher.init()`'s
// next allocation. Under ASAN it reports use-after-poison on `this`.
//
// The fix merges `closed = true` and the `has_pending_directories` check
// into a single critical section so the worker cannot interleave.
//
// Windows uses win_watcher.zig and macOS directories use FSEvents; neither
// schedules a DirectoryRegisterTask, so the race does not exist there.
test.skipIf(isWindows || isMacOS)(
  "close() racing DirectoryRegisterTask completion does not double-free PathWatcher",
  async () => {
    // One file is the sweet spot: processWatcher() has just enough work that
    // close() on the main thread lands while the worker is finishing, so the
    // worker observes closed == true in unrefPendingDirectory(). An empty
    // directory finishes too fast (worker always wins → no race); more files
    // make the worker finish after main has already returned early.
    using dir = tempDir("fswatch-close-race", { "f.txt": "x" });

    const fixture = /* js */ `
      const fs = require("fs");
      const dir = process.argv[1];
      const ITERS = 3000;
      for (let i = 0; i < ITERS; i++) {
        const w = fs.watch(dir, { persistent: false }, () => {});
        w.close();
      }
      console.log("ok " + ITERS);
    `;

    // The race is timing-dependent (~90% hit rate per run under ASAN on the
    // unpatched build); run a handful of attempts so an unpatched build fails
    // with overwhelming probability while a patched build stays fast.
    const ATTEMPTS = 4;
    const results: Array<{ stdout: string; stderr: string; exitCode: number }> = [];
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture, String(dir)],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        proc.stdout.text(),
        proc.stderr.text(),
        proc.exited,
      ]);
      results.push({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode });
    }

    // Every attempt must have completed the full loop cleanly.
    expect(results).toEqual(
      Array.from({ length: ATTEMPTS }, () => ({ stdout: "ok 3000", stderr: "", exitCode: 0 })),
    );
  },
  60000,
);
