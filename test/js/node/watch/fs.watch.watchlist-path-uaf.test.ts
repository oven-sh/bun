import { expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows, tempDir } from "harness";

// Regression test for a use-after-free of `Watcher.watchlist.file_path`.
//
// `WatchItem.file_path` was conditionally owned based on the comptime
// `clone_file_path` parameter to `addFile`/`addDirectory`. `path_watcher.zig`
// always passed `false`, so the watchlist entry BORROWED the string owned
// by `PathWatcherManager.file_paths`. On `close()`:
//
//   _decrementPathRefNoLock():
//     main_watcher.remove(path.hash);   // only queues evict_list entry
//     this.file_paths.remove(path_);
//     bun.default_allocator.free(path_); // watchlist[idx].file_path dangles
//
// `remove()` only appends to `evict_list`; the watchlist entry survives
// until `flushEvictions()`. If an inotify event for that entry arrives
// first, the File-Watcher thread's `onFileUpdate()` reads
// `watchlist.items(.file_path)[event.index]` → freed memory. Under ASAN:
//
//   AddressSanitizer: use-after-poison
//   in mem.trimEnd  (std/mem.zig)
//   PathWatcherManager.onFileUpdate  (path_watcher.zig:263)
//   INotifyWatcher.processINotifyEventBatch
//
// The fix makes `Watcher` always own `file_path` (dupeZ on append, free in
// flushEvictions/deinit) so the manager can free its copy independently.
//
// Windows uses win_watcher.zig (no shared watchlist); macOS directory
// watches use FSEvents. File watches on macOS/FreeBSD go through
// KEventWatcher but the event doesn't carry a watchlist index the same
// way — the Linux inotify path is where this UAF is reliably hit.
test.skipIf(isWindows || isMacOS)(
  "onFileUpdate does not read freed watchlist file_path after close()",
  async () => {
    using dir = tempDir("fswatch-watchlist-uaf", { "f.txt": "x" });

    // The subprocess delay between iterations lets the File-Watcher thread
    // fully process each IN_MODIFY event (acquire and release both
    // PathWatcherManager.mutex and Watcher.mutex) before the next close()
    // contends for them — sidestepping a separate pre-existing AB/BA
    // deadlock between those two mutexes that is out of scope here.
    const fixture = /* js */ `
      const fs = require("fs");
      const path = require("path");
      const target = path.join(process.argv[1], "f.txt");
      (async () => {
        const ITERS = 100;
        for (let i = 0; i < ITERS; i++) {
          const w = fs.watch(target, () => {});
          w.close();
          // watchlist entry for target is now pending eviction with a
          // (pre-fix) dangling file_path; this write delivers an IN_MODIFY
          // routed to that entry.
          fs.writeFileSync(target, String(i));
          await new Promise(r => setTimeout(r, 5));
        }
        console.log("ok " + ITERS);
      })();
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture, String(dir)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const filteredStderr = stderr
      .split("\n")
      .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
      .join("\n");

    expect({ stdout: stdout.trim(), stderr: filteredStderr, exitCode }).toEqual({
      stdout: "ok 100",
      stderr: "",
      exitCode: 0,
    });
  },
  30000,
);
