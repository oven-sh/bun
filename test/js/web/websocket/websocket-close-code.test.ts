// Client-side WebSocket#close() argument validation, closing handshake and close code
// handling, per https://websockets.spec.whatwg.org/#dom-websocket-close and RFC 6455
// section 7. The basic received-close-code matrix is in websocket.test.js
// ("WebSocket CloseEvent reports the received close code").
import { setSocketOptions } from "bun:internal-for-testing";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { once } from "node:events";
import { type AddressInfo, connect, createServer } from "node:net";
import { startRawWssServer } from "./proxy-test-utils";
import { closePayload, createPeer, encodeFrame, OP, type RawSocket, response101, showFrame } from "./raw-peer";

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

  // Bind the same address the clients connect to. On macOS, binding port 0 on the
  // default dual-stack [::] address can return a port an IPv4 socket is already
  // listening on, and connecting to 127.0.0.1 would reach that socket instead.
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

// RFC 6455 section 7, observed from a raw server. The connection counts as closed once both Close
// frames are exchanged or TCP closes, not once the client writes its own Close frame. The close event
// reports the server's code and reason. Until then the client keeps reading and keeps the process alive.
describe.concurrent("WebSocket closing handshake", () => {
  // Raw ws:// or wss:// server. It replies to the client's FIN with its own. With `keepOpen`, only the test closes
  // the connection. With `paused`, it stops reading after the opening handshake.
  function startPeer({ paused = false, keepOpen = false, secure = false } = {}) {
    return createPeer({
      secure,
      allowHalfOpen: keepOpen,
      respond(connection) {
        if (paused) connection.socket.pause();
        return response101(connection);
      },
    });
  }

  // What the client did, in order: its frames, then "end" for its FIN or "error <code>" for a reset, then "close".
  const seen = (peer: RawSocket) => [...peer.frames.map(showFrame), ...peer.socketEvents];

  // A FIN sent right after a frame reaches the server's receive queue along with it. One more
  // loopback round trip gives this process time to read it.
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

  // Records the client's events in order: messages, each error's `code`, and the close event.
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
    await using server = await startPeer();
    const ws = new WebSocket(server.url);
    const { events, closed } = observe(ws);
    ws.onopen = () => ws.close(1000, "mine");
    const peer = await server.connection();
    await peer.next();
    const afterServerReadClose = { readyState: ws.readyState, events: [...events] };
    peer.close(4321, "theirs");
    expect({ afterServerReadClose, events: await closed }).toEqual({
      afterServerReadClose: { readyState: WebSocket.CLOSING, events: [] },
      events: [{ code: 4321, reason: "theirs", wasClean: true }],
    });
    await peer.closed;
    expect(seen(peer)).toEqual(['close 1000 "mine"', "end", "close"]);
  });

  it.each([
    // Without a code, the Close frame has no payload. Receiving one like that reports 1005 ("no status received").
    ["close()", (ws: WebSocket) => ws.close(), "close", undefined, 1005],
    ["close(1000)", (ws: WebSocket) => ws.close(1000), "close 1000", 1000, 1000],
    ["close(3001, 'bye')", (ws: WebSocket) => ws.close(3001, "bye"), 'close 3001 "bye"', undefined, 1005],
    // A reason without a code is sent with 1000.
    ["close(undefined, 'r')", (ws: WebSocket) => ws.close(undefined, "r"), 'close 1000 "r"', 1000, 1000],
  ] as const)("%s sends exactly that code and reason", async (_label, act, sent, reply, code) => {
    await using server = await startPeer();
    const ws = new WebSocket(server.url);
    const { closed } = observe(ws);
    ws.onopen = () => act(ws);
    const peer = await server.connection();
    await peer.next();
    peer.close(reply);
    expect(await closed).toEqual([{ code, reason: "", wasClean: true }]);
    await peer.closed;
    expect(seen(peer)).toEqual([sent, "end", "close"]);
  });

  it.each([
    [1000, "done", 'close 1000 "done"', { code: 1000, reason: "done", wasClean: true }],
    [1001, "away", 'close 1001 "away"', { code: 1001, reason: "away", wasClean: true }],
    // 1012-1014 are IANA-registered and legal on the wire.
    [1014, undefined, "close 1014", { code: 1014, reason: "", wasClean: true }],
    [undefined, undefined, "close", { code: 1005, reason: "", wasClean: true }],
  ] as const)("echoes the server's Close frame unchanged: %#", async (code, reason, echo, event) => {
    await using server = await startPeer();
    const { closed } = observe(new WebSocket(server.url));
    const peer = await server.connection();
    peer.close(code, reason);
    expect(await closed).toEqual([event]);
    await peer.closed;
    // Once the echo is sent, both Close frames have been exchanged, so the FIN follows immediately.
    expect(seen(peer)).toEqual([echo, "end", "close"]);
  });

  it("close() reports 1006 when the server resets the connection without a Close frame", async () => {
    await using server = await startPeer();
    const ws = new WebSocket(server.url);
    const { closed } = observe(ws);
    ws.onopen = () => ws.close(1000);
    const peer = await server.connection();
    await peer.next();
    peer.reset();
    expect(await closed).toEqual([{ code: 1006, reason: "", wasClean: false }]);
  });

  it("terminate() closes the connection like socket.destroy(): data already sent still arrives", async () => {
    await using server = await startPeer({ paused: true });
    const ws = new WebSocket(server.url);
    const { closed } = observe(ws);
    await opened(ws);
    ws.send("one");
    ws.send("three");
    ws.terminate();
    expect(await closed).toEqual([{ code: 1006, reason: "", wasClean: false }]);
    const peer = await server.connection();
    peer.socket.resume();
    await peer.closed;
    expect(seen(peer)).toEqual(['text "one"', 'text "three"', "end", "close"]);
  });

  // The server doesn't read until the client has called close(). After that it replies to every chunk
  // with a frame of its own, like a chat or a ticker, and closes after the client's Close frame.
  it("delivers everything sent before close() to a server that keeps sending", async () => {
    await using server = await startPeer({ paused: true });
    const ws = new WebSocket(server.url);
    const { closed } = observe(ws);
    await opened(ws);
    const message = Buffer.alloc(65536, "M").toString();
    for (let i = 0; i < 8; i++) ws.send(message);
    ws.close(1000, "bye");

    const peer = await server.connection();
    peer.socket.on("data", () => {
      if (!peer.socket.writable) return;
      if (peer.frames.at(-1)?.opcode === OP.close) peer.socket.end(peer.frame(OP.close, closePayload(1000)));
      else peer.text("tick");
    });
    peer.text("tick");
    peer.socket.resume();

    expect(await closed).toEqual([{ code: 1000, reason: "", wasClean: true }]);
    await peer.closed;
    expect(seen(peer)).toEqual([...Array(8).fill("text 65536 bytes"), 'close 1000 "bye"', "end", "close"]);
  });

  it("after close(), reads and drops frames until the server's Close frame, then sends a FIN", async () => {
    await using server = await startPeer();
    const ws = new WebSocket(server.url);
    const { closed } = observe(ws);
    ws.onopen = () => ws.close(1000);
    const peer = await server.connection();
    await peer.next();
    await roundTrip();
    const beforeReply = seen(peer);
    peer.write(
      Buffer.concat([
        peer.frame(OP.text, "late"),
        peer.frame(OP.ping),
        peer.frame(OP.binary, Buffer.alloc(70000, "A")),
        peer.frame(OP.close, closePayload(1000)),
      ]),
    );
    expect(await closed).toEqual([{ code: 1000, reason: "", wasClean: true }]);
    await peer.closed;
    // No Pong either. Nothing may be sent after a Close frame (RFC 6455 section 5.5.1).
    expect({ beforeReply, afterReply: seen(peer) }).toEqual({
      beforeReply: ["close 1000"],
      afterReply: ["close 1000", "end", "close"],
    });
  });

  it("sends the Pong before the ping event, so close() in a ping listener isn't followed by a Pong", async () => {
    await using server = await startPeer();
    const ws = new WebSocket(server.url);
    const { closed } = observe(ws);
    ws.addEventListener("ping", () => ws.close(4000, "in ping"));
    const peer = await server.connection();
    peer.ping("hi");
    await peer.nextFrames(2);
    peer.close(4000, "in ping");
    expect(await closed).toEqual([{ code: 4000, reason: "in ping", wasClean: true }]);
    await peer.closed;
    expect(seen(peer)).toEqual(['pong "hi"', 'close 4000 "in ping"', "end", "close"]);
  });

  // RFC 6455 section 7.1.4: "the WebSocket connection is closed" when the underlying connection is closed.
  // That's when the close event fires, same as in Node. On TLS, "end" below is the client's close_notify.
  describe.each(["ws", "wss"] as const)("the close event waits for the connection to close (%s:)", scheme => {
    const secure = scheme === "wss";
    const createClient = (url: string) => new WebSocket(url, { tls: { rejectUnauthorized: false } });
    const CLOSING = { readyState: WebSocket.CLOSING, events: [] };

    // The client's FIN shows it has read the server's Close frame.
    async function stateAfterHandshake(ws: WebSocket, events: Observed[], peer: RawSocket) {
      await peer.ended;
      await roundTrip();
      return { readyState: ws.readyState, events: [...events] };
    }

    it("stays CLOSING until terminate() when the server echoes close() but keeps the connection open", async () => {
      await using server = await startPeer({ secure, keepOpen: true });
      const ws = createClient(server.url);
      const { events, closed } = observe(ws);
      ws.onopen = () => ws.close(1000, "mine");
      const peer = await server.connection();
      await peer.next();
      peer.close(1000, "theirs");
      expect(await stateAfterHandshake(ws, events, peer)).toEqual(CLOSING);
      ws.terminate();
      expect(await closed).toEqual([{ code: 1000, reason: "theirs", wasClean: true }]);
    });

    it("stays CLOSING until the server's FIN when the server echoes close() and disconnects later", async () => {
      await using server = await startPeer({ secure, keepOpen: true });
      const ws = createClient(server.url);
      const { events, closed } = observe(ws);
      ws.onopen = () => ws.close(1000, "mine");
      const peer = await server.connection();
      await peer.next();
      peer.close(1000, "theirs");
      expect(await stateAfterHandshake(ws, events, peer)).toEqual(CLOSING);
      peer.end();
      expect(await closed).toEqual([{ code: 1000, reason: "theirs", wasClean: true }]);
      await peer.closed;
      expect(seen(peer)).toEqual(['close 1000 "mine"', "end", "close"]);
    });

    it("stays CLOSING until the connection drops when the server sends Close but keeps the connection open", async () => {
      await using server = await startPeer({ secure, keepOpen: true });
      const ws = createClient(server.url);
      const { events, closed } = observe(ws);
      const peer = await server.connection();
      peer.close(1001, "away");
      expect(await stateAfterHandshake(ws, events, peer)).toEqual(CLOSING);
      expect(seen(peer)).toEqual(['close 1001 "away"', "end"]);
      peer.destroy();
      expect(await closed).toEqual([{ code: 1001, reason: "away", wasClean: true }]);
    });

    it("closes cleanly when the server sends Close and ends the connection after the echo", async () => {
      await using server = await startPeer({ secure, keepOpen: true });
      const { closed } = observe(createClient(server.url));
      const peer = await server.connection();
      peer.close(1001, "away");
      await peer.next();
      peer.end();
      expect(await closed).toEqual([{ code: 1001, reason: "away", wasClean: true }]);
      await peer.closed;
      expect(seen(peer)).toEqual(['close 1001 "away"', "end", "close"]);
    });

    it("a protocol error doesn't wait for a server that keeps the connection open", async () => {
      await using server = await startPeer({ secure, keepOpen: true });
      const { closed } = observe(createClient(server.url));
      const peer = await server.connection();
      peer.write(Buffer.from([0x83, 0x00]));
      expect(await closed).toEqual([{ error: "WS_ERR_INVALID_OPCODE" }, { code: 1006, reason: "", wasClean: false }]);
      await peer.ended;
      expect({ seen: seen(peer), ended: peer.socket.writableEnded }).toEqual({
        seen: ["close 1002", "end"],
        ended: false,
      });
    });

    it("a protocol error is reported once when the server ends the connection after the Close frame", async () => {
      await using server = await startPeer({ secure });
      const { events, closed } = observe(createClient(server.url));
      const peer = await server.connection();
      peer.write(Buffer.from([0x83, 0x00]));
      await closed;
      await peer.closed;
      await roundTrip();
      expect(events).toEqual([{ error: "WS_ERR_INVALID_OPCODE" }, { code: 1006, reason: "", wasClean: false }]);
      expect(seen(peer)).toEqual(["close 1002", "end", "close"]);
    });

    it("a FIN on an open connection gets a FIN back and reports 1006 with no error event", async () => {
      await using server = await startPeer({ secure });
      const ws = createClient(server.url);
      const { closed } = observe(ws);
      await opened(ws);
      const peer = await server.connection();
      peer.end();
      expect(await closed).toEqual([{ code: 1006, reason: "", wasClean: false }]);
      await peer.closed;
      expect(seen(peer)).toEqual(["end", "close"]);
    });

    it("stays CLOSING with no FIN when the server never echoes close(), then reports 1006 on disconnect", async () => {
      await using server = await startPeer({ secure });
      const ws = createClient(server.url);
      const { events, closed } = observe(ws);
      ws.onopen = () => ws.close(1000);
      const peer = await server.connection();
      await peer.next();
      await roundTrip();
      expect({ readyState: ws.readyState, events: [...events], seen: seen(peer) }).toEqual({
        ...CLOSING,
        seen: ["close 1000"],
      });
      peer.end();
      expect(await closed).toEqual([{ code: 1006, reason: "", wasClean: false }]);
    });
  });

  // RFC 6455 section 7.1.7, "fail the WebSocket connection": send a Close frame with the reason, don't wait
  // for a reply, fire an error event, and report 1006 because no Close frame was received (section 7.1.5).
  const MASK = [1, 2, 3, 4];
  it.each([
    ["a reserved opcode", [0x83, 0x00], 1002, "WS_ERR_INVALID_OPCODE"],
    ["a continuation frame with nothing to continue", [0x80, 0x00], 1002, "WS_ERR_INVALID_OPCODE"],
    ["a new message inside a fragmented one", [0x01, 0x01, 0x61, 0x81, 0x01, 0x62], 1002, "WS_ERR_INVALID_OPCODE"],
    ["RSV2", [0xa1, 0x00], 1002, "WS_ERR_UNEXPECTED_RSV_2_3"],
    ["RSV3", [0x91, 0x00], 1002, "WS_ERR_UNEXPECTED_RSV_2_3"],
    ["RSV1 without permessage-deflate", [0xc1, 0x01, 0x61], 1002, "WS_ERR_UNEXPECTED_RSV_1"],
    // Section 5.1: "A client MUST close a connection if it detects a masked frame."
    ["a masked text frame", [0x81, 0x81, ...MASK, 0x60], 1002, "WS_ERR_UNEXPECTED_MASK"],
    ["a masked continuation", [0x01, 0x01, 0x61, 0x80, 0x81, ...MASK, 0x63], 1002, "WS_ERR_UNEXPECTED_MASK"],
    ["a masked Ping", [0x89, 0x81, ...MASK, 0x60], 1002, "WS_ERR_UNEXPECTED_MASK"],
    ["a masked Close frame", [0x88, 0x82, ...MASK, 0x02, 0xea], 1002, "WS_ERR_UNEXPECTED_MASK"],
    ["a fragmented Ping", [0x09, 0x00], 1002, "WS_ERR_EXPECTED_FIN"],
    ["a 126-byte Ping", [0x89, 126, 0, 126], 1002, "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH"],
    ["a 1-byte Close frame", [0x88, 0x01, 0x03], 1002, "WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH"],
    // Sections 7.4.1 and 7.4.2: reserved or undefined codes. websocket.test.js covers the other reserved ranges.
    ["close code 1005", [...encodeFrame(OP.close, closePayload(1005))], 1002, "WS_ERR_INVALID_CLOSE_CODE"],
    ["close code 1015", [...encodeFrame(OP.close, closePayload(1015))], 1002, "WS_ERR_INVALID_CLOSE_CODE"],
    ["close code 5000", [...encodeFrame(OP.close, closePayload(5000))], 1002, "WS_ERR_INVALID_CLOSE_CODE"],
    ["close code 65535", [...encodeFrame(OP.close, closePayload(65535))], 1002, "WS_ERR_INVALID_CLOSE_CODE"],
    // Section 7.4.1: 1007 is "data within a message that was not consistent with the type of the message".
    ["a text frame with invalid UTF-8", [0x81, 0x02, 0xc3, 0x28], 1007, "WS_ERR_INVALID_UTF8"],
    ["a close reason with invalid UTF-8", [0x88, 0x04, 0x03, 0xe8, 0xc3, 0x28], 1007, "WS_ERR_INVALID_UTF8"],
    ["a 128 MiB + 1 byte frame", [0x82, 127, 0, 0, 0, 0, 0x08, 0, 0, 1], 1009, "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH"],
    ["a 2^53 byte frame", [0x82, 127, 0, 0x20, 0, 0, 0, 0, 0, 0], 1009, "WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH"],
    ["a 2^64 - 1 byte frame", [0x82, 127, ...Array(8).fill(255)], 1009, "WS_ERR_UNSUPPORTED_DATA_PAYLOAD_LENGTH"],
  ] as const)("%s fails the connection", async (_label, bytes, sent, error) => {
    await using server = await startPeer();
    const { closed } = observe(new WebSocket(server.url));
    const peer = await server.connection();
    peer.write(Buffer.from(bytes));
    expect(await closed).toEqual([{ error }, { code: 1006, reason: "", wasClean: false }]);
    await peer.closed;
    expect(seen(peer)).toEqual([`close ${sent}`, "end", "close"]);
  });

  // Section 5.2 requires the minimal length encoding. Node's WebSocket and the `ws` package accept longer ones too.
  it.each([
    ["0 in 16 bits", [0x81, 126, 0, 0], 0],
    ["0 in 64 bits", [0x81, 127, 0, 0, 0, 0, 0, 0, 0, 0], 0],
    ["0 in 16 bits, in the last fragment", [0x01, 0x02, 0x61, 0x62, 0x80, 126, 0, 0], 2],
  ] as const)("accepts a non-minimal length encoding: %s", async (_label, bytes, length) => {
    await using server = await startPeer();
    const { closed } = observe(new WebSocket(server.url));
    const peer = await server.connection();
    peer.write(Buffer.concat([Buffer.from(bytes), peer.frame(OP.close, closePayload(1000))]));
    expect(await closed).toEqual([`message ${length}`, { code: 1000, reason: "", wasClean: true }]);
  });

  describe("when the server stopped reading", () => {
    const CHUNK = Buffer.alloc(64 * 1024, "x").toString();
    // Winsock may take any write whole, whatever SO_SNDBUF says.
    const CHUNKS = isWindows ? 256 : 16;

    // Opens a client and sends more than the kernel's socket buffer can hold, so some of it stays buffered.
    async function flood(url: string) {
      const ws = new WebSocket(url);
      const observed = observe(ws);
      await opened(ws);
      setSocketOptions(ws, 1, 64 * 1024);
      for (let i = 0; i < CHUNKS; i++) ws.send(CHUNK);
      expect(ws.bufferedAmount).toBeGreaterThan(0);
      return { ws, ...observed };
    }

    async function waitWhileOpen(ws: WebSocket) {
      const deadline = Date.now() + 3000;
      while (ws.readyState === WebSocket.OPEN && Date.now() < deadline) await new Promise(setImmediate);
      return ws.readyState;
    }

    it("the server's Close frame moves it to CLOSING immediately, and nothing is sent after the echo", async () => {
      await using server = await startPeer({ paused: true });
      const { ws, closed } = await flood(server.url);
      const peer = await server.connection();
      peer.close(1000, "bye");
      expect(await waitWhileOpen(ws)).toBe(WebSocket.CLOSING);
      ws.send("late");
      peer.socket.resume();
      expect(await closed).toEqual([{ code: 1000, reason: "bye", wasClean: true }]);
      await peer.closed;
      expect(seen(peer)).toEqual([...Array(CHUNKS).fill("text 65536 bytes"), 'close 1000 "bye"', "end", "close"]);
    });

    it("terminate() after the server's Close frame reports the received code", async () => {
      await using server = await startPeer({ paused: true });
      const { ws, closed } = await flood(server.url);
      (await server.connection()).close(1000, "bye");
      expect(await waitWhileOpen(ws)).toBe(WebSocket.CLOSING);
      ws.terminate();
      expect(await closed).toEqual([{ code: 1000, reason: "bye", wasClean: false }]);
    });

    it("terminate() ends a close() whose Close frame is stuck behind unsent data", async () => {
      await using server = await startPeer({ paused: true });
      const { ws, closed } = await flood(server.url);
      ws.close(1000);
      ws.terminate();
      expect(await closed).toEqual([{ code: 1006, reason: "", wasClean: false }]);
    });
  });

  // Only the pending closing handshake keeps this script alive. The server starts reading after close() returns.
  it("a pending close() keeps the process alive until the server's Close frame arrives", async () => {
    await using server = await startPeer({ paused: true });
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

    const peer = await server.connection();
    peer.socket.resume();
    await peer.nextFrames(33);
    peer.write(Buffer.concat([peer.frame(OP.text, "echo"), peer.frame(OP.close, closePayload(4000, "server"))]));
    for (let read; !(read = await reader.read()).done;) stdout += decoder.decode(read.value, { stream: true });
    await peer.closed;
    expect({ stdout, seen: seen(peer) }).toEqual({
      stdout: "closing\n4000 server true\n",
      seen: [...Array(32).fill('text "msg"'), "close 1000", "end", "close"],
    });
    expect(await client.exited).toBe(0);
  });
});

// RFC 6455 section 7.1.1: the client lets the server close the TCP connection first.
describe.concurrent("wss:// after the closing handshake", () => {
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
});
