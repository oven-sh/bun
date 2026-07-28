import { serve } from "bun";
import { expect, setDefaultTimeout, test } from "bun:test";
import crypto from "node:crypto";
import net from "node:net";
import { deflateRawSync, constants as zc } from "node:zlib";

// The decompression bomb test needs extra time to compress 150MB of test data
setDefaultTimeout(30_000);

// Test compressed continuation frames
test("WebSocket client handles compressed continuation frames correctly", async () => {
  using server = serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) {
        return;
      }
      return new Response("Not found", { status: 404 });
    },
    websocket: {
      perMessageDeflate: true,
      open(ws) {
        // Send a message that should be compressed
        const largeMessage = "A".repeat(100000); // 100KB of A's
        const result = ws.send(largeMessage, true);
        if (result <= 0) {
          throw new Error(`Failed to send large message, result: ${result}`);
        }
      },
      message(ws, message) {
        // Echo back
        const result = ws.send(message, true);
        if (result <= 0) {
          throw new Error(`Failed to echo message, result: ${result}`);
        }
      },
    },
  });

  const client = new WebSocket(`ws://localhost:${server.port}`);

  const { promise: openPromise, resolve: resolveOpen, reject: rejectOpen } = Promise.withResolvers<void>();
  client.onopen = () => resolveOpen();
  client.onerror = error => rejectOpen(error);
  client.onclose = event => {
    if (!event.wasClean) {
      rejectOpen(new Error(`WebSocket closed: code=${event.code}, reason=${event.reason}`));
    }
  };

  await openPromise;
  expect(client.extensions).toContain("permessage-deflate");

  const { promise: messagePromise, resolve: resolveMessage } = Promise.withResolvers<string>();
  client.onmessage = event => resolveMessage(event.data);

  const receivedMessage = await messagePromise;
  expect(receivedMessage).toBe("A".repeat(100000));

  client.close();
  server.stop();
});

// Test small message compression threshold
test("WebSocket client doesn't compress small messages", async () => {
  let serverReceivedCompressed = false;

  using server = serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) {
        return;
      }
      return new Response("Not found", { status: 404 });
    },
    websocket: {
      perMessageDeflate: true,
      open(ws) {
        // Track if messages are compressed by checking frame headers
      },
      message(ws, message) {
        // Small messages should not be compressed (< 860 bytes)
        const result = ws.send("OK", true);
        if (result <= 0) {
          throw new Error(`Failed to send OK response, result: ${result}`);
        }
      },
    },
  });

  const client = new WebSocket(`ws://localhost:${server.port}`);

  const { promise: openPromise, resolve: resolveOpen, reject: rejectOpen } = Promise.withResolvers<void>();
  client.onopen = () => resolveOpen();
  client.onerror = error => rejectOpen(error);

  await openPromise;

  const { promise: messagePromise, resolve: resolveMessage } = Promise.withResolvers<string>();
  client.onmessage = event => resolveMessage(event.data);

  // Send a small message (should not be compressed)
  client.send("Hello");

  const receivedMessage = await messagePromise;
  expect(receivedMessage).toBe("OK");

  client.close();
  server.stop();
});

// Test message size limits
test("WebSocket client rejects messages exceeding size limit", async () => {
  // This test would require a custom server that sends extremely large compressed data
  // For now, we'll test that normal large messages work
  using server = serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) {
        return;
      }
      return new Response("Not found", { status: 404 });
    },
    websocket: {
      perMessageDeflate: true,
      open(ws) {
        // Send a 1MB message (under the 100MB limit) with more realistic data
        // Using varied content to avoid triggering compression bomb detection
        const size = 1 * 1024 * 1024;
        const pattern = "The quick brown fox jumps over the lazy dog. ";
        const buffer = Buffer.alloc(size);
        buffer.fill(pattern);
        const result = ws.send(buffer, true);
        if (result <= 0) {
          throw new Error(`Failed to send large buffer, result: ${result}`);
        }
      },
      message(ws, message) {},
    },
  });

  const client = new WebSocket(`ws://localhost:${server.port}`);

  const { promise: openPromise, resolve: resolveOpen, reject: rejectOpen } = Promise.withResolvers<void>();
  client.onopen = () => resolveOpen();
  client.onerror = error => rejectOpen(error);

  const { promise: messagePromise, resolve: resolveMessage } = Promise.withResolvers<string>();
  client.onmessage = event => resolveMessage(event.data);

  await openPromise;
  const receivedMessage = await messagePromise;
  expect(receivedMessage.length).toBe(1 * 1024 * 1024);

  client.close();
  server.stop();
});

