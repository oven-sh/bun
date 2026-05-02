// The fuzzilli REPRL setup installs SIGSEGV/SIGILL/SIGFPE/SIGABRT handlers so
// buffered stdio is flushed before a crash. Those handlers must chain to the
// previously-installed handler (WTF::jscSignalHandler → ASAN) instead of
// re-raising with SIG_DFL, otherwise:
//   • ASAN never prints a report for null derefs / wild accesses, so every
//     signal-based fuzzer crash shows up as a bare "TERMSIG: 11".
//   • JSC's signal-based VMTraps and WASM fault handling are broken, turning
//     intentional JIT trap breakpoints into hard process crashes.
//
// Only runs when the binary under test was built with FUZZILLI_ENABLED (the
// `fuzzilli()` global exists). Normal debug/release builds skip.

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

declare const fuzzilli: unknown;
const isFuzzilliBuild = typeof fuzzilli === "function";

// Skip symbolization so ASAN writes its report and exits immediately instead
// of shelling out to llvm-symbolizer for every frame (several seconds on the
// fuzz binary). The presence of "AddressSanitizer: SEGV" is enough to prove
// the handler chain reached ASAN. allow_user_segv_handler keeps JSC from
// disabling its own fault handling when it sees ASAN_OPTIONS is set.
const fastCrashEnv = {
  ...bunEnv,
  ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "allow_user_segv_handler=1", "symbolize=0"].filter(Boolean).join(":"),
};

test.skipIf(!isFuzzilliBuild)("fuzzilli crash signal handler chains to JSC/ASAN for SIGSEGV", async () => {
  // FUZZILLI_CRASH type 5 writes to a volatile null pointer. With a working
  // handler chain the fault reaches jscSignalHandler → ASAN and we get an
  // "AddressSanitizer: SEGV" report on stderr; with signal()+SIG_DFL the
  // process dies with stderr containing only the [COV] banner.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", 'fuzzilli("FUZZILLI_CRASH", 5);'],
    env: fastCrashEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("FUZZILLI_CRASH: 5");
  expect(stderr).toContain("AddressSanitizer: SEGV");
  // ASAN aborts after printing; a bare SIGSEGV would surface as signalCode
  // "SIGSEGV" with nothing useful on stderr.
  expect(proc.signalCode).not.toBe("SIGSEGV");
});

test.skipIf(!isFuzzilliBuild)("fuzzilli crash signal handler survives Worker global creation", async () => {
  // Bun__REPRL__registerFuzzilliFunctions runs for every GlobalObject (main,
  // macros, Workers). Without a once-guard the Worker's call re-installs the
  // handler, saving fuzzilliSignalHandler itself into fuzzilliOldActions and
  // turning the next SIGSEGV into infinite self-recursion → bare TERMSIG 11.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      'const w = new Worker("data:text/javascript,postMessage(0)"); await new Promise(r => (w.onmessage = r)); w.terminate(); fuzzilli("FUZZILLI_CRASH", 5);',
    ],
    env: fastCrashEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("FUZZILLI_CRASH: 5");
  expect(stderr).toContain("AddressSanitizer: SEGV");
  expect(proc.signalCode).not.toBe("SIGSEGV");
});

test.skipIf(!isFuzzilliBuild)("fuzzilli crash signal handler still terminates for SIGABRT", async () => {
  // FUZZILLI_CRASH type 0 is std::abort(). No JSC/ASAN handler is registered
  // for SIGABRT by default, so the chain falls through to SIG_DFL and the
  // process terminates with SIGABRT — Fuzzilli's crash detection relies on
  // this.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", 'fuzzilli("FUZZILLI_CRASH", 0);'],
    env: fastCrashEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("FUZZILLI_CRASH: 0");
  expect(exitCode).not.toBe(0);
  expect(proc.signalCode).toBe("SIGABRT");
});
