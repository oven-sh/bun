import type { Subprocess } from "bun";
import { spawn } from "bun";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import crypto from "crypto";
import { EventEmitter, once } from "events";
import { bunEnv, bunExe, isDebug } from "harness";
import { createServer, request } from "http";
import { AddressInfo, connect } from "net";
import path from "node:path";
import { Server, WebSocket, WebSocketServer } from "ws";
import NpmWebSocketServerModule from "../../../node_modules/ws/lib/websocket-server.js";

const NpmWebSocketServer: typeof WebSocketServer = NpmWebSocketServerModule;

const strings = [
  {
    label: "string (ascii)",
    message: "ascii",
    bytes: [0x61, 0x73, 0x63, 0x69, 0x69],
  },
  {
    label: "string (latin1)",
    message: "latin1-©",
    bytes: [0x6c, 0x61, 0x74, 0x69, 0x6e, 0x31, 0x2d, 0xc2, 0xa9],
  },
  {
    label: "string (utf-8)",
    message: "utf8-😶",
    bytes: [0x75, 0x74, 0x66, 0x38, 0x2d, 0xf0, 0x9f, 0x98, 0xb6],
  },
] as const;

const buffers = [
  {
    label: "Uint8Array (utf-8)",
    message: new TextEncoder().encode("utf8-🙂"),
    bytes: [0x75, 0x74, 0x66, 0x38, 0x2d, 0xf0, 0x9f, 0x99, 0x82],
  },
  {
    label: "ArrayBuffer (utf-8)",
    message: new TextEncoder().encode("utf8-🙃").buffer,
    bytes: [0x75, 0x74, 0x66, 0x38, 0x2d, 0xf0, 0x9f, 0x99, 0x83],
  },
  {
    label: "Buffer (utf-8)",
    message: Buffer.from("utf8-🤩"),
    bytes: [0x75, 0x74, 0x66, 0x38, 0x2d, 0xf0, 0x9f, 0xa4, 0xa9],
  },
] as const;

const messages = [...strings, ...buffers] as const;

// One rule for the client and the server socket of the shim. `type` is the shape of a binary
// message. npm ws emits ping and pong payloads as a Buffer in every mode. The shim keeps that
// where it can wrap the payload synchronously. A Blob cannot be wrapped, so "blob" applies to
// ping and pong payloads too, as it does on the native sockets.
const binaryTypes = [
  {
    label: "nodebuffer",
    type: Buffer,
    controlType: Buffer,
  },
  {
    label: "arraybuffer",
    type: ArrayBuffer,
    controlType: Buffer,
  },
  {
    label: "blob",
    type: Blob,
    controlType: Blob,
  },
] as const;

// Names match `type.name` and `controlType.name` above. A plain Uint8Array, which is what
// the server socket used to emit in "arraybuffer" mode, shows up as "[object Uint8Array]".
function shapeOf(data: unknown): string {
  if (Buffer.isBuffer(data)) return "Buffer";
  if (data instanceof ArrayBuffer) return "ArrayBuffer";
  if (data instanceof Blob) return "Blob";
  return Object.prototype.toString.call(data);
}

let servers: Subprocess[] = [];
let clients: WebSocket[] = [];

function cleanUp() {
  for (const client of clients) {
    client.terminate();
  }
  for (const server of servers) {
    server.kill();
  }
}

beforeEach(cleanUp);
afterEach(cleanUp);

describe("WebSocket", () => {
  test("url", (ws, done) => {
    expect(ws.url).toStartWith("ws://");
    done();
  });
  test("readyState", (ws, done) => {
    expect(ws.readyState).toBe(WebSocket.CONNECTING);
    ws.on("open", () => {
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    });
    ws.on("close", () => {
      expect(ws.readyState).toBe(WebSocket.CLOSED);
      done();
    });
  });
  describe("binaryType", () => {
    test("(default)", (ws, done) => {
      expect(ws.binaryType).toBe("nodebuffer");
      done();
    });
    test("(invalid)", (ws, done) => {
      try {
        // @ts-expect-error
        ws.binaryType = "invalid";
        done(new Error("Expected an error"));
      } catch {
        done();
      }
    });
    for (const { label, type, controlType } of binaryTypes) {
      test(label, (ws, done) => {
        // @types/ws 8.5 does not list "blob", ws 8.18 accepts it
        ws.binaryType = label as WebSocket["binaryType"];
        const seen: Record<string, string> = {};
        // The echo server answers the message, pings back when pinged and pongs back when
        // ponged. The native client also pongs the echoed ping by itself, so the first pong
        // is the one that gets recorded. Every one of them has the shape binaryType selects.
        function record(event: string, data: unknown) {
          seen[event] ??= shapeOf(data);
          if (!(seen.message && seen.ping && seen.pong)) return;
          try {
            expect(seen).toEqual({
              binaryType: label,
              message: type.name,
              ping: controlType.name,
              pong: controlType.name,
            });
            done();
          } catch (err) {
            done(err);
          }
        }
        ws.on("open", () => {
          seen.binaryType = ws.binaryType;
          ws.send(new Uint8Array(1));
          ws.ping();
          ws.pong();
        });
        ws.on("message", (data, isBinary) => {
          if (isBinary) record("message", data);
          else done(new Error(`expected a binary echo, got ${shapeOf(data)}`));
        });
        ws.on("ping", data => record("ping", data));
        ws.on("pong", data => record("pong", data));
      });
    }
  });
  describe("send()", () => {
    for (const { label, message, bytes } of messages) {
      test(label, (ws, done) => {
        ws.on("open", () => {
          ws.send(message);
        });
        ws.on("message", (data, isBinary) => {
          if (typeof data === "string") {
            expect(data).toBe(message);
            expect(isBinary).toBeFalse();
          } else {
            expect(data).toEqual(Buffer.from(bytes));
            expect(isBinary).toBeTrue();
          }
          done();
        });
      });
    }
  });
  describe("ping()", () => {
    test("(no argument)", (ws, done) => {
      ws.on("open", () => {
        ws.ping();
      });
      ws.on("ping", data => {
        expect(data).toBeInstanceOf(Buffer);
        done();
      });
    });
    for (const { label, message, bytes } of messages) {
      test(label, (ws, done) => {
        ws.on("open", () => {
          ws.ping(message);
        });
        ws.on("ping", data => {
          expect(data).toEqual(Buffer.from(bytes));
          done();
        });
      });
    }
  });
  describe("pong()", () => {
    test("(no argument)", (ws, done) => {
      ws.on("open", () => {
        ws.pong();
      });
      ws.on("pong", data => {
        expect(data).toBeInstanceOf(Buffer);
        done();
      });
    });
    for (const { label, message, bytes } of messages) {
      test(label, (ws, done) => {
        ws.on("open", () => {
          ws.pong(message);
        });
        ws.on("pong", data => {
          expect(data).toEqual(Buffer.from(bytes));
          done();
        });
      });
    }
  });
  describe("close()", () => {
    test("(no arguments)", (ws, done) => {
      ws.on("open", () => {
        ws.close();
      });
      ws.on("close", (code: number, reason: string, wasClean: boolean) => {
        expect(code).toBe(1000);
        expect(reason).toBeString();
        expect(wasClean).toBeTrue();
        done();
      });
    });
    test("(no reason)", (ws, done) => {
      ws.on("open", () => {
        ws.close(1001);
      });
      ws.on("close", (code: number, reason: string, wasClean: boolean) => {
        expect(code).toBe(1001);
        expect(reason).toBeString();
        expect(wasClean).toBeTrue();
        done();
      });
    });
    // FIXME: Encoding issue
    // Expected: "latin1-©"
    // Received: "latin1-Â©"
    /*
    for (const { label, message } of strings) {
      test(label, (ws, done) => {
        ws.on("open", () => {
          ws.close(1002, message);
        });
        ws.on("close", (code, reason, wasClean) => {
          expect(code).toBe(1002);
          expect(reason).toBe(message);
          expect(wasClean).toBeTrue();
          done();
        });
      });
    }
    */
  });
  test("terminate()", (ws, done) => {
    ws.on("open", () => {
      ws.terminate();
    });
    ws.on("close", (code: number, reason: string, wasClean: boolean) => {
      expect(code).toBe(1006);
      expect(reason).toBeString();
      expect(wasClean).toBeFalse();
      done();
    });
  });
  test("prototype properties are set correctly", (ws, done) => {
    expect(ws.CLOSED).toBeDefined();
    expect(ws.CLOSING).toBeDefined();
    expect(ws.CONNECTING).toBeDefined();
    expect(ws.OPEN).toBeDefined();
    done();
  });
  it("sets static properties correctly", () => {
    expect(WebSocket.CLOSED).toBeDefined();
    expect(WebSocket.CLOSING).toBeDefined();
    expect(WebSocket.CONNECTING).toBeDefined();
    expect(WebSocket.OPEN).toBeDefined();
  });
});

