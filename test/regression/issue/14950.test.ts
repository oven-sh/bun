// https://github.com/oven-sh/bun/issues/14950
// `expect(pendingPromise).resolves.<matcher>()` in a sync test body must not
// hang `bun test` forever at 100% CPU; the per-test timeout has to fire.
import { test, expect, describe } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

async function runTestFile(name: string, body: string) {
  using dir = tempDir(name, { "t.test.js": body });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "t.test.js", "--timeout", "500"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });
  // On an unfixed build the inner runner never exits (the per-test --timeout
  // cannot interrupt the wait_for_promise spin), so kill it ourselves instead
  // of letting the outer runner's own timeout abort the assertion.
  let hung = false;
  const watchdog = setTimeout(() => {
    hung = true;
    proc.kill();
  }, 20_000);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    return { stdout, stderr, exitCode, hung };
  } finally {
    clearTimeout(watchdog);
  }
}

describe.concurrent("expect().resolves/.rejects on a not-yet-settled promise", () => {
  test(
    ".resolves on a promise resolved after the matcher call times out instead of hanging",
    async () => {
      const { stderr, exitCode, hung } = await runTestFile(
        "issue-14950-resolves",
        `test("promise resolves after expect call", () => {
           let resolve;
           expect(new Promise(r => (resolve = r))).resolves.toBe(25);
           resolve(25);
         });`,
      );
      expect(hung).toBe(false);
      expect(stderr).toContain("still pending");
      expect(stderr).toMatch(/timed out after \d+ms/);
      expect(exitCode).toBe(1);
    },
    60_000,
  );

  test(
    ".rejects on a never-settling promise times out instead of hanging",
    async () => {
      const { stderr, exitCode, hung } = await runTestFile(
        "issue-14950-rejects",
        `test("never settles", () => {
           expect(new Promise(() => {})).rejects.toThrow();
         });`,
      );
      expect(hung).toBe(false);
      expect(stderr).toContain("still pending");
      expect(stderr).toMatch(/timed out after \d+ms/);
      expect(exitCode).toBe(1);
    },
    60_000,
  );

  test(
    "toThrow on an async fn returning a never-settling promise times out instead of hanging",
    async () => {
      const { stderr, exitCode, hung } = await runTestFile(
        "issue-14950-tothrow",
        `test("never settles", () => {
           expect(() => new Promise(() => {})).toThrow();
         });`,
      );
      expect(hung).toBe(false);
      expect(stderr).toContain("did not settle within the test timeout");
      expect(exitCode).toBe(1);
    },
    60_000,
  );

  test(
    "async custom matcher returning a never-settling promise times out instead of hanging",
    async () => {
      const { stderr, exitCode, hung } = await runTestFile(
        "issue-14950-custom",
        `const { expect, test } = require("bun:test");
         expect.extend({
           toNeverSettle() { return new Promise(() => {}); },
         });
         test("never settles", () => {
           expect(1).toNeverSettle();
         });`,
      );
      expect(hung).toBe(false);
      expect(stderr).toContain("did not settle within the test timeout");
      expect(exitCode).toBe(1);
    },
    60_000,
  );

  test(
    "a test after one that spins on .resolves still runs",
    async () => {
      const { stderr, exitCode, hung } = await runTestFile(
        "issue-14950-next-test",
        `test("hangs", () => {
           expect(new Promise(() => {})).resolves.toBe(1);
         });
         test("runs after", () => {
           expect(1).toBe(1);
         });`,
      );
      expect(hung).toBe(false);
      expect(stderr).toMatch(/1 pass/);
      expect(stderr).toMatch(/1 fail/);
      expect(exitCode).toBe(1);
    },
    60_000,
  );

  test(
    ".resolves on an already-resolved promise still passes synchronously",
    async () => {
      const { stderr, exitCode, hung } = await runTestFile(
        "issue-14950-settled",
        `test("already settled", () => {
           expect(Promise.resolve(25)).resolves.toBe(25);
         });`,
      );
      expect(hung).toBe(false);
      expect(stderr).toMatch(/1 pass/);
      expect(stderr).not.toContain("still pending");
      expect(exitCode).toBe(0);
    },
    60_000,
  );
});
