import { TCPSocketListener } from "bun";
import { describe, expect, test } from "bun:test";

const hostname = "127.0.0.1";
const port = 0;
const MAX_HEADER_SIZE = 16 * 1024; // 16KB max for handshake headers

describe("WebSocket", () => {
  test("fragmented close frame", async () => {
    let server: TCPSocketListener | undefined;
    let client: WebSocket | undefined;
    let handshakeBuffer = new Uint8Array(0);
    let handshakeComplete = false;

    try {
      server = Bun.listen({
        socket: {
          data(socket, data) {
            if (handshakeComplete) {
              // Client's close response - end the connection
              socket.end();
              return;
            }

            // Accumulate handshake data
            const newBuffer = new Uint8Array(handshakeBuffer.length + data.length);
            newBuffer.set(handshakeBuffer);
            newBuffer.set(data, handshakeBuffer.length);
            handshakeBuffer = newBuffer;

            // Prevent unbounded growth
            if (handshakeBuffer.length > MAX_HEADER_SIZE) {
              socket.end();
              throw new Error("Handshake headers too large");
            }

            // Check for end of HTTP headers
            const dataStr = new TextDecoder("utf-8").decode(handshakeBuffer);
            const endOfHeaders = dataStr.indexOf("\r\n\r\n");
            if (endOfHeaders === -1) {
              // Need more data
              return;
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

            // Respond with a websocket handshake
            socket.write(
              "HTTP/1.1 101 Switching Protocols\r\n" +
                "Upgrade: websocket\r\n" +
                "Connection: Upgrade\r\n" +
                `Sec-WebSocket-Accept: ${accept}\r\n` +
                "\r\n",
            );
            socket.flush();

            handshakeComplete = true;

            // Send a close frame split across two writes to simulate TCP fragmentation.
            // Close frame: FIN=1, opcode=8 (close), payload = 2 byte code + 21 byte reason
            const closeCode = 1000;
            const closeReason = "fragmented close test";
            const reasonBytes = new TextEncoder().encode(closeReason);
            const payloadLength = 2 + reasonBytes.length; // 23 bytes total

            // Ensure payload fits in single-byte length field
            if (payloadLength >= 126) {
              throw new Error("Payload too large for this test");
            }

            // Part 1: Frame header (2 bytes) + close code (2 bytes) + first 10 bytes of reason = 14 bytes
            const part1 = new Uint8Array(2 + 2 + 10);
            part1[0] = 0x88; // FIN + Close opcode
            part1[1] = payloadLength; // Single-byte payload length
            part1[2] = (closeCode >> 8) & 0xff;
            part1[3] = closeCode & 0xff;
            part1.set(reasonBytes.slice(0, 10), 4);

            socket.write(part1);
            socket.flush();

            // Part 2: Remaining 11 bytes of the close reason
            setTimeout(() => {
              socket.write(reasonBytes.slice(10));
              socket.flush();
            }, 10);
          },
        },
        hostname,
        port,
      });

      const { promise, resolve, reject } = Promise.withResolvers<void>();

      client = new WebSocket(`ws://${server.hostname}:${server.port}`);
      client.addEventListener("error", () => {
        reject(new Error("WebSocket error"));
      });
      client.addEventListener("close", event => {
        try {
          expect(event.code).toBe(1000);
          expect(event.reason).toBe("fragmented close test");
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      await promise;
    } finally {
      client?.close();
      server?.stop(true);
    }
  });
});

describe("WebSocket close frame split across two reads", () => {
  // FIN + Close opcode, 5-byte payload: status code 4000, reason "bye".
  const closeFrame = Buffer.from([0x88, 0x05, 0x0f, 0xa0, 0x62, 0x79, 0x65]);
  const emptyPing = Buffer.from([0x89, 0x00]);

  // Unmasks the client-to-server frames in `buf`. Control frames only, so 7-bit lengths.
  function readClientFrames(buf: Buffer) {
    const frames: { opcode: number; payload: Buffer }[] = [];
    while (buf.length >= 6 && buf.length >= 6 + (buf[1] & 0x7f)) {
      const len = buf[1] & 0x7f;
      const mask = buf.subarray(2, 6);
      const payload = Buffer.from(buf.subarray(6, 6 + len));
      for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      frames.push({ opcode: buf[0] & 0x0f, payload });
      buf = buf.subarray(6 + len);
    }
    return { frames, rest: buf };
  }

  test.concurrent.each([1, 2, 3, 4, 5, 6])("after byte %d of 7", async cut => {
    const echoed = Promise.withResolvers<{ code: number | null; reason: string } | null>();

    using server = Bun.listen<{ buf: Buffer; upgraded: boolean; sentTail: boolean }>({
      hostname,
      port,
      socket: {
        open(socket) {
          socket.data = { buf: Buffer.alloc(0), upgraded: false, sentTail: false };
        },
        data(socket, chunk) {
          const st = socket.data;
          st.buf = Buffer.concat([st.buf, chunk]);

          if (!st.upgraded) {
            const end = st.buf.indexOf("\r\n\r\n");
            if (end === -1) return;
            const key = /Sec-WebSocket-Key:\s*(\S+)/i.exec(st.buf.toString("latin1", 0, end))![1];
            st.buf = st.buf.subarray(end + 4);
            st.upgraded = true;

            const hasher = new Bun.CryptoHasher("sha1");
            hasher.update(key);
            hasher.update("258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
            socket.write(
              "HTTP/1.1 101 Switching Protocols\r\n" +
                "Upgrade: websocket\r\n" +
                "Connection: Upgrade\r\n" +
                `Sec-WebSocket-Accept: ${hasher.digest("base64")}\r\n` +
                "\r\n",
            );
            // A Ping goes out in front of the first part of the Close frame. The
            // Pong that answers it proves the client has read that part, so the
            // rest of the frame below always lands in a later read.
            socket.write(Buffer.concat([emptyPing, closeFrame.subarray(0, cut)]));
            socket.flush();
          }

          const { frames, rest } = readClientFrames(st.buf);
          st.buf = rest;
          for (const { opcode, payload } of frames) {
            if (opcode === 0xa && !st.sentTail) {
              st.sentTail = true;
              socket.write(closeFrame.subarray(cut));
              socket.flush();
            } else if (opcode === 0x8) {
              echoed.resolve({
                code: payload.length >= 2 ? payload.readUInt16BE(0) : null,
                reason: payload.toString("utf8", 2),
              });
              socket.end();
            }
          }
        },
        close() {
          echoed.resolve(null);
        },
        error() {
          echoed.resolve(null);
        },
      },
    });

    const closed = Promise.withResolvers<{ code: number; reason: string; wasClean: boolean }>();
    const ws = new WebSocket(`ws://${server.hostname}:${server.port}`);
    ws.onclose = ev => closed.resolve({ code: ev.code, reason: ev.reason, wasClean: ev.wasClean });

    try {
      expect(await closed.promise).toEqual({ code: 4000, reason: "bye", wasClean: true });
      // The client echoes the status code it received (RFC 6455 section 5.5.1).
      expect(await echoed.promise).toEqual({ code: 4000, reason: "bye" });
    } finally {
      ws.close();
    }
  });
});
