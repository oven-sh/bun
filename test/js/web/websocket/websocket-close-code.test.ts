// WebSocket#close() argument validation and the close-code handling that
// https://websockets.spec.whatwg.org/#dom-websocket-close and RFC 6455
// section 7.4 require of the client. The base received-close-code matrix lives
// in websocket.test.js ("WebSocket CloseEvent reports the received close
// code"); this file holds the close() validation and the cases added with it.
import { describe, expect, it } from "bun:test";
import crypto from "node:crypto";
import { createServer, type Socket } from "node:net";
import { WebSocket as WsWebSocket } from "ws";

describe.concurrent("WebSocket close() argument validation", () => {
  // https://websockets.spec.whatwg.org/#dom-websocket-close step 1: the WHATWG
  // API accepts only 1000 and 3000-4999. 1001-1014 are legal on the wire for an
  // RFC 6455 endpoint but the browser interface forbids passing them; undici
  // and every browser throw InvalidAccessError for them. The `ws` npm package
  // accepts the wider endpoint set, covered in the "ws" describe below.
  const INVALID_CODES = [
    0, 999, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014, 1015, 1016, 2999, 5000,
    65535,
  ];
  const VALID_CODES = [1000, 3000, 4000, 4999];
  const LONG_REASON = Buffer.alloc(124, "R").toString();

  // `constructor` is DOMException for InvalidAccessError, but the native
  // SyntaxError for the reason-length check: Bun intentionally maps
  // ExceptionCode::SyntaxError to a JS SyntaxError (JSDOMExceptionHandling.cpp).
  function expectThrows(fn: () => void, constructor: Function, name: string, messageContains: string) {
    let error: Error | undefined;
    try {
      fn();
    } catch (e) {
      error = e as Error;
    }
    expect(error).toBeInstanceOf(constructor);
    expect(error!.name).toBe(name);
    expect(error!.message).toContain(messageContains);
  }

  function upgradeServer(onClose?: (event: { code: number; reason: string }) => void) {
    return Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("upgrade failed", { status: 400 });
      },
      websocket: {
        message() {},
        close(ws, code, reason) {
          onClose?.({ code, reason });
        },
      },
    });
  }

  async function open(server: Bun.Server) {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/`);
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("WebSocket failed to connect"));
    ws.onclose = () => reject(new Error("WebSocket closed before open"));
    await promise;
    // The tests install their own close handlers (and close the socket).
    ws.onerror = null;
    ws.onclose = null;
    return ws;
  }

  it("throws InvalidAccessError for close codes an endpoint must not send", async () => {
    using server = upgradeServer();
    const ws = await open(server);
    try {
      for (const code of INVALID_CODES) {
        expectThrows(() => ws.close(code), DOMException, "InvalidAccessError", `Received ${code}`);
        // Validation failed, so the socket must not have started closing.
        expect(ws.readyState).toBe(WebSocket.OPEN);
      }
    } finally {
      ws.close();
    }
  });

  it("throws SyntaxError when the reason is longer than 123 UTF-8 bytes", async () => {
    using server = upgradeServer();
    const ws = await open(server);
    try {
      expectThrows(() => ws.close(1000, LONG_REASON), SyntaxError, "SyntaxError", "123 UTF-8 bytes");
      expectThrows(() => ws.close(undefined, LONG_REASON), SyntaxError, "SyntaxError", "123 UTF-8 bytes");
      // 62 two-byte characters: 62 UTF-16 code units but 124 UTF-8 bytes. The
      // limit is on the encoded size.
      expectThrows(() => ws.close(4000, "é".repeat(62)), SyntaxError, "SyntaxError", "124 bytes");
      expect(ws.readyState).toBe(WebSocket.OPEN);
    } finally {
      ws.close();
    }
  });

  it("accepts a reason of exactly 123 UTF-8 bytes", async () => {
    const serverGotClose = Promise.withResolvers<{ code: number; reason: string }>();
    using server = upgradeServer(serverGotClose.resolve);
    const ws = await open(server);
    const reason = Buffer.alloc(123, "R").toString();
    ws.close(3000, reason);
    expect(await serverGotClose.promise).toEqual({ code: 3000, reason });
  });

  it("validates arguments even when the socket is already closed", async () => {
    using server = upgradeServer();
    const ws = await open(server);
    const closed = new Promise(resolve => (ws.onclose = resolve));
    ws.close();
    await closed;
    expect(ws.readyState).toBe(WebSocket.CLOSED);
    expectThrows(() => ws.close(5000), DOMException, "InvalidAccessError", "Received 5000");
    expectThrows(() => ws.close(1000, LONG_REASON), SyntaxError, "SyntaxError", "123 UTF-8 bytes");
  });

  it("validates arguments while the socket is still connecting", async () => {
    using server = upgradeServer();
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/`);
    const opened = Promise.withResolvers<unknown>();
    ws.onopen = opened.resolve;
    // A close or error before open means the rejected close() still tore the
    // connection attempt down.
    ws.onerror = () => opened.reject(new Error("connection errored before open"));
    ws.onclose = () => opened.reject(new Error("connection closed before open"));
    expect(ws.readyState).toBe(WebSocket.CONNECTING);
    expectThrows(() => ws.close(5000), DOMException, "InvalidAccessError", "Received 5000");
    expectThrows(() => ws.close(3000, LONG_REASON), SyntaxError, "SyntaxError", "123 UTF-8 bytes");
    expect(ws.readyState).toBe(WebSocket.CONNECTING);
    await opened.promise;
    ws.onclose = null;
    ws.close();
  });

  describe.each(VALID_CODES)("close(%i) is allowed", code => {
    it("and the code and reason reach the server", async () => {
      const serverGotClose = Promise.withResolvers<{ code: number; reason: string }>();
      using server = upgradeServer(serverGotClose.resolve);
      const ws = await open(server);
      const clientClosed = new Promise(resolve => (ws.onclose = e => resolve(e.code)));
      ws.close(code, "bye");
      expect(await serverGotClose.promise).toEqual({ code, reason: "bye" });
      expect(await clientClosed).toBe(code);
    });
  });

  describe("ws package close() argument validation", () => {
    // npm `ws` validates against the RFC 6455 endpoint set and throws a
    // TypeError, not a DOMException. Bun's shim forwards to the native
    // WebSocket, so it has to opt out of the WHATWG-strict check above to
    // keep 1001-1014 working.
    const WS_VALID = [1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014, 3000, 4999];
    const WS_INVALID = [0, 999, 1004, 1005, 1006, 1015, 2999, 5000, 65535];

    async function openWs(server: Bun.Server) {
      const ws = new WsWebSocket(`ws://127.0.0.1:${server.port}/`);
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      ws.on("open", resolve);
      ws.on("error", reject);
      await promise;
      return ws;
    }

    it("throws TypeError for codes outside the RFC 6455 endpoint set", async () => {
      using server = upgradeServer();
      const ws = await openWs(server);
      try {
        for (const code of WS_INVALID) {
          expectThrows(() => ws.close(code), TypeError, "TypeError", "valid error code number");
          expect(ws.readyState).toBe(WsWebSocket.OPEN);
        }
        expectThrows(() => ws.close("1000" as any), TypeError, "TypeError", "valid error code number");
      } finally {
        ws.close();
      }
    });

    describe.each(WS_VALID)("close(%i) is allowed", code => {
      it("and the code reaches the server", async () => {
        const serverGotClose = Promise.withResolvers<{ code: number; reason: string }>();
        using server = upgradeServer(serverGotClose.resolve);
        const ws = await openWs(server);
        ws.close(code, "bye");
        expect(await serverGotClose.promise).toEqual({ code, reason: "bye" });
      });
    });
  });
});

