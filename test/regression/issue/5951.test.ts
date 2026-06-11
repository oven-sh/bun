// https://github.com/oven-sh/bun/issues/5951
//
// Frameworks like next-ws wrap the `socket` argument passed to
// `WebSocketServer#handleUpgrade` in a Proxy that hides symbol properties.
// Bun's internal `ws` implementation previously read `kBunInternals`
// (`::bunternal::`) directly from the socket to recover the underlying
// Request object. When the symbol was hidden by a wrapper the upgrade
// failed with `TypeError: upgrade requires a Request object`.
//
// This regression test reproduces the next-ws wrapping pattern and
// asserts the upgrade completes and messages flow both ways.

import { once } from "node:events";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { expect, test } from "bun:test";

test("handleUpgrade works when socket is wrapped in a Proxy that hides symbol properties (#5951)", async () => {
  const wss = new WebSocketServer({ noServer: true });
  const httpServer = createServer();

  const serverReceived = Promise.withResolvers<string>();
  const clientReceived = Promise.withResolvers<string>();

  wss.on("connection", (ws, request: IncomingMessage) => {
    expect(request.url).toBe("/chat");
    ws.on("message", data => serverReceived.resolve(data.toString()));
    ws.send("hello from server");
  });

  httpServer.on("upgrade", (request, socket, head) => {
    // Simulate next-ws / http-proxy: the socket argument is wrapped in a
    // Proxy that returns undefined for any symbol-keyed property, hiding
    // the hidden `::bunternal::` symbol that Bun's ws shim relies on.
    // Regular properties still forward to the real socket so writes and
    // method calls keep working.
    const wrappedSocket = new Proxy(socket, {
      get(target, prop, receiver) {
        if (typeof prop === "symbol") return undefined;
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
      has(target, prop) {
        if (typeof prop === "symbol") return false;
        return Reflect.has(target, prop);
      },
    });

    wss.handleUpgrade(request, wrappedSocket as typeof socket, head, ws => {
      wss.emit("connection", ws, request);
    });
  });

  httpServer.listen(0, "127.0.0.1");
  await once(httpServer, "listening");

  try {
    const { port } = httpServer.address() as AddressInfo;
    const client = new WebSocket(`ws://127.0.0.1:${port}/chat`);
    client.on("message", data => clientReceived.resolve(data.toString()));
    await once(client, "open");
    client.send("hello from client");

    expect(await serverReceived.promise).toBe("hello from client");
    expect(await clientReceived.promise).toBe("hello from server");

    client.close();
  } finally {
    wss.close();
    httpServer.close();
    httpServer.closeAllConnections();
  }
});
