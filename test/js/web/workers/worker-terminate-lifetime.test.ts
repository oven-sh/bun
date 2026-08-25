import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir, tls } from "harness";
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

// A worker's own Bun.serve() listener kept dispatching requests
// into the fetch handler for the rest of the loop tick after process.exit()
// had stopped the VM. Building the Request for a VM whose termination had
// already unwound script initialised JSRequestStructure under a pending
// TerminationException, tripping VMTraps::deferTerminationSlow's
// ASSERT(vm.hasTerminationRequest()). A stopped VM's server now answers 503
// natively, as it already did for node:http.
test.skipIf(!isDebug)(
  "process.exit() with requests arriving at the worker's own Bun.serve() does not build them for a stopped VM",
  async () => {
    const workers = slow ? 8 : 24;
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { Worker } = require("node:worker_threads");
        const src =
          "const s = Bun.serve({ port: 0, fetch: () => new Response('x') });" +
          "for (let i = 0; i < 8; i++) fetch(s.url).then(r => r.text()).catch(() => {});" +
          "setImmediate(() => process.exit(0));";
        let started = 0, exited = 0;
        function again() {
          if (started >= ${workers}) {
            if (exited === ${workers}) console.log("PASS");
            return;
          }
          started++;
          const w = new Worker(src, { eval: true });
          w.on("error", (e) => { console.error(e); process.exit(1); });
          w.on("exit", (code) => {
            if (code !== 0) { console.error("worker exited " + code); process.exit(1); }
            exited++;
            again();
          });
        }
        again();
        again();
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
  timeout,
);

// WebCore-style callbacks (PerformanceObserver, abort algorithms)
// were still invoked from the task queue after terminate() had stopped the
// worker's VM mid-tick, entering JS with the TerminationException a previous
// task left pending and tripping executeCallImpl's assertNoException(). They
// now refuse once script is forbidden, like event listeners already did.
test.skipIf(!isDebug)(
  "terminate() while PerformanceObserver deliveries are queued does not invoke the observer on a stopped VM",
  async () => {
    const workers = slow ? 24 : 60;
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const src =
          "const { PerformanceObserver, performance } = require('node:perf_hooks');" +
          "new PerformanceObserver(() => {}).observe({ entryTypes: ['mark', 'measure'] });" +
          "self.onmessage = () => { performance.mark('x'); performance.measure('mx', 'x'); };" +
          "for (let i = 0; i < 50; i++) { performance.mark('a' + i); performance.measure('m' + i, 'a' + i); }" +
          "postMessage('go');" +
          "Bun.sleepSync(20);";
        const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
        let started = 0, closed = 0;
        function again() {
          if (started >= ${workers}) {
            if (closed === ${workers}) console.log("PASS");
            return;
          }
          started++;
          const w = new Worker(url, { smol: true });
          for (let i = 0; i < 500; i++) {
            const ab = new ArrayBuffer(64);
            w.postMessage({ i, ab }, [ab]);
          }
          w.onmessage = () => w.terminate();
          w.onerror = () => {};
          w.addEventListener("close", () => { closed++; again(); });
        }
        again(); again(); again();
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
  timeout,
);

// A nested worker's parent that is itself being terminated still
// tried to settle the getHeapSnapshot()/getHeapStatistics() promises it had
// pending against its child when the child's exit was processed in the same
// tick, building the ERR_WORKER_NOT_RUNNING error under its own pending
// TerminationException — which yields no object — and rejecting with a null
// cell (UBSan null member call in debug, SEGV in JSCell::validateIsNotSweeping
// under ASAN). A stopped parent VM now settles nothing and just drops them.
test(
  "terminate() of a worker with cross-VM requests pending against its own child does not settle them on the stopped VM",
  async () => {
    const workers = slow ? 12 : 60;
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { Worker } = require("node:worker_threads");
        const inner = "setImmediate(() => process.exit(0)); require('node:worker_threads').parentPort.postMessage('x');";
        const middle =
          "const { Worker, parentPort } = require('node:worker_threads');" +
          "const w2 = new Worker(" + JSON.stringify(inner) + ", { eval: true });" +
          "w2.on('error', () => {});" +
          "w2.getHeapSnapshot().then(() => {}, () => {});" +
          "const iv = setInterval(() => { w2.getHeapSnapshot().then(() => {}, () => {}); w2.getHeapStatistics().then(() => {}, () => {}); }, 1);" +
          "w2.on('exit', () => clearInterval(iv));" +
          "w2.terminate(); w2.terminate();" +
          "parentPort.postMessage('up');";
        let started = 0, exited = 0;
        function again() {
          if (started >= ${workers}) {
            if (exited === ${workers}) console.log("PASS");
            return;
          }
          started++;
          const w1 = new Worker(middle, { eval: true });
          w1.on("online", () => w1.terminate());
          w1.on("error", () => {});
          w1.on("exit", () => { exited++; again(); });
        }
        again(); again();
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
  timeout,
);

// worker.terminate() landing while the worker was re-running its event loop for
// process.on('beforeExit') listeners (they scheduled more work) was never acted
// on: that inner drain only watched for the loop to go idle, and with the stop
// requested the in-flight work's completion is no longer delivered, so the
// worker slept in its loop forever and terminate() never settled.
test(
  "terminate() while the worker drains work scheduled by 'beforeExit' stops it",
  async () => {
    using server = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) });
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
      const { Worker } = require("node:worker_threads");
      const w = new Worker(
        "const { parentPort } = require('node:worker_threads');" +
        "process.on('beforeExit', () => { fetch(process.env.HANG_URL).catch(() => {}); parentPort.postMessage('draining'); });" +
        "process.on('exit', (c) => parentPort.postMessage('exit ' + c));",
        { eval: true },
      );
      w.on("message", async (m) => {
        if (m !== "draining") { console.log("unexpected", m); return; }
        const code = await w.terminate();
        console.log("terminated", code);
      });
      w.on("exit", (c) => console.log("exit", c));
    `,
      ],
      env: { ...bunEnv, HANG_URL: server.url.href },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim().split("\n").sort()).toEqual(["exit 1", "terminated 1"]);
    expect(exitCode).toBe(0);
  },
  timeout,
);

// Spawns workers that each start `connectExpr` in one immediate and call
// process.exit(0) in the next, so whatever that connect attempt left behind is
// still pending when the worker's VM tears down.
async function exitRightAfterConnecting(connectExpr: string) {
  const workers = slow ? 8 : 24;
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { Worker } = require("node:worker_threads");
      const src =
        "const { parentPort } = require('node:worker_threads');" +
        "Bun.file(process.execPath).slice(0, 100).json().catch(() => {});" +
        ${JSON.stringify(`setImmediate(() => ${connectExpr}.catch(() => {}));`)} +
        "parentPort.postMessage('up');" +
        "setImmediate(() => process.exit(0));";
      let started = 0, exited = 0;
      function again() {
        if (started >= ${workers}) {
          if (exited === ${workers}) console.log("PASS");
          return;
        }
        started++;
        const w = new Worker(src, { eval: true });
        w.on("error", (e) => { console.error(e); process.exit(1); });
        w.on("exit", () => { exited++; again(); });
      }
      again(); again();
    `,
    ],
    env: { ...bunEnv, UV_THREADPOOL_SIZE: "4" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("PASS\n");
  expect(exitCode).toBe(0);
}

// For a debug build: host code that runs after the worker's own process.exit()
// unwound script — here a redis connect started in the same immediate tick as
// the exit, whose ECONNREFUSED then lands in that loop tick — builds JS error
// objects, initialising lazy structures under the TerminationException Bun keeps
// pending. JSC had already reset its termination-request flag when the entry the
// exception unwound exited, so DeferTermination asserted `vm.hasTerminationRequest()`
// (and dropped the pending termination in release); Bun now keeps the flag set
// for as long as it keeps the exception.
test.skipIf(!isDebug)(
  "process.exit() with native error completions landing in the same tick does not trip DeferTermination",
  () =>
    exitRightAfterConnecting(
      "new Bun.RedisClient('redis://127.0.0.1:9', { connectionTimeout: 100, autoReconnect: false }).connect()",
    ),
  timeout,
);

// A TLS context that cannot be built fails the dial before there is a socket;
// the redis client then settles that from a task it queues on the event loop,
// holding a ref to itself and the loop. The exit in the next immediate tears
// the VM down with that task still queued, so it has to be released without
// running (a debug build asserts on the refcount if either ref is mishandled;
// the ASAN build reports the leak).
test.skipIf(!isDebug && !isASAN)(
  "process.exit() with a redis client's deferred close still queued releases it cleanly",
  () =>
    exitRightAfterConnecting(
      "new Bun.RedisClient('rediss://127.0.0.1:9', { tls: { key: 'x', cert: 'x' }, autoReconnect: false }).connect()",
    ),
  timeout,
);

// The same task, queued by a first command whose dial failed outright (a unix
// socket path nobody listens on), with the command itself still queued behind it.
test.skipIf((!isDebug && !isASAN) || isWindows)(
  "process.exit() with a redis client's deferred close and a queued command releases both cleanly",
  () => exitRightAfterConnecting("new Bun.RedisClient('redis+unix:///nonexistent/redis.sock').ping()"),
  timeout,
);

// The same deferred close on the main thread, left to run: it settles the
// connect and drops its refs, so nothing keeps the event loop alive and the
// process exits on its own.
test(
  "a redis client whose TLS context cannot be built does not keep the process alive",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        new Bun.RedisClient("rediss://127.0.0.1:1", { tls: { key: "x", cert: "x" }, autoReconnect: false })
          .connect()
          .catch(err => console.log("connect rejected", err.code));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "connect rejected ERR_REDIS_CONNECTION_CLOSED\n",
      stderr: "",
      exitCode: 0,
    });
  },
  timeout,
);

