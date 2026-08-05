import { TCPSocketListener } from "bun";
import { estimateShallowMemoryUsageOf } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import net from "node:net";

const hostname = "127.0.0.1";
const MAX_HEADER_SIZE = 16 * 1024;

function doHandshake(
  socket: any,
  handshakeBuffer: Uint8Array,
  data: Uint8Array,
): { buffer: Uint8Array; done: boolean } {
  const newBuffer = new Uint8Array(handshakeBuffer.length + data.length);
  newBuffer.set(handshakeBuffer);
  newBuffer.set(data, handshakeBuffer.length);

  if (newBuffer.length > MAX_HEADER_SIZE) {
    socket.end();
    throw new Error("Handshake headers too large");
  }

  const dataStr = new TextDecoder("utf-8").decode(newBuffer);
  const endOfHeaders = dataStr.indexOf("\r\n\r\n");
  if (endOfHeaders === -1) {
    return { buffer: newBuffer, done: false };
  }

  if (!dataStr.startsWith("GET")) {
    throw new Error("Invalid handshake");
  }

  const magic = /Sec-WebSocket-Key:\s*(.*)\r\n/i.exec(dataStr);
  if (!magic) {
    throw new Error("Missing Sec-WebSocket-Key");
  }

  const hasher = new Bun.CryptoHasher("sha1");
  hasher.update(magic[1].trim());
  hasher.update("258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
  const accept = hasher.digest("base64");

  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      "\r\n",
  );
  socket.flush();

  return { buffer: newBuffer, done: true };
}

function makeTextFrame(text: string): Uint8Array {
  const payload = new TextEncoder().encode(text);
  const len = payload.length;
  let header: Uint8Array;
  if (len < 126) {
    header = new Uint8Array([0x81, len]);
  } else if (len < 65536) {
    header = new Uint8Array([0x81, 126, (len >> 8) & 0xff, len & 0xff]);
  } else {
    throw new Error("Message too large for this test");
  }
  const frame = new Uint8Array(header.length + len);
  frame.set(header);
  frame.set(payload, header.length);
  return frame;
}

function makeBinaryFrame(payload: Uint8Array, { fin, opcode }: { fin: boolean; opcode: number }): Uint8Array {
  const len = payload.length;
  const b0 = (fin ? 0x80 : 0) | opcode;
  let header: Uint8Array;
  if (len < 126) {
    header = new Uint8Array([b0, len]);
  } else if (len < 65536) {
    header = new Uint8Array([b0, 126, (len >> 8) & 0xff, len & 0xff]);
  } else {
    throw new Error("Message too large for this test");
  }
  const frame = new Uint8Array(header.length + len);
  frame.set(header);
  frame.set(payload, header.length);
  return frame;
}

