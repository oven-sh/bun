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

// Regression: a Bun.serve() listen socket in a worker was never closed when
// the worker exited. WebWorker::shutdown()'s close_all_socket_groups() skips
// listen sockets (the owner holds a raw *mut us_listen_socket_t), and nothing
// else called stop() on the server, so the fd survived on a destroyed epoll
// instance: the port stayed bound process-wide and new clients were accepted
// by the kernel into a backlog no thread serviced. Covers all three shutdown
// entry points (terminate(), worker process.exit(), unref'd natural exit).
test(
  "a worker's Bun.serve() listen socket is closed when the worker exits",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { connect } = require("net");
        const mk = body => "data:text/javascript," + encodeURIComponent(body);
        const serve = "const s = Bun.serve({ port: 0, fetch: () => new Response('W') });";

        // After the worker's "close" event the port must be free: a raw TCP
        // connect is the observable signal (ECONNREFUSED vs. ACCEPTED into a
        // kernel backlog nothing accept()s).
        const probe = port =>
          new Promise(res => {
            const s = connect(port, "127.0.0.1");
            s.once("connect", () => { s.destroy(); res("ACCEPTED"); });
            s.once("error", e => res(e.code));
          });

        async function cycle(body, terminate) {
          const w = new Worker(mk(body));
          const port = await new Promise(r =>
            w.addEventListener("message", e => r(e.data), { once: true }),
          );
          const closed = new Promise(r => w.addEventListener("close", r, { once: true }));
          if (terminate) w.terminate();
          await closed;
          return probe(port);
        }

        // One warm-up cycle so lazily-created per-process fds (event-loop
        // timers, DNS, net module) don't count against the leak delta below.
        await cycle(serve + "postMessage(s.port);", true);

        const fdCount = ${isLinux}
          ? () => require("fs").readdirSync("/proc/self/fd").length
          : () => 0;
        const before = fdCount();

        const out = {};
        out.terminate = await cycle(serve + "postMessage(s.port);", true);
        out.processExit = await cycle(
          serve + "postMessage(s.port); setTimeout(() => process.exit(0), 20);",
          false,
        );
        out.unrefNatural = await cycle(serve + "s.unref(); postMessage(s.port);", false);
        // Two more terminate cycles so the fd delta is meaningful.
        for (let i = 0; i < 2; i++) await cycle(serve + "postMessage(s.port);", true);

        out.fdDelta = fdCount() - before;
        console.log(JSON.stringify(out));
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const out = JSON.parse(stdout.trim());
    expect({
      terminate: out.terminate,
      processExit: out.processExit,
      unrefNatural: out.unrefNatural,
    }).toEqual({
      terminate: "ECONNREFUSED",
      processExit: "ECONNREFUSED",
      unrefNatural: "ECONNREFUSED",
    });
    if (isLinux) {
      // Unfixed: one listen fd per cycle (>= 5). Allow 1 for incidental fds.
      expect(out.fdDelta).toBeLessThanOrEqual(1);
    }
    expect(exitCode).toBe(0);
  },
  timeout,
);
