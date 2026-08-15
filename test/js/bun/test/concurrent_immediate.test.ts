import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

test("concurrent immediate", async () => {
  const result = await Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/concurrent_immediate.fixture.ts"],
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();
  expect(exitCode).toBe(0);
  expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`
    "bun test <version> (<revision>)
    beforeEach
    start test 1
    afterEach
    beforeEach
    start test 2
    afterEach
    beforeEach
    start test 3
    afterEach"
    `);

  const result2 = await Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/concurrent_immediate_promise.fixture.ts"],
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode2 = await result2.exited;
  const stdout2 = await result2.stdout.text();
  const stderr2 = await result2.stderr.text();
  expect(exitCode2).toBe(0);
  expect(normalizeBunSnapshot(stdout2)).toBe(normalizeBunSnapshot(stdout));
  expect(normalizeBunSnapshot(stderr2).replaceAll("_promise.", ".")).toBe(normalizeBunSnapshot(stderr));
});

function filterImportantLines(stderr: string) {
  return normalizeBunSnapshot(stderr)
    .split("\n")
    .map(l => l.trim())
    .filter(
      l =>
        l.startsWith("(pass)") ||
        l.startsWith("(fail)") ||
        l.startsWith("error:") ||
        l.startsWith("# Unhandled error") ||
        /^\d+ (pass|fail|errors?)$/.test(l),
    )
    .join("\n");
}

test("concurrent immediate error", async () => {
  const result = await Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/concurrent_immediate_error.fixture.ts"],
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await result.exited;
  const stdout = await result.stdout.text();
  const stderr = await result.stderr.text();
  expect(exitCode).toBe(1);
  expect(filterImportantLines(stderr)).toMatchInlineSnapshot(`
    "(pass) test 1
    error: test 2 error
    (fail) test 2
    (pass) test 3
    2 pass
    1 fail"
  `);

  const result2 = await Bun.spawn({
    cmd: [bunExe(), "test", import.meta.dir + "/concurrent_immediate_error_promise.fixture.ts"],
    cwd: import.meta.dir,
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode2 = await result2.exited;
  const stdout2 = await result2.stdout.text();
  const stderr2 = await result2.stderr.text();
  expect(filterImportantLines(stderr2)).toBe(filterImportantLines(stderr));
});

// An error that surfaces while a concurrent test's callback is still on the stack (before the runner
// has attached anything to its promise or done callback) has to be charged to that test. These used
// to be printed as "Unhandled error between tests" while the test itself passed, as soon as the
// concurrent group held more than one test.
async function runInlineFixture(source: string) {
  using dir = tempDir("concurrent-immediate", { "immediate.test.ts": source });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "./immediate.test.ts"],
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: normalizeBunSnapshot(stdout, String(dir)), stderr: filterImportantLines(stderr), exitCode };
}

test.concurrent("concurrent immediate done(error)", async () => {
  const { stderr, exitCode } = await runInlineFixture(`
    import { test } from "bun:test";
    test.concurrent("test 1", () => {});
    test.concurrent("test 2", done => {
      done(new Error("test 2 error"));
    });
    test.concurrent("test 3", async done => {
      await 1;
      done(new Error("test 3 error"));
    });
    test.concurrent.failing("test 4", done => {
      done(new Error("test 4 error"));
    });
    test.concurrent("test 5", done => {
      setTimeout(done, 1);
    });
  `);
  expect(stderr).toMatchInlineSnapshot(`
    "(pass) test 1
    error: test 2 error
    (fail) test 2
    error: test 3 error
    (fail) test 3
    (pass) test 4
    (pass) test 5
    3 pass
    2 fail"
  `);
  expect(exitCode).toBe(1);
});

test.concurrent("concurrent immediate done(error) in describe.concurrent still runs the hooks", async () => {
  const { stdout, stderr, exitCode } = await runInlineFixture(`
    import { afterEach, beforeEach, describe, test } from "bun:test";
    describe.concurrent("group", () => {
      beforeEach(() => console.log("beforeEach"));
      afterEach(() => console.log("afterEach"));
      test("test 1", done => {
        done(new Error("test 1 error"));
      });
      test("test 2", () => {});
    });
  `);
  expect(stdout).toMatchInlineSnapshot(`
    "bun test <version> (<revision>)
    beforeEach
    afterEach
    beforeEach
    afterEach"
  `);
  expect(stderr).toMatchInlineSnapshot(`
    "error: test 1 error
    (fail) group > test 1
    (pass) group > test 2
    1 pass
    1 fail"
  `);
  expect(exitCode).toBe(1);
});

test.concurrent("concurrent immediate unhandled error", async () => {
  const { stderr, exitCode } = await runInlineFixture(`
    import { test } from "bun:test";
    test.concurrent("test 1", () => {});
    test.concurrent("test 2", async () => {
      Promise.reject(new Error("test 2 error"));
    });
    test.concurrent("test 3", () => {
      process.nextTick(() => {
        throw new Error("test 3 error");
      });
    });
  `);
  expect(stderr).toMatchInlineSnapshot(`
    "(pass) test 1
    error: test 2 error
    (fail) test 2
    error: test 3 error
    (fail) test 3
    1 pass
    2 fail"
  `);
  expect(exitCode).toBe(1);
});
