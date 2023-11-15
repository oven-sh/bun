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
      BUN_DEBUG_QUIET_LOGS: "1",
    },
  });
  expect(await exited).toBe(0);
  const outText = await new Response(stderr).text();
  const expectedText = await new Response(file(import.meta.dir + "/console-timeLog.expected.txt")).text();
  expect(outText.replace(/^\[.+?s\] /gm, "")).toBe(expectedText.replace(/^\[.+?s\] /gm, ""));
});
