import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/14644
// An unhandled promise rejection inside an async test must mark the test as
// failed but still await the returned promise before running afterEach and the
// next test.

test("unhandled rejection in async test does not advance past the test body", async () => {
  using dir = tempDir("issue-14644", {
    "order.test.js": `
      import { beforeEach, afterEach, test } from "bun:test";

      beforeEach(() => { console.log("beforeEach"); });
      afterEach(() => { console.log("afterEach"); });

      test("a", async () => {
        console.log("test a start");
        ;(async () => { throw 123; })();
        await Bun.sleep(1);
        console.log("test a end");
      });

      test("b", async () => {
        console.log("test b");
        await Bun.sleep(1);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "order.test.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const combined = stdout + stderr;

  const pick = (s: string) =>
    s
      .split("\n")
      .map(l => l.trim())
      .filter(l => l.startsWith("beforeEach") || l.startsWith("afterEach") || l.startsWith("test "));

  expect(pick(stdout)).toEqual([
    "beforeEach",
    "test a start",
    "test a end",
    "afterEach",
    "beforeEach",
    "test b",
    "afterEach",
  ]);

  expect(combined).toContain("123");
  expect(combined).toMatch(/\n 1 pass/);
  expect(combined).toMatch(/\n 1 fail/);
  expect(exitCode).toBe(1);
});

test("unhandled rejection from a macrotask while awaiting does not advance past the test body", async () => {
  using dir = tempDir("issue-14644-timer", {
    "order.test.js": `
      import { afterEach, test } from "bun:test";

      afterEach(() => { console.log("afterEach"); });

      test("a", async () => {
        console.log("test a start");
        setTimeout(() => {
          ;(async () => { throw 123; })();
        }, 1);
        await Bun.sleep(10);
        console.log("test a end");
      });

      test("b", () => {
        console.log("test b");
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "order.test.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const combined = stdout + stderr;

  const pick = (s: string) =>
    s
      .split("\n")
      .map(l => l.trim())
      .filter(l => l.startsWith("afterEach") || l.startsWith("test "));

  expect(pick(stdout)).toEqual(["test a start", "test a end", "afterEach", "test b", "afterEach"]);

  expect(combined).toContain("123");
  expect(combined).toMatch(/\n 1 pass/);
  expect(combined).toMatch(/\n 1 fail/);
  expect(exitCode).toBe(1);
});
