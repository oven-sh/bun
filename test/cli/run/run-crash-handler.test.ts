import { crash_handler } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isLinux, isPosix, isWindows, mergeWindowEnvs, tempDir } from "harness";
import { rmSync } from "node:fs";
import { constants as osConstants } from "node:os";
import { inflateSync } from "node:zlib";
import path from "path";
const { getMachOImageZeroOffset } = crash_handler;

// CI sets BUN_CRASH_REPORT_URL so unexpected crashes are captured; these
// deliberate crashes must not upload there or the runner pins them on the
// next unrelated failing test as "crash reported" and blocks its retries.
const noReportEnv = { ...bunEnv, BUN_CRASH_REPORT_URL: "", BUN_ENABLE_CRASH_REPORTING: "0" };

// On Linux, debug builds symbolize crash traces by spawning llvm-symbolizer;
// without it the fallback printer has no Rust symbol names to assert on.
const hasSymbolizer = !!(Bun.which("llvm-symbolizer") || Bun.which("llvm-symbolizer-21"));

const fixture = path.join(import.meta.dir, "fixture-crash.js");

// `panic` calls the crash handler's `panic_impl` directly. `rustPanic` and
// `rustUnwrap` are a real `panic!` and a real `Result::unwrap()` on an `Err`,
// which is how every `.unwrap()` / `assert!` / `unreachable!()` in Bun crashes:
// they reach the crash handler through the `std::panic` hook it installs. The
// literal `panic!` arrives there as a `&'static str` payload; std formats the
// unwrapped `Err` into a `String` payload. All three must print the same report.
const panicApproaches = [
  ["panic", "invoked crashByPanic() handler"],
  ["rustPanic", "invoked crashByRustPanic() handler"],
  ["rustUnwrap", 'called `Result::unwrap()` on an `Err` value: "invoked crashByRustUnwrap() handler"'],
] as const;

// In trace-string mode (release builds, or --debug-crash-handler-use-trace-string)
// the report ends with the trace string on its own line after "please file a
// GitHub issue using the link below:". With noReportEnv's empty base URL it is
// printed as just the path, `/{version}/...`.
function traceStringFromReport(stderr: string): string {
  const traceString = (stderr.split("using the link below:")[1] ?? "").trim().split(/\s+/)[0];
  expect(traceString).toBeTruthy();
  return traceString;
}

// A trace string is `{base}/{version}/{header}{frames...}{VLQ 0}{reason}`. For
// a panic the reason is the tag `0` followed by the zlib-compressed, base64
// message (see `encode_trace_string` in src/crash_handler/lib.rs). The frames
// are variable-length, so find the terminator by trying each `A0` (`A` is the
// VLQ encoding of 0) until the remainder inflates.
function panicMessageFromTraceString(traceString: string): string | undefined {
  const pathname = new URL(traceString, "http://trace.invalid").pathname;
  const payload = pathname.slice(pathname.indexOf("/", 1) + 1);
  for (let i = payload.indexOf("A0"); i !== -1; i = payload.indexOf("A0", i + 1)) {
    try {
      return inflateSync(Buffer.from(payload.slice(i + 2), "base64")).toString();
    } catch {}
  }
  return undefined;
}

test.if(isDebug && isLinux && hasSymbolizer)(
  "crash trace starts at the crash site, not inside the crash handler",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), fixture, "panic"],
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

// For a real Rust panic the innermost frames are std's panic machinery, so the
// crash site is not frame 0, but it must be in the trace and the crash
// handler's own frames must not be.
describe.if(isDebug && isLinux && hasSymbolizer)("Rust panic trace includes the panic site", () => {
  test.each([
    ["rustPanic", "js_rust_panic"],
    ["rustUnwrap", "js_rust_unwrap"],
  ] as const)(
    "%s",
    async (approach, crashSite) => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), fixture, approach],
        env: noReportEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toContain("panic(main thread): ");
      expect(stdout).toContain(crashSite);
      expect(stdout).not.toContain("capture_stack_trace");
      expect(exitCode).not.toBe(0);
    },
    60_000, // symbolizing the debug binary takes several seconds
  );
});

