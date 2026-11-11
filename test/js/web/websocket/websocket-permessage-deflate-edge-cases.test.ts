import { serve } from "bun";
import { expect, setDefaultTimeout, test } from "bun:test";
import { tls as receiveTls } from "harness";
import crypto from "node:crypto";
import net from "node:net";
import { Worker } from "node:worker_threads";
import { WebSocket as NodeWS } from "ws";
import { createDeflateRaw, deflateRawSync, inflateRawSync, constants as zc } from "node:zlib";
import { createPeer, encodeFrame, OP, RawSocket, response101 } from "./raw-peer";

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
    tcpServer.listen(0, "127.0.0.1", () => {
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
    const connection = new RawSocket(socket, false);
    accepted.resolve(connection);
    let buffer = Buffer.alloc(0);
    let upgraded = false;

    socket.on("data", (data: Buffer) => {
      if (upgraded) return connection.push(data);
      buffer = Buffer.concat([buffer, data]);

      // Look for end of HTTP headers
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      upgraded = true;

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

  const accepted = Promise.withResolvers<RawSocket>();
  let client: WebSocket | null = null;
  let messageReceived = false;

  try {
    // Connect with Bun's WebSocket client
    client = new WebSocket(`ws://127.0.0.1:${port}`);

    let error: string | undefined;
    const result = await new Promise<{ code: number; reason: string }>(resolve => {
      client!.onopen = () => {
        // Connection opened, waiting for the bomb to be sent
      };

      client!.onmessage = () => {
        // Should NOT receive the message - it should be rejected
        messageReceived = true;
      };

      client!.onerror = event => {
        error = (event as ErrorEvent).error?.code;
      };

      client!.onclose = event => {
        resolve({
          code: messageReceived ? -1 : event.code,
          reason: messageReceived ? "Message was received but should have been rejected" : event.reason,
        });
      };
    });

    // The client fails the connection. It sends Close 1009 (Message Too Big) to the server, then fires
    // an error event and a 1006 close event.
    expect({ error, ...result }).toEqual({ error: "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH", code: 1006, reason: "" });
    expect(await (await accepted.promise).next()).toBe("close 1009");
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

/** `error` is the error event's `error.code`. `sent` is the first frame the client sent, e.g. "close 1002". */
type Outcome = { error?: string; code: number; reason: string; messages: unknown[]; sent?: string };

/** The outcome when the client fails the connection with `error.code === error` and sends Close `sent`. */
const failedWith = (error: string, sent: number): Outcome => ({
  error,
  code: 1006,
  reason: "",
  messages: [],
  sent: `close ${sent}`,
});

/**
 * Complete a WebSocket handshake by hand, write `frames`, and report how the
 * client reacted: either how it failed the connection, or the first message it
 * delivered (which for these frames would be a protocol violation).
 */
async function sendRawFrames(
  frames: Uint8Array[],
  { negotiateDeflate }: { negotiateDeflate: boolean },
): Promise<Outcome> {
  const messages: unknown[] = [];
  await using peer = await createPeer({
    headers: negotiateDeflate ? ["Sec-WebSocket-Extensions: permessage-deflate"] : [],
    afterUpgrade: Buffer.concat(frames),
  });
  const client = new WebSocket(peer.url);

  try {
    const { promise, resolve } = Promise.withResolvers<Outcome>();
    // Settle on whichever comes first: a delivered message means the client
    // accepted frames it should have rejected.
    client.onmessage = event => {
      messages.push(event.data);
      resolve({ code: 0, reason: "<still open>", messages });
    };
    let error: string | undefined;
    client.onerror = event => {
      error = (event as ErrorEvent).error?.code;
    };
    client.onclose = async event => {
      const sent = await (await peer.connection()).next();
      resolve({ error, code: event.code, reason: event.reason, messages, sent });
    };
    return await promise;
  } finally {
    client.close();
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

  expect(outcome).toEqual(failedWith("WS_ERR_UNEXPECTED_RSV_1", 1002));
});

test("WebSocket client fails the connection on RSV1 set on a continuation frame without deflate", async () => {
  const outcome = await sendRawFrames(
    [
      frame(OPCODE_TEXT, Buffer.from("Hel"), { fin: false }),
      frame(OPCODE_CONTINUATION, Buffer.from("lo"), { fin: true, rsv1: true }),
    ],
    { negotiateDeflate: false },
  );

  expect(outcome).toEqual(failedWith("WS_ERR_UNEXPECTED_RSV_1", 1002));
});

test.each([true, false])(
  "WebSocket client fails the connection on RSV1 set on a control frame (deflate negotiated: %p)",
  async negotiateDeflate => {
    const outcome = await sendRawFrames([frame(OPCODE_PING, Buffer.from("ping"), { rsv1: true })], {
      negotiateDeflate,
    });

    expect(outcome).toEqual(failedWith("WS_ERR_UNEXPECTED_RSV_1", 1002));
  },
);

// RFC 6455 section 7.4.1: 1007 is for data that is not consistent with the type of the message.
test("WebSocket client fails the connection on a compressed message that fails to inflate", async () => {
  const outcome = await sendRawFrames([frame(OPCODE_TEXT, Buffer.from([0xff, 0xff, 0xff, 0xff]), { rsv1: true })], {
    negotiateDeflate: true,
  });

  expect(outcome).toEqual(failedWith("Z_DATA_ERROR", 1007));
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
        // The next bytes are the client's Close frame. The server has to close the TCP
        // connection first (RFC 6455 7.1.1). The client doesn't send FIN until it does.
        sock.once("data", () => sock.end());
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

const DEFLATE_TRAILER = Buffer.from([0x00, 0x00, 0xff, 0xff]);

// RFC 7692 §7.1.2.2: the client offers `client_max_window_bits` without a
// value, so the server may pick any window from 8 to 15 bits. zlib can't create
// a raw deflater with an 8-bit window, so the client used to negotiate the
// extension but end up without a codec. It still reported the extension in
// `extensions`, sent uncompressed, and closed with 1011 on the first compressed
// server message. It has to compress with a 9-bit window instead. A server using
// the negotiated 256-byte window can still inflate that output, because its
// back-references are at most 250 bytes.
test("WebSocket client honors client_max_window_bits=8", async () => {
  // The same 300 bytes repeated: a compressor using a larger window than
  // negotiated would encode the repeats as back-references that an 8-bit
  // window cannot resolve.
  const block = Buffer.alloc(300);
  let x = 12345;
  for (let i = 0; i < block.length; i++) {
    x = (Math.imul(x, 1103515245) + 12345) | 0;
    block[i] = 0x20 + ((x >>> 16) % 0x5e);
  }
  const clientMessage = Buffer.concat(Array(6).fill(block)).toString("latin1");

  const serverDeflated = deflateRawSync(Buffer.from("hello from the server"), { finishFlush: zc.Z_SYNC_FLUSH });
  const serverFrame = frame(OPCODE_TEXT, serverDeflated.subarray(0, serverDeflated.length - 4), { rsv1: true });

  // Rejected if the connection fails before the events below arrive; every
  // await below races against it.
  const failed = Promise.withResolvers<never>();
  await using peer = await createPeer({
    headers: ["Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits=8"],
    afterUpgrade: Buffer.from(serverFrame),
  });

  const opened = Promise.withResolvers<void>();
  const serverMessage = Promise.withResolvers<string>();
  const ws = new WebSocket(peer.url);
  ws.onopen = () => opened.resolve();
  ws.onmessage = event => serverMessage.resolve(event.data);
  ws.onclose = event => failed.reject(new Error(`closed: code=${event.code} reason=${event.reason}`));

  try {
    await Promise.race([opened.promise, failed.promise]);
    expect(ws.extensions).toBe("permessage-deflate; client_max_window_bits=8");
    ws.send(clientMessage);

    expect(await Promise.race([serverMessage.promise, failed.promise])).toBe("hello from the server");

    const connection = await peer.connection();
    const { fin, rsv, opcode, masked, payload } = (await Promise.race([connection.nextFrame(), failed.promise]))!;
    // 0b100 is RSV1 alone.
    expect({ fin, rsv, opcode, masked }).toEqual({ fin: true, rsv: 0b100, opcode: OPCODE_TEXT, masked: true });
    // Inflate with the window the server negotiated. The small chunkSize makes
    // zlib resolve back-references through that 256-byte window rather than
    // through the output buffer, so a longer distance fails here as it would on
    // a real server.
    const inflated = inflateRawSync(Buffer.concat([payload, DEFLATE_TRAILER]), {
      windowBits: 8,
      chunkSize: 64,
      finishFlush: zc.Z_SYNC_FLUSH,
    });
    expect(inflated.toString("latin1")).toBe(clientMessage);
  } finally {
    ws.close();
  }
});

// Without context takeover the client inflates with libdeflate if the output fits in 128 KiB, and with zlib otherwise.
// With context takeover a repeated message is encoded as references to the previous one, which only zlib can resolve.
test.each([true, false])(
  "WebSocket client inflates messages of every size (server_no_context_takeover=%p)",
  async noContextTakeover => {
    const text = (length: number) => {
      const bytes = Buffer.alloc(length);
      let x = length;
      for (let i = 0; i < length; i++) {
        x = (Math.imul(x, 1103515245) + 12345) | 0;
        bytes[i] = 0x61 + ((x >>> 16) % 6);
      }
      return bytes;
    };
    const KiB = 1024;
    const messages = [1, 100, 100, 2048, 2048, 128 * KiB - 1, 128 * KiB, 128 * KiB + 1, 300 * KiB, 100].map(text);

    const deflater = createDeflateRaw();
    const deflated: Buffer[] = [];
    deflater.on("data", chunk => deflated.push(chunk));
    const frames: Buffer[] = [];
    for (const message of messages) {
      deflated.length = 0;
      deflater.write(message);
      await new Promise<void>(resolve => deflater.flush(zc.Z_SYNC_FLUSH, () => resolve()));
      frames.push(encodeFrame(OP.binary, Buffer.concat(deflated).subarray(0, -4), { rsv1: true }));
      if (noContextTakeover) deflater.reset();
    }

    await using peer = await createPeer({
      headers: [
        "Sec-WebSocket-Extensions: permessage-deflate" + (noContextTakeover ? "; server_no_context_takeover" : ""),
      ],
      afterUpgrade: Buffer.concat(frames),
    });
    const received: Buffer[] = [];
    const done = Promise.withResolvers<void>();
    const ws = new WebSocket(peer.url);
    ws.binaryType = "nodebuffer";
    ws.onmessage = event => void (received.push(event.data) === messages.length && done.resolve());
    ws.onclose = event => done.reject(new Error(`closed: code=${event.code} reason=${event.reason}`));
    try {
      await done.promise;
      expect(received.map(message => message.length)).toEqual(messages.map(message => message.length));
      expect(received.every((message, i) => message.equals(messages[i]))).toBe(true);
    } finally {
      ws.onclose = null;
      ws.terminate();
    }
  },
);

// The client appends bytes to the payload before inflating it. A message that ends in the middle of a block must not
// turn those bytes into data.
test.each([
  ["a final stored block of 5 bytes with no data", "010500faff"],
  ["a fixed Huffman block that ends early", "02ac63"],
])("WebSocket client inflates a truncated message like zlib: %s", async (_, hex) => {
  const payload = Buffer.from(hex, "hex");
  let expected: string;
  try {
    expected = inflateRawSync(Buffer.concat([payload, DEFLATE_TRAILER]), { finishFlush: zc.Z_SYNC_FLUSH }).toString(
      "hex",
    );
  } catch {
    expected = "closed 1006";
  }
  await using peer = await createPeer({
    headers: ["Sec-WebSocket-Extensions: permessage-deflate; server_no_context_takeover"],
    afterUpgrade: encodeFrame(OP.binary, payload, { rsv1: true }),
  });
  const ws = new WebSocket(peer.url);
  ws.binaryType = "nodebuffer";
  const outcome = await new Promise<string>(resolve => {
    ws.onmessage = event => resolve(event.data.toString("hex"));
    ws.onclose = event => resolve(`closed ${event.code}`);
  });
  ws.onclose = null;
  ws.terminate();
  expect(outcome).toBe(expected);
});

function createReceiveClient(api: string, url: string, secure: boolean, perMessageDeflate: boolean) {
  if (api === "ws") {
    return new NodeWS(url, {
      perMessageDeflate,
      ...(secure ? { ca: receiveTls.cert, servername: "localhost" } : {}),
    });
  }
  return new WebSocket(url, secure ? { tls: { ca: receiveTls.cert, serverName: "localhost" } } : undefined);
}

function buildAfterReceive(promise: Promise<void>) {
  return Bun.build({
    entrypoints: ["receive:entry"],
    target: "bun",
    plugins: [
      {
        name: "receive-continuation",
        setup(builder) {
          builder.onResolve({ filter: /^receive:entry$/ }, () => ({ path: "entry", namespace: "receive" }));
          builder.onLoad({ filter: /^entry$/, namespace: "receive" }, () => ({
            contents: "export default 1",
            loader: "js",
          }));
          return promise;
        },
      },
    ],
  });
}

// https://github.com/oven-sh/bun/issues/48524
test.each(
  ["web", "ws"].flatMap(api =>
    (api === "ws" ? ["text", "arraybuffer", "nodebuffer"] : ["text", "blob", "arraybuffer", "nodebuffer"]).flatMap(
      kind =>
        [false, true].flatMap(split =>
          [false, true].flatMap(compressed =>
            ["matcher", "async-plugin-setup"].flatMap(wait =>
              [false, true].map(secure => [api, kind, split, compressed, wait, secure] as const),
            ),
          ),
        ),
    ),
  ),
)(
  "%s WebSocket receive state survives %s promise continuation (split=%p, compressed=%p, wait=%s, secure=%p)",
  async (api, kind, split, compressed, wait, secure) => {
    const compressedFrames = [
      "wUCqVspMUbIy1FEqSi0uzSlRsqoGshJTKpWsSopKU3WUChJTUjLz0pWslAwMjYxNTM3MLSwTk5JTUtNGGl+pthYA",
      "wROqBgeWEXJglSXmlKaOhg4odAAA",
    ].map(value => Buffer.from(value, "base64"));
    const padding = Buffer.alloc(256, "0123456789abcdef").toString();
    const expected = [
      JSON.stringify({ id: 1, result: { ready: true, padding } }),
      JSON.stringify({ id: 2, result: { value: padding } }),
    ];
    const frames = compressed ? compressedFrames : expected.map(message => encodeFrame(OP.text, message));
    if (kind !== "text") for (const frame of frames) frame[0] = compressed ? 0xc2 : 0x82;
    await using peer = await createPeer({
      secure,
      afterUpgrade: split ? frames[0].subarray(0, 5) : undefined,
      respond(connection) {
        connection.socket.setNoDelay(true);
        let handled = 0;
        connection.socket.on("data", () => {
          for (; handled < connection.frames.length; handled++) {
            const frame = connection.frames[handled];
            if (frame.opcode !== OP.text) continue;
            if (frame.payload.toString() === "first")
              connection.socket.write(split ? frames[0].subarray(5) : frames[0]);
            else if (frame.payload.toString() === "second") connection.socket.write(frames[1]);
          }
        });
        return response101(connection, ["Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits=15"]);
      },
    });
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    const failed = Promise.withResolvers<never>();
    const received: string[] = [];
    const ws = createReceiveClient(api, peer.url, secure, true);
    if (kind !== "text") ws.binaryType = kind as WebSocket["binaryType"];
    const sendRequest = (message: string) => {
      if (api === "ws") (ws as NodeWS).send(message, { compress: false });
      else ws.send(message);
    };
    ws.onopen = () => sendRequest("first");
    const observe = (message: string) => {
      received.push(message);
      if (message === expected[0]) first.resolve();
      else if (message === expected[1]) second.resolve();
    };
    ws.onmessage = event => {
      if (kind === "blob") void event.data.text().then(observe, failed.reject);
      else observe(kind === "text" ? event.data : Buffer.from(event.data).toString());
    };
    ws.onerror = event => failed.reject((event as ErrorEvent).error);
    ws.onclose = event => failed.reject(new Error(`closed: code=${event.code} reason=${event.reason}`));
    try {
      await Promise.race([first.promise, failed.promise]);
      sendRequest("second");
      const outcome = Promise.race([second.promise, failed.promise]);
      if (wait === "async-plugin-setup") {
        const build = await buildAfterReceive(outcome);
        expect(build.success).toBe(true);
      } else {
        await expect(
          outcome.then(() => {
            throw new Error("intended rejection");
          }),
        ).rejects.toThrow("intended rejection");
      }
      expect(received).toEqual(expected);
    } finally {
      ws.onerror = null;
      ws.onclose = null;
      ws.terminate();
    }
  },
);

// https://github.com/oven-sh/bun/issues/48524
test("WebSocket coalesced message events retain their microtask ordering", async () => {
  await using peer = await createPeer({
    afterUpgrade: Buffer.concat([encodeFrame(OP.text, "first"), encodeFrame(OP.text, "second")]),
  });
  const done = Promise.withResolvers<void>();
  const order: string[] = [];
  const ws = new WebSocket(peer.url);
  ws.onmessage = ({ data }) => {
    order.push(data);
    queueMicrotask(() => order.push(`microtask ${data}`));
    if (data === "second") done.resolve();
  };
  ws.onerror = event => done.reject((event as ErrorEvent).error);
  ws.onclose = event => done.reject(new Error(`closed: code=${event.code} reason=${event.reason}`));
  try {
    await done.promise;
    expect(order).toEqual(["first", "microtask first", "second", "microtask second"]);
  } finally {
    ws.onerror = null;
    ws.onclose = null;
    ws.terminate();
  }
});

// https://github.com/oven-sh/bun/issues/48524
test("WebSocket binary messages read binaryType when their delivery task runs", async () => {
  await using peer = await createPeer({
    afterUpgrade: Buffer.concat([encodeFrame(OP.binary, "first"), encodeFrame(OP.binary, "second")]),
  });
  const done = Promise.withResolvers<void>();
  const received: string[] = [];
  const ws = new WebSocket(peer.url);
  ws.binaryType = "arraybuffer";
  ws.onmessage = ({ data }) => {
    if (received.length === 0) {
      received.push(
        data instanceof ArrayBuffer ? Buffer.from(data).toString() : `wrong first type: ${data.constructor.name}`,
      );
      ws.binaryType = "blob";
    } else if (data instanceof Blob) {
      void data.text().then(message => {
        received.push(message);
        done.resolve();
      }, done.reject);
    } else {
      done.reject(new Error(`wrong second type: ${data.constructor.name}`));
    }
  };
  ws.onerror = event => done.reject((event as ErrorEvent).error);
  ws.onclose = event => done.reject(new Error(`closed: code=${event.code} reason=${event.reason}`));
  try {
    await done.promise;
    expect(received).toEqual(["first", "second"]);
  } finally {
    ws.onerror = null;
    ws.onclose = null;
    ws.terminate();
  }
});

// https://github.com/oven-sh/bun/issues/48524
test.each(
  ["web", "ws"].flatMap(api =>
    ["upgrade", "socket"].flatMap(input =>
      ["text", "empty-text", "empty-binary"].flatMap(first =>
        [false, true].flatMap(secure => [false, true].map(large => [api, input, first, secure, large] as const)),
      ),
    ),
  ),
)(
  "%s WebSocket retains wire order across coalesced %s data and a nested receive (first=%s, secure=%p, large=%p)",
  async (api, input, firstKind, secure, large) => {
    const expected = [
      firstKind === "text" ? "first" : "",
      large ? Buffer.alloc(20 * 1024, "S").toString() : "second old packet",
      "third new packet",
    ];
    const initial = Buffer.concat([
      encodeFrame(firstKind === "empty-binary" ? OP.binary : OP.text, expected[0]),
      encodeFrame(OP.text, expected[1]),
    ]);
    await using peer = await createPeer({
      secure,
      afterUpgrade: input === "upgrade" ? initial : undefined,
      respond(connection) {
        connection.socket.setNoDelay(true);
        let handled = 0;
        connection.socket.on("data", () => {
          for (; handled < connection.frames.length; handled++) {
            const frame = connection.frames[handled];
            if (frame.opcode !== OP.text) continue;
            const request = frame.payload.toString();
            if (request === "first" && input === "socket") connection.socket.write(initial);
            else if (request === "next") connection.socket.write(encodeFrame(OP.text, expected[2]));
          }
        });
        return response101(connection);
      },
    });
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    const third = Promise.withResolvers<void>();
    const failed = Promise.withResolvers<never>();
    const received: string[] = [];
    const ws = createReceiveClient(api, peer.url, secure, false);
    ws.binaryType = "arraybuffer";
    const sendRequest = (message: string) => {
      if (api === "ws") (ws as NodeWS).send(message, { compress: false });
      else ws.send(message);
    };
    ws.onopen = () => sendRequest("first");
    ws.onmessage = ({ data }) => {
      const message = typeof data === "string" ? data : Buffer.from(data).toString();
      received.push(message);
      if (message === expected[0]) first.resolve();
      else if (message === expected[1]) second.resolve();
      else if (message === expected[2]) third.resolve();
      else failed.reject(new Error("Unexpected message: " + message));
    };
    ws.onerror = event => failed.reject((event as ErrorEvent).error);
    ws.onclose = event => failed.reject(new Error(`closed: code=${event.code} reason=${event.reason}`));
    try {
      await Promise.race([first.promise, failed.promise]);
      sendRequest("next");
      const build = await buildAfterReceive(Promise.race([third.promise, failed.promise]));
      expect(build.success).toBe(true);
      await Promise.race([second.promise, failed.promise]);
      expect(received).toEqual(expected);
    } finally {
      ws.onerror = null;
      ws.onclose = null;
      ws.terminate();
    }
  },
);

// https://github.com/oven-sh/bun/issues/48524
test.each(["web", "ws"].flatMap(api => ["close", "terminate"].map(operation => [api, operation] as const)))(
  "%s WebSocket preserves buffered receive semantics after %s in the first handler",
  async (api, operation) => {
    await using peer = await createPeer({
      afterUpgrade: Buffer.concat([encodeFrame(OP.text, "first"), encodeFrame(OP.text, "buffered second")]),
      respond(connection) {
        let handled = 0;
        connection.socket.on("data", () => {
          for (; handled < connection.frames.length; handled++) {
            const frame = connection.frames[handled];
            if (frame.opcode === OP.close) {
              connection.socket.write(encodeFrame(OP.close, frame.payload));
              connection.socket.end();
            }
          }
        });
        return response101(connection);
      },
    });
    const done = Promise.withResolvers<void>();
    const received: string[] = [];
    const ws = createReceiveClient(api, peer.url, false, false);
    ws.onmessage = ({ data }) => {
      received.push(data);
      if (received.length === 1) {
        if (operation === "close") ws.close(1000);
        else ws.terminate();
      }
    };
    ws.onerror = event => done.reject((event as ErrorEvent).error);
    ws.onclose = () => done.resolve();
    try {
      await done.promise;
      // npm ws drains buffered frames while CLOSING: https://github.com/websockets/ws/blob/8.18.3/lib/websocket.js#L1302
      expect(received).toEqual(api === "ws" ? ["first", "buffered second"] : ["first"]);
    } finally {
      ws.onerror = null;
      ws.onclose = null;
      ws.terminate();
    }
  },
);

// https://github.com/oven-sh/bun/issues/48524
test("terminating a worker releases its queued WebSocket receive tail", async () => {
  await using peer = await createPeer({
    afterUpgrade: Buffer.concat([encodeFrame(OP.text, "first"), encodeFrame(OP.text, Buffer.alloc(20 * 1024, "S"))]),
  });
  const ready = Promise.withResolvers<void>();
  let observed = false;
  const errors: Error[] = [];
  const worker = new Worker(
    `
    import { parentPort, workerData } from "node:worker_threads";
    const ws = new WebSocket(workerData.url);
    ws.onmessage = ({ data }) => {
      if (data !== "first") throw new Error("unexpected first message");
      parentPort.postMessage("pending receive tail");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
    };
    ws.onerror = event => { throw event.error; };
    ws.onclose = () => { throw new Error("closed before termination"); };
  `,
    { eval: true, workerData: { url: peer.url } },
  );
  worker.on("message", message => {
    if (message !== "pending receive tail") ready.reject(new Error("unexpected worker acknowledgement"));
    else {
      observed = true;
      ready.resolve();
    }
  });
  worker.on("error", error => {
    errors.push(error);
    ready.reject(error);
  });
  worker.on("exit", code => {
    if (!observed) ready.reject(new Error("worker exited before receiving: " + code));
  });
  let code: number;
  try {
    await ready.promise;
  } finally {
    code = await worker.terminate();
  }
  expect(code).toBe(1);
  expect(errors).toEqual([]);
});
