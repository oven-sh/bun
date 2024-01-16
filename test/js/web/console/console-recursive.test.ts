// @known-failing-on-windows: 1 failing
import { file, spawn } from "bun";
import { expect, it } from "bun:test";
import { bunExe, bunEnv } from "harness";

it("should not hang when logging to stdout recursively", async () => {
  const { stdout, exited } = spawn({
    cmd: [bunExe(), import.meta.dir + "/console-recursive.js"],
    stdin: null,
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  expect(await exited).toBe(0);
  const outText = await new Response(stdout).text();
  const expectedText = await new Response(file(import.meta.dir + "/console-recursive.expected.txt")).text();
  expect(outText.replace(/^\[.+?s\] /gm, "")).toBe(expectedText.replace(/^\[.+?s\] /gm, ""));
});

it("should not hang when logging to stderr recursively", async () => {
  const { stderr, exited } = spawn({
    cmd: [bunExe(), import.meta.dir + "/console-recursive.js"],
    stdin: null,
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  expect(await exited).toBe(0);
  const outText = await new Response(stderr).text();
  const expectedText = await new Response(file(import.meta.dir + "/console-recursive.expected.txt")).text();
  expect(outText.replace(/^\[.+?s\] /gm, "")).toBe(expectedText.replace(/^\[.+?s\] /gm, ""));
});
