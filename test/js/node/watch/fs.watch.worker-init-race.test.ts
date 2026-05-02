import { expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, tempDir } from "harness";

// Regression test for broken double-checked locking on `fsevents_default_loop`
// in src/bun.js/node/fs_events.zig.
//
// `FSEvents.watch()` is called from `Darwin.addWatch` (path_watcher.zig)
// WITHOUT holding `manager.mutex` (it's released first to keep lock order
// one-way). Two Workers can therefore enter `FSEvents.watch()` concurrently.
//
// Before the fix the function read `fsevents_default_loop` with no lock and
// no acquire fence; only the else-branch took `fsevents_default_loop_mutex`.
// On ARM64 Worker A's store of the pointer could become visible to Worker B
// before the stores inside `FSEventsLoop.init()` (`this.* = fs_loop`), so
// Worker B would call `registerWatcher()` on a partially-visible loop and
// lock a garbage `loop.mutex` / read a garbage `loop.watchers` BabyList.
// `CoreFoundation.get()` / `CoreServices.get()` had the identical pattern.
//
// This is `path_watcher.zig`'s own `PathWatcherManager.get()` comment applied
// to `fs_events.zig`: drop the unlocked fast path; the mutex is uncontended
// after initialization.
//
// The race requires (a) the very first `fs.watch()` in the process to happen
// on two threads at once and (b) store reordering, so it is low-probability
// even on Apple Silicon. This test spawns a fresh process per iteration so
// the loop is uninitialized each time, and fires several Workers that all
// call `fs.watch()` as their first statement on distinct directories (so
// `PathWatcherManager` dedup doesn't serialize them).
//
// macOS-only: the FSEvents code path doesn't exist on other platforms.
test.skipIf(!isMacOS)(
  "FSEvents: concurrent first fs.watch() from Workers does not observe a partially-initialized loop",
  async () => {
    const WORKERS = 8;
    const files: Record<string, string> = {};
    for (let i = 0; i < WORKERS; i++) files[`d${i}/f.txt`] = "x";
    files["worker.js"] = `
      const fs = require("fs");
      const { parentPort, workerData } = require("worker_threads");
      // First thing this thread does: hit FSEvents.watch() via Darwin.addWatch
      // with manager.mutex released. Multiple Workers race here on a fresh
      // process so fsevents_default_loop starts null.
      const w = fs.watch(workerData.dir, () => {});
      w.close();
      parentPort.postMessage("ok");
    `;
    files["main.js"] = `
      const path = require("path");
      const { Worker } = require("worker_threads");
      const root = process.argv[2];
      const N = ${WORKERS};
      let done = 0;
      let failed = false;
      for (let i = 0; i < N; i++) {
        const w = new Worker(path.join(root, "worker.js"), {
          workerData: { dir: path.join(root, "d" + i) },
        });
        w.on("message", () => {
          if (++done === N && !failed) {
            console.log("OK");
            process.exit(0);
          }
        });
        w.on("error", err => {
          failed = true;
          console.error("worker error:", err);
          process.exit(1);
        });
      }
    `;

    using dir = tempDir("fsevents-worker-init-race", files);

    // Fresh process each iteration so the FSEvents loop global starts null
    // and the DCLP race window exists every time.
    for (let i = 0; i < 20; i++) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "main.js", String(dir)],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        proc.stdout.text(),
        proc.stderr.text(),
        proc.exited,
      ]);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("OK");
      expect(exitCode).toBe(0);
    }
  },
  60_000,
);
