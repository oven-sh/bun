import { expect, it } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";
import path from "node:path";

async function runFixture(fixture: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, fixture)],
    env: {
      ...bunEnv,
      // These make the debug build an order of magnitude slower; the fixtures need real wall time.
      BUN_JSC_validateExceptionChecks: undefined,
      BUN_JSC_dumpSimulatedThrows: undefined,
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
