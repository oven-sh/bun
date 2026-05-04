import { expect, test } from "bun:test";
import http2 from "node:http2";
import net from "node:net";
import http2utils from "./helpers";

// RFC 7540 Section 6.1 / 6.2: "Padding octets MUST be set to zero when sending."
//
// Bun assembles padded HTTP/2 DATA frames in a threadlocal `shared_request_buffer`
// (declared `= undefined`). The pad-length byte is written at [0], the payload
// is moved to [1..1+len), and the frame is emitted as buffer[0..payload_size) —
// but the trailing padding region [1+len..payload_size) was never zeroed, so
// whatever the previous user of the buffer had left there (typically the
// payload of an earlier DATA frame on the same thread, or HPACK-encoded
// headers) was transmitted verbatim as "padding" to the peer.
//
// This test drives a node:http2 client with PADDING_STRATEGY_MAX against a
// raw TCP server, parses the wire bytes, and asserts every padding octet is
// zero. A distinctive sentinel payload is sent first so that, without the fix,
// its bytes visibly appear in the padding of the following frame.

const PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n", "latin1");
const FRAME_DATA = 0x0;
const FRAME_HEADERS = 0x1;
const FLAG_END_STREAM = 0x1;
const FLAG_PADDED = 0x8;
const FLAG_PRIORITY = 0x20;

type Frame = {
  length: number;
  type: number;
  flags: number;
  streamId: number;
  payload: Buffer;
};

function parseFrames(buf: Buffer): Frame[] {
  const frames: Frame[] = [];
  let off = 0;
  // Skip the client connection preface.
  if (buf.subarray(0, PREFACE.length).equals(PREFACE)) {
    off = PREFACE.length;
  }
  while (off + 9 <= buf.length) {
    const length = (buf[off] << 16) | (buf[off + 1] << 8) | buf[off + 2];
    const type = buf[off + 3];
    const flags = buf[off + 4];
    const streamId = buf.readUInt32BE(off + 5) & 0x7fffffff;
    if (off + 9 + length > buf.length) break;
    const payload = buf.subarray(off + 9, off + 9 + length);
    frames.push({ length, type, flags, streamId, payload });
    off += 9 + length;
  }
  return frames;
}

function extractPadding(frame: Frame, priorityOverhead: number): { padLen: number; padding: Buffer; data: Buffer } {
  // PADDED frame layout: [PadLen:1][<priority>?][data...][Padding:PadLen]
  const padLen = frame.payload[0];
  const dataStart = 1 + priorityOverhead;
  const dataEnd = frame.payload.length - padLen;
  return {
    padLen,
    data: frame.payload.subarray(dataStart, dataEnd),
    padding: frame.payload.subarray(dataEnd),
  };
}

async function captureClientFrames(
  configure: (client: http2.ClientHttp2Session) => void,
): Promise<{ frames: Frame[]; close: () => void }> {
  const chunks: Buffer[] = [];
  let gotEndStream = false;
  const { promise: serverListening, resolve: serverResolve } = Promise.withResolvers<void>();
  const { promise: captured, resolve: capturedResolve, reject: capturedReject } = Promise.withResolvers<void>();

  const fail = (err: unknown) => capturedReject(err instanceof Error ? err : new Error(String(err)));

  const server = net.createServer(socket => {
    // ECONNRESET here is expected once the client is torn down in close();
    // by then `captured` is already settled so this is a no-op.
    socket.once("error", fail);
    // Speak enough HTTP/2 to let the client proceed: empty SETTINGS + ACK.
    socket.write(new http2utils.SettingsFrame(false).data);
    socket.write(new http2utils.SettingsFrame(true).data);
    socket.on("data", d => {
      chunks.push(Buffer.from(d));
      // Re-parse from the start each time; the stream is small. Resolve once
      // the client has emitted END_STREAM on a DATA frame.
      for (const f of parseFrames(Buffer.concat(chunks))) {
        if (f.type === FRAME_DATA && f.flags & FLAG_END_STREAM) gotEndStream = true;
      }
      if (gotEndStream) capturedResolve();
    });
  });
  server.once("error", fail);
  server.listen(0, "127.0.0.1", () => serverResolve());
  await serverListening;

  const url = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  const client = http2.connect(url, {
    paddingStrategy: http2.constants.PADDING_STRATEGY_MAX,
  });
  // Surface session failures as a test error instead of a generic timeout.
  client.once("error", fail);
  client.once("close", () => {
    if (!gotEndStream) fail(new Error("HTTP/2 session closed before END_STREAM was captured"));
  });
  client.on("connect", () => configure(client));

  const close = () => {
    client.destroy();
    server.close();
  };
  try {
    await captured;
  } catch (e) {
    close();
    throw e;
  }
  return { frames: parseFrames(Buffer.concat(chunks)), close };
}

test("PADDING_STRATEGY_MAX does not leak prior DATA payload into padding bytes", async () => {
  // Write a 200-byte block of 0x5a first so it occupies shared_request_buffer
  // at [1..201], then a 1-byte payload whose padded frame spans [0..257].
  // Without the fix, the second frame's padding region [2..257] still holds
  // 199 of those 0x5a bytes.
  const sentinel = Buffer.alloc(200, 0x5a);

  const { frames, close } = await captureClientFrames(client => {
    const req = client.request({ ":path": "/", ":method": "POST" });
    req.on("error", () => {});
    // Chain via the write callback so the second write is framed separately
    // and re-uses the same shared_request_buffer slot.
    req.write(sentinel, () => {
      req.write(Buffer.from("A"), () => req.end());
    });
  });

  try {
    const dataFrames = frames.filter(f => f.type === FRAME_DATA && f.streamId === 1 && f.length > 0);
    expect(dataFrames.length).toBeGreaterThanOrEqual(2);

    let sawPadded = false;
    for (const f of dataFrames) {
      // Every non-empty DATA frame under PADDING_STRATEGY_MAX must be PADDED,
      // and every padding octet must be zero (RFC 7540 §6.1).
      expect(f.flags & FLAG_PADDED).toBe(FLAG_PADDED);
      const { padLen, padding } = extractPadding(f, 0);
      expect(padLen).toBeGreaterThan(0);
      sawPadded = true;
      // The sentinel byte must not appear anywhere in the padding.
      expect(padding.includes(0x5a)).toBe(false);
      // And the padding must be entirely zero.
      expect(padding.equals(Buffer.alloc(padLen))).toBe(true);
    }
    expect(sawPadded).toBe(true);

    // HEADERS frame padding must also be zero (RFC 7540 §6.2). The backing
    // buffer for header encoding is grown from uninitialized storage. Under
    // PADDING_STRATEGY_MAX a small header block is always padded, so assert
    // the flag is present rather than silently skipping the check.
    const headersFrame = frames.find(f => f.type === FRAME_HEADERS && f.streamId === 1);
    expect(headersFrame).toBeDefined();
    expect(headersFrame!.flags & FLAG_PADDED).toBe(FLAG_PADDED);
    const prio = headersFrame!.flags & FLAG_PRIORITY ? 5 : 0;
    const h = extractPadding(headersFrame!, prio);
    expect(h.padLen).toBeGreaterThan(0);
    expect(h.padding.equals(Buffer.alloc(h.padLen))).toBe(true);
  } finally {
    close();
  }
});
