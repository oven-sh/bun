import { expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, isLinux, isWindows, joinP, tempDir, tempDirWithFiles } from "harness";

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

// https://github.com/oven-sh/bun/issues/17762
// Workers used to re-bind the port the primary had already bound on their
// behalf, so every `net.createServer().listen()` in a worker died with
// EADDRINUSE. Now the primary only coordinates (it resolves port 0 to the
// concrete port every worker must agree on) and each worker binds with
// SO_REUSEPORT, which Windows does not implement.
test.skipIf(isWindows)("net.createServer in cluster workers shares one port and serves from every worker", async () => {
  using dir = tempDir("cluster-net", {
    "server.js": `
      const cluster = require("node:cluster");
      const net = require("node:net");

      if (cluster.isPrimary) {
        const ports = new Map();
        const errors = [];
        const workers = [cluster.fork(), cluster.fork()];
        for (const worker of workers) {
          worker.on("message", message => errors.push(message));
          worker.on("exit", code => {
            // No worker may die before the primary is done with it.
            console.log(JSON.stringify({ earlyExit: { id: worker.id, code }, errors }));
            process.exit(1);
          });
        }
        cluster.on("listening", (worker, address) => {
          ports.set(worker.id, address.port);
          if (ports.size === workers.length) {
            run().catch(error => {
              console.log(JSON.stringify({ clientError: String(error), ports: [...ports.values()], errors }));
              process.exit(1);
            });
          }
        });

        async function run() {
          const port = [...ports.values()][0];
          const served = new Set();
          let attempts = 0;
          // SO_REUSEPORT picks the listener from a hash of the 4-tuple, so
          // distinct client source ports reach both workers within a few
          // connections. Bounded so a regression cannot hang the test.
          while (served.size < 2 && attempts < 200) {
            attempts++;
            served.add(await new Promise((resolve, reject) => {
              const socket = net.connect(port, "127.0.0.1");
              let data = "";
              socket.on("data", chunk => (data += chunk));
              socket.on("end", () => resolve(data));
              socket.on("error", reject);
            }));
          }
          console.log(JSON.stringify({ ports: [...ports.values()], errors, served: [...served].sort(), attempts }));
          for (const worker of workers) {
            worker.removeAllListeners("exit");
            worker.kill();
          }
          process.exit(0);
        }
      } else {
        const server = net.createServer(socket => socket.end("worker:" + cluster.worker.id));
        server.on("error", error => process.send({ id: cluster.worker.id, code: error.code }));
        server.listen(0);
      }
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.js"],
    env: bunEnv,
    cwd: String(dir),
    // Inherited so a worker's crash output reaches the runner log instead of
    // filling an unread pipe.
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  const { ports = [], errors = [], served = [], attempts: _attempts, ...failure } = JSON.parse(stdout.trim());
  // `failure` carries the fixture's diagnostic fields, so a bail-out shows up
  // in the first diff instead of as a missing port.
  expect({ ...failure, errors }).toEqual({ errors: [] });
  // Every worker must end up on the port the primary picked.
  expect(ports).toHaveLength(2);
  expect(ports[1]).toBe(ports[0]);
  expect(ports[0]).toBeGreaterThan(0);
  // The kernel only balances across a SO_REUSEPORT group on Linux; on other
  // platforms it is enough that the shared port serves at all.
  if (isLinux) {
    expect(served).toEqual(["worker:1", "worker:2"]);
  } else {
    expect(served.length).toBeGreaterThan(0);
  }
  expect(exitCode).toBe(0);
});

// worker.disconnect() must close the net servers the worker opened through
// node:cluster, or the worker keeps listening and never exits.
test("worker.disconnect closes a net server opened in the worker", async () => {
  using dir = tempDir("cluster-net-disconnect", {
    "server.js": `
      const cluster = require("node:cluster");
      const net = require("node:net");

      if (cluster.isPrimary) {
        const worker = cluster.fork();
        console.log("I" + JSON.stringify({ workerPid: worker.process.pid }));
        worker.once("listening", () => worker.disconnect());
        worker.once("exit", (code, signal) => {
          console.log("P" + JSON.stringify({ code, signal, exitedAfterDisconnect: worker.exitedAfterDisconnect }));
        });
      } else {
        const server = net.createServer(() => {});
        server.listen(0);
        // The primary-initiated disconnect reaches this event whether or not
        // the server was torn down, so a regression reports listening: true
        // here instead of hanging with no output.
        process.once("disconnect", () => {
          console.log("W" + JSON.stringify({ listening: server.listening }));
        });
      }
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "inherit",
  });

  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  async function nextLine(): Promise<string> {
    for (;;) {
      const newline = buffered.indexOf("\n");
      if (newline !== -1) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        return line;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error(`stdout ended early: ${JSON.stringify(buffered)}`);
      buffered += decoder.decode(value, { stream: true });
    }
  }

  const { workerPid } = JSON.parse((await nextLine()).slice(1));
  try {
    // Asserted one line at a time: the primary's line only arrives once the
    // worker exits on its own, which a worker whose server was never torn
    // down does not do, so the worker's report has to be checked first.
    const worker = await nextLine();
    expect({ tag: worker[0], ...JSON.parse(worker.slice(1)) }).toEqual({ tag: "W", listening: false });
    const primary = await nextLine();
    expect({ tag: primary[0], ...JSON.parse(primary.slice(1)) }).toEqual({
      tag: "P",
      code: 0,
      signal: null,
      exitedAfterDisconnect: true,
    });
    expect(await proc.exited).toBe(0);
  } finally {
    // The worker is the primary's child, not ours: killing `proc` cannot
    // reach it, and on failure it has no reason to exit on its own.
    try {
      process.kill(workerPid, "SIGKILL");
    } catch {}
  }
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
