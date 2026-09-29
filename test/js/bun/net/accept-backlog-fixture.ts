// Reports how many connections each event loop turn accepts when the accept queue of a
// listen socket never runs empty.
//
// usage: bun accept-backlog-fixture.ts <listen | serve> <count>
//
// A worker thread is the client. It connects a batch of sockets while this thread blocks in
// Atomics.wait, so every connection of the batch waits in the kernel. The accept handler asks for
// the next batch while `lowWater` connections still wait, so the queue never runs empty before
// the last connection. The queue holds at most `batchSize` connections, which fits the listen
// backlog of every platform.
const kind = process.argv[2];
const count = Number(process.argv[3]);

const batchSize = 100;
const lowWater = 50;

const signal = new Int32Array(new SharedArrayBuffer(4));
const worker = new Worker(new URL("./accept-backlog-client-fixture.ts", import.meta.url).href);
let accepted = 0;
let requested = 0;

// Blocks this thread until the worker has the next connections in the accept queue.
function connectBatch() {
  const batch = Math.min(batchSize - (requested - accepted), count - requested);
  requested += batch;
  Atomics.store(signal, 0, 0);
  worker.postMessage(batch);
  const result = Atomics.wait(signal, 0, 0, 60_000);
  if (result === "timed-out" || Atomics.load(signal, 0) !== 1) {
    console.error("the client did not connect", batch, "sockets:", result, Atomics.load(signal, 0));
    process.exit(1);
  }
}

function onAccept() {
  accepted++;
  if (requested < count && requested - accepted === lowWater) connectBatch();
}

let port = 0;
if (kind === "listen") {
  const server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        onAccept();
        socket.end();
      },
      data() {},
      error() {},
    },
  });
  port = server.port;
} else if (kind === "serve") {
  // The listen socket of Bun.serve has TCP_DEFER_ACCEPT on Linux. There, the accept loop also
  // reads the request and calls this handler.
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      onAccept();
      return new Response("ok");
    },
  });
  port = server.port;
} else {
  throw new Error("unknown kind " + kind);
}

const { promise: ready, resolve: onReady, reject } = Promise.withResolvers<unknown>();
worker.onmessage = onReady;
worker.onerror = reject;
worker.postMessage({ port, request: kind === "serve" ? "GET / HTTP/1.1\r\nHost: localhost\r\n\r\n" : "", signal });
await ready;

connectBatch();

const perTurn: number[] = [];
let seen = 0;
let idleTurns = 0;
(function turn() {
  if (accepted > seen) {
    perTurn.push(accepted - seen);
    idleTurns = 0;
  }
  seen = accepted;
  if (seen >= count || ++idleTurns === 100_000) {
    console.log(JSON.stringify({ accepted: seen, perTurn }));
    process.exit(0);
  }
  setImmediate(turn);
})();
