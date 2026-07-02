import { expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, isIPv6, isWindows, joinP, tempDirWithFiles } from "harness";

test("cloneable and transferable equals", () => {
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
  bunRun(joinP(dir, "index.ts"), bunEnv, true);
});

test("cloneable and non-transferable not-equals (BunFile)", () => {
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
  bunRun(joinP(dir, "index.ts"), bunEnv, true);
});

test("cloneable and non-transferable not-equals (net.BlockList)", () => {
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
  bunRun(joinP(dir, "index.ts"), bunEnv, true);
});

test("non-cluster parent ignores cluster-internal IPC messages from a forked child", () => {
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
  const { stdout } = bunRun(joinP(dir, "parent.ts"), bunEnv);
  expect(stdout).toContain("P received regular message");
});

test("TLS worker listening on a key already owned by a round-robin handle fails with EINVAL", () => {
  const dir = tempDirWithFiles("bun-test", {
    "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");
const tls = require("node:tls");

if (cluster.isPrimary) {
  // The plain worker claims the handle key first, so the primary maps it to
  // a RoundRobinHandle before the TLS worker (sharedOnly) asks for it.
  const netWorker = cluster.fork({ ROLE: "net" });
  cluster.once("listening", () => {
    const tlsWorker = cluster.fork({ ROLE: "tls" });
    tlsWorker.on("message", msg => {
      console.log("tls listen error code:", msg.code);
      netWorker.kill();
      tlsWorker.kill();
      process.exit(0);
    });
  });
} else if (process.env.ROLE === "net") {
  net.createServer(() => {}).listen(0);
} else {
  // Same key as the net worker: first listen(0) in each worker uses index 0.
  const server = tls.createServer({});
  server.on("error", err => process.send({ code: err.code }));
  server.listen(0);
}
`,
  });
  const { stdout } = bunRun(joinP(dir, "main.ts"), bunEnv);
  expect(stdout).toContain("tls listen error code: EINVAL");
});

test("cluster pipe listen error carries no port suffix", () => {
  const dir = tempDirWithFiles("bun-test", {
    "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");
const path = require("node:path");

if (cluster.isPrimary) {
  // The name must be computed once and shared via the fork env: a
  // pid-derived name re-evaluated in the worker would point at a
  // different (free) pipe and the listen below would succeed.
  const PIPE =
    process.platform === "win32"
      ? String.raw\`\\\\.\\pipe\\bun-cluster-pipe-err-\${process.pid}\`
      : path.join(__dirname, "test.sock");
  // Hold the pipe in the primary so the worker's listen fails EADDRINUSE.
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
  const { stdout } = bunRun(joinP(dir, "main.ts"), bunEnv);
  expect(stdout).toContain("code: EADDRINUSE");
  expect(stdout).not.toContain(":-1");
  expect(stdout).toContain("port: -1");
});

test.skipIf(isWindows)("SCHED_NONE pipe listen unlinks the socket file when the last worker leaves", () => {
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
    // removeHandlesForWorker (and SharedHandle.remove) runs before the
    // primary emits 'exit', so the unlink must have happened by now.
    console.log("exists after exit:", fs.existsSync(SOCK));
    process.exit(0);
  });
} else {
  net.createServer(() => {}).listen(process.env.BUN_CLUSTER_SOCK);
}
`,
  });
  const { stdout } = bunRun(joinP(dir, "main.ts"), bunEnv);
  expect(stdout).toContain("exists while listening: true");
  expect(stdout).toContain("exists after exit: false");
});

test.skipIf(isWindows)("SCHED_NONE pipe listen applies readableAll/writableAll to the socket file", () => {
  const dir = tempDirWithFiles("bun-test", {
    "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");

cluster.schedulingPolicy = cluster.SCHED_NONE;
const SOCK = path.join(__dirname, "perm.sock");

if (cluster.isPrimary) {
  const worker = cluster.fork({ BUN_CLUSTER_SOCK: SOCK });
  cluster.on("listening", () => {
    // node: the worker fchmods the shared pipe handle after listen, so the
    // group/other read+write bits must be set by the time it is listening.
    const mode = fs.statSync(SOCK).mode;
    console.log("perm bits:", (mode & 0o066).toString(8));
    worker.kill();
    process.exit(0);
  });
} else {
  net.createServer(() => {}).listen({ path: process.env.BUN_CLUSTER_SOCK, readableAll: true, writableAll: true });
}
`,
  });
  const { stdout } = bunRun(joinP(dir, "main.ts"), bunEnv);
  expect(stdout).toContain("perm bits: 66");
});

test.skipIf(isWindows)("round-robin pipe listen applies readableAll/writableAll to the socket file", () => {
  const dir = tempDirWithFiles("bun-test", {
    "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");

const SOCK = path.join(__dirname, "rr-perm.sock");

if (cluster.isPrimary) {
  // Default SCHED_RR: the primary owns the real pipe listener, so it must
  // receive readableAll/writableAll through the worker's queryServer message.
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
  const { stdout } = bunRun(joinP(dir, "main.ts"), bunEnv);
  expect(stdout).toContain("perm bits: 66");
  expect(stdout).toContain("worker exit: 0");
});

test.skipIf(isWindows)("round-robin accepted sockets honor allowHalfOpen after the client's FIN", () => {
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
      // Half-close: the worker's reply comes after our FIN.
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
  // The reply is written a tick after 'end': with allowHalfOpen the adopted
  // fd must keep its writable half open instead of being closed on the FIN.
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
  const { stdout } = bunRun(joinP(dir, "main.ts"), bunEnv);
  expect(stdout).toContain("client got: pong:ping");
});

test("round-robin accepted sockets honor the server's highWaterMark", () => {
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
  // 1234 is far from the default highWaterMark, so a dropped option is
  // visible. The RR path must propagate it like ServerHandlers.open().
  net
    .createServer({ highWaterMark: 1234 }, socket => {
      process.send({ hwm: socket.readableHighWaterMark });
      socket.end();
    })
    .listen(0, "127.0.0.1");
}
`,
  });
  const { stdout } = bunRun(joinP(dir, "main.ts"), bunEnv);
  expect(stdout).toContain("accepted hwm: 1234");
});

test.skipIf(!isIPv6())("SCHED_NONE listen with no host binds the IPv6 wildcard (dual-stack)", () => {
  const dir = tempDirWithFiles("bun-test", {
    "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");

cluster.schedulingPolicy = cluster.SCHED_NONE;

if (cluster.isPrimary) {
  const worker = cluster.fork();
  cluster.on("listening", (w, address) => {
    // node's createServerHandle binds "::" when no address is given, so an
    // IPv6 client must be able to reach the shared-handle server.
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
  const { stdout } = bunRun(joinP(dir, "main.ts"), bunEnv);
  expect(stdout).toContain("ipv6 connect ok");
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
