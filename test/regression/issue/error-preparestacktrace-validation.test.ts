import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("Error.prepareStackTrace should throw TypeError when called with missing arguments", async () => {
  const proc = spawn({
    cmd: [bunExe(), "-e", "const e = new Error(); Error.prepareStackTrace(e);"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).not.toBe(0);
  expect(stderr).toContain("TypeError: Second argument must be an Array of CallSite objects");
  expect(stderr).not.toContain("Segmentation fault");
  expect(stderr).not.toContain("panic(main thread)");
});

test("Error.prepareStackTrace should throw TypeError when called with no arguments", async () => {
  const proc = spawn({
    cmd: [bunExe(), "-e", "Error.prepareStackTrace();"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).not.toBe(0);
  expect(stderr).toContain("TypeError: First argument must be an Error object");
});

test("Error.prepareStackTrace should throw TypeError when first argument is not an Error", async () => {
  const proc = spawn({
    cmd: [bunExe(), "-e", "Error.prepareStackTrace('not an error', []);"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).not.toBe(0);
  expect(stderr).toContain("TypeError: First argument must be an Error object");
});

test("Error.prepareStackTrace should throw TypeError when second argument is not an Array", async () => {
  const proc = spawn({
    cmd: [bunExe(), "-e", "const e = new Error(); Error.prepareStackTrace(e, 'not an array');"],
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).not.toBe(0);
  expect(stderr).toContain("TypeError: Second argument must be an Array of CallSite objects");
});

test("Error.prepareStackTrace should work correctly with proper arguments", async () => {
  const proc = spawn({
    cmd: [bunExe(), "-e", "const e = new Error('test message'); console.log(Error.prepareStackTrace(e, []));"],
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
  expect(stdout).toContain("Error: test message");
  expect(stderr).toBe("");
});

test("Error.prepareStackTrace should work with Error instance containing stack", async () => {
  const code = `
    const e = new Error('test with stack');
    Error.captureStackTrace(e);
    try {
      console.log(Error.prepareStackTrace(e, []));
    } catch (err) {
      console.error('Error:', err.message);
    }
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
  expect(stdout).toContain("Error: test with stack");
});

test("Error.prepareStackTrace should handle various Error types", async () => {
  const code = `
    const types = [
      new Error('base error'),
      new TypeError('type error'),
      new ReferenceError('ref error'),
      new SyntaxError('syntax error')
    ];
    
    for (const err of types) {
      try {
        const result = Error.prepareStackTrace(err, []);
        console.log('OK:', result.split('\\n')[0]);
      } catch (e) {
        console.log('FAIL:', e.message);
      }
    }
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
  expect(stdout).toContain("OK: Error: base error");
  expect(stdout).toContain("OK: Error: type error");
  expect(stdout).toContain("OK: Error: ref error");
  expect(stdout).toContain("OK: Error: syntax error");
});

test("Error.prepareStackTrace edge case: null and undefined arguments", async () => {
  const code = `
    try {
      Error.prepareStackTrace(null, []);
    } catch (e) {
      console.log('null error:', e.message);
    }
    
    try {
      Error.prepareStackTrace(undefined, []);
    } catch (e) {
      console.log('undefined error:', e.message);
    }
    
    try {
      const err = new Error('test');
      Error.prepareStackTrace(err, null);
    } catch (e) {
      console.log('null callsites:', e.message);
    }
    
    try {
      const err = new Error('test');
      Error.prepareStackTrace(err, undefined);
    } catch (e) {
      console.log('undefined callsites:', e.message);
    }
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
  expect(stdout).toContain("null error: First argument must be an Error object");
  expect(stdout).toContain("undefined error: First argument must be an Error object");
  expect(stdout).toContain("null callsites: Second argument must be an Array of CallSite objects");
  expect(stdout).toContain("undefined callsites: Second argument must be an Array of CallSite objects");
});

test("Error.prepareStackTrace should not crash with complex nested calls", async () => {
  const code = `
    function createDeepError(depth) {
      if (depth === 0) {
        const e = new Error('deep error');
        Error.captureStackTrace(e);
        return e;
      }
      return createDeepError(depth - 1);
    }
    
    try {
      const deepError = createDeepError(5);
      const result = Error.prepareStackTrace(deepError, []);
      console.log('Success: Got result with length', result.length);
    } catch (e) {
      console.log('Failed:', e.message);
    }
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
  expect(stdout).toContain("Success: Got result with length");
  expect(stderr).toBe("");
});
