import { crash_handler } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isPosix, isWindows, mergeWindowEnvs, tempDir } from "harness";
import { rmSync } from "node:fs";
import { constants as osConstants } from "node:os";
import path from "path";
const { getMachOImageZeroOffset } = crash_handler;

// CI sets BUN_CRASH_REPORT_URL so unexpected crashes are captured; these
// deliberate crashes must not upload there or the runner pins them on the
// next unrelated failing test as "crash reported" and blocks its retries.
const noReportEnv = { ...bunEnv, BUN_CRASH_REPORT_URL: "", BUN_ENABLE_CRASH_REPORTING: "0" };

// On Linux, debug builds symbolize crash traces by spawning llvm-symbolizer;
// without it the fallback printer has no Rust symbol names to assert on.
const hasSymbolizer = !!(Bun.which("llvm-symbolizer") || Bun.which("llvm-symbolizer-21"));

test.if(isDebug && isLinux && hasSymbolizer)(
  "crash trace starts at the crash site, not inside the crash handler",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "fixture-crash.js"), "panic"],
      env: noReportEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // The panic header goes to stderr; the symbolized frames are printed by
    // llvm-symbolizer, which is spawned with inherited stdio, so they land on
    // stdout.
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("panic(main thread): invoked crashByPanic() handler");
    expect(exitCode).not.toBe(0);

    // The innermost frame of the trace must be the code that crashed (the
    // js_panic test hook)...
    const firstFrame = stdout.split("\n").find(line => line.trim().length > 0);
    expect(firstFrame ?? "<no frames printed>").toContain("js_panic");

    // ...not the capture machinery. A mismatched trim anchor used to leave
    // `capture_stack_trace` → `crash_handler` → `panic_impl` as the innermost
    // frames of every report, burying the real crash site.
    expect(stdout).not.toContain("capture_stack_trace");
  },
  60_000, // symbolizing the debug binary takes several seconds
);

// `crash()` resets fatal-signal dispositions to SIG_DFL before re-raising so
// that JS-registered listeners (`process.on("SIGABRT")` etc., installed by
// npm's widely-used signal-exit package) cannot swallow the termination. A
// JS listener's backing sigaction enqueues to the JS thread and returns;
// without the reset the process would survive the raise and fall through to
// the trap fallback, which on aarch64 (brk → SIGTRAP) used to spin forever.
test.if(isPosix)(
  "panic terminates the process even when JS registered trap-signal listeners",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `process.on("SIGTRAP", () => {});
         process.on("SIGILL", () => {});
         process.on("SIGABRT", () => {});
         require("bun:internal-for-testing").crash_handler.panic();`,
        // Make debug builds take the fast trace-string path instead of
        // spawning llvm-symbolizer, which can take tens of seconds.
        "--debug-crash-handler-use-trace-string",
      ],
      env: noReportEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Without the fix the child never exits — it loops SIGTRAP delivery on the
    // trap instruction. Bound the wait and fail explicitly rather than hanging
    // the test runner and leaking a core-pinning process.
    const exited = await Promise.race([proc.exited, Bun.sleep(8_000).then(() => "spinning" as const)]);
    if (exited === "spinning") {
      proc.kill("SIGKILL");
    }

    const stderr = await proc.stderr.text();
    expect(exited, `process should have died from the trap, stderr:\n${stderr}`).not.toBe("spinning");

    // It went through the crash handler...
    expect(stderr).toContain("invoked crashByPanic() handler");
    // ...and died from the trap's default action, not a clean exit, and not a
    // JS-observed SIGTRAP (the JS listener must never swallow the crash).
    expect(proc.signalCode === null ? proc.exitCode : proc.signalCode).not.toBe(0);
  },
  20_000,
);

// After printing the crash report the handler must terminate with a signal
// that reflects the crash cause: panics abort (SIGABRT), a caught fault is
// re-raised as the original signal. Previously the handler ended in a trap
// instruction (ud2 → SIGILL on x86_64, brk → SIGTRAP on aarch64) so shells
// reported "illegal hardware instruction" for every crash and parent
// processes could not distinguish a panic from a CPU/codegen fault.
describe.if(isPosix)("terminal signal reflects the crash cause", () => {
  test.each([
    ["panic", "SIGABRT"],
    ["outOfMemory", "SIGABRT"],
    ["segfault", "SIGSEGV"],
    ["abort", "SIGABRT"],
    ["trap", "SIGTRAP"],
  ] as const)("%s terminates with %s", async (approach, expectedSignal) => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        path.join(import.meta.dir, "fixture-crash.js"),
        approach,
        "--debug-crash-handler-use-trace-string",
      ],
      env: noReportEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    if (approach === "segfault") {
      expect(stderr).toContain("Segmentation fault at address");
    } else if (approach === "panic") {
      expect(stderr).toContain("invoked crashByPanic() handler");
    } else if (approach === "abort") {
      expect(stderr).toContain("abort() called");
    } else if (approach === "trap") {
      expect(stderr).toContain("Trap instruction");
    }
    expect(proc.signalCode).toBe(expectedSignal);
    expect(exitCode).not.toBe(0);
    void stdout;
  });
});

