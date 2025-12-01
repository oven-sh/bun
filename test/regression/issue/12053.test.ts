// Regression test for https://github.com/oven-sh/bun/issues/12053
// http.Agent connection pool was not reusing connections due to:
// 1. Case-insensitive header matching issue in src/http.zig
// 2. Property typo: keepalive vs keepAlive in src/js/node/_http_client.ts
//
// Note: Bun implements http.request via fetch() internally, so we test
// connection reuse at the network level (server-side socket tracking)
// rather than relying on agent.freeSockets or req.reusedSocket which
// are Node.js-specific socket pooling features.

import { describe, expect, test } from "bun:test";
import http from "node:http";
import net from "node:net";

describe("http.Agent connection reuse (#12053)", () => {
  test.each([
    { keepAlive: true, expectedSockets: 1, description: "reuses TCP connection" },
    { keepAlive: false, expectedSockets: 2, description: "creates new TCP connection per request" },
  ])("agent with keepAlive: $keepAlive $description", async ({ keepAlive, expectedSockets }) => {
    const agent = new http.Agent({ keepAlive });
    const serverSockets: Set<net.Socket> = new Set();

    // Track server-side sockets to verify connection reuse
    const server = net.createServer(socket => {
      serverSockets.add(socket);
      socket.on("data", () => {
        socket.write("HTTP/1.1 200 OK\r\n" + "Connection: keep-alive\r\n" + "Content-Length: 2\r\n" + "\r\n" + "OK");
      });
    });

    await new Promise<void>(resolve => server.listen(0, resolve));
    const { port } = server.address() as { port: number };

    const makeRequest = () =>
      new Promise<void>((resolve, reject) => {
        http
          .get({ hostname: "localhost", port, agent, path: "/" }, res => {
            res.on("data", () => {});
            res.on("end", resolve);
          })
          .on("error", reject);
      });

    try {
      await makeRequest();
      await makeRequest();

      expect(serverSockets.size).toBe(expectedSockets);
    } finally {
      agent.destroy();
      server.close();
    }
  });

  describe("Connection header case-insensitivity", () => {
    test.each(["keep-alive", "Keep-Alive", "KEEP-ALIVE"])(
      'reuses connection when server sends Connection: "%s"',
      async connectionValue => {
        const agent = new http.Agent({ keepAlive: true });
        const serverSockets: Set<net.Socket> = new Set();

        // Use raw net.createServer to control exact header casing
        const server = net.createServer(socket => {
          serverSockets.add(socket);
          socket.on("data", () => {
            socket.write(`HTTP/1.1 200 OK\r\nConnection: ${connectionValue}\r\nContent-Length: 2\r\n\r\nOK`);
          });
        });

        await new Promise<void>(resolve => server.listen(0, resolve));
        const { port } = server.address() as { port: number };

        const makeRequest = () =>
          new Promise<void>((resolve, reject) => {
            http
              .get({ hostname: "localhost", port, agent, path: "/" }, res => {
                res.on("data", () => {});
                res.on("end", resolve);
              })
              .on("error", reject);
          });

        try {
          await makeRequest();
          await makeRequest();

          // Both requests should reuse the same TCP connection
          expect(serverSockets.size).toBe(1);
        } finally {
          agent.destroy();
          server.close();
        }
      },
    );
  });

  test.each(["close", "CLOSE"])('Connection: "%s" prevents TCP connection reuse', async connectionValue => {
    const agent = new http.Agent({ keepAlive: true });
    const serverSockets: Set<net.Socket> = new Set();

    const server = net.createServer(socket => {
      serverSockets.add(socket);
      socket.on("data", () => {
        socket.write(`HTTP/1.1 200 OK\r\nConnection: ${connectionValue}\r\nContent-Length: 2\r\n\r\nOK`);
        socket.end();
      });
    });

    await new Promise<void>(resolve => server.listen(0, resolve));
    const { port } = server.address() as { port: number };

    const makeRequest = () =>
      new Promise<void>((resolve, reject) => {
        http
          .get({ hostname: "localhost", port, agent, path: "/" }, res => {
            res.on("data", () => {});
            res.on("end", resolve);
          })
          .on("error", reject);
      });

    try {
      await makeRequest();
      await makeRequest();

      // Each request should create a new TCP connection due to Connection: close/CLOSE
      expect(serverSockets.size).toBe(2);
    } finally {
      agent.destroy();
      server.close();
    }
  });

  test("multiple sequential requests reuse same TCP connection", async () => {
    const agent = new http.Agent({ keepAlive: true });
    const serverSockets: Set<net.Socket> = new Set();
    const REQUEST_COUNT = 5;

    const server = net.createServer(socket => {
      serverSockets.add(socket);
      socket.on("data", () => {
        socket.write("HTTP/1.1 200 OK\r\n" + "Connection: keep-alive\r\n" + "Content-Length: 2\r\n" + "\r\n" + "OK");
      });
    });

    await new Promise<void>(resolve => server.listen(0, resolve));
    const { port } = server.address() as { port: number };

    const makeRequest = () =>
      new Promise<void>((resolve, reject) => {
        http
          .get({ hostname: "localhost", port, agent, path: "/" }, res => {
            res.on("data", () => {});
            res.on("end", resolve);
          })
          .on("error", reject);
      });

    try {
      for (let i = 0; i < REQUEST_COUNT; i++) {
        await makeRequest();
      }

      // All requests should reuse the same TCP connection
      expect(serverSockets.size).toBe(1);
    } finally {
      agent.destroy();
      server.close();
    }
  });
});
