// A worker is terminated while the `pull()` of its direct stream spins. The
// server ends that request without the stream. The chunk that the stream had
// buffered must not follow the response.
if (Bun.isMainThread) {
  const worker = new Worker(import.meta.url);
  const port = Promise.withResolvers<number>();
  worker.addEventListener("message", ({ data }) => {
    if (data === "spinning") worker.terminate();
    else port.resolve(data.port);
  });

  const chunks: Buffer[] = [];
  const closed = Promise.withResolvers<void>();
  await Bun.connect({
    hostname: "127.0.0.1",
    port: await port.promise,
    socket: {
      open(socket) {
        socket.write("GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
      },
      data(_socket, data) {
        chunks.push(data);
      },
      error() {},
      close() {
        closed.resolve();
      },
    },
  });
  await closed.promise;

  const wire = Buffer.concat(chunks).toString("latin1");
  const endOfHead = wire.indexOf("\r\n\r\n");
  console.log(
    JSON.stringify({
      statusLine: wire.split("\r\n")[0],
      // The response is complete: it declares no body, and its header section ends.
      contentLength: /\r\ncontent-length: (\d+)\r\n/i.exec(wire)?.[1],
      afterHead: endOfHead === -1 ? null : wire.slice(endOfHead + 4),
    }),
  );
} else {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () =>
      new Response(
        new ReadableStream({
          type: "direct",
          async pull(c: any) {
            c.write("chunk-a");
            await 1;
            postMessage("spinning");
            for (;;) {}
          },
        } as any),
      ),
  });
  postMessage({ port: server.port });
}