describe("WebSocket", () => {
  test("fragmented pong frame does not cause frame desync", async () => {
    let server: TCPSocketListener | undefined;
    let client: WebSocket | undefined;
    let handshakeBuffer = new Uint8Array(0);
    let handshakeComplete = false;

    try {
      const { promise, resolve, reject } = Promise.withResolvers<void>();

      server = Bun.listen({
        socket: {
          data(socket, data) {
            if (handshakeComplete) {
              // After handshake, we just receive client frames (like close) - ignore them
              return;
            }

            const result = doHandshake(socket, handshakeBuffer, new Uint8Array(data));
            handshakeBuffer = result.buffer;
            if (!result.done) return;

            handshakeComplete = true;

            // Build a pong frame with a 50-byte payload, but deliver it in two parts.
            // Pong opcode = 0x8A, FIN=1
            const pongPayload = new Uint8Array(50);
            for (let i = 0; i < 50; i++) pongPayload[i] = 0x41 + (i % 26); // 'A'-'Z' repeated
            const pongFrame = new Uint8Array(2 + 50);
            pongFrame[0] = 0x8a; // FIN + Pong opcode
            pongFrame[1] = 50; // payload length
            pongFrame.set(pongPayload, 2);

            // Part 1 of pong: header (2 bytes) + first 2 bytes of payload = 4 bytes
            // This leaves 48 bytes of pong payload undelivered.
            const pongPart1 = pongFrame.slice(0, 4);
            // Part 2: remaining 48 bytes of pong payload
            const pongPart2 = pongFrame.slice(4);

            // A text message to send after the pong completes.
            const textFrame = makeTextFrame("hello after pong");

            // Send part 1 of pong
            socket.write(pongPart1);
            socket.flush();

            // After a delay, send part 2 of pong + the follow-up text message
            setTimeout(() => {
              // Concatenate part2 + text frame to simulate them arriving together
              const combined = new Uint8Array(pongPart2.length + textFrame.length);
              combined.set(pongPart2);
              combined.set(textFrame, pongPart2.length);
              socket.write(combined);
              socket.flush();
            }, 50);
          },
        },
        hostname,
        port: 0,
      });

      const messages: string[] = [];

      client = new WebSocket(`ws://${server.hostname}:${server.port}`);
      client.addEventListener("error", event => {
        reject(new Error("WebSocket error"));
      });
      client.addEventListener("close", event => {
        // If the connection closes unexpectedly due to frame desync, the test should fail
        reject(new Error(`WebSocket closed unexpectedly: code=${event.code} reason=${event.reason}`));
      });
      client.addEventListener("message", event => {
        messages.push(event.data as string);
        if (messages.length === 1) {
          // We got the text message after the fragmented pong
          try {
            expect(messages[0]).toBe("hello after pong");
            resolve();
          } catch (err) {
            reject(err);
          }
        }
      });

      await promise;
    } finally {
      client?.close();
      server?.stop(true);
    }
  });

  test("pong frame with payload > 125 bytes is rejected", async () => {
    let server: TCPSocketListener | undefined;
    let client: WebSocket | undefined;
    let handshakeBuffer = new Uint8Array(0);
    let handshakeComplete = false;

    try {
      const { promise, resolve, reject } = Promise.withResolvers<void>();

      server = Bun.listen({
        socket: {
          data(socket, data) {
            if (handshakeComplete) return;

            const result = doHandshake(socket, handshakeBuffer, new Uint8Array(data));
            handshakeBuffer = result.buffer;
            if (!result.done) return;

            handshakeComplete = true;

            // Send a pong frame with a 126-byte payload (invalid per RFC 6455 Section 5.5)
            // Control frames MUST have a payload length of 125 bytes or less.
            // Use 2-byte extended length encoding since 126 > 125.
            // But actually, the 7-bit length field in byte[1] can encode 0-125 directly.
            // For 126, the server must use the extended 16-bit length.
            // However, control frames with >125 payload are invalid regardless of encoding.
            const pongFrame = new Uint8Array(4 + 126);
            pongFrame[0] = 0x8a; // FIN + Pong
            pongFrame[1] = 126; // Signals 16-bit extended length follows
            pongFrame[2] = 0; // High byte of length
            pongFrame[3] = 126; // Low byte of length = 126
            // Fill payload with arbitrary data
            for (let i = 0; i < 126; i++) pongFrame[4 + i] = 0x42;

            socket.write(pongFrame);
            socket.flush();
          },
        },
        hostname,
        port: 0,
      });

      client = new WebSocket(`ws://${server.hostname}:${server.port}`);
      client.addEventListener("error", () => {
        // Expected - the connection should error due to invalid control frame
        resolve();
      });
      client.addEventListener("close", () => {
        // Also acceptable - connection closes due to protocol error
        resolve();
      });
      client.addEventListener("message", () => {
        reject(new Error("Should not receive a message from an invalid pong frame"));
      });

      await promise;
    } finally {
      client?.close();
      server?.stop(true);
    }
  });

  test("fragmented binary message keeps receive buffer capacity", async () => {
    // The client pre-allocates a receive buffer at connect time. Dispatching a
    // message assembled from multiple fragments must not discard that
    // allocation; the next fragmented message should reuse it instead of
    // reallocating from zero. The reported memory cost of the WebSocket
    // (via estimateShallowMemoryUsageOf) includes that buffer's capacity.
    let server: TCPSocketListener | undefined;
    let client: WebSocket | undefined;
    let handshakeBuffer = new Uint8Array(0);
    let handshakeComplete = false;

    try {
      const { promise, resolve, reject } = Promise.withResolvers<{
        baseline: number;
        after: number;
        fragmented: Uint8Array;
      }>();

      server = Bun.listen({
        socket: {
          data(socket, data) {
            if (handshakeComplete) return;

            const result = doHandshake(socket, handshakeBuffer, new Uint8Array(data));
            handshakeBuffer = result.buffer;
            if (!result.done) return;

            handshakeComplete = true;

            // Three messages in one write so the client parses them in a
            // single handle_data pass (no timing dependence):
            //  1) single-frame binary "A"  -> fast path; baseline measured here
            //  2) two-fragment binary 100B -> buffered in receive_buffer,
            //     dispatched from the buffer
            //  3) single-frame binary "Z"  -> fast path; measured again here
            const msg1 = makeBinaryFrame(Uint8Array.of(0x41), { fin: true, opcode: 0x2 });
            const frag = new Uint8Array(50);
            for (let i = 0; i < frag.length; i++) frag[i] = i & 0xff;
            const msg2a = makeBinaryFrame(frag, { fin: false, opcode: 0x2 });
            const msg2b = makeBinaryFrame(frag, { fin: true, opcode: 0x0 });
            const msg3 = makeBinaryFrame(Uint8Array.of(0x5a), { fin: true, opcode: 0x2 });

            const all = new Uint8Array(msg1.length + msg2a.length + msg2b.length + msg3.length);
            let off = 0;
            for (const part of [msg1, msg2a, msg2b, msg3]) {
              all.set(part, off);
              off += part.length;
            }
            socket.write(all);
            socket.flush();
          },
          error(_socket, err) {
            reject(err);
          },
        },
        hostname,
        port: 0,
      });

      client = new WebSocket(`ws://${server.hostname}:${server.port}`);
      const ws = client;
      ws.binaryType = "arraybuffer";

      let baseline = 0;
      let fragmented: Uint8Array | undefined;
      let received = 0;

      ws.addEventListener("error", () => reject(new Error("WebSocket error")));
      ws.addEventListener("close", ev => {
        reject(new Error(`WebSocket closed unexpectedly: code=${ev.code} reason=${ev.reason}`));
      });
      ws.addEventListener("message", ev => {
        received++;
        const bytes = new Uint8Array(ev.data as ArrayBuffer);
        if (received === 1) {
          // fast-path dispatch; receive_buffer is untouched and still holds
          // its initial pre-allocated capacity
          baseline = estimateShallowMemoryUsageOf(ws);
        } else if (received === 2) {
          fragmented = bytes;
        } else if (received === 3) {
          // fast-path dispatch again; receive_buffer should still hold the
          // capacity it had before the fragmented message
          const after = estimateShallowMemoryUsageOf(ws);
          resolve({ baseline, after, fragmented: fragmented! });
        }
      });

      const { baseline: base, after, fragmented: reassembled } = await promise;

      // Sanity: the fragmented message was reassembled correctly.
      const expected = new Uint8Array(100);
      for (let i = 0; i < 50; i++) {
        expected[i] = i & 0xff;
        expected[50 + i] = i & 0xff;
      }
      expect(reassembled).toEqual(expected);

      // The receive buffer's pre-allocated capacity must survive the
      // fragmented dispatch. estimateShallowMemoryUsageOf includes
      // receive_buffer.capacity(); if the buffer was dropped and replaced
      // with a fresh empty fifo, this drops by the pre-allocated amount.
      expect(base).toBeGreaterThan(0);
      expect(after).toBeGreaterThanOrEqual(base);
    } finally {
      client?.close();
      server?.stop(true);
    }
  });

  test("many fragmented binary messages reassemble without truncation", async () => {
    // The receive buffer is a ring. Clearing it between messages must rewind
    // head to 0; if head only advances, a later message can wrap the ring
    // and readable_slice(0) would hand dispatch only the first contiguous
    // segment. The client pre-allocates 2048 bytes, so two 1000-byte
    // fragmented messages advance head to 2000, and a third message split as
    // 48 + 52 bytes writes across the wrap boundary.
    let server: TCPSocketListener | undefined;
    let client: WebSocket | undefined;
    let handshakeBuffer = new Uint8Array(0);
    let handshakeComplete = false;

    const fill = (n: number, base: number) => {
      const b = new Uint8Array(n);
      for (let i = 0; i < n; i++) b[i] = (base + i) & 0xff;
      return b;
    };

    const expected: Uint8Array[] = [
      new Uint8Array([...fill(500, 0), ...fill(500, 1)]),
      new Uint8Array([...fill(500, 2), ...fill(500, 3)]),
      new Uint8Array([...fill(48, 4), ...fill(52, 5)]),
    ];

    try {
      const { promise, resolve, reject } = Promise.withResolvers<Uint8Array[]>();

      server = Bun.listen({
        socket: {
          data(socket, data) {
            if (handshakeComplete) return;

            const result = doHandshake(socket, handshakeBuffer, new Uint8Array(data));
            handshakeBuffer = result.buffer;
            if (!result.done) return;

            handshakeComplete = true;

            const frames = [
              makeBinaryFrame(fill(500, 0), { fin: false, opcode: 0x2 }),
              makeBinaryFrame(fill(500, 1), { fin: true, opcode: 0x0 }),
              makeBinaryFrame(fill(500, 2), { fin: false, opcode: 0x2 }),
              makeBinaryFrame(fill(500, 3), { fin: true, opcode: 0x0 }),
              makeBinaryFrame(fill(48, 4), { fin: false, opcode: 0x2 }),
              makeBinaryFrame(fill(52, 5), { fin: true, opcode: 0x0 }),
            ];
            const total = frames.reduce((n, f) => n + f.length, 0);
            const all = new Uint8Array(total);
            let off = 0;
            for (const f of frames) {
              all.set(f, off);
              off += f.length;
            }
            socket.write(all);
            socket.flush();
          },
          error(_socket, err) {
            reject(err);
          },
        },
        hostname,
        port: 0,
      });

      client = new WebSocket(`ws://${server.hostname}:${server.port}`);
      const ws = client;
      ws.binaryType = "arraybuffer";

      const received: Uint8Array[] = [];
      ws.addEventListener("error", () => reject(new Error("WebSocket error")));
      ws.addEventListener("close", ev => {
        reject(new Error(`WebSocket closed unexpectedly: code=${ev.code} reason=${ev.reason}`));
      });
      ws.addEventListener("message", ev => {
        received.push(new Uint8Array(ev.data as ArrayBuffer));
        if (received.length === expected.length) resolve(received);
      });

      const got = await promise;
      expect(got.map(b => b.length)).toEqual(expected.map(b => b.length));
      for (let i = 0; i < expected.length; i++) {
        expect(got[i]).toEqual(expected[i]);
      }
    } finally {
      client?.close();
      server?.stop(true);
    }
  });
});

