import { expect, it } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows } from "harness";
import path from "node:path";

async function runFixture(fixture: string, env: Record<string, string | undefined> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, fixture)],
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

it("timer heap survives cross-thread Atomics.waitAsync timeout cancellation", async () => {
  expect(await runFixture("timer-heap-atomics-fixture.ts")).toEqual({
    stdout: "OK\n",
    stderr: expect.any(String),
    signal: null,
    exitCode: 0,
  });
}, 20_000);

it.skipIf(!isDebug)(
  "timer heap stays consistent while GC re-arms the RunLoop timer",
  async () => {
    expect(await runFixture("timer-heap-gc-fixture.ts")).toEqual({
      stdout: "ok 30\n",
      stderr: expect.any(String),
      signal: null,
      exitCode: 0,
    });
  },
  20_000,
);

// Windows uses uv_timer_t; ensure_uv_timer() already re-reads both heaps on
// every insert, so the onBeforeWait window does not exist there.
it.skipIf(isWindows)(
  "a WTF timer armed inside onBeforeWait bounds the epoll/kqueue park",
  async () => {
    // sweepSynchronously so module-load GC does not leave a short-deadline
    // IncrementalSweeper in the wtf_timers heap ahead of the watchdog.
    const env = { BUN_JSC_sweepSynchronously: "1" };
    expect(await runFixture("timer-heap-onbeforewait-fixture.ts", env)).toEqual({
      stdout: "OK\n",
      stderr: expect.any(String),
      signal: null,
      exitCode: 0,
    });
  },
  20_000,
);
