import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, nodeExe, tempDir, tls } from "harness";

const node = nodeExe();

describe.skipIf(isWindows)("process.send(message, handle)", () => {
  test.concurrent("bun parent -> bun child: net.Server handle and message both arrive", async () => {
    using dir = tempDir("ipc-handle-bun-bun", {
      "parent.js": `
const { fork } = require('node:child_process');
const { createServer, connect } = require('node:net');

const child = fork('child.js');
const server = createServer();

function finish(ok, detail) {
  console.log(ok ? 'RESPONSE:' + detail : 'FAILED:' + detail);
  try { child.kill(); } catch {}
  try { server.close(); } catch {}
  process.exit(ok ? 0 : 1);
}

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  child.send({ greeting: 'hi' }, server);
  child.on('message', m => {
    if (typeof m === 'object' && m.error) return finish(false, m.error);
    if (m !== 'ready') return;
    server.close();
    const client = connect(port, '127.0.0.1');
    client.setEncoding('utf8');
    let data = '';
    client.on('data', c => (data += c));
    client.on('end', () => finish(true, data));
    client.on('error', err => finish(false, 'client:' + err.message));
  });
});
`,
      "child.js": `
const net = require('node:net');
process.on('message', (m, server) => {
  if (!(server instanceof net.Server)) return process.send({ error: 'handle was ' + typeof server });
  if (!m || m.greeting !== 'hi') return process.send({ error: 'message was ' + JSON.stringify(m) });
  server.on('connection', s => s.end('hello from bun child'));
  process.send('ready');
});
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "parent.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ exitCode, stderr, response: stdout.includes("RESPONSE:hello from bun child") }).toEqual({
      exitCode: 0,
      stderr: expect.any(String),
      response: true,
    });
  });

  // The receiver's first poll of the adopted descriptor accepts everything queued in its backlog, so
  // the 'message' listener has to hold the server before that poll. The server is emitted from its
  // 'listening' event; while that was a 1ms timer, the poll ran first and the connections landed on a
  // server nobody was listening on.
  test.concurrent(
    "connections queued before a net.Server handoff reach the receiver's 'connection' listener",
    async () => {
      using dir = tempDir("ipc-handle-server-backlog", {
        "parent.js": `
const { fork } = require('node:child_process');
const net = require('node:net');
const N = 20;
const child = fork('child.js');
const server = net.createServer();
let served = 0;
let report;

function finish(extra) {
  console.log(JSON.stringify({ served, ...report, ...extra }));
  child.kill();
  process.exit(0);
}

child.on('exit', code => finish({ childExit: code }));
child.on('message', m => {
  report = m;
  // A connection accepted before the child held the server is never served: stop waiting for it.
  if (m.acceptedBeforeDelivery !== 0 || served === N) finish();
});

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  child.send('srv', server);
  // send() duplicated the descriptor, so the socket keeps listening after the parent closes its own
  // copy: the connections below queue up in the backlog and only the child can accept them.
  server.close();
  for (let i = 0; i < N; i++) {
    const client = net.connect(port, '127.0.0.1');
    client.setEncoding('utf8');
    let data = '';
    client.on('data', c => (data += c));
    client.on('end', () => {
      if (data === 'C') served++;
      if (served === N && report) finish();
    });
    client.on('error', e => finish({ clientError: e.message }));
  }
});
`,
        "child.js": `
process.on('message', (m, server) => {
  server.on('connection', s => s.end('C'));
  process.send({ acceptedBeforeDelivery: server._connections });
});
`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "parent.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ out: JSON.parse(stdout.trim()), stderr }).toEqual({
        out: { served: 20, acceptedBeforeDelivery: 0 },
        stderr: "",
      });
      expect(exitCode).toBe(0);
    },
  );

  // A plain message sent after a handle is only written once the handle is acked, so the receiver
  // has to emit the handle before it reads that message. A received net.Server is emitted from its
  // 'listening' event; while that was a 1ms timer, it fired after the message behind it had been read.
  test.concurrent("a net.Server handle is delivered before the message sent after it", async () => {
    using dir = tempDir("ipc-handle-send-order", {
      "parent.js": `
const { fork } = require('node:child_process');
const net = require('node:net');
const child = fork('child.js');
let report;
child.on('message', m => { report = m; });
child.on('close', code => console.log(JSON.stringify({ ...report, code })));
const server = net.createServer().listen(0, '127.0.0.1', () => {
  child.send('srv', server, () => server.close());
  child.send('after-handle');
});
`,
      "child.js": `
const order = [];
function record(event) {
  order.push(event);
  if (order.length === 3) {
    process.send({ order });
    process.disconnect();
  }
}
process.on('message', (m, server) => {
  if (server) {
    server.close();
    record('handle:' + m);
    return;
  }
  record(m);
  setImmediate(() => record('immediate'));
});
`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "parent.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ out: JSON.parse(stdout.trim()), stderr }).toEqual({
      out: { order: ["handle:srv", "after-handle", "immediate"], code: 0 },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  test
    .skipIf(!node)
    .concurrent("bun parent -> node child: the user message survives the NODE_HANDLE envelope", async () => {
      using dir = tempDir("ipc-handle-bun-node", {
        "parent.js": `
const { fork } = require('node:child_process');
const { createServer, connect } = require('node:net');

const child = fork('child.js', [], { execPath: ${JSON.stringify(node)} });
const server = createServer();

function finish(ok, detail) {
  console.log(ok ? 'RESPONSE:' + detail : 'FAILED:' + detail);
  try { child.kill(); } catch {}
  try { server.close(); } catch {}
  process.exit(ok ? 0 : 1);
}

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  child.send({ greeting: 'hi-from-bun' }, server);
  child.on('message', m => {
    if (typeof m === 'object' && m.error) return finish(false, m.error);
    if (m !== 'ready') return;
    server.close();
    const client = connect(port, '127.0.0.1');
    client.setEncoding('utf8');
    let data = '';
    client.on('data', c => (data += c));
    client.on('end', () => finish(true, data));
    client.on('error', err => finish(false, 'client:' + err.message));
  });
});
`,
        "child.js": `
const net = require('node:net');
process.on('message', (m, server) => {
  if (!(server instanceof net.Server)) return process.send({ error: 'handle was ' + typeof server });
  if (!m || m.greeting !== 'hi-from-bun') return process.send({ error: 'message was ' + JSON.stringify(m) });
  server.on('connection', s => s.end('hello from node child'));
  process.send('ready');
});
`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "parent.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ exitCode, stderr, response: stdout.includes("RESPONSE:hello from node child") }).toEqual({
        exitCode: 0,
        stderr: expect.any(String),
        response: true,
      });
    });

  test.concurrent("destroying a socket right after send() does not lose the queued handle", async () => {
    using dir = tempDir("ipc-handle-destroy-race", {
      "parent.js": `
const { fork } = require('node:child_process');
const net = require('node:net');

const child = fork('child.js');
const replies = [];
const datas = [];
let clientsDone = 0;

function finish(ok, detail) {
  console.log(ok ? 'RESULT:' + detail : 'FAILED:' + detail);
  try { child.kill(); } catch {}
  process.exit(ok ? 0 : 1);
}

child.on('message', m => {
  replies.push(m);
  if (m.error) finish(false, m.error);
});

const server = net.createServer();
const accepted = [];
server.on('connection', c => {
  accepted.push(c);
  if (accepted.length === 2) {
    child.send({ i: 1 }, accepted[0]);
    child.send({ i: 2 }, accepted[1]);
    accepted[1].destroy();
  }
});
server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  for (let i = 0; i < 2; i++) {
    const client = net.connect(port, '127.0.0.1');
    client.setEncoding('utf8');
    let buf = '';
    client.on('data', c => (buf += c));
    client.on('end', () => {
      datas.push(buf);
      if (++clientsDone === 2) {
        server.close();
        finish(true, JSON.stringify(datas.sort()));
      }
    });
    client.on('error', e => finish(false, 'client:' + e.message));
  }
});
`,
      "child.js": `
