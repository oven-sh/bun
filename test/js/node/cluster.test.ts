import { expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, bunRun, joinP, tempDir, tempDirWithFiles } from "harness";
import path from "node:path";

// Every test here forks at least one cluster worker (a whole bun process, plus
// a nested fork), which runs well past the 5s default under a debug/ASAN build.
setDefaultTimeout(40_000);

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

// https://github.com/oven-sh/bun/issues/20642
test("worker.disconnect() with a net.Server exits instead of hanging", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "cluster", "worker-disconnect-with-tcp-server-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Two workers each: listening + disconnecting; primary logs two worker exits + final line.
  const listening = [...stdout.matchAll(/\[worker \d+\] listening/g)].length;
  const disconnecting = [...stdout.matchAll(/\[worker \d+\] disconnecting/g)].length;
  const workerExited = [...stdout.matchAll(/\[master\] worker \d+ exited/g)].length;
  expect({ listening, disconnecting, workerExited, stderr, exitCode }).toEqual({
    listening: 2,
    disconnecting: 2,
    workerExited: 2,
    stderr: "",
    exitCode: 0,
  });
  expect(stdout).toContain("[master] all workers exited");
});

// Per https://nodejs.org/api/cluster.html#workerdisconnect, disconnect() closes the
// worker's servers, waits for their 'close' events, then disconnects the IPC channel.
// Covers both node:http (own SO_REUSEPORT socket) and net.Server (_getServer stub).
test.concurrent(
  "primary-initiated worker.disconnect() closes the worker's http server and the worker exits",
  async () => {
    using dir = tempDir("cluster-disconnect-http", {
      "main.js": `
        const cluster = require("node:cluster");
        const http = require("node:http");
        const net = require("node:net");

        if (cluster.isPrimary) {
          const worker = cluster.fork();
          const disconnected = new Promise(resolve => worker.once("disconnect", resolve));
          const exited = new Promise(resolve => worker.once("exit", (code, signal) => resolve({ code, signal })));

          worker.on("message", async msg => {
            if (msg.cmd !== "listening") return;
            const port = msg.port;
            const before = await (await fetch(\`http://127.0.0.1:\${port}/\`)).text();

            worker.disconnect();

            // The worker must close its server, disconnect the channel and
            // exit on its own. If it never does (the bug), kill it so it
            // cannot outlive the test, and report the failure.
            let timer;
            const timedOut = new Promise(resolve => {
              timer = setTimeout(resolve, 20_000, "timeout");
            });
            const exit = await Promise.race([Promise.all([exited, disconnected]).then(([e]) => e), timedOut]);
            clearTimeout(timer);
            if (exit === "timeout") {
              worker.process.kill("SIGKILL");
              console.log(JSON.stringify({ fail: "worker did not exit after disconnect()" }));
              process.exit(1);
            }

            // The worker is gone, so nothing may be listening on its port.
            const after = await new Promise(resolve => {
              const socket = net.connect(port, "127.0.0.1");
              socket.once("connect", () => {
                socket.destroy();
                resolve("still listening");
              });
              socket.once("error", () => resolve("refused"));
            });

            console.log(JSON.stringify({ before, exit, exitedAfterDisconnect: worker.exitedAfterDisconnect, after }));
            process.exit(0);
          });
        } else {
          const server = http.createServer((req, res) => res.end("served-by-worker"));
          server.listen(0, "127.0.0.1", () => {
            process.send({ cmd: "listening", port: server.address().port });
          });
        }
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      env: bunEnv,
      cwd: String(dir),
      // Inherited so that on regression the worker's output reaches the
      // runner log instead of filling an unread pipe.
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe(
      '{"before":"served-by-worker","exit":{"code":0,"signal":null},"exitedAfterDisconnect":true,"after":"refused"}',
    );
    expect(exitCode).toBe(0);
  },
);

test.concurrent(
  "primary-initiated worker.disconnect() closes the worker's net.Server and the worker exits",
  async () => {
    using dir = tempDir("cluster-disconnect-net", {
      "main.js": `
        const cluster = require("node:cluster");
        const net = require("node:net");

        if (cluster.isPrimary) {
          const worker = cluster.fork();
          const exited = new Promise(resolve => worker.once("exit", (code, signal) => resolve({ code, signal })));

          worker.on("message", async msg => {
            if (msg.cmd !== "listening") return;
            worker.disconnect();

            let timer;
            const timedOut = new Promise(resolve => {
              timer = setTimeout(resolve, 20_000, "timeout");
            });
            const exit = await Promise.race([exited, timedOut]);
            clearTimeout(timer);
            if (exit === "timeout") {
              worker.process.kill("SIGKILL");
              console.log(JSON.stringify({ fail: "worker did not exit after disconnect()" }));
              process.exit(1);
            }
            console.log(JSON.stringify({ exit }));
            process.exit(0);
          });
        } else {
          const server = net.createServer(socket => socket.end());
          // disconnect() must close the worker's real listening socket, not
          // just the cluster bookkeeping stub.
          server.once("close", () => console.log("worker server closed"));
          server.listen(0, "127.0.0.1", () => {
            process.send({ cmd: "listening", port: server.address().port });
          });
        }
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      env: bunEnv,
      cwd: String(dir),
      // Inherited so that on regression the worker's output reaches the
      // runner log instead of filling an unread pipe.
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim().split("\n")).toEqual(["worker server closed", '{"exit":{"code":0,"signal":null}}']);
    expect(exitCode).toBe(0);
  },
);
