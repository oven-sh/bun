import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";

// Worker VM startup/teardown is much slower under debug and/or ASAN; these
// tests spawn many workers, so scale iteration counts and timeouts down.
// ASAN catches the underlying UAF deterministically, so fewer iterations
// are still sufficient regression coverage.
const slow = isDebug || isASAN;
const rounds = slow ? 4 : 8;
const perRound = slow ? 12 : 32;
const timeout = slow ? 60_000 : 20_000;

// Regression: `new Worker(url, { ref: false })` was silently ignored — the
// Zig-side `user_keep_alive` field was set from it but never read, and the
// parent keep-alive was taken unconditionally in `create()`. `.unref()` after
// construction worked; the constructor option did not.
test("new Worker with { ref: false } does not keep the parent alive", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        // The worker never exits on its own; if ref:false is honoured the
        // parent process exits immediately after spawning it.
        new Worker("data:text/javascript,setInterval(() => {}, 100000)", { ref: false });
        console.log("spawned");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("spawned\n");
  expect(exitCode).toBe(0);
});

// Regression: the Zig WebWorker struct was freed by the worker thread in
// exitAndDeinit while the C++ Worker still held a raw impl_ pointer, so a
// terminate()/ref()/unref() that landed after natural exit dereferenced freed
// memory (ASAN use-after-poison in setRefInternal).
test(
  "terminate/ref/unref after worker exits naturally does not UAF",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        for (let round = 0; round < ${rounds}; round++) {
          const workers = [];
          for (let i = 0; i < ${perRound}; i++) {
            // Empty body: worker thread exits as soon as the event loop drains.
            workers.push(new Worker("data:text/javascript,"));
          }
          await Promise.all(workers.map(w => new Promise(r => w.addEventListener("close", r, { once: true }))));
          // All workers have exited; previously the Zig struct was freed here,
          // so every call below dereferenced freed memory via Worker::impl_.
          for (const w of workers) {
            w.ref();
            w.unref();
            w.terminate();
            w.terminate();
            w.ref();
            w.unref();
          }
        }
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
  },
  timeout,
);

// Regression: WebWorker__dispatchExit deref'd the C++ Worker on the worker
// thread; if that was the last ref, ~Worker → ~EventTarget ran there and
// EventListenerMap::releaseAssertOrSetThreadUID tripped because the listener
// map was populated on the parent thread.
test(
  "nested worker whose grandchild outlives the middle worker's JSWorker does not assert",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        for (let i = 0; i < ${rounds}; i++) {
          const middle = new Worker(
            'data:text/javascript,' +
            // Middle worker creates an inner worker, registers a listener (so the
            // inner Worker's EventListenerMap is tagged with the middle thread),
            // then lets its own event loop drain.
            'const w = new Worker("data:text/javascript,"); w.addEventListener("message", () => {});'
          );
          middle.addEventListener("message", () => {});
          await new Promise(r => middle.addEventListener("close", r, { once: true }));
        }
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
  },
  timeout,
);

