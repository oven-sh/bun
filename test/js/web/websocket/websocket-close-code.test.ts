// WebSocket#close() argument validation, the closing handshake and the close-code
// handling that https://websockets.spec.whatwg.org/#dom-websocket-close and RFC 6455
// section 7 require of the client. The base received-close-code matrix lives
// in websocket.test.js ("WebSocket CloseEvent reports the received close code").
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

  // Bind the address that the clients dial. On macOS, a port-0 bind to the
  // default dual-stack [::] address can get a port that an IPv4 socket already
  // listens on, and a dial to 127.0.0.1 then reaches that socket.
  function upgradeServer(onClose?: (event: { code: number; reason: string }) => void) {
    return Bun.serve({
      hostname: "127.0.0.1",
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

// RFC 6455 section 7, as a raw server sees it. The connection is closed when both Close frames are
// exchanged or TCP is gone, not when the client's own frame is written: the close event reports what
// the server sent, and until then the client keeps reading and keeps the process alive.
describe.concurrent("WebSocket closing handshake", () => {
  // An unmasked frame, as a server sends it.
  function frame(opcode: number, payload: string | Uint8Array = "") {
    const body = Buffer.from(payload);
    const head =
      body.length < 126
        ? Buffer.from([0x80 | opcode, body.length])
        : Buffer.from([
            0x80 | opcode,
            127,
            0,
            0,
            0,
            0,
            ...new Uint8Array(new Uint32Array([body.length]).buffer).reverse(),
          ]);
    return Buffer.concat([head, body]);
  }

  function closeFrame(code?: number, reason = "") {
    return frame(
      0x8,
      code === undefined ? "" : Buffer.concat([Buffer.from([code >> 8, code & 0xff]), Buffer.from(reason)]),
    );
  }

  const OPCODES: Record<number, string> = { 0: "continuation", 1: "text", 2: "binary", 9: "ping", 10: "pong" };

  // One connection a raw server accepted. `seen` is what the client did, in order: "text 5" for a frame
  // and its payload length, "close 1000 bye", "close" for a Close frame without a payload, then "FIN" or
  // the error code of a reset. The server sends its FIN after the client's unless a test ends the socket.
  class Peer {
    seen: string[] = [];
    gone: Promise<void>;
    #pending = Buffer.alloc(0);
    #waiting: [prefix: string, resolve: () => void][] = [];

    constructor(readonly socket: Socket) {
      socket.on("data", chunk => this.#parse(chunk));
      socket.on("end", () => {
        this.note("FIN");
        socket.end();
      });
      socket.on("error", (error: NodeJS.ErrnoException) => this.note(error.code!));
      this.gone = new Promise(resolve => {
        socket.on("close", () => {
          for (const [, found] of this.#waiting) found();
          resolve();
        });
      });
    }

    note(entry: string) {
      this.seen.push(entry);
      this.#waiting = this.#waiting.filter(([prefix, found]) => !entry.startsWith(prefix) || (found(), false));
    }

    // Resolves when `seen` has an entry that starts with `prefix`, or when the connection is gone.
    saw(prefix: string) {
      if (this.socket.destroyed || this.seen.some(entry => entry.startsWith(prefix))) return Promise.resolve();
      return new Promise<void>(resolve => this.#waiting.push([prefix, resolve]));
    }

    #parse(chunk: Buffer) {
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
          this.note(
            ["close", ...(length ? [payload.readUInt16BE(0)] : []), payload.toString("utf8", 2)].join(" ").trim(),
          );
        } else {
          this.note(`${OPCODES[opcode]} ${length}`);
        }
        buf = buf.subarray(offset + length);
      }
      this.#pending = buf;
    }
  }

  // A raw ws:// server for one client. It answers the opening handshake. `deaf`: it reads nothing after that.
  async function startPeer({ deaf = false } = {}) {
    const accepted = Promise.withResolvers<Peer>();
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
          "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
            `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
        );
        const peer = new Peer(socket);
        if (deaf) socket.pause();
        accepted.resolve(peer);
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return {
      url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`,
      peer: accepted.promise,
      [Symbol.dispose]() {
        server.close();
        accepted.promise.then(peer => peer.socket.destroy());
      },
    };
  }

  // A FIN right behind a frame is in the server's receive queue when the frame is. One more
  // loopback round trip gives this process the time to read it.
  async function roundTrip() {
    const echo = createServer(socket => void socket.pipe(socket)).listen(0, "127.0.0.1");
    await once(echo, "listening");
    const socket = connect((echo.address() as AddressInfo).port, "127.0.0.1");
    socket.write("x");
    await once(socket, "data");
    socket.destroy();
    echo.close();
  }

  type Observed = string | { error: string | undefined } | { code: number; reason: string; wasClean: boolean };

  // Everything the client reports, in order: messages, the `code` of each error, the close event.
  function observe(ws: WebSocket) {
    const events: Observed[] = [];
    const closed = new Promise<Observed[]>(resolve => {
      ws.addEventListener("message", event => events.push(`message ${String(event.data).length}`));
      ws.addEventListener("error", event => events.push({ error: (event as ErrorEvent).error?.code }));
      ws.addEventListener("close", event => {
        events.push({ code: event.code, reason: event.reason, wasClean: event.wasClean });
        resolve(events);
      });
    });
    return { events, closed };
  }

  const opened = (ws: WebSocket) => new Promise(resolve => ws.addEventListener("open", resolve, { once: true }));

  it("close() waits for the server's Close frame and reports that frame's code and reason", async () => {
    using server = await startPeer();
    const ws = new WebSocket(server.url);
    const { events, closed } = observe(ws);
    ws.onopen = () => ws.close(1000, "mine");
    const peer = await server.peer;
    await peer.saw("close");
    const whenTheServerReadIt = { readyState: ws.readyState, events: [...events] };
    peer.socket.write(closeFrame(4321, "theirs"));
    expect({ whenTheServerReadIt, events: await closed }).toEqual({
      whenTheServerReadIt: { readyState: WebSocket.CLOSING, events: [] },
      events: [{ code: 4321, reason: "theirs", wasClean: true }],
    });
    await peer.gone;
    expect(peer.seen).toEqual(["close 1000 mine", "FIN"]);
  });

  it.each([
    // No code: a Close frame without a payload, and 1005 ("no status received") for one that comes back.
    ["close()", (ws: WebSocket) => ws.close(), "close", closeFrame(), 1005],
    ["close(1000)", (ws: WebSocket) => ws.close(1000), "close 1000", closeFrame(1000), 1000],
    ["close(3001, 'bye')", (ws: WebSocket) => ws.close(3001, "bye"), "close 3001 bye", closeFrame(), 1005],
  ] as const)("%s puts exactly that on the wire", async (_label, act, sent, answer, code) => {
    using server = await startPeer();
    const ws = new WebSocket(server.url);
    const { closed } = observe(ws);
    ws.onopen = () => act(ws);
    const peer = await server.peer;
    await peer.saw("close");
    peer.socket.write(answer);
    expect(await closed).toEqual([{ code, reason: "", wasClean: true }]);
    await peer.gone;
    expect(peer.seen).toEqual([sent, "FIN"]);
  });

  it.each([
    [closeFrame(1000, "done"), "close 1000 done", { code: 1000, reason: "done", wasClean: true }],
    [closeFrame(1001, "away"), "close 1001 away", { code: 1001, reason: "away", wasClean: true }],
    // 1012-1014 are IANA-registered and legal on the wire.
    [closeFrame(1014), "close 1014", { code: 1014, reason: "", wasClean: true }],
    [closeFrame(), "close", { code: 1005, reason: "", wasClean: true }],
  ] as const)("a Close frame from the server is echoed as it came: %#", async (received, echo, event) => {
    using server = await startPeer();
    const { closed } = observe(new WebSocket(server.url));
    const peer = await server.peer;
    peer.socket.write(received);
    expect(await closed).toEqual([event]);
    await peer.gone;
    // Both frames are exchanged when the echo is out: the FIN follows at once.
    expect(peer.seen).toEqual([echo, "FIN"]);
  });

  it.each([
    ["ends the connection", (socket: Socket) => void socket.end()],
    ["resets the connection", (socket: Socket) => void socket.resetAndDestroy()],
  ] as const)("close() reports 1006 when the server %s without a Close frame", async (_label, act) => {
    using server = await startPeer();
    const ws = new WebSocket(server.url);
    const { closed } = observe(ws);
    ws.onopen = () => ws.close(1000);
    const peer = await server.peer;
    await peer.saw("close");
    await roundTrip();
    // No FIN behind the Close frame.
    expect(peer.seen).toEqual(["close 1000"]);
    act(peer.socket);
    expect(await closed).toEqual([{ code: 1006, reason: "", wasClean: false }]);
  });

  it("the end of an open connection is answered with a FIN and reported as 1006 without an error", async () => {
    using server = await startPeer();
    const ws = new WebSocket(server.url);
    const { closed } = observe(ws);
    await opened(ws);
    const peer = await server.peer;
    peer.socket.end();
    expect(await closed).toEqual([{ code: 1006, reason: "", wasClean: false }]);
    await peer.gone;
    expect(peer.seen).toEqual(["FIN"]);
  });

  it("terminate() closes the connection as socket.destroy() does: what was sent still arrives", async () => {
    using server = await startPeer({ deaf: true });
    const ws = new WebSocket(server.url);
    const { closed } = observe(ws);
    await opened(ws);
    ws.send("one");
    ws.send("three");
    ws.terminate();
    expect(await closed).toEqual([{ code: 1006, reason: "", wasClean: false }]);
    const peer = await server.peer;
    peer.socket.resume();
    await peer.gone;
    expect(peer.seen).toEqual(["text 3", "text 5", "FIN"]);
  });

  // The server reads nothing until the client called close(). From then on it answers every chunk it
  // reads with a frame of its own, like a chat or a ticker, and closes after the client's Close frame.
  it("everything sent before close() arrives at a server that keeps talking", async () => {
    using server = await startPeer({ deaf: true });
    const ws = new WebSocket(server.url);
    const { closed } = observe(ws);
    await opened(ws);
    const message = Buffer.alloc(65536, "M").toString();
    for (let i = 0; i < 8; i++) ws.send(message);
    ws.close(1000, "bye");

    const peer = await server.peer;
    peer.socket.on("data", () => {
      if (!peer.socket.writable) return;
      if (peer.seen.at(-1)?.startsWith("close")) peer.socket.end(closeFrame(1000));
      else peer.socket.write(frame(0x1, "tick"));
    });
    peer.socket.write(frame(0x1, "tick"));
    peer.socket.resume();

    expect(await closed).toEqual([{ code: 1000, reason: "", wasClean: true }]);
    await peer.gone;
    expect(peer.seen).toEqual([...Array(8).fill("text 65536"), "close 1000 bye", "FIN"]);
  });

  it("what the server still says before its Close frame is read and dropped, and the FIN follows that frame", async () => {
    using server = await startPeer();
    const ws = new WebSocket(server.url);
    const { closed } = observe(ws);
    ws.onopen = () => ws.close(1000);
    const peer = await server.peer;
    await peer.saw("close");
    await roundTrip();
    peer.note("the server answers");
    peer.socket.write(
      Buffer.concat([frame(0x1, "late"), frame(0x9), frame(0x2, Buffer.alloc(70000, "A")), closeFrame(1000)]),
    );
    expect(await closed).toEqual([{ code: 1000, reason: "", wasClean: true }]);
    await peer.gone;
    // No Pong either: nothing follows a Close frame (RFC 6455 section 5.5.1).
    expect(peer.seen).toEqual(["close 1000", "the server answers", "FIN"]);
  });

  it("the Pong goes out before the ping event, so a listener that closes sends nothing behind its Close frame", async () => {
    using server = await startPeer();
    const ws = new WebSocket(server.url);
    const { closed } = observe(ws);
    ws.addEventListener("ping", () => ws.close(4000, "in ping"));
    const peer = await server.peer;
    peer.socket.write(frame(0x9, "hi"));
    await peer.saw("close");
    peer.socket.write(closeFrame(4000, "in ping"));
    expect(await closed).toEqual([{ code: 4000, reason: "in ping", wasClean: true }]);
    await peer.gone;
    expect(peer.seen).toEqual(["pong 2", "close 4000 in ping", "FIN"]);
  });

  // RFC 6455 section 7.1.7, "fail the WebSocket connection": a Close frame that says why, no wait for an
  // answer, an error event, and 1006 because no Close frame was received (section 7.1.5).
  const KEY = [1, 2, 3, 4];
  it.each([
    ["a reserved opcode", [0x83, 0x00], 1002, "WS_ERR_INVALID_OPCODE"],
    ["a continuation of nothing", [0x80, 0x00], 1002, "WS_ERR_INVALID_OPCODE"],
    ["a new message inside a fragmented one", [0x01, 0x01, 0x61, 0x81, 0x01, 0x62], 1002, "WS_ERR_INVALID_OPCODE"],
    ["RSV2", [0xa1, 0x00], 1002, "WS_ERR_UNEXPECTED_RSV_2_3"],
    ["RSV3", [0x91, 0x00], 1002, "WS_ERR_UNEXPECTED_RSV_2_3"],
    ["RSV1 without permessage-deflate", [0xc1, 0x01, 0x61], 1002, "WS_ERR_UNEXPECTED_RSV_1"],
    // Section 5.1: "A client MUST close a connection if it detects a masked frame."
    ["a masked text frame", [0x81, 0x81, ...KEY, 0x60], 1002, "WS_ERR_UNEXPECTED_MASK"],
    ["a masked continuation", [0x01, 0x01, 0x61, 0x80, 0x81, ...KEY, 0x63], 1002, "WS_ERR_UNEXPECTED_MASK"],
    ["a masked Ping", [0x89, 0x81, ...KEY, 0x60], 1002, "WS_ERR_UNEXPECTED_MASK"],
    ["a masked Close frame", [0x88, 0x82, ...KEY, 0x02, 0xea], 1002, "WS_ERR_UNEXPECTED_MASK"],
    ["a fragmented Ping", [0x09, 0x00], 1002, "WS_ERR_EXPECTED_FIN"],
    ["a Ping of 126 bytes", [0x89, 126, 0, 126], 1002, "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH"],
    ["a Close frame of 1 byte", [0x88, 0x01, 0x03], 1002, "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH"],
    // Sections 7.4.1 and 7.4.2: reserved, or not defined. The rest of the reserved bands is in websocket.test.js.
    ["close code 1005", [...closeFrame(1005)], 1002, "WS_ERR_INVALID_CLOSE_CODE"],
    ["close code 1015", [...closeFrame(1015)], 1002, "WS_ERR_INVALID_CLOSE_CODE"],
    ["close code 5000", [...closeFrame(5000)], 1002, "WS_ERR_INVALID_CLOSE_CODE"],
    ["close code 65535", [...closeFrame(65535)], 1002, "WS_ERR_INVALID_CLOSE_CODE"],
    // Section 7.4.1: 1007 is "data within a message that was not consistent with the type of the message".
    ["a text frame that is not UTF-8", [0x81, 0x02, 0xc3, 0x28], 1007, "WS_ERR_INVALID_UTF8"],
    ["a close reason that is not UTF-8", [0x88, 0x04, 0x03, 0xe8, 0xc3, 0x28], 1007, "WS_ERR_INVALID_UTF8"],
    ["a frame of 128 MiB + 1", [0x82, 127, 0, 0, 0, 0, 0x08, 0, 0, 1], 1009, "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"],
    ["a frame of 2^53 bytes", [0x82, 127, 0, 0x20, 0, 0, 0, 0, 0, 0], 1009, "WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH"],
    ["a frame of 2^64 - 1 bytes", [0x82, 127, ...Array(8).fill(255)], 1009, "WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH"],
  ] as const)("%s fails the connection", async (_label, bytes, sent, error) => {
    using server = await startPeer();
    const { closed } = observe(new WebSocket(server.url));
    const peer = await server.peer;
    peer.socket.write(Buffer.from(bytes));
    expect(await closed).toEqual([{ error }, { code: 1006, reason: "", wasClean: false }]);
    await peer.gone;
    expect(peer.seen).toEqual([`close ${sent}`, "FIN"]);
  });

  // Section 5.2 asks for the shortest form. Node's WebSocket and the `ws` package take the others too.
  it.each([
    ["0 in 16 bits", [0x81, 126, 0, 0], 0],
    ["0 in 64 bits", [0x81, 127, 0, 0, 0, 0, 0, 0, 0, 0], 0],
    ["0 in 16 bits, in the last fragment", [0x01, 0x02, 0x61, 0x62, 0x80, 126, 0, 0], 2],
  ] as const)("a length may be written in more bytes than it needs: %s", async (_label, bytes, length) => {
    using server = await startPeer();
    const { closed } = observe(new WebSocket(server.url));
    const peer = await server.peer;
    peer.socket.write(Buffer.concat([Buffer.from(bytes), closeFrame(1000)]));
    expect(await closed).toEqual([`message ${length}`, { code: 1000, reason: "", wasClean: true }]);
  });

  describe("with a server that stopped reading", () => {
    const CHUNK = Buffer.alloc(64 * 1024, "x").toString();

    // An open client with more unsent data than the kernel takes.
    async function flood(url: string) {
      const ws = new WebSocket(url);
      const observed = observe(ws);
      await opened(ws);
      for (let i = 0; i < 256; i++) ws.send(CHUNK);
      expect(ws.bufferedAmount).toBeGreaterThan(0);
      return { ws, ...observed };
    }

    async function closing(ws: WebSocket) {
      const deadline = Date.now() + 3000;
      while (ws.readyState === WebSocket.OPEN && Date.now() < deadline) await new Promise(setImmediate);
      return ws.readyState;
    }

    it("a Close frame from the server starts the handshake at once: CLOSING, and no frame behind the echo", async () => {
      using server = await startPeer({ deaf: true });
      const { ws, closed } = await flood(server.url);
      const peer = await server.peer;
      peer.socket.write(closeFrame(1000, "bye"));
      expect(await closing(ws)).toBe(WebSocket.CLOSING);
      ws.send("late");
      peer.socket.resume();
      expect(await closed).toEqual([{ code: 1000, reason: "bye", wasClean: true }]);
      await peer.gone;
      expect(peer.seen).toEqual([...Array(256).fill("text 65536"), "close 1000 bye", "FIN"]);
    });

    it("terminate() behind the server's Close frame reports the code that was received", async () => {
      using server = await startPeer({ deaf: true });
      const { ws, closed } = await flood(server.url);
      (await server.peer).socket.write(closeFrame(1000, "bye"));
      expect(await closing(ws)).toBe(WebSocket.CLOSING);
      ws.terminate();
      expect(await closed).toEqual([{ code: 1000, reason: "bye", wasClean: false }]);
    });

    it("terminate() ends a close() whose Close frame is stuck behind unsent data", async () => {
      using server = await startPeer({ deaf: true });
      const { ws, closed } = await flood(server.url);
      ws.close(1000);
      ws.terminate();
      expect(await closed).toEqual([{ code: 1006, reason: "", wasClean: false }]);
    });
  });

  // Nothing but the pending handshake keeps this script alive. The server reads only after close() returned.
  it("a script that sends, closes and ends stays until the server's Close frame", async () => {
    using server = await startPeer({ deaf: true });
    await using client = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const ws = new WebSocket(process.env.WS_URL);
          ws.onopen = () => {
            for (let i = 0; i < 32; i++) ws.send("msg");
            ws.close(1000);
            console.log("closing");
          };
          ws.onclose = event => console.log(event.code, event.reason, event.wasClean);
        `,
      ],
      env: { ...bunEnv, WS_URL: server.url },
      stdout: "pipe",
      stderr: "inherit",
    });
    const reader = client.stdout.getReader();
    const decoder = new TextDecoder();
    let stdout = "";
    for (let read; !stdout.includes("\n") && !(read = await reader.read()).done;) {
      stdout += decoder.decode(read.value, { stream: true });
    }
    await roundTrip();

    const peer = await server.peer;
    peer.socket.resume();
    await peer.saw("close");
    peer.socket.write(Buffer.concat([frame(0x1, "echo"), closeFrame(4000, "server")]));
    for (let read; !(read = await reader.read()).done;) stdout += decoder.decode(read.value, { stream: true });
    await peer.gone;
    expect({ stdout, seen: peer.seen }).toEqual({
      stdout: "closing\n4000 server true\n",
      seen: [...Array(32).fill("text 3"), "close 1000", "FIN"],
    });
    expect(await client.exited).toBe(0);
  });

  // The timeout is the only thing that ends these waits, and uSockets sweeps its timeouts every 4 s:
  // a timeout of 1 s takes 4 to 8 s. They run beside the wss:// tests below that wait for it too.
  it.each([
    ["never answers", false, ""],
    ["stopped reading, with the Close frame behind unsent data", true, "for (let i = 0; i < 256; i++) ws.send(chunk);"],
  ] as const)(
    "close() gives up on a server that %s: 1006, and the process ends",
    async (_label, deaf, before) => {
      using server = await startPeer({ deaf });
      await using client = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
            const chunk = Buffer.alloc(64 * 1024, "x").toString();
            const ws = new WebSocket(process.env.WS_URL);
            ws.onopen = () => {
              ${before}
              ws.close(1000);
            };
            ws.onerror = event => console.log("error", event.message);
            ws.onclose = event => console.log(event.code, event.wasClean);
          `,
        ],
        env: { ...bunEnv, WS_URL: server.url, BUN_CONFIG_WS_CLOSE_TIMEOUT: "1" },
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([client.stdout.text(), client.exited]);
      expect(stdout).toBe("1006 false\n");
      expect(exitCode).toBe(0);
    },
    20_000,
  );
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
