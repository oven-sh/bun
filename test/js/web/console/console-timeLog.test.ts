import { file, spawn } from "bun";
import { expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

// console.timeLog / console.timeEnd print `${label}: ${formatTime(ms)}` through
// console.log, i.e. to stdout:
// https://github.com/nodejs/node/blob/v24.0.0/lib/internal/console/constructor.js#L401-L407
// https://github.com/nodejs/node/blob/v24.0.0/lib/internal/util/debuglog.js#L155-L187
const elapsed = /^(.*?): \d+(?:\.\d{1,3})?(?:ms|s)/gm;

it.concurrent("console.timeEnd with empty label emits exactly one trailing newline", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `console.time(""); console.timeEnd("");`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toMatch(/^: \d+(\.\d{1,3})?ms\n$/);
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
  expect(stdout).toMatch(/^abc: \d+(\.\d{1,3})?ms\n$/);
  expect(exitCode).toBe(0);
});

it.concurrent("console.timeEnd / timeLog for a missing label warn instead of printing", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "--no-warnings", // only our listener prints
      "-e",
      `process.on("warning", w => process.stderr.write("warning: " + w.message + "\\n")); console.timeEnd("nope"); console.timeLog("nope"); console.time("dup"); console.time("dup"); console.timeEnd("dup");`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe(
    "warning: No such label 'nope' for console.timeEnd()\n" +
      "warning: No such label 'nope' for console.timeLog()\n" +
      "warning: Label 'dup' already exists for console.time()\n",
  );
  expect(stdout).toMatch(/^dup: \d+(\.\d{1,3})?ms\n$/);
  expect(exitCode).toBe(0);
});

it("should log to console correctly", async () => {
  await using proc = spawn({
    cmd: [bunExe(), join(import.meta.dir, "console-timeLog.js")],
    stdin: null,
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const expectedText = (await file(join(import.meta.dir, "console-timeLog.expected.txt")).text()).replaceAll(
    "\r\n",
    "\n",
  );

  expect(stderr).toBe("");
  expect(stdout.replace(elapsed, "$1: [time]")).toBe(expectedText.replace(elapsed, "$1: [time]"));
  expect(exitCode).toBe(0);
});