describe.concurrent("WebSocket client and server-sent close frames", () => {
  // Raw TCP server: complete the WS handshake, then run `afterUpgrade(socket)`.
  function rawWsServer(afterUpgrade: (socket: Socket) => void) {
    return new Promise<ReturnType<typeof createServer>>(resolveServer => {
      const server = createServer(sock => {
        let buf = "";
        let upgraded = false;
        sock.on("data", chunk => {
          if (upgraded) {
            sock.end();
            return;
          }
          buf += chunk.toString("latin1");
          if (!buf.includes("\r\n\r\n")) return;
          const key = /Sec-WebSocket-Key:\s*(.*)\r\n/i.exec(buf)![1].trim();
          const accept = crypto
            .createHash("sha1")
            .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
            .digest("base64");
          sock.write(
            "HTTP/1.1 101 Switching Protocols\r\n" +
              "Upgrade: websocket\r\n" +
              "Connection: Upgrade\r\n" +
              "Sec-WebSocket-Accept: " +
              accept +
              "\r\n\r\n",
          );
          upgraded = true;
          afterUpgrade(sock);
        });
        sock.on("error", () => {});
      });
      server.listen(0, "127.0.0.1", () => resolveServer(server));
    });
  }

  function closeFrame(code: number, reason = "") {
    const r = Buffer.from(reason);
    const f = Buffer.alloc(4 + r.length);
    f[0] = 0x88;
    f[1] = 2 + r.length;
    f[2] = (code >> 8) & 0xff;
    f[3] = code & 0xff;
    r.copy(f, 4);
    return f;
  }

  async function connectAndAwaitClose(server: ReturnType<typeof createServer>) {
    const address = server.address() as import("node:net").AddressInfo;
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}`);
    const { promise, resolve } = Promise.withResolvers<{ code: number; reason: string; wasClean: boolean }>();
    ws.addEventListener("close", e => resolve({ code: e.code, reason: e.reason, wasClean: e.wasClean }));
    ws.addEventListener("error", () => {});
    const result = await promise;
    await new Promise(r => server.close(r));
    return result;
  }

  // RFC6455 §7.4.1-§7.4.2: 1015 is reserved and must not appear on the wire,
  // and 5000-65535 is not defined, so a server sending one is reporting a
  // protocol error and JS sees 1002. The in-range reserved bands (999,
  // 1004-1006, 1016-2999) are covered in websocket.test.js.
  describe.each([1015, 5000, 65535])("received close code %i", code => {
    it("reports 1002", async () => {
      const server = await rawWsServer(sock => sock.write(closeFrame(code)));
      expect(await connectAndAwaitClose(server)).toEqual({ code: 1002, reason: "", wasClean: true });
    });
  });

  // 1012-1014 are IANA-registered and legal on the wire.
  it("received close code 1014 passes through unchanged", async () => {
    const server = await rawWsServer(sock => sock.write(closeFrame(1014)));
    expect(await connectAndAwaitClose(server)).toEqual({ code: 1014, reason: "", wasClean: true });
  });

  // RFC 6455 §7.4.1: 1007 is "received data inconsistent with the type of the
  // message (e.g., non-UTF-8 data within a text message)". 1003 would mean an
  // unsupported data type.
  it("a text frame with invalid UTF-8 fails with 1007", async () => {
    const server = await rawWsServer(sock => sock.write(Buffer.from([0x81, 0x02, 0xc3, 0x28])));
    expect(await connectAndAwaitClose(server)).toEqual({
      code: 1007,
      reason: "Server sent invalid UTF8",
      wasClean: false,
    });
  });
});
