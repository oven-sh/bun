// What `ws` exports, the shape of the WebSocket class and of its instances, and the small methods. See ws-raw-peer.ts.
import { describe, expect, test } from "bun:test";
import EventEmitter from "node:events";
import util from "node:util";
import * as builtinNamespace from "ws";
import * as npmNamespace from "../../../node_modules/ws/wrapper.mjs";
import {
  closedPort,
  createPeer,
  dial,
  event,
  implementations,
  openClient,
  openServer,
  runScript,
  scriptTimeout,
} from "./ws-raw-peer";

const opening = ["upgrade 101 rs=0", "open rs=1"];
const readyStates = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"];
const readOnlyAttributes = ["bufferedAmount", "extensions", "isPaused", "protocol", "readyState", "url"];
const writableAttributes = ["binaryType", "onclose", "onerror", "onmessage", "onopen"];
// What `for (const key in ws)` and `Object.keys(WebSocket.prototype)` give.
const enumerable = [
  ...readyStates,
  ...readOnlyAttributes,
  ...writableAttributes,
  "addEventListener",
  "removeEventListener",
].sort();
const methods = [
  "close",
  "constructor",
  "emitClose",
  "pause",
  "ping",
  "pong",
  "resume",
  "send",
  "setSocket",
  "terminate",
];

