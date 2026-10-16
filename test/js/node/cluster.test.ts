import { describe, expect, test } from "bun:test";
import {
  bunEnv,
  bunExe,
  bunRun,
  isIPv6,
  isLinux,
  isWindows,
  joinP,
  tempDir,
  tempDirWithFiles,
  tls as tlsCerts,
} from "harness";
import net from "node:net";

test.concurrent("cloneable and transferable equals", async () => {
  const dir = tempDirWithFiles("bun-test", {
    "index.ts": `
import cluster from "cluster";
import { expect } from "bun:test";
if (cluster.isPrimary) {
  cluster.settings.serialization = "advanced";
  const worker = cluster.fork();
  const original = Uint8Array.from([21, 11, 96, 126, 243, 128, 164]);
  const buf = Uint8Array.from([21, 11, 96, 126, 243, 128, 164]);
  const ab = buf.buffer.transfer();
  expect(ab).toBeInstanceOf(ArrayBuffer);
  expect(new Uint8Array(ab)).toEqual(original);
  worker.on("online", function () {
    worker.send(ab);
  });
  worker.on("message", function (data) {
    worker.kill();
    expect(data).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(data)).toEqual(original);
    process.exit(0);
  });
} else {
  process.on("message", msg => {
    console.log("W", msg);
    process.send!(msg);
  });
}
`,
  });
  expect(await bunRun(joinP(dir, "index.ts"), bunEnv)).toSpawn();
});

test.concurrent("cloneable and non-transferable not-equals (BunFile)", async () => {
  const dir = tempDirWithFiles("bun-test", {
    "index.ts": `
import cluster from "cluster";
import { expect } from "bun:test";
if (cluster.isPrimary) {
  cluster.settings.serialization = "advanced";
  const worker = cluster.fork();
  const file = Bun.file(import.meta.filename);
  console.log("P", "O", file);
  expect(file).toBeInstanceOf(Blob); // Bun.BunFile isnt exposed to JS
  expect(file.name).toEqual(import.meta.filename);
  expect(file.type).toEqual("text/javascript;charset=utf-8");
  worker.on("online", function () {
    worker.send({ file });
  });
  worker.on("exit", function (code, signal) {
    if (code !== 0) {
      process.exit(code);
    }
  });
  worker.on("message", function (data) {
    worker.kill();
    const { file } = data;
    console.log("P", "M", file);
    expect(file.name).toBeUndefined();
    expect(file.type).toBeUndefined();
    expect(file).toBeEmptyObject();
    process.exit(0);
  });
} else {
  process.on("message", msg => {
    console.log("W", msg);
    process.send!(msg);
  });
  process.on("uncaughtExceptionMonitor", (error) => {
    console.error(error);
    process.exit(1);
  });
}
`,
  });
  expect(await bunRun(joinP(dir, "index.ts"), bunEnv)).toSpawn();
});

test.concurrent("cloneable and non-transferable not-equals (net.BlockList)", async () => {
  const dir = tempDirWithFiles("bun-test", {
    "index.ts": `
import cluster from "cluster";
import net from "net";
import { expect } from "bun:test";
if (cluster.isPrimary) {
  cluster.settings.serialization = "advanced";
  const worker = cluster.fork();
  const blocklist = new net.BlockList();
  console.log("P", "O", blocklist);
  blocklist.addAddress("123.123.123.123");
  worker.on("online", function () {
    worker.send({ blocklist });
  });
  worker.on("exit", function (code, signal) {
    if (code !== 0) {
      process.exit(code);
    }
  });
  worker.on("message", function (data) {
    worker.kill();
    const { blocklist } = data;
    console.log("P", "M", blocklist);
    expect(blocklist.rules).toBeUndefined();
    expect(blocklist).toBeEmptyObject();
    process.exit(0);
  });
} else {
  process.on("message", msg => {
    console.log("W", msg);
    process.send!(msg); 
  });
  process.on("uncaughtExceptionMonitor", (error) => {
    console.error(error);
    process.exit(1);
  });
}
`,
  });
  expect(await bunRun(joinP(dir, "index.ts"), bunEnv)).toSpawn();
});

test.concurrent("non-cluster parent ignores cluster-internal IPC messages from a forked child", async () => {
  const dir = tempDirWithFiles("bun-test", {
    "parent.ts": `
const { fork } = require("node:child_process");
const path = require("node:path");

// Plain child_process.fork — this process never touches node:cluster's
// primary API, so no cluster message handler is registered for the child.
const child = fork(path.join(__dirname, "child.ts"), [], {
  env: { ...process.env, NODE_UNIQUE_ID: "1" },
});

child.on("message", msg => {
  if (msg === "regular message") {
    console.log("P received regular message");
    child.kill();
    process.exit(0);
  }
});

child.on("exit", (code, signal) => {
  // The child must stay alive until the parent has seen the regular message.
  console.error("child exited early", code, signal);
  process.exit(1);
});
`,
    "child.ts": `
// With NODE_UNIQUE_ID set, loading node:cluster makes this process behave as a
// cluster worker: it immediately writes a cluster-internal {act:"online"} IPC
// frame to its parent, even though the parent never registered node:cluster's
// primary callback. The parent must drop that frame instead of crashing.
require("node:cluster");
process.send("regular message");
`,
  });
  const { stdout, exitCode } = await bunRun(joinP(dir, "parent.ts"), bunEnv);
  expect(stdout).toContain("P received regular message");
  expect(exitCode).toBe(0);
});

test("TLS worker listening on a key already owned by a round-robin handle fails with EINVAL", async () => {
  const dir = tempDirWithFiles("bun-test", {
    "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");
const tls = require("node:tls");

if (cluster.isPrimary) {
  const netWorker = cluster.fork({ ROLE: "net" });
  cluster.once("listening", () => {
    const tlsWorker = cluster.fork({ ROLE: "tls" });
    tlsWorker.on("message", msg => {
      console.log("tls listen error code:", msg.code, msg.msg);
      netWorker.kill();
      tlsWorker.kill();
      process.exit(0);
    });
  });
} else if (process.env.ROLE === "net") {
  net.createServer(() => {}).listen(0);
} else {
  const server = tls.createServer({});
  server.on("error", err => process.send({ code: err.code, msg: err.message }));
  server.listen(0);
}
`,
  });
  const { stdout } = await bunRun(joinP(dir, "main.ts"), bunEnv);
  expect(stdout).toContain("tls listen error code: EINVAL");
  expect(stdout).toContain("TLS and non-TLS cluster workers cannot share");
});

test("cluster pipe listen error carries no port suffix", async () => {
  const dir = tempDirWithFiles("bun-test", {
    "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");
const path = require("node:path");

if (cluster.isPrimary) {
  const PIPE =
    process.platform === "win32"
      ? String.raw\`\\\\.\\pipe\\bun-cluster-pipe-err-\${process.pid}\`
      : path.join(__dirname, "test.sock");
  const blocker = net.createServer(() => {});
  blocker.listen(PIPE, () => {
    const worker = cluster.fork({ BUN_CLUSTER_PIPE: PIPE });
    worker.on("message", msg => {
      console.log("code:", msg.code);
      console.log("message:", msg.message);
      console.log("port:", msg.port);
      worker.kill();
      blocker.close();
      process.exit(0);
    });
  });
} else {
  const server = net.createServer(() => {});
  server.on("error", err => process.send({ code: err.code, message: err.message, port: err.port }));
  server.listen(process.env.BUN_CLUSTER_PIPE);
}
`,
  });
  const { stdout } = await bunRun(joinP(dir, "main.ts"), bunEnv);
  expect(stdout).toContain("code: EADDRINUSE");
  expect(stdout).not.toContain(":-1");
  expect(stdout).toContain("port: -1");
});

