// https://github.com/oven-sh/bun/issues/29157

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test.concurrent("console.dir on AggregateError prints the wrapper, not just the inner errors", async () => {
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
  expect(exitCode).toBe(0);
});

test.concurrent("Promise.any rejection surfaces as an AggregateError, not a stray inner error", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `await Promise.any([Promise.reject(new Error("inner"))]).catch(console.dir);`],
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("AggregateError");
  expect(stdout).toContain("inner");
  expect(exitCode).toBe(0);
});

test.concurrent("uncaught AggregateError rejection still shows the wrapper", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `await Promise.any([Promise.reject(new Error("child_aaa")), Promise.reject(new Error("child_bbb"))]);`,
    ],
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("AggregateError");
  // Distinctive messages so the assertion can only pass when the inner
  // errors are actually printed — single-char strings would match the
  // wrapper name or stack-frame content even if the children were dropped.
  expect(stderr).toContain("child_aaa");
  expect(stderr).toContain("child_bbb");
  expect(exitCode).not.toBe(0);
});

test.concurrent("AggregateError with a cause chain prints wrapper + errors + cause", async () => {
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
  // Node's util.inspect emits "[errors]: [ ... ]" with the children before
  // the cause. Assert that ordering so we don't regress to wrapper → cause →
  // children (the pre-fix queueing order in errors_to_append).
  const childIdx = stdout.indexOf("child");
  const causeIdx = stdout.indexOf("root cause");
  expect(childIdx).toBeGreaterThan(-1);
  expect(causeIdx).toBeGreaterThan(-1);
  expect(childIdx).toBeLessThan(causeIdx);
  expect(exitCode).toBe(0);
});
