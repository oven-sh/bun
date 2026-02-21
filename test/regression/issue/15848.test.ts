import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/15848
// Optional chaining in assignment target should be a SyntaxError

test("optional chaining dot access in for-of assignment target", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `for ([{set y(val){console.log("accessed")}}?.y = 0] of [[]]);`],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("Invalid assignment target");
  expect(stdout).not.toContain("accessed");
  expect(exitCode).not.toBe(0);
});

test("optional chaining bracket access in assignment", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `({})?.["x"] = 1`],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("Invalid assignment target");
  expect(exitCode).not.toBe(0);
});

test("array literal optional chaining in assignment", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `[1]?.x = 0`],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("Invalid assignment target");
  expect(exitCode).not.toBe(0);
});

test("class expression optional chaining in assignment", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `(class {})?.x = 0`],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("Invalid assignment target");
  expect(exitCode).not.toBe(0);
});

test("function expression optional chaining in assignment", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `(function(){})?.x = 0`],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("Invalid assignment target");
  expect(exitCode).not.toBe(0);
});

test("valid optional chaining is not affected", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const obj = { a: { b: 1 } };
      console.log(obj?.a?.b);
      console.log({}?.x);
      console.log([1]?.length);
    `,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("1");
  expect(exitCode).toBe(0);
});