test.skipIf(isWindows)("SCHED_NONE pipe listen unlinks the socket file when the last worker leaves", async () => {
  const dir = tempDirWithFiles("bun-test", {
    "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");

cluster.schedulingPolicy = cluster.SCHED_NONE;
const SOCK = path.join(__dirname, "test.sock");

if (cluster.isPrimary) {
  const worker = cluster.fork({ BUN_CLUSTER_SOCK: SOCK });
  cluster.on("listening", () => {
    console.log("exists while listening:", fs.existsSync(SOCK));
    worker.disconnect();
  });
  cluster.on("exit", () => {
    console.log("exists after exit:", fs.existsSync(SOCK));
    process.exit(0);
  });
} else {
  net.createServer(() => {}).listen(process.env.BUN_CLUSTER_SOCK);
}
`,
  });
  const { stdout } = await bunRun(joinP(dir, "main.ts"), bunEnv);
  expect(stdout).toContain("exists while listening: true");
  expect(stdout).toContain("exists after exit: false");
});

test.skipIf(isWindows)("round-robin pipe listen applies readableAll/writableAll to the socket file", async () => {
  const dir = tempDirWithFiles("bun-test", {
    "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");

const SOCK = path.join(__dirname, "rr-perm.sock");

if (cluster.isPrimary) {
  const worker = cluster.fork({ BUN_CLUSTER_SOCK: SOCK });
  cluster.on("listening", () => {
    const mode = fs.statSync(SOCK).mode;
    console.log("perm bits:", (mode & 0o066).toString(8));
    worker.disconnect();
  });
  worker.on("exit", (code, signal) => {
    console.log("worker exit:", code, signal);
    process.exit(0);
  });
} else {
  net.createServer(() => {}).listen({ path: process.env.BUN_CLUSTER_SOCK, readableAll: true, writableAll: true });
}
`,
  });
  const { stdout } = await bunRun(joinP(dir, "main.ts"), bunEnv);
  expect(stdout).toContain("perm bits: 66");
  expect(stdout).toContain("worker exit: 0");
});

test.skipIf(isWindows)("round-robin accepted sockets honor allowHalfOpen after the client's FIN", async () => {
  const dir = tempDirWithFiles("bun-test", {
    "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");

if (cluster.isPrimary) {
  const worker = cluster.fork();
  cluster.on("listening", (w, address) => {
    const c = net.connect({ host: "127.0.0.1", port: address.port, allowHalfOpen: true });
    let buf = "";
    c.on("data", d => (buf += d));
    c.on("connect", () => {
      c.write("ping");
      c.end();
    });
    c.on("end", () => {
      console.log("client got:", buf);
      worker.kill();
      process.exit(0);
    });
    c.on("error", e => {
      console.log("client error:", e.code);
      process.exit(1);
    });
  });
} else {
  net
    .createServer({ allowHalfOpen: true }, socket => {
      let buf = "";
      socket.on("data", d => (buf += d));
      socket.on("end", () => {
        setTimeout(() => socket.end("pong:" + buf), 50);
      });
    })
    .listen(0, "127.0.0.1");
}
`,
  });
  const { stdout } = await bunRun(joinP(dir, "main.ts"), bunEnv);
  expect(stdout).toContain("client got: pong:ping");
});

test("round-robin accepted sockets honor the server's highWaterMark", async () => {
  const dir = tempDirWithFiles("bun-test", {
    "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");

if (cluster.isPrimary) {
  const worker = cluster.fork();
  worker.on("message", m => {
    console.log("accepted hwm:", m.hwm);
    worker.kill();
    process.exit(0);
  });
  cluster.on("listening", (w, address) => {
    const c = net.connect({ host: "127.0.0.1", port: address.port });
    c.on("error", () => {});
  });
} else {
  net
    .createServer({ highWaterMark: 1234 }, socket => {
      process.send({ hwm: socket.readableHighWaterMark });
      socket.end();
    })
    .listen(0, "127.0.0.1");
}
`,
  });
  const { stdout } = await bunRun(joinP(dir, "main.ts"), bunEnv);
  expect(stdout).toContain("accepted hwm: 1234");
});

test.skipIf(!isIPv6())("SCHED_NONE listen with no host binds the IPv6 wildcard (dual-stack)", async () => {
  const dir = tempDirWithFiles("bun-test", {
    "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");

cluster.schedulingPolicy = cluster.SCHED_NONE;

if (cluster.isPrimary) {
  const worker = cluster.fork();
  cluster.on("listening", (w, address) => {
    const c = net.connect({ host: "::1", port: address.port });
    c.on("connect", () => {
      console.log("ipv6 connect ok");
      c.end();
      worker.kill();
      process.exit(0);
    });
    c.on("error", err => {
      console.log("ipv6 connect error:", err.code);
      worker.kill();
      process.exit(1);
    });
  });
} else {
  net.createServer(s => s.end()).listen(0);
}
`,
  });
  const { stdout } = await bunRun(joinP(dir, "main.ts"), bunEnv);
  expect(stdout).toContain("ipv6 connect ok");
});

test("SCHED_NONE: a second worker listens on the same shared handle", async () => {
  const dir = tempDirWithFiles("bun-test", {
    "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");

cluster.schedulingPolicy = cluster.SCHED_NONE;

if (cluster.isPrimary) {
  const workers = [cluster.fork(), cluster.fork()];
  let listening = 0;
  const ports = new Set();
  console.log("policy is SCHED_NONE:", cluster.schedulingPolicy === cluster.SCHED_NONE);
  cluster.on("listening", (w, address) => {
    ports.add(address.port);
    if (++listening !== 2) return;
    console.log("listening workers:", listening, "distinct ports:", ports.size);
    for (const w of workers) w.kill();
    process.exit(0);
  });
  for (const w of workers) {
    w.on("message", msg => {
      console.log("worker listen error:", msg.code, msg.msg);
      for (const x of workers) x.kill();
      process.exit(1);
    });
  }
} else {
  const server = net.createServer(s => s.end());
  server.on("error", err => process.send({ code: err.code, msg: err.message }));
  server.listen(0, "127.0.0.1");
}
`,
  });
  const { stdout } = await bunRun(joinP(dir, "main.ts"), bunEnv);
  expect(stdout).toContain("policy is SCHED_NONE: true");
  expect(stdout).toContain("listening workers: 2 distinct ports: 1");
});

test("SCHED_NONE: close() releases the shared handle so the worker can re-listen on the same port", async () => {
  using dir = tempDir("cluster-shared-relisten", {
    "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");
cluster.schedulingPolicy = cluster.SCHED_NONE;
if (cluster.isPrimary) {
  const worker = cluster.fork();
  worker.on("message", m => {
    if (m.port) { const c = net.connect(m.port, "127.0.0.1"); c.on("error", () => {}); return; }
    console.log(JSON.stringify(m));
    worker.disconnect();
  });
} else {
  const first = net.createServer(sock => {
    // Close while this connection is still open, then re-listen on the same port immediately.
    const port = first.address().port;
    first.close();
    const second = net.createServer();
    const report = result => { sock.destroy(); second.close(); process.send(result); };
    second.on("error", err => report({ relisten: err.code }));
    second.listen(port, "127.0.0.1", () => report({ relisten: "ok", samePort: second.address().port === port }));
  });
  first.listen(0, "127.0.0.1", () => process.send({ port: first.address().port }));
}
`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ out: JSON.parse(stdout.trim()), stderr }).toEqual({
    out: { relisten: "ok", samePort: true },
    stderr: expect.any(String),
  });
  expect(exitCode).toBe(0);
});

test.skipIf(isWindows)("SCHED_NONE: a worker listening on a unix path reports it from address()", async () => {
  using dir = tempDir("cluster-shared-unix-address", {
    "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");
const path = require("node:path");
cluster.schedulingPolicy = cluster.SCHED_NONE;
const SOCK = path.join(__dirname, "srv.sock");
if (cluster.isPrimary) {
  const worker = cluster.fork();
  worker.on("message", m => { console.log(JSON.stringify(m)); worker.disconnect(); });
} else {
  const server = net.createServer();
  server.listen(SOCK, () => { const address = server.address(); server.close(() => process.send({ address, expected: SOCK })); });
}
`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const out = JSON.parse(stdout.trim());
  expect({ address: out.address, stderr }).toEqual({ address: out.expected, stderr: expect.any(String) });
  expect(exitCode).toBe(0);
});

test.skipIf(!isLinux)("SCHED_NONE: an abstract-namespace listen is reachable by clients", async () => {
  using dir = tempDir("cluster-shared-abstract", {
    "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");
cluster.schedulingPolicy = cluster.SCHED_NONE;
const NAME = "\\0bun-cluster-abstract-" + (process.env.ABSTRACT_ID || process.pid);
if (cluster.isPrimary) {
  const worker = cluster.fork({ ABSTRACT_ID: String(process.pid) });
  worker.on("message", () => {
    const finish = result => { console.log(JSON.stringify(result)); worker.send("close"); };
    const c = net.connect(NAME, () => { c.destroy(); finish({ connect: "ok" }); });
    c.on("error", err => finish({ connect: err.code }));
  });
  worker.on("exit", code => process.exitCode = code);
} else {
  const server = net.createServer(s => s.end());
  process.on("message", () => server.close(() => process.disconnect()));
  server.listen(NAME, () => process.send("listening"));
}
`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ out: JSON.parse(stdout.trim()), stderr }).toEqual({ out: { connect: "ok" }, stderr: expect.any(String) });
  expect(exitCode).toBe(0);
});

test("disconnect() on a cluster.Worker built around a plain object does not abort", async () => {
  // `kHandle` is a private symbol that only `cluster.fork()` sets, so a
  // `cluster.Worker({ process })` built around a plain object (how Node's own
  // tests mock workers) hands `undefined` to the native `sendHelper` binding.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const cluster = require("node:cluster");
        const fake = { on() {}, disconnect() {}, kill() {}, send() { return false; } };
        const worker = new cluster.Worker({ process: fake });
        const returned = worker.disconnect();
        console.log("returned self:", returned === worker);
      `,
    ],
    env: bunEnv,
    // Inherited so that on regression the child's abort output reaches the
    // runner log instead of filling an unread pipe.
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "returned self: true", exitCode: 0 });
});

