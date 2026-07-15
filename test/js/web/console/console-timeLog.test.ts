import { file, spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

// Matches Node.js: `label: 0.123ms`, `label: 1.234s`, `label: 1:02.345 (m:ss.mmm)`, ...
const DURATION = /[\d.]+ms|[\d.]+s|[\d:.]+ \((?:h:mm|m):ss\.mmm\)/;

it.concurrent("console.time/timeLog/timeEnd write to stdout, not stderr", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `console.time("t"); console.timeLog("t", "x"); console.timeEnd("t");`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.split("\n")).toEqual([
    expect.stringMatching(new RegExp(String.raw`^t: ${DURATION.source} x$`)),
    expect.stringMatching(new RegExp(String.raw`^t: ${DURATION.source}$`)),
    "",
  ]);
  expect(exitCode).toBe(0);
});

it.concurrent("console.timeEnd with empty label emits exactly one trailing newline", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `console.time(""); console.timeEnd("");`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toMatch(new RegExp(String.raw`^: ${DURATION.source}\n$`));
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
  expect(stdout).toMatch(new RegExp(String.raw`^abc: ${DURATION.source}\n$`));
  expect(exitCode).toBe(0);
});

it.concurrent("console.timeEnd prints ms below one second", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `console.time("fast"); console.timeEnd("fast");`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toMatch(/^fast: \d+(?:\.\d{1,3})?ms\n$/);
  expect(exitCode).toBe(0);
});

it.concurrent("console.timeEnd scales to seconds at >=1000ms", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      // Busy-wait just past one second so the elapsed time lands in [1000, 2000)ms.
      `console.time("sc"); const t0=Date.now(); while (Date.now()-t0 < 1100) {} console.timeEnd("sc");`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toMatch(/^sc: 1\.\d{3}s\n$/);
  expect(exitCode).toBe(0);
});

it.concurrent("console.timeEnd uses the default label when none is given", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `console.time(); console.timeEnd();`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toMatch(new RegExp(String.raw`^default: ${DURATION.source}\n$`));
  expect(exitCode).toBe(0);
});

describe("duplicate / unknown labels", () => {
  it.concurrent("console.time on an existing label keeps the original timer", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `console.time("d"); const t0=Date.now(); while (Date.now()-t0 < 1100) {} console.time("d"); console.timeEnd("d");`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Node emits a warning on duplicate console.time; Bun currently does not.
    // Either way the original timer must be kept, so the duration is >= 1s.
    expect(stdout).toMatch(/^d: 1\.\d{3}s\n$/);
    expect(exitCode).toBe(0);
  });

  it.concurrent("console.timeEnd / timeLog on an unknown label produce no stdout", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `console.timeLog("nope"); console.timeEnd("nope");`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
  });
});

it("should log to console correctly", async () => {
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

  const normalize = (s: string) => s.replace(new RegExp(String.raw`^(.*?): ${DURATION.source}`, "gm"), "$1: <time>");
  expect(normalize(outText)).toBe(normalize(expectedText));
  expect(exitCode).toBe(0);
});
