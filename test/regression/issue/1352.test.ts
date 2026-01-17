import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("Error.cause should display with [cause] label", async () => {
  using dir = tempDir("error-cause-test", {
    "test.js": `
const err = new Error("Main error");
err.cause = new Error("Cause error");
console.error(err);
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The output should contain "[cause]" label
  expect(stderr).toContain("[cause]");
  expect(stderr).toContain("Main error");
  expect(stderr).toContain("Cause error");
  expect(exitCode).toBe(0);
});

test("AggregateError should display message and [errors] label", async () => {
  using dir = tempDir("aggregate-error-test", {
    "test.js": `
const aggregate = new AggregateError(
    [new Error('Error 1'), new Error('Error 2')],
    'Aggregate error message.'
);
throw aggregate;
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The output should contain the AggregateError message
  expect(stderr).toContain("AggregateError");
  expect(stderr).toContain("Aggregate error message.");
  // The output should contain "[errors]" label
  expect(stderr).toContain("[errors]");
  expect(stderr).toContain("Error 1");
  expect(stderr).toContain("Error 2");
  expect(exitCode).not.toBe(0); // throw causes non-zero exit
});

test("AggregateError with cause should display [cause] label", async () => {
  using dir = tempDir("aggregate-error-cause-test", {
    "test.js": `
const aggregate = new AggregateError(
    [new Error('Error 1')],
    'Aggregate error message.',
    { cause: new Error('Cause') }
);
throw aggregate;
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The output should contain [cause] label
  expect(stderr).toContain("[cause]");
  expect(stderr).toContain("Cause");
  // The output should contain [errors] label
  expect(stderr).toContain("[errors]");
  expect(stderr).toContain("Error 1");
  expect(exitCode).not.toBe(0); // throw causes non-zero exit
});

test("Nested Error.cause chain should display properly", async () => {
  using dir = tempDir("nested-cause-test", {
    "test.js": `
const err3 = new Error("Third level");
const err2 = new Error("Second level", { cause: err3 });
const err1 = new Error("First level", { cause: err2 });
console.error(err1);
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Should show cause labels for nested errors
  expect(stderr).toContain("First level");
  expect(stderr).toContain("Second level");
  expect(stderr).toContain("Third level");
  // Should have multiple [cause] labels
  const causeMatches = stderr.match(/\[cause\]/g);
  expect(causeMatches).not.toBeNull();
  expect(causeMatches!.length).toBeGreaterThanOrEqual(2);
  expect(exitCode).toBe(0);
});
