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

test.concurrent("self.close() lets the current task finish before terminating", async () => {
  // Per https://html.spec.whatwg.org/multipage/workers.html#close-a-worker,
  // close() sets the "closing" flag and discards tasks already queued on the
  // worker's event loop. The task that called close() runs to completion —
  // so postMessage calls BEFORE *and* AFTER close() within the same task
  // must still reach the parent. Browsers (Chrome/Firefox/Safari) all
  // deliver "after".
  using dir = tempDir("issue-29186", {
    "worker.mjs": `
      self.postMessage("before");
      self.close();
      self.postMessage("after");
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

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // Check exit code first — if the worker threw (pre-fix), stdout is empty and
  // the parse below would mask the real failure with a confusing JSON error.
  expect({ exitCode, stdout, stderr }).toMatchObject({ exitCode: 0 });
  expect(JSON.parse(stdout.trim())).toEqual([
    { type: "message", data: "before" },
    { type: "message", data: "after" },
    { type: "close" },
  ]);
});

test.concurrent("close and self.close exist on the Web Worker global scope", async () => {
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

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ exitCode, stdout, stderr }).toMatchObject({ exitCode: 0 });
  expect(JSON.parse(stdout.trim())).toEqual({
    selfClose: "function",
    globalClose: "function",
  });
});

test.concurrent("close is NOT defined on node:worker_threads Workers (matches Node.js)", async () => {
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

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ exitCode, stdout, stderr }).toMatchObject({ exitCode: 0 });
  expect(JSON.parse(stdout.trim())).toEqual({
    globalClose: "undefined",
    globalThisClose: "undefined",
    referenceErrorThrown: true,
  });
});

test.concurrent("self.close() discards queued tasks (setTimeout scheduled before close never fires)", async () => {
  // Per https://html.spec.whatwg.org/multipage/workers.html#close-a-worker step
  // 1, `close()` discards tasks already queued on the worker's event loop.
  // A `setTimeout(fn, 0)` scheduled before close() must not fire. Browsers
  // (Chrome/Firefox/Safari) all match this; Bun used to run one extra tick
  // of queued work after close().
  using dir = tempDir("issue-29186-discard", {
    "worker.mjs": `
      setTimeout(() => { self.postMessage("timer-fired"); }, 0);
      self.postMessage("before-close");
      self.close();
    `,
    "main.mjs": `
      const worker = new Worker(new URL("./worker.mjs", import.meta.url).href, { type: "module" });
      const events = [];
      const { promise, resolve, reject } = Promise.withResolvers();

      worker.onmessage = ({ data }) => { events.push(data); };
      worker.onerror = (e) => reject(new Error("worker error: " + (e.message || e)));
      worker.addEventListener("close", () => resolve());

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

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ exitCode, stdout, stderr }).toMatchObject({ exitCode: 0 });
  // Only "before-close" — the queued setTimeout must be discarded.
  expect(JSON.parse(stdout.trim())).toEqual(["before-close"]);
});

test.concurrent("worker.terminate() still interrupts JS even after self.close() was called", async () => {
  // `self.close()` sets a cooperative-close flag — but a follow-up
  // parent-side `worker.terminate()` must still arm the JSC termination
  // trap and interrupt any long-running synchronous work the worker got
  // stuck in after close(). Otherwise `worker.terminate()` would be a
  // silent no-op for closed-but-busy workers.
  //
  // Ordering is deterministic via an "in-loop" readiness postMessage: the
  // parent only calls terminate() after seeing that message, which proves
  // the worker reached the busy loop AFTER self.close(). The first test in
  // this file already proves postMessage-after-close is delivered.
  using dir = tempDir("issue-29186-terminate-after-close", {
    "worker.mjs": `
      self.close();
      self.postMessage("in-loop");
      // Heavy synchronous work — would run forever without the trap.
      const start = performance.now();
      while (performance.now() - start < 60_000) {}
      self.postMessage("should-not-reach");
    `,
    "main.mjs": `
      const worker = new Worker(new URL("./worker.mjs", import.meta.url).href, { type: "module" });
      const ready = Promise.withResolvers();
      const done = Promise.withResolvers();
      let sawUnexpected = false;

      worker.onmessage = ({ data }) => {
        if (data === "in-loop") ready.resolve();
        else sawUnexpected = true;
      };
      worker.addEventListener("close", () => done.resolve());
      worker.onerror = (e) => done.reject(new Error("worker error: " + (e.message || e)));

      // Wait for the worker to confirm it's in the busy loop, then force
      // termination.
      await ready.promise;
      worker.terminate();
      await done.promise;

      console.log(sawUnexpected ? "UNEXPECTED" : "OK");
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
  expect({ exitCode, stdout, stderr }).toMatchObject({ exitCode: 0 });
  expect(stdout.trim()).toBe("OK");
});

test.concurrent("close() on the main thread is a no-op", async () => {
  // On main (non-window) contexts, `close()` should silently do nothing —
  // matching how `postMessage` is a no-op there today.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `close(); console.log("ok");`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ exitCode, stdout, stderr }).toMatchObject({ exitCode: 0 });
  expect(stdout).toBe("ok\n");
});