// The primary and the worker of a fixture each print one JSON line on the stdout they share.
async function runDisconnectFixture(files: Record<string, string>) {
  using dir = tempDir("cluster-primary-disconnect", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    // Inherited so that on regression the fixture's errors reach the runner log.
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  const lines = stdout.split("\n").filter(Boolean);
  return { ...Object.assign({}, ...lines.map(line => JSON.parse(line))), exitCode };
}

// A primary's worker.disconnect() only sends a request. The worker closes its servers, waits for
// their 'close' events and then closes the channel itself, so everything the primary queued before
// the request still arrives. https://nodejs.org/api/cluster.html#workerdisconnect
test.concurrent("primary worker.disconnect() delivers the messages send() already accepted", async () => {
  const result = await runDisconnectFixture({
    "main.js": `
        const cluster = require("node:cluster");
        const N = 50;
        if (cluster.isPrimary) {
          const worker = cluster.fork();
          worker.once("message", () => {
            // 64 KiB each, so most of them are still queued behind the socket buffer at disconnect().
            const payload = Buffer.alloc(64 * 1024, "z").toString();
            let acked = 0;
            for (let i = 0; i < N; i++) worker.send({ i, payload }, err => { if (!err) acked++; });
            worker.disconnect();
            worker.once("exit", (code, signal) => {
              console.log(JSON.stringify({ primary: { acked, exit: { code, signal } } }));
            });
          });
        } else {
          let received = 0;
          const events = [];
          process.on("message", () => received++);
          process.on("disconnect", () => events.push("disconnect after " + received + " messages"));
          process.on("exit", () => require("node:fs").writeSync(1, JSON.stringify({ worker: events }) + "\\n"));
          process.send("ready");
        }
      `,
  });
  expect(result).toEqual({
    worker: ["disconnect after 50 messages"],
    primary: { acked: 50, exit: { code: 0, signal: null } },
    exitCode: 0,
  });
});

// A repeated request finds the worker's handle table already empty, and must still wait for the first one.
test.concurrent.each([
  ["one request", 1],
  ["a repeated request", 2],
])(
  "primary worker.disconnect() keeps the channel up until the worker's servers have closed (%s)",
  async (_, requests) => {
    const result = await runDisconnectFixture({
      "main.js": `
        const cluster = require("node:cluster");
        const net = require("node:net");

        if (cluster.isPrimary) {
          const result = {};
          const worker = cluster.fork();
          worker.on("message", msg => {
            if (msg.port) {
              const client = net.connect(msg.port, "127.0.0.1");
              client.on("end", () => client.end());
              client.resume();
            } else if (msg === "accepted") {
              for (let i = 0; i < ${requests}; i++) worker.disconnect();
              result.connectedAfterDisconnect = worker.isConnected();
              worker.send("ping", err => {
                result.ping = err ? err.code : "sent";
              });
            }
          });
          let pending = 2;
          const done = () => {
            if (--pending === 0) console.log(JSON.stringify({ primary: result }));
          };
          worker.once("disconnect", done);
          worker.once("exit", (code, signal) => {
            result.exit = { code, signal };
            done();
          });
        } else {
          const events = [];
          let socket;
          const server = net.createServer(accepted => {
            socket = accepted;
            socket.resume();
            process.send("accepted");
          });
          server.on("close", () => events.push("server close, connected: " + process.connected));
          // The connection stays open until the worker has either the ping, which follows the
          // disconnect request on the same channel, or a 'disconnect' that did not wait for the server.
          process.on("message", msg => {
            if (msg === "ping") socket.end();
          });
          cluster.worker.on("disconnect", () => {
            events.push("disconnect");
            socket.end();
          });
          process.on("exit", () => require("node:fs").writeSync(1, JSON.stringify({ worker: events }) + "\\n"));
          server.listen(0, "127.0.0.1", () => process.send({ port: server.address().port }));
        }
      `,
    });
    expect(result).toEqual({
      worker: ["server close, connected: true", "disconnect"],
      primary: { connectedAfterDisconnect: true, ping: "sent", exit: { code: 0, signal: null } },
      exitCode: 0,
    });
  },
);

// Starts a worker script that never loads node:cluster. Prints { primary: events } once the worker has both
// disconnected and exited, so that a row does not depend on the order of those two events.
const scriptWorkerPrimary = ({ exec = "worker.js", execArgv = "[]", silent = false } = {}) => `
const cluster = require("node:cluster");
const path = require("node:path");
cluster.setupPrimary({ exec: path.join(__dirname, ${JSON.stringify(exec)}), execArgv: ${execArgv}, silent: ${silent} });
const events = [];
const worker = cluster.fork();
worker.on("online", () => events.push("online, state " + worker.state));
let pending = 2;
const done = () => {
  if (--pending === 0) console.log(JSON.stringify({ primary: events }));
};
worker.once("disconnect", done);
worker.once("exit", (code, signal) => {
  events.push("exit " + code + " " + signal);
  done();
});
`;
const printWorkerAtExit = (what: string) =>
  `process.on("exit", () => require("node:fs").writeSync(1, JSON.stringify({ worker: ${what} }) + "\\n"));`;

// Node.js sets a worker up before any user code (initializeClusterIPC in lib/internal/process/pre_execution.js),
// so a worker does not have to load node:cluster to be one.
describe.concurrent("a worker that never loads node:cluster", () => {
  test.each([
    {
      name: "comes online, gets the job that the primary sends on 'online', and honors disconnect()",
      files: {
        "main.js": `${scriptWorkerPrimary()}
  worker.once("online", () => worker.send(21));
  worker.on("message", message => {
    events.push("message " + message);
    // A "ready" with no 'online' before it: no job was sent, so there is no answer to wait for.
    if (message === 42 || worker.state === "none") worker.disconnect();
  });`,
        "worker.js": `
  const events = [];
  process.on("message", n => process.send(n * 2));
  process.on("disconnect", () => events.push("disconnect"));
  ${printWorkerAtExit("events")}
  process.send("ready");`,
      },
      expected: {
        worker: ["disconnect"],
        primary: ["online, state online", "message ready", "message 42", "exit 0 null"],
      },
    },
    {
      name: "is set up before a --require preload and the entry: no NODE_UNIQUE_ID, one 'message' and one 'disconnect' listener",
      files: {
        "main.js": `${scriptWorkerPrimary({ execArgv: `["--require", path.join(__dirname, "preload.js")]` })}
  worker.once("message", seen => {
    events.push(...seen);
    worker.disconnect();
  });`,
        "preload.js": `
  globalThis.snapshot = where =>
    where + ": NODE_UNIQUE_ID " + process.env.NODE_UNIQUE_ID + ", listeners " + process.listenerCount("message") + " " + process.listenerCount("disconnect");
  globalThis.seen = [snapshot("preload")];`,
        "worker.js": `
  seen.push(snapshot("entry"));
  process.send(seen);`,
      },
      expected: {
        primary: [
          "online, state online",
          "preload: NODE_UNIQUE_ID undefined, listeners 1 1",
          "entry: NODE_UNIQUE_ID undefined, listeners 1 1",
          "exit 0 null",
        ],
      },
    },
    {
      name: "stays alive while it is connected, with nothing left to do",
      files: {
        "main.js": `${scriptWorkerPrimary()}
  worker.once("online", () => worker.disconnect());`,
        "worker.js": printWorkerAtExit(`"connected at exit: " + process.connected`),
      },
      expected: {
        worker: "connected at exit: false",
        primary: ["online, state online", "exit 0 null"],
      },
    },
    {
      name: "exits at once when its channel closes without a disconnect request",
      files: {
        "main.js": `${scriptWorkerPrimary()}
  worker.once("message", () => worker.process.disconnect());`,
        "worker.js": `
  const events = [];
  process.on("disconnect", () => events.push("a listener that the script added"));
  process.on("exit", code => events.push("exit " + code));
  ${printWorkerAtExit("events")}
  process.send("ready");`,
      },
      expected: {
        worker: ["exit 0"],
        primary: ["online, state online", "exit 0 null"],
      },
    },
    {
      name: "has worker threads that are not workers",
      files: {
        "main.js": `${scriptWorkerPrimary()}
  worker.once("message", seen => {
    events.push(seen);
    worker.disconnect();
  });`,
        "worker.js": `
  const { Worker } = require("node:worker_threads");
  new Worker(require("node:path").join(__dirname, "thread.js")).once("message", seen => process.send(seen));`,
        "thread.js": `
  const { parentPort } = require("node:worker_threads");
  parentPort.postMessage("thread: NODE_UNIQUE_ID " + process.env.NODE_UNIQUE_ID + ", isPrimary " + require("node:cluster").isPrimary);`,
      },
      expected: {
        primary: ["online, state online", "thread: NODE_UNIQUE_ID undefined, isPrimary true", "exit 0 null"],
      },
    },
    {
      name: "is not set up again when it loads node:cluster later",
      files: {
        "main.js": `${scriptWorkerPrimary()}
  worker.on("message", message => {
    events.push("message " + message);
    if (message !== "first") worker.disconnect();
  });`,
        "worker.js": `
  process.send("first");
  setImmediate(() => {
    const cluster = require("node:cluster");
    process.send("worker id " + cluster.worker.id + ", isWorker " + cluster.isWorker);
  });`,
      },
      expected: {
        primary: ["online, state online", "message first", "message worker id 1, isWorker true", "exit 0 null"],
      },
    },
    {
      name: "still gets a message sent right after fork() when its ESM graph loads first",
      files: {
        "main.js": `${scriptWorkerPrimary({ exec: "worker.mjs" })}
  worker.send("early");
  worker.once("message", message => {
    events.push("message " + message);
    worker.disconnect();
  });`,
        "worker.mjs": `import "./a.mjs";\nprocess.on("message", message => process.send("got " + message));`,
        "a.mjs": `import "./b.mjs";`,
        "b.mjs": `import "./c.mjs";`,
        "c.mjs": `export {};`,
      },
      expected: {
        primary: ["online, state online", "message got early", "exit 0 null"],
      },
    },
  ])("$name", async ({ files, expected }) => {
    expect(await runDisconnectFixture(files)).toEqual({ ...expected, exitCode: 0 });
  });
});

test.concurrent.each([
  {
    name: "fork(), send() and disconnect() in one tick deliver 'online' and every message",
    files: {
      "main.js": `
const cluster = require("node:cluster");
const N = 50;
if (cluster.isPrimary) {
  const events = [];
  const worker = cluster.fork();
  worker.on("online", () => events.push("worker online"));
  cluster.on("online", () => events.push("cluster online"));
  // 64 KiB each, so most of them are still queued behind the socket buffer at disconnect().
  const payload = Buffer.alloc(64 * 1024, "z").toString();
  let acked = 0;
  for (let i = 0; i < N; i++) worker.send({ i, payload }, err => { if (!err) acked++; });
  worker.disconnect();
  let pending = 2;
  let exit;
  const done = () => {
    if (--pending === 0) console.log(JSON.stringify({ primary: { events, acked, exit } }));
  };
  worker.once("disconnect", done);
  worker.once("exit", (code, signal) => {
    exit = { code, signal };
    done();
  });
} else {
  let received = 0;
  const events = [];
  process.on("message", () => received++);
  process.on("disconnect", () => events.push("disconnect after " + received + " messages"));
  ${printWorkerAtExit("events")}
}`,
    },
    expected: {
      worker: ["disconnect after 50 messages"],
      primary: { events: ["worker online", "cluster online"], acked: 50, exit: { code: 0, signal: null } },
    },
  },
  {
    name: "a process that sets NODE_UNIQUE_ID at run time is not set up as a worker, and its http server listens",
    files: {
      "main.js": `
const child = require("node:child_process").fork(require("node:path").join(__dirname, "child.js"));
const messages = [];
child.on("message", message => {
  messages.push(message);
  if (message === "listening") child.disconnect();
});
child.once("exit", code => console.log(JSON.stringify({ primary: { messages, code } })));`,
      "child.js": `
process.env.NODE_UNIQUE_ID = "7";
const cluster = require("node:cluster");
process.send("isWorker " + cluster.isWorker + ", worker " + (cluster.worker === null ? null : "set") + ", NODE_UNIQUE_ID " + process.env.NODE_UNIQUE_ID);
require("node:http").createServer().listen(0, function () {
  process.send("listening");
  this.close();
});`,
    },
    expected: {
      primary: { messages: ["isWorker true, worker null, NODE_UNIQUE_ID 7", "listening"], code: 0 },
    },
  },
  {
    name: "a process that a worker starts with Bun.spawn({ ipc }) and no env option is not set up as a worker",
    files: {
      "main.js": `${scriptWorkerPrimary()}
worker.once("message", seen => {
  events.push(seen);
  worker.disconnect();
});`,
      "worker.js": `
const messages = [];
const child = Bun.spawn({
  cmd: [process.execPath, require("node:path").join(__dirname, "child.js")],
  stdio: ["ignore", "inherit", "inherit"],
  ipc: message => messages.push(message),
});
child.exited.then(code => process.send("child: " + JSON.stringify(messages) + ", exit " + code));`,
      "child.js": `process.send("from the child");`,
    },
    expected: {
      primary: ["online, state online", 'child: ["from the child"], exit 0', "exit 0 null"],
    },
  },
  {
    name: "a send() that the primary queues behind the disconnect request still gets its callback",
    files: {
      "main.js": `
const cluster = require("node:cluster");
const N = 50;
if (cluster.isPrimary) {
  const worker = cluster.fork();
  let callbacks = 0;
  worker.once("online", () => {
    worker.disconnect();
    // 64 KiB each, so most of them are still queued when the worker closes the channel.
    const payload = Buffer.alloc(64 * 1024, "z").toString();
    for (let i = 0; i < N; i++) worker.send({ i, payload }, () => callbacks++);
  });
  let pending = 2;
  let exit;
  const done = () => {
    if (--pending === 0) console.log(JSON.stringify({ primary: { callbacks, exit } }));
  };
  worker.once("disconnect", done);
  worker.once("exit", (code, signal) => {
    exit = { code, signal };
    done();
  });
}`,
    },
    expected: {
      primary: { callbacks: 50, exit: { code: 0, signal: null } },
    },
  },
  {
    name: "a worker that runs under bun test is set up, and its net server listens",
    files: {
      // silent: the report that bun test prints must not reach the stdout this fixture is parsed from.
      "main.js": `${scriptWorkerPrimary({ exec: "worker.test.js", execArgv: `["test"]`, silent: true })}
worker.process.stdout.resume();
worker.process.stderr.pipe(process.stderr);
worker.once("message", message => {
  events.push(message);
  worker.disconnect();
});`,
      "worker.test.js": `
const { test } = require("bun:test");
test("listen", async () => {
  const { promise, resolve, reject } = Promise.withResolvers();
  const server = require("node:net").createServer();
  server.once("error", reject);
  server.listen(0, () => server.close(resolve));
  await promise;
  // The test ends when the primary has the message and has asked for the disconnect, not when bun test exits.
  const disconnected = new Promise(done => process.once("disconnect", done));
  process.send("listened, NODE_UNIQUE_ID " + process.env.NODE_UNIQUE_ID);
  await disconnected;
});`,
    },
    expected: {
      primary: ["online, state online", "listened, NODE_UNIQUE_ID undefined", "exit 0 null"],
    },
  },
  {
    name: "a process that sets NODE_UNIQUE_ID at run time can listen with exclusive after a listen through the cluster",
    files: {
      "main.js": `
process.env.NODE_UNIQUE_ID = "7";
const cluster = require("node:cluster");
const events = [];
const print = () => console.log(JSON.stringify({ primary: { worker: cluster.worker, events } }));
process.on("uncaughtException", error => {
  events.push("uncaught " + error.constructor.name);
  print();
});
const server = require("node:net").createServer();
// Asks a primary that does not exist, and leaves a 'listening' listener that expects a worker.
server.listen(0);
server.listen({ port: 0, exclusive: true }, () => {
  events.push("listening");
  server.close(print);
});`,
    },
    expected: {
      primary: { worker: null, events: ["listening"] },
    },
  },
  {
    name: "a process with NODE_UNIQUE_ID and no script (-e) is not set up as a worker",
    files: {
      "main.js": `
const { stdout } = require("node:child_process").spawnSync(
  process.execPath,
  ["-e", 'const cluster = require("node:cluster"); console.log(JSON.stringify({ primary: [cluster.isWorker, cluster.worker, process.env.NODE_UNIQUE_ID] }))'],
  { env: { ...process.env, NODE_UNIQUE_ID: "5" }, stdio: ["ignore", "pipe", "inherit"] },
);
process.stdout.write(stdout);`,
    },
    expected: {
      primary: [true, null, "5"],
    },
  },
])("$name", async ({ files, expected }) => {
  expect(await runDisconnectFixture(files)).toEqual({ ...expected, exitCode: 0 });
});

const listeningPayloadFixture = `
const cluster = require("node:cluster");

const targets = JSON.parse(process.env.TARGETS);

if (cluster.isPrimary) {
  const payloads = [];
  const { promise, resolve, reject } = Promise.withResolvers();
  const worker = cluster.fork();

  cluster.on("listening", (listeningWorker, address) => {
    if (listeningWorker !== worker) {
      reject(new Error("'listening' came from an unexpected worker"));
      return;
    }
    payloads.push({ address: address.address, addressType: address.addressType, port: address.port });
    if (payloads.length === targets.length) resolve();
  });
  worker.on("error", reject);
  worker.on("exit", (code, signal) => {
    reject(new Error("worker exited before it finished listening (" + code + ", " + signal + ")"));
  });

  promise.then(
    () => {
      console.log(JSON.stringify(payloads));
      worker.kill();
      process.exit(0);
    },
    error => {
      console.error(error);
      process.exit(1);
    },
  );
} else {
  const { createServer } = require("node:" + process.env.MODULE);

  (async () => {
    for (const target of targets) {
      const server = createServer(() => {});
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        if (target.path) server.listen(target.path, resolve);
        else if (target.host === null) server.listen(0, resolve);
        else server.listen(0, target.host, resolve);
      });
    }
  })().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
`;

test.each(["net", "http"])("cluster 'listening' reports the address a %s server bound", async moduleName => {
  const dir = tempDirWithFiles("cluster-listening", { "fixture.js": listeningPayloadFixture });
  const targets: ({ host: string | null } | { path: string })[] = [{ host: "127.0.0.1" }, { host: null }];
  if (isIPv6()) targets.push({ host: "::1" });
  if (!isWindows) targets.push({ path: joinP(dir, `${moduleName}.sock`) });

  const { stdout } = await bunRun(joinP(dir, "fixture.js"), { MODULE: moduleName, TARGETS: JSON.stringify(targets) });
  const payloads = JSON.parse(stdout);

  expect(payloads).toEqual(
    targets.map(target =>
      "path" in target
        ? { address: target.path, addressType: -1, port: -1 }
        : {
            address: target.host,
            addressType: target.host?.includes(":") ? 6 : 4,
            port: expect.any(Number),
          },
    ),
  );
  for (const [i, target] of targets.entries()) {
    if (!("path" in target)) expect(payloads[i].port).toBeWithin(1, 65536);
  }
});

// Node registers the listen() callback before the worker's own 'listening' listener that notifies
// the primary. So the callback still sees worker.state 'online', and the primary receives what the
// callback sends before cluster emits 'listening'.
const listenCallbackOrderFixture = `
const cluster = require("node:cluster");

if (cluster.isPrimary) {
  const order = [];
  const worker = cluster.fork();
  const done = () => {
    if (order.length < 2) return;
    console.log(JSON.stringify(order));
    worker.kill();
    process.exit(0);
  };
  worker.on("message", message => {
    order.push("callback:" + message.state);
    done();
  });
  cluster.on("listening", () => {
    order.push("cluster:listening");
    done();
  });
  worker.on("exit", (code, signal) => {
    console.error("worker exited before it finished listening (" + code + ", " + signal + ")");
    process.exit(1);
  });
} else {
  const { createServer } = require("node:" + process.env.MODULE);
  createServer(() => {}).listen(0, () => process.send({ state: cluster.worker.state }));
}
`;

test.each(["net", "http"])(
  "a %s server's listen() callback runs before the worker reports 'listening'",
  async moduleName => {
    const dir = tempDirWithFiles("cluster-listen-callback", { "fixture.js": listenCallbackOrderFixture });
    const { stdout, stderr, exitCode } = await bunRun(joinP(dir, "fixture.js"), { MODULE: moduleName });
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: JSON.stringify(["callback:online", "cluster:listening"]),
      stderr: "",
      exitCode: 0,
    });
  },
);

