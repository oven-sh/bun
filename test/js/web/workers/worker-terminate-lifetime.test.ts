import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";

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

// Regression: terminating a worker while a fetch() it started was still in
// flight freed the worker's VirtualMachine while the HTTP client thread still
// held a FetchTasklet backref to it. The next progress callback read
// `is_shutting_down` from the freed allocation and pushed onto the freed
// concurrent task queue — a segfault on the queue-head atomic swap in release
// builds, a deterministic heap-use-after-free under ASAN.
test(
  "terminating a worker with an in-flight fetch does not UAF the worker VM",
  async () => {
    using dir = tempDir("worker-fetch-terminate", {
      "main.js": `
        // Drip body chunks forever so each worker's fetch stays in flight and
        // keeps generating HTTP-thread progress callbacks after terminate().
        const server = Bun.serve({
          port: 0,
          idleTimeout: 0,
          fetch() {
            let timer;
            return new Response(
              new ReadableStream({
                start(controller) {
                  timer = setInterval(() => {
                    try {
                      controller.enqueue(new Uint8Array(4096));
                    } catch {
                      clearInterval(timer);
                    }
                  }, 1);
                },
                cancel() {
                  clearInterval(timer);
                },
              }),
            );
          },
        });

        for (let i = 0; i < ${slow ? 8 : 16}; i++) {
          const worker = new Worker(new URL("./worker.js", import.meta.url).href);
          // Reject on every failure event so a broken worker fails the test
          // immediately instead of hanging it until the timeout.
          const { promise: inFlight, resolve: markInFlight, reject: failInFlight } = Promise.withResolvers();
          worker.onmessage = markInFlight;
          worker.onmessageerror = () => failInFlight(new Error("worker message failed to deserialize"));
          worker.onerror = e => failInFlight(new Error("worker error: " + (e?.message ?? e)));
          worker.addEventListener("close", () => failInFlight(new Error("worker closed before signaling in-flight fetch")), {
            once: true,
          });
          worker.postMessage(server.port);
          await inFlight;
          // The worker has processed the response headers; the body is still
          // streaming. Terminate mid-stream: the worker VM is torn down while
          // the HTTP thread keeps delivering chunks for its tasklet — and the
          // streams of workers terminated in previous iterations keep
          // dripping into their freed VMs throughout the loop.
          worker.terminate();
        }
        // Force-close the dripping connections so every leaked request also
        // delivers its final result callback for a long-dead worker VM, then
        // give those callbacks a moment to land (they are internal HTTP-thread
        // events for dead workers — there is nothing observable to await).
        server.stop(true);
        await Bun.sleep(50);
        console.log("done");
      `,
      "worker.js": `
        self.onmessage = async e => {
          const res = await fetch("http://127.0.0.1:" + e.data + "/");
          // Deliberately do not consume res.body — the server keeps dripping
          // and every chunk is an HTTP-thread callback targeting this VM.
          postMessage("in-flight");
        };
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      // Destruct-on-exit (what ASAN CI runs with) additionally walks the
      // process-exit reclaim paths: dead-worker tasklets sit parked in the
      // process-global exit reclaim list, and the exit drain then runs their
      // `deinit` — including JSC-handle teardown against worker heaps that
      // died with `teardownJSCVM` (bmalloc-backed, so ASAN alone cannot
      // flag it). The fixture must stay crash-free through that whole path.
      env: { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("done\n");
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
