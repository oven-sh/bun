import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, nodeExe, tempDir } from "harness";

// `subprocess.send(message, handle)` / `process.send(message, handle)`:
// the handle's fd is passed over the IPC channel (SCM_RIGHTS on the unix
// socketpair + Node's `NODE_HANDLE` / `NODE_HANDLE_ACK` handshake) and
// reconstructed as a live net.Server / net.Socket in the receiving process.
// https://nodejs.org/api/child_process.html#subprocesssendmessage-sendhandle-options-callback
//
// Windows is skipped: Bun's named-pipe IPC has no SOCKET duplication yet, and
// `send()` throws there instead of silently dropping the handle.

const node = nodeExe();

// Passing a net.Server handle over IPC duplicates the listening socket's fd to
// the child via SCM_RIGHTS, which is POSIX-only.
test.skipIf(isWindows)("fork() + subprocess.send(msg, server) gives the child a usable net.Server", async () => {
  using dir = tempDir("ipc-server-handle", {
    "parent.js": `
import { fork } from 'node:child_process';
import { createServer, connect } from 'node:net';

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
  child.send('server', server);

  child.on('message', m => {
    if (typeof m === 'object' && m.error) return finish(false, m.error);
    if (m !== 'ready') return;
    // The fd is duplicated to the child (SCM_RIGHTS), so both processes would
    // otherwise race on accept(). The child has already called
    // server.listen({ fd }) before sending 'ready', so closing our copy now
    // leaves only the child's fd accepting — deterministically the child
    // answers the connection.
    server.close();
    const client = connect(port, '127.0.0.1');
    client.setEncoding('utf8');
    let data = '';
    client.on('data', chunk => { data += chunk; });
    client.on('end', () => finish(true, data));
    client.on('error', err => finish(false, 'client:' + err.message));
  });
});
`,
    "child.js": `
process.on('message', (m, server) => {
  if (m !== 'server') return;
  console.log('CHILD_TYPEOF:' + typeof server);
  if (!server || typeof server.on !== 'function') {
    process.send({ error: 'handle was ' + typeof server });
    return;
  }
  server.on('connection', socket => {
    socket.end('Hello from child');
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

  expect(stderr).toBe("");
  expect(stdout).toContain("CHILD_TYPEOF:object");
  expect(stdout).toContain("RESPONSE:Hello from child");
  expect(exitCode).toBe(0);
});

// The NODE_HANDLE envelope carries the user payload under `msg` (Node's wire
// format), so a Bun parent can hand a net.Server to a Node child and the child
// still receives the accompanying message.
test.skipIf(isWindows || !node)("Bun parent can pass a net.Server (and message) to a Node child", async () => {
  using dir = tempDir("ipc-server-handle-node", {
    "parent.js": `
import { fork } from 'node:child_process';
import { createServer, connect } from 'node:net';

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
    client.on('data', chunk => { data += chunk; });
    client.on('end', () => finish(true, data));
    client.on('error', err => finish(false, 'client:' + err.message));
  });
});
`,
    "child.js": `
const net = require('node:net');
process.on('message', (m, server) => {
  if (!(server instanceof net.Server)) {
    process.send({ error: 'handle was ' + typeof server });
    return;
  }
  if (!m || m.greeting !== 'hi-from-bun') {
    process.send({ error: 'message was ' + JSON.stringify(m) });
    return;
  }
  server.on('connection', socket => socket.end('Hello from node child'));
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

  expect(stderr).toBe("");
  expect(stdout).toContain("RESPONSE:Hello from node child");
  expect(exitCode).toBe(0);
});

async function run(dir: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "parent.mjs"],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) console.error("parent.mjs stderr:\n" + stderr);
  return { stdout: stdout.trim(), exitCode };
}

