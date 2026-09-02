// https://github.com/oven-sh/bun/issues/34115
// A preload script that touches process.nextTick (directly, or via a module that
// does) must not change the relative order of process.nextTick vs microtasks
// scheduled at the top level of the entry module.
//
// node:worker_threads workers hit the same path: since #31216 every such worker
// implicitly preloads node:worker_threads, which pulls in node:stream and
// touches process.nextTick before the worker's own entry runs.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const orderFixture = `
process.nextTick(() => console.log("nextTick"));
queueMicrotask(() => console.log("microtask"));
Promise.resolve().then(() => console.log("promise"));
`;

describe("process.nextTick ordering is preserved with --preload", () => {
  test.concurrent.each([
    ["that reads process.nextTick", `process.nextTick;`],
    ["that calls process.nextTick", `process.nextTick(() => console.log("preload-tick"));`, "preload-tick\n"],
    ["that requires node:stream", `require("node:stream");`],
    ["that requires node:zlib", `require("node:zlib");`],
  ])("preload %s", async (_name, preloadBody, preloadOutput = "") => {
    using dir = tempDir("issue-34115-order", {
      "preload.js": preloadBody,
      "order.js": orderFixture,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--preload", "./preload.js", "order.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe(preloadOutput + "nextTick\nmicrotask\npromise\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("preserved with two preload scripts", async () => {
    using dir = tempDir("issue-34115-two-preloads", {
      "preload-a.js": `process.nextTick(() => console.log("a"));`,
      "preload-b.js": `process.nextTick(() => console.log("b"));`,
      "order.js": orderFixture,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--preload", "./preload-a.js", "--preload", "./preload-b.js", "order.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("a\nb\nnextTick\nmicrotask\npromise\n");
    expect(exitCode).toBe(0);
  });
});

describe("process.nextTick ordering at the top level of a worker_threads CJS entry", () => {
  const workerOrderBody = `
const seq = ["sync"];
Promise.resolve().then(() => seq.push("pt"));
queueMicrotask(() => seq.push("qm"));
process.nextTick(() => seq.push("nt"));
setImmediate(() => require("node:worker_threads").parentPort.postMessage(seq.join(",")));
`;

  test.concurrent.each([
    ["file entry", `"./worker.cjs"`],
    ["eval: true", `${JSON.stringify(workerOrderBody)}, { eval: true }`],
  ])("matches the main thread (%s)", async (_name, workerArgs) => {
    using dir = tempDir("issue-34115-worker", {
      "worker.cjs": workerOrderBody,
      "main.mjs": `
import { Worker } from "node:worker_threads";
const w = new Worker(${workerArgs});
w.on("message", seq => { console.log(seq); w.terminate(); });
w.on("error", e => { console.error(String(e)); process.exitCode = 1; });
`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("sync,nt,pt,qm\n");
    expect(exitCode).toBe(0);
  });
});

test.concurrent("Writable.toWeb() close rejects with ABORT_ERR when preload requires node:stream", async () => {
  using dir = tempDir("issue-34115-writable", {
    "preload.js": `require("node:stream");`,
    "repro.js": `
      const { Writable } = require("stream");
      const w = new Writable({ write(c, e, cb) { cb(); } });
      const ws = Writable.toWeb(w);
      ws.close().then(
        () => console.log("RESOLVED"),
        e => console.log("rejected:", e.code),
      );
      w.end();
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--preload", "./preload.js", "repro.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("rejected: ABORT_ERR\n");
  expect(exitCode).toBe(0);
});

// A nextTick callback that spins wait_for_promise re-enters GlobalObject::drainMicrotasks
// under the hook's m_isDrainingNextTickQueue guard; JSNextTickQueue::drain must not clear
// asyncContextData[0] on that nested path.
test.concurrent("AsyncLocalStorage frame survives a nextTick callback that spins wait_for_promise", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const { AsyncLocalStorage } = require("node:async_hooks");
const als = new AsyncLocalStorage();
als.run("outer-frame", () => {
  process.nextTick(() => {
    const before = als.getStore();
    new HTMLRewriter()
      .on("*", {
        async element() {
          await 0;
          process.nextTick(() => {});
          await 0;
        },
      })
      .transform(new Response("<div></div><div></div>"))
      .text();
    console.log(before, als.getStore());
  });
});
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("outer-frame outer-frame\n");
  expect(exitCode).toBe(0);
});
