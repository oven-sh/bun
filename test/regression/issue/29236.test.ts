// https://github.com/oven-sh/bun/issues/29236
//
// onTestFinished() must be usable from inside a concurrent test, just like
// a plain try/finally cleanup block is. Before the fix, any onTestFinished()
// call from a concurrent test threw:
//
//   Cannot call onTestFinished() here. It cannot be called inside a
//   concurrent test. Use test.serial or remove test.concurrent.
//
// because the hook lookup couldn't resolve which sequence owned the call
// when more than one concurrent sequence was active.
import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("onTestFinished works inside concurrent tests", async () => {
  using dir = tempDir("issue-29236-on-test-finished-concurrent", {
    "concurrent.test.ts": /* ts */ `
      import { expect, onTestFinished, test } from "bun:test";

      const runs: string[] = [];

      test.concurrent("a", async () => {
        onTestFinished(() => { runs.push("a-finished"); });
        await new Promise<void>(r => setTimeout(r, 10));
        expect(1).toBe(1);
      });

      test.concurrent("b", async () => {
        onTestFinished(() => { runs.push("b-finished"); });
        await new Promise<void>(r => setTimeout(r, 10));
        expect(1).toBe(1);
      });

      test.concurrent("c", async () => {
        onTestFinished(() => { runs.push("c-finished"); });
        await new Promise<void>(r => setTimeout(r, 10));
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
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);
  const output = stdout + stderr;
  expect(output).not.toContain("Cannot call onTestFinished");
  expect(output).toContain("4 pass");
  expect(output).toContain("0 fail");
  expect(exitCode).toBe(0);
});

test("onTestFinished works inside concurrent tests via --concurrent flag", async () => {
  using dir = tempDir("issue-29236-on-test-finished-cli", {
    "plain.test.ts": /* ts */ `
      import { expect, onTestFinished, test } from "bun:test";

      test("one", async () => {
        onTestFinished(() => {});
        await new Promise<void>(r => setTimeout(r, 5));
        expect(1).toBe(1);
      });

      test("two", async () => {
        onTestFinished(() => {});
        await new Promise<void>(r => setTimeout(r, 5));
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
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);
  const output = stdout + stderr;
  expect(output).not.toContain("Cannot call onTestFinished");
  expect(output).toContain("2 pass");
  expect(output).toContain("0 fail");
  expect(exitCode).toBe(0);
});
