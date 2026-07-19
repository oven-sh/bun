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

test("primary does not root the worker object graph per live worker", async () => {
  // `onInternalMessagePrimary` stores the Worker object and the internal
  // message callback for each forked worker. Storing them as GC roots (one
  // `JSC::Strong` each) means:
  //   * every live worker adds two entries to the protected-object set, and
  //   * Worker → ChildProcess → Subprocess → ipc_data → Strong(Worker) is a
  //     cycle through a root, so the whole graph survives GC after the worker
  //     exits.
  // Held in the Subprocess wrapper's own WriteBarrier slots instead, they are
  // a GC edge rather than a GC root: neither effect occurs.
  using dir = tempDir("cluster-internal-msg-roots", {
    "primary.ts": `
import cluster from "node:cluster";
import { heapStats } from "bun:jsc";

if (!cluster.isPrimary) {
  process.on("message", () => {});
  await new Promise(() => {});
}

const N = 6;

function protectedCounts() {
  Bun.gc(true);
  const p = heapStats().protectedObjectTypeCounts;
  return { Function: p.Function ?? 0, Object: p.Object ?? 0 };
}

const before = protectedCounts();

const workers: import("node:cluster").Worker[] = [];
for (let i = 0; i < N; i++) workers.push(cluster.fork());
await Promise.all(workers.map(w => new Promise<void>(r => w.once("online", () => r()))));

const during = protectedCounts();

// Kill every worker, wait for the channel to close, then drop user references.
for (const w of workers) w.process.kill();
await Promise.all(
  workers.map(w => new Promise<void>(r => {
    let n = 0;
    const step = () => { if (++n === 2) r(); };
    w.once("exit", step);
    w.once("disconnect", step);
  })),
);
workers.length = 0;

// Bounded poll across event-loop turns: finalization may need a few extra
// turns, while a Strong-rooted Subprocess never goes away.
let liveSubprocess = Infinity;
for (let i = 0; i < 60; i++) {
  await new Promise<void>(r => setImmediate(r));
  Bun.gc(true);
  liveSubprocess = heapStats().objectTypeCounts.Subprocess ?? 0;
  if (liveSubprocess <= 1) break;
}

console.log(JSON.stringify({ N, before, during, liveSubprocess }));
process.exit(0);
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "primary.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  const { N, before, during, liveSubprocess } = JSON.parse(stdout.trim());
  // No per-worker protected roots while the workers are alive. Strict equality
  // against the baseline: a regression shows up as `before + N`.
  expect({
    protectedFunctionDelta: during.Function - before.Function,
    protectedObjectDelta: during.Object - before.Object,
    exitCode,
  }).toEqual({
    protectedFunctionDelta: 0,
    protectedObjectDelta: 0,
    exitCode: 0,
  });
  // After every worker exits and user code holds no reference, the Subprocess
  // wrappers are collectable. Allow one straggler for a conservatively rooted
  // async frame; a root-cycle leak retains all N.
  expect(liveSubprocess).toBeLessThanOrEqual(1);
  expect(liveSubprocess).toBeLessThan(N);
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
