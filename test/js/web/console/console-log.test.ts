import { file, spawn } from "bun";
import { expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";
it("should log to console correctly", async () => {
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), join(import.meta.dir, "console-log.js")],
    stdin: null,
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  expect(await exited).toBe(0);
  expect((await new Response(stderr).text()).replaceAll("\r\n", "\n")).toBe("uh oh\n");
  expect((await new Response(stdout).text()).replaceAll("\r\n", "\n")).toBe(
    (await new Response(file(join(import.meta.dir, "console-log.expected.txt"))).text()).replaceAll("\r\n", "\n"),
  );
});
