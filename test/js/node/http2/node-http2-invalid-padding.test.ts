import { expect, test } from "bun:test";
import http2 from "node:http2";
import net from "node:net";
import http2utils from "./helpers";

// These tests craft malformed PADDED frames from a raw TCP server and feed them
// to Bun's node:http2 client. Before the fix, `payload.len - padding` in
// handleHeadersFrame would wrap around when Pad Length exceeded the payload
// length, producing an out-of-bounds slice that was handed to the HPACK decoder
// in release builds (and an `integer overflow` panic in debug/safe builds).

type SessionResult = { err: Error & { code?: string }; close: () => void };

async function sendFrames(write: (socket: net.Socket) => void): Promise<SessionResult> {
  const { promise: waitToWrite, resolve: allowWrite } = Promise.withResolvers<void>();
  const { promise: serverListening, resolve: serverResolve } = Promise.withResolvers<void>();
  const server = net.createServer(async socket => {
    socket.on("error", () => {});
    const settings = new http2utils.SettingsFrame(true);
    socket.write(settings.data);
    await waitToWrite;
    write(socket);
  });
  server.listen(0, "127.0.0.1", () => serverResolve());
  await serverListening;

  const url = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  const { promise, resolve } = Promise.withResolvers<Error & { code?: string }>();
  const client = http2.connect(url);
  client.on("error", resolve);
  client.on("connect", () => {
    const req = client.request({ ":path": "/" });
    req.on("error", () => {});
    req.end();
    allowWrite();
  });
  const err = await promise;
  return {
    err,
    close: () => {
      client.destroy();
      server.close();
    },
  };
}

test("should reject HEADERS frame with Pad Length >= payload length", async () => {
  // RFC 7540 Section 6.2: Padding that exceeds the size remaining for the header
  // block fragment MUST be treated as a PROTOCOL_ERROR.
  const { err, close } = await sendFrames(socket => {
    // HEADERS (type=1), flags = PADDED (0x8) | END_HEADERS (0x4), stream=1, length=1
    // payload = [0xFF]  -> Pad Length = 255, header block fragment would require 255
    // trailing padding bytes that do not exist.
    const frame = new http2utils.Frame(1, 1, 0x8 | 0x4, 1).data;
    socket.write(Buffer.concat([frame, Buffer.from([0xff])]));
  });
  try {
    expect(err).toBeDefined();
    expect(err.code).toBe("ERR_HTTP2_SESSION_ERROR");
    expect(err.message).toBe("Session closed with error code NGHTTP2_PROTOCOL_ERROR");
  } finally {
    close();
  }
});

test("should reject zero-length HEADERS frame with PADDED flag", async () => {
  const { err, close } = await sendFrames(socket => {
    // HEADERS (type=1), flags = PADDED (0x8) | END_HEADERS (0x4), stream=1, length=0
    // PADDED requires at least 1 byte for the Pad Length field.
    const frame = new http2utils.Frame(0, 1, 0x8 | 0x4, 1).data;
    socket.write(frame);
  });
  try {
    expect(err).toBeDefined();
    expect(err.code).toBe("ERR_HTTP2_SESSION_ERROR");
    expect(err.message).toBe("Session closed with error code NGHTTP2_FRAME_SIZE_ERROR");
  } finally {
    close();
  }
});

test("should reject HEADERS frame with truncated priority fields", async () => {
  // RFC 7540 Section 4.2: A frame too small to contain mandatory frame data
  // (here the 5-byte priority block) MUST be treated as a FRAME_SIZE_ERROR.
  const { err, close } = await sendFrames(socket => {
    // HEADERS (type=1), flags = PRIORITY (0x20) | END_HEADERS (0x4), stream=1, length=3
    const frame = new http2utils.Frame(3, 1, 0x20 | 0x4, 1).data;
    socket.write(Buffer.concat([frame, Buffer.alloc(3)]));
  });
  try {
    expect(err).toBeDefined();
    expect(err.code).toBe("ERR_HTTP2_SESSION_ERROR");
    expect(err.message).toBe("Session closed with error code NGHTTP2_FRAME_SIZE_ERROR");
  } finally {
    close();
  }
});

