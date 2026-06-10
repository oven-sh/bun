import { sleep } from "bun";
import { expect, test } from "bun:test";

test("HTTPResponseSink displays correct message", async () => {
  let leakedCtrl: any;
  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      return new Response(
        new ReadableStream({
          type: "direct",
          async pull(ctrl) {
            await ctrl.write("a");
            await sleep(10);
            await ctrl.write("b");
            ctrl.flush();
            leakedCtrl = ctrl;
          },
        } as any),
      );
    },
  });
  let response = await fetch(server.url);
  expect(await response.text()).toBe("ab");
  expect(() => leakedCtrl.write("c")).toThrow(
    'This HTTPResponseSink has already been closed. A "direct" ReadableStream terminates its underlying socket once `async pull()` returns.',
  );
  expect(() => leakedCtrl.write.call({}, "c")).toThrow("Expected HTTPResponseSink");
});

// https://github.com/oven-sh/bun/issues/28019
// A close-delimited HTTP/1.0 streaming response has no framing, so nothing but
// body bytes may be written once the body starts. Ending the sink while it
// still held buffered data used to route through uWS::internalEnd's
// content-length branch and inject "Content-Length: <n>\r\n\r\n" into the body.
test("ending an HTTP/1.0 streaming response does not inject a Content-Length header", async () => {
  const first = Buffer.alloc(65536, "x");
  const expectedBody = first.toString() + "Hello Bun!\n";
  const firstBytesReceived = Promise.withResolvers<void>();
  await using server = Bun.serve({
    port: 0,
    async fetch() {
      return new Response(
        new ReadableStream({
          type: "direct",
          async pull(ctrl) {
            // At or above the sink's highWaterMark: flushed to the socket
            // immediately, so the response body is started on the wire.
            ctrl.write(first);
            // Wait until the client holds body bytes before finishing.
            await firstBytesReceived.promise;
            // Below the highWaterMark: stays in the sink's buffer, so ending
            // the sink ends the response with buffered data left over.
            ctrl.write("Hello Bun!\n");
            ctrl.end();
          },
        } as any),
      );
    },
  });

  const { promise, resolve, reject } = Promise.withResolvers<string>();
  let received = "";
  let headerEnd = -1;
  await Bun.connect({
    hostname: server.hostname,
    port: server.port!,
    socket: {
      open(socket) {
        // HTTP/1.0 without keep-alive: the response is delimited by the
        // connection close, so the server streams it without chunked framing.
        socket.write(`GET / HTTP/1.0\r\nHost: ${server.hostname}\r\n\r\n`);
      },
      data(socket, data) {
        received += data.toString("latin1");
        if (headerEnd === -1) {
          headerEnd = received.indexOf("\r\n\r\n");
        }
        if (headerEnd !== -1) {
          const body = received.slice(headerEnd + 4);
          if (body.length > 0) {
            firstBytesReceived.resolve();
          }
          // A corrupted body has extra injected bytes, so it reaches the
          // expected length too; compare as soon as the length is there.
          if (body.length >= expectedBody.length) {
            resolve(body);
            socket.end();
          }
        }
      },
      close() {
        reject(new Error(`connection closed after ${received.length} bytes, before the full body arrived`));
      },
      error(_socket, error) {
        reject(error);
      },
    },
  });

  const body = await promise;
  // The first 64 KiB were already on the wire when the stream ended; anything
  // injected by the end path lands right after them.
  expect(body.slice(65536)).toBe(expectedBody.slice(65536));
  expect(body).toBe(expectedBody);
});
