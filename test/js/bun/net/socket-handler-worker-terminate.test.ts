// worker.terminate() firing while a Bun.listen socket handler is mid-call must
// not re-enter JS with the termination exception still pending. The socket
// dispatch path calls the error handler when the primary handler throws, and
// termination cannot be cleared: entering JS again trips Interpreter::
// executeCallImpl's `assertNoException`. Repro for the
// test/js/node/test/parallel/test-http2-reset-flood.js SIGABRT.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

const workerSource = `
const { parentPort } = require("worker_threads");
const shared = new Int32Array(require("worker_threads").workerData);

const server = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: {
    open(socket) {
      socket.write("hello");
    },
    data() {},
    // The close handler is the dispatch point socket_body.rs:on_close drives:
    // a termination raised here returns Err to the native caller, which then
    // invokes the error handler via another JSValue::call.
    close() {
      // Signal the parent that we are inside the handler so it terminates us
      // while this frame is still on the stack.
      Atomics.store(shared, 0, 1);
      Atomics.notify(shared, 0);
      // Spin on safepoints until termination arrives (bounded so a missed
      // terminate cannot hang the test). Array allocation + property sets are
      // safepoints without needing any timers.
      let sink = [];
      for (let i = 0; i < 50_000; i++) {
        sink.push(i & 0xff);
        if (sink.length > 64) sink.length = 0;
      }
      // Reaching this line means termination did not land mid-handler this
      // iteration; the parent observes 2 and does not count it as a hit.
      Atomics.store(shared, 0, 2);
    },
    error() {},
  },
});
parentPort.postMessage(server.port);
`;

const parentSource = `
const { Worker } = require("worker_threads");
const net = require("net");

(async () => {
  // Each iteration is an independent opportunity for terminate() to land inside
  // the close handler. Atomics coordination makes it land reliably on the
  // first try; a handful leave headroom for CI scheduling jitter.
  let hits = 0;
  for (let i = 0; i < 8; i++) {
    const sab = new SharedArrayBuffer(4);
    const shared = new Int32Array(sab);
    const worker = new Worker(${JSON.stringify(workerSource)}, { eval: true, workerData: sab });
    const port = await new Promise(resolve => worker.once("message", resolve));

    const conn = net.connect({ port, host: "127.0.0.1" });
    await new Promise(resolve => conn.once("data", resolve));
    // Closing the client is what drives on_close on the server's per-connection
    // socket inside the worker.
    conn.destroy();
    // Wait until the worker signals it is inside the close handler, then
    // terminate so the termination exception lands mid-handler.
    const waited = Atomics.wait(shared, 0, 0, 2000);
    if (waited === "timed-out") throw new Error("close() never fired");
    await worker.terminate();
    // shared[0] === 1 means termination landed mid-handler (the spin loop was
    // interrupted); 2 means the handler returned normally first.
    if (Atomics.load(shared, 0) === 1) hits++;
  }
  if (hits === 0) {
    throw new Error("terminate() never landed inside the close handler (0/8)");
  }
  console.log("ok", hits);
})();
`;

const wsWorkerSource = `
const { parentPort } = require("worker_threads");
const shared = new Int32Array(require("worker_threads").workerData);

const server = Bun.serve({
  port: 0,
  fetch(req, server) {
    if (server.upgrade(req)) return;
    return new Response("no upgrade", { status: 400 });
  },
  websocket: {
    open(ws) { ws.send("hello"); },
    // Bun.serve's websocket message handler is the dispatch point
    // ServerWebSocket.rs drives; a termination raised here returns Err to the
    // native caller, which then invokes WebSocketServerContext::
    // run_error_callback.
    message() {
      Atomics.store(shared, 0, 1);
      Atomics.notify(shared, 0);
      let sink = [];
      for (let i = 0; i < 50_000; i++) {
        sink.push(i & 0xff);
        if (sink.length > 64) sink.length = 0;
      }
      Atomics.store(shared, 0, 2);
    },
    close() {},
    error() {},
  },
});
parentPort.postMessage(server.port);
`;

const wsParentSource = `
const { Worker } = require("worker_threads");

(async () => {
  let hits = 0;
  for (let i = 0; i < 8; i++) {
    const sab = new SharedArrayBuffer(4);
    const shared = new Int32Array(sab);
    const worker = new Worker(${JSON.stringify(wsWorkerSource)}, { eval: true, workerData: sab });
    const port = await new Promise(resolve => worker.once("message", resolve));

    const ws = new WebSocket("ws://127.0.0.1:" + port);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    ws.send("go");
    const waited = Atomics.wait(shared, 0, 0, 2000);
    if (waited === "timed-out") throw new Error("message() never fired");
    await worker.terminate();
    ws.close();
    if (Atomics.load(shared, 0) === 1) hits++;
  }
  if (hits === 0) {
    throw new Error("terminate() never landed inside the message handler (0/8)");
  }
  console.log("ok", hits);
})();
`;

// On Windows the usockets close path and Atomics.wait scheduling differ enough
// that the window does not open; the bug is platform-agnostic and is exercised
// on the POSIX lanes.
describe.skipIf(isWindows)(
  "worker.terminate() mid-handler does not re-enter JS with a pending termination exception",
  () => {
    for (const [name, src] of [
      ["Bun.listen close handler (socket Handlers::call_error_handler)", parentSource],
      ["Bun.serve websocket message handler (WebSocketServerContext::run_error_callback)", wsParentSource],
    ] as const) {
      test.concurrent(
        name,
        async () => {
          await using proc = Bun.spawn({
            cmd: [bunExe(), "-e", src],
            env: bunEnv,
            stdout: "pipe",
            stderr: "pipe",
          });
          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          // The unpatched build aborts inside an iteration (exit 134,
          // "ASSERTION FAILED: !exception()" on stderr, no stdout). Assert on
          // stdout/exitCode so benign debug-build stderr noise cannot cause a
          // false positive; the crash's stderr is in the diff either way.
          expect({ stdout: stdout.trim(), stderr, exitCode }).toMatchObject({
            stdout: expect.stringMatching(/^ok [1-8]$/),
            exitCode: 0,
          });
        },
        60_000,
      );
    }
  },
);
