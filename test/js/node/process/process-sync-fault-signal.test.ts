// A `process.on(<fault signal>, fn)` listener is necessarily deferred: the
// native handler enqueues the signal number to a ring buffer and returns, and
// the event loop later drains it into JS. That is correct for async signals
// (kill, raise). For a *synchronous* CPU fault (bad load/store, ud2, brk,
// div-by-zero) the kernel restores PC to the faulting instruction after the
// handler returns, so the fault fires again immediately — an unkillable
// 100% CPU loop between _sigtramp and the faulting instruction.
//
// Observed in the field as: macOS, process.exit() → atexit → Bun__onExit →
// FSEvents.closeAndWait() → pthread_join(CFThreadLoop); CFThreadLoop hits a
// bad free in _pthread_tsd_cleanup → abort() → __abort() → __builtin_trap();
// a JS listener on the trap signal made it spin forever while the main thread
// waited on the join.
//
// The fix: when the native handler sees a kernel-generated fault (si_code > 0
// on Linux; 0 < si_code < SI_USER on Darwin) for SIGSEGV/SIGILL/SIGBUS/SIGFPE/
// SIGTRAP, it restores whatever handler it displaced (Bun's crash reporter,
// ASAN, or SIG_DFL) and returns. The immediate re-fault then terminates the
// process instead of livelocking. Async delivery of those same signals
// (process.kill, raise) still reaches the JS listener.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix } from "harness";

// Windows uses uv_signal_t and has no synchronous-fault signals in this sense.
describe.skipIf(!isPosix)("process.on(<fault signal>) with a real CPU fault", () => {
  // llvm-symbolizer on the debug binary is extremely slow; skip it so the
  // ASAN report (if any) completes within the test timeout.
  const crashEnv = {
    ...bunEnv,
    BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1",
    ASAN_OPTIONS: "allow_user_segv_handler=1:disable_coredump=1:symbolize=0:fast_unwind_on_fatal=1",
  };

  test("does not livelock on a real SIGSEGV", async () => {
    // crash_handler.segfault() writes to 0xDEADBEEF → SIGSEGV with a
    // kernel-generated si_code (SEGV_MAPERR). Before the fix, the returning
    // handler installed by process.on('SIGSEGV') would be re-entered forever
    // at 100% CPU and the child would only die to SIGKILL.
    const src = `
      const { crash_handler } = require("bun:internal-for-testing");
      process.on("SIGSEGV", () => {
        // Never reached for a synchronous fault: the native handler restores
        // the displaced crash handler and the re-fault terminates the process
        // before the event loop can drain the signal ring buffer.
        console.log("js-listener-ran");
      });
      // Keep the loop alive so a regression actually livelocks instead of
      // draining and exiting between re-faults.
      setInterval(() => {}, 1000);
      crash_handler.segfault();
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: crashEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    // The bug is an infinite spin; bound the wait so a regression fails the
    // assertion below rather than hanging the suite.
    const killer = setTimeout(() => proc.kill("SIGKILL"), 10_000);
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    clearTimeout(killer);

    // Primary assertion: the process terminated on its own. If it had to be
    // SIGKILLed by the watchdog above, the fix regressed.
    expect({ signalCode: proc.signalCode, stderrEmpty: stderr === "", stdout }).not.toEqual({
      signalCode: "SIGKILL",
      stderrEmpty: true,
      stdout: "",
    });
    expect(proc.signalCode).not.toBe("SIGKILL");
    // Release: Bun's crash handler prints a report then crash()es (signal).
    // Debug-ASAN: ASAN prints a report then _exit(1). Either way, non-zero
    // and something on stderr.
    expect(exitCode === 0).toBe(false);
    expect(stderr.length).toBeGreaterThan(0);
    // The JS listener must not have run — there is no safe point to run it
    // for a synchronous fault.
    expect(stdout).not.toContain("js-listener-ran");
  }, 30_000);

  test("still delivers async process.kill(pid, 'SIGSEGV') to the JS listener", async () => {
    // A SIGSEGV sent with kill() has si_code == SI_USER (0 on Linux, 0x10001
    // on Darwin), so forwardSignal enqueues it and the JS listener runs on
    // the next loop tick. This is the Node.js-compatible path.
    const src = `
      let got = 0;
      process.on("SIGSEGV", (name, num) => {
        got++;
        if (name !== "SIGSEGV") { console.error("bad name", name); process.exit(1); }
        if (got === 2) { console.log("OK"); process.exit(0); }
      });
      process.kill(process.pid, "SIGSEGV");
      process.kill(process.pid, "SIGSEGV");
      // Keep the loop alive until the listener fires.
      setTimeout(() => { console.error("listener never ran"); process.exit(1); }, 5000);
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("OK\n");
    expect(stderr).not.toContain("listener never ran");
    expect(exitCode).toBe(0);
  }, 15_000);

  test("still delivers raise(SIGSEGV) to the JS listener", async () => {
    // raise() is pthread_kill(self, …) on both Linux (si_code == SI_TKILL < 0)
    // and Darwin (si_code == SI_USER >= 0x10001). Neither is a kernel fault,
    // so the JS listener must still run.
    const src = `
      const { dlopen, FFIType } = require("bun:ffi");
      const lib = process.platform === "darwin" ? "libc.dylib" : "libc.so.6";
      const { symbols } = dlopen(lib, { raise: { args: [FFIType.i32], returns: FFIType.i32 } });
      process.on("SIGSEGV", () => { console.log("OK"); process.exit(0); });
      symbols.raise(require("os").constants.signals.SIGSEGV);
      setTimeout(() => { console.error("listener never ran"); process.exit(1); }, 5000);
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("OK\n");
    expect(stderr).not.toContain("listener never ran");
    expect(exitCode).toBe(0);
  }, 15_000);

  test("removing the last listener restores the displaced handler, not SIG_DFL", async () => {
    // Before: removing the last listener installed SIG_DFL unconditionally,
    // wiping out Bun's crash reporter (or ASAN's handler) for that signal.
    // After: it restores whatever was there before process.on() was called,
    // so a subsequent real fault still produces a report on stderr.
    const src = `
      const { crash_handler } = require("bun:internal-for-testing");
      const listener = () => {};
      process.on("SIGSEGV", listener);
      process.removeListener("SIGSEGV", listener);
      crash_handler.segfault();
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: crashEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const killer = setTimeout(() => proc.kill("SIGKILL"), 10_000);
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    clearTimeout(killer);

    // In release builds the restored handler is Bun's crash reporter, which
    // prints a report to stderr. In ASAN debug builds the restored handler is
    // ASAN's, which also prints to stderr. Either way: something on stderr.
    // With SIG_DFL (the old behaviour) stderr would be empty.
    expect(proc.signalCode).not.toBe("SIGKILL");
    expect(exitCode === 0).toBe(false);
    expect(stderr.length).toBeGreaterThan(0);
    // A bare SIG_DFL death in debug builds prints the one-line ASAN startup
    // warning and nothing else. Make sure there's an actual report body.
    expect(stderr.replace(/^WARNING:.*\n/m, "").trim().length).toBeGreaterThan(0);
    expect(stdout).toBe("");
  }, 30_000);
});
