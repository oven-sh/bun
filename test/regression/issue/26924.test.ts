import { expect, test, describe } from "bun:test";
import http from "node:http";

// https://github.com/oven-sh/bun/issues/26924
// node:http server should fall back to emitting 'request' when an upgrade
// request arrives but no 'upgrade' event listener is registered.

describe("node:http upgrade fallback to request", () => {
  test("emits 'request' when no 'upgrade' listener exists", async () => {
    const { promise: gotRequest, resolve: resolveRequest } = Promise.withResolvers<http.IncomingMessage>();

    const server = http.createServer((req, res) => {
      resolveRequest(req);
      res.writeHead(200);
      res.end("ok");
    });

    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = (server.address() as { port: number }).port;

      // Send a WebSocket upgrade request — server has no 'upgrade' listener,
      // so Node.js should fall back to emitting 'request'
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);

      const req = await gotRequest;
      expect(req.headers.upgrade).toBe("websocket");

      ws.close();
    } finally {
      server.close();
    }
  });

  test("emits 'upgrade' when listener exists", async () => {
    const { promise: gotUpgrade, resolve: resolveUpgrade } = Promise.withResolvers<http.IncomingMessage>();

    const server = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });

    server.on("upgrade", (req, socket) => {
      resolveUpgrade(req);
      socket.end();
    });

    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = (server.address() as { port: number }).port;

      const ws = new WebSocket(`ws://127.0.0.1:${port}`);

      const req = await gotUpgrade;
      expect(req.headers.upgrade).toBe("websocket");

      ws.close();
    } finally {
      server.close();
    }
  });
});