test("round-robin worker connection socket has connecting=false and remoteAddress synchronously", async () => {
  const dir = tempDirWithFiles("bun-test", {
    "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");

if (cluster.isPrimary) {
  const worker = cluster.fork();
  worker.on("message", m => {
    console.log(JSON.stringify(m));
    worker.kill();
    process.exit(0);
  });
  cluster.on("listening", (w, address) => {
    net.connect(address.port, "127.0.0.1").on("error", () => {});
  });
} else {
  net
    .createServer(socket => {
      process.send({
        connecting: socket.connecting,
        readyState: socket.readyState,
        remote: typeof socket.remoteAddress,
      });
      socket.end();
    })
    .listen(0, "127.0.0.1");
}
`,
  });
  const { stdout } = await bunRun(joinP(dir, "main.ts"), bunEnv);
  const m = JSON.parse(stdout.trim());
  expect(m.connecting).toBe(false);
  expect(m.readyState).toBe("open");
  expect(m.remote).toBe("string");
});

test("round-robin: primary never consumes accepted-socket bytes before handoff", async () => {
  const dir = tempDirWithFiles("bun-test", {
    "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");

const N = 20;
if (cluster.isPrimary) {
  const worker = cluster.fork();
  let got = 0;
  worker.on("message", m => {
    console.log(m);
    if (++got === N) {
      worker.kill();
      process.exit(0);
    }
  });
  cluster.on("listening", (w, address) => {
    for (let i = 0; i < N; i++) {
      const c = net.connect(address.port, "127.0.0.1", () => {
        c.write("MAGIC-" + i + "-" + "x".repeat(4096));
        c.end();
      });
      c.on("error", () => {});
    }
  });
} else {
  net
    .createServer(sock => {
      let buf = "";
      sock.on("data", d => (buf += d));
      sock.on("end", () => process.send(buf.slice(0, 20) + " " + buf.length));
    })
    .listen(0, "127.0.0.1");
}
`,
  });
  const { stdout } = await bunRun(joinP(dir, "main.ts"), bunEnv);
  const lines = stdout.trim().split("\n").sort();
  expect(lines.length).toBe(20);
  for (const line of lines) {
    expect(line).toMatch(/^MAGIC-\d+-x+ 41\d\d$/);
  }
});

