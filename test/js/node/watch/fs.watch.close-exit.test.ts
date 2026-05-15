import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Regression test for pointer-provenance UB in the fs.watch backends
// introduced by the Rust port.
//
// `FSEventsLoop::init()` spawned the CoreFoundation thread by laundering
// `*mut FSEventsLoop` through `usize` (`this as usize` → `addr as *mut _`) to
// satisfy `Send` on the closure. That strips provenance: the CF thread's
// writes to `self.loop_` become disconnected from the JS thread's reads.
// Compounding this, `cf_thread_loop` took `&mut self` and held it across
// `CFRunLoopRun()`, so the JS thread's `&mut FSEventsLoop` in
// `register_watcher`/`unregister_watcher`/`Drop` aliased it — two live
// `&mut` to one allocation is UB regardless of synchronization. Under
// `noalias` LLVM is free to treat the CF thread's
// `self.loop_ = CFRunLoopGetCurrent()` as invisible, so the JS thread's
// `enqueue_task_concurrent` reads a stale `NULL` and calls
// `CFRunLoopWakeUp(NULL)`, faulting inside CoreFoundation at +0xC.
//
// The same `usize` round-trip existed in the Linux inotify and FreeBSD
// kqueue reader-thread spawns; fixed together.
//
// Field report: test/js/node/async_hooks/async-context/async-context-fs-watch.js
// crashed on macOS aarch64 release with "Segmentation fault at address 0xC".
//
// This test hammers the exact sequence from that report — watch → trigger →
// close-in-callback → process.exit — across many subprocesses so the optimizer
// has plenty of chances to exploit the UB.
test.concurrent("fs.watch: close() + process.exit() inside the watch callback does not crash", async () => {
  using dir = tempDir("fs-watch-close-exit", {
    ".keep": "",
  });

  const script = /* js */ `
    const fs = require("fs");
    const path = require("path");
    // Each subprocess gets its own file so concurrent runs don't race on
    // unlink/watch of a shared path.
    const file = path.join(process.argv[2], "target-" + process.pid + ".txt");
    fs.writeFileSync(file, "initial");

    const watcher = fs.watch(file, () => {
      // Inside the callback: drop the watcher (→ unregister_watcher →
      // enqueue_task_concurrent, which reads self.loop_), then exit
      // (→ close_and_wait → Drop → enqueue_task_concurrent again while the
      // CF thread is still inside cf_thread_loop).
      watcher.close();
      try { fs.unlinkSync(file); } catch {}
      process.exit(0);
    });

    // Trigger the watch.
    setImmediate(() => fs.writeFileSync(file, "modified"));

    // Fallback exit in case the event never fires (acceptable — we're
    // asserting "does not crash", not "event delivered").
    setTimeout(() => {
      watcher.close();
      process.exit(0);
    }, 4000);
  `;

  // Run the sequence many times. On an unpatched macOS aarch64 release build
  // this reproduces the 0xC segfault within a handful of iterations; on other
  // platforms it exercises the SendPtr-wrapped reader-thread spawn.
  // Batch them so a failure surfaces quickly without serializing 40 spawns.
  const iterations = 40;
  const width = 8;
  for (let base = 0; base < iterations; base += width) {
    const batch = Array.from({ length: Math.min(width, iterations - base) }, async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script, String(dir)],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        proc.stdout.text(),
        proc.stderr.text(),
        proc.exited,
      ]);
      expect(stderr).toBe("");
      expect(stdout).toBe("");
      expect(proc.signalCode).toBeNull();
      expect(exitCode).toBe(0);
    });
    await Promise.all(batch);
  }
}, 60_000);
