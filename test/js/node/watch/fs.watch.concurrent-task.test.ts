// Regression test for FSWatchTaskPosix.enqueue() leaving `concurrent_task.next`
// undefined. `PackedNextPtr.setPtr` preserves the low `auto_delete` bit, so when
// `.next` is undefined the preserved bit is garbage; if it reads as 1 the event
// loop calls `bun.destroy` on the *embedded* ConcurrentTask (an interior pointer)
// and corrupts the heap.
//
// The fix uses `ConcurrentTask.from(that, .manual_deinit)` which fully initializes
// both `.task` and `.next`. A debug assertion in `enqueueTaskConcurrent` verifies
// `.next.getPtr() == null` before push, which fires on any regression of this
// pattern (Zig's debug `undefined` = 0xAA..AA → non-null pointer bits).
import { test, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import path from "node:path";

// FSWatchTaskPosix is the POSIX-only code path.
test.skipIf(isWindows)("fs.watch: FSWatchTask enqueue fully initializes ConcurrentTask", async () => {
  using dir = tempDir("fswatch-concurrent-task", {
    "a.txt": "a",
    "b.txt": "b",
    "c.txt": "c",
    "d.txt": "d",
  });

  const fixture = /* js */ `
    const fs = require("fs");
    const path = require("path");
    const dir = ${JSON.stringify(String(dir))};

    let received = 0;
    const watchers = [];
    // Many watchers → many FSWatchTask.enqueue() calls per batch of fs events.
    for (let i = 0; i < 64; i++) {
      watchers.push(fs.watch(dir, () => { received++; }));
    }

    let round = 0;
    const files = ["a.txt", "b.txt", "c.txt", "d.txt"];
    function tick() {
      if (round++ >= 50) {
        for (const w of watchers) w.close();
        // Allow the close tasks (also routed via enqueue) to drain.
        setImmediate(() => {
          if (received === 0) {
            console.error("no events received");
            process.exit(1);
          }
          console.log("OK " + received);
          process.exit(0);
        });
        return;
      }
      for (const f of files) {
        fs.writeFileSync(path.join(dir, f), "round" + round);
      }
      setImmediate(tick);
    }
    setImmediate(tick);
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toStartWith("OK ");
  expect(exitCode).toBe(0);
});
