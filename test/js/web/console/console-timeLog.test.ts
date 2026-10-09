import { file, spawn } from "bun";
import { expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
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

// stderr is a regular file. The inspect hook of an argument reads the size of that file while console.timeLog
// still formats. The `[1.23ms] label` prefix used to leave on its own, before the arguments were formatted.
it.concurrent("console.timeLog writes its prefix and its arguments as one line", async () => {
  using dir = tempDir("console-timelog", {});
  const path = (name: string) => join(String(dir), name);
  await using proc = spawn({
    cmd: [
      bunExe(),
      "-e",
      `const fs = require("fs");
       let during;
       const probe = { [Symbol.for("nodejs.util.inspect.custom")]() { during = fs.fstatSync(2).size; return "probe"; } };
       console.time("label");
       console.timeLog("label", probe, "end");
       fs.writeFileSync(process.env.REPORT, JSON.stringify({ during }));`,
    ],
    env: { ...bunEnv, REPORT: path("report.json") },
    stdout: "pipe",
    stderr: file(path("stderr.txt")),
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("");
  expect(await file(path("stderr.txt")).text()).toMatch(/^\[[\d.]+m?s\] label probe end\n$/);
  expect(await file(path("report.json")).json()).toEqual({ during: 0 });
  expect(exitCode).toBe(0);
});

it.concurrent("console.timeLog writes nothing when an argument throws while it is formatted", async () => {
  await using proc = spawn({
    cmd: [
      bunExe(),
      "-e",
      `const hook = { [Symbol.for("nodejs.util.inspect.custom")]() { throw new Error("boom"); } };
       console.time("label");
       try {
         console.timeLog("label", "before", hook, "after");
       } catch (e) {
         console.log("caught", e.message);
       }`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr }).toEqual({ stdout: "caught boom\n", stderr: "" });
  expect(exitCode).toBe(0);
});