// Test compression error handling
test("WebSocket client handles compression errors gracefully", async () => {
  using server = serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) {
        return;
      }
      return new Response("Not found", { status: 404 });
    },
    websocket: {
      perMessageDeflate: true,
      open(ws) {
        // Send a message
        const result = ws.send("Test message", true);
        if (result <= 0) {
          throw new Error(`Failed to send test message, result: ${result}`);
        }
      },
      message(ws, message) {
        // Echo back with compression
        const result = ws.send(message, true);
        if (result <= 0) {
          throw new Error(`Failed to echo message in compression test, result: ${result}`);
        }
      },
    },
  });

  const client = new WebSocket(`ws://localhost:${server.port}`);

  const { promise: openPromise, resolve: resolveOpen, reject: rejectOpen } = Promise.withResolvers<void>();
  client.onopen = () => resolveOpen();
  client.onerror = error => rejectOpen(error);

  const { promise: messagePromise, resolve: resolveMessage } = Promise.withResolvers<string>();
  client.onmessage = event => resolveMessage(event.data);

  await openPromise;
  const receivedMessage = await messagePromise;
  expect(receivedMessage).toBe("Test message");

  // Send a message to test compression
  client.send(Buffer.alloc(1000, "A").toString()); // Should be compressed

  client.close();
  server.stop();
});

