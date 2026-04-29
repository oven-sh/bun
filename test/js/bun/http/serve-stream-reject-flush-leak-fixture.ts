// Regression: when a direct ReadableStream used as a Response body rejects
// while a controller.end() / flush(true) promise is parked under
// backpressure, handleRejectStream() nulled `pending_flush` without
// unprotecting the JSPromise, leaking one GC root per request for the
// lifetime of the VM.
//
// Repro:
//   1. Go async first (setImmediate) so RequestContext.toAsync() has already
//      registered the uWS abort handler and doRenderStream is parked on the
//      pending pull() promise (onResolveStream/onRejectStream wired up).
//   2. Bump the sink's highWaterMark so write() buffers instead of draining
//      straight to res.write() — this keeps isHttpWriteCalled() false so
//      end() takes the tryEnd() path.
//   3. Write a chunk large enough that tryEnd() hits socket backpressure on
//      a non-reading client → pending_flush is created + protected.
//   4. Throw, rejecting the pull() promise → onRejectStream →
//      handleRejectStream() with pending_flush still set.
//
// Without the fix, protected Promise count grows by ~1 per iteration.

import { heapStats } from "bun:jsc";
import { connect } from "node:net";

// 64 MiB outsizes Windows' loopback autotuned SO_SNDBUF + SO_RCVBUF (which
// can absorb ~16 MiB combined even with the client paused). On POSIX 8 MiB
// was already plenty; the buffer is reused so the larger size only costs one
// allocation.
const CHUNK = Buffer.alloc(64 * 1024 * 1024, "x");

let flushPending = 0;
let currentSocket: import("node:net").Socket | undefined;

const server = Bun.serve({
  port: 0,
  idleTimeout: 0,
  development: false,
  error() {
    return new Response("err", { status: 500 });
  },
  fetch() {
    return new Response(
      new ReadableStream({
        type: "direct",
        async pull(controller: any) {
          await new Promise<void>(r => setImmediate(() => r()));
          controller.start({ highWaterMark: CHUNK.length + 1 });
          controller.write(CHUNK);
          const p = controller.end();
          if (p instanceof Promise && Bun.peek.status(p) === "pending") {
            flushPending++;
          }
          // Tear down the client after handleRejectStream has run. The throw
          // below rejects pull()'s promise; onRejectStream → handleRejectStream
          // fires on the microtask queue, then this setImmediate fires on the
          // next macrotask. Without it the parked tryEnd() write never drains
          // (client is paused) and uWS won't close the connection.
          setImmediate(() => currentSocket?.destroy());
          throw new Error("boom");
        },
      } as any),
    );
  },
});

function protectedPromiseCount() {
  Bun.gc(true);
  return heapStats().protectedObjectTypeCounts.Promise ?? 0;
}

function oneRequest(): Promise<void> {
  // Raw TCP client that sends the request line and then never reads, so the
  // server's first body write (tryEnd of 8 MiB) hits backpressure. Windows'
  // loopback fast-path will absorb the full 8 MiB into the kernel if the
  // client is draining, so explicitly pause(); the server side destroys the
  // socket once handleRejectStream has run.
  return new Promise(resolve => {
    const socket = connect({ port: server.port, host: "127.0.0.1" }, () => {
      socket.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
      socket.pause();
    });
    currentSocket = socket;
    socket.on("close", () => resolve());
    socket.on("error", () => {});
  });
}

const ITERATIONS = 10;

// Warm up so per-process one-time promise protections (module loader, etc.)
// don't count against us.
await oneRequest();
await oneRequest();
Bun.gc(true);

const before = protectedPromiseCount();

for (let i = 0; i < ITERATIONS; i++) {
  await oneRequest();
}

for (let i = 0; i < 5; i++) {
  await Bun.sleep(0);
  Bun.gc(true);
}

const after = protectedPromiseCount();
const delta = after - before;

await server.stop(true);

console.log(
  JSON.stringify({
    before,
    after,
    delta,
    flushPending,
    iterations: ITERATIONS,
  }),
);

// The test must actually exercise the backpressure → pending_flush path.
if (flushPending < ITERATIONS / 2) {
  console.error(`insufficient backpressure: only ${flushPending}/${ITERATIONS} end() calls returned a pending promise`);
  process.exit(2);
}
// Before the fix: delta ≈ ITERATIONS (every pending_flush stays protected).
// After the fix: delta stays near zero.
if (delta > ITERATIONS / 2) {
  console.error(`LEAK: ${delta} Promise objects stayed protected after ${ITERATIONS} rejected streams`);
  process.exit(1);
}

process.exit(0);
