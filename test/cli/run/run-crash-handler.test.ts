import { crash_handler } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isPosix, isWindows, mergeWindowEnvs, tempDir } from "harness";
import { existsSync, rmSync } from "node:fs";
import { constants as osConstants } from "node:os";
import path from "path";
const { getMachOImageZeroOffset } = crash_handler;

// CI sets BUN_CRASH_REPORT_URL so unexpected crashes are captured; these
// deliberate crashes must not upload there or the runner pins them on the
// next unrelated failing test as "crash reported" and blocks its retries.
const noReportEnv = { ...bunEnv, BUN_CRASH_REPORT_URL: "", BUN_ENABLE_CRASH_REPORTING: "0" };

// For children that die via SIG_DFL (rather than via a test hook that calls
// suppress_core_dumps_if_necessary()): on the --coredump-upload CI lane the
// runner flags leaked core files as a hard failure. ulimit -c 0 in a shell
// wrapper is inherited by the bun child (and by anything it spawns); every
// user is isPosix-gated so /bin/sh is available.
const noCoreCmd = (argv: string[]) => ["/bin/sh", "-c", `ulimit -c 0 && exec "$@"`, "--", ...argv];

// On Linux, debug builds symbolize crash traces by spawning llvm-symbolizer;
// without it the fallback printer has no Rust symbol names to assert on.
const hasSymbolizer = !!(Bun.which("llvm-symbolizer") || Bun.which("llvm-symbolizer-23"));

// Compiles the LD_PRELOAD shim of the native stack overflow tests.
const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

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

