import { describe, expect, it, test } from "bun:test";
import { tls } from "harness";
import crypto from "node:crypto";
import net from "node:net";
import nodeTls from "node:tls";

const CHUNK = new Uint8Array(64 * 1024);
const TOTAL = 1024; // 64 MiB, far past any socket/TLS buffer
const TOTAL_BYTES = TOTAL * CHUNK.byteLength;
// Each binary frame is header (10 bytes for a 64 KiB payload) + 4-byte mask + payload.
const FRAMING_PER_CHUNK = 14;

// A raw origin that completes the WebSocket upgrade and then reads only when
// told to, so the client's send side has to queue. It sees plaintext frames
// (TLS, when any, terminates here or at the proxy), so the byte count it
// resolves on is payload plus framing.
function rawOrigin(secure: boolean) {
  const { promise: upgraded, resolve: resolveUpgraded } = Promise.withResolvers<net.Socket>();
  let received = 0;
  const { promise: gotAll, resolve: resolveGotAll } = Promise.withResolvers<void>();
  function onConnection(sock: net.Socket) {
    sock.once("data", head => {
      const key = /Sec-WebSocket-Key: (.+)\r\n/.exec(head.toString("latin1"))![1].trim();
      const accept = crypto
        .createHash("sha1")
        .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
        .digest("base64");
      sock.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      sock.pause();
      sock.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (received >= TOTAL * (CHUNK.byteLength + FRAMING_PER_CHUNK)) resolveGotAll();
      });
      resolveUpgraded(sock);
    });
    sock.on("error", () => {});
  }
  const server = secure
    ? nodeTls.createServer({ key: tls.key, cert: tls.cert }, onConnection)
    : net.createServer(onConnection);
  return {
    listen: () =>
      new Promise<number>(resolve =>
        server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port)),
      ),
    upgraded,
    gotAll,
    close: () => server.close(),
  };
}

async function pipingConnectProxy(secure: boolean): Promise<{ port: number; close(): void }> {
  function onConnection(client: net.Socket) {
    client.once("data", head => {
      const match = /^CONNECT ([^:]+):(\d+) /.exec(head.toString("latin1"));
      if (!match) {
        client.destroy();
        return;
      }
      const upstream = net.connect(Number(match[2]), match[1], () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.on("error", () => client.destroy());
      client.on("error", () => upstream.destroy());
    });
  }
  const server = secure
    ? nodeTls.createServer({ key: tls.key, cert: tls.cert }, onConnection)
    : net.createServer(onConnection);
  const port = await new Promise<number>(resolve =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port)),
  );
  return { port, close: () => server.close() };
}

function open(ws: WebSocket): Promise<void> {
  return new Promise(resolve => (ws.onopen = () => resolve()));
}

const MODES = [
  { name: "ws", secure: false, proxy: null },
  { name: "wss", secure: true, proxy: null },
  { name: "wss via http:// proxy", secure: true, proxy: "http" },
  { name: "wss via https:// proxy", secure: true, proxy: "https" },
  { name: "ws via https:// proxy", secure: false, proxy: "https" },
] as const;

for (const mode of MODES) {
  describe(`WebSocket.bufferedAmount (${mode.name})`, () => {
    it("counts bytes the peer has not accepted and drains to 0", async () => {
      const origin = rawOrigin(mode.secure);
      const originPort = await origin.listen();
      const proxy = mode.proxy ? await pipingConnectProxy(mode.proxy === "https") : undefined;
      try {
        const ws = new WebSocket(`${mode.secure ? "wss" : "ws"}://127.0.0.1:${originPort}`, {
          tls: { rejectUnauthorized: false },
          ...(proxy ? { proxy: `${mode.proxy}://127.0.0.1:${proxy.port}` } : {}),
        });
        await open(ws);
        const peer = await origin.upgraded;
        expect(ws.bufferedAmount).toBe(0);

        for (let i = 0; i < TOTAL; i++) ws.send(CHUNK);

        // The kernel and any proxy absorbed some; the rest is ours to report.
        const queued = ws.bufferedAmount;
        expect(queued).toBeGreaterThan(TOTAL_BYTES / 2);
        expect(queued).toBeLessThanOrEqual(TOTAL * (CHUNK.byteLength + FRAMING_PER_CHUNK));

        // Only what the kernel can still absorb drains while the peer isn't reading.
        await new Promise(resolve => setImmediate(resolve));
        expect(ws.bufferedAmount).toBeLessThanOrEqual(queued);
        expect(ws.bufferedAmount).toBeGreaterThan(TOTAL_BYTES / 2);

        peer.resume();
        await origin.gotAll;
        expect(ws.bufferedAmount).toBe(0);
        ws.close();
      } finally {
        proxy?.close();
        origin.close();
      }
    }, 60_000);
  });
}

