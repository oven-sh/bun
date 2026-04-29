// Regression test for FSWatchTaskPosix.enqueue() leaving `concurrent_task.next`
// undefined. `PackedNextPtr.setPtr` preserves the low `auto_delete` bit, so when
// `.next` is undefined the preserved bit is garbage; if it reads as 1 the event
// loop calls `bun.destroy` on the *embedded* ConcurrentTask (an interior pointer)
// and corrupts the heap.
//
// The fix uses `ConcurrentTask.from(that, .manual_deinit)` which fully initializes
// both `.task` and `.next`. A debug assertion in `enqueueTaskConcurrent` verifies
// the pointer bits of `.next` are zero before push, which fires on any regression
// of this pattern (Zig's debug `undefined` = 0xAA..AA → non-zero pointer bits).
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// FSWatchTaskPosix is the POSIX-only code path.
test.skipIf(isWindows)("fs.watch: FSWatchTask enqueue fully initializes ConcurrentTask", async () => {
  using dir = tempDir("fswatch-concurrent-task", {
    "a.txt": "a",
    "b.txt": "b",
    "c.txt": "c",
    "d.txt": "d",
  });

  // The regression signal here is the debug assertion / no heap corruption in
  // FSWatchTask.enqueue(), not event-delivery count. On macOS, directory watches
  // route through FSEvents which has ~50ms coalescing latency and async stream
  // registration, so we wait for the first event before counting stress rounds
  // rather than assuming a fixed number of setImmediate turns is "enough time".
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

    function done() {
      for (const w of watchers) w.close();
      // Allow the close tasks (also routed via enqueue) to drain.
      setImmediate(() => {
        console.log("OK " + received);
        process.exit(0);
      });
    }

    const files = ["a.txt", "b.txt", "c.txt", "d.txt"];
    function write() {
      for (const f of files) fs.writeFileSync(path.join(dir, f), "v" + received);
    }

    // Phase 1: write until the first event arrives (condition, not time).
    const started = Date.now();
    (async () => {
      while (received === 0) {
        write();
        await new Promise(r => setImmediate(r));
        // Give up waiting for delivery after a generous bound; the assertion /
        // heap check is still exercised by close() even if no events arrived.
        if (Date.now() - started > 10_000) return done();
      }
      // Phase 2: now that enqueue() is known to be firing, stress it.
      for (let round = 0; round < 50; round++) {
        write();
        await new Promise(r => setImmediate(r));
      }
      done();
    })();
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
}, 30_000);