describe("panics through panic_impl and through the std panic hook print the same report", () => {
  test.concurrent.each(panicApproaches)("%s", async (approach, message) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), fixture, approach, "--debug-crash-handler-use-trace-string"],
      env: noReportEnv,
      stdio: ["ignore", "ignore", "pipe"],
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    // Metadata header, e.g. "Bun Debug v1.4.0 (eabb96de7) Linux x64".
    expect(stderr).toMatch(/^Bun (Debug |Canary )?v\d+\.\d+\.\d+/m);
    // The message is reported on its own, with no `file:line:col` suffix.
    expect(stderr).toContain(`panic(main thread): ${message}\n`);
    expect(stderr).toContain("oh no: Bun has crashed. This indicates a bug in Bun, not your code.");
    expect(panicMessageFromTraceString(traceStringFromReport(stderr))).toBe(message);
    expect(exitCode).not.toBe(0);
  });
});

// `--watch` sets `auto_reload_on_crash`, and `crash_handler()` restarts the
// process after it has printed the report. The hook used to end the process
// without checking the flag, so a Rust panic under `--watch` stayed dead while
// a segfault or a `panic_impl` crash restarted.
describe.if(isPosix)("--watch restarts the process after a panic", () => {
  test.concurrent.each(panicApproaches)("%s", async (approach, message) => {
    const proc = Bun.spawn({
      cmd: [bunExe(), "--watch", fixture, approach, "--debug-crash-handler-use-trace-string"],
      env: noReportEnv,
      stdio: ["ignore", "ignore", "pipe"],
    });
    try {
      // The restarted process crashes and restarts again, so stop at the first
      // restart notice instead of waiting for the process to exit.
      const restartNotice = "Bun is auto-restarting due to crash";
      const decoder = new TextDecoder();
      let stderr = "";
      for await (const chunk of proc.stderr) {
        stderr += decoder.decode(chunk, { stream: true });
        if (stderr.includes(restartNotice)) break;
      }

      expect(stderr).toContain(`panic(main thread): ${message}\n`);
      expect(stderr).toContain(restartNotice);
    } finally {
      proc.kill("SIGKILL");
      await proc.exited;
    }
  });
});

// The one thing the panic hook does besides calling the crash handler: a panic
// payload can be arbitrarily long (an `assert_eq!` dump), so it reports at most
// MAX_MESSAGE_BYTES (1024) of it, cut on a char boundary (see `rust_panic_hook`
// in src/crash_handler/lib.rs). `rustPanic(message)` panics with the given
// message, which reaches the hook as a `String` payload.
describe("the panic hook caps the reported message at 1024 bytes", () => {
  const a = (n: number) => Buffer.alloc(n, "a").toString();
  // [name, JS expression the child panics with, what the report must contain]
  test.concurrent.each([
    ["a 1024-byte message is reported whole", `Buffer.alloc(1019, "a") + ":tail"`, `${a(1019)}:tail`],
    ["a longer message is cut after 1024 bytes", `Buffer.alloc(1024, "a") + ":tail"`, a(1024)],
    // Bytes 1023-1024 are one two-byte char; cutting at byte 1024 would split it.
    ["the cut does not split a multi-byte char", `Buffer.alloc(1023, "a") + "\\u00e9"`, a(1023)],
  ])("%s", async (_name, messageExpr, reported) => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `require("bun:internal-for-testing").crash_handler.rustPanic(${messageExpr})`,
        "--debug-crash-handler-use-trace-string",
      ],
      env: noReportEnv,
      stdio: ["ignore", "ignore", "pipe"],
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(stderr.match(/^panic\(main thread\): (.*)$/m)?.[1]).toBe(reported);
    expect(panicMessageFromTraceString(traceStringFromReport(stderr))).toBe(reported);
    expect(exitCode).not.toBe(0);
  });
});

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
  test.concurrent.each([
    ["panic", "SIGABRT", "invoked crashByPanic() handler"],
    ["rustPanic", "SIGABRT", "invoked crashByRustPanic() handler"],
    ["rustUnwrap", "SIGABRT", "called `Result::unwrap()` on an `Err` value"],
    ["outOfMemory", "SIGABRT", "Bun has run out of memory"],
    ["segfault", "SIGSEGV", "Segmentation fault at address"],
    ["abort", "SIGABRT", "abort() called"],
    ["trap", "SIGTRAP", "Trap instruction"],
  ] as const)("%s terminates with %s", async (approach, expectedSignal, expectedMessage) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), fixture, approach, "--debug-crash-handler-use-trace-string"],
      env: noReportEnv,
      stdio: ["ignore", "ignore", "pipe"],
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(stderr).toContain(expectedMessage);
    expect(proc.signalCode).toBe(expectedSignal);
    expect(exitCode).not.toBe(0);
  });
});

