import { expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, tempDir } from "harness";

// Regression test for FSEvents `_events_cb` iterating `loop.watchers`
// without holding `loop.mutex`.
//
// `_events_cb` runs on the dedicated CoreFoundation thread. Before the fix
// it sliced `loop.watchers` and dereferenced each `FSEventsWatcher` (reading
// `handle.path`, calling `handle.emit`) without taking `loop.mutex`. At the
// same time the JS thread can call `watcher.close()` → `FSEventsWatcher.deinit()`
// → `unregisterWatcher()` (which nulls the entry under the mutex) and then
// immediately `destroy()` the watcher and free its path buffer. Nothing
// synchronised the in-flight CF-thread iteration with that destroy, so the
// CF thread could read freed memory.
//
// The race window is small; this test floods the directory with writes
// (so `_events_cb` fires continuously) while rapidly creating/closing
// watchers on the same directory (so destroys land mid-iteration). Under
// ASAN on an unpatched build this reliably reports heap-use-after-free.
//
// macOS-only: the FSEvents code path doesn't exist on other platforms.
test.skipIf(!isMacOS)("FSEvents: closing watchers while events fire does not UAF", async () => {
  using dir = tempDir("fsevents-events-cb-race", {
    "a.txt": "x",
    "b.txt": "x",
    "c.txt": "x",
  });

  const script = /* js */ `
    const fs = require("fs");
    const path = require("path");
    const dir = process.argv[1];

    let writes = 0;
    let stopped = false;

    // Writer: hammer the directory so the CF thread's _events_cb fires
    // as often as possible. Runs until we explicitly stop it.
    function writeLoop() {
      if (stopped) return;
      try {
        fs.writeFileSync(path.join(dir, "a.txt"), String(writes));
        fs.writeFileSync(path.join(dir, "b.txt"), String(writes));
        fs.writeFileSync(path.join(dir, "c.txt"), String(writes));
      } catch {}
      writes++;
      setImmediate(writeLoop);
    }
    setImmediate(writeLoop);

    // Churn watchers: each iteration creates a few watchers on the same
    // directory (so the watchers list has multiple live entries, and
    // registerWatcher may reallocate the backing buffer) then closes them
    // on the next tick while _events_cb is likely mid-iteration.
    const iterations = 400;
    let i = 0;
    function churn() {
      if (i++ >= iterations) {
        stopped = true;
        // Let any in-flight CF callbacks drain before declaring success.
        setTimeout(() => {
          console.log("OK " + i + " " + writes);
          process.exit(0);
        }, 100);
        return;
      }
      const ws = [];
      for (let j = 0; j < 4; j++) {
        ws.push(fs.watch(dir, () => {}));
      }
      setImmediate(() => {
        for (const w of ws) w.close();
        setImmediate(churn);
      });
    }
    setImmediate(churn);

    // Watchdog: if we deadlock or hang, bail with a distinctive message.
    const wd = setTimeout(() => {
      process.stderr.write("HUNG after 30s (i=" + i + ", writes=" + writes + ")\\n");
      process.exit(1);
    }, 30000);
    wd.unref();
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script, String(dir)],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("HUNG");
  expect(stdout).toStartWith("OK");
  expect(exitCode).toBe(0);
}, 60000);
