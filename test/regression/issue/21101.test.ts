import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("worker receives messages during top-level await", async () => {
  using dir = tempDir("issue-21101", {
    "main.js": `
      import { Worker } from "node:worker_threads";

      const worker = new Worker(new URL("./worker.js", import.meta.url), {
        type: "module",
      });

      let watchdog;
      worker.on("message", (msg) => {
        console.log(msg);
        if (msg === "done") {
          clearInterval(interval);
          clearTimeout(watchdog);
          // Drop the parent-side ref so the parent's event loop drains
          // and the process exits. terminateAllAndWait() then forcibly
          // tears down the worker (parked in its never-resolving TLA)
          // during parent process shutdown. Using terminate()+process.exit()
          // here races the worker's dispatchExit and exposes a pre-existing
          // teardown crash unrelated to this fix.
          worker.unref();
        }
      });

      let count = 0;
      const interval = setInterval(() => {
        worker.postMessage("ping");
        count++;
        if (count >= 5) {
          clearInterval(interval);
          // If we sent 5 messages and never got "done", the bug is present.
          watchdog = setTimeout(() => process.exit(1), 2000);
        }
      }, 500);
    `,
    "worker.js": `
      import { parentPort } from "node:worker_threads";

      let received = 0;
      parentPort.on("message", (msg) => {
        received++;
        if (received === 3) {
          parentPort.postMessage("done");
        }
      });

      // Top-level await that never resolves — messages should still
      // be delivered while this is pending.
      await new Promise(() => {});
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The worker received at least 3 messages during TLA and sent "done"
  expect(stdout.trim()).toBe("done");
  expect(exitCode).toBe(0);
}, 15000);

test("worker receives messages during finite top-level await", async () => {
  using dir = tempDir("issue-21101-finite", {
    "main.js": `
      import { Worker } from "node:worker_threads";

      const worker = new Worker(new URL("./worker.js", import.meta.url), {
        type: "module",
      });

      let count = 0;
      const interval = setInterval(() => {
        worker.postMessage("hello");
        count++;
        if (count >= 10) clearInterval(interval);
      }, 100);

      worker.on("message", (msg) => {
        if (typeof msg === "string" && msg.startsWith("count:")) {
          console.log(msg);
          clearInterval(interval);
          // Drop the parent-side ref: see "during top-level await" test
          // for rationale. Parent drains, process exits, worker is
          // torn down via terminateAllAndWait().
          worker.unref();
        }
      });
    `,
    "worker.js": `
      import { parentPort } from "node:worker_threads";

      const received = [];
      parentPort.on("message", (msg) => {
        received.push(msg);
      });

      // TLA that resolves after 2s — messages sent during
      // the await should be delivered in real time, not queued.
      await new Promise((resolve) => setTimeout(resolve, 2000));

      parentPort.postMessage("count:" + received.length);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The worker should have received messages DURING the await
  const countLine = stdout
    .trim()
    .split("\n")
    .find((l: string) => l.startsWith("count:"));
  expect(countLine).toBeDefined();
  const count = parseInt(countLine!.split(":")[1]);
  expect(count).toBeGreaterThanOrEqual(1);
  expect(exitCode).toBe(0);
}, 15000);

test("worker receives messages posted synchronously before startup", async () => {
  // Regression guard: when the main thread posts messages synchronously
  // right after `new Worker(...)`, they are buffered in the inbox before
  // the worker's VM starts. The worker must drain the module body to
  // register its listener before firing the buffered messages, otherwise
  // they are dispatched with no listener and silently dropped.
  using dir = tempDir("issue-21101-sync", {
    "main.js": `
      import { Worker } from "node:worker_threads";

      const worker = new Worker(new URL("./worker.js", import.meta.url), {
        type: "module",
      });

      // Post BEFORE worker is online — these go into the pre-online inbox.
      worker.postMessage("m1");
      worker.postMessage("m2");
      worker.postMessage("m3");

      let timer = setTimeout(() => {
        console.error("timeout — buffered messages were dropped");
        process.exit(1);
      }, 3000);

      worker.on("message", (msg) => {
        if (msg === "done") {
          clearTimeout(timer);
          // Drop the parent-side ref: see "during top-level await" test
          // for rationale (pre-existing teardown crash with terminate()).
          worker.unref();
        }
      });
    `,
    "worker.js": `
      import { parentPort } from "node:worker_threads";

      const received = [];
      parentPort.on("message", (msg) => {
        received.push(msg);
        if (received.length === 3) {
          parentPort.postMessage("done");
        }
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("timeout");
  expect(exitCode).toBe(0);
}, 15000);

test("worker with preload that registers message listener still delivers to main module", async () => {
  // Regression guard for the pre-online loop: hasMessageListener is
  // satisfied by ANY listener on globalEventScope, including one
  // registered by a preload module that runs synchronously inside
  // reloadEntryPoint. If the loop short-circuits on the preload's
  // listener before the main module body runs, fireEarlyMessages
  // would dispatch buffered messages to the preload's listener only
  // and the main module's parentPort.on('message', ...) would never
  // see them.
  using dir = tempDir("issue-21101-preload", {
    "main.js": `
      import { Worker } from "node:worker_threads";
      import { fileURLToPath } from "node:url";

      const worker = new Worker(new URL("./worker.js", import.meta.url), {
        type: "module",
        preload: [fileURLToPath(new URL("./preload.js", import.meta.url))],
      });

      // Post BEFORE worker is online so the message is buffered and
      // drained by fireEarlyMessages on the worker thread.
      worker.postMessage("hello");

      let watchdog = setTimeout(() => {
        console.error("timeout");
        process.exit(1);
      }, 5000);

      worker.on("message", (msg) => {
        if (msg === "main-got") {
          clearTimeout(watchdog);
          worker.unref();
        }
      });
    `,
    "preload.js": `
      // Preload registers a 'message' listener on globalEventScope. Both
      // preload and main-module listeners share that scope, so on the
      // passing path both fire for every delivered message. We detect a
      // regression of the pre-online race not by exclusivity but by the
      // presence of 'main-got' in the parent's messages — which only
      // arrives if the main-module listener was registered before
      // fireEarlyMessages drained the buffered inbox.
      self.addEventListener("message", () => {
        self.postMessage("preload-got");
      });
    `,
    "worker.js": `
      import { parentPort } from "node:worker_threads";

      parentPort.on("message", (msg) => {
        if (msg === "hello") {
          parentPort.postMessage("main-got");
        }
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("timeout");
  expect(exitCode).toBe(0);
}, 15000);
