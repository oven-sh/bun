// Regression test for https://github.com/oven-sh/bun/issues/31158.
//
// When a shared library (e.g. Go's cgo runtime) force-sets `SA_ONSTACK` on
// JavaScriptCore's thread-suspend signal (SIGPWR on Linux in Bun's WebKit
// fork), every delivery of that signal on a thread that has an alternate
// signal stack (ASAN runtime, Bun's crash handler, libbacktrace) runs the
// handler on the alt stack. WTF's stack-check in `signalHandlerSuspendResume`
// used `currentStackPointer()` — the handler's own SP — so the sanity
// check failed every time, `Thread::suspend()` retried forever, and the
// event loop stopped advancing on the next WASM compile/install.
//
// Fixed upstream (oven-sh/WebKit#235) by reading the interrupted thread's
// SP from the ucontext instead of the handler's own SP — that SP is stable
// whether the handler runs on the normal stack or the alt stack, so
// `SA_ONSTACK` no longer matters.
//
// Triggers the exact shape of the bug without needing Go installed in CI:
// force `SA_ONSTACK` onto SIGPWR via `bun:ffi` (same thing Go's cgo
// `initsig` does to every handler at load time), then compile+call a WASM
// function (which triggers `resetInstructionCacheOnAllThreads`, the code
// path that actually suspends the JS thread). Without the fix,
// `setTimeout` after the WASM call never fires and the child hangs.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isGlibc } from "harness";

// The bug is only reachable on Linux: SIGPWR is only used as the suspend/
// resume signal on Linux (see `vendor/WebKit/Source/WTF/wtf/posix/
// ThreadingPOSIX.cpp` — USE(BUN_JSC_ADDITIONS) branch). The reproduction
// dlopens `libc.so.6` directly so it needs glibc; musl names its libc
// differently and static-musl builds of Bun don't even have a dynamic
// loader in the room.
test.skipIf(!isGlibc)(
  "event loop survives SA_ONSTACK on SIGPWR + WASM (oven-sh/bun#31158)",
  async () => {
    const script = /* ts */ `
      import { dlopen, FFIType, ptr } from "bun:ffi";

      // 1. Open libc so we can flip SA_ONSTACK on SIGPWR the same way Go's
      //    cgo 'initsig' does on every inherited handler.
      const libc = dlopen("libc.so.6", {
        sigaction: { args: [FFIType.i32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
      });

      // x86_64 glibc layout: sa_handler (8), sa_mask (128), sa_flags (4), sa_restorer (8).
      // We only touch sa_flags so this layout holds on aarch64 too (same offsets).
      const SIGACTION_SIZE = 152;
      const FLAGS_OFFSET = 8 + 128;
      const SIGPWR = 30;
      const SA_ONSTACK = 0x08000000;

      const buf = new ArrayBuffer(SIGACTION_SIZE);
      const view = new DataView(buf);

      libc.symbols.sigaction(SIGPWR, null, ptr(buf));
      view.setInt32(FLAGS_OFFSET, view.getInt32(FLAGS_OFFSET, true) | SA_ONSTACK, true);
      libc.symbols.sigaction(SIGPWR, ptr(buf), null);

      // 2. Exercise the WASM path that calls resetInstructionCacheOnAllThreads.
      //    The bytes below are a minimal WASM module with one exported function
      //    that loops 10_000 times and returns — enough to trigger compilation.
      //    SA_ONSTACK is still set at this point; the WTF fix makes the
      //    handler tolerate it instead of spinning.
      const bytes = new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0, 7, 5,
        1, 1, 102, 0, 0, 10, 34, 1, 32, 1, 1, 127, 65, 0, 33, 0, 2, 64, 3, 64,
        32, 0, 65, 1, 106, 33, 0, 32, 0, 65, 144, 206, 0, 72, 13, 0, 11, 11, 32,
        0, 11,
      ]);
      const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes));
      (inst.exports.f as () => number)();

      // 3. A setTimeout that must fire — the bug makes this hang forever.
      await new Promise(r => setTimeout(r, 10));
      console.log("EVENT_LOOP_ALIVE");
    `;

    // `await using` scopes the child to this block — if the test-runner
    // timeout fires because the bug reproduced, `Bun.spawn`'s disposer
    // kills the child on the way out, no harness-side watchdog needed.
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Debug/ASAN builds print a benign "WARNING: ASAN interferes with JSC signal
    // handlers" banner (bunEnv's BUN_DEBUG_QUIET_LOGS gates only Bun's debug
    // scopes, not this); filter it so the real signal is what's asserted.
    const cleanStderr = stderr.replace(/^WARNING: ASAN interferes with JSC signal handlers;[^\n]*\n?/gm, "");
    expect({ stdout, stderr: cleanStderr, exitCode }).toEqual({
      stdout: expect.stringContaining("EVENT_LOOP_ALIVE"),
      stderr: "",
      exitCode: 0,
    });
  },
  15_000,
);
