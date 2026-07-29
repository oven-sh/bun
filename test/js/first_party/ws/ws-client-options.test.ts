import { describe, expect, it } from "bun:test";
import { once } from "events";
import net, { AddressInfo } from "net";
import { WebSocket } from "ws";

describe("maxPayload", () => {
  async function testMaxPayload(sendText: boolean) {
    await using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response(null, { status: 404 });
      },
      websocket: {
        perMessageDeflate: false,
        open(ws) {
          const payload = Buffer.alloc(100_000, "x");
          ws.send(sendText ? payload.toString() : payload);
        },
        message() {},
      },
    });

    const { promise, resolve, reject } = Promise.withResolvers<number>();
    const ws = new WebSocket(server.url.href.replace("http", "ws"), { maxPayload: 1024 });
    ws.on("message", data => reject(new Error(`received ${(data as Buffer).length} bytes; maxPayload ignored`)));
    // npm ws emits a RangeError before 'close'; accept either ordering but
    // always assert the close code unconditionally.
    ws.on("error", () => {});
    ws.on("close", code => resolve(code));

    expect(await promise).toBe(1009);
  }

  it("closes with 1009 when a text frame exceeds the limit", async () => {
    await testMaxPayload(true);
  });

  it("closes with 1009 when a binary frame exceeds the limit", async () => {
    await testMaxPayload(false);
  });

  it("delivers messages at or below the limit", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response(null, { status: 404 });
      },
      websocket: {
        perMessageDeflate: false,
        open(ws) {
          ws.send(Buffer.alloc(1024, "x").toString());
        },
        message() {},
      },
    });

    const { promise, resolve, reject } = Promise.withResolvers<number>();
    const ws = new WebSocket(server.url.href.replace("http", "ws"), { maxPayload: 1024 });
    try {
      ws.on("message", data => resolve((data as Buffer).length));
      ws.on("error", reject);
      ws.on("close", code => reject(new Error(`closed ${code} before message`)));

      expect(await promise).toBe(1024);
    } finally {
      ws.removeAllListeners();
      ws.close();
    }
  });

  it("treats 0 as unlimited", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response(null, { status: 404 });
      },
      websocket: {
        perMessageDeflate: false,
        open(ws) {
          ws.send(Buffer.alloc(100_000, "x").toString());
        },
        message() {},
      },
    });

    const { promise, resolve, reject } = Promise.withResolvers<number>();
    const ws = new WebSocket(server.url.href.replace("http", "ws"), { maxPayload: 0 });
    try {
      ws.on("message", data => resolve((data as Buffer).length));
      ws.on("error", reject);
      ws.on("close", code => reject(new Error(`closed ${code} before message`)));

      expect(await promise).toBe(100_000);
    } finally {
      ws.removeAllListeners();
      ws.close();
    }
  });
});

describe("handshakeTimeout", () => {
  it("emits 'error' when the server never completes the upgrade", async () => {
    const sockets: net.Socket[] = [];
    const srv = net.createServer(s => {
      sockets.push(s);
    });
    let ws: WebSocket | undefined;
    try {
      await once(srv.listen(0, "127.0.0.1"), "listening");
      const port = (srv.address() as AddressInfo).port;

      const events: unknown[] = [];
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      ws = new WebSocket(`ws://127.0.0.1:${port}`, { handshakeTimeout: 500 });
      ws.on("open", () => reject(new Error("should not open")));
      ws.on("error", err => events.push({ event: "error", message: (err as Error).message }));
      ws.on("close", code => {
        events.push({ event: "close", code });
        resolve();
      });

      await promise;
      expect(events).toEqual([
        { event: "error", message: "Opening handshake has timed out" },
        { event: "close", code: 1006 },
      ]);
    } finally {
      ws?.removeAllListeners();
      ws?.terminate();
      for (const s of sockets) s.destroy();
      await new Promise<void>(r => srv.close(() => r()));
    }
  });

  it("does not fire when the connection opens in time", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response(null, { status: 404 });
      },
      websocket: { open() {}, message() {} },
    });

    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const ws = new WebSocket(server.url.href.replace("http", "ws"), { handshakeTimeout: 60_000 });
    try {
      ws.on("open", () => resolve("open"));
      ws.on("error", err => reject(err));

      expect(await promise).toBe("open");
      const { promise: closed, resolve: onClose } = Promise.withResolvers<void>();
      ws.on("close", () => onClose());
      ws.close();
      await closed;
    } finally {
      ws.removeAllListeners();
      ws.terminate();
    }
  });
});