// worker.terminate() never stopped a worker parked in
// Atomics.wait() (sync-over-async worker pools park exactly there). JSC wakes
// the parked thread when termination is requested, but the wake-up predicate
// only looked at a flag the parked thread itself would have had to set, so it
// went back to sleep and terminate()'s promise never settled.
test(
  "terminate() stops a worker blocked in Atomics.wait()",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
      const { Worker } = require("node:worker_threads");
      const w = new Worker(
        "const { parentPort } = require('node:worker_threads');" +
        "const i32 = new Int32Array(new SharedArrayBuffer(4));" +
        "parentPort.postMessage('parking');" +
        "Atomics.wait(i32, 0, 0);" +
        "parentPort.postMessage('woke ' + Atomics.load(i32, 0));",
        { eval: true },
      );
      w.on("message", async (m) => {
        if (m !== "parking") { console.log("unexpected", m); process.exit(1); }
        // The case of interest is terminate() landing once the worker is parked, for which there
        // is no observable signal, so give it a moment; landing before it parks must pass too.
        await Bun.sleep(100);
        const code = await w.terminate();
        console.log("terminated", code);
      });
      w.on("exit", (c) => console.log("exit", c));
    `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim().split("\n").sort()).toEqual(["exit 1", "terminated 1"]);
    expect(exitCode).toBe(0);
  },
  timeout,
);

// crypto.generatePrime()/generatePrimeSync()/checkPrime() with `safe: true` (or awkward add/rem
// constraints) can grind for minutes. The worker's teardown waits for its pool job, and the sync
// form cannot observe the termination at all, so terminate() used to hang for as long as BoringSSL
// took. The generation's progress callback now gives up once the worker has been asked to stop.
test(
  "terminate() does not wait for a prime generation the worker no longer needs",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { Worker } = require("node:worker_threads");
        async function run(body) {
          const w = new Worker('require("node:worker_threads").parentPort.postMessage("go");' + body, { eval: true });
          w.on("error", (e) => { console.error(e); process.exit(1); });
          await new Promise((r) => w.once("message", r));
          await Bun.sleep(100);
          return await w.terminate();
        }
        (async () => {
          const t = performance.now();
          const codes = await Promise.all([
            run('for (;;) require("node:crypto").generatePrimeSync(2048, { safe: true });'),
            run('require("node:crypto").generatePrime(2048, { safe: true }, () => {}); setInterval(() => {}, 1000);'),
            run('require("node:crypto").checkPrime((1n << 4423n) - 1n, { checks: 200 }, () => {}); setInterval(() => {}, 1000);'),
          ]);
          console.log(codes.join(","), performance.now() - t < 20000 ? "promptly" : "after " + Math.round(performance.now() - t) + "ms");
        })();
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("1,1,1 promptly\n");
    expect(exitCode).toBe(0);
  },
  timeout,
);

// fs.readFile / readFileSync read until EOF, and a FIFO (or /dev/urandom) never reaches one. The
// native read loop checked only the caller's AbortSignal between chunks, never whether the worker
// had been asked to stop: the sync form never came back to JS for the termination to land, and the
// async form kept its pool job alive, which the worker's teardown waits for. terminate() hung for as
// long as the data flowed (node: ~5ms). The loop now gives up at the next chunk once the worker
// is stopping. Two data points per flavor: less than 256 KiB read so far (the pre-stat read), and
// more (the read-until-EOF tail, where the buffer grows).
describe.skipIf(isWindows)("terminate() stops a readFile of a FIFO that never ends", () => {
  test.concurrent.each([
    ["readFileSync", 192 * 1024],
    ["readFileSync", 512 * 1024],
    ["promises.readFile", 192 * 1024],
    ["promises.readFile", 512 * 1024],
  ])(
    "%s after %d bytes",
    async (api, fed) => {
      using dir = tempDir("worker-terminate-readfile-fifo", {});
      const fifo = join(String(dir), "fifo");
      const read =
        api === "readFileSync"
          ? `fs.readFileSync(fifo); parentPort.postMessage("returned");`
          : `fs.promises.readFile(fifo).then(() => parentPort.postMessage("resolved"), e => parentPort.postMessage("rejected " + e.code));`;
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
        const fs = require("node:fs");
        const { Worker } = require("node:worker_threads");
        const fifo = ${JSON.stringify(fifo)};
        require("node:child_process").execFileSync("mkfifo", [fifo]);
        // Both ends are held here, so the worker's open() does not block and its read() never sees
        // EOF. The writes go through a non-blocking end: this loop must stay free to run the
        // worker's 'exit' and the terminate() settlement whatever the worker does with the pipe.
        const hold = fs.openSync(fifo, "r+");
        const out = fs.openSync(fifo, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
        const write = (buf, off) => {
          try {
            return fs.writeSync(out, buf, off);
          } catch (e) {
            if (e.code !== "EAGAIN") throw e;
            return 0;
          }
        };
        const w = new Worker(
          'const fs = require("node:fs"); const { parentPort, workerData: fifo } = require("node:worker_threads");' +
          'parentPort.postMessage("reading"); ${read}',
          { eval: true, workerData: fifo },
        );
        w.on("error", e => { console.error("worker error:", e); process.exit(1); });
        w.on("exit", code => console.log("exit", code));
        w.on("message", async m => {
          console.log(m);
          if (m !== "reading") process.exit(1);
          // More bytes than the pipe holds only go through once the worker's read loop has drained
          // the rest, so from here on the worker is inside that loop, blocked in read().
          const chunk = Buffer.alloc(${fed}, 0x78);
          const deadline = Date.now() + ${timeout / 2};
          for (let off = 0; off < chunk.length; ) {
            const n = write(chunk, off);
            if (n === 0) {
              if (Date.now() > deadline) { console.log("the worker took only", off, "bytes"); process.exit(3); }
              await Bun.sleep(1);
            }
            off += n;
          }
          console.log("fed");
          // Keep the data flowing: the loop can only notice the stop when a read returns.
          const x = Buffer.from("x");
          const feed = setInterval(() => write(x, 0), 1);
          // A watchdog, not a wait: the unfixed build never settles terminate(), and the test is
          // more useful failing on this line than on its timeout.
          const code = await Promise.race([w.terminate(), Bun.sleep(${timeout / 2}).then(() => "hung")]);
          clearInterval(feed);
          console.log("terminated", code);
          // Both ends closed: a worker still in its read loop gets EOF, so the exit's VM teardown
          // (BUN_DESTRUCT_VM_ON_EXIT=1 joins it) does not wait on the FIFO.
          fs.closeSync(out);
          fs.closeSync(hold);
          process.exit(code === "hung" ? 2 : 0);
        });
      `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toBe("reading\nfed\nexit 1\nterminated 1\n");
      expect(exitCode).toBe(0);
    },
    timeout,
  );

  // A device never blocks, so the loop only sees the stop between two reads, and the tail's read
  // size used to double with the buffer (a 2 GiB read of /dev/urandom takes seconds). The tail now
  // reads 1 MiB at a time. /proc/self/io gives the process's read count and bytes, so the average
  // read size over a window of reading is observable (Linux only; reported as 0 elsewhere).
  // Sequential: a build without the stop reads gigabytes before the watchdog fires.
  test.each(["readFileSync", "promises.readFile"])(
    "%s of /dev/urandom",
    async api => {
      const read =
        api === "readFileSync"
          ? `fs.readFileSync("/dev/urandom"); parentPort.postMessage("returned");`
          : `fs.promises.readFile("/dev/urandom").then(() => parentPort.postMessage("resolved"), e => parentPort.postMessage("rejected " + e.code));`;
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
        const fs = require("node:fs");
        const { Worker } = require("node:worker_threads");
        const io = () => {
          const text = fs.readFileSync("/proc/self/io", "utf8");
          return { bytes: Number(/rchar: (\\d+)/.exec(text)[1]), reads: Number(/syscr: (\\d+)/.exec(text)[1]) };
        };
        const w = new Worker(
          'const fs = require("node:fs"); const { parentPort } = require("node:worker_threads");' +
          'parentPort.postMessage("reading"); ${read}',
          { eval: true },
        );
        w.on("error", e => { console.error("worker error:", e); process.exit(1); });
        w.on("exit", code => console.log("exit", code));
        w.on("message", async m => {
          console.log(m);
          if (m !== "reading") process.exit(1);
          // A window of reading: 32 MiB, past which a doubling read size averages above 2 MiB.
          let perRead = 0;
          if (process.platform === "linux") {
            const a = io();
            let b = a;
            for (const deadline = Date.now() + ${timeout / 4}; b.bytes - a.bytes < 32 * 1024 * 1024 && Date.now() < deadline; ) {
              await Bun.sleep(10);
              b = io();
            }
            perRead = Math.round((b.bytes - a.bytes) / Math.max(1, b.reads - a.reads));
          }
          const code = await Promise.race([w.terminate(), Bun.sleep(${timeout / 2}).then(() => "hung")]);
          console.log("terminated", code, "bytes per read:", perRead);
          process.exit(code === "hung" ? 2 : 0);
        });
      `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      const m = /^reading\nexit 1\nterminated 1 bytes per read: (\d+)\n$/.exec(stdout);
      expect(m, stdout).not.toBeNull();
      expect(Number(m![1])).toBeLessThanOrEqual(1024 * 1024);
      expect(exitCode).toBe(0);
    },
    timeout,
  );
});

// A worker exiting while a Bun.spawn() child still has a pending pipe-backed stdin (a Blob the child
// never reads; the default stdin path on Windows, BUN_FEATURE_FLAG_DISABLE_MEMFD elsewhere): the
// Subprocess finalizer closed that writer, whose close path re-evaluated pending activity and tried to
// re-root the wrapper it had just marked finalized (debug assert).
test(
  "worker exit with a spawned child's Blob stdin still pending",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { Worker } = require("node:worker_threads");
        const w = new Worker(\`
          const p = Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 3000)"], { stdin: new Blob([new Uint8Array(4 << 20)]), stdout: "ignore" });
          globalThis.keep = p;
          setTimeout(() => process.exit(0), 50);
        \`, { eval: true });
        w.on("error", (e) => { console.error(e); process.exit(1); });
        w.on("exit", (c) => { console.log("worker exit", c); process.exit(0); });
      `,
      ],
      env: { ...bunEnv, BUN_FEATURE_FLAG_DISABLE_MEMFD: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("worker exit 0\n");
    expect(exitCode).toBe(0);
  },
  timeout,
);

