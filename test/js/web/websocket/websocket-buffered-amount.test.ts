import { describe, expect, test } from "bun:test";
import crypto from "node:crypto";
import net from "node:net";

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

// Raw TCP server that completes the WebSocket handshake and then stops reading
// from the socket (`pause()`), so the client's outbound frames cannot drain to
// the peer and pile up in the in-process send buffer. `afterUpgrade`, when
// provided, runs once right after the handshake (read side still paused) to
// drive a specific close path, e.g. writing a frame or destroying the socket.
function nonDrainingServer(afterUpgrade?: (sock: net.Socket) => void): Promise<{ port: number; close: () => void }> {
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
        afterUpgrade?.(sock);
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

// A server must not mask the frames it sends; a masked frame is a protocol
// violation that makes the client abort the connection via the abrupt-close
// (fail) path rather than a graceful close handshake.
function maskedServerFrame(): Buffer {
  const payload = Buffer.from("x");
  // FIN + opcode 0x2 (binary), MASK bit set, 1-byte length, 4-byte mask key.
  const header = Buffer.from([0x82, 0x80 | payload.length, 0x01, 0x02, 0x03, 0x04]);
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i++) masked[i] ^= header[2 + (i % 4)];
  return Buffer.concat([header, masked]);
}

// A valid (unmasked) server Close frame with status 1000. Triggers the client's
// graceful close handshake (echo Close), not the abrupt-close path.
function serverCloseFrame(): Buffer {
  // FIN + opcode 0x8 (close), unmasked, 2-byte payload = status code 1000.
  return Buffer.from([0x88, 0x02, 0x03, 0xe8]);
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
      // The backlog must survive the close() transition: per spec bufferedAmount
      // does not reset to 0 once closed. close() snapshots the live backlog, so
      // afterClose stays essentially the whole queue (a few frames may flush to
      // the OS buffer between the two reads, so allow a small tolerance).
      expect(afterClose).toBeGreaterThan(beforeClose * 0.95);
    } finally {
      close();
    }
  });

  // Every send()/ping()/pong() overload must account for data queued after
  // close() the same way the spec requires for send() ("increase the
  // bufferedAmount attribute by the size of the data"). The Blob overloads were
  // the only ones that returned without accounting; they must now match their
  // String/ArrayBuffer/ArrayBufferView siblings. close() freezes m_bufferedAmount
  // and drops the connection, so each post-close call adds deterministically.
  test("send/ping/pong(Blob) after close() increase bufferedAmount like the other overloads", async () => {
    const blobBytes = 4096;
    const { port, close } = await nonDrainingServer();
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
      const { promise, resolve, reject } = Promise.withResolvers<number[]>();
      ws.onerror = () => reject(new Error("unexpected error event"));
      ws.onopen = () => {
        // After close() the state is CLOSING and the connection is released, so
        // bufferedAmount is a frozen snapshot plus post-close accumulation only.
        ws.close();
        const blob = () => new Blob([new Uint8Array(blobBytes)]);
        const samples = [ws.bufferedAmount];
        ws.send(blob());
        samples.push(ws.bufferedAmount);
        ws.ping(blob());
        samples.push(ws.bufferedAmount);
        ws.pong(blob());
        samples.push(ws.bufferedAmount);
        resolve(samples);
      };
      const samples = await promise;

      // Each Blob overload must add at least the blob's raw size. Before the fix
      // the Blob branch alone returned without touching bufferedAmount, so the
      // value would not move between samples.
      for (let i = 1; i < samples.length; i++) {
        expect(samples[i] - samples[i - 1]).toBeGreaterThanOrEqual(blobBytes);
      }
    } finally {
      close();
    }
  });

  // The abrupt-close path (protocol error / timeout / write failure) must also
  // preserve the backlog: the spec's "does not reset to 0" guarantee is not
  // limited to graceful close(). Here the server sends a masked frame (illegal
  // from a server), which aborts the client via the fail() path.
  test("does not reset to 0 on an abrupt close while a backlog is queued", async () => {
    const { port, close } = await nonDrainingServer(sock => sock.write(maskedServerFrame()));
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
      const { promise, resolve } = Promise.withResolvers<{ beforeClose: number; onClose: number }>();
      let beforeClose = 0;
      ws.onopen = () => {
        const chunk = Buffer.alloc(64 * 1024, 0x7b).toString();
        // Synchronous flood: completes before the event loop processes the
        // server's incoming masked frame, so the backlog is queued first.
        for (let i = 0; i < 4000; i++) ws.send(chunk);
        beforeClose = ws.bufferedAmount;
      };
      // The illegal frame aborts the connection; bufferedAmount read in the
      // close handler must still reflect the queued backlog.
      ws.onclose = () => resolve({ beforeClose, onClose: ws.bufferedAmount });
      ws.onerror = () => {};
      const { beforeClose: queued, onClose } = await promise;

      expect(queued).toBeGreaterThan(64 * 1024);
      // Must not reset to 0 on the abrupt close: the backlog is still queued.
      // (Not an exact match: a few frames may drain between the read above and
      // the close, so assert it stays a large backlog rather than an exact value.)
      expect(onClose).toBeGreaterThan(64 * 1024);
    } finally {
      close();
    }
  });

  // The server-initiated close (peer sends a valid Close frame) is a fourth
  // close path. With an undrainable backlog the client defers the close until
  // the transport dies, so the peer drops the connection right after the Close
  // frame; the close event must still preserve the backlog, not reset it to 0.
  test("does not reset to 0 on a server-initiated close while a backlog is queued", async () => {
    // Stop reading so the client's sends pile up, send a valid Close frame, then
    // drop the connection so the deferred close completes.
    const { port, close } = await nonDrainingServer(sock => {
      sock.write(serverCloseFrame());
      sock.destroy();
    });
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
      const { promise, resolve } = Promise.withResolvers<{ beforeClose: number; onClose: number }>();
      let beforeClose = 0;
      ws.onopen = () => {
        const chunk = Buffer.alloc(64 * 1024, 0x7c).toString();
        for (let i = 0; i < 4000; i++) ws.send(chunk);
        beforeClose = ws.bufferedAmount;
      };
      ws.onclose = () => resolve({ beforeClose, onClose: ws.bufferedAmount });
      ws.onerror = () => {};
      const { beforeClose: queued, onClose } = await promise;

      expect(queued).toBeGreaterThan(64 * 1024);
      // The backlog must survive the server-initiated close.
      expect(onClose).toBeGreaterThan(64 * 1024);
    } finally {
      close();
    }
  });

  // An abrupt socket close (no WebSocket Close handshake) while a backlog is
  // queued must also preserve bufferedAmount. Depending on the platform's event
  // loop this routes through either handle_close() (socket-close callback) or
  // handle_end() -> fail(); both snapshot the backlog before freeing it.
  test("does not reset to 0 on an abrupt socket close while a backlog is queued", async () => {
    // Stop reading so the client's sends pile up, then abruptly destroy the
    // connection (sends FIN; the client's own writes to the closed peer may then
    // draw an RST); no WebSocket Close handshake either way.
    const { port, close } = await nonDrainingServer(sock => sock.destroy());
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
      const { promise, resolve } = Promise.withResolvers<{ beforeClose: number; onClose: number }>();
      let beforeClose = 0;
      ws.onopen = () => {
        const chunk = Buffer.alloc(64 * 1024, 0x7d).toString();
        for (let i = 0; i < 4000; i++) ws.send(chunk);
        beforeClose = ws.bufferedAmount;
      };
      ws.onclose = () => resolve({ beforeClose, onClose: ws.bufferedAmount });
      ws.onerror = () => {};
      const { beforeClose: queued, onClose } = await promise;

      expect(queued).toBeGreaterThan(64 * 1024);
      // The backlog must survive the abrupt socket close.
      expect(onClose).toBeGreaterThan(64 * 1024);
    } finally {
      close();
    }
  });
});
