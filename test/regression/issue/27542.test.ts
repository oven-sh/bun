import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Test that alert(), confirm(), and prompt() accept \r (carriage return) as
// a line ending. In raw terminal mode (e.g. the REPL), pressing Enter sends
// \r instead of \n. Previously these functions only checked for \n, causing
// them to hang indefinitely in the REPL.

test("alert() accepts \\r as line ending", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "alert('Hello'); console.error('done')"],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  // Send \r (carriage return) instead of \n to simulate raw terminal mode
  proc.stdin.write("\r");
  proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("[Enter]");
  expect(stderr).toBe("done\n");
  expect(exitCode).toBe(0);
});

test("confirm() accepts \\r as line ending (default no)", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "const r = confirm('OK?'); console.error(r)"],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  // Bare \r should be treated as Enter (default = no)
  proc.stdin.write("\r");
  proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("false\n");
  expect(exitCode).toBe(0);
});

test("confirm() accepts y + \\r as yes", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "const r = confirm('OK?'); console.error(r)"],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  // y followed by \r should be treated as "yes"
  proc.stdin.write("y\r");
  proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("true\n");
  expect(exitCode).toBe(0);
});

test("prompt() accepts \\r as line ending (returns default)", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "const r = prompt('Name?', 'default'); console.error(r)"],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  // Bare \r should be treated as Enter (return default value)
  proc.stdin.write("\r");
  proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("default\n");
  expect(exitCode).toBe(0);
});

test("prompt() accepts input + \\r as line ending", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "const r = prompt('Name?'); console.error(r)"],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  // Text followed by \r should return the text
  proc.stdin.write("hello\r");
  proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("hello\n");
  expect(exitCode).toBe(0);
});

// Tests for \r\n (Windows cooked console mode) to ensure the trailing \n is consumed
// and doesn't leak into subsequent calls.

test("confirm() accepts \\r\\n as line ending (default no)", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "const r = confirm('OK?'); console.error(r)"],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  // Send \r\n (Windows cooked mode) - should be treated as Enter (default = no)
  proc.stdin.write("\r\n");
  proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("false\n");
  expect(exitCode).toBe(0);
});

test("confirm() accepts y + \\r\\n as yes", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "const r = confirm('OK?'); console.error(r)"],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  // y followed by \r\n should be treated as "yes"
  proc.stdin.write("y\r\n");
  proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("true\n");
  expect(exitCode).toBe(0);
});

test("sequential prompt() calls with \\r\\n don't skip", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      "const a = prompt('first?', 'def1'); const b = prompt('second?', 'def2'); console.error(a + ',' + b)",
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  // Send \r\n for first prompt (returns default), then "hello\r\n" for second
  proc.stdin.write("\r\n");
  proc.stdin.write("hello\r\n");
  proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("def1,hello\n");
  expect(exitCode).toBe(0);
});

test("prompt() accepts \\r\\n as line ending (returns default)", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "const r = prompt('Name?', 'default'); console.error(r)"],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  // Send \r\n (Windows cooked mode) - should return default
  proc.stdin.write("\r\n");
  proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("default\n");
  expect(exitCode).toBe(0);
});

test("prompt() accepts input + \\r\\n as line ending", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "const r = prompt('Name?'); console.error(r)"],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  // Text followed by \r\n should return the text
  proc.stdin.write("hello\r\n");
  proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("hello\n");
  expect(exitCode).toBe(0);
});
