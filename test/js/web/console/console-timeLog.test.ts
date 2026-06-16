import { file, spawn } from "bun";
import { expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

it.concurrent("console.timeEnd with empty label emits exactly one trailing newline", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `console.time(""); console.timeEnd("");`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toMatch(/^\[[\d.]+[mnµ]?s\]\n$/);
  expect(exitCode).toBe(0);
});

it.concurrent("console.timeEnd with non-empty label emits exactly one trailing newline", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `console.time("abc"); console.timeEnd("abc");`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toMatch(/^\[[\d.]+[mnµ]?s\] abc\n$/);
  expect(exitCode).toBe(0);
});

// https://github.com/oven-sh/bun/issues/12031
it.concurrent("console.timeEnd writes to stdout, not stderr", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `console.time(); console.timeEnd();`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toMatch(/^\[[\d.]+[mnµ]?s\] default\n$/);
  expect(exitCode).toBe(0);
});

// https://github.com/oven-sh/bun/issues/12031
it.concurrent("console.timeLog writes to stdout, not stderr", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `console.time(); console.timeLog(); console.timeLog("default", "extra", "args");`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const lines = stdout.split("\n");
  expect(lines[0]).toMatch(/^\[[\d.]+[mnµ]?s\] default$/);
  expect(lines[1]).toMatch(/^\[[\d.]+[mnµ]?s\] default extra args$/);
  expect(lines[2]).toBe("");
  expect(lines.length).toBe(3);
  expect(exitCode).toBe(0);
});

it.concurrent("should log to console correctly", async () => {
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), join(import.meta.dir, "console-timeLog.js")],
    stdin: null,
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const [outText, errText, exitCode] = await Promise.all([stdout.text(), stderr.text(), exited]);
  expect(errText).toBe("");
  const expectedText = (await file(join(import.meta.dir, "console-timeLog.expected.txt")).text()).replaceAll(
    "\r\n",
    "\n",
  );

  expect(outText.replace(/^\[.+?s\] /gm, "")).toBe(expectedText.replace(/^\[.+?s\] /gm, ""));
  expect(exitCode).toBe(0);
});
