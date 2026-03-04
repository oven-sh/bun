// Regression test for PathWatcher self-deadlock when close() wins the race
// against the background DirectoryRegisterTask scan.
//
// The bug (pre-fix unrefPendingDirectory):
//   1. watch(dir) schedules a DirectoryRegisterTask on the workpool and returns.
//   2. close() runs synchronously on the main thread BEFORE the scan finishes:
//      deinit() → setClosed() → closed=true → hasPendingDirectories()==true →
//      early return. Main thread is done; workpool is still scanning.
//   3. Workpool finishes the scan, defer fires unrefPendingDirectory():
//        this.mutex.lock();
//        if (isClosed() && pending_directories == 0) {    // true — main thread set it
//            this.deinit();                               // called HOLDING this.mutex
//        }
//   4. deinit() → setClosed() → this.mutex.lock() — recursive lock, same thread.
//
// bun.Mutex is non-recursive. On debug builds (`bun bd`, which has ASAN),
// DebugImpl.lock() tracks the locking thread and detects re-entry:
// @panic("Deadlock detected"). That lands on stderr. Several workpool threads
// typically hit it at once — Bun prints "oh no: multiple threads are crashing".
//
// On release builds, FutexImpl just self-blocks in futex_wait forever —
// silent. The main thread never waits for the workpool, so the process still
// exits 0, and the stderr assertion below passes vacuously. That's fine:
// `bun bd test` (debug) is what guards this in CI, and release-ASAN isn't
// where this bug lives — it's a deadlock, not a UAF.
//
// Why this test doesn't assert on fd growth: on the fixed build there's a
// residual ~1-fd-per-iter leak PLUS an occasional ~200-fd spike (1/8 iters
// on ~15% of runs, even when serialized). The spike is a SEPARATE bug —
// likely a concurrent-deinit race where both the main thread and the
// workpool get past hasPendingDirectories() and both call destroy(this).
// Pre-fix, the recursive lock deadlocked the workpool BEFORE it could
// reach that second destroy; post-fix, both threads proceed. That's worth
// fixing, but it makes fd growth a noisy signal for THIS regression.
//
// Linux-only: macOS uses FSEvents for directory watches, which doesn't go
// through DirectoryRegisterTask.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";

test.skipIf(!isLinux)("fs.watch: closing a directory watcher mid-scan should not self-deadlock", async () => {
  using dir = tempDir("fs-watch-midscan", {
    "probe.mjs": `
import { watch } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2];

// Wide race window: the workpool has to open() + inotify_add_watch() each of
// 200 entries; the main thread just falls through to close(). close() lands
// while the scan is mid-walk.
const filesPerDir = 200;

for (let iter = 0; iter < 8; iter++) {
  const d = join(root, "d" + iter);
  mkdirSync(d);
  for (let i = 0; i < filesPerDir; i++) writeFileSync(join(d, "f" + i), "x");

  const w = watch(d, { recursive: false });
  w.close(); // NO await — fires while the workpool scan is still walking the 200 entries
}

// Write a sentinel to the result file so the test knows the main thread got
// here. On pre-fix debug the PANIC is on the WORKPOOL threads, not main, so
// main runs to completion — but the process then hangs at exit because the
// panic handlers hold Bun's crash-handler mutex. SIGKILL self guarantees
// termination; the test reads stderr and sees "Deadlock detected".
writeFileSync(join(root, "done"), "ok");
process.kill(process.pid, "SIGKILL");
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "probe.mjs", String(dir)],
    env: bunEnv,
    cwd: String(dir),
    // Pre-fix debug dumps Zig panic stack traces to stdout (several per
    // workpool thread). We don't read it; don't let the pipe backpressure
    // the child if it fills.
    stdout: "ignore",
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  // The actual regression check. Pre-fix debug: each deadlocked workpool
  // thread prints "panic: Deadlock detected" with a Zig stack trace naming
  // unrefPendingDirectory → deinit → setClosed → Mutex.lock. Post-fix: silent.
  //
  // Release builds never use DebugImpl so this passes trivially there — that's
  // by design. The deadlock IS silent on release (futex_wait forever on a
  // workpool thread that nothing waits for); there's no portable, non-flaky
  // way to observe it there. Debug is the guard.
  //
  // Pre-fix debug + the 5s local test timeout: Bun.spawn on debug+ASAN takes
  // ~7s to resolve proc.exited after the child SIGKILLs itself (unrelated
  // debug overhead). Locally the test times out before reaching these
  // assertions. Still a FAIL — just via timeout instead of .not.toContain.
  // CI's 90s timeout is long enough to see the assertion fire directly.
  const cleanedStderr = stderr.replace(/^WARNING: ASAN interferes.*\n/m, "");
  expect(cleanedStderr).not.toContain("Deadlock detected");
  expect(cleanedStderr).not.toContain("panic:");

  // Child always SIGKILLs itself → 128 + 9.
  expect(exitCode).toBe(137);
});
