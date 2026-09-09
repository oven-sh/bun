// RFC 6455 5.2 + RFC 7692 6.1: RSV1 ("per-message compressed") is only valid on
// the first frame of a data message. A control or continuation frame setting it
// must fail the connection, and must not arm the connection's compressed flag.
import { serve } from "bun";
import { describe, expect, it } from "bun:test";
import net from "node:net";
import { constants, deflateRawSync } from "node:zlib";

const RSV1_CLOSE = { code: 1006, reason: "Received unexpected RSV1 bit" };

// A permessage-deflate message payload: raw deflate, sync flushed, with the
// trailing 0x00 0x00 0xff 0xff removed (RFC 7692 section 7.2.1).
function pmdDeflate(payload: Buffer): Buffer {
  const deflated = deflateRawSync(payload, { finishFlush: constants.Z_SYNC_FLUSH });
  expect(deflated.subarray(-4)).toEqual(Buffer.from([0x00, 0x00, 0xff, 0xff]));
  return deflated.subarray(0, -4);
}

describe.concurrent("permessage-deflate RSV1 frames", () => {
  function frame(opcode: number, payload: Buffer, opts: { fin?: boolean; rsv1?: boolean } = {}): Buffer {
    const { fin = true, rsv1 = false } = opts;
    if (payload.length > 0xffff) throw new Error("these tests only build short and medium frames");
    const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
    const masked = Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]));
    const flags = (fin ? 0x80 : 0x00) | (rsv1 ? 0x40 : 0x00) | opcode;
    const head =
      payload.length < 126
        ? Buffer.from([flags, 0x80 | payload.length])
        : Buffer.from([flags, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
    return Buffer.concat([head, mask, masked]);
  }

  // Raw TCP WebSocket client that negotiates permessage-deflate against a
  // Bun.serve websocket server, then exposes exactly what the server observed
  // (message/ping/close handlers) and every frame byte the server wrote back.
  async function connectDeflated() {
    const received: string[] = [];
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
        perMessageDeflate: true,
        message(ws, message) {
          const hex = Buffer.from(message as Buffer).toString("hex");
          received.push(hex);
          firstMessage.resolve(`message:${hex}`);
        },
        ping(ws, data) {
          pings.push(Buffer.from(data).toString("hex"));
        },
        close(ws, code, reason) {
          serverClose.resolve({ code, reason });
        },
      },
    });

    const socket = net.connect(server.port, "127.0.0.1");
    socket.setNoDelay(true);
    const upgraded = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<string>();
    socket.on("close", () => {
      closed.resolve("socket-closed-by-server");
      // No-op once the 101 already resolved it; fails the handshake fast otherwise.
      upgraded.reject(new Error("socket closed before the 101 response"));
    });
    socket.on("error", (error: Error) => {
      closed.resolve("socket-closed-by-server");
      upgraded.reject(error);
    });

    // Every byte the server sends after the 101 head is WebSocket frame data.
    let frameBytes = Buffer.alloc(0);
    const frameByteListeners: (() => void)[] = [];
    const onFrameData = (chunk: Buffer) => {
      frameBytes = Buffer.concat([frameBytes, chunk]);
      for (const notify of frameByteListeners) notify();
    };

    let head = Buffer.alloc(0);
    let negotiated = "";
    const onHead = (chunk: Buffer) => {
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf("\r\n\r\n");
      if (end === -1) return;
      socket.off("data", onHead);
      socket.on("data", onFrameData);
      const headText = head.subarray(0, end).toString();
      if (!headText.startsWith("HTTP/1.1 101")) {
        upgraded.reject(new Error(`upgrade failed: ${headText.split("\r\n")[0]}`));
        return;
      }
      negotiated = headText.split("\r\n").find(line => /^sec-websocket-extensions:/i.test(line)) ?? "";
      const rest = head.subarray(end + 4);
      if (rest.length) onFrameData(rest);
      upgraded.resolve();
    };
    socket.on("data", onHead);
    socket.write(
      "GET / HTTP/1.1\r\n" +
        "Host: localhost\r\n" +
        "Connection: Upgrade\r\n" +
        "Upgrade: websocket\r\n" +
        "Sec-WebSocket-Version: 13\r\n" +
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
        "Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits\r\n" +
        "\r\n",
    );
    try {
      await upgraded.promise;
      // Every test here needs a connection that really negotiated compression.
      expect(negotiated.toLowerCase()).toContain("permessage-deflate");
    } catch (error) {
      // The disposable below (the only thing that stops the server) is never
      // created when the handshake fails, so release everything here.
      socket.destroy();
      server.stop(true);
      throw error;
    }

    return {
      socket,
      received,
      pings,
      firstMessage: firstMessage.promise,
      serverClose: serverClose.promise,
      closed: closed.promise,
      frames: () => frameBytes,
      // Resolves once the server has written `count` bytes of frame data.
      waitForFrameBytes(count: number): Promise<string> {
        if (frameBytes.length >= count) return Promise.resolve("server-sent-a-frame");
        const { promise, resolve } = Promise.withResolvers<string>();
        frameByteListeners.push(() => {
          if (frameBytes.length >= count) resolve("server-sent-a-frame");
        });
        return promise;
      },
      [Symbol.dispose]() {
        socket.destroy();
        server.stop(true);
      },
    };
  }

  // A conforming server neither answers an RSV1 ping nor lets it reach ping().
  it("a ping with RSV1 set fails the connection and is not answered", async () => {
    using raw = await connectDeflated();
    raw.socket.write(frame(0x9, pmdDeflate(Buffer.from("pingy")), { rsv1: true }));
    expect(await Promise.race([raw.serverClose, raw.waitForFrameBytes(1)])).toEqual(RSV1_CLOSE);
    expect(raw.pings).toEqual([]);
    expect(raw.frames()).toEqual(Buffer.alloc(0));
  });

  it("an RSV1 ping must not make the next uncompressed data frame get inflated", async () => {
    using raw = await connectDeflated();
    // What a poisoned server hands to message(): the inflation of `wire`.
    const inflated = Buffer.alloc(80, "ab");
    const wire = pmdDeflate(inflated);
    expect(wire.equals(inflated)).toBe(false);
    raw.socket.write(
      Buffer.concat([
        frame(0x9, pmdDeflate(Buffer.from("pingy")), { rsv1: true }),
        // An ordinary binary frame with RSV1 clear: its payload is *not* compressed.
        frame(0x2, wire),
      ]),
    );
    // The connection dies at the ping; the data frame is never delivered, and
    // in particular never delivered inflated.
    expect(await Promise.race([raw.serverClose, raw.firstMessage])).toEqual(RSV1_CLOSE);
    expect(raw.received).toEqual([]);
  });

  it("a pong with RSV1 set fails the connection", async () => {
    using raw = await connectDeflated();
    raw.socket.write(
      Buffer.concat([
        frame(0xa, pmdDeflate(Buffer.from("pongy")), { rsv1: true }),
        // Sentinel: must never be delivered (it would be wrongly inflated).
        frame(0x2, Buffer.from("after")),
      ]),
    );
    expect(await Promise.race([raw.serverClose, raw.firstMessage])).toEqual(RSV1_CLOSE);
    expect(raw.received).toEqual([]);
  });

  it("a continuation frame with RSV1 set fails the connection", async () => {
    using raw = await connectDeflated();
    // RFC 7692 6.1: only the *first* fragment of a data message may set RSV1.
    raw.socket.write(
      Buffer.concat([
        frame(0x2, Buffer.from("he"), { fin: false }),
        frame(0x0, Buffer.from("llo"), { fin: true, rsv1: true }),
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
    raw.socket.write(frame(0x2, pmdDeflate(original), { rsv1: true }));
    expect(await Promise.race([raw.firstMessage, raw.closed])).toBe(`message:${original.toString("hex")}`);
    expect(raw.received).toEqual([original.toString("hex")]);
  });

  it("a compressed text message is still inflated and delivered", async () => {
    using raw = await connectDeflated();
    const original = Buffer.from("hello rsv1 text");
    raw.socket.write(frame(0x1, pmdDeflate(original), { rsv1: true }));
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
    const big = frame(0x2, compressed, { rsv1: true });
    // End the first write 7 bytes into big's header; the ping in front of it is
    // answered in the same parse pass, so its pong proves the server consumed
    // (and spilled) those 7 bytes before the rest is sent.
    raw.socket.write(Buffer.concat([frame(0x9, Buffer.from("sync")), big.subarray(0, 7)]));
    expect(await Promise.race([raw.waitForFrameBytes(6), raw.closed])).toBe("server-sent-a-frame");
    raw.socket.write(big.subarray(7));
    expect(await Promise.race([raw.firstMessage, raw.serverClose])).toBe(`message:${original.toString("hex")}`);
  });

  // Control: a well-formed ping on the same connection is still answered.
  it("a ping without RSV1 is still answered with a pong", async () => {
    using raw = await connectDeflated();
    raw.socket.write(frame(0x9, Buffer.from("hi")));
    expect(await Promise.race([raw.waitForFrameBytes(4), raw.closed])).toBe("server-sent-a-frame");
    expect(raw.frames()).toEqual(Buffer.from([0x8a, 0x02, 0x68, 0x69]));
    expect(raw.pings).toEqual([Buffer.from("hi").toString("hex")]);
  });
});
