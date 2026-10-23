import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { unsupported } from "./run-programs";

const files = {
  "main.cjs": String.raw`
const http = require("node:http");
const net = require("node:net");

process.on("uncaughtException", error => console.log("uncaught " + error.name));

let when;
const server = http.createServer((req, res) => {
  if (when === "ahead of end()") req.socket = null;
  res.on("finish", () => console.log("  finish"));
  res.on("close", () => console.log("  close"));
  res.end("ok");
  if (when === "behind end()") req.socket = null;
});

function get(socket) {
  return new Promise(resolve => {
    let text = "";
    socket.on("data", function onData(chunk) {
      text += chunk;
      if (!text.endsWith("ok")) return;
      socket.off("data", onData);
      resolve(text.split("\r\n")[0]);
    });
    socket.write("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
  });
}

server.listen(0, "127.0.0.1", async () => {
  for (when of ["never", "ahead of end()", "behind end()"]) {
    console.log(when);
    const socket = net.connect(server.address().port, "127.0.0.1");
    socket.setEncoding("latin1");
    await new Promise(resolve => socket.on("connect", resolve));
    for (let round = 0; round < 2; round++) {
      console.log("  " + (await get(socket)));
      await new Promise(resolve => setImmediate(resolve));
    }
    socket.destroy();
  }
  server.close();
  server.closeAllConnections();
});
`,
};

const served = ["  finish", "  close", "  HTTP/1.1 200 OK", "  finish", "  close", "  HTTP/1.1 200 OK"];
const expected = ["never", ...served, "ahead of end()", ...served, "behind end()", ...served, ""].join("\n");

test.skipIf(!!unsupported)(
  "a response finishes though the socket of its request was taken away",
  async () => {
    using dir = tempDir("aot-request-whose-socket-is-taken-away", files);
    const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", executable],
      String(dir),
      bunEnv,
    );
    expect({
      stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
      exitCode: built.exitCode,
    }).toEqual({ stderr: [], exitCode: 0 });
    const plain = await run([bunExe(), "run", "main.cjs"], String(dir), bunEnv);
    const compiled = await run([executable], String(dir), { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
    expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({ stdout: expected, exitCode: 0 });
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: expected, exitCode: 0 });
  },
  240_000,
);