describe("WebSocketServer", () => {
  it("sets websocket prototype properties correctly", async () => {
    const wss = new WebSocketServer({ port: 0 });
    const { resolve, reject, promise } = Promise.withResolvers();

    wss.on("connection", ws => {
      try {
        expect(ws.CLOSED).toBeDefined();
        expect(ws.CLOSING).toBeDefined();
        expect(ws.CONNECTING).toBeDefined();
        expect(ws.OPEN).toBeDefined();
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        wss.close();
        ws.close();
      }
    });

    new WebSocket("ws://localhost:" + wss.address().port);
    await promise;
  });

  it("sockets can be terminated", async () => {
    const wss = new WebSocketServer({ port: 0 });
    const { resolve, reject, promise } = Promise.withResolvers();

    wss.on("connection", ws => {
      ws.on("close", () => {
        resolve();
      });
      try {
        ws.terminate();
      } catch (err) {
        reject(err);
      }
    });

    new WebSocket("ws://localhost:" + wss.address().port);
    await promise;
  });

  // websockets/ws test/websocket-server.test.js
  it("handles data passed along with the upgrade request", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<{ data: unknown; isBinary: boolean }>();
    const wss = new WebSocketServer({ port: 0 }, () => {
      const req = request({
        port: (wss.address() as AddressInfo).port,
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
          "Sec-WebSocket-Version": 13,
        },
      });
      req.on("error", reject);
      // The text frame "Hello", masked with a zero key.
      req.write(Buffer.concat([Buffer.from([0x81, 0x85, 0, 0, 0, 0]), Buffer.from("Hello")]));
      req.end();
    });
    wss.on("connection", ws => {
      ws.on("message", (data, isBinary) => resolve({ data, isBinary }));
      ws.on("close", code => reject(new Error(`closed with ${code} before the message`)));
    });

    try {
      expect(await promise).toEqual({ data: Buffer.from("Hello"), isBinary: false });
    } finally {
      wss.close();
    }
  });

  describe("binaryType", () => {
    type Received = { event: string; shape: string; bytes: number[]; isBinary?: boolean };

    async function describeReceived(event: string, data: unknown, isBinary?: boolean): Promise<Received> {
      const bytes = Array.from(new Uint8Array(data instanceof Blob ? await data.bytes() : (data as Uint8Array)));
      const received: Received = { event, shape: shapeOf(data), bytes };
      if (isBinary !== undefined) received.isBinary = isBinary;
      return received;
    }

    // Collects what the server socket emits for the frames `sendFrames` puts on the wire.
    // Resolves once `messageCount` 'message' events arrived. The frames arrive in order,
    // so every ping/pong sent before the last message has been emitted by then.
    async function receiveOnServer(
      onConnection: (ws: WebSocket) => void,
      sendFrames: (client: WebSocket) => void,
      messageCount: number,
    ): Promise<Received[]> {
      const wss = new WebSocketServer({ port: 0 });
      const { promise, resolve, reject } = Promise.withResolvers<Promise<Received>[]>();
      const received: Promise<Received>[] = [];
      let messages = 0;

      wss.on("connection", ws => {
        ws.on("error", reject);
        onConnection(ws);
        ws.on("ping", data => received.push(describeReceived("ping", data)));
        ws.on("pong", data => received.push(describeReceived("pong", data)));
        ws.on("message", (data, isBinary) => {
          received.push(describeReceived("message", data, isBinary));
          if (++messages === messageCount) resolve(received);
        });
      });

      const client = new WebSocket("ws://localhost:" + (wss.address() as AddressInfo).port);
      client.on("error", reject);
      client.on("open", () => sendFrames(client));
      try {
        return await Promise.all(await promise);
      } finally {
        client.terminate();
        wss.close();
      }
    }

    it.each(binaryTypes)(
      "$label: binary frames arrive as $type.name, ping and pong payloads as $controlType.name",
      async ({ label, type, controlType }) => {
        const received = await receiveOnServer(
          ws => {
            // @types/ws 8.5 does not list "blob", ws 8.18 accepts it
            ws.binaryType = label as WebSocket["binaryType"];
          },
          client => {
            client.ping(Buffer.from([4]));
            client.pong(Buffer.from([5]));
            client.send(Buffer.from([1, 2, 3]));
            client.send(Buffer.alloc(0));
          },
          2,
        );

        expect(received).toEqual([
          { event: "ping", shape: controlType.name, bytes: [4] },
          { event: "pong", shape: controlType.name, bytes: [5] },
          { event: "message", shape: type.name, bytes: [1, 2, 3], isBinary: true },
          { event: "message", shape: type.name, bytes: [], isBinary: true },
        ]);
      },
    );

    // binaryType selects the shape of a binary frame only. npm ws emits a text frame as a Buffer.
    it.each(binaryTypes)("$label: text frames arrive as Buffer", async ({ label, type }) => {
      const received = await receiveOnServer(
        ws => {
          ws.binaryType = label as WebSocket["binaryType"];
        },
        client => {
          for (const { message } of strings) client.send(message);
          client.send(Buffer.from([1, 2, 3]));
          client.send("");
        },
        strings.length + 2,
      );

      expect(received).toEqual([
        ...strings.map(({ bytes }) => ({ event: "message", shape: "Buffer", bytes: [...bytes], isBinary: false })),
        { event: "message", shape: type.name, bytes: [1, 2, 3], isBinary: true },
        { event: "message", shape: "Buffer", bytes: [], isBinary: false },
      ]);
    });

    // The broadcast of the npm ws README. A text frame must reach the peer as a text frame.
    it.each(binaryTypes)("$label: send(data, { binary: isBinary }) keeps the frame type", async ({ label }) => {
      const wss = new WebSocketServer({ port: 0 });
      const { promise, resolve, reject } = Promise.withResolvers<{ isBinary: boolean; bytes: number[] }[]>();
      const frames = [...strings.map(({ message }) => message), Buffer.from([1, 2, 3]), ""];
      const received: { isBinary: boolean; bytes: number[] }[] = [];
      wss.on("connection", ws => {
        ws.binaryType = label as WebSocket["binaryType"];
        ws.on("error", reject);
        ws.on("message", (data, isBinary) => {
          for (const client of wss.clients) client.send(data, { binary: isBinary });
        });
      });

      const client = new WebSocket("ws://localhost:" + (wss.address() as AddressInfo).port);
      client.on("error", reject);
      client.on("open", () => {
        for (const frame of frames) client.send(frame);
      });
      client.on("message", (data, isBinary) => {
        received.push({ isBinary, bytes: [...(data as Buffer)] });
        if (received.length === frames.length) resolve(received);
      });
      try {
        expect(await promise).toEqual([
          ...strings.map(({ bytes }) => ({ isBinary: false, bytes: [...bytes] })),
          { isBinary: true, bytes: [1, 2, 3] },
          { isBinary: false, bytes: [] },
        ]);
      } finally {
        client.terminate();
        wss.close();
      }
    });

    it("defaults to nodebuffer and applies a new value to the next frame", async () => {
      const binaryTypesSeen: string[] = [];
      const received = await receiveOnServer(
        ws => {
          binaryTypesSeen.push(ws.binaryType);
          ws.binaryType = "arraybuffer";
          binaryTypesSeen.push(ws.binaryType);
          const next = ["blob", "nodebuffer"];
          ws.on("message", () => {
            if (next.length) ws.binaryType = next.shift() as WebSocket["binaryType"];
          });
        },
        client => {
          client.send(Buffer.from([1]));
          client.ping(Buffer.from([2]));
          client.send(Buffer.from([3]));
          client.send(Buffer.from([4]));
        },
        3,
      );

      expect(binaryTypesSeen).toEqual(["nodebuffer", "arraybuffer"]);
      expect(received).toEqual([
        { event: "message", shape: "ArrayBuffer", bytes: [1], isBinary: true },
        // the ping arrives after the change to "blob"
        { event: "ping", shape: "Blob", bytes: [2] },
        { event: "message", shape: "Blob", bytes: [3], isBinary: true },
        { event: "message", shape: "Buffer", bytes: [4], isBinary: true },
      ]);
    });

    it("can be set after the socket closed", async () => {
      const wss = new WebSocketServer({ port: 0 });
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      wss.on("connection", ws => {
        ws.on("error", reject);
        ws.on("close", () => {
          try {
            ws.binaryType = "arraybuffer";
            resolve(ws.binaryType);
          } catch (err) {
            reject(err);
          }
        });
      });

      const client = new WebSocket("ws://localhost:" + (wss.address() as AddressInfo).port);
      client.on("error", reject);
      client.on("open", () => client.close());
      try {
        expect(await promise).toBe("arraybuffer");
      } finally {
        wss.close();
      }
    });
  });
});

describe("Server", () => {
  it("sets websocket prototype properties correctly", async () => {
    const wss = new Server({ port: 0 });
    const { resolve, reject, promise } = Promise.withResolvers();

    wss.on("connection", ws => {
      try {
        expect(ws.CLOSED).toBeDefined();
        expect(ws.CLOSING).toBeDefined();
        expect(ws.CONNECTING).toBeDefined();
        expect(ws.OPEN).toBeDefined();
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        wss.close();
        ws.close();
      }
    });

    new WebSocket("ws://localhost:" + wss.address().port);
    await promise;
  });
});

it("isBinary", async () => {
  const wss = new WebSocketServer({ port: 0 });
  let isDone = false;
  const { resolve, reject, promise } = Promise.withResolvers();
  wss.on("connection", ws => {
    ws.on("message", (data, isBinary) => {
      if (isDone) {
        expect(isBinary).toBeTrue();
        wss.close();
        ws.close();
        resolve();
        return;
      }
      expect(isBinary).toBeFalse();
      isDone = true;
    });
    ws.on("error", reject);
  });

  const ws = new WebSocket("ws://localhost:" + wss.address().port);
  ws.on("open", function open() {
    ws.send("hello");
    ws.send(Buffer.from([1, 2, 3]));
  });

  await promise;
});

it("onmessage", done => {
  const wss = new WebSocketServer({ port: 0 });
  wss.on("connection", ws => {
    const handler = e => {
      expect(e.data).toBe("hello");
      expect(ws.onmessage).toBe(handler);
      done();
      wss.close();
    };
    ws.onmessage = handler;
  });

  const ws = new WebSocket("ws://localhost:" + wss.address().port);
  ws.onopen = () => {
    ws.send("hello");
  };
});

