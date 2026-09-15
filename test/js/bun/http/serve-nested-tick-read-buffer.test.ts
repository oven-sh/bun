import { expect, test } from "bun:test";
import { tempDir, tls as tlsCert } from "harness";
import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";

// Every read on the server's loop lands in one receive buffer, and uWS keeps
// parsing out of it after the request handler returns: the request body that
// arrived with the head, a request pipelined behind that head, and the lazily
// read url and headers of the `Request`. A handler that runs the event loop
// inside itself lets the nested tick read another connection, so none of those
// bytes may come from that read.
//
// Each test has the handler run the loop until a request on a second
// connection has been handled, so none of them needs any timing. Two calls
// that run the loop are covered: `Bun.build` with a plugin whose `setup()`
// returns a pending promise, and an un-awaited `expect(promise).resolves`,
// which is the one that returns before the handler responds.

const OWN_BODY = Buffer.alloc(64, "a").toString();

function ownPost(path: string) {
  return `POST ${path} HTTP/1.1\r\nHost: own.example\r\nContent-Length: ${OWN_BODY.length}\r\n\r\n${OWN_BODY}`;
}

function ownGet(path: string) {
  return `GET ${path} HTTP/1.1\r\nHost: own.example\r\nX-Own: own-header\r\n\r\n`;
}

/* `filler` sizes the request so that one read of it covers the bytes the test
 * is about. */
function otherGet(filler: number) {
  return `GET /other HTTP/1.1\r\nHost: other.example\r\nX-Filler: ${Buffer.alloc(filler, "f").toString()}\r\n\r\n`;
}

/* Past the end of the first connection's head and body. */
const PAST_THE_BODY = 700;
/* Past the end of the first connection's head, and ending inside the request
 * pipelined behind it, so a parse of those bytes fails instead of waiting for
 * the rest of a head. */
const INTO_THE_PIPELINED_REQUEST = 44;

function parseResponses(raw: string) {
  const out: { status: number; body: string }[] = [];
  let rest = raw;
  for (;;) {
    const end = rest.indexOf("\r\n\r\n");
    if (end < 0) break;
    const head = rest.slice(0, end);
    const contentLength = /\r\ncontent-length: *(\d+)/i.exec(head);
    const bodyLength = contentLength ? Number(contentLength[1]) : 0;
    if (rest.length < end + 4 + bodyLength) break;
    out.push({ status: Number(head.slice(9, 12)), body: rest.slice(end + 4, end + 4 + bodyLength) });
    rest = rest.slice(end + 4 + bodyLength);
  }
  return out;
}

/* Reads whole HTTP responses off a raw socket. `latin1` keeps one byte per
 * character, so Content-Length and the offsets agree. */
function collect(socket: Socket) {
  let raw = "";
  let closed = false;
  const waiting = new Set<() => void>();
  const wake = () => {
    for (const listener of [...waiting]) listener();
  };
  socket.on("data", chunk => {
    raw += chunk.toString("latin1");
    wake();
  });
  socket.on("close", () => {
    closed = true;
    wake();
  });
  socket.on("error", () => {});
  return async function responses(count: number) {
    while (parseResponses(raw).length < count) {
      if (closed) throw new Error(`the connection closed with ${JSON.stringify(raw)}`);
      await new Promise<void>(resolve => {
        const listener = () => {
          waiting.delete(listener);
          resolve();
        };
        waiting.add(listener);
      });
    }
    return parseResponses(raw);
  };
}

async function connectTo(port: number, secure: boolean) {
  const socket = secure
    ? tlsConnect({ port, host: "127.0.0.1", rejectUnauthorized: false })
    : netConnect(port, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    socket.once(secure ? "secureConnect" : "connect", () => resolve());
    socket.once("error", reject);
  });
  socket.setNoDelay(true);
  return socket as Socket;
}

type Nesting = {
  /* Writes a request on a second connection. The promise resolves once the
   * server has handled it, which is what the handler runs the loop for. */
  startOtherRequest: (filler: number) => Promise<string>;
};

/* A server that forwards every request to `handler`, except the one a nested
 * run asked for. The handler must read nothing off its request before it runs
 * the loop: a read copies the head, and the test no longer covers it. */
