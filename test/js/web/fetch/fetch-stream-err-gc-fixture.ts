// Regression fixture for an unprotected JSValue stored in
// ByteStream.pending.result via StreamError.JSValue.
//
// FetchTasklet.onBodyReceived constructs `.{.err = .{.JSValue = js_err}}`
// where `js_err`'s only root is a local Body.Value.ValueError Strong that is
// released by `defer err.deinit()` once the function returns. When
// ByteStream.onData has no pending read and no buffer_action it parks the raw
// JSValue on the heap in `this.pending.result`. After the Response (and its
// `body.Error` Strong) is collected, a later `toBufferedValue` returns a
// freed JSCell — segfault or JSC structure-corruption crash.
//
// The fixture materializes `res.body` without reading, errors the connection
// mid-body, forces GC + heap pressure to collect and reuse the cell, then
// calls `body.text()` and asserts it rejects with the real ECONNRESET error.

import net from "node:net";

async function once(): Promise<string> {
  const { promise: listening, resolve: onListening } = Promise.withResolvers<void>();
  const { promise: gotSocket, resolve: onSocket } = Promise.withResolvers<net.Socket>();

  const server = net.createServer(socket => {
    socket.on("error", () => {});
    socket.on("data", () => {
      // Send headers and a partial body; Content-Length promises more so the
      // HTTP client stays in "waiting for body" state.
      socket.write(
        "HTTP/1.1 200 OK\r\n" +
          "Content-Type: text/plain\r\n" +
          "Content-Length: 1000000\r\n" +
          "\r\n" +
          "hello",
        () => onSocket(socket),
      );
    });
  });
  server.listen(0, onListening);
  await listening;
  const port = (server.address() as net.AddressInfo).port;

  let body: ReadableStream<Uint8Array>;
  {
    // Scope `res` so it becomes unreachable after this block.
    const res = await fetch(`http://127.0.0.1:${port}/`);
    // Materialize the ReadableStream: sets FetchTasklet.readable_stream_ref
    // and creates the ByteStream, but does NOT start a read -> no pending
    // pull, no buffer_action.
    body = res.body!;
  }

  // Now that the client has headers + body stream, kill the connection.
  const socket = await gotSocket;
  const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
  socket.on("close", () => onClosed());
  socket.destroy();
  await closed;

  // Let the HTTP thread observe the close and enqueue onProgressUpdate ->
  // onBodyReceived -> ByteStream.onData(.err) -> append() stores the error
  // JSValue in `pending.result` on the heap.
  for (let i = 0; i < 10; i++) await new Promise<void>(r => setImmediate(r));

  // Collect the Response. Its deinit releases the ValueError Strong that was
  // the only root for the error JSValue now parked in ByteStream.pending.result.
  Bun.gc(true);
  await new Promise<void>(r => setImmediate(r));
  Bun.gc(true);

  // Pressure the GC heap so the freed error cell gets reused.
  const junk: unknown[] = [];
  for (let i = 0; i < 4000; i++) junk.push({ ["k" + i]: i });
  junk.length = 0;
  Bun.gc(true);

  // Ask the ByteStream for the buffered body. With the bug this surfaces a
  // freed JSCell as the rejection and crashes inside JSC.
  let caught: unknown;
  try {
    await body.text();
    caught = null;
  } catch (e) {
    caught = e;
  }

  server.close();

  if (caught instanceof Error && typeof (caught as NodeJS.ErrnoException).code === "string") {
    return "code=" + (caught as NodeJS.ErrnoException).code;
  }
  if (caught == null) return "resolved";
  return "non-error:" + String(caught);
}

// Run two iterations: the crash is GC-timing dependent, so give unfixed
// builds two chances to hit it while keeping the fixture fast in debug.
for (let i = 0; i < 2; i++) {
  const r = await once();
  if (r !== "code=ECONNRESET") {
    console.log(`FAIL[${i}]: ${r}`);
    process.exit(1);
  }
}
console.log("OK");
