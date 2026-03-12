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