// The report header names the CPU features the crash handler detected. On
// x86_64 that detection uses cpuid directly (CPUFeatures.cpp). Every supported
// x64 CPU has SSE4.2 and POPCNT, since the baseline build targets Nehalem.
// AVX is optional. AVX2 and AVX-512 are reported only with AVX, and after it.
test("the crash report lists the CPU features", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "fixture-crash.js"), "panic", "--debug-crash-handler-use-trace-string"],
    env: noReportEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const cpuLine = stderr.split(/\r?\n/).find(line => line.startsWith("CPU: "));
  if (process.arch === "x64") {
    expect(cpuLine).toMatch(/^CPU: sse42 popcnt(?: avx(?: avx2)?(?: avx512)?)?$/);
  } else {
    expect(cpuLine).toMatch(/^CPU: neon fp( \w+)*$/);
  }
  expect(exitCode).not.toBe(0);
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
    cmd: [bunExe(), fixture, "segfaultInDll"],
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
    cmd: [bunExe(), fixture, "raiseIgnoringPanicHandler"],
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

// For children that die via SIG_DFL (rather than via a test hook that calls
// suppress_core_dumps_if_necessary()): on the --coredump-upload CI lane the
// runner flags leaked core files as a hard failure. ulimit -c 0 in a shell
// wrapper is inherited by the bun child (and by anything it spawns); every
// user is isPosix-gated so /bin/sh is available.
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
      cmd: [bunExe(), fixture, approach, "--debug-crash-handler-use-trace-string"],
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

