// RFC 6455 section 7.1.7: to Fail the WebSocket Connection, an endpoint SHOULD
// send a Close frame with the appropriate status code before closing the
// underlying TCP connection. Section 7.4.1 mandates the codes: 1002 for a
// protocol error, 1007 for inconsistent data (bad UTF-8), 1009 for a message
// that is too big. Bun.serve previously tore the TCP connection down without
// ever writing a Close frame, so a conforming client only ever saw 1006.
import { serve } from "bun";
import { describe, expect, it } from "bun:test";
import net from "node:net";

describe.concurrent("Bun.serve WebSocket fail-the-connection close codes", () => {
  // Build a client->server frame. Short (<126 byte) payloads only.
  function frame(opcode: number, payload: Buffer, opts: { fin?: boolean; rsv1?: boolean; masked?: boolean } = {}) {
    const { fin = true, rsv1 = false, masked = true } = opts;
    if (payload.length > 125) throw new Error("short frames only");
    const flags = (fin ? 0x80 : 0x00) | (rsv1 ? 0x40 : 0x00) | opcode;
    if (!masked) return Buffer.concat([Buffer.from([flags, payload.length]), payload]);
    const mask = Buffer.from([0x37, 0xfa, 0x21, 0x3d]);
    const body = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
    return Buffer.concat([Buffer.from([flags, 0x80 | payload.length]), mask, body]);
  }

  // Build a client->server frame that declares an extended (>=126 byte) payload.
  function mediumFrame(opcode: number, payload: Buffer) {
    const mask = Buffer.from([0x37, 0xfa, 0x21, 0x3d]);
    const body = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
    return Buffer.concat([
      Buffer.from([0x80 | opcode, 0x80 | 126, payload.length >> 8, payload.length & 0xff]),
      mask,
      body,
    ]);
  }

  type ServerView = { code: number; reason: string; messages: unknown[] };
  type Wire = { closeFrame: Buffer | null; bytes: Buffer };

  // Raw RFC 6455 client: do the upgrade handshake over a plain TCP socket,
  // write `send`, and record (a) what the app's close() handler observed and
  // (b) every byte the server wrote back so the test can look for a Close
  // frame on the wire.
  async function probe(
    send: Buffer,
    opts: { maxPayloadLength?: number } = {},
  ): Promise<{ server: ServerView; wire: Wire }> {
    const messages: unknown[] = [];
    const appClose = Promise.withResolvers<ServerView>();
    using server = serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("upgrade failed", { status: 400 });
      },
      websocket: {
        maxPayloadLength: opts.maxPayloadLength,
        message(_ws, message) {
          messages.push(message);
        },
        close(_ws, code, reason) {
          appClose.resolve({ code, reason, messages });
        },
      },
    });

    const socket = net.connect(server.port, "127.0.0.1");
    try {
      socket.setNoDelay(true);
      const upgraded = Promise.withResolvers<void>();
      const closed = Promise.withResolvers<void>();
      socket.on("close", () => {
        closed.resolve();
        upgraded.reject(new Error("socket closed before the 101 response"));
      });
      socket.on("error", () => {
        closed.resolve();
        upgraded.reject(new Error("socket error before the 101 response"));
      });

      let wireBytes = Buffer.alloc(0);
      const onFrameData = (chunk: Buffer) => {
        wireBytes = Buffer.concat([wireBytes, chunk]);
      };

      let head = Buffer.alloc(0);
      const onHead = (chunk: Buffer) => {
        head = Buffer.concat([head, chunk]);
        const end = head.indexOf("\r\n\r\n");
        if (end === -1) return;
        socket.off("data", onHead);
        socket.on("data", onFrameData);
        const text = head.subarray(0, end).toString();
        if (!text.startsWith("HTTP/1.1 101")) {
          upgraded.reject(new Error(`upgrade failed: ${text.split("\r\n")[0]}`));
          return;
        }
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
          "\r\n",
      );
      await upgraded.promise;

      socket.write(send);
      const [serverView] = await Promise.all([appClose.promise, closed.promise]);

      return { server: serverView, wire: parseWire(wireBytes) };
    } finally {
      socket.destroy();
    }
  }

  function parseWire(wireBytes: Buffer): Wire {
    // Walk the server->client frame stream for the (only) Close frame. Server
    // frames are never masked, so the header is 2 bytes for a <126-byte body.
    let closeFrame: Buffer | null = null;
    let i = 0;
    while (i + 2 <= wireBytes.length) {
      const op = wireBytes[i] & 0x0f;
      const len = wireBytes[i + 1] & 0x7f;
      if (len > 125 || i + 2 + len > wireBytes.length) break;
      if (op === 0x8) {
        closeFrame = wireBytes.subarray(i, i + 2 + len);
        break;
      }
      i += 2 + len;
    }

    return { closeFrame, bytes: wireBytes };
  }

  function closeCodeOf(closeFrame: Buffer | null): number | null {
    if (!closeFrame || closeFrame.length < 4) return null;
    return closeFrame.readUInt16BE(2);
  }

  function closeReasonOf(closeFrame: Buffer | null): string | null {
    if (!closeFrame || closeFrame.length < 4) return null;
    return closeFrame.subarray(4).toString();
  }

  // ── 1002: protocol errors ────────────────────────────────────────────────

  it("unmasked client frame → Close 1002 on the wire", async () => {
    const { server, wire } = await probe(frame(0x1, Buffer.from("hi"), { masked: false }));
    expect(closeCodeOf(wire.closeFrame)).toBe(1002);
    expect(closeReasonOf(wire.closeFrame)).toBe("Received an incorrectly masked frame");
    expect(server).toEqual({ code: 1002, reason: "Received an incorrectly masked frame", messages: [] });
  });

  it("reserved opcode 3 → Close 1002 on the wire", async () => {
    const { server, wire } = await probe(frame(0x3, Buffer.alloc(0)));
    expect(closeCodeOf(wire.closeFrame)).toBe(1002);
    expect(server.code).toBe(1002);
    expect(server.messages).toEqual([]);
  });

  it("reserved opcode 11 → Close 1002 on the wire", async () => {
    const { server, wire } = await probe(frame(0xb, Buffer.alloc(0)));
    expect(closeCodeOf(wire.closeFrame)).toBe(1002);
    expect(server.code).toBe(1002);
  });

  it("RSV1 without negotiated compression → Close 1002 on the wire", async () => {
    const { server, wire } = await probe(frame(0x1, Buffer.from("hi"), { rsv1: true }));
    expect(closeCodeOf(wire.closeFrame)).toBe(1002);
    expect(closeReasonOf(wire.closeFrame)).toBe("Received unexpected RSV1 bit");
    expect(server).toEqual({ code: 1002, reason: "Received unexpected RSV1 bit", messages: [] });
  });

  it("fragmented ping (FIN=0 on a control frame) → Close 1002 on the wire", async () => {
    const { server, wire } = await probe(frame(0x9, Buffer.from("hi"), { fin: false }));
    expect(closeCodeOf(wire.closeFrame)).toBe(1002);
    expect(server.code).toBe(1002);
  });

  it("control frame with a >125-byte payload → Close 1002 on the wire", async () => {
    const { server, wire } = await probe(mediumFrame(0x9, Buffer.alloc(126, 0x61)));
    expect(closeCodeOf(wire.closeFrame)).toBe(1002);
    expect(server.code).toBe(1002);
  });

  it("continuation frame with no message in progress → Close 1002 on the wire", async () => {
    const { server, wire } = await probe(frame(0x0, Buffer.from("hi")));
    expect(closeCodeOf(wire.closeFrame)).toBe(1002);
    expect(server.code).toBe(1002);
    expect(server.messages).toEqual([]);
  });

  it("new data frame while a fragmented message is open → Close 1002 on the wire", async () => {
    const { server, wire } = await probe(
      Buffer.concat([frame(0x1, Buffer.from("he"), { fin: false }), frame(0x1, Buffer.from("llo"))]),
    );
    expect(closeCodeOf(wire.closeFrame)).toBe(1002);
    expect(server.code).toBe(1002);
    expect(server.messages).toEqual([]);
  });

  // ── 1007: inconsistent data (invalid UTF-8 TEXT) ─────────────────────────

  it("TEXT frame carrying invalid UTF-8 → Close 1007 on the wire", async () => {
    const { server, wire } = await probe(frame(0x1, Buffer.from([0xff, 0xfe, 0xfd])));
    expect(closeCodeOf(wire.closeFrame)).toBe(1007);
    expect(closeReasonOf(wire.closeFrame)).toBe("Received invalid UTF-8");
    expect(server).toEqual({ code: 1007, reason: "Received invalid UTF-8", messages: [] });
  });

  // ── 1009: message too big ────────────────────────────────────────────────

  it("single frame over maxPayloadLength → Close 1009 on the wire", async () => {
    const { server, wire } = await probe(mediumFrame(0x2, Buffer.alloc(200, 0x61)), { maxPayloadLength: 100 });
    expect(closeCodeOf(wire.closeFrame)).toBe(1009);
    expect(closeReasonOf(wire.closeFrame)).toBe("Received too big message");
    expect(server).toEqual({ code: 1009, reason: "Received too big message", messages: [] });
  });

  it("fragmented message growing past maxPayloadLength → Close 1009 on the wire", async () => {
    const { server, wire } = await probe(
      Buffer.concat([
        frame(0x2, Buffer.alloc(80, 0x61), { fin: false }),
        frame(0x0, Buffer.alloc(80, 0x61), { fin: true }),
      ]),
      { maxPayloadLength: 100 },
    );
    expect(closeCodeOf(wire.closeFrame)).toBe(1009);
    expect(server).toEqual({ code: 1009, reason: "Received too big message", messages: [] });
  });

  // ── invalid inbound Close frames must be answered with 1002/1007 ─────────

  it("Close frame with an invalid status code (999) → Close 1002 on the wire", async () => {
    const { server, wire } = await probe(frame(0x8, Buffer.from([0x03, 0xe7]))); // 999
    expect(closeCodeOf(wire.closeFrame)).toBe(1002);
    expect(server.code).toBe(1002);
  });

  it("Close frame with the reserved status code 1005 → Close 1002 on the wire", async () => {
    const { server, wire } = await probe(frame(0x8, Buffer.from([0x03, 0xed]))); // 1005
    expect(closeCodeOf(wire.closeFrame)).toBe(1002);
    expect(server.code).toBe(1002);
  });

  it("Close frame with status code 5000 (above 4999) → Close 1002 on the wire", async () => {
    const { server, wire } = await probe(frame(0x8, Buffer.from([0x13, 0x88]))); // 5000
    expect(closeCodeOf(wire.closeFrame)).toBe(1002);
    expect(server.code).toBe(1002);
  });

  it("Close frame with a 1-byte body → Close 1002 on the wire", async () => {
    // RFC 6455 5.5.1: if there is a body, its first two bytes MUST be the code.
    const { server, wire } = await probe(frame(0x8, Buffer.from([0x03])));
    expect(closeCodeOf(wire.closeFrame)).toBe(1002);
    expect(server.code).toBe(1002);
  });

  it("Close frame with an invalid-UTF-8 reason → Close 1007 on the wire", async () => {
    const { server, wire } = await probe(frame(0x8, Buffer.from([0x03, 0xe8, 0xff, 0xfe]))); // 1000 + bad UTF-8
    expect(closeCodeOf(wire.closeFrame)).toBe(1007);
    expect(server.code).toBe(1007);
  });

  // ── controls: nothing well-formed is over-rejected ───────────────────────

  it("a valid masked TEXT frame is still delivered", async () => {
    // Send a well-formed message, then a clean close so probe() returns.
    const { server, wire } = await probe(
      Buffer.concat([frame(0x1, Buffer.from("ok")), frame(0x8, Buffer.from([0x03, 0xe8]))]),
    );
    expect(server.messages).toEqual(["ok"]);
    expect(server.code).toBe(1000);
    expect(closeCodeOf(wire.closeFrame)).toBe(1000);
  });

  it("an empty Close body is still answered with an empty Close (1005 locally)", async () => {
    const { server, wire } = await probe(frame(0x8, Buffer.alloc(0)));
    // 1005 means "no status code present" and is not sent on the wire: the
    // reply is an empty-body Close.
    expect(server.code).toBe(1005);
    expect(wire.closeFrame).toEqual(Buffer.from([0x88, 0x00]));
  });

  it("a Close with code 1000 is echoed back as 1000", async () => {
    const { server, wire } = await probe(frame(0x8, Buffer.from([0x03, 0xe8, 0x62, 0x79, 0x65])));
    expect(server).toEqual({ code: 1000, reason: "bye", messages: [] });
    expect(closeCodeOf(wire.closeFrame)).toBe(1000);
    expect(closeReasonOf(wire.closeFrame)).toBe("bye");
  });
});
