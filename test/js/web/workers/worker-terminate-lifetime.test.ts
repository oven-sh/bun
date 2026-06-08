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

// Regression: worker shutdown tore down the JSC VM (freeing its HandleSet)
// before dropping the per-VM RareData/RuntimeState, so the SQL contexts'
// Strong handles — populated at module load by internal/sql/{postgres,mysql}'s
// top-level init — and the default S3 client Strong were released against
// freed memory (segfault in Bun__StrongRef__delete →
// JSC::HandleSet::deallocate → WTF::SentinelLinkedList::remove during
// WebWorker::shutdown).
//
// Malloc=1 makes WebKit's fastMalloc use the system allocator (bmalloc
// DebugHeap) so ASAN builds poison the freed HandleSet/HandleBlock memory
// and report the use-after-free deterministically; with libpas the freed
// pages stay mapped and the bug only crashes when the pool reuses them.
test("worker that loaded Bun.SQL and Bun.s3 exits without touching freed JSC handles", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        // Touching Bun.SQL requires the bun:sql internal module, whose
        // top-level init() stores Strong refs in the worker's per-VM SQL
        // contexts; touching Bun.s3 caches the default S3 client in a
        // RareData Strong. The worker then drains and exits naturally,
        // running the full shutdown sequence.
        const w = new Worker("data:text/javascript," + encodeURIComponent("Bun.SQL; Bun.s3; postMessage('loaded');"));
        const loaded = new Promise((resolve, reject) => {
          w.onmessage = resolve;
          w.onerror = reject;
        });
        const closed = new Promise(r => w.addEventListener("close", r, { once: true }));
        await loaded;
        await closed;
        console.log("worker closed");
      `,
    ],
    env: { ...bunEnv, Malloc: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("worker closed\n");
  expect(exitCode).toBe(0);
});

// Terminating a worker with an in-flight dns.resolve* query tears down the
// per-VM c-ares channel during shutdown: the EDESTRUCTION callbacks must drop
// their promise Strongs against a live JSC heap, and the resolver's timeout
// timer must be unlinked from the per-thread timer heap before its memory
// frees (WTFTimer::update still walks that heap during teardown).
test("worker terminated with an in-flight DNS query shuts down cleanly", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const code = \`
          const dns = require("node:dns");
          dns.setServers(["192.0.2.1"]); // TEST-NET blackhole: the query stays in flight
          dns.promises.resolve4("inflight.example").catch(() => {});
          postMessage("inflight");
          setInterval(() => {}, 1000); // keep the worker alive until terminate()
        \`;
        const w = new Worker("data:text/javascript," + encodeURIComponent(code));
        await new Promise((res, rej) => { w.onmessage = res; w.onerror = rej; });
        await w.terminate();
        console.log("terminated ok");
      `,
    ],
    env: { ...bunEnv, Malloc: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("terminated ok\n");
  expect(exitCode).toBe(0);
});

// Main-thread variant of the same teardown ordering: with
// BUN_DESTRUCT_VM_ON_EXIT=1 (set by ASAN CI lanes), global_exit derefs the
// JSC VM in Zig__GlobalObject__destructOnExit before destroy() drops
// RuntimeState, hitting the identical freed-HandleSet release.
test("main thread that loaded Bun.SQL and Bun.s3 destructs on exit without touching freed JSC handles", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `Bun.SQL; Bun.s3; console.log("loaded");`],
    env: { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", Malloc: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("loaded\n");
  expect(exitCode).toBe(0);
});

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
