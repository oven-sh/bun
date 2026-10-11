// WebSocket#close() argument validation and the close-code handling that
// https://websockets.spec.whatwg.org/#dom-websocket-close and RFC 6455
// section 7.4 require of the client. The base received-close-code matrix lives
// in websocket.test.js ("WebSocket CloseEvent reports the received close
// code"); this file holds the close() validation and the cases added with it.
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import crypto from "node:crypto";
import { once } from "node:events";
import { type AddressInfo, connect, createServer, type Socket } from "node:net";
import { type Departure, departure, startRawWssServer, startRecordingProxy } from "./proxy-test-utils";

describe.concurrent("WebSocket close() argument validation", () => {
  // Close codes an RFC 6455 endpoint must never put on the wire. close() has to
  // reject them: the peer treats them as a protocol error.
  const INVALID_CODES = [0, 999, 1004, 1005, 1006, 1015, 1016, 2999, 5000, 65535];
  // Every code an endpoint may send (RFC 6455 7.4 + IANA): 1000-1014 minus the
  // reserved 1004-1006, plus the 3000-4999 boundaries. Unlike browsers, the
  // 1001-1014 band stays permitted: `ws` clients and Bun's inspector use 1001/1011.
  const VALID_CODES = [1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014, 3000, 4999];
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

  async function open(server: Bun.Server<undefined>) {
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

// RFC 6455 section 7.1.1: the client lets the server close the TCP connection first, but not forever.
describe.concurrent("wss:// after the close event", () => {
  const CLOSE_1000 = Buffer.from([0x88, 0x02, 0x03, 0xe8]);

  it("the server's Close frame gets no second Close frame back", async () => {
    let fromClient = Buffer.alloc(0);
    using server = await startRawWssServer((socket, chunk) => {
      if (fromClient.length === 0) socket.end(CLOSE_1000);
      fromClient = Buffer.concat([fromClient, chunk]);
    });
    const ws = new WebSocket(`wss://127.0.0.1:${server.port}`, { tls: { rejectUnauthorized: false } });
    ws.onopen = () => ws.close(1000);
    const event = await new Promise<CloseEvent>(resolve => (ws.onclose = resolve));
    expect({ code: event.code, wasClean: event.wasClean }).toEqual({ code: 1000, wasClean: true });
    await Promise.all(server.departures);
    // One masked Close frame with a status code: 2 header bytes, 4 mask bytes, 2 payload bytes.
    expect({ opcode: fromClient[0] & 0x0f, bytes: fromClient.length }).toEqual({ opcode: 0x8, bytes: 8 });
  });

  // Stands between the client and its peer and sees how the client's TCP connection ends. After
  // `freeze()` the peer hears nothing more from the client, like a peer that stopped reading.
  async function startRelay(port: number) {
    let frozen = false;
    let fromClient = Buffer.alloc(0);
    const departed = Promise.withResolvers<Departure>();
    const relay = createServer(client => {
      departed.resolve(departure(client));
      const peer = connect(port, "127.0.0.1");
      peer.on("error", () => {});
      peer.pipe(client);
      client.on("close", () => peer.destroy());
      client.on("data", (chunk: Buffer) => {
        fromClient = Buffer.concat([fromClient, chunk]);
        if (!frozen) peer.write(chunk);
      });
    });
    relay.listen(0, "127.0.0.1");
    await once(relay, "listening");
    return {
      port: (relay.address() as AddressInfo).port,
      departed: departed.promise,
      freeze: () => void (frozen = true),
      // The content type of the last TLS record the client sent.
      lastRecordType() {
        let offset = 0;
        for (let next; (next = offset + 5 + fromClient.readUInt16BE(offset + 3)) < fromClient.length; ) offset = next;
        return fromClient[offset];
      },
      [Symbol.dispose]: () => void relay.close(),
    };
  }

  // uSockets sweeps its timeouts every 4 s, so a timeout of 1 s takes 4 to 8 s.
  it.each([
    // TLS 1.2 does not hide the type of a record: 21 is an alert, the close_notify.
    ["direct", 21],
    // This proxy never answers the close_notify of the client. TLS 1.3 shows every record as 23.
    ["https proxy", 23],
  ] as const)(
    "the client closes a connection that its peer keeps open: %s",
    async (route, lastRecordType) => {
      using server = await startRawWssServer(socket => socket.write(CLOSE_1000), { maxVersion: "TLSv1.2" });
      using proxy = await startRecordingProxy({ tls: true });
      using relay = await startRelay(route === "direct" ? server.port : proxy.port);
      await using client = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
            const ws = new WebSocket(process.env.WS_URL, {
              proxy: process.env.WS_PROXY || undefined,
              tls: { rejectUnauthorized: false },
            });
            ws.onopen = () => setImmediate(() => ws.close());
            ws.onclose = event => console.log(event.code, event.wasClean);
            // An exit would close the connection too, so stay until the test lets go of stdin.
            process.stdin.resume();
          `,
        ],
        env: {
          ...bunEnv,
          NO_PROXY: "",
          no_proxy: "",
          BUN_CONFIG_WS_CLOSE_TIMEOUT: "1",
          WS_URL: `wss://127.0.0.1:${route === "direct" ? relay.port : server.port}`,
          WS_PROXY: route === "direct" ? "" : `https://127.0.0.1:${relay.port}`,
        },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "inherit",
      });
      const { value } = await client.stdout.getReader().read();
      expect(new TextDecoder().decode(value)).toBe("1000 true\n");
      relay.freeze();
      // A FIN and not a reset, which drops what is still in flight behind the clean close event.
      expect({ departure: await relay.departed, lastRecordType: relay.lastRecordType() }).toEqual({
        departure: { fin: true },
        lastRecordType,
      });
      expect(client.exitCode).toBeNull();
    },
    20_000,
  );
});
