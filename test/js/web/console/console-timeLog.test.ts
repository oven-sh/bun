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

// console.timeLog formats its arguments with user code, as console.log does. Its line reaches the stream
// when it is complete: a console call made from that code prints first, and a throw prints nothing.
it.concurrent("console.timeLog and console.timeEnd write their line when the line is complete", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const custom = Symbol.for("nodejs.util.inspect.custom");
        const error = new Error("boom");
        const logs = call => ({ [custom]() { call(); return "x"; } });
        console.time("t");
        let thrown;
        try { console.timeLog("t", "a", { [custom]() { throw error; } }, "z"); } catch (e) { thrown = e; }
        console.error(thrown === error ? "threw" : "did not throw");
        console.timeLog("t", "a", logs(() => console.error("inner")), "z");
        console.timeLog("t", "a", logs(() => console.timeLog("t", "inner")), "z");
        console.time("u");
        console.timeLog("t", "a", logs(() => console.timeEnd("u")), "z");
        console.error("outer", logs(() => console.timeLog("t", "inner")), "end");
        console.time("u");
        console.error("outer", logs(() => console.timeEnd("u")), "end");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr: stderr.replace(/^\[[\d.]+[mnµ]?s\] /gm, "[time] "), exitCode }).toEqual({
    stdout: "",
    stderr: [
      "threw",
      "inner",
      "[time] t a x z",
      "[time] t inner",
      "[time] t a x z",
      "[time] u",
      "[time] t a x z",
      "[time] t inner",
      "outer x end",
      "[time] u",
      "outer x end",
      "",
    ].join("\n"),
    exitCode: 0,
  });
});
