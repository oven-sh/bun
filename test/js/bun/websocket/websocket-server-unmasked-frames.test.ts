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
    const messageListeners: (() => void)[] = [];
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
          for (const notify of messageListeners) notify();
        },
        close(ws, code, reason) {
          serverClose.resolve({ code, reason });
        },
      },
    });

    const socket = net.connect(server.port, "127.0.0.1");
    const closed = Promise.withResolvers<string>();
    const upgraded = Promise.withResolvers<void>();
    socket.on("close", () => {
      closed.resolve("socket-closed-by-server");
      // No-op once the 101 already resolved it; fails the handshake fast otherwise.
      upgraded.reject(new Error("socket closed before the 101 response"));
    });
    socket.on("error", (error: Error) => {
      closed.resolve("socket-closed-by-server");
      upgraded.reject(error);
    });

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
    try {
      await upgraded.promise;
    } catch (error) {
      // The disposable below (the only thing that stops the server) is never
      // created when the handshake fails, so release everything here.
      socket.destroy();
      server.stop(true);
      throw error;
    }

    return {
      server,
      socket,
      received,
      firstMessage: firstMessage.promise,
      serverClose: serverClose.promise,
      closed: closed.promise,
      // Resolves once the server's message handler has run `count` times.
      waitForMessages(count: number): Promise<void> {
        if (received.length >= count) return Promise.resolve();
        const { promise, resolve } = Promise.withResolvers<void>();
        messageListeners.push(() => {
          if (received.length >= count) resolve();
        });
        return promise;
      },
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
    // Trailing bytes so the parser sees a full server-role header in one read.
    raw.socket.write(Buffer.concat([unmaskedFrame(0x8, Buffer.alloc(0)), Buffer.alloc(4)]));
    expect(await raw.serverClose).toEqual({ code: 1006, reason: "Received an incorrectly masked frame" });
  });

  // The mask bit is in the 2-byte base header. The server must not sit on a
  // lone unmasked frame waiting for the 4 masking-key bytes that never come.
  it("a lone 2-byte unmasked frame is rejected without waiting for more bytes", async () => {
    using raw = await connectRaw();
    raw.socket.write(unmaskedFrame(0x1, Buffer.alloc(0)));
    expect(await raw.closed).toBe("socket-closed-by-server");
    expect(raw.received).toEqual([]);
    expect(await raw.serverClose).toEqual({ code: 1006, reason: "Received an incorrectly masked frame" });
  });

  // Control: the same raw client with correct masking is parsed and delivered,
  // and the connection survives delivery (a follow-up frame arrives too).
  // Raced against `closed` so a wrongly rejected frame fails the assertion
  // instead of hanging until the test times out.
  it("a masked text frame from the same raw client is delivered", async () => {
    using raw = await connectRaw();
    raw.socket.write(maskedFrame(0x1, Buffer.from("hi")));
    expect(await Promise.race([raw.firstMessage, raw.closed])).toBe('message:"hi"');
    raw.socket.write(maskedFrame(0x1, Buffer.from("again")));
    await Promise.race([raw.waitForMessages(2), raw.closed]);
    expect(raw.received).toEqual(["hi", "again"]);
  });

  // Control: a masked frame whose 2-byte base header arrives on its own must
  // be buffered (not rejected) until the masking key and payload follow.
  it("a masked text frame split after the base header is still delivered", async () => {
    using raw = await connectRaw();
    const frame = maskedFrame(0x1, Buffer.from("hi"));
    await new Promise<void>(resolve => raw.socket.write(frame.subarray(0, 2), () => resolve()));
    raw.socket.write(frame.subarray(2));
    expect(await Promise.race([raw.firstMessage, raw.closed])).toBe('message:"hi"');
    raw.socket.write(maskedFrame(0x1, Buffer.from("again")));
    await Promise.race([raw.waitForMessages(2), raw.closed]);
    expect(raw.received).toEqual(["hi", "again"]);
  });
});
