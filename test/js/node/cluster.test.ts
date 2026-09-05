import { expect, setDefaultTimeout, test } from "bun:test";
import {
  bunEnv,
  bunExe,
  bunRun,
  isDebug,
  isIPv6,
  isLinux,
  isWindows,
  joinP,
  tempDir,
  tempDirWithFiles,
  tls as tlsCerts,
} from "harness";

// Every test forks cluster workers, and a debug build spends about a second per process evaluating
// node:cluster, node:net and node:tls. The tests run concurrently, so under `bun bd test` each one
// also shares the CPU with the others in flight and the 5s default is not enough. The release and
// ASAN binaries CI runs are not debug builds, so the --timeout the runner passes still applies there.
if (isDebug) setDefaultTimeout(60_000);

// On Windows a busy machine can make the primary drop a worker's ack for a handed-off connection (#37815),
// and every later IPC message to that worker waits behind it. Tests whose completion depends on IPC after
// a round-robin handoff run one at a time there until that fix lands.
const concurrentAfterHandoff = !isWindows;

// The message a worker's server 'error' carries when a TLS and a plain server ask for one address:port.
const sharedOnlyEinvalMessage =
  "bind EINVAL\n  note: TLS and non-TLS cluster workers cannot share the same address:port under SCHED_RR " +
  "(Bun's TLS accept is native and cannot adopt round-robin connection fds)";

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
  expect(await bunRun(joinP(dir, "index.ts"), bunEnv)).toSpawn("W ArrayBuffer(7) [ 21, 11, 96, 126, 243, 128, 164 ]");
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
  const result = await bunRun(joinP(dir, "index.ts"), bunEnv);
  expect(result).toSpawn();
  expect(result.stdout.split("\n")).toEqual([
    expect.stringMatching(/^P O FileRef \(".*index\.ts"\) \{$/),
    '  type: "text/javascript;charset=utf-8"',
    "}",
    "W {",
    "  file: {},",
    "}",
    "P M {}",
  ]);
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
  expect(await bunRun(joinP(dir, "index.ts"), bunEnv)).toSpawn(
    [
      "P O BlockList {",
      "  addAddress: [Function: addAddress],",
      "  addRange: [Function: addRange],",
      "  addSubnet: [Function: addSubnet],",
      "  check: [Function: check],",
      "  rules: [],",
      "}",
      "W {",
      "  blocklist: {},",
      "}",
      "P M {}",
    ].join("\n"),
  );
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
  const { stdout, stderr, exitCode } = await bunRun(joinP(dir, "parent.ts"), bunEnv);
  expect({ stdout, stderr }).toEqual({ stdout: "P received regular message", stderr: "" });
  expect(exitCode).toBe(0);
});

