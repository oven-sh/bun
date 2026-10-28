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

it.concurrent("console.timeLog writes its line once, after its arguments are formatted", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const custom = Symbol.for("nodejs.util.inspect.custom");
       console.time("t");
       let outcome = "returned";
       try {
         console.timeLog("t", "first", { [custom]() { throw new Error("hook"); } }, "last");
       } catch (e) {
         outcome = "threw " + e.message;
       }
       console.error(outcome);
       console.timeLog("t", [1, { [custom]() { console.error("INNER"); return "x"; } }]);`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("");
  // The call that throws prints nothing. A message from a hook comes before the line that called it.
  expect(stderr).toMatch(/^threw hook\nINNER\n\[[\d.]+[mnµ]?s\] t \[ 1, x \]\n$/);
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
