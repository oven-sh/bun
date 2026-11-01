// RFC 6455 5.2 + RFC 7692 6.1: RSV1 ("per-message compressed") is only valid on
// the first frame of a data message. A control or continuation frame setting it
// must fail the connection, and must not arm the connection's compressed flag.
import type { ServerWebSocket, WebSocketHandler } from "bun";
import { serve } from "bun";
import { describe, expect, it } from "bun:test";
import { constants, deflateRawSync } from "node:zlib";
import { OP, RawClient, showFrame } from "../../web/websocket/raw-peer";

const RSV1_CLOSE = { code: 1006, reason: "Received unexpected RSV1 bit" };

// A permessage-deflate message payload: raw deflate, sync flushed, with the
// trailing 0x00 0x00 0xff 0xff removed (RFC 7692 section 7.2.1).
function pmdDeflate(payload: Buffer): Buffer {
  const deflated = deflateRawSync(payload, { finishFlush: constants.Z_SYNC_FLUSH });
  expect(deflated.subarray(-4)).toEqual(Buffer.from([0x00, 0x00, 0xff, 0xff]));
  return deflated.subarray(0, -4);
}

// Raw WebSocket client that offers permessage-deflate to a Bun.serve websocket
// server. Exposes what the server's message/ping/close handlers got, and
// `client` has every frame the server sent.
async function connectRaw(options: {
  perMessageDeflate: WebSocketHandler["perMessageDeflate"];
  maxPayloadLength?: number;
  onMessage?: (ws: ServerWebSocket<undefined>, message: string | Buffer) => void;
}) {
  const received: string[] = [];
  const receivedListeners: (() => void)[] = [];
  const pings: string[] = [];
  const firstMessage = Promise.withResolvers<string>();
  const serverClose = Promise.withResolvers<{ code: number; reason: string }>();
  const server = serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response("upgrade failed", { status: 400 });
    },
    websocket: {
      perMessageDeflate: options.perMessageDeflate,
      maxPayloadLength: options.maxPayloadLength,
      message(ws, message) {
        const hex = Buffer.from(message as Buffer).toString("hex");
        received.push(hex);
        firstMessage.resolve(`message:${hex}`);
        for (const notify of receivedListeners) notify();
        options.onMessage?.(ws, message);
      },
      ping(ws, data) {
        pings.push(Buffer.from(data).toString("hex"));
      },
      close(ws, code, reason) {
        serverClose.resolve({ code, reason });
      },
    },
  });

  const client = await RawClient.upgrade(server.port!, {
    headers: { "Sec-WebSocket-Extensions": "permessage-deflate; client_max_window_bits" },
  }).catch(error => {
    // The disposable below is the only other thing that stops the server.
    server.stop(true);
    throw error;
  });

  return {
    client,
    received,
    pings,
    negotiated: client.header("sec-websocket-extensions") ?? "",
    firstMessage: firstMessage.promise,
    // Resolves with every received message once message() has run `count` times.
    messages(count: number): Promise<string[]> {
      if (received.length >= count) return Promise.resolve(received);
      const { promise, resolve } = Promise.withResolvers<string[]>();
      receivedListeners.push(() => {
        if (received.length >= count) resolve(received);
      });
      return promise;
    },
    serverClose: serverClose.promise,
    // Every frame the server sent, once it has closed the connection.
    async sentFrames(): Promise<string[]> {
      await client.closed;
      expect(client.unparsedBytes).toBe(0);
      return client.frames.map(showFrame);
    },
    [Symbol.dispose]() {
      client.destroy();
      server.stop(true);
    },
  };
}

