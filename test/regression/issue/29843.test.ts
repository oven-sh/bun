// https://github.com/oven-sh/bun/issues/29843
//
// Loading a Go `-buildmode=c-shared` library via bun:ffi dlopen() caused
// Prisma's MariaDB adapter to hang the event loop. The root cause: Go's
// c-shared runtime registers its own signal handlers during library init
// (SIGURG for goroutine preemption, but also SIGPIPE, SIGCHLD, SIGHUP,
// SIGINT, SIGTERM, SIGABRT, SIGSEGV, SIGILL, SIGBUS, SIGFPE, SIGTRAP,
// SIGQUIT), overwriting Bun's. The most immediately damaging swap is
// SIGPIPE: Bun installs SIG_IGN so writes to closed sockets/pipes return
// EPIPE; Go replaces it with a runtime handler that doesn't preserve that
// behaviour. Other clobbered signals include Bun's crash handlers
// (SEGV/ILL/BUS/FPE) and any `process.on("SIG…")` the user registered.
//
// Fix: snapshot sigactions before dlopen() and restore them afterwards.
// Only signals that had a non-default handler are restored, so libraries
// (like Go) can still install handlers for signals Bun doesn't use —
// notably SIGURG, which Go needs for its own scheduler.
//
// The test compiles a tiny C library whose __attribute__((constructor))
// replicates exactly what Go's c-shared runtime does at init time: bulk
// sigaction() calls for the full signal set. No Go toolchain required.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isPosix, tempDir } from "harness";
import { join } from "node:path";

// Reproduce Go's c-shared init-time signal-handler install. sa_flags
// deliberately include SA_SIGINFO|SA_ONSTACK|SA_RESTART to match what
// Go actually does, so the "changed" detection in c-bindings.cpp
// exercises the SA_SIGINFO branch.
const libSource = `
#include <signal.h>
#include <stdio.h>

static void noop_handler(int sig, siginfo_t *info, void *ctx) {
  (void)sig; (void)info; (void)ctx;
}

__attribute__((constructor))
static void on_load(void) {
  struct sigaction sa;
  sa.sa_sigaction = noop_handler;
  sigemptyset(&sa.sa_mask);
  sa.sa_flags = SA_SIGINFO | SA_ONSTACK | SA_RESTART;

  // Mirror Go's c-shared init. Every one of these is a signal Go claims.
  int sigs[] = {
    SIGPIPE, SIGCHLD, SIGURG, SIGHUP, SIGINT, SIGTERM,
    SIGABRT, SIGSEGV, SIGILL, SIGBUS, SIGFPE, SIGTRAP, SIGQUIT,
    SIGUSR1, SIGUSR2,
  };
  for (unsigned i = 0; i < sizeof(sigs) / sizeof(sigs[0]); i++) {
    sigaction(sigs[i], &sa, NULL);
  }
}

int version(void) { return 1; }
`;

