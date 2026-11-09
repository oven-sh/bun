// Tests the API surface of a `ws` server socket: properties, `_socket`, the 'connection' handler, and the EventEmitter
// and EventTarget interfaces. The client is a raw TCP socket. See ws-raw-peer.ts.
import { describe, expect, test } from "bun:test";
import { EventEmitter, once } from "node:events";
import { createServer, implementations, nextEvent, openServer, show, tryCall } from "./ws-raw-peer";

type Server = Awaited<ReturnType<typeof openServer>>;

// Converts an event to plain data: its class name, every enumerable property, and whether `target` is the socket.
function describeEvent(event: any, ws: unknown) {
  const result: Record<string, unknown> = { class: event.constructor.name };
  for (const key in event) {
    const value = event[key];
    result[key] = key === "target" ? value === ws : typeof value === "object" ? show(value) : value;
  }
  return result;
}

describe.each(implementations)("ws server events ($name)", ({ ws: implementation, builtin }) => {
  const { WebSocket } = implementation;

  test("the 'connection' handler gets (ws, req) with the server as `this`, and the socket is OPEN", async () => {
    await using server = await createServer(implementation);
    const seen: unknown[] = [];
    server.wss.on("connection", function (this: unknown, ws) {
      ws.on("open", () => seen.push("open"));
      seen.push(
        this === server.wss,
        arguments.length,
        ws.readyState,
        tryCall(() => ws.send("hello")),
        tryCall(() => ws.ping()),
      );
    });
    const client = server.connect();
    expect(await client.nextFrames(2)).toEqual(['text "hello"', "ping"]);
    expect(await client.roundTrip()).toEqual([]);
    // No 'open' event: the socket was already open before a listener could be added.
    expect(seen).toEqual([true, 2, WebSocket.OPEN, "undefined", "undefined"]);
  });

  test("initial properties of a new socket and its request", async () => {
    await using server = await openServer(
      implementation,
      {},
      { path: "/some/path?x=1", headers: { "Sec-WebSocket-Protocol": "p1" } },
    );
    const { ws, req, client } = server;
    const { url, protocol, extensions, binaryType, bufferedAmount, isPaused, readyState } = ws;
    expect<object>({ url, protocol, extensions, binaryType, bufferedAmount, isPaused, readyState }).toEqual({
      url: undefined,
      protocol: "p1",
      extensions: "",
      binaryType: "nodebuffer",
      bufferedAmount: 0,
      isPaused: false,
      readyState: 1,
    });
    expect([ws.CONNECTING, ws.OPEN, ws.CLOSING, ws.CLOSED]).toEqual([0, 1, 2, 3]);
    expect([ws.onopen, ws.onmessage, ws.onclose, ws.onerror]).toEqual([null, null, null, null]);
    expect({
      url: req.url,
      method: req.method,
      host: req.headers.host,
      remoteAddress: req.socket.remoteAddress,
      remotePort: req.socket.remotePort,
      connection: req.connection === req.socket,
    }).toEqual({
      url: "/some/path?x=1",
      method: "GET",
      host: "localhost",
      remoteAddress: "127.0.0.1",
      remotePort: client.socket.localPort,
      connection: true,
    });
  });

  test("_socket is the request's socket", async () => {
    await using server = await openServer(implementation);
    const ws: any = server.ws;
    const socket = ws._socket;
    expect(socket).toBe(server.req.socket);
    expect({
      remoteAddress: socket.remoteAddress,
      remotePort: socket.remotePort,
      setNoDelay: socket.setNoDelay() === socket,
      setKeepAlive: socket.setKeepAlive(true, 1000) === socket,
      bytesWritten: typeof socket.bytesWritten,
    }).toEqual({
      remoteAddress: "127.0.0.1",
      remotePort: server.client.socket.localPort,
      setNoDelay: true,
      setKeepAlive: true,
      bytesWritten: "number",
    });
    expect({ _isServer: ws._isServer, _closeCode: ws._closeCode, _closeFrameSent: ws._closeFrameSent }).toEqual({
      _isServer: true,
      _closeCode: 1006,
      _closeFrameSent: false,
    });
  });

  test("req.socket is still usable after the upgrade, and destroying it closes the WebSocket with 1006", async () => {
    await using server = await openServer(implementation);
    const { remoteAddress, destroyed, readable, writable } = server.req.socket;
    expect({ remoteAddress, destroyed, readable, writable }).toEqual({
      remoteAddress: "127.0.0.1",
      destroyed: false,
      readable: true,
      writable: true,
    });
    const socketClosed = nextEvent(server.req.socket, "close");
    server.req.socket.destroy();
    await Promise.all([server.closed, socketClosed]);
    expect(server.events).toEqual(["close 1006 Buffer() rs=3"]);
    expect(await server.client.remainingFrames()).toEqual([]);
  });

  test("the `WebSocket` option sets the class of the server's sockets", async () => {
    class CustomWebSocket extends WebSocket {
      hello() {
        return "hi";
      }
    }
    await using server = await openServer(implementation, { WebSocket: CustomWebSocket });
    expect(server.ws).toBeInstanceOf(CustomWebSocket);
    expect((server.ws as CustomWebSocket).hello()).toBe("hi");
  });

  test("new WebSocket(null, undefined, {}) creates a CONNECTING socket with setSocket()", () => {
    const ws: any = new WebSocket(null as any, undefined, {});
    expect(ws).toBeInstanceOf(WebSocket);
    expect(ws.readyState).toBe(WebSocket.CONNECTING);
    expect(ws.setSocket).toBeFunction();
  });

  test("a new socket has only the server's 'close' listener, and works as a plain EventEmitter", async () => {
    await using server = await createServer(implementation);
    const connection = once(server.wss, "connection");
    const client = server.connect();
    const [ws] = await connection;
    expect(ws.eventNames()).toEqual(["close"]);
    expect(ws.listenerCount("close")).toBe(1);

    const calls: string[] = [];
    ws.once("message", (data: unknown) => calls.push("once " + show(data)));
    ws.prependListener("message", (data: unknown) => calls.push("prepended " + show(data)));
    client.text("1");
    await nextEvent(ws, "message");
    expect(calls).toEqual(['prepended Buffer("1")', 'once Buffer("1")']);
    expect(ws.listenerCount("message")).toBe(1);
    ws.removeAllListeners("message");
    expect(ws.listenerCount("message")).toBe(0);
  });

  describe("EventTarget interface", () => {
    // `args` are the arguments the socket emits with the event. A server socket never emits 'open', so these tests call
    // emit() themselves.
    const eventTypes = [
      { type: "open", args: [], event: { class: "Event", target: true, type: "open" } },
      {
        type: "error",
        args: [new Error("boom")],
        event: { class: "ErrorEvent", error: 'Error "boom"', message: "boom", target: true, type: "error" },
      },
      {
        type: "close",
        args: [4000, Buffer.from("bye")],
        // The socket is still open, so no Close frame was sent or received.
        event: { class: "CloseEvent", code: 4000, reason: "bye", wasClean: false, target: true, type: "close" },
      },
      {
        type: "message",
        args: [Buffer.from("text"), false],
        event: { class: "MessageEvent", data: "text", target: true, type: "message" },
      },
    ];

    describe.each(eventTypes)("$type", ({ type, args, event }) => {
      const attribute = `on${type}`;

      // `count()` excludes the listeners added by the server and by openServer().
      async function open() {
        const server = await openServer(implementation);
        const ws: any = server.ws;
        const existing = ws.listenerCount(type);
        const count = () => ws.listenerCount(type) - existing;
        return { ws, existing, count, [Symbol.asyncDispose]: server[Symbol.asyncDispose] };
      }

      test(`${attribute} keeps a single handler, and assigning a non-function resets it to null`, async () => {
        await using socket = await open();
        const { ws, count } = socket;
        const state = () => ({ handler: ws[attribute], listeners: count() });
        const calls: string[] = [];
        const first = () => calls.push("first");
        const second = () => calls.push("second");

        expect(state()).toEqual({ handler: null, listeners: 0 });
        for (const value of [null, undefined, 42, "foo", {}]) {
          ws[attribute] = first;
          expect(state()).toEqual({ handler: first, listeners: 1 });
          ws[attribute] = value;
          expect(state()).toEqual({ handler: null, listeners: 0 });
        }

        ws[attribute] = first;
        ws[attribute] = second;
        expect(state()).toEqual({ handler: second, listeners: 1 });
        ws.emit(type, ...args);
        expect(calls).toEqual(["second"]);

        ws.removeAllListeners(type);
        expect(ws[attribute]).toBeNull();
      });

      test("listeners are called with a single event object", async () => {
        await using socket = await open();
        const { ws } = socket;
        const received: unknown[] = [];
        const record = (kind: string, expectedThis: () => unknown) =>
          function (this: unknown, ...args: unknown[]) {
            received.push({
              kind,
              arguments: args.length,
              this: this === expectedThis(),
              event: describeEvent(args[0], ws),
            });
          };
        // `handleEvent` is looked up at dispatch time, and only on non-function objects.
        const object: { handleEvent?: Function } = {};
        const functionWithHandleEvent = Object.assign(
          record("function", () => ws),
          { handleEvent: record("function.handleEvent", () => functionWithHandleEvent) },
        );

        ws[attribute] = record(attribute, () => ws);
        ws.addEventListener(
          type,
          record("addEventListener", () => ws),
        );
        ws.addEventListener(type, object);
        ws.addEventListener(type, functionWithHandleEvent);
        object.handleEvent = record("handleEvent", () => object);
        ws.emit(type, ...args);

        expect(received).toEqual(
          [attribute, "addEventListener", "handleEvent", "function"].map(kind => ({
            kind,
            arguments: 1,
            this: true,
            event,
          })),
        );
      });

      test("addEventListener() ignores duplicates, and { once: true } removes a listener before it runs", async () => {
        await using socket = await open();
        const { ws, count } = socket;
        const calls: [string, number][] = [];
        const listener = () => calls.push(["listener", count()]);
        const onceListener = () => calls.push(["once", count()]);

        ws.addEventListener(type, listener);
        ws.addEventListener(type, listener);
        ws.addEventListener(type, onceListener, { once: true });
        ws.addEventListener(type, onceListener, { once: true });
        expect(count()).toBe(2);

        ws.emit(type, ...args);
        ws.emit(type, ...args);
        expect(calls).toEqual([
          ["listener", 2],
          ["once", 1],
          ["listener", 1],
        ]);
      });

      test("removeEventListener() only removes listeners added with addEventListener()", async () => {
        await using socket = await open();
        const { ws, count } = socket;
        const calls: string[] = [];
        const shared = () => calls.push("shared");
        const onceListener = () => calls.push("once");
        const object = { handleEvent: () => calls.push("object") };
        const viaOn = () => calls.push("on");

        // The same function set as the attribute and added as a listener counts as two listeners.
        ws[attribute] = shared;
        ws.addEventListener(type, shared);
        ws.addEventListener(type, onceListener, { once: true });
        ws.addEventListener(type, object);
        ws.on(type, viaOn);
        expect(count()).toBe(5);

        ws.removeEventListener(type, shared);
        ws.removeEventListener(type, onceListener);
        ws.removeEventListener(type, object);
        ws.removeEventListener(type, viaOn);
        ws.removeEventListener(type, () => {});
        expect({ handler: ws[attribute], listeners: count() }).toEqual({ handler: shared, listeners: 2 });

        ws.emit(type, ...args);
        expect(calls).toEqual(["shared", "on"]);
      });

      test("off() and listeners() see a wrapper, not the original function", async () => {
        await using socket = await open();
        const { ws, existing, count } = socket;
        let calls = 0;
        const listener = () => calls++;

        ws.addEventListener(type, listener);
        ws.off(type, listener);
        const added = ws.listeners(type).slice(existing);
        expect(added).toEqual([expect.any(Function)]);
        expect(added[0]).not.toBe(listener);

        ws.off(type, added[0]);
        expect(count()).toBe(0);
        ws.emit(type, ...args);
        expect(calls).toBe(0);
      });

      test("on<event>, addEventListener() and on() listeners share one ordered listener list", async () => {
        await using socket = await open();
        const { ws } = socket;
        const calls: string[] = [];
        const named = (name: string) => () => calls.push(name);
        const run = (setup: () => void) => {
          ws.removeAllListeners(type);
          calls.length = 0;
          setup();
          const state = { handler: ws[attribute], listeners: ws.listenerCount(type) };
          ws.emit(type, ...args);
          ws.emit(type, ...args);
          return { ...state, calls: calls.join(",") };
        };
        const f = named("f");
        const a = named("a");
        const d = named("d");

        expect([
          run(() => {
            ws.addEventListener(type, f);
            ws[attribute] = f;
          }),
          // Reassigning the attribute moves its handler to the end.
          run(() => {
            ws[attribute] = a;
            ws.on(type, named("b"));
            ws.addEventListener(type, named("c"));
            ws[attribute] = d;
          }),
          run(() => {
            ws.on(type, named("on"));
            ws.prependListener(type, named("prepended"));
            ws[attribute] = named("attribute");
            ws.addEventListener(type, named("once"), { once: true });
          }),
          run(() => {
            ws.on(type, f);
            ws.addEventListener(type, f);
          }),
        ]).toEqual([
          { handler: f, listeners: 2, calls: "f,f,f,f" },
          { handler: d, listeners: 3, calls: "b,c,d,b,c,d" },
          {
            handler: expect.any(Function),
            listeners: 4,
            calls: "prepended,on,attribute,once,prepended,on,attribute",
          },
          { handler: null, listeners: 2, calls: "f,f,f,f" },
        ]);
      });
    });

    test("every socket uses the same class for each event type", async () => {
      await using first = await openServer(implementation);
      await using second = await openServer(implementation);
      const classes: Record<string, Function[]> = {};
      for (const { type, args } of eventTypes) {
        const seen: Function[] = (classes[type] = []);
        const record = (event: any) => seen.push(event.constructor);
        first.ws.addEventListener(type as any, record);
        (first.ws as any)[`on${type}`] = record;
        second.ws.addEventListener(type as any, record);
        first.ws.emit(type, ...args);
        second.ws.emit(type, ...args);
      }

      const [Event] = classes.open;
      expect(
        Object.entries(classes).map(([type, seen]) => ({
          type,
          events: seen.length,
          classes: new Set(seen).size,
          name: seen[0].name,
          extendsEvent: seen[0] === Event || Object.getPrototypeOf(seen[0].prototype) === Event.prototype,
        })),
      ).toEqual([
        { type: "open", events: 3, classes: 1, name: "Event", extendsEvent: true },
        { type: "error", events: 3, classes: 1, name: "ErrorEvent", extendsEvent: true },
        { type: "close", events: 3, classes: 1, name: "CloseEvent", extendsEvent: true },
        { type: "message", events: 3, classes: 1, name: "MessageEvent", extendsEvent: true },
      ]);
    });

    test("its six members are enumerable prototype properties", async () => {
      await using server = await openServer(implementation);
      const prototype = Object.getPrototypeOf(server.ws);
      const describeProperty = (name: string) => {
        const { get, set, value, ...flags } = Object.getOwnPropertyDescriptor(prototype, name)!;
        return value ? { ...flags, length: value.length } : { ...flags, accessor: !!get && !!set };
      };
      const accessor = { accessor: true, enumerable: true, configurable: true };
      const method = { length: 2, writable: true, enumerable: true, configurable: true };
      expect(
        ["onopen", "onerror", "onclose", "onmessage", "addEventListener", "removeEventListener"].map(describeProperty),
      ).toEqual([accessor, accessor, accessor, accessor, method, method]);
    });

    test("addEventListener() ignores unsupported event types", async () => {
      await using server = await openServer(implementation);
      const ws: any = server.ws;
      const types = ["upgrade", "unexpected-response", "redirect", "foo"];
      const before = types.map(type => ws.listenerCount(type));
      for (const type of types) ws.addEventListener(type, () => {});
      expect(types.map(type => ws.listenerCount(type))).toEqual(before);
    });

    // npm ws ignores these two as well. Bun's `ws` has always supported them, and heartbeat code relies on that.
    test.skipIf(!builtin)("addEventListener('ping' | 'pong') works", async () => {
      await using server = await openServer(implementation);
      const { client } = server;
      const ws: any = server.ws;
      const seen: string[] = [];
      const listener = (event: any) => seen.push(`${event.type} ${show(event.data)} ${event.target === ws}`);
      ws.addEventListener("ping", listener);
      ws.addEventListener("pong", listener);
      ws.addEventListener("pong", listener);
      ws.addEventListener("pong", () => seen.push("once"), { once: true });
      const lastPong = new Promise<void>(resolve => ws.on("pong", (data: Buffer) => String(data) === "c" && resolve()));
      client.ping("a");
      client.pong("b");
      client.pong("c");
      await lastPong;
      expect(seen).toEqual(['ping Buffer("a") true', 'pong Buffer("b") true', "once", 'pong Buffer("c") true']);

      ws.removeEventListener("ping", listener);
      ws.removeEventListener("pong", listener);
      client.pong("d");
      expect(await client.roundTrip()).toEqual(['pong "a"']);
      expect(seen).toHaveLength(4);
    });

    // Listeners added with on() aren't wrappers, so their wrapped function is `undefined`, which matches.
    test("removeEventListener(type, undefined) removes the first listener added with on()", async () => {
      await using server = await openServer(implementation);
      const { ws, wss, client, events } = server;
      // Removes watch()'s 'message' listener, and the 'close' listener that deletes the socket from `wss.clients`.
      ws.removeEventListener("message", undefined as any);
      ws.removeEventListener("close", undefined as any);
      client.text("text");
      client.close(1000);
      await server.closed;
      expect(events).toEqual(["close 1000 Buffer() rs=3"]);
      expect(wss.clients.size).toBe(1);
    });

    test("an on<event> setter calls the socket's addEventListener()", async () => {
      await using server = await openServer(implementation);
      const ws: any = server.ws;
      const types: string[] = [];
      ws.addEventListener = (type: string) => types.push(type);
      ws.onmessage = () => {};
      expect(types).toEqual(["message"]);
      expect(ws.onmessage).toBeNull();
    });

    test("with captureRejections, only a rejection from an on() listener is emitted as 'error'", async () => {
      const rejects = (name: string) => {
        const promise = Promise.reject(new Error(name));
        promise.catch(() => {});
        return () => promise;
      };
      EventEmitter.captureRejections = true;
      try {
        await using server = await openServer(implementation);
        const { ws } = server;
        const errors: string[] = [];
        const errorEmitted = new Promise<void>(resolve =>
          ws.on("error", error => {
            errors.push(error.message);
            if (error.message === "on()") resolve();
          }),
        );
        ws.onmessage = rejects("onmessage");
        ws.addEventListener("message", rejects("addEventListener()"));
        ws.addEventListener("message", { handleEvent: rejects("handleEvent()") } as any);
        ws.on("message", rejects("on()"));
        ws.emit("message", Buffer.from("text"), false);
        await errorEmitted;
        expect(errors).toEqual(["on()"]);
      } finally {
        EventEmitter.captureRejections = false;
      }
    });

    // binaryType only affects binary messages.
    test.each([
      { binaryType: "nodebuffer", binary: "Buffer(0x010203)" },
      { binaryType: "arraybuffer", binary: "ArrayBuffer(0x010203)" },
      { binaryType: "fragments", binary: "[Buffer(0x010203)]" },
      { binaryType: "blob", binary: "Blob(3)" },
    ])("with binaryType $binaryType, MessageEvent.data is a string for text and $binary for binary", async row => {
      await using server = await openServer(implementation);
      const { ws, client } = server;
      const seen: unknown[] = [];
      ws.binaryType = row.binaryType as typeof ws.binaryType;
      ws.onmessage = event => seen.push(describeEvent(event, ws));
      ws.addEventListener("message", event => seen.push(describeEvent(event, ws)));
      for (const text of ["ascii", "latin1-©", "utf8-😶", ""]) client.text(text);
      client.binary(Buffer.from([1, 2, 3]));
      expect(await client.roundTrip()).toEqual([]);
      expect(seen).toEqual(
        ["ascii", "latin1-©", "utf8-😶", "", row.binary].flatMap(data => {
          const event = { class: "MessageEvent", type: "message", data, target: true };
          return [event, event];
        }),
      );
    });

    test("onmessage = null removes the handler, and other listeners still get the next message", async () => {
      await using server = await openServer(implementation);
      const { ws, client, events } = server;
      let calls = 0;
      ws.onmessage = () => calls++;
      ws.onmessage = null;
      expect(ws.onmessage).toBeNull();
      client.text("x");
      expect(await client.roundTrip()).toEqual([]);
      expect(calls).toBe(0);
      expect(events).toEqual(['message Buffer("x") text rs=1']);
    });

    test("every kind of listener receives the peer's messages", async () => {
      await using server = await openServer(implementation);
      const { ws, client } = server;
      const existing = ws.listenerCount("message");
      const seen: string[] = [];
      const record = (name: string) => (event: { data: unknown }) => seen.push(`${name} ${event.data}`);
      const listener = record("listener");
      ws.addEventListener("message", listener);
      ws.addEventListener("message", listener);
      expect(ws.listenerCount("message") - existing).toBe(1);
      ws.addEventListener("message", record("once"), { once: true });
      ws.addEventListener("message", { handleEvent: record("handleEvent") } as any);
      client.text("a");
      client.text("b");
      expect(await client.roundTrip()).toEqual([]);
      ws.removeEventListener("message", listener);
      expect(ws.listenerCount("message") - existing).toBe(1);
      client.text("c");
      expect(await client.roundTrip()).toEqual([]);
      expect(seen).toEqual(["listener a", "once a", "handleEvent a", "listener b", "handleEvent b", "handleEvent c"]);
    });

    // wasClean is true when a Close frame was both sent and received.
    test.each([
      {
        how: "the peer closes with 4002",
        end: ({ client }) => client.close(4002, "why"),
        event: { code: 4002, reason: "why", wasClean: true },
      },
      {
        how: "the peer closes without a code",
        end: ({ client }) => client.close(),
        event: { code: 1005, reason: "", wasClean: true },
      },
      {
        how: "the peer drops the connection",
        end: ({ client }) => client.destroy(),
        event: { code: 1006, reason: "", wasClean: false },
      },
      {
        how: "close(4001) and the peer echoes it",
        end: ({ ws, client }) => (ws.close(4001, "srv"), client.close(4001, "srv")),
        event: { code: 4001, reason: "srv", wasClean: true },
      },
      {
        how: "close(4001) and the peer drops the connection",
        end: ({ ws, client }) => (ws.close(4001, "srv"), client.destroy()),
        event: { code: 1006, reason: "", wasClean: false },
      },
      {
        how: "terminate()",
        end: ({ ws }) => ws.terminate(),
        event: { code: 1006, reason: "", wasClean: false },
      },
    ] as { how: string; end(server: Server): void; event: object }[])(
      "CloseEvent after $how",
      async ({ end, event }) => {
        await using server = await openServer(implementation);
        const { ws } = server;
        const seen: unknown[] = [];
        ws.onerror = event => seen.push(describeEvent(event, ws));
        ws.onclose = event => seen.push(describeEvent(event, ws));
        ws.addEventListener("close", event => seen.push(describeEvent(event, ws)));
        end(server);
        await server.closed;
        const expected = { class: "CloseEvent", type: "close", ...event, target: true };
        expect(seen).toEqual([expected, expected]);
      },
    );

    test("a protocol error dispatches an ErrorEvent, then a CloseEvent with wasClean false", async () => {
      await using server = await openServer(implementation);
      const { ws, client } = server;
      const seen: unknown[] = [];
      ws.onerror = event => seen.push(describeEvent(event, ws));
      ws.onclose = event => seen.push(describeEvent(event, ws));
      client.send(3, "x");
      await server.closed;
      expect(seen).toEqual([
        {
          class: "ErrorEvent",
          type: "error",
          error: 'RangeError "Invalid WebSocket frame: invalid opcode 3" WS_ERR_INVALID_OPCODE',
          message: "Invalid WebSocket frame: invalid opcode 3",
          target: true,
        },
        { class: "CloseEvent", type: "close", code: 1006, reason: "", wasClean: false, target: true },
      ]);
      expect(await client.remainingFrames()).toEqual(["close 1002"]);
    });
  });
});