process.on('message', (m, sock) => {
  if (!sock) return process.send({ i: m.i, error: 'no handle for message ' + m.i });
  sock.end('hi-' + m.i);
  process.send({ i: m.i });
});
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "parent.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ exitCode, stderr, result: stdout.includes('RESULT:["hi-1","hi-2"]') }).toEqual({
      exitCode: 0,
      stderr: expect.any(String),
      result: true,
    });
  });

  test
    .skipIf(!node)
    .concurrent("node parent -> bun child: the user message survives the NODE_HANDLE envelope", async () => {
      using dir = tempDir("ipc-handle-node-bun", {
        "parent.js": `
const { fork } = require('node:child_process');
const { createServer, connect } = require('node:net');

const child = fork('child.js', [], { execPath: ${JSON.stringify(bunExe())} });
const server = createServer();

function finish(ok, detail) {
  console.log(ok ? 'RESPONSE:' + detail : 'FAILED:' + detail);
  try { child.kill(); } catch {}
  try { server.close(); } catch {}
  process.exit(ok ? 0 : 1);
}

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  child.send({ greeting: 'hi-from-node' }, server);
  child.on('message', m => {
    if (typeof m === 'object' && m.error) return finish(false, m.error);
    if (m !== 'ready') return;
    server.close();
    const client = connect(port, '127.0.0.1');
    client.setEncoding('utf8');
    let data = '';
    client.on('data', c => (data += c));
    client.on('end', () => finish(true, data));
    client.on('error', err => finish(false, 'client:' + err.message));
  });
});
`,
        "child.js": `
const net = require('node:net');
process.on('message', (m, server) => {
  if (!(server instanceof net.Server)) return process.send({ error: 'handle was ' + typeof server });
  if (!m || m.greeting !== 'hi-from-node') return process.send({ error: 'message was ' + JSON.stringify(m) });
  server.on('connection', s => s.end('hello from bun child'));
  process.send('ready');
});
`,
      });

      await using proc = Bun.spawn({
        cmd: [node!, "parent.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ exitCode, stderr, response: stdout.includes("RESPONSE:hello from bun child") }).toEqual({
        exitCode: 0,
        stderr: expect.any(String),
        response: true,
      });
    });

  test.concurrent("net.Socket handle sent with {keepOpen: true} stays open in the sender", async () => {
    using dir = tempDir("ipc-handle-keepopen", {
      "parent.js": `
const { fork } = require('node:child_process');
const net = require('node:net');

const child = fork('child.js');
let closed = false;
const server = net.createServer(socket => {
  socket.on('close', () => { closed = true; });
  child.send('socket', socket, { keepOpen: true }, err => {
    if (err) return finish(false, 'send:' + err.message);
    socket.write('parent', () => {});
  });
  child.on('message', m => {
    if (m !== 'child-wrote') return;
    setTimeout(() => {
      if (closed) return finish(false, 'parent socket closed by keepOpen send');
      socket.end();
    }, 50);
  });
}).listen(0, '127.0.0.1', () => {
  const client = net.connect(server.address().port, '127.0.0.1');
  client.setEncoding('utf8');
  let data = '';
  client.on('data', c => (data += c));
  client.on('end', () => finish(data.includes('parent') && data.includes('child'), data));
  client.on('error', e => finish(false, 'client:' + e.message));
});

function finish(ok, detail) {
  console.log(ok ? 'RESPONSE:' + detail : 'FAILED:' + detail);
  try { child.kill(); } catch {}
  try { server.close(); } catch {}
  process.exit(ok ? 0 : 1);
}
`,
      "child.js": `
const net = require('node:net');
process.on('message', (m, socket) => {
  if (!(socket instanceof net.Socket)) return process.send({ error: 'handle was ' + typeof socket });
  socket.write('child', () => process.send('child-wrote'));
});
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "parent.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ exitCode, stderr, hasParent: stdout.includes("parent"), hasChild: stdout.includes("child") }).toEqual({
      exitCode: 0,
      stderr: expect.any(String),
      hasParent: true,
      hasChild: true,
    });
  });

  test.concurrent("dgram.Socket handle arrives as a bound dgram.Socket the child can send/receive on", async () => {
    using dir = tempDir("ipc-handle-dgram", {
      "parent.js": `
const { fork } = require('node:child_process');
const dgram = require('node:dgram');

const child = fork('child.js');
const server = dgram.createSocket('udp4');
const client = dgram.createSocket('udp4');

function finish(ok, detail) {
  console.log(ok ? 'RESPONSE:' + detail : 'FAILED:' + detail);
  try { child.kill(); } catch {}
  try { client.close(); } catch {}
  process.exit(ok ? 0 : 1);
}

server.bind(0, '127.0.0.1', () => {
  const port = server.address().port;
  let ready = false, closed = false;
  const maybePing = () => {
    if (!ready || !closed) return;
    client.once('message', buf => finish(true, buf.toString()));
    client.send('ping', port, '127.0.0.1', err => {
      if (err) finish(false, 'client:' + err.message);
    });
  };
  child.send({ greeting: 'hi' }, server, err => {
    if (err) return finish(false, 'send:' + err.message);
    server.close(() => { closed = true; maybePing(); });
  });
  child.on('message', m => {
    if (m && m.error) return finish(false, m.error);
    if (m !== 'ready') return;
    ready = true; maybePing();
  });
});
`,
      "child.js": `
const dgram = require('node:dgram');
process.on('message', (m, socket) => {
  if (!(socket instanceof dgram.Socket)) return process.send({ error: 'handle was ' + typeof socket });
  if (!m || m.greeting !== 'hi') return process.send({ error: 'message was ' + JSON.stringify(m) });
  socket.on('message', (buf, rinfo) => {
    socket.send('pong:' + buf, rinfo.port, rinfo.address);
  });
  process.send('ready');
});
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "parent.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ exitCode, stderr, response: stdout.includes("RESPONSE:pong:ping") }).toEqual({
      exitCode: 0,
      stderr: expect.any(String),
      response: true,
    });
  });

  test.concurrent("received net.Socket has connecting=false and remoteAddress synchronously", async () => {
    using dir = tempDir("ipc-handle-connecting", {
      "parent.js": `
const { fork } = require('node:child_process');
const net = require('node:net');
const child = fork('child.js');
const server = net.createServer(sock => child.send('sock', sock));
server.listen(0, '127.0.0.1', () => {
  const c = net.connect(server.address().port, '127.0.0.1');
  c.on('error', () => {});
});
child.on('message', m => { console.log(JSON.stringify(m)); child.kill(); server.close(); process.exit(0); });
`,
      "child.js": `
process.on('message', (m, sock) => {
  process.send({ connecting: sock.connecting, readyState: sock.readyState, hasRemote: typeof sock.remoteAddress === 'string' });
});
`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "parent.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ out: JSON.parse(stdout.trim()), stderr }).toEqual({
      out: { connecting: false, readyState: "open", hasRemote: true },
      stderr: expect.any(String),
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent(
    "channel close: written handle callback fires null; unsent queued handle callback never fires",
    async () => {
      using dir = tempDir("ipc-handle-abort-unsent", {
        "parent.js": `
const { fork } = require('node:child_process');
const net = require('node:net');
const child = fork('child.js');
const server = net.createServer();
server.listen(0, '127.0.0.1', () => {
  let a = "never called", bCalled = false;
  net.connect(server.address().port, '127.0.0.1', function () {
    const sockA = this;
    net.connect(server.address().port, '127.0.0.1', function () {
      const sockB = this;
      child.send('A', sockA, err => { a = err; });
      child.send('B', sockB, () => { bCalled = true; });
      child.kill('SIGKILL');
      child.on('close', () => setImmediate(() => {
        console.log(JSON.stringify({ aWasNull: a === null, bCalled }));
        server.close();
        process.exit(0);
      }));
    }).on('error', () => {});
  }).on('error', () => {});
});
`,
        "child.js": `const end = Date.now() + 30_000; while (Date.now() < end) {}`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "parent.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ out: JSON.parse(stdout.trim()), stderr }).toEqual({
        out: { aWasNull: true, bCalled: false },
        stderr: expect.any(String),
      });
      expect(exitCode).toBe(0);
    },
  );

  test.concurrent(
    "sending a tls.TLSSocket throws ERR_INVALID_HANDLE_TYPE instead of silently dropping the handle",
    async () => {
      using dir = tempDir("ipc-handle-tls-socket", {
        "cert.pem": tls.cert,
        "key.pem": tls.key,
        "parent.js": `
const { fork } = require('node:child_process');
const tlsMod = require('node:tls');
const fs = require('node:fs');
const child = fork('child.js');
const sockets = [];
const finish = out => { console.log(JSON.stringify(out)); for (const s of sockets) s.destroy(); server.close(); child.disconnect(); };
child.on('message', m => finish({ childReceived: m }));
const server = tlsMod.createServer({ key: fs.readFileSync('key.pem'), cert: fs.readFileSync('cert.pem') }, serverSide => {
  sockets.push(serverSide);
  try { child.send('tls', serverSide); } catch (err) { report('serverCode', err.code); }
});
const codes = {};
function report(side, code) { codes[side] = code; if ('serverCode' in codes && 'clientCode' in codes) finish({ ...codes, childReceived: null }); }
server.listen(0, '127.0.0.1', () => {
  const clientSide = tlsMod.connect({ port: server.address().port, host: '127.0.0.1', rejectUnauthorized: false }, () => {
    sockets.push(clientSide);
    try { child.send('tls', clientSide); } catch (err) { report('clientCode', err.code); }
  });
});
`,
        "child.js": `process.on('message', m => process.send('unexpected:' + m));`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "parent.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ out: JSON.parse(stdout.trim()), stderr }).toEqual({
        out: { serverCode: "ERR_INVALID_HANDLE_TYPE", clientCode: "ERR_INVALID_HANDLE_TYPE", childReceived: null },
        stderr: expect.any(String),
      });
      expect(exitCode).toBe(0);
    },
  );

  test.concurrent("a received handle that lands on fd 0 is adopted", async () => {
    using dir = tempDir("ipc-handle-fd0", {
      "parent.js": `
const { fork } = require('node:child_process');
const net = require('node:net');
const child = fork('child.js');
const server = net.createServer(sock => {
  child.send('sock', sock);
  child.once('message', m => { console.log(JSON.stringify(m)); sock.destroy(); server.close(); child.disconnect(); });
});
server.listen(0, '127.0.0.1', () => {
  const client = net.connect(server.address().port, '127.0.0.1');
  client.on('data', d => { client.end(); });
  client.on('error', () => {});
});
`,
      "child.js": `
require('node:fs').closeSync(0); // the next descriptor this process receives is fd 0
process.on('message', (m, sock) => {
  const fd = sock && sock._handle && sock._handle.fd;
  sock.end('hi', () => process.send({ message: m, receivedFd: fd, writable: true }));
});
`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "parent.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ out: JSON.parse(stdout.trim()), stderr }).toEqual({
      out: { message: "sock", receivedFd: 0, writable: true },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  // node: a sent socket is detached from the sender's net.Socket (no 'end'/'close' there when the
  // receiver finishes with it), and disconnect() waits for the messages queued behind an un-acked
  // handle to be delivered. https://github.com/nodejs/node/blob/v26.3.0/lib/internal/child_process.js
  test.concurrent(
    "handoff detaches the sender's socket; disconnect() reports disconnected at once but flushes messages queued behind the handle",
    async () => {
      using dir = tempDir("ipc-handle-detach-flush", {
        "parent.js": `
const { fork } = require('node:child_process');
const net = require('node:net');
const child = fork('child.js');
const senderEvents = [];
let client, connectedAfterDisconnect, secondDisconnect = 'no error';
child.on('error', e => { secondDisconnect = e.code; });
const server = net.createServer(sock => {
  sock.on('end', () => senderEvents.push('end'));
  sock.on('close', () => senderEvents.push('close'));
  child.send('sock', sock);
  child.send({ type: 'after-handle' });
  child.disconnect();
  // While the queue behind the handle drains, the channel already reports disconnected.
  connectedAfterDisconnect = child.connected;
  child.disconnect();
});
child.on('exit', code => {
  client.destroy();
  server.close(() => console.log(JSON.stringify({ childSawQueuedMessage: code === 0, senderEvents, connectedAfterDisconnect, secondDisconnect })));
});
server.listen(0, '127.0.0.1', () => {
  client = net.connect(server.address().port, '127.0.0.1');
  client.on('error', () => {});
});
`,
        "child.js": `
let sawQueued = false;
process.on('message', (m, sock) => { if (sock) sock.destroy(); else sawQueued = m.type === 'after-handle'; });
process.on('disconnect', () => process.exit(sawQueued ? 0 : 3));
`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "parent.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ out: JSON.parse(stdout.trim()), stderr }).toEqual({
        out: {
          childSawQueuedMessage: true,
          senderEvents: [],
          connectedAfterDisconnect: false,
          secondDisconnect: "ERR_IPC_DISCONNECTED",
        },
        stderr: "",
      });
      expect(exitCode).toBe(0);
    },
  );

  // The child sends a server and disconnects at once. node: process.connected drops immediately, a
  // second disconnect() errors, and the parent receives the server, then the message queued behind
  // it (the child only sends it once the handle is acked), then 'disconnect'. The parent reports on
  // 'close', which a fork()ed child reaches only after 'exit', the IPC 'disconnect' and the end of
  // the stderr pipe; 'exit' alone can run before the other two.
  test.concurrent("a handle sent right before the child's disconnect() is delivered, in send order", async () => {
    using dir = tempDir("ipc-handle-then-disconnect", {
      "parent.js": `
const { fork } = require('node:child_process');
const child = fork('child.js', { stdio: ['ignore', 'inherit', 'pipe', 'ipc'] });
const got = [];
let childReport = '';
child.stderr.on('data', d => { childReport += d; });
child.on('message', (m, h) => { got.push(h ? 'handle:' + m : m); if (h) h.close(); });
child.on('disconnect', () => got.push('disconnect'));
child.on('close', code => console.log(JSON.stringify({ got, code, child: JSON.parse(childReport) })));
`,
      "child.js": `
const net = require('node:net');
const server = net.createServer().listen(0, '127.0.0.1', () => {
  process.send('srv', server);
  process.send('after-handle');
  process.disconnect();
  const connectedAfterDisconnect = process.connected;
  let secondDisconnect = 'no error';
  process.once('error', e => { secondDisconnect = e.code; });
  process.disconnect();
  process.on('disconnect', () => { process.stderr.write(JSON.stringify({ connectedAfterDisconnect, secondDisconnect })); server.close(); });
});
`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "parent.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ out: JSON.parse(stdout.trim()), stderr }).toEqual({
      out: {
        got: ["handle:srv", "after-handle", "disconnect"],
        code: 0,
        child: { connectedAfterDisconnect: false, secondDisconnect: "ERR_IPC_DISCONNECTED" },
      },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });
});
