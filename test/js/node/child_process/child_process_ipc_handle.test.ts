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