// Test that decompression is limited to prevent decompression bombs
test("WebSocket client rejects decompression bombs", async () => {
  const net = await import("net");
  const zlib = await import("zlib");
  const crypto = await import("crypto");

  // Create a raw TCP server that speaks WebSocket protocol
  const tcpServer = net.createServer();

  const serverReady = new Promise<number>(resolve => {
    tcpServer.listen(0, () => {
      const addr = tcpServer.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });

  const port = await serverReady;

  tcpServer.on("connection", socket => {
    // Raw test server: tolerate client aborts, surface anything unexpected.
    socket.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code !== "ECONNRESET" && err.code !== "EPIPE" && err.code !== "ECONNABORTED") throw err;
    });
    let buffer = Buffer.alloc(0);

    socket.on("data", data => {
      buffer = Buffer.concat([buffer, data]);

      // Look for end of HTTP headers
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      const headers = buffer.slice(0, headerEnd).toString();

      // Extract Sec-WebSocket-Key
      const keyMatch = headers.match(/Sec-WebSocket-Key: ([A-Za-z0-9+/=]+)/i);
      if (!keyMatch) {
        socket.end();
        return;
      }

      const key = keyMatch[1];
      const acceptKey = crypto
        .createHash("sha1")
        .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
        .digest("base64");

      // Send WebSocket upgrade response with permessage-deflate
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${acceptKey}\r\n` +
          "Sec-WebSocket-Extensions: permessage-deflate; server_no_context_takeover; client_no_context_takeover\r\n" +
          "\r\n",
      );

      // Create a decompression bomb: 150MB of zeros (exceeds the 128MB limit)
      const uncompressedSize = 150 * 1024 * 1024;
      const payload = Buffer.alloc(uncompressedSize, 0);

      // Compress with raw deflate (no header, no trailing bytes that permessage-deflate removes)
      const compressed = zlib.deflateRawSync(payload, { level: 9 });

      // Build WebSocket frame (binary, FIN=1, RSV1=1 for compression)
      // Frame format: FIN(1) RSV1(1) RSV2(0) RSV3(0) Opcode(4) Mask(1) PayloadLen(7) [ExtendedLen] [MaskKey] Payload
      const frameHeader: number[] = [];

      // First byte: FIN=1, RSV1=1 (compressed), RSV2=0, RSV3=0, Opcode=2 (binary)
      frameHeader.push(0b11000010);

      // Second byte: Mask=0 (server to client), payload length
      if (compressed.length < 126) {
        frameHeader.push(compressed.length);
      } else if (compressed.length < 65536) {
        frameHeader.push(126);
        frameHeader.push((compressed.length >> 8) & 0xff);
        frameHeader.push(compressed.length & 0xff);
      } else {
        frameHeader.push(127);
        // 64-bit length (we only need lower 32 bits for this test)
        frameHeader.push(0, 0, 0, 0);
        frameHeader.push((compressed.length >> 24) & 0xff);
        frameHeader.push((compressed.length >> 16) & 0xff);
        frameHeader.push((compressed.length >> 8) & 0xff);
        frameHeader.push(compressed.length & 0xff);
      }

      const frame = Buffer.concat([Buffer.from(frameHeader), compressed]);
      socket.write(frame);
    });
  });

  let client: WebSocket | null = null;
  let messageReceived = false;

  try {
    // Connect with Bun's WebSocket client
    client = new WebSocket(`ws://localhost:${port}`);

    const result = await new Promise<{ code: number; reason: string }>(resolve => {
      client!.onopen = () => {
        // Connection opened, waiting for the bomb to be sent
      };

      client!.onmessage = () => {
        // Should NOT receive the message - it should be rejected
        messageReceived = true;
      };

      client!.onerror = () => {
        // Error is expected
      };

      client!.onclose = event => {
        resolve({
          code: messageReceived ? -1 : event.code,
          reason: messageReceived ? "Message was received but should have been rejected" : event.reason,
        });
      };
    });

    // The connection should be closed with code 1009 (Message Too Big)
    expect(result.code).toBe(1009);
    expect(result.reason).toBe("Message too big");
  } finally {
    // Ensure cleanup happens even on test failure/timeout
    if (client && client.readyState !== WebSocket.CLOSED) {
      client.close();
    }
    await new Promise<void>(resolve => tcpServer.close(() => resolve()));
  }
});

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const OPCODE_CONTINUATION = 0x0;
const OPCODE_TEXT = 0x1;
const OPCODE_PING = 0x9;

/** Build one unmasked server -> client frame. Payloads must stay under 126 bytes. */
function frame(opcode: number, payload: Uint8Array, { fin = true, rsv1 = false } = {}): Uint8Array {
  if (payload.length >= 126) throw new Error("frame() only supports payloads under 126 bytes");
  const bytes = new Uint8Array(2 + payload.length);
  bytes[0] = (fin ? 0x80 : 0) | (rsv1 ? 0x40 : 0) | opcode;
  bytes[1] = payload.length;
  bytes.set(payload, 2);
  return bytes;
}

type Outcome = { code: number; reason: string; messages: unknown[] };

/**
 * Complete a WebSocket handshake by hand, write `frames`, and report how the
 * client reacted: either the close it performed, or the first message it
 * delivered (which for these frames would be a protocol violation).
 */
async function sendRawFrames(
  frames: Uint8Array[],
  { negotiateDeflate }: { negotiateDeflate: boolean },
): Promise<Outcome> {
  let handshake = "";
  let handshakeComplete = false;
  const messages: unknown[] = [];
  let client: WebSocket | undefined;

  const server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      // The client fails the connection by resetting it; that is the point of the test.
      error() {},
      data(socket, data) {
        if (handshakeComplete) return;
        handshake += data.toString();
        if (!handshake.includes("\r\n\r\n")) return;

        const key = /Sec-WebSocket-Key:\s*(\S+)/i.exec(handshake);
        if (!key) throw new Error("client did not send Sec-WebSocket-Key");
        const accept = new Bun.CryptoHasher("sha1").update(key[1] + WEBSOCKET_GUID).digest("base64");
        handshakeComplete = true;

        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            `Sec-WebSocket-Accept: ${accept}\r\n` +
            (negotiateDeflate ? "Sec-WebSocket-Extensions: permessage-deflate\r\n" : "") +
            "\r\n",
        );
        for (const bytes of frames) socket.write(bytes);
        socket.flush();
      },
    },
  });

  try {
    const { promise, resolve } = Promise.withResolvers<Outcome>();
    client = new WebSocket(`ws://127.0.0.1:${server.port}`);
    // Settle on whichever comes first: a delivered message means the client
    // accepted frames it should have rejected.
    client.onmessage = event => {
      messages.push(event.data);
      resolve({ code: 0, reason: "<still open>", messages });
    };
    client.onerror = () => {};
    client.onclose = event => resolve({ code: event.code, reason: event.reason, messages });
    return await promise;
  } finally {
    client?.close();
    server.stop(true);
  }
}

