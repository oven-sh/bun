// An error thrown by a ReadableStream used as a Response body must never
// escape as a global unhandledRejection. Bun's default unhandledRejection
// policy exits the process, so before the fix a single bad request took the
// entire server down.
//
// argv[2]: variant name (see `sources` below)
// argv[3]: "development" to run the server with development: true
//
// Prints a single JSON object on stdout and exits 0.
import net from "node:net";

const variant = process.argv[2];
const development = process.argv[3] === "development";

// Set by the mid-stream variant so it only errors once its chunk has provably
// reached the client socket, i.e. after the 200 response is committed on the
// wire. Called from the raw request's data handler below.
let midStreamResolve: (() => void) | undefined;

// Set by the cancel variants: resolved once the source's cancel() has run, so
// the test observes any resulting rejection before declaring success.
const cancelRan = Promise.withResolvers<void>();

const sources: Record<string, () => ReadableStream> = {
  // Already errored by the time Bun.serve starts rendering the body.
  "pull-throw": () =>
    new ReadableStream({
      pull(c) {
        c.enqueue("x");
        throw new Error("boom");
      },
    }),
  "pull-async-reject": () =>
    new ReadableStream({
      async pull(c) {
        c.enqueue("x");
        throw new Error("boom");
      },
    }),
  "controller-error": () =>
    new ReadableStream({
      pull(c) {
        c.enqueue("x");
        c.error(new Error("boom"));
      },
    }),
  "start-async-reject": () =>
    new ReadableStream({
      async start() {
        throw new Error("boom");
      },
    }),
  // highWaterMark: 0 defers the first pull() until the server's own reader
  // asks for data, so the stream is still readable when the server commits to
  // streaming and only errors inside the microtask drain that follows.
  "deferred-pull-throw": () =>
    new ReadableStream(
      {
        pull() {
          throw new Error("boom");
        },
      },
      { highWaterMark: 0 },
    ),
  // Errors only after a chunk has already been flushed to the client.
  "mid-stream-reject": () =>
    new ReadableStream({
      async pull(c) {
        const { promise, resolve } = Promise.withResolvers<void>();
        midStreamResolve = resolve;
        c.enqueue("chunk-a");
        await promise;
        throw new Error("boom");
      },
    }),
  // Same, but controller.error() with no argument: the stored error is
  // undefined (WHATWG default). The sink's abort close still receives exactly
  // one (undefined) argument from rsisSinkClose, and the connection must be
  // force-closed without a clean chunked terminator.
  "mid-stream-nullish-error": () =>
    new ReadableStream({
      async pull(c) {
        const { promise, resolve } = Promise.withResolvers<void>();
        midStreamResolve = resolve;
        c.enqueue("chunk-a");
        await promise;
        c.error();
      },
    }),
  // The client aborts the download mid-stream, which makes Bun cancel the body
  // stream; the source's cancel() then throws. That rejection belongs to a
  // promise Bun created internally and must not surface as unhandledRejection.
  "cancel-throw": () =>
    new ReadableStream({
      async pull(c) {
        c.enqueue("chunk-a");
        await Bun.sleep(4);
      },
      cancel() {
        queueMicrotask(cancelRan.resolve);
        throw new Error("boom");
      },
    }),
  "cancel-async-reject": () =>
    new ReadableStream({
      async pull(c) {
        c.enqueue("chunk-a");
        await Bun.sleep(4);
      },
      async cancel() {
        queueMicrotask(cancelRan.resolve);
        throw new Error("boom");
      },
    }),
  "cancel-byte-throw": () =>
    new ReadableStream({
      type: "bytes",
      async pull(c) {
        c.enqueue(new TextEncoder().encode("chunk-a"));
        await Bun.sleep(4);
      },
      cancel() {
        queueMicrotask(cancelRan.resolve);
        throw new Error("boom");
      },
    }),
};

const source = sources[variant];
if (!source) {
  console.error(`unknown variant: ${variant}`);
  process.exit(3);
}
const clientAborts = variant.startsWith("cancel-");

// Counting instead of relying on the default exit-on-unhandledRejection
// policy gives the test an exact number and keeps the process alive long
// enough to observe the wire either way.
let unhandled = 0;
process.on("unhandledRejection", () => {
  unhandled++;
});

let errorCb = 0;
await using server = Bun.serve({
  port: 0,
  development,
  error() {
    errorCb++;
    return new Response("err-body", { status: 500 });
  },
  fetch() {
    return new Response(source());
  },
});

// Sends one request over a raw socket and returns everything received before
// the server closed the connection, so the test can assert on the HTTP
// framing. A forced close (ECONNRESET) is an expected, asserted-on outcome
// for the mid-stream variant, so socket errors are not fatal.
function rawRequest(abort: boolean): Promise<string> {
  const chunks: Buffer[] = [];
  return new Promise(resolve => {
    const sock = net.connect(server.port, "127.0.0.1", () => {
      sock.write("GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    });
    sock.on("data", d => {
      chunks.push(d);
      if (Buffer.concat(chunks).includes("chunk-a")) {
        midStreamResolve?.();
        // The cancel variants tear down the socket once a body chunk has
        // provably reached the client, so the server's onAborted path fires
        // and cancels the source while pull() is still pending.
        if (abort) sock.resetAndDestroy();
      }
    });
    sock.on("error", () => {});
    sock.on("close", () => resolve(Buffer.concat(chunks).toString("latin1")));
  });
}

const wire = await rawRequest(clientAborts);
if (clientAborts) await cancelRan.promise;
// A second request proves the server is still accepting and answering. For the
// cancel variants the body stream never self-terminates, so abort that one too;
// only the status line is asserted.
const secondWire = await rawRequest(clientAborts);

// Cycle the event loop so any stray rejected promise reaches the
// unhandledRejection reporter before we declare success.
for (let i = 0; i < 10; i++) await Bun.sleep(0);

console.log(
  JSON.stringify({
    statusLine: wire.split("\r\n")[0],
    cleanChunkedTerminator: wire.endsWith("0\r\n\r\n"),
    body: wire.split("\r\n\r\n").slice(1).join("\r\n\r\n"),
    errorCb,
    unhandled,
    secondStatusLine: secondWire.split("\r\n")[0],
  }),
);
