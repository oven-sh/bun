import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

// The fuzzilli REPRL wrapper (src/js/eval/fuzzilli-reprl.ts) executes
// fuzzer-generated scripts in-process. APIs that intentionally kill the
// process outside of normal exception handling must be stubbed out before the
// loop starts, otherwise every fuzz case reaching them is reported as a
// crash. process.execve is one of those: on success it replaces the process
// image, which would silently end the REPRL loop.
test("REPRL loop survives a payload that calls process.execve", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "fuzzilli-reprl-execve.fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("STATUS_WRITES=2 LIVE=true");
  expect(exitCode).toBe(0);
});

declare const fuzzilli: unknown;
// The native side (src/jsc/bindings/FuzzilliREPRL.cpp) only exists in the
// fuzzilli build, which is the only build with a fuzzilli() global.
const isFuzzilliBuild = typeof fuzzilli === "function";

// symbolize=0: ASAN would otherwise run llvm-symbolizer over every frame of
// the fuzz binary, which takes seconds. The report header is enough here.
// The inherited ASAN_OPTIONS is dropped so that the signal handling under test
// comes from __asan_default_options only.
const crashEnv = {
  ...bunEnv,
  ASAN_OPTIONS: "symbolize=0",
};

// A crash in the REPRL child must leave an ASAN report on stderr. The REPRL
// code used to install its own signal handler, which replaced ASAN's and
// re-raised the signal, so a SIGSEGV died with no report, and a bare abort()
// died with no output at all.
describe.skipIf(!isFuzzilliBuild)("fuzzilli crash reporting", () => {
  // FUZZILLI_CRASH types: 0 is std::abort(), 1 is __builtin_trap() (SIGILL on
  // x64, SIGTRAP on arm64), 5 writes through a null pointer.
  describe.each([
    [0, /AddressSanitizer: ABRT/],
    [1, /AddressSanitizer: (ILL|TRAP)/],
    [5, /AddressSanitizer: SEGV/],
  ])("FUZZILLI_CRASH %d", (type, report) => {
    test.concurrent("dies with an ASAN report", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", `fuzzilli("FUZZILLI_CRASH", ${type})`],
        env: crashEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain(`FUZZILLI_CRASH: ${type}`);
      expect(stderr).toMatch(report);
      // ASAN aborts after the report, so the death is still a signal, which is
      // what Fuzzilli counts as a crash.
      expect(proc.signalCode).toBe("SIGABRT");
    });
  });
});
