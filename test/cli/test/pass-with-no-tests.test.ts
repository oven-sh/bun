import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("--pass-with-no-tests exits with 0 when no test files found", async () => {
  using dir = tempDir("pass-with-no-tests", {
    "not-a-test.ts": `console.log("hello");`,
  });

  const { exited, stderr } = Bun.spawn({
    cmd: [bunExe(), "test", "--pass-with-no-tests"],
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: bunEnv,
  });

  const [err, exitCode] = await Promise.all([stderr.text(), exited]);

  expect(exitCode).toBe(0);
  expect(err).toContain("No tests found!");
});

test("--pass-with-no-tests exits with 0 when filters match no tests", async () => {
  using dir = tempDir("pass-with-no-tests-filter", {
    "some.test.ts": `import { test } from "bun:test"; test("example", () => {});`,
  });

  const { exited, stderr } = Bun.spawn({
    cmd: [bunExe(), "test", "--pass-with-no-tests", "-t", "nonexistent"],
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: bunEnv,
  });

  const [err, exitCode] = await Promise.all([stderr.text(), exited]);

  expect(exitCode).toBe(0);
});

test.each([
  ["a path that does not exist", ["./does-not-exist"]],
  ["several paths that do not exist", ["./does-not-exist", "./also-missing"]],
  ["a directory with no test files", ["./empty"]],
])("--pass-with-no-tests exits with 0 when given %s", async (_label, paths) => {
  using dir = tempDir("pass-with-no-tests-path", {
    "some.test.ts": `import { test } from "bun:test"; test("example", () => {});`,
    "empty/not-a-test.ts": `console.log("hello");`,
  });

  await using failing = Bun.spawn({
    cmd: [bunExe(), "test", ...paths],
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: bunEnv,
  });
  const [failErr, failExitCode] = await Promise.all([failing.stderr.text(), failing.exited]);
  expect(failErr).toContain(paths[0]);
  expect(failErr).not.toContain("example");
  expect(failExitCode).toBe(1);

  await using passing = Bun.spawn({
    cmd: [bunExe(), "test", ...paths, "--pass-with-no-tests"],
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: bunEnv,
  });
  const [passErr, passExitCode] = await Promise.all([passing.stderr.text(), passing.exited]);
  expect(passErr).toContain("The following filters did not match any test files:");
  expect(passErr).toContain(paths[0]);
  expect(passErr).not.toContain("example");
  expect(passExitCode).toBe(0);
});

test("without --pass-with-no-tests, exits with 1 when no test files found", async () => {
  using dir = tempDir("fail-with-no-tests", {
    "not-a-test.ts": `console.log("hello");`,
  });

  const { exited, stderr } = Bun.spawn({
    cmd: [bunExe(), "test"],
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: bunEnv,
  });

  const [err, exitCode] = await Promise.all([stderr.text(), exited]);

  expect(exitCode).toBe(1);
  expect(err).toContain("No tests found!");
});

test("without --pass-with-no-tests, exits with 1 when filters match no tests", async () => {
  using dir = tempDir("fail-with-no-tests-filter", {
    "some.test.ts": `import { test } from "bun:test"; test("example", () => {});`,
  });

  const { exited } = Bun.spawn({
    cmd: [bunExe(), "test", "-t", "nonexistent"],
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: bunEnv,
  });

  const exitCode = await exited;

  expect(exitCode).toBe(1);
});

test("--pass-with-no-tests still fails when tests fail", async () => {
  using dir = tempDir("pass-with-no-tests-but-fail", {
    "test.test.ts": `import { test, expect } from "bun:test"; test("failing", () => { expect(1).toBe(2); });`,
  });

  const { exited } = Bun.spawn({
    cmd: [bunExe(), "test", "--pass-with-no-tests"],
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: bunEnv,
  });

  const exitCode = await exited;

  expect(exitCode).toBe(1);
});
