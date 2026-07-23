// https://github.com/oven-sh/bun/issues/13696
// node:http ClientRequest: a single req.write() without req.end() never sent
// the request, and in duplex mode 'response' was held back until req.end().
// docker-modem relies on write-once-keep-open for container.exec stdin, which
// is why testcontainers' default HostPortWaitStrategy hung until timeout.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// Runs a fixture that simulates docker-modem's chunked POST with an open
// request body, against a raw TCP server that responds before the request is
// finished. Prints "recv:<text>" for each response chunk as it arrives, and
// "request-seen" once the server has received the headers.
const fixture = (socketPath: string | undefined) => `
const net = require("net");
const http = require("http");

const socketPath = ${JSON.stringify(socketPath)};

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

const listenArgs = socketPath ? [socketPath] : [0, "127.0.0.1"];

server.listen(...listenArgs, () => {
  const requestOpts = socketPath
    ? { socketPath, path: "/exec/abc/start" }
    : { host: "127.0.0.1", port: server.address().port, path: "/exec/abc/start" };

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
    using dir = tempDir("issue-13696", {});
    const socketPath = socketMode === "unix" ? join(String(dir), "docker.sock") : undefined;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture(socketPath)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const lines = stdout.trim().split("\n");
    // The server must have received the request (a single write() dispatches
    // it), the response must be emitted with status 200, every body chunk must
    // be delivered, and the response must end cleanly.
    expect({ lines, stderr }).toEqual({
      lines: ["request-seen", "response-status:200", "recv:chunk-0", "recv:chunk-1", "recv:chunk-2", "response-end"],
      stderr: expect.not.stringContaining("request-error"),
    });
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

  expect({ stdout: stdout.trim(), stderr }).toEqual({
    stdout: "body:hello",
    stderr: expect.not.stringContaining("request-error"),
  });
  expect(exitCode).toBe(0);
});
