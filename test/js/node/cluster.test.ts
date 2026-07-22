import { expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, isIPv6, isWindows, joinP, tempDir, tempDirWithFiles, tls as tlsCerts } from "harness";
import net from "node:net";

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
  const { stdout } = bunRun(joinP(dir, "main.ts"), bunEnv);
  expect(stdout).toContain("tls listen error code: EINVAL");
  expect(stdout).toContain("TLS and non-TLS cluster workers cannot share");
});

test("cluster pipe listen error carries no port suffix", () => {
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

test.skipIf(isWindows)("round-robin pipe listen applies readableAll/writableAll to the socket file", () => {
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

test("SCHED_NONE: a second worker listens on the same shared handle", () => {
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
  const { stdout } = bunRun(joinP(dir, "main.ts"), bunEnv);
  expect(stdout).toContain("policy is SCHED_NONE: true");
  expect(stdout).toContain("listening workers: 2 distinct ports: 1");
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

test.each(["net", "http"])("cluster 'listening' reports the address a %s server bound", moduleName => {
  const dir = tempDirWithFiles("cluster-listening", { "fixture.js": listeningPayloadFixture });
  const targets: ({ host: string | null } | { path: string })[] = [{ host: "127.0.0.1" }, { host: null }];
  if (isIPv6()) targets.push({ host: "::1" });
  if (!isWindows) targets.push({ path: joinP(dir, `${moduleName}.sock`) });

  const { stdout } = bunRun(joinP(dir, "fixture.js"), { MODULE: moduleName, TARGETS: JSON.stringify(targets) });
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

test("round-robin worker connection socket has connecting=false and remoteAddress synchronously", () => {
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
  const { stdout } = bunRun(joinP(dir, "main.ts"), bunEnv);
  const m = JSON.parse(stdout.trim());
  expect(m.connecting).toBe(false);
  expect(m.readyState).toBe("open");
  expect(m.remote).toBe("string");
});

test("round-robin: primary never consumes accepted-socket bytes before handoff", () => {
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
  const { stdout } = bunRun(joinP(dir, "main.ts"), bunEnv);
  const lines = stdout.trim().split("\n").sort();
  expect(lines.length).toBe(20);
  for (const line of lines) {
    expect(line).toMatch(/^MAGIC-\d+-x+ 41\d\d$/);
  }
});

test("TLS cluster worker under SCHED_RR listens on a shared handle and completes handshakes", () => {
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
  const { stdout } = bunRun(joinP(dir, "main.ts"), bunEnv);
  expect(stdout).toContain("distinct ports: 1");
  expect(stdout).toContain("reply: echo:hi");
}, 30_000);

test("plain worker listening on a key already owned by a TLS shared-only handle fails with EINVAL", () => {
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
  const { stdout } = bunRun(joinP(dir, "main.ts"), bunEnv);
  expect(stdout).toContain("net listen error code: EINVAL");
  expect(stdout).toContain("TLS and non-TLS cluster workers cannot share");
}, 30_000);

test.skipIf(isWindows)("SCHED_NONE listen({fd:2}) fails ENOTSOCK and does not close the primary's stderr", () => {
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
  const { stdout } = bunRun(joinP(dir, "main.ts"), bunEnv);
  expect(stdout).toMatch(/worker error code: (ENOTSOCK|EINVAL|EBADF)/);
  expect(stdout).toContain("stderr open: true");
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

test("round-robin worker honors server.blockList", async () => {
  using dir = tempDir("cluster-blocklist", {
    "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");
if (cluster.isPrimary) {
  const worker = cluster.fork();
  worker.on("message", m => { console.log(m); worker.kill(); process.exit(m === "drop" ? 0 : 1); });
  cluster.on("listening", (_w, addr) => {
    const c = net.connect(addr.port, "127.0.0.1");
    c.on("error", () => {});
    c.on("close", () => {});
  });
} else {
  const bl = new net.BlockList();
  bl.addAddress("127.0.0.1");
  const server = net.createServer({ blockList: bl }, () => process.send("connection"));
  server.on("drop", () => process.send("drop"));
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
  expect({ stdout: stdout.trim(), stderr }).toEqual({ stdout: "drop", stderr: expect.any(String) });
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
      "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");
if (cluster.isPrimary) {
  const die = cluster.fork({ ROLE: "die" });
  const live = cluster.fork({ ROLE: "live" });
  live.on("message", m => { console.log(m); die.kill(); live.kill(); process.exit(0); });
  let listening = 0;
  cluster.on("listening", (_w, addr) => {
    if (++listening !== 2) return;
    const c = net.connect(addr.port, "127.0.0.1", () => c.write("hi"));
    c.on("error", () => {});
  });
} else if (process.env.ROLE === "die") {
  process.on("internalMessage", m => { if (m.act === "newconn") process.exit(0); });
  // maxConnections = 0 makes this worker refuse the handoff, so the primary
  // redistributes on EITHER outcome of the exit-vs-reply race: an escaped
  // reply says accepted: false, and a killed reply surfaces as the IPC close.
  // Exiting on a plain accepting server is racy even under real node - the
  // accepted: true reply escapes whenever uv flushes it before exit, and the
  // connection then dies with this worker.
  const srv = net.createServer(() => {});
  srv.maxConnections = 0;
  srv.listen(0, "127.0.0.1");
} else {
  net.createServer(sock => sock.on("data", d => process.send("live got: " + d))).listen(0, "127.0.0.1");
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

test("an out-of-range worker port throws in the worker and leaves the primary alive", () => {
  const dir = tempDirWithFiles("bun-test", {
    "main.ts": `
const cluster = require("node:cluster");
if (cluster.isPrimary) {
  const worker = cluster.fork();
  worker.on("message", m => {
    console.log("sync code:", m.sync);
    console.log("probe errno truthy:", !!m.probeErrno);
    setTimeout(() => { console.log("primary alive"); worker.kill(); process.exit(0); }, 50);
  });
} else {
  const http = require("node:http");
  let sync = "no-throw";
  try {
    http.createServer().listen(70000);
  } catch (e) {
    sync = e.code;
  }
  // Also poke the primary directly with the malformed probe: it must reply
  // with an errno instead of dying with an uncaughtException.
  cluster._sendInternal({ act: "probePort", address: null, port: 70000, addressType: 4 }, reply => {
    process.send({ sync, probeErrno: reply.errno });
  });
}
`,
  });
  const { stdout } = bunRun(joinP(dir, "main.ts"), bunEnv);
  expect(stdout).toContain("sync code: ERR_SOCKET_BAD_PORT");
  expect(stdout).toContain("probe errno truthy: true");
  expect(stdout).toContain("primary alive");
});

test("closing a worker http server releases the primary's port claim", () => {
  const dir = tempDirWithFiles("bun-test", {
    "main.ts": `
const cluster = require("node:cluster");
const net = require("node:net");
if (cluster.isPrimary) {
  // Reserve a concrete free port, release it, then hand it to the worker.
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1", () => {
    const port = probe.address().port;
    probe.close(() => {
      const worker = cluster.fork({ TEST_PORT: String(port) });
      let blocker;
      worker.on("message", m => {
        if (m.step === "closed") {
          // Occupy the port OUTSIDE the cluster, then ask the worker to re-listen.
          blocker = net.createServer(c => c.destroy());
          blocker.listen(port, "127.0.0.1", () => worker.send("relisten"));
        } else if (m.step === "relisten-error") {
          console.log("relisten code:", m.code, "syscall:", m.syscall);
          worker.kill();
          process.exit(0);
        } else if (m.step === "relisten-ok") {
          console.log("relisten wrongly succeeded");
          worker.kill();
          process.exit(1);
        }
      });
    });
  });
} else {
  const http = require("node:http");
  const port = Number(process.env.TEST_PORT);
  const first = http.createServer();
  first.listen(port, "127.0.0.1", () => {
    first.close(() => process.send({ step: "closed" }));
  });
  process.on("message", m => {
    if (m !== "relisten") return;
    const second = http.createServer();
    second.on("error", e => process.send({ step: "relisten-error", code: e.code, syscall: e.syscall }));
    second.listen(port, "127.0.0.1", () => process.send({ step: "relisten-ok" }));
  });
}
`,
  });
  const { stdout } = bunRun(joinP(dir, "main.ts"), bunEnv);
  // The re-listen must hit a FRESH primary test bind (syscall "bind" from the
  // probe reply), not a stale cached success that only fails later inside the
  // worker's own listen.
  expect(stdout).toContain("relisten code: EADDRINUSE syscall: bind");
});
