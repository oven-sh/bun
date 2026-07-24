// https://github.com/oven-sh/bun/issues/29236
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test.concurrent("onTestFinished works inside concurrent tests", async () => {
  using dir = tempDir("issue-29236-on-test-finished-concurrent", {
    "concurrent.test.ts": /* ts */ `
      import { expect, onTestFinished, test } from "bun:test";

      const runs: string[] = [];

      test.concurrent("a", () => {
        onTestFinished(() => { runs.push("a-finished"); });
        expect(1).toBe(1);
      });

      test.concurrent("b", () => {
        onTestFinished(() => { runs.push("b-finished"); });
        expect(1).toBe(1);
      });

      test.concurrent("c", () => {
        onTestFinished(() => { runs.push("c-finished"); });
        expect(1).toBe(1);
      });

      test("report", () => {
        runs.sort();
        expect(runs).toEqual(["a-finished", "b-finished", "c-finished"]);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "concurrent.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const output = stdout + stderr;
  expect(output).not.toContain("Cannot call onTestFinished");
  expect(output).toMatch(/\b4 pass\b/);
  expect(output).toMatch(/\b0 fail\b/);
  expect(exitCode).toBe(0);
});

test.concurrent("onTestFinished works inside concurrent tests via --concurrent flag", async () => {
  using dir = tempDir("issue-29236-on-test-finished-cli", {
    "plain.test.ts": /* ts */ `
      import { expect, onTestFinished, test } from "bun:test";

      test("one", () => {
        onTestFinished(() => {});
        expect(1).toBe(1);
      });

      test("two", () => {
        onTestFinished(() => {});
        expect(1).toBe(1);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--concurrent", "plain.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const output = stdout + stderr;
  expect(output).not.toContain("Cannot call onTestFinished");
  expect(output).toMatch(/\b2 pass\b/);
  expect(output).toMatch(/\b0 fail\b/);
  expect(exitCode).toBe(0);
});

// When onTestFinished() is called in a concurrent test *after* control has
// returned to the event loop (e.g. after a timer-based await), the
// synchronous push/pop stack has already been popped, so the hook cannot
// resolve which concurrent sequence it belongs to. The error message should
// tell the user to hoist the call before the first await — not to remove
// .concurrent or use describe(), which was the pre-fix wording.
test.concurrent("error message after yielding await in concurrent test tells users to hoist", async () => {
  using dir = tempDir("issue-29236-after-await-error", {
    "after-await.test.ts": /* ts */ `
      import { onTestFinished, test } from "bun:test";
      test.concurrent("a", async () => {
        await Bun.sleep(5);
        onTestFinished(() => {});
      });
      test.concurrent("b", async () => {
        await Bun.sleep(5);
        onTestFinished(() => {});
      });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "after-await.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const output = stdout + stderr;
  // The legacy wording told users to switch to test.serial — that's wrong
  // after this fix; synchronous registration works fine.
  expect(output).not.toContain("Use test.serial");
  expect(output).toMatch(/before the first `?await`?/);
  expect(exitCode).not.toBe(0);
});
