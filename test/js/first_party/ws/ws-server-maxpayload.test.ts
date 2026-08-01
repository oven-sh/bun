import { describe, expect, it } from "bun:test";
import { once } from "events";
import { createServer } from "http";
import { AddressInfo } from "net";
import { WebSocket, WebSocketServer } from "ws";

// https://github.com/oven-sh/bun/issues/8261
// The `ws` WebSocketServer `maxPayload` option was ignored: Bun applied a fixed
// 16 MiB native limit regardless of the value passed, so a smaller limit let
// oversized frames through and a larger limit still rejected frames above the
// native default.
describe("WebSocketServer maxPayload", () => {
  const SMALL = 4096;

  it.concurrent("rejects a message larger than maxPayload with a RangeError on the server socket", async () => {
    const wss = new WebSocketServer({ port: 0, maxPayload: SMALL });
    const serverEvents: any[] = [];
    const serverDone = Promise.withResolvers<void>();
    const clientClose = Promise.withResolvers<number>();

    wss.on("connection", serverWs => {
      serverWs.on("message", m => serverEvents.push({ type: "message", length: (m as Buffer).length }));
      serverWs.on("error", err => serverEvents.push({ type: "error", err }));
      serverWs.on("close", code => {
        serverEvents.push({ type: "close", code });
        serverDone.resolve();
      });
    });

    const ws = new WebSocket("ws://127.0.0.1:" + (wss.address() as AddressInfo).port);
    ws.on("open", () => ws.send(new Uint8Array(64 * 1024)));
    ws.on("close", code => clientClose.resolve(code));
    ws.on("error", () => {});

    try {
      await serverDone.promise;
      // Server side matches npm `ws`: 'error' (RangeError, WS_ERR_UNSUPPORTED_MESSAGE_LENGTH)
      // fires before 'close' (1009), and no 'message' event is emitted.
      expect(serverEvents).toHaveLength(2);
      expect(serverEvents[0].type).toBe("error");
      expect(serverEvents[0].err).toBeInstanceOf(RangeError);
      expect(serverEvents[0].err.message).toBe("Max payload size exceeded");
      expect(serverEvents[0].err.code).toBe("WS_ERR_UNSUPPORTED_MESSAGE_LENGTH");
      expect(serverEvents[1]).toEqual({ type: "close", code: 1009 });
      expect(await clientClose.promise).toBe(1009);
    } finally {
      ws.close();
      wss.close();
    }
  });

  // Just over Bun.serve's 16 MiB websocket default, to prove the native cap is
  // raised without shipping a needlessly large payload through a debug build.
  const BIG = 17 * 1024 * 1024;

  it.concurrent("accepts a message larger than Bun.serve's 16 MiB default when maxPayload is raised", async () => {
    const wss = new WebSocketServer({ port: 0, maxPayload: BIG + 1024 });
    const serverOutcome = Promise.withResolvers<{ type: string; length?: number; code?: number }>();

    wss.on("connection", serverWs => {
      serverWs.on("message", m => serverOutcome.resolve({ type: "message", length: (m as Buffer).length }));
      serverWs.on("error", () => serverOutcome.resolve({ type: "error" }));
      serverWs.on("close", code => serverOutcome.resolve({ type: "close", code }));
    });

    const ws = new WebSocket("ws://127.0.0.1:" + (wss.address() as AddressInfo).port);
    ws.on("open", () => ws.send(new Uint8Array(BIG)));
    ws.on("error", () => {});

    try {
      const outcome = await serverOutcome.promise;
      expect(outcome).toEqual({ type: "message", length: BIG });
    } finally {
      ws.close();
      wss.close();
    }
  });

  it.concurrent("delivers a message that is exactly maxPayload bytes", async () => {
    const wss = new WebSocketServer({ port: 0, maxPayload: SMALL });
    const serverOutcome = Promise.withResolvers<{ type: string; length?: number }>();

    wss.on("connection", serverWs => {
      serverWs.on("message", m => serverOutcome.resolve({ type: "message", length: (m as Buffer).length }));
      serverWs.on("error", () => serverOutcome.resolve({ type: "error" }));
    });

    const ws = new WebSocket("ws://127.0.0.1:" + (wss.address() as AddressInfo).port);
    ws.on("open", () => ws.send(new Uint8Array(SMALL)));
    ws.on("error", () => {});

    try {
      expect(await serverOutcome.promise).toEqual({ type: "message", length: SMALL });
    } finally {
      ws.close();
      wss.close();
    }
  });

  it.concurrent("raises the native limit when attached to an already-listening server (server mode)", async () => {
    const httpServer = createServer((req, res) => res.end("ok"));
    httpServer.listen(0);
    await once(httpServer, "listening");
    const port = (httpServer.address() as AddressInfo).port;

    // Attaching with a maxPayload above Bun.serve's default reloads the native
    // listener; plain HTTP requests on the same server must keep working.
    expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe("ok");

    const wss = new WebSocketServer({ server: httpServer, maxPayload: BIG + 1024 });
    const serverOutcome = Promise.withResolvers<{ type: string; length?: number; code?: number }>();

    expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe("ok");

    wss.on("connection", serverWs => {
      serverWs.on("message", m => serverOutcome.resolve({ type: "message", length: (m as Buffer).length }));
      serverWs.on("error", () => serverOutcome.resolve({ type: "error" }));
      serverWs.on("close", code => serverOutcome.resolve({ type: "close", code }));
    });

    const ws = new WebSocket("ws://127.0.0.1:" + port);
    ws.on("open", () => ws.send(new Uint8Array(BIG)));
    ws.on("error", () => {});

    try {
      const outcome = await serverOutcome.promise;
      expect(outcome).toEqual({ type: "message", length: BIG });
    } finally {
      ws.close();
      wss.close();
      httpServer.close();
    }
  });

  it.concurrent("enforces maxPayload in noServer mode", async () => {
    const wss = new WebSocketServer({ noServer: true, maxPayload: SMALL });
    const httpServer = createServer();
    const serverOutcome = Promise.withResolvers<{ type: string; err?: any }>();

    httpServer.on("upgrade", (request, socket, head) => {
      wss.handleUpgrade(request, socket, head, ws => wss.emit("connection", ws, request));
    });
    wss.on("connection", serverWs => {
      serverWs.on("message", () => serverOutcome.resolve({ type: "message" }));
      serverWs.on("error", err => serverOutcome.resolve({ type: "error", err }));
    });

    httpServer.listen(0);
    await once(httpServer, "listening");

    const ws = new WebSocket("ws://127.0.0.1:" + (httpServer.address() as AddressInfo).port);
    ws.on("open", () => ws.send(new Uint8Array(64 * 1024)));
    ws.on("error", () => {});

    try {
      const outcome = await serverOutcome.promise;
      expect(outcome.type).toBe("error");
      expect(outcome.err).toBeInstanceOf(RangeError);
    } finally {
      ws.close();
      wss.close();
      httpServer.close();
    }
  });

  it.concurrent("applies per-WebSocketServer limits when two share one http server", async () => {
    const httpServer = createServer();
    httpServer.listen(0);
    await once(httpServer, "listening");

    const strict = new WebSocketServer({ noServer: true, maxPayload: SMALL });
    const loose = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

    httpServer.on("upgrade", (request, socket, head) => {
      const which = request.url === "/loose" ? loose : strict;
      which.handleUpgrade(request, socket, head, ws => which.emit("connection", ws, request));
    });

    const strictOutcome = Promise.withResolvers<string>();
    const looseOutcome = Promise.withResolvers<{ type: string; length?: number }>();
    strict.on("connection", ws => {
      ws.on("message", () => strictOutcome.resolve("message"));
      ws.on("error", () => strictOutcome.resolve("error"));
    });
    loose.on("connection", ws => {
      ws.on("message", m => looseOutcome.resolve({ type: "message", length: (m as Buffer).length }));
      ws.on("error", () => looseOutcome.resolve({ type: "error" }));
    });

    const port = (httpServer.address() as AddressInfo).port;
    const payload = new Uint8Array(64 * 1024);

    const c1 = new WebSocket(`ws://127.0.0.1:${port}/strict`);
    c1.on("open", () => c1.send(payload));
    c1.on("error", () => {});
    const c2 = new WebSocket(`ws://127.0.0.1:${port}/loose`);
    c2.on("open", () => c2.send(payload));
    c2.on("error", () => {});

    try {
      expect(await strictOutcome.promise).toBe("error");
      expect(await looseOutcome.promise).toEqual({ type: "message", length: 64 * 1024 });
    } finally {
      c1.close();
      c2.close();
      strict.close();
      loose.close();
      httpServer.close();
    }
  });
});
