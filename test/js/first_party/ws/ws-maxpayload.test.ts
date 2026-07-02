import { describe, expect, it } from "bun:test";
import { once } from "events";
import { createServer } from "http";
import { AddressInfo } from "net";
import { WebSocket, WebSocketServer } from "ws";

// https://github.com/oven-sh/bun/issues/33284
// The `ws` WebSocketServer `maxPayload` option was ignored under Bun: oversized
// frames were delivered to the message handler instead of being rejected.
describe("maxPayload", () => {
  const MAX = 4096;

  it("rejects an oversized text message with a RangeError and a 1009 close", async () => {
    const wss = new WebSocketServer({ port: 0, maxPayload: MAX });
    const serverOutcome = Promise.withResolvers<{ type: string; err?: any; length?: number }>();
    const clientClose = Promise.withResolvers<number>();

    wss.on("connection", serverWs => {
      serverWs.on("message", message => serverOutcome.resolve({ type: "message", length: message.length }));
      serverWs.on("error", err => serverOutcome.resolve({ type: "error", err }));
    });

    const ws = new WebSocket("ws://localhost:" + (wss.address() as AddressInfo).port);
    ws.on("open", () => ws.send(Buffer.alloc(MAX + 1, "A").toString()));
    ws.on("close", code => clientClose.resolve(code));
    ws.on("error", () => {});

    try {
      const outcome = await serverOutcome.promise;
      expect(outcome.type).toBe("error");
      expect(outcome.err).toBeInstanceOf(RangeError);
      expect(outcome.err.message).toBe("Max payload size exceeded");
      expect(outcome.err.code).toBe("WS_ERR_UNSUPPORTED_MESSAGE_LENGTH");
      expect(await clientClose.promise).toBe(1009);
    } finally {
      wss.close();
    }
  });

  it("rejects an oversized binary message with a RangeError and a 1009 close", async () => {
    const wss = new WebSocketServer({ port: 0, maxPayload: MAX });
    const serverOutcome = Promise.withResolvers<{ type: string; err?: any; length?: number }>();
    const clientClose = Promise.withResolvers<number>();

    wss.on("connection", serverWs => {
      serverWs.on("message", message => serverOutcome.resolve({ type: "message", length: message.length }));
      serverWs.on("error", err => serverOutcome.resolve({ type: "error", err }));
    });

    const ws = new WebSocket("ws://localhost:" + (wss.address() as AddressInfo).port);
    ws.on("open", () => ws.send(Buffer.alloc(MAX + 1, 1)));
    ws.on("close", code => clientClose.resolve(code));
    ws.on("error", () => {});

    try {
      const outcome = await serverOutcome.promise;
      expect(outcome.type).toBe("error");
      expect(outcome.err).toBeInstanceOf(RangeError);
      expect(outcome.err.message).toBe("Max payload size exceeded");
      expect(outcome.err.code).toBe("WS_ERR_UNSUPPORTED_MESSAGE_LENGTH");
      expect(await clientClose.promise).toBe(1009);
    } finally {
      wss.close();
    }
  });

  it("delivers a message that is exactly maxPayload bytes", async () => {
    const wss = new WebSocketServer({ port: 0, maxPayload: MAX });
    const serverOutcome = Promise.withResolvers<{ type: string; length?: number }>();

    wss.on("connection", serverWs => {
      serverWs.on("message", message => serverOutcome.resolve({ type: "message", length: message.length }));
      serverWs.on("error", () => serverOutcome.resolve({ type: "error", length: 0 }));
    });

    const ws = new WebSocket("ws://localhost:" + (wss.address() as AddressInfo).port);
    ws.on("open", () => ws.send(Buffer.alloc(MAX, "A").toString()));
    ws.on("error", () => {});

    try {
      const outcome = await serverOutcome.promise;
      expect(outcome).toEqual({ type: "message", length: MAX });
    } finally {
      wss.close();
    }
  });

  it("enforces maxPayload in noServer mode", async () => {
    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX });
    const httpServer = createServer();
    const serverOutcome = Promise.withResolvers<{ type: string; err?: any }>();
    const clientClose = Promise.withResolvers<number>();

    httpServer.on("upgrade", (request, socket, head) => {
      wss.handleUpgrade(request, socket, head, ws => wss.emit("connection", ws, request));
    });
    wss.on("connection", serverWs => {
      serverWs.on("message", () => serverOutcome.resolve({ type: "message" }));
      serverWs.on("error", err => serverOutcome.resolve({ type: "error", err }));
    });

    httpServer.listen(0);
    await once(httpServer, "listening");

    const ws = new WebSocket("ws://localhost:" + (httpServer.address() as AddressInfo).port);
    ws.on("open", () => ws.send(Buffer.alloc(MAX + 1, "A").toString()));
    ws.on("close", code => clientClose.resolve(code));
    ws.on("error", () => {});

    try {
      const outcome = await serverOutcome.promise;
      expect(outcome.type).toBe("error");
      expect(outcome.err).toBeInstanceOf(RangeError);
      expect(outcome.err.message).toBe("Max payload size exceeded");
      expect(await clientClose.promise).toBe(1009);
    } finally {
      wss.close();
      httpServer.close();
    }
  });

  it("emits the server 'error' event before 'close'", async () => {
    const wss = new WebSocketServer({ port: 0, maxPayload: MAX });
    const order: string[] = [];
    const serverClosed = Promise.withResolvers<void>();

    wss.on("connection", serverWs => {
      serverWs.on("error", () => order.push("error"));
      serverWs.on("close", () => {
        order.push("close");
        serverClosed.resolve();
      });
    });

    const ws = new WebSocket("ws://localhost:" + (wss.address() as AddressInfo).port);
    ws.on("open", () => ws.send(Buffer.alloc(MAX + 1, "A").toString()));
    ws.on("error", () => {});

    try {
      await serverClosed.promise;
      expect(order).toEqual(["error", "close"]);
    } finally {
      wss.close();
    }
  });
});