describe("WebSocket.bufferedAmount", () => {
  it("is 0 once a small message has been written", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response();
      },
      websocket: {
        message(ws, message) {
          ws.send(message);
        },
      },
    });
    const ws = new WebSocket(`ws://localhost:${server.port}`);
    await open(ws);
    const { promise: echoed, resolve } = Promise.withResolvers<string>();
    ws.onmessage = ({ data }) => resolve(data);
    ws.send("hello");
    expect(await echoed).toBe("hello");
    expect(ws.bufferedAmount).toBe(0);
    ws.close();
  });

  it("ws package reports the same number", async () => {
    const { WebSocket: WS } = await import("ws");
    const origin = rawOrigin(false);
    const originPort = await origin.listen();
    try {
      const ws = new WS(`ws://127.0.0.1:${originPort}`);
      await new Promise(resolve => ws.once("open", resolve));
      const peer = await origin.upgraded;
      expect(ws.bufferedAmount).toBe(0);
      for (let i = 0; i < TOTAL; i++) ws.send(CHUNK);
      expect(ws.bufferedAmount).toBeGreaterThan(TOTAL_BYTES / 2);
      peer.resume();
      await origin.gotAll;
      expect(ws.bufferedAmount).toBe(0);
      ws.close();
    } finally {
      origin.close();
    }
  }, 60_000);
});

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

