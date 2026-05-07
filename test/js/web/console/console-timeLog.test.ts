import { file, spawn } from "bun";
import { expect, it, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";
it("should log to console correctly", async () => {
  const { stderr, exited } = spawn({
    cmd: [bunExe(), join(import.meta.dir, "console-timeLog.js")],
    stdin: null,
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  expect(await exited).toBe(0);
  const outText = await stderr.text();
  const expectedText = (await file(join(import.meta.dir, "console-timeLog.expected.txt")).text()).replaceAll(
    "\r\n",
    "\n",
  );

  expect(outText.replace(/^\[.+?s\] /gm, "")).toBe(expectedText.replace(/^\[.+?s\] /gm, ""));
});

// https://github.com/oven-sh/bun/issues/30017
// `console.timeEnd()` (and `console.timeLog()` / `console.count()`) must apply
// the indentation produced by `console.group()`, per the WHATWG Console spec.
test.concurrent("console.timeEnd applies console.group indent (#30017)", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      "console.group('groupName'); console.time('timerName'); console.timeEnd('timerName'); console.groupEnd();",
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Bun prints `console.time*` output to stderr; either way, the timer line
  // must start with two spaces (one indent level) before the elapsed bracket.
  const combined = stdout + stderr;
  expect(combined).toMatch(/^groupName\n\s{2}\[.+?ms\] timerName\n/m);
  expect(exitCode).toBe(0);
});

test.concurrent("console.timeEnd indents per nested console.group (#30017)", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      "console.group('a'); console.group('b'); console.time('t'); console.timeEnd('t'); console.groupEnd(); console.groupEnd();",
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const combined = stdout + stderr;
  // Two groups deep -> 4-space indent
  expect(combined).toMatch(/^\s{4}\[.+?ms\] t\n/m);
  expect(exitCode).toBe(0);
});

test.concurrent("console.timeLog and console.count also indent per console.group (#30017)", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      "console.group('g'); console.time('t'); console.timeLog('t'); console.count('c'); console.groupEnd();",
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const combined = stdout + stderr;
  expect(combined).toMatch(/^\s{2}\[.+?ms\] t\n/m);
  expect(combined).toMatch(/^\s{2}c: 1\n/m);
  expect(exitCode).toBe(0);
});

test.concurrent("console.timeEnd without an active group has no indent (#30017)", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "console.time('t'); console.timeEnd('t');"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const combined = stdout + stderr;
  // No leading whitespace before the bracket when no group is active.
  expect(combined).toMatch(/^\[.+?ms\] t\n/m);
  expect(exitCode).toBe(0);
});