// process.kill() aimed at the process itself with one of the signals the crash
// handler is installed for is, like process.abort(), a request to die from that
// signal. The kernel delivers it inside the kill(2) call, so process._kill has
// to give the signal its default disposition beforehand; otherwise the crash
// handler reports the user's own signal as a Bun crash (and uploads it).
describe.if(isPosix)("process.kill() aimed at the process itself is not reported as a crash", () => {
  const crashHandlerSignals = ["SIGSEGV", "SIGILL", "SIGBUS", "SIGFPE", "SIGABRT", "SIGTRAP"] as const;

  // The value `exited` resolves to for a death by signal: 128 + the platform's
  // number for it. Compared instead of `signalCode`, which Bun currently names
  // with Linux numbering, so on macOS a death from SIGBUS (10 there) reads as
  // "SIGUSR1".
  const diedFrom = (signal: (typeof crashHandlerSignals)[number]) => 128 + osConstants.signals[signal];

  // `detached` puts the child in a process group of its own, so that the
  // process-group forms of kill(2) below cannot reach this test runner.
  async function run(code: string, { detached = false } = {}) {
    await using proc = Bun.spawn({
      cmd: noCoreCmd([bunExe(), "-e", code, "--debug-crash-handler-use-trace-string"]),
      env: noReportEnv,
      stdio: ["ignore", "pipe", "pipe"],
      detached,
    });
    const [stdout, stderr, exited] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode: proc.exitCode, exited };
  }

  test.concurrent.each(crashHandlerSignals)(
    "process.kill(process.pid, %s) dies from the signal silently",
    async signal => {
      expect(await run(`process.kill(process.pid, "${signal}")`)).toEqual({
        stdout: "",
        stderr: "",
        exitCode: null,
        exited: diedFrom(signal),
      });
    },
  );

  // pid 0 is the caller's own process group and -pgid names that group by id
  // (the detached child leads its group, so its pgid is its pid). Both include
  // the caller, so they are self-sent signals as well.
  test.concurrent.each([
    ["process.kill(0, ...)", `process.kill(0, "SIGABRT")`],
    ["process.kill(-pgid, ...)", `process.kill(-process.pid, "SIGABRT")`],
  ])("%s aimed at the process's own group dies from the signal silently", async (_name, code) => {
    expect(await run(code, { detached: true })).toEqual({
      stdout: "",
      stderr: "",
      exitCode: null,
      exited: diedFrom("SIGABRT"),
    });
  });

  test.concurrent("a JS listener for the signal still receives it", async () => {
    expect(
      await run(
        `process.on("SIGABRT", () => { console.log("listener ran"); process.exit(0); });
         process.kill(process.pid, "SIGABRT");
         setInterval(() => {}, 1 << 30);`,
      ),
    ).toEqual({ stdout: "listener ran\n", stderr: "", exitCode: 0, exited: 0 });
  });

  // Sending one of these signals to another process must leave this process's
  // crash handler installed: a real abort afterwards is still reported.
  // (Outside ASAN builds the abort hook raises the real signal.)
  test.concurrent("sending the signal to another process keeps the crash handler installed", async () => {
    const { stdout, stderr, exitCode, exited } = await run(
      `import { crash_handler } from "bun:internal-for-testing";
       const child = Bun.spawn({ cmd: [process.execPath, "-e", "setInterval(() => {}, 1 << 30)"], stdio: ["ignore", "ignore", "ignore"] });
       process.kill(child.pid, "SIGABRT");
       console.log(await child.exited);
       crash_handler.abort();`,
    );
    expect(stdout).toBe(`${diedFrom("SIGABRT")}\n`);
    expect(stderr).toContain("abort() called");
    expect(stderr).toContain("oh no: Bun has crashed");
    expect({ exitCode, exited }).toEqual({ exitCode: null, exited: diedFrom("SIGABRT") });
  });
});

describe("automatic crash reporter", () => {
  const panicMessages = new Map<string, string>(panicApproaches);
  for (const approach of ["panic", "rustPanic", "rustUnwrap", "segfault", "outOfMemory"]) {
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
        cmd: [bunExe(), fixture, approach],
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

      // Assert on the report before waiting for the upload, so a crash that
      // never reports fails here instead of timing out on the promise below.
      const traceString = traceStringFromReport(stderr);
      expect(traceString).toStartWith(server.url.toString());
      if (approach !== "outOfMemory") {
        expect(stderr).toContain("oh no: Bun has crashed. This indicates a bug in Bun, not your code");
      } else {
        expect(stderr.toLowerCase()).toContain("out of memory");
        expect(stderr.toLowerCase()).not.toContain("panic");
      }
      // bun.report shows the panic message it decodes from the trace string,
      // so a real Rust panic must encode its message exactly like panic_impl.
      const panicMessage = panicMessages.get(approach);
      if (panicMessage !== undefined) {
        expect(panicMessageFromTraceString(traceString)).toBe(panicMessage);
      }
      expect(exitCode).not.toBe(0);

      await resolve_handler.promise;
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
        cmd: [bunExe(), fixture, "panic"],
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
