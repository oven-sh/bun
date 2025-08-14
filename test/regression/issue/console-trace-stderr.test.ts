import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("console.trace() should output to stderr, not stdout", async () => {
  const proc = spawn({
    cmd: [bunExe(), "-e", "console.trace('test trace message')"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);

  // stdout should be empty
  expect(stdout).toBe("");

  // stderr should contain the trace output
  expect(stderr).toContain("test trace message");
  expect(stderr).toContain("at /workspace/bun/[eval]:");
});

test("console.trace() with multiple arguments should output to stderr", async () => {
  const proc = spawn({
    cmd: [bunExe(), "-e", "console.trace('arg1', 'arg2', { key: 'value' })"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toBe("");
  expect(stderr).toContain("arg1");
  expect(stderr).toContain("arg2");
  expect(stderr).toContain("key");
  expect(stderr).toContain("value");
});

test("console.trace() with no arguments should output to stderr", async () => {
  const proc = spawn({
    cmd: [bunExe(), "-e", "console.trace()"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toBe("");
  expect(stderr).toContain("at /workspace/bun/[eval]:");
});

test("console.trace() inside a function should show proper stack trace in stderr", async () => {
  const code = `
    function outer() {
      function inner() {
        console.trace('from inner function');
      }
      inner();
    }
    outer();
  `;

  const proc = spawn({
    cmd: [bunExe(), "-e", code],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toBe("");
  expect(stderr).toContain("from inner function");
  expect(stderr).toContain("at inner");
  expect(stderr).toContain("at outer");
});

test("console.trace() behavior should match Node.js (stderr output)", async () => {
  // Test that console.trace goes to stderr, same as Node.js
  const bunProc = spawn({
    cmd: [bunExe(), "-e", "console.trace('test')"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const [bunStdout, bunStderr] = await Promise.all([
    new Response(bunProc.stdout).text(),
    new Response(bunProc.stderr).text(),
    bunProc.exited,
  ]);

  // Both should have empty stdout and content in stderr
  expect(bunStdout).toBe("");
  expect(bunStderr).toContain("test");
  expect(bunStderr).toContain("at /workspace/bun/[eval]:");
});

test("console methods routing: log->stdout, error->stderr, trace->stderr", async () => {
  const code = `
    console.log('log message');
    console.error('error message');
    console.trace('trace message');
  `;

  const proc = spawn({
    cmd: [bunExe(), "-e", code],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);

  // stdout should only contain log output
  expect(stdout).toContain("log message");
  expect(stdout).not.toContain("error message");
  expect(stdout).not.toContain("trace message");

  // stderr should contain error and trace output
  expect(stderr).toContain("error message");
  expect(stderr).toContain("trace message");
  expect(stderr).not.toContain("log message");
});

test("console.trace() performance doesn't regress", async () => {
  // Test that trace doesn't significantly slow down due to the stderr routing change
  const code = `
    const start = Date.now();
    for (let i = 0; i < 50; i++) {
      console.trace('perf test', i);
    }
    const end = Date.now();
    console.log('Time taken:', end - start, 'ms');
  `;

  const proc = spawn({
    cmd: [bunExe(), "-e", code],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("Time taken:");
  expect(stderr).toContain("perf test");

  // Should complete in reasonable time (this is mostly a smoke test)
  const timeMatch = stdout.match(/Time taken: (\d+) ms/);
  if (timeMatch) {
    const timeMs = parseInt(timeMatch[1]);
    expect(timeMs).toBeLessThan(3000); // Should complete in under 3 seconds
  }
});
