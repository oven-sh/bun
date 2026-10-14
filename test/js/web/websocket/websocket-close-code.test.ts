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
        for (let next; (next = offset + 5 + fromClient.readUInt16BE(offset + 3)) < fromClient.length;) offset = next;
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

// Behind its Close frame the client shuts nothing down: it keeps reading. A shutdown(SHUT_RD)
// plus a FIN there makes the kernel reset the connection on the server's next frame, and the
// reset drops what the client sent and the kernel had not delivered yet. The client sends its
// FIN when the server's Close frame is in (RFC 6455 section 7.1.1, and what `ws` does).
describe.concurrent("ws:// after the close event", () => {
  type ClientClose = { code: number; reason: string };

  // The masked frames a client sent: data frames and Pongs are counted, Close frames are kept.
  class ClientFrames {
    messages = 0;
    bytes = 0;
    pongs = 0;
    closes: ClientClose[] = [];
    #pending = Buffer.alloc(0);

    push(chunk: Buffer) {
      let buf = this.#pending.length ? Buffer.concat([this.#pending, chunk]) : chunk;
      for (;;) {
        if (buf.length < 2) break;
        let length = buf[1] & 0x7f;
        let offset = 2;
        if (length === 126) {
          if (buf.length < 4) break;
          length = buf.readUInt16BE(2);
          offset = 4;
        } else if (length === 127) {
          if (buf.length < 10) break;
          length = Number(buf.readBigUInt64BE(2));
          offset = 10;
        }
        const mask = buf.subarray(offset, offset + 4);
        offset += 4;
        if (buf.length < offset + length) break;
        const opcode = buf[0] & 0x0f;
        if (opcode === 0x8) {
          const payload = Buffer.from(buf.subarray(offset, offset + length));
          for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
          this.closes.push({ code: payload.readUInt16BE(0), reason: payload.toString("utf8", 2) });
        } else if (opcode === 0xa) {
          this.pongs++;
        } else if (opcode === 0x1 || opcode === 0x2) {
          this.messages++;
          this.bytes += length;
        }
        buf = buf.subarray(offset + length);
      }
      this.#pending = buf;
    }
  }

  const CLOSE_1000 = Buffer.from([0x88, 0x02, 0x03, 0xe8]);
  const TICK = Buffer.from([0x81, 0x04, 0x74, 0x69, 0x63, 0x6b]);

  // An unmasked frame, as a server sends it, with `length` bytes of payload.
  function serverFrame(opcode: number, length: number) {
    const head =
      length < 126
        ? Buffer.from([0x80 | opcode, length])
        : length < 65536
          ? Buffer.from([0x80 | opcode, 126, length >> 8, length & 0xff])
          : Buffer.from([
              0x80 | opcode,
              127,
              0,
              0,
              0,
              0,
              length >>> 24,
              (length >> 16) & 0xff,
              (length >> 8) & 0xff,
              length & 0xff,
            ]);
    return Buffer.concat([head, Buffer.alloc(length, "A")]);
  }

  // A raw ws:// server that keeps its side open after the client's FIN. It answers the
  // opening handshake, with `withThe101` in the same write, and hands the socket to `onUpgrade`.
  async function startRawWsServer(
    onUpgrade: (socket: Socket, frames: ClientFrames) => void,
    withThe101: Buffer = Buffer.alloc(0),
  ) {
    const server = createServer({ allowHalfOpen: true }, socket => {
      let head = "";
      socket.on("data", function onHead(chunk: Buffer) {
        head += chunk.toString("latin1");
        if (!head.includes("\r\n\r\n")) return;
        socket.off("data", onHead);
        const key = /Sec-WebSocket-Key:\s*(.*)\r\n/i.exec(head)![1].trim();
        const accept = crypto
          .createHash("sha1")
          .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
          .digest("base64");
        socket.write(
          Buffer.concat([
            Buffer.from(
              "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
                `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
            ),
            withThe101,
          ]),
        );
        onUpgrade(socket, new ClientFrames());
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return {
      url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`,
      [Symbol.dispose]: () => void server.close(),
    };
  }

  // A FIN behind the Close frame is in the server's receive queue when the Close frame is.
  // One more loopback round trip gives this process the time to read it.
  async function startRoundTrip() {
    const echo = createServer(socket => void socket.pipe(socket)).listen(0, "127.0.0.1");
    await once(echo, "listening");
    return {
      async roundTrip() {
        const socket = connect((echo.address() as AddressInfo).port, "127.0.0.1");
        socket.write("x");
        await once(socket, "data");
        socket.destroy();
      },
      [Symbol.dispose]: () => void echo.close(),
    };
  }

  // `closed` is the close event. `failed` rejects when the client reports an error, so that a
  // test that waits for its server fails with the cause and not at its timeout.
  function connectClient(url: string) {
    const ws = new WebSocket(url);
    const closed = new Promise<{ code: number; wasClean: boolean }>(resolve => {
      ws.onclose = event => resolve({ code: event.code, wasClean: event.wasClean });
    });
    const failed = new Promise<never>((_, reject) => {
      ws.onerror = event => reject(new Error(`WebSocket error: ${(event as ErrorEvent).message}`));
    });
    failed.catch(() => {});
    return { ws, closed, failed };
  }

  type Served = { finBeforeTheAnswer: boolean; closes: ClientClose[]; pongs: number; client_left: Departure };

  // The server's side of a close. When the client's Close frame is in, it notes whether the
  // client's FIN is there too, answers with `answer`, and waits until the connection is gone.
  // It sends its own FIN only after the client's, unless `answer` ends the socket.
  function serveClose(
    socket: Socket,
    frames: ClientFrames,
    roundTrip: () => Promise<void>,
    answer: (socket: Socket) => void,
  ): Promise<Served> {
    const departed = departure(socket);
    const served = Promise.withResolvers<Served>();
    let clientFin = false;
    socket.on("end", () => {
      clientFin = true;
      socket.end();
    });
    async function answerTheClose() {
      await roundTrip();
      const finBeforeTheAnswer = clientFin;
      answer(socket);
      return { finBeforeTheAnswer, closes: frames.closes, pongs: frames.pongs, client_left: await departed };
    }
    socket.on("data", chunk => {
      const answered = frames.closes.length > 0;
      frames.push(chunk);
      if (!answered && frames.closes.length > 0) served.resolve(answerTheClose());
    });
    return served.promise;
  }

  // The server reads nothing until the client called close(). From then on it answers every
  // chunk it reads with a frame of its own, like a chat or a ticker, and closes after the
  // client's Close frame.
  it("everything sent before close() arrives at a server that keeps talking", async () => {
    const upgraded = Promise.withResolvers<{ socket: Socket; frames: ClientFrames }>();
    using server = await startRawWsServer((socket, frames) => {
      socket.pause();
      upgraded.resolve({ socket, frames });
    });

    const { ws, closed, failed } = connectClient(server.url);
    const sent = new Promise<void>(resolve => {
      ws.onopen = () => {
        const message = Buffer.alloc(65536, "M").toString();
        for (let i = 0; i < 8; i++) ws.send(message);
        ws.close(1000, "bye");
        resolve();
      };
    });

    const { socket, frames } = await Promise.race([upgraded.promise, failed]);
    const departed = departure(socket);
    socket.on("data", chunk => {
      frames.push(chunk);
      if (frames.closes.length === 0) socket.write(TICK);
      else socket.end(CLOSE_1000);
    });
    await Promise.race([sent, failed]);
    socket.write(TICK);
    socket.resume();

    const [client_left, client] = await Promise.all([departed, closed]);
    expect({
      server: { messages: frames.messages, bytes: frames.bytes, closes: frames.closes, client_left },
      client,
    }).toEqual({
      server: {
        messages: 8,
        bytes: 8 * 65536,
        closes: [{ code: 1000, reason: "bye" }],
        client_left: { fin: true },
      },
      client: { code: 1000, wasClean: true },
    });
  });

  // The server answers with what it still had to say and then its Close frame, and keeps the
  // connection open: the client's FIN follows the server's Close frame, not its own.
  it("close() sends its FIN when the server's Close frame is in, not before", async () => {
    using loopback = await startRoundTrip();
    const served = Promise.withResolvers<Served>();
    using server = await startRawWsServer((socket, frames) => {
      served.resolve(
        serveClose(socket, frames, loopback.roundTrip, socket => {
          socket.write(Buffer.concat([TICK, serverFrame(0x1, 300), serverFrame(0x2, 70000), CLOSE_1000]));
        }),
      );
    });
    const { ws, closed, failed } = connectClient(server.url);
    ws.onopen = () => ws.close(1000);
    expect(await Promise.race([served.promise, failed])).toEqual({
      finBeforeTheAnswer: false,
      closes: [{ code: 1000, reason: "" }],
      pongs: 0,
      client_left: { fin: true },
    });
    expect(await closed).toEqual({ code: 1000, wasClean: true });
  });

  const GREETING = serverFrame(0x1, 2);
  const inAHandler = (ws: WebSocket) => ws.addEventListener("message", () => ws.close(1000));
  const inATask = (ws: WebSocket) => ws.addEventListener("message", () => setImmediate(() => ws.close(1000)));
  const inOnOpen = (ws: WebSocket) => ws.addEventListener("open", () => ws.close(1000));

  // The server's Close frame with code 1000 and a reason of 98 bytes.
  const LONG_CLOSE_1000 = Buffer.concat([Buffer.from([0x88, 100, 0x03, 0xe8]), Buffer.alloc(98, "r")]);

  // The server sends the first 40 bytes of `inFlight` with its 101, behind `greeting`. The rest
  // follows the client's Close frame, and then `last`.
  it.each([
    // The read that dispatches the greeting carries the first bytes of the next frame.
    ["a message handler", "a binary frame", GREETING, serverFrame(0x2, 1000), CLOSE_1000, inAHandler],
    // Those bytes are parsed by the time close() runs.
    ["a task after the message", "a binary frame", GREETING, serverFrame(0x2, 1000), CLOSE_1000, inATask],
    ["a task after the message", "a Ping", GREETING, serverFrame(0x9, 100), CLOSE_1000, inATask],
    ["a task after the message", "the server's Close frame", GREETING, LONG_CLOSE_1000, Buffer.alloc(0), inATask],
    // The bytes that come with the 101 reach the client after the open event.
    ["onopen", "a binary frame", Buffer.alloc(0), serverFrame(0x2, 1000), CLOSE_1000, inOnOpen],
  ] as const)(
    "close() in %s, with %s in flight, sends its FIN when the server's Close frame is in",
    async (_where, _what, greeting, inFlight, last, arm) => {
      using loopback = await startRoundTrip();
      const served = Promise.withResolvers<Served>();
      using server = await startRawWsServer(
        (socket, frames) => {
          served.resolve(
            serveClose(socket, frames, loopback.roundTrip, socket => {
              socket.write(Buffer.concat([inFlight.subarray(40), last]));
            }),
          );
        },
        Buffer.concat([greeting, inFlight.subarray(0, 40)]),
      );
      const { ws, closed, failed } = connectClient(server.url);
      arm(ws);
      expect(await Promise.race([served.promise, failed])).toEqual({
        finBeforeTheAnswer: false,
        closes: [{ code: 1000, reason: "" }],
        pongs: 0,
        client_left: { fin: true },
      });
      expect(await closed).toEqual({ code: 1000, wasClean: true });
    },
  );

  it("a server that closes without a Close frame gets the client's FIN, not a reset", async () => {
    using loopback = await startRoundTrip();
    const served = Promise.withResolvers<Served>();
    using server = await startRawWsServer((socket, frames) => {
      served.resolve(serveClose(socket, frames, loopback.roundTrip, socket => void socket.end()));
    });
    const { ws, closed, failed } = connectClient(server.url);
    ws.onopen = () => ws.close(1000);
    expect(await Promise.race([served.promise, failed])).toEqual({
      finBeforeTheAnswer: false,
      closes: [{ code: 1000, reason: "" }],
      pongs: 0,
      client_left: { fin: true },
    });
    expect(await closed).toEqual({ code: 1000, wasClean: true });
  });

  it("a paused client reads the server's Close frame and FIN after close()", async () => {
    using loopback = await startRoundTrip();
    const served = Promise.withResolvers<Served>();
    using server = await startRawWsServer((socket, frames) => {
      served.resolve(serveClose(socket, frames, loopback.roundTrip, socket => void socket.end(CLOSE_1000)));
    });
    const { ws, closed, failed } = connectClient(server.url);
    ws.onopen = () => {
      ws.pause();
      ws.close(1000);
    };
    expect(await Promise.race([served.promise, failed])).toEqual({
      finBeforeTheAnswer: false,
      closes: [{ code: 1000, reason: "" }],
      pongs: 0,
      client_left: { fin: true },
    });
    expect(await closed).toEqual({ code: 1000, wasClean: true });
  });

  it("a ping listener that calls close() sends no Pong behind the Close frame", async () => {
    using loopback = await startRoundTrip();
    const served = Promise.withResolvers<Served>();
    using server = await startRawWsServer((socket, frames) => {
      served.resolve(serveClose(socket, frames, loopback.roundTrip, socket => void socket.end(CLOSE_1000)));
      socket.write(Buffer.from([0x89, 0x00]));
    });
    const { ws, closed, failed } = connectClient(server.url);
    ws.addEventListener("ping", () => ws.close(1000));
    expect(await Promise.race([served.promise, failed])).toEqual({
      finBeforeTheAnswer: false,
      closes: [{ code: 1000, reason: "" }],
      pongs: 0,
      client_left: { fin: true },
    });
    expect(await closed).toEqual({ code: 1000, wasClean: true });
  });

  // Both Close frames are exchanged when the client's answer is out: its FIN follows at once.
  it("a server-initiated close gets the client's Close frame and then its FIN", async () => {
    const left = Promise.withResolvers<{ closes: ClientClose[]; client_left: Departure }>();
    using server = await startRawWsServer(async (socket, frames) => {
      const departed = departure(socket);
      socket.on("data", chunk => frames.push(chunk));
      socket.on("end", () => socket.end());
      socket.write(CLOSE_1000);
      left.resolve({ closes: frames.closes, client_left: await departed });
    });
    const { closed, failed } = connectClient(server.url);
    expect(await Promise.race([left.promise, failed])).toEqual({
      closes: [{ code: 1000, reason: "" }],
      client_left: { fin: true },
    });
    expect(await closed).toEqual({ code: 1000, wasClean: true });
  });

  // The timeout is the only signal that ends this wait, and uSockets sweeps its timeouts every
  // 4 s: a timeout of 1 s takes 4 to 8 s. The test runs beside the wss:// ones that wait for it too.
  it("the client closes a connection that its peer keeps open", async () => {
    using loopback = await startRoundTrip();
    const served = Promise.withResolvers<Served>();
    using server = await startRawWsServer((socket, frames) => {
      served.resolve(serveClose(socket, frames, loopback.roundTrip, () => {}));
    });
    await using client = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const ws = new WebSocket(process.env.WS_URL);
          ws.onopen = () => ws.close();
          ws.onclose = event => console.log(event.code, event.wasClean);
          // An exit would close the connection too, so stay until the test lets go of stdin.
          process.stdin.resume();
        `,
      ],
      env: { ...bunEnv, WS_URL: server.url, BUN_CONFIG_WS_CLOSE_TIMEOUT: "1" },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    });
    // The line of the close event, whole: one read can return a part of it.
    const reader = client.stdout.getReader();
    const decoder = new TextDecoder();
    let stdout = "";
    while (!stdout.includes("\n")) {
      const { value, done } = await reader.read();
      if (done) break;
      stdout += decoder.decode(value, { stream: true });
    }
    expect(stdout).toBe("1000 true\n");
    // No FIN right behind the Close frame, and a FIN (not a reset) when the wait is over.
    expect(await served.promise).toEqual({
      finBeforeTheAnswer: false,
      closes: [{ code: 1000, reason: "" }],
      pongs: 0,
      client_left: { fin: true },
    });
    expect(client.exitCode).toBeNull();
  }, 20_000);
});
