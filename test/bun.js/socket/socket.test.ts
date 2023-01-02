import { expect, it } from "bun:test";
import { bunExe } from "../bunExe";
import { spawn } from "bun";

it("should keep process alive only when active", async () => {
  const { exited, stdout, stderr } = spawn({
    cmd: [ bunExe(), "echo.js" ],
    cwd: import.meta.dir,
    stdout: "pipe",
    stdin: null,
    stderr: "pipe",
    env: {
      BUN_DEBUG_QUIET_LOGS: 1,
    },
  });
  expect(await exited).toBe(0);
  expect(await new Response(stderr).text()).toBe("");
  var lines = (await new Response(stdout).text()).split(/\r?\n/);
  expect(lines.filter(function(line) {
    return line.startsWith("[Server]");
  })).toEqual([
    "[Server] OPENED",
    "[Server] GOT request",
    "[Server] CLOSED",
  ]);
  expect(lines.filter(function(line) {
    return line.startsWith("[Client]");
  })).toEqual([
    "[Client] OPENED",
    "[Client] GOT response",
    "[Client] ENDED",
    "[Client] CLOSED",
  ]);
});
