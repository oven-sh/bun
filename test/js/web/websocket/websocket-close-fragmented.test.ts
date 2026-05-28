import { TCPSocketListener } from "bun";
import { describe, expect, test } from "bun:test";

const hostname = "127.0.0.1";
const port = 0;
const MAX_HEADER_SIZE = 16 * 1024; // 16KB max for handshake headers

// Complete the WebSocket handshake, then write the raw Close frame bytes split
// into `parts` across separate TCP segments so the client parser re-enters its
// Close state on a header/body boundary.
async function fragmentedClose(parts: Uint8Array[]): Promise<{ code: number; reason: string; wasClean: boolean }> {
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

          // Write each part in its own TCP segment. The small delay forces a
          // segment boundary at the split point so the parser actually re-enters
          // its Close state mid-frame (a single write can be coalesced).
          const writePart = (i: number) => {
            if (i >= parts.length) return;
            socket.write(parts[i]);
            socket.flush();
            if (i + 1 < parts.length) setTimeout(() => writePart(i + 1), 10);
          };
          writePart(0);
        },
      },
      hostname,
      port,
    });

    const { promise, resolve, reject } = Promise.withResolvers<{
      code: number;
      reason: string;
      wasClean: boolean;
    }>();

    client = new WebSocket(`ws://${server.hostname}:${server.port}`);
    client.addEventListener("error", () => {});
    client.addEventListener("close", event => {
      resolve({ code: event.code, reason: event.reason, wasClean: event.wasClean });
    });

    return await promise;
  } finally {
    client?.close();
    server?.stop(true);
  }
}

// Build a Close frame: FIN + opcode 8, single-byte length, 2-byte code, reason.
function closeFrame(code: number, reason: string): Uint8Array {
  const reasonBytes = new TextEncoder().encode(reason);
  const payloadLength = 2 + reasonBytes.length;
  if (payloadLength >= 126) throw new Error("Payload too large for this test");
  const frame = new Uint8Array(2 + payloadLength);
  frame[0] = 0x88;
  frame[1] = payloadLength;
  frame[2] = (code >> 8) & 0xff;
  frame[3] = code & 0xff;
  frame.set(reasonBytes, 4);
  return frame;
}

describe("WebSocket", () => {
  test("fragmented close frame", async () => {
    // Split mid-reason: header(2) + code(2) + first 10 reason bytes, then the rest.
    const frame = closeFrame(1000, "fragmented close test");
    expect(await fragmentedClose([frame.slice(0, 14), frame.slice(14)])).toEqual({
      code: 1000,
      reason: "fragmented close test",
      wasClean: true,
    });
  });

  // Regression: the Close parser validates the declared payload length only on
  // the first entry. A split that leaves exactly 1 byte buffered must not be
  // re-read as a length==1 frame (which would spuriously fail the connection
  // with "invalid control frame").
  test("close frame split after one body byte preserves code and reason", async () => {
    const frame = closeFrame(1000, "boom");
    expect(await fragmentedClose([frame.slice(0, 3), frame.slice(3)])).toEqual({
      code: 1000,
      reason: "boom",
      wasClean: true,
    });
  });

  // Regression: a split exactly on the header/body boundary leaves 0 bytes
  // buffered; the parser must not treat the frame as bodyless (which would drop
  // the status code and report 1005 "no status received").
  test("close frame split at the header boundary preserves code and reason", async () => {
    const frame = closeFrame(1000, "boom");
    expect(await fragmentedClose([frame.slice(0, 2), frame.slice(2)])).toEqual({
      code: 1000,
      reason: "boom",
      wasClean: true,
    });
  });
});
