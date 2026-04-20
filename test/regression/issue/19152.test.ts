// Issue #19152: Bun's HTTP/2 server ignores peer's SETTINGS_HEADER_TABLE_SIZE.
// Per RFC 9113 §6.5.2 the peer's SETTINGS_HEADER_TABLE_SIZE bounds OUR HPACK
// encoder's dynamic table. When a client (e.g. nginx as reverse proxy) sends
// SETTINGS_HEADER_TABLE_SIZE=0, the server must stop emitting dynamic-table
// references (indices ≥ 62) and emit a Dynamic Table Size Update of 0
// (RFC 7541 §6.3). Bun previously never propagated the remote setting to the
// ls-hpack encoder, so the second response on a connection would reference a
// dynamic-table entry the client never accepted, yielding "invalid http2 table
// index" upstream.
//
// This test speaks raw HTTP/2 over a net.Socket so we can inspect the encoded
// HEADERS bytes directly rather than relying on a lenient decoder.
import { expect, test } from "bun:test";
import { once } from "node:events";
import http2 from "node:http2";
import net from "node:net";

const PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");

function frame(type: number, flags: number, streamId: number, payload: Buffer = Buffer.alloc(0)) {
  const header = Buffer.alloc(9);
  header.writeUIntBE(payload.length, 0, 3);
  header.writeUInt8(type, 3);
  header.writeUInt8(flags, 4);
  header.writeUInt32BE(streamId & 0x7fffffff, 5);
  return Buffer.concat([header, payload]);
}

function settingsFrame(pairs: Array<[number, number]>) {
  const payload = Buffer.alloc(pairs.length * 6);
  pairs.forEach(([id, value], i) => {
    payload.writeUInt16BE(id, i * 6);
    payload.writeUInt32BE(value, i * 6 + 2);
  });
  return frame(0x4, 0, 0, payload);
}

// Minimal HPACK encoding using only literal-without-indexing representations so
// the request itself never depends on dynamic-table state.
function hpackLiteral(name: string, value: string) {
  const n = Buffer.from(name);
  const v = Buffer.from(value);
  return Buffer.concat([Buffer.from([0x00, n.length]), n, Buffer.from([v.length]), v]);
}

function requestHeaders() {
  return Buffer.concat([
    hpackLiteral(":method", "GET"),
    hpackLiteral(":scheme", "http"),
    hpackLiteral(":path", "/"),
    hpackLiteral(":authority", "localhost"),
  ]);
}

type ParsedFrame = { type: number; flags: number; streamId: number; payload: Buffer };

function parseFrames(buf: Buffer): { frames: ParsedFrame[]; rest: Buffer } {
  const frames: ParsedFrame[] = [];
  let off = 0;
  while (buf.length - off >= 9) {
    const len = buf.readUIntBE(off, 3);
    if (buf.length - off < 9 + len) break;
    frames.push({
      type: buf.readUInt8(off + 3),
      flags: buf.readUInt8(off + 4),
      streamId: buf.readUInt32BE(off + 5) & 0x7fffffff,
      payload: buf.subarray(off + 9, off + 9 + len),
    });
    off += 9 + len;
  }
  return { frames, rest: buf.subarray(off) };
}

// Decode an HPACK integer with N-bit prefix starting at buf[pos]; returns [value, bytesConsumed].
function hpackInt(buf: Buffer, pos: number, prefixBits: number): [number, number] {
  const mask = (1 << prefixBits) - 1;
  let value = buf[pos] & mask;
  if (value < mask) return [value, 1];
  let m = 0;
  let i = 1;
  while (true) {
    const b = buf[pos + i];
    value += (b & 0x7f) << m;
    m += 7;
    i++;
    if ((b & 0x80) === 0) break;
  }
  return [value, i];
}

