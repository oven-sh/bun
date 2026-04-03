import { expect, test } from "bun:test";
import { once } from "events";
import { AddressInfo, createServer } from "net";
import { WebSocket } from "ws";

// https://github.com/oven-sh/bun/issues/24229
// miniflare's dispatchFetch resolves a deferred promise exclusively from the
// 'upgrade' or 'unexpected-response' events. If neither fires, wrangler dev hangs.
test("ws client resolves via 'upgrade' / 'unexpected-response' (miniflare pattern)", async () => {
  const server = createServer(socket => {
    socket.once("data", () => {
      socket.write("HTTP/1.1 503 Service Unavailable\r\nRetry-After: 1\r\n\r\nnot ready");
      socket.end();
    });
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const port = (server.address() as AddressInfo).port;

  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const { promise, resolve } = Promise.withResolvers<{ status: number; via: string }>();
    ws.once("upgrade", res => resolve({ status: res.statusCode!, via: "upgrade" }));
    ws.once("unexpected-response", (_req, res) => resolve({ status: res.statusCode!, via: "unexpected-response" }));

    const result = await promise;
    expect(result).toEqual({ status: 503, via: "unexpected-response" });
  } finally {
    server.close();
  }
});
