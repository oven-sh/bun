// A `ws` client as an EventEmitter and as an EventTarget, against a raw TCP peer. See ws-raw-peer.ts.
import { describe, expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import { errorMonitor, EventEmitter, on, once } from "node:events";
import net from "node:net";
import path from "node:path";
import type { WebSocket as WsSocket } from "ws";
import {
  attempt,
  createPeer,
  event,
  implementations,
  OP,
  type PeerOptions,
  type RawSocket,
  response101,
  runScript,
  scriptTimeout,
  show,
  showError,
  type WsModule,
} from "./ws-raw-peer";

const silent: PeerOptions = { respond: () => null };
const hangsUp: PeerOptions = { respond: connection => (connection.end(), null) };
const notFound: PeerOptions = {
  respond: connection => (connection.socket.end("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n"), null),
};

const hangUp = 'Error "socket hang up" ECONNRESET';
const refused = 'Error "connect ECONNREFUSED 127.0.0.1:PORT" ECONNREFUSED';
const unexpected404 = 'Error "Unexpected server response: 404"';
const closedBeforeOpen = 'Error "WebSocket was closed before the connection was established"';
const invalidOpcode = 'RangeError "Invalid WebSocket frame: invalid opcode 3" WS_ERR_INVALID_OPCODE';

/**
 * A socket that has no listeners but those of the test. With the default peer it stays CONNECTING. `around` runs the
 * constructor call.
 */
async function bare(
  { WebSocket }: WsModule,
  peerOptions = silent,
  around = (construct: () => WsSocket) => construct(),
) {
  const peer = await createPeer(peerOptions);
  const ws = around(() => new WebSocket(peer.url));
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

/** The same, OPEN, with `conn`, the raw server's end of the connection. */
async function bareOpen(implementation: WsModule) {
  const client = await bare(implementation, {});
  const opened = event(client.ws, "open");
  const conn = await client.peer.connection();
  await opened;
  return { ...client, conn, [Symbol.asyncDispose]: client[Symbol.asyncDispose] };
}

/**
 * A URL that refuses connections. Its port is the client's end of a connection, so unlike a port that was closed it
 * cannot be given to a server of a test that runs at the same time.
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
      for (const each of [socket, ...accepted]) each.destroy();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

describe.each(implementations)("ws client, events ($name)", ({ ws: implementation, builtin, specifier }) => {
  const { WebSocket } = implementation;

  describe("on<event> attributes", () => {
    test.each(["open", "message", "error", "close"])(
      "on%s holds one function, a listener of the emitter",
      async type => {
        await using client = await bare(implementation);
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

    test("they are enumerable, configurable accessors of the prototype", () => {
      for (const attribute of ["onopen", "onmessage", "onerror", "onclose"]) {
        expect(Object.getOwnPropertyDescriptor(WebSocket.prototype, attribute)).toEqual({
          get: expect.any(Function),
          set: expect.any(Function),
          enumerable: true,
          configurable: true,
        });
      }
    });

    test("they do not show on() and addEventListener() listeners", async () => {
      await using client = await bare(implementation);
      const { ws } = client;
      ws.on("message", () => {});
      expect(ws.onmessage).toBe(null);
      ws.addEventListener("message", () => {});
      expect(ws.onmessage).toBe(null);
    });

    test("one function can be the attribute and an addEventListener() listener", async () => {
      await using client = await bare(implementation);
      const { ws } = client;
      const listener = () => {};
      ws.onmessage = listener;
      ws.addEventListener("message", listener);
      expect(ws.listenerCount("message")).toBe(2);
      ws.removeEventListener("message", listener);
      expect(ws.listenerCount("message")).toBe(1);
      expect(ws.onmessage).toBe(listener);
    });

    test("a new value goes to the end of the listeners", async () => {
      await using client = await bareOpen(implementation);
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
    test("adds a wrapper to the emitter, once for each listener", async () => {
      await using client = await bare(implementation);
      const { ws } = client;
      const listener = () => {};
      ws.addEventListener("message", listener);
      ws.addEventListener("message", listener);
      expect(ws.listenerCount("message")).toBe(1);
      expect(ws.listeners("message")[0]).not.toBe(listener);
      ws.removeEventListener("message", listener);
      expect(ws.listenerCount("message")).toBe(0);
    });

    test("removeEventListener() leaves on() listeners, off() leaves addEventListener() listeners", async () => {
      await using client = await bare(implementation);
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

    test("takes 'open', 'message', 'error' and 'close' only", async () => {
      await using client = await bare(implementation);
      const ws = client.ws as any;
      for (const type of ["foo", "upgrade", "unexpected-response", "redirect"]) {
        ws.addEventListener(type, () => {});
        expect(ws.listenerCount(type)).toBe(0);
      }
      expect(ws.emit("foo")).toBe(false);
      // Bun's `ws` has always taken these two as well.
      for (const type of ["ping", "pong"]) {
        ws.addEventListener(type, () => {});
        expect(ws.listenerCount(type)).toBe(builtin ? 1 : 0);
      }
    });

    test.skipIf(!builtin)("'ping' and 'pong' listeners get the payload as `data`", async () => {
      await using client = await bareOpen(implementation);
      const { conn } = client;
      const ws = client.ws as any;
      const seen: string[] = [];
      for (const type of ["ping", "pong"]) {
        ws.addEventListener(type as "open", (event: any) =>
          seen.push(`${event.type} ${show(event.data)} ${event.target === ws}`),
        );
      }
      const pong = event(ws, "pong");
      conn.ping("a");
      conn.pong("b");
      await pong;
      expect(seen).toEqual(['ping Buffer("a") true', 'pong Buffer("b") true']);
    });

    test("anything is taken for a listener", async () => {
      await using client = await bare(implementation);
      const ws = client.ws as any;
      expect([undefined, null, 5].map(listener => attempt(() => ws.addEventListener("message", listener)))).toEqual([
        "undefined",
        "undefined",
        "undefined",
      ]);
      expect(ws.listenerCount("message")).toBe(3);
    });

    test("{ once: true }, and an object with handleEvent()", async () => {
      await using client = await bareOpen(implementation);
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

    test("the `signal` option is ignored", async () => {
      await using client = await bareOpen(implementation);
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
      await using client = await bareOpen(implementation);
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

    test("the events are of ws's own small classes, not the global ones", async () => {
      await using client = await bare(implementation, {});
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
      await event(ws, "close");

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

    test("emit() reaches these listeners and the attributes", async () => {
      await using client = await bare(implementation);
      const { ws } = client;
      const seen: unknown[] = [];
      ws.addEventListener("message", event => seen.push(event.data));
      ws.onmessage = event => seen.push(event.data);
      expect(ws.emit("message", Buffer.from("x"), false)).toBe(true);
      expect(seen).toEqual(["x", "x"]);
    });
  });

  test("listeners run in the order they were added, however they were added", async () => {
    await using client = await bareOpen(implementation);
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
    test("before on(): each event reaches each listener once", async () => {
      await using client = await bare(implementation, {});
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
      await event(ws, "close");
      expect(calls).toEqual(["once open", "on open", "once 1", "on 1", "on 2", "once close", "on close"]);
    });

    test("between two on()", async () => {
      await using client = await bareOpen(implementation);
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
    ])("works again for '$type' after it has fired", async ({ type, opcode }) => {
      await using client = await bareOpen(implementation);
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

    test("listeners() gives the function, rawListeners() its wrapper", async () => {
      await using client = await bare(implementation);
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
      await using client = await bare(implementation, {});
      expect(await once(client.ws, "open")).toEqual([]);
      expect(client.ws.listenerCount("error")).toBe(0);
    });

    test("on(ws, 'message') iterates over the messages", async () => {
      await using client = await bareOpen(implementation);
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
      expect(thrown?.name).toBe("AbortError");
      expect(seen).toEqual(["1 false", "2 false"]);
    });

    test("the socket is an EventEmitter", () => {
      expect(WebSocket.prototype).toBeInstanceOf(EventEmitter);
    });
  });

  test("off() stops the delivery", async () => {
    await using client = await bareOpen(implementation);
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

  test("a listener added after removeAllListeners() gets the messages", async () => {
    await using client = await bareOpen(implementation);
    const { ws, conn } = client;
    const seen: string[] = [];
    ws.on("message", data => seen.push("removed " + data));
    ws.removeAllListeners();
    ws.on("message", data => seen.push("added " + data));
    conn.text("1");
    expect(await conn.roundTrip()).toEqual([]);
    expect(seen).toEqual(["added 1"]);
  });

  test("'newListener' and eventNames() see every kind of listener", async () => {
    await using client = await bare(implementation);
    const { ws } = client;
    const seen: string[] = [];
    ws.on("newListener", (name, listener) => seen.push(`${String(name)} ${listener.name}`));
    ws.on("error", function viaOn() {});
    ws.once("open", function viaOnce() {});
    ws.prependListener("close", function viaPrepend() {});
    ws.addEventListener("message", function viaAddEventListener() {});
    ws.onopen = function viaAttribute() {};
    // The last two are the wrappers.
    expect(seen).toEqual(["error viaOn", "open viaOnce", "close viaPrepend", "message onMessage", "open onOpen"]);
    expect(ws.eventNames()).toEqual(["newListener", "error", "open", "close", "message"]);
  });

  test("on() throws for a listener that is not a function", async () => {
    await using client = await bare(implementation);
    expect(attempt(() => client.ws.on("message", undefined as any))).toBe(
      'throws TypeError "The \\"listener\\" argument must be of type function. Received undefined" ERR_INVALID_ARG_TYPE',
    );
    expect(client.ws.listenerCount("message")).toBe(0);
  });

  test("the 11th listener of an event gives a MaxListenersExceededWarning, however it was added", async () => {
    await using client = await bare(implementation);
    const { ws } = client;
    const warnings: string[] = [];
    const both = Promise.withResolvers<void>();
    const onWarning = (warning: any) => {
      if (warning.emitter !== ws) return;
      warnings.push(`${warning.name} ${warning.type} ${warning.count}`);
      if (warnings.length === 2) both.resolve();
    };
    process.on("warning", onWarning);
    try {
      for (let i = 0; i < 11; i++) ws.on("message", () => {});
      for (let i = 0; i < 11; i++) ws.addEventListener("close", () => {});
      await both.promise;
    } finally {
      process.off("warning", onWarning);
    }
    expect(warnings).toEqual(["MaxListenersExceededWarning message 11", "MaxListenersExceededWarning close 11"]);
  });

  describe("AsyncLocalStorage", () => {
    test("every event runs in the context of the constructor call", async () => {
      const storage = new AsyncLocalStorage<string>();
      await using client = await bare(implementation, {}, construct => storage.run("constructor", construct));
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
      await event(ws, "close");
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

    test("so do 'error' and 'close' of a failed handshake", async () => {
      const storage = new AsyncLocalStorage<string>();
      await using client = await bare(implementation, hangsUp, construct => storage.run("constructor", construct));
      const { ws } = client;
      const stores: string[] = [];
      for (const type of ["error", "close"]) ws.on(type, () => stores.push(`${type} ${storage.getStore()}`));
      await event(ws, "close");
      expect(stores).toEqual(["error constructor", "close constructor"]);
    });
  });

  describe("'error' with a listener", () => {
    type Hear = (as: string) => (value: any) => void;
    const hearInto =
      (lines: string[]): Hear =>
      as =>
      value => {
        const error =
          value instanceof Error ? showError(value) : `${value.constructor.name}(${showError(value.error)})`;
        lines.push(`${as} ${error}`);
      };
    const inEvent = `ErrorEvent(${hangUp})`;

    test.each([
      { name: "on()", arm: (ws, hear) => ws.on("error", hear("on")), heard: [`on ${hangUp}`], left: 1 },
      { name: "once()", arm: (ws, hear) => ws.once("error", hear("once")), heard: [`once ${hangUp}`], left: 0 },
      {
        name: "once(), then on()",
        arm: (ws, hear) => ws.once("error", hear("once")).on("error", hear("on")),
        heard: [`once ${hangUp}`, `on ${hangUp}`],
        left: 1,
      },
      {
        name: "on(), then once()",
        arm: (ws, hear) => ws.on("error", hear("on")).once("error", hear("once")),
        heard: [`on ${hangUp}`, `once ${hangUp}`],
        left: 1,
      },
      {
        name: "once() twice",
        arm: (ws, hear) => ws.once("error", hear("first")).once("error", hear("second")),
        heard: [`first ${hangUp}`, `second ${hangUp}`],
        left: 0,
      },
      {
        name: "prependListener()",
        arm: (ws, hear) => ws.prependListener("error", hear("prepend")),
        heard: [`prepend ${hangUp}`],
        left: 1,
      },
      {
        name: "prependOnceListener()",
        arm: (ws, hear) => ws.prependOnceListener("error", hear("prepend")),
        heard: [`prepend ${hangUp}`],
        left: 0,
      },
      {
        name: "on(), then on(errorMonitor)",
        arm: (ws, hear) => ws.on("error", hear("on")).on(errorMonitor, hear("monitor")),
        heard: [`monitor ${hangUp}`, `on ${hangUp}`],
        left: 1,
      },
      { name: "onerror", arm: (ws, hear) => (ws.onerror = hear("onerror")), heard: [`onerror ${inEvent}`], left: 1 },
      {
        name: "addEventListener()",
        arm: (ws, hear) => ws.addEventListener("error", hear("listener")),
        heard: [`listener ${inEvent}`],
        left: 1,
      },
      {
        name: "addEventListener() with handleEvent()",
        arm: (ws, hear) => ws.addEventListener("error", { handleEvent: hear("handleEvent") } as any),
        heard: [`handleEvent ${inEvent}`],
        left: 1,
      },
      {
        name: "addEventListener() with { once: true }",
        arm: (ws, hear) => ws.addEventListener("error", hear("listener"), { once: true }),
        heard: [`listener ${inEvent}`],
        left: 0,
      },
      {
        name: "addEventListener() with { capture: true, once: true }",
        arm: (ws, hear) => ws.addEventListener("error", hear("listener"), { capture: true, once: true } as any),
        heard: [`listener ${inEvent}`],
        left: 0,
      },
      {
        name: "onerror, then on(), then addEventListener()",
        arm: (ws, hear) => {
          ws.onerror = hear("onerror");
          ws.on("error", hear("on"));
          ws.addEventListener("error", hear("listener"));
        },
        heard: [`onerror ${inEvent}`, `on ${hangUp}`, `listener ${inEvent}`],
        left: 3,
      },
    ] as { name: string; arm(ws: WsSocket, hear: Hear): unknown; heard: string[]; left: number }[])(
      "$name: heard once, then 'close' 1006",
      async ({ arm, heard, left }) => {
        await using client = await bare(implementation, hangsUp);
        const { ws } = client;
        const lines: string[] = [];
        arm(ws, hearInto(lines));
        ws.on("close", code => lines.push("close " + code));
        await event(ws, "close");
        expect(lines).toEqual([...heard, "close 1006"]);
        expect(ws.listenerCount("error")).toBe(left);
      },
    );

    test.each([
      { name: "onerror", arm: (ws, listener) => (ws.onerror = listener) },
      { name: "addEventListener()", arm: (ws, listener) => ws.addEventListener("error", listener) },
    ] as { name: string; arm(ws: WsSocket, listener: (event: any) => void): unknown }[])(
      "$name alone handles a refused connection",
      async ({ arm }) => {
        await using target = await refusingUrl();
        const ws = new WebSocket(target.url);
        const seen: string[] = [];
        arm(ws, event => seen.push(`${event.constructor.name} ${showError(event.error)}`));
        await event(ws, "close");
        expect(seen).toEqual([`ErrorEvent ${refused}`]);
      },
    );

    test.each([
      { name: "with", upgrade: true },
      { name: "without", upgrade: false },
    ])("a 404 is the same Error for every kind of listener, $name an 'upgrade' listener", async ({ upgrade }) => {
      await using client = await bare(implementation, notFound);
      const { ws } = client;
      const lines: string[] = [];
      const hear = hearInto(lines);
      if (upgrade) ws.on("upgrade", () => lines.push("upgrade"));
      ws.on("error", hear("on"));
      ws.onerror = hear("onerror");
      ws.addEventListener("error", hear("listener"));
      await event(ws, "close");
      expect(lines).toEqual([
        `on ${unexpected404}`,
        `onerror ErrorEvent(${unexpected404})`,
        `listener ErrorEvent(${unexpected404})`,
      ]);
    });

    test("two bad frames and a reset give one 'error'", async () => {
      await using client = await bareOpen(implementation);
      const { ws, conn } = client;
      const errors: string[] = [];
      ws.on("error", error => errors.push(showError(error)));
      const closed = event(ws, "close");
      conn.write(Buffer.concat([conn.frame(3, "x"), conn.frame(3, "y")]));
      expect(await conn.next()).toBe("close 1002");
      conn.reset();
      await closed;
      expect(errors).toEqual([invalidOpcode]);
    });
  });

  test("a connection that is lost after 'open' is no 'error': nothing is thrown without a listener", async () => {
    await using client = await bareOpen(implementation);
    client.conn.end();
    expect((await event(client.ws, "close")).map(show)).toEqual(["1006", "Buffer()"]);
  });

  // `WS_URL` is a raw server of this process, or for "refuses" a port on which nothing listens. `lines` is what the
  // child printed and `exit <code>`.
  async function child(script: string, target: PeerOptions | "refuses", drive?: (conn: RawSocket) => unknown) {
    await using peer = target === "refuses" ? undefined : await createPeer(target);
    await using refusing = peer ? undefined : await refusingUrl();
    const result = runScript({ specifier }, script, { WS_URL: (peer ?? refusing)!.url });
    if (drive) await drive(await peer!.connection());
    const { lines, stderr, exitCode } = await result;
    return { lines: [...lines, "exit " + exitCode], stderr, handshakes: peer?.connections.length };
  }
  const dial = "const ws = new WebSocket(process.env.WS_URL);";

  // No child needs a timer or an exit() call: once the handshake has failed nothing keeps its event loop alive.
  describe("'error' without a listener is thrown", () => {
    test.concurrent.each([
      { name: "no listener at all", script: dial },
      {
        name: "'upgrade', 'open', 'message' and 'close' listeners: none is called, not even 'close'",
        script: `${dial} for (const type of ["upgrade", "open", "message", "close"]) ws.on(type, () => console.log(type));`,
      },
      {
        name: "an 'error' listener that off() has removed",
        script: `${dial} const listener = () => console.log("removed"); ws.on("error", listener); ws.off("error", listener);`,
      },
      {
        name: "an errorMonitor listener, which hears it first",
        script: `${dial} ws.on(require("node:events").errorMonitor, error => console.log("monitor " + showError(error)));`,
        heard: ["monitor " + hangUp],
      },
      {
        name: "onerror set, then set to null",
        script: `${dial} ws.onerror = () => console.log("removed"); ws.onerror = null;`,
      },
      { name: "onerror set to an object", script: `${dial} ws.onerror = {};` },
      {
        name: "addEventListener(), then removeEventListener()",
        script: `${dial} const listener = () => console.log("removed");
          ws.addEventListener("error", listener); ws.removeEventListener("error", listener);`,
      },
      { name: "in a subclass", script: `new (class extends WebSocket {})(process.env.WS_URL);` },
      {
        name: "with the finishRequest option",
        script: `new WebSocket(process.env.WS_URL, { finishRequest: request => request.end() });`,
      },
      {
        name: "from a socket that nothing refers to",
        script: `(() => void new WebSocket(process.env.WS_URL))(); Bun.gc(true);`,
      },
    ] as { name: string; script: string; heard?: string[] }[])(
      "$name",
      async ({ script, heard = [] }) => {
        expect((await child(script, hangsUp)).lines).toEqual([...heard, "uncaught " + hangUp, "exit 0"]);
      },
      scriptTimeout,
    );

    const atExit = `process.on("exit", () => console.log("rs=" + ws.readyState));`;
    test.concurrent.each([
      { name: "a refused connection", peer: "refuses", script: dial, lines: ["uncaught " + refused] },
      { name: "a 404", peer: notFound, script: dial, lines: ["uncaught " + unexpected404] },
      {
        name: "a 404, with an 'upgrade' listener",
        peer: notFound,
        script: `${dial} ws.on("upgrade", () => console.log("upgrade"));`,
        lines: ["uncaught " + unexpected404],
      },
      {
        name: "a wrong Sec-WebSocket-Accept",
        peer: { respond: connection => response101(connection, [], { "Sec-WebSocket-Accept": "AAAA" }) },
        script: dial,
        lines: ['uncaught Error "Invalid Sec-WebSocket-Accept header"'],
      },
      {
        name: "close() before the server has answered",
        peer: silent,
        script: `${dial} ${atExit} ws.close();`,
        lines: ["uncaught " + closedBeforeOpen, "rs=2"],
      },
      {
        name: "terminate() before the server has answered",
        peer: silent,
        script: `${dial} ${atExit} ws.terminate();`,
        lines: ["uncaught " + closedBeforeOpen, "rs=2"],
      },
    ] as { name: string; peer: PeerOptions | "refuses"; script: string; lines: string[] }[])(
      "$name",
      async ({ peer, script, lines }) => {
        expect((await child(script, peer)).lines).toEqual([...lines, "exit 0"]);
      },
      scriptTimeout,
    );

    test.concurrent.skipIf(isWindows)(
      "a unix socket that does not exist",
      async () => {
        using dir = tempDir("ws-events", {});
        const socketPath = path.join(String(dir), "missing.sock");
        const { lines, exitCode } = await runScript({ specifier }, dial, { WS_URL: "ws+unix:" + socketPath });
        expect(lines.map(line => line.replace(socketPath, "<path>"))).toEqual([
          'uncaught Error "connect ENOENT <path>" ENOENT',
        ]);
        expect(exitCode).toBe(0);
      },
      scriptTimeout,
    );

    test.concurrent(
      "a protocol error after 'open': the Close frame goes out all the same, and 'close' comes",
      async () => {
        const script = `${dial}
        ws.on("open", () => console.log("open"));
        process.on("uncaughtException", () => console.log("rs=" + ws.readyState));
        // The peer ends the connection when it has the Close frame. That ends the process.
        ws.on("close", (code, reason) => console.log("close " + code + " " + show(reason) + " rs=" + ws.readyState));`;
        let sent = "";
        const { lines } = await child(script, {}, async conn => {
          conn.send(3, "x");
          sent = await conn.next();
          conn.end();
        });
        expect(sent).toBe("close 1002");
        expect(lines).toEqual(["open", "uncaught " + invalidOpcode, "rs=2", "close 1006 Buffer() rs=3", "exit 0"]);
      },
      scriptTimeout,
    );

    test.concurrent(
      "an 'error' listener that throws: its exception, and no 'close'",
      async () => {
        const { lines } = await child(
          `${dial}
        ws.on("error", () => { throw new Error("thrown by the listener"); });
        ws.on("close", () => console.log("close"));`,
          hangsUp,
        );
        expect(lines).toEqual(['uncaught Error "thrown by the listener"', "exit 0"]);
      },
      scriptTimeout,
    );

    // Here nothing listens for 'uncaughtException'.
    test.concurrent.each([
      {
        name: "a refused connection, no listener",
        peer: "refuses",
        listeners: "",
        error: "connect ECONNREFUSED 127.0.0.1:PORT",
      },
      {
        name: "a connection that ends, 'open' and 'message' listeners",
        peer: hangsUp,
        listeners: `ws.on("open", () => console.log("open")); ws.on("message", () => console.log("message"));`,
        error: "socket hang up",
      },
      {
        name: "a 404, an 'open' listener",
        peer: notFound,
        listeners: `ws.on("open", () => console.log("open"));`,
        error: "Unexpected server response: 404",
      },
    ] as { name: string; peer: PeerOptions | "refuses"; listeners: string; error: string }[])(
      "$name: the process prints the Error and exits with 1",
      async ({ peer, listeners, error }) => {
        const { lines, stderr } = await child(
          `process.removeAllListeners("uncaughtException"); ${dial} ${listeners}`,
          peer,
        );
        const errors = stderr.split(/\r?\n/).filter(line => /^error: /i.test(line));
        expect(errors.map(line => line.slice(7).replace(/(127\.0\.0\.1:)\d+/, "$1PORT"))).toEqual([error]);
        expect(lines).toEqual(["exit 1"]);
      },
      scriptTimeout,
    );

    test.concurrent(
      "in a Worker: the Worker fails with it",
      async () => {
        const { lines } = await child(
          `const source = "new (require(process.env.WS_SPECIFIER).WebSocket)(process.env.WS_URL);";
        const worker = new Worker(URL.createObjectURL(new Blob([source])));
        worker.addEventListener("error", event => console.log(/^error: .*$/m.exec(event.message)[0]));
        // The end of the Worker ends the process.
        worker.addEventListener("close", event => console.log("close " + event.code));`,
          hangsUp,
        );
        expect(lines).toEqual(["error: socket hang up", "close 1", "exit 0"]);
      },
      scriptTimeout,
    );
  });

  describe("nothing is thrown", () => {
    test.concurrent(
      "when events.once(ws, 'open') is all that listens to a refused connection",
      async () => {
        const { lines } = await child(
          `${dial} require("node:events").once(ws, "open").catch(error => console.log("rejected " + showError(error)));`,
          "refuses",
        );
        expect(lines).toEqual(["rejected " + refused, "exit 0"]);
      },
      scriptTimeout,
    );

    test.concurrent(
      "when an 'unexpected-response' listener takes the 404",
      async () => {
        const { lines } = await child(
          `${dial}
        // The peer closes the connection after its answer. That ends the process.
        ws.on("unexpected-response", (request, response) => console.log("unexpected-response " + response.statusCode));`,
          notFound,
        );
        expect(lines).toEqual(["unexpected-response 404", "exit 0"]);
      },
      scriptTimeout,
    );

    test.concurrent(
      "when the server terminates in 'connection': 'open', then 'close' 1006",
      async () => {
        const { lines, exitCode } = await runScript(
          { specifier },
          `const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
        wss.on("connection", ws => ws.terminate());
        wss.on("listening", () => {
          const ws = new WebSocket("ws://127.0.0.1:" + wss.address().port);
          ws.on("open", () => console.log("open"));
          // Closing the server ends the process.
          ws.on("close", code => (console.log("close " + code), wss.close()));
        });`,
        );
        expect(lines).toEqual(["open", "close 1006"]);
        expect(exitCode).toBe(0);
      },
      scriptTimeout,
    );

    test.concurrent(
      "when finishRequest ends the request later: one handshake, with what it added",
      async () => {
        const { lines, handshakes } = await child(
          `const ws = new WebSocket(process.env.WS_URL, {
          finishRequest(request) {
            setImmediate(() => {
              request.setHeader("authorization", "late");
              request.end();
            });
          },
        });
        // terminate() ends the process.
        ws.on("open", () => (console.log("open"), ws.terminate()));`,
          {
            respond: connection =>
              connection.header("authorization") === "late"
                ? response101(connection)
                : (connection.socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n"), null),
          },
        );
        expect(lines).toEqual(["open", "exit 0"]);
        expect(handshakes).toBe(1);
      },
      scriptTimeout,
    );
  });

  test.concurrent(
    "an async listener that rejects is an unhandled rejection, not an 'error'",
    async () => {
      const { lines } = await child(
        `${dial}
      ws.on("error", error => console.log("error " + showError(error)));
      ws.on("message", async () => { throw new Error("async boom"); });
      // terminate() ends the process.
      process.on("unhandledRejection", error => (console.log("unhandledRejection " + showError(error)), ws.terminate()));`,
        {},
        conn => conn.text("1"),
      );
      expect(lines).toEqual(['unhandledRejection Error "async boom"', "exit 0"]);
    },
    scriptTimeout,
  );
});