describe.concurrent("permessage-deflate RSV1 frames", () => {
  // Every test here needs a connection that really negotiated compression.
  async function connectDeflated() {
    const raw = await connectRaw({ perMessageDeflate: true });
    try {
      expect(raw.negotiated).toContain("permessage-deflate");
    } catch (error) {
      // If this throws, the caller's `using` never binds, so dispose here.
      raw[Symbol.dispose]();
      throw error;
    }
    return raw;
  }

  // A conforming server neither answers an RSV1 ping nor lets it reach ping().
  it("a ping with RSV1 set fails the connection and is not answered", async () => {
    using raw = await connectDeflated();
    raw.client.send(OP.ping, pmdDeflate(Buffer.from("pingy")), { rsv1: true });
    expect(await raw.serverClose).toEqual(RSV1_CLOSE);
    expect(raw.pings).toEqual([]);
    expect(await raw.sentFrames()).toEqual([`close 1002 "${RSV1_CLOSE.reason}"`]);
  });

  it("an RSV1 ping must not make the next uncompressed data frame get inflated", async () => {
    using raw = await connectDeflated();
    // What a poisoned server hands to message(): the inflation of `wire`.
    const inflated = Buffer.alloc(80, "ab");
    const wire = pmdDeflate(inflated);
    expect(wire.equals(inflated)).toBe(false);
    raw.client.write(
      Buffer.concat([
        raw.client.frame(OP.ping, pmdDeflate(Buffer.from("pingy")), { rsv1: true }),
        // An ordinary binary frame with RSV1 clear: its payload is *not* compressed.
        raw.client.frame(OP.binary, wire),
      ]),
    );
    // The connection dies at the ping; the data frame is never delivered, and
    // in particular never delivered inflated.
    expect(await Promise.race([raw.serverClose, raw.firstMessage])).toEqual(RSV1_CLOSE);
    expect(raw.received).toEqual([]);
  });

  it("a pong with RSV1 set fails the connection", async () => {
    using raw = await connectDeflated();
    raw.client.write(
      Buffer.concat([
        raw.client.frame(OP.pong, pmdDeflate(Buffer.from("pongy")), { rsv1: true }),
        // Sentinel: must never be delivered (it would be wrongly inflated).
        raw.client.frame(OP.binary, Buffer.from("after")),
      ]),
    );
    expect(await Promise.race([raw.serverClose, raw.firstMessage])).toEqual(RSV1_CLOSE);
    expect(raw.received).toEqual([]);
  });

  it("a continuation frame with RSV1 set fails the connection", async () => {
    using raw = await connectDeflated();
    // RFC 7692 6.1: only the *first* fragment of a data message may set RSV1.
    raw.client.write(
      Buffer.concat([
        raw.client.frame(OP.binary, Buffer.from("he"), { fin: false }),
        raw.client.frame(OP.continuation, Buffer.from("llo"), { fin: true, rsv1: true }),
      ]),
    );
    expect(await Promise.race([raw.serverClose, raw.firstMessage])).toEqual(RSV1_CLOSE);
    expect(raw.received).toEqual([]);
  });

  // Control: a genuinely compressed message (RSV1 on the first data frame) is
  // still inflated and delivered, so rejecting the frames above is not
  // over-rejection. TEXT and BINARY are the two opcodes that may carry RSV1.
  it("a compressed binary message is still inflated and delivered", async () => {
    using raw = await connectDeflated();
    const original = Buffer.alloc(80, "ab");
    raw.client.binary(pmdDeflate(original), { rsv1: true });
    expect(await Promise.race([raw.firstMessage, raw.client.closed])).toBe(`message:${original.toString("hex")}`);
    expect(raw.received).toEqual([original.toString("hex")]);
  });

  it("a compressed text message is still inflated and delivered", async () => {
    using raw = await connectDeflated();
    const original = Buffer.from("hello rsv1 text");
    raw.client.text(pmdDeflate(original), { rsv1: true });
    expect(await Promise.race([raw.firstMessage, raw.serverClose])).toBe(`message:${original.toString("hex")}`);
    expect(raw.received).toEqual([original.toString("hex")]);
  });

  // An extended-length header is validated once its first 6 bytes arrive, then
  // spilled and validated again whole: the second pass must also accept RSV1.
  it("a compressed frame whose extended-length header is split is still delivered", async () => {
    using raw = await connectDeflated();
    // 256 distinct bytes do not compress, forcing a payload longer than 125.
    const original = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    const compressed = pmdDeflate(original);
    expect(compressed.length).toBeGreaterThan(125);
    const big = raw.client.frame(OP.binary, compressed, { rsv1: true });
    // End the first write 7 bytes into big's header; the ping in front of it is
    // answered in the same parse pass, so its pong proves the server consumed
    // (and spilled) those 7 bytes before the rest is sent.
    raw.client.write(Buffer.concat([raw.client.frame(OP.ping, Buffer.from("sync")), big.subarray(0, 7)]));
    expect(await raw.client.next()).toBe('pong "sync"');
    raw.client.write(big.subarray(7));
    expect(await Promise.race([raw.firstMessage, raw.serverClose])).toBe(`message:${original.toString("hex")}`);
  });

  // Control: a well-formed ping on the same connection is still answered.
  it("a ping without RSV1 is still answered with a pong", async () => {
    using raw = await connectDeflated();
    raw.client.ping("hi");
    expect(await raw.client.next()).toBe('pong "hi"');
    expect(raw.pings).toEqual([Buffer.from("hi").toString("hex")]);
  });
});

