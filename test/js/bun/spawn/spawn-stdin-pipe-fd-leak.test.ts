// When `stdin: "pipe"` is passed to Bun.spawn and the `.stdin` getter is
// never read, the stdin pipe fd should still be closed when the child
// exits — not deferred to GC.
//
// Root cause: `Writable.init()` wrote `subprocess.weak_file_sink_stdin_ptr`,
// `subprocess.ref()`, and `subprocess.flags.*` while being called as a field
// initializer inside the `subprocess.* = Subprocess{ ... }` aggregate, so
// those writes were immediately clobbered by the rest of the literal
// (including `weak_file_sink_stdin_ptr`'s default of `null`). `onProcessExit`
// then found no pipe to close and the fd lived until Subprocess finalization.

import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { isPosix } from "harness";

function countOpenFds(): number {
  // Linux and macOS both expose per-process fd tables here.
  try {
    return readdirSync("/proc/self/fd").length;
  } catch {
    return readdirSync("/dev/fd").length;
  }
}

// Windows has no /proc/self/fd equivalent; the observable leak is
// POSIX-specific anyway (libuv pipe close on Windows is async regardless).
test.skipIf(!isPosix)("stdin: 'pipe' fd is closed on child exit without reading .stdin", async () => {
  const N = 100;

  // Warm up: spawn once so any lazily-opened runtime fds (signalfd, etc.)
  // are already present in the baseline.
  {
    const p = Bun.spawn({ cmd: ["true"], stdin: "pipe", stdout: "ignore", stderr: "ignore" });
    await p.exited;
  }

  const baseline = countOpenFds();

  const children: Bun.Subprocess[] = [];
  for (let i = 0; i < N; i++) {
    children.push(Bun.spawn({ cmd: ["true"], stdin: "pipe", stdout: "ignore", stderr: "ignore" }));
  }
  await Promise.all(children.map(p => p.exited));

  // fd closes go through bun.Async.Closer on POSIX; give the close thread
  // a moment — but do NOT invoke GC, since the bug was that cleanup only
  // happened via Subprocess finalization.
  for (let i = 0; i < 20 && countOpenFds() - baseline > N / 4; i++) await Bun.sleep(20);

  const afterExit = countOpenFds() - baseline;

  // Keep `children` alive across the measurement so GC finalization cannot
  // be what closed the fds.
  expect(children.length).toBe(N);

  // Without the fix every stdin pipe (one per child) is still open here,
  // so `afterExit` ≈ N. Allow slack for a few async closes still in flight.
  expect(afterExit).toBeLessThan(N / 4);
});

// Reading `.stdin` after the child has already exited should still return
// the FileSink (not `undefined`) — the fix must not regress this.
test.skipIf(!isPosix)("reading .stdin after child exit still returns a FileSink", async () => {
  const p = Bun.spawn({ cmd: ["true"], stdin: "pipe", stdout: "ignore", stderr: "ignore" });
  await p.exited;
  const stdin = p.stdin;
  expect(stdin).toBeDefined();
  expect(typeof (stdin as any).write).toBe("function");
});
