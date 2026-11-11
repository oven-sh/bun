import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Three requests on one connection. The listener changes the socket at the first one.
const script = /* js */ `
  const http = require("node:http");
  const net = require("node:net");
  const { once } = require("node:events");
  const change = process.argv[1];
  process.on("uncaughtException", error => console.log("uncaught", error.name));
  let count = 0;
  const server = http.createServer((req, res) => {
    const socket = req.socket;
    if (++count === 1) {
      if (change === "removeListener of the socket") {
        const original = socket.removeListener;
        socket.removeListener = function (name, listener) {
          console.log("removeListener", name);
          return original.call(this, name, listener);
        };
      } else if (change === "removeListener of EventEmitter.prototype") {
        const prototype = require("node:events").prototype;
        const original = prototype.removeListener;
        prototype.removeListener = function (name, listener) {
          if (this === socket) console.log("removeListener", name);
          return original.call(this, name, listener);
        };
      } else if (change === "server of the socket") {
        socket.server = null;
      } else {
        socket._readableState = null;
      }
    }
    res.end("ok");
  });
  (async () => {
    await once(server.listen(0), "listening");
    const client = net.connect(server.address().port);
    const closed = once(client, "close").then(() => null);
    for (let i = 0; i < 3; i++) {
      client.write("GET / HTTP/1.1\\r\\nHost: a\\r\\n\\r\\n");
      const chunk = await Promise.race([once(client, "data").then(([chunk]) => String(chunk)), closed]);
      if (chunk === null) {
        console.log("answered by closing");
        break;
      }
      console.log("answered", chunk.split("\\r\\n")[0], JSON.stringify(chunk.split("\\r\\n\\r\\n").slice(1).join(" ")));
      await new Promise(resolve => setImmediate(resolve));
    }
    client.destroy();
    server.close();
  })();
`;

async function run(change: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script, change],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim().split("\n"), stderr, exitCode };
}

const answered = Array(3).fill('answered HTTP/1.1 200 OK "ok"');
const isAnswer = (line: string) => line.startsWith("answered");

test.each(["removeListener of the socket", "removeListener of EventEmitter.prototype"])(
  "each response that ends, and the close of the connection, call the %s",
  async change => {
    const { stdout, stderr, exitCode } = await run(change);
    expect(stderr).toBe("");
    expect(stdout.filter(isAnswer)).toEqual(answered);
    expect(stdout.filter(line => !isAnswer(line))).toEqual(Array(4).fill("removeListener close"));
    expect(exitCode).toBe(0);
  },
);

test("each response that ends reads the keep-alive timeout of socket.server", async () => {
  const { stdout, stderr, exitCode } = await run("server of the socket");
  expect(stderr).toBe("");
  expect(stdout.filter(isAnswer)).toEqual(answered);
  expect(stdout.filter(line => !isAnswer(line))).toEqual(Array(3).fill("uncaught TypeError"));
  expect(exitCode).toBe(0);
});

test("a request on a socket whose _readableState is null is answered with an empty body, and the connection closes", async () => {
  const { stdout, stderr, exitCode } = await run("_readableState of the socket");
  expect(stderr).toBe("");
  expect(stdout.filter(isAnswer)).toEqual([
    'answered HTTP/1.1 200 OK "ok"',
    'answered HTTP/1.1 200 OK "0 "',
    "answered by closing",
  ]);
  expect(exitCode).toBe(0);
});
