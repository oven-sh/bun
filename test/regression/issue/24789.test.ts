import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("stack traces should include all function calls, not be eliminated by tail call optimization", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
function err1() {
    let error = new Error('test error')
    return error
}

function err2() {
    let e = err1()
    return e
}

function err3() {
    let e = err2()
    return e
}

const error = err3()
console.log(error.stack)
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The stack trace should include all three functions: err1, err2, err3
  expect(stdout).toContain("at err1");
  expect(stdout).toContain("at err2");
  expect(stdout).toContain("at err3");

  expect(exitCode).toBe(0);
});

test("stack traces should be complete even with direct return statements", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
function err1() {
    return new Error('test error')
}

function err2() {
    return err1()
}

function err3() {
    return err2()
}

const error = err3()
console.log(error.stack)
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The stack trace should include all three functions: err1, err2, err3
  expect(stdout).toContain("at err1");
  expect(stdout).toContain("at err2");
  expect(stdout).toContain("at err3");

  expect(exitCode).toBe(0);
});
