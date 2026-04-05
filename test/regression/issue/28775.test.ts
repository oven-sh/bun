import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("HTTP server emits error on malformed chunked request (incomplete chunk)", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const http = require('http');
const net = require('net');

const server = http.createServer(function (req, res) {
  const bufs = [];

  req.on('data', function (chunk) {
    bufs.push(chunk);
  });

  req.on('end', function () {
    // Should NOT fire — the body is incomplete.
    res.end('OK');
    server.close();
  });

  req.socket.on('error', function (e) {
    console.log('socket error: ' + e.code);
    req.destroy();
    server.close();
  });
});

server.listen(0, function () {
  const port = server.address().port;
  const sock = net.createConnection(port, '127.0.0.1');

  sock.on('connect', function () {
    sock.write('POST / HTTP/1.1\\r\\n');
    sock.write('Host: localhost\\r\\n');
    sock.write('Transfer-Encoding: chunked\\r\\n');
    sock.write('\\r\\n');
    sock.write('3\\r\\nfoo\\r\\n');
    sock.write('3\\r\\nbar\\r\\n');
    sock.write('ff\\r\\n');   // Declares 255 bytes but sends none
    sock.end();
  });
});

setTimeout(function () {
  console.log('timeout!');
  process.exit(1);
}, 5000).unref();
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toContain("socket error: HPE_INVALID_EOF_STATE");
  expect(stdout).not.toContain("timeout!");
  expect(exitCode).toBe(0);
});

test("incomplete chunked request routes error to req.on('error') when no socket listener", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const http = require('http');
const net = require('net');

const server = http.createServer(function (req, res) {
  req.on('data', function () {});

  req.on('error', function (e) {
    console.log('req error: ' + e.code);
    server.close();
  });
});

server.listen(0, function () {
  const port = server.address().port;
  const sock = net.createConnection(port, '127.0.0.1');

  sock.on('connect', function () {
    sock.write('POST / HTTP/1.1\\r\\n');
    sock.write('Host: localhost\\r\\n');
    sock.write('Transfer-Encoding: chunked\\r\\n');
    sock.write('\\r\\n');
    sock.write('3\\r\\nfoo\\r\\n');
    sock.write('ff\\r\\n');
    sock.end();
  });
});

setTimeout(function () {
  console.log('timeout!');
  process.exit(1);
}, 5000).unref();
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toContain("req error: HPE_INVALID_EOF_STATE");
  expect(stdout).not.toContain("req error: ECONNRESET");
  expect(stdout).not.toContain("timeout!");
  expect(exitCode).toBe(0);
});
