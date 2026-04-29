import { expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows, tempDir } from "harness";

// Regression test for `Watcher.evict_list` overflow.
//
// `Watcher.remove()` appends the watchlist index to a fixed-size
// `evict_list[max_eviction_count = 8096]` buffer; the actual removal
// happens in `flushEvictions()`, which was only driven by `onFileUpdate()`
// on the watcher thread — i.e. only when a filesystem event arrives.
//
// `fs.watch(path).close()` reaches `_decrementPathRefNoLock()` →
// `main_watcher.remove(hash)` for the watched path. Repeating that
// without ever modifying the filesystem means `flushEvictions()` never
// runs, and once the cumulative remove count passes 8096,
// `removeAtIndex()` writes past the end of `evict_list`:
//
//   panic(main thread): index out of bounds: index 8096, len 8096
//   Watcher.removeAtIndex  src/Watcher.zig
//   Watcher.remove
//   PathWatcherManager._decrementPathRefNoLock
//
// The fix drains `evict_list` inside `remove()` when it's full (the
// mutex is already held there, matching how `flushEvictions()` is
// invoked from the platform watch loops).
//
// Watching a single file (not a directory) keeps the test deterministic:
// file watches don't schedule a `DirectoryRegisterTask`, so `deinit()`
// runs to completion on every `close()` and exactly one `remove()` is
// issued per iteration; and the inotify file mask doesn't include
// IN_OPEN / IN_CLOSE so re-opening the fd each cycle doesn't generate
// events that would opportunistically flush.
//
// Windows uses win_watcher.zig (no evict_list); macOS directory watches
// use FSEvents. The overflow is reachable on Linux/FreeBSD only.
test.skipIf(isWindows || isMacOS)(
  "Watcher.remove() does not overflow evict_list when no fs events fire",
  async () => {
    using dir = tempDir("fswatch-evict-overflow", { "f.txt": "x" });

    const fixture = /* js */ `
      const fs = require("fs");
      const path = require("path");
      const target = path.join(process.argv[1], "f.txt");
      // > max_eviction_count (8096): one remove() per cycle, no fs events,
      // so without the fix evict_list_i hits 8096 and removeAtIndex panics.
      const ITERS = 8200;
      for (let i = 0; i < ITERS; i++) {
        const w = fs.watch(target, { persistent: false }, () => {});
        w.close();
      }
      console.log("ok " + ITERS);
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
      stdout: "ok 8200",
      stderr: "",
      exitCode: 0,
    });
  },
  30000,
);
