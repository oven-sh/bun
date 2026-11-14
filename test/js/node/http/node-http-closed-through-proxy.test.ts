import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test.each([
  "new Proxy(socket, {})",
  "new Proxy(new Proxy(socket, {}), {})",
  "new Proxy(socket, { ownKeys: Reflect.ownKeys })",
])("Object.freeze(%s) does what Object.freeze(socket) does", async wrapped => {
  const script = (frozen: string) => `
      const { once } = require("node:events");
      const http = require("node:http");
      const tell = error => error.name + " in " + error.stack.split("\\n")[1].trim().split(" ")[1];
      process.on("uncaughtException", error => console.log("uncaught", tell(error)));
      const server = http.createServer((request, response) => {
        const socket = request.socket;
        socket.on("error", error => console.log("error", tell(error)));
        socket.on("close", () => console.log("close"));
        socket.setTimeout(60_000);
        response.end("done");
        Object.freeze(${frozen});
      });
      (async () => {
        await once(server.listen(0, "127.0.0.1"), "listening");
        console.log(await (await fetch("http://127.0.0.1:" + server.address().port)).text());
        server.closeAllConnections();
        server.close();
      })();
    `;
  const run = async (frozen: string) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script(frozen)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    return { lines: stdout.trim().split("\n"), exitCode };
  };
  const [direct, throughProxy] = await Promise.all([run("socket"), run(wrapped)]);
  expect(direct.lines).toContain("close");
  expect(throughProxy).toEqual(direct);
});
