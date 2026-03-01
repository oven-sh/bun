import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("--retry retries failed tests", async () => {
  using dir = tempDir("retry-flag", {
    "flaky.test.ts": `
      import { test, expect } from "bun:test";
      let count = 0;
      test("flaky test", () => {
        count++;
        if (count < 3) throw new Error("fail attempt " + count);
        expect(true).toBe(true);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--retry", "3", "flaky.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("flaky test");
  expect(stderr).toContain("attempt 3");
  expect(exitCode).toBe(0);
});

test("per-test { retry } overrides --retry", async () => {
  using dir = tempDir("retry-override", {
    "override.test.ts": `
      import { test, expect } from "bun:test";
      let countA = 0;
      let countB = 0;

      // Per-test retry=1 overrides --retry 5. Fails twice, so retry=1 not enough.
      test("limited retry", { retry: 1 }, () => {
        countA++;
        if (countA < 3) throw new Error("fail attempt " + countA);
      });

      // Uses global --retry 5 default, fails once then passes.
      test("default retry", () => {
        countB++;
        if (countB < 2) throw new Error("fail attempt " + countB);
        expect(true).toBe(true);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--retry", "5", "override.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("limited retry");
  expect(stderr).toContain("default retry");
  expect(exitCode).not.toBe(0);
});

test("--retry works with describe blocks and beforeEach/afterEach hooks", async () => {
  using dir = tempDir("retry-hooks", {
    "hooks.test.ts": `
      import { test, expect, describe, beforeEach, afterEach } from "bun:test";
      let hookLog: string[] = [];
      let attempt = 0;

      describe("suite with hooks", () => {
        beforeEach(() => {
          hookLog.push("before");
        });

        afterEach(() => {
          hookLog.push("after");
        });

        test("flaky with hooks", () => {
          attempt++;
          hookLog.push("test:" + attempt);
          if (attempt < 3) throw new Error("fail attempt " + attempt);
          // On passing attempt, verify hooks ran each time
          expect(hookLog).toEqual([
            "before", "test:1", "after",
            "before", "test:2", "after",
            "before", "test:3",
          ]);
        });
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--retry", "3", "hooks.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("flaky with hooks");
  expect(exitCode).toBe(0);
});

test("--retry with multiple tests where only some need retries", async () => {
  using dir = tempDir("retry-multi", {
    "multi.test.ts": `
      import { test, expect } from "bun:test";
      let flakyCount = 0;

      test("always passes", () => {
        expect(1 + 1).toBe(2);
      });

      test("flaky test", () => {
        flakyCount++;
        if (flakyCount < 2) throw new Error("fail");
        expect(true).toBe(true);
      });

      test("always fails", () => {
        throw new Error("permanent failure");
      });

      test("another passing test", () => {
        expect("hello").toBe("hello");
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--retry", "3", "multi.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // "always fails" should still fail after all retries
  expect(exitCode).not.toBe(0);
  // Both passing tests and the flaky test should show as passing
  expect(stderr).toContain("always passes");
  expect(stderr).toContain("flaky test");
  expect(stderr).toContain("always fails");
  expect(stderr).toContain("another passing test");
});

test("--retry with async tests", async () => {
  using dir = tempDir("retry-async", {
    "async.test.ts": `
      import { test, expect } from "bun:test";
      let count = 0;

      test("async flaky test", async () => {
        count++;
        await Bun.sleep(1);
        if (count < 3) throw new Error("async fail attempt " + count);
        expect(true).toBe(true);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--retry", "3", "async.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("async flaky test");
  expect(stderr).toContain("attempt 3");
  expect(exitCode).toBe(0);
});

test("--retry with nested describe blocks", async () => {
  using dir = tempDir("retry-nested", {
    "nested.test.ts": `
      import { test, expect, describe, beforeEach } from "bun:test";
      let outerSetup = 0;
      let innerSetup = 0;
      let attempt = 0;

      describe("outer", () => {
        beforeEach(() => { outerSetup++; });

        describe("inner", () => {
          beforeEach(() => { innerSetup++; });

          test("deeply nested flaky", () => {
            attempt++;
            if (attempt < 2) throw new Error("fail");
            // Both outer and inner beforeEach should have run for each attempt
            expect(outerSetup).toBe(2);
            expect(innerSetup).toBe(2);
          });
        });
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--retry", "3", "nested.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("deeply nested flaky");
  expect(exitCode).toBe(0);
});

test("--retry past MAX_FLAKY_ATTEMPTS (16) still retries correctly", async () => {
  using dir = tempDir("retry-max", {
    "max.test.ts": `
      import { test, expect } from "bun:test";
      let count = 0;

      // Fails 19 times, passes on attempt 20 -- well past the 16-entry buffer
      test("fails many times", { retry: 20 }, () => {
        count++;
        if (count < 20) throw new Error("fail attempt " + count);
        expect(true).toBe(true);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "max.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("fails many times");
  expect(exitCode).toBe(0);
});

test("--retry with test.skip and test.todo does not retry them", async () => {
  using dir = tempDir("retry-skip-todo", {
    "skip-todo.test.ts": `
      import { test, expect } from "bun:test";

      test.skip("skipped test", () => {
        throw new Error("should not run");
      });

      test.todo("todo test");

      let count = 0;
      test("normal flaky", () => {
        count++;
        if (count < 2) throw new Error("fail");
        expect(true).toBe(true);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--retry", "3", "skip-todo.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("normal flaky");
  expect(stderr).toContain("skipped test");
  expect(stderr).toContain("todo test");
  expect(exitCode).toBe(0);
});

test("bunfig.toml retry works equivalently", async () => {
  using dir = tempDir("retry-bunfig", {
    "bunfig.toml": `
[test]
retry = 3
`,
    "flaky.test.ts": `
      import { test, expect } from "bun:test";
      let count = 0;
      test("flaky via bunfig", () => {
        count++;
        if (count < 3) throw new Error("fail attempt " + count);
        expect(true).toBe(true);
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "flaky.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("flaky via bunfig");
  expect(stderr).toContain("attempt 3");
  expect(exitCode).toBe(0);
});
