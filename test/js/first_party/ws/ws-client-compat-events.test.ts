// EventEmitter and EventTarget behavior of a `ws` client, tested against a raw TCP peer. See ws-raw-peer.ts.
import { describe, expect, test } from "bun:test";
import { bunEnv, isWindows, tempDir } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import { errorMonitor, EventEmitter, on, once } from "node:events";
import net from "node:net";
import path from "node:path";
import type { WebSocket as WsSocket } from "ws";
import {
  createPeer,
  implementations,
  nextEvent,
  OP,
  type PeerOptions,
  type RawSocket,
  response101,
  runScript,
  scriptTimeout,
  show,
  showError,
  tryCall,
  type WsModule,
} from "./ws-raw-peer";

const neverResponds: PeerOptions = { respond: () => null };
const hangsUp: PeerOptions = { respond: connection => (connection.end(), null) };
const notFound: PeerOptions = {
  respond: connection => (connection.socket.end("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n"), null),
};

const socketHangUp = 'Error "socket hang up" ECONNRESET';
const connectionRefused = 'Error "connect ECONNREFUSED 127.0.0.1:PORT" ECONNREFUSED';
const unexpected404 = 'Error "Unexpected server response: 404"';
const closedBeforeOpen = 'Error "WebSocket was closed before the connection was established"';
const invalidOpcode = 'RangeError "Invalid WebSocket frame: invalid opcode 3" WS_ERR_INVALID_OPCODE';
/** The arguments of 'close' when no Close frame arrived, as `show()` formats them. */
const abnormalCloseArgs = ["1006", "Buffer()"];

/**
 * A socket with no listeners except the ones the test adds. With the default peer it stays CONNECTING.
 * `runConstructor` lets a test wrap the constructor call, e.g. in AsyncLocalStorage.run().
 */
async function bareClient(
  { WebSocket }: WsModule,
  peerOptions = neverResponds,
  runConstructor = (construct: () => WsSocket) => construct(),
) {
  const peer = await createPeer(peerOptions);
  const ws = runConstructor(() => new WebSocket(peer.url));
  return {
    peer,
    ws,
    async [Symbol.asyncDispose]() {
      ws.on("error", () => {});
      ws.terminate();
      await peer[Symbol.asyncDispose]();
    },
  };
}

/** Like `bareClient()` but OPEN, plus `conn`, the raw server's end of the connection. */
async function openBareClient(implementation: WsModule) {
  const client = await bareClient(implementation, {});
  const opened = nextEvent(client.ws, "open");
  const conn = await client.peer.connection();
  await opened;
  return { ...client, conn, [Symbol.asyncDispose]: client[Symbol.asyncDispose] };
}

/**
 * A URL that refuses connections. Its port is in use as the local port of an open client connection, so unlike a port
 * that was just closed, the OS can't assign it to a server in a test that runs concurrently.
 */
