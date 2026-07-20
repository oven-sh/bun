import { crash_handler } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isPosix, mergeWindowEnvs } from "harness";
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
// must route through the crash handler so they are not silently lost.
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

  // The above goes via the internal test hook, which under ASAN calls the
  // handler directly because ASAN owns the fault signals. This case raises the
  // signal for real to prove the sigaction registration itself; ASAN builds
  // never install those handlers so skip there.
  test.skipIf(isASAN).concurrent.each(["SIGABRT", "SIGTRAP"] as const)(
    "raised %s produces a crash report",
    async signal => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", `process.kill(process.pid, "${signal}")`, "--debug-crash-handler-use-trace-string"],
        env: noReportEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const [stderr] = await Promise.all([proc.stderr.text(), proc.exited]);

      expect(stderr).toContain("oh no");
      expect(proc.signalCode).toBe(signal);
    },
  );

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
      cmd: [bunExe(), "-e", "process.abort()"],
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
