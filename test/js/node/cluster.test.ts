import { expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, joinP, tempDir, tempDirWithFiles } from "harness";

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

// Node's cluster primary resolves listen(0) to ONE port that every worker
// shares; Bun used to let each worker bind its own ephemeral port, so
// server.address().port disagreed between workers and only one of them served
// the port the application registered.
const listenZeroFixture = /* js */ `
import cluster from "node:cluster";

// "net" or "http"; loading only the module under test keeps the per-process
// startup cost of a debug build out of the test's timeout budget.
const kind = process.argv[2];
const mod = (await import("node:" + kind)).default;
const workerCount = 3;
const requestCount = 8;

if (cluster.isPrimary) {
  const reported = [];
  const listening = [];
  const { promise: allReady, resolve: ready, reject: fail } = Promise.withResolvers();
  const check = () => {
    if (reported.length === workerCount && listening.length === workerCount) ready();
  };
  cluster.on("exit", (worker, code, signal) => {
    fail(new Error("worker " + worker.id + " exited before readiness (" + (signal ?? code) + ")"));
  });
  cluster.on("message", (worker, message) => {
    reported.push(message.port);
    check();
  });
  cluster.on("listening", (worker, address) => {
    listening.push(address.port);
    check();
  });
  for (let i = 0; i < workerCount; i++) cluster.fork();
  await allReady;
  cluster.removeAllListeners("exit");
  cluster.removeAllListeners("message");
  cluster.removeAllListeners("listening");

  const port = reported[0];

  // A worker whose listen(0) arrives after the port is already resolved takes
  // the primary handle's answered-up-front path (the same one every worker of
  // a fixed-port server takes) and must join P, not bind a fresh port.
  const { promise: lateReady, resolve: lateDone, reject: lateFail } = Promise.withResolvers();
  const late = cluster.fork();
  late.on("message", lateDone);
  late.on("exit", (code, signal) => {
    lateFail(new Error("late worker exited before listening (" + (signal ?? code) + ")"));
  });
  const lateReport = await lateReady;

  // Every request to the one reported port must be answered by a worker: the
  // primary never owns a competing socket that would swallow connections.
  let served = 0;
  for (let i = 0; i < requestCount; i++) {
    let body;
    if (kind === "http") {
      body = await (await fetch("http://127.0.0.1:" + port + "/")).text();
    } else {
      body = await new Promise((resolve, reject) => {
        const socket = mod.connect(port, "127.0.0.1");
        let data = "";
        socket.on("data", chunk => (data += chunk));
        socket.on("end", () => resolve(data));
        socket.on("error", reject);
      });
    }
    if (body.startsWith("served by worker ")) served++;
  }

  console.log(
    JSON.stringify({
      workers: reported.length,
      distinctReportedPorts: new Set(reported).size,
      distinctListeningPorts: new Set(listening).size,
      listeningMatchesReported: new Set([...reported, ...listening]).size === 1,
      lateWorkerSharesPort: lateReport.port === port,
      served,
    }),
  );
  for (const id in cluster.workers) cluster.workers[id].process.kill();
  process.exit(0);
} else {
  const body = "served by worker " + cluster.worker.id;
  const server =
    kind === "http"
      ? mod.createServer((req, res) => res.end(body))
      : mod.createServer(socket => socket.end(body));
  server.on("error", error => {
    console.error("worker listen error:", error.code);
    process.exit(1);
  });
  server.listen(0, "127.0.0.1", () => {
    process.send({ port: server.address().port });
  });
}
`;

test.concurrent.each(["net", "http"])(
  "cluster workers all share one primary-resolved port for listen(0) (%s)",
  async kind => {
    using dir = tempDir("cluster-listen0", { "fixture.mjs": listenZeroFixture });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.mjs", kind],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    let result;
    try {
      result = JSON.parse(stdout.trim().split("\n").pop()!);
    } catch {
      result = { stdout, stderr };
    }
    expect(result).toEqual({
      workers: 3,
      distinctReportedPorts: 1,
      distinctListeningPorts: 1,
      listeningMatchesReported: true,
      lateWorkerSharesPort: true,
      served: 8,
    });
    expect(exitCode).toBe(0);
  },
  // The primary and each worker load node:cluster from scratch in a debug
  // build, which alone is most of bun:test's 5s default.
  30_000,
);
