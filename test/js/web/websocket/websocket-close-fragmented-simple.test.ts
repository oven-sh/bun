import { TCPSocketListener } from "bun";
import { describe, expect, test } from "bun:test";

const hostname = process.env.HOST || "127.0.0.1";
const port = parseInt(process.env.PORT || "0");

describe("WebSocket fragmented close frame (simple)", () => {
  test("should handle close frame with fragmented reason - raw WebSocket", async () => {
    let server: TCPSocketListener | undefined;
    let hasHandshaked = false;

    try {
      server = Bun.listen({
        socket: {
          data(socket, data) {
            const dataStr = data.toString("utf-8");

            if (!hasHandshaked && dataStr.startsWith("GET")) {
              hasHandshaked = true;

              const magic = /Sec-WebSocket-Key: (.*)\r\n/.exec(dataStr);
              if (!magic) {
                throw new Error("Missing Sec-WebSocket-Key");
              }

              const hasher = new Bun.CryptoHasher("sha1");
              hasher.update(magic[1]);
              hasher.update("258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
              const accept = hasher.digest("base64");

              // Respond with a websocket handshake.
              socket.write(
                "HTTP/1.1 101 Switching Protocols\r\n" +
                  "Upgrade: websocket\r\n" +
                  "Connection: Upgrade\r\n" +
                  `Sec-WebSocket-Accept: ${accept}\r\n` +
                  "\r\n",
              );
              socket.flush();

              const closeCode = 1000;
              const closeReason = "test reason"; // 11 bytes
              const reasonBytes = new TextEncoder().encode(closeReason);
              const payloadLength = 2 + reasonBytes.length; // 13 bytes total

              // Part 1: Frame header + close code + first 5 bytes of reason
              const part1 = new Uint8Array(2 + 2 + 5);
              part1[0] = 0x88; // FIN + Close opcode
              part1[1] = payloadLength; // Payload length
              part1[2] = (closeCode >> 8) & 0xff;
              part1[3] = closeCode & 0xff;
              part1.set(reasonBytes.slice(0, 5), 4);

              socket.write(part1);
              socket.flush();

              // Part 2: Remaining 6 bytes of the close reason
              setTimeout(() => {
                const part2 = reasonBytes.slice(5);
                socket.write(part2);
                socket.flush();
              }, 50);
            } else if (hasHandshaked) {
              // Client's close response
              socket.end();
            }
          },
        },
        hostname,
        port,
      });

      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const timeout = setTimeout(() => reject(new Error("Test timeout")), 3000);

      const ws = new WebSocket(`ws://${server.hostname}:${server.port}`);

      ws.addEventListener("error", err => {
        clearTimeout(timeout);
        reject(err);
      });

      ws.addEventListener("close", event => {
        clearTimeout(timeout);
        expect(event.code).toBe(1000);
        expect(event.reason).toBe("test reason");
        resolve();
      });

      await promise;
    } finally {
      server?.stop(true);
    }
  });
});
