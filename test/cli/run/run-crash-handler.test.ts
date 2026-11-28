import { CString, dlopen, type Pointer } from "bun:ffi";
import { crash_handler } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  bunEnv,
  bunExe,
  compileFixture,
  isArm64,
  isASAN,
  isDebug,
  isGlibc,
  isLinux,
  isMacOS,
  isPosix,
  isWindows,
  libcPathForDlopen,
  mergeWindowEnvs,
  tempDir,
} from "harness";
import { copyFileSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { constants as osConstants } from "node:os";
import path from "path";
import { without } from "../../aot/harness/capabilities";
import { withoutCoreDump } from "../../aot/harness/commands";
import { unsupported } from "../../aot/harness/compiler";
import { run } from "../../aot/harness/run";
const { getMachOImageZeroOffset } = crash_handler;

// CI sets BUN_CRASH_REPORT_URL so unexpected crashes are captured; these
// deliberate crashes must not upload there or the runner pins them on the
// next unrelated failing test as "crash reported" and blocks its retries.
const noReportEnv = { ...bunEnv, BUN_CRASH_REPORT_URL: "", BUN_ENABLE_CRASH_REPORTING: "0" };

// On Linux, debug builds symbolize crash traces by spawning llvm-symbolizer;
// without it the fallback printer has no Rust symbol names to assert on.
const hasSymbolizer = !!(Bun.which("llvm-symbolizer") || Bun.which("llvm-symbolizer-23"));

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
    // `panic` test hook)...
    const firstFrame = stdout.split("\n").find(line => line.trim().length > 0);
    expect(firstFrame ?? "<no frames printed>").toContain("crash_handler_jsc::panic");

    // ...not the capture machinery. A mismatched trim anchor used to leave
    // `capture_stack_trace` → `crash_handler` → `panic_impl` as the innermost
    // frames of every report, burying the real crash site.
    expect(stdout).not.toContain("capture_stack_trace");
  },
  60_000, // symbolizing the debug binary takes several seconds
);

// Read as it is, a return address that -mbranch-protection=pac-ret signed is the address of nothing.
const hasPointerAuthentication = isLinux && isArm64 && /\bpaca\b/.test(readFileSync("/proc/cpuinfo", "utf8"));
test.if(hasPointerAuthentication)("a stack trace takes the signature off a return address", () => {
  expect(crash_handler.stackTraceStartsAtSignedReturnAddress()).toBe(true);
});

