import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("destroying a frozen server socket emits the TypeError of the store that fails, then 'close'", async () => {
  const script = `
    const { once } = require("node:events");
    const http = require("node:http");
    process.on("uncaughtException", () => {});
    let turn = 0;
    const server = http.createServer((request, response) => {
      const socket = request.socket;
      if (turn++ === 0) {
        socket.prependListener("error", error => console.log("error", error.name, error.message));
        socket.once("close", () => console.log("close"));
      } else {
        Object.freeze(socket);
      }
      response.end("done");
    });
    (async () => {
      await once(server.listen(0, "127.0.0.1"), "listening");
      // The third request finds the socket frozen: it reaches no handler, and the connection ends.
      for (let index = 0; index < 3; index++) {
        const answer = await fetch("http://127.0.0.1:" + server.address().port);
        console.log(answer.status, JSON.stringify(await answer.text()));
      }
      await new Promise(resolve => setTimeout(resolve, 5));
      server.closeAllConnections();
      server.close();
    })();
  `;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "inherit" });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout.trim().split("\n")).toEqual([
    '200 "done"',
    '200 "done"',
    '200 ""',
    "error TypeError Attempted to assign to readonly property.",
    "close",
  ]);
  expect(exitCode).toBe(0);
});
