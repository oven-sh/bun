import { describe, expect, it } from "bun:test";
import { once } from "events";
import type { IncomingMessage } from "http";
import { WebSocket, WebSocketServer } from "ws";

// https://github.com/oven-sh/bun/issues/31406
//
// The `ws` client used to hardcode the `upgrade` event as "not implemented"
// and print a warning instead of firing it. Node's `ws` emits `upgrade` with
// the handshake response (an http.IncomingMessage) right before `open`. These
// tests use in-process servers (no subprocess spawning) so they run fast under
// the ASAN debug build.
describe("ws client upgrade event", () => {
  it("fires before open with the 101 handshake response", async () => {
    const wss = new WebSocketServer({ port: 0 });
    wss.on("connection", ws => ws.close());

    const order: string[] = [];
    const { promise, resolve, reject } = Promise.withResolvers<IncomingMessage>();

    const ws = new WebSocket("ws://localhost:" + wss.address().port);
    ws.on("upgrade", res => {
      order.push("upgrade");
      resolve(res);
    });
    ws.on("open", () => {
      order.push("open");
      ws.close();
    });
    ws.on("error", reject);

    const res = await promise;

    // `upgrade` must fire, and it must fire before `open` (as in node's ws).
    expect(order[0]).toBe("upgrade");
    // The argument is the handshake response (an http.IncomingMessage).
    expect(res.statusCode).toBe(101);
    expect(res.statusMessage).toBe("Switching Protocols");
    expect(res.httpVersion).toBe("1.1");
    expect(res.headers.upgrade?.toLowerCase()).toBe("websocket");
    expect(res.headers.connection?.toLowerCase()).toBe("upgrade");
    expect(typeof res.headers["sec-websocket-accept"]).toBe("string");
    expect(Array.isArray(res.rawHeaders)).toBe(true);

    await once(ws, "close");
    wss.close();
  });

  it("exposes custom handshake response headers", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (
          server.upgrade(req, {
            headers: { "X-Custom-Header": "custom-value", "Set-Cookie": "a=1" },
          })
        ) {
          return;
        }
        return new Response("no upgrade");
      },
      websocket: { open() {}, message() {} },
    });

    const { promise, resolve, reject } = Promise.withResolvers<IncomingMessage>();
    const ws = new WebSocket(server.url.href);
    ws.on("upgrade", resolve);
    ws.on("error", reject);
    // Close only after the connection is established to avoid racing the
    // in-flight handshake (upgrade fires while still CONNECTING).
    ws.on("open", () => ws.close());

    const res = await promise;
    expect(res.statusCode).toBe(101);
    expect(res.headers["x-custom-header"]).toBe("custom-value");
    // node's IncomingMessage represents set-cookie as an array.
    expect(res.headers["set-cookie"]).toEqual(["a=1"]);

    await once(ws, "close");
  });

  it("supports once() for upgrade", async () => {
    const wss = new WebSocketServer({ port: 0 });
    wss.on("connection", () => {});

    const { promise, resolve, reject } = Promise.withResolvers<IncomingMessage>();
    const ws = new WebSocket("ws://localhost:" + wss.address().port);
    ws.once("upgrade", resolve);
    ws.on("open", () => ws.close());
    ws.on("error", reject);
    const res = await promise;
    expect(res.statusCode).toBe(101);
    await once(ws, "close");

    wss.close();
  });

  // ws / EventEmitter consumers also subscribe via addListener /
  // prependListener / prependOnceListener; each must wire the native handshake
  // listener so `upgrade` actually fires.
  for (const method of ["addListener", "prependListener", "prependOnceListener"] as const) {
    it(`fires upgrade when subscribed via ${method}`, async () => {
      const wss = new WebSocketServer({ port: 0 });
      wss.on("connection", () => {});

      const { promise, resolve, reject } = Promise.withResolvers<IncomingMessage>();
      const ws = new WebSocket("ws://localhost:" + wss.address().port);
      ws[method]("upgrade", resolve);
      ws.on("open", () => ws.close());
      ws.on("error", reject);
      const res = await promise;
      expect(res.statusCode).toBe(101);
      await once(ws, "close");

      wss.close();
    });
  }
});