// RFC 6455 5.4: once a data message is fragmented (a data frame with FIN=0),
// only continuation frames and control frames may follow until it completes.
// A new text/binary frame before the message ends must fail the connection.
describe("WebSocket server rejects a new data frame mid-fragment (RFC 6455 5.4)", () => {
  const CONT = 0x0;
  const TEXT = 0x1;
  const BINARY = 0x2;
  const PING = 0x9;

  function maskedFrame(opcode: number, payload: Buffer, fin: boolean): Buffer {
    const mask = Buffer.from([1, 2, 3, 4]);
    const masked = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
    return Buffer.concat([Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | payload.length]), mask, masked]);
  }

  // Connect a raw client, finish the handshake, send `frames`, and report whether
  // the server delivered a message or failed (closed) the connection.
  async function outcomeFor(frames: Buffer[]): Promise<{ outcome: "message" | "closed"; data?: string }> {
    const { promise, resolve, reject } = Promise.withResolvers<{ outcome: "message" | "closed"; data?: string }>();

    using server = Bun.serve({
      port: 0,
      fetch(req, srv) {
        if (srv.upgrade(req)) return;
        return new Response("no", { status: 400 });
      },
      websocket: {
        message(ws, m) {
          resolve({ outcome: "message", data: Buffer.from(m as Buffer).toString() });
        },
      },
    });

    const sock = net.connect(server.port, "127.0.0.1");
    let handshakeDone = false;
    let buf = Buffer.alloc(0);

    sock.on("error", err => {
      if (handshakeDone) resolve({ outcome: "closed" });
      else reject(err);
    });
    sock.on("data", chunk => {
      if (handshakeDone) return;
      buf = Buffer.concat([buf, chunk]);
      const headerEnd = buf.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      // The test only means anything if the upgrade succeeded; otherwise a
      // closed non-websocket connection would masquerade as { outcome: "closed" }.
      const response = buf.subarray(0, headerEnd).toString("utf8");
      if (!response.startsWith("HTTP/1.1 101 ")) {
        sock.destroy();
        reject(new Error(`websocket upgrade failed:\n${response}`));
        return;
      }
      handshakeDone = true;
      sock.write(Buffer.concat(frames));
    });
    sock.on("close", () => {
      if (handshakeDone) resolve({ outcome: "closed" });
      else reject(new Error("socket closed before the websocket upgrade completed"));
    });

    sock.write(
      "GET / HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n" +
        "Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
    );

    try {
      return await promise;
    } finally {
      sock.destroy();
    }
  }

  test("a new BINARY frame inside a fragmented BINARY message fails the connection", async () => {
    expect(
      await outcomeFor([maskedFrame(BINARY, Buffer.from("he"), false), maskedFrame(BINARY, Buffer.from("llo"), true)]),
    ).toEqual({ outcome: "closed" });
  });

  test("a new TEXT frame inside a fragmented TEXT message fails the connection", async () => {
    expect(
      await outcomeFor([maskedFrame(TEXT, Buffer.from("he"), false), maskedFrame(TEXT, Buffer.from("llo"), true)]),
    ).toEqual({ outcome: "closed" });
  });

  test("a new data frame after an interleaved control frame fails the connection", async () => {
    expect(
      await outcomeFor([
        maskedFrame(BINARY, Buffer.from("he"), false),
        maskedFrame(PING, Buffer.from("p"), true),
        maskedFrame(BINARY, Buffer.from("llo"), true),
      ]),
    ).toEqual({ outcome: "closed" });
  });

  test("a fragmented message with a legitimately interleaved control frame is delivered", async () => {
    expect(
      await outcomeFor([
        maskedFrame(BINARY, Buffer.from("he"), false),
        maskedFrame(PING, Buffer.from("p"), true),
        maskedFrame(CONT, Buffer.from("llo"), true),
      ]),
    ).toEqual({ outcome: "message", data: "hello" });
  });
});