// Raw TCP server that completes the WebSocket handshake and then stops reading
// from the socket (`pause()`), so the client's outbound frames cannot drain to
// the peer and pile up in the in-process send buffer. `afterUpgrade`, when
// provided, runs once right after the handshake (read side still paused) to
// drive a specific behaviour: resume reading, write a frame, or destroy the
// socket.
function nonDrainingServer(afterUpgrade?: (sock: net.Socket) => void): Promise<{ port: number; close: () => void }> {
  return new Promise((resolve, reject) => {
    // Track live sockets so close() can destroy them. server.close() only stops
    // accepting; after the deferred-close refactor a backlogged ws.close() waits
    // for the socket to die, so leaving the paused peer alive pins the client's
    // multi-MB send buffer for the rest of the run.
    const sockets = new Set<net.Socket>();
    const server = net.createServer(sock => {
      sockets.add(sock);
      sock.on("close", () => sockets.delete(sock));
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
      resolve({
        port: address.port,
        close: () => {
          for (const s of sockets) s.destroy();
          server.close();
        },
      });
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
      // does not reset to 0 once closed. close() leaves the connection set while
      // the buffer drains, so afterClose still reads the live backlog and stays
      // essentially the whole queue (a few frames may flush to the OS buffer
      // between the two reads, so allow a small tolerance).
      expect(afterClose).toBeGreaterThan(beforeClose * 0.95);
    } finally {
      close();
    }
  });

  // terminate() is close()'s abrupt sibling: it cancels the native client
  // synchronously, so the C++ side snapshots the backlog eagerly before the
  // send buffer is freed. The snapshot must survive the call.
  test("does not reset to 0 after terminate() while a backlog is queued", async () => {
    const { port, close } = await nonDrainingServer();
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
      const { promise, resolve, reject } = Promise.withResolvers<{ beforeTerminate: number; afterTerminate: number }>();
      ws.onerror = () => reject(new Error("unexpected error event"));
      ws.onopen = () => {
        const chunk = Buffer.alloc(64 * 1024, 0x7c).toString();
        for (let i = 0; i < 4000; i++) ws.send(chunk);
        const beforeTerminate = ws.bufferedAmount;
        // terminate() dispatches error/close synchronously; here they are
        // expected, not failures.
        ws.onerror = null;
        ws.terminate();
        const afterTerminate = ws.bufferedAmount;
        resolve({ beforeTerminate, afterTerminate });
      };
      const { beforeTerminate, afterTerminate } = await promise;

      expect(beforeTerminate).toBeGreaterThan(64 * 1024);
      // terminate() snapshots the backlog before cancel frees the send buffer;
      // the connection is gone afterward, so the value is frozen (same small
      // flush tolerance as the close() case).
      expect(afterTerminate).toBeGreaterThan(beforeTerminate * 0.95);
    } finally {
      close();
    }
  });

  // Every send()/ping()/pong() overload must account for data queued after
  // close() the same way the spec requires for send() ("increase the
  // bufferedAmount attribute by the size of the data"). The Blob overloads were
  // the only ones that returned without accounting; they must now match their
  // String/ArrayBuffer/ArrayBufferView siblings. With no backlog queued, close()
  // dispatches synchronously and releases the connection, so each post-close
  // call adds deterministically to m_bufferedAmountAfterClose.
  test("send/ping/pong(Blob) after close() increase bufferedAmount like the other overloads", async () => {
    const blobBytes = 4096;
    const { port, close } = await nonDrainingServer();
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
      const { promise, resolve, reject } = Promise.withResolvers<number[]>();
      ws.onerror = () => reject(new Error("unexpected error event"));
      ws.onopen = () => {
        // With an empty buffer, close() releases the connection synchronously, so
        // bufferedAmount is the final snapshot plus post-close accumulation only.
        ws.close();
        const blob = () => new Blob([new Uint8Array(blobBytes)]);
        const samples = [ws.bufferedAmount];
        ws.send(blob());
        samples.push(ws.bufferedAmount);
        ws.ping(blob());
        samples.push(ws.bufferedAmount);
        ws.pong(blob());
        samples.push(ws.bufferedAmount);
        // The no-argument forms send the same empty control frame as ping("")
        // when OPEN, so they must account the same 6 framing bytes after close.
        const beforeEmptyPing = ws.bufferedAmount;
        ws.ping();
        const afterEmptyPing = ws.bufferedAmount;
        ws.pong();
        const afterEmptyPong = ws.bufferedAmount;
        resolve([...samples, afterEmptyPing - beforeEmptyPing, afterEmptyPong - afterEmptyPing]);
      };
      const all = await promise;
      const emptyPongDelta = all.pop()!;
      const emptyPingDelta = all.pop()!;
      const samples = all;

      // Each Blob overload must add at least the blob's raw size. Before the fix
      // the Blob branch alone returned without touching bufferedAmount, so the
      // value would not move between samples.
      for (let i = 1; i < samples.length; i++) {
        expect(samples[i] - samples[i - 1]).toBeGreaterThanOrEqual(blobBytes);
      }
      // 2-byte header + 4-byte masking key.
      expect(emptyPingDelta).toBe(6);
      expect(emptyPongDelta).toBe(6);
    } finally {
      close();
    }
  });

  // Counterpart to the retention tests: when the peer reads, a backlog queued
  // before close() transmits and the close event must report the drained total,
  // not a stale close-time snapshot (which would wrongly count transmitted bytes
  // as still buffered). The ~MiB backlog builds during the synchronous send loop
  // (the event loop cannot drain mid-loop) and the reading peer empties it after.
  test("drains toward 0 after a graceful close once a reading peer empties the backlog", async () => {
    // resume() undoes the handshake's pause(), so this peer keeps draining the
    // client's frames instead of letting them pile up.
    const { port, close } = await nonDrainingServer(sock => sock.resume());
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
      const { promise, resolve, reject } = Promise.withResolvers<number>();
      ws.onerror = () => reject(new Error("unexpected error event"));
      let maxBuffered = 0;
      ws.onopen = () => {
        const chunk = Buffer.alloc(64 * 1024, 0x7e).toString();
        for (let i = 0; i < 500; i++) {
          ws.send(chunk);
          if (ws.bufferedAmount > maxBuffered) maxBuffered = ws.bufferedAmount;
        }
        ws.close();
      };
      ws.onclose = () => resolve(ws.bufferedAmount);
      const onClose = await promise;

      // A large backlog existed at close() time.
      expect(maxBuffered).toBeGreaterThan(64 * 1024);
      // By the close event the peer has read it, so bufferedAmount reflects the
      // transmitted bytes rather than the close-time high-water mark.
      expect(onClose).toBeLessThan(maxBuffered / 2);
    } finally {
      close();
    }
  });

  // While the socket stays OPEN the value is live: it rises during a burst and
  // returns to 0 once the peer has read everything, so callers can wait for
  // backpressure to clear before sending more.
  test("returns to 0 while open once a reading peer has drained the backlog", async () => {
    const frames = 500;
    const payloadBytes = 64 * 1024;
    const received = Promise.withResolvers<void>();
    const { port, close } = await nonDrainingServer(sock => {
      let bytes = 0;
      sock.on("data", d => {
        bytes += d.length;
        if (bytes >= frames * payloadBytes) received.resolve();
      });
      sock.resume();
    });
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
      const { promise, resolve, reject } = Promise.withResolvers<number>();
      ws.onerror = () => reject(new Error("unexpected error event"));
      ws.onclose = () => reject(new Error("unexpected close event"));
      ws.onopen = () => {
        const chunk = Buffer.alloc(payloadBytes, 0x7f).toString();
        let max = 0;
        for (let i = 0; i < frames; i++) {
          ws.send(chunk);
          if (ws.bufferedAmount > max) max = ws.bufferedAmount;
        }
        resolve(max);
      };
      const max = await promise;
      // The first promise is settled now; rewire failure events at the drain
      // wait so an unexpected error/close fails fast instead of hanging (an
      // abrupt close freezes bufferedAmount non-zero, so the poll would spin).
      ws.onerror = ws.onclose = e => received.reject(new Error(`unexpected ${e.type} event during drain`));
      expect(max).toBeGreaterThan(payloadBytes);

      // The peer has the payloads; only the tail of the last frame can still be
      // in flight, so the live value must settle back to exactly 0.
      await received.promise;
      while (ws.bufferedAmount !== 0 && ws.readyState === WebSocket.OPEN) await Bun.sleep(1);
      expect(ws.readyState).toBe(WebSocket.OPEN);
      expect(ws.bufferedAmount).toBe(0);
      ws.onclose = null;
      ws.close();
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
