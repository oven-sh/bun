import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("node:http server falls back upgrade request to 'request' event when no 'upgrade' listener", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const http = require('node:http');

const server = http.createServer();
const events = [];

server.on('request', (req, res) => {
  events.push('request');
  res.end();
});

// No 'upgrade' listener registered

server.listen(0, function() {
  const port = this.address().port;
  // Send a request with Upgrade header using http module
  const req = http.request({
    hostname: 'localhost',
    port,
    path: '/',
    method: 'GET',
    headers: {
      'Connection': 'Upgrade',
      'Upgrade': 'websocket',
    },
  }, (res) => {
    events.push('response');
    res.resume();
    res.on('end', () => {
      console.log(JSON.stringify(events));
      server.close();
    });
  });
  req.end();
});
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const events = JSON.parse(stdout.trim());
  expect(events).toEqual(["request", "response"]);
  expect(exitCode).toBe(0);
});

test("node:http server emits 'upgrade' event when listener is registered", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const http = require('node:http');

const server = http.createServer();
const events = [];

server.on('request', (req, res) => {
  events.push('request');
  res.end();
});

server.on('upgrade', (req, socket) => {
  events.push('upgrade');
  socket.end();
});

server.listen(0, function() {
  const port = this.address().port;
  const req = http.request({
    hostname: 'localhost',
    port,
    path: '/',
    method: 'GET',
    headers: {
      'Connection': 'Upgrade',
      'Upgrade': 'websocket',
    },
  });
  req.on('error', () => {});
  req.end();
  // Give the server time to process
  setTimeout(() => {
    console.log(JSON.stringify(events));
    server.close();
  }, 500);
});
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const events = JSON.parse(stdout.trim());
  expect(events).toEqual(["upgrade"]);
  expect(exitCode).toBe(0);
});