// A native stack overflow faults on the guard page, so the kernel can only run
// a signal handler on an alternate signal stack. Two things used to break that:
// JSC's VM initialization re-registers SIGSEGV/SIGBUS for the JIT without
// SA_ONSTACK, and only the main thread had a sigaltstack. Every native
// recursion that lost its stack, on any thread, died with the default action:
// exit 139 and nothing on stderr.
//
// Under ASAN bun leaves SIGSEGV to the sanitizer, which chains behind JSC's
// handler and prints its own stack-overflow report.
describe.if(isPosix)("native stack overflow is reported", () => {
  const expected = isASAN ? "AddressSanitizer: stack-overflow" : "Stack overflow";
  // The one-line ASAN report is enough; symbolizing its frames takes seconds.
  const env = { ...noReportEnv, ASAN_OPTIONS: [noReportEnv.ASAN_OPTIONS, "symbolize=0"].filter(Boolean).join(":") };

  // The CI agents run with `ulimit -s unlimited`, where the main thread's stack
  // grows until it exhausts memory instead of hitting a guard page. Give the
  // child the usual 8 MiB so the overflow is a fault, not an OOM kill.
  test.concurrent("on the main thread", async () => {
    await using proc = Bun.spawn({
      cmd: [
        "/bin/sh",
        "-c",
        'ulimit -s 8192; exec "$0" "$@"',
        bunExe(),
        path.join(import.meta.dir, "fixture-crash.js"),
        "stackOverflow",
        "--debug-crash-handler-use-trace-string",
      ],
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(stderr).toContain(expected);
    if (!isASAN) {
      expect(stderr).toContain("panic(main thread): Stack overflow");
      expect(proc.signalCode).toBe("SIGSEGV");
    }
    expect(exitCode).not.toBe(0);
  });

  test.concurrent("on a worker thread", async () => {
    using dir = tempDir("stack-overflow-worker", {
      "main.js": `
        const worker = new Worker(new URL("./worker.js", import.meta.url).href, { name: "deep" });
        worker.onerror = e => console.error("worker error: " + e.message);
      `,
      "worker.js": `
        require("bun:internal-for-testing").crash_handler.stackOverflow();
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--debug-crash-handler-use-trace-string", "main.js"],
      env,
      cwd: String(dir),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(stderr).toContain(expected);
    if (!isASAN) {
      expect(stderr).toContain("panic(deep): Stack overflow");
      expect(proc.signalCode).toBe("SIGSEGV");
    }
    expect(exitCode).not.toBe(0);
  });

  // No input overflows the native stack in these two places, so a preloaded
  // library does it: in exit() and quick_exit(), or when the named thread asks
  // for its stack bounds, which JSC does on every thread that runs it.
  describe.if(isLinux && !!cc)("with a preloaded library that overflows the stack", () => {
    let shimDir: ReturnType<typeof tempDir> | undefined;
    let preload: typeof env;

    beforeAll(async () => {
      shimDir = tempDir("stack-overflow-shim", {
        "overflow.c": /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <pthread.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/resource.h>

static unsigned long recurse(unsigned long depth) {
  volatile char frame[1024];
  frame[depth % sizeof(frame)] = (char)depth;
  return recurse(depth + 1) + frame[0];
}

static void overflow(void) {
  struct rlimit core = {0, 0};
  setrlimit(RLIMIT_CORE, &core);
  /* An unlimited main thread stack (the CI agents) grows until memory runs out. */
  struct rlimit stack;
  if (getrlimit(RLIMIT_STACK, &stack) == 0 && stack.rlim_cur > (8 << 20)) {
    stack.rlim_cur = 8 << 20;
    setrlimit(RLIMIT_STACK, &stack);
  }
  recurse(0);
}

void exit(int code) {
  if (getenv("OVERFLOW_AT_EXIT")) overflow();
  ((void (*)(int))dlsym(RTLD_NEXT, "exit"))(code);
  abort();
}

void quick_exit(int code) {
  if (getenv("OVERFLOW_AT_EXIT")) overflow();
  ((void (*)(int))dlsym(RTLD_NEXT, "quick_exit"))(code);
  abort();
}

int pthread_getattr_np(pthread_t thread, pthread_attr_t *attr) {
  const char *target = getenv("OVERFLOW_ON_THREAD");
  char name[16] = {0};
  if (target && prctl(PR_GET_NAME, name) == 0 && strcmp(name, target) == 0) overflow();
  return ((int (*)(pthread_t, pthread_attr_t *))dlsym(RTLD_NEXT, "pthread_getattr_np"))(thread, attr);
}
`,
      });
      const shim = path.join(String(shimDir), "overflow.so");
      await using compile = Bun.spawn({
        cmd: [cc!, "-shared", "-fPIC", "-o", shim, path.join(String(shimDir), "overflow.c"), "-ldl"],
        env: bunEnv,
        stdio: ["ignore", "ignore", "pipe"],
      });
      const [errors, exitCode] = await Promise.all([compile.stderr.text(), compile.exited]);
      if (exitCode !== 0) throw new Error(`shim compile failed: ${errors}`);
      preload = { ...env, LD_PRELOAD: [shim, env.LD_PRELOAD].filter(Boolean).join(":") };
    });

    afterAll(() => {
      shimDir?.[Symbol.dispose]();
    });

    // `bun build` creates no global object. With `--bytecode` its first JSC VM
    // is the one that generates the bytecode.
    test.concurrent("after `bun build --bytecode` created the first VM", async () => {
      using dir = tempDir("stack-overflow-bytecode", {
        "entry.js": `console.log("hello");`,
      });
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "--debug-crash-handler-use-trace-string",
          "--bytecode",
          "--target=bun",
          "--outdir=out",
          "entry.js",
        ],
        env: { ...preload, OVERFLOW_AT_EXIT: "1" },
        cwd: String(dir),
        stdio: ["ignore", "pipe", "pipe"],
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

      expect(stderr).toContain(expected);
      // The bytecode is on disk, so its VM existed when the process exited.
      expect(existsSync(path.join(String(dir), "out", "entry.js.jsc"))).toBe(true);
      if (!isASAN) {
        expect(stderr).toContain("panic(main thread): Stack overflow");
        expect(proc.signalCode).toBe("SIGSEGV");
      }
      expect(exitCode).not.toBe(0);
    });

    // The compile cache generates its bytecode on a thread of its own.
    test.concurrent("on the compile cache thread", async () => {
      using dir = tempDir("stack-overflow-compile-cache", {
        "main.cjs": `console.log("hello");`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--debug-crash-handler-use-trace-string", "main.cjs"],
        env: {
          ...preload,
          NODE_COMPILE_CACHE: path.join(String(dir), "cache"),
          OVERFLOW_ON_THREAD: "BunCompileCache",
        },
        cwd: String(dir),
        stdio: ["ignore", "pipe", "pipe"],
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toContain(expected);
      expect(stdout).toBe("hello\n");
      if (!isASAN) {
        expect(stderr).toContain("panic(BunCompileCache): Stack overflow");
        expect(proc.signalCode).toBe("SIGSEGV");
      }
      expect(exitCode).not.toBe(0);
    });
  });

  // A fault close to the stack pointer is not always an overflow. An overflow
  // is a data access in the frame being entered, so an instruction fetch and an
  // access above the frame pointer keep the segmentation fault report and its
  // address. Linux: the addresses come from /proc/self/maps.
  describe.if(isLinux && !isASAN)("a fault near the stack pointer that is not an overflow keeps its address", () => {
    const prelude = `
      const { CFunction, read } = require("bun:ffi");
      const maps = require("fs").readFileSync("/proc/self/maps", "utf8").split("\\n").filter(Boolean)
        .map(line => ({ start: Number("0x" + line.split("-")[0]), end: Number("0x" + line.split(/[- ]/)[1]), name: line }));
      const stack = maps.find(m => m.name.endsWith("[stack]"));
      let past = stack.end;
      for (let next; (next = maps.find(m => m.start === past)); ) past = next.end;
      const crashAt = (address, crash) => {
        require("fs").writeSync(1, address.toString(16).toUpperCase());
        crash(address);
      };
    `;

    test.concurrent.each([
      [
        "a call through a pointer into the stack",
        `crashAt(stack.end - 4096, ptr => new CFunction({ ptr, args: [], returns: "void" })());`,
      ],
      ["a read past the top of the stack", `crashAt(past, ptr => read.u8(ptr, 0));`],
    ])("%s", async (_, crash) => {
      await using proc = Bun.spawn({
        cmd: noCoreCmd([bunExe(), "--debug-crash-handler-use-trace-string", "-e", prelude + crash]),
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const [address, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(address).toMatch(/^[0-9A-F]+$/);
      expect(stderr).toContain(`panic(main thread): Segmentation fault at address 0x${address}\n`);
      expect(proc.signalCode).toBe("SIGSEGV");
      expect(exitCode).not.toBe(0);
    });
  });
});

// JSC turns an out-of-bounds WebAssembly access into a RuntimeError in its
// SIGSEGV/SIGBUS handler. On a thread that has an alternate signal stack, that
// handler runs on it.
describe("an out-of-bounds WebAssembly access throws", () => {
  const fixture = `
    // (module (memory 1) (func (export "load") (param i32) (result i32) local.get 0 i32.load))
    const bytes = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x06, 0x01, 0x60, 0x01, 0x7f, 0x01, 0x7f,
      0x03, 0x02, 0x01, 0x00, 0x05, 0x03, 0x01, 0x00, 0x01, 0x07, 0x08, 0x01, 0x04, 0x6c, 0x6f, 0x61,
      0x64, 0x00, 0x00, 0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x28, 0x02, 0x00, 0x0b,
    ]);
    function run() {
      const { load } = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports;
      let thrown = 0;
      for (let i = 0; i < ${isDebug || isASAN ? 300 : 20000}; i++) {
        try {
          load(0x7ffffff0);
        } catch (e) {
          if (e instanceof WebAssembly.RuntimeError) thrown++;
        }
      }
      return thrown;
    }
    if (!Bun.isMainThread) {
      postMessage(run());
    } else if (process.argv[2] === "worker") {
      const worker = new Worker(import.meta.url);
      worker.onmessage = e => {
        console.log(JSON.stringify([run(), e.data]));
        worker.terminate();
      };
    } else {
      console.log(JSON.stringify([run()]));
    }
  `;
  const all = isDebug || isASAN ? 300 : 20000;

  test.concurrent("on the main thread and in a Worker", async () => {
    using dir = tempDir("wasm-out-of-bounds", { "fault.js": fixture });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "fault.js", "worker"],
      env: bunEnv,
      cwd: String(dir),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual([all, all]);
    expect(exitCode).toBe(0);
  });

  // The profiler holds a lock that the handler waits for, while it suspends the thread.
  test.concurrent("while the sampling profiler suspends the thread", async () => {
    using dir = tempDir("wasm-out-of-bounds", { "fault.js": fixture });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--cpu-prof", "--cpu-prof-interval=250", "fault.js"],
      env: bunEnv,
      cwd: String(dir),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual([all]);
    expect(exitCode).toBe(0);
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