test("TLS cluster worker under SCHED_RR listens on a shared handle and completes handshakes", async () => {
  const dir = tempDirWithFiles("bun-test", {
    "cert.pem": tlsCerts.cert,
    "key.pem": tlsCerts.key,
    "main.ts": `
const cluster = require("node:cluster");
const tls = require("node:tls");
const fs = require("node:fs");
const path = require("node:path");
const key = fs.readFileSync(path.join(__dirname, "key.pem"));
const cert = fs.readFileSync(path.join(__dirname, "cert.pem"));

if (cluster.isPrimary) {
  const w1 = cluster.fork();
  const w2 = cluster.fork();
  const ports = new Set();
  let listening = 0;
  for (const w of [w1, w2]) {
    w.on("message", msg => {
      if (!msg || !msg.listenError) return;
      const e = msg.listenError;
      console.log("worker listen error:", e.code, e.errno, e.syscall, e.msg);
      w1.kill();
      w2.kill();
      process.exit(1);
    });
  }
  cluster.on("listening", (w, address) => {
    ports.add(address.port);
    if (++listening !== 2) return;
    console.log("distinct ports:", ports.size);
    const port = address.port;
    const c = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false }, () => {
      c.write("hi");
    });
    c.setEncoding("utf8");
    c.on("data", d => {
      console.log("reply:", d);
      c.end();
      w1.kill();
      w2.kill();
      process.exit(0);
    });
    c.on("error", e => {
      console.log("client error:", e.code);
      process.exit(1);
    });
  });
} else {
  const server = tls.createServer({ key, cert }, socket => {
    socket.on("data", d => socket.end("echo:" + d));
  });
  server.on("error", e =>
    process.send({ listenError: { code: e.code, errno: e.errno, syscall: e.syscall, msg: e.message } }),
  );
  server.listen(0);
}
`,
  });
  const { stdout } = await bunRun(joinP(dir, "main.ts"), bunEnv);
  expect(stdout).toContain("distinct ports: 1");
  expect(stdout).toContain("reply: echo:hi");
}, 30_000);

