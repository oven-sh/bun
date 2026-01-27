import { describe, expect, it } from "bun:test";
import { tls } from "harness";

// Test for https://github.com/oven-sh/bun/issues/22870
// rejectUnauthorized should work at the top level of WebSocket options
// for compatibility with Node.js ws library
describe("WebSocket rejectUnauthorized option", () => {
  it("should accept rejectUnauthorized at top level", async () => {
    // Create a server with self-signed certificate
    using server = Bun.serve({
      port: 0,
      tls,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }
        return new Response("Upgrade failed", { status: 500 });
      },
      websocket: {
        open(ws) {
          ws.send("hello");
        },
        message(ws, message) {
          ws.send(message);
        },
      },
    });

    // This should work with rejectUnauthorized at top level
    const ws = new WebSocket(server.url.href.replace("https:", "wss:"), {
      rejectUnauthorized: false,
    });

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = e => reject(new Error(`WebSocket error: ${e}`));
    });

    const closed = new Promise(resolve => {
      ws.onclose = resolve;
    });
    ws.close();
    await closed;
  });

  it("should still accept rejectUnauthorized nested in tls object", async () => {
    // Create a server with self-signed certificate
    using server = Bun.serve({
      port: 0,
      tls,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }
        return new Response("Upgrade failed", { status: 500 });
      },
      websocket: {
        open(ws) {
          ws.send("hello");
        },
        message(ws, message) {
          ws.send(message);
        },
      },
    });

    // The nested tls object should still work
    const ws = new WebSocket(server.url.href.replace("https:", "wss:"), {
      tls: { rejectUnauthorized: false },
    });

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = e => reject(new Error(`WebSocket error: ${e}`));
    });

    const closed = new Promise(resolve => {
      ws.onclose = resolve;
    });
    ws.close();
    await closed;
  });

  it("should prefer tls.rejectUnauthorized over top-level rejectUnauthorized", async () => {
    // Create a server with self-signed certificate
    using server = Bun.serve({
      port: 0,
      tls,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }
        return new Response("Upgrade failed", { status: 500 });
      },
      websocket: {
        open(ws) {
          ws.send("hello");
        },
        message(ws, message) {
          ws.send(message);
        },
      },
    });

    // When both are specified, tls.rejectUnauthorized should take precedence
    // Here tls.rejectUnauthorized: false should allow connection even though top-level says true
    const ws = new WebSocket(server.url.href.replace("https:", "wss:"), {
      rejectUnauthorized: true,
      tls: { rejectUnauthorized: false },
    });

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = e => reject(new Error(`WebSocket error: ${e}`));
    });

    const closed = new Promise(resolve => {
      ws.onclose = resolve;
    });
    ws.close();
    await closed;
  });

  it("should fail with rejectUnauthorized: true against self-signed cert", async () => {
    // Create a server with self-signed certificate
    using server = Bun.serve({
      port: 0,
      tls,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }
        return new Response("Upgrade failed", { status: 500 });
      },
      websocket: {
        open(ws) {
          ws.send("hello");
        },
        message(ws, message) {
          ws.send(message);
        },
      },
    });

    // With rejectUnauthorized: true (or default), self-signed cert should be rejected
    const ws = new WebSocket(server.url.href.replace("https:", "wss:"), {
      rejectUnauthorized: true,
    });

    const errored = await new Promise<boolean>(resolve => {
      ws.onopen = () => {
        ws.close();
        resolve(false);
      };
      ws.onerror = () => {
        ws.close();
        resolve(true);
      };
    });

    expect(errored).toBe(true);
  });
});
