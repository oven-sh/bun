import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/14217
// Runtime DCE incorrectly removes `new WeakMap([])` (and similar) after the
// global constructor has been reassigned.

test("reassigned WeakMap constructor is not DCE'd", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `WeakMap = function() { console.log("WeakMap called"); }; new WeakMap([]);`],
    env: bunEnv,
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toContain("WeakMap called");
  expect(exitCode).toBe(0);
});

test("reassigned Map constructor is not DCE'd", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `Map = function() { console.log("Map called"); }; new Map([]);`],
    env: bunEnv,
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toContain("Map called");
  expect(exitCode).toBe(0);
});

test("reassigned Set constructor is not DCE'd", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `Set = function() { console.log("Set called"); }; new Set([]);`],
    env: bunEnv,
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toContain("Set called");
  expect(exitCode).toBe(0);
});

test("reassigned Date constructor is not DCE'd", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `Date = function() { console.log("Date called"); }; new Date();`],
    env: bunEnv,
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toContain("Date called");
  expect(exitCode).toBe(0);
});

test("reassigned WeakSet constructor is not DCE'd", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `WeakSet = function() { console.log("WeakSet called"); }; new WeakSet([]);`],
    env: bunEnv,
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toContain("WeakSet called");
  expect(exitCode).toBe(0);
});

test("reassigned Error constructor preserves new.target", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `Error = function() { console.log(new.target ? "has new.target" : "no new.target"); }; new Error();`,
    ],
    env: bunEnv,
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toContain("has new.target");
  expect(exitCode).toBe(0);
});

test("reassigned Array constructor is not replaced with literal", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `Array = function() { console.log("Array called"); }; new Array();`],
    env: bunEnv,
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toContain("Array called");
  expect(exitCode).toBe(0);
});

test("reassigned Object constructor is not replaced with literal", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `Object = function() { console.log("Object called"); }; new Object();`],
    env: bunEnv,
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toContain("Object called");
  expect(exitCode).toBe(0);
});
