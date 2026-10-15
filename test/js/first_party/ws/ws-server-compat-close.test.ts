// close(), terminate() and the closing handshake of a `ws` server socket, wss.close() and wss.clients, against a raw
// TCP client. See ws-raw-peer.ts.
import { describe, expect, test } from "bun:test";
import { tls as certificate, isWindows } from "harness";
import http from "node:http";
import https from "node:https";
import type { WebSocket as WsSocket } from "ws";
import {
  attempt,
  closePayload,
  createServer,
  encodeFrame,
  event,
  implementations,
  OP,
  openServer,
  type Payload,
  RawClient,
  serve,
  show,
  showError,
  showFrame,
  watch,
} from "./ws-raw-peer";

const lost = "close 1006 Buffer() rs=3";
const invalidCode = 'throws TypeError "First argument must be a valid error code number"';
const reasonTooLong = 'throws RangeError "The message must not be greater than 123 bytes"';
const a = (count: number) => Buffer.alloc(count, "a").toString();
// Gives each row of a table of close() arguments its name.
const calls = <Row extends { args: unknown[] }>(rows: Row[]) =>
  rows.map(row => ({ call: `close(${row.args.map(show).join(", ")})`, ...row }));
const sendResult = (ws: WsSocket, data: string | Buffer) =>
  new Promise<string>(resolve => ws.send(data, error => resolve(error ? showError(error) : "ok")));