// POSIX-only: Windows refuses to remove a directory that is any process's cwd.
describe.if(isPosix)("cwd deleted before startup", () => {
  test.concurrent.each(["install", "test"])("bun %s prints the cwd-deleted hint", async cmd => {
    using dir = tempDir("cwd-unlinked", {});
    const gone = String(dir);

    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", `cd "${gone}" && rmdir "${gone}" && exec "${bunExe()}" '${cmd}'`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "",
      stderr: expect.stringContaining("The current working directory was deleted"),
      exitCode: 1,
    });
    expect(stderr).not.toContain("Bun could not find a file");
  });

  test.concurrent("bun -e boots via the exe-dir fallback instead", async () => {
    using dir = tempDir("cwd-unlinked-run", {});
    const gone = String(dir);

    await using proc = Bun.spawn({
      cmd: ["/bin/sh", "-c", `cd "${gone}" && rmdir "${gone}" && exec "${bunExe()}" -e 'console.log(1)'`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("1\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});

// Windows: the VEH handler must walk the stack from the fault CONTEXT record
// (RtlVirtualUnwind), not from inside the handler. When the fault is in an
// external DLL the old RtlCaptureStackBackTrace path could stop at
// KiUserExceptionDispatcher on some Windows versions, leaving only the
// handler's own frames in the trace and none of the bun callers.
test.if(isWindows && isDebug)("Windows: segfault inside a system DLL captures the bun callers", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "fixture-crash.js"), "segfaultInDll"],
    env: noReportEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("Segmentation fault at address 0xDEADBEEF");
  expect(exitCode).not.toBe(0);

  // The debug build's fallback printer emits one `???:?:?: 0x<addr>` line per
  // captured frame. A walk seeded from the fault CONTEXT reaches through the
  // DLL into the bun call chain (the JS host-fn dispatch is several frames
  // deep), so a short trace means the unwind stopped at the exception
  // dispatcher and the handler's own frames are all that was captured.
  const frameAddrs = [...stderr.matchAll(/: (0x[0-9a-f]{6,}) in /gi)].map(m => BigInt(m[1]));
  expect(frameAddrs.length).toBeGreaterThanOrEqual(7);

  // Frame 0 is the fault PC inside ntdll.dll; frames 1+ must be the bun call
  // chain with no handler or ntdll-dispatch frames interleaved. Frames 1..6 all
  // coming from one image means their address span fits inside that image's
  // mapped range; the old RtlCaptureStackBackTrace path left
  // [handler x3][ntdll-dispatch x3] ahead of the first real caller, so frames
  // 4-6 landed in ntdll and the span covered the >10 GiB gap between the EXE
  // and system-DLL HEASLR regions.
  const callers = frameAddrs.slice(1, 7);
  const span = callers.reduce((a, b) => (a > b ? a : b)) - callers.reduce((a, b) => (a < b ? a : b));
  expect(span).toBeLessThan(2n ** 31n);
});

// The Windows crash handler is a Vectored Exception Handler, which sees every
// first-chance exception process-wide before frame-based SEH does. Third-party
// DLLs injected into the process (AV/EDR agents such as BeyondTrust's
// PGHook.dll, virtualization guest tools, shell extensions) routinely raise
// and then handle access violations under SEH as part of normal operation.
// The VEH must let those through rather than treating them as a fatal crash.
// `IsBadReadPtr` is the canonical example: it probes its argument inside a
// `__try`/`__except` in kernel32, so the AV it raises is inside a system DLL
// and is immediately swallowed by that DLL's own SEH.
//
// See https://github.com/oven-sh/bun/issues/10056 (Carbon Black),
// https://github.com/oven-sh/bun/issues/11898 (Trend Micro).
describe.if(isWindows)("Windows VEH handler and first-chance faults in external DLLs", () => {
  test("SEH-guarded probe survives", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { dlopen } = require("bun:ffi");
         const lib = dlopen("kernel32.dll", {
           IsBadReadPtr: { args: ["usize", "usize"], returns: "i32" },
         });
         const rc = lib.symbols.IsBadReadPtr(0xE8, 8);
         console.log("SURVIVED rc=" + rc);`,
      ],
      env: noReportEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("Segmentation fault");
    // rc=1: kernel32's SEH caught the AV and reported the pointer as bad.
    expect(stdout.trim()).toBe("SURVIVED rc=1");
    expect(exitCode).toBe(0);
  });

  // `RtlFillMemory` has no `__try`/`__except` around its store. With the VEH
  // now returning CONTINUE_SEARCH for out-of-image PCs, the catch point is
  // JSC's jscJITSEHHandler (registered for JIT frames), which routes to
  // Bun__crashHandlerFromJSCFrame, or UEF. This exercises that the crash is
  // still reported and the report carries the fault address.
  test("unguarded fault still crash-reports", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "--debug-crash-handler-use-trace-string",
        "-e",
        `const { dlopen } = require("bun:ffi");
         const lib = dlopen("ntdll.dll", {
           RtlFillMemory: { args: ["usize", "usize", "i32"], returns: "void" },
         });
         lib.symbols.RtlFillMemory(0xE8, 8, 0);
         console.log("SHOULD NOT REACH");`,
      ],
      env: noReportEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("Segmentation fault at address 0xE8");
    expect(stdout).not.toContain("SHOULD NOT REACH");
    expect(exitCode).not.toBe(0);
  });

  // Validate WebKit's registerJITUnwindInfo against the actual unwinder:
  // RtlLookupFunctionEntry must return a RUNTIME_FUNCTION for a JIT pool PC.
  // This is the smoke test for the hand-encoded UNWIND_INFO / .xdata bytes.
  // LLInt PCs are not covered here: LLInt lives in image .text and Windows
  // only consults static .pdata for in-module PCs; that needs build-time
  // .seh_* emission in offlineasm (follow-up).
  test("RtlLookupFunctionEntry resolves JSC JIT pool PCs", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { dlopen, FFIType, ptr } = require("bun:ffi");
         const { symbols } = dlopen("ntdll.dll", {
           RtlLookupFunctionEntry: {
             args: [FFIType.u64, FFIType.pointer, FFIType.pointer],
             returns: FFIType.pointer,
           },
         });
         const { jscInternals } = require("bun:internal-for-testing");
         const pool = jscInternals.startOfFixedExecutableMemoryPool();
         const imageBase = new BigUint64Array(1);
         const jitEntry = symbols.RtlLookupFunctionEntry(pool + 0x100n, ptr(imageBase), null);
         console.log(JSON.stringify({
           pool: pool.toString(16),
           jitEntry: jitEntry === null ? "null" : "ok",
         }));`,
      ],
      env: noReportEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const out = JSON.parse(stdout.trim());
    expect(out.jitEntry).toBe("ok");
    expect(exitCode).toBe(0);
  });

  // End-to-end: warm a JS function into the JIT, then fault from inside it
  // via FFI. The crash report must fire via jscJITSEHHandler at the JIT
  // boundary. Clears the UEF backstop first so the assertion isolates the JSC
  // handler (deleting setJITExceptionHandlerWin would break this test, not
  // just fall through to UEF). Disables the concurrent JIT so warm-up is
  // deterministic.
  test("unguarded fault from inside a JIT-compiled frame still crash-reports via the JSC handler", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "--debug-crash-handler-use-trace-string",
        "-e",
        `const { dlopen } = require("bun:ffi");
         const ntdll = dlopen("ntdll.dll", {
           RtlFillMemory: { args: ["usize", "usize", "i32"], returns: "void" },
         });
         const k32 = dlopen("kernel32.dll", {
           SetUnhandledExceptionFilter: { args: ["usize"], returns: "usize" },
         });
         function hot(i) {
           if (i === 10000) ntdll.symbols.RtlFillMemory(0xE8, 8, 0);
           return i;
         }
         for (let i = 0; i < 10000; i++) hot(i);
         k32.symbols.SetUnhandledExceptionFilter(0);
         hot(10000);
         console.log("SHOULD NOT REACH");`,
      ],
      env: { ...noReportEnv, BUN_JSC_jitPolicyScale: "0", BUN_JSC_useConcurrentJIT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("Segmentation fault at address 0xE8");
    expect(stdout).not.toContain("SHOULD NOT REACH");
    expect(exitCode).not.toBe(0);
  });
});

