import { TCPSocketListener } from "bun";
import { expect, test } from "bun:test";

// `WebSocket.protocol` is the subprotocol the server chose, once the connection is established, so
// the handshake that fails leaves it empty.
const failedProtocol = async (extraHeaders: string, accept?: string) => {
  let server: TCPSocketListener | undefined;
  try {
    server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data(socket, data) {
          const request = data.toString("utf-8");
          const key = /Sec-WebSocket-Key: (.*)\r\n/i.exec(request)?.[1];
          if (!key) return;
          const hasher = new Bun.CryptoHasher("sha1");
          hasher.update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
          socket.write(
            "HTTP/1.1 101 Switching Protocols\r\n" +
              "Upgrade: websocket\r\n" +
              "Connection: Upgrade\r\n" +
              `Sec-WebSocket-Accept: ${accept ?? hasher.digest("base64")}\r\n` +
              extraHeaders +
              "\r\n",
          );
          socket.flush();
        },
      },
    });
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, ["a", "b"]);
    const { promise, resolve } = Promise.withResolvers<string>();
    ws.addEventListener("open", () => resolve("open"));
    ws.addEventListener("close", () => resolve("close"));
    expect(await promise).toBe("close");
    return ws.protocol;
  } finally {
    server?.stop(true);
  }
};

test("a handshake with two Sec-WebSocket-Protocol headers fails with an empty protocol", async () => {
  expect(await failedProtocol("Sec-WebSocket-Protocol: a\r\nSec-WebSocket-Protocol: a\r\n")).toBe("");
});

test("a handshake with a wrong Sec-WebSocket-Accept fails with an empty protocol", async () => {
  expect(await failedProtocol("Sec-WebSocket-Protocol: a\r\n", "dGhlIHNhbXBsZSBub25jZQ==")).toBe("");
});
