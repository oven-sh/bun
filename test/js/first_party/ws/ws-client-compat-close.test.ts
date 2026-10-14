// close(), terminate() and the closing handshake of a `ws` client, against a raw TCP peer. See ws-raw-peer.ts.
import { describe, expect, test } from "bun:test";
import {
  attempt,
  closedPort,
  closePayload,
  createPeer,
  dial,
  event,
  implementations,
  OP,
  openClient,
  runScript,
  scriptTimeout,
  show,
  showFrame,
  watch,
} from "./ws-raw-peer";

const opening = ["upgrade 101 rs=0", "open rs=1"];
const closedBeforeOpen = [
  'error Error "WebSocket was closed before the connection was established" rs=2',
  "close 1006 Buffer() rs=3",
];
const invalidCode = 'throws TypeError "First argument must be a valid error code number"';
const reasonTooLong = 'throws RangeError "The message must not be greater than 123 bytes"';
type Client = Awaited<ReturnType<typeof openClient>>;
const a = (count: number) => Buffer.alloc(count, "a").toString();
// Gives each row of a table of close() arguments its name.
const calls = <Row extends { args: unknown[] }>(rows: Row[]) =>
  rows.map(row => ({ call: `close(${row.args.map(show).join(", ")})`, ...row }));

describe.each(implementations)("ws client, closing ($name)", ({ ws: implementation, builtin, specifier }) => {
  const { WebSocket } = implementation;

  describe("close(code, reason) on an open socket", () => {
    // The peer echoes the Close frame, so 'close' reports what went out.
    test.each(
      calls([
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
        // Without a code the reason is dropped, whatever its length.
        { args: [undefined, "reason"], frame: "close", event: "close 1005 Buffer() rs=3" },
        { args: [undefined, a(200)], frame: "close", event: "close 1005 Buffer() rs=3" },
        // A reason with no `length` counts as no reason.
        { args: [1000, 42], frame: "close 1000", event: "close 1000 Buffer() rs=3" },
        { args: [1000, {}], frame: "close 1000", event: "close 1000 Buffer() rs=3" },
      ]),
    )("$call sends $frame", async ({ args, frame, event }) => {
      await using client = await openClient(implementation);
      const { ws, conn, events } = client;
      expect(attempt(() => ws.close(...(args as [])))).toBe("undefined");
      expect(ws.readyState).toBe(WebSocket.CLOSING);
      const sent = (await conn.nextFrame())!;
      expect(showFrame(sent)).toBe(frame);
      conn.send(OP.close, sent.payload);
      conn.end();
      await client.closed;
      expect(events).toEqual([...opening, event]);
      expect(await conn.rest()).toEqual([]);
    });

    test.each(
      calls([
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
      expect(attempt(() => ws.close(...(args as [])))).toBe(thrown);
      // ws 8.18 leaves the socket CLOSING here, later versions OPEN. Either way no frame went out.
      ws.terminate();
      expect(await conn.rest()).toEqual([]);
    });

    test("close(1000, null) throws a TypeError and sends nothing", async () => {
      await using client = await openClient(implementation);
      expect(() => client.ws.close(1000, null as any)).toThrow(TypeError);
      client.ws.terminate();
      expect(await client.conn.rest()).toEqual([]);
    });
  });

  test("'close' waits for the peer's Close frame and reports the peer's code", async () => {
    await using client = await openClient(implementation);
    const { ws, conn, events } = client;
    ws.close(1000, "mine");
    expect(await conn.next()).toBe('close 1000 "mine"');

    // A message is still delivered, which also shows that nothing closed the socket in the meantime.
    conn.text("still here");
    await event(ws, "message");
    expect(events).toEqual([...opening, 'message Buffer("still here") text rs=2']);

    conn.close(4001, "theirs");
    conn.end();
    await client.closed;
    expect(events.slice(3)).toEqual(['close 4001 Buffer("theirs") rs=3']);
    await conn.closed;
    expect(conn.tcp).toEqual(["end", "close"]);
  });

  test.each([
    { first: "the client", start: (ws, conn) => (ws.close(1000), conn.close(1000)) },
    { first: "the peer", start: (ws, conn) => conn.close(1000) },
  ] as { first: string; start(ws: Client["ws"], conn: Client["conn"]): void }[])(
    `$first closes first: after both Close frames the client sends FIN and ${
      builtin ? "emits 'close'" : "stays CLOSING until the server's FIN"
    }`,
    async ({ start }) => {
      await using client = await openClient(implementation);
      const { ws, conn, events } = client;
      start(ws, conn);
      await conn.ended;
      expect(conn.tcp).toEqual(["end"]);
      // The built-in does not wait for the server to end the connection.
      if (!builtin) {
        expect(ws.readyState).toBe(WebSocket.CLOSING);
        expect(events).toEqual(opening);
        conn.end();
      }
      await client.closed;
      expect(events).toEqual([...opening, "close 1000 Buffer() rs=3"]);
    },
  );

  test("messages and pings that arrive after close() are delivered, and no Pong goes out", async () => {
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
      ...opening,
      'message Buffer("late-1") text rs=2',
      'message Buffer("late-2") text rs=2',
      'ping Buffer("late-ping") rs=2',
      "close 1000 Buffer() rs=3",
    ]);
    expect(await conn.rest()).toEqual([]);
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
      expect(events).toEqual([...opening, event]);
      expect(await conn.rest()).toEqual([frame]);
    });

    test("the reason is a Buffer", async () => {
      await using client = await openClient(implementation);
      const closed = new Promise<unknown[]>(resolve => client.ws.on("close", (...args) => resolve(args)));
      client.conn.close(4000, "héllo");
      client.conn.end();
      expect(await closed).toEqual([4000, Buffer.from("héllo")]);
    });

    test("messages in the same packet as the Close frame come first", async () => {
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
        ...opening,
        'message Buffer("a") text rs=1',
        'message Buffer("b") text rs=1',
        'close 1000 Buffer("done") rs=3',
      ]);
    });

    test("what follows the Close frame is ignored", async () => {
      await using client = await openClient(implementation);
      const { conn } = client;
      conn.write(Buffer.concat([conn.frame(OP.close, closePayload(1000)), conn.frame(OP.text, "after")]));
      conn.end();
      await client.closed;
      expect(client.events).toEqual([...opening, "close 1000 Buffer() rs=3"]);
    });

    test("close() in the 'close' listener does nothing", async () => {
      await using client = await openClient(implementation);
      const { ws, conn } = client;
      let result = "";
      ws.on("close", () => (result = attempt(() => ws.close())));
      conn.close(1000);
      conn.end();
      await client.closed;
      expect(result).toBe("undefined");
      expect(await conn.rest()).toEqual(["close 1000"]);
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
      "$how: 'close' 1006, no 'error', nothing sent",
      async ({ end }) => {
        await using client = await openClient(implementation);
        end(client.conn);
        await client.closed;
        expect(client.events).toEqual([...opening, "close 1006 Buffer() rs=3"]);
        expect(await client.conn.rest()).toEqual([]);
      },
    );
  });

  describe("terminate()", () => {
    test("on an open socket: CLOSING at once, FIN without a Close frame, 'close' 1006", async () => {
      await using client = await openClient(implementation);
      const { ws, conn, events } = client;
      ws.terminate();
      expect(ws.readyState).toBe(WebSocket.CLOSING);
      expect(events).toEqual(opening);
      await client.closed;
      expect(events).toEqual([...opening, "close 1006 Buffer() rs=3"]);
      expect(await conn.rest()).toEqual([]);
      expect(conn.tcp).toEqual(["end"]);
    });

    test("after close(): 'close' 1006, not the code of close()", async () => {
      await using client = await openClient(implementation);
      const { ws, conn, events } = client;
      ws.close(1000);
      ws.terminate();
      expect(ws.readyState).toBe(WebSocket.CLOSING);
      await client.closed;
      expect(events).toEqual([...opening, "close 1006 Buffer() rs=3"]);
      expect(await conn.rest()).toEqual(["close 1000"]);
      expect(conn.tcp).toEqual(["end"]);
    });

    test("twice, and every closing call on a CLOSED socket, do nothing", async () => {
      await using client = await openClient(implementation);
      const { ws, events } = client;
      ws.terminate();
      ws.terminate();
      await client.closed;
      expect([() => ws.terminate(), () => ws.close(), () => ws.close(999)].map(attempt)).toEqual([
        "undefined",
        "undefined",
        "undefined",
      ]);
      const error = await new Promise<Error | undefined>(resolve => ws.send("x", resolve));
      expect(error?.message).toBe("WebSocket is not open: readyState 3 (CLOSED)");
      expect(events).toEqual([...opening, "close 1006 Buffer() rs=3"]);
    });
  });

  test("a second close() is ignored, arguments and all", async () => {
    await using client = await openClient(implementation);
    const { ws, conn, events } = client;
    ws.close(1000, "first");
    ws.close(4000, "second");
    expect(attempt(() => ws.close(999))).toBe("undefined");
    conn.close(1000);
    conn.end();
    await client.closed;
    expect(await conn.rest()).toEqual(['close 1000 "first"']);
    expect(events).toEqual([...opening, "close 1000 Buffer() rs=3"]);
  });

  test("what send() queued goes out before the Close frame", async () => {
    await using client = await openClient(implementation, { perMessageDeflate: false });
    const { ws, conn } = client;
    for (let i = 0; i < 5; i++) ws.send("m" + i);
    ws.close(1000);
    expect(await conn.take(6)).toEqual(['text "m0"', 'text "m1"', 'text "m2"', 'text "m3"', 'text "m4"', "close 1000"]);
  });

  test("close() in the 'open' listener", async () => {
    await using client = await dial(implementation);
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
    // The code is not looked at: there is no frame to put it in.
    test.each([
      { call: "close()", act: ws => ws.close() },
      { call: "close(1000)", act: ws => ws.close(1000) },
      { call: "close(999)", act: ws => ws.close(999) },
      { call: "terminate()", act: ws => ws.terminate() },
    ] as { call: string; act(ws: Client["ws"]): void }[])(
      "$call while the server has not answered: CLOSING at once, then 'error' and 'close' 1006",
      async ({ act }) => {
        await using client = await dial(implementation, {}, { respond: () => null });
        const { ws, events } = client;
        const conn = await client.peer.connection();
        expect(attempt(() => act(ws))).toBe("undefined");
        expect(ws.readyState).toBe(WebSocket.CLOSING);
        expect(events).toEqual([]);
        await client.closed;
        expect(events).toEqual(closedBeforeOpen);
        expect(await conn.rest()).toEqual([]);
      },
    );

    test("close() right after the constructor: no request reaches the server", async () => {
      await using client = await dial(implementation);
      client.ws.close();
      expect(client.ws.readyState).toBe(WebSocket.CLOSING);
      await client.closed;
      expect(client.events).toEqual(closedBeforeOpen);
      // A second client dials after the first one gave up. Its request is the only one the server reads.
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
      "$call in the 'upgrade' listener: no 'open'",
      async ({ act }) => {
        await using client = await dial(implementation);
        client.ws.prependListener("upgrade", () => act(client.ws));
        await client.closed;
        expect(client.events).toEqual(["upgrade 101 rs=2", ...closedBeforeOpen]);
      },
    );

    test("close() and terminate() in the 'error' listener of a refused connection do nothing", async () => {
      const ws = new WebSocket("ws://127.0.0.1:" + (await closedPort()));
      const calls: string[] = [];
      ws.on("error", () =>
        calls.push(
          attempt(() => ws.close()),
          attempt(() => ws.terminate()),
        ),
      );
      const events = watch(ws);
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

    test("after a closing handshake: the peer's code, the reason as a string, clean", async () => {
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

    test("after a lost connection: 1006, not clean", async () => {
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

  // npm ws sends the bytes as they are. The native close() takes a string, so the built-in sends U+FFFD.
  test.skipIf(builtin)("a reason that is not UTF-8 goes out as it is", async () => {
    await using client = await openClient(implementation);
    client.ws.close(1000, Buffer.from([0xff]));
    expect(await client.conn.next()).toBe("close 1000 0xff");
  });

  // Each of the 100 bytes becomes U+FFFD, which is three.
  test.skipIf(!builtin)("a reason that is too long once it is UTF-8 throws, and the socket stays open", async () => {
    await using client = await openClient(implementation);
    const { ws, conn } = client;
    expect(attempt(() => ws.close(1000, Buffer.alloc(100, 0xff)))).toBe(reasonTooLong);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(await conn.roundTrip()).toEqual([]);
    ws.close(1000, "bye");
    expect(await conn.next()).toBe('close 1000 "bye"');
  });

  // The global WebSocket gives up on a closing handshake by itself. It is the clock here: it closes after the `ws`
  // socket, so its time is up later.
  test.concurrent(
    "'close' waits for the peer as long as `closeTimeout` says, longer than the global WebSocket does",
    async () => {
      await using peer = await createPeer();
      const script = `
        const ws = new WebSocket(process.env.PEER_URL + "/ws");
        ws.on("close", (code, reason) => console.log("close", code, show(reason)));
        ws.on("open", () => {
          ws.close(1000);
          const clock = new globalThis.WebSocket(process.env.PEER_URL + "/clock");
          clock.onopen = () => clock.close(1000);
          clock.onclose = event => console.log("the global WebSocket gave up", event.code, "readyState", ws.readyState);
        });
      `;
      const child = runScript({ specifier }, script, { PEER_URL: peer.url, BUN_CONFIG_WS_CLOSE_TIMEOUT: "1" });
      const conn = await peer.connection();
      const clock = await peer.connection();
      await clock.ended;
      conn.close(1000, "late");
      conn.end();
      expect((await child).lines).toEqual([
        "the global WebSocket gave up 1006 readyState 2",
        'close 1000 Buffer("late")',
      ]);
    },
    scriptTimeout,
  );
});