test.if(process.platform === "darwin")("macOS has the assumed image offset", () => {
  // If this fails, then https://bun.report will be incorrect and the stack
  // trace remappings will stop working.
  expect(getMachOImageZeroOffset()).toBe(0x100000000);
});

test("raise ignoring panic handler does not trigger the panic handler", async () => {
  let sent = false;
  const resolve_handler = Promise.withResolvers();

  using server = Bun.serve({
    port: 0,
    fetch(request, server) {
      sent = true;
      resolve_handler.resolve();
      return new Response("OK");
    },
  });

  const proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "fixture-crash.js"), "raiseIgnoringPanicHandler"],
    env: mergeWindowEnvs([
      bunEnv,
      {
        BUN_CRASH_REPORT_URL: server.url.toString(),
        BUN_ENABLE_CRASH_REPORTING: "1",
      },
    ]),
  });

  await proc.exited;

  /// Wait two seconds for a slow http request, or continue immediately once the request is heard.
  await Promise.race([resolve_handler.promise, Bun.sleep(2000)]);

  expect(proc.exited).resolves.not.toBe(0);
  expect(sent).toBe(false);
});

// For children that terminate via SIG_DFL (rather than via a test hook that
// calls suppress_core_dumps_if_necessary()): on the --coredump-upload CI lane
// the runner flags leaked core files as a hard failure. ulimit -c 0 in a shell
// wrapper is inherited by the bun child; every user is isPosix/isLinux-gated
// so /bin/sh is available.
const noCoreCmd = (argv: string[]) => ["/bin/sh", "-c", `ulimit -c 0 && exec "$@"`, "--", ...argv];

