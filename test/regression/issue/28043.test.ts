import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/28043
// Piping between two spawned processes should work correctly.
// Previously on Linux, vfork() caused the parent to block until the child
// exec'd, so the second spawn() wouldn't start until the first child was
// already running. This meant processes spawned later weren't visible in
// the process table when earlier processes read it.
test("child_process spawn pipe between two processes works", async () => {
  // Spawn grep first so it exists in the process table before echo runs,
  // then spawn echo and pipe its stdout directly to grep's stdin.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { spawn } = require('node:child_process');

      const grep = spawn('grep', ['hello']);
      const echo = spawn('echo', ['hello world']);

      echo.stdout.pipe(grep.stdin);

      let output = '';
      grep.stdout.on('data', (data) => {
        output += data.toString();
      });

      grep.on('close', (code) => {
        process.stdout.write(output);
        process.exit(code ?? 1);
      });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("hello world");
  expect(exitCode).toBe(0);
});

test("child_process spawn stdin.write and stdin.end work correctly", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { spawn } = require('node:child_process');

      const grep = spawn('grep', ['hello']);

      let output = '';
      grep.stdout.on('data', (data) => {
        output += data.toString();
      });

      grep.on('close', (code) => {
        process.stdout.write(output);
        process.exit(code ?? 1);
      });

      grep.stdin.write('hello world\\n');
      grep.stdin.write('goodbye\\n');
      grep.stdin.end();
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("hello world");
  expect(exitCode).toBe(0);
});

test("child_process spawn exec failure is observable", async () => {
  // With fork() + non-blocking errpipe, exec failures may be caught
  // synchronously (if the child fails before the parent reads) or
  // asynchronously (child exits with code 127). Either way, the failure
  // must be observable to the user.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { spawn } = require('node:child_process');

      const child = spawn('/nonexistent_binary_28043');

      child.on('error', (err) => {
        process.stdout.write('error:' + err.code + '\\n');
      });

      child.on('close', (code) => {
        process.stdout.write('exit:' + code + '\\n');
        process.exit(0);
      });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The failure must be observable: either via 'error' event (ENOENT) if
  // the errpipe caught it synchronously, or via exit code 127 if the child
  // failed exec asynchronously after the parent returned.
  const hasError = stdout.includes("error:ENOENT");
  const hasExit127 = stdout.includes("exit:127");
  expect(hasError || hasExit127).toBe(true);
  expect(exitCode).toBe(0);
});
