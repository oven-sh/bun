import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux } from "harness";
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

// Regression: NewServer::finalize() never closed its listen socket. Worker
// shutdown's close_all_socket_groups() deliberately skips listen sockets on
// the assumption the owner closes them in finalize (Bun.listen's Listener
// does), so a Bun.serve() server in a terminated worker leaked its listen fd
// and the port stayed bound for the life of the process. All three exit modes
// below converge on WebWorker::shutdown() -> lastChanceToFinalize().
test.each([
  ["parent terminate()", "", true],
  ["worker process.exit()", " setImmediate(() => process.exit(0));", false],
  ["worker unref() + drain", " s.unref();", false],
])(
  "Bun.serve() in a worker releases the listening port on %s",
  async (_name, tail, parentTerminates) => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const serveWorker =
          "const s = Bun.serve({ port: 0, fetch: () => new Response('ok') });" +
          "postMessage(s.port);" + ${JSON.stringify(tail)};

        async function cycle() {
          const w = new Worker("data:text/javascript," + encodeURIComponent(serveWorker));
          const port = await new Promise(r => w.addEventListener("message", e => r(e.data), { once: true }));
          const closed = new Promise(r => w.addEventListener("close", r, { once: true }));
          ${parentTerminates ? "w.terminate();" : ""}
          await closed;
          // Worker has fully exited; its listen socket must be gone. Rebind
          // fails with EADDRINUSE if the old listener is still alive.
          const s = Bun.serve({ port, reusePort: false, fetch: () => new Response("x") });
          s.stop(true);
          return port;
        }

        // One warm-up cycle so lazily-created per-process fds (DNS, event loop
        // timers, module cache) do not count against the leak delta below.
        await cycle();

        const fdCount = ${isLinux}
          ? () => require("fs").readdirSync("/proc/self/fd").length
          : () => 0;
        const before = fdCount();

        const ports = [];
        for (let i = 0; i < 5; i++) ports.push(await cycle());

        // The 'close' event fires from WebWorker__dispatchExit (shutdown step
        // 4); the detached worker thread then still runs step 5 (vm.destroy +
        // on_thread_exit) which closes the per-worker epoll/eventfd. Poll the
        // fd count with a bounded deadline so the last cycle's worker has
        // reached that point instead of relying on gc() as an implicit sleep.
        let fdDelta = fdCount() - before;
        for (let i = 0; fdDelta > 1 && i < ${slow ? 500 : 100}; i++) {
          await Bun.sleep(10);
          fdDelta = fdCount() - before;
        }
        console.log(JSON.stringify({ ports: ports.length, fdDelta }));
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const { ports, fdDelta } = JSON.parse(stdout.trim());
    // Every cycle rebound its port: EADDRINUSE would have thrown before here.
    expect(ports).toBe(5);
    if (isLinux) {
      // Unfixed: one listen fd per cycle (>= 5).
      expect(fdDelta).toBeLessThanOrEqual(1);
    }
    expect(exitCode).toBe(0);
  },
  timeout,
);