// SIGABRT (libc abort(), mimalloc/glibc heap-corruption, std::terminate) and
// SIGTRAP (WTF CRASH()/RELEASE_ASSERT, __builtin_trap() -> `brk` on aarch64)
// must route through the crash handler so they are not silently lost. Outside
// ASAN builds the abort/trap hooks raise the real signal, so these also prove
// the sigaction registration itself.
describe.if(isPosix)("SIGABRT/SIGTRAP are caught by the crash handler", () => {
  test.concurrent.each([
    ["abort", "SIGABRT", "abort() called"],
    ["trap", "SIGTRAP", "Trap instruction"],
  ] as const)("%s produces a crash report", async (approach, expectedSignal, expectedMsg) => {
    let sent = false;
    const resolve_handler = Promise.withResolvers<void>();
    using server = Bun.serve({
      port: 0,
      fetch(request) {
        expect(request.url).toEndWith("/ack");
        sent = true;
        resolve_handler.resolve();
        return new Response("OK");
      },
    });

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        path.join(import.meta.dir, "fixture-crash.js"),
        approach,
        "--debug-crash-handler-use-trace-string",
      ],
      env: mergeWindowEnvs([
        bunEnv,
        {
          BUN_CRASH_REPORT_URL: server.url.toString(),
          BUN_ENABLE_CRASH_REPORTING: "1",
          GITHUB_ACTIONS: undefined,
          CI: undefined,
        },
      ]),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(stderr).toContain(expectedMsg);
    expect(stderr).toContain("oh no");
    expect(stderr).toContain(server.url.toString());
    expect(proc.signalCode).toBe(expectedSignal);
    expect(exitCode).not.toBe(0);

    await resolve_handler.promise;
    expect(sent).toBe(true);
  });

  // process.abort() is a deliberate user action, not a Bun crash. It must still
  // terminate with SIGABRT but must not print a crash report or upload one.
  test.concurrent("process.abort() does not report a crash", async () => {
    let sent = false;
    using server = Bun.serve({
      port: 0,
      fetch() {
        sent = true;
        return new Response("OK");
      },
    });

    await using proc = Bun.spawn({
      cmd: noCoreCmd([bunExe(), "-e", "process.abort()"]),
      env: mergeWindowEnvs([
        bunEnv,
        {
          BUN_CRASH_REPORT_URL: server.url.toString(),
          BUN_ENABLE_CRASH_REPORTING: "1",
          GITHUB_ACTIONS: undefined,
          CI: undefined,
        },
      ]),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stderr] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("Bun has crashed");
    expect(stderr).not.toContain(server.url.toString());
    expect(proc.signalCode).toBe("SIGABRT");
    expect(sent).toBe(false);
  });
});

