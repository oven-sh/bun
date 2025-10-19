import { TCPSocketListener } from "bun";
import { describe, expect, test } from "bun:test";
import { WebSocket } from "ws";

const hostname = process.env.HOST || "127.0.0.1";
const port = parseInt(process.env.PORT || "0");

describe("WebSocket fragmented close frame", () => {
  test("should handle close frame with fragmented reason", async () => {
    let server: TCPSocketListener | undefined;
    let client: WebSocket | undefined;
    let init = false;

    try {
      server = Bun.listen({
        socket: {
          data(socket, data) {
            if (init) {
              return;
            }

            init = true;

            const frame = data.toString("utf-8");
            if (!frame.startsWith("GET")) {
              throw new Error("Invalid handshake");
            }

            const magic = /Sec-WebSocket-Key: (.*)\r\n/.exec(frame);
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

            // Send a close frame (opcode 0x88) with FIN=1
            // The close frame has:
            // - 1 byte: FIN (1) + opcode (8) = 0x88
            // - 1 byte: MASK (0) + payload length (24) = 0x18
            // - 2 bytes: close code 1000 (0x03 0xe8)
            // - 22 bytes: close reason "fragmented close test"
            //
            // We'll send this in two parts to trigger the bug:
            // Part 1: header + first 12 bytes of payload (header + code + partial reason)
            // Part 2: remaining 12 bytes of payload

            const closeCode = 1000;
            const closeReason = "fragmented close test";
            const reasonBytes = new TextEncoder().encode(closeReason);
            const payloadLength = 2 + reasonBytes.length; // 2 bytes for code + reason

            // Part 1: Frame header + close code + first 10 bytes of reason
            const part1 = new Uint8Array(2 + 2 + 10);
            part1[0] = 0x88; // FIN + Close opcode
            part1[1] = payloadLength; // Payload length (24 bytes total)
            part1[2] = (closeCode >> 8) & 0xff; // Close code high byte
            part1[3] = closeCode & 0xff; // Close code low byte
            // Copy first 10 bytes of reason
            part1.set(reasonBytes.slice(0, 10), 4);

            socket.write(part1);
            socket.flush();

            // Part 2: Remaining bytes of the close reason after a small delay
            setTimeout(() => {
              const part2 = reasonBytes.slice(10);
              socket.write(part2);
              socket.flush();
            }, 10);
          },
        },
        hostname,
        port,
      });

      const { promise, resolve, reject } = Promise.withResolvers<void>();

      client = new WebSocket(`ws://${server.hostname}:${server.port}`);
      client.addEventListener("error", err => {
        reject(new Error(err.message));
      });
      client.addEventListener("close", event => {
        // Should receive the close event without panic
        expect(event.code).toBe(1000);
        expect(event.reason).toBe("fragmented close test");
        resolve();
      });

      await promise;
    } finally {
      client?.close();
      server?.stop(true);
    }
  });
});
