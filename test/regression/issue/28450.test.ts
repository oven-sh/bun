import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Issue #28450: http.ClientRequest does not emit "upgrade" event for 101 responses.
// This breaks playwright-core and any library using the real `ws` package for WebSocket
// connections via http.request() upgrade handshake.

test.concurrent("http.request emits upgrade event on 101 Switching Protocols", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const net = require('net');
const http = require('http');
const crypto = require('crypto');

const server = net.createServer((socket) => {
  let data = '';
  let upgraded = false;
  socket.on('data', (chunk) => {
    if (upgraded) {
      socket.write(chunk);
      return;
    }
    data += chunk.toString();
    if (data.includes('\\r\\n\\r\\n')) {
      const keyMatch = data.match(/sec-websocket-key: (.+)\\r\\n/i);
      if (keyMatch) {
        const key = keyMatch[1];
        const accept = crypto.createHash('sha1')
          .update(key + '258EAFA5-E914-47DA-95CA-5AB5F06CA30E')
          .digest('base64');
        socket.write('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: ' + accept + '\\r\\n\\r\\n');
        upgraded = true;
      }
    }
  });
});

server.listen(0, () => {
  const port = server.address().port;
  const req = http.request({
    hostname: 'localhost',
    port,
    path: '/',
    headers: {
      'Connection': 'Upgrade',
      'Upgrade': 'websocket',
      'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version': '13',
    }
  });
  req.on('upgrade', (res, socket, head) => {
    console.log('STATUS:' + res.statusCode);
    console.log('UPGRADE:' + res.headers['upgrade']);
    console.log('ACCEPT:' + res.headers['sec-websocket-accept']);
    // Verify the socket is usable for bidirectional communication
    socket.write('hello');
    socket.once('data', (data) => {
      console.log('ECHO:' + data.toString());
      socket.destroy();
      server.close();
    });
  });
  req.on('response', (res) => {
    console.log('UNEXPECTED_RESPONSE:' + res.statusCode);
    server.close();
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

  expect(stdout).toContain("STATUS:101");
  expect(stdout).toContain("UPGRADE:websocket");
  expect(stdout).toContain("ECHO:hello");
  expect(stdout).not.toContain("UNEXPECTED_RESPONSE");
  expect(exitCode).toBe(0);
});

test.concurrent("http.request upgrade event provides valid IncomingMessage headers", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const net = require('net');
const http = require('http');
const crypto = require('crypto');

const server = net.createServer((socket) => {
  let data = '';
  socket.on('data', (chunk) => {
    data += chunk.toString();
    if (data.includes('\\r\\n\\r\\n')) {
      const keyMatch = data.match(/sec-websocket-key: (.+)\\r\\n/i);
      if (keyMatch) {
        const key = keyMatch[1];
        const accept = crypto.createHash('sha1')
          .update(key + '258EAFA5-E914-47DA-95CA-5AB5F06CA30E')
          .digest('base64');
        socket.write('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: ' + accept + '\\r\\nX-Custom-Header: test-value\\r\\n\\r\\n');
      }
    }
  });
});

server.listen(0, () => {
  const port = server.address().port;
  const key = crypto.randomBytes(16).toString('base64');
  const expectedAccept = crypto.createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-5AB5F06CA30E')
    .digest('base64');
  const req = http.request({
    hostname: 'localhost',
    port,
    path: '/ws',
    headers: {
      'Connection': 'Upgrade',
      'Upgrade': 'websocket',
      'Sec-WebSocket-Key': key,
      'Sec-WebSocket-Version': '13',
    }
  });
  req.on('upgrade', (res, socket, head) => {
    const results = {
      statusCode: res.statusCode,
      statusMessage: res.statusMessage,
      upgrade: res.headers['upgrade'],
      connection: res.headers['connection'],
      accept: res.headers['sec-websocket-accept'],
      expectedAccept: expectedAccept,
      customHeader: res.headers['x-custom-header'],
      hasRawHeaders: Array.isArray(res.rawHeaders) && res.rawHeaders.length > 0,
      headIsBuffer: Buffer.isBuffer(head),
    };
    console.log(JSON.stringify(results));
    socket.destroy();
    server.close();
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

  const results = JSON.parse(stdout.trim());
  expect(results).toEqual({
    statusCode: 101,
    statusMessage: "Switching Protocols",
    upgrade: "websocket",
    connection: "Upgrade",
    accept: results.expectedAccept,
    expectedAccept: results.expectedAccept,
    customHeader: "test-value",
    hasRawHeaders: true,
    headIsBuffer: true,
  });
  expect(exitCode).toBe(0);
});

test.concurrent("http.request emits response (not upgrade) for non-101 on upgrade request", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const net = require('net');
const http = require('http');

// Server that responds with 400 instead of upgrading
const server = net.createServer((socket) => {
  let data = '';
  socket.on('data', (chunk) => {
    data += chunk.toString();
    if (data.includes('\\r\\n\\r\\n')) {
      socket.write('HTTP/1.1 400 Bad Request\\r\\nContent-Type: text/plain\\r\\nContent-Length: 11\\r\\n\\r\\nBad Request');
      socket.end();
    }
  });
});

server.listen(0, () => {
  const port = server.address().port;
  const req = http.request({
    hostname: 'localhost',
    port,
    path: '/',
    headers: {
      'Connection': 'Upgrade',
      'Upgrade': 'websocket',
      'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version': '13',
    }
  });
  req.on('upgrade', () => {
    console.log('UNEXPECTED_UPGRADE');
    server.close();
  });
  req.on('response', (res) => {
    let body = '';
    res.on('data', (chunk) => body += chunk);
    res.on('end', () => {
      console.log('RESPONSE:' + res.statusCode);
      console.log('BODY:' + body);
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

  expect(stdout).toContain("RESPONSE:400");
  expect(stdout).toContain("BODY:Bad Request");
  expect(stdout).not.toContain("UNEXPECTED_UPGRADE");
  expect(exitCode).toBe(0);
});
