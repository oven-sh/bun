import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { unlinkSync } from "node:fs";
import { join } from "node:path";

describe("WebSocket over Unix domain sockets", () => {
  test("should connect using ws+unix:// URL scheme", async () => {
    using dir = tempDir("websocket-unix", {});
    const socketPath = join(String(dir), "test.sock");

    const server = Bun.serve({
      port: 0,
      unix: socketPath,
      websocket: {
        open(ws) {
          ws.send("Hello from server");
        },
        message(ws, message) {
          ws.send(`Echo: ${message}`);
        },
      },
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }
        return new Response("Expected WebSocket upgrade", { status: 400 });
      },
    });

    try {
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      const ws = new WebSocket(`ws+unix://${socketPath.replaceAll("\\", "/")}:/`);

      let messagesReceived: string[] = [];

      ws.onopen = () => {
        ws.send("Hello from client");
      };

      ws.onmessage = event => {
        messagesReceived.push(event.data);
        if (messagesReceived.length === 2) {
          resolve("success");
        }
      };

      ws.onerror = event => {
        reject(new Error(`WebSocket error: ${event}`));
      };

      await promise;

      expect(messagesReceived).toEqual(["Hello from server", "Echo: Hello from client"]);

      ws.close();
    } finally {
      server.stop();
      try {
        unlinkSync(socketPath);
      } catch {}
    }
  });

  test("should fail gracefully on invalid ws+unix:// URL", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const ws = new WebSocket("ws+unix:///nonexistent/socket.sock:/");

    ws.onerror = () => {
      resolve();
    };

    ws.onopen = () => {
      reject(new Error("Should not have connected to nonexistent socket"));
    };

    await promise;
  });

  test("should handle query string in ws+unix:// URL", async () => {
    using dir = tempDir("websocket-unix-query", {});
    const socketPath = join(String(dir), "test.sock");

    let receivedUrl = "";
    const server = Bun.serve({
      port: 0,
      unix: socketPath,
      websocket: {
        open(ws) {
          ws.send("connected");
        },
      },
      fetch(req, server) {
        receivedUrl = req.url;
        if (server.upgrade(req)) {
          return;
        }
        return new Response("Expected WebSocket upgrade", { status: 400 });
      },
    });

    try {
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const ws = new WebSocket(`ws+unix://${socketPath.replaceAll("\\", "/")}:/api/endpoint?foo=bar&baz=qux`);

      ws.onmessage = () => {
        resolve();
      };

      ws.onerror = event => {
        reject(new Error(`WebSocket error: ${event}`));
      };

      await promise;

      expect(receivedUrl).toContain("/api/endpoint?foo=bar&baz=qux");

      ws.close();
    } finally {
      server.stop();
      try {
        unlinkSync(socketPath);
      } catch {}
    }
  });

  test("should handle empty path after colon in ws+unix:// URL", async () => {
    using dir = tempDir("websocket-unix-empty-path", {});
    const socketPath = join(String(dir), "test.sock");

    let receivedPath = "";
    const server = Bun.serve({
      port: 0,
      unix: socketPath,
      websocket: {
        open(ws) {
          ws.send("connected");
        },
      },
      fetch(req, server) {
        const url = new URL(req.url);
        receivedPath = url.pathname + url.search;
        if (server.upgrade(req)) {
          return;
        }
        return new Response("Expected WebSocket upgrade", { status: 400 });
      },
    });

    try {
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const ws = new WebSocket(`ws+unix://${socketPath.replaceAll("\\", "/")}:`);

      ws.onmessage = () => {
        resolve();
      };

      ws.onerror = event => {
        reject(new Error(`WebSocket error: ${event}`));
      };

      await promise;

      expect(receivedPath).toMatch(/\/$/);

      ws.close();
    } finally {
      server.stop();
      try {
        unlinkSync(socketPath);
      } catch {}
    }
  });

  test("should handle path without leading slash in ws+unix:// URL", async () => {
    using dir = tempDir("websocket-unix-no-slash", {});
    const socketPath = join(String(dir), "test.sock");

    let receivedPath = "";
    const server = Bun.serve({
      port: 0,
      unix: socketPath,
      websocket: {
        open(ws) {
          ws.send("connected");
        },
      },
      fetch(req, server) {
        const url = new URL(req.url);
        receivedPath = url.pathname + url.search;
        if (server.upgrade(req)) {
          return;
        }
        return new Response("Expected WebSocket upgrade", { status: 400 });
      },
    });

    try {
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const ws = new WebSocket(`ws+unix://${socketPath.replaceAll("\\", "/")}:api/test`);

      ws.onmessage = () => {
        resolve();
      };

      ws.onerror = event => {
        reject(new Error(`WebSocket error: ${event}`));
      };

      await promise;

      expect(receivedPath).toMatch(/\/api\/test$/);

      ws.close();
    } finally {
      server.stop();
      try {
        unlinkSync(socketPath);
      } catch {}
    }
  });
});
