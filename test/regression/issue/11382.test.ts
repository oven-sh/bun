import { describe, expect, test } from "bun:test";

describe("server.upgrade() with non-original Request", () => {
  test("new Request(req.url, req) should upgrade successfully", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        const newReq = new Request(req.url, req);
        if (server.upgrade(newReq)) return;
        return new Response("Upgrade failed", { status: 500 });
      },
      websocket: {
        open(ws) {
          ws.send("hello");
        },
        message() {},
      },
    });

    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const ws = new WebSocket(`ws://localhost:${server.port}`);
    ws.onmessage = e => resolve(e.data);
    ws.onerror = () => reject(new Error("WebSocket error"));

    expect(await promise).toBe("hello");
    ws.close();
  });

  test("req.clone() should upgrade successfully", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        const cloned = req.clone();
        if (server.upgrade(cloned)) return;
        return new Response("Upgrade failed", { status: 500 });
      },
      websocket: {
        open(ws) {
          ws.send("hello");
        },
        message() {},
      },
    });

    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const ws = new WebSocket(`ws://localhost:${server.port}`);
    ws.onmessage = e => resolve(e.data);
    ws.onerror = () => reject(new Error("WebSocket error"));

    expect(await promise).toBe("hello");
    ws.close();
  });

  test("new Request(req) should upgrade successfully", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        const newReq = new Request(req);
        if (server.upgrade(newReq)) return;
        return new Response("Upgrade failed", { status: 500 });
      },
      websocket: {
        open(ws) {
          ws.send("hello");
        },
        message() {},
      },
    });

    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const ws = new WebSocket(`ws://localhost:${server.port}`);
    ws.onmessage = e => resolve(e.data);
    ws.onerror = () => reject(new Error("WebSocket error"));

    expect(await promise).toBe("hello");
    ws.close();
  });

  test("original req should still upgrade after clone", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        // Clone the request but upgrade the original
        const _cloned = req.clone();
        if (server.upgrade(req)) return;
        return new Response("Upgrade failed", { status: 500 });
      },
      websocket: {
        open(ws) {
          ws.send("hello");
        },
        message() {},
      },
    });

    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const ws = new WebSocket(`ws://localhost:${server.port}`);
    ws.onmessage = e => resolve(e.data);
    ws.onerror = () => reject(new Error("WebSocket error"));

    expect(await promise).toBe("hello");
    ws.close();
  });
});
