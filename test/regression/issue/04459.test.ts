import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("http.Server.getConnections returns connection count", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const http = require("node:http");

const server = http.createServer((req, res) => {
  server.getConnections((err, count) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err, count: count }));
  });
});

server.listen(0, () => {
  const port = server.address().port;
  fetch("http://localhost:" + port)
    .then(r => r.json())
    .then(data => {
      console.log(JSON.stringify(data));
      server.close();
    });
});
`,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const result = JSON.parse(stdout.trim());
  expect(result.error).toBeNull();
  expect(result.count).toBeGreaterThanOrEqual(0);
  expect(typeof result.count).toBe("number");
  expect(exitCode).toBe(0);
});

test("http.Server.connections property is available", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const http = require("node:http");

const server = http.createServer((req, res) => {
  const count = server.connections;
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ count: count, type: typeof count }));
});

server.listen(0, () => {
  const port = server.address().port;
  fetch("http://localhost:" + port)
    .then(r => r.json())
    .then(data => {
      console.log(JSON.stringify(data));
      server.close();
    });
});
`,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const result = JSON.parse(stdout.trim());
  expect(result.type).toBe("number");
  expect(result.count).toBeGreaterThanOrEqual(0);
  expect(exitCode).toBe(0);
});

test("http.Server.getConnections returns 0 when server is not listening", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const http = require("node:http");

const server = http.createServer();
server.getConnections((err, count) => {
  console.log(JSON.stringify({ error: err, count: count }));
});
`,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  const result = JSON.parse(stdout.trim());
  expect(result.error).toBeNull();
  expect(result.count).toBe(0);
  expect(exitCode).toBe(0);
});
