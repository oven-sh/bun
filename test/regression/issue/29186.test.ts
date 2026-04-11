// https://github.com/oven-sh/bun/issues/29186
//
// `self.close()` is the WHATWG DedicatedWorkerGlobalScope#close API. Inside a
// Web Worker it requests termination of the worker on the next event loop
// tick; any task already queued before the call (e.g. an immediately-
// preceding postMessage) still completes. Before the fix, calling it threw
// `TypeError: self.close is not a function`.
//
// Node.js worker_threads has NO global `close` — Bun's Node-kind workers
// must therefore not expose one either, otherwise `typeof close === "undefined"`
// feature-detection breaks and stray `close()` calls silently kill the
// worker instead of throwing `ReferenceError`.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("self.close() terminates the worker after the current task finishes", async () => {
  using dir = tempDir("issue-29186", {
    "worker.mjs": `
      self.postMessage("message");
      // Closing immediately after postMessage should just terminate the worker;
      // the queued postMessage above must still reach the parent.
      self.close();
    `,
    "main.mjs": `
      const worker = new Worker(new URL("./worker.mjs", import.meta.url).href, { type: "module" });
      const events = [];
      const { promise, resolve, reject } = Promise.withResolvers();

      worker.onmessage = ({ data }) => { events.push({ type: "message", data }); };
      worker.onerror = (e) => reject(new Error("worker error: " + (e.message || e)));
      worker.addEventListener("close", () => {
        events.push({ type: "close" });
        resolve();
      });

      await promise;
      console.log(JSON.stringify(events));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(JSON.parse(stdout.trim())).toEqual([
    { type: "message", data: "message" },
    { type: "close" },
  ]);
  expect(exitCode).toBe(0);
});

test("close and self.close exist on the Web Worker global scope", async () => {
  using dir = tempDir("issue-29186-typeof", {
    "worker.mjs": `
      self.postMessage({
        selfClose: typeof self.close,
        globalClose: typeof close,
      });
    `,
    "main.mjs": `
      const worker = new Worker(new URL("./worker.mjs", import.meta.url).href, { type: "module" });
      const { promise, resolve, reject } = Promise.withResolvers();
      worker.onmessage = ({ data }) => { console.log(JSON.stringify(data)); resolve(); };
      worker.onerror = (e) => reject(new Error("worker error: " + (e.message || e)));
      await promise;
      worker.terminate();
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(JSON.parse(stdout.trim())).toEqual({
    selfClose: "function",
    globalClose: "function",
  });
  expect(exitCode).toBe(0);
});

test("close is NOT defined on node:worker_threads Workers (matches Node.js)", async () => {
  // In Node.js, `typeof close` is `"undefined"` inside a worker_threads Worker
  // and calling `close()` throws `ReferenceError: close is not defined`.
  // Bun must match — otherwise a stray `close()` would silently terminate
  // the worker and `if (typeof close === "function")` feature detection would
  // misbehave.
  using dir = tempDir("issue-29186-node-worker-threads", {
    "worker.cjs": `
      const { parentPort } = require("node:worker_threads");
      let referenceErrorThrown = false;
      try {
        // eslint-disable-next-line no-undef
        close();
      } catch (e) {
        referenceErrorThrown = e instanceof ReferenceError;
      }
      parentPort.postMessage({
        globalClose: typeof close,
        globalThisClose: typeof globalThis.close,
        referenceErrorThrown,
      });
    `,
    "main.cjs": `
      const { Worker } = require("node:worker_threads");
      const worker = new Worker(require("node:path").join(__dirname, "worker.cjs"));
      worker.on("message", (msg) => { console.log(JSON.stringify(msg)); worker.terminate(); });
      worker.on("error", (err) => { console.error("worker error:", err); process.exit(1); });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(JSON.parse(stdout.trim())).toEqual({
    globalClose: "undefined",
    globalThisClose: "undefined",
    referenceErrorThrown: true,
  });
  expect(exitCode).toBe(0);
});

test("close() on the main thread is a no-op", async () => {
  // On main (non-window) contexts, `close()` should silently do nothing —
  // matching how `postMessage` is a no-op there today.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `close(); console.log("ok");`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
});
