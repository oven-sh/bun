// RFC 6455 7.1.7: before failing the connection, the server sends a Close frame
// with 1002 (protocol error), 1007 (invalid data) or 1009 (too big) and the
// error message as the reason. The close handler gets 1006 with the same
// message. A peer can't send 1006, so it always means the server aborted.
import { describe, expect, test } from "bun:test";
import { tls as cert } from "harness";
import net from "node:net";
import tls from "node:tls";

const CONT = 0x0;
const TEXT = 0x1;
const BINARY = 0x2;
const CLOSE = 0x8;
const PING = 0x9;

type FrameOptions = { fin?: boolean; rsv?: number; mask?: boolean; declaredLength?: number };

// Builds a client frame. `rsv` is a bit mask: 4 = RSV1, 2 = RSV2, 1 = RSV3.
function frame(opcode: number, payload: string | Buffer | number[] = "", options: FrameOptions = {}): Buffer {
  const { fin = true, rsv = 0, mask = true } = options;
  const body = Buffer.from(payload as string);
  const length = options.declaredLength ?? body.length;
  const maskBit = mask ? 0x80 : 0;
  let head: Buffer;
  if (length < 126) {
    head = Buffer.from([0, maskBit | length]);
  } else if (length < 65536) {
    head = Buffer.from([0, maskBit | 126, length >> 8, length & 0xff]);
  } else {
    head = Buffer.alloc(10);
    head[1] = maskBit | 127;
    head.writeBigUInt64BE(BigInt(length), 2);
  }
  head[0] = (fin ? 0x80 : 0) | (rsv << 4) | opcode;
  if (!mask) return Buffer.concat([head, body]);
  const key = [0x37, 0xfa, 0x21, 0x3d];
  return Buffer.concat([head, Buffer.from(key), body.map((byte, i) => byte ^ key[i & 3])]);
}

function closeBody(code: number, reason: string | number[] = ""): Buffer {
  return Buffer.concat([Buffer.from([code >> 8, code & 0xff]), Buffer.from(reason as string)]);
}

// Formats the frames the server sent, one string per frame.
function describeFrames(bytes: Buffer): string[] {
  const names: Record<number, string> = { 1: "TEXT", 2: "BINARY", 8: "CLOSE", 9: "PING", 10: "PONG" };
  const out: string[] = [];
  while (bytes.length >= 2 && bytes[1] < 126 && bytes.length >= 2 + bytes[1]) {
    const payload = bytes.subarray(2, 2 + bytes[1]);
    const text =
      (bytes[0] & 0xf) === CLOSE && payload.length >= 2
        ? `${payload.readUInt16BE(0)} ${JSON.stringify(payload.subarray(2).toString())}`
        : JSON.stringify(payload.toString());
    out.push(`${names[bytes[0] & 0xf] ?? bytes[0] & 0xf} ${text}`);
    bytes = bytes.subarray(2 + payload.length);
  }
  if (bytes.length) out.push(`${bytes.length} more bytes`);
  return out;
}

