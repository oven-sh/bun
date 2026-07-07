// node:http2 client outbound flow control conformance (RFC 9113 §6.9).
// A raw byte-level server drives a Bun node:http2 client and asserts the exact DATA bytes it
// emits against the per-stream send window the server has granted.

import { expect, test } from "bun:test";
import { once } from "node:events";
import http2 from "node:http2";
import net from "node:net";

const PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");

function frame(type: number, flags: number, streamId: number, payload: Buffer = Buffer.alloc(0)) {
  const header = Buffer.alloc(9);
  header.writeUIntBE(payload.length, 0, 3);
  header[3] = type;
  header[4] = flags;
  header.writeUInt32BE(streamId, 5);
  return Buffer.concat([header, payload]);
}
function u32(n: number) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
}
function settingsPayload(pairs: [number, number][]) {
  return Buffer.concat(
    pairs.map(([id, v]) => {
      const b = Buffer.alloc(6);
      b.writeUInt16BE(id);
      b.writeUInt32BE(v >>> 0, 2);
      return b;
    }),
  );
}

type RawFrame = { type: number; flags: number; streamId: number; length: number; payload: Buffer };

/** Raw HTTP/2 server: sends the preface, parses inbound frames, and hands each to `onFrame`. */
async function rawH2Server(onFrame: (f: RawFrame, socket: net.Socket) => void) {
  let buf = Buffer.alloc(0);
  let sawPreface = false;
  const server = net.createServer(socket => {
    socket.on("error", () => {});
    socket.on("data", chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (!sawPreface) {
        if (buf.length < PREFACE.length) return;
        sawPreface = true;
        buf = buf.subarray(PREFACE.length);
        // Server preface: empty SETTINGS, ACK of the client's SETTINGS, and a large
        // connection-level WINDOW_UPDATE so the connection window is never the limiting factor.
        socket.write(Buffer.concat([frame(0x4, 0, 0), frame(0x4, 0x1, 0), frame(0x8, 0, 0, u32(1 << 24))]));
      }
      while (buf.length >= 9) {
        const length = buf.readUIntBE(0, 3);
        if (buf.length < 9 + length) break;
        const f: RawFrame = {
          length,
          type: buf[3],
          flags: buf[4],
          streamId: buf.readUInt32BE(5) & 0x7fffffff,
          payload: Buffer.from(buf.subarray(9, 9 + length)),
        };
        buf = buf.subarray(9 + length);
        onFrame(f, socket);
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, port: (server.address() as net.AddressInfo).port };
}

test("client stops sending DATA when a mid-stream SETTINGS_INITIAL_WINDOW_SIZE reduction drives the stream send window negative (RFC 9113 §6.9.2)", async () => {
  // The client exhausts the default 65535-byte stream window, then the peer lowers
  // INITIAL_WINDOW_SIZE to 10: §6.9.2 says every stream's send window shifts by the delta, so the
  // stream window becomes 10 - 65535 = -65525. 40 WINDOW_UPDATEs of 1000 raise it to -25525, still
  // negative. A compliant sender MUST NOT emit any DATA until the window is positive again.
  const BODY_SIZE = 100000;
  let dataBytes = 0;
  let phase = 0;
  let dataAtShrink = -1;
  let peer!: net.Socket;
  const { promise: shrinkAck, resolve: resolveShrinkAck, reject: rejectShrinkAck } = Promise.withResolvers<number>();
  const { promise: drained, resolve: resolveDrained, reject: rejectDrained } = Promise.withResolvers<void>();
  const fail = (e: unknown) => {
    rejectShrinkAck(e);
    rejectDrained(e);
  };

  const { server, port } = await rawH2Server((f, socket) => {
    peer = socket;
    if (f.type === 0x0 /* DATA */) {
      dataBytes += f.length;
      if (phase === 0 && dataBytes >= 65535) {
        phase = 1;
        dataAtShrink = dataBytes;
        // Shrink INITIAL_WINDOW_SIZE to 10, grant 40 * 1000 of stream credit (window stays
        // negative), then PING so its ACK marks when the client has processed all of it.
        const batch = [frame(0x4, 0, 0, settingsPayload([[0x4, 10]]))];
        for (let i = 0; i < 40; i++) batch.push(frame(0x8, 0, 1, u32(1000)));
        batch.push(frame(0x6, 0, 0, Buffer.from("shrinkpt")));
        socket.write(Buffer.concat(batch));
      }
      if (dataBytes >= BODY_SIZE) resolveDrained();
    } else if (f.type === 0x6 /* PING */ && f.flags & 0x1 && f.payload.equals(Buffer.from("shrinkpt"))) {
      resolveShrinkAck(dataBytes - dataAtShrink);
    }
  });

  const client = http2.connect(`http://127.0.0.1:${port}`);
  client.on("error", fail);
  client.once("remoteSettings", () => {
    const req = client.request({ ":method": "POST", ":path": "/" });
    req.on("error", () => {});
    req.write(Buffer.alloc(BODY_SIZE, 0x42));
    req.end();
  });

  try {
    const bytesSentWhileNegative = await shrinkAck;
    // Stream send window at this point: 10 + 40*1000 - dataAtShrink <= -25525. A compliant sender
    // sends nothing until further credit arrives.
    expect({ dataAtShrink, bytesSentWhileNegative }).toEqual({ dataAtShrink: 65535, bytesSentWhileNegative: 0 });
    // Reopen the stream window so the queued remainder drains and nothing is left pending.
    peer.write(frame(0x8, 0, 1, u32(200000)));
    await drained;
    expect(dataBytes).toBe(BODY_SIZE);
  } finally {
    client.removeListener("error", fail);
    client.destroy();
    server.close();
  }
});

// https://github.com/oven-sh/bun/issues/30342
test("client applies a SETTINGS_INITIAL_WINDOW_SIZE increase as a delta on top of prior WINDOW_UPDATE credit (RFC 9113 §6.9.2)", async () => {
  // After the default 65535-byte window is exhausted the peer grants 10000 via WINDOW_UPDATE and
  // then raises INITIAL_WINDOW_SIZE to 200000. §6.9.2 says the stream window shifts by
  // (200000 - 65535), so total granted credit is 65535 + 10000 + 134465 = 210000. The upload is
  // exactly 210000 bytes and must drain fully; overwriting the window with the new initial value
  // instead of adding the delta would lose the 10000 WINDOW_UPDATE credit and stall at 200000.
  const BODY_SIZE = 210000;
  let dataBytes = 0;
  let phase = 0;
  const { promise: outcome, resolve: resolveOutcome, reject: rejectOutcome } = Promise.withResolvers<number>();

  const { server, port } = await rawH2Server((f, socket) => {
    if (f.type === 0x0 /* DATA */) {
      dataBytes += f.length;
      if (phase === 0 && dataBytes >= 65535) {
        phase = 1;
        // Grant 10000 via WINDOW_UPDATE, then raise INITIAL_WINDOW_SIZE to 200000, then PING.
        socket.write(
          Buffer.concat([
            frame(0x8, 0, 1, u32(10000)),
            frame(0x4, 0, 0, settingsPayload([[0x4, 200000]])),
            frame(0x6, 0, 0, Buffer.from("growping")),
          ]),
        );
      }
    } else if (f.type === 0x6 /* PING */ && f.flags & 0x1 && f.payload.equals(Buffer.from("growping"))) {
      resolveOutcome(dataBytes);
    }
  });

  const client = http2.connect(`http://127.0.0.1:${port}`);
  client.on("error", rejectOutcome);
  client.once("remoteSettings", () => {
    const req = client.request({ ":method": "POST", ":path": "/" });
    req.on("error", () => {});
    req.write(Buffer.alloc(BODY_SIZE, 0x42));
    req.end();
  });

  try {
    // After the WU + SETTINGS the stream has exactly BODY_SIZE bytes of credit; the upload drains
    // before the PING ACK is written.
    expect(await outcome).toBe(BODY_SIZE);
  } finally {
    client.removeListener("error", rejectOutcome);
    client.destroy();
    server.close();
  }
});
