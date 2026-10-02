import { dlopen } from "bun:ffi";
import { beforeAll, describe, expect, test } from "bun:test";
import {
  bunEnv,
  bunExe,
  bunRun,
  isIPv6,
  isLinux,
  isWindows,
  joinP,
  libcPathForDlopen,
  tempDir,
  tempDirWithFiles,
  tls as tlsCerts,
} from "harness";
import { closeSync } from "node:fs";
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

test.skipIf(isWindows)(
  "dgram bind({ fd }) on a stream socket fails EINVAL like node and leaves the primary's server listening",
  async () => {
    using dir = tempDir("cluster-dgram-stream-fd", {
      "main.ts": `
const cluster = require("node:cluster");
const dgram = require("node:dgram");
const net = require("node:net");

if (cluster.isPrimary) {
  const tcp = net.createServer().listen(0, "127.0.0.1", () => {
    const { port } = tcp.address();
    const worker = cluster.fork();
    worker.on("message", m => {
      console.log("worker error:", JSON.stringify(m));
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
    socket.on("error", err => process.send({ code: err.code, errno: err.errno, syscall: err.syscall }));
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
      stdout: 'worker error: {"code":"EINVAL","errno":-22,"syscall":"open"}\nprobe: connected',
      stderr: "",
    });
    expect(exitCode).toBe(0);
  },
);

// A socket of this process that a primary gets as a descriptor. The types of these sockets do not have `fd`.
async function socketForPrimary(sockets: DisposableStack, kind: "tcp" | "udp" | "unix dgram") {
  if (kind === "tcp") {
    const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    sockets.defer(() => listener.stop(true));
    return listener as typeof listener & { fd: number };
  }
  if (kind === "udp") {
    const udp = await Bun.udpSocket({ hostname: "127.0.0.1", port: 0 });
    sockets.defer(() => udp.close());
    return udp as typeof udp & { fd: number };
  }
  const libc = dlopen(libcPathForDlopen(), { socket: { args: ["int", "int", "int"], returns: "int" } });
  sockets.defer(() => libc.close());
  const AF_UNIX = 1;
  const SOCK_DGRAM = 2;
  const fd = libc.symbols.socket(AF_UNIX, SOCK_DGRAM, 0);
  if (fd < 0) throw new Error("socket(AF_UNIX, SOCK_DGRAM, 0) failed");
  sockets.defer(() => closeSync(fd));
  return { fd, port: 0 };
}

test.skipIf(isWindows)("dgram worker releases a shared fd it failed to adopt", async () => {
  using dir = tempDir("cluster-dgram-adopt-fail", {
    "main.ts": `
const cluster = require("node:cluster");
const dgram = require("node:dgram");
const fs = require("node:fs");

if (cluster.isPrimary) {
  const worker = cluster.fork();
  worker.on("message", m => {
    console.log("worker error code:", m.code);
    try {
      fs.fstatSync(3);
      console.log("descriptor of the primary: open");
    } catch (err) {
      console.log("descriptor of the primary:", err.code);
    }
    // Free once both processes closed their copy; a leaked copy in either keeps the port bound.
    const probe = dgram.createSocket("udp4");
    probe.on("listening", () => { console.log("probe: listening"); probe.close(finish); });
    probe.on("error", err => { console.log("probe:", err.code); finish(); });
    probe.bind(Number(process.env.PORT), "127.0.0.1");
  });
  function finish() {
    worker.kill();
    worker.on("exit", () => process.exit(0));
  }
} else {
  // The primary shares a datagram socket only, and a worker adopts every one. So the handle names a file here.
  const getServer = cluster._getServer;
  cluster._getServer = (socket, options, callback) =>
    getServer(socket, options, (err, handle) => {
      if (handle) handle.sharedFd = fs.openSync(__filename, "r");
      callback(err, handle);
    });
  const socket = dgram.createSocket("udp4");
  socket.on("listening", () => process.send({ code: "listening" }));
  socket.on("error", err => process.send({ code: err.code }));
  socket.bind({ fd: 3 });
}
`,
  });
  using sockets = new DisposableStack();
  const udp = await socketForPrimary(sockets, "udp");
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    env: { ...bunEnv, PORT: String(udp.port) },
    cwd: String(dir),
    // Descriptor 3 of the primary.
    stdio: ["ignore", "pipe", "pipe", udp.fd],
  });
  // The primary has its copy. A copy in this process keeps the port bound.
  sockets.dispose();
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr }).toEqual({
    stdout: "worker error code: ENOTSOCK\ndescriptor of the primary: EBADF\nprobe: listening",
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

// Runs as the primary and as its workers. SCENARIO is { policy, cases: [{ fd, port, steps }] }. The test made one
// socket for each case, and the primary has it as descriptor `fd`. A step is one of:
//   { worker, kind, fd }          the worker calls listen({ fd }) or bind({ fd }) on a new server or socket
//   { worker, kind, fd, twice }   one server calls listen({ fd }) two times before the first answer
//   { worker, kind, port: 0 }     the worker listens on a port, so the primary makes a socket (`fd: "created"`)
//   { primary: kind }             the primary binds a socket of its own to the descriptor
//   { connect: true }             the primary connects a client to the socket of the case
const fdQueryFixture = `
const cluster = require("node:cluster");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const scenario = JSON.parse(process.env.SCENARIO);
cluster.schedulingPolicy = scenario.policy === "SCHED_NONE" ? cluster.SCHED_NONE : cluster.SCHED_RR;

function stateOf(fd) {
  try {
    fs.fstatSync(fd);
    return "open";
  } catch (error) {
    return error.code;
  }
}

function socketsOfPrimary() {
  const fds = [];
  for (let fd = 3; fd < 256; fd++) {
    if (stateOf(fd) === "open" && fs.fstatSync(fd).isSocket()) fds.push(fd);
  }
  return fds;
}

function bindInPrimary(kind, fd) {
  const { promise, resolve, reject } = Promise.withResolvers();
  const socket = require("node:dgram").createSocket(kind);
  socket.once("error", reject);
  socket.bind({ fd }, () => resolve(socket));
  return promise;
}

// Takes each free number up to the descriptor. If the primary closed the descriptor too early, a sentinel has its
// number, and the close by the holder then closes that sentinel.
function openSentinels(fd) {
  const sentinels = [];
  do sentinels.push(fs.openSync(__filename, "r"));
  while (sentinels.at(-1) < fd);
  return sentinels;
}

function connectTo(port) {
  const { promise, resolve } = Promise.withResolvers();
  let data = "";
  const client = net.connect(port, "127.0.0.1", () => client.end("ping"));
  client.setEncoding("utf8");
  client.on("data", chunk => (data += chunk));
  client.on("error", error => resolve(error.code));
  client.on("close", () => resolve(data));
  return promise;
}

async function primary() {
  const count = 1 + Math.max(...scenario.cases.flatMap(({ steps }) => steps.map(step => step.worker ?? 0)));
  const workers = [];
  const pending = [];
  let cases = true;
  const start = i => {
    workers[i] = cluster.fork();
    workers[i].on("message", message => pending[i].resolve(message.result));
    // A worker that left fails its case only. The next case has a new worker.
    workers[i].on("exit", (code, signal) => {
      if (!cases) return;
      start(i);
      pending[i]?.reject(new Error("worker " + i + " left: " + code + " " + signal));
    });
  };
  for (let i = 0; i < count; i++) start(i);
  const tell = (i, command) => {
    pending[i] = Promise.withResolvers();
    workers[i].send(command);
    return pending[i].promise;
  };
  const closeAll = async () => {
    for (const i of workers.keys()) await tell(i, { close: true });
  };

  for (const { fd, port, steps } of scenario.cases) {
    const answers = [];
    const own = [];
    // The descriptor that the case is about: the one of the test, or the socket that the primary made.
    let held = fd;
    try {
      for (const step of steps) {
        if (step.connect) {
          answers.push({ client: await connectTo(port) });
        } else if (step.primary) {
          own.push(await bindInPrimary(step.primary, fd));
          answers.push({ primary: "listening", fd: stateOf(fd) });
        } else if (step.port === 0) {
          const before = socketsOfPrimary();
          answers.push({ result: await tell(step.worker, step) });
          const created = socketsOfPrimary().filter(n => !before.includes(n));
          if (created.length !== 1) throw new Error("expected one new socket in the primary, found [" + created + "]");
          held = created[0];
        } else {
          const result = await tell(step.worker, { ...step, fd: step.fd === "created" ? held : step.fd });
          answers.push({ result, fd: stateOf(held) });
        }
      }
      const sentinels = openSentinels(held);
      await closeAll();
      const closed = sentinels.map(stateOf).find(state => state !== "open");
      console.log(JSON.stringify({ answers, left: { fd: stateOf(held), sentinels: closed ?? "open" } }));
    } catch (error) {
      process.exitCode = 1;
      console.log(JSON.stringify({ answers, error: error.message }));
      await closeAll();
    }
    for (const socket of own) socket.close();
  }

  cases = false;
  for (const worker of workers) {
    const { promise, resolve } = Promise.withResolvers();
    worker.once("exit", resolve);
    worker.disconnect();
    await promise;
  }
}

function make(kind) {
  const tlsOptions = () => ({
    key: fs.readFileSync(path.join(__dirname, "key.pem")),
    cert: fs.readFileSync(path.join(__dirname, "cert.pem")),
  });
  switch (kind) {
    case "net":
      return net.createServer(socket => socket.resume().end("served"));
    case "tls":
      return require("node:tls").createServer(tlsOptions());
    default:
      return require("node:dgram").createSocket(kind);
  }
}

function worker() {
  const live = [];
  process.on("message", async step => {
    if (step.close) {
      for (const target of live.splice(0)) {
        const { promise, resolve } = Promise.withResolvers();
        target.close(resolve);
        await promise;
      }
      process.send({ result: "closed" });
      return;
    }
    const target = make(step.kind);
    const done = result => process.send({ result });
    target.once("error", error => done({ code: error.code, syscall: error.syscall, errno: error.errno }));
    const listening = () => {
      live.push(target);
      done("listening");
    };
    if (step.kind === "udp4" || step.kind === "udp6") target.bind({ fd: step.fd }, listening);
    else if (step.port === 0) target.listen(0, "127.0.0.1", listening);
    else {
      if (step.twice) target.listen({ fd: step.fd });
      target.listen({ fd: step.fd }, listening);
    }
  });
}

if (cluster.isPrimary) {
  primary().catch(error => {
    console.error(error);
    process.exit(1);
  });
} else {
  worker();
}
`;

type FdQueryStep =
  | { worker: number; kind: string; fd: number | "created"; twice?: true }
  | { worker: number; kind: string; port: 0 }
  | { primary: string }
  | { connect: true };
type FdQueryCase = {
  name: string;
  socket: "tcp" | "udp" | "unix dgram";
  // `fd` is the descriptor of the case in the primary.
  steps: (fd: number) => FdQueryStep[];
  answers: object[];
  // After the workers closed what they listened on. The holder of the descriptor closed it one time.
  left?: { fd: string; sentinels: string };
};

const served = { result: "listening", fd: "open" };
const refused = (code: "EEXIST" | "EINVAL", syscall: "bind" | "open") => ({
  result: { code, syscall, errno: code === "EEXIST" ? -17 : -22 },
  fd: "open",
});
const ask = (kind: string, fd: number | "created", worker = 0): FdQueryStep => ({ worker, kind, fd });
const twoAsks = (first: string, second: string) => (fd: number) => [ask(first, fd), ask(second, fd)];

// Each answer is the answer of node v26.3.0 for the same fixture. A row with another answer says what node does.
const fdQueryCases: Record<"SCHED_NONE" | "SCHED_RR", FdQueryCase[]> = {
  SCHED_NONE: [
    {
      name: "net, then udp4 on the stream socket",
      socket: "tcp",
      steps: fd => [ask("net", fd), ask("udp4", fd), { connect: true }],
      answers: [served, refused("EINVAL", "open"), { client: "served" }],
    },
    {
      name: "udp4, then net on the datagram socket",
      socket: "udp",
      steps: twoAsks("udp4", "net"),
      answers: [served, refused("EINVAL", "bind")],
    },
    {
      name: "net on a datagram socket, then udp4",
      socket: "udp",
      steps: twoAsks("net", "udp4"),
      answers: [refused("EINVAL", "bind"), served],
    },
    {
      name: "udp4 on a stream socket, then net",
      socket: "tcp",
      steps: twoAsks("udp4", "net"),
      answers: [refused("EINVAL", "open"), served],
    },
    {
      name: "net on the descriptor plus 0.5, then net on the descriptor",
      socket: "tcp",
      steps: fd => [ask("net", fd + 0.5), ask("net", fd)],
      answers: [refused("EINVAL", "bind"), served],
    },
    {
      name: "udp4 on a unix datagram socket",
      socket: "unix dgram",
      steps: fd => [ask("udp4", fd)],
      answers: [refused("EINVAL", "open")],
      left: { fd: "open", sentinels: "open" },
    },
    {
      // node: the worker dies on ERR_INTERNAL_ASSERTION at the second answer (nodejs/node#64869).
      name: "net, net, then net in a second worker",
      socket: "tcp",
      steps: fd => [ask("net", fd), ask("net", fd), { connect: true }, ask("net", fd, 1)],
      answers: [served, refused("EEXIST", "bind"), { client: "served" }, served],
    },
    {
      // node: the worker dies on ERR_INTERNAL_ASSERTION at the second answer.
      name: "udp4, udp4",
      socket: "udp",
      steps: twoAsks("udp4", "udp4"),
      answers: [served, refused("EEXIST", "open")],
    },
    {
      // The refused net ask leaves the descriptor open, so the third ask is the second ask of "udp4, udp4".
      // node: the worker dies on ERR_INTERNAL_ASSERTION at the third answer.
      name: "udp4, net, then udp4 on the datagram socket",
      socket: "udp",
      steps: fd => [ask("udp4", fd), ask("net", fd), ask("udp4", fd)],
      answers: [served, refused("EINVAL", "bind"), refused("EEXIST", "open")],
    },
    {
      // node: 'listening'. Its primary then closes the descriptor two times.
      name: "udp4, then udp6 in a second worker",
      socket: "udp",
      steps: fd => [ask("udp4", fd), ask("udp6", fd, 1)],
      answers: [served, refused("EEXIST", "open")],
    },
    {
      // node: 'listening'. Its primary then closes the socket two times.
      name: "net on a port, then net on the socket that the primary made for it",
      socket: "tcp",
      steps: () => [{ worker: 0, kind: "net", port: 0 }, ask("net", "created")],
      answers: [{ result: "listening" }, refused("EEXIST", "bind")],
    },
    {
      // node: 'listening' under this policy, EEXIST under SCHED_RR. The worker gave the first handle back, so the
      // holder closed the descriptor, and a sentinel has its number.
      name: "one net server that listens two times before the first answer",
      socket: "tcp",
      steps: fd => [{ ...ask("net", fd), twice: true }],
      answers: [{ ...refused("EEXIST", "bind"), fd: "EBADF" }],
      left: { fd: "open", sentinels: "open" },
    },
    {
      name: "a udp4 socket of the primary, then udp4",
      socket: "udp",
      steps: fd => [{ primary: "udp4" }, ask("udp4", fd)],
      answers: [{ primary: "listening", fd: "open" }, refused("EEXIST", "open")],
      left: { fd: "open", sentinels: "open" },
    },
  ],
  SCHED_RR: [
    {
      name: "net, then udp4 on the stream socket",
      socket: "tcp",
      steps: fd => [ask("net", fd), ask("udp4", fd), { connect: true }],
      answers: [served, refused("EINVAL", "open"), { client: "served" }],
    },
    {
      // A TLS server has a shared handle under this policy, so this row reaches the check that a net server skips.
      name: "tls on a datagram socket, then udp4",
      socket: "udp",
      steps: twoAsks("tls", "udp4"),
      answers: [refused("EINVAL", "bind"), served],
    },
    {
      // A net server skips that check. The listener of the primary refuses the number: Bun.listen takes an integer.
      name: "net on the descriptor plus 0.5, then net on the descriptor",
      socket: "tcp",
      steps: fd => [ask("net", fd + 0.5), ask("net", fd), { connect: true }],
      answers: [refused("EINVAL", "bind"), served, { client: "served" }],
    },
    {
      // With epoll the second listener of the primary fails, so this row passes without the lookup. Not with kqueue.
      name: "net, net, then net in a second worker",
      socket: "tcp",
      steps: fd => [ask("net", fd), ask("net", fd), { connect: true }, ask("net", fd, 1)],
      answers: [served, refused("EEXIST", "bind"), { client: "served" }, served],
    },
    { name: "tls, tls", socket: "tcp", steps: twoAsks("tls", "tls"), answers: [served, refused("EEXIST", "bind")] },
    {
      // node: its primary answers EEXIST, and its worker dies on a TypeError in tls.Server._setServerData(null).
      name: "net, tls",
      socket: "tcp",
      steps: fd => [ask("net", fd), ask("tls", fd), { connect: true }],
      answers: [served, refused("EEXIST", "bind"), { client: "served" }],
    },
    { name: "tls, net", socket: "tcp", steps: twoAsks("tls", "net"), answers: [served, refused("EEXIST", "bind")] },
    {
      // The kind comes before the holder. This row passes without the lookup.
      name: "udp4, then net on the datagram socket",
      socket: "udp",
      steps: twoAsks("udp4", "net"),
      answers: [served, refused("EINVAL", "bind")],
    },
    {
      name: "net on a port, then tls on the socket that the primary made for it",
      socket: "tcp",
      steps: () => [{ worker: 0, kind: "net", port: 0 }, ask("tls", "created")],
      answers: [{ result: "listening" }, refused("EEXIST", "bind")],
    },
  ],
};

async function runFdQueryCases(policy: "SCHED_NONE" | "SCHED_RR") {
  using dir = tempDir("cluster-fd-query", {
    "cert.pem": tlsCerts.cert,
    "key.pem": tlsCerts.key,
    "fixture.cjs": fdQueryFixture,
  });
  using sockets = new DisposableStack();
  const cases: { fd: number; port: number; steps: FdQueryStep[] }[] = [];
  const inherited: number[] = [];
  for (const { socket, steps } of fdQueryCases[policy]) {
    const { fd, port } = await socketForPrimary(sockets, socket);
    inherited.push(fd);
    // The primary has the sockets as descriptors 3, 4, 5 and so on.
    cases.push({ fd: 3 + cases.length, port, steps: steps(3 + cases.length) });
  }
  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.cjs"],
    env: { ...bunEnv, SCENARIO: JSON.stringify({ policy, cases }) },
    cwd: String(dir),
    stdio: ["ignore", "pipe", "pipe", ...inherited],
  });
  // The primary has its copies. A listener in this process takes the clients of the workers.
  sockets.dispose();
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { lines: stdout.split("\n").filter(Boolean), stderr, exitCode };
}

describe.skipIf(isWindows).each(["SCHED_NONE", "SCHED_RR"] as const)(
  "%s: a worker names a descriptor of the primary",
  policy => {
    // One primary and two workers run all the cases of a policy.
    let run: Awaited<ReturnType<typeof runFdQueryCases>>;
    beforeAll(async () => {
      run = await runFdQueryCases(policy);
    });

    test("the primary and its workers leave with no error", () => {
      expect({ lines: run.lines.length, stderr: run.stderr, exitCode: run.exitCode }).toEqual({
        lines: fdQueryCases[policy].length,
        stderr: "",
        exitCode: 0,
      });
    });

    test.each(fdQueryCases[policy].map((row, i) => [row.name, row, i] as const))(
      "%s",
      (_, { answers, left = { fd: "EBADF", sentinels: "open" } }, i) => {
        // The primary prints one line for each case. A line is missing when the primary stopped before the case.
        expect(run.lines[i] === undefined ? undefined : JSON.parse(run.lines[i])).toEqual({ answers, left });
      },
    );
  },
);

// One worker asks for descriptor 3 in the order of ASKS and closes nothing. Then the primary disconnects it.
const fdDisconnectFixture = `
const cluster = require("node:cluster");
cluster.schedulingPolicy = cluster.SCHED_NONE;

if (cluster.isPrimary) {
  const worker = cluster.fork();
  worker.on("message", line => {
    if (line === "asked") worker.disconnect();
    else console.log(line);
  });
  worker.on("exit", (code, signal) => console.log("worker left:", code, signal));
} else {
  const asks = process.env.ASKS.split(",");
  const ask = i => {
    if (i === asks.length) return process.send("asked");
    const kind = asks[i];
    const target = kind === "net" ? require("node:net").createServer() : require("node:dgram").createSocket(kind);
    const answer = result => {
      process.send(kind + ": " + result);
      ask(i + 1);
    };
    target.once("error", error => answer(error.syscall + " " + error.code));
    if (kind === "net") target.listen({ fd: 3 }, () => answer("listening"));
    else target.bind({ fd: 3 }, () => answer("listening"));
  };
  ask(0);
}
`;

// A worker has one handle for each key, and a disconnect closes the handles that it has. With two handles under one
// key the first one stays open, and the worker never leaves.
test.concurrent.skipIf(isWindows).each([
  ["udp", "udp4,net,udp4", ["udp4: listening", "net: bind EINVAL", "udp4: open EEXIST"]],
  ["tcp", "net,udp4,net", ["net: listening", "udp4: open EINVAL", "net: bind EEXIST"]],
] as const)("a worker leaves on disconnect after it asked for a %s descriptor: %s", async (socket, asks, answers) => {
  using dir = tempDir("cluster-fd-disconnect", { "fixture.cjs": fdDisconnectFixture });
  using sockets = new DisposableStack();
  const { fd } = await socketForPrimary(sockets, socket);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.cjs"],
    env: { ...bunEnv, ASKS: asks },
    cwd: String(dir),
    // Descriptor 3 of the primary.
    stdio: ["ignore", "pipe", "pipe", fd],
  });
  // The primary has its copy.
  sockets.dispose();
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ lines: stdout.trim().split("\n"), stderr }).toEqual({
    lines: [...answers, "worker left: 0 null"],
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