// `perMessageDeflate: { compress, decompress }` configures each direction
// separately, but RFC 7692 negotiates both at once. So "compress off" means the
// server never sets RSV1 on outgoing frames, and "decompress off" means no
// per-socket inflater.
describe.concurrent("perMessageDeflate per-direction options", () => {
  // 320 repeated bytes deflate to a few bytes, so a compressed reply is short
  // and has RSV1 set, and a plain reply is 320 bytes with RSV1 clear.
  const reply = Buffer.alloc(320, "x");
  const inbound = Buffer.from("hello from the client");
  const sendCompressedReply = (ws: ServerWebSocket<undefined>) => {
    ws.send(reply, true);
  };
  // The only thing the server has sent is `reply`, uncompressed. A compressed reply would be a complete frame
  // too, so this fails on one instead of waiting for 320 bytes.
  async function expectPlainReply(client: RawClient) {
    expect(await client.next()).toBe("binary 320 bytes");
    expect([client.frames.length, client.unparsedBytes]).toEqual([1, 0]);
    expect(client.frames[0].payload).toEqual(reply);
  }

  for (const [perMessageDeflate, negotiated] of [
    [{ compress: "disable", decompress: "shared" }, "client_no_context_takeover; server_no_context_takeover"],
    [{ compress: false, decompress: true }, "client_no_context_takeover; server_no_context_takeover"],
    [{ compress: false, decompress: "dedicated" }, "server_no_context_takeover"],
    [{ compress: "disable", decompress: "8KB" }, "client_max_window_bits=13; server_no_context_takeover"],
  ] as const) {
    it(`${JSON.stringify(perMessageDeflate)} inflates inbound messages and never compresses outbound ones`, async () => {
      using raw = await connectRaw({ perMessageDeflate, onMessage: sendCompressedReply });
      expect(raw.negotiated).toBe(`permessage-deflate; ${negotiated}`);
      raw.client.text(pmdDeflate(inbound), { rsv1: true });
      expect(await Promise.race([raw.firstMessage, raw.serverClose])).toBe(`message:${inbound.toString("hex")}`);
      await expectPlainReply(raw.client);
    });
  }

  for (const [perMessageDeflate, negotiated] of [
    [true, "client_no_context_takeover; server_no_context_takeover"],
    [{ compress: "shared", decompress: "shared" }, "client_no_context_takeover; server_no_context_takeover"],
    [{ compress: "shared" }, "client_no_context_takeover; server_no_context_takeover"],
    [{ decompress: "shared" }, "client_no_context_takeover; server_no_context_takeover"],
    // With no dedicated decompressor, the shared one inflates.
    [{ compress: "shared", decompress: "disable" }, "client_no_context_takeover; server_no_context_takeover"],
    [{ compress: true, decompress: false }, "client_no_context_takeover; server_no_context_takeover"],
    [{ compress: "dedicated", decompress: false }, "client_no_context_takeover"],
    // A size only sets the window for its own direction.
    [{ decompress: "16KB" }, "client_max_window_bits=14; server_no_context_takeover"],
    [{ compress: "16KB", decompress: "8KB" }, "client_max_window_bits=13; server_max_window_bits=11"],
    [{ compress: "shared", decompress: "256KB" }, "server_no_context_takeover"],
    [{ compress: "3KB", decompress: "3KB" }, "client_max_window_bits=11; server_max_window_bits=9"],
  ] as const) {
    it(`${JSON.stringify(perMessageDeflate)} inflates inbound and compresses outbound messages`, async () => {
      using raw = await connectRaw({ perMessageDeflate, onMessage: sendCompressedReply });
      expect(raw.negotiated).toBe(`permessage-deflate; ${negotiated}`);
      raw.client.text(pmdDeflate(inbound), { rsv1: true });
      expect(await Promise.race([raw.firstMessage, raw.serverClose])).toBe(`message:${inbound.toString("hex")}`);
      const sent = (await raw.client.nextFrame())!;
      expect([sent.fin, sent.rsv, sent.opcode, sent.masked]).toEqual([true, 4, OP.binary, false]);
      expect(sent.length).toBeLessThan(126);
    });
  }

  for (const perMessageDeflate of [
    false,
    {},
    { compress: "disable", decompress: "disable" },
    { compress: false, decompress: false },
    { decompress: false },
    { compress: "disable" },
  ] as const) {
    it(`${JSON.stringify(perMessageDeflate)} does not negotiate the extension`, async () => {
      using raw = await connectRaw({ perMessageDeflate, onMessage: sendCompressedReply });
      expect(raw.negotiated).toBe("");
      raw.client.text(inbound);
      expect(await Promise.race([raw.firstMessage, raw.serverClose])).toBe(`message:${inbound.toString("hex")}`);
      await expectPlainReply(raw.client);
    });
  }
});

