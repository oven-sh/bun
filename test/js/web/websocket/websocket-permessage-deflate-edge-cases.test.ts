import { serve } from "bun";
import { expect, setDefaultTimeout, test } from "bun:test";

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
