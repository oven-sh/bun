import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// When a node:http request handler throws synchronously before any status line
// has been written, Bun should respond with 500 Internal Server Error rather
// than defaulting to 200 OK. The cleanup path in server.zig checks whether a
// status has already been sent via isHttpStatusCalled(); previously the
// condition was inverted so the 500 branch was unreachable and endStream()
// wrote a default "HTTP/1.1 200 OK".
test.concurrent("node:http responds 500 when handler throws synchronously before writing status", async () => {
  const script = /* js */ `
    const http = require("node:http");
    const net = require("node:net");
    const { once } = require("node:events");

    // Swallow the propagated handler exception so the process stays alive.
    process.on("uncaughtException", err => {
      process.stderr.write("uncaughtException:" + err.message + "\\n");
    });

    const server = http.createServer((req, res) => {
      throw new Error("boom");
    });

    server.listen(0, "127.0.0.1", async () => {
      const port = server.address().port;
      const socket = net.connect(port, "127.0.0.1");
      await once(socket, "connect");
      socket.write("GET / HTTP/1.1\\r\\nHost: 127.0.0.1\\r\\nConnection: close\\r\\n\\r\\n");
      let raw = "";
      for await (const chunk of socket) raw += chunk.toString("latin1");
      const statusLine = raw.slice(0, raw.indexOf("\\r\\n"));
      process.stdout.write("STATUS_LINE:" + statusLine + "\\n");
      server.close();
      process.exit(0);
    });
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("uncaughtException:boom");
  expect(stdout.trim()).toBe("STATUS_LINE:HTTP/1.1 500 Internal Server Error");
  expect(exitCode).toBe(0);
});

test.concurrent("node:http still terminates the response when handler throws after writeHead", async () => {
  const script = /* js */ `
    const http = require("node:http");
    const net = require("node:net");
    const { once } = require("node:events");

    process.on("uncaughtException", err => {
      process.stderr.write("uncaughtException:" + err.message + "\\n");
    });

    const server = http.createServer((req, res) => {
      res.writeHead(201, { "x-before-throw": "yes" });
      res.flushHeaders();
      throw new Error("boom-after-head");
    });

    server.listen(0, "127.0.0.1", async () => {
      const port = server.address().port;
      const socket = net.connect(port, "127.0.0.1");
      await once(socket, "connect");
      socket.write("GET / HTTP/1.1\\r\\nHost: 127.0.0.1\\r\\nConnection: close\\r\\n\\r\\n");
      let raw = "";
      for await (const chunk of socket) raw += chunk.toString("latin1");
      const statusLine = raw.slice(0, raw.indexOf("\\r\\n"));
      process.stdout.write("STATUS_LINE:" + statusLine + "\\n");
      process.stdout.write("HAS_HEADER:" + raw.includes("x-before-throw: yes") + "\\n");
      server.close();
      process.exit(0);
    });
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("uncaughtException:boom-after-head");
  // Status was already sent before the throw, so it stays 201, but the
  // connection must still be terminated (we received a complete response).
  expect(stdout.trim()).toBe("STATUS_LINE:HTTP/1.1 201 Created\nHAS_HEADER:true");
  expect(exitCode).toBe(0);
});
