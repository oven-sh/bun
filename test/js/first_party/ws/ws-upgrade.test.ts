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

  // Node + ws emit `upgrade` and `open` from the same socket-data turn with no
  // microtask checkpoint between them, so a microtask/nextTick queued inside the
  // `upgrade` handler runs after the socket is OPEN.
  it("does not drain microtasks between upgrade and open", async () => {
    const wss = new WebSocketServer({ port: 0 });
    wss.on("connection", () => {});

    const { promise, resolve, reject } = Promise.withResolvers<{ microtask: number; nextTick: number }>();
    const ws = new WebSocket("ws://localhost:" + wss.address().port);
    const states: { microtask?: number; nextTick?: number } = {};
    ws.on("upgrade", () => {
      // These are scheduled while still CONNECTING but must observe OPEN,
      // because `open` fires before the microtask/nextTick checkpoint.
      queueMicrotask(() => {
        states.microtask = ws.readyState;
      });
      process.nextTick(() => {
        states.nextTick = ws.readyState;
      });
    });
    ws.on("open", async () => {
      // After a macrotask turn both the microtask and the nextTick have run.
      await Bun.sleep(0);
      resolve(states as { microtask: number; nextTick: number });
    });
    ws.on("error", reject);

    const seen = await promise;
    expect(seen.microtask).toBe(WebSocket.OPEN);
    expect(seen.nextTick).toBe(WebSocket.OPEN);

    ws.close();
    await once(ws, "close");
    wss.close();
  });

  // Consequence of the ordering above: a `process.nextTick(() => ws.send(...))`
  // scheduled from the `upgrade` handler runs after `open`, so the socket is
  // OPEN and the send is delivered (rather than hitting InvalidStateError while
  // still CONNECTING).
  it("delivers a send scheduled from the upgrade handler", async () => {
    const wss = new WebSocketServer({ port: 0 });
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    wss.on("connection", server => {
      server.on("message", data => resolve(data.toString()));
    });

    const ws = new WebSocket("ws://localhost:" + wss.address().port);
    ws.on("upgrade", () => {
      process.nextTick(() => ws.send("from-upgrade"));
    });
    ws.on("error", reject);

    const received = await promise;
    expect(received).toBe("from-upgrade");

    ws.close();
    await once(ws, "close");
    wss.close();
  });
});