// The program finds the return addresses that `descend` has left on the stack and changes the bits where a signature goes.
describe.if(hasPointerAuthentication && !isASAN && !unsupported)("signed return addresses of compiled code", () => {
  const program = `import { read, toArrayBuffer } from "bun:ffi";
import { readFileSync } from "node:fs";

const mappings = readFileSync("/proc/self/maps", "utf8")
  .trim()
  .split("\\n")
  .map(line => ({ line, range: line.split(/[- ]/, 2).map(digits => parseInt(digits, 16)) }));
const [start, end] = mappings.find(({ line }) => line.endsWith("[stack]"))!.range;
const code = mappings.filter(({ line }) => / ..x. /.test(line)).map(({ range }) => range);
const halves = new Uint32Array(toArrayBuffer(start as never, 0, end - start));
const before = halves.slice();

function lowest(how: string): number {
  const places = new Map<number, number[]>();
  for (let at = 0; at < halves.length; at += 2) {
    const address = (halves[at + 1] & 0xffff) * 2 ** 32 + halves[at];
    if (halves[at] !== before[at] && code.some(([from, to]) => address >= from && address < to))
      places.getOrInsert(address, []).push(at);
  }
  // What deeper calls have left behind lies below.
  const row = [...places.values()].findLast(row => row.length >= 4)!;
  for (let index = 0; index < row.length; index++) {
    if (how === "wiped") halves[row[index]] = halves[row[index] + 1] = 0;
    else if (how !== "plain") halves[row[index] + 1] ^= 0x500000;
  }
  return how === "returned to" ? 0 : read.u8(8 as never) + 1;
}

function descend(left: number): number {
  return left ? descend(left - 1) + 1 : lowest(process.argv[2]);
}

console.log(descend(process.argv.length + 9));
`;
  const callers = [...Array(12).fill("at descend (./app.ts:30:17)"), "at ./app.ts:33:13"];
  let dir: ReturnType<typeof tempDir>;

  beforeAll(async () => {
    dir = tempDir("signed-return-addresses", { "app.ts": program });
    const cmd = [bunExe(), "build", "--compile", "--aot", "app.ts", "--outfile", "app"];
    const { stderr, exitCode } = await run(cmd, String(dir));
    expect({ stderr, exitCode }).toEqual({ stderr: expect.not.stringMatching(/^error\b/m), exitCode: 0 });
  }, 60_000);
  afterAll(() => dir?.[Symbol.dispose]());

  async function crashed(how: string) {
    const cmd = withoutCoreDump([path.join(String(dir), "app"), how]);
    const { stdout, stderr, exitCode } = await run(cmd, String(dir), noReportEnv, 20_000);
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 128 + osConstants.signals.SIGSEGV });
    return { stderr, frames: stderr.match(/(?<=^ +)at .*/gm) };
  }

  test.each(["plain", "signed"])("every caller is named: %s", async how => {
    expect((await crashed(how)).frames).toEqual(["at lowest (./app.ts:26:43)", ...callers]);
  });

  test("the report reads the words that the program finds", async () => {
    const { frames } = await crashed("wiped");
    expect(frames![0]).toBe("at lowest (./app.ts:26:43)");
    expect(frames!.length).toBeLessThan(callers.length / 2);
  });

  // This is how a failed authentication ends without FEAT_FPAC. A hardened build authenticates here itself.
  test.if(!!without("a hardened build"))(
    "a return that faults names the place, and gives no address away",
    async () => {
      const { stderr, frames } = await crashed("returned to");
      expect(frames).toEqual(callers);
      expect(stderr).toMatch(/ x30=code\+0x\w+ sp=stack\+0x0 pc=code\+0x\w+$/m);
    },
  );
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

// mimalloc provides `operator new` only on Linux without ASAN.
describe.if(isLinux && !isASAN)("operator new that fails to allocate", () => {
  test.concurrent("reports out of memory", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        path.join(import.meta.dir, "fixture-crash.js"),
        "operatorNew",
        "--debug-crash-handler-use-trace-string",
      ],
      env: noReportEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("Bun has run out of memory");
    expect(proc.signalCode).toBe("SIGABRT");
    expect(exitCode).not.toBe(0);
  });

  // `std::stable_sort` retries with half the buffer when this form returns null.
  test.concurrent("returns null from new (std::nothrow)", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `console.log(require("bun:internal-for-testing").crash_handler.operatorNew(true))`],
      env: noReportEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout).toBe("true\n");
    expect(exitCode).toBe(0);
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

test("the trace string ends with the panic message as a zlib stream", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "fixture-crash.js"), "panic", "--debug-crash-handler-use-trace-string"],
    env: noReportEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // "invoked crashByPanic() handler"
  expect(stderr).toMatch(/A0eNrLzCvLz05NUUguSizOcKoMSMzLTNbQVMhIzEvJSS0CAK\/LCxc(\/view)?\s/);
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

  await expect(proc.exited).resolves.not.toBe(0);
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

