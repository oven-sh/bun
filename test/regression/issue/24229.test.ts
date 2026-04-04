import { expect, test } from "bun:test";
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

async function port(server: any) {
  return (server.address() as AddressInfo).port;
}

test("ws handshake events: upgrade / unexpected-response", async () => {
  // 1. non-101 → 'unexpected-response' with status/headers/body + set-cookie array + whitespace trim
  {
    const server = await rawServer(
      "HTTP/1.1 503 Service Unavailable\r\n" +
        "Content-Type: text/plain\r\n" +
        "Set-Cookie: a=1\r\n" +
        "Set-Cookie: b=2\r\n" +
        "X-Multi: foo  \r\n" +
        "X-Multi:   bar  \r\n\r\nworkerd starting",
    );
    try {
      const ws = new WebSocket("ws://127.0.0.1:" + (await port(server)));
      const { promise, resolve } = Promise.withResolvers<IncomingMessage>();
      ws.once("unexpected-response", (req, res) => {
        expect(req).toBeNull();
        resolve(res);
      });
      const res = await promise;
      expect(res.statusCode).toBe(503);
      expect(res.statusMessage).toBe("Service Unavailable");
      expect(res.headers["content-type"]).toBe("text/plain");
      expect(res.headers["set-cookie"]).toEqual(["a=1", "b=2"]);
      expect(res.headers["x-multi"]).toBe("foo, bar");
      expect(res.rawHeaders).toEqual([
        "Content-Type",
        "text/plain",
        "Set-Cookie",
        "a=1",
        "Set-Cookie",
        "b=2",
        "X-Multi",
        "foo",
        "X-Multi",
        "bar",
      ]);
      let body = "";
      for await (const chunk of res) body += chunk.toString();
      expect(body).toBe("workerd starting");
      await once(ws, "close");
    } finally {
      server.close();
    }
  }

  // 2. non-101 without 'unexpected-response' listener → 'error' with status in message
  {
    const server = await rawServer("HTTP/1.1 503 Service Unavailable\r\n\r\n");
    try {
      const ws = new WebSocket("ws://127.0.0.1:" + (await port(server)));
      const { promise, resolve } = Promise.withResolvers<Error>();
      ws.on("error", resolve);
      expect((await promise).message).toBe("Unexpected server response: 503");
      await once(ws, "close");
    } finally {
      server.close();
    }
  }

  // 3. 101 → 'upgrade' fires BEFORE 'open'
  {
    const server = createServer(socket => {
      let buf = "";
      socket.on("data", chunk => {
        buf += chunk.toString();
        if (buf.indexOf("\r\n\r\n") === -1) return;
        const keyMatch = buf.match(/sec-websocket-key:\s*(.+)\r\n/i);
        if (!keyMatch) return socket.destroy();
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
    try {
      const ws = new WebSocket("ws://127.0.0.1:" + (await port(server)));
      const { promise, resolve } = Promise.withResolvers<IncomingMessage>();
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
  }
});
