import { test } from "bun:test";
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

// https://github.com/oven-sh/bun/issues/12040
test("ws.send callback works as expected", async () => {
  const httpServer = createServer();
  const { promise, resolve } = Promise.withResolvers();
  const { promise: promise2, resolve: resolve2 } = Promise.withResolvers();

  const wss = new WebSocketServer({
    server: httpServer,
    WebSocket,
  });

  wss.on("connection", ws => {
    // Following are two messages about to be sent, each with a slightly different way of calling the `ws.send` method:
    ws.send("foo", () => resolve());
    ws.send("bar", {}, () => resolve2());
  });

  const { promise: promise3, resolve: resolve3 } = Promise.withResolvers();
  httpServer.listen(0, () => resolve3());
  await promise3;

  var ws = new WebSocket("ws://localhost:" + httpServer.address().port);

  ws.on("message", msg => {});
  await Promise.all([promise, promise2]);
  ws.close();
  wss.close();
});
