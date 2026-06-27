// RFC 6455 section 5.1: a server MUST close the connection upon receiving a
// frame that is not masked. Bun.serve's frame parser assumes the 4-byte masking
// key is present, so an unmasked frame also desyncs everything that follows it;
// it must never reach the message handler.
import { serve } from "bun";
import { describe, expect, it } from "bun:test";
import net from "node:net";

describe.concurrent("unmasked client frames", () => {
  function maskedFrame(opcode: number, payload: Buffer): Buffer {
    const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
    const masked = Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]));
    return Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | payload.length]), mask, masked]);
  }

  function unmaskedFrame(opcode: number, payload: Buffer): Buffer {
    return Buffer.concat([Buffer.from([0x80 | opcode, payload.length]), payload]);
  }

  // Raw TCP WebSocket client against a Bun.serve websocket server: performs the
  // upgrade, then exposes exactly what the server observed.
  async function connectRaw() {
    const received: unknown[] = [];
    const firstMessage = Promise.withResolvers<string>();
    const serverClose = Promise.withResolvers<{ code: number; reason: string }>();
    const server = serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("upgrade failed", { status: 400 });
      },
      websocket: {
        message(ws, message) {
          received.push(message);
          firstMessage.resolve(`message:${JSON.stringify(message)}`);
        },
        close(ws, code, reason) {
          serverClose.resolve({ code, reason });
        },
      },
    });

    const socket = net.connect(server.port, "127.0.0.1");
    const closed = Promise.withResolvers<string>();
    socket.on("close", () => closed.resolve("socket-closed-by-server"));
    socket.on("error", () => closed.resolve("socket-closed-by-server"));

    const upgraded = Promise.withResolvers<void>();
    let buffered = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      const end = buffered.indexOf("\r\n\r\n");
      if (end === -1) return;
      const head = buffered.subarray(0, end).toString();
      socket.removeAllListeners("data");
      if (head.startsWith("HTTP/1.1 101")) upgraded.resolve();
      else upgraded.reject(new Error(`upgrade failed: ${head.split("\r\n")[0]}`));
    });
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

    return {
      server,
      socket,
      received,
      firstMessage: firstMessage.promise,
      serverClose: serverClose.promise,
      closed: closed.promise,
      [Symbol.dispose]() {
        socket.destroy();
        server.stop(true);
      },
    };
  }

  // An unmasked zero-length frame is the worst case: the parser used to read
  // the next frame's first 4 bytes as its masking key and deliver the empty
  // message to `message()`.
  it("an unmasked empty text frame is not delivered and fails the connection", async () => {
    using raw = await connectRaw();
    raw.socket.write(Buffer.concat([unmaskedFrame(0x1, Buffer.alloc(0)), maskedFrame(0x1, Buffer.from("hi"))]));
    expect(await Promise.race([raw.closed, raw.firstMessage])).toBe("socket-closed-by-server");
    expect(raw.received).toEqual([]);
    expect(await raw.serverClose).toEqual({ code: 1006, reason: "Received an incorrectly masked frame" });
  });

  it("an unmasked text frame is not delivered and fails the connection", async () => {
    using raw = await connectRaw();
    // The trailing bytes are where the parser used to look for the payload
    // after consuming "hell" as the masking key.
    raw.socket.write(Buffer.concat([unmaskedFrame(0x1, Buffer.from("hello")), Buffer.from("XYZW")]));
    expect(await Promise.race([raw.closed, raw.firstMessage])).toBe("socket-closed-by-server");
    expect(raw.received).toEqual([]);
    expect(await raw.serverClose).toEqual({ code: 1006, reason: "Received an incorrectly masked frame" });
  });

  it("an unmasked close frame fails the connection instead of completing the handshake", async () => {
    using raw = await connectRaw();
    // 4 extra bytes so the (server-role) parser has a full 6-byte header to look at.
    raw.socket.write(Buffer.concat([unmaskedFrame(0x8, Buffer.alloc(0)), Buffer.alloc(4)]));
    expect(await raw.serverClose).toEqual({ code: 1006, reason: "Received an incorrectly masked frame" });
  });

  // Control: the same raw client with correct masking is parsed and delivered.
  it("a masked text frame from the same raw client is delivered", async () => {
    using raw = await connectRaw();
    raw.socket.write(maskedFrame(0x1, Buffer.from("hi")));
    expect(await raw.firstMessage).toBe('message:"hi"');
    expect(raw.received).toEqual(["hi"]);
  });
});