describe.each(implementations)("ws server, closing ($name)", ({ ws: implementation, builtin }) => {
  const { WebSocket, WebSocketServer } = implementation;

  describe("close(code, reason) on an open socket", () => {
    // The client echoes the Close frame, so 'close' reports what went out.
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
      await using server = await openServer(implementation);
      const { ws, client, events } = server;
      expect(attempt(() => ws.close(...(args as [])))).toBe("undefined");
      expect(ws.readyState).toBe(WebSocket.CLOSING);
      const sent = (await client.nextFrame())!;
      expect(showFrame(sent)).toBe(frame);
      client.send(OP.close, sent.payload);
      await server.closed;
      expect(events).toEqual([event]);
      expect(await client.rest()).toEqual([]);
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
      await using server = await openServer(implementation);
      const { ws, client } = server;
      expect(attempt(() => ws.close(...(args as [])))).toBe(thrown);
      // ws 8.18 leaves the socket CLOSING here, later versions OPEN. Either way no frame went out.
      ws.terminate();
      expect(await client.rest()).toEqual([]);
    });

    test("close(1000, null) throws a TypeError and sends nothing", async () => {
      await using server = await openServer(implementation);
      expect(() => server.ws.close(1000, null as any)).toThrow(TypeError);
      server.ws.terminate();
      expect(await server.client.rest()).toEqual([]);
    });
  });

  test("'close' waits for the peer's Close frame and reports the peer's code", async () => {
    await using server = await openServer(implementation);
    const { ws, client, events } = server;
    ws.close(4000, "mine");
    expect(await client.next()).toBe('close 4000 "mine"');

    // A message is still delivered, which also shows that nothing closed the socket in the meantime.
    client.text("still here");
    await event(ws, "message");
    expect(events).toEqual(['message Buffer("still here") text rs=2']);

    client.close(4444, "theirs");
    await server.closed;
    expect(events.slice(1)).toEqual(['close 4444 Buffer("theirs") rs=3']);
    await client.closed;
    expect(client.tcp).toEqual(["end", "close"]);
  });

  test("after both Close frames the server sends FIN, and 'close' waits for the client's", async () => {
    await using server = await openServer(implementation, {}, { allowHalfOpen: true });
    const { ws, client, events } = server;
    ws.close(1000);
    client.close(1000);
    await client.ended;
    expect(ws.readyState).toBe(WebSocket.CLOSING);
    expect(events).toEqual([]);
    client.end();
    await server.closed;
    expect(events).toEqual(["close 1000 Buffer() rs=3"]);
  });

  test("messages and pings that arrive after close() are delivered, and no Pong goes out", async () => {
    await using server = await openServer(implementation);
    const { ws, client, events } = server;
    ws.close(1000);
    expect(await client.next()).toBe("close 1000");
    client.text("late-1");
    client.text("late-2");
    client.ping("late-ping");
    client.close(1000);
    await server.closed;
    expect(events).toEqual([
      'message Buffer("late-1") text rs=2',
      'message Buffer("late-2") text rs=2',
      'ping Buffer("late-ping") rs=2',
      "close 1000 Buffer() rs=3",
    ]);
    expect(await client.rest()).toEqual([]);
  });

  test("send() after close() fails its callback and counts in bufferedAmount", async () => {
    await using server = await openServer(implementation);
    const { ws, client } = server;
    ws.close(1000);
    expect(await sendResult(ws, "late")).toBe('Error "WebSocket is not open: readyState 2 (CLOSING)"');
    expect(ws.bufferedAmount).toBe(4);
    client.close(1000);
    await server.closed;
    expect(await sendResult(ws, "later")).toBe('Error "WebSocket is not open: readyState 3 (CLOSED)"');
    expect(await client.rest()).toEqual(["close 1000"]);
  });

  describe("the peer closes first", () => {
    test.each([
      { code: 1000, reason: "", frame: "close 1000", event: "close 1000 Buffer() rs=3" },
      { code: 1000, reason: "bye", frame: 'close 1000 "bye"', event: 'close 1000 Buffer("bye") rs=3' },
      {
        code: 1001,
        reason: "page unload",
        frame: 'close 1001 "page unload"',
        event: 'close 1001 Buffer("page unload") rs=3',
      },
      { code: 1011, reason: "err", frame: 'close 1011 "err"', event: 'close 1011 Buffer("err") rs=3' },
      { code: 3999, reason: "é", frame: 'close 3999 "é"', event: 'close 3999 Buffer("é") rs=3' },
      { code: 4001, reason: "bye bye", frame: 'close 4001 "bye bye"', event: 'close 4001 Buffer("bye bye") rs=3' },
      { code: undefined, reason: "", frame: "close", event: "close 1005 Buffer() rs=3" },
    ])("$frame is echoed, then FIN", async ({ code, reason, frame, event }) => {
      await using server = await openServer(implementation, {}, { allowHalfOpen: true });
      const { ws, client, events } = server;
      client.close(code, reason);
      expect(await client.next()).toBe(frame);
      expect(ws.readyState).toBe(WebSocket.CLOSING);
      // The server ends its side without waiting for the client to do so.
      await client.ended;
      expect(client.tcp).toEqual(["end"]);
      client.end();
      await server.closed;
      expect(events).toEqual([event]);
    });

    test("the reason is a Buffer", async () => {
      await using server = await openServer(implementation);
      const closed = event(server.ws, "close");
      server.client.close(4000, "héllo");
      expect(await closed).toEqual([4000, Buffer.from("héllo")]);
    });

    test("messages in the same packet as the Close frame come first", async () => {
      await using server = await openServer(implementation);
      const { client } = server;
      client.write(
        Buffer.concat([
          client.frame(OP.text, "a"),
          client.frame(OP.text, "b"),
          client.frame(OP.close, closePayload(1000, "done")),
        ]),
      );
      await server.closed;
      expect(server.events).toEqual([
        'message Buffer("a") text rs=1',
        'message Buffer("b") text rs=1',
        'close 1000 Buffer("done") rs=3',
      ]);
    });

    test("what follows the Close frame is ignored", async () => {
      await using server = await openServer(implementation);
      const { client } = server;
      client.write(Buffer.concat([client.frame(OP.close, closePayload(1000)), client.frame(OP.text, "after")]));
      await server.closed;
      expect(server.events).toEqual(["close 1000 Buffer() rs=3"]);
    });

    test("close() in the 'close' listener does nothing", async () => {
      await using server = await openServer(implementation);
      const { ws, client } = server;
      let result = "";
      ws.on("close", () => (result = attempt(() => ws.close())));
      client.close(1000);
      await server.closed;
      expect(result).toBe("undefined");
      expect(await client.rest()).toEqual(["close 1000"]);
    });
  });

  describe("the connection ends without a Close frame", () => {
    test.each([
      { how: "FIN", end: client => client.end() },
      { how: "RST", end: client => client.reset() },
      {
        how: "FIN in the middle of a frame",
        end: client => (client.write(client.frame(OP.text, "hello").subarray(0, 4)), client.end()),
      },
    ] as { how: string; end(client: RawClient): void }[])(
      "$how: 'close' 1006, no 'error', nothing sent",
      async ({ end }) => {
        await using server = await openServer(implementation);
        end(server.client);
        await server.closed;
        expect(server.events).toEqual(["close 1006 Buffer() rs=3"]);
        expect(await server.client.rest()).toEqual([]);
      },
    );

    test("FIN in answer to close(): 'close' 1006, not the code of close()", async () => {
      await using server = await openServer(implementation);
      const { ws, client, events } = server;
      ws.close(4000, "x");
      expect(await client.next()).toBe('close 4000 "x"');
      client.end();
      await server.closed;
      expect(events).toEqual(["close 1006 Buffer() rs=3"]);
    });
  });

  describe("terminate()", () => {
    test("on an open socket: CLOSING at once, FIN without a Close frame, 'close' 1006", async () => {
      await using server = await openServer(implementation);
      const { ws, client, events } = server;
      expect(attempt(() => ws.terminate())).toBe("undefined");
      expect(ws.readyState).toBe(WebSocket.CLOSING);
      expect(events).toEqual([]);
      await server.closed;
      expect(events).toEqual(["close 1006 Buffer() rs=3"]);
      expect(await client.rest()).toEqual([]);
      await client.closed;
      expect(client.tcp).toEqual(["end", "close"]);
    });

    // What the socket already holds is still parsed. Nothing is answered: no Pong, no Close frame.
    describe("with frames that came with the request, in the 'connection' listener", () => {
      test.each<{ held: string; frames: [opcode: number, payload?: Payload][]; cut?: number; events: string[] }>([
        {
          held: "a message and a Close frame",
          frames: [
            [OP.text, "one"],
            [OP.close, closePayload(1000, "bye")],
          ],
          events: ['message Buffer("one") text rs=2', 'close 1000 Buffer("bye") rs=3'],
        },
        {
          held: "a Close frame",
          frames: [[OP.close, closePayload(1000, "bye")]],
          events: ['close 1000 Buffer("bye") rs=3'],
        },
        { held: "a message", frames: [[OP.text, "one"]], events: ['message Buffer("one") text rs=2', lost] },
        {
          held: "two messages",
          frames: [
            [OP.text, "one"],
            [OP.binary, "two"],
          ],
          events: ['message Buffer("one") text rs=2', 'message Buffer("two") binary rs=2', lost],
        },
        {
          held: "a Ping and a message",
          frames: [
            [OP.ping, "p"],
            [OP.text, "one"],
          ],
          events: ['ping Buffer("p") rs=2', 'message Buffer("one") text rs=2', lost],
        },
        { held: "a message without its last byte", frames: [[OP.text, "one"]], cut: -1, events: [lost] },
        {
          held: "a frame that is no frame",
          frames: [[3, "x"]],
          events: ['error RangeError "Invalid WebSocket frame: invalid opcode 3" WS_ERR_INVALID_OPCODE rs=2', lost],
        },
      ])("$held", async ({ frames, cut, events }) => {
        const held = Buffer.concat(frames.map(([opcode, payload]) => encodeFrame(opcode, payload, { mask: true })));
        await using server = await createServer(implementation);
        const seen: string[] = [];
        const closed = new Promise<void>(resolve =>
          server.wss.on("connection", ws => {
            watch(ws, seen);
            ws.on("close", () => resolve());
            ws.terminate();
          }),
        );
        const client = server.connect({ afterRequest: held.subarray(0, cut) });
        await closed;
        expect(seen).toEqual(events);
        expect(await client.rest()).toEqual([]);
      });
    });

    test("after close(): 'close' 1006, not the code of close()", async () => {
      await using server = await openServer(implementation);
      const { ws, client, events } = server;
      ws.close(1000);
      ws.terminate();
      expect(ws.readyState).toBe(WebSocket.CLOSING);
      await server.closed;
      expect(events).toEqual(["close 1006 Buffer() rs=3"]);
      expect(await client.rest()).toEqual(["close 1000"]);
      await client.closed;
      expect(client.tcp).toEqual(["end", "close"]);
    });

    test("twice, and every closing call on a CLOSED socket, do nothing", async () => {
      await using server = await openServer(implementation);
      const { ws, events } = server;
      ws.terminate();
      ws.terminate();
      await server.closed;
      expect([() => ws.terminate(), () => ws.close(), () => ws.close(999)].map(attempt)).toEqual([
        "undefined",
        "undefined",
        "undefined",
      ]);
      expect(events).toEqual(["close 1006 Buffer() rs=3"]);
    });

    test("without a receiver throws a TypeError", async () => {
      await using server = await openServer(implementation);
      const { terminate } = server.ws;
      expect(() => terminate()).toThrow(TypeError);
      expect(server.ws.readyState).toBe(WebSocket.OPEN);
    });
  });

  // The socket is CLOSING when the call returns, and a listener added after it gets 'close'.
  describe.each([
    {
      call: 'close(4001, "no")',
      act: ws => ws.close(4001, "no"),
      sent: ['close 4001 "no"'],
      answer: client => client.close(4001, "no"),
      code: 4001,
    },
    { call: "terminate()", act: ws => ws.terminate(), sent: [], answer: () => {}, code: 1006 },
  ] as { call: string; act(ws: WsSocket): void; sent: string[]; answer(client: RawClient): void; code: number }[])(
    "'close' comes after $call has returned",
    ({ act, sent, answer, code }) => {
      function run(ws: WsSocket) {
        act(ws);
        const { readyState } = ws;
        return event(ws, "close").then(([code]) => ({ readyState, code }));
      }
      async function finish(client: RawClient, result: Promise<unknown>) {
        expect(await client.take(sent.length)).toEqual(sent);
        answer(client);
        expect(await result).toEqual({ readyState: WebSocket.CLOSING, code });
        expect(await client.rest()).toEqual([]);
      }

      test("outside of any listener", async () => {
        await using server = await openServer(implementation);
        await finish(server.client, run(server.ws));
      });

      test("in the 'connection' listener, and the client gets the 101 first", async () => {
        await using server = await createServer(implementation);
        const result = new Promise(resolve => server.wss.on("connection", ws => resolve(run(ws))));
        const client = server.connect();
        expect((await client.response).status).toBe("HTTP/1.1 101 Switching Protocols");
        await finish(client, result);
      });

      test("in a 'message' listener", async () => {
        await using server = await openServer(implementation);
        const result = new Promise(resolve => server.ws.on("message", () => resolve(run(server.ws))));
        server.client.text("x");
        await finish(server.client, result);
      });
    },
  );

  test("a second close() is ignored, arguments and all", async () => {
    await using server = await openServer(implementation);
    const { ws, client, events } = server;
    ws.close(4000, "first");
    expect(attempt(() => ws.close(4001, "second"))).toBe("undefined");
    expect(attempt(() => ws.close(999))).toBe("undefined");
    client.close(4000);
    await server.closed;
    expect(await client.rest()).toEqual(['close 4000 "first"']);
    expect(events).toEqual(["close 4000 Buffer() rs=3"]);
  });

  test("what send() queued goes out before the Close frame", async () => {
    await using server = await openServer(implementation);
    const { ws, client } = server;
    for (let i = 0; i < 5; i++) ws.send("m" + i);
    ws.close(1000, "done");
    expect(await client.take(6)).toEqual([
      'text "m0"',
      'text "m1"',
      'text "m2"',
      'text "m3"',
      'text "m4"',
      'close 1000 "done"',
    ]);
  });

  // Winsock takes any amount of loopback data, so nothing builds up in the process.
  describe.skipIf(isWindows)("behind a backlog", () => {
    const size = 256 * 1024;

    // Sends until the kernel takes no more, and twice more. The client is in this thread: it reads nothing meanwhile.
    function fill(ws: WsSocket) {
      const results: Promise<string>[] = [];
      const send = () => results.push(sendResult(ws, Buffer.alloc(size, results.length)));
      while (ws.bufferedAmount === 0 && results.length < 256) send();
      const written = results.length - 1;
      const { bufferedAmount } = ws;
      send();
      send();
      return { results, written, bufferedAmount };
    }

    function fillAndClose(ws: WsSocket) {
      const backlog = fill(ws);
      ws.close(1000, "done");
      return { ...backlog, closed: event(ws, "close") };
    }

    async function everythingArrives(client: RawClient, backlog: ReturnType<typeof fillAndClose>) {
      const count = backlog.results.length;
      expect(backlog.bufferedAmount).toBeGreaterThan(0);
      expect(await client.take(count + 1)).toEqual([...Array(count).fill(`binary ${size} bytes`), 'close 1000 "done"']);
      expect(client.frames.slice(0, count).map(frame => frame.payload[0])).toEqual([...Array(count).keys()]);
      client.close(1000, "done");
      expect(await backlog.closed).toEqual([1000, Buffer.from("done")]);
      expect(await Promise.all(backlog.results)).toEqual(Array(count).fill("ok"));
    }

    test("close(): every message goes out, then the Close frame, and every callback succeeds", async () => {
      await using server = await openServer(implementation);
      await everythingArrives(server.client, fillAndClose(server.ws));
    });

    test("close() in the 'connection' listener: the same", async () => {
      await using server = await createServer(implementation);
      const backlog = new Promise<ReturnType<typeof fillAndClose>>(resolve =>
        server.wss.on("connection", ws => resolve(fillAndClose(ws))),
      );
      await everythingArrives(server.connect(), await backlog);
    });

    test("terminate(): the callbacks of what was not written fail", async () => {
      await using server = await openServer(implementation);
      const { results, written, bufferedAmount } = fill(server.ws);
      expect(bufferedAmount).toBeGreaterThan(0);
      server.ws.terminate();
      // The error is node:net's.
      expect((await Promise.all(results)).map(result => result === "ok")).toEqual(results.map((_, i) => i < written));
      await server.closed;
      expect(server.events).toEqual(["close 1006 Buffer() rs=3"]);
    });
  });

  describe("over TLS", () => {
    test("the closing handshake", async () => {
      await using web = await serve(https.createServer(certificate));
      const server = await web.open(new WebSocketServer({ server: web.server }));
      const { ws, client, events } = server;
      ws.close(4000, "tls bye");
      expect(ws.readyState).toBe(WebSocket.CLOSING);
      expect(await client.next()).toBe('close 4000 "tls bye"');
      client.close(4000, "tls bye");
      expect(await client.next()).toBe("EOF");
      await server.closed;
      expect(events).toEqual(['close 4000 Buffer("tls bye") rs=3']);
    });

    test("terminate()", async () => {
      await using web = await serve(https.createServer(certificate));
      const server = await web.open(new WebSocketServer({ server: web.server }));
      server.ws.terminate();
      expect(await server.client.next()).toBe("EOF");
      await server.closed;
      expect(server.events).toEqual(["close 1006 Buffer() rs=3"]);
    });
  });

  describe("wss.clients", () => {
    test("holds a socket from 'connection' until its 'close' event", async () => {
      await using server = await openServer(implementation);
      const { wss, ws, client } = server;
      expect(wss.clients.size).toBe(1);
      expect(wss.clients.has(ws)).toBe(true);
      ws.close(1000);
      expect(wss.clients.has(ws)).toBe(true);
      let inListener = -1;
      ws.on("close", () => (inListener = wss.clients.size));
      client.close(1000);
      await server.closed;
      expect(inListener).toBe(0);
      expect(wss.clients.size).toBe(0);
    });

    test("is undefined with clientTracking: false", async () => {
      await using server = await openServer(implementation, { clientTracking: false });
      expect(server.wss.clients).toBeUndefined();
    });
  });

  describe("wss.close()", () => {
    test("with its own HTTP server: no new connections, the sockets stay open, done when they are gone", async () => {
      await using server = await openServer(implementation);
      const { wss, ws, client, events } = server;
      const log: string[] = [];
      wss.on("close", () => log.push("'close' event"));
      const done = new Promise<void>(resolve => wss.close(error => (log.push(`callback ${show(error)}`), resolve())));

      expect(await client.roundTrip()).toEqual([]);
      expect(log).toEqual([]);
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.send("still works");
      expect(await client.next()).toBe('text "still works"');

      const refused = server.connect();
      await refused.closed;
      expect(refused.tcp).toEqual(["error ECONNREFUSED", "close"]);

      // Which 'close' comes first, the socket's or the server's, is up to node:net.
      ws.terminate();
      await Promise.all([done, server.closed]);
      expect(log).toEqual(["'close' event", "callback undefined"]);
      expect(events).toEqual(["close 1006 Buffer() rs=3"]);
    });

    test("with `server`: removes its listeners, the HTTP server goes on, done when the sockets are gone", async () => {
      await using web = await serve(http.createServer());
      const httpServer = web.server;
      const listeners = () => ["upgrade", "listening", "error"].map(name => httpServer.listenerCount(name));
      const before = listeners();
      const server = await web.open(new WebSocketServer({ server: httpServer }));
      const { wss, ws, client } = server;
      expect(listeners()).toEqual(before.map(count => count + 1));

      let called = false;
      const done = new Promise<void>(resolve => wss.close(() => ((called = true), resolve())));
      expect(listeners()).toEqual(before);
      expect(await client.roundTrip()).toEqual([]);
      expect(called).toBe(false);
      expect(httpServer.listening).toBe(true);

      ws.close();
      expect(await client.next()).toBe("close");
      client.close();
      await done;
      expect(httpServer.listening).toBe(true);
    });

    test("with `server` and clientTracking: false: does not wait for the sockets", async () => {
      await using web = await serve(http.createServer());
      const server = await web.open(new WebSocketServer({ server: web.server, clientTracking: false }));
      expect(await new Promise(resolve => server.wss.close(resolve))).toBeUndefined();
      expect(server.ws.readyState).toBe(WebSocket.OPEN);
    });

    test("a second time: the callback gets an error", async () => {
      const wss = new WebSocketServer({ noServer: true });
      expect(await new Promise(resolve => wss.close(resolve))).toBeUndefined();
      expect(showError(await new Promise(resolve => wss.close(resolve)))).toBe('Error "The server is not running"');
    });

    test("after close() on each of wss.clients: done when the clients have answered", async () => {
      await using server = await openServer(implementation);
      const { wss, client } = server;
      for (const ws of wss.clients) ws.close(1001, "server shutting down");
      const done = new Promise(resolve => wss.close(resolve));
      expect(await client.next()).toBe('close 1001 "server shutting down"');
      client.close(1001, "server shutting down");
      expect(await done).toBeUndefined();
    });
  });

  test("http.Server close() and closeAllConnections() leave a socket open, and close() waits for it", async () => {
    await using web = await serve(http.createServer());
    const httpServer = web.server;
    const server = await web.open(new WebSocketServer({ server: httpServer }));
    const { ws, client } = server;
    let called = false;
    const done = new Promise<void>(resolve => httpServer.close(() => ((called = true), resolve())));
    expect(attempt(() => httpServer.closeAllConnections())).toBe("undefined");
    expect(await client.roundTrip()).toEqual([]);
    expect(called).toBe(false);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.send("x");
    expect(await client.next()).toBe('text "x"');
    ws.terminate();
    await done;
  });

  // npm ws sends the bytes as they are. The native close() takes a string, so the built-in sends U+FFFD.
  test.skipIf(builtin)("a reason that is not UTF-8 goes out as it is", async () => {
    await using server = await openServer(implementation);
    server.ws.close(1000, Buffer.from([0xff]));
    expect(await server.client.next()).toBe("close 1000 0xff");
  });

  // Each of the 100 bytes becomes U+FFFD, which is three.
  test.skipIf(!builtin)("a reason that is too long once it is UTF-8 throws, and the socket stays open", async () => {
    await using server = await openServer(implementation);
    const { ws, client } = server;
    expect(attempt(() => ws.close(1000, Buffer.alloc(100, 0xff)))).toBe(reasonTooLong);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(await client.roundTrip()).toEqual([]);
    ws.close(1000, "bye");
    expect(await client.next()).toBe('close 1000 "bye"');
  });
});
