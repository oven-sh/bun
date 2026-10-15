// `ws` client close(), terminate() and the closing handshake, tested against a raw TCP peer. See ws-raw-peer.ts.
import { describe, expect, test } from "bun:test";
import {
  closedPort,
  closePayload,
  connectClient,
  createPeer,
  encodeFrame,
  implementations,
  nextEvent,
  OP,
  openClient,
  type Payload,
  recordEvents,
  runScript,
  scriptTimeout,
  show,
  showFrame,
  tryCall,
} from "./ws-raw-peer";

const openEvents = ["upgrade 101 rs=0", "open rs=1"];
const closedBeforeOpen = [
  'error Error "WebSocket was closed before the connection was established" rs=2',
  "close 1006 Buffer() rs=3",
];
const abnormalClose = "close 1006 Buffer() rs=3";
const invalidCode = 'throws TypeError "First argument must be a valid error code number"';
const reasonTooLong = 'throws RangeError "The message must not be greater than 123 bytes"';
type Client = Awaited<ReturnType<typeof openClient>>;
const a = (count: number) => Buffer.alloc(count, "a").toString();
// Adds a `call` label such as `close(1000, "bye")` to each row.
const withCallLabels = <Row extends { args: unknown[] }>(rows: Row[]) =>
  rows.map(row => ({ call: `close(${row.args.map(show).join(", ")})`, ...row }));

