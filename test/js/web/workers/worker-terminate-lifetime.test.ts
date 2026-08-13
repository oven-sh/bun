import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir, tls } from "harness";
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
            // lands. node:dns.lookup() uses the getaddrinfo backend, so opt
            // into c-ares explicitly to put an ares_getaddrinfo request in
            // flight alongside resolve4's ares_query.
            'const dgram = require("dgram");' +
            'const dns = require("dns");' +
            'const s = dgram.createSocket("udp4");' +
            's.bind(0, "127.0.0.1", () => {' +
            '  dns.setServers(["127.0.0.1:" + s.address().port]);' +
            '  Bun.dns.lookup("example.org", { backend: "c-ares" }).catch(() => {});' +
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

// Regression: Bun.serve() inside a worker, streaming a JS ReadableStream body,
// then worker.terminate() mid-stream. Worker shutdown stops the server which
// tears down the in-flight HTTP(S)ResponseSink and fires its JS onClose hook
// via AsyncContextFrame::call while the VM's sticky TerminationException is
// still pending, tripping Interpreter::executeCallImpl's
// scope.assertNoException() and SIGABRTing the whole process. Release WebKit
// compiles that ASSERT out, so this is debug/ASAN only. Two cells cover
// HTTPResponseSink and HTTPSResponseSink; the type:"direct" shape hits a
// separate pre-existing VMTraps::deferTerminationSlow assert and is tracked
// separately.
describe.skipIf(!isDebug)(
  "terminate() while Bun.serve is streaming a ReadableStream body does not trip assertNoException()",
  () => {
    async function runCell(
      workerBody: string,
      scheme: "http" | "https",
      fetchOpts: string,
      workerData?: Record<string, string>,
    ) {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          const { Worker } = require("node:worker_threads");
          const workerData = ${JSON.stringify(workerData ?? {})};
          const src = ${JSON.stringify(workerBody)};
          for (let i = 0; i < ${rounds}; i++) {
            const w = new Worker(src, { eval: true, workerData });
            const port = await new Promise(r => w.once("message", r));
            const res = await fetch("${scheme}://127.0.0.1:" + port + "/", ${fetchOpts});
            const rd = res.body.getReader();
            await rd.read();
            const done = new Promise(r => w.once("exit", r));
            w.terminate();
            await done;
            await rd.cancel().catch(() => {});
          }
          console.log("survived");
        `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toBe("survived\n");
      expect(exitCode).toBe(0);
    }

    const pullBody =
      "let i = 0;" +
      "return new Response(new ReadableStream({ async pull(c) {" +
      "  c.enqueue(new Uint8Array(8192).fill(i++));" +
      "  if (i > 20000) c.close();" +
      "  await Bun.sleep(0);" +
      "} }));";
    const httpWorker =
      "const server = Bun.serve({ port: 0, fetch() {" +
      pullBody +
      "} });" +
      "require('node:worker_threads').parentPort.postMessage(server.port);";
    const httpsWorker =
      "const { workerData } = require('node:worker_threads');" +
      "const server = Bun.serve({ port: 0, tls: { cert: workerData.cert, key: workerData.key }, fetch() {" +
      pullBody +
      "} });" +
      "require('node:worker_threads').parentPort.postMessage(server.port);";

    test.concurrent("http (HTTPResponseSink)", () => runCell(httpWorker, "http", "{}"), timeout);
    test.concurrent(
      "https (HTTPSResponseSink)",
      () =>
        runCell(httpsWorker, "https", "{ tls: { rejectUnauthorized: false } }", {
          cert: tls.cert,
          key: tls.key,
        }),
      timeout,
    );
  },
);

// Regression: NewSocket::on_open was the only socket dispatch missing the
// shutdown guard. It resolves the Bun.connect() promise (entering JS, where
// the worker's termination trap fires and leaves the TerminationException
// pending) and then calls the JS `open` handler, which trips
// Interpreter::executeCallImpl's scope.assertNoException() and SIGABRTs the
// whole process. Hits from Bun.connect, net.connect, and tls.connect alike
// (they share on_open). Release WebKit compiles that ASSERT out, so this is
// debug-only; the exception-scope verifier makes it fire on the first hit.
test.skipIf(!isDebug)(
  "terminate() while a worker's Bun.connect() open is firing does not trip assertNoException()",
  async () => {
    // Each round keeps LANES loopback connects in flight per worker and
    // terminates once the worker reports steady state, so terminate() lands
    // while on_open is hot. Debug+ASAN makes each round ~5s, so the pass
    // time is ~60s; the unpatched build aborts in the first few rounds.
    const ROUNDS = 12;
    const WORKERS = 4;
    const LANES = 32;
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { Worker } = require("node:worker_threads");
        const net = require("node:net");
        const srv = net.createServer((c) => { c.on("error", () => {}); c.end(); });
        await new Promise((r) => srv.listen(0, "127.0.0.1", r));
        const port = srv.address().port;
        const src =
          "const { parentPort, workerData: d } = require('node:worker_threads');" +
          "let opens = 0;" +
          "function lane() {" +
          "  Bun.connect({ hostname: '127.0.0.1', port: d.port, socket: {" +
          "    open(s) { if (++opens === ${LANES}) parentPort.postMessage('hot'); s.end(); }," +
          "    data() {}, close() { setImmediate(lane); }," +
          "    connectError() { setImmediate(lane); }, error() {} } })" +
          "    .catch(() => setImmediate(lane));" +
          "}" +
          "for (let i = 0; i < ${LANES}; i++) lane();";
        function ready(w) {
          return new Promise((res, rej) => {
            w.once("message", res);
            w.once("error", rej);
            w.once("exit", (c) => rej(new Error("worker exited " + c + " before ready")));
          });
        }
        for (let r = 0; r < ${ROUNDS}; r++) {
          const ws = [];
          for (let i = 0; i < ${WORKERS}; i++) {
            const w = new Worker(src, { eval: true, workerData: { port } });
            ws.push(w);
          }
          await Promise.all(ws.map(ready));
          for (const w of ws) w.on("error", () => {});
          await Bun.sleep(r % 3);
          await Promise.all(ws.map((w) => w.terminate()));
        }
        srv.close();
        console.log("PASS");
      `,
      ],
      env: { ...bunEnv, BUN_JSC_validateExceptionChecks: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("PASS\n");
    expect(exitCode).toBe(0);
  },
  120_000,
);

// Regression: terminate() during a synchronous require() of a deep CJS graph.
// finishRequireWithError (and JSCommonJSModule::load's error branch) did
// tryClearException() then requireMap()->remove() with the sticky
// TerminationException still pending, so JSMap::remove bailed and
// ASSERT(wasRemoved) SIGABRTed the process. Release builds compile the assert
// out and leave the throwing module cached for a dying VM, so debug-only.
test.skipIf(!isDebug)(
  "terminate() while a worker is inside require() does not trip ASSERT(wasRemoved)",
  async () => {
    // Build the CJS graph in the outer test so cleanup is guaranteed even when
    // the subprocess SIGABRTs (the fail-before behavior) or is SIGKILLed by
    // the outer timeout; process.on('exit') inside the subprocess would not
    // run on either path.
    const N = 200;
    const files: Record<string, string> = {
      "w.mjs":
        `postMessage('ready');\n` +
        `while (true) {\n` +
        `  for (const k of Object.keys(require.cache)) delete require.cache[k];\n` +
        `  require('./c0.cjs');\n` +
        `}\n`,
    };
    for (let i = 0; i < N; i++) {
      const a = (i + 1) % N;
      const b = (i * 13 + 5) % N;
      files[`c${i}.cjs`] = `require('./c${a}.cjs');\nrequire('./c${b}.cjs');\nexports.id = ${i};\n`;
    }
    using dir = tempDir("cjsreq", files);

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        // Three lanes, each terminates its worker at a sweep of offsets so at
        // least one lands mid-require. The worker spends ~all its time inside
        // require(), so the unpatched build aborts within the first few
        // iterations.
        async function lane(offset) {
          for (let i = 0; i < 25; i++) {
            const w = new Worker("./w.mjs");
            await new Promise((res, rej) => {
              w.onmessage = () => res();
              w.onerror = (e) => rej(e.error ?? e);
            });
            w.onerror = () => {};
            await Bun.sleep(offset + (i % 10) * 5);
            await w.terminate();
          }
        }
        await Promise.all([lane(0), lane(20), lane(60)]);
        console.log("PASS");
      `,
      ],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("PASS\n");
    expect(exitCode).toBe(0);
  },
  120_000,
);

// Regression: Bun__handleUncaughtException probed process._fatalException (a
// JS get(), where the worker's termination trap fires) and then called
// wrapped.emit("uncaughtException") with the sticky TerminationException
// still pending after tryClearException(), tripping
// Interpreter::executeCallImpl's scope.assertNoException(). The sibling
// rejectionHandled / unhandledRejection emit paths share the guard.
test.skipIf(!isDebug)(
  "terminate() while a worker is emitting process 'uncaughtException' does not trip assertNoException()",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { Worker } = require("node:worker_threads");
        const src =
          "const { parentPort } = require('node:worker_threads');" +
          "let first = true;" +
          "process.on('uncaughtException', () => { if (first) { first = false; parentPort.postMessage('hot'); } });" +
          "setInterval(() => { for (let i = 0; i < 50; i++) setTimeout(() => { throw new Error('e'); }, 0); }, 1);";
        function ready(w) {
          return new Promise((res, rej) => {
            w.once("message", res);
            w.once("error", rej);
            w.once("exit", (c) => rej(new Error("worker exited " + c + " before ready")));
          });
        }
        for (let r = 0; r < 15; r++) {
          const ws = [];
          for (let i = 0; i < 6; i++) {
            const w = new Worker(src, { eval: true });
            ws.push(w);
          }
          await Promise.all(ws.map(ready));
          for (const w of ws) w.on("error", () => {});
          await Bun.sleep((r * 37) % 250);
          await Promise.all(ws.map((w) => w.terminate()));
        }
        console.log("PASS");
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("PASS\n");
    expect(exitCode).toBe(0);
  },
  120_000,
);

// Regression: terminating a worker with in-flight fs.readFile calls whose
// result is zero bytes (empty file, or a FIFO/pipe hitting EOF) wild-freed the
// dangling empty-buffer pointer when the dead VM refused the completed
// thread-pool job: MarkedArrayBuffer::from_bytes claimed ownership of an empty
// Box<[u8]> (no backing allocation), and dropping the undelivered result
// called free(0x1). ASAN catches it as a SEGV in the allocator on the pool or
// worker thread.
test(
  "terminate with in-flight zero-length fs.readFile results does not wild-free",
  async () => {
    const cellRounds = slow ? 4 : 10;
    using dir = tempDir("worker-terminate-empty-readfile", {
      "empty.txt": "",
      "main.cjs": `
        const { Worker, isMainThread, parentPort } = require("node:worker_threads");
        const fs = require("node:fs");
        const path = require("node:path");
        const empty = path.join(__dirname, "empty.txt");
        if (isMainThread) {
          let n = 0;
          const again = () => {
            const w = new Worker(__filename);
            w.on("message", () =>
              w.terminate().then(() => {
                if (++n < ${cellRounds}) again();
                else {
                  console.log("survived", n);
                  process.exit(0);
                }
              }),
            );
          };
          again();
        } else {
          // 64 concurrent chains of zero-byte reads; signal once completions
          // are churning so terminate() lands with results still in flight.
          let signaled = false;
          const go = () =>
            fs.readFile(empty, () => {
              if (!signaled) {
                signaled = true;
                parentPort.postMessage("busy");
              }
              go();
            });
          for (let i = 0; i < 64; i++) go();
        }
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: `survived ${cellRounds}`,
      stderr: "",
      exitCode: 0,
    });
  },
  timeout,
);
