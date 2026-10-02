// RFC 6455 section 5.5.1: when a Close frame carries a body, the first two
// bytes MUST be the 2-byte status code, so a 1-byte body is malformed and must
// be treated like any other invalid Close payload, not as "no status received".
import { serve } from "bun";
import { describe, expect, it } from "bun:test";
import net from "node:net";

describe.concurrent("Bun.serve received Close frame validation", () => {
  function maskedClose(payload: Buffer): Buffer {
    const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
    const masked = Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]));
    return Buffer.concat([Buffer.from([0x88, 0x80 | payload.length]), mask, masked]);
  }

  // Raw TCP WebSocket client against a Bun.serve websocket server: perform the
  // upgrade, then expose the server's close() callback and every frame byte it
  // writes back.
  async function connectRaw() {
    const serverClose = Promise.withResolvers<{ code: number; reason: string }>();
    const server = serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("upgrade failed", { status: 400 });
      },
      websocket: {
        perMessageDeflate: false,
        message() {},
        close(ws, code, reason) {
          serverClose.resolve({ code, reason });
        },
      },
    });

    const socket = net.connect(server.port, "127.0.0.1");
    const upgraded = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<void>();
    socket.on("close", () => {
      closed.resolve();
      upgraded.reject(new Error("socket closed before the 101 response"));
    });
    socket.on("error", (error: Error) => {
      closed.resolve();
      upgraded.reject(error);
    });

    let frameBytes = Buffer.alloc(0);
    const onFrameData = (chunk: Buffer) => {
      frameBytes = Buffer.concat([frameBytes, chunk]);
    };

    let head = Buffer.alloc(0);
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
    try {
      await upgraded.promise;
    } catch (error) {
      socket.destroy();
      server.stop(true);
      throw error;
    }

    return {
      socket,
      serverClose: serverClose.promise,
      closed: closed.promise,
      frames: () => frameBytes,
      [Symbol.dispose]() {
        socket.destroy();
        server.stop(true);
      },
    };
  }

  // Autobahn 7.3.2: a 1-byte Close body is a protocol error. The server's
  // close() handler must report it like every other invalid Close payload
  // (1006), not as 1005 "no status received" which a valid empty body maps to.
  it("a Close frame with a 1-byte body is reported as abnormal (1006)", async () => {
    using raw = await connectRaw();
    raw.socket.write(maskedClose(Buffer.from([0x00])));
    expect(await raw.serverClose).toEqual({ code: 1006, reason: "" });
    await raw.closed;
    // 1006 is never put on the wire: the reply is a bodyless Close.
    expect(raw.frames()).toEqual(Buffer.from([0x88, 0x00]));
  });

  // Control: a well-formed empty Close body is the one case that maps to 1005.
  it("an empty Close body reports 1005 (no status received)", async () => {
    using raw = await connectRaw();
    raw.socket.write(maskedClose(Buffer.alloc(0)));
    expect(await raw.serverClose).toEqual({ code: 1005, reason: "" });
    await raw.closed;
    expect(raw.frames()).toEqual(Buffer.from([0x88, 0x00]));
  });

  // Control: a valid code is echoed and delivered verbatim.
  it("a valid code is echoed and delivered to close()", async () => {
    using raw = await connectRaw();
    raw.socket.write(maskedClose(Buffer.from([0x03, 0xe8, 0x62, 0x79, 0x65])));
    expect(await raw.serverClose).toEqual({ code: 1000, reason: "bye" });
    await raw.closed;
    expect(raw.frames()).toEqual(Buffer.from([0x88, 0x05, 0x03, 0xe8, 0x62, 0x79, 0x65]));
  });

  // The other malformed-Close-body cases (reserved code, bad UTF-8 reason) all
  // map to 1006 via the same parseClosePayload routine the 1-byte case feeds.
  it.each([
    ["a reserved code (999)", Buffer.from([0x03, 0xe7])],
    ["a code forbidden on the wire (1005)", Buffer.from([0x03, 0xed])],
    ["a non-UTF-8 reason", Buffer.from([0x03, 0xe8, 0xc3, 0x28])],
  ])("%s is reported as abnormal (1006)", async (_, body) => {
    using raw = await connectRaw();
    raw.socket.write(maskedClose(body));
    expect(await raw.serverClose).toEqual({ code: 1006, reason: "" });
    await raw.closed;
    expect(raw.frames()).toEqual(Buffer.from([0x88, 0x00]));
  });
});