const decompressors = [
  ["shared", { compress: "shared", decompress: "shared" }],
  ["dedicated", { compress: "shared", decompress: "dedicated" }],
] as const;

// RFC 7692 7.2.3.4: a sender may end a message with a BFINAL=1 block. The
// receiver decodes it, and the next message starts a new DEFLATE stream.
describe.concurrent.each(decompressors)("inbound BFINAL=1 blocks (%s decompressor)", (_label, perMessageDeflate) => {
  const original = Buffer.alloc(750, "bfinal-interop-");
  const hex = (...payloads: Buffer[]) => payloads.map(payload => payload.toString("hex"));
  // The form the RFC describes: the complete stream, then the 0x00 that remains
  // of an empty stored block after stripping its 0x00 0x00 0xff 0xff.
  const padded = (payload: Buffer) => Buffer.concat([deflateRawSync(payload), Buffer.from([0x00])]);

  it("inflates and delivers a BFINAL=1 message", async () => {
    using raw = await connectRaw({ perMessageDeflate });
    raw.client.binary(deflateRawSync(original), { rsv1: true });
    expect(await Promise.race([raw.messages(1), raw.serverClose])).toEqual(hex(original));
  });

  it("inflates and delivers a BFINAL=1 message padded with 0x00", async () => {
    using raw = await connectRaw({ perMessageDeflate });
    raw.client.binary(padded(original), { rsv1: true });
    expect(await Promise.race([raw.messages(1), raw.serverClose])).toEqual(hex(original));
  });

  it("inflates a sync-flushed message after a BFINAL=1 message", async () => {
    using raw = await connectRaw({ perMessageDeflate });
    const followup = Buffer.alloc(200, "after-bfinal-");
    raw.client.write(
      Buffer.concat([
        raw.client.frame(OP.binary, deflateRawSync(original), { rsv1: true }),
        raw.client.frame(OP.binary, pmdDeflate(followup), { rsv1: true }),
      ]),
    );
    expect(await Promise.race([raw.messages(2), raw.serverClose])).toEqual(hex(original, followup));
  });

  it("inflates two BFINAL=1 messages in a row", async () => {
    using raw = await connectRaw({ perMessageDeflate });
    const other = Buffer.alloc(300, "second-bfinal-");
    raw.client.write(
      Buffer.concat([
        raw.client.frame(OP.binary, padded(original), { rsv1: true }),
        raw.client.frame(OP.binary, deflateRawSync(other), { rsv1: true }),
      ]),
    );
    expect(await Promise.race([raw.messages(2), raw.serverClose])).toEqual(hex(original, other));
  });

  it("inflates a fragmented BFINAL=1 message", async () => {
    using raw = await connectRaw({ perMessageDeflate });
    const compressed = deflateRawSync(original);
    raw.client.write(
      Buffer.concat([
        raw.client.frame(OP.binary, compressed.subarray(0, 5), { rsv1: true, fin: false }),
        raw.client.frame(OP.continuation, compressed.subarray(5)),
      ]),
    );
    expect(await Promise.race([raw.messages(1), raw.serverClose])).toEqual(hex(original));
  });

  // The inflate scratch buffer is 16384 bytes. Cover an exact fit, one byte over, and multiple refills.
  it.each([4096, 4097, 16384, 16385, 40000])("delivers a BFINAL=1 message that inflates to %d bytes", async size => {
    using raw = await connectRaw({ perMessageDeflate });
    const payload = Buffer.alloc(size, "bfinal-boundary-");
    raw.client.binary(deflateRawSync(payload), { rsv1: true });
    expect(await Promise.race([raw.messages(1), raw.serverClose])).toEqual(hex(payload));
  });
});

