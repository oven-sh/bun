// Regression: when a fetch handler returns `new Response(bigString)` sync
// and tryEnd() hits backpressure, the RequestContext holds `response_ptr`
// across the async onWritable gap but only protected the Response JSValue
// for file-backed / Locked bodies. For InternalBlob/WTFStringImpl bodies,
// nothing rooted the Response (RequestContext is a pool struct, not GC-
// visited). If GC collected it and the client then aborted while the request
// body was still .Locked, onAbort() dereferenced a freed *Response at
// RequestContext.zig:692 — heap-use-after-free under ASAN.
//
// This fixture reproduces: POST with an incomplete chunked body (so
// request_body stays .Locked and onAbort takes the !isDeadRequest branch),
// handler returns a large in-memory Response, client never reads
// (backpressure), GC runs, client closes.

import { connect } from "node:net";

// Large enough to guarantee tryEnd() backpressure on a paused client socket.
const big = Buffer.alloc(8 * 1024 * 1024, "x").toString();

const handlerEntered: Array<() => void> = [];
let abortCount = 0;
let gcTimer: ReturnType<typeof setInterval> | undefined;

const server = Bun.serve({
  port: 0,
  idleTimeout: 0,
  fetch(req) {
    req.signal.addEventListener("abort", () => abortCount++, { once: true });
    handlerEntered.shift()?.();
    // Sync Response with a plain string body → InternalBlob / WTFStringImpl.
    // Not a file, not a stream: the old code left response_jsvalue
    // unprotected here.
    return new Response(big);
  },
});

const port = Number(server.port);

async function oneRound() {
  const { promise: entered, resolve: markEntered } = Promise.withResolvers<void>();
  handlerEntered.push(markEntered);

  const sock = connect(port, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    sock.on("connect", resolve);
    sock.on("error", reject);
  });
  // Stop the client from draining the response so the server's tryEnd()
  // stalls on backpressure and registers onWritable.
  sock.pause();

  // POST, chunked, with one chunk but no terminator — the request body
  // stays .Locked on the server so onAbort takes the branch that
  // dereferences response_ptr.
  sock.write(
    "POST / HTTP/1.1\r\n" + //
      `Host: 127.0.0.1:${port}\r\n` +
      "Transfer-Encoding: chunked\r\n" +
      "\r\n" +
      "5\r\nhello\r\n",
  );

  await entered;

  // Give tryEnd() a tick to hit backpressure and unwind, then hammer GC so
  // the (previously unrooted) Response is collected before the abort.
  for (let i = 0; i < 20; i++) {
    await Bun.sleep(1);
    Bun.gc(true);
  }

  // Client closes → server onAbort → dereferences response_ptr.
  const { promise: closed, resolve: markClosed } = Promise.withResolvers<void>();
  sock.on("close", () => markClosed());
  sock.destroy();
  await closed;
}

// Keep GC pressure on between rounds too.
gcTimer = setInterval(() => Bun.gc(true), 1);

const ITERATIONS = 10;
for (let i = 0; i < ITERATIONS; i++) {
  await oneRound();
}

clearInterval(gcTimer);

// Let the server observe the aborts.
for (let i = 0; i < 100 && abortCount < ITERATIONS; i++) {
  Bun.gc(true);
  await Bun.sleep(5);
}

// After aborts, contexts should drain to 0 (no leak).
for (let i = 0; i < 100 && server.pendingRequests > 0; i++) {
  Bun.gc(true);
  await Bun.sleep(5);
}

const pending = server.pendingRequests;
console.log(JSON.stringify({ pending, abortCount, iterations: ITERATIONS }));
server.stop(true);

if (abortCount !== ITERATIONS) {
  console.error(`Expected ${ITERATIONS} abort events, got ${abortCount}`);
  process.exit(1);
}
if (pending !== 0) {
  console.error(`LEAK: ${pending} RequestContexts were never freed`);
  process.exit(1);
}
process.exit(0);
