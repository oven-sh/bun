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

// Regression: Worker.terminate() freed the worker's VirtualMachine while the
// shared HTTP thread still held a pointer to it from an in-flight fetch();
// when the fetch later failed, the HTTP thread read the freed VM
// (FetchTasklet::callback -> is_shutting_down) and pushed onto its freed
// concurrent task queue. https://github.com/oven-sh/bun/issues/33911
test(
  "terminating a worker with in-flight fetch() does not touch the freed VM",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        // Local server that accepts connections and never responds, so the
        // worker's fetches are still in flight when the worker is terminated.
        const pending = [];
        let onOpen = null;
        const server = Bun.listen({
          hostname: "127.0.0.1",
          port: 0,
          socket: {
            open(socket) { pending.push(socket); if (onOpen) { onOpen(); onOpen = null; } },
            data() {},
            close() {},
          },
        });

        const workerCode =
          'self.addEventListener("message", e => {' +
          '  for (let i = 0; i < 3; i++) fetch("http://127.0.0.1:" + e.data + "/").catch(() => {});' +
          '  self.postMessage("fired");' +
          '});';

        for (let i = 0; i < 10; i++) {
          const worker = new Worker("data:text/javascript," + encodeURIComponent(workerCode));
          const opened = new Promise(r => { onOpen = r; });
          await new Promise(r => worker.addEventListener("open", r, { once: true }));
          worker.postMessage(server.port);
          await new Promise(r => worker.addEventListener("message", r, { once: true }));
          await opened; // the HTTP thread has connected to our server
          await worker.terminate(); // worker VM torn down with the fetches in flight
          // The VM is freed slightly after terminate() resolves (the close
          // event is dispatched before the worker thread's final teardown
          // step); there is no JS-observable signal for that, so give the
          // worker thread a moment before forcing the failure callbacks.
          await Bun.sleep(100);
          // RST every held connection: the HTTP thread now fails the fetches
          // and delivers the results to the (previously freed) worker VM.
          for (const s of pending.splice(0)) s.terminate();
          await Bun.sleep(100);
        }
        server.stop(true);
        console.log("done");
        process.exit(0);
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, exitCode }).toEqual({ stdout: "done\n", exitCode: 0 });
  },
  timeout,
);