describe.concurrent.each(decompressors)("inflate failures (%s decompressor)", (_label, perMessageDeflate) => {
  it("a corrupt DEFLATE stream fails the connection with 1007", async () => {
    using raw = await connectRaw({ perMessageDeflate });
    // BTYPE=11 is reserved.
    raw.client.binary(Buffer.from([0x06, 0x00]), { rsv1: true });
    const reason = "Received invalid compressed data";
    expect(await Promise.race([raw.serverClose, raw.firstMessage])).toEqual({ code: 1006, reason });
    expect(await raw.sentFrames()).toEqual([`close 1007 "${reason}"`]);
  });

  it.each([
    [1000, 1001],
    [1000, 40000],
    [16384, 16385],
    [20000, 20001],
  ])("maxPayloadLength %d: a message that inflates to %d bytes fails the connection with 1009", async (max, size) => {
    using raw = await connectRaw({ perMessageDeflate, maxPayloadLength: max });
    raw.client.binary(pmdDeflate(Buffer.alloc(size, "a")), { rsv1: true });
    const reason = "Received too big message";
    expect(await Promise.race([raw.serverClose, raw.firstMessage])).toEqual({ code: 1006, reason });
    expect(await raw.sentFrames()).toEqual([`close 1009 "${reason}"`]);
  });

  it.each([1000, 16384, 20000])("delivers a message that inflates to exactly maxPayloadLength (%d)", async max => {
    using raw = await connectRaw({ perMessageDeflate, maxPayloadLength: max });
    const payload = Buffer.alloc(max, "a");
    raw.client.binary(pmdDeflate(payload), { rsv1: true });
    expect(await Promise.race([raw.messages(1), raw.serverClose])).toEqual([payload.toString("hex")]);
  });
});
