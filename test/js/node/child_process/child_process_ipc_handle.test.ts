import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, nodeExe, tempDir } from "harness";

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
  let a = null, bCalled = false;
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
});

describe.skipIf(isWindows)("send() callback settlement on channel close", () => {
  test.concurrent("every queued plain send callback settles (with null, like node)", async () => {
    using dir = tempDir("ipc-close-settles-callbacks", {
      "parent.js": `
const { fork } = require('node:child_process');
const child = fork('child.js');

child.on('message', m => {
  if (m !== 'ready') return;
  // 8MB per message: far beyond what one synchronous write can hand to the
  // kernel, so all three sends still sit (at least partly) in the send
  // queue when the SIGKILL lands in this same tick. Node settles accepted
  // plain sends with null even when the peer dies before reading them
  // (req.oncomplete ignores the write status); none may be dropped.
  const big = 'x'.repeat(8 * 1024 * 1024);
  const results = [];
  const total = 3;
  for (let i = 0; i < total; i++) {
    child.send(big, err => {
      results.push(err === null ? 'null' : err.code);
      if (results.length === total) {
        console.log('CALLBACKS:' + results.join(','));
        process.exit(0);
      }
    });
  }
  child.kill('SIGKILL');
});
setTimeout(() => { console.log('TIMEOUT:callbacks-never-settled'); process.exit(1); }, 15000);
`,
      "child.js": `
process.send('ready');
setInterval(() => {}, 1 << 30);
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "parent.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe("CALLBACKS:null,null,null");
    expect(exitCode).toBe(0);
  });

  test.concurrent("handle send queued behind plain backpressure settles null on close, like node", async () => {
    using dir = tempDir("ipc-handle-behind-backpressure", {
      "parent.js": `
const { fork } = require('node:child_process');
const net = require('node:net');
const child = fork('child.js');
const server = net.createServer();
server.listen(0, '127.0.0.1', () => {
  let a = 'nocall', h = 'nocall';
  // 8MB plain write saturates the pipe, so the handle send below is still
  // queued (never written, no ack pending) when the SIGKILL lands. Node
  // settles both callbacks with null in this shape (verified v26.3.0).
  const big = 'x'.repeat(8 * 1024 * 1024);
  child.send(big, err => { a = err === null ? 'null' : err.code; });
  child.send('withhandle', server, err => { h = err === null ? 'null' : err.code; });
  child.kill('SIGKILL');
  child.on('close', () => setImmediate(() => setImmediate(() => {
    console.log(JSON.stringify({ a, h }));
    server.close();
    process.exit(0);
  })));
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
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(JSON.parse(stdout.trim())).toEqual({ a: "null", h: "null" });
    expect(exitCode).toBe(0);
  });

  test.concurrent("sending a dgram socket fails loudly instead of dropping the handle", async () => {
    using dir = tempDir("ipc-dgram-handle-loud", {
      "parent.js": `
const { fork } = require('node:child_process');
const dgram = require('node:dgram');
const child = fork('child.js');
const sock = dgram.createSocket('udp4');
sock.bind(0, () => {
  let result;
  try {
    child.send('msg', sock);
    result = 'sent-silently';
  } catch (err) {
    result = err.code;
  }
  console.log('RESULT:' + result);
  sock.close();
  child.kill();
  process.exit(0);
});
`,
      "child.js": `
// If the message arrives without its handle, the silent-drop bug is back.
process.on('message', (m, handle) => process.send({ got: m, handle: handle === undefined ? 'missing' : 'present' }));
setTimeout(() => process.exit(0), 5000);
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "parent.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe("RESULT:ERR_INVALID_HANDLE_TYPE");
    expect(exitCode).toBe(0);
  });
});

describe("NODE_-prefixed user messages", () => {
  test.concurrent("a user send with cmd NODE_CLUSTER reaches a plain-fork parent as internalMessage, like node", async () => {
    using dir = tempDir("ipc-node-cluster-user-msg", {
      "parent.js": `
const { fork } = require('node:child_process');
const child = fork('child.js');
const got = [];
const done = () => {
  if (got.length === 2) {
    console.log(JSON.stringify(got));
    child.kill();
    process.exit(0);
  }
};
child.on('message', m => { got.push(['message', m]); done(); });
child.on('internalMessage', m => { got.push(['internalMessage', m]); done(); });
setTimeout(() => { console.log('TIMEOUT:' + JSON.stringify(got)); process.exit(1); }, 10000);
`,
      "child.js": `
process.send({ cmd: 'NODE_CLUSTER', x: 1 });
process.send({ cmd: 'OTHER', y: 2 });
setInterval(() => {}, 1 << 30);
`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "parent.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    // Same routing as real node: the NODE_-prefixed message fires
    // 'internalMessage' on the child handle; the other one is a normal message.
    expect(JSON.parse(stdout.trim())).toEqual([
      ["internalMessage", { cmd: "NODE_CLUSTER", x: 1 }],
      ["message", { cmd: "OTHER", y: 2 }],
    ]);
    expect(exitCode).toBe(0);
  });
});
