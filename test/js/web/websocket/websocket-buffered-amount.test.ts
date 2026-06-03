import { describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import net from "node:net";

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

// Raw TCP server that completes the WebSocket handshake and then stops reading
// from the socket (`pause()`), so the client's outbound frames cannot drain to
// the peer and pile up in the in-process send buffer.
function nonDrainingServer(): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer(sock => {
      let buf = "";
      let upgraded = false;
      sock.on("data", d => {
        if (upgraded) return;
        buf += d.toString("latin1");
        if (!buf.includes("\r\n\r\n")) return;
        const key = /sec-websocket-key:\s*(.+)\r\n/i.exec(buf)?.[1]?.trim() ?? "";
        const accept = crypto
          .createHash("sha1")
          .update(key + WS_MAGIC)
          .digest("base64");
        sock.write(
          "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
        );
        upgraded = true;
        sock.pause(); // never read the client's frames
      });
      sock.on("error", () => {});
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as net.AddressInfo;
      resolve({ port: address.port, close: () => server.close() });
    });
  });
}

describe("WebSocket.bufferedAmount (client)", () => {
  test("reflects the backlog queued to a peer that stopped reading", async () => {
    const { port, close } = await nonDrainingServer();
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
      const { promise, resolve, reject } = Promise.withResolvers<{ atOpen: number; max: number }>();
      ws.onerror = () => reject(new Error("unexpected error event"));
      ws.onopen = () => {
        // Nothing queued yet: the baseline must be 0, not a constant.
        const atOpen = ws.bufferedAmount;
        const chunk = Buffer.alloc(64 * 1024, 0x79).toString();
        let max = atOpen;
        // 4000 * 64 KiB = ~250 MiB — far more than any socket buffer can accept,
        // so the excess must queue in-process.
        for (let i = 0; i < 4000; i++) {
          ws.send(chunk);
          if (ws.bufferedAmount > max) max = ws.bufferedAmount;
        }
        resolve({ atOpen, max });
      };
      const { atOpen, max } = await promise;
      ws.close();

      // Baseline with nothing queued.
      expect(atOpen).toBe(0);
      // Before the fix, bufferedAmount was hard-wired to 0 for the client
      // WebSocket. It must now track the unsent backlog — which is far larger
      // than a single 64 KiB frame once the peer stops reading.
      expect(max).toBeGreaterThan(64 * 1024);
    } finally {
      close();
    }
  });

  // Per the WHATWG spec, bufferedAmount "does not reset to zero once the
  // connection closes" — after close() it only increases with further send().
  test("does not reset to 0 after close() while a backlog is queued", async () => {
    const { port, close } = await nonDrainingServer();
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
      const { promise, resolve, reject } = Promise.withResolvers<{ beforeClose: number; afterClose: number }>();
      ws.onerror = () => reject(new Error("unexpected error event"));
      ws.onopen = () => {
        const chunk = Buffer.alloc(64 * 1024, 0x7a).toString();
        for (let i = 0; i < 4000; i++) ws.send(chunk);
        const beforeClose = ws.bufferedAmount;
        ws.close();
        // Reading immediately after close() must retain the queued backlog,
        // not snap back to 0.
        const afterClose = ws.bufferedAmount;
        resolve({ beforeClose, afterClose });
      };
      const { beforeClose, afterClose } = await promise;

      expect(beforeClose).toBeGreaterThan(64 * 1024);
      // The backlog must survive the close() transition.
      expect(afterClose).toBe(beforeClose);
    } finally {
      close();
    }
  });
});