describe.concurrent.each(["ws", "wss"] as const)("%s: failing the connection", scheme => {
  // Upgrades over a raw socket, writes `bytes` in one write, and reads until the server's FIN.
  // The server echoes every message.
  async function probe(bytes: Buffer, options: { maxPayloadLength?: number } = {}) {
    const events: string[] = [];
    const serverClosed = Promise.withResolvers<void>();
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      ...(scheme === "wss" ? { tls: cert } : {}),
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("upgrade failed", { status: 400 });
      },
      websocket: {
        maxPayloadLength: options.maxPayloadLength ?? 1024,
        message(ws, message) {
          events.push(`message ${JSON.stringify(message.toString())}`);
          ws.send(message);
        },
        close(ws, code, reason) {
          events.push(`close ${code} ${JSON.stringify(reason)}`);
          serverClosed.resolve();
        },
      },
    });

    const socket =
      scheme === "wss"
        ? tls.connect({ port: server.port, host: "127.0.0.1", rejectUnauthorized: false })
        : net.connect({ port: server.port!, host: "127.0.0.1" });
    try {
      const finished = Promise.withResolvers<string>();
      let received = Buffer.alloc(0);
      let head: string | undefined;
      socket.on("data", chunk => {
        received = Buffer.concat([received, chunk]);
        if (head !== undefined) return;
        const end = received.indexOf("\r\n\r\n");
        if (end === -1) return;
        head = received.subarray(0, end).toString();
        received = received.subarray(end + 4);
        if (!head.startsWith("HTTP/1.1 101 ")) return finished.reject(new Error(`upgrade failed: ${head}`));
        socket.write(bytes);
      });
      socket.on("end", () => finished.resolve("FIN"));
      socket.on("error", error => finished.resolve((error as NodeJS.ErrnoException).code!));
      socket.on("close", () => finished.resolve("closed without a FIN"));
      socket.write(
        "GET / HTTP/1.1\r\n" +
          "Host: localhost\r\n" +
          "Connection: Upgrade\r\n" +
          "Upgrade: websocket\r\n" +
          "Sec-WebSocket-Version: 13\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
      );
      const ending = await finished.promise;
      await serverClosed.promise;
      return { wire: [...describeFrames(received), ending], events };
    } finally {
      socket.destroy();
    }
  }

  function failed(code: number, diagnostic: string) {
    return {
      wire: [`CLOSE ${code} ${JSON.stringify(diagnostic)}`, "FIN"],
      events: [`close 1006 ${JSON.stringify(diagnostic)}`],
    };
  }

  const interleaved = "Received new message inside a fragmented message";
  const violations: [name: string, bytes: Buffer, code: number, diagnostic: string][] = [
    ["an unmasked frame", frame(TEXT, "hi", { mask: false }), 1002, "Received an incorrectly masked frame"],
    ["RSV1 without permessage-deflate", frame(TEXT, "hi", { rsv: 4 }), 1002, "Received unexpected RSV1 bit"],
    ["RSV2", frame(TEXT, "hi", { rsv: 2 }), 1002, "Received unexpected RSV2 or RSV3 bit"],
    ["RSV3 on a ping", frame(PING, "hi", { rsv: 1 }), 1002, "Received unexpected RSV2 or RSV3 bit"],
    ["opcode 3", frame(3), 1002, "Received invalid opcode"],
    ["opcode 7", frame(7, "hi"), 1002, "Received invalid opcode"],
    ["opcode 11", frame(11), 1002, "Received invalid opcode"],
    ["opcode 15", frame(15, "hi"), 1002, "Received invalid opcode"],
    ["a ping without FIN", frame(PING, "hi", { fin: false }), 1002, "Received fragmented control frame"],
    ["a Close without FIN", frame(CLOSE, closeBody(1000), { fin: false }), 1002, "Received fragmented control frame"],
    ["a 126-byte ping", frame(PING, Buffer.alloc(126, "a")), 1002, "Received too big control frame"],
    [
      "a 126-byte Close",
      frame(CLOSE, closeBody(1000, Buffer.alloc(124, "a").toString())),
      1002,
      "Received too big control frame",
    ],
    [
      "a continuation frame outside a fragmented message",
      frame(CONT, "hi"),
      1002,
      "Received continuation frame outside a fragmented message",
    ],
    [
      "TEXT inside a fragmented TEXT",
      Buffer.concat([frame(TEXT, "a", { fin: false }), frame(TEXT, "b")]),
      1002,
      interleaved,
    ],
    [
      "BINARY inside a fragmented BINARY",
      Buffer.concat([frame(BINARY, "a", { fin: false }), frame(BINARY, "b")]),
      1002,
      interleaved,
    ],
    [
      "BINARY inside a fragmented TEXT",
      Buffer.concat([frame(TEXT, "a", { fin: false }), frame(BINARY, "b")]),
      1002,
      interleaved,
    ],
    [
      "TEXT inside a fragmented BINARY",
      Buffer.concat([frame(BINARY, "a", { fin: false }), frame(TEXT, "b")]),
      1002,
      interleaved,
    ],
    ["invalid UTF-8 in a TEXT frame", frame(TEXT, [0xff, 0xfe, 0xfd]), 1007, "Received invalid UTF-8"],
    [
      "invalid UTF-8 across fragments",
      Buffer.concat([frame(TEXT, [0xf4, 0x90], { fin: false }), frame(CONT, [0x80, 0x80])]),
      1007,
      "Received invalid UTF-8",
    ],
    ["a frame over maxPayloadLength", frame(BINARY, Buffer.alloc(1025)), 1009, "Received too big message"],
    [
      "a frame header declaring 1 GiB",
      frame(BINARY, "", { declaredLength: 1024 * 1024 * 1024 }),
      1009,
      "Received too big message",
    ],
    [
      "fragments totaling more than maxPayloadLength",
      Buffer.concat([frame(BINARY, Buffer.alloc(600), { fin: false }), frame(CONT, Buffer.alloc(600))]),
      1009,
      "Received too big message",
    ],
    ["a Close with a 1-byte body", frame(CLOSE, [0x03]), 1002, "Received invalid close payload"],
    ...[999, 1004, 1005, 1006, 1015, 1016, 2999, 5000, 65535].map(
      code =>
        [`a Close with code ${code}`, frame(CLOSE, closeBody(code)), 1002, "Received invalid close code"] as [
          string,
          Buffer,
          number,
          string,
        ],
    ),
    [
      "a Close with invalid UTF-8 in the reason",
      frame(CLOSE, closeBody(1000, [0xff, 0xfe])),
      1007,
      "Received invalid UTF-8",
    ],
  ];

  // Sent after each invalid frame. A server that wrongly accepts the frame echoes this Close
  // instead of leaving the test hanging.
  const normalClose = frame(CLOSE, closeBody(1000));

  test.each(violations)("rejects %s", async (_name, bytes, code, diagnostic) => {
    expect(await probe(Buffer.concat([bytes, normalClose]))).toEqual(failed(code, diagnostic));
  });

  test("rejects a new message after a ping inside a fragmented message", async () => {
    expect(
      await probe(
        Buffer.concat([frame(BINARY, "a", { fin: false }), frame(PING, "p"), frame(BINARY, "b"), normalClose]),
      ),
    ).toEqual({
      wire: ['PONG "p"', `CLOSE 1002 ${JSON.stringify(interleaved)}`, "FIN"],
      events: [`close 1006 ${JSON.stringify(interleaved)}`],
    });
  });

  test("replies to an earlier valid frame in the same read before sending the Close frame", async () => {
    expect(await probe(Buffer.concat([frame(TEXT, "Hello"), frame(TEXT, "hi", { rsv: 2 }), frame(PING)]))).toEqual({
      wire: ['TEXT "Hello"', 'CLOSE 1002 "Received unexpected RSV2 or RSV3 bit"', "FIN"],
      events: ['message "Hello"', 'close 1006 "Received unexpected RSV2 or RSV3 bit"'],
    });
  });

  describe("accepts valid frames", () => {
    test("a message, then Close 1000", async () => {
      expect(await probe(Buffer.concat([frame(TEXT, "ok"), frame(CLOSE, closeBody(1000, "bye"))]))).toEqual({
        wire: ['TEXT "ok"', 'CLOSE 1000 "bye"', "FIN"],
        events: ['message "ok"', 'close 1000 "bye"'],
      });
    });

    test("a ping inside a fragmented message", async () => {
      expect(
        await probe(
          Buffer.concat([
            frame(BINARY, "he", { fin: false }),
            frame(PING, "p"),
            frame(CONT, "llo"),
            frame(CLOSE, closeBody(1000)),
          ]),
        ),
      ).toEqual({
        wire: ['PONG "p"', 'BINARY "hello"', 'CLOSE 1000 ""', "FIN"],
        events: ['message "hello"', 'close 1000 ""'],
      });
    });

    // maxPayloadLength only applies to messages. RFC 6455 5.5 caps control frames at 125 bytes.
    test("a ping and a Close longer than maxPayloadLength", async () => {
      const payload = Buffer.alloc(100, "p").toString();
      expect(
        await probe(
          Buffer.concat([frame(PING, payload), frame(TEXT, "1234"), frame(CLOSE, closeBody(1000, "goodbye"))]),
          {
            maxPayloadLength: 4,
          },
        ),
      ).toEqual({
        wire: [`PONG "${payload}"`, 'TEXT "1234"', 'CLOSE 1000 "goodbye"', "FIN"],
        events: ['message "1234"', 'close 1000 "goodbye"'],
      });
    });

    test("echoes an empty Close as an empty Close", async () => {
      expect(await probe(frame(CLOSE))).toEqual({ wire: ['CLOSE ""', "FIN"], events: ['close 1005 ""'] });
    });

    test.each([1000, 1001, 1003, 1007, 1014, 3000, 4999])("echoes Close %d", async code => {
      expect(await probe(frame(CLOSE, closeBody(code, "why")))).toEqual({
        wire: [`CLOSE ${code} "why"`, "FIN"],
        events: [`close ${code} "why"`],
      });
    });
  });
});
