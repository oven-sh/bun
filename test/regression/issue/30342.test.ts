// https://github.com/oven-sh/bun/issues/30342
//
// RFC 7540 §6.9.2: when the peer sends a SETTINGS frame that changes
// SETTINGS_INITIAL_WINDOW_SIZE, the client must apply the delta
// (new - old) to every existing stream's remote (send) window. Per-
// stream and connection-level windows are independent flow-control
// mechanisms.
//
// The prior implementation gated the per-stream delta on the
// connection-level remoteWindowSize, so if the peer had raised the
// connection window first (as gRPC servers routinely do), the
// SETTINGS change was effectively ignored and any queued DATA past
// the default 65535-byte stream window hung forever.
import { describe, expect, it } from "bun:test";
import http2 from "node:http2";
import net from "node:net";

describe("SETTINGS_INITIAL_WINDOW_SIZE delta handling", () => {
  const PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n", "ascii");
  const TYPE_DATA = 0x0;
  const TYPE_HEADERS = 0x1;
  const TYPE_SETTINGS = 0x4;
  const TYPE_WINDOW_UPDATE = 0x8;
  const SETTING_INITIAL_WINDOW_SIZE = 0x4;

  function rawFrame(type: number, flags: number, streamId: number, payload: Buffer): Buffer {
    const len = payload.length;
    const buf = Buffer.alloc(9 + len);
    buf[0] = (len >>> 16) & 0xff;
    buf[1] = (len >>> 8) & 0xff;
    buf[2] = len & 0xff;
    buf[3] = type;
    buf[4] = flags;
    buf.writeUInt32BE(streamId >>> 0, 5);
    payload.copy(buf, 9);
    return buf;
  }

  function settingsPayload(id: number, value: number): Buffer {
    const p = Buffer.alloc(6);
    p.writeUInt16BE(id, 0);
    p.writeUInt32BE(value >>> 0, 2);
    return p;
  }

  interface RawHooks {
    onPreface?(sock: net.Socket): void;
    onClientSettingsAck?(sock: net.Socket): void;
    onClientHeaders?(sock: net.Socket, streamId: number): void;
    onClientData?(sock: net.Socket, streamId: number, payload: Buffer, end: boolean): void;
  }

  // Drives a raw-frame HTTP/2 server. `hooks` fires on the client's
  // SETTINGS ACK of the server's SETTINGS, on HEADERS, and on each
  // DATA frame. Caller closes server via the returned object.
  async function startRawServer(hooks: RawHooks): Promise<{ server: net.Server; port: number }> {
    const { promise, resolve } = Promise.withResolvers<void>();
    const server = net.createServer(sock => {
      let buf = Buffer.alloc(0);
      let gotPreface = false;
      sock.on("error", () => {});
      sock.on("data", chunk => {
        buf = Buffer.concat([buf, chunk]);
        if (!gotPreface) {
          if (buf.length < PREFACE.length) return;
          buf = buf.subarray(PREFACE.length);
          gotPreface = true;
          hooks.onPreface?.(sock);
        }
        while (buf.length >= 9) {
          const length = (buf[0] << 16) | (buf[1] << 8) | buf[2];
          if (buf.length < 9 + length) break;
          const type = buf[3];
          const flags = buf[4];
          const streamId = buf.readUInt32BE(5) & 0x7fffffff;
          const payload = buf.subarray(9, 9 + length);
          buf = buf.subarray(9 + length);
          if (type === TYPE_SETTINGS) {
            if (flags & 0x1) hooks.onClientSettingsAck?.(sock);
            else sock.write(rawFrame(TYPE_SETTINGS, 0x1, 0, Buffer.alloc(0)));
          } else if (type === TYPE_HEADERS) {
            hooks.onClientHeaders?.(sock, streamId);
          } else if (type === TYPE_DATA) {
            hooks.onClientData?.(sock, streamId, payload, (flags & 0x1) !== 0);
          }
        }
      });
    });
    server.listen(0, "127.0.0.1", () => resolve());
    await promise;
    return { server, port: (server.address() as net.AddressInfo).port };
  }

  it("positive delta unblocks queued DATA", async () => {
    let secondSettingsSent = false;
    const { server, port } = await startRawServer({
      onPreface(sock) {
        // Empty SETTINGS (defaults) + connection-level WINDOW_UPDATE.
        // Raising the connection window first is the trigger: the old
        // buggy code compared the new per-stream window against
        // this.remoteWindowSize, so with a wide connection window the
        // per-stream update was skipped entirely.
        sock.write(rawFrame(TYPE_SETTINGS, 0, 0, Buffer.alloc(0)));
        const winInc = Buffer.alloc(4);
        winInc.writeUInt32BE(10 << 20, 0);
        sock.write(rawFrame(TYPE_WINDOW_UPDATE, 0, 0, winInc));
      },
      onClientSettingsAck(sock) {
        if (secondSettingsSent) return;
        secondSettingsSent = true;
        // Raise SETTINGS_INITIAL_WINDOW_SIZE to 1 MiB.
        sock.write(rawFrame(TYPE_SETTINGS, 0, 0, settingsPayload(SETTING_INITIAL_WINDOW_SIZE, 1 << 20)));
      },
      onClientData(sock, streamId, payload, end) {
        // Ack only the CONNECTION window. No per-stream WINDOW_UPDATE —
        // the INITIAL_WINDOW_SIZE bump alone has to unblock queued DATA.
        const inc = Buffer.alloc(4);
        inc.writeUInt32BE(payload.length || 1, 0);
        sock.write(rawFrame(TYPE_WINDOW_UPDATE, 0, 0, inc));
        if (end) {
          // minimal :status 200 response to close the stream
          sock.write(rawFrame(TYPE_HEADERS, 0x4 | 0x1, streamId, Buffer.from([0x88])));
        }
      },
    });

    try {
      const client = http2.connect(`http://127.0.0.1:${port}`);
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const req = client.request({ ":method": "POST", ":path": "/" });
      // 87136 > 65535 default per-stream window — the client must queue
      // the tail until the SETTINGS bump raises the window.
      const body = Buffer.alloc(87136, 0x61);
      req.on("end", resolve);
      req.on("error", reject);
      req.write(body);
      req.end();
      await promise;
      client.close();
    } finally {
      server.close();
    }
  });

  it("negative delta applied to existing stream holds DATA until WINDOW_UPDATE", async () => {
    // Sequence exercises the *existing-stream* delta path specifically:
    //  1. server sends empty SETTINGS (initial=65535 default)
    //  2. client opens a stream via HEADERS; stream's remoteWindowSize
    //     is 65535 at that point
    //  3. ONLY AFTER the HEADERS frame is visible on the wire, server
    //     sends SETTINGS shrinking INITIAL_WINDOW_SIZE to 0. RFC §6.9.2
    //     requires the delta (-65535) to apply to the live stream,
    //     driving its remoteWindowSize to 0.
    //  4. client writes 65535 bytes; DATA must NOT be sent
    //  5. assert nothing was sent after 200ms, emit per-stream
    //     WINDOW_UPDATE to reopen, and verify DATA finally flows
    let peerSocket: net.Socket;
    let dataBeforeReopen = 0;
    let reopenArmed = false;
    const { server, port } = await startRawServer({
      onPreface(sock) {
        peerSocket = sock;
        sock.write(rawFrame(TYPE_SETTINGS, 0, 0, Buffer.alloc(0)));
      },
      onClientSettingsAck() {},
      onClientHeaders(sock) {
        // Shrink per-stream initial window to 0. The delta (-65535) is
        // applied to the stream that just opened.
        sock.write(rawFrame(TYPE_SETTINGS, 0, 0, settingsPayload(SETTING_INITIAL_WINDOW_SIZE, 0)));
      },
      onClientData(sock, streamId, payload, end) {
        if (!reopenArmed) dataBeforeReopen += payload.length;
        const inc = Buffer.alloc(4);
        inc.writeUInt32BE(payload.length || 1, 0);
        sock.write(rawFrame(TYPE_WINDOW_UPDATE, 0, 0, inc));
        if (end) {
          sock.write(rawFrame(TYPE_HEADERS, 0x4 | 0x1, streamId, Buffer.from([0x88])));
        }
      },
    });

    try {
      const client = http2.connect(`http://127.0.0.1:${port}`);
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const req = client.request({ ":method": "POST", ":path": "/" });
      req.on("end", resolve);
      req.on("error", reject);
      // Let HEADERS reach the server and the shrink SETTINGS come back
      // and get applied before we write a body the size of the original
      // window. Without the delta fix, remoteWindowSize stays at 65535
      // and the write flies; with the fix it's driven to 0.
      await new Promise(r => setTimeout(r, 150));
      const body = Buffer.alloc(65535, 0x62);
      req.write(body);
      req.end();
      await new Promise(r => setTimeout(r, 200));
      expect(dataBeforeReopen).toBe(0);
      reopenArmed = true;
      // Emit WINDOW_UPDATE for stream 1 large enough to send the body.
      const inc = Buffer.alloc(4);
      inc.writeUInt32BE(body.length, 0);
      peerSocket!.write(rawFrame(TYPE_WINDOW_UPDATE, 0, 1, inc));
      await promise;
      client.close();
    } finally {
      server.close();
    }
  });

  it("delta that overflows 2^31-1 closes the session with FLOW_CONTROL_ERROR", async () => {
    // Sequence:
    //  1. server sends empty SETTINGS (initial=65535) and ACKs client's
    //  2. on the client's HEADERS, server emits WINDOW_UPDATE on the
    //     stream raising its cumulative send credit to (MAX - 1)
    //  3. server then sends SETTINGS raising INITIAL_WINDOW_SIZE by 2,
    //     which would push the stream's available window past 2^31-1
    //     (spec §6.9.1 cap)
    //  4. client must emit GOAWAY with NGHTTP2_FLOW_CONTROL_ERROR (3),
    //     surfaced as ERR_HTTP2_SESSION_ERROR on the 'error' event
    const MAX = 2 ** 31 - 1;
    let primed = false;
    const { server, port } = await startRawServer({
      onPreface(sock) {
        sock.write(rawFrame(TYPE_SETTINGS, 0, 0, Buffer.alloc(0)));
      },
      onClientSettingsAck() {},
      onClientHeaders(sock, streamId) {
        if (primed) return;
        primed = true;
        // Stream's cumulative remoteWindowSize starts at 65535 (default).
        // Raise it to (MAX - 1) via a single WINDOW_UPDATE.
        const inc = Buffer.alloc(4);
        inc.writeUInt32BE(MAX - 1 - 65535, 0);
        sock.write(rawFrame(TYPE_WINDOW_UPDATE, 0, streamId, inc));
        // Raise INITIAL_WINDOW_SIZE from 65535 to 65537. Delta = +2.
        // next = (MAX - 1) + 2 = MAX + 1; used = 0 (no DATA sent yet);
        // next - used = MAX + 1 > MAX → FLOW_CONTROL_ERROR.
        sock.write(rawFrame(TYPE_SETTINGS, 0, 0, settingsPayload(SETTING_INITIAL_WINDOW_SIZE, 65537)));
      },
    });

    try {
      const client = http2.connect(`http://127.0.0.1:${port}`);
      const { promise, resolve } = Promise.withResolvers<any>();
      client.on("error", resolve);
      const req = client.request({ ":method": "POST", ":path": "/" });
      req.on("error", () => {});
      // no DATA — HEADERS alone registers the stream with the parser
      const err = await promise;
      expect(err).toBeDefined();
      expect(err.code).toBe("ERR_HTTP2_SESSION_ERROR");
      expect(err.message).toBe("Session closed with error code NGHTTP2_FLOW_CONTROL_ERROR");
      try {
        client.destroy();
      } catch {}
    } finally {
      server.close();
    }
  });
});