test("plain worker listening on a key already owned by a TLS shared-only handle fails with EINVAL", async () => {
  const dir = tempDirWithFiles("bun-test", {
    "cert.pem": tlsCerts.cert,
    "key.pem": tlsCerts.key,
    "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");
const tls = require("node:tls");
const fs = require("node:fs");
const path = require("node:path");
const key = fs.readFileSync(path.join(__dirname, "key.pem"));
const cert = fs.readFileSync(path.join(__dirname, "cert.pem"));

if (cluster.isPrimary) {
  const tlsWorker = cluster.fork({ ROLE: "tls" });
  cluster.once("listening", () => {
    const netWorker = cluster.fork({ ROLE: "net" });
    netWorker.on("message", msg => {
      console.log("net listen error code:", msg.code, msg.msg);
      tlsWorker.kill();
      netWorker.kill();
      process.exit(0);
    });
  });
} else if (process.env.ROLE === "tls") {
  tls.createServer({ key, cert }, () => {}).listen(0);
} else {
  const server = net.createServer(() => {});
  server.on("error", err => process.send({ code: err.code, msg: err.message }));
  server.listen(0);
}
`,
  });
  const { stdout } = await bunRun(joinP(dir, "main.ts"), bunEnv);
  expect(stdout).toContain("net listen error code: EINVAL");
  expect(stdout).toContain("TLS and non-TLS cluster workers cannot share");
}, 30_000);

test.skipIf(isWindows)(
  "SCHED_NONE listen({fd:2}) fails EINVAL like node and does not close the primary's stderr",
  async () => {
    const dir = tempDirWithFiles("bun-test", {
      "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");
const fs = require("node:fs");

cluster.schedulingPolicy = cluster.SCHED_NONE;

if (cluster.isPrimary) {
  const worker = cluster.fork();
  worker.on("message", m => {
    console.log("worker error code:", m.code);
    worker.disconnect();
  });
  cluster.on("exit", () => {
    try {
      fs.fstatSync(2);
      console.log("stderr open: true");
    } catch (e) {
      console.log("stderr open: false");
    }
    process.exit(0);
  });
} else {
  const server = net.createServer(() => {});
  server.on("error", err => {
    process.send({ code: err.code });
  });
  server.listen({ fd: 2 });
}
`,
    });
    const { stdout } = await bunRun(joinP(dir, "main.ts"), bunEnv);
    expect(stdout).toContain("worker error code: EINVAL");
    expect(stdout).toContain("stderr open: true");
  },
);

