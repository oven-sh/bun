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

import { fileSinkInternals } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix } from "harness";
import { readdirSync } from "node:fs";

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

// Reading `proc.stdin` calls `Writable.toJS` (.pipe arm), which moves the
// enum's owned `*FileSink` (+1) into the JS wrapper:
//   src/runtime/api/bun/subprocess/Writable.zig:244-272
//     this.* = .{ .ignore = {} };
//     return pipe.toJS(globalThis);              // TRANSFER, no extra ref()
//     return pipe.toJSWithDestructor(...);       // TRANSFER, no extra ref()
//
// The wrapper's finalize() balances that single +1. If the JS-wrapper
// constructor were to take its OWN +1 (instead of adopting the enum's), the
// enum's original +1 would be orphaned and every `.stdin` read would leak one
// native FileSink — observable here via `fileSinkInternals.liveCount()`
// growing by N regardless of GC.
// TODO(zig-rust-divergence): Rust port over-refs in the JS-wrapper constructor;
// see docs/ZIG_RUST_DIVERGENCE_AUDIT.md.
test.todo(
  "reading .stdin does not leak a native FileSink per spawn",
  async () => {
    const N = 24;

    async function once() {
      const proc = Bun.spawn({
        cmd: [bunExe(), "-e", ""],
        env: bunEnv,
        stdin: "pipe",
        stdout: "ignore",
        stderr: "ignore",
      });
      // Touch the getter — this is the `Writable.toJS` `.pipe` arm under test.
      const stdin = proc.stdin;
      expect(stdin).toBeDefined();
      await Promise.resolve(stdin!.end()).catch(() => {});
      await proc.exited;
    }

    // Warm up so any one-off lazy allocations are in the baseline.
    await once();
    Bun.gc(true);
    const baseline = fileSinkInternals.liveCount();

    for (let i = 0; i < N; i++) await once();

    // Let JS wrappers finalize (their deref is what drops liveCount).
    for (let i = 0; i < 50; i++) {
      Bun.gc(true);
      if (fileSinkInternals.liveCount() <= baseline) break;
      await Bun.sleep(10);
    }

    const leaked = fileSinkInternals.liveCount() - baseline;
    // A couple of stragglers whose JS wrappers haven't finalized yet are fine;
    // a +1-per-iteration native leak would leave `leaked` ≈ N here.
    expect(leaked).toBeLessThan(N / 4);
  },
  30_000,
);

// Reading `.stdin` after the child has already exited should still return
// the FileSink (not `undefined`) — the fix must not regress this.
test.skipIf(!isPosix)("reading .stdin after child exit still returns a FileSink", async () => {
  const p = Bun.spawn({ cmd: ["true"], stdin: "pipe", stdout: "ignore", stderr: "ignore" });
  await p.exited;
  const stdin = p.stdin;
  expect(stdin).toBeDefined();
  expect(typeof (stdin as any).write).toBe("function");
});
