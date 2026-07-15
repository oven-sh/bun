// https://github.com/oven-sh/bun/issues/4459
// http.Server#getConnections was not implemented.
import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";

describe("http.Server getConnections", () => {
  test("exists and reports the number of open connections", async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
    });

    expect(typeof server.getConnections).toBe("function");

    await once(server.listen(0), "listening");
    const { port } = server.address() as net.AddressInfo;

    try {
      const getConnections = () =>
        new Promise<number>((resolve, reject) => {
          server.getConnections((err, count) => {
            if (err) reject(err);
            else resolve(count);
          });
        });

      expect(await getConnections()).toBe(0);

      const sockets: net.Socket[] = [];
      let seen = 0;
      const sawAll = new Promise<void>(resolve => {
        server.on("connection", () => {
          if (++seen === 3) resolve();
        });
      });
      for (let i = 0; i < 3; i++) {
        const sock = net.connect({ port, host: "127.0.0.1" });
        await once(sock, "connect");
        // Send a request so the server observes the new connection.
        sock.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n");
        sockets.push(sock);
      }
      await sawAll;

      expect(await getConnections()).toBe(3);
      expect(server._connections).toBe(3);

      // Close one connection and ensure the count drops.
      const closing = sockets.pop()!;
      const closed = once(closing, "close");
      closing.destroy();
      await closed;
      while ((await getConnections()) > 2) {
        await new Promise(resolve => setImmediate(resolve));
      }
      expect(await getConnections()).toBe(2);

      for (const sock of sockets) sock.destroy();
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  test("callback receives (null, count) and returns this", async () => {
    const server = http.createServer(() => {});
    await once(server.listen(0), "listening");
    try {
      let sync = true;
      const { promise, resolve } = Promise.withResolvers<void>();
      const ret = server.getConnections((err, count) => {
        expect(sync).toBe(false);
        expect(err).toBeNull();
        expect(count).toBe(0);
        resolve();
      });
      sync = false;
      expect(ret).toBe(server);
      await promise;

      // Node passes the callback straight to process.nextTick, which validates
      // it and throws ERR_INVALID_ARG_TYPE for non-functions.
      expect(() => server.getConnections()).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
      expect(() => server.getConnections("not a function" as any)).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
      );
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  test("still reports open connections after close() is called", async () => {
    const server = http.createServer(() => {});
    const connected = new Promise<void>(resolve => server.once("connection", () => resolve()));
    await once(server.listen(0), "listening");
    const { port } = server.address() as net.AddressInfo;

    const sock = net.connect({ port, host: "127.0.0.1" });
    try {
      await once(sock, "connect");
      sock.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n");
      await connected;

      const getConnections = () =>
        new Promise<number>((resolve, reject) => {
          server.getConnections((err, n) => (err ? reject(err) : resolve(n)));
        });

      // close() stops accepting new connections but the existing one is still open.
      server.close();
      expect(await getConnections()).toBe(1);
      expect(server._connections).toBe(1);

      sock.destroy();
      while ((await getConnections()) > 0) {
        await new Promise(resolve => setImmediate(resolve));
      }
      expect(await getConnections()).toBe(0);
      expect(server._connections).toBe(0);
    } finally {
      sock.destroy();
      server.closeAllConnections();
    }
  });

  test("is usable inside a request handler (original report)", async () => {
    const server = http.createServer((req, res) => {
      server.getConnections((err, conns) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ err: err ?? null, count: conns }));
      });
    });
    await once(server.listen(0), "listening");
    const { port } = server.address() as net.AddressInfo;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      const body = await res.json();
      expect(body).toEqual({ err: null, count: 1 });
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
