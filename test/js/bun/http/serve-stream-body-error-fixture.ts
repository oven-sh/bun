// An error thrown by a ReadableStream used as a Response body must never
// escape as a global unhandledRejection. Bun's default unhandledRejection
// policy exits the process, so before the fix a single bad request took the
// entire server down.
//
// argv[2]: variant name (see `sources` and `nativeSources` below)
// argv[3..]: "development" to run the server with development: true,
//            "no-error-handler" to run it without an error() callback
//
// Prints a single JSON object on stdout. Exits 0, except that a run without
// error() reports the failures as unhandled, which makes Bun exit 1.
import net from "node:net";

const variant = process.argv[2];
const flags = process.argv.slice(3);
const development = flags.includes("development");
const withErrorHandler = !flags.includes("no-error-handler");

// Set by the mid-stream variant so it only errors once its chunk has provably
// reached the client socket, i.e. after the 200 response is committed on the
// wire. Called from the raw request's data handler below.
let midStreamResolve: (() => void) | undefined;

// Set by the native after-attach variant: called once the response's status
// line has reached the client, i.e. after Bun.serve attached to the body and
// committed the status.
let statusOnWire: (() => void) | undefined;

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

// Native counterparts: bodies backed by Bun's own ByteStream (a fetch()
// response body, directly or through an HTMLRewriter) whose upstream
// connection fails. The upstream is a raw socket so the failure is
// deterministic: it announces a 100-byte body and closes when the variant
// says so.
//
// Returns the fetch() Response; `fail()` closes the upstream connection.
async function fetchFromFailingUpstream(firstWrite: string) {
  const sockets: net.Socket[] = [];
  const upstream = net.createServer(socket => {
    sockets.push(socket);
    socket.resume();
    socket.on("error", () => {});
    socket.write(firstWrite);
  });
  await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
  // Scratch server for one request: it must never be what keeps this process
  // alive if something below goes wrong.
  upstream.unref();
  const { port } = upstream.address() as net.AddressInfo;
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${port}/`);
  } catch (error) {
    for (const socket of sockets) socket.destroy();
    upstream.close();
    throw error;
  }
  return {
    res,
    fail() {
      for (const socket of sockets) socket.end();
      upstream.close();
    },
  };
}

// The failure reaches the fetch() Response on a later event-loop turn.
// Bun.inspect(res) lists the body stream while the body is still pending and
// stops listing it once the body holds the error; reading the stream to find
// out would consume the very state under test. By then the error has also
// been pushed into the already-materialized native stream.
async function untilBodyFailed(res: Response) {
  const deadline = Date.now() + 10_000;
  while (Bun.inspect(res).includes("ReadableStream")) {
    if (Date.now() > deadline) throw new Error("the upstream failure never reached the idle body");
    await Bun.sleep(1);
  }
}

const PARTIAL_BODY = "HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\npartial";
const HEADERS_ONLY = "HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n";

const nativeSources: Record<string, () => Promise<ReadableStream>> = {
  // The stream exists (res.body was taken) but nothing reads it when the
  // failure arrives, so the error is held inside the native stream with no
  // JS-visible rejection anywhere by the time Bun.serve renders the Response
  // wrapping it.
  "native-errored-before-render": async () => {
    const { res, fail } = await fetchFromFailingUpstream(PARTIAL_BODY);
    const body = res.body!;
    fail();
    await untilBodyFailed(res);
    return body;
  },
  // Same, one producer further away: the failing fetch() body feeds an
  // HTMLRewriter and it is the rewriter's output stream that holds the error.
  // (The rewriter is given a wrapper so `res` itself still tracks the failure.)
  "native-rewriter-errored-before-render": async () => {
    const { res, fail } = await fetchFromFailingUpstream(PARTIAL_BODY);
    const input = new Response(res.body, { headers: { "content-type": "text/html" } });
    const body = new HTMLRewriter().on("p", {}).transform(input).body!;
    fail();
    await untilBodyFailed(res);
    return body;
  },
  // Control: the same upstream fails only after Bun.serve has attached to the
  // healthy stream and committed the status line, so the error can only
  // terminate the body.
  "native-errored-after-attach": async () => {
    const { res, fail } = await fetchFromFailingUpstream(HEADERS_ONLY);
    statusOnWire = fail;
    return res.body!;
  },
};

const source = sources[variant];
const nativeSource = nativeSources[variant];
if (!source && !nativeSource) {
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
  // The body names the error that reached error(), so the wire pins both the
  // channel and the error's identity.
  error: withErrorHandler
    ? (error: Error & { code?: string }) => {
        errorCb++;
        return new Response(`err-body:${error.code ?? error.message}`, { status: 500 });
      }
    : undefined,
  fetch() {
    if (nativeSource) return nativeSource().then(body => new Response(body));
    return new Response(source!());
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
      // Anything at all on the wire means the status line went out.
      statusOnWire?.();
      statusOnWire = undefined;
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
