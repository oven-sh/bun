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
