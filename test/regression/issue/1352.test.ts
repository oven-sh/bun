import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("AggregateError.errors array is displayed when thrown", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const errors = [
  new Error("Error 1"),
  new Error("Error 2"),
  new TypeError("Type Error"),
];
const aggregateError = new AggregateError(errors, "Multiple errors occurred");
console.error(aggregateError);
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // Verify that the AggregateError is displayed
  expect(stderr).toContain("AggregateError");
  expect(stderr).toContain("Multiple errors occurred");

  // Verify that the individual errors in the .errors array are displayed
  expect(stderr).toContain("Error 1");
  expect(stderr).toContain("Error 2");
  expect(stderr).toContain("Type Error");

  expect(exitCode).toBe(0);
});

test("Error.cause is still displayed correctly", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const originalError = new Error("Original error message");
const wrappedError = new Error("Wrapped error message", { cause: originalError });
console.error(wrappedError);
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // Verify that both the wrapped error and the cause are displayed
  expect(stderr).toContain("Wrapped error message");
  expect(stderr).toContain("Original error message");

  expect(exitCode).toBe(0);
});

test("AggregateError with Error.cause and .errors array displays both", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const originalError = new Error("Root cause");
const error1 = new Error("Error 1");
const error2 = new Error("Error 2");
const aggregateError = new AggregateError([error1, error2], "Multiple errors with cause", {
  cause: originalError,
});
console.error(aggregateError);
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  // Verify that the AggregateError is displayed
  expect(stderr).toContain("AggregateError");
  expect(stderr).toContain("Multiple errors with cause");

  // Verify that both the errors array and the cause are displayed
  expect(stderr).toContain("Error 1");
  expect(stderr).toContain("Error 2");
  expect(stderr).toContain("Root cause");

  expect(exitCode).toBe(0);
});
