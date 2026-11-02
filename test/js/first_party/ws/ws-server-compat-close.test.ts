// Tests close(), terminate(), the closing handshake, wss.close() and wss.clients on a `ws` server, using a raw TCP
// client. See ws-raw-peer.ts.
import { describe, expect, test } from "bun:test";
import { tls as certificate, isWindows } from "harness";
import http from "node:http";
import https from "node:https";
import type { TLSSocket } from "node:tls";
import type { WebSocket as WsSocket } from "ws";
import {
  abnormalClose,
  closePayload,
  createServer,
  encodeFrame,
  implementations,
  invalidCloseCalls,
  nextEvent,
  OP,
  openServer,
  type Payload,
  RawClient,
  reasonTooLong,
  recordEvents,
  type RequestOptions,
  serve,
  show,
  showError,
  showFrame,
  shrinkBuffers,
  tryCall,
  validCloseCalls,
} from "./ws-raw-peer";

const sendResult = (ws: WsSocket, data: string | Buffer) =>
  new Promise<string>(resolve => ws.send(data, error => resolve(error ? showError(error) : "ok")));

describe.each(implementations)("ws server close ($name)", ({ ws: implementation, builtin }) => {
  const { WebSocket, WebSocketServer } = implementation;

  describe("close(code, reason) on an open socket", () => {
    // The client echoes the Close frame, so 'close' reports the code and reason the server sent.
    test.each(validCloseCalls)("$call sends $frame", async ({ args, frame, event }) => {
      await using server = await openServer(implementation);
      const { ws, client, events } = server;
      expect(tryCall(() => ws.close(...(args as [])))).toBe("undefined");
      expect(ws.readyState).toBe(WebSocket.CLOSING);
      const sent = (await client.nextFrame())!;
      expect(showFrame(sent)).toBe(frame);
      client.send(OP.close, sent.payload);
      await server.closed;
      expect(events).toEqual([event]);
      expect(await client.remainingFrames()).toEqual([]);
    });

    test.each(invalidCloseCalls)("$call throws and sends nothing", async ({ args, thrown }) => {
      await using server = await openServer(implementation);
      const { ws, client } = server;
      expect(tryCall(() => ws.close(...(args as [])))).toBe(thrown);
      // ws 8.18 leaves the socket CLOSING here, later versions leave it OPEN. Either way no frame is sent.
      ws.terminate();
      expect(await client.remainingFrames()).toEqual([]);
    });

    test("close(1000, null) throws a TypeError and sends nothing", async () => {
      await using server = await openServer(implementation);
      expect(() => server.ws.close(1000, null as any)).toThrow(TypeError);
      server.ws.terminate();
      expect(await server.client.remainingFrames()).toEqual([]);
    });
  });

  test("'close' waits for the peer's Close frame and reports the peer's code", async () => {
    await using server = await openServer(implementation);
    const { ws, client, events } = server;
    ws.close(4000, "mine");
    expect(await client.next()).toBe('close 4000 "mine"');

    // Messages are still delivered while CLOSING, which also proves the socket wasn't closed early.
    client.text("still here");
    await nextEvent(ws, "message");
    expect(events).toEqual(['message Buffer("still here") text rs=2']);

    client.close(4444, "theirs");
    await server.closed;
    expect(events.slice(1)).toEqual(['close 4444 Buffer("theirs") rs=3']);
    await client.closed;
    expect(client.socketEvents).toEqual(["end", "close"]);
  });

  test("sends FIN after both Close frames, and 'close' waits for the client's FIN", async () => {
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

  test("delivers messages and pings received after close(), but doesn't send a Pong", async () => {
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
    expect(await client.remainingFrames()).toEqual([]);
  });

  test("send() after close() passes an error to its callback and adds to bufferedAmount", async () => {
    await using server = await openServer(implementation);
    const { ws, client } = server;
    ws.close(1000);
    expect(await sendResult(ws, "late")).toBe('Error "WebSocket is not open: readyState 2 (CLOSING)"');
    expect(ws.bufferedAmount).toBe(4);
    client.close(1000);
    await server.closed;
    expect(await sendResult(ws, "later")).toBe('Error "WebSocket is not open: readyState 3 (CLOSED)"');
    expect(await client.remainingFrames()).toEqual(["close 1000"]);
  });

  describe("when the peer closes first", () => {
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
    ])("echoes $frame, then sends FIN", async ({ code, reason, frame, event }) => {
      await using server = await openServer(implementation, {}, { allowHalfOpen: true });
      const { ws, client, events } = server;
      client.close(code, reason);
      expect(await client.next()).toBe(frame);
      expect(ws.readyState).toBe(WebSocket.CLOSING);
      // The server sends FIN without waiting for the client's.
      await client.ended;
      expect(client.socketEvents).toEqual(["end"]);
      client.end();
      await server.closed;
      expect(events).toEqual([event]);
    });

    test("'close' gets the reason as a Buffer", async () => {
      await using server = await openServer(implementation);
      const closed = nextEvent(server.ws, "close");
      server.client.close(4000, "héllo");
      expect(await closed).toEqual([4000, Buffer.from("héllo")]);
    });

    test("delivers messages in the same packet as the Close frame before 'close'", async () => {
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

    test("ignores frames after the Close frame", async () => {
      await using server = await openServer(implementation);
      const { client } = server;
      client.write(Buffer.concat([client.frame(OP.close, closePayload(1000)), client.frame(OP.text, "after")]));
      await server.closed;
      expect(server.events).toEqual(["close 1000 Buffer() rs=3"]);
    });

    test("close() in the 'close' listener is a no-op", async () => {
      await using server = await openServer(implementation);
      const { ws, client } = server;
      let result = "";
      ws.on("close", () => (result = tryCall(() => ws.close())));
      client.close(1000);
      await server.closed;
      expect(result).toBe("undefined");
      expect(await client.remainingFrames()).toEqual(["close 1000"]);
    });
  });

  describe("when the connection ends without a Close frame", () => {
    test.each([
      { how: "FIN", end: client => client.end() },
      { how: "RST", end: client => client.reset() },
      {
        how: "FIN mid-frame",
        end: client => (client.write(client.frame(OP.text, "hello").subarray(0, 4)), client.end()),
      },
    ] as { how: string; end(client: RawClient): void }[])(
      "$how emits 'close' 1006 and no 'error', and sends nothing",
      async ({ end }) => {
        await using server = await openServer(implementation);
        end(server.client);
        await server.closed;
        expect(server.events).toEqual(["close 1006 Buffer() rs=3"]);
        expect(await server.client.remainingFrames()).toEqual([]);
      },
    );

    test("FIN in reply to close() emits 'close' 1006, not close()'s code", async () => {
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
    test("on an open socket: CLOSING immediately, sends FIN with no Close frame, emits 'close' 1006", async () => {
      await using server = await openServer(implementation);
      const { ws, client, events } = server;
      expect(tryCall(() => ws.terminate())).toBe("undefined");
      expect(ws.readyState).toBe(WebSocket.CLOSING);
      expect(events).toEqual([]);
      await server.closed;
      expect(events).toEqual(["close 1006 Buffer() rs=3"]);
      expect(await client.remainingFrames()).toEqual([]);
      await client.closed;
      expect(client.socketEvents).toEqual(["end", "close"]);
    });

    // Data already buffered in the socket is still parsed, but gets no reply: no Pong, no Close frame.
    describe("in the 'connection' listener, with frames sent in the same write as the upgrade request", () => {
      test.each<{ label: string; frames: [opcode: number, payload?: Payload][]; sliceEnd?: number; events: string[] }>([
        {
          label: "a message and a Close frame",
          frames: [
            [OP.text, "one"],
            [OP.close, closePayload(1000, "bye")],
          ],
          events: ['message Buffer("one") text rs=2', 'close 1000 Buffer("bye") rs=3'],
        },
        {
          label: "a Close frame",
          frames: [[OP.close, closePayload(1000, "bye")]],
          events: ['close 1000 Buffer("bye") rs=3'],
        },
        { label: "a message", frames: [[OP.text, "one"]], events: ['message Buffer("one") text rs=2', abnormalClose] },
        {
          label: "two messages",
          frames: [
            [OP.text, "one"],
            [OP.binary, "two"],
          ],
          events: ['message Buffer("one") text rs=2', 'message Buffer("two") binary rs=2', abnormalClose],
        },
        {
          label: "a Ping and a message",
          frames: [
            [OP.ping, "p"],
            [OP.text, "one"],
          ],
          events: ['ping Buffer("p") rs=2', 'message Buffer("one") text rs=2', abnormalClose],
        },
        { label: "a message missing its last byte", frames: [[OP.text, "one"]], sliceEnd: -1, events: [abnormalClose] },
        {
          label: "a frame with an invalid opcode",
          frames: [[3, "x"]],
          events: [
            'error RangeError "Invalid WebSocket frame: invalid opcode 3" WS_ERR_INVALID_OPCODE rs=2',
            abnormalClose,
          ],
        },
      ])("$label", async ({ frames, sliceEnd, events }) => {
        const buffered = Buffer.concat(frames.map(([opcode, payload]) => encodeFrame(opcode, payload, { mask: true })));
        await using server = await createServer(implementation);
        const seen: string[] = [];
        const closed = new Promise<void>(resolve =>
          server.wss.on("connection", ws => {
            recordEvents(ws, seen);
            ws.on("close", () => resolve());
            ws.terminate();
          }),
        );
        const client = server.connect({ trailingBytes: buffered.subarray(0, sliceEnd) });
        await closed;
        expect(seen).toEqual(events);
        expect(await client.remainingFrames()).toEqual([]);
      });
    });

    test("after close() emits 'close' 1006, not close()'s code", async () => {
      await using server = await openServer(implementation);
      const { ws, client, events } = server;
      ws.close(1000);
      ws.terminate();
      expect(ws.readyState).toBe(WebSocket.CLOSING);
      await server.closed;
      expect(events).toEqual(["close 1006 Buffer() rs=3"]);
      expect(await client.remainingFrames()).toEqual(["close 1000"]);
      await client.closed;
      expect(client.socketEvents).toEqual(["end", "close"]);
    });

    test("a second call, and terminate() or close() on a CLOSED socket, are no-ops", async () => {
      await using server = await openServer(implementation);
      const { ws, events } = server;
      ws.terminate();
      ws.terminate();
      await server.closed;
      expect([() => ws.terminate(), () => ws.close(), () => ws.close(999)].map(tryCall)).toEqual([
        "undefined",
        "undefined",
        "undefined",
      ]);
      expect(events).toEqual(["close 1006 Buffer() rs=3"]);
    });

    test("throws a TypeError when called without `this`", async () => {
      await using server = await openServer(implementation);
      const { terminate } = server.ws;
      expect(() => terminate()).toThrow(TypeError);
      expect(server.ws.readyState).toBe(WebSocket.OPEN);
    });
  });

  // The socket is CLOSING when the call returns, and a 'close' listener added afterwards still fires.
  describe.each([
    {
      call: 'close(4001, "no")',
      act: ws => ws.close(4001, "no"),
      sent: ['close 4001 "no"'],
      reply: client => client.close(4001, "no"),
      code: 4001,
    },
    { call: "terminate()", act: ws => ws.terminate(), sent: [], reply: () => {}, code: 1006 },
  ] as { call: string; act(ws: WsSocket): void; sent: string[]; reply(client: RawClient): void; code: number }[])(
    "'close' fires after $call returns",
    ({ act, sent, reply, code }) => {
      function run(ws: WsSocket) {
        act(ws);
        const { readyState } = ws;
        return nextEvent(ws, "close").then(([code]) => ({ readyState, code }));
      }
      async function finish(client: RawClient, result: Promise<unknown>) {
        expect(await client.nextFrames(sent.length)).toEqual(sent);
        reply(client);
        expect(await result).toEqual({ readyState: WebSocket.CLOSING, code });
        expect(await client.remainingFrames()).toEqual([]);
      }

      test("when called outside any listener", async () => {
        await using server = await openServer(implementation);
        await finish(server.client, run(server.ws));
      });

      test("when called in the 'connection' listener, and the client gets the 101 first", async () => {
        await using server = await createServer(implementation);
        const result = new Promise(resolve => server.wss.on("connection", ws => resolve(run(ws))));
        const client = server.connect();
        expect((await client.response).status).toBe("HTTP/1.1 101 Switching Protocols");
        await finish(client, result);
      });

      test("when called in a 'message' listener", async () => {
        await using server = await openServer(implementation);
        const result = new Promise(resolve => server.ws.on("message", () => resolve(run(server.ws))));
        server.client.text("x");
        await finish(server.client, result);
      });
    },
  );

  test("a second close() is ignored, even with invalid arguments", async () => {
    await using server = await openServer(implementation);
    const { ws, client, events } = server;
    ws.close(4000, "first");
    expect(tryCall(() => ws.close(4001, "second"))).toBe("undefined");
    expect(tryCall(() => ws.close(999))).toBe("undefined");
    client.close(4000);
    await server.closed;
    expect(await client.remainingFrames()).toEqual(['close 4000 "first"']);
    expect(events).toEqual(["close 4000 Buffer() rs=3"]);
  });

  test("sends queued messages before the Close frame", async () => {
    await using server = await openServer(implementation);
    const { ws, client } = server;
    for (let i = 0; i < 5; i++) ws.send("m" + i);
    ws.close(1000, "done");
    expect(await client.nextFrames(6)).toEqual([
      'text "m0"',
      'text "m1"',
      'text "m2"',
      'text "m3"',
      'text "m4"',
      'close 1000 "done"',
    ]);
  });

  // Winsock buffers any amount of loopback data, so the process never sees backpressure.
  describe.skipIf(isWindows)("under backpressure", () => {
    const size = 64 * 1024;

    // Sends until three messages in a row have left something unwritten. The client runs on this thread, so it can't
    // read yet. The kernel can still make room between two sends, by moving what it took to the client's buffer, and a
    // send() that finds room also writes what the ones before it left.
    function fill(ws: WsSocket) {
      shrinkBuffers({ sender: ws });
      const results: Promise<string>[] = [];
      let written = 0;
      while (results.length - written < 3 && results.length < 256) {
        results.push(sendResult(ws, Buffer.alloc(size, results.length)));
        if (ws.bufferedAmount === 0) written = results.length;
      }
      return { results, written, bufferedAmount: ws.bufferedAmount };
    }

    function fillAndClose(ws: WsSocket) {
      const backlog = fill(ws);
      ws.close(1000, "done");
      return { ...backlog, closed: nextEvent(ws, "close") };
    }

    async function expectAllDelivered(client: RawClient, backlog: ReturnType<typeof fillAndClose>) {
      const count = backlog.results.length;
      expect(backlog.bufferedAmount).toBeGreaterThan(0);
      expect(await client.nextFrames(count + 1)).toEqual([
        ...Array(count).fill(`binary ${size} bytes`),
        'close 1000 "done"',
      ]);
      expect(client.frames.slice(0, count).map(frame => frame.payload[0])).toEqual([...Array(count).keys()]);
      client.close(1000, "done");
      expect(await backlog.closed).toEqual([1000, Buffer.from("done")]);
      expect(await Promise.all(backlog.results)).toEqual(Array(count).fill("ok"));
    }

    test("close() flushes every message, then the Close frame, and every send() callback succeeds", async () => {
      await using server = await openServer(implementation);
      await expectAllDelivered(server.client, fillAndClose(server.ws));
    });

    test("close() in the 'connection' listener does the same", async () => {
      await using server = await createServer(implementation);
      const backlog = new Promise<ReturnType<typeof fillAndClose>>(resolve =>
        server.wss.on("connection", ws => resolve(fillAndClose(ws))),
      );
      await expectAllDelivered(server.connect(), await backlog);
    });

    test("terminate() fails the callbacks of unwritten messages", async () => {
      await using server = await openServer(implementation);
      const { results, written, bufferedAmount } = fill(server.ws);
      expect(bufferedAmount).toBeGreaterThan(0);
      server.ws.terminate();
      // The error comes from node:net, so only check which callbacks failed.
      expect((await Promise.all(results)).map(result => result === "ok")).toEqual(results.map((_, i) => i < written));
      await server.closed;
      expect(server.events).toEqual(["close 1006 Buffer() rs=3"]);
    });
  });

  describe("over TLS", () => {
    test("completes the closing handshake", async () => {
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

    test("terminate() emits 'close' 1006", async () => {
      await using web = await serve(https.createServer(certificate));
      const server = await web.open(new WebSocketServer({ server: web.server }));
      server.ws.terminate();
      expect(await server.client.next()).toBe("EOF");
      await server.closed;
      expect(server.events).toEqual(["close 1006 Buffer() rs=3"]);
    });
  });

  // For example, to decrement a connections-per-IP counter when a client disconnects. Middleware like tinyws upgrades
  // from a 'request' listener, which npm ws can't do on Bun: node:http doesn't give that listener a raw socket.
  describe.each(builtin ? ["upgrade", "request"] : ["upgrade"])(
    "after handleUpgrade() from the '%s' event, the 'close' listener can still read",
    event => {
      type Connection = Awaited<ReturnType<typeof open>>;

      async function open(server: http.Server, request?: RequestOptions) {
        const wss = new WebSocketServer({ noServer: true });
        server.on(event, (req: http.IncomingMessage) =>
          wss.handleUpgrade(req, req.socket, Buffer.alloc(0), ws => wss.emit("connection", ws, req)),
        );
        const web = await serve(server);
        try {
          return { ...(await web.open(wss, request)), [Symbol.asyncDispose]: web[Symbol.asyncDispose] };
        } catch (error) {
          await web[Symbol.asyncDispose]();
          throw error;
        }
      }

      const address = ({ ws, req }: Connection) => {
        const { remoteAddress, remotePort, remoteFamily } = req.socket;
        return { remoteAddress, remotePort, remoteFamily, fromWebSocket: (ws as any)._socket.remoteAddress };
      };
      const addressOf = (client: RawClient) => ({
        remoteAddress: "127.0.0.1",
        remotePort: client.socket.localPort,
        remoteFamily: "IPv4",
        fromWebSocket: "127.0.0.1",
      });

      test.each<{ how: string; end(ws: WsSocket, client: RawClient): void }>([
        { how: "a closing handshake", end: (ws, client) => client.close(1000) },
        { how: "terminate()", end: ws => ws.terminate() },
        { how: "RST", end: (ws, client) => client.reset() },
      ])("the client's address after $how", async ({ end }) => {
        await using server = await open(http.createServer());
        const { ws, client } = server;
        const expected = addressOf(client);
        expect(address(server)).toEqual(expected);
        const inListener = nextEvent(ws, "close").then(() => address(server));
        end(ws, client);
        expect(await inListener).toEqual(expected);
      });

      // This one isn't from Node, which only keeps an address that was read while the socket was open.
      test("the client's address for the first time, after FIN", async () => {
        await using server = await open(http.createServer());
        const expected = addressOf(server.client);
        const inListener = nextEvent(server.ws, "close").then(() => address(server));
        server.client.end();
        expect(await inListener).toEqual(expected);
      });

      test.each([
        {
          label: "with a client certificate",
          clientCertificate: certificate,
          expected: { authorized: true, authorizationError: null, servername: "localhost" },
        },
        {
          label: "without a client certificate",
          clientCertificate: {},
          expected: { authorized: false, authorizationError: "UNABLE_TO_GET_ISSUER_CERT", servername: "localhost" },
        },
      ])("the TLS handshake's result, $label", async ({ clientCertificate, expected }) => {
        await using server = await open(
          https.createServer({ ...certificate, ca: certificate.cert, requestCert: true, rejectUnauthorized: false }),
          { tls: { servername: "localhost", ...clientCertificate } },
        );
        const handshakeResult = (): object => {
          const { authorized, authorizationError, servername } = server.req.socket as TLSSocket;
          return { authorized, authorizationError, servername };
        };
        expect(handshakeResult()).toEqual(expected);
        const inListener = nextEvent(server.ws, "close").then(handshakeResult);
        server.client.close(1000);
        expect(await inListener).toEqual(expected);
      });
    },
  );

  describe("wss.clients", () => {
    test("contains a socket from 'connection' until its 'close' event", async () => {
      await using server = await openServer(implementation);
      const { wss, ws, client } = server;
      expect(wss.clients.size).toBe(1);
      expect(wss.clients.has(ws)).toBe(true);
      ws.close(1000);
      expect(wss.clients.has(ws)).toBe(true);
      let sizeInListener = -1;
      ws.on("close", () => (sizeInListener = wss.clients.size));
      client.close(1000);
      await server.closed;
      expect(sizeInListener).toBe(0);
      expect(wss.clients.size).toBe(0);
    });

    test("is undefined with clientTracking: false", async () => {
      await using server = await openServer(implementation, { clientTracking: false });
      expect(server.wss.clients).toBeUndefined();
    });
  });

  describe("wss.close()", () => {
    test("with its own HTTP server: stops accepting, leaves sockets open, finishes once they close", async () => {
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
      expect(refused.socketEvents).toEqual(["error ECONNREFUSED", "close"]);

      // node:net decides whether the socket's or the server's 'close' fires first.
      ws.terminate();
      await Promise.all([done, server.closed]);
      expect(log).toEqual(["'close' event", "callback undefined"]);
      expect(events).toEqual(["close 1006 Buffer() rs=3"]);
    });

    test("with `server`: removes its listeners, keeps the HTTP server open, finishes once sockets close", async () => {
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

    test("with `server` and clientTracking: false: doesn't wait for the sockets", async () => {
      await using web = await serve(http.createServer());
      const server = await web.open(new WebSocketServer({ server: web.server, clientTracking: false }));
      expect(await new Promise(resolve => server.wss.close(resolve))).toBeUndefined();
      expect(server.ws.readyState).toBe(WebSocket.OPEN);
    });

    test("called twice: the second callback gets an error", async () => {
      const wss = new WebSocketServer({ noServer: true });
      expect(await new Promise(resolve => wss.close(resolve))).toBeUndefined();
      expect(showError(await new Promise(resolve => wss.close(resolve)))).toBe('Error "The server is not running"');
    });

    test("after close() on every socket in wss.clients: finishes once the clients echo the Close frame", async () => {
      await using server = await openServer(implementation);
      const { wss, client } = server;
      for (const ws of wss.clients) ws.close(1001, "server shutting down");
      const done = new Promise(resolve => wss.close(resolve));
      expect(await client.next()).toBe('close 1001 "server shutting down"');
      client.close(1001, "server shutting down");
      expect(await done).toBeUndefined();
    });
  });

  test("http.Server close() and closeAllConnections() leave upgraded sockets open, and close() waits", async () => {
    await using web = await serve(http.createServer());
    const httpServer = web.server;
    const server = await web.open(new WebSocketServer({ server: httpServer }));
    const { ws, client } = server;
    let called = false;
    const done = new Promise<void>(resolve => httpServer.close(() => ((called = true), resolve())));
    expect(tryCall(() => httpServer.closeAllConnections())).toBe("undefined");
    expect(await client.roundTrip()).toEqual([]);
    expect(called).toBe(false);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.send("x");
    expect(await client.next()).toBe('text "x"');
    ws.terminate();
    await done;
  });

  // npm ws sends the bytes unchanged. The native close() takes a string, so the built-in sends U+FFFD instead.
  test.skipIf(builtin)("sends a non-UTF-8 reason unchanged", async () => {
    await using server = await openServer(implementation);
    server.ws.close(1000, Buffer.from([0xff]));
    expect(await server.client.next()).toBe("close 1000 0xff");
  });

  // Each of the 100 bytes becomes U+FFFD, which is 3 bytes in UTF-8.
  test.skipIf(!builtin)(
    "throws when the reason is over 123 bytes once converted to UTF-8, and leaves the socket open",
    async () => {
      await using server = await openServer(implementation);
      const { ws, client } = server;
      expect(tryCall(() => ws.close(1000, Buffer.alloc(100, 0xff)))).toBe(reasonTooLong);
      expect(ws.readyState).toBe(WebSocket.OPEN);
      expect(await client.roundTrip()).toEqual([]);
      ws.close(1000, "bye");
      expect(await client.next()).toBe('close 1000 "bye"');
    },
  );
});