// A preloaded shim fails the syscall. The `ulimit -n` value that makes the loop fail first differs between builds.
const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
describe.skipIf(!isGlibc || !cc)("out of file descriptors while creating the event loop", () => {
  const shim = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <stdlib.h>
#include <string.h>

static int should_fail(const char *name) {
  if (strcmp(getenv("FAIL_LOOP_SYSCALL"), name) != 0) return 0;
  errno = strcmp(getenv("FAIL_LOOP_ERRNO"), "ENFILE") == 0 ? ENFILE : EMFILE;
  return 1;
}

int epoll_create1(int flags) {
  if (should_fail("epoll_create1")) return -1;
  return ((int (*)(int)) dlsym(RTLD_NEXT, "epoll_create1"))(flags);
}

int eventfd(unsigned int initval, int flags) {
  if (should_fail("eventfd")) return -1;
  return ((int (*)(unsigned int, int)) dlsym(RTLD_NEXT, "eventfd"))(initval, flags);
}
`;

  test.concurrent.each([
    ["epoll_create1", "EMFILE", "bun ran out of file descriptors (ProcessFdQuotaExceeded)"],
    ["eventfd", "EMFILE", "bun ran out of file descriptors (ProcessFdQuotaExceeded)"],
    ["eventfd", "ENFILE", "Your computer ran out of file descriptors (SystemFdQuotaExceeded)"],
  ])("%s failing with %s exits 1 with the file descriptor error", async (syscall, errno, message) => {
    using dir = tempDir("loop-init-fd-limit", {
      "shim.c": shim,
      "app.js": "console.log('entry point ran');\n",
    });
    const shimPath = path.join(String(dir), "shim.so");
    const compiled = Bun.spawnSync({
      cmd: [cc!, "-shared", "-fPIC", "-o", shimPath, "shim.c", "-ldl"],
      cwd: String(dir),
      stderr: "pipe",
    });
    expect(compiled.stderr.toString()).toBe("");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "app.js", "--debug-crash-handler-use-trace-string"],
      cwd: String(dir),
      env: { ...noReportEnv, LD_PRELOAD: shimPath, FAIL_LOOP_SYSCALL: syscall, FAIL_LOOP_ERRNO: errno },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout, stderr }).toEqual({ stdout: "", stderr: expect.stringContaining(message) });
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(1);
  });
});

// The frames of a trace string `{base}/{version}/{payload}`, decoded the way
// bun.report's parser decodes them. The payload is the platform, command and
// format characters, 7 characters of commit, two VLQs of feature bits, then
// the frames until a VLQ of 0 ends the list. A frame is a VLQ, an offset in
// bun. A VLQ of 1 comes before the length of a name, the name, and an offset
// in the image of that name. `_` is an unknown frame and `=` is JS. A frame in
// bun's own image decodes with the object `<bun>`: the encoder writes names
// from `[A-Za-z0-9._+-]` only, so no image can decode to that.
function decodeTraceFrames(payload: string): { object: string; address: number }[] {
  const digits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let i = 3 + 7;
  function vlq(): number {
    let value = 0;
    for (let shift = 0; ; shift += 5) {
      const digit = digits.indexOf(payload[i++]);
      if (digit < 0) throw new Error(`bad VLQ digit at ${i - 1} of ${payload}`);
      value += (digit & 31) * 2 ** shift;
      if (!(digit & 32)) return value % 2 ? -Math.floor(value / 2) : value / 2;
    }
  }
  vlq();
  vlq();
  const frames: { object: string; address: number }[] = [];
  while (i < payload.length) {
    if (payload[i] === "_" || payload[i] === "=") {
      frames.push({ object: payload[i++] === "_" ? "?" : "js", address: 0 });
      continue;
    }
    let address = vlq();
    if (address === 0) return frames;
    let object = "<bun>";
    if (address === 1) {
      const length = vlq();
      object = payload.slice(i, i + length);
      i += length;
      address = vlq();
    }
    frames.push({ object, address });
  }
  throw new Error(`unterminated frame list in ${payload}`);
}

// Runs `cmd`, a bun that crashes, receives the report it uploads, and returns
// the crash's stderr and exit code together with the decoded frames of the
// uploaded trace string.
async function uploadedCrashFrames(cmd: string[], env: Record<string, string> = {}) {
  const uploaded = Promise.withResolvers<string>();
  using server = Bun.serve({
    port: 0,
    fetch(request) {
      uploaded.resolve(new URL(request.url).pathname);
      return new Response("OK");
    },
  });

  await using proc = Bun.spawn({
    cmd,
    env: {
      ...bunEnv,
      ...env,
      BUN_CRASH_REPORT_URL: server.url.origin,
      BUN_ENABLE_CRASH_REPORTING: "1",
      GITHUB_ACTIONS: undefined,
      CI: undefined,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  // The curl that uploads holds the crashed process's stderr, so the upload
  // has arrived by now. A process that died without reporting never uploads:
  // fail with its stderr instead of waiting for the test timeout.
  const pathname = await Promise.race([
    uploaded.promise,
    Bun.sleep(2000).then(() => {
      throw new Error(`no crash report was uploaded; exit code ${exitCode}, stderr:\n${stderr}`);
    }),
  ]);
  // `/` is also a VLQ digit, so the payload cannot be split out on it.
  const payload = pathname.match(/^\/[^/]+\/(.*)\/ack$/)?.[1];
  expect(payload, pathname).toBeDefined();
  return { stderr, exitCode, frames: decodeTraceFrames(payload!) };
}

// A frame outside bun's own executable is encoded with the file name of the
// image it is in, which bun.report shows beside the frame: that is what says
// which native addon or system library a crash went through.
// Not on Windows, where `libcPathForDlopen()` has no answer and there is no
// `dladdr`. Not on FreeBSD and Android, where a report of a fault does not
// start at the fault.
describe.if(isLinux || isMacOS)("the uploaded trace string names the image of a frame outside bun", () => {
  // A library of this test calls back into bun, which faults. The library
  // keeps its frame pointer, so its frame is on the walked stack between
  // bun's. Its file name has bytes that a URL cannot carry as they are, and is
  // longer than the 64 bytes a name keeps.
  const loaderInserts = [["no library", undefined]] as [string, string | undefined][];
  if (isMacOS) loaderInserts.push(["a library", "/usr/lib/libz.1.dylib"]);
  test.if(!!cc).each(loaderInserts)("between bun's frames, with %s inserted by the loader", async (_, inserted) => {
    using dir = tempDir("crash-names-image", {
      "calls back (a library with a long file name that a crash report cuts).c": `
        /* The call is not the last thing it does, so its frame is there while the callback runs. */
        int calls_back(int (*callback)(void)) { return callback() + 1; }
      `,
      "crash.js": `
        const { dlopen, JSCallback } = require("bun:ffi");
        const { crash_handler } = require("bun:internal-for-testing");
        const [library, inserted] = process.argv.slice(2);
        if (inserted && process.env.DYLD_INSERT_LIBRARIES !== inserted) throw new Error("the loader did not insert " + inserted);
        const { calls_back } = dlopen(library, { calls_back: { args: ["function"], returns: "i32" } }).symbols;
        calls_back(new JSCallback(crash_handler.segfault, { args: [], returns: "i32" }).ptr);
      `,
    });
    const library = compileFixture(
      path.join(String(dir), "calls back (a library with a long file name that a crash report cuts).c"),
      { flags: ["-fno-omit-frame-pointer"] },
    );
    const { stderr, exitCode, frames } = await uploadedCrashFrames(
      [bunExe(), path.join(String(dir), "crash.js"), library, ...(inserted ? [inserted] : [])],
      // dyld lists an inserted library before the executable, which must not make bun's frames another image's.
      inserted ? { DYLD_INSERT_LIBRARIES: inserted } : {},
    );

    expect(stderr).toContain("Segmentation fault at address 0xDEADBEEF");

    const name = path.basename(library);
    expect(name.length).toBeGreaterThan(64);
    const objects = frames.map(frame => frame.object);
    const inLibrary = objects.indexOf(name.slice(0, 64).replace(/[^A-Za-z0-9._+-]/g, "_"));
    // The fault is in bun's own code, and the executable is not taken for another image.
    expect(objects[0]).toBe("<bun>");
    expect(inLibrary).toBeGreaterThan(0);

    // The offset is from where the loader put the library, as a symbolizer wants it.
    const { dladdr } = dlopen(libcPathForDlopen(), { dladdr: { args: ["ptr", "ptr"], returns: "i32" } }).symbols;
    const { calls_back } = dlopen(library, { calls_back: { args: ["ptr"], returns: "i32" } }).symbols;
    const info = new BigUint64Array(4);
    expect(dladdr(calls_back.ptr, info)).not.toBe(0);
    expect(path.basename(new CString(Number(info[0]) as Pointer).toString())).toBe(name);
    const inFunction = frames[inLibrary].address - Number(BigInt(calls_back.ptr!) - info[1]);
    expect(inFunction).toBeGreaterThan(0);
    expect(inFunction).toBeLessThan(64);

    expect(exitCode).toBe(128 + osConstants.signals.SIGSEGV);
  });

  // libc's strlen reads from a bad pointer: the fault itself is in another
  // image. Under ASAN bun has no handler for a real fault.
  test.if(!isASAN)("where the fault is", async () => {
    const { stderr, exitCode, frames } = await uploadedCrashFrames(
      // No test hook turns core dumps off for a fault that bun:ffi reaches.
      withoutCoreDump([
        bunExe(),
        "-e",
        `require("bun:ffi").dlopen(${JSON.stringify(libcPathForDlopen())}, { strlen: { args: ["usize"], returns: "usize" } }).symbols.strlen(0xdeadbeef)`,
      ]),
    );

    // strlen may round the pointer down to its alignment.
    expect(stderr).toContain("Segmentation fault at address 0xDEADBEE");
    expect(frames[0].object).toMatch(/\.(so\b|dylib$)/);
    expect(frames[0].address).toBeGreaterThan(0);
    // strlen keeps no frame of its own, so the walk goes on to bun's callers.
    expect(frames.map(frame => frame.object)).toContain("<bun>");
    expect(exitCode).toBe(128 + osConstants.signals.SIGSEGV);
  });

  // A library faults more calls deep than a report has frames. Its file name
  // is of the longest kind that a frame carries, and no frame is left out for
  // that. Under ASAN bun has no handler for a real fault.
  test.if(!!cc && !isASAN)("in every frame of a report, each with the longest name", async () => {
    using dir = tempDir("crash-names-every-frame", {
      "faults deep (a library with a long file name that a crash report cuts).c": `
        int faults_deep(int depth);
        /* The compiler cannot see where this call goes: it stays a call, with a frame. */
        static int (*volatile next)(int) = faults_deep;
        int faults_deep(int depth) {
          if (depth == 0) return *(volatile int *)0xDEADBEEF;
          return next(depth - 1) + 1;
        }
      `,
    });
    const library = compileFixture(
      path.join(String(dir), "faults deep (a library with a long file name that a crash report cuts).c"),
      { flags: ["-fno-omit-frame-pointer"] },
    );
    const { stderr, exitCode, frames } = await uploadedCrashFrames(
      withoutCoreDump([
        bunExe(),
        "-e",
        `require("bun:ffi").dlopen(${JSON.stringify(library)}, { faults_deep: { args: ["i32"], returns: "i32" } }).symbols.faults_deep(40)`,
      ]),
    );

    expect(stderr).toContain("Segmentation fault at address 0xDEADBEEF");
    const name = path.basename(library);
    expect(name.length).toBeGreaterThan(64);
    const object = name.slice(0, 64).replace(/[^A-Za-z0-9._+-]/g, "_");
    expect(frames.map(frame => frame.object)).toEqual(Array(20).fill(object));
    expect(exitCode).toBe(128 + osConstants.signals.SIGSEGV);
  });

  // A standalone executable loads a library that it holds from a file that it
  // writes, and the name of that file has the user's id. Linux alone builds
  // this one: the name is made the same way on every platform.
  test.if(isLinux && !!cc && !isASAN)(
    "without the user's id, where a standalone executable wrote the library",
    async () => {
      using dir = tempDir("crash-names-written-library", {
        "faults.c": `int faults(void) { return *(volatile int *)0xDEADBEEF; }`,
        "app.js": `
          import { dlopen } from "bun:ffi";
          import library from "./faults.so" with { type: "file" };
          dlopen(library, { faults: { args: [], returns: "i32" } }).symbols.faults();
        `,
      });
      const cwd = String(dir);
      copyFileSync(compileFixture(path.join(cwd, "faults.c")), path.join(cwd, "faults.so"));
      const build = await run([bunExe(), "build", "--compile", "app.js", "--outfile", "app"], cwd);
      expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({
        stderr: expect.not.stringMatching(/^error\b/m),
        exitCode: 0,
      });

      using writtenTo = tempDir("crash-names-written-library-tmp", {});
      const { stderr, exitCode, frames } = await uploadedCrashFrames(withoutCoreDump([path.join(cwd, "app")]), {
        BUN_TMPDIR: String(writtenTo),
        TMPDIR: String(writtenTo),
      });

      expect(stderr).toContain("Segmentation fault at address 0xDEADBEEF");
      const userId = process.geteuid!();
      const written = readdirSync(String(writtenTo)).filter(name => name.endsWith(".so"));
      expect(written).toEqual([expect.stringMatching(new RegExp(`^\\.bun-${userId}-[0-9a-f]+\\.so$`))]);
      expect(frames[0].object).toBe(written[0].replace(`-${userId}-`, "-"));
      expect(exitCode).toBe(128 + osConstants.signals.SIGSEGV);
    },
  );
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