test.concurrent("TLS worker listening on a key already owned by a round-robin handle fails with EINVAL", async () => {
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
      console.log(JSON.stringify(msg));
      netWorker.kill();
      tlsWorker.kill();
      process.exit(0);
    });
  });
} else if (process.env.ROLE === "net") {
  net.createServer(() => {}).listen(0);
} else {
  const server = tls.createServer({});
  server.on("error", err => process.send({ code: err.code, syscall: err.syscall, message: err.message }));
  server.listen(0);
}
`,
  });
  const { stdout, stderr, exitCode } = await bunRun(joinP(dir, "main.ts"), bunEnv);
  expect({ out: JSON.parse(stdout || "null"), stderr }).toEqual({
    out: { code: "EINVAL", syscall: "bind", message: sharedOnlyEinvalMessage },
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

test.concurrent("cluster pipe listen error carries no port suffix", async () => {
  const dir = tempDirWithFiles("bun-test", {
    "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");

const PIPE = process.env.BUN_CLUSTER_PIPE;
if (cluster.isPrimary) {
  const blocker = net.createServer(() => {});
  blocker.listen(PIPE, () => {
    const worker = cluster.fork();
    worker.on("message", msg => {
      console.log(JSON.stringify(msg));
      worker.kill();
      blocker.close();
      process.exit(0);
    });
  });
} else {
  const server = net.createServer(() => {});
  server.on("error", err =>
    process.send({ code: err.code, syscall: err.syscall, message: err.message, address: err.address, port: err.port }),
  );
  server.listen(PIPE);
}
`,
  });
  const PIPE = isWindows ? `\\\\.\\pipe\\bun-cluster-pipe-err-${process.pid}` : joinP(dir, "test.sock");
  const { stdout, stderr, exitCode } = await bunRun(joinP(dir, "main.ts"), { ...bunEnv, BUN_CLUSTER_PIPE: PIPE });
  expect({ out: JSON.parse(stdout || "null"), stderr }).toEqual({
    out: { code: "EADDRINUSE", syscall: "bind", message: `bind EADDRINUSE ${PIPE}`, address: PIPE, port: -1 },
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

test.concurrent.skipIf(isWindows)(
  "SCHED_NONE pipe listen unlinks the socket file when the last worker leaves",
  async () => {
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
  cluster.on("exit", (w, code, signal) => {
    console.log("worker exit:", code, signal);
    console.log("exists after exit:", fs.existsSync(SOCK));
    process.exit(0);
  });
} else {
  net.createServer(() => {}).listen(process.env.BUN_CLUSTER_SOCK);
}
`,
    });
    const { stdout, stderr, exitCode } = await bunRun(joinP(dir, "main.ts"), bunEnv);
    expect({ stdout, stderr }).toEqual({
      stdout: "exists while listening: true\nworker exit: 0 null\nexists after exit: false",
      stderr: "",
    });
    expect(exitCode).toBe(0);
  },
);

test.concurrent.skipIf(isWindows)(
  "round-robin pipe listen applies readableAll/writableAll to the socket file",
  async () => {
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
    const { stdout, stderr, exitCode } = await bunRun(joinP(dir, "main.ts"), bunEnv);
    expect({ stdout, stderr }).toEqual({ stdout: "perm bits: 66\nworker exit: 0 null", stderr: "" });
    expect(exitCode).toBe(0);
  },
);

test.concurrent.skipIf(isWindows)(
  "round-robin accepted sockets honor allowHalfOpen after the client's FIN",
  async () => {
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
        // Without allowHalfOpen the Duplex ends its writable side on the next tick after 'end', so a
        // reply written after that tick only reaches the client if the option was honored.
        setImmediate(() => socket.end("pong:" + buf));
      });
    })
    .listen(0, "127.0.0.1");
}
`,
    });
    const { stdout, stderr, exitCode } = await bunRun(joinP(dir, "main.ts"), bunEnv);
    expect({ stdout, stderr }).toEqual({ stdout: "client got: pong:ping", stderr: "" });
    expect(exitCode).toBe(0);
  },
);

test.concurrent("round-robin accepted sockets honor the server's highWaterMark", async () => {
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
  const { stdout, stderr, exitCode } = await bunRun(joinP(dir, "main.ts"), bunEnv);
  expect({ stdout, stderr }).toEqual({ stdout: "accepted hwm: 1234", stderr: "" });
  expect(exitCode).toBe(0);
});

test.concurrent.skipIf(!isIPv6())("SCHED_NONE listen with no host binds the IPv6 wildcard (dual-stack)", async () => {
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
  const { stdout, stderr, exitCode } = await bunRun(joinP(dir, "main.ts"), bunEnv);
  expect({ stdout, stderr }).toEqual({ stdout: "ipv6 connect ok", stderr: "" });
  expect(exitCode).toBe(0);
});

