import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// These tests only make sense in a FUZZILLI_ENABLED build, where the
// `fuzzilli()` builtin and the REPRL signal handlers are compiled in.
const isFuzzilliBuild = typeof (globalThis as any).fuzzilli === "function";

// The REPRL flush-on-crash signal handler must not replace ASAN's SIGSEGV
// handler. The Fuzzilli profile runs with allow_user_segv_handler=1, which
// lets signal(SIGSEGV, ...) actually take effect; if our handler overwrites
// ASAN's and re-raises with SIG_DFL, every segfault dies as a bare signal 11
// with empty stderr and no sanitizer report.
test.skipIf(!isFuzzilliBuild)("fuzzilli signal handler preserves ASAN SIGSEGV report", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `fuzzilli("FUZZILLI_CRASH", 5);`],
    env: {
      ...bunEnv,
      // Match the Fuzzilli profile's ASAN options so the interceptor allows
      // user code to install a SIGSEGV handler (the condition for the bug).
      ASAN_OPTIONS:
        "allow_user_segv_handler=1:allocator_may_return_null=1:abort_on_error=1:symbolize=false:detect_leaks=0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("FUZZILLI_CRASH: 5");
  // ASAN must have been allowed to print its DEADLYSIGNAL/SEGV report.
  expect(stderr).toContain("AddressSanitizer");
  expect(stderr).toContain("SEGV");
  // ASAN aborts after reporting; the process must not have died with a raw
  // SIGSEGV (which is what happens when the report is suppressed).
  expect(proc.signalCode).not.toBe("SIGSEGV");
  expect(exitCode).not.toBe(0);
});

// Sanity: heap errors reported by ASAN's allocator hooks must still crash
// and carry a report under the REPRL signal-handler setup.
test.skipIf(!isFuzzilliBuild)("fuzzilli signal handler preserves ASAN heap-use-after-free report", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `fuzzilli("FUZZILLI_CRASH", 4);`],
    env: {
      ...bunEnv,
      ASAN_OPTIONS:
        "allow_user_segv_handler=1:allocator_may_return_null=1:abort_on_error=1:symbolize=false:detect_leaks=0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("FUZZILLI_CRASH: 4");
  expect(stderr).toContain("AddressSanitizer");
  expect(stderr).toContain("heap-use-after-free");
  expect(exitCode).not.toBe(0);
});
