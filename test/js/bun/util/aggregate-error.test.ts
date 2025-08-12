import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("AggregateError displays with proper formatting", async () => {
  const code = `
    function foo() {
      return new Error("foo!");
    }
    
    function bar() {
      return new Error("bar!");
    }
    
    throw new AggregateError([foo(), bar()], "qux!");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(1);

  // Should display the AggregateError name and message
  expect(stderr).toContain("AggregateError: qux!");

  // Should show it's an AggregateError with grouped errors
  expect(stderr).toContain("[errors]:");

  // Should still show the individual error messages
  expect(stderr).toContain("error: foo!");
  expect(stderr).toContain("error: bar!");
});

test("AggregateError with empty errors array", async () => {
  const code = `throw new AggregateError([], "no errors");`;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(1);
  expect(stderr).toContain("AggregateError: no errors");
});

test("AggregateError with single error", async () => {
  const code = `throw new AggregateError([new Error("single")], "wrapper");`;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(1);
  expect(stderr).toContain("AggregateError: wrapper");
  expect(stderr).toContain("[errors]:");
  expect(stderr).toContain("error: single");
});

test("AggregateError with non-Error objects", async () => {
  const code = `throw new AggregateError([new Error("real error"), "string error", 42], "mixed");`;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(1);
  expect(stderr).toContain("AggregateError: mixed");
  expect(stderr).toContain("[errors]:");
  expect(stderr).toContain("error: real error");
  // Non-Error values should still be displayed somehow
  expect(stderr).toContain("string error");
  expect(stderr).toContain("42");
});

test("Nested AggregateError", async () => {
  const code = `
    const inner = new AggregateError([new Error("inner1"), new Error("inner2")], "inner aggregate");
    throw new AggregateError([inner, new Error("outer")], "outer aggregate");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(1);
  expect(stderr).toContain("AggregateError: outer aggregate");
  expect(stderr).toContain("[errors]:");
  // The nested AggregateError should also be properly displayed
  expect(stderr).toContain("AggregateError: inner aggregate");
});
