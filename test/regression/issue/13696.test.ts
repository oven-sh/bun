// https://github.com/oven-sh/bun/issues/13696
//
// testcontainers (via docker-modem) talks to the Docker daemon over a unix
// socket using node:http. For `container.exec({ stdin: true })`, docker-modem
// sends a POST with `Transfer-Encoding: chunked`, writes the JSON body with a
// single `req.write(body)`, and intentionally does *not* call `req.end()` so
// that stdin can be streamed to the container later. The Docker daemon replies
// immediately with the exec output while the request body stream stays open.
//
// Bun's node:http client previously:
//   1. Only dispatched the request after the *second* write() (or end()/
//      flushHeaders()), so a single write() without end() never sent anything.
//   2. In duplex mode, deferred emitting 'response' until the request body
//      generator finished, i.e. until req.end() was called.
//
// Both behaviours together meant the request was never sent and the response
// was never delivered, causing testcontainers' wait strategies that rely on
// container.exec() (the default HostPortWaitStrategy) to hang until timeout.

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Runs a fixture that simulates docker-modem's chunked POST with an open
// request body, against a raw TCP server that responds before the request is
// finished. Prints "recv:<text>" for each response chunk as it arrives, and
// "request-seen" once the server has received the headers.
const fixture = (socketMode: "tcp" | "unix") => `
const net = require("net");
const http = require("http");
const os = require("os");
const path = require("path");
const fs = require("fs");

const socketMode = ${JSON.stringify(socketMode)};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const server = net.createServer((sock) => {
  let buf = "";
  let responded = false;
  sock.on("data", async (d) => {
    buf += d.toString("latin1");
    if (responded || !buf.includes("\\r\\n\\r\\n")) return;
    responded = true;
    console.log("request-seen");
    // Docker's exec response has no Content-Length and no chunked encoding;
    // it just writes raw frames until the connection closes.
    sock.write(
      "HTTP/1.1 200 OK\\r\\n" +
      "Content-Type: application/vnd.docker.raw-stream\\r\\n" +
      "\\r\\n",
    );
    for (let i = 0; i < 3; i++) {
      sock.write("chunk-" + i + "\\n");
      await wait(50);
    }
    sock.end();
  });
});

let listenArgs;
let requestOpts;
if (socketMode === "unix") {
  const socketPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bun-13696-")), "docker.sock");
  listenArgs = [socketPath];
  requestOpts = { socketPath, path: "/exec/abc/start" };
} else {
  listenArgs = [0, "127.0.0.1"];
  requestOpts = undefined; // filled in after listen
}

server.listen(...listenArgs, () => {
  if (socketMode === "tcp") {
    const { port } = server.address();
    requestOpts = { host: "127.0.0.1", port, path: "/exec/abc/start" };
  }

  // docker-modem passes an empty callback here and attaches 'response'
  // separately via req.on('response', ...).
  const req = http.request(
    {
      ...requestOpts,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Transfer-Encoding": "chunked",
      },
    },
    function () {},
  );

  req.on("response", (res) => {
    console.log("response-status:" + res.statusCode);
    res.setEncoding("utf8");
    res.on("data", (chunk) => {
      for (const line of chunk.split("\\n")) {
        if (line) console.log("recv:" + line);
      }
    });
    res.on("end", () => {
      console.log("response-end");
      server.close();
      // The request body stream is still open; end it now so the process
      // can exit cleanly.
      req.end();
    });
  });

  req.on("error", (err) => {
    console.error("request-error:" + err.message);
    process.exit(1);
  });

  // Single write, no req.end(). docker-modem does exactly this for
  // openStdin: true.
  req.write(JSON.stringify({ Detach: false, Tty: true }));
});

// Exit with whatever we've collected so far if the response never arrives,
// so the parent test gets a clean assertion failure instead of a timeout.
setTimeout(() => process.exit(0), 3000).unref();
`;

for (const socketMode of ["tcp", "unix"] as const) {
  test(`http.request delivers response while request body stream is still open (${socketMode})`, async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture(socketMode)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const lines = stdout.trim().split("\n");
    // The server must have received the request (a single write() dispatches
    // it), the response must be emitted with status 200, every body chunk must
    // be delivered, and the response must end cleanly.
    expect(lines).toEqual([
      "request-seen",
      "response-status:200",
      "recv:chunk-0",
      "recv:chunk-1",
      "recv:chunk-2",
      "response-end",
    ]);
    expect(exitCode).toBe(0);
  });
}

// Also cover the case where flushHeaders() is called explicitly (which already
// started the fetch in duplex mode) but the response was still being held back
// until req.end().
test("http.request emits 'response' in duplex mode after flushHeaders() without end()", async () => {
  const src = `
const net = require("net");
const http = require("http");

const server = net.createServer((sock) => {
  let buf = "";
  let responded = false;
  sock.on("data", (d) => {
    buf += d.toString("latin1");
    if (responded || !buf.includes("\\r\\n\\r\\n")) return;
    responded = true;
    sock.write("HTTP/1.1 200 OK\\r\\nContent-Type: text/plain\\r\\n\\r\\nhello");
    sock.end();
  });
});

server.listen(0, "127.0.0.1", () => {
  const { port } = server.address();
  const req = http.request({
    host: "127.0.0.1",
    port,
    path: "/",
    method: "POST",
    headers: { "Transfer-Encoding": "chunked" },
  });
  req.on("response", (res) => {
    let body = "";
    res.setEncoding("utf8");
    res.on("data", (c) => (body += c));
    res.on("end", () => {
      console.log("body:" + body);
      server.close();
      req.end();
    });
  });
  req.on("error", (err) => {
    console.error("request-error:" + err.message);
    process.exit(1);
  });
  req.flushHeaders();
  req.write("payload");
});

setTimeout(() => process.exit(0), 3000).unref();
`;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("body:hello");
  expect(exitCode).toBe(0);
});