test.concurrent("SCHED_NONE: a second worker listens on the same shared handle", async () => {
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
  const { stdout, stderr, exitCode } = await bunRun(joinP(dir, "main.ts"), bunEnv);
  expect({ stdout, stderr }).toEqual({
    stdout: "policy is SCHED_NONE: true\nlistening workers: 2 distinct ports: 1",
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

test.concurrent(
  "SCHED_NONE: close() releases the shared handle so the worker can re-listen on the same port",
  async () => {
    using dir = tempDir("cluster-shared-relisten", {
      "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");
cluster.schedulingPolicy = cluster.SCHED_NONE;
if (cluster.isPrimary) {
  const worker = cluster.fork();
  worker.on("message", m => {
    if (m.port) { const c = net.connect(m.port, "127.0.0.1"); c.on("error", () => {}); return; }
    worker.on("exit", (code, signal) => console.log(JSON.stringify({ ...m, exit: [code, signal] })));
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
    expect({ out: JSON.parse(stdout.trim() || "null"), stderr }).toEqual({
      out: { relisten: "ok", samePort: true, exit: [0, null] },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  },
);

test.concurrent.skipIf(isWindows)(
  "SCHED_NONE: a worker listening on a unix path reports it from address()",
  async () => {
    using dir = tempDir("cluster-shared-unix-address", {
      "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");
const path = require("node:path");
cluster.schedulingPolicy = cluster.SCHED_NONE;
const SOCK = path.join(__dirname, "srv.sock");
if (cluster.isPrimary) {
  const worker = cluster.fork();
  worker.on("message", m => {
    worker.on("exit", (code, signal) => console.log(JSON.stringify({ ...m, exit: [code, signal] })));
    worker.disconnect();
  });
} else {
  const server = net.createServer();
  server.listen(SOCK, () => { const address = server.address(); server.close(() => process.send({ address })); });
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
    expect({ out: JSON.parse(stdout.trim() || "null"), stderr }).toEqual({
      out: { address: joinP(String(dir), "srv.sock"), exit: [0, null] },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  },
);

test.concurrent.skipIf(!isLinux)("SCHED_NONE: an abstract-namespace listen is reachable by clients", async () => {
  using dir = tempDir("cluster-shared-abstract", {
    "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");
cluster.schedulingPolicy = cluster.SCHED_NONE;
const NAME = "\\0bun-cluster-abstract-" + (process.env.ABSTRACT_ID || process.pid);
if (cluster.isPrimary) {
  const worker = cluster.fork({ ABSTRACT_ID: String(process.pid) });
  worker.on("message", () => {
    const finish = result => {
      worker.on("exit", (code, signal) => console.log(JSON.stringify({ ...result, exit: [code, signal] })));
      worker.send("close");
    };
    const c = net.connect(NAME, () => { c.destroy(); finish({ connect: "ok" }); });
    c.on("error", err => finish({ connect: err.code }));
  });
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
  expect({ out: JSON.parse(stdout.trim() || "null"), stderr }).toEqual({
    out: { connect: "ok", exit: [0, null] },
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

test.concurrent("disconnect() on a cluster.Worker built around a plain object does not abort", async () => {
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
  // What each server's own address() said once its listen() callback ran, in target order.
  const bound = [];
  const { promise, resolve, reject } = Promise.withResolvers();
  const worker = cluster.fork();
  const done = () => {
    if (payloads.length === targets.length && bound.length === targets.length) resolve();
  };

  cluster.on("listening", (listeningWorker, address) => {
    if (listeningWorker !== worker) {
      reject(new Error("'listening' came from an unexpected worker"));
      return;
    }
    payloads.push({ address: address.address, addressType: address.addressType, port: address.port });
    done();
  });
  worker.on("message", message => {
    bound.push(message);
    done();
  });
  worker.on("error", reject);
  worker.on("exit", (code, signal) => {
    reject(new Error("worker exited before it finished listening (" + code + ", " + signal + ")"));
  });

  promise.then(
    () => {
      console.log(JSON.stringify({ payloads, bound }));
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
      process.send(server.address());
    }
  })().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
`;

test.concurrent.each(["net", "http"])("cluster 'listening' reports the address a %s server bound", async moduleName => {
  const dir = tempDirWithFiles("cluster-listening", { "fixture.js": listeningPayloadFixture });
  const targets: ({ host: string | null } | { path: string })[] = [{ host: "127.0.0.1" }, { host: null }];
  if (isIPv6()) targets.push({ host: "::1" });
  if (!isWindows) targets.push({ path: joinP(dir, `${moduleName}.sock`) });

  const { stdout, stderr, exitCode } = await bunRun(joinP(dir, "fixture.js"), {
    MODULE: moduleName,
    TARGETS: JSON.stringify(targets),
  });
  const report = JSON.parse(stdout || "null");
  // Each 'listening' payload must name the port the worker's server really bound, not just some port.
  const boundPort = (i: number) => report?.bound?.[i]?.port;
  expect({ payloads: report?.payloads, stderr }).toEqual({
    payloads: targets.map((target, i) =>
      "path" in target
        ? { address: target.path, addressType: -1, port: -1 }
        : { address: target.host, addressType: target.host?.includes(":") ? 6 : 4, port: boundPort(i) },
    ),
    stderr: "",
  });
  for (const [i, target] of targets.entries()) {
    if (!("path" in target)) expect(boundPort(i)).toBeWithin(1, 65536);
  }
  expect(exitCode).toBe(0);
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

test.concurrent.each(["net", "http"])(
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

test.concurrent(
  "round-robin worker connection socket has connecting=false and remoteAddress synchronously",
  async () => {
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
        remoteAddress: socket.remoteAddress,
        remoteFamily: socket.remoteFamily,
        localAddress: socket.localAddress,
      });
      socket.end();
    })
    .listen(0, "127.0.0.1");
}
`,
    });
    const { stdout, stderr, exitCode } = await bunRun(joinP(dir, "main.ts"), bunEnv);
    expect({ out: JSON.parse(stdout || "null"), stderr }).toEqual({
      out: {
        connecting: false,
        readyState: "open",
        remoteAddress: "127.0.0.1",
        remoteFamily: "IPv4",
        localAddress: "127.0.0.1",
      },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  },
);

test.concurrentIf(concurrentAfterHandoff)(
  "round-robin: primary never consumes accepted-socket bytes before handoff",
  async () => {
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
    const { stdout, stderr, exitCode } = await bunRun(joinP(dir, "main.ts"), bunEnv);
    // The worker reports the first 20 bytes and the length of each connection's payload, in the
    // order the connections finished. Every byte the client wrote must have reached the worker.
    const expected = Array.from({ length: 20 }, (_, i) => {
      const payload = "MAGIC-" + i + "-" + Buffer.alloc(4096, "x").toString();
      return payload.slice(0, 20) + " " + payload.length;
    });
    expect({ lines: stdout.split("\n").sort(), stderr }).toEqual({ lines: expected.sort(), stderr: "" });
    expect(exitCode).toBe(0);
  },
);

test.concurrent("TLS cluster worker under SCHED_RR listens on a shared handle and completes handshakes", async () => {
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
  const { stdout, stderr, exitCode } = await bunRun(joinP(dir, "main.ts"), bunEnv);
  expect({ stdout, stderr }).toEqual({ stdout: "distinct ports: 1\nreply: echo:hi", stderr: "" });
  expect(exitCode).toBe(0);
});

test.concurrent(
  "plain worker listening on a key already owned by a TLS shared-only handle fails with EINVAL",
  async () => {
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
      console.log(JSON.stringify(msg));
      tlsWorker.kill();
      netWorker.kill();
      process.exit(0);
    });
  });
} else if (process.env.ROLE === "tls") {
  tls.createServer({ key, cert }, () => {}).listen(0);
} else {
  const server = net.createServer(() => {});
  server.on("error", err => process.send({ code: err.code, syscall: err.syscall, message: err.message }));
  server.listen(0);
}
`,
    });
    const { stdout, stderr, exitCode } = await bunRun(joinP(dir, "main.ts"), bunEnv);
    expect({ out: JSON.parse(stdout || "null"), stderr }).toEqual({
      out: { code: "EINVAL", syscall: "bind", message: sharedOnlyEinvalMessage },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  },
);

test.concurrent.skipIf(isWindows)(
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
    console.log(JSON.stringify(m));
    worker.disconnect();
  });
  cluster.on("exit", (w, code, signal) => {
    console.log("worker exit:", code, signal);
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
    process.send({ code: err.code, syscall: err.syscall, message: err.message });
  });
  server.listen({ fd: 2 });
}
`,
    });
    const { stdout, stderr, exitCode } = await bunRun(joinP(dir, "main.ts"), bunEnv);
    expect({ stdout, stderr }).toEqual({
      stdout: [
        JSON.stringify({ code: "EINVAL", syscall: "bind", message: "bind EINVAL" }),
        "worker exit: 0 null",
        "stderr open: true",
      ].join("\n"),
      stderr: "",
    });
    expect(exitCode).toBe(0);
  },
);

test.concurrent.skipIf(isWindows)("dgram worker releases a shared fd it failed to adopt", async () => {
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

test.concurrent.skipIf(isWindows)("round-robin: RST-while-queued handle is dropped, not shipped stale", async () => {
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
  expect({ stdout: stdout.trim(), stderr }).toEqual({ stdout: "worker got: REAL", stderr: "" });
  expect(exitCode).toBe(0);
});

test.concurrentIf(concurrentAfterHandoff)(
  "round-robin worker closes a server.blockList peer silently, like node",
  async () => {
    using dir = tempDir("cluster-blocklist", {
      "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");
if (cluster.isPrimary) {
  const worker = cluster.fork();
  worker.on("message", m => {
    worker.on("exit", (code, signal) => console.log(JSON.stringify({ ...m, exit: [code, signal] })));
    worker.disconnect();
  });
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
    expect({ out: JSON.parse(stdout.trim() || "null"), stderr }).toEqual({
      out: { connection: false, drop: false, clientClosed: true, exit: [0, null] },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  },
);

test.concurrent("round-robin worker honors server.pauseOnConnect and sets socket._server", async () => {
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
  expect({ out: JSON.parse(stdout.trim() || "null"), stderr }).toEqual({
    out: { paused: true, earlyData: false, _server: true },
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

test.concurrentIf(concurrentAfterHandoff)(
  "round-robin worker adopts a pauseOnConnect connection without reading from it",
  async () => {
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
    expect({ out: JSON.parse(stdout.trim() || "null"), stderr }).toEqual({
      out: { paused: true, bytesRead: 0, earlyData: false, _server: true },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  },
);

test.concurrentIf(concurrentAfterHandoff)(
  "round-robin accepted socket buffers early bytes until a 'data' listener is attached",
  async () => {
    using dir = tempDir("cluster-early-bytes", {
      "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");
if (cluster.isPrimary) {
  const worker = cluster.fork();
  let c;
  worker.on("message", m => {
    if (m === "connected") return c.end("early", () => worker.send("attach"));
    worker.on("exit", (code, signal) => console.log(JSON.stringify({ ...m, exit: [code, signal] })));
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
    expect({ out: JSON.parse(stdout.trim() || "null"), stderr }).toEqual({
      out: { endedBeforeListener: false, data: "early", exit: [0, null] },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  },
);

test.concurrent("worker listen(0, 'localhost') resolves before querying the primary", async () => {
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
  const out = JSON.parse(stdout.trim() || "null");
  // The primary sees the resolved loopback address, never the name, and the matching family.
  expect({ out, stderr }).toEqual({
    out: out?.address === "::1" ? { address: "::1", type: 6 } : { address: "127.0.0.1", type: 4 },
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

test.concurrent.skipIf(isWindows)(
  "worker death mid-handoff redistributes the connection to another worker",
  async () => {
    using dir = tempDir("cluster-mid-handoff", {
      "main.ts": `const cluster = require("node:cluster");
const net = require("node:net");
if (cluster.isPrimary) {
  // Each worker's first listen(0, "127.0.0.1") maps to the same key in the primary, so both share one
  // round-robin handle. "die" registers first, so the first connection is handed to it; it exits on
  // that newconn and the primary must hand the unacked connection to "live".
  const die = cluster.fork({ ROLE: "die" });
  die.once("listening", dieAddress => {
    const live = cluster.fork({ ROLE: "live" });
    let served = false;
    live.on("message", m => { served = true; console.log(m); live.send("close"); });
    live.once("listening", liveAddress => {
      console.log("shared port:", liveAddress.port === dieAddress.port);
      const client = net.connect(dieAddress.port, "127.0.0.1", () => client.write("hi"));
      client.on("error", () => {});
      client.on("close", () => { if (!served) { console.log("connection dropped"); live.send("close"); } });
    });
  });
} else if (process.env.ROLE === "die") {
  process.on("internalMessage", m => { if (m.act === "newconn") process.exit(0); });
  net.createServer(() => {}).listen(0, "127.0.0.1");
} else {
  const server = net.createServer(sock => sock.on("data", d => { process.send("live got: " + d); sock.destroy(); }));
  process.on("message", () => server.close(() => process.disconnect()));
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
    expect({ stdout: stdout.trim(), stderr }).toEqual({ stdout: "shared port: true\nlive got: hi", stderr: "" });
    expect(exitCode).toBe(0);
  },
);

test.concurrent("round-robin newconn reaches the worker's internalMessage listener via the handle slot", async () => {
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

test.concurrent("cluster child send() clones and stamps cmd:NODE_CLUSTER", async () => {
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
  expect({ out: JSON.parse(stdout.trim() || "null"), stderr }).toEqual({
    out: { qCmd: "NODE_CLUSTER", lCmd: "NODE_CLUSTER", qActNow: "queryServer" },
    stderr: "",
  });
  expect(exitCode).toBe(0);
});
