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

// Regression: a fetch() in flight on the shared HTTP thread held a raw
// pointer to the worker's VirtualMachine; worker.terminate() freed the VM
// while response callbacks could still read it and push into its embedded
// concurrent-task queue (heap-use-after-free / segfault at address 0x0 in
// UnboundedQueue::push_batch on the HTTP Client thread).
test(
  "terminating a worker with fetches in flight does not UAF the worker VM",
  async () => {
    // The server lives in the test process: the LeakSanitizer-validated child
    // would otherwise report Bun.serve's intentional exit leaks.
    using server = Bun.serve({
      port: 0,
      fetch() {
        // Drip the body forever so responses are always mid-flight when
        // the worker is terminated.
        return new Response(
          new ReadableStream({
            async pull(controller) {
              controller.enqueue(new Uint8Array(1024));
              await Bun.sleep(1);
            },
          }),
        );
      },
    });
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const workerSource =
          "for (let i = 0; i < 16; i++) " +
          "fetch(" + JSON.stringify(process.env.DRIP_SERVER_URL) + ").then(r => r.text().catch(() => {}), () => {});" +
          "postMessage('fetching');";
        const url = "data:text/javascript," + encodeURIComponent(workerSource);
        for (let i = 0; i < ${perRound}; i++) {
          const w = new Worker(url);
          await new Promise(resolve => (w.onmessage = resolve));
          // Vary the delay to scan the terminate-vs-response race window.
          await Bun.sleep(i % 4);
          w.terminate();
        }
        console.log("done");
      `,
      ],
      env: { ...bunEnv, DRIP_SERVER_URL: server.url.href },
      stdout: "pipe",
      stderr: "pipe",
    });

    // stderr is drained but not asserted: ASAN/debug builds emit benign noise.
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) console.error("child stderr:\n" + stderr);
    expect(stdout).toBe("done\n");
    expect(exitCode).toBe(0);
  },
  timeout,
);

// Same bug class as the fetch test above, for work-pool producers: async fs,
// Bun.password, zlib, and DNS completions on pool threads enqueued into the
// worker VM's concurrent-task queue after terminate() freed it. One test per
// producer, run sequentially: combining job types multiplies pool load and
// trips a separate, pre-existing JSC worker-churn crash unrelated to this
// bug class.
const workPoolJobs: [name: string, source: string][] = [
  ["Bun.password", "Bun.password.hash('hunter2', { algorithm: 'bcrypt', cost: 8 }).then(swallow, swallow);"],
  ["node:zlib", "require('node:zlib').gzip(Buffer.alloc(1 << 16, 7), swallow);"],
  ["node:fs", "require('node:fs/promises').stat(process.execPath).then(swallow, swallow);"],
  ["node:dns", "require('node:dns').promises.lookup('localhost').then(swallow, swallow);"],
  ["node:crypto", "require('node:crypto').pbkdf2('pw', 'salt', 25000, 64, 'sha512', swallow);"],
  [
    "node:fs readFile/writeFile/copyFile",
    "const fsp = require('node:fs/promises'); const f = process.env.FS_SCRATCH; " +
      "fsp.readFile(f + '/big').then(swallow, swallow); " +
      "fsp.writeFile(f + '/w', Buffer.alloc(1 << 20, 1)).then(swallow, swallow); " +
      "fsp.copyFile(f + '/big', f + '/c').then(swallow, swallow);",
  ],
];
for (const [name, job] of workPoolJobs) {
  test(
    `terminating a worker with ${name} jobs in flight does not UAF the worker VM`,
    async () => {
      using scratch = tempDir("worker-terminate-fs", {
        big: Buffer.alloc(4 << 20, 0x5a).toString("binary"),
      });
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          const workerSource =
            "const swallow = () => {};" +
            "for (let i = 0; i < 8; i++) { " + ${JSON.stringify(job)} + " }" +
            "postMessage('working');";
          const url = "data:text/javascript," + encodeURIComponent(workerSource);
          for (let i = 0; i < ${perRound}; i++) {
            const w = new Worker(url);
            await new Promise(resolve => (w.onmessage = resolve));
            await Bun.sleep(i % 4);
            w.terminate();
          }
          console.log("done");
          process.exit(0);
        `,
        ],
        env: { ...bunEnv, FS_SCRATCH: String(scratch) },
        stdout: "pipe",
        stderr: "pipe",
      });

      // stderr is drained but not asserted: ASAN/debug builds emit benign noise.
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      if (exitCode !== 0) console.error("child stderr:\n" + stderr);
      expect(stdout).toBe("done\n");
      expect(exitCode).toBe(0);
    },
    timeout,
  );
}

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