describe.skipIf(isWindows)("send(message, netSocket)", () => {
  test("parent passes an accepted net.Socket to a forked child", async () => {
    using dir = tempDir("ipc-send-socket", {
      "child.mjs": /* js */ `
        process.on("message", (m, handle) => {
          // The whole bug: send() reported true but the child saw no handle.
          if (!handle) process.exit(40);
          handle.end("got:" + handle.constructor.name + ":" + handle.readyState);
        });
      `,
      "parent.mjs": /* js */ `
        import { fork } from "node:child_process";
        import net from "node:net";

        const child = fork(new URL("./child.mjs", import.meta.url).pathname);
        child.on("exit", code => { if (code) process.exit(30); });

        const srv = net.createServer(sock => {
          const sent = child.send("conn", sock);
          if (sent !== true) { console.error("send() returned", sent); process.exit(31); }
          // Node detaches the sender's copy of a sent socket immediately
          // (_handle becomes null; readyState stays "open" in node too).
          if (sock._handle !== null) { console.error("sender _handle not detached"); process.exit(32); }
        });

        srv.listen(0, "127.0.0.1", () => {
          const c = net.connect(srv.address().port, "127.0.0.1");
          let data = "";
          c.on("data", d => (data += d));
          c.on("end", () => {
            console.log(data);
            srv.close();
            child.kill();
            process.exit(data === "got:Socket:open" ? 0 : 1);
          });
          c.on("error", e => { console.error("client error:", e); process.exit(33); });
        });
      `,
    });
    expect(await run(String(dir))).toEqual({ stdout: "got:Socket:open", exitCode: 0 });
  });

  test("child passes an accepted net.Socket to the parent via process.send", async () => {
    using dir = tempDir("ipc-send-socket-up", {
      "child.mjs": /* js */ `
        import net from "node:net";
        const srv = net.createServer(sock => {
          const sent = process.send("conn", sock);
          if (sent !== true) { console.error("process.send() returned", sent); process.exit(41); }
        });
        srv.listen(0, "127.0.0.1", () => process.send({ port: srv.address().port }));
      `,
      "parent.mjs": /* js */ `
        import { fork } from "node:child_process";
        import net from "node:net";

        const child = fork(new URL("./child.mjs", import.meta.url).pathname);
        child.on("exit", code => { if (code) process.exit(30); });

        child.on("message", (m, handle) => {
          if (m?.port) {
            const c = net.connect(m.port, "127.0.0.1");
            let data = "";
            c.on("data", d => (data += d));
            c.on("end", () => {
              console.log(data);
              child.kill();
              process.exit(data === "got:Socket" ? 0 : 1);
            });
            return;
          }
          if (m === "conn") {
            if (!handle) process.exit(40);
            handle.end("got:" + handle.constructor.name);
          }
        });
      `,
    });
    expect(await run(String(dir))).toEqual({ stdout: "got:Socket", exitCode: 0 });
  });

  test("{ keepOpen: true } leaves the sender's net.Socket attached", async () => {
    using dir = tempDir("ipc-send-keepopen", {
      "child.mjs": /* js */ `
        process.on("message", (m, handle) => {
          if (!handle) process.exit(40);
          handle.end("from-child");
        });
      `,
      "parent.mjs": /* js */ `
        import { fork } from "node:child_process";
        import net from "node:net";

        const child = fork(new URL("./child.mjs", import.meta.url).pathname);
        child.on("exit", code => { if (code) process.exit(30); });

        const srv = net.createServer(sock => {
          child.send("conn", sock, { keepOpen: true });
          // keepOpen: the sender's socket must stay usable.
          console.log("sender:" + sock.readyState);
        });

        srv.listen(0, "127.0.0.1", () => {
          const c = net.connect(srv.address().port, "127.0.0.1");
          let data = "";
          c.on("data", d => (data += d));
          c.on("end", () => {
            console.log("client:" + data);
            srv.close();
            child.kill();
            process.exit(data === "from-child" ? 0 : 1);
          });
        });
      `,
    });
    expect(await run(String(dir))).toEqual({ stdout: "sender:open\nclient:from-child", exitCode: 0 });
  });

  // The real test of the NODE_HANDLE wire format: a Node.js child must be able
  // to reconstruct the socket Bun sent it, using only Node's own machinery.
  test.skipIf(!node)("Bun parent passes an accepted net.Socket to a Node child", async () => {
    using dir = tempDir("ipc-send-socket-node", {
      "child.cjs": /* js */ `
        process.on("message", (m, handle) => {
          if (m !== "conn") return;
          if (!handle) { console.error("node child got no handle"); process.exit(40); }
          handle.end("got:" + handle.constructor.name);
        });
      `,
      "parent.mjs": /* js */ `
        import { fork } from "node:child_process";
        import net from "node:net";

        const child = fork(new URL("./child.cjs", import.meta.url).pathname, [], { execPath: ${JSON.stringify(node)} });
        child.on("exit", code => { if (code) process.exit(30); });

        const srv = net.createServer(sock => child.send("conn", sock));
        srv.listen(0, "127.0.0.1", () => {
          const c = net.connect(srv.address().port, "127.0.0.1");
          let data = "";
          c.on("data", d => (data += d));
          c.on("end", () => {
            console.log(data);
            srv.close();
            child.kill();
            process.exit(data === "got:Socket" ? 0 : 1);
          });
          c.on("error", e => { console.error("client error:", e); process.exit(33); });
        });
      `,
    });
    expect(await run(String(dir))).toEqual({ stdout: "got:Socket", exitCode: 0 });
  });
});

test("send(message, handle) with an unsupported handle type throws, never drops silently", async () => {
  using dir = tempDir("ipc-send-bad-handle", {
    "child.mjs": /* js */ `process.on("message", () => {}); process.on("disconnect", () => process.exit(0));`,
    "parent.mjs": /* js */ `
      import { fork } from "node:child_process";
      const child = fork(new URL("./child.mjs", import.meta.url).pathname);
      let err;
      let returned;
      try {
        returned = child.send("x", {});
      } catch (e) {
        err = e;
      }
      console.log(JSON.stringify({ returned, code: err?.code, name: err?.name }));
      child.disconnect();
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "parent.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) console.error("parent.mjs stderr:\n" + stderr);
  expect(JSON.parse(stdout)).toEqual({ code: "ERR_INVALID_HANDLE_TYPE", name: "TypeError" });
  expect(exitCode).toBe(0);
});