test.skipIf(isWindows)("dgram worker releases a shared fd it failed to adopt", async () => {
  using dir = tempDir("cluster-dgram-adopt-fail", {
    "main.ts": `
const cluster = require("node:cluster");
const dgram = require("node:dgram");
const net = require("node:net");

if (cluster.isPrimary) {
  // A stream socket passes the primary's fd check but cannot be adopted as a dgram socket in the worker.
  const tcp = net.createServer().listen(0, "127.0.0.1", () => {
    const { port } = tcp.address();
    const worker = cluster.fork();
    worker.on("message", m => {
      console.log("worker error code:", m.code);
      // Refused once both processes closed their copy; a leaked copy in either keeps the socket accepting.
      const probe = net.connect(port, "127.0.0.1");
      probe.on("connect", () => { console.log("probe: connected"); probe.destroy(); finish(); });
      probe.on("error", err => { console.log("probe:", err.code); finish(); });
    });
    function finish() {
      worker.kill();
      worker.on("exit", () => process.exit(0));
    }
    worker.send({ fd: tcp._handle.fd });
  });
} else {
  process.on("message", ({ fd }) => {
    const socket = dgram.createSocket("udp4");
    socket.on("listening", () => process.send({ code: "listening" }));
    socket.on("error", err => process.send({ code: err.code }));
    socket.bind({ fd });
  });
}
`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr }).toEqual({
    stdout: "worker error code: EINVAL\nprobe: ECONNREFUSED",
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

test.skipIf(isWindows)(
  "round-robin: RST-while-queued handle is dropped, not shipped stale",
  async () => {
    using dir = tempDir("cluster-rst-queued", {
      "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");
if (cluster.isPrimary) {
  const worker = cluster.fork();
  worker.on("message", msg => { console.log(msg); worker.kill(); process.exit(0); });
  cluster.on("listening", (_w, addr) => {
    const N = 4;
    let done = 0;
    const clients = [];
    for (let i = 0; i < N; i++) {
      const c = net.connect(addr.port, "127.0.0.1");
      c.on("connect", () => { if (++done === N) setImmediate(rst); });
      c.on("error", () => {});
      clients.push(c);
    }
    function rst() {
      let closed = 0;
      for (const c of clients) { c.once("close", onClosed); c.resetAndDestroy(); }
      function onClosed() {
        if (++closed !== N) return;
        const real = net.connect(addr.port, "127.0.0.1");
        real.on("connect", () => real.write("REAL"));
        real.on("error", e => { console.log("real client error:", e.code); process.exit(1); });
      }
    }
  });
} else {
  const server = net.createServer(sock => {
    sock.on("data", d => { process.send("worker got: " + d.toString()); server.close(); });
    sock.on("error", () => {});
  });
  server.listen(0, "127.0.0.1");
}
`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr }).toEqual({ stdout: "worker got: REAL", stderr: expect.any(String) });
    expect(exitCode).toBe(0);
  },
  30_000,
);

test("round-robin worker closes a server.blockList peer silently, like node", async () => {
  using dir = tempDir("cluster-blocklist", {
    "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");
if (cluster.isPrimary) {
  const worker = cluster.fork();
  worker.on("message", m => { console.log(JSON.stringify(m)); worker.disconnect(); });
  cluster.on("listening", (_w, addr) => {
    const c = net.connect(addr.port, "127.0.0.1");
    c.on("error", () => {});
    // The blocked peer is closed by the worker; node emits neither 'connection' nor 'drop' for it.
    c.on("close", () => worker.send("report"));
  });
} else {
  const bl = new net.BlockList();
  bl.addAddress("127.0.0.1");
  const seen = { connection: false, drop: false };
  const server = net.createServer({ blockList: bl }, () => { seen.connection = true; });
  server.on("drop", () => { seen.drop = true; });
  process.on("message", () => server.close(() => process.send({ ...seen, clientClosed: true })));
  server.listen(0, "127.0.0.1");
}
`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr }).toEqual({
    stdout: JSON.stringify({ connection: false, drop: false, clientClosed: true }),
    stderr: expect.any(String),
  });
  expect(exitCode).toBe(0);
}, 30_000);

test("round-robin worker honors server.pauseOnConnect and sets socket._server", async () => {
  using dir = tempDir("cluster-pauseonconnect", {
    "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");
if (cluster.isPrimary) {
  const worker = cluster.fork();
  worker.on("message", m => { console.log(JSON.stringify(m)); worker.kill(); process.exit(0); });
  cluster.on("listening", (_w, addr) => {
    const c = net.connect(addr.port, "127.0.0.1", () => c.write("early"));
    c.on("error", () => {});
  });
} else {
  const server = net.createServer({ pauseOnConnect: true }, sock => {
    let earlyData = false;
    sock.once("data", () => { earlyData = true; });
    setImmediate(() => {
      process.send({ paused: sock.isPaused(), earlyData, _server: sock._server === server });
    });
  });
  server.listen(0, "127.0.0.1");
}
`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ out: JSON.parse(stdout.trim()), stderr }).toEqual({
    out: { paused: true, earlyData: false, _server: true },
    stderr: expect.any(String),
  });
  expect(exitCode).toBe(0);
}, 30_000);

test("round-robin worker adopts a pauseOnConnect connection without reading from it", async () => {
  using dir = tempDir("cluster-pauseonconnect-bytes", {
    "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");
if (cluster.isPrimary) {
  const worker = cluster.fork();
  worker.on("message", m => { console.log(JSON.stringify(m)); worker.kill(); process.exit(0); });
  cluster.on("listening", (_w, addr) => {
    // "early" is in the worker's receive buffer before the write callback runs.
    const c = net.connect(addr.port, "127.0.0.1", () => c.write("early", () => worker.send("written")));
    c.on("error", () => {});
  });
} else {
  let sock, written = false, earlyData = false;
  // The IPC message can be dispatched in the same poll as, and ahead of, the socket's
  // readable event, so report after the poll between two immediates: a handle that
  // reads has consumed "early" by then.
  const report = () => {
    if (!sock || !written) return;
    setImmediate(() => setImmediate(() => {
      process.send({ paused: sock.isPaused(), bytesRead: sock.bytesRead, earlyData, _server: sock._server === server });
    }));
  };
  process.on("message", () => { written = true; report(); });
  const server = net.createServer({ pauseOnConnect: true }, s => {
    sock = s;
    s.once("data", () => { earlyData = true; });
    report();
  });
  server.listen(0, "127.0.0.1");
}
`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ out: JSON.parse(stdout.trim()), stderr }).toEqual({
    out: { paused: true, bytesRead: 0, earlyData: false, _server: true },
    stderr: expect.any(String),
  });
  expect(exitCode).toBe(0);
}, 30_000);

test("round-robin accepted socket buffers early bytes until a 'data' listener is attached", async () => {
  using dir = tempDir("cluster-early-bytes", {
    "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");
if (cluster.isPrimary) {
  const worker = cluster.fork();
  let c;
  worker.on("message", m => {
    if (m === "connected") return c.end("early", () => worker.send("attach"));
    console.log(JSON.stringify(m));
    c.destroy();
    worker.disconnect();
  });
  cluster.on("listening", (_w, addr) => {
    c = net.connect(addr.port, "127.0.0.1");
    c.on("error", () => {});
  });
} else {
  const server = net.createServer(sock => {
    process.once("message", () => {
      const report = result => { sock.destroy(); server.close(); process.send(result); };
      if (sock.readableEnded) return report({ endedBeforeListener: true, data: "" });
      let data = "";
      sock.on("data", d => { data += d; });
      sock.on("end", () => report({ endedBeforeListener: false, data }));
    });
    process.send("connected");
  });
  server.listen(0, "127.0.0.1");
}
`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ out: JSON.parse(stdout.trim()), stderr }).toEqual({
    out: { endedBeforeListener: false, data: "early" },
    stderr: expect.any(String),
  });
  expect(exitCode).toBe(0);
}, 30_000);

test("worker listen(0, 'localhost') resolves before querying the primary", async () => {
  using dir = tempDir("cluster-dns", {
    "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");
if (cluster.isPrimary) {
  const worker = cluster.fork();
  cluster.on("listening", (_w, addr) => {
    console.log(JSON.stringify({ address: addr.address, type: addr.addressType }));
    worker.kill();
    process.exit(0);
  });
} else {
  net.createServer(() => {}).listen(0, "localhost");
}
`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const out = JSON.parse(stdout.trim());
  expect(net.isIP(out.address)).toBeGreaterThan(0);
  expect([4, 6]).toContain(out.type);
  expect(stderr).toEqual(expect.any(String));
  expect(exitCode).toBe(0);
}, 30_000);

test.skipIf(isWindows)(
  "worker death mid-handoff redistributes the connection to another worker",
  async () => {
    using dir = tempDir("cluster-mid-handoff", {
      "main.ts": `const cluster = require("node:cluster");
const net = require("node:net");
if (cluster.isPrimary) {
  // One shared round-robin handle on a pre-picked port. "die" registers first, so the first connection
  // is handed to it; it exits on that newconn and the primary must hand the unacked connection to "live".
  const pick = net.createServer();
  pick.listen(0, "127.0.0.1", () => {
    const port = pick.address().port;
    pick.close(() => {
      const die = cluster.fork({ ROLE: "die", PORT: port });
      die.once("listening", () => {
        const live = cluster.fork({ ROLE: "live", PORT: port });
        let served = false;
        live.on("message", m => { served = true; console.log(m); live.send("close"); });
        live.once("listening", () => {
          const client = net.connect(port, "127.0.0.1", () => client.write("hi"));
          client.on("error", () => {});
          client.on("close", () => { if (!served) { console.log("connection dropped"); live.send("close"); } });
        });
      });
    });
  });
} else if (process.env.ROLE === "die") {
  process.on("internalMessage", m => { if (m.act === "newconn") process.exit(0); });
  net.createServer(() => {}).listen(+process.env.PORT, "127.0.0.1");
} else {
  const server = net.createServer(sock => sock.on("data", d => { process.send("live got: " + d); sock.destroy(); }));
  process.on("message", () => server.close(() => process.disconnect()));
  server.listen(+process.env.PORT, "127.0.0.1");
}
`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr }).toEqual({ stdout: "live got: hi", stderr: expect.any(String) });
    expect(exitCode).toBe(0);
  },
  30_000,
);

test("round-robin newconn reaches the worker's internalMessage listener via the handle slot", async () => {
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/cluster/utils.js#L33-L49
  using dir = tempDir("cluster-handle-slot", {
    "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");

if (cluster.isPrimary) {
  const worker = cluster.fork();
  worker.on("message", m => { console.log(JSON.stringify(m)); worker.kill(); process.exit(0); });
  cluster.on("listening", (_w, addr) => {
    net.connect(addr.port, "127.0.0.1");
  });
} else {
  let reported = false;
  process.on("internalMessage", (msg, handle) => {
    if (msg && msg.act === "newconn" && !reported) {
      reported = true;
      process.send({
        hasDollarFd: "$fd" in msg,
        handleIsObject: typeof handle === "object" && handle !== null,
        handleHasFd: typeof handle?.fd === "number",
      });
    }
  });
  net.createServer(() => {}).listen(0, "127.0.0.1");
}
`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), joinP(String(dir), "main.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual({ hasDollarFd: false, handleIsObject: true, handleHasFd: true });
  expect(exitCode).toBe(0);
});

test("cluster child send() clones and stamps cmd:NODE_CLUSTER", async () => {
  using dir = tempDir("cluster-send-shape", {
    "main.ts": `
const cluster = require("node:cluster");
if (cluster.isPrimary) {
  const worker = cluster.fork();
  worker.on("message", m => { console.log(JSON.stringify(m)); worker.kill(); process.exit(0); });
} else {
  const seen = [];
  const orig = process.send;
  process.send = function (msg, ...rest) { seen.push(msg); return orig.call(this, msg, ...rest); };
  const server = require("node:net").createServer(() => {});
  server.listen(0, "127.0.0.1");
  server.once("listening", () => setImmediate(() => {
    const q = seen.find(m => m && m.act === "queryServer");
    const l = seen.find(m => m && m.act === "listening");
    process.send = orig;
    process.send({ qCmd: q?.cmd, lCmd: l?.cmd, qActNow: q?.act });
  }));
}
`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ out: JSON.parse(stdout.trim()), stderr }).toEqual({
    out: { qCmd: "NODE_CLUSTER", lCmd: "NODE_CLUSTER", qActNow: "queryServer" },
    stderr: expect.any(String),
  });
  expect(exitCode).toBe(0);
}, 30_000);

test.concurrent("require('cluster') does not throw when NODE_UNIQUE_ID is set after node:net was loaded", async () => {
  // The worker setup only runs for a script file (process.argv[1]), not for -e.
  using dir = tempDir("cluster-unique-id-late", {
    "index.js": `require("node:net"); process.env.NODE_UNIQUE_ID = "1"; require("node:cluster"); console.log("loaded");`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr }).toEqual({ stdout: "loaded\n", stderr: "" });
  expect(exitCode).toBe(0);
});

describe.concurrent("a message the primary sends right after fork() reaches", () => {
  // The import chain keeps a module graph loading, with the event loop turning, while the worker's IPC channel is
  // already open. "late" is only sent once the worker has run, so the worker reports in either case.
  const chain = {
    "a.mjs": `import "./b.mjs";`,
    "b.mjs": `import "./c.mjs";`,
    "c.mjs": `import "./d.mjs";`,
    "d.mjs": `export {};`,
  };
  const primary = `
  const worker = cluster.fork();
  worker.send("early");
  worker.on("message", message => {
    if (message === "ready") worker.send("late");
  });
  worker.on("exit", code => process.exit(code));`;
  const listen = `
const seen = [];
process.on("message", message => {
  seen.push(message);
  if (message === "late") {
    console.log(JSON.stringify(seen));
    process.disconnect();
  }
});
process.send("ready");`;

  test.each([
    {
      name: "an ESM worker's top-level listener",
      entry: "main.mjs",
      files: {
        "main.mjs": `import cluster from "node:cluster";\nimport "./a.mjs";\nif (cluster.isPrimary) {${primary}\n} else {${listen}\n}`,
      },
      expected: ["early", "late"],
    },
    {
      name: "an ESM worker's top-level await",
      entry: "main.mjs",
      files: {
        "main.mjs": `import cluster from "node:cluster";\nimport "./a.mjs";\nif (cluster.isPrimary) {${primary}\n} else {
  process.send("ready");
  const first = await new Promise(resolve => process.once("message", resolve));
  console.log(JSON.stringify([first]));
  process.disconnect();
}`,
      },
      expected: ["early"],
    },
    {
      name: "the module an ESM worker imports dynamically",
      entry: "main.mjs",
      files: {
        "main.mjs": `import cluster from "node:cluster";\nif (cluster.isPrimary) {${primary}\n} else {\n  await import("./app.mjs");\n}`,
        "app.mjs": `import "./a.mjs";${listen}`,
      },
      expected: ["early", "late"],
    },
    {
      name: "the ESM app a CommonJS worker imports",
      entry: "main.cjs",
      files: {
        "main.cjs": `const cluster = require("node:cluster");\nif (cluster.isPrimary) {${primary}\n} else {\n  import("./app.mjs");\n}`,
        "app.mjs": `import "./a.mjs";${listen}`,
      },
      expected: ["early", "late"],
    },
    {
      name: "a worker whose ESM preload imports node:cluster",
      entry: "main.mjs",
      files: {
        "main.mjs": `import cluster from "node:cluster";\ncluster.setupPrimary({ exec: "app.mjs", execArgv: ["--import", "./preload.mjs"] });${primary}`,
        "preload.mjs": `import "node:cluster";\nimport "./a.mjs";`,
        "app.mjs": listen,
      },
      expected: ["early", "late"],
    },
    {
      // What a worker setup that runs before user code looks like to the loader.
      name: "a worker whose first preload requires node:cluster, with a second preload and an entry that import nothing",
      entry: "main.mjs",
      files: {
        "main.mjs": `import cluster from "node:cluster";\ncluster.setupPrimary({ exec: "app.mjs", execArgv: ["--require", "./cluster.cjs", "--require", "./empty.cjs"] });${primary}`,
        "cluster.cjs": `require("node:cluster");`,
        "empty.cjs": ``,
        "app.mjs": listen,
      },
      expected: ["early", "late"],
    },
    {
      // The worker is online while its chain still loads, so the chain is long enough for the reply to arrive.
      name: "an ESM worker's top-level listener when the primary sends it on 'online'",
      entry: "main.mjs",
      files: {
        ...Object.fromEntries(
          Array.from({ length: 40 }, (_, i) => [`m${i}.mjs`, i < 39 ? `import "./m${i + 1}.mjs";` : `export {};`]),
        ),
        "main.mjs": `import cluster from "node:cluster";\nimport "./m0.mjs";\nif (cluster.isPrimary) {${primary.replace('worker.send("early");', 'worker.on("online", () => worker.send("early"));')}\n} else {${listen}\n}`,
      },
      expected: ["early", "late"],
    },
  ])("$name", async ({ entry, files, expected }) => {
    using dir = tempDir("cluster-early-message", { ...chain, ...files });
    await using proc = Bun.spawn({
      cmd: [bunExe(), entry],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: JSON.stringify(expected) + "\n", stderr: expect.any(String) });
    expect(exitCode).toBe(0);
  });
});

// A worker is a process that starts with NODE_UNIQUE_ID, which cluster.fork() sets.
test.concurrent("a process that a worker starts with Bun.spawn and no env option is not a worker", async () => {
  // Bun.spawn with no `env` passes the startup env on, not process.env, where the worker setup deletes NODE_UNIQUE_ID.
  using dir = tempDir("cluster-spawn-default-env", {
    "worker.js": `
const cmd = [process.execPath, "child.js"];
const spawn = () => Bun.spawn({ cmd, stdout: "pipe", stderr: "inherit" }).stdout.text();
const beforeWorkerSetup = spawn();
require("node:cluster");
const afterWorkerSetup = spawn();
const thread = new Worker(require.resolve("./thread.js"));
const fromThread = new Promise((resolve, reject) => {
  thread.onmessage = event => resolve(event.data);
  thread.onerror = reject;
});
const spawnSync = Bun.spawnSync({ cmd, stderr: "inherit" }).stdout.toString();
Promise.all([beforeWorkerSetup, afterWorkerSetup, fromThread]).then(([before, after, inThread]) => {
  console.log("Bun.spawn before the worker setup:", before.trim());
  console.log("Bun.spawn:", after.trim());
  console.log("Bun.spawnSync:", spawnSync.trim());
  console.log("Bun.spawnSync in a worker thread:", inThread.trim());
  process.exit(0);
});
`,
    "thread.js": `
postMessage(Bun.spawnSync({ cmd: [process.execPath, "child.js"], stderr: "inherit" }).stdout.toString());
`,
    "child.js": `
// Read first: a process that takes itself for a worker deletes the variable when node:cluster loads.
const uniqueId = process.env.NODE_UNIQUE_ID ?? null;
console.log(JSON.stringify({ uniqueId, isWorker: require("node:cluster").isWorker }));
`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "worker.js"],
    env: { ...bunEnv, NODE_UNIQUE_ID: "1" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const notAWorker = '{"uniqueId":null,"isWorker":false}';
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout:
      `Bun.spawn before the worker setup: ${notAWorker}\n` +
      `Bun.spawn: ${notAWorker}\n` +
      `Bun.spawnSync: ${notAWorker}\n` +
      `Bun.spawnSync in a worker thread: ${notAWorker}\n`,
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent.skipIf(!isLinux)("Bun.serve in a worker defaults reusePort to true", async () => {
  // docs/guides/http/cluster.mdx: reusePort is Linux only.
  await using server = Bun.serve({ port: 0, reusePort: true, fetch: () => new Response("ok") });
  using dir = tempDir("cluster-serve-reuse-port", {
    "serve.js": `
require("node:cluster");
try {
  Bun.serve({ port: Number(process.env.SERVE_PORT), fetch: () => new Response("ok") });
  console.log("listening");
} catch (error) {
  console.log(error.code ?? String(error));
}
process.exit(0);
`,
  });
  async function serve(env: Record<string, string>) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "serve.js"],
      env: { ...bunEnv, SERVE_PORT: String(server.port), ...env },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }
  const [notAWorker, worker] = await Promise.all([serve({}), serve({ NODE_UNIQUE_ID: "1" })]);
  expect({ notAWorker, worker }).toEqual({
    notAWorker: { stdout: "EADDRINUSE\n", stderr: "", exitCode: 0 },
    worker: { stdout: "listening\n", stderr: "", exitCode: 0 },
  });
});
