// A `req.signal` abort listener uses the controller of a direct stream while
// an abort tears the request down. The listener runs after the server has
// given the response up, so nothing it does must reach that response.
//
//   write  The client leaves. The listener writes and flushes.
//   end    The client leaves. The listener ends the stream.
//   flush  The producer stops the server while a flush(true) waits for a
//          client that does not read, with a later write still buffered. The
//          listener calls flush(true) again.
const scenario = process.argv[2];
const heard: string[] = [];
const large = Buffer.alloc(32 * 1024 * 1024, "x");
const stopped = Promise.withResolvers<void>();

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req) {
    let controller: any;
    req.signal.addEventListener("abort", () => {
      if (scenario === "end") return void heard.push(`end:${controller.end()}`);
      if (scenario === "flush") heard.push(`flush(true) again:${Bun.peek.status(controller.flush(true))}`);
      heard.push(`write:${controller.write("late")}`, `flush:${controller.flush()}`);
    });
    return new Response(
      new ReadableStream({
        type: "direct",
        async pull(c: any) {
          controller = c;
          if (scenario === "flush") {
            // The handler has returned by then: the stop aborts a response that is in flight.
            await new Promise(resolve => setImmediate(resolve));
            c.write(large);
            heard.push(`flush(true):${Bun.peek.status(c.flush(true))}`);
            c.write("small");
            server.stop(true);
            stopped.resolve();
          } else {
            c.write("chunk-a");
            await c.flush();
          }
          await new Promise(() => {});
        },
        cancel(reason: unknown) {
          heard.push(`cancel:${reason}`);
        },
      } as any),
    );
  },
});

const closed = Promise.withResolvers<void>();
const client = await Bun.connect({
  hostname: "127.0.0.1",
  port: server.port!,
  socket: {
    open(socket) {
      if (scenario === "flush") socket.pause();
      socket.write("GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
    },
    data(socket, data) {
      if (data.includes("chunk-a")) socket.end();
    },
    error() {},
    close() {
      closed.resolve();
    },
  },
});
// A client that does not read does not see the close either.
if (scenario === "flush") await stopped.promise.then(() => client.resume());
await closed.promise;
// The server hears the close on a later turn of the event loop, and frees the
// socket one turn after that. A request that it never lets go shows in the result.
const deadline = Date.now() + 2000;
while (server.pendingRequests > 0 && Date.now() < deadline) await new Promise(resolve => setImmediate(resolve));
await new Promise(resolve => setImmediate(resolve));

console.log(JSON.stringify({ heard, pendingRequests: server.pendingRequests }));
server.stop(true);
