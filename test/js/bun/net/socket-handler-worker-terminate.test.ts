// worker.terminate() firing while a Bun.listen socket handler is mid-call must
// not re-enter JS with the termination exception still pending. The socket
// dispatch path calls the error handler when the primary handler throws, and
// termination cannot be cleared: entering JS again trips Interpreter::
// executeCallImpl's `assertNoException`. Repro for the
// test/js/node/test/parallel/test-http2-reset-flood.js SIGABRT.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// The handler body shared by both the Bun.listen close handler and the
// Bun.serve websocket message handler: a two-phase Atomics handshake so the
// safepoint spin starts only once the parent is already calling terminate(),
// making the window build-speed-independent.
//   shared[0]: worker -> parent ("I am inside the handler"; 2 = spin ran out)
//   shared[1]: parent -> worker ("terminate() is in flight")
const handlerBody = `
  Atomics.store(shared, 0, 1);
  Atomics.notify(shared, 0);
  Atomics.wait(shared, 1, 0, 5000);
  // terminate() is now in flight; spin on safepoints so the termination
  // exception is raised inside this handler frame. Bounded so a missed
  // terminate cannot hang.
  let sink = 0;
  for (let i = 0; i < 10_000_000; i++) sink += Atomics.load(shared, 1);
  Atomics.store(shared, 0, 2);
`;

const workerSource = `
const { parentPort } = require("worker_threads");
const shared = new Int32Array(require("worker_threads").workerData);

const server = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: {
    open(socket) { socket.write("hello"); },
    data() {},
    // socket_body.rs:on_close: a termination raised here returns Err to the
    // native caller, which then invokes Handlers::call_error_handler.
    close() {${handlerBody}},
    error() {},
  },
});
parentPort.postMessage(server.port);
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
    // ServerWebSocket.rs:on_message: a termination raised here returns Err to
    // the native caller, which then invokes WebSocketServerContext::
    // run_error_callback.
    message() {${handlerBody}},
    close() {},
    error() {},
  },
});
parentPort.postMessage(server.port);
`;

function parentSource(workerSrc: string, driveHandler: string, cleanup: string) {
  return `
const { Worker } = require("worker_threads");
const net = require("net");

(async () => {
  // Each iteration is an independent opportunity for terminate() to land inside
  // the handler. The two-phase handshake makes it land on the first try; a few
  // repeats leave headroom for CI scheduling jitter.
  let hits = 0;
  for (let i = 0; i < 6; i++) {
    const sab = new SharedArrayBuffer(8);
    const shared = new Int32Array(sab);
    const worker = new Worker(${JSON.stringify(workerSrc)}, { eval: true, workerData: sab });
    const port = await new Promise(resolve => worker.once("message", resolve));
    ${driveHandler}
    // Wait until the worker is inside the handler, then release it from its
    // own wait and terminate so the termination exception lands mid-handler.
    if (Atomics.wait(shared, 0, 0, 5000) === "timed-out") throw new Error("handler never fired");
    Atomics.store(shared, 1, 1);
    Atomics.notify(shared, 1);
    await worker.terminate();
    ${cleanup}
    // shared[0] === 1 means termination landed mid-handler (the spin loop was
    // interrupted); 2 means the handler returned normally first.
    if (Atomics.load(shared, 0) === 1) hits++;
  }
  if (hits === 0) throw new Error("terminate() never landed inside the handler (0/6)");
  console.log("ok", hits);
})();
`;
}

const listenDriver = `
    const conn = net.connect({ port, host: "127.0.0.1" });
    await new Promise(resolve => conn.once("data", resolve));
    // Closing the client drives on_close on the server's per-connection socket.
    conn.destroy();
`;

const wsDriver = `
    const ws = new WebSocket("ws://127.0.0.1:" + port);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    ws.send("go");
`;

// On Windows the usockets close path and Atomics.wait scheduling differ enough
// that the window does not open; the bug is platform-agnostic and is exercised
// on the POSIX lanes.
describe.skipIf(isWindows)(
  "worker.terminate() mid-handler does not re-enter JS with a pending termination exception",
  () => {
    for (const [name, src] of [
      ["Bun.listen close handler (socket Handlers::call_error_handler)", parentSource(workerSource, listenDriver, "")],
      [
        "Bun.serve websocket message handler (WebSocketServerContext::run_error_callback)",
        parentSource(wsWorkerSource, wsDriver, "ws.close();"),
      ],
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
            stdout: expect.stringMatching(/^ok [1-6]$/),
            exitCode: 0,
          });
        },
        60_000,
      );
    }
  },
);