// The crash handler is registered for SIGSEGV/SIGBUS/SIGILL/SIGFPE/SIGABRT/
// SIGTRAP, but one of those arriving from kill(2) (`kill -SEGV`, a timeout
// tool sending SIGABRT, `process.kill(process.pid, child.signal)` mirroring a
// child's death) is not a fault in Bun. It has to die from the signal exactly
// like a process without a handler (and like Node) does: no report, no upload.
// Linux only: the handler tells the two apart with si_code, which only Linux
// defines usefully (see was_sent_with_kill in src/crash_handler/lib.rs).
describe.if(isLinux)("fatal signals sent with kill(2) are not reported as crashes", () => {
  const handledSignals = ["SIGSEGV", "SIGBUS", "SIGILL", "SIGFPE", "SIGABRT", "SIGTRAP"] as const;

  // Real deliveries need the sigaction handler, which ASAN builds leave
  // uninstalled so that ASAN's own fault diagnostics stay in charge.
  describe.skipIf(isASAN)("delivered by the kernel", () => {
    test.concurrent("a signal from another process dies silently, reporting enabled", async () => {
      let sent = false;
      using server = Bun.serve({
        port: 0,
        fetch() {
          sent = true;
          return new Response("OK");
        },
      });

      await using proc = Bun.spawn({
        // Keep the event loop alive; "ready" proves startup (and the crash
        // handler's sigaction registration) completed before the kill.
        cmd: noCoreCmd([bunExe(), "-e", `console.log("ready"); setInterval(() => {}, 1 << 30);`]),
        env: mergeWindowEnvs([
          bunEnv,
          {
            BUN_CRASH_REPORT_URL: server.url.toString(),
            BUN_ENABLE_CRASH_REPORTING: "1",
            GITHUB_ACTIONS: undefined,
            CI: undefined,
          },
        ]),
        stdio: ["ignore", "pipe", "pipe"],
      });
      const decoder = new TextDecoder();
      let stdout = "";
      for await (const chunk of proc.stdout) {
        stdout += decoder.decode(chunk, { stream: true });
        if (stdout.includes("ready\n")) break;
      }
      expect(stdout).toBe("ready\n");

      proc.kill("SIGSEGV");
      const [stderr] = await Promise.all([proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(proc.signalCode).toBe("SIGSEGV");
      expect(sent).toBe(false);
    });

    test.concurrent.each(handledSignals)("process.kill(process.pid, %s) dies silently from it", async signal => {
      await using proc = Bun.spawn({
        cmd: noCoreCmd([bunExe(), "-e", `process.kill(process.pid, "${signal}")`]),
        env: noReportEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const [stderr] = await Promise.all([proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(proc.signalCode).toBe(signal);
    });
  });

  // Same handler body, fed a chosen si_code through the test hook, so the
  // classification is covered in ASAN builds as well. Values are the Linux
  // ones from sigaction(2) / <asm-generic/siginfo.h>.
  describe("classified by si_code", () => {
    const SI_USER = 0; // kill(2)
    const SI_QUEUE = -1; // sigqueue(3)
    const SI_TKILL = -6; // tgkill(2): how glibc and musl deliver abort() and raise()
    const SI_KERNEL = 0x80; // kernel-raised without a more specific code, e.g. int3 -> SIGTRAP on x86_64
    const SEGV_MAPERR = 1; // access to an unmapped address
    const BUS_ADRERR = 2; // access to a nonexistent physical address, e.g. past the end of a truncated mmap'd file

    const runHook = async (signal: (typeof handledSignals)[number], siCode: number) => {
      await using proc = Bun.spawn({
        cmd: noCoreCmd([
          bunExe(),
          "-e",
          `require("bun:internal-for-testing").crash_handler.handlePosixSignal(${osConstants.signals[signal]}, ${siCode})`,
          "--debug-crash-handler-use-trace-string",
        ]),
        env: noReportEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const [stderr] = await Promise.all([proc.stderr.text(), proc.exited]);
      return { stderr, signalCode: proc.signalCode };
    };

    test.concurrent.each([
      ["SIGSEGV", "SI_USER", SI_USER],
      ["SIGBUS", "SI_USER", SI_USER],
      ["SIGILL", "SI_USER", SI_USER],
      ["SIGFPE", "SI_USER", SI_USER],
      ["SIGABRT", "SI_USER", SI_USER],
      ["SIGTRAP", "SI_USER", SI_USER],
      ["SIGSEGV", "SI_QUEUE", SI_QUEUE],
      ["SIGABRT", "SI_QUEUE", SI_QUEUE],
    ] as const)("%s with %s dies silently from the signal", async (signal, _name, siCode) => {
      expect(await runHook(signal, siCode)).toEqual({ stderr: "", signalCode: signal });
    });

    test.concurrent.each([
      ["SIGABRT", "SI_TKILL", SI_TKILL, "abort() called"],
      ["SIGSEGV", "SEGV_MAPERR", SEGV_MAPERR, "Segmentation fault at address 0xDEADBEEF"],
      ["SIGBUS", "BUS_ADRERR", BUS_ADRERR, "Bus error at address 0xDEADBEEF"],
      ["SIGTRAP", "SI_KERNEL", SI_KERNEL, "Trap instruction at address 0xDEADBEEF"],
    ] as const)("%s with %s is still reported as a crash", async (signal, _name, siCode, message) => {
      const { stderr, signalCode } = await runHook(signal, siCode);
      expect(stderr).toContain(message);
      expect(stderr).toContain("oh no: Bun has crashed");
      expect(signalCode).toBe(signal);
    });
  });
});

describe("automatic crash reporter", () => {
  for (const approach of ["panic", "segfault", "outOfMemory"]) {
    test(`${approach} should report`, async () => {
      let sent = false;
      const resolve_handler = Promise.withResolvers();

      // Self host the crash report backend.
      using server = Bun.serve({
        port: 0,
        fetch(request, server) {
          expect(request.url).toEndWith("/ack");
          sent = true;
          resolve_handler.resolve();
          return new Response("OK");
        },
      });

      const proc = Bun.spawn({
        cmd: [bunExe(), path.join(import.meta.dir, "fixture-crash.js"), approach],
        env: mergeWindowEnvs([
          bunEnv,
          {
            BUN_CRASH_REPORT_URL: server.url.toString(),
            BUN_ENABLE_CRASH_REPORTING: "1",
            GITHUB_ACTIONS: undefined,
            CI: undefined,
          },
        ]),
        stdio: ["ignore", "pipe", "pipe"],
      });
      const exitCode = await proc.exited;
      const stderr = await proc.stderr.text();
      console.log(stderr);

      await resolve_handler.promise;

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain(server.url.toString());
      if (approach !== "outOfMemory") {
        expect(stderr).toContain("oh no: Bun has crashed. This indicates a bug in Bun, not your code");
      } else {
        expect(stderr.toLowerCase()).toContain("out of memory");
        expect(stderr.toLowerCase()).not.toContain("panic");
      }
      expect(sent).toBe(true);
    });
  }
});

test.if(isWindows)(
  "Windows: crash report upload runs the system PowerShell, not a powershell.exe in the working directory",
  async () => {
    let sent = false;
    const acked = Promise.withResolvers<void>();

    using server = Bun.serve({
      port: 0,
      fetch(request) {
        expect(request.url).toEndWith("/ack");
        sent = true;
        acked.resolve();
        return new Response("OK");
      },
    });

    // Not `using`: the crash reporter's PowerShell child inherits this cwd
    // and can outlive the crashed process, so a scoped delete races it.
    const dir = tempDir("crash-report-system-powershell", { "placeholder.js": "" });
    try {
      await Bun.write(path.join(String(dir), "powershell.exe"), Bun.file(bunExe()));

      await using proc = Bun.spawn({
        cmd: [bunExe(), path.join(import.meta.dir, "fixture-crash.js"), "panic"],
        cwd: String(dir),
        env: mergeWindowEnvs([
          bunEnv,
          {
            BUN_CRASH_REPORT_URL: server.url.toString(),
            BUN_ENABLE_CRASH_REPORTING: "1",
            GITHUB_ACTIONS: undefined,
            CI: undefined,
          },
        ]),
        stdio: ["ignore", "pipe", "pipe"],
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

      /// Wait two seconds for a slow http request, or continue immediately once the request is heard.
      await Promise.race([acked.promise, Bun.sleep(2000)]);

      expect(stderr).toContain(server.url.toString());
      expect(sent).toBe(true);
      expect(exitCode).not.toBe(0);
    } finally {
      try {
        rmSync(String(dir), { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
      } catch {}
    }
  },
);