test("should reject DATA frame with Pad Length >= payload length", async () => {
  // RFC 7540 Section 6.1: If the length of the padding is the length of the
  // frame payload or greater, the recipient MUST treat this as a connection
  // error of type PROTOCOL_ERROR.
  const { err, close } = await sendFrames(socket => {
    // Valid HEADERS response first so the DATA frame is accepted on stream 1.
    const headers = new http2utils.HeadersFrame(1, http2utils.kFakeResponseHeaders, 0, true, false);
    socket.write(headers.data);
    // DATA (type=0), flags = PADDED (0x8), stream=1, length=2, payload = [0xFF, 0x00]
    // Pad Length = 255 which exceeds the remaining payload (1 byte).
    const frame = new http2utils.Frame(2, 0, 0x8, 1).data;
    socket.write(Buffer.concat([frame, Buffer.from([0xff, 0x00])]));
  });
  try {
    expect(err).toBeDefined();
    expect(err.code).toBe("ERR_HTTP2_SESSION_ERROR");
    expect(err.message).toBe("Session closed with error code NGHTTP2_PROTOCOL_ERROR");
  } finally {
    close();
  }
});

async function receiveBody(
  write: (socket: net.Socket, onFirstData: Promise<void>) => void | Promise<void>,
): Promise<{ body: Buffer; close: () => void }> {
  const { promise: waitToWrite, resolve: allowWrite } = Promise.withResolvers<void>();
  const { promise: serverListening, resolve: serverResolve } = Promise.withResolvers<void>();
  // Resolves the first time the client request emits 'data', so the server
  // can observe that the parser has already consumed what was sent so far.
  const { promise: onFirstData, resolve: gotFirstData } = Promise.withResolvers<void>();
  const server = net.createServer(async socket => {
    socket.on("error", () => {});
    socket.setNoDelay(true);
    const settings = new http2utils.SettingsFrame(true);
    socket.write(settings.data);
    await waitToWrite;
    const headers = new http2utils.HeadersFrame(1, http2utils.kFakeResponseHeaders, 0, true, false);
    socket.write(headers.data);
    await write(socket, onFirstData);
  });
  server.listen(0, "127.0.0.1", () => serverResolve());
  await serverListening;

  const url = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  const client = http2.connect(url);
  client.on("error", reject);
  client.on("connect", () => {
    const req = client.request({ ":path": "/" });
    const chunks: Buffer[] = [];
    req.on("data", c => {
      chunks.push(Buffer.from(c));
      gotFirstData();
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
    req.end();
    allowWrite();
  });
  const close = () => {
    client.destroy();
    server.close();
  };
  try {
    const body = await promise;
    return { body, close };
  } catch (e) {
    close();
    throw e;
  }
}

test("should strip Pad Length octet from DATA frame when Pad Length is 0", async () => {
  // RFC 7540 Section 6.1: "A frame can be increased in size by one octet by
  // including a Pad Length field with a value of zero." The Pad Length octet
  // is present whenever PADDED is set and must be stripped regardless of its
  // value; previously `padding > 0` was used as the guard so the 0x00 leaked
  // into the response body.
  const { body, close } = await receiveBody(socket => {
    // DATA (type=0), flags = PADDED (0x8) | END_STREAM (0x1), stream=1, length=5
    // payload = [0x00, 'A', 'B', 'C', 'D'] -> Pad Length = 0, body = "ABCD".
    const frame = new http2utils.Frame(5, 0, 0x8 | 0x1, 1).data;
    socket.write(Buffer.concat([frame, Buffer.from([0x00, 0x41, 0x42, 0x43, 0x44])]));
  });
  try {
    expect(body.toString("latin1")).toBe("ABCD");
  } finally {
    close();
  }
});

test("should not drop trailing data byte from padded DATA frame split across reads", async () => {
  // When a padded DATA frame is delivered across multiple socket reads, the
  // Pad Length octet is consumed in the first chunk. On subsequent chunks the
  // frame-relative start offset already accounts for it, so it must not be
  // subtracted a second time when computing how many bytes of this chunk are
  // data (vs trailing padding).
  const { body, close } = await receiveBody(async (socket, onFirstData) => {
    // DATA (type=0), flags = PADDED (0x8) | END_STREAM (0x1), stream=1, length=10
    // payload = [0x02, D1..D7, P1, P2] -> Pad Length = 2, body = 7 bytes.
    // Deliver the frame header + Pad Length octet + first data byte, then
    // wait for the client request to emit 'data' (proving the parser has
    // already consumed the first chunk and will re-enter handleDataFrame
    // with start_idx >= 2 for the remainder) before sending the rest.
    const header = new http2utils.Frame(10, 0, 0x8 | 0x1, 1).data;
    socket.write(Buffer.concat([header, Buffer.from([0x02, 0x41])]));
    await onFirstData;
    socket.write(Buffer.from([0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x00, 0x00]));
  });
  try {
    expect(body.toString("latin1")).toBe("ABCDEFG");
  } finally {
    close();
  }
});

test("should zero-fill padding octets in padded DATA frames sent by the client", async () => {
  // RFC 7540 Section 6.1: "Padding octets MUST be set to zero when sending."
  // Padded DATA frames are assembled in a shared scratch buffer before being
  // written to the socket; the bytes after the payload must be zeroed rather
  // than left with whatever a previous frame stored in that buffer.
  const { promise: serverListening, resolve: serverResolve } = Promise.withResolvers<void>();
  const { promise: firstBodySent, resolve: firstBodyDone } = Promise.withResolvers<void>();
  const { promise: secondBodySent, resolve: secondBodyDone } = Promise.withResolvers<void>();

  type CapturedDataFrame = { streamId: number; padded: boolean; padLength: number; data: Buffer; padding: Buffer };
  const dataFrames: CapturedDataFrame[] = [];
  const bytesPerStream = new Map<number, number>();
  let firstStreamId = -1;

  const firstBody = Buffer.alloc(2048, 0x41); // 2048 x "A"
  const secondBody = Buffer.from("XYZ");

  let received = Buffer.alloc(0);
  let sawPreface = false;

  const server = net.createServer(socket => {
    socket.on("error", () => {});
    socket.setNoDelay(true);
    // Acknowledge the client's SETTINGS so the session emits `connect`.
    socket.write(new http2utils.SettingsFrame(true).data);
    socket.on("data", chunk => {
      received = Buffer.concat([received, chunk]);
      if (!sawPreface) {
        if (received.length < http2utils.kClientMagic.length) return;
        received = received.subarray(http2utils.kClientMagic.length);
        sawPreface = true;
      }
      // Parse complete frames out of the accumulated bytes (frames may span
      // or share TCP reads).
      while (received.length >= 9) {
        const length = (received[0] << 16) | (received[1] << 8) | received[2];
        if (received.length < 9 + length) break;
        const type = received[3];
        const flags = received[4];
        const streamId = received.readUInt32BE(5) & 0x7fffffff;
        const payload = received.subarray(9, 9 + length);
        received = received.subarray(9 + length);
        if (type !== 0) continue; // only DATA frames carry the padding under test
        const padded = (flags & 0x8) !== 0;
        const padLength = padded ? payload[0] : 0;
        const data = Buffer.from(padded ? payload.subarray(1, payload.length - padLength) : payload);
        const padding = Buffer.from(padded ? payload.subarray(payload.length - padLength) : Buffer.alloc(0));
        dataFrames.push({ streamId, padded, padLength, data, padding });
        if (firstStreamId === -1) firstStreamId = streamId;
        const total = (bytesPerStream.get(streamId) ?? 0) + data.length;
        bytesPerStream.set(streamId, total);
        if (streamId === firstStreamId && total >= firstBody.length) firstBodyDone();
        if (streamId !== firstStreamId && total >= secondBody.length) secondBodyDone();
      }
    });
  });
  server.listen(0, "127.0.0.1", () => serverResolve());
  await serverListening;

  const url = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  const client = http2.connect(url);
  client.on("error", () => {});
  try {
    await new Promise<void>(resolve => client.on("connect", () => resolve()));

    const requestOptions = { paddingStrategy: http2.constants.PADDING_STRATEGY_MAX };

    // First request: a longer body, so the scratch buffer used to assemble
    // padded DATA frames has held known payload bytes well past the region
    // the next (shorter) frame's padding will occupy.
    const req1 = client.request({ ":path": "/first", ":method": "POST" }, requestOptions);
    req1.on("error", () => {});
    req1.end(firstBody);
    await firstBodySent;

    // Second request: a much shorter body whose padding region overlaps the
    // buffer offsets the first request's payload occupied.
    const req2 = client.request({ ":path": "/second", ":method": "POST" }, requestOptions);
    req2.on("error", () => {});
    req2.end(secondBody);
    await secondBodySent;

    // The short body must actually have been transmitted in at least one
    // padded DATA frame, otherwise the padding path was never exercised.
    const secondStreamFrames = dataFrames.filter(f => f.streamId !== firstStreamId);
    expect(secondStreamFrames.length).toBeGreaterThan(0);
    expect(secondStreamFrames.some(f => f.padded && f.padLength > 0)).toBe(true);

    // Payload bytes are transmitted intact for both requests.
    expect(Buffer.concat(secondStreamFrames.map(f => f.data)).toString("latin1")).toBe("XYZ");
    const firstStreamData = Buffer.concat(dataFrames.filter(f => f.streamId === firstStreamId).map(f => f.data));
    expect(firstStreamData.equals(firstBody)).toBe(true);

    // RFC 7540 Section 6.1: every padding octet on the wire must be zero —
    // none of them may carry bytes from previously transmitted payloads.
    for (const frame of dataFrames) {
      expect(Array.from(frame.padding).every(byte => byte === 0)).toBe(true);
    }
  } finally {
    client.destroy();
    server.close();
  }
});
