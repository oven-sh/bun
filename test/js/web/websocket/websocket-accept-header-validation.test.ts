import { TCPSocketListener } from "bun";
import { describe, expect, test } from "bun:test";
import { WebSocket } from "ws";

describe("WebSocket Sec-WebSocket-Accept validation", () => {
  test("rejects handshake with incorrect Sec-WebSocket-Accept", async () => {
    let server: TCPSocketListener | undefined;
    let client: WebSocket | undefined;

    try {
      server = Bun.listen({
        socket: {
          data(socket, data) {
            const frame = data.toString("utf-8");
            if (!frame.startsWith("GET")) return;

            // Send back a 101 with an INCORRECT Sec-WebSocket-Accept value
            socket.write(
              "HTTP/1.1 101 Switching Protocols\r\n" +
                "Upgrade: websocket\r\n" +
                "Connection: Upgrade\r\n" +
                "Sec-WebSocket-Accept: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
                "\r\n",
            );
            socket.flush();
          },
        },
        hostname: "127.0.0.1",
        port: 0,
      });

      const { promise, resolve } = Promise.withResolvers<{ code: number; reason: string }>();

      client = new WebSocket(`ws://127.0.0.1:${server.port}`);
      client.addEventListener("error", () => {
        // Expected: connection should fail
        resolve({ code: -1, reason: "error" });
      });
      client.addEventListener("close", event => {
        resolve({ code: event.code, reason: event.reason });
      });
      client.addEventListener("open", () => {
        resolve({ code: 0, reason: "opened unexpectedly" });
      });

      const result = await promise;
      // The connection should NOT have opened successfully
      expect(result.code).not.toBe(0);
    } finally {
      client?.close();
      server?.stop(true);
    }
  });

  test("accepts handshake with correct Sec-WebSocket-Accept", async () => {
    let server: TCPSocketListener | undefined;
    let client: WebSocket | undefined;

    try {
      server = Bun.listen({
        socket: {
          data(socket, data) {
            const frame = data.toString("utf-8");
            if (!frame.startsWith("GET")) return;

            const keyMatch = /Sec-WebSocket-Key: (.*)\r\n/.exec(frame);
            if (!keyMatch) return;

            // Compute the CORRECT accept value per RFC 6455
            const hasher = new Bun.CryptoHasher("sha1");
            hasher.update(keyMatch[1]);
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

            // Send a text frame with "hello" to confirm the connection works
            const payload = Buffer.from("hello");
            const wsFrame = Buffer.alloc(2 + payload.length);
            wsFrame[0] = 0x81; // FIN + text opcode
            wsFrame[1] = payload.length;
            payload.copy(wsFrame, 2);
            socket.write(wsFrame);
            socket.flush();
          },
        },
        hostname: "127.0.0.1",
        port: 0,
      });

      const { promise, resolve, reject } = Promise.withResolvers<string>();

      client = new WebSocket(`ws://127.0.0.1:${server.port}`);
      client.addEventListener("error", err => {
        reject(new Error(err.message));
      });
      client.addEventListener("message", event => {
        resolve(event.data.toString("utf-8"));
      });

      expect(await promise).toBe("hello");
    } finally {
      client?.close();
      server?.stop(true);
    }
  });
});
