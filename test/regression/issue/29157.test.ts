// https://github.com/oven-sh/bun/issues/29157

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

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("AggregateError");
  expect(stdout).toContain("wrapper");
  expect(stdout).toContain("child1");
  expect(stdout).toContain("child2");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("Promise.any rejection surfaces as an AggregateError, not a stray inner error", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `await Promise.any([Promise.reject(new Error("inner"))]).catch(console.dir);`],
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("AggregateError");
  expect(stdout).toContain("inner");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("uncaught AggregateError rejection still shows the wrapper", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `await Promise.any([Promise.reject(new Error("a")), Promise.reject(new Error("b"))]);`],
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("AggregateError");
  expect(stderr).toContain("a");
  expect(stderr).toContain("b");
  expect(exitCode).not.toBe(0);
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

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("AggregateError");
  expect(stdout).toContain("wrapper");
  expect(stdout).toContain("child");
  expect(stdout).toContain("root cause");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
