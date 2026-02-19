import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/13992
// Bun was too aggressive with const reassignment errors in dead/unreachable code.
// Per the ECMAScript specification, reassignment to a const binding is a runtime
// TypeError, not a syntax error. Programs with unreachable const assignments should
// still run.

test("const reassignment after return (unreachable code)", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
function b(){
    return;
    obj = 2;
}
const obj = 1;
b();
console.log(obj);
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("1");
  expect(exitCode).toBe(0);
});

test("const reassignment inside if(false) (dead code)", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
function b() {
   if (false) {
    obj = 2;
   }
}
const obj = 1;
b();
console.log(obj);
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("1");
  expect(exitCode).toBe(0);
});

test("const reassignment in never-called function", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
"use strict";
function a() {
  obj = 2;
}
const obj = 1;
console.log(obj);
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("1");
  expect(exitCode).toBe(0);
});

test("const reassignment inside with statement resolves to property", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const obj = { obj: 2 };
with (obj) {
    obj = 10;
};
console.log(JSON.stringify(obj));
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe('{"obj":10}');
  expect(exitCode).toBe(0);
});

test("actual const reassignment still throws at runtime", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const obj = Math.random();
obj = 2;
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("TypeError");
  expect(exitCode).not.toBe(0);
});
