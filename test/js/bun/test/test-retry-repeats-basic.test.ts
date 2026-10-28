// Every check here runs `bun test` in a subprocess so the intentional
// intermediate retry failures don't leak into this run's reporter output
// (JUnit, GitHub Actions annotations).
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

test("retry and repeats hook ordering", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", join(import.meta.dir, "test-retry-repeats-basic-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("12 pass");
  expect(stderr).toContain("0 fail");
  expect(stderr).toContain("(attempt 3)");
  expect(exitCode).toBe(0);
});

async function runRetryFixture(name: string, source: string) {
  using dir = tempDir(name, { "retry.test.ts": source });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "retry.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// In each fixture below, attempt 1 times out while waiting on something that
// attempt 2 completes as soon as it starts. Attempt 1's late completion must
// not count as the completion of attempt 2.
//
// The ordering does not depend on timers: attempt 1's completion is queued while
// attempt 2's body is still on the stack (synchronously by done(), or in the
// microtask drain that follows the body), and the runner consumes it in the same
// step, before anything attempt 2 scheduled can run. On an unfixed runner attempt
// 2 is therefore reported as passed before its own timer fires; the timers only
// keep attempt 2 alive past that point.

test.concurrent("a late resolve from a timed-out attempt does not complete the retry", async () => {
  const { stdout, stderr, exitCode } = await runRetryFixture(
    "retry-stale-resolve",
    `
      import { test, expect } from "bun:test";
      const first = Promise.withResolvers<void>();
      let attempt = 0;
      test("retry", async () => {
        attempt++;
        if (attempt === 1) {
          await first.promise;
          return;
        }
        first.resolve();
        await Bun.sleep(1);
        console.log("attempt 2 body finished");
        expect(attempt).toBe(1);
      }, { retry: 1, timeout: 500 });
    `,
  );

  expect(stdout).toContain("attempt 2 body finished");
  expect(stderr).toContain("(fail) retry (attempt 2)");
  expect(stderr).toContain("Expected: 1");
  expect(stderr).toContain("Received: 2");
  expect(stderr).toContain("0 pass");
  expect(stderr).toContain("1 fail");
  expect(exitCode).toBe(1);
});

test.concurrent("a late resolve from a timed-out attempt keeps the retry's own timeout armed", async () => {
  const { stderr, exitCode } = await runRetryFixture(
    "retry-stale-resolve-timeout",
    `
      import { test } from "bun:test";
      const first = Promise.withResolvers<void>();
      let attempt = 0;
      test("retry", async () => {
        attempt++;
        if (attempt === 1) {
          await first.promise;
          return;
        }
        first.resolve();
        await new Promise(() => {});
      }, { retry: 1, timeout: 100 });
    `,
  );

  expect(stderr).toContain("(fail) retry (attempt 2)");
  expect(stderr).toContain("this test timed out after 100ms");
  expect(stderr).toContain("0 pass");
  expect(stderr).toContain("1 fail");
  expect(exitCode).toBe(1);
});

test.concurrent("a late done() from a timed-out attempt does not complete the retry", async () => {
  const { stdout, stderr, exitCode } = await runRetryFixture(
    "retry-stale-done",
    `
      import { test } from "bun:test";
      let firstDone: (err?: unknown) => void;
      let attempt = 0;
      test("retry", done => {
        attempt++;
        if (attempt === 1) {
          firstDone = done;
          return;
        }
        firstDone();
        setTimeout(() => {
          console.log("attempt 2 body finished");
          done(new Error("attempt 2 failed on its own"));
        }, 1);
      }, { retry: 1, timeout: 500 });
    `,
  );

  expect(stdout).toContain("attempt 2 body finished");
  expect(stderr).toContain("error: attempt 2 failed on its own");
  expect(stderr).toContain("(fail) retry (attempt 2)");
  expect(stderr).toContain("0 pass");
  expect(stderr).toContain("1 fail");
  expect(exitCode).toBe(1);
});

// Each attempt reports its failure through done(err). The completion that done(err) queues, and the
// one that the async function's promise queues, belong to that attempt and must not end the next one.
test.concurrent("done(err) fails every attempt of a retried test", async () => {
  const { stderr, exitCode } = await runRetryFixture(
    "retry-done-err",
    `
      import { test } from "bun:test";
      test("from a callback", done => {
        setImmediate(() => done(new Error("callback boom")));
      }, { retry: 1 });
      test("from an async function", async done => {
        await new Promise(resolve => setImmediate(resolve));
        done(new Error("async boom"));
      }, { retry: 1 });
    `,
  );

  expect(stderr).toContain("(fail) from a callback (attempt 2)");
  expect(stderr).toContain("(fail) from an async function (attempt 2)");
  expect(stderr).toContain("0 pass");
  expect(stderr).toContain("2 fail");
  expect(exitCode).toBe(1);
});
