import { expect, it } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import path from "node:path";

// Rounds of cross-thread timer churn per worker, and the number of workers.
// About 3s on a debug ASAN build, well under 1s on a release build.
const ATOMICS_PUMPS = 100;
const ATOMICS_WORKERS = 3;
// Full GCs driven from a setTimeout loop, so the per-VM RunLoop timer is
// re-armed and popped next to the regular timer heap.
const GC_TICKS = 30;

async function runFixture(fixture: string, args: string[] = [], env: Record<string, string | undefined> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, fixture), ...args],
    env: {
      ...bunEnv,
      // These make the debug build an order of magnitude slower; the fixtures need real wall time.
      BUN_JSC_validateExceptionChecks: undefined,
      BUN_JSC_dumpSimulatedThrows: undefined,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  return { stdout, stderr, signal: proc.signalCode, exitCode };
}

it.concurrent(
  "timer heap survives cross-thread Atomics.waitAsync timeout cancellation",
  async () => {
    expect(await runFixture("timer-heap-atomics-fixture.ts", [String(ATOMICS_PUMPS), String(ATOMICS_WORKERS)])).toEqual(
      {
        stdout: `OK ${ATOMICS_WORKERS} workers ${ATOMICS_WORKERS * ATOMICS_PUMPS} pumps\n`,
        stderr: expect.any(String),
        signal: null,
        exitCode: 0,
      },
    );
  },
  20_000,
);

it.concurrent.skipIf(!isDebug)(
  "timer heap stays consistent while GC re-arms the RunLoop timer",
  async () => {
    expect(await runFixture("timer-heap-gc-fixture.ts", [String(GC_TICKS)])).toEqual({
      stdout: `ok ${GC_TICKS}\n`,
      stderr: expect.any(String),
      signal: null,
      exitCode: 0,
    });
  },
  20_000,
);

it.concurrent.skipIf(!isASAN)(
  "terminating a worker with pending Atomics.waitAsync tickets does not leak deferred-work tasks",
  async () => {
    const { stdout, stderr, signal, exitCode } = await runFixture("timer-heap-atomics-teardown-fixture.ts", [], {
      BUN_DESTRUCT_VM_ON_EXIT: "1",
      ASAN_OPTIONS: "allow_user_segv_handler=1:disable_coredump=0:detect_leaks=1:abort_on_error=1",
      LSAN_OPTIONS: `malloc_context_size=30:print_suppressions=0:suppressions=${path.join(import.meta.dir, "..", "..", "..", "leaksan.supp")}`,
    });
    // LSan writes its leak report to stderr and SIGABRTs; stdout holds the
    // fixture's own OK line either way, so assert exitCode/signal explicitly.
    expect({ stdout, stderr, signal, exitCode }).toEqual({
      stdout: "OK\n",
      stderr: expect.not.stringContaining("LeakSanitizer"),
      signal: null,
      exitCode: 0,
    });
  },
  20_000,
);
