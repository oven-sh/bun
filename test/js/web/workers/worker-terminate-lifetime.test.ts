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

// Coverage for the `live_workers` intrusive list (`web_worker.rs`): the list
// head is an `AtomicPtrCell<WebWorker>` that every worker spawn/exit
// links/unlinks under `live_workers::MUTEX`, and `terminate_all_and_wait()`
// (run from `global_exit` under `BUN_DESTRUCT_VM_ON_EXIT=1`) walks it on the
// main thread while worker threads are still registering/unregistering. Spawn a burst of long-lived
// workers, then `process.exit()` mid-burst so the sweep sees a populated
// list under contention. A broken head pointer would corrupt the intrusive
// links and the sweep would deref garbage (ASAN / null-deref crash).
test(
  "process.exit with many live workers terminates cleanly via live_workers sweep",
  async () => {
    const n = slow ? 16 : 48;
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        // Workers that never exit on their own, so all ${n} are still
        // registered in the live_workers list when process.exit fires.
        const ws = [];
        for (let i = 0; i < ${n}; i++) {
          ws.push(new Worker("data:text/javascript,setInterval(() => {}, 1e9)"));
        }
        // Wait for every worker to reach its VM (so live_workers::register
        // has run for each) before exiting — otherwise the sweep might see
        // an empty list and this test proves nothing.
        await Promise.all(ws.map(w => new Promise(r => w.addEventListener("open", r, { once: true }))));
        console.log("all-open");
        process.exit(0);
      `,
      ],
      env: { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("all-open\n");
    expect(exitCode).toBe(0);
  },
  timeout,
);

// Coverage for concurrent `live_workers::register`/`unregister`: spawn and
// immediately drain many short-lived workers in parallel so the intrusive
// list head sees interleaved link/unlink from dozens of threads at once.
test(
  "concurrent worker spawn+exit churns the live_workers list without corruption",
  async () => {
    const n = slow ? 24 : 64;
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        // Empty body → each worker registers, drains, unregisters. Firing
        // them all at once maximises overlap on the list head.
        const ws = Array.from({ length: ${n} }, () => new Worker("data:text/javascript,"));
        await Promise.all(ws.map(w => new Promise(r => w.addEventListener("close", r, { once: true }))));
        console.log("done");
      `,
      ],
      env: bunEnv,
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
