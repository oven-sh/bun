// https://github.com/oven-sh/bun/issues/29157
//
// Bun's native `console.dir` / `console.log` formatter early-returned on any
// AggregateError, walking `.errors` and printing each entry as a top-level
// error — dropping the AggregateError wrapper's name, message, and stack.
//
// `Promise.any([Promise.reject(Error(""))]).catch(console.dir)` should print
// `AggregateError: ... { [errors]: [ ... ] }` like Node. Bun instead printed
// just the inner `Error` with no trace of the wrapper.
//
// Fix: removed the AggregateError early-return in `printErrorlikeObject` and
// taught `printErrorInstance` to walk the non-enumerable `.errors` array the
// same way it already walks `.cause`.

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("console.dir on AggregateError prints the wrapper, not just the inner errors", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const err = new AggregateError([new Error("child1"), new Error("child2")], "wrapper");
       console.dir(err);`,
    ],
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  // The wrapper's name + message must be in the output. Pre-fix, this was
  // absent — the formatter printed only "error: child1 ... error: child2".
  expect(stdout).toContain("AggregateError");
  expect(stdout).toContain("wrapper");
  // Children must still be printed below the wrapper.
  expect(stdout).toContain("child1");
  expect(stdout).toContain("child2");
});

test("Promise.any rejection surfaces as an AggregateError, not a stray inner error", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `await Promise.any([Promise.reject(new Error("inner"))]).catch(console.dir);`,
    ],
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  // Pre-fix Bun printed `Error:` with no mention of AggregateError at all —
  // exactly the bug from the issue report.
  expect(stdout).toContain("AggregateError");
  expect(stdout).toContain("inner");
});

test("uncaught AggregateError rejection still shows the wrapper", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `await Promise.any([Promise.reject(new Error("a")), Promise.reject(new Error("b"))]);`,
    ],
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).not.toBe(0);
  // Uncaught rejection goes to stderr. The wrapper must appear there — the
  // native error-reporter was fanning out `.errors` without printing the
  // outer AggregateError at all.
  expect(stderr).toContain("AggregateError");
  expect(stderr).toContain("a");
  expect(stderr).toContain("b");
});

test("AggregateError with a cause chain prints wrapper + errors + cause", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const cause = new Error("root cause");
       const err = new AggregateError([new Error("child")], "wrapper", { cause });
       console.dir(err);`,
    ],
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("AggregateError");
  expect(stdout).toContain("wrapper");
  expect(stdout).toContain("child");
  expect(stdout).toContain("root cause");
});
