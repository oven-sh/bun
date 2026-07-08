import { TCPSocketListener } from "bun";
import { describe, expect, test } from "bun:test";
import { WebSocket } from "ws";

type HandshakeOutcome = { opened: boolean; code: number; reason: string };

async function handshakeWithConnectionHeader(connectionLines: string): Promise<HandshakeOutcome> {
  let buf = "";
  using server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(socket, data) {
        buf += data.toString("latin1");
        if (!buf.includes("\r\n\r\n")) return;
        const key = /sec-websocket-key: *(\S+)/i.exec(buf)?.[1] ?? "";
        const hasher = new Bun.CryptoHasher("sha1");
        hasher.update(key);
        hasher.update("258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
        const accept = hasher.digest("base64");
        socket.write(
          "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            connectionLines +
            `Sec-WebSocket-Accept: ${accept}\r\n` +
            "\r\n",
        );
        socket.flush();
      },
    },
  });

  const { promise, resolve } = Promise.withResolvers<HandshakeOutcome>();
  let opened = false;
  const ws = new globalThis.WebSocket(`ws://127.0.0.1:${server.port}`);
  ws.addEventListener("open", () => {
    opened = true;
    ws.close();
  });
  ws.addEventListener("close", e => resolve({ opened, code: e.code, reason: e.reason }));
  try {
    return await promise;
  } finally {
    ws.close();
  }
}

// RFC 6455 §4.1 item 6: |Connection| must CONTAIN a token that case-insensitively
// matches "Upgrade". It is a comma-list (RFC 7230 §6.1), and repeated field lines
// are equivalent to their comma-joined form (§3.2.2).
describe("WebSocket Connection header validation", () => {
  test.each([
    ["single token", "Connection: Upgrade\r\n"],
    ["lowercase", "Connection: upgrade\r\n"],
    ["token list, Upgrade last", "Connection: keep-alive, Upgrade\r\n"],
    ["token list, Upgrade first", "Connection: Upgrade, keep-alive\r\n"],
    ["token list, extra whitespace", "Connection:  keep-alive ,  Upgrade \r\n"],
    ["two field lines, Upgrade second", "Connection: keep-alive\r\nConnection: Upgrade\r\n"],
    ["two field lines, Upgrade first", "Connection: Upgrade\r\nConnection: keep-alive\r\n"],
  ])("accepts handshake when Connection contains Upgrade token (%s)", async (_label, lines) => {
    const result = await handshakeWithConnectionHeader(lines);
    expect(result).toEqual({ opened: true, code: 1000, reason: "" });
  });

  test.each([
    ["keep-alive only", "Connection: keep-alive\r\n"],
    ["close only", "Connection: close\r\n"],
    ["substring but not a token", "Connection: Upgrade-Insecure\r\n"],
  ])("rejects handshake when Connection lacks Upgrade token (%s)", async (_label, lines) => {
    const result = await handshakeWithConnectionHeader(lines);
    expect(result).toEqual({ opened: false, code: 1002, reason: "Invalid connection header" });
  });

  test("rejects handshake when Connection header is missing", async () => {
    const result = await handshakeWithConnectionHeader("");
    expect(result).toEqual({ opened: false, code: 1002, reason: "Missing connection header" });
  });
});

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
