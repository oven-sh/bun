import { file, spawn } from "bun";
import { consoleTableSizes } from "bun:internal-for-testing";
import { expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

it.concurrent("console.timeEnd with empty label emits exactly one trailing newline", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `console.time(""); console.timeEnd("");`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("");
  expect(stderr).toMatch(/^\[[\d.]+[mnµ]?s\]\n$/);
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
  expect(stdout).toBe("");
  expect(stderr).toMatch(/^\[[\d.]+[mnµ]?s\] abc\n$/);
  expect(exitCode).toBe(0);
});

it.concurrent("an ended timer and a reset count start again from nothing", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        console.time("a");
        console.timeEnd("a");
        console.error("ended:");
        console.timeEnd("a");
        console.timeLog("a", "x");
        console.error("started again:");
        console.time("a");
        console.timeLog("a", "y");
        console.timeEnd("a");

        console.count("a");
        console.count("a");
        console.count("b");
        console.countReset("a");
        console.countReset("never counted");
        console.count("a");
        console.count("b");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr.replace(/^\[[\d.]+[mnµ]?s\]/gm, "[time]")).toBe(
    "[time] a\nended:\nstarted again:\n[time] a y\n[time] a\n",
  );
  expect(stdout).toBe("a: 1\na: 2\nb: 1\na: 1\nb: 2\n");
  expect(exitCode).toBe(0);
});

it("consoleTableSizes() counts the running timers and the counted labels", () => {
  // Labels that no earlier run of this test in this process has used.
  const run = randomUUID();
  const before = consoleTableSizes();
  console.time(run + " a");
  console.time(run + " b");
  console.count(run + " c");
  const started = consoleTableSizes();
  console.timeEnd(run + " a");
  console.timeEnd(run + " b");
  console.countReset(run + " c");
  expect({
    timers: started.timerEntries - before.timerEntries,
    counts: started.countEntries - before.countEntries,
  }).toEqual({ timers: 2, counts: 1 });
  expect(started.timerCapacity).toBeGreaterThanOrEqual(started.timerEntries);
  expect(started.countCapacity).toBeGreaterThanOrEqual(started.countEntries);
});

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
