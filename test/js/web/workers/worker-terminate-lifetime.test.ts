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

// Regression: these properties are lazily built by JSC's reifyStaticProperty,
// which performs no exception check. A terminate() that landed while a builder
// was entering JS left a TerminationException pending (tryClearException()
// cannot clear one), so the builder either tripped the caller's
// `EXCEPTION_ASSERT(!scope.exception() || !hasSlot)` or handed the empty
// JSValue to putDirect (a null JSCell deref).
//
// Each worker blocks in Bun.sleepSync so terminate() is requested while the
// thread sits in native code with no JS safepoint ahead of the property read;
// the builder then runs with the termination trap armed. A blocking call is
// the point of the test, not a wait for a condition.
//
// One entry per builder shape: a process.* TopExceptionScope builder, a JS
// property get, an internal-module require, a JSC::call, and a Rust-backed
// getter behind the shared wrapper macro.
const lazyProperties = [
  "process.nextTick",
  "process.mainModule",
  "process.stdin",
  "Bun.$",
  "Bun.sql",
  "Bun.SQL",
  "Bun.argv",
];
const blockMs = slow ? 600 : 200;

test(
  "terminate() while a lazy property builder is entering JS does not abort",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const properties = ${JSON.stringify(lazyProperties)};
        await Promise.all(
          properties.map(property => {
            const w = new Worker(
              "data:text/javascript," +
                encodeURIComponent(
                  'postMessage("go");' +
                    // Blocks the worker thread in native code; terminate() arms the
                    // termination trap while we are parked here.
                    "Bun.sleepSync(${blockMs});" +
                    // First touch of the lazy property: its builder enters JS and is
                    // terminated mid-call.
                    property + ";",
                ),
            );
            const closed = new Promise(resolve => w.addEventListener("close", resolve, { once: true }));
            w.addEventListener("message", () => w.terminate(), { once: true });
            return closed;
          }),
        );
        console.log("terminated " + properties.length);
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: `terminated ${lazyProperties.length}\n`,
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
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
