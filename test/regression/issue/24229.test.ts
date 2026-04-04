import { describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import { once } from "events";
import type { IncomingMessage } from "http";
import { AddressInfo, createServer } from "net";
import { WebSocket } from "ws";

// https://github.com/oven-sh/bun/issues/24229
// https://github.com/oven-sh/bun/issues/5951
//
// Bun's `ws` shim was missing the 'upgrade' and 'unexpected-response' events.
// miniflare's `dispatchFetch` resolves a deferred promise exclusively from
// those two events, so wrangler dev would hang forever on a non-101 response.

async function rawServer(response: string) {
  const server = createServer(socket => socket.once("data", () => socket.end(response))).listen(0, "127.0.0.1");
  await once(server, "listening");
  return server;
}

describe("ws handshake events", () => {
  test("ws client resolves via 'upgrade' / 'unexpected-response' (miniflare pattern)", async () => {
    const server = await rawServer("HTTP/1.1 503 Service Unavailable\r\nRetry-After: 1\r\n\r\nnot ready");
    try {
      const ws = new WebSocket("ws://127.0.0.1:" + (server.address() as AddressInfo).port);
      const { promise, resolve } = Promise.withResolvers<{ status: number; via: string }>();
      ws.once("upgrade", res => resolve({ status: res.statusCode!, via: "upgrade" }));
      ws.once("unexpected-response", (_req, res) => resolve({ status: res.statusCode!, via: "unexpected-response" }));

      expect(await promise).toEqual({ status: 503, via: "unexpected-response" });
    } finally {
      server.close();
    }
  });

  test("emits 'unexpected-response' with status, headers and body on non-101", async () => {
    const server = await rawServer(
      "HTTP/1.1 503 Service Unavailable\r\nContent-Type: text/plain\r\nX-Reason: not-ready\r\n\r\nworkerd starting",
    );
    const { promise, resolve, reject } = Promise.withResolvers<IncomingMessage>();
    try {
      const ws = new WebSocket("ws://127.0.0.1:" + (server.address() as AddressInfo).port);
      ws.on("error", reject);
      ws.once("unexpected-response", (req, res) => {
        expect(req).toBeNull();
        resolve(res);
      });

      const res = await promise;
      expect(res.statusCode).toBe(503);
      expect(res.statusMessage).toBe("Service Unavailable");
      expect(res.headers["content-type"]).toBe("text/plain");
      expect(res.headers["x-reason"]).toBe("not-ready");
      let body = "";
      for await (const chunk of res) body += chunk.toString();
      expect(body).toBe("workerd starting");
      await once(ws, "close");
    } finally {
      server.close();
    }
  });

  test("keeps 'set-cookie' as array and trims whitespace (Node compat)", async () => {
    const server = await rawServer(
      "HTTP/1.1 503 Service Unavailable\r\n" +
        "Set-Cookie: a=1\r\n" +
        "Set-Cookie: b=2\r\n" +
        "X-Multi: foo  \r\n" +
        "X-Multi:   bar  \r\n\r\n",
    );
    const { promise, resolve } = Promise.withResolvers<IncomingMessage>();
    try {
      const ws = new WebSocket("ws://127.0.0.1:" + (server.address() as AddressInfo).port);
      ws.once("unexpected-response", (_req, res) => resolve(res));
      const res = await promise;
      expect(res.headers["set-cookie"]).toEqual(["a=1", "b=2"]);
      expect(res.headers["x-multi"]).toBe("foo, bar");
      expect(res.rawHeaders).toEqual(["Set-Cookie", "a=1", "Set-Cookie", "b=2", "X-Multi", "foo", "X-Multi", "bar"]);
      await once(ws, "close");
    } finally {
      server.close();
    }
  });

  test("emits 'error' with status code when no 'unexpected-response' listener", async () => {
    const server = await rawServer("HTTP/1.1 503 Service Unavailable\r\n\r\n");
    const { promise, resolve } = Promise.withResolvers<Error>();
    try {
      const ws = new WebSocket("ws://127.0.0.1:" + (server.address() as AddressInfo).port);
      ws.on("error", resolve);
      expect((await promise).message).toBe("Unexpected server response: 503");
      await once(ws, "close");
    } finally {
      server.close();
    }
  });

  test("emits 'upgrade' with headers before 'open' on 101", async () => {
    // Fake a WS 101 handshake on a raw TCP socket so this test doesn't spin up
    // a real WebSocketServer (ws's server leaks uWS resources under ASAN).
    const server = createServer(socket => {
      let buf = "";
      socket.on("data", chunk => {
        buf += chunk.toString();
        const headerEnd = buf.indexOf("\r\n\r\n");
        if (headerEnd === -1) return;
        const keyMatch = buf.match(/sec-websocket-key:\s*(.+)\r\n/i);
        if (!keyMatch) {
          socket.destroy();
          return;
        }
        const accept = createHash("sha1")
          .update(keyMatch[1].trim() + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
          .digest("base64");
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            "Sec-WebSocket-Accept: " +
            accept +
            "\r\n\r\n",
        );
      });
    }).listen(0, "127.0.0.1");
    await once(server, "listening");
    const { promise, resolve } = Promise.withResolvers<IncomingMessage>();
    try {
      const ws = new WebSocket("ws://127.0.0.1:" + (server.address() as AddressInfo).port);
      const order: string[] = [];
      ws.on("upgrade", res => {
        order.push("upgrade");
        resolve(res);
      });
      ws.on("open", () => {
        order.push("open");
        ws.close();
      });

      const res = await promise;
      expect(res.statusCode).toBe(101);
      expect(res.headers["sec-websocket-accept"]).toBeString();
      expect(res.headers["upgrade"]?.toLowerCase()).toBe("websocket");
      await once(ws, "close");
      expect(order).toEqual(["upgrade", "open"]);
    } finally {
      server.close();
    }
  });
});