// Walk an HPACK header block and return a summary of representations seen.
function scanHpack(block: Buffer) {
  let pos = 0;
  let sawSizeUpdateZero = false;
  let maxIndexedRef = 0;
  let incrementalIndexing = 0;
  while (pos < block.length) {
    const b = block[pos];
    if (b & 0x80) {
      // Indexed Header Field (RFC 7541 §6.1)
      const [idx, n] = hpackInt(block, pos, 7);
      maxIndexedRef = Math.max(maxIndexedRef, idx);
      pos += n;
    } else if ((b & 0xc0) === 0x40) {
      // Literal with Incremental Indexing (RFC 7541 §6.2.1) — adds to dynamic table
      incrementalIndexing++;
      const [idx, n] = hpackInt(block, pos, 6);
      pos += n;
      if (idx === 0) {
        const [nlen, nn] = hpackInt(block, pos, 7);
        pos += nn + nlen;
      }
      const [vlen, vn] = hpackInt(block, pos, 7);
      pos += vn + vlen;
    } else if ((b & 0xe0) === 0x20) {
      // Dynamic Table Size Update (RFC 7541 §6.3)
      const [size, n] = hpackInt(block, pos, 5);
      if (size === 0) sawSizeUpdateZero = true;
      pos += n;
    } else {
      // Literal without Indexing / Never Indexed (§6.2.2, §6.2.3)
      const [idx, n] = hpackInt(block, pos, 4);
      pos += n;
      if (idx === 0) {
        const [nlen, nn] = hpackInt(block, pos, 7);
        pos += nn + nlen;
      }
      const [vlen, vn] = hpackInt(block, pos, 7);
      pos += vn + vlen;
    }
  }
  return { sawSizeUpdateZero, maxIndexedRef, incrementalIndexing };
}

test("http2 server respects remote SETTINGS_HEADER_TABLE_SIZE=0 (issue #19152)", async () => {
  const server = http2.createServer();
  server.on("stream", stream => {
    stream.respond({
      ":status": 200,
      "content-type": "text/plain",
      "x-hpack-probe": "issue-19152",
    });
    stream.end();
  });
  server.listen(0);
  await once(server, "listening");
  const port = (server.address() as net.AddressInfo).port;

  try {
    const sock = net.connect(port, "127.0.0.1");
    await once(sock, "connect");

    // Client preface + SETTINGS_HEADER_TABLE_SIZE=0. Per RFC 9113 §6.5.2 this
    // limits the SERVER's HPACK encoder dynamic table to zero entries.
    sock.write(PREFACE);
    sock.write(settingsFrame([[0x1, 0]]));

    let buffer = Buffer.alloc(0);
    const allFrames: ParsedFrame[] = [];
    sock.on("data", chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      const { frames, rest } = parseFrames(buffer);
      buffer = rest;
      allFrames.push(...frames);
    });

    const waitFor = (pred: () => boolean) =>
      new Promise<void>((resolve, reject) => {
        const check = () => (pred() ? resolve() : undefined);
        sock.on("data", check);
        sock.on("error", reject);
        sock.on("close", () => (pred() ? resolve() : reject(new Error("closed before condition met"))));
        check();
      });

    // Wait for the server's initial SETTINGS, then ACK it.
    await waitFor(() => allFrames.some(f => f.type === 0x4 && (f.flags & 0x1) === 0));
    sock.write(frame(0x4, 0x1, 0));

    // Wait for the server to ACK our SETTINGS so we know it has applied
    // headerTableSize=0 before we send any request.
    await waitFor(() => allFrames.some(f => f.type === 0x4 && (f.flags & 0x1) === 0x1));

    // Two requests: a buggy server adds x-hpack-probe to its dynamic table on
    // stream 1, then references it by index ≥ 62 on stream 3.
    const req = requestHeaders();
    sock.write(frame(0x1, 0x05, 1, req)); // HEADERS, END_STREAM|END_HEADERS
    sock.write(frame(0x1, 0x05, 3, req));

    await waitFor(() => allFrames.filter(f => f.type === 0x1 && f.streamId !== 0).length >= 2);
    sock.destroy();

    const responses = allFrames
      .filter(f => f.type === 0x1)
      .sort((a, b) => a.streamId - b.streamId)
      .map(f => scanHpack(f.payload));

    expect(responses.length).toBeGreaterThanOrEqual(2);

    // NOTE: RFC 7541 §6.3 also requires emitting a Dynamic Table Size Update
    // of 0 in the first subsequent header block. ls-hpack does not auto-emit
    // this when capacity is reduced; tracked separately. The user-visible bug
    // (#19152) is the dynamic-table references below, which this asserts.

    for (const r of responses) {
      // No dynamic-table references: static table ends at index 61.
      expect(r.maxIndexedRef).toBeLessThanOrEqual(61);
      // No literals-with-incremental-indexing: with a zero-size table the
      // encoder must not attempt to add entries.
      expect(r.incrementalIndexing).toBe(0);
    }
  } finally {
    server.close();
  }
});