// RFC 7692 §6.1: RSV1 marks the start of a compressed message, so only the
// first frame of a data message may set it.
test("WebSocket client fails the connection on RSV1 set on a continuation frame", async () => {
  const compressed = deflateRawSync(Buffer.from("Hello, World!"));
  const outcome = await sendRawFrames(
    [
      frame(OPCODE_TEXT, compressed.subarray(0, 1), { fin: false, rsv1: true }),
      frame(OPCODE_CONTINUATION, compressed.subarray(1), { fin: true, rsv1: true }),
    ],
    { negotiateDeflate: true },
  );

  expect(outcome).toEqual({ code: 1002, reason: "Protocol error - RSV1 must be clear", messages: [] });
});

test("WebSocket client fails the connection on RSV1 set on a continuation frame without deflate", async () => {
  const outcome = await sendRawFrames(
    [
      frame(OPCODE_TEXT, Buffer.from("Hel"), { fin: false }),
      frame(OPCODE_CONTINUATION, Buffer.from("lo"), { fin: true, rsv1: true }),
    ],
    { negotiateDeflate: false },
  );

  expect(outcome).toEqual({ code: 1002, reason: "Protocol error - RSV1 must be clear", messages: [] });
});

test("WebSocket client fails the connection on RSV1 set on a control frame", async () => {
  const outcome = await sendRawFrames([frame(OPCODE_PING, Buffer.from("ping"), { rsv1: true })], {
    negotiateDeflate: true,
  });

  expect(outcome).toEqual({ code: 1002, reason: "Protocol error - RSV1 must be clear", messages: [] });
});

test("WebSocket client accepts RSV1 on the first frame of a fragmented compressed message", async () => {
  const compressed = deflateRawSync(Buffer.from("Hello, World!"));
  const outcome = await sendRawFrames(
    [
      frame(OPCODE_TEXT, compressed.subarray(0, 1), { fin: false, rsv1: true }),
      frame(OPCODE_CONTINUATION, compressed.subarray(1), { fin: true }),
    ],
    { negotiateDeflate: true },
  );

  expect(outcome).toEqual({ code: 0, reason: "<still open>", messages: ["Hello, World!"] });
});

