import { expect, test } from "bun:test";
import { once } from "events";
import { AddressInfo, createServer } from "net";

// https://github.com/oven-sh/bun/issues/24229
// https://github.com/oven-sh/bun/issues/5951
//
// The native WebSocket client now surfaces the handshake response to JS via
// a 'handshake' event (statusCode + statusMessage + rawHeaders + body) so the `ws` package shim can
// emit 'upgrade' / 'unexpected-response'. Previously non-101 responses were
// silently discarded, which made miniflare's `dispatchFetch` hang forever.
//
// Tests the native 'handshake' event directly — what the ws.js shim consumes.
test("WebSocket 'handshake' event surfaces status/head/body on non-101", async () => {
  const server = createServer(socket =>
    socket.once("data", () =>
      socket.end(
        "HTTP/1.1 503 Service Unavailable\r\n" +
          "Content-Type: text/plain\r\n" +
          "Set-Cookie: a=1\r\n" +
          "Set-Cookie: b=2\r\n" +
          "X-Multi: foo  \r\n\r\nworkerd starting",
      ),
    ),
  ).listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    const ws = new WebSocket("ws://127.0.0.1:" + (server.address() as AddressInfo).port);
    ws.addEventListener("error", () => {}); // swallow the expected-101 error
    const { promise, resolve } = Promise.withResolvers<{
      statusCode: number;
      statusMessage: string;
      rawHeaders: string[];
      body: Uint8Array;
    }>();
    // 'handshake' is a Bun extension consumed by the ws package shim.
    ws.addEventListener("handshake" as any, ((e: MessageEvent) => resolve(e.data as any)) as any);
    const { statusCode, statusMessage, rawHeaders, body } = await promise;

    expect(statusCode).toBe(503);
    expect(statusMessage).toBe("Service Unavailable");
    expect(rawHeaders).toEqual([
      "Content-Type",
      "text/plain",
      "Set-Cookie",
      "a=1",
      "Set-Cookie",
      "b=2",
      "X-Multi",
      "foo",
    ]);
    expect(body).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(body)).toBe("workerd starting");
  } finally {
    server.close();
  }
});
