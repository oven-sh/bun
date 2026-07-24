// argv[2]: route name (see below)
// argv[3]: "no-error-handler" to omit error(), "async-error-handler" for an
//   async error(), "async-fetch" for an async fetch() that awaits a timer
//   before returning (so the handler promise goes Pending past the initial
//   drain and on_resolve runs with is_async()=true)
//
// Prints one JSON object on stdout. Raw keep-alive socket so the exact wire
// framing (status line, body bytes, presence of the terminating chunk) can be
// asserted, including the truncated-chunked cases fetch() would mask.
import net from "node:net";

const routeName = process.argv[2];
const errorMode = process.argv[3];

let unhandled = 0;
process.on("unhandledRejection", () => unhandled++);

let errorCalls: string[] = [];
const errorHandler =
  errorMode === "no-error-handler"
    ? {}
    : errorMode === "async-error-handler"
      ? {
          async error(e: Error) {
            errorCalls.push(e?.message ?? String(e));
            await Bun.sleep(1);
            return new Response("E:" + e?.message, { status: 500, headers: { "x-err": "1" } });
          },
        }
      : {
          error(e: Error) {
            errorCalls.push(e?.message ?? String(e));
            return new Response("E:" + e?.message, { status: 500, headers: { "x-err": "1" } });
          },
        };
function route(p: string): Response {
  // async iterable: throws before the first yield
  if (p === "/iter-throw-first") {
    async function* g() {
      throw new Error("boom-first");
    }
    return new Response(g() as any, { status: 201, headers: { "x-orig": "1" } });
  }
  // async iterable: awaits a timer, then throws before the first yield
  if (p === "/iter-throw-first-slow") {
    async function* g() {
      await Bun.sleep(5);
      throw new Error("boom-slow");
    }
    return new Response(g() as any, { status: 201, headers: { "x-orig": "1" } });
  }
  // async iterable: yields synchronously, then throws
  if (p === "/iter-yield-then-throw") {
    async function* g() {
      yield "AAAA";
      yield "BBBB";
      throw new Error("boom-fast");
    }
    return new Response(g() as any);
  }
  // async iterable: yields with awaited gaps, then throws
  if (p === "/iter-yield-slow-then-throw") {
    let resolve!: () => void;
    const gate = new Promise<void>(r => (resolve = r));
    (globalThis as any).__gate = resolve;
    async function* g() {
      yield "AAAA";
      await gate;
      throw new Error("boom-mid");
    }
    return new Response(g() as any);
  }
  // default ReadableStream: pull rejects before any enqueue
  if (p === "/rs-pull-throw") {
    return new Response(
      new ReadableStream({
        async pull() {
          throw new Error("rs-boom");
        },
      }),
    );
  }
  // async iterable: successful empty body (custom status/headers must survive)
  if (p === "/iter-empty-ok") {
    async function* g() {}
    return new Response(g() as any, { status: 202, headers: { "x-custom": "yes" } });
  }
  // ReadableStream: close() in start, no chunks (user status/headers must survive)
  if (p === "/rs-empty-ok") {
    return new Response(new ReadableStream({ start: c => c.close() }), { status: 202, headers: { "x-custom": "yes" } });
  }
  // direct stream: async pull resolves without write/end (handle_resolve_stream
  // reaches finalize()'s !done branch with the user status still unwritten)
  if (p === "/direct-empty-ok") {
    return new Response(
      new ReadableStream({
        type: "direct",
        async pull() {
          await Bun.sleep(1);
        },
      } as any),
      { status: 202, headers: { "x-custom": "yes" } },
    );
  }
  return new Response("unknown: " + p, { status: 404 });
}

await using server = Bun.serve({
  port: 0,
  development: false,
  ...errorHandler,
  ...(errorMode === "async-fetch"
    ? {
        async fetch(req) {
          await Bun.sleep(1);
          return route(new URL(req.url).pathname);
        },
      }
    : {
        fetch(req) {
          return route(new URL(req.url).pathname);
        },
      }),
});

// Keep-alive request: read exactly one response, then end() so the server
// frees the socket. The truncated-chunk variants force-close the connection,
// which may surface as ECONNRESET; that is an asserted outcome, not a failure.
function rawRequest(path: string): Promise<{ raw: string; resetAfterBytes: boolean }> {
  return new Promise(resolve => {
    let buf = "";
    let reset = false;
    const sock = net.connect(server.port, "127.0.0.1", () => {
      sock.write(`GET ${path} HTTP/1.1\r\nHost: x\r\n\r\n`);
    });
    sock.on("data", d => {
      buf += d.toString("latin1");
      if (buf.includes("AAAA")) (globalThis as any).__gate?.();
      // Once a complete Content-Length body or the terminating chunk has
      // arrived, end() releases the keep-alive connection.
      if (buf.endsWith("0\r\n\r\n")) sock.end();
      const clen = buf.match(/Content-Length: (\d+)\r\n/i);
      const sep = buf.indexOf("\r\n\r\n");
      if (clen && sep >= 0 && buf.length - sep - 4 >= Number(clen[1])) sock.end();
    });
    sock.on("error", () => (reset = true));
    sock.on("close", () => resolve({ raw: buf, resetAfterBytes: reset }));
  });
}

const { raw, resetAfterBytes } = await rawRequest("/" + routeName);

for (let i = 0; i < 10; i++) await Bun.sleep(0);

const sep = raw.indexOf("\r\n\r\n");
const headers = sep >= 0 ? raw.slice(0, sep) : raw;
console.log(
  JSON.stringify({
    statusLine: headers.split("\r\n")[0] ?? "",
    xErr: /\bx-err: 1\b/i.test(headers),
    xOrig: /\bx-orig: 1\b/i.test(headers),
    xCustom: /\bx-custom: yes\b/i.test(headers),
    body: sep >= 0 ? raw.slice(sep + 4) : "",
    resetAfterBytes,
    errorCalls,
    unhandled,
  }),
);
