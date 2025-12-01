// Regression test for https://github.com/oven-sh/bun/issues/12053
// http.Agent connection pool was not reusing connections due to:
// 1. Case-insensitive header matching issue in src/http.zig
// 2. Property typo: keepalive vs keepAlive in src/js/node/_http_client.ts

import { describe, expect, test } from "bun:test";
import http from "node:http";
import net from "node:net";

describe("http.Agent connection reuse (#12053)", () => {
  test("custom agent with maxSockets: 1 reuses socket across requests", async () => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    const sockets: Set<unknown> = new Set();

    const server = http.createServer((req, res) => {
      res.writeHead(200, { Connection: "keep-alive" });
      res.end("OK");
    });

    await new Promise<void>(resolve => server.listen(0, resolve));
    const { port } = server.address() as { port: number };

    const makeRequest = () =>
      new Promise<void>((resolve, reject) => {
        const req = http.get(
          {
            hostname: "localhost",
            port,
            agent,
            path: "/",
          },
          res => {
            sockets.add(res.socket);
            res.on("data", () => {});
            res.on("end", resolve);
          },
        );
        req.on("error", reject);
      });

    try {
      // Make 3 sequential requests
      for (let i = 0; i < 3; i++) {
        await makeRequest();
        await new Promise(r => setImmediate(r));
      }

      // All requests should use the same socket
      expect(sockets.size).toBe(1);
    } finally {
      agent.destroy();
      server.close();
    }
  });

  test("req.reusedSocket is true on subsequent requests", async () => {
    const agent = new http.Agent({ keepAlive: true });

    const server = http.createServer((req, res) => {
      res.writeHead(200, { Connection: "keep-alive" });
      res.end("OK");
    });

    await new Promise<void>(resolve => server.listen(0, resolve));
    const { port } = server.address() as { port: number };

    const makeRequest = () =>
      new Promise<http.ClientRequest>((resolve, reject) => {
        const req = http.get(
          {
            hostname: "localhost",
            port,
            agent,
            path: "/",
          },
          res => {
            res.on("data", () => {});
            res.on("end", () => resolve(req));
          },
        );
        req.on("error", reject);
      });

    try {
      const req1 = await makeRequest();
      expect(req1.reusedSocket).toBeFalsy();

      await new Promise(r => setImmediate(r));

      const req2 = await makeRequest();
      expect(req2.reusedSocket).toBe(true);
    } finally {
      agent.destroy();
      server.close();
    }
  });

  test("socket is added to freeSockets pool after request", async () => {
    const agent = new http.Agent({ keepAlive: true });

    const server = http.createServer((req, res) => {
      res.writeHead(200, { Connection: "keep-alive" });
      res.end("OK");
    });

    await new Promise<void>(resolve => server.listen(0, resolve));
    const { port } = server.address() as { port: number };

    try {
      await new Promise<void>((resolve, reject) => {
        http
          .get(
            {
              hostname: "localhost",
              port,
              agent,
              path: "/",
            },
            res => {
              res.on("data", () => {});
              res.on("end", resolve);
            },
          )
          .on("error", reject);
      });

      await new Promise(r => setImmediate(r));

      const name = agent.getName({ host: "localhost", port });
      expect(agent.freeSockets[name]?.length).toBe(1);
    } finally {
      agent.destroy();
      server.close();
    }
  });

  describe("Connection header case-insensitivity", () => {
    const headerVariations = ["keep-alive", "Keep-Alive", "KEEP-ALIVE"];

    for (const connectionValue of headerVariations) {
      test(`handles Connection: "${connectionValue}" header`, async () => {
        const agent = new http.Agent({ keepAlive: true });

        // Use raw net.createServer to control exact header casing
        const server = net.createServer(socket => {
          socket.on("data", () => {
            socket.write(
              "HTTP/1.1 200 OK\r\n" + `Connection: ${connectionValue}\r\n` + "Content-Length: 2\r\n" + "\r\n" + "OK",
            );
          });
        });

        await new Promise<void>(resolve => server.listen(0, resolve));
        const { port } = server.address() as { port: number };

        const makeRequest = () =>
          new Promise<http.ClientRequest>((resolve, reject) => {
            const req = http.get(
              {
                hostname: "localhost",
                port,
                agent,
                path: "/",
              },
              res => {
                res.on("data", () => {});
                res.on("end", () => resolve(req));
              },
            );
            req.on("error", reject);
          });

        try {
          const req1 = await makeRequest();
          expect(req1.reusedSocket).toBeFalsy();

          await new Promise(r => setImmediate(r));

          // Verify socket is in freeSockets pool
          const name = agent.getName({ host: "localhost", port });
          expect(agent.freeSockets[name]?.length).toBe(1);

          // Second request should reuse socket
          const req2 = await makeRequest();
          expect(req2.reusedSocket).toBe(true);
        } finally {
          agent.destroy();
          server.close();
        }
      });
    }
  });

  test("Connection: close prevents socket reuse", async () => {
    const agent = new http.Agent({ keepAlive: true });
    const sockets: Set<unknown> = new Set();

    // Use raw net.createServer to send Connection: close
    const server = net.createServer(socket => {
      socket.on("data", () => {
        socket.write("HTTP/1.1 200 OK\r\n" + "Connection: close\r\n" + "Content-Length: 2\r\n" + "\r\n" + "OK");
        socket.end();
      });
    });

    await new Promise<void>(resolve => server.listen(0, resolve));
    const { port } = server.address() as { port: number };

    const makeRequest = () =>
      new Promise<http.ClientRequest>((resolve, reject) => {
        const req = http.get(
          {
            hostname: "localhost",
            port,
            agent,
            path: "/",
          },
          res => {
            sockets.add(res.socket);
            res.on("data", () => {});
            res.on("end", () => resolve(req));
          },
        );
        req.on("error", reject);
      });

    try {
      const req1 = await makeRequest();
      expect(req1.reusedSocket).toBeFalsy();

      await new Promise(r => setImmediate(r));

      // freeSockets should be empty since server sent Connection: close
      const name = agent.getName({ host: "localhost", port });
      expect(agent.freeSockets[name]).toBeUndefined();

      const req2 = await makeRequest();
      expect(req2.reusedSocket).toBeFalsy();

      // Each request should have used a different socket
      expect(sockets.size).toBe(2);
    } finally {
      agent.destroy();
      server.close();
    }
  });

  test("agent with keepAlive: false does not reuse sockets", async () => {
    const agent = new http.Agent({ keepAlive: false });

    const server = http.createServer((req, res) => {
      res.writeHead(200, { Connection: "keep-alive" });
      res.end("OK");
    });

    await new Promise<void>(resolve => server.listen(0, resolve));
    const { port } = server.address() as { port: number };

    const makeRequest = () =>
      new Promise<http.ClientRequest>((resolve, reject) => {
        const req = http.get(
          {
            hostname: "localhost",
            port,
            agent,
            path: "/",
          },
          res => {
            res.on("data", () => {});
            res.on("end", () => resolve(req));
          },
        );
        req.on("error", reject);
      });

    try {
      await makeRequest();
      await new Promise(r => setImmediate(r));

      // freeSockets should be empty since keepAlive: false
      const name = agent.getName({ host: "localhost", port });
      expect(agent.freeSockets[name]).toBeUndefined();

      const req2 = await makeRequest();
      expect(req2.reusedSocket).toBeFalsy();
    } finally {
      agent.destroy();
      server.close();
    }
  });
});