// A worker exiting with fetches that have both a streaming request body (whose sink cell holds the
// FetchTasklet) and a JS-touched response.body (a ByteStream source owned by another cell): the VM's
// last sweep destroys cells in no particular order, and the tasklet's teardown unhooked itself as the
// response stream's producer by writing through the stream's wrapper into a source that sweep had
// already freed (heap-use-after-free WRITE under ASAN). The tasklet now holds a counted ref on the
// source for as long as it is its producer.
test(
  "worker exit with streaming-request-body fetches whose response.body was touched",
  async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { Worker } = require("node:worker_threads");
        const server = Bun.serve({ port: 0, fetch(req) { return new Response(req.body); } });
        const N = 6;
        let done = 0;
        for (let i = 0; i < N; i++) {
          const w = new Worker(\`
            const keep = [];
            let touched = 0;
            for (let j = 0; j < 8; j++) {
              let ctrl;
              const body = new ReadableStream({ start(c) { ctrl = c; c.enqueue(new Uint8Array(1024)); } });
              const p = fetch("\${server.url}", { method: "POST", body, duplex: "half" })
                .then((r) => { keep.push(r.body); const rd = r.body.getReader(); rd.read(); keep.push(rd); touched++; })
                .catch(() => {});
              keep.push(p, ctrl);
              setInterval(() => { try { ctrl.enqueue(new Uint8Array(512)); } catch {} }, 5);
            }
            // Exit with that state alive; exit code 3 if no fetch ever reached it (the test would
            // then not be exercising what it claims to).
            setTimeout(() => process.exit(touched > 0 ? 0 : 3), 150 + \${(i * 13) % 60});
          \`, { eval: true });
          w.on("error", (e) => { console.error(e); process.exit(1); });
          w.on("exit", (code) => {
            if (code !== 0) { console.error("worker exited " + code); process.exit(1); }
            if (++done === N) { console.log("all exited"); server.stop(true); process.exit(0); }
          });
        }
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("all exited\n");
    expect(exitCode).toBe(0);
  },
  timeout,
);

// A worker's Bun.serve() rendering a body whose microtask checkpoint meets the worker's termination
// (a promise/stream body that spins in a microtask when terminate() lands): the render used to go on
// and attach its continuation with the TerminationException pending (JSC assertNoException in the
// promise `then`). The context's checkpoint now lands the termination and the render stands down.
test(
  "terminate() while the worker's Bun.serve() renders a promise/stream body stuck in a microtask",
  async () => {
    const workers = slow ? 6 : 12;
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { Worker } = require("node:worker_threads");
        const src =
          "const { parentPort } = require('worker_threads');" +
          "const s = Bun.serve({ port: 0, fetch(req) {" +
          "  if (new URL(req.url).pathname === '/stream') return new Response(new ReadableStream({ async pull(c) { await 1; c.enqueue(new TextEncoder().encode('x')); await 1; for (;;) {} } }));" +
          "  return (async () => { await 1; for (;;) {} })();" +
          "}});" +
          "parentPort.postMessage(s.url.href);";
        (async () => {
          for (let i = 0; i < ${workers}; i++) {
            const w = new Worker(src, { eval: true });
            const url = await new Promise(r => w.once("message", r));
            fetch(url + (i % 2 ? "stream" : "promise")).then(r => r.text()).catch(() => {});
            await Bun.sleep(30);
            await w.terminate();
          }
          console.log("PASS");
          process.exit(0);
        })();
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
  timeout,
);

// A worker terminated while HTMLRewriter transforms with async element handlers are in flight: a
// handler's promise reaction resumes the rewrite (more handlers, sink writes, stream delivery) beneath a
// microtask, and the reaction returned a value with the termination it met still pending ("host fn
// return/exception state mismatch"). It now reports the pending exception instead.
test(
  "terminate() while HTMLRewriter async element handlers resume beneath a microtask",
  async () => {
    const workers = slow ? 10 : 40;
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { Worker } = require("node:worker_threads");
        const src =
          "const { parentPort } = require('worker_threads');" +
          "const T = f => { try { const x = f(); if (x && x.then) x.then(()=>{},()=>{}); } catch {} };" +
          "const once = () => T(() => new HTMLRewriter().on('*', { async element(e) { await Bun.sleep(Math.random() * 3); T(() => e.setAttribute('y', '1')); } })" +
          "  .transform(new Response('<p><a>x</a></p>'.repeat(50))).text().then(() => {}, () => {}));" +
          "setInterval(() => { for (let i = 0; i < 4; i++) once(); }, 1);" +
          "parentPort.postMessage('go');";
        (async () => {
          for (let i = 0; i < ${workers}; i++) {
            const w = new Worker(src, { eval: true });
            await new Promise(r => w.once("message", r));
            await Bun.sleep(8 + (i % 8) * 3);
            await w.terminate();
          }
          console.log("PASS");
          process.exit(0);
        })();
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
  timeout,
);

// A worker terminated while async-iterable bodies are being driven (a `Bun.serve` handler returning
// `new Response(asyncGenerator())`, a `fetch()` with an async-iterable request body): the pump met the
// termination as the abrupt completion of `iterator.next()` and went on to notify the iterator —
// `iterator.throw(undefined)` and error-code lookups with the TerminationException pending — walking
// objects mid-teardown (JSC "object->structure() == this" assert). It now stands down instead.
test(
  "terminate() while async-iterable Response/request bodies are being pumped",
  async () => {
    const workers = slow ? 10 : 30;
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { Worker } = require("node:worker_threads");
        const src =
          "const { parentPort } = require('worker_threads');" +
          "const T = f => { try { const x = f(); if (x && x.then) x.then(()=>{},()=>{}); } catch {} };" +
          "async function* gen() { for (;;) { await Bun.sleep(Math.random() * 2); yield new TextEncoder().encode('chunk'); } }" +
          "const s = Bun.serve({ port: 0, fetch: () => new Response(gen()) });" +
          "setInterval(() => { T(() => fetch(s.url).then(r => r.body.getReader().read())); T(() => fetch(s.url, { method: 'POST', body: gen(), duplex: 'half' }).then(r => r.text())); }, 1);" +
          "parentPort.postMessage('go');";
        (async () => {
          for (let i = 0; i < ${workers}; i++) {
            const w = new Worker(src, { eval: true });
            await new Promise(r => w.once("message", r));
            await Bun.sleep(10 + (i % 6) * 5);
            await w.terminate();
          }
          console.log("PASS");
          process.exit(0);
        })();
      `,
      ],
      // Every fetch here is deliberately still in flight when its worker is terminated, and an
      // in-flight fetch's tasklet is not reclaimed at worker teardown (pre-existing; not what this
      // test is about), so leak checking is off for this child — the test guards the pump's
      // termination handling, which aborts the child (no PASS) when it regresses.
      env: { ...bunEnv, ASAN_OPTIONS: "detect_leaks=0:allow_user_segv_handler=1:disable_coredump=0" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // A worker terminated mid-fetch of its own streaming response can report one rejection with an
    // empty reason natively (its handlers can no longer run) — a bare "error" line, seen on main as
    // well and unrelated to what this test guards; anything else on stderr fails the test.
    expect(stderr.split("\n").filter(l => l.trim() !== "" && l.trim() !== "error")).toEqual([]);
    expect(stdout).toBe("PASS\n");
    expect(exitCode).toBe(0);
  },
  timeout,
);