describe.each(implementations)("ws, shape ($name)", ({ ws: implementation, builtin, specifier }) => {
  const { WebSocket, WebSocketServer } = implementation;

  describe("the module", () => {
    test("is the WebSocket class, with the other exports as its properties", () => {
      expect(Object.keys(implementation)).toEqual(
        expect.arrayContaining([
          ...readyStates,
          "Receiver",
          "Sender",
          "Server",
          "WebSocket",
          "WebSocketServer",
          "createWebSocketStream",
        ]),
      );
      expect(implementation.WebSocket).toBe(implementation);
      expect(implementation.Server).toBe(implementation.WebSocketServer);
      expect(
        [implementation.WebSocket, implementation.WebSocketServer, implementation.createWebSocketStream].map(
          fn => `${fn.name}/${fn.length}`,
        ),
      ).toEqual(["WebSocket/3", "WebSocketServer/2", "createWebSocketStream/2"]);
      expect(Object.prototype.toString.call(WebSocket)).toBe("[object Function]");
    });

    test("has npm's named exports as an ES module", () => {
      const namespace: Record<string, unknown> = builtin ? builtinNamespace : npmNamespace;
      expect(Object.keys(namespace)).toEqual(
        expect.arrayContaining([
          "Receiver",
          "Sender",
          "WebSocket",
          "WebSocketServer",
          "createWebSocketStream",
          "default",
        ]),
      );
      expect(namespace.default).toBe(implementation);
      expect(namespace.WebSocket).toBe(implementation);
      expect(namespace.WebSocketServer).toBe(WebSocketServer);
      expect(namespace.createWebSocketStream).toBe(implementation.createWebSocketStream);
    });

    // npm's wrapper.mjs does not have these. Code written for Bun imports them.
    test.skipIf(!builtin)("has `Server` and the ready states as named exports too", () => {
      expect(builtinNamespace).toMatchObject({
        Server: WebSocketServer,
        CONNECTING: 0,
        OPEN: 1,
        CLOSING: 2,
        CLOSED: 3,
      });
    });
  });

  describe("the class", () => {
    test.each(readyStates.map((name, value) => ({ name, value })))(
      "$name is $value, read-only and enumerable, on the class and on the prototype",
      ({ name, value }) => {
        const descriptor = { value, writable: false, enumerable: true, configurable: false };
        expect(Object.getOwnPropertyDescriptor(WebSocket, name)).toEqual(descriptor);
        expect(Object.getOwnPropertyDescriptor(WebSocket.prototype, name)).toEqual(descriptor);
      },
    );

    test.each([
      ...readOnlyAttributes.map(name => ({ name, set: "undefined" as const })),
      ...writableAttributes.map(name => ({ name, set: "function" as const })),
    ])("$name is an enumerable accessor of the prototype, setter: $set", ({ name, set }) => {
      const descriptor = Object.getOwnPropertyDescriptor(WebSocket.prototype, name)!;
      expect({ ...descriptor, get: typeof descriptor.get, set: typeof descriptor.set }).toEqual({
        enumerable: true,
        configurable: true,
        get: "function",
        set,
      });
    });

    test("the properties of the prototypes", () => {
      expect(Object.getOwnPropertyNames(WebSocket.prototype).sort()).toEqual([...enumerable, ...methods].sort());
      expect(Object.keys(WebSocket.prototype).sort()).toEqual(enumerable);
      expect(Object.getOwnPropertyNames(WebSocketServer.prototype).sort()).toEqual([
        "address",
        "close",
        "completeUpgrade",
        "constructor",
        "handleUpgrade",
        "shouldHandle",
      ]);
      expect(Object.getPrototypeOf(WebSocket.prototype)).toBe(EventEmitter.prototype);
      expect(Object.getPrototypeOf(WebSocketServer.prototype)).toBe(EventEmitter.prototype);
    });

    test("the `length` of the methods", () => {
      const lengths = {
        send: 3,
        close: 2,
        ping: 3,
        pong: 3,
        terminate: 0,
        pause: 0,
        resume: 0,
        addEventListener: 2,
        removeEventListener: 2,
      };
      const names = Object.keys(lengths);
      expect(Object.fromEntries(names.map(name => [name, WebSocket.prototype[name].length]))).toEqual(lengths);
    });

    test("a patch of WebSocket.prototype reaches client and server sockets", async () => {
      const { send } = WebSocket.prototype;
      const patched: unknown[] = [];
      WebSocket.prototype.send = function (this: unknown, ...args: any) {
        patched.push(this);
        return send.apply(this, args);
      };
      try {
        await using server = await openServer(implementation);
        await using client = await openClient(implementation, { perMessageDeflate: false });
        server.ws.send("from the server");
        client.ws.send("from the client");
        expect(await server.client.next()).toBe('text "from the server"');
        expect(await client.conn.next()).toBe('text "from the client"');
        expect(patched.length).toBe(2);
        expect(patched[0]).toBe(server.ws);
        expect(patched[1]).toBe(client.ws);
      } finally {
        WebSocket.prototype.send = send;
      }
    });
  });

  describe("a client socket", () => {
    test("is a plain EventEmitter object of the class, with no public property of its own", async () => {
      await using client = await dial(implementation);
      const { ws } = client;
      expect(ws).toBeInstanceOf(WebSocket);
      expect(ws).toBeInstanceOf(EventEmitter);
      expect(ws.constructor).toBe(WebSocket);
      expect(Object.getPrototypeOf(ws)).toBe(WebSocket.prototype);
      expect(Object.prototype.toString.call(ws)).toBe("[object Object]");
      expect(Object.keys(ws).filter(key => !key.startsWith("_"))).toEqual([]);
    });

    test("for...in gives the attributes", async () => {
      await using client = await dial(implementation);
      const keys: string[] = [];
      for (const key in client.ws) if (!key.startsWith("_") && !(key in EventEmitter.prototype)) keys.push(key);
      expect(keys.sort()).toEqual(enumerable);
    });

    test("util.inspect() names the class", async () => {
      await using client = await dial(implementation);
      expect(util.inspect(client.ws, { depth: 0 })).toStartWith("WebSocket {\n");
    });

    test("JSON.stringify() gives no public key", async () => {
      await using client = await dial(implementation);
      // `_req` is the request in flight, which is circular on Node.js too.
      const json = JSON.stringify(client.ws, (key, value) => (key === "_req" ? undefined : value));
      expect(Object.keys(JSON.parse(json)).filter(key => !key.startsWith("_"))).toEqual([]);
    });

    test.each([...readOnlyAttributes, "OPEN"])("assigning to %s throws a TypeError", async name => {
      await using client = await dial(implementation);
      const ws: Record<string, any> = client.ws;
      const before = ws[name];
      expect(() => {
        ws[name] = 1234;
      }).toThrow(TypeError);
      expect(ws[name]).toBe(before);
    });

    test("binaryType takes the four known values and ignores the rest", async () => {
      await using client = await dial(implementation);
      const ws: { binaryType: unknown } = client.ws;
      expect(ws.binaryType).toBe("nodebuffer");
      const results = ["arraybuffer", "fragments", "blob", "nodebuffer", "foo", undefined, null, 1].map(
        value => ((ws.binaryType = value), ws.binaryType),
      );
      expect(results).toEqual([
        "arraybuffer",
        "fragments",
        "blob",
        "nodebuffer",
        "nodebuffer",
        "nodebuffer",
        "nodebuffer",
        "nodebuffer",
      ]);
    });

    test("_socket has what people use of a net.Socket, from 'open' on", async () => {
      await using client = await dial(implementation);
      const ws: any = client.ws;
      expect([ws._socket, ws._isServer, ws._closeCode]).toEqual([null, false, 1006]);
      await client.opened;
      const socket = ws._socket;
      expect([socket.remoteAddress, socket.remotePort]).toEqual(["127.0.0.1", client.peer.port]);
      for (const name of ["ref", "unref", "setNoDelay", "setKeepAlive", "destroy"]) expect(socket[name]).toBeFunction();
      expect([ws._isServer, ws._closeCode]).toEqual([false, 1006]);

      const conn = await client.peer.connection();
      conn.close(4000);
      conn.end();
      await client.closed;
      expect(ws._socket).toBe(socket);
      expect(ws._closeCode).toBe(4000);
    });

    test("_socket.destroy() drops the connection", async () => {
      await using client = await openClient(implementation);
      (client.ws as any)._socket.destroy();
      await client.closed;
      expect(client.events).toEqual([...opening, "close 1006 Buffer() rs=3"]);
      expect(await client.conn.rest()).toEqual([]);
    });
  });

  describe("a server socket", () => {
    test("is of the same class as a client socket", async () => {
      await using server = await openServer(implementation);
      const { ws } = server;
      expect(ws).toBeInstanceOf(WebSocket);
      expect(ws).toBeInstanceOf(EventEmitter);
      expect(ws.constructor).toBe(WebSocket);
      expect(ws.constructor.name).toBe("WebSocket");
      expect(Object.getPrototypeOf(ws)).toBe(WebSocket.prototype);
      expect(Object.prototype.toString.call(ws)).toBe("[object Object]");
      expect([ws.send, ws.close]).toEqual([WebSocket.prototype.send, WebSocket.prototype.close]);
    });

    test("is of the class given as the `WebSocket` option", async () => {
      class Mine extends WebSocket {
        hello() {
          return "hi";
        }
      }
      await using server = await openServer(implementation, { WebSocket: Mine });
      expect(server.ws).toBeInstanceOf(Mine);
      expect((server.ws as Mine).hello()).toBe("hi");
    });

    test("_socket is the socket of the request", async () => {
      await using server = await openServer(implementation);
      const ws: any = server.ws;
      expect(ws._socket).toBe(server.req.socket);
      expect(ws._socket.remoteAddress).toBe("127.0.0.1");
      expect(ws._socket.remotePort).toBe(server.client.socket.localPort);
      expect([ws._isServer, ws._closeCode]).toEqual([true, 1006]);
    });
  });

  describe("pause() and resume()", () => {
    test("a paused socket still sends, and gets its messages after resume()", async () => {
      await using client = await openClient(implementation, { perMessageDeflate: false });
      const { ws, conn, events } = client;
      expect(ws.isPaused).toBe(false);
      ws.pause();
      expect(ws.isPaused).toBe(true);
      conn.text("while paused");
      // The way there and back gives the message the time to be delivered, if it were.
      ws.send("marker");
      expect(await conn.next()).toBe('text "marker"');
      expect(events).toEqual(opening);

      ws.resume();
      expect(ws.isPaused).toBe(false);
      await event(ws, "message");
      expect(events).toEqual([...opening, 'message Buffer("while paused") text rs=1']);
    });

    test("do nothing while CONNECTING and once CLOSED", async () => {
      await using client = await dial(implementation);
      const { ws } = client;
      ws.pause();
      expect(ws.isPaused).toBe(false);
      ws.resume();
      await client.opened;
      ws.terminate();
      await client.closed;
      ws.pause();
      expect(ws.isPaused).toBe(false);
      ws.resume();
      expect(ws.isPaused).toBe(false);
    });

    test("the peer closes a paused socket: it stays OPEN until resume()", async () => {
      await using client = await openClient(implementation, { perMessageDeflate: false });
      const { ws, conn, events } = client;
      ws.pause();
      conn.text("a");
      conn.close(1000);
      conn.end();
      ws.send("marker");
      expect(await conn.next()).toBe('text "marker"');
      expect([ws.readyState, ws.isPaused]).toEqual([WebSocket.OPEN, true]);
      expect(events).toEqual(opening);

      ws.resume();
      await client.closed;
      expect(events).toEqual([...opening, 'message Buffer("a") text rs=1', "close 1000 Buffer() rs=3"]);
      expect(await conn.rest()).toEqual(["close 1000"]);
    });

    const untilResume = "the peer's Close frame is not read until resume()";
    test(`close() on a paused socket: ${builtin ? "it reads again" : untilResume}`, async () => {
      await using client = await openClient(implementation);
      const { ws, conn, events } = client;
      ws.pause();
      ws.close(1000);
      expect(await conn.next()).toBe("close 1000");
      conn.close(1000);
      conn.end();
      // On the built-in close() resumes a client, so that the closing handshake can end.
      if (builtin) {
        expect(ws.isPaused).toBe(false);
      } else {
        // A CLOSING socket cannot send a marker: another connection goes there and back.
        await using other = await openClient(implementation);
        expect(await other.conn.roundTrip()).toEqual([]);
        expect([ws.readyState, ws.isPaused]).toEqual([WebSocket.CLOSING, true]);
        expect(events).toEqual(opening);
        ws.resume();
      }
      await client.closed;
      expect(events).toEqual([...opening, "close 1000 Buffer() rs=3"]);
    });
  });

  describe("EventEmitter methods", () => {
    test.each(["on", "once", "addListener", "prependListener", "prependOnceListener"] as const)(
      "a 'message' listener added with %s() alone gets the message",
      async method => {
        await using peer = await createPeer();
        const ws: EventEmitter & { terminate(): void } = new WebSocket(peer.url);
        try {
          const message = new Promise<unknown[]>(resolve => ws[method]("message", (...args) => resolve(args)));
          (await peer.connection()).text("hi");
          expect(await message).toEqual([Buffer.from("hi"), false]);
        } finally {
          ws.on("error", () => {}).terminate();
        }
      },
    );

    test("a failure emits 'error' once, for a once() listener too", async () => {
      const ws = new WebSocket("ws://127.0.0.1:" + (await closedPort()));
      const emitted: string[] = [];
      const { emit } = ws;
      ws.emit = function (name: string, ...args: any) {
        emitted.push(name);
        return emit.call(this, name, ...args);
      };
      ws.once("error", () => {});
      await event(ws, "close");
      expect(emitted).toEqual(["error", "close"]);
    });
  });

  describe("the event loop", () => {
    test.concurrent(
      "an open socket without listeners keeps the process alive",
      async () => {
        await using peer = await createPeer();
        const child = runScript({ specifier }, `new WebSocket(process.env.PEER_URL);`, { PEER_URL: peer.url });
        const conn = await peer.connection();
        // Its script has ended, and it still answers.
        expect(await conn.roundTrip()).toEqual([]);
        expect(await conn.roundTrip()).toEqual([]);
        conn.close(1000);
        conn.end();
        expect(await child).toEqual({ lines: [], stderr: "", exitCode: 0 });
      },
      scriptTimeout,
    );

    test.concurrent(
      "_socket.unref() lets the process exit while the socket is open",
      async () => {
        await using peer = await createPeer();
        const script = `
        const ws = new WebSocket(process.env.PEER_URL);
        ws.on("open", () => {
          ws._socket.unref();
          console.log("unref", ws.readyState);
        });
        ws.on("close", () => console.log("close"));
      `;
        expect(await runScript({ specifier }, script, { PEER_URL: peer.url })).toEqual({
          lines: ["unref 1"],
          stderr: "",
          exitCode: 0,
        });
      },
      scriptTimeout,
    );
  });
});
