import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "path";

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

// https://github.com/oven-sh/bun/issues/29173
// JSC's Atomics.wait loop only exits on vm.hasTerminationRequest(), which
// Bun never set before firing the NeedTermination trap that wakes the waiter.
test(
  "terminate() interrupts a worker blocked in Atomics.wait",
  async () => {
    using dir = tempDir("worker-terminate-atomics-wait", {
      "worker.js": `
      self.onmessage = ({ data: sab }) => {
        const ia = new Int32Array(sab);
        postMessage("waiting");
        // Re-enter the futex forever; terminate() must interrupt this.
        for (;;) Atomics.wait(ia, 0, 0);
      };
    `,
      "main.js": `
      const sab = new SharedArrayBuffer(16);
      const ia = new Int32Array(sab);
      const w = new Worker(new URL("./worker.js", import.meta.url).href);
      w.addEventListener("close", () => {
        console.log("CLOSED");
        process.exit(0);
      });
      w.onmessage = ({ data }) => {
        if (data !== "waiting") return;
        // Atomics.notify returns how many waiters it woke; spinning until it
        // returns 1 proves the worker thread is parked inside Atomics.wait.
        while (Atomics.notify(ia, 0, 1) === 0) {}
        // The worker's for(;;) re-enters the futex within microseconds; this
        // bounded wait guarantees terminate() lands while it is parked again.
        Atomics.wait(ia, 1, 0, 100);
        w.terminate();
      };
      w.postMessage(sab);
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
    expect(stderr).toBe("");
    expect(stdout).toBe("CLOSED\n");
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

// Regression: the per-VM c-ares channel was destroyed in deinit_runtime_state
// (RuntimeState drop) AFTER JSC teardown and RareData.file_polls drop.
// ares_destroy() synchronously fires EDESTRUCTION query callbacks and socket-
// state callbacks, which then dereferenced the freed JSGlobalObject and the
// freed FilePoll hive. ASAN-only: release builds read freed memory without
// crashing. Upstream Node test-worker-dns-terminate.js.
test.skipIf(!isASAN)(
  "terminate() while dns.lookup() is in flight does not UAF on c-ares channel teardown",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { Worker } = require("worker_threads");
        let done = 0;
        for (let i = 0; i < 4; i++) {
          const w = new Worker(
            // Hermetic: point the global resolver's c-ares channel at a local
            // UDP socket that never replies, so both queries are guaranteed
            // in-flight (socket registered, no completion) when terminate()
            // lands. dns.lookup() only respects setServers() where the c-ares
            // backend is the default (Linux); elsewhere resolve4 alone still
            // covers the socket-state and EDESTRUCTION paths hermetically.
            'const dgram = require("dgram");' +
            'const dns = require("dns");' +
            'const s = dgram.createSocket("udp4");' +
            's.bind(0, "127.0.0.1", () => {' +
            '  dns.setServers(["127.0.0.1:" + s.address().port]);' +
            '  if (process.platform === "linux") dns.lookup("example.org", () => {});' +
            '  dns.resolve4("example.org", () => {});' +
            '  require("worker_threads").parentPort.postMessage(0);' +
            '});',
            { eval: true },
          );
          w.on("message", () => w.terminate().then(() => {
            if (++done === 4) console.log("ok");
          }));
        }
      `,
      ],
      env: {
        ...bunEnv,
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
        LSAN_OPTIONS: `print_suppressions=0:suppressions=${join(import.meta.dirname, "../../../leaksan.supp")}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "ok\n", stderr: "", exitCode: 0 });
  },
  timeout,
);
