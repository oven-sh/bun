// RFC 6455 4.1 tells a client to wait for the 101 before it sends frames, and
// browsers do. A client that does not wait can get its first frames into the
// TCP read that carries the upgrade request. The HTTP parser stops at the end
// of the request head, and the rest of that read used to be dropped: the 101
// went out, the connection stayed open, and the frames were never seen. If the
// read ended inside a frame, the next read started in the middle of it and the
// server closed the connection. The `ws` package on Node parses these bytes
// (it unshifts the 'upgrade' event's head into the socket). So does Bun.serve
// when server.upgrade() runs before the request's dispatch returns: in the
// handler itself, or after an await that needs no new turn of the event loop.
import type { Server } from "bun";
import { serve } from "bun";
import { describe, expect, it } from "bun:test";
import { tls as tlsCert } from "harness";
import { maxHeaderSize } from "node:http";
import net from "node:net";
import tls from "node:tls";

describe.concurrent("frames in the same read as the upgrade request", () => {
  const upgradeRequest =
    "GET / HTTP/1.1\r\n" +
    "Host: 127.0.0.1\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
    "Sec-WebSocket-Version: 13\r\n" +
    "\r\n";

  // A client frame: masked, short payload.
  function maskedFrame(opcode: number, payload: string): Buffer {
    const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
    const masked = Buffer.from(Buffer.from(payload).map((byte, i) => byte ^ mask[i % 4]));
    return Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | masked.length]), mask, masked]);
  }
  const text = (payload: string) => maskedFrame(1, payload);
  const ping = (payload: string) => maskedFrame(9, payload);

  // Echoes every message, so the frames a client gets back show what the
  // server saw and in which order.
  function echoServer(events: string[], options: { tls?: boolean; fetch?: (req: Request, srv: Server) => any } = {}) {
    return serve({
      port: 0,
      hostname: "127.0.0.1",
      tls: options.tls ? tlsCert : undefined,
      fetch:
        options.fetch ??
        ((req, srv) => {
          if (new URL(req.url).pathname === "/plain") return new Response("plain");
          if (srv.upgrade(req)) return;
          return new Response("no", { status: 400 });
        }),
      websocket: {
        open() {
          events.push("open");
        },
        message(ws, message) {
          events.push(`message:${message}`);
          ws.send(`echo:${message}`);
        },
        ping(ws, data) {
          events.push(`ping:${data}`);
        },
        close(ws, code) {
          events.push(`close:${code}`);
        },
      },
    });
  }

  // A raw client that reads what the server sent: HTTP responses first,
  // WebSocket frames after the 101.
  async function rawClient(port: number, useTls = false) {
    const socket = useTls
      ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false })
      : net.connect({ port, host: "127.0.0.1" });
    const closed = Promise.withResolvers<void>();
    const failed = Promise.withResolvers<never>();
    // Only observed through the races below.
    failed.promise.catch(() => {});
    socket.on("error", error => failed.reject(error));
    socket.on("close", () => {
      closed.resolve();
      failed.reject(new Error("the server closed the socket"));
    });

    let buffered = Buffer.alloc(0);
    let onData = () => {};
    socket.on("data", (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      onData();
    });
    // Rejects if the server closes the socket before the condition holds.
    const until = <T>(condition: () => T | undefined) =>
      Promise.race([
        failed.promise,
        new Promise<T>(resolve => {
          onData = () => {
            const value = condition();
            if (value !== undefined) resolve(value);
          };
          onData();
        }),
      ]);

    await Promise.race([
      failed.promise,
      new Promise<void>(resolve => socket.once(useTls ? "secureConnect" : "connect", () => resolve())),
    ]);

    return {
      socket,
      closed: closed.promise,
      // The status line of the next HTTP response. Skips `bodyLength` bytes of body.
      status: (bodyLength = 0) =>
        until(() => {
          const end = buffered.indexOf("\r\n\r\n");
          if (end === -1 || buffered.length < end + 4 + bodyLength) return undefined;
          const statusLine = buffered.subarray(0, buffered.indexOf("\r\n")).toString("latin1");
          buffered = buffered.subarray(end + 4 + bodyLength);
          return statusLine;
        }),
      // Every frame up to the one that reads `last`. Server frames are
      // unmasked, and every frame in these tests has a short payload.
      framesUntil(last: string) {
        const seen: string[] = [];
        return until(() => {
          while (buffered.length >= 2 && buffered.length >= 2 + buffered[1]) {
            const kind = { 1: "text", 8: "close", 9: "ping", 10: "pong" }[buffered[0] & 0x0f] ?? "unexpected";
            seen.push(`${kind}:${buffered.subarray(2, 2 + buffered[1])}`);
            buffered = buffered.subarray(2 + buffered[1]);
          }
          return seen.includes(last) ? seen : undefined;
        });
      },
      [Symbol.dispose]() {
        socket.destroy();
      },
    };
  }

  it.each([false, true])("are delivered in order, and a ping gets its pong (tls: %p)", async useTls => {
    const events: string[] = [];
    using server = echoServer(events, { tls: useTls });
    using client = await rawClient(server.port, useTls);

    // One write, so the request and the frames reach the server in one read.
    client.socket.write(Buffer.concat([Buffer.from(upgradeRequest), text("early"), ping("p")]));
    expect(await client.status()).toBe("HTTP/1.1 101 Switching Protocols");
    client.socket.write(text("later"));

    expect(await client.framesUntil("text:echo:later")).toEqual(["text:echo:early", "pong:p", "text:echo:later"]);
    expect(events).toEqual(["open", "message:early", "ping:p", "message:later"]);
  });

  it.each(["Promise.resolve()", "req.text()"])(
    "are delivered when server.upgrade() runs after `await %s`",
    async awaited => {
      const events: string[] = [];
      using server = echoServer(events, {
        // Neither await needs a new turn of the event loop: the rest of the
        // handler runs before the request's dispatch returns.
        async fetch(req, srv) {
          await (awaited === "req.text()" ? req.text() : Promise.resolve());
          if (srv.upgrade(req)) return;
          return new Response("no", { status: 400 });
        },
      });
      using client = await rawClient(server.port);

      client.socket.write(Buffer.concat([Buffer.from(upgradeRequest), text("early"), ping("p")]));
      expect(await client.status()).toBe("HTTP/1.1 101 Switching Protocols");
      client.socket.write(text("later"));

      expect(await client.framesUntil("text:echo:later")).toEqual(["text:echo:early", "pong:p", "text:echo:later"]);
      expect(events).toEqual(["open", "message:early", "ping:p", "message:later"]);
    },
  );

  // Without its first bytes, the rest of the frame used to be parsed as a new
  // frame, and the server closed the connection.
  it("a frame that the read cuts short is completed by the next read", async () => {
    const events: string[] = [];
    using server = echoServer(events);
    using client = await rawClient(server.port);

    const frame = text("split");
    client.socket.write(Buffer.concat([Buffer.from(upgradeRequest), frame.subarray(0, 4)]));
    expect(await client.status()).toBe("HTTP/1.1 101 Switching Protocols");
    client.socket.write(Buffer.concat([frame.subarray(4), text("later")]));

    expect(await client.framesUntil("text:echo:later")).toEqual(["text:echo:split", "text:echo:later"]);
    expect(events).toEqual(["open", "message:split", "message:later"]);
  });

  // The parser completes a request head that spans two reads in a buffer of
  // its own, which the upgrade frees. The frames are still in the socket read.
  it("are delivered when the request head spans two reads", async () => {
    const events: string[] = [];
    using server = echoServer(events);
    using client = await rawClient(server.port);

    // The response to the first request shows that the server has read, and
    // kept, the first part of the upgrade request.
    client.socket.write("GET /plain HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n" + upgradeRequest.slice(0, 40));
    expect(await client.status("plain".length)).toBe("HTTP/1.1 200 OK");
    client.socket.write(Buffer.concat([Buffer.from(upgradeRequest.slice(40)), text("early"), ping("p")]));
    expect(await client.status()).toBe("HTTP/1.1 101 Switching Protocols");
    client.socket.write(text("later"));

    expect(await client.framesUntil("text:echo:later")).toEqual(["text:echo:early", "pong:p", "text:echo:later"]);
    expect(events).toEqual(["open", "message:early", "ping:p", "message:later"]);
  });

  // The parser's buffer for a split head takes `maxHeaderSize` bytes. A head
  // of that size fills it, so the frames behind the head never get into it.
  it("are delivered when a request head that spans two reads is as large as a head can be", async () => {
    const events: string[] = [];
    using server = echoServer(events);
    using client = await rawClient(server.port);

    const padding = maxHeaderSize - upgradeRequest.length - "X-Pad: \r\n".length;
    const request = `${upgradeRequest.slice(0, -2)}X-Pad: ${Buffer.alloc(padding, "a")}\r\n\r\n`;
    expect(request.length).toBe(maxHeaderSize);

    client.socket.write("GET /plain HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n" + request.slice(0, 40));
    expect(await client.status("plain".length)).toBe("HTTP/1.1 200 OK");
    client.socket.write(Buffer.concat([Buffer.from(request.slice(40)), text("early"), ping("p")]));
    expect(await client.status()).toBe("HTTP/1.1 101 Switching Protocols");
    client.socket.write(text("later"));

    expect(await client.framesUntil("text:echo:later")).toEqual(["text:echo:early", "pong:p", "text:echo:later"]);
    expect(events).toEqual(["open", "message:early", "ping:p", "message:later"]);
  });

  // The read starts with the end of an earlier request's body, so the upgrade
  // request is not at the start of the read.
  it("are delivered when the read starts with the rest of another request's body", async () => {
    const events: string[] = [];
    using server = echoServer(events);
    using client = await rawClient(server.port);

    client.socket.write("POST /plain HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 10\r\n\r\n01234");
    expect(await client.status("plain".length)).toBe("HTTP/1.1 200 OK");
    client.socket.write(Buffer.concat([Buffer.from("56789" + upgradeRequest), text("early"), ping("p")]));
    expect(await client.status()).toBe("HTTP/1.1 101 Switching Protocols");
    client.socket.write(text("later"));

    expect(await client.framesUntil("text:echo:later")).toEqual(["text:echo:early", "pong:p", "text:echo:later"]);
    expect(events).toEqual(["open", "message:early", "ping:p", "message:later"]);
  });

  // server.upgrade() does not read a body that the upgrade request declares.
  // The body is not frames either: it is dropped, and the WebSocket works.
  it.each([
    ["Content-Length", 'Content-Length: 17\r\n\r\n{"hello":"world"}'],
    ["chunked", 'Transfer-Encoding: chunked\r\n\r\n11\r\n{"hello":"world"}\r\n0\r\n\r\n'],
  ])("a %s body in the same read as the upgrade request is not parsed as frames", async (_, framedBody) => {
    const events: string[] = [];
    using server = echoServer(events);
    using client = await rawClient(server.port);

    client.socket.write(upgradeRequest.slice(0, -2) + framedBody);
    expect(await client.status()).toBe("HTTP/1.1 101 Switching Protocols");
    client.socket.write(text("later"));

    expect(await client.framesUntil("text:echo:later")).toEqual(["text:echo:later"]);
    expect(events).toEqual(["open", "message:later"]);
  });

  it("a body is not parsed as frames when the request head spans two reads", async () => {
    const events: string[] = [];
    using server = echoServer(events);
    using client = await rawClient(server.port);

    client.socket.write("GET /plain HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n" + upgradeRequest.slice(0, 40));
    expect(await client.status("plain".length)).toBe("HTTP/1.1 200 OK");
    client.socket.write(upgradeRequest.slice(40, -2) + 'Content-Length: 17\r\n\r\n{"hello":"world"}');
    expect(await client.status()).toBe("HTTP/1.1 101 Switching Protocols");
    client.socket.write(text("later"));

    expect(await client.framesUntil("text:echo:later")).toEqual(["text:echo:later"]);
    expect(events).toEqual(["open", "message:later"]);
  });

  // A server.upgrade() in a later turn of the event loop runs when the read is
  // over. By then the HTTP parser has read the frame as the start of the next
  // request and rejected it: the client gets a 400 and a closed connection.
  // (Bytes that can still begin a request line wait in the parser's buffer
  // instead, and the upgrade frees that buffer.)
  it("fail the connection when server.upgrade() runs in a later turn of the event loop", async () => {
    const events: string[] = [];
    const upgradeResult = Promise.withResolvers<boolean>();
    using server = echoServer(events, {
      async fetch(req, srv) {
        await new Promise(resolve => setImmediate(resolve));
        upgradeResult.resolve(srv.upgrade(req));
      },
    });
    using client = await rawClient(server.port);

    client.socket.write(Buffer.concat([Buffer.from(upgradeRequest), text("early")]));
    expect(await client.status()).toBe("HTTP/1.1 400 Bad Request");
    await client.closed;
    expect(await upgradeResult.promise).toBe(false);
    expect(events).toEqual([]);
  });

  // server.upgrade() for one connection can run in a microtask of another
  // connection's request. The bytes after that other request are not frames
  // of the upgraded connection.
  it("never reach the WebSocket of another connection", async () => {
    const events: string[] = [];
    const waiting = Promise.withResolvers<void>();
    let release = () => {};
    using server = echoServer(events, {
      async fetch(req, srv) {
        if (new URL(req.url).pathname === "/release") {
          release();
          return new Response("released");
        }
        await new Promise<void>(resolve => {
          release = resolve;
          waiting.resolve();
        });
        if (srv.upgrade(req)) return;
        return new Response("no", { status: 400 });
      },
    });
    using upgrading = await rawClient(server.port);
    using other = await rawClient(server.port);

    upgrading.socket.write(upgradeRequest);
    await waiting.promise;
    other.socket.write(
      Buffer.concat([Buffer.from("GET /release HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"), text("not yours")]),
    );
    expect(await other.status("released".length)).toBe("HTTP/1.1 200 OK");
    expect(await upgrading.status()).toBe("HTTP/1.1 101 Switching Protocols");
    upgrading.socket.write(text("later"));

    expect(await upgrading.framesUntil("text:echo:later")).toEqual(["text:echo:later"]);
    expect(events).toEqual(["open", "message:later"]);
  });
});
