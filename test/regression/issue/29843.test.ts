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

import { beforeAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isPosix, tmpdirSync } from "harness";
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

// Compiled once in beforeAll so each test body is just "spawn a subprocess
// that loads this path" — well within the default per-test timeout even
// on slow ASAN CI lanes. (The test/CLAUDE.md rule is "no explicit
// per-test timeouts".)
let libPath = "";
beforeAll(async () => {
  const dir = tmpdirSync("issue-29843-");
  const ext = process.platform === "darwin" ? "dylib" : "so";
  await Bun.write(join(dir, "lib.c"), libSource);
  await using proc = Bun.spawn({
    cmd: ["cc", "-shared", "-fPIC", "-o", `libsigtest.${ext}`, "lib.c"],
    cwd: dir,
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`cc failed (${exitCode}): ${stderr}`);
  libPath = join(dir, `libsigtest.${ext}`);
});

// Direct sigaction inspection via /proc/self/status. Linux-only because
// other POSIX systems don't expose this via procfs, but it's the most
// precise way to assert "the handler state matches pre-dlopen".
test.skipIf(!isLinux)("bun:ffi dlopen restores Bun's sigactions (#29843)", async () => {
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
  expect(exitCode).toBe(0);

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
});

// process.on("SIG…") handlers must also survive dlopen. The compat layer
// in BunProcess.cpp installs sigaction() with its own forwardSignal stub;
// a Go-style constructor would clobber it, leaving the JS listener
// attached to a signal that can no longer reach it.
test.skipIf(!isPosix)("bun:ffi dlopen preserves process.on SIGUSR1 handler (#29843)", async () => {
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