async function refusingUrl() {
  const accepted: net.Socket[] = [];
  const server = net.createServer(socket => accepted.push(socket)).listen(0, "127.0.0.1");
  await once(server, "listening");
  const socket = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
  await once(socket, "connect");
  return {
    url: "ws://127.0.0.1:" + socket.localPort,
    async [Symbol.asyncDispose]() {
      for (const connection of [socket, ...accepted]) connection.destroy();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

describe.each(implementations)("ws client events ($name)", ({ ws: implementation, builtin }) => {
  const { WebSocket } = implementation;

  describe("on<event> attributes", () => {
    test.each(["open", "message", "error", "close"])(
      "on%s stores a single function and registers it as an emitter listener",
      async type => {
        await using client = await bareClient(implementation);
        const ws = client.ws as any;
        const attribute = "on" + type;
        const first = () => {};
        const second = () => {};
        expect(ws[attribute]).toBe(null);

        ws[attribute] = first;
        expect(ws[attribute]).toBe(first);
        expect(ws.listenerCount(type)).toBe(1);
        ws[attribute] = second;
        expect(ws[attribute]).toBe(second);
        expect(ws.listenerCount(type)).toBe(1);

        for (const value of [null, "string", {}, undefined]) {
          ws[attribute] = first;
          ws[attribute] = value;
          expect(ws[attribute]).toBe(null);
          expect(ws.listenerCount(type)).toBe(0);
        }
      },
    );

    test("are enumerable, configurable accessors on the prototype", () => {
      for (const attribute of ["onopen", "onmessage", "onerror", "onclose"]) {
        expect(Object.getOwnPropertyDescriptor(WebSocket.prototype, attribute)).toEqual({
          get: expect.any(Function),
          set: expect.any(Function),
          enumerable: true,
          configurable: true,
        });
      }
    });

    test("don't return listeners added with on() or addEventListener()", async () => {
      await using client = await bareClient(implementation);
      const { ws } = client;
      ws.on("message", () => {});
      expect(ws.onmessage).toBe(null);
      ws.addEventListener("message", () => {});
      expect(ws.onmessage).toBe(null);
    });

    test("the same function can be both the attribute and an addEventListener() listener", async () => {
      await using client = await bareClient(implementation);
      const { ws } = client;
      const listener = () => {};
      ws.onmessage = listener;
      ws.addEventListener("message", listener);
      expect(ws.listenerCount("message")).toBe(2);
      ws.removeEventListener("message", listener);
      expect(ws.listenerCount("message")).toBe(1);
      expect(ws.onmessage).toBe(listener);
    });

    test("reassigning moves the handler to the end of the listener list", async () => {
      await using client = await openBareClient(implementation);
      const { ws, conn } = client;
      const order: string[] = [];
      ws.onmessage = () => order.push("first value");
      ws.on("message", () => order.push("on"));
      ws.onmessage = () => order.push("second value");
      conn.text("1");
      expect(await conn.roundTrip()).toEqual([]);
      expect(order).toEqual(["on", "second value"]);
    });
  });

  describe("addEventListener()", () => {
    test("adds a wrapper to the emitter and ignores duplicate listeners", async () => {
      await using client = await bareClient(implementation);
      const { ws } = client;
      const listener = () => {};
      ws.addEventListener("message", listener);
      ws.addEventListener("message", listener);
      expect(ws.listenerCount("message")).toBe(1);
      expect(ws.listeners("message")[0]).not.toBe(listener);
      ws.removeEventListener("message", listener);
      expect(ws.listenerCount("message")).toBe(0);
    });

    test("removeEventListener() ignores on() listeners and off() ignores addEventListener() listeners", async () => {
      await using client = await bareClient(implementation);
      const { ws } = client;
      const listener = () => {};
      ws.on("message", listener);
      ws.removeEventListener("message", listener);
      expect(ws.listenerCount("message")).toBe(1);
      ws.off("message", listener);

      ws.addEventListener("message", listener);
      ws.off("message", listener);
      expect(ws.listenerCount("message")).toBe(1);
      ws.removeAllListeners("message");
      expect(ws.listenerCount("message")).toBe(0);
    });

    test("only accepts 'open', 'message', 'error' and 'close'", async () => {
      await using client = await bareClient(implementation);
      const ws = client.ws as any;
      for (const type of ["foo", "upgrade", "unexpected-response", "redirect"]) {
        ws.addEventListener(type, () => {});
        expect(ws.listenerCount(type)).toBe(0);
      }
      expect(ws.emit("foo")).toBe(false);
      // Bun's `ws` has always accepted these two as well.
      for (const type of ["ping", "pong"]) {
        ws.addEventListener(type, () => {});
        expect(ws.listenerCount(type)).toBe(builtin ? 1 : 0);
      }
    });

    test.skipIf(!builtin)("'ping' and 'pong' listeners receive the payload as `event.data`", async () => {
      await using client = await openBareClient(implementation);
      const { conn } = client;
      const ws = client.ws as any;
      const seen: string[] = [];
      for (const type of ["ping", "pong"]) {
        ws.addEventListener(type as "open", (event: any) =>
          seen.push(`${event.type} ${show(event.data)} ${event.target === ws}`),
        );
      }
      const pong = nextEvent(ws, "pong");
      conn.ping("a");
      conn.pong("b");
      await pong;
      expect(seen).toEqual(['ping Buffer("a") true', 'pong Buffer("b") true']);
    });

    test("doesn't validate the listener", async () => {
      await using client = await bareClient(implementation);
      const ws = client.ws as any;
      expect([undefined, null, 5].map(listener => tryCall(() => ws.addEventListener("message", listener)))).toEqual([
        "undefined",
        "undefined",
        "undefined",
      ]);
      expect(ws.listenerCount("message")).toBe(3);
    });

    test("supports { once: true } and objects with handleEvent()", async () => {
      await using client = await openBareClient(implementation);
      const { ws, conn } = client;
      const seen: unknown[] = [];
      ws.addEventListener("message", event => seen.push(["once", event.data]), { once: true });
      const object = {
        handleEvent(event: any) {
          seen.push(["handleEvent", event.data, this === object]);
        },
      };
      ws.addEventListener("message", object as any);
      conn.text("1");
      conn.text("2");
      expect(await conn.roundTrip()).toEqual([]);
      const expected = [
        ["once", "1"],
        ["handleEvent", "1", true],
        ["handleEvent", "2", true],
      ];
      expect(seen).toEqual(expected);

      ws.removeEventListener("message", object as any);
      conn.text("3");
      expect(await conn.roundTrip()).toEqual([]);
      expect(seen).toEqual(expected);
    });

    test("ignores the `signal` option", async () => {
      await using client = await openBareClient(implementation);
      const { ws, conn } = client;
      const controller = new AbortController();
      let calls = 0;
      ws.addEventListener("message", () => calls++, { signal: controller.signal } as any);
      conn.text("1");
      expect(await conn.roundTrip()).toEqual([]);
      controller.abort();
      conn.text("2");
      expect(await conn.roundTrip()).toEqual([]);
      expect(calls).toBe(2);
    });

    test("`this` and `event.target` are the socket", async () => {
      await using client = await openBareClient(implementation);
      const { ws, conn } = client;
      const seen: unknown[] = [];
      function listener(this: unknown, event: any) {
        seen.push({ this: this === ws, target: event.target === ws, currentTarget: event.currentTarget });
      }
      ws.addEventListener("message", listener);
      ws.onmessage = listener;
      conn.text("1");
      expect(await conn.roundTrip()).toEqual([]);
      const expected = { this: true, target: true, currentTarget: undefined };
      expect(seen).toEqual([expected, expected]);
    });

    test("events are instances of ws's own minimal classes, not the global ones", async () => {
      await using client = await bareClient(implementation, {});
      const { ws } = client;
      const seen: unknown[] = [];
      for (const type of ["open", "message", "error", "close"] as const) {
        ws.addEventListener(type as "open", (event: any) =>
          seen.push({
            type: event.type,
            class: event.constructor.name,
            global: event instanceof (globalThis as any)[event.constructor.name] || event instanceof Event,
            keys: Object.keys(event),
            rest: [event.bubbles, event.isTrusted, event.timeStamp, event.origin],
          }),
        );
      }
      let errorEvent: any;
      ws.addEventListener("error", event => (errorEvent = event));
      const conn = await client.peer.connection();
      conn.text("1");
      conn.send(3, "x");
      conn.end();
      await nextEvent(ws, "close");

      const common = { global: false, keys: [], rest: [undefined, undefined, undefined, undefined] };
      expect(seen).toEqual([
        { type: "open", class: "Event", ...common },
        { type: "message", class: "MessageEvent", ...common },
        { type: "error", class: "ErrorEvent", ...common },
        { type: "close", class: "CloseEvent", ...common },
      ]);
      expect(showError(errorEvent.error)).toBe(invalidOpcode);
      expect(errorEvent.message).toBe(errorEvent.error.message);
    });

    test("emit() calls addEventListener() listeners and on<event> attributes", async () => {
      await using client = await bareClient(implementation);
      const { ws } = client;
      const seen: unknown[] = [];
      ws.addEventListener("message", event => seen.push(event.data));
      ws.onmessage = event => seen.push(event.data);
      expect(ws.emit("message", Buffer.from("x"), false)).toBe(true);
      expect(seen).toEqual(["x", "x"]);
    });
  });

  test("listeners run in insertion order regardless of how they were added", async () => {
    await using client = await openBareClient(implementation);
    const { ws, conn } = client;
    const order: string[] = [];
    ws.on("message", () => order.push("on 1"));
    ws.addEventListener("message", () => order.push("addEventListener 1"));
    ws.onmessage = () => order.push("onmessage");
    ws.on("message", () => order.push("on 2"));
    ws.addEventListener("message", () => order.push("addEventListener 2"));
    ws.prependListener("message", () => order.push("prependListener"));
    conn.text("1");
    expect(await conn.roundTrip()).toEqual([]);
    expect(order).toEqual(["prependListener", "on 1", "addEventListener 1", "onmessage", "on 2", "addEventListener 2"]);
  });

  describe("once()", () => {
    test("before on(): both listeners fire, once() only for the first event", async () => {
      await using client = await bareClient(implementation, {});
      const { ws } = client;
      const calls: string[] = [];
      ws.once("open", () => calls.push("once open"));
      ws.on("open", () => calls.push("on open"));
      ws.once("message", data => calls.push("once " + data));
      ws.on("message", data => calls.push("on " + data));
      ws.once("close", () => calls.push("once close"));
      ws.on("close", () => calls.push("on close"));
      const conn = await client.peer.connection();
      conn.text("1");
      conn.text("2");
      conn.close(1000);
      conn.end();
      await nextEvent(ws, "close");
      expect(calls).toEqual(["once open", "on open", "once 1", "on 1", "on 2", "once close", "on close"]);
    });

    test("between two on() listeners", async () => {
      await using client = await openBareClient(implementation);
      const { ws, conn } = client;
      const calls: string[] = [];
      ws.on("message", data => calls.push("first on " + data));
      ws.once("message", data => calls.push("once " + data));
      ws.on("message", data => calls.push("second on " + data));
      conn.text("1");
      conn.text("2");
      expect(await conn.roundTrip()).toEqual([]);
      expect(calls).toEqual(["first on 1", "once 1", "second on 1", "first on 2", "second on 2"]);
    });

    test.each([
      { type: "message", opcode: OP.text },
      { type: "ping", opcode: OP.ping },
      { type: "pong", opcode: OP.pong },
    ])("can be registered again for '$type' after it fires", async ({ type, opcode }) => {
      await using client = await openBareClient(implementation);
      const { ws, conn } = client;
      const seen: string[] = [];
      for (const payload of ["1", "2", "3"]) {
        const fired = new Promise<void>(resolve => ws.once(type, data => (seen.push(String(data)), resolve())));
        conn.send(opcode, payload);
        await fired;
        expect(ws.listenerCount(type)).toBe(0);
      }
      expect(seen).toEqual(["1", "2", "3"]);
    });

    test("listeners() returns the function, rawListeners() returns its wrapper", async () => {
      await using client = await bareClient(implementation);
      const { ws } = client;
      const listener = () => {};
      ws.once("message", listener);
      expect(ws.listeners("message")).toEqual([listener]);
      expect((ws.rawListeners("message")[0] as any).listener).toBe(listener);
      expect(ws.listenerCount("message")).toBe(1);
    });
  });

  describe("node:events", () => {
    test("once(ws, 'open') resolves with no arguments and leaves no 'error' listener", async () => {
      await using client = await bareClient(implementation, {});
      expect(await once(client.ws, "open")).toEqual([]);
      expect(client.ws.listenerCount("error")).toBe(0);
    });

    test("on(ws, 'message') iterates over the messages", async () => {
      await using client = await openBareClient(implementation);
      const { ws, conn } = client;
      conn.text("1");
      conn.text("2");
      const controller = new AbortController();
      const seen: string[] = [];
      let thrown: any;
      try {
        for await (const [data, isBinary] of on(ws, "message", { signal: controller.signal })) {
          seen.push(`${data} ${isBinary}`);
          if (seen.length === 2) controller.abort();
        }
      } catch (error) {
        thrown = error;
      }
      expect({ thrown: [thrown?.name, thrown?.code], seen }).toEqual({
        thrown: ["AbortError", "ABORT_ERR"],
        seen: ["1 false", "2 false"],
      });
    });

    test("WebSocket extends EventEmitter", () => {
      expect(WebSocket.prototype).toBeInstanceOf(EventEmitter);
    });
  });

  test("off() stops delivery", async () => {
    await using client = await openBareClient(implementation);
    const { ws, conn } = client;
    let calls = 0;
    const listener = () => calls++;
    ws.on("message", listener);
    conn.text("1");
    expect(await conn.roundTrip()).toEqual([]);
    ws.off("message", listener);
    conn.text("2");
    expect(await conn.roundTrip()).toEqual([]);
    expect(calls).toBe(1);
    expect(ws.listenerCount("message")).toBe(0);
  });

  test("a listener added after removeAllListeners() still receives messages", async () => {
    await using client = await openBareClient(implementation);
    const { ws, conn } = client;
    const seen: string[] = [];
    ws.on("message", data => seen.push("removed " + data));
    ws.removeAllListeners();
    ws.on("message", data => seen.push("added " + data));
    conn.text("1");
    expect(await conn.roundTrip()).toEqual([]);
    expect(seen).toEqual(["added 1"]);
  });

  test("'newListener' and eventNames() report every kind of listener", async () => {
    await using client = await bareClient(implementation);
    const { ws } = client;
    const seen: string[] = [];
    ws.on("newListener", (name, listener) => seen.push(`${String(name)} ${listener.name}`));
    ws.on("error", function viaOn() {});
    ws.once("open", function viaOnce() {});
    ws.prependListener("close", function viaPrepend() {});
    ws.addEventListener("message", function viaAddEventListener() {});
    ws.onopen = function viaAttribute() {};
    // The last two names belong to ws's wrapper functions.
    expect(seen).toEqual(["error viaOn", "open viaOnce", "close viaPrepend", "message onMessage", "open onOpen"]);
    expect(ws.eventNames()).toEqual(["newListener", "error", "open", "close", "message"]);
  });

  test("on() throws if the listener isn't a function", async () => {
    await using client = await bareClient(implementation);
    expect(tryCall(() => client.ws.on("message", undefined as any))).toBe(
      'throws TypeError "The \\"listener\\" argument must be of type function. Received undefined" ERR_INVALID_ARG_TYPE',
    );
    expect(client.ws.listenerCount("message")).toBe(0);
  });

  test("the 11th listener triggers MaxListenersExceededWarning regardless of how it was added", async () => {
    await using client = await bareClient(implementation);
    const { ws } = client;
    const warnings: string[] = [];
    const bothWarnings = Promise.withResolvers<void>();
    const onWarning = (warning: any) => {
      if (warning.emitter !== ws) return;
      warnings.push(`${warning.name} ${warning.type} ${warning.count}`);
      if (warnings.length === 2) bothWarnings.resolve();
    };
    process.on("warning", onWarning);
    try {
      for (let i = 0; i < 11; i++) ws.on("message", () => {});
      for (let i = 0; i < 11; i++) ws.addEventListener("close", () => {});
      await bothWarnings.promise;
    } finally {
      process.off("warning", onWarning);
    }
    expect(warnings).toEqual(["MaxListenersExceededWarning message 11", "MaxListenersExceededWarning close 11"]);
  });

  describe("AsyncLocalStorage", () => {
    test("every event runs in the constructor call's async context", async () => {
      const storage = new AsyncLocalStorage<string>();
      await using client = await bareClient(implementation, {}, construct => storage.run("constructor", construct));
      const { ws } = client;
      const stores: string[] = [];
      for (const type of ["upgrade", "open", "message", "ping", "pong", "close"]) {
        ws.on(type, () => stores.push(`${type} ${storage.getStore()}`));
      }
      ws.addEventListener("message", () => stores.push(`addEventListener ${storage.getStore()}`));
      ws.onclose = () => stores.push(`onclose ${storage.getStore()}`);
      const conn = await client.peer.connection();
      conn.text("1");
      conn.ping();
      conn.pong();
      conn.close(1000);
      conn.end();
      await nextEvent(ws, "close");
      expect(stores).toEqual([
        "upgrade constructor",
        "open constructor",
        "message constructor",
        "addEventListener constructor",
        "ping constructor",
        "pong constructor",
        "close constructor",
        "onclose constructor",
      ]);
    });

    test("so do 'error' and 'close' after a failed handshake", async () => {
      const storage = new AsyncLocalStorage<string>();
      await using client = await bareClient(implementation, hangsUp, construct =>
        storage.run("constructor", construct),
      );
      const { ws } = client;
      const stores: string[] = [];
      for (const type of ["error", "close"]) ws.on(type, () => stores.push(`${type} ${storage.getStore()}`));
      await nextEvent(ws, "close");
      expect(stores).toEqual(["error constructor", "close constructor"]);
    });
  });

  describe("'error' with a listener", () => {
    type Recorder = (label: string) => (value: any) => void;
    const recordInto =
      (lines: string[]): Recorder =>
      label =>
      value => {
        const error =
          value instanceof Error ? showError(value) : `${value.constructor.name}(${showError(value.error)})`;
        lines.push(`${label} ${error}`);
      };
    const hangUpEvent = `ErrorEvent(${socketHangUp})`;

    test.each([
      {
        name: "on()",
        listen: (ws, record) => ws.on("error", record("on")),
        expected: [`on ${socketHangUp}`],
        remaining: 1,
      },
      {
        name: "once()",
        listen: (ws, record) => ws.once("error", record("once")),
        expected: [`once ${socketHangUp}`],
        remaining: 0,
      },
      {
        name: "once(), then on()",
        listen: (ws, record) => ws.once("error", record("once")).on("error", record("on")),
        expected: [`once ${socketHangUp}`, `on ${socketHangUp}`],
        remaining: 1,
      },
      {
        name: "on(), then once()",
        listen: (ws, record) => ws.on("error", record("on")).once("error", record("once")),
        expected: [`on ${socketHangUp}`, `once ${socketHangUp}`],
        remaining: 1,
      },
      {
        name: "once() twice",
        listen: (ws, record) => ws.once("error", record("first")).once("error", record("second")),
        expected: [`first ${socketHangUp}`, `second ${socketHangUp}`],
        remaining: 0,
      },
      {
        name: "prependListener()",
        listen: (ws, record) => ws.prependListener("error", record("prepend")),
        expected: [`prepend ${socketHangUp}`],
        remaining: 1,
      },
      {
        name: "prependOnceListener()",
        listen: (ws, record) => ws.prependOnceListener("error", record("prepend")),
        expected: [`prepend ${socketHangUp}`],
        remaining: 0,
      },
      {
        name: "on(), then on(errorMonitor)",
        listen: (ws, record) => ws.on("error", record("on")).on(errorMonitor, record("monitor")),
        expected: [`monitor ${socketHangUp}`, `on ${socketHangUp}`],
        remaining: 1,
      },
      {
        name: "onerror",
        listen: (ws, record) => (ws.onerror = record("onerror")),
        expected: [`onerror ${hangUpEvent}`],
        remaining: 1,
      },
      {
        name: "addEventListener()",
        listen: (ws, record) => ws.addEventListener("error", record("listener")),
        expected: [`listener ${hangUpEvent}`],
        remaining: 1,
      },
      {
        name: "addEventListener() with handleEvent()",
        listen: (ws, record) => ws.addEventListener("error", { handleEvent: record("handleEvent") } as any),
        expected: [`handleEvent ${hangUpEvent}`],
        remaining: 1,
      },
      {
        name: "addEventListener() with { once: true }",
        listen: (ws, record) => ws.addEventListener("error", record("listener"), { once: true }),
        expected: [`listener ${hangUpEvent}`],
        remaining: 0,
      },
      {
        name: "addEventListener() with { capture: true, once: true }",
        listen: (ws, record) => ws.addEventListener("error", record("listener"), { capture: true, once: true } as any),
        expected: [`listener ${hangUpEvent}`],
        remaining: 0,
      },
      {
        name: "onerror, then on(), then addEventListener()",
        listen: (ws, record) => {
          ws.onerror = record("onerror");
          ws.on("error", record("on"));
          ws.addEventListener("error", record("listener"));
        },
        expected: [`onerror ${hangUpEvent}`, `on ${socketHangUp}`, `listener ${hangUpEvent}`],
        remaining: 3,
      },
    ] as { name: string; listen(ws: WsSocket, record: Recorder): unknown; expected: string[]; remaining: number }[])(
      "$name: each listener is called once, then 'close' 1006 is emitted",
      async ({ listen, expected, remaining }) => {
        await using client = await bareClient(implementation, hangsUp);
        const { ws } = client;
        const lines: string[] = [];
        listen(ws, recordInto(lines));
        ws.on("close", code => lines.push("close " + code));
        await nextEvent(ws, "close");
        expect(lines).toEqual([...expected, "close 1006"]);
        expect(ws.listenerCount("error")).toBe(remaining);
      },
    );

    test.each([
      { name: "onerror", listen: (ws, listener) => (ws.onerror = listener) },
      { name: "addEventListener()", listen: (ws, listener) => ws.addEventListener("error", listener) },
    ] as { name: string; listen(ws: WsSocket, listener: (event: any) => void): unknown }[])(
      "$name alone is enough to handle a refused connection",
      async ({ listen }) => {
        await using target = await refusingUrl();
        const ws = new WebSocket(target.url);
        const seen: string[] = [];
        listen(ws, event => seen.push(`${event.constructor.name} ${showError(event.error)}`));
        const closed = (await nextEvent(ws, "close")).map(show);
        expect({ seen, closed }).toEqual({ seen: [`ErrorEvent ${connectionRefused}`], closed: abnormalCloseArgs });
      },
    );

    test.each([
      { name: "with", upgrade: true },
      { name: "without", upgrade: false },
    ])("every kind of listener gets the same Error for a 404, $name an 'upgrade' listener", async ({ upgrade }) => {
      await using client = await bareClient(implementation, notFound);
      const { ws } = client;
      const lines: string[] = [];
      const record = recordInto(lines);
      if (upgrade) ws.on("upgrade", () => lines.push("upgrade"));
      ws.on("error", record("on"));
      ws.onerror = record("onerror");
      ws.addEventListener("error", record("listener"));
      const closed = (await nextEvent(ws, "close")).map(show);
      expect({ lines, closed }).toEqual({
        lines: [`on ${unexpected404}`, `onerror ErrorEvent(${unexpected404})`, `listener ErrorEvent(${unexpected404})`],
        closed: abnormalCloseArgs,
      });
    });

    test("two invalid frames and a reset emit only one 'error'", async () => {
      await using client = await openBareClient(implementation);
      const { ws, conn } = client;
      const errors: string[] = [];
      ws.on("error", error => errors.push(showError(error)));
      const closed = nextEvent(ws, "close");
      conn.write(Buffer.concat([conn.frame(3, "x"), conn.frame(3, "y")]));
      expect(await conn.next()).toBe("close 1002");
      conn.reset();
      expect({ closed: (await closed).map(show), errors }).toEqual({
        closed: abnormalCloseArgs,
        errors: [invalidOpcode],
      });
    });
  });

  test("a connection dropped after 'open' doesn't emit 'error', so nothing throws without a listener", async () => {
    await using client = await openBareClient(implementation);
    client.conn.end();
    expect((await nextEvent(client.ws, "close")).map(show)).toEqual(abnormalCloseArgs);
  });
});

// `bun run testleak` turns `print_suppressions` on, which puts LeakSanitizer's list of used suppressions on stderr.
const childEnv = { LSAN_OPTIONS: [bunEnv.LSAN_OPTIONS, "print_suppressions=0"].filter(Boolean).join(":") };

/**
 * Runs `script` in a child process. `WS_URL` points to a raw server in this process, or for "refuses" to a port
 * nothing listens on. Returns what `runScript()` returns plus `handshakes`: how many upgrade requests the raw server
 * received.
 */
async function runChild(
  specifier: string,
  script: string,
  target: PeerOptions | "refuses",
  drive?: (conn: RawSocket) => unknown,
) {
  await using peer = target === "refuses" ? undefined : await createPeer(target);
  await using refusing = peer ? undefined : await refusingUrl();
  const result = runScript({ specifier }, script, { ...childEnv, WS_URL: (peer ?? refusing)!.url });
  if (drive) {
    // A child that exits before it connects fails its test on what it printed, not on the timeout.
    const conn = await Promise.race([peer!.connection(), result.then(() => undefined)]);
    if (conn) await drive(conn);
  }
  return { ...(await result), handshakes: peer?.connections.length };
}
const connect = "const ws = new WebSocket(process.env.WS_URL);";

/** What a child returns if it printed `lines`, wrote nothing to stderr and exited with code 0. */
const cleanExit = (lines: string[], handshakes?: number) => ({ lines, stderr: "", exitCode: 0, handshakes });

// First, so that the other child-process tests overlap these two: their children exit slowest under LeakSanitizer.
describe.concurrent.each(implementations)("ws client events ($name)", ({ specifier }) => {
  describe("'error' without a listener throws", () => {
    test(
      "in a Worker, the error terminates the Worker",
      async () => {
        const child = await runChild(
          specifier,
          `const source = "new (require(process.env.WS_SPECIFIER).WebSocket)(process.env.WS_URL);";
        const worker = new Worker(URL.createObjectURL(new Blob([source])));
        worker.addEventListener("error", event => console.log(/^error: .*$/m.exec(event.message)[0]));
        // The process exits once the Worker does.
        worker.addEventListener("close", event => console.log("close " + event.code));`,
          hangsUp,
        );
        expect(child).toEqual(cleanExit(["error: socket hang up", "close 1"], 1));
      },
      scriptTimeout,
    );
  });

  describe("nothing throws", () => {
    test(
      "when the server calls terminate() in 'connection': emits 'open', then 'close' 1006",
      async () => {
        const child = await runScript(
          { specifier },
          `const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
        wss.on("connection", ws => ws.terminate());
        wss.on("listening", () => {
          const ws = new WebSocket("ws://127.0.0.1:" + wss.address().port);
          ws.on("open", () => console.log("open"));
          // Closing the server lets the process exit.
          ws.on("close", code => (console.log("close " + code), wss.close()));
        });`,
          childEnv,
        );
        expect(child).toEqual(cleanExit(["open", "close 1006"]));
      },
      scriptTimeout,
    );
  });
});

// Not in the first describe.each(), so that the children of both implementations run as one concurrent group.
describe.concurrent.each(implementations)("ws client events ($name)", ({ specifier }) => {
  // The children need no timer or exit() call. Once the handshake fails, nothing keeps their event loop alive.
  describe("'error' without a listener throws", () => {
    test.each([
      { name: "no listener at all", script: connect },
      {
        name: "'upgrade', 'open', 'message' and 'close' listeners, none of which are called",
        script: `${connect} for (const type of ["upgrade", "open", "message", "close"]) ws.on(type, () => console.log(type));`,
      },
      {
        name: "an 'error' listener removed with off()",
        script: `${connect} const listener = () => console.log("removed"); ws.on("error", listener); ws.off("error", listener);`,
      },
      {
        name: "an errorMonitor listener, which is called first",
        script: `${connect} ws.on(require("node:events").errorMonitor, error => console.log("monitor " + showError(error)));`,
        printed: ["monitor " + socketHangUp],
      },
      {
        name: "onerror set, then set to null",
        script: `${connect} ws.onerror = () => console.log("removed"); ws.onerror = null;`,
      },
      { name: "onerror set to an object", script: `${connect} ws.onerror = {};` },
      {
        name: "addEventListener(), then removeEventListener()",
        script: `${connect} const listener = () => console.log("removed");
          ws.addEventListener("error", listener); ws.removeEventListener("error", listener);`,
      },
      { name: "in a subclass", script: `new (class extends WebSocket {})(process.env.WS_URL);` },
      {
        name: "with the finishRequest option",
        script: `new WebSocket(process.env.WS_URL, { finishRequest: request => request.end() });`,
      },
      {
        name: "from an unreferenced socket",
        script: `(() => void new WebSocket(process.env.WS_URL))(); Bun.gc(true);`,
      },
    ] as { name: string; script: string; printed?: string[] }[])(
      "$name",
      async ({ script, printed = [] }) => {
        const child = await runChild(specifier, script, hangsUp);
        expect(child).toEqual(cleanExit([...printed, "uncaught " + socketHangUp], 1));
      },
      scriptTimeout,
    );

    const atExit = `process.on("exit", () => console.log("rs=" + ws.readyState));`;
    test.each([
      { name: "a refused connection", peer: "refuses", script: connect, lines: ["uncaught " + connectionRefused] },
      { name: "a 404", peer: notFound, script: connect, lines: ["uncaught " + unexpected404], handshakes: 1 },
      {
        name: "a 404, with an 'upgrade' listener",
        peer: notFound,
        script: `${connect} ws.on("upgrade", () => console.log("upgrade"));`,
        lines: ["uncaught " + unexpected404],
        handshakes: 1,
      },
      {
        name: "a wrong Sec-WebSocket-Accept",
        peer: { respond: connection => response101(connection, [], { "Sec-WebSocket-Accept": "AAAA" }) },
        script: connect,
        lines: ['uncaught Error "Invalid Sec-WebSocket-Accept header"'],
        handshakes: 1,
      },
      // A socket that is closed in the tick that created it never sends its request.
      {
        name: "close() before the server responds",
        peer: neverResponds,
        script: `${connect} ${atExit} ws.close();`,
        lines: ["uncaught " + closedBeforeOpen, "rs=2"],
        handshakes: 0,
      },
      {
        name: "terminate() before the server responds",
        peer: neverResponds,
        script: `${connect} ${atExit} ws.terminate();`,
        lines: ["uncaught " + closedBeforeOpen, "rs=2"],
        handshakes: 0,
      },
    ] as { name: string; peer: PeerOptions | "refuses"; script: string; lines: string[]; handshakes?: number }[])(
      "$name",
      async ({ peer, script, lines, handshakes }) => {
        expect(await runChild(specifier, script, peer)).toEqual(cleanExit(lines, handshakes));
      },
      scriptTimeout,
    );

    test.skipIf(isWindows)(
      "a unix socket that doesn't exist",
      async () => {
        using dir = tempDir("ws-events", {});
        const socketPath = path.join(String(dir), "missing.sock");
        const env = { ...childEnv, WS_URL: "ws+unix:" + socketPath };
        const { lines, ...rest } = await runScript({ specifier }, connect, env);
        expect({ lines: lines.map(line => line.replace(socketPath, "<path>")), ...rest }).toEqual(
          cleanExit(['uncaught Error "connect ENOENT <path>" ENOENT']),
        );
      },
      scriptTimeout,
    );

    test(
      "a protocol error after 'open' still sends the Close frame and emits 'close'",
      async () => {
        const script = `${connect}
        ws.on("open", () => console.log("open"));
        process.on("uncaughtException", () => console.log("rs=" + ws.readyState));
        // The peer closes the connection once it gets the Close frame, which lets the process exit.
        ws.on("close", (code, reason) => console.log("close " + code + " " + show(reason) + " rs=" + ws.readyState));`;
        let sent = "";
        const child = await runChild(specifier, script, {}, async conn => {
          conn.send(3, "x");
          sent = await conn.next();
          conn.end();
        });
        expect({ sent, ...child }).toEqual({
          sent: "close 1002",
          ...cleanExit(["open", "uncaught " + invalidOpcode, "rs=2", "close 1006 Buffer() rs=3"], 1),
        });
      },
      scriptTimeout,
    );

    test(
      "when an 'error' listener throws, its exception propagates and 'close' isn't emitted",
      async () => {
        const child = await runChild(
          specifier,
          `${connect}
        ws.on("error", () => { throw new Error("thrown by the listener"); });
        ws.on("close", () => console.log("close"));`,
          hangsUp,
        );
        expect(child).toEqual(cleanExit(['uncaught Error "thrown by the listener"'], 1));
      },
      scriptTimeout,
    );

    // These remove the 'uncaughtException' listener that runScript() installs.
    test.each([
      {
        name: "a refused connection, no listener",
        peer: "refuses",
        listeners: "",
        error: "connect ECONNREFUSED 127.0.0.1:PORT",
      },
      {
        name: "a hang-up, 'open' and 'message' listeners",
        peer: hangsUp,
        listeners: `ws.on("open", () => console.log("open")); ws.on("message", () => console.log("message"));`,
        error: "socket hang up",
        handshakes: 1,
      },
      {
        name: "a 404, an 'open' listener",
        peer: notFound,
        listeners: `ws.on("open", () => console.log("open"));`,
        error: "Unexpected server response: 404",
        handshakes: 1,
      },
    ] as { name: string; peer: PeerOptions | "refuses"; listeners: string; error: string; handshakes?: number }[])(
      "$name: the process prints the error and exits with code 1",
      async ({ peer, listeners, error, handshakes }) => {
        const { stderr, ...child } = await runChild(
          specifier,
          `process.removeAllListeners("uncaughtException"); ${connect} ${listeners}`,
          peer,
        );
        const errors = stderr.split(/\r?\n/).filter(line => /^error: /i.test(line));
        expect(errors.map(line => line.slice(7).replace(/(127\.0\.0\.1:)\d+/, "$1PORT"))).toEqual([error]);
        expect(child).toEqual({ lines: [], exitCode: 1, handshakes });
      },
      scriptTimeout,
    );
  });

  describe("nothing throws", () => {
    test(
      "when events.once(ws, 'open') is the only listener on a refused connection",
      async () => {
        const child = await runChild(
          specifier,
          `${connect} require("node:events").once(ws, "open").catch(error => console.log("rejected " + showError(error)));`,
          "refuses",
        );
        expect(child).toEqual(cleanExit(["rejected " + connectionRefused]));
      },
      scriptTimeout,
    );

    test(
      "when an 'unexpected-response' listener handles the 404",
      async () => {
        const child = await runChild(
          specifier,
          `${connect}
        // The peer closes the connection after responding, which lets the process exit.
        ws.on("unexpected-response", (request, response) => console.log("unexpected-response " + response.statusCode));`,
          notFound,
        );
        expect(child).toEqual(cleanExit(["unexpected-response 404"], 1));
      },
      scriptTimeout,
    );

    test(
      "when finishRequest ends the request asynchronously: sends one handshake, with the header it added",
      async () => {
        const child = await runChild(
          specifier,
          `const ws = new WebSocket(process.env.WS_URL, {
          finishRequest(request) {
            setImmediate(() => {
              request.setHeader("authorization", "late");
              request.end();
            });
          },
        });
        // terminate() lets the process exit.
        ws.on("open", () => (console.log("open"), ws.terminate()));`,
          {
            respond: connection =>
              connection.header("authorization") === "late"
                ? response101(connection)
                : (connection.socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n"), null),
          },
        );
        expect(child).toEqual(cleanExit(["open"], 1));
      },
      scriptTimeout,
    );
  });

  test(
    "an async listener that rejects causes an unhandled rejection, not an 'error'",
    async () => {
      const child = await runChild(
        specifier,
        `${connect}
      ws.on("error", error => console.log("error " + showError(error)));
      ws.on("message", async () => { throw new Error("async boom"); });
      // terminate() lets the process exit.
      process.on("unhandledRejection", error => (console.log("unhandledRejection " + showError(error)), ws.terminate()));`,
        {},
        conn => conn.text("1"),
      );
      expect(child).toEqual(cleanExit(['unhandledRejection Error "async boom"'], 1));
    },
    scriptTimeout,
  );
});