// Cross-thread completion delivery inside a worker goes through schedule-time
// VM/loop handles validated against the live-VM registry (address +
// generation). A broken handle capture (e.g. a zero generation) silently
// drops the completion instead of delivering it, so each producer class below
// would hang instead of resolving: the HTTP client thread (fetch), the
// process waiter thread (Bun.spawn exit), and the work pool (node:fs async,
// zlib native streams, Bun.password).
test(
  "cross-thread completions are delivered to live worker VMs",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const workerCode = \`
          const results = {};
          const server = Bun.serve({ port: 0, fetch: () => new Response("pong") });
          results.fetch = await (await fetch("http://127.0.0.1:" + server.port + "/")).text();
          server.stop(true);
          const child = Bun.spawn({ cmd: [process.execPath, "-e", "process.exit(7)"] });
          results.spawnExit = await child.exited;
          results.statIsFile = (await require("fs").promises.stat(process.execPath)).isFile();
          const zlib = require("zlib");
          const gz = await new Promise((resolve, reject) =>
            zlib.gzip(Buffer.from("hello"), (e, d) => (e ? reject(e) : resolve(d))),
          );
          results.gunzip = (await new Promise((resolve, reject) =>
            zlib.gunzip(gz, (e, d) => (e ? reject(e) : resolve(d))),
          )).toString();
          const hash = await Bun.password.hash("pw", { algorithm: "bcrypt", cost: 4 });
          results.password = await Bun.password.verify("pw", hash);
          postMessage(results);
        \`;
        const worker = new Worker(
          "data:text/javascript," + encodeURIComponent("(async () => {" + workerCode + "})()"),
        );
        const results = await new Promise((resolve, reject) => {
          worker.onmessage = e => resolve(e.data);
          worker.onerror = e => reject(new Error(e.message));
        });
        worker.terminate();
        console.log(JSON.stringify(results));
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      fetch: "pong",
      spawnExit: 7,
      statIsFile: true,
      gunzip: "hello",
      password: true,
    });
    expect(exitCode).toBe(0);
  },
  timeout,
);

// Same class as the fetch test below, for the process waiter thread: a worker
// that spawned a subprocess is terminated (VM freed) before the subprocess
// exits; the waiter thread then delivers the exit notification through the
// EventLoopHandle captured at spawn time, which the registry check must drop
// instead of enqueueing into the freed loop.
test(
  "terminating a worker with a subprocess in flight drops the waiter-thread completion",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const workerCode =
          "const child = Bun.spawn({ cmd: [process.execPath, \\"-e\\", \\"setTimeout(() => {}, 100000)\\"] });" +
          "postMessage(child.pid);";
        for (let i = 0; i < 3; i++) {
          const worker = new Worker("data:text/javascript," + encodeURIComponent(workerCode));
          const pid = await new Promise(resolve => (worker.onmessage = e => resolve(e.data)));
          const closed = new Promise(resolve => worker.addEventListener("close", resolve, { once: true }));
          worker.terminate();
          await closed;
          // Give the worker thread time to finish shutdown() and free its VM.
          await Bun.sleep(300);
          // Reap the orphan; the waiter thread now delivers the exit
          // notification keyed by the freed worker's event loop. Tolerate the
          // child having already died with the worker.
          try {
            process.kill(pid);
          } catch {}
          await Bun.sleep(300);
        }
        // Leave room for an in-progress sanitizer report to abort the process
        // before we exit cleanly.
        await Bun.sleep(1000);
        console.log("done");
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("AddressSanitizer");
    expect({ stdout, exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: "done\n",
      exitCode: 0,
      signalCode: null,
    });
  },
  timeout,
);

// Regression: a worker terminated while a fetch was in flight freed its
// VirtualMachine (and the event loop embedded in it) while the HTTP client
// thread still held a pointer to it; the completion callback then read the
// freed VM (heap-use-after-free in FetchTasklet::callback →
// VirtualMachine::is_shutting_down) and pushed into the freed concurrent
// queue. The corrupted queue surfaced in the wild as "Panic: invalid enum
// value" in EventLoop.tickQueueWithCount on worker threads. Same class: any
// cross-thread producer (work pool, watcher threads, napi) completing after
// worker.terminate(). ASAN-only: without a sanitizer the stale write is
// silent, so this test can only prove the bug on ASAN builds (the gate and
// the asan CI lanes).
test.skipIf(!isASAN)(
  "terminating a worker with a fetch in flight does not touch the freed VM",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        let releaseResponse = null;
        let requestArrived = null;
        const server = Bun.serve({
          port: 0,
          async fetch(req) {
            requestArrived();
            await new Promise(resolve => (releaseResponse = resolve));
            return new Response("x".repeat(1024));
          },
        });
        const url = "http://127.0.0.1:" + server.port + "/";
        const workerCode =
          "fetch(" + JSON.stringify(url) + ").then(r => r.text()).catch(() => {});" +
          "postMessage('fetching');";
        for (let i = 0; i < 3; i++) {
          const arrived = new Promise(resolve => (requestArrived = resolve));
          const worker = new Worker("data:text/javascript," + encodeURIComponent(workerCode));
          await new Promise(resolve => (worker.onmessage = resolve));
          // The request is now in flight on the HTTP client thread.
          await arrived;
          const closed = new Promise(resolve => worker.addEventListener("close", resolve, { once: true }));
          worker.terminate();
          await closed;
          // Give the worker thread time to finish shutdown() and free its VM.
          await Bun.sleep(300);
          // The HTTP thread now delivers the response to the freed VM.
          releaseResponse();
          await Bun.sleep(300);
        }
        // Leave room for an in-progress sanitizer report to abort the process
        // before we exit cleanly.
        await Bun.sleep(3000);
        console.log("done");
        server.stop(true);
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Check stderr first: on failure the sanitizer report is the useful
    // output, and asserting on it surfaces the report text in the diff.
    expect(stderr).not.toContain("AddressSanitizer");
    expect({ stdout, exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: "done\n",
      exitCode: 0,
      signalCode: null,
    });
  },
  timeout,
);
