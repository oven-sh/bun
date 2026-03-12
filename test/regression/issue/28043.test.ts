import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/28043
// Piping between two spawned processes should work correctly.
// Previously on Linux, vfork() caused the parent to block until the child
// exec'd, so the second spawn() wouldn't start until the first child was
// already running. This meant processes spawned later weren't visible in
// the process table when earlier processes read it.
test("child_process spawn pipe between two processes works", async () => {
  // Use a deterministic test that doesn't depend on process table timing:
  // spawn "echo" piped to "grep" via JS - the data must flow correctly.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { spawn } = require('node:child_process');

      const echo = spawn('echo', ['hello world']);
      const grep = spawn('grep', ['hello']);

      echo.stdout.on('data', (data) => {
        grep.stdin.write(data);
      });

      echo.on('close', () => {
        grep.stdin.end();
      });

      let output = '';
      grep.stdout.on('data', (data) => {
        output += data.toString();
      });

      grep.on('close', (code) => {
        // grep should find "hello" in the piped data and exit 0
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
