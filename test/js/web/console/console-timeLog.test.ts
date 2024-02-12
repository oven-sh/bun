import { file, spawn } from "bun";
import { expect, it } from "bun:test";
import { bunExe, bunEnv } from "harness";

it("should log to console correctly", async () => {
  const { stderr, exited } = spawn({
    cmd: [bunExe(), import.meta.dir + "/console-timeLog.js"],
    stdin: null,
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  expect(await exited).toBe(0);
  const outText = await new Response(stderr).text();
  const expectedText = (await file(import.meta.dir + "/console-timeLog.expected.txt").text()).replaceAll("\r\n", "\n");
  expect(outText.replace(/^\[.+?s\] /gm, "")).toBe(expectedText.replace(/^\[.+?s\] /gm, ""));
});
