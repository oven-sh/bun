import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("http.createServer clientError handler can send 431 response", async () => {
  await using server = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const http = require("http");
const net = require("net");

const server = http.createServer((req, res) => {
  res.end("ok");
});

server.on("clientError", (err, socket) => {
  if (!socket.destroyed) {
    socket.end("HTTP/1.1 431 Header Too Large\\r\\nConnection: close\\r\\n\\r\\nHeader too large");
  }
});

server.listen(0, () => {
  const port = server.address().port;

  const client = net.createConnection({ port, host: "127.0.0.1" }, () => {
    const hugeHeader = Buffer.alloc(128 * 1024, 97).toString(); // 128KB of 'a'
    client.write("GET / HTTP/1.1\\r\\nHost: localhost\\r\\nX-Huge: " + hugeHeader + "\\r\\n\\r\\n");
  });

  let data = "";
  let finished = false;
  const finish = (output) => {
    if (finished) return;
    finished = true;
    process.stdout.write(output || data);
    server.close();
  };
  client.on("data", (chunk) => { data += chunk.toString(); });
  client.on("end", () => finish());
  client.on("close", () => finish());
  client.on("error", (err) => finish("ERROR:" + err.message));
});
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "ignore",
  });

  const [stdout, exitCode] = await Promise.all([server.stdout.text(), server.exited]);

  expect(stdout).toContain("431");
  expect(stdout).toContain("Header too large");
  expect(exitCode).toBe(0);
});

test("http.createServer sends default 431 for header overflow when no clientError listener", async () => {
  await using server = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const http = require("http");
const net = require("net");

const server = http.createServer((req, res) => {
  res.end("ok");
});

// No clientError listener — should get default 431 for header overflow

server.listen(0, () => {
  const port = server.address().port;

  const client = net.createConnection({ port, host: "127.0.0.1" }, () => {
    const hugeHeader = Buffer.alloc(128 * 1024, 97).toString();
    client.write("GET / HTTP/1.1\\r\\nHost: localhost\\r\\nX-Huge: " + hugeHeader + "\\r\\n\\r\\n");
  });

  let data = "";
  let finished = false;
  const finish = (output) => {
    if (finished) return;
    finished = true;
    process.stdout.write(output || data);
    server.close();
  };
  client.on("data", (chunk) => { data += chunk.toString(); });
  client.on("end", () => finish());
  client.on("close", () => finish());
  client.on("error", (err) => finish("ERROR:" + err.message));
});
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "ignore",
  });

  const [stdout, exitCode] = await Promise.all([server.stdout.text(), server.exited]);

  expect(stdout).toContain("431");
  expect(exitCode).toBe(0);
});
