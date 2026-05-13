// https://github.com/oven-sh/bun/issues/26037
//
// With jest.useFakeTimers() active, awaiting a Promise that depends on a
// fake setTimeout (and never advancing the fake clock) should cause the test
// to fail with a timeout — the same behavior as Jest. Before this fix, the
// per-test timeout timer (which lives in the real timer heap with a real-time
// deadline) was compared against the mocked clock (which starts at 0), so it
// never fired and the test runner hung forever.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function runInnerTest(files: Record<string, string>, entry: string) {
  using dir = tempDir("issue-26037", files);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", entry],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  // The inner tests use a 1s per-test timeout. On an unfixed build the child
  // never exits at all, so cap the wait and kill it rather than letting this
  // outer test sit until its own timeout. 10s leaves plenty of headroom for
  // debug-build child startup while still producing a clear "hung" failure.
  const exitCode = await Promise.race([proc.exited, Bun.sleep(10_000).then(() => "hung" as const)]);
  if (exitCode === "hung") proc.kill();

  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);
  return { stdout, stderr, exitCode };
}

test.concurrent(
  "test timeout fires while fake timers are active",
  async () => {
    const { stdout, stderr, exitCode } = await runInnerTest(
      {
        "hang.test.ts": `
        import { it, jest } from "bun:test";

        it("hangs on fake setTimeout", async () => {
          jest.useFakeTimers();
          console.log("before-await");
          // This setTimeout goes into the fake timer heap and nothing ever
          // advances the fake clock, so the promise never resolves.
          await new Promise(resolve => setTimeout(resolve, 0));
          console.log("after-await");
          jest.useRealTimers();
        }, 1000);
      `,
      },
      "hang.test.ts",
    );

    // The child reached the await (so fake timers were active at the time the
    // per-test timeout should have fired) but never resolved past it.
    expect(stdout).toContain("before-await");
    expect(stdout).not.toContain("after-await");

    // The test runner reported a timeout rather than hanging forever.
    expect(exitCode).not.toBe("hung");
    expect(stderr).toMatch(/timed out after \d+ms/i);
    expect(stderr).toContain("1 fail");
    expect(exitCode).toBe(1);
  },
  30_000,
);

test.concurrent(
  "test timeout fires when fake timers are enabled after the test starts",
  async () => {
    // Regression guard for the @testing-library/user-event shape: useFakeTimers()
    // is called *inside* the test body after the timeout timer has already been
    // armed (with a real-time deadline) and inserted into the real heap.
    const { stderr, exitCode } = await runInnerTest(
      {
        "late.test.ts": `
        import { it, jest } from "bun:test";

        it("enables fake timers mid-test then awaits", async () => {
          // Do a microtask hop first so the test timeout timer is definitely
          // armed before fake timers are enabled.
          await Promise.resolve();
          jest.useFakeTimers();
          await new Promise(resolve => setTimeout(resolve, 0));
          jest.useRealTimers();
        }, 1000);
      `,
      },
      "late.test.ts",
    );

    expect(exitCode).not.toBe("hung");
    expect(stderr).toMatch(/timed out after \d+ms/i);
    expect(stderr).toContain("1 fail");
    expect(exitCode).toBe(1);
  },
  30_000,
);

test.concurrent(
  "real setTimeout scheduled before useFakeTimers still fires",
  async () => {
    // Timers inserted into the real heap before fake timers are enabled have
    // real-time deadlines. Draining the real heap against mocked time made them
    // look perpetually "not due yet". After the fix they fire on schedule.
    const { stderr, exitCode } = await runInnerTest(
      {
        "prior.test.ts": `
        import { it, jest, expect } from "bun:test";

        it("pre-fake-timer setTimeout fires", async () => {
          let fired = false;
          const p = new Promise<void>(resolve => {
            setTimeout(() => {
              fired = true;
              resolve();
            }, 50);
          });
          jest.useFakeTimers();
          try {
            await p;
            expect(fired).toBe(true);
          } finally {
            jest.useRealTimers();
          }
        }, 1000);
      `,
      },
      "prior.test.ts",
    );

    expect(stderr).not.toMatch(/timed out/i);
    expect(exitCode).not.toBe("hung");
    expect(stderr).toContain("1 pass");
    expect(exitCode).toBe(0);
  },
  30_000,
);