// Everything in this file is POSIX-only: the fix is guarded by
// `#if !OS(WINDOWS)` / `Environment.isPosix`, `cc` isn't on PATH in
// Windows CI, and /proc/self/status doesn't exist on macOS. The describe
// wrapper keeps the beforeAll fixture-build from running on Windows
// (Bun's runner executes top-level hooks even when every test is skipped).
describe.skipIf(!isPosix)("bun:ffi dlopen signal-handler preservation (#29843)", () => {
  let dir!: string & Disposable & AsyncDisposable;
  let libPath = "";

  // Compiled once in beforeAll so each test body is just "spawn a subprocess
  // that loads this path" — well within the default per-test timeout even
  // on slow ASAN CI lanes. (test/CLAUDE.md forbids explicit per-test timeouts.)
  beforeAll(async () => {
    dir = tempDir("issue-29843-", {});
    const ext = process.platform === "darwin" ? "dylib" : "so";
    await Bun.write(join(String(dir), "lib.c"), libSource);
    await using proc = Bun.spawn({
      cmd: ["cc", "-shared", "-fPIC", "-o", `libsigtest.${ext}`, "lib.c"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) throw new Error(`cc failed (${exitCode}): ${stderr}`);
    libPath = join(String(dir), `libsigtest.${ext}`);
  });

  afterAll(async () => {
    await dir[Symbol.asyncDispose]();
  });

  // Direct sigaction inspection via /proc/self/status. Linux-only because
  // other POSIX systems don't expose this via procfs, but it's the most
  // precise way to assert "the handler state matches pre-dlopen".
  test.skipIf(!isLinux)("bun:ffi dlopen restores Bun's sigactions", async () => {
    // The fixture reads /proc/self/status's SigIgn and SigCgt bitmasks
    // before and after dlopen and reports any signal whose bit flipped —
    // either gained a handler or lost one. The test then asserts that any
    // changes are limited to SIGURG (Go's goroutine-preemption signal, a
    // signal Bun doesn't manage and deliberately leaves alone) and to
    // signals whose pre-dlopen handler was SIG_DFL (which we intentionally
    // don't restore — the loaded library is free to claim unhandled
    // signals, e.g. Go's SIGPROF/SIGVTALRM for its profiler).
    const fixture = `
      import { dlopen, FFIType } from "bun:ffi";
      import { readFileSync } from "node:fs";

      function getMasks() {
        const status = readFileSync("/proc/self/status", "utf8");
        let ign = 0n, cgt = 0n;
        for (const line of status.split("\\n")) {
          const igm = line.match(/^SigIgn:\\s+([0-9a-f]+)/);
          if (igm) ign = BigInt("0x" + igm[1]);
          const cgm = line.match(/^SigCgt:\\s+([0-9a-f]+)/);
          if (cgm) cgt = BigInt("0x" + cgm[1]);
        }
        return { ign, cgt };
      }

      const before = getMasks();
      const lib = dlopen(${JSON.stringify(libPath)}, {
        version: { args: [], returns: FFIType.int },
      });
      lib.symbols.version();
      const after = getMasks();

      // Report signal numbers whose ignore/caught state flipped. Bit N in
      // these masks corresponds to signal N+1.
      const changed = { ignLost: [], ignGained: [], cgtLost: [], cgtGained: [] };
      for (let i = 0; i < 32; i++) {
        const bit = 1n << BigInt(i);
        const signo = i + 1;
        if ((before.ign & bit) && !(after.ign & bit)) changed.ignLost.push(signo);
        if (!(before.ign & bit) && (after.ign & bit)) changed.ignGained.push(signo);
        if ((before.cgt & bit) && !(after.cgt & bit)) changed.cgtLost.push(signo);
        if (!(before.cgt & bit) && (after.cgt & bit)) changed.cgtGained.push(signo);
      }
      console.log(JSON.stringify(changed));
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    // Not asserting stderr is empty — debug ASAN builds print a JSC
    // "useWasmFaultSignalHandler will be disabled" warning to stderr on
    // any run that touches WASM, and any warning we care about would
    // already cause the JSON parse below to fail.
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const changed = JSON.parse(stdout.trim().split("\n").pop()!);

    // Bun must not LOSE any sigaction — that's the bug: Bun's SIGPIPE=IGN
    // and crash/forwardSignal handlers all survive dlopen.
    expect(changed.ignLost).toEqual([]);
    expect(changed.cgtLost).toEqual([]);

    // Bun must not GAIN a SIG_IGN it didn't set. The loaded library installs
    // SA_SIGINFO handlers (which land in SigCgt); none should leak into
    // SigIgn, and those SigCgt additions are only allowed for signals that
    // were SIG_DFL pre-dlopen (1=HUP, 2=INT, 3=QUIT, 4=ILL (ASAN disables
    // Bun's crash handler), 5=TRAP, 6=ABRT, 10=USR1, 12=USR2, 14=ALRM,
    // 15=TERM, 17=CHLD, 23=URG) — the Go-style loader may claim those, and
    // the user can later call process.on() to take them back.
    expect(changed.ignGained).toEqual([]);
    const allowedCgtGain = new Set([1, 2, 3, 4, 5, 6, 10, 12, 14, 15, 17, 23]);
    const disallowedCgtGain = changed.cgtGained.filter((s: number) => !allowedCgtGain.has(s));
    expect(disallowedCgtGain).toEqual([]);

    expect(exitCode).toBe(0);
  });

  // process.on("SIG…") handlers must also survive dlopen. The compat layer
  // in BunProcess.cpp installs sigaction() with its own forwardSignal stub;
  // a Go-style constructor would clobber it, leaving the JS listener
  // attached to a signal that can no longer reach it.
  test("bun:ffi dlopen preserves process.on SIGUSR1 handler", async () => {
    const fixture = `
      import { dlopen, FFIType } from "bun:ffi";

      const { promise, resolve } = Promise.withResolvers();
      process.on("SIGUSR1", () => { resolve(); });

      const lib = dlopen(${JSON.stringify(libPath)}, {
        version: { args: [], returns: FFIType.int },
      });
      lib.symbols.version();

      // Give the kernel a moment to route; then raise SIGUSR1 to ourselves.
      // If the handler was clobbered, the JS listener never fires and the
      // process would hang; the test's built-in timeout kills it.
      setImmediate(() => process.kill(process.pid, "SIGUSR1"));
      await promise;
      console.log("sigusr1-delivered");
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    // Not asserting stderr — see comment in the sibling test.
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ exitCode, tail: stdout.trim().split("\n").pop() }).toEqual({
      exitCode: 0,
      tail: "sigusr1-delivered",
    });
  });

  // The same preservation must hold for process.dlopen(), which takes a
  // separate code path through Process_functionDlopen in BunProcess.cpp
  // (versus FFI.open in ffi.zig for bun:ffi). This test loads the same
  // Go-style library via process.dlopen so both call sites are covered.
  //
  // process.dlopen uses napi_module_register for exports, so the library
  // has to look like a node-api addon; we reuse the same libsigtest.so
  // and only care that the constructor ran (which installs the handlers)
  // and that SIGPIPE = SIG_IGN survives. The process.dlopen API will
  // complain about the module not registering, but the constructor runs
  // before any of that, so the signal state after the call is what matters.
  test.skipIf(!isLinux)("process.dlopen restores Bun's sigactions", async () => {
    const fixture = `
      import { readFileSync } from "node:fs";

      function getMasks() {
        const status = readFileSync("/proc/self/status", "utf8");
        let ign = 0n, cgt = 0n;
        for (const line of status.split("\\n")) {
          const igm = line.match(/^SigIgn:\\s+([0-9a-f]+)/);
          if (igm) ign = BigInt("0x" + igm[1]);
          const cgm = line.match(/^SigCgt:\\s+([0-9a-f]+)/);
          if (cgm) cgt = BigInt("0x" + cgm[1]);
        }
        return { ign, cgt };
      }

      const before = getMasks();
      // process.dlopen throws because libsigtest.so isn't a real node
      // addon (no napi_register_module call), but its constructor — the
      // bit that installs the signal handlers — runs before the symbol
      // lookup that makes process.dlopen throw. Swallow the error and
      // check the signal state after.
      try {
        const module = { exports: {} };
        process.dlopen(module, ${JSON.stringify(libPath)}, 0);
      } catch {}
      const after = getMasks();

      const SIGPIPE_BIT = 1n << 12n;
      console.log(JSON.stringify({
        sigpipeStillIgnored: (after.ign & SIGPIPE_BIT) !== 0n,
        ignChanged: before.ign !== after.ign,
      }));
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const report = JSON.parse(stdout.trim().split("\n").pop()!);
    // The regression is SIGPIPE losing its SIG_IGN across the dlopen;
    // with the fix, SigIgn is unchanged.
    expect(report).toEqual({ sigpipeStillIgnored: true, ignChanged: false });

    expect(exitCode).toBe(0);
  });
});