async function serve(
  secure: boolean,
  handler: (req: Request, nesting: Nesting) => Response | Promise<Response>,
): Promise<{ port: number; stop: () => void }> {
  let handled: ((value: string) => void) | undefined;
  let other: Socket;

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    tls: secure ? tlsCert : undefined,
    fetch(req) {
      if (handled) {
        const resolve = handled;
        handled = undefined;
        resolve("other");
        return new Response("other");
      }
      return handler(req, nesting);
    },
  });

  const nesting: Nesting = {
    startOtherRequest(filler) {
      const { promise, resolve } = Promise.withResolvers<string>();
      handled = resolve;
      other.write(otherGet(filler));
      return promise;
    },
  };

  other = await connectTo(server.port, secure);
  collect(other);

  return {
    port: server.port,
    stop: () => {
      other.destroy();
      server.stop(true);
    },
  };
}

/* Runs the event loop until the other request has been handled, and returns
 * only after that. */
function buildWithPendingSetup(entry: string, nesting: Nesting, filler: number) {
  return Bun.build({
    entrypoints: [entry],
    plugins: [{ name: "pending-setup", setup: () => nesting.startOtherRequest(filler).then(() => {}) }],
  }).then(
    () => {},
    () => {},
  );
}

async function bodyIsTheHandlersOwn(secure: boolean) {
  using dir = tempDir("serve-nested-tick-read-buffer", { "entry.js": "export default 1;\n" });

  const served = await serve(secure, async (req, nesting) => {
    await buildWithPendingSetup(`${dir}/entry.js`, nesting, PAST_THE_BODY);
    // The parse frame dispatches the body after this handler suspends, out of
    // the buffer the nested tick just read the other request into.
    return new Response(await req.text());
  });

  const own = await connectTo(served.port, secure);
  const responses = collect(own);
  try {
    own.write(ownPost("/own"));
    expect(await responses(1)).toEqual([{ status: 200, body: OWN_BODY }]);
  } finally {
    own.destroy();
    served.stop();
  }
}

test("a handler that runs the event loop reads its own request body", async () => {
  await bodyIsTheHandlersOwn(false);
});

test("a handler that runs the event loop reads its own request body over TLS", async () => {
  await bodyIsTheHandlersOwn(true);
});

test("a handler that runs the event loop reads its own url and headers", async () => {
  using dir = tempDir("serve-nested-tick-read-buffer", { "entry.js": "export default 1;\n" });

  const read = Promise.withResolvers<{ url: string; header: string | null }>();
  const served = await serve(false, async (req, nesting) => {
    await buildWithPendingSetup(`${dir}/entry.js`, nesting, PAST_THE_BODY);
    read.resolve({ url: req.url, header: req.headers.get("x-own") });
    return new Response("first");
  });

  const own = await connectTo(served.port, false);
  collect(own);
  try {
    own.write(ownGet("/own"));
    expect(await read.promise).toEqual({ url: "http://own.example/own", header: "own-header" });
  } finally {
    own.destroy();
    served.stop();
  }
});

test("a request pipelined behind a handler that runs the event loop gets its own response", async () => {
  let requests = 0;
  const served = await serve(false, (_req, nesting) => {
    if (++requests > 1) return new Response("second");
    // An un-awaited `.resolves` waits for the promise with the event loop, so
    // unlike the build above it returns before this handler responds. The
    // response is therefore still synchronous, which is the pipelining
    // Bun.serve serves.
    expect(nesting.startOtherRequest(INTO_THE_PIPELINED_REQUEST)).resolves.toBe("other");
    return new Response("first");
  });

  const own = await connectTo(served.port, false);
  const responses = collect(own);
  try {
    // Both requests arrive in one read. The first handler runs the event loop,
    // and the parse frame then reads the second request out of the same
    // buffer.
    own.write(ownGet("/first") + ownGet("/second"));
    expect(await responses(2)).toEqual([
      { status: 200, body: "first" },
      { status: 200, body: "second" },
    ]);
  } finally {
    own.destroy();
    served.stop();
  }
});
