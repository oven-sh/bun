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

// UAF: a TranspilerJob for a worker's dynamic import() runs on the shared work
// pool and reads the worker's VirtualMachine allocation throughout; terminate()
// freed that allocation mid-transpile. VM teardown now joins in-flight
// transpiler jobs first. Only ASAN reliably turns the stale reads into a crash.
// https://github.com/oven-sh/bun/issues/33936
test.skipIf(!isASAN)(
  "terminate() racing an in-flight dynamic import transpile does not UAF",
  async () => {
    // Big enough that the pool-thread transpile (seconds under ASAN) vastly
    // outlasts the terminated worker's teardown (tens of milliseconds).
    const big = Array.from(
      { length: 4000 },
      (_, i) => `export function f${i}(a,b){ const x = a?.b ?? (b ||= ${i}); return x + ${i}; }`,
    ).join("\n");
    using dir = tempDir("worker-terminate-transpile", {
      "big.ts": big,
      // "started" is posted after import() has scheduled the transpile on the
      // work pool, so the parent's terminate() lands while it is in flight.
      "racer-worker.js": `
        import("./big.ts").then(() => postMessage("done")).catch(() => {});
        postMessage("started");
      `,
      // Untouched worker transpiling the same module; its completion keeps the
      // process alive for the whole window in which the racer's orphaned
      // pool-thread job reads the freed VM on broken builds.
      "ref-worker.js": `
        import("./big.ts?ref").then(() => postMessage("done")).catch(() => {});
      `,
      "main.js": `
        const racer = new Worker(new URL("./racer-worker.js", import.meta.url).href);
        const terminated = new Promise(resolve => {
          racer.onmessage = e => { if (e.data === "started") { racer.terminate(); resolve(); } };
        });
        const ref = new Worker(new URL("./ref-worker.js", import.meta.url).href);
        const refDone = new Promise(resolve => {
          ref.onmessage = e => { if (e.data === "done") resolve(); };
        });
        await terminated;
        await refDone;
        ref.terminate();
        console.log("ok");
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
    expect({ stdout, exitCode, stderr: stderr.includes("AddressSanitizer") ? stderr : "" }).toEqual({
      stdout: "ok\n",
      exitCode: 0,
      stderr: "",
    });
  },
  timeout,
);