// The socket that a WebSocketServer hands to 'connection' has the EventTarget interface of npm ws
// (lib/event-target.js). The block runs on the built-in and on the installed package, so every
// expectation is what npm ws does. `builtin` selects the value in the four tests where the
// built-in differs on purpose. The client is the built-in one in both runs.
describe.each([
  { implementation: "built-in", ServerClass: WebSocketServer, builtin: true },
  { implementation: "npm ws", ServerClass: NpmWebSocketServer, builtin: false },
])("server socket EventTarget interface ($implementation)", ({ ServerClass, builtin }) => {
  function listeningServer() {
    const wss = new ServerClass({ port: 0 });
    return { wss, url: "ws://127.0.0.1:" + (wss.address() as AddressInfo).port };
  }

  // The server socket of a fresh connection, with an open client.
  async function connectedServerSocket() {
    const { wss, url } = listeningServer();
    const connected = Promise.withResolvers<any>();
    const opened = Promise.withResolvers<void>();
    wss.on("connection", connected.resolve);
    wss.on("error", connected.reject);
    const client = new WebSocket(url);
    client.on("error", opened.reject);
    client.on("open", () => opened.resolve());
    const [ws] = await Promise.all([connected.promise, opened.promise]);
    // The tests emit and receive 'error' on purpose.
    ws.on("error", () => {});
    return {
      ws,
      client,
      wss,
      [Symbol.dispose]() {
        client.terminate();
        wss.close();
      },
    };
  }

  // The server socket of a connection whose peer is a plain TCP socket, so that the test
  // chooses the bytes of each frame.
  async function serverSocketOfRawPeer() {
    const { wss } = listeningServer();
    const connected = Promise.withResolvers<any>();
    wss.on("connection", connected.resolve);
    wss.on("error", connected.reject);
    const peer = connect((wss.address() as AddressInfo).port, "127.0.0.1");
    peer.on("error", () => {});
    peer.write(
      [
        "GET / HTTP/1.1",
        "Host: localhost",
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Sec-WebSocket-Version: 13",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
        "",
        "",
      ].join("\r\n"),
    );
    const ws = await connected.promise;
    ws.on("error", () => {});
    return {
      ws,
      peer,
      [Symbol.dispose]() {
        peer.destroy();
        wss.close();
      },
    };
  }

  // An event as plain data: the name of its class, every property that `for in` reads, and
  // whether `target` is the socket.
  function describeEvent(event: any, ws: unknown) {
    const described: Record<string, unknown> = { class: event.constructor.name };
    for (const key in event) {
      const value = event[key];
      described[key] = key === "target" ? value === ws : value instanceof Error ? String(value) : value;
    }
    return described;
  }

  // `args` is what the socket emits for the event. The server socket emits no 'open' and no
  // 'error' by itself, so every test emits.
  const eventTypes = [
    { type: "open", adapter: "onOpen", args: [], event: { class: "Event", target: true, type: "open" } },
    {
      type: "error",
      adapter: "onError",
      args: [new Error("boom")],
      event: { class: "ErrorEvent", error: "Error: boom", message: "boom", target: true, type: "error" },
    },
    {
      type: "close",
      adapter: "onClose",
      args: [4000, Buffer.from("bye")],
      // The socket is open, so no close frame went either way.
      event: { class: "CloseEvent", code: 4000, reason: "bye", wasClean: false, target: true, type: "close" },
    },
    {
      type: "message",
      adapter: "onMessage",
      args: [Buffer.from("text"), false],
      event: { class: "MessageEvent", data: "text", target: true, type: "message" },
    },
  ];

  describe.each(eventTypes)("$type", ({ type, adapter, args, event }) => {
    const attribute = `on${type}`;

    it(`${attribute} holds one handler, and only a function sets it`, async () => {
      using connection = await connectedServerSocket();
      const { ws } = connection;
      // The listeners that are not part of the test: the server's own for 'close', the helper's for 'error'.
      const others = ws.listenerCount(type);
      const state = () => ({ handler: ws[attribute], listeners: ws.listenerCount(type) - others });
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

    it("a listener gets one event object", async () => {
      using connection = await connectedServerSocket();
      const { ws } = connection;
      const received: unknown[] = [];
      const record = (face: string, expectedThis: () => unknown) =>
        function (this: unknown, ...args: unknown[]) {
          received.push({
            face,
            arguments: args.length,
            this: this === expectedThis(),
            event: describeEvent(args[0], ws),
          });
        };
      // `handleEvent` is read when the event is dispatched, and only from an object.
      const object: { handleEvent?: Function } = {};
      const functionWithHandleEvent = Object.assign(
        record("function", () => ws),
        { handleEvent: record("handleEvent of a function", () => functionWithHandleEvent) },
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
        [attribute, "addEventListener", "handleEvent", "function"].map(face => ({
          face,
          arguments: 1,
          this: true,
          event,
        })),
      );
    });

    it("addEventListener() adds a listener once, and { once: true } removes it before it runs", async () => {
      using connection = await connectedServerSocket();
      const { ws } = connection;
      const others = ws.listenerCount(type);
      const calls: [string, number][] = [];
      const listener = () => calls.push(["listener", ws.listenerCount(type) - others]);
      const onceListener = () => calls.push(["once", ws.listenerCount(type) - others]);

      ws.addEventListener(type, listener);
      ws.addEventListener(type, listener);
      ws.addEventListener(type, onceListener, { once: true });
      ws.addEventListener(type, onceListener, { once: true });
      expect(ws.listenerCount(type) - others).toBe(2);

      ws.emit(type, ...args);
      ws.emit(type, ...args);
      expect(calls).toEqual([
        ["listener", 2],
        ["once", 1],
        ["listener", 1],
      ]);
    });

    it("removeEventListener() removes what addEventListener() added, and nothing else", async () => {
      using connection = await connectedServerSocket();
      const { ws } = connection;
      const others = ws.listenerCount(type);
      const calls: string[] = [];
      const shared = () => calls.push("shared");
      const onceListener = () => calls.push("once");
      const object = { handleEvent: () => calls.push("object") };
      const viaOn = () => calls.push("on");

      // The same function through both faces is two listeners.
      ws[attribute] = shared;
      ws.addEventListener(type, shared);
      ws.addEventListener(type, onceListener, { once: true });
      ws.addEventListener(type, object);
      ws.on(type, viaOn);
      expect(ws.listenerCount(type) - others).toBe(5);

      ws.removeEventListener(type, shared);
      ws.removeEventListener(type, onceListener);
      ws.removeEventListener(type, object);
      ws.removeEventListener(type, viaOn);
      ws.removeEventListener(type, () => {});
      expect({ handler: ws[attribute], listeners: ws.listenerCount(type) - others }).toEqual({
        handler: shared,
        listeners: 2,
      });

      ws.emit(type, ...args);
      expect(calls).toEqual(["shared", "on"]);
    });

    it("off() and listeners() see the adapter, not the function", async () => {
      using connection = await connectedServerSocket();
      const { ws } = connection;
      const others = ws.listenerCount(type);
      let calls = 0;
      const listener = () => calls++;

      ws.addEventListener(type, listener);
      ws.off(type, listener);
      const added = ws.listeners(type).slice(others);
      expect(added.map((f: Function) => ({ name: f.name, isListener: f === listener }))).toEqual([
        { name: adapter, isListener: false },
      ]);

      ws.off(type, added[0]);
      expect(ws.listenerCount(type) - others).toBe(0);
      ws.emit(type, ...args);
      expect(calls).toBe(0);
    });

    it("a listener keeps its place in the list of the EventEmitter", async () => {
      using connection = await connectedServerSocket();
      const { ws } = connection;
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
        // The attribute and addEventListener() hold the same function apart.
        run(() => {
          ws.addEventListener(type, f);
          ws[attribute] = f;
        }),
        // A new handler of the attribute goes to the end.
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
        // on() and addEventListener() hold the same function apart.
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

  it("has one class per event, shared by every socket and both faces", async () => {
    using first = await connectedServerSocket();
    using second = await connectedServerSocket();
    const classes: Record<string, Function[]> = {};
    for (const { type, args } of eventTypes) {
      const seen = (classes[type] = [] as Function[]);
      const record = (event: any) => seen.push(event.constructor);
      first.ws.addEventListener(type, record);
      first.ws[`on${type}`] = record;
      second.ws.addEventListener(type, record);
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

  // The built-in differs on purpose. npm ws ignores a type that is not one of the four. The
  // built-in has always added a plain listener, so a heartbeat with addEventListener("pong", f)
  // works on it.
  it(`addEventListener() of another event type adds ${builtin ? "a plain listener" : "nothing"}`, async () => {
    using connection = await connectedServerSocket();
    const { ws, client } = connection;
    const types = ["ping", "pong", "upgrade", "unexpected-response", "foo"];
    const calls: unknown[] = [];
    const listener = (...args: unknown[]) => calls.push(args.map(shapeOf));
    const onceListener = (...args: unknown[]) => calls.push(["once", ...args.map(shapeOf)]);
    const pinged = Promise.withResolvers<void>();

    for (const type of types) ws.addEventListener(type, listener);
    ws.addEventListener("ping", onceListener, { once: true });
    // What is not a function is ignored, as every listener of these types is in npm ws.
    for (const notFunction of [undefined, null, { handleEvent: listener }]) {
      ws.addEventListener("pong", notFunction);
      ws.removeEventListener("pong", notFunction);
    }
    const added = types.filter(type => ws.listenerCount(type) !== 0);
    const pongListeners = ws.listenerCount("pong");
    ws.on("ping", () => pinged.resolve());
    client.ping(Buffer.from([4]));
    await pinged.promise;
    ws.removeAllListeners("ping");
    for (const type of types) ws.removeEventListener(type, listener);

    expect({ added, pongListeners, calls, left: types.filter(type => ws.listenerCount(type) !== 0) }).toEqual(
      builtin
        ? { added: types, pongListeners: 1, calls: [["Buffer"], ["once", "Buffer"]], left: [] }
        : { added: [], pongListeners: 0, calls: [], left: [] },
    );
  });

  it("defines its six members as enumerable properties of the prototype", async () => {
    using connection = await connectedServerSocket();
    const prototype = Object.getPrototypeOf(connection.ws);
    const describeProperty = (name: string) => {
      const { get, set, value, ...flags } = Object.getOwnPropertyDescriptor(prototype, name)!;
      return value ? { ...flags, length: value.length } : { ...flags, accessor: !!get && !!set };
    };

    const accessor = { accessor: true, enumerable: true, configurable: true };
    const method = { length: 2, writable: true, enumerable: true, configurable: true };
    expect({
      onopen: describeProperty("onopen"),
      onerror: describeProperty("onerror"),
      onclose: describeProperty("onclose"),
      onmessage: describeProperty("onmessage"),
      addEventListener: describeProperty("addEventListener"),
      removeEventListener: describeProperty("removeEventListener"),
    }).toEqual({
      onopen: accessor,
      onerror: accessor,
      onclose: accessor,
      onmessage: accessor,
      addEventListener: method,
      removeEventListener: method,
    });
  });

  // The built-in differs on purpose. In npm ws a listener that on() added has `undefined` for the
  // function it adapts, so removeEventListener(type, undefined) removes the first one. For 'close'
  // that is the listener that takes the socket out of `wss.clients`.
  it(`removeEventListener(type, undefined) removes ${builtin ? "nothing" : "a listener that on() added"}`, async () => {
    using connection = await connectedServerSocket();
    const { ws, wss, client } = connection;
    const closed = Promise.withResolvers<void>();
    let messages = 0;
    ws.on("message", () => messages++);

    const before = { message: ws.listenerCount("message"), close: ws.listenerCount("close") };
    ws.removeEventListener("message", undefined);
    ws.removeEventListener("close", undefined);
    const removed = {
      message: before.message - ws.listenerCount("message"),
      close: before.close - ws.listenerCount("close"),
    };
    ws.on("close", () => closed.resolve());

    client.send("text");
    client.close();
    await closed.promise;
    expect({ removed, messages, clients: wss.clients.size }).toEqual(
      builtin
        ? { removed: { message: 0, close: 0 }, messages: 1, clients: 0 }
        : { removed: { message: 1, close: 1 }, messages: 0, clients: 1 },
    );
  });

  // The built-in differs on purpose. npm ws calls `this.addEventListener()` from the setter of
  // on<event>. A built-in module does not call a method that user code can replace.
  it(`an on<event> setter ${builtin ? "does not call" : "calls"} an addEventListener() of the socket`, async () => {
    using connection = await connectedServerSocket();
    const { ws } = connection;
    const handler = () => {};
    const types: string[] = [];
    ws.addEventListener = (type: string) => types.push(type);
    ws.onmessage = handler;

    expect({ types, handler: ws.onmessage }).toEqual(
      builtin ? { types: [], handler } : { types: ["message"], handler: null },
    );
  });

  it("assigning a non-function to onmessage clears the handler", async () => {
    const { wss, url } = listeningServer();
    let called = 0;
    const observed: unknown[] = [];
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    wss.on("connection", ws => {
      observed.push(ws.onmessage);
      ws.onmessage = () => called++;
      ws.onmessage = null;
      observed.push(ws.onmessage);
      ws.addEventListener("message", () => resolve());
      ws.on("error", reject);
    });

    const ws = new WebSocket(url);
    try {
      ws.on("error", reject);
      ws.on("open", () => ws.send("hello"));

      await promise;
      expect(observed).toEqual([null, null]);
      expect(called).toBe(0);
    } finally {
      wss.close();
      ws.close();
    }
  });

  // https://github.com/oven-sh/bun/issues/36060
  it("addEventListener('message') converts text frames to strings", async () => {
    const { wss, url } = listeningServer();
    const events: any[] = [];
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    wss.on("connection", ws => {
      ws.addEventListener("message", event => {
        events.push(event);
        if (events.length === 2) resolve();
      });
      ws.on("error", reject);
    });

    const ws = new WebSocket(url);
    try {
      ws.on("error", reject);
      ws.on("open", () => {
        ws.send("hello");
        ws.send(Buffer.from([1, 2, 3]));
      });

      await promise;
      expect(events[0].type).toBe("message");
      expect(events[0].data).toBe("hello");
      expect(events[1].type).toBe("message");
      expect(Buffer.isBuffer(events[1].data)).toBeTrue();
      expect(events[1].data).toEqual(Buffer.from([1, 2, 3]));
    } finally {
      wss.close();
      ws.close();
    }
  });

  it("text frames stay Buffer/string when binaryType is 'blob'", async () => {
    const { wss, url } = listeningServer();
    const emitted: [unknown, boolean][] = [];
    const events: any[] = [];
    let serverSocket: any;
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    wss.on("connection", ws => {
      serverSocket = ws;
      // @types/ws 8.5 does not list "blob", ws 8.18 accepts it
      ws.binaryType = "blob" as WebSocket["binaryType"];
      ws.on("message", (data, isBinary) => emitted.push([data, isBinary]));
      ws.addEventListener("message", event => {
        events.push(event);
        if (events.length === 2) resolve();
      });
      ws.on("error", reject);
    });

    const ws = new WebSocket(url);
    try {
      ws.on("error", reject);
      ws.on("open", () => {
        ws.send("hello");
        ws.send(Buffer.from([1, 2, 3]));
      });

      await promise;
      // binaryType only affects binary frames, like npm ws
      expect(Buffer.isBuffer(emitted[0][0])).toBeTrue();
      expect(emitted[0][1]).toBeFalse();
      expect(events[0].type).toBe("message");
      expect(events[0].target).toBe(serverSocket);
      expect(events[0].data).toBe("hello");
      expect(emitted[1][0]).toBeInstanceOf(Blob);
      expect(emitted[1][1]).toBeTrue();
      expect(events[1].type).toBe("message");
      expect(events[1].target).toBe(serverSocket);
      expect(events[1].data).toBeInstanceOf(Blob);
    } finally {
      wss.close();
      ws.close();
    }
  });

  it("addEventListener supports { once: true } and removeEventListener", async () => {
    const { wss, url } = listeningServer();
    let onceCount = 0;
    let removedCount = 0;
    let sharedCount = 0;
    let directCount = 0;
    const seen: string[] = [];
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    wss.on("connection", ws => {
      ws.addEventListener("message", () => onceCount++, { once: true });
      const removed = () => removedCount++;
      ws.addEventListener("message", removed);
      ws.removeEventListener("message", removed);
      // removeEventListener must skip on-event-attribute handlers, even when the
      // same function was also registered via addEventListener. The onmessage
      // wrapper sits first in the listener list, so a non-skipping implementation
      // removes it instead; reassigning onmessage afterwards then leaks the
      // addEventListener wrapper and shared keeps firing.
      const shared = () => sharedCount++;
      ws.onmessage = shared;
      ws.addEventListener("message", shared);
      ws.removeEventListener("message", shared);
      ws.onmessage = () => {};
      // plain .on() subscriptions are invisible to removeEventListener
      const direct = () => directCount++;
      ws.on("message", direct);
      ws.removeEventListener("message", direct);
      ws.addEventListener("message", event => {
        seen.push(event.data as string);
        if (seen.length === 2) resolve();
      });
      ws.on("error", reject);
    });

    const ws = new WebSocket(url);
    try {
      ws.on("error", reject);
      ws.on("open", () => {
        ws.send("first");
        ws.send("second");
      });

      await promise;
      expect(seen).toEqual(["first", "second"]);
      expect(onceCount).toBe(1);
      expect(removedCount).toBe(0);
      // removeEventListener took the addEventListener registration and the
      // onmessage reassignment replaced the rest, so shared never fires
      expect(sharedCount).toBe(0);
      expect(directCount).toBe(2);
    } finally {
      wss.close();
      ws.close();
    }
  });

  // binaryType selects the shape of a binary frame only. The data of a text frame is a string.
  describe.each(binaryTypes)("binaryType $label", ({ label, type }) => {
    it.each(["onmessage", "addEventListener"])("%s gets the data of each frame", async face => {
      using connection = await connectedServerSocket();
      const { ws, client } = connection;
      const received: Promise<unknown>[] = [];
      const frames = [...strings.map(({ message }) => message), "", Buffer.from([1, 2, 3]), Buffer.alloc(0)];
      const all = Promise.withResolvers<void>();
      const listener = ({ data }: { data: unknown }) => {
        received.push(
          typeof data === "string"
            ? Promise.resolve(data)
            : (async () => ({
                shape: shapeOf(data),
                bytes: [...new Uint8Array(data instanceof Blob ? await data.bytes() : (data as Uint8Array))],
              }))(),
        );
        if (received.length === frames.length) all.resolve();
      };

      ws.binaryType = label;
      if (face === "onmessage") ws.onmessage = listener;
      else ws.addEventListener("message", listener);
      for (const frame of frames) client.send(frame);
      await all.promise;

      expect(await Promise.all(received)).toEqual([
        ...strings.map(({ message }) => message),
        "",
        { shape: type.name, bytes: [1, 2, 3] },
        { shape: type.name, bytes: [] },
      ]);
    });
  });

  // wasClean is true when the connection ended with a close frame.
  it.each([
    {
      label: "the client closes with 1000",
      end: ({ client }: { client: WebSocket }) => client.close(1000, "bye"),
      event: { code: 1000, reason: "bye", wasClean: true },
    },
    {
      label: "the client drops the connection",
      end: ({ client }: { client: WebSocket }) => client.terminate(),
      event: { code: 1006, reason: "", wasClean: false },
    },
    {
      label: "the server closes with 4001",
      end: ({ ws }: { ws: WebSocket }) => ws.close(4001, "srv"),
      event: { code: 4001, reason: "srv", wasClean: true },
    },
    {
      label: "the server drops the connection",
      end: ({ ws }: { ws: WebSocket }) => ws.terminate(),
      event: { code: 1006, reason: "", wasClean: false },
    },
  ])("the close event when $label", async ({ end, event }) => {
    using connection = await connectedServerSocket();
    const { ws } = connection;
    const closed = Promise.withResolvers<unknown>();
    ws.onclose = closed.resolve;
    end(connection);

    expect(describeEvent(await closed.promise, ws)).toEqual({
      class: "CloseEvent",
      ...event,
      target: true,
      type: "close",
    });
  });

  // The built-in differs on purpose. An adapter of npm ws returns nothing, so an EventEmitter
  // that captures rejections does not get the promise of an async listener. The built-in has
  // always handed it over.
  it(`a rejection of an async listener is ${builtin ? "" : "not "}sent to 'error'`, async () => {
    const errors: unknown[] = [];
    EventEmitter.captureRejections = true;
    try {
      using connection = await connectedServerSocket();
      const { ws } = connection;
      const error = new Error("from the listener");
      const rejection = Promise.reject(error);
      rejection.catch(() => {});
      ws.on("error", (error: unknown) => errors.push(error));
      ws.onmessage = () => rejection;
      ws.addEventListener("message", () => rejection);
      ws.addEventListener("message", { handleEvent: () => rejection });
      ws.emit("message", Buffer.from("text"), false);
      await new Promise(resolve => setImmediate(resolve));

      expect(errors).toEqual(builtin ? [error, error, error] : []);
    } finally {
      EventEmitter.captureRejections = false;
    }
  });

  it("the close event when the peer sends a close frame with no code", async () => {
    using connection = await serverSocketOfRawPeer();
    const { ws, peer } = connection;
    const closed = Promise.withResolvers<unknown>();
    ws.onclose = closed.resolve;
    // FIN + close, masked with a zero key, no payload. Then the peer ends its side.
    peer.end(Buffer.from([0x88, 0x80, 0, 0, 0, 0]));

    expect(describeEvent(await closed.promise, ws)).toEqual({
      class: "CloseEvent",
      code: 1005,
      reason: "",
      wasClean: true,
      target: true,
      type: "close",
    });
  });
});

// https://github.com/oven-sh/bun/issues/7896
it("close event", async () => {
  const via = [
    function once(ws) {
      const { promise, resolve, reject } = Promise.withResolvers();
      ws.once("close", () => resolve());
      return promise;
    },
    function on(ws) {
      const { promise, resolve, reject } = Promise.withResolvers();
      ws.on("close", () => resolve());
      return promise;
    },
    function addEventListener(ws) {
      const { promise, resolve, reject } = Promise.withResolvers();
      ws.addEventListener("close", () => resolve());
      return promise;
    },
    function onclose(ws) {
      const { promise, resolve, reject } = Promise.withResolvers();
      // @ts-expect-error
      ws.onclose = () => resolve();
      return promise;
    },
  ];
  const wss = new WebSocketServer({ port: 0 });
  wss.on("connection", ws => {
    ws.onmessage = e => {
      expect(e.data).toBe("hello");
      setTimeout(() => ws.close(), 10);
    };
  });
  await Promise.all(
    via.map(async version => {
      const ws = new WebSocket("ws://localhost:" + wss.address().port);
      ws.onopen = () => {
        ws.send("hello");
      };
      return version(ws);
    }),
  );

  wss.close();
});

// https://github.com/oven-sh/bun/issues/14345
it("WebSocket finishRequest mocked", async () => {
  const { promise, resolve, reject } = Promise.withResolvers();

  using server = Bun.serve({
    port: 0,
    websocket: {
      open() {},
      close() {},
      message() {},
    },
    fetch(req, server) {
      expect(req.headers.get("X-Custom-Header")).toBe("CustomValue");
      expect(req.headers.get("Another-Header")).toBe("AnotherValue");
      return server.upgrade(req);
    },
  });

  const customHeaders = {
    "X-Custom-Header": "CustomValue",
    "Another-Header": "AnotherValue",
  };

  const ws = new WebSocket(server.url, [], {
    finishRequest: req => {
      Object.entries(customHeaders).forEach(([key, value]) => {
        req.setHeader(key, value);
      });
      req.end();
    },
  });

  ws.once("open", () => {
    ws.send("Hello");
    ws.close();
    resolve();
  });

  await promise;
});

function test(label: string, fn: (ws: WebSocket, done: (err?: unknown) => void) => void, timeout?: number) {
  it(
    label,
    testDone => {
      let isDone = false;
      const done = (err?: unknown) => {
        if (!isDone) {
          isDone = true;
          testDone(err);
        }
      };
      listen()
        .then(url => {
          const ws = new WebSocket(url);
          clients.push(ws);
          fn(ws, done);
        })
        .catch(done);
    },
    // Each test spawns its own echo-server subprocess; debug builds take
    // well over 1s to spawn + connect on slow CI runners, and so does a release build on a busy host.
    { timeout: timeout ?? (isDebug ? 10000 : 5000) },
  );
}

async function listen(): Promise<URL> {
  const pathname = path.resolve(import.meta.dir, "../../web/websocket/websocket-server-echo.mjs");
  const { promise, resolve, reject } = Promise.withResolvers();
  const server = spawn({
    cmd: [bunExe(), pathname],
    cwd: import.meta.dir,
    env: bunEnv,
    stdout: "inherit",
    stderr: "inherit",
    serialization: "json",
    ipc(message) {
      const url = message?.href;
      if (url) {
        try {
          resolve(new URL(url));
        } catch (error) {
          reject(error);
        }
      }
    },
  });

  servers.push(server);

  return await promise;
}

it("WebSocketServer should handle backpressure", async () => {
  const { promise, resolve, reject } = Promise.withResolvers();
  const PAYLOAD_SIZE = 64 * 1024;
  const ITERATIONS = 10;
  const payload = Buffer.alloc(PAYLOAD_SIZE, "a");
  let received = 0;

  const wss = new WebSocketServer({ port: 0 });

  wss.on("connection", function connection(ws) {
    ws.onerror = reject;

    let i = 0;

    async function commit(err?: Error) {
      if (err) {
        reject(err);
        return;
      }
      await Bun.sleep(10);

      if (i < ITERATIONS) {
        i++;
        ws.send(payload, commit);
      } else {
        ws.close();
      }
    }

    commit(undefined);
  });

  try {
    const ws = new WebSocket("ws://localhost:" + wss.address().port);
    ws.onmessage = event => {
      received += event.data.byteLength;
    };
    ws.onclose = resolve;
    ws.onerror = reject;
    await promise;

    expect(received).toBe(PAYLOAD_SIZE * ITERATIONS);
  } finally {
    wss.close();
  }
});

it("should abort incorrect WebSocket handshake", async () => {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const wss = new WebSocketServer({ port: 0 });
  let connectionAttempted = false;
  let testResolved = false;

  wss.on("connection", () => {
    connectionAttempted = true;
    if (!testResolved) {
      testResolved = true;
      reject(new Error("Connection should not have been established"));
    }
  });

  wss.on("error", error => {
    // Server errors are expected for invalid handshakes
    console.log("Server error (expected):", error.message);
  });

  try {
    const net = require("node:net");
    const port = (wss.address() as any).port;
    const socket = net.createConnection(port, "localhost");

    socket.on("connect", () => {
      // Send an invalid WebSocket handshake request (invalid Sec-WebSocket-Key)
      const invalidRequest = [
        "GET / HTTP/1.1",
        "Host: localhost",
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Sec-WebSocket-Key: invalid-key", // Invalid key format
        "Sec-WebSocket-Version: 13",
        "",
        "",
      ].join("\r\n");

      socket.write(invalidRequest);
    });

    let responseReceived = false;
    socket.on("data", data => {
      const response = data.toString();
      responseReceived = true;

      // Should receive a 400 Bad Request response for invalid handshake
      if (response.includes("400") && !testResolved) {
        testResolved = true;
        resolve();
      } else if (!testResolved) {
        testResolved = true;
        reject(new Error(`Expected 400 response, got: ${response}`));
      }
      socket.end();
    });

    socket.on("error", error => {
      // Connection errors are also acceptable as the server may close the connection
      if (!testResolved) {
        testResolved = true;
        resolve();
      }
    });

    socket.on("close", () => {
      // If we reach here without getting a proper response and connection wasn't attempted,
      // the server properly rejected the invalid handshake
      if (!responseReceived && !connectionAttempted && !testResolved) {
        testResolved = true;
        resolve();
      }
    });

    await promise;
  } finally {
    wss.close();
  }

  expect(connectionAttempted).toBeFalse();
  expect(testResolved).toBeTrue();
});

it("Server should be able to send empty pings", async () => {
  // WebSocket frame creation function with masking
  function createWebSocketFrame(message: string) {
    const messageBuffer = Buffer.from(message);
    const frame = [];

    // Add FIN bit and opcode for text frame
    frame.push(0x81);

    // Payload length
    if (messageBuffer.length < 126) {
      frame.push(messageBuffer.length | 0x80); // Mask bit set
    } else if (messageBuffer.length < 65536) {
      frame.push(126 | 0x80); // Mask bit set
      frame.push((messageBuffer.length >> 8) & 0xff);
      frame.push(messageBuffer.length & 0xff);
    } else {
      frame.push(127 | 0x80); // Mask bit set
      for (let i = 7; i >= 0; i--) {
        frame.push((messageBuffer.length >> (i * 8)) & 0xff);
      }
    }

    // Generate masking key
    const maskingKey = crypto.randomBytes(4);
    frame.push(...maskingKey);

    // Mask the payload
    const maskedPayload = Buffer.alloc(messageBuffer.length);
    for (let i = 0; i < messageBuffer.length; i++) {
      maskedPayload[i] = messageBuffer[i] ^ maskingKey[i % 4];
    }

    // Combine frame header and masked payload
    return Buffer.concat([Buffer.from(frame), maskedPayload]);
  }

  async function checkPing(helloMessage: string, pingMessage?: string) {
    const { promise, resolve, reject } = Promise.withResolvers();
    const server = new WebSocketServer({ noServer: true });
    const httpServer = createServer();

    try {
      server.on("connection", async incoming => {
        incoming.on("message", value => {
          try {
            expect(value.toString()).toBe(helloMessage);
            if (arguments.length > 1) {
              incoming.ping(pingMessage);
            } else {
              incoming.ping();
            }
          } catch (e) {
            reject(e);
          }
        });
      });

      httpServer.on("upgrade", async (request, socket, head) => {
        server.handleUpgrade(request, socket, head, ws => {
          server.emit("connection", ws, request);
        });
      });
      httpServer.listen(0);
      await once(httpServer, "listening");
      const socket = connect({
        port: (httpServer.address() as AddressInfo).port,
        host: "127.0.0.1",
      });

      let upgradeResponse = "";

      let state = 0; //connecting
      socket.on("data", (data: Buffer) => {
        switch (state) {
          case 0: {
            upgradeResponse += data.toString("utf8");

            if (upgradeResponse.indexOf("\r\n\r\n") !== -1) {
              if (upgradeResponse.indexOf("HTTP/1.1 101 Switching Protocols") !== -1) {
                state = 1;
                socket.write(createWebSocketFrame(helloMessage));
              } else {
                reject(new Error("Failed to Upgrade WebSockets"));
                state = 2;
                socket.end();
              }
            }
            break;
          }
          case 1: {
            if (data.at(0) === 137) {
              try {
                const len = data.at(1) as number;
                if (len > 0) {
                  const str = data.slice(2, len + 2).toString("utf8");
                  resolve(str);
                } else {
                  resolve("");
                }
              } catch (e) {
                reject(e);
              }
              state = 2;
              socket.end();
              break;
            }
            reject(new Error("Unexpected data received"));
          }
          case 2: {
            reject(new Error("Connection Closed"));
          }
        }
      });

      // Generate a Sec-WebSocket-Key
      const key = crypto.randomBytes(16).toString("base64");

      // Create the WebSocket upgrade request
      socket.write(
        [
          `GET / HTTP/1.1`,
          `Host: 127.0.0.1`,
          `Upgrade: websocket`,
          `Connection: Upgrade`,
          `Sec-WebSocket-Key: ${key}`,
          `Sec-WebSocket-Version: 13`,
          `\r\n`,
        ].join("\r\n"),
      );

      return await promise;
    } finally {
      httpServer.closeAllConnections();
      httpServer.close();
    }
  }
  {
    // test without any payload
    const pingMessage = await checkPing("");
    expect(pingMessage).toBe("");
  }
  {
    // test with null payload
    //@ts-ignore
    const pingMessage = await checkPing("", null);
    expect(pingMessage).toBe("");
  }
  {
    // test with undefined payload
    const pingMessage = await checkPing("", undefined);
    expect(pingMessage).toBe("");
  }
  {
    // test with some payload
    const pingMessage = await checkPing("Hello", "bun");
    expect(pingMessage).toBe("bun");
  }
  {
    // test limits
    const pingPayload = Buffer.alloc(125, "b").toString();
    const pingMessage = await checkPing("Hello, World", pingPayload);
    expect(pingMessage).toBe(pingPayload);
  }

  {
    // > 125 bytes throws RangeError synchronously, matching npm ws
    const pingPayload = Buffer.alloc(126, "b").toString();
    let err: unknown;
    await checkPing("Hello, World", pingPayload).catch(e => (err = e));
    expect(err).toBeInstanceOf(RangeError);
    expect((err as Error).message).toContain("must not be greater than 125 bytes");
  }
});

// Verify ws.ping() / ws.pong() without arguments send empty control frames,
// not the literal string "undefined" (9 bytes).
describe("ping/pong no-arg payload", () => {
  it("ws.ping() sends empty payload", async () => {
    const wss = new WebSocketServer({ port: 0 });
    const { resolve, reject, promise } = Promise.withResolvers<void>();

    wss.on("connection", serverWs => {
      serverWs.on("ping", (data: Buffer) => {
        try {
          expect(data).toBeInstanceOf(Buffer);
          expect(data.length).toBe(0);
          resolve();
        } catch (e) {
          reject(e);
        } finally {
          serverWs.close();
          wss.close();
        }
      });
    });

    const ws = new WebSocket("ws://localhost:" + (wss.address() as AddressInfo).port);
    ws.on("open", () => ws.ping());
    await promise;
  });

  it("ws.pong() sends empty payload", async () => {
    const wss = new WebSocketServer({ port: 0 });
    const { resolve, reject, promise } = Promise.withResolvers<void>();

    wss.on("connection", serverWs => {
      serverWs.on("pong", (data: Buffer) => {
        try {
          expect(data).toBeInstanceOf(Buffer);
          expect(data.length).toBe(0);
          resolve();
        } catch (e) {
          reject(e);
        } finally {
          serverWs.close();
          wss.close();
        }
      });
    });

    const ws = new WebSocket("ws://localhost:" + (wss.address() as AddressInfo).port);
    ws.on("open", () => ws.pong());
    await promise;
  });

  it("ws.ping(data) sends correct payload", async () => {
    const wss = new WebSocketServer({ port: 0 });
    const { resolve, reject, promise } = Promise.withResolvers<void>();

    wss.on("connection", serverWs => {
      serverWs.on("ping", (data: Buffer) => {
        try {
          expect(data).toBeInstanceOf(Buffer);
          expect(data.toString()).toBe("hello");
          resolve();
        } catch (e) {
          reject(e);
        } finally {
          serverWs.close();
          wss.close();
        }
      });
    });

    const ws = new WebSocket("ws://localhost:" + (wss.address() as AddressInfo).port);
    ws.on("open", () => ws.ping(Buffer.from("hello")));
    await promise;
  });

  it("ws.pong(data) sends correct payload", async () => {
    const wss = new WebSocketServer({ port: 0 });
    const { resolve, reject, promise } = Promise.withResolvers<void>();

    wss.on("connection", serverWs => {
      serverWs.on("pong", (data: Buffer) => {
        try {
          expect(data).toBeInstanceOf(Buffer);
          expect(data.toString()).toBe("hello");
          resolve();
        } catch (e) {
          reject(e);
        } finally {
          serverWs.close();
          wss.close();
        }
      });
    });

    const ws = new WebSocket("ws://localhost:" + (wss.address() as AddressInfo).port);
    ws.on("open", () => ws.pong(Buffer.from("hello")));
    await promise;
  });
});

describe("handleUpgrade without an Upgrade header", () => {
  it("responds with 400 Invalid Upgrade header instead of throwing", () => {
    const wss = new WebSocketServer({ noServer: true });
    const written: { code?: number; headers?: Record<string, unknown>; body?: string; ended: boolean } = {
      ended: false,
    };
    const response = {
      writeHead(code: number, headers: Record<string, unknown>) {
        written.code = code;
        written.headers = headers;
      },
      write(body: string) {
        written.body = body;
      },
      end() {
        written.ended = true;
      },
    };
    // A socket that node:http handed to a 'request' listener, with its ServerResponse attached.
    const socket = Object.assign(new EventEmitter(), { _httpMessage: response });
    const request = {
      method: "GET",
      headers: {
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
      },
    };
    let called = false;
    expect(() =>
      wss.handleUpgrade(request as any, socket as any, Buffer.alloc(0), () => {
        called = true;
      }),
    ).not.toThrow();
    expect(called).toBe(false);
    expect(written.code).toBe(400);
    expect(written.body).toBe("Invalid Upgrade header");
    expect(written.headers).toEqual({
      Connection: "close",
      "Content-Type": "text/html",
      "Content-Length": Buffer.byteLength("Invalid Upgrade header"),
    });
    expect(written.ended).toBe(true);
  });

  it("emits wsClientError with the Invalid Upgrade header message", () => {
    const wss = new WebSocketServer({ noServer: true });
    const socket = new EventEmitter();
    const request = {
      method: "GET",
      headers: {
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
      },
    };
    let received: { err?: Error; socket?: unknown; req?: unknown } = {};
    wss.on("wsClientError", (err: Error, sock: unknown, req: unknown) => {
      received = { err, socket: sock, req };
    });
    let called = false;
    expect(() =>
      wss.handleUpgrade(request as any, socket as any, Buffer.alloc(0), () => {
        called = true;
      }),
    ).not.toThrow();
    expect(called).toBe(false);
    expect(received.err).toBeInstanceOf(Error);
    expect(received.err?.message).toBe("Invalid Upgrade header");
    expect(received.socket).toBe(socket);
    expect(received.req).toBe(request);
  });
});

// Same behavior as the npm "ws" package. node:http hands an 'upgrade' request
// over as a raw socket with no ServerResponse: a handshake the server rejects
// is answered by writing to that socket and closing it, a socket whose
// connection is gone is destroyed without a callback, and a live socket can
// still be upgraded from a later task (after the app awaited something).
describe("handleUpgrade on a node:http upgrade socket", () => {
  function upgradeRequest({
    path = "/",
    key = "dGhlIHNhbXBsZSBub25jZQ==",
    version = "13",
    body = "",
    httpVersion = "1.1",
  }: { path?: string; key?: string; version?: string; body?: string; httpVersion?: string } = {}) {
    return [
      `GET ${path} HTTP/${httpVersion}`,
      "Host: localhost",
      "Connection: Upgrade",
      "Upgrade: websocket",
      `Sec-WebSocket-Version: ${version}`,
      ...(key ? [`Sec-WebSocket-Key: ${key}`] : []),
      ...(body ? [`Content-Length: ${body.length}`] : []),
      "",
      body,
    ].join("\r\n");
  }

  // The reply the npm package writes for a rejected handshake.
  function rejection(status: string, body = status.slice(4), headers: string[] = []) {
    return [
      `HTTP/1.1 ${status}`,
      "Connection: close",
      "Content-Type: text/html",
      `Content-Length: ${body.length}`,
      ...headers,
      "",
      body,
    ].join("\r\n");
  }

  // Sends `request` to a node:http server over a raw TCP connection and hands
  // back what the server's 'upgrade' listener received.
  async function receiveUpgrade(request: string | Buffer, server = createServer()) {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const upgrade = once(server, "upgrade");
    const client = connect((server.address() as AddressInfo).port, "127.0.0.1");
    client.on("error", () => {});
    let data = "";
    client.on("data", chunk => (data += chunk.toString("latin1")));
    // Not events.once(): that rejects on 'error', and a reset connection emits
    // 'error' before 'close'. Whatever happened, 'close' ends the wait.
    const closed = new Promise<void>(resolve => client.once("close", resolve));
    await once(client, "connect");
    client.write(request);
    const [req, socket, head] = await upgrade;
    return {
      req,
      socket,
      head,
      client,
      // What the client received, once `until` has arrived or the server has
      // closed the connection.
      received(until?: string) {
        return new Promise<string>(resolve => {
          const check = () => {
            if (until !== undefined && data.includes(until)) resolve(data);
          };
          client.on("data", check);
          closed.then(() => resolve(data));
          check();
        });
      },
      async [Symbol.asyncDispose]() {
        client.destroy();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
      },
    };
  }

  it("upgrades a live socket from a later task", async () => {
    await using upgrade = await receiveUpgrade(upgradeRequest());
    const { req, socket, head } = upgrade;
    const wss = new WebSocketServer({ noServer: true });
    const connections: unknown[] = [];

    // The 'upgrade' listener returned without calling handleUpgrade(), as an
    // app that checks credentials first does.
    await new Promise(resolve => setImmediate(resolve));
    expect(() => wss.handleUpgrade(req, socket, head, ws => connections.push(ws))).not.toThrow();

    expect(connections).toHaveLength(1);
    expect(wss.clients.size).toBe(1);
    expect(await upgrade.received("\r\n\r\n")).toStartWith("HTTP/1.1 101 Switching Protocols\r\n");
  });

  // An HTTP/1.0 request has no keep-alive, but the 101 switches protocols: the
  // close after the response ends with the HTTP exchange, not with the
  // WebSocket that takes over the socket. From a later task the socket is
  // outside the parser's corked write, and the HTTP layer used to shut it down
  // right after the 101, under the new WebSocket (a use-after-free of the
  // socket once the 'close' reached JS).
  it("upgrades a live HTTP/1.0 socket from a later task", async () => {
    await using upgrade = await receiveUpgrade(upgradeRequest({ httpVersion: "1.0" }));
    const { req, socket, head, client } = upgrade;
    const wss = new WebSocketServer({ noServer: true });
    const closed = Promise.withResolvers<number>();
    const clientClosed = new Promise<string>(resolve => client.once("close", () => resolve("client closed")));

    await new Promise(resolve => setImmediate(resolve));
    wss.handleUpgrade(req, socket, head, ws => {
      ws.on("close", code => closed.resolve(code));
      ws.send("from handleUpgrade");
    });
    expect(wss.clients.size).toBe(1);

    // The 101, then the text frame sent from the callback (FIN + text, 18 bytes).
    const received = await upgrade.received("from handleUpgrade");
    expect(received).toStartWith("HTTP/1.1 101 Switching Protocols\r\n");
    expect(received).toEndWith("\r\n\r\n\x81\x12from handleUpgrade");

    // A masked Close(1000) from the client reaches the server's close handler.
    client.write(Buffer.from([0x88, 0x82, 0x00, 0x00, 0x00, 0x00, 0x03, 0xe8]));
    expect(await Promise.race([closed.promise, clientClosed])).toBe(1000);
  });

  // server.upgrade(res, { headers }) converts `headers` after it checks that
  // the response is still open. The conversion runs user code (a getter, a
  // toString(), an iterator). If that code ends the response, upgrade() must
  // return false and write nothing: the header bytes used to land after the
  // finished response.
  describe.each([
    [
      "a getter",
      (end: () => void) => ({
        get "x-a"() {
          end();
          return "1";
        },
      }),
    ],
    [
      "a toString()",
      (end: () => void) => ({
        "x-a": {
          toString() {
            end();
            return "1";
          },
        },
      }),
    ],
    [
      "an iterator",
      (end: () => void) => ({
        *[Symbol.iterator]() {
          end();
          yield ["x-a", "1"];
        },
      }),
    ],
  ])("when %s in options.headers ends the response", (_, headers) => {
    it("returns false and writes nothing", async () => {
      await using upgrade = await receiveUpgrade(upgradeRequest());
      const { socket } = upgrade;
      const internals = Symbol.for("::bunternal::");
      const res = socket[internals];
      const bunServer = socket.server[internals];

      expect(bunServer.upgrade(res, { data: {}, headers: headers(() => res.end()) })).toBe(false);

      // Anything upgrade() wrote is already on the socket. Close it so that
      // the client sees the whole exchange.
      socket.destroy();
      expect(await upgrade.received()).toMatch(/^HTTP\/1\.1 200 OK\r\n(?:[^\r\n]+\r\n)*Content-Length: 0\r\n\r\n$/);
    });
  });

  it("returns without calling back when the socket was destroyed before handleUpgrade()", async () => {
    await using upgrade = await receiveUpgrade(upgradeRequest());
    const { req, socket, head } = upgrade;
    const wss = new WebSocketServer({ noServer: true });
    const connections: unknown[] = [];

    socket.destroy();
    expect(() => wss.handleUpgrade(req, socket, head, ws => connections.push(ws))).not.toThrow();

    expect(connections).toEqual([]);
    expect(wss.clients.size).toBe(0);
    expect(await upgrade.received()).toBe("");
  });

  it("returns without writing when the socket was destroyed and the handshake is invalid", async () => {
    await using upgrade = await receiveUpgrade(upgradeRequest({ key: "" }));
    const { req, socket, head } = upgrade;
    const wss = new WebSocketServer({ noServer: true });
    const connections: unknown[] = [];

    socket.destroy();
    expect(() => wss.handleUpgrade(req, socket, head, ws => connections.push(ws))).not.toThrow();

    expect(connections).toEqual([]);
    expect(await upgrade.received()).toBe("");
  });

  it("destroys the socket when the client went away while verifyClient was pending", async () => {
    await using upgrade = await receiveUpgrade(upgradeRequest());
    const { req, socket, head, client } = upgrade;
    let verified!: (verified: boolean) => void;
    const wss = new WebSocketServer({
      noServer: true,
      verifyClient: (_info: unknown, callback: (verified: boolean) => void) => {
        verified = callback;
      },
    });
    const connections: unknown[] = [];
    wss.handleUpgrade(req, socket, head, ws => connections.push(ws));

    // The client's FIN ends the readable side. The socket stays writable
    // (allowHalfOpen), which is the state the upstream check is written for.
    const ended = once(socket, "end");
    client.destroy();
    await ended;
    expect({ readable: socket.readable, writable: socket.writable }).toEqual({ readable: false, writable: true });

    const closed = once(socket, "close");
    expect(() => verified(true)).not.toThrow();
    await closed;

    expect(connections).toEqual([]);
    expect(wss.clients.size).toBe(0);
    expect(socket.destroyed).toBe(true);
  });

  it("rejects an unsupported Sec-WebSocket-Version with a 400 and closes the connection", async () => {
    await using upgrade = await receiveUpgrade(upgradeRequest({ version: "7" }));
    const { req, socket, head } = upgrade;
    const wss = new WebSocketServer({ noServer: true });
    const connections: unknown[] = [];

    expect(() => wss.handleUpgrade(req, socket, head, ws => connections.push(ws))).not.toThrow();

    expect(await upgrade.received()).toBe(
      rejection("400 Bad Request", "Missing or invalid Sec-WebSocket-Version header", ["Sec-WebSocket-Version: 13, 8"]),
    );
    expect(connections).toEqual([]);
    expect(socket.destroyed).toBe(true);
  });

  it("answers 503 and closes the connection when the WebSocketServer is closing", async () => {
    await using upgrade = await receiveUpgrade(upgradeRequest());
    const { req, socket, head } = upgrade;
    const wss = new WebSocketServer({ noServer: true });
    const connections: unknown[] = [];

    wss.close();
    expect(() => wss.handleUpgrade(req, socket, head, ws => connections.push(ws))).not.toThrow();

    expect(await upgrade.received()).toBe(rejection("503 Service Unavailable"));
    expect(connections).toEqual([]);
    expect(socket.destroyed).toBe(true);
  });

  it("answers once when no WebSocketServer on the http.Server serves the path", async () => {
    const server = createServer();
    const chat = new WebSocketServer({ server, path: "/chat" });
    const other = new WebSocketServer({ server, path: "/other" });
    const connections: unknown[] = [];
    chat.on("connection", ws => connections.push(ws));
    other.on("connection", ws => connections.push(ws));

    // Both servers reject the request inside the 'upgrade' event. The first
    // one ends the socket, so the second one's reply fails with a socket
    // 'error', which the error handler handleUpgrade() installed absorbs.
    await using upgrade = await receiveUpgrade(upgradeRequest({ path: "/nope" }), server);

    expect(await upgrade.received()).toBe(rejection("400 Bad Request"));
    expect(connections).toEqual([]);
    expect(upgrade.socket.destroyed).toBe(true);
    chat.close();
    other.close();
  });

  it("upgrades a live socket from a later task when the request carried a body", async () => {
    // node:http releases a request with a body once the body has arrived,
    // not when the 'upgrade' listener returns. The body is never read here.
    await using upgrade = await receiveUpgrade(upgradeRequest({ body: "hello" }));
    const { req, socket, head } = upgrade;
    const wss = new WebSocketServer({ noServer: true });
    const connections: unknown[] = [];

    await new Promise(resolve => setImmediate(resolve));
    expect(() => wss.handleUpgrade(req, socket, head, ws => connections.push(ws))).not.toThrow();

    expect(connections).toHaveLength(1);
    expect(await upgrade.received("\r\n\r\n")).toStartWith("HTTP/1.1 101 Switching Protocols\r\n");
  });

  // An upgrade from the request's body handler left the HTTP context marked as
  // upgraded. The next request on any other connection of the server then
  // stopped the parser, and requests pipelined behind it got no answer (#43163).
  for (const [where, request, body] of [
    ["in the same read as the head", upgradeRequest({ body: "hello" }), ""],
    ["in a read of its own", upgradeRequest({ body: "hello" }).slice(0, -"hello".length), "hello"],
  ] as const) {
    it(`upgrades from the body handler with the body ${where}, and the next connection still pipelines`, async () => {
      const server = createServer((req, res) => res.end(req.url));
      const wss = new WebSocketServer({ noServer: true });
      const upgraded = Promise.withResolvers<void>();
      // Registered before the request arrives, so 'end' is armed while the
      // parser still runs and handleUpgrade() runs from inside it.
      server.on("upgrade", (req, socket, head) => {
        req.on("end", () => wss.handleUpgrade(req, socket, head, () => upgraded.resolve()));
        req.resume();
      });
      await using upgrade = await receiveUpgrade(request, server);
      if (body) upgrade.client.write(body);
      await upgraded.promise;
      expect(await upgrade.received("\r\n\r\n")).toStartWith("HTTP/1.1 101 Switching Protocols\r\n");

      // Two requests in one write on a second connection. Both get a response,
      // and the server closes the connection after the second.
      const other = connect((server.address() as AddressInfo).port, "127.0.0.1");
      other.on("error", () => {});
      let data = "";
      other.on("data", chunk => (data += chunk.toString("latin1")));
      const closed = new Promise<void>(resolve => other.once("close", resolve));
      await once(other, "connect");
      other.write("GET /one HTTP/1.1\r\nHost: x\r\n\r\nGET /two HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
      await closed;
      expect(data.match(/\/(one|two)/g)).toEqual(["/one", "/two"]);
      wss.close();
    });
  }

  // The bytes of the request body are not frames. The WebSocket reads from the
  // first byte behind the body, where a client that does not wait for the 101
  // can already have a frame (RFC 6455 4.1).
  for (const [framing, header, body] of [
    ["Content-Length", "Content-Length: 5", "hello"],
    ["chunked", "Transfer-Encoding: chunked", "5\r\nhello\r\n0\r\n\r\n"],
  ] as const) {
    for (const where of ["in the same read as the head", "in a read of its own"] as const) {
      it(`keeps the WebSocket of an upgrade from the body handler open, ${framing} body ${where}`, async () => {
        const server = createServer();
        const wss = new WebSocketServer({ noServer: true });
        server.on("upgrade", (req, socket, head) => {
          req.on("end", () =>
            wss.handleUpgrade(req, socket, head, ws => ws.on("message", message => ws.send(`echo:${message}`))),
          );
          req.resume();
        });
        const head = upgradeRequest().replace("\r\n\r\n", `\r\n${header}\r\n\r\n`);
        // FIN + text "ping", masked with a zero key.
        const frame = Buffer.concat([Buffer.from([0x81, 0x84, 0, 0, 0, 0]), Buffer.from("ping")]);
        const sameRead = where === "in the same read as the head";
        await using upgrade = await receiveUpgrade(
          sameRead ? Buffer.concat([Buffer.from(head + body), frame]) : head,
          server,
        );
        if (!sameRead) upgrade.client.write(Buffer.concat([Buffer.from(body), frame]));
        expect(await upgrade.received("echo:ping")).toContain("echo:ping");
        wss.close();
      });
    }
  }

  // The parser of connection A must not take an upgrade of connection B, done
  // from A's body handler, for an upgrade of A: the request pipelined behind
  // A's body still gets its response, and A closes on Connection: close.
  it("upgrades a parked request from another connection's body handler and keeps parsing that connection", async () => {
    const wss = new WebSocketServer({ noServer: true });
    const connections: unknown[] = [];
    const server = createServer((req, res) => {
      if (req.method !== "POST") return res.end(req.url);
      req.on("end", () => {
        wss.handleUpgrade(upgrade.req, upgrade.socket, upgrade.head, ws => connections.push(ws));
        res.end("posted");
      });
      req.resume();
    });
    // Connection B: the Upgrade request, parked by the 'upgrade' listener.
    await using upgrade = await receiveUpgrade(upgradeRequest(), server);

    // Connection A: a POST whose 'end' upgrades B, and a request behind it.
    const other = connect((server.address() as AddressInfo).port, "127.0.0.1");
    other.on("error", () => {});
    let data = "";
    other.on("data", chunk => (data += chunk.toString("latin1")));
    const closed = new Promise<void>(resolve => other.once("close", resolve));
    await once(other, "connect");
    other.write(
      "POST /post HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\n\r\nhello" +
        "GET /after HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
    );
    await closed;
    expect(data.match(/posted|\/after/g)).toEqual(["posted", "/after"]);

    expect(connections).toHaveLength(1);
    expect(await upgrade.received("\r\n\r\n")).toStartWith("HTTP/1.1 101 Switching Protocols\r\n");
    wss.close();
  });

  it("leaves a connection alone that another WebSocketServer on the same http.Server took", async () => {
    const server = createServer();
    // Registered first, so it sees the socket before either WebSocketServer does.
    let errorListenersBefore = -1;
    server.on("upgrade", (_req, socket) => (errorListenersBefore = socket.listenerCount("error")));
    const chat = new WebSocketServer({ server, path: "/chat" });
    const other = new WebSocketServer({ server, path: "/other" });
    const connections: unknown[] = [];
    chat.on("connection", ws => connections.push(ws));
    other.on("connection", ws => connections.push(ws));

    await using upgrade = await receiveUpgrade(upgradeRequest({ path: "/chat" }), server);

    // Both servers saw the 'upgrade' event: /chat upgraded the connection, and
    // /other's 400 for the path mismatch must not reach it. Writing that 400
    // ends the socket, so `destroyed` is what detects it.
    expect(connections).toHaveLength(1);
    const received = await upgrade.received("\r\n\r\n");
    expect(received).toStartWith("HTTP/1.1 101 Switching Protocols\r\n");
    expect(received).not.toContain("HTTP/1.1 400");
    expect(upgrade.socket.destroyed).toBe(false);
    // Both servers installed the error handler. The socket carries one copy.
    expect(upgrade.socket.listenerCount("error")).toBe(errorListenersBefore + 1);
    chat.close();
    other.close();
  });

  // A client that does not wait for the 101 can get frames to the server before
  // the upgrade. The npm package parses them: it unshifts the 'upgrade' event's
  // head into the socket and reads frames from the socket stream.
  describe("frames that arrive before the 101", () => {
    // FIN + text, masked with a zero key.
    const text = (payload: string) =>
      Buffer.concat([Buffer.from([0x81, 0x80 | payload.length, 0, 0, 0, 0]), Buffer.from(payload)]);
    const requestAndEarlyFrame = () => Buffer.concat([Buffer.from(upgradeRequest()), text("early")]);

    // Every message the connections of `wss` received, up to "later". Rejects
    // if a connection closes first.
    function messagesOf(wss: WebSocketServer) {
      const messages: string[] = [];
      const { promise, resolve, reject } = Promise.withResolvers<string[]>();
      // A test that fails before it awaits this must not add an unhandled rejection.
      promise.catch(() => {});
      wss.on("connection", ws => {
        ws.on("message", data => {
          messages.push(String(data));
          if (String(data) === "later") resolve(messages);
        });
        ws.on("close", code => reject(new Error(`closed with ${code} after ${JSON.stringify(messages)}`)));
      });
      return promise;
    }

    // Sends "later" once the 101 is in, then waits for the server to see it.
    async function sendLater(upgrade: Awaited<ReturnType<typeof receiveUpgrade>>, messages: Promise<string[]>) {
      expect(await upgrade.received("\r\n\r\n")).toStartWith("HTTP/1.1 101 Switching Protocols\r\n");
      upgrade.client.write(text("later"));
      return await messages;
    }

    it("are delivered when handleUpgrade() runs inside the 'upgrade' event", async () => {
      const server = createServer();
      const wss = new WebSocketServer({ server });
      const messages = messagesOf(wss);

      await using upgrade = await receiveUpgrade(requestAndEarlyFrame(), server);

      expect(await sendLater(upgrade, messages)).toEqual(["early", "later"]);
      wss.close();
    });

    // node:http on Node reads a body that the upgrade request declares as the
    // request's body. Here the body is dropped. It is never frames.
    it("are not taken from a body of the upgrade request", async () => {
      const server = createServer();
      const wss = new WebSocketServer({ server });
      const messages = messagesOf(wss);

      await using upgrade = await receiveUpgrade(upgradeRequest({ body: '{"hello":"world"}' }), server);

      expect(await sendLater(upgrade, messages)).toEqual(["later"]);
      wss.close();
    });

    // https://github.com/oven-sh/bun/issues/43149: a handleUpgrade() in a later
    // task hands the connection to the native WebSocket without the bytes that
    // node:http received before it (head, or data of the socket).
    it.todo("are delivered when handleUpgrade() runs in a later task", async () => {
      const wss = new WebSocketServer({ noServer: true });
      const messages = messagesOf(wss);

      await using upgrade = await receiveUpgrade(requestAndEarlyFrame());
      await new Promise(resolve => setImmediate(resolve));
      wss.handleUpgrade(upgrade.req, upgrade.socket, upgrade.head, ws => wss.emit("connection", ws, upgrade.req));

      expect(await sendLater(upgrade, messages)).toEqual(["early", "later"]);
    });

    it.todo("are delivered when verifyClient answers in a later task", async () => {
      const server = createServer();
      const wss = new WebSocketServer({
        server,
        verifyClient: (_info: unknown, callback: (verified: boolean) => void) => setImmediate(() => callback(true)),
      });
      const messages = messagesOf(wss);

      await using upgrade = await receiveUpgrade(requestAndEarlyFrame(), server);

      expect(await sendLater(upgrade, messages)).toEqual(["early", "later"]);
      wss.close();
    });

    it.todo("are delivered when they arrive in a read of their own before handleUpgrade()", async () => {
      const wss = new WebSocketServer({ noServer: true });
      const messages = messagesOf(wss);

      await using upgrade = await receiveUpgrade(upgradeRequest());
      upgrade.client.write(text("early"));
      // 'readable' leaves the bytes in the socket for handleUpgrade().
      await once(upgrade.socket, "readable");
      wss.handleUpgrade(upgrade.req, upgrade.socket, upgrade.head, ws => wss.emit("connection", ws, upgrade.req));

      expect(await sendLater(upgrade, messages)).toEqual(["early", "later"]);
    });
  });

  it("throws when called twice with the same socket", async () => {
    await using upgrade = await receiveUpgrade(upgradeRequest());
    const { req, socket, head } = upgrade;
    const wss = new WebSocketServer({ noServer: true });
    const connections: unknown[] = [];

    wss.handleUpgrade(req, socket, head, ws => connections.push(ws));
    expect(connections).toHaveLength(1);

    expect(() => wss.handleUpgrade(req, socket, head, ws => connections.push(ws))).toThrow(
      "server.handleUpgrade() was called more than once with the same socket, possibly due to a misconfiguration",
    );
    expect(connections).toHaveLength(1);
  });
});

describe("module loading", () => {
  it("require('ws') does not load node:http eagerly", async () => {
    // Loading node:http materializes the HTTPParser binding; requiring only
    // the ws client must not pay that cost.
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { heapStats } = require("bun:jsc");
         require("ws");
         const afterWs = heapStats().objectTypeCounts.HTTPParser ?? 0;
         require("node:http");
         const afterHttp = heapStats().objectTypeCounts.HTTPParser ?? 0;
         console.log(JSON.stringify({ afterWs, httpMarkerWorks: afterHttp > 0 }));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    // httpMarkerWorks guards the detector: if node:http ever stops creating
    // HTTPParser structures at load time, this test needs a new marker.
    expect(JSON.parse(stdout)).toEqual({ afterWs: 0, httpMarkerWorks: true });
    expect(exitCode).toBe(0);
  });
});
