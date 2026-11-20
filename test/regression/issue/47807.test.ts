import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/47807
// The child never reads its stdin, so the pipe fills and a write stays pending. destroy() waited
// for that write, which a child that stays never takes: 'close' did not come, `closed` stayed
// false, and stream.finished() did not call back. (Node.js calls it back with the error of the
// write that it cancels.)
test("child.stdin.destroy() emits 'close' while a write is pending and the child stays", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      // The child stays until its channel closes: the parent lets it go once stdin has closed.
      `const { spawn } = require("node:child_process");
       const { finished } = require("node:stream");
       const stays = "process.on('message', () => {});";
       const child = spawn(process.execPath, ["-e", stays], { stdio: ["pipe", "ignore", "inherit", "ipc"] });
       const stdin = child.stdin;
       stdin.on("error", () => {});
       const chunk = Buffer.alloc(64 * 1024);
       while (stdin.write(chunk)) {}
       let finishedCalledBack = false;
       finished(stdin, () => (finishedCalledBack = true));
       stdin.once("close", () => {
         console.log(JSON.stringify({ closed: stdin.closed, destroyed: stdin.destroyed, finishedCalledBack }));
         child.disconnect();
       });
       stdin.destroy();`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout && JSON.parse(stdout), stderr, exitCode }).toEqual({
    stdout: { closed: true, destroyed: true, finishedCalledBack: true },
    stderr: "",
    exitCode: 0,
  });
});
