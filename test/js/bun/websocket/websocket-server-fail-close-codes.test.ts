// RFC 6455 7.1.7: before failing the connection, the server sends a Close frame
// with 1002 (protocol error), 1007 (invalid data) or 1009 (too big) and the
// error message as the reason. The close handler gets 1006 with the same
// message. A peer can't send 1006, so it always means the server aborted.
import { describe, expect, test } from "bun:test";
import { tls as cert } from "harness";
import {
  closePayload,
  encodeFrame,
  type FrameOptions,
  OP,
  type Payload,
  RawClient,
  showFullFrame,
} from "../../web/websocket/raw-peer";

// Builds a client frame.
function frame(opcode: number, payload?: Payload, options?: FrameOptions): Buffer {
  return encodeFrame(opcode, payload, { mask: true, ...options });
}

describe.concurrent.each(["ws", "wss"] as const)("%s: failing the connection", scheme => {
  // Upgrades over a raw socket, writes `bytes` in one write, and reads until the server's FIN ("end").
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

    using client = await RawClient.upgrade(server.port!, { secure: scheme === "wss" });
    client.write(bytes);
    await client.ended;
    await serverClosed.promise;
    expect(client.unparsedBytes).toBe(0);
    return { wire: [...client.frames.map(showFullFrame), client.socketEvents[0]], events };
  }

  function failed(code: number, diagnostic: string) {
    return {
      wire: [`close ${code} ${JSON.stringify(diagnostic)}`, "end"],
      events: [`close 1006 ${JSON.stringify(diagnostic)}`],
    };
  }

  const interleaved = "Received new message inside a fragmented message";
  const violations: [name: string, bytes: Buffer, code: number, diagnostic: string][] = [
    ["an unmasked frame", frame(OP.text, "hi", { mask: false }), 1002, "Received an incorrectly masked frame"],
    ["RSV1 without permessage-deflate", frame(OP.text, "hi", { rsv1: true }), 1002, "Received unexpected RSV1 bit"],
    ["RSV2", frame(OP.text, "hi", { rsv2: true }), 1002, "Received unexpected RSV2 or RSV3 bit"],
    ["RSV3 on a ping", frame(OP.ping, "hi", { rsv3: true }), 1002, "Received unexpected RSV2 or RSV3 bit"],
    ["opcode 3", frame(3), 1002, "Received invalid opcode"],
    ["opcode 7", frame(7, "hi"), 1002, "Received invalid opcode"],
    ["opcode 11", frame(11), 1002, "Received invalid opcode"],
    ["opcode 15", frame(15, "hi"), 1002, "Received invalid opcode"],
    ["a ping without FIN", frame(OP.ping, "hi", { fin: false }), 1002, "Received fragmented control frame"],
    [
      "a Close without FIN",
      frame(OP.close, closePayload(1000), { fin: false }),
      1002,
      "Received fragmented control frame",
    ],
    ["a 126-byte ping", frame(OP.ping, Buffer.alloc(126, "a")), 1002, "Received too big control frame"],
    [
      "a 126-byte Close",
      frame(OP.close, closePayload(1000, Buffer.alloc(124, "a").toString())),
      1002,
      "Received too big control frame",
    ],
    [
      "a continuation frame outside a fragmented message",
      frame(OP.continuation, "hi"),
      1002,
      "Received continuation frame outside a fragmented message",
    ],
    [
      "TEXT inside a fragmented TEXT",
      Buffer.concat([frame(OP.text, "a", { fin: false }), frame(OP.text, "b")]),
      1002,
      interleaved,
    ],
    [
      "BINARY inside a fragmented BINARY",
      Buffer.concat([frame(OP.binary, "a", { fin: false }), frame(OP.binary, "b")]),
      1002,
      interleaved,
    ],
    [
      "BINARY inside a fragmented TEXT",
      Buffer.concat([frame(OP.text, "a", { fin: false }), frame(OP.binary, "b")]),
      1002,
      interleaved,
    ],
    [
      "TEXT inside a fragmented BINARY",
      Buffer.concat([frame(OP.binary, "a", { fin: false }), frame(OP.text, "b")]),
      1002,
      interleaved,
    ],
    ["invalid UTF-8 in a TEXT frame", frame(OP.text, Buffer.from([0xff, 0xfe, 0xfd])), 1007, "Received invalid UTF-8"],
    [
      "invalid UTF-8 across fragments",
      Buffer.concat([
        frame(OP.text, Buffer.from([0xf4, 0x90]), { fin: false }),
        frame(OP.continuation, Buffer.from([0x80, 0x80])),
      ]),
      1007,
      "Received invalid UTF-8",
    ],
    ["a frame over maxPayloadLength", frame(OP.binary, Buffer.alloc(1025)), 1009, "Received too big message"],
    [
      "a frame header declaring 1 GiB",
      frame(OP.binary, "", { declaredLength: 1024 * 1024 * 1024 }),
      1009,
      "Received too big message",
    ],
    [
      "fragments totaling more than maxPayloadLength",
      Buffer.concat([frame(OP.binary, Buffer.alloc(600), { fin: false }), frame(OP.continuation, Buffer.alloc(600))]),
      1009,
      "Received too big message",
    ],
    ["a Close with a 1-byte body", frame(OP.close, Buffer.from([0x03])), 1002, "Received invalid close payload"],
    ...[999, 1004, 1005, 1006, 1015, 1016, 2999, 5000, 65535].map(
      code =>
        [`a Close with code ${code}`, frame(OP.close, closePayload(code)), 1002, "Received invalid close code"] as [
          string,
          Buffer,
          number,
          string,
        ],
    ),
    [
      "a Close with invalid UTF-8 in the reason",
      frame(OP.close, closePayload(1000, Buffer.from([0xff, 0xfe]))),
      1007,
      "Received invalid UTF-8",
    ],
  ];

  // Sent after each invalid frame. A server that wrongly accepts the frame echoes this Close
  // instead of leaving the test hanging.
  const normalClose = frame(OP.close, closePayload(1000));

  test.each(violations)("rejects %s", async (_name, bytes, code, diagnostic) => {
    expect(await probe(Buffer.concat([bytes, normalClose]))).toEqual(failed(code, diagnostic));
  });

  test("rejects a new message after a ping inside a fragmented message", async () => {
    expect(
      await probe(
        Buffer.concat([frame(OP.binary, "a", { fin: false }), frame(OP.ping, "p"), frame(OP.binary, "b"), normalClose]),
      ),
    ).toEqual({
      wire: ['pong "p"', `close 1002 ${JSON.stringify(interleaved)}`, "end"],
      events: [`close 1006 ${JSON.stringify(interleaved)}`],
    });
  });

  test("replies to an earlier valid frame in the same read before sending the Close frame", async () => {
    expect(
      await probe(Buffer.concat([frame(OP.text, "Hello"), frame(OP.text, "hi", { rsv2: true }), frame(OP.ping)])),
    ).toEqual({
      wire: ['text "Hello"', 'close 1002 "Received unexpected RSV2 or RSV3 bit"', "end"],
      events: ['message "Hello"', 'close 1006 "Received unexpected RSV2 or RSV3 bit"'],
    });
  });

  describe("accepts valid frames", () => {
    test("a message, then Close 1000", async () => {
      expect(await probe(Buffer.concat([frame(OP.text, "ok"), frame(OP.close, closePayload(1000, "bye"))]))).toEqual({
        wire: ['text "ok"', 'close 1000 "bye"', "end"],
        events: ['message "ok"', 'close 1000 "bye"'],
      });
    });

    test("a ping inside a fragmented message", async () => {
      expect(
        await probe(
          Buffer.concat([
            frame(OP.binary, "he", { fin: false }),
            frame(OP.ping, "p"),
            frame(OP.continuation, "llo"),
            frame(OP.close, closePayload(1000)),
          ]),
        ),
      ).toEqual({
        wire: ['pong "p"', 'binary "hello"', "close 1000", "end"],
        events: ['message "hello"', 'close 1000 ""'],
      });
    });

    // maxPayloadLength only applies to messages. RFC 6455 5.5 caps control frames at 125 bytes.
    test("a ping and a Close longer than maxPayloadLength", async () => {
      const payload = Buffer.alloc(100, "p").toString();
      expect(
        await probe(
          Buffer.concat([
            frame(OP.ping, payload),
            frame(OP.text, "1234"),
            frame(OP.close, closePayload(1000, "goodbye")),
          ]),
          {
            maxPayloadLength: 4,
          },
        ),
      ).toEqual({
        wire: [`pong "${payload}"`, 'text "1234"', 'close 1000 "goodbye"', "end"],
        events: ['message "1234"', 'close 1000 "goodbye"'],
      });
    });

    test("echoes an empty Close as an empty Close", async () => {
      expect(await probe(frame(OP.close))).toEqual({ wire: ["close", "end"], events: ['close 1005 ""'] });
    });

    test.each([1000, 1001, 1003, 1007, 1014, 3000, 4999])("echoes Close %d", async code => {
      expect(await probe(frame(OP.close, closePayload(code, "why")))).toEqual({
        wire: [`close ${code} "why"`, "end"],
        events: [`close ${code} "why"`],
      });
    });
  });
});
