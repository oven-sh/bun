import { file, spawn } from "bun";
import { expect, it } from "bun:test";
import { bunExe } from "bunExe";

it("should log to console correctly", async () => {
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), import.meta.dir + "/console-log.js"],
    stdin: null,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      BUN_DEBUG_QUIET_LOGS: "1",
    },
  });
  expect(await exited).toBe(0);
  expect(await new Response(stderr).text()).toBe("uh oh\n");
  expect(await new Response(stdout).text()).toBe(
    await new Response(file(import.meta.dir + "/console-log.expected.txt")).text(),
  );
});
