// An error thrown by a ReadableStream used as a Response body must never
// escape as a global unhandledRejection. Bun's default unhandledRejection
// policy exits the process, so before the fix a single bad request took the
// entire server down. The `nativeBodies` variants pin the same wire and
// reporting contract for bodies Bun.serve streams without a JS ReadableStream.
//
// argv[2]: variant name (see `sources` and `nativeBodies` below)
// argv[3..]: "development" to run the server with development: true;
//            "dev-server" to also give it an HTML route, which makes the
//            development server run a bake dev server (the requests below
//            still go to fetch())
//
// Prints a single JSON object on stdout and exits 0.
import net from "node:net";
import devServerPage from "./serve-stream-body-error-fixture.html";

const variant = process.argv[2];
const flags = process.argv.slice(3);
const development = flags.includes("development");
const devServer = flags.includes("dev-server");

// Set by the mid-stream variants so they only error once their chunk has
// provably reached the client socket, i.e. after the 200 response is committed
// on the wire. Called from the raw request's data handler below.
let midStreamResolve: (() => void) | undefined;

// Arms `midStreamResolve` for one request. Every mid-stream variant calls this
// before it emits "chunk-a", so the resolver is in place by the time the
// client can see the chunk.
function chunkReachedClient(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  midStreamResolve = resolve;
  return promise;
}

// Set by the variants that fail after the status line but before any body byte
// (pending-error-after-headers, proxied-fetch-after-status) so they only error
// once the status line has provably reached the client socket. (uWS terminates
// the header block only with the first body byte, so a blank line never
// arrives for these variants.) The forced close that follows sends a RST, and
// a RST can discard data the peer has not read yet (Windows always does), so
// the error must not race the client's read.
let statusLineReceivedResolve: (() => void) | undefined;

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
  // The first pull() is pending when the server flushes the headers; the
  // source then errors without ever producing a chunk.
  "pending-error-after-headers": () =>
    new ReadableStream({
      async pull(c) {
        const { promise, resolve } = Promise.withResolvers<void>();
        statusLineReceivedResolve = resolve;
        await promise;
        c.error(new Error("boom"));
      },
    }),
  // Errors only after a chunk has already been flushed to the client.
  "mid-stream-reject": () =>
    new ReadableStream({
      async pull(c) {
        const reached = chunkReachedClient();
        c.enqueue("chunk-a");
        await reached;
        throw new Error("boom");
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

// HTMLRewriter input that lets the rewritten "<b>chunk-a</b>" reach the client
// before delivering the element whose handler fails.
function rewriterInput(): ReadableStream {
  const reached = chunkReachedClient();
  let pulls = 0;
  return new ReadableStream({
    async pull(c) {
      if (pulls++ === 0) {
        c.enqueue("<b>chunk-a</b>");
        return;
      }
      await reached;
      c.enqueue("<p>x</p>");
      c.close();
    },
  });
}

function rewriterResponse(element: () => void | Promise<void>): Response {
  return new HTMLRewriter()
    .on("p", { element })
    .transform(new Response(rewriterInput(), { headers: { "content-type": "text/html" } }));
}

// Upstream for the proxied variants: a scratch server for one request that
// answers with `firstWrite` (announcing more body than it will ever send), so
// the fetch() body fails deterministically when `fail()` closes the connection.
async function fetchFromFailingUpstream(firstWrite: string) {
  const sockets: net.Socket[] = [];
  const upstream = net.createServer(socket => {
    sockets.push(socket);
    socket.resume();
    socket.on("error", () => {});
    socket.write(firstWrite);
  });
  await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
  // Must never be what keeps the process alive if fail() is not reached.
  upstream.unref();
  const { port } = upstream.address() as net.AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/`);
  return {
    res,
    fail() {
      for (const socket of sockets) socket.end();
      upstream.close();
    },
  };
}

// Bodies Bun.serve streams natively (no JS ReadableStream pump) whose producer
// fails after the status line is committed. error() can no longer answer, so
// the failure is reported and the connection is closed without the terminating
// chunk, whether or not a body byte went out first.
const nativeBodies: Record<string, () => Response | Promise<Response>> = {
  "rewriter-mid-stream-throw": () =>
    rewriterResponse(() => {
      throw new Error("boom");
    }),
  "rewriter-mid-stream-reject": () =>
    rewriterResponse(async () => {
      await Bun.sleep(0);
      throw new Error("boom");
    }),
  // `return fetch(...)` whose upstream dies once its first chunk has made it
  // through to our client.
  "proxied-fetch-mid-stream": async () => {
    const reached = chunkReachedClient();
    const { res, fail } = await fetchFromFailingUpstream("HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\nchunk-a");
    reached.then(fail);
    return res;
  },
  // Same, but the upstream dies before producing a single body byte. Bun.serve
  // commits the status as soon as it attaches to a fetch() body, so the client
  // has the status line and then the connection closes with no body at all.
  "proxied-fetch-after-status": async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    statusLineReceivedResolve = resolve;
    const { res, fail } = await fetchFromFailingUpstream("HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n");
    promise.then(fail);
    return res;
  },
};

const source = sources[variant];
const nativeBody = nativeBodies[variant];
if (!source && !nativeBody) {
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
  ...(devServer ? { routes: { "/dev-server-page": devServerPage } } : {}),
  error() {
    errorCb++;
    return new Response("err-body", { status: 500 });
  },
  fetch(req) {
    if (new URL(req.url).pathname === "/ok") {
      return new Response("ok");
    }
    return nativeBody ? nativeBody() : new Response(source());
  },
});

// Sends one request over a raw socket and returns everything received before
// the server closed the connection, so the test can assert on the HTTP
// framing. A forced close (ECONNRESET) is an expected, asserted-on outcome
// for the erroring variants, so socket errors are not fatal.
function rawRequest(path: string, abort: boolean): Promise<string> {
  const chunks: Buffer[] = [];
  return new Promise(resolve => {
    const sock = net.connect(server.port, "127.0.0.1", () => {
      sock.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
    sock.on("data", d => {
      chunks.push(d);
      const received = Buffer.concat(chunks);
      if (received.includes("\r\n")) {
        statusLineReceivedResolve?.();
        statusLineReceivedResolve = undefined;
      }
      if (received.includes("chunk-a")) {
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

const wire = await rawRequest("/", clientAborts);
if (clientAborts) await cancelRan.promise;
// A second request to a healthy route proves the server is still accepting
// and answering; only its status line is asserted.
const secondWire = await rawRequest("/ok", false);

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