describe.each(implementations)("ws client close ($name)", ({ ws: implementation, builtin, specifier }) => {
  const { WebSocket } = implementation;

  describe("close(code, reason) on an open socket", () => {
    // The peer echoes the Close frame, so 'close' reports the code and reason that were sent.
    test.each(
      withCallLabels([
        { args: [], frame: "close", event: "close 1005 Buffer() rs=3" },
        { args: [1000], frame: "close 1000", event: "close 1000 Buffer() rs=3" },
        { args: [1000, "bye"], frame: 'close 1000 "bye"', event: 'close 1000 Buffer("bye") rs=3' },
        { args: [1000, ""], frame: "close 1000", event: "close 1000 Buffer() rs=3" },
        { args: [1000, Buffer.from("buf")], frame: 'close 1000 "buf"', event: 'close 1000 Buffer("buf") rs=3' },
        { args: [1000, new Uint8Array([104, 105])], frame: 'close 1000 "hi"', event: 'close 1000 Buffer("hi") rs=3' },
        {
          args: [1000, new TextEncoder().encode("🙂")],
          frame: 'close 1000 "🙂"',
          event: 'close 1000 Buffer("🙂") rs=3',
        },
        { args: [1000, a(123)], frame: "close 1000 123 bytes", event: "close 1000 Buffer(123 bytes) rs=3" },
        { args: [1000, a(120) + "☃"], frame: "close 1000 123 bytes", event: "close 1000 Buffer(123 bytes) rs=3" },
        { args: [1000.5], frame: "close 1000", event: "close 1000 Buffer() rs=3" },
        { args: [1001], frame: "close 1001", event: "close 1001 Buffer() rs=3" },
        { args: [1003, "bye"], frame: 'close 1003 "bye"', event: 'close 1003 Buffer("bye") rs=3' },
        { args: [1012], frame: "close 1012", event: "close 1012 Buffer() rs=3" },
        { args: [1013], frame: "close 1013", event: "close 1013 Buffer() rs=3" },
        { args: [1014], frame: "close 1014", event: "close 1014 Buffer() rs=3" },
        { args: [3000, "x"], frame: 'close 3000 "x"', event: 'close 3000 Buffer("x") rs=3' },
        { args: [4999], frame: "close 4999", event: "close 4999 Buffer() rs=3" },
        // Without a code the reason is dropped, no matter how long it is.
        { args: [undefined, "reason"], frame: "close", event: "close 1005 Buffer() rs=3" },
        { args: [undefined, a(200)], frame: "close", event: "close 1005 Buffer() rs=3" },
        // A reason without a `length` is treated as empty.
        { args: [1000, 42], frame: "close 1000", event: "close 1000 Buffer() rs=3" },
        { args: [1000, {}], frame: "close 1000", event: "close 1000 Buffer() rs=3" },
      ]),
    )("$call sends $frame", async ({ args, frame, event }) => {
      await using client = await openClient(implementation);
      const { ws, conn, events } = client;
      expect(tryCall(() => ws.close(...(args as [])))).toBe("undefined");
      expect(ws.readyState).toBe(WebSocket.CLOSING);
      const sent = (await conn.nextFrame())!;
      expect(showFrame(sent)).toBe(frame);
      conn.send(OP.close, sent.payload);
      conn.end();
      await client.closed;
      expect(events).toEqual([...openEvents, event]);
      expect(await conn.remainingFrames()).toEqual([]);
    });

    test.each(
      withCallLabels([
        { args: [999], thrown: invalidCode },
        { args: [1004], thrown: invalidCode },
        { args: [1005], thrown: invalidCode },
        { args: [1006], thrown: invalidCode },
        { args: [1015], thrown: invalidCode },
        { args: [1016], thrown: invalidCode },
        { args: [2999], thrown: invalidCode },
        { args: [5000], thrown: invalidCode },
        { args: [65535], thrown: invalidCode },
        { args: [100000], thrown: invalidCode },
        { args: [0], thrown: invalidCode },
        { args: [-1], thrown: invalidCode },
        { args: [NaN], thrown: invalidCode },
        { args: ["1000"], thrown: invalidCode },
        { args: [null], thrown: invalidCode },
        { args: [true], thrown: invalidCode },
        { args: [1000, a(124)], thrown: reasonTooLong },
        { args: [1000, Buffer.alloc(124, "é").toString()], thrown: reasonTooLong },
        { args: [1000, Buffer.alloc(124, "a")], thrown: reasonTooLong },
      ]),
    )("$call throws and sends nothing", async ({ args, thrown }) => {
      await using client = await openClient(implementation);
      const { ws, conn } = client;
      expect(tryCall(() => ws.close(...(args as [])))).toBe(thrown);
      // ws 8.18 leaves the socket CLOSING here, later versions OPEN. Either way no frame was sent.
      ws.terminate();
      expect(await conn.remainingFrames()).toEqual([]);
    });

    test("close(1000, null) throws a TypeError and sends nothing", async () => {
      await using client = await openClient(implementation);
      expect(() => client.ws.close(1000, null as any)).toThrow(TypeError);
      client.ws.terminate();
      expect(await client.conn.remainingFrames()).toEqual([]);
    });
  });

  test("'close' waits for the peer's Close frame and reports the peer's code", async () => {
    await using client = await openClient(implementation);
    const { ws, conn, events } = client;
    ws.close(1000, "mine");
    expect(await conn.next()).toBe('close 1000 "mine"');

    // Messages are still delivered while CLOSING, which also proves the socket hasn't closed yet.
    conn.text("still here");
    await nextEvent(ws, "message");
    expect(events).toEqual([...openEvents, 'message Buffer("still here") text rs=2']);

    conn.close(4001, "theirs");
    conn.end();
    await client.closed;
    expect(events.slice(3)).toEqual(['close 4001 Buffer("theirs") rs=3']);
    await conn.closed;
    expect(conn.socketEvents).toEqual(["end", "close"]);
  });

  describe.each([
    { transport: "ws:", secure: false },
    { transport: "wss:", secure: true },
  ])("after both Close frames, $transport", ({ secure }) => {
    test.each([
      { first: "the client", start: (ws, conn) => (ws.close(1000), conn.close(1000)) },
      { first: "the peer", start: (ws, conn) => conn.close(1000) },
    ] as { first: string; start(ws: Client["ws"], conn: Client["conn"]): void }[])(
      "stays CLOSING after sending FIN until the server closes the connection ($first closes first)",
      async ({ start }) => {
        await using client = await openClient(implementation, { rejectUnauthorized: false }, { secure });
        const { ws, conn, events } = client;
        start(ws, conn);
        await conn.ended;
        expect(conn.socketEvents).toEqual(["end"]);
        expect(ws.readyState).toBe(WebSocket.CLOSING);
        expect(events).toEqual(openEvents);
        conn.end();
        await client.closed;
        expect(events).toEqual([...openEvents, "close 1000 Buffer() rs=3"]);
      },
    );
  });

  // ws added the `closeTimeout` option in 8.19. The version in node_modules hardcodes 30 s.
  describe.skipIf(!builtin)("closeTimeout", () => {
    test.each([
      { first: "the client", start: (ws, conn) => (ws.close(1000, "mine"), conn.close(4001, "theirs")) },
      { first: "the peer", start: (ws, conn) => conn.close(4001, "theirs") },
    ] as { first: string; start(ws: Client["ws"], conn: Client["conn"]): void }[])(
      "emits a clean 'close' with the peer's code if the server never closes the connection ($first closes first)",
      async ({ start }) => {
        await using client = await openClient(implementation, { closeTimeout: 50 } as {});
        const { ws, conn, events } = client;
        const wasClean = new Promise(resolve => ws.addEventListener("close", event => resolve(event.wasClean)));
        start(ws, conn);
        await client.closed;
        expect(events).toEqual([...openEvents, 'close 4001 Buffer("theirs") rs=3']);
        expect(await wasClean).toBe(true);
        await conn.ended;
        expect(conn.socketEvents).toEqual(["end"]);
      },
    );

    test("emits 'close' 1006 with wasClean false if the peer never echoes the Close frame", async () => {
      await using client = await openClient(implementation, { closeTimeout: 50 } as {});
      const { ws, conn, events } = client;
      const wasClean = new Promise(resolve => ws.addEventListener("close", event => resolve(event.wasClean)));
      ws.close(1000);
      await client.closed;
      expect(events).toEqual([...openEvents, "close 1006 Buffer() rs=3"]);
      expect(await wasClean).toBe(false);
      expect(await conn.remainingFrames()).toEqual(["close 1000"]);
    });
  });

  test("messages and pings received after close() are delivered, but the pings aren't answered", async () => {
    await using client = await openClient(implementation);
    const { ws, conn, events } = client;
    ws.close(1000);
    expect(await conn.next()).toBe("close 1000");
    conn.text("late-1");
    conn.text("late-2");
    conn.ping("late-ping");
    conn.close(1000);
    conn.end();
    await client.closed;
    expect(events).toEqual([
      ...openEvents,
      'message Buffer("late-1") text rs=2',
      'message Buffer("late-2") text rs=2',
      'ping Buffer("late-ping") rs=2',
      "close 1000 Buffer() rs=3",
    ]);
    expect(await conn.remainingFrames()).toEqual([]);
  });

  describe("the peer closes first", () => {
    test.each([
      { code: 1000, reason: "", frame: "close 1000", event: "close 1000 Buffer() rs=3" },
      { code: 1000, reason: "bye", frame: 'close 1000 "bye"', event: 'close 1000 Buffer("bye") rs=3' },
      { code: 1001, reason: "away", frame: 'close 1001 "away"', event: 'close 1001 Buffer("away") rs=3' },
      { code: 1011, reason: "err", frame: 'close 1011 "err"', event: 'close 1011 Buffer("err") rs=3' },
      { code: 3999, reason: "é", frame: 'close 3999 "é"', event: 'close 3999 Buffer("é") rs=3' },
      { code: 4000, reason: "custom", frame: 'close 4000 "custom"', event: 'close 4000 Buffer("custom") rs=3' },
      { code: undefined, reason: "", frame: "close", event: "close 1005 Buffer() rs=3" },
    ])("$frame is echoed", async ({ code, reason, frame, event }) => {
      await using client = await openClient(implementation);
      const { conn, events } = client;
      conn.close(code, reason);
      conn.end();
      await client.closed;
      expect(events).toEqual([...openEvents, event]);
      expect(await conn.remainingFrames()).toEqual([frame]);
    });

    test("the reason is a Buffer", async () => {
      await using client = await openClient(implementation);
      const closed = new Promise<unknown[]>(resolve => client.ws.on("close", (...args) => resolve(args)));
      client.conn.close(4000, "héllo");
      client.conn.end();
      expect(await closed).toEqual([4000, Buffer.from("héllo")]);
    });

    test("messages in the same packet as the Close frame are delivered first", async () => {
      await using client = await openClient(implementation);
      const { conn } = client;
      conn.write(
        Buffer.concat([
          conn.frame(OP.text, "a"),
          conn.frame(OP.text, "b"),
          conn.frame(OP.close, closePayload(1000, "done")),
        ]),
      );
      conn.end();
      await client.closed;
      expect(client.events).toEqual([
        ...openEvents,
        'message Buffer("a") text rs=1',
        'message Buffer("b") text rs=1',
        'close 1000 Buffer("done") rs=3',
      ]);
    });

    test("ignores frames after the Close frame", async () => {
      await using client = await openClient(implementation);
      const { conn } = client;
      conn.write(Buffer.concat([conn.frame(OP.close, closePayload(1000)), conn.frame(OP.text, "after")]));
      conn.end();
      await client.closed;
      expect(client.events).toEqual([...openEvents, "close 1000 Buffer() rs=3"]);
    });

    test("close() in the 'close' listener is a no-op", async () => {
      await using client = await openClient(implementation);
      const { ws, conn } = client;
      let result = "";
      ws.on("close", () => (result = tryCall(() => ws.close())));
      conn.close(1000);
      conn.end();
      await client.closed;
      expect(result).toBe("undefined");
      expect(await conn.remainingFrames()).toEqual(["close 1000"]);
    });
  });

  describe("the connection ends without a Close frame", () => {
    test.each([
      { how: "FIN", end: conn => conn.end() },
      { how: "RST", end: conn => conn.reset() },
      {
        how: "FIN in the middle of a frame",
        end: conn => (conn.write(conn.frame(OP.text, "hello").subarray(0, 4)), conn.end()),
      },
    ] as { how: string; end(conn: Client["conn"]): void }[])(
      "$how emits 'close' 1006 without an 'error' and sends nothing",
      async ({ end }) => {
        await using client = await openClient(implementation);
        end(client.conn);
        await client.closed;
        expect(client.events).toEqual([...openEvents, "close 1006 Buffer() rs=3"]);
        expect(await client.conn.remainingFrames()).toEqual([]);
      },
    );
  });

  describe("terminate()", () => {
    test("on an open socket switches to CLOSING immediately, sends FIN without a Close frame and emits 'close' 1006", async () => {
      await using client = await openClient(implementation);
      const { ws, conn, events } = client;
      ws.terminate();
      expect(ws.readyState).toBe(WebSocket.CLOSING);
      expect(events).toEqual(openEvents);
      await client.closed;
      expect(events).toEqual([...openEvents, "close 1006 Buffer() rs=3"]);
      expect(await conn.remainingFrames()).toEqual([]);
      expect(conn.socketEvents).toEqual(["end"]);
    });

    // Data already buffered in the socket is still parsed, but nothing is sent in reply: no Pong, no Close frame.
    describe("in the 'open' listener, with frames that arrived with the 101", () => {
      test.each<{ buffered: string; frames: [opcode: number, payload?: Payload][]; end?: number; events: string[] }>([
        {
          buffered: "a message and a Close frame",
          frames: [
            [OP.text, "one"],
            [OP.close, closePayload(1000, "bye")],
          ],
          events: ['message Buffer("one") text rs=2', 'close 1000 Buffer("bye") rs=3'],
        },
        {
          buffered: "a Close frame",
          frames: [[OP.close, closePayload(1000, "bye")]],
          events: ['close 1000 Buffer("bye") rs=3'],
        },
        {
          buffered: "a message",
          frames: [[OP.text, "one"]],
          events: ['message Buffer("one") text rs=2', abnormalClose],
        },
        {
          buffered: "two messages",
          frames: [
            [OP.text, "one"],
            [OP.binary, "two"],
          ],
          events: ['message Buffer("one") text rs=2', 'message Buffer("two") binary rs=2', abnormalClose],
        },
        {
          buffered: "a Ping and a message",
          frames: [
            [OP.ping, "p"],
            [OP.text, "one"],
          ],
          events: ['ping Buffer("p") rs=2', 'message Buffer("one") text rs=2', abnormalClose],
        },
        { buffered: "a truncated message", frames: [[OP.text, "one"]], end: -1, events: [abnormalClose] },
        {
          buffered: "an invalid frame",
          frames: [[3, "x"]],
          events: [
            'error RangeError "Invalid WebSocket frame: invalid opcode 3" WS_ERR_INVALID_OPCODE rs=2',
            abnormalClose,
          ],
        },
      ])("$buffered", async ({ frames, end, events }) => {
        const buffered = Buffer.concat(frames.map(frame => encodeFrame(...frame))).subarray(0, end);
        await using client = await connectClient(implementation, {}, { afterUpgrade: buffered });
        const { ws } = client;
        ws.on("open", () => ws.terminate());
        await client.closed;
        expect(client.events).toEqual([...openEvents, ...events]);
        expect(await (await client.peer.connection()).remainingFrames()).toEqual([]);
      });

      test("wasClean is false when the peer's Close frame was never echoed", async () => {
        const buffered = encodeFrame(OP.close, closePayload(1000, "bye"));
        await using client = await connectClient(implementation, {}, { afterUpgrade: buffered });
        const { ws } = client;
        ws.on("open", () => ws.terminate());
        const [{ code, reason, wasClean }] = await new Promise<[CloseEvent]>(resolve =>
          ws.addEventListener("close", event => resolve([event as unknown as CloseEvent])),
        );
        expect({ code, reason, wasClean }).toEqual({ code: 1000, reason: "bye", wasClean: false });
      });
    });

    test("after close() emits 'close' 1006, not the code passed to close()", async () => {
      await using client = await openClient(implementation);
      const { ws, conn, events } = client;
      ws.close(1000);
      ws.terminate();
      expect(ws.readyState).toBe(WebSocket.CLOSING);
      await client.closed;
      expect(events).toEqual([...openEvents, "close 1006 Buffer() rs=3"]);
      expect(await conn.remainingFrames()).toEqual(["close 1000"]);
      expect(conn.socketEvents).toEqual(["end"]);
    });

    test("a second terminate(), and close() or terminate() on a CLOSED socket, are no-ops", async () => {
      await using client = await openClient(implementation);
      const { ws, events } = client;
      ws.terminate();
      ws.terminate();
      await client.closed;
      expect([() => ws.terminate(), () => ws.close(), () => ws.close(999)].map(tryCall)).toEqual([
        "undefined",
        "undefined",
        "undefined",
      ]);
      const error = await new Promise<Error | undefined>(resolve => ws.send("x", resolve));
      expect(error?.message).toBe("WebSocket is not open: readyState 3 (CLOSED)");
      expect(events).toEqual([...openEvents, "close 1006 Buffer() rs=3"]);
    });
  });

  test("a second close() is ignored and its arguments aren't validated", async () => {
    await using client = await openClient(implementation);
    const { ws, conn, events } = client;
    ws.close(1000, "first");
    ws.close(4000, "second");
    expect(tryCall(() => ws.close(999))).toBe("undefined");
    conn.close(1000);
    conn.end();
    await client.closed;
    expect(await conn.remainingFrames()).toEqual(['close 1000 "first"']);
    expect(events).toEqual([...openEvents, "close 1000 Buffer() rs=3"]);
  });

  test("queued messages are sent before the Close frame", async () => {
    await using client = await openClient(implementation, { perMessageDeflate: false });
    const { ws, conn } = client;
    for (let i = 0; i < 5; i++) ws.send("m" + i);
    ws.close(1000);
    expect(await conn.nextFrames(6)).toEqual([
      'text "m0"',
      'text "m1"',
      'text "m2"',
      'text "m3"',
      'text "m4"',
      "close 1000",
    ]);
  });

  test("close() in the 'open' listener", async () => {
    await using client = await connectClient(implementation);
    const { ws, events } = client;
    ws.prependListener("open", () => ws.close(1000, "x"));
    const conn = await client.peer.connection();
    expect(await conn.next()).toBe('close 1000 "x"');
    conn.close(1000, "x");
    conn.end();
    await client.closed;
    expect(events).toEqual(["upgrade 101 rs=0", "open rs=2", 'close 1000 Buffer("x") rs=3']);
  });

  describe("before the connection is open", () => {
    // The code isn't validated, because no Close frame is sent.
    test.each([
      { call: "close()", act: ws => ws.close() },
      { call: "close(1000)", act: ws => ws.close(1000) },
      { call: "close(999)", act: ws => ws.close(999) },
      { call: "terminate()", act: ws => ws.terminate() },
    ] as { call: string; act(ws: Client["ws"]): void }[])(
      "$call before the server responds switches to CLOSING immediately, then emits 'error' and 'close' 1006",
      async ({ act }) => {
        await using client = await connectClient(implementation, {}, { respond: () => null });
        const { ws, events } = client;
        const conn = await client.peer.connection();
        expect(tryCall(() => act(ws))).toBe("undefined");
        expect(ws.readyState).toBe(WebSocket.CLOSING);
        expect(events).toEqual([]);
        await client.closed;
        expect(events).toEqual(closedBeforeOpen);
        expect(await conn.remainingFrames()).toEqual([]);
      },
    );

    test("close() right after the constructor sends no request", async () => {
      await using client = await connectClient(implementation);
      client.ws.close();
      expect(client.ws.readyState).toBe(WebSocket.CLOSING);
      await client.closed;
      expect(client.events).toEqual(closedBeforeOpen);
      // A second client connects after the first one closed. Its request is the only one the server reads.
      const second = new WebSocket(client.peer.url + "/second");
      try {
        expect((await client.peer.connection()).headLines[0]).toBe("GET /second HTTP/1.1");
      } finally {
        second.on("error", () => {}).terminate();
      }
    });

    test.each([
      { call: "close()", act: ws => ws.close() },
      { call: "terminate()", act: ws => ws.terminate() },
    ] as { call: string; act(ws: Client["ws"]): void }[])(
      "$call in the 'upgrade' listener skips 'open' and drops frames that arrived with the 101",
      async ({ act }) => {
        const buffered = Buffer.concat([encodeFrame(OP.text, "one"), encodeFrame(OP.close, closePayload(1000, "bye"))]);
        await using client = await connectClient(implementation, {}, { afterUpgrade: buffered });
        client.ws.prependListener("upgrade", () => act(client.ws));
        await client.closed;
        expect(client.events).toEqual(["upgrade 101 rs=2", ...closedBeforeOpen]);
      },
    );

    test("close() and terminate() are no-ops in the 'error' listener of a refused connection", async () => {
      const ws = new WebSocket("ws://127.0.0.1:" + (await closedPort()));
      const calls: string[] = [];
      ws.on("error", () =>
        calls.push(
          tryCall(() => ws.close()),
          tryCall(() => ws.terminate()),
        ),
      );
      const events = recordEvents(ws);
      await new Promise(resolve => ws.on("close", resolve));
      expect(calls).toEqual(["undefined", "undefined"]);
      expect(events).toEqual([
        'error Error "connect ECONNREFUSED 127.0.0.1:PORT" ECONNREFUSED rs=2',
        "close 1006 Buffer() rs=3",
      ]);
    });
  });

  describe("CloseEvent", () => {
    const describeEvent = (event: any, ws: unknown) => ({
      class: event.constructor.name,
      type: event.type,
      code: event.code,
      reason: event.reason,
      wasClean: event.wasClean,
      target: event.target === ws,
    });

    test("after a closing handshake has the peer's code, a string reason and wasClean true", async () => {
      await using client = await openClient(implementation);
      const { ws, conn } = client;
      const seen: unknown[] = [];
      ws.addEventListener("close", event => seen.push(describeEvent(event, ws)));
      ws.onclose = event => seen.push(describeEvent(event, ws));
      conn.close(4000, "why");
      conn.end();
      await client.closed;
      const event = { class: "CloseEvent", type: "close", code: 4000, reason: "why", wasClean: true, target: true };
      expect(seen).toEqual([event, event]);
    });

    test("after a dropped connection has code 1006 and wasClean false", async () => {
      await using client = await openClient(implementation);
      const seen: unknown[] = [];
      client.ws.addEventListener("close", event => seen.push(describeEvent(event, client.ws)));
      client.conn.destroy();
      await client.closed;
      expect(seen).toEqual([
        { class: "CloseEvent", type: "close", code: 1006, reason: "", wasClean: false, target: true },
      ]);
    });
  });

  // npm ws sends the bytes unchanged. The native close() takes a string, so the built-in sends U+FFFD instead.
  test.skipIf(builtin)("a reason that isn't valid UTF-8 is sent unchanged", async () => {
    await using client = await openClient(implementation);
    client.ws.close(1000, Buffer.from([0xff]));
    expect(await client.conn.next()).toBe("close 1000 0xff");
  });

  // Each of the 100 bytes becomes U+FFFD, which is 3 bytes in UTF-8.
  test.skipIf(!builtin)(
    "close() throws and the socket stays OPEN when the reason is too long once converted to UTF-8",
    async () => {
      await using client = await openClient(implementation);
      const { ws, conn } = client;
      expect(tryCall(() => ws.close(1000, Buffer.alloc(100, 0xff)))).toBe(reasonTooLong);
      expect(ws.readyState).toBe(WebSocket.OPEN);
      expect(await conn.roundTrip()).toEqual([]);
      ws.close(1000, "bye");
      expect(await conn.next()).toBe('close 1000 "bye"');
    },
  );

  // The global WebSocket has its own closing handshake timeout, so it serves as the clock. It calls close() after the
  // `ws` socket does, so it times out later. Once it has, a third client connects to the peer, and the `ws` socket must
  // still be CLOSING at that point.
  test.concurrent.each([
    { waits: "for the peer's Close frame", answered: false },
    { waits: "for the connection to close after both Close frames", answered: true },
  ])(
    "waiting $waits uses `closeTimeout`, not the global WebSocket's shorter timeout",
    async ({ answered }) => {
      await using peer = await createPeer();
      const script = `
        const ws = new WebSocket(process.env.PEER_URL + "/ws");
        ws.on("close", (code, reason) => console.log("close", code, show(reason)));
        ws.on("open", () => {
          ws.close(1000);
          const clock = new globalThis.WebSocket(process.env.PEER_URL + "/clock");
          clock.onopen = () => clock.close(1000);
          clock.onclose = event => {
            console.log("the global WebSocket gave up", event.code);
            const probe = new WebSocket(process.env.PEER_URL + "/probe");
            probe.on("open", () => {
              console.log("readyState", ws.readyState);
              probe.terminate();
            });
          };
        });
      `;
      const child = runScript({ specifier }, script, { PEER_URL: peer.url, BUN_CONFIG_WS_CLOSE_TIMEOUT: "1" });
      const conn = await peer.connection();
      expect(await conn.next()).toBe("close 1000");
      if (answered) conn.close(1000, "late");
      await peer.connection();
      const probe = await peer.connection();
      await probe.ended;
      if (!answered) conn.close(1000, "late");
      conn.end();
      expect((await child).lines).toEqual([
        "the global WebSocket gave up 1006",
        "readyState 2",
        'close 1000 Buffer("late")',
      ]);
    },
    scriptTimeout,
  );
});