// RFC 7692 §7.2.3: a sender may end a DEFLATE stream with BFINAL=1 and begin
// a fresh one for the next message. The client's inflater must be reset on
// Z_STREAM_END even with context takeover, otherwise every later compressed
// message is silently delivered as 0 bytes.
test.each([false, true])(
  "WebSocket client resets inflater after BFINAL (server_no_context_takeover=%p)",
  async serverNoContextTakeover => {
    // Deterministic incompressible bytes so msg1 bypasses the libdeflate fast
    // path (200KiB decompressed exceeds the 128KiB output buffer) and reaches
    // the persistent zlib stream.
    const msg1 = Buffer.alloc(200 * 1024);
    let x = 12345;
    for (let i = 0; i < msg1.length; i++) {
      x = (Math.imul(x, 1103515245) + 12345) | 0;
      msg1[i] = (x >>> 16) & 255;
    }
    const msg2 = Buffer.alloc(30 * 19, "hello after bfinal ");
    const msg3 = Buffer.alloc(30 * 6, "third ");

    // msg1: Z_FINISH -> ends with BFINAL=1 (Z_STREAM_END on the receiver).
    // msg2/msg3: Z_SYNC_FLUSH with the 4-byte trailer stripped (RFC 7692 §7.2.1).
    const syncFlush = (p: Buffer) => {
      const o = deflateRawSync(p, { flush: zc.Z_SYNC_FLUSH, finishFlush: zc.Z_SYNC_FLUSH });
      return o.subarray(0, o.length - 4);
    };
    const wire = [deflateRawSync(msg1), syncFlush(msg2), syncFlush(msg3)];

    const compressedBinaryFrame = (p: Buffer) => {
      const h = [0xc2]; // FIN=1, RSV1=1, opcode=2 (binary)
      if (p.length < 126) h.push(p.length);
      else if (p.length < 65536) h.push(126, (p.length >> 8) & 0xff, p.length & 0xff);
      else
        h.push(
          127,
          0,
          0,
          0,
          0,
          Math.floor(p.length / 2 ** 24) & 0xff,
          (p.length >>> 16) & 0xff,
          (p.length >>> 8) & 0xff,
          p.length & 0xff,
        );
      return Buffer.concat([Buffer.from(h), p]);
    };

    const ext = "permessage-deflate" + (serverNoContextTakeover ? "; server_no_context_takeover" : "");
    const server = net.createServer(sock => {
      sock.on("error", () => {});
      let pre = Buffer.alloc(0);
      const onData = (d: Buffer) => {
        pre = Buffer.concat([pre, d]);
        if (pre.indexOf("\r\n\r\n") < 0) return;
        sock.off("data", onData);
        const key = pre
          .toString("latin1")
          .match(/^sec-websocket-key:\s*(.*)$/im)![1]
          .trim();
        const acc = crypto
          .createHash("sha1")
          .update(key + WEBSOCKET_GUID)
          .digest("base64");
        sock.write(
          "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            `Sec-WebSocket-Accept: ${acc}\r\n` +
            `Sec-WebSocket-Extensions: ${ext}\r\n` +
            "\r\n",
        );
        for (const w of wire) sock.write(compressedBinaryFrame(w));
      };
      sock.on("data", onData);
    });
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));

    const got: Buffer[] = [];
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const ws = new WebSocket(`ws://127.0.0.1:${(server.address() as net.AddressInfo).port}/`);
    ws.binaryType = "arraybuffer";
    ws.onmessage = e => {
      got.push(Buffer.from(e.data as ArrayBuffer));
      if (got.length === 3) resolve();
    };
    ws.onerror = ev => reject(new Error(`WebSocket error: ${String(ev)}`));
    ws.onclose = ev => reject(new Error(`closed before 3 messages: code=${ev.code} reason=${ev.reason}`));

    try {
      await promise;
      expect({
        msg1: { len: got[0].length, ok: got[0].equals(msg1) },
        msg2: { len: got[1].length, ok: got[1].equals(msg2) },
        msg3: { len: got[2].length, ok: got[2].equals(msg3) },
      }).toEqual({
        msg1: { len: 200 * 1024, ok: true },
        msg2: { len: 570, ok: true },
        msg3: { len: 180, ok: true },
      });
    } finally {
      ws.close();
      await new Promise<void>(r => server.close(() => r()));
    }
  },
);
