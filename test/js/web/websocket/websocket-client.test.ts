import type { Subprocess } from "bun";
import { spawn } from "bun";
import { heapStats } from "bun:jsc";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, nodeExe, tls as tlsCerts } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, X509Certificate } from "node:crypto";
import { once } from "node:events";
import net, { type AddressInfo, createServer } from "node:net";
import * as path from "node:path";
import tls from "node:tls";
import { Worker } from "node:worker_threads";
import { type ClientOptions, WebSocket as NodeWS, WebSocketServer } from "ws";
import {
  clientEvents,
  failingSession,
  ignoreAmbientNoProxy,
  startRecordingProxy,
  startRenegotiatingWssServer,
} from "./proxy-test-utils";
import { createPeer, OP, RawSocket, response101 } from "./raw-peer";
function test(
  label: string,
  fn: (ws: WebSocket, done: (err?: unknown) => void) => void,
  timeout?: number,
  isOnly = false,
) {
  return makeTest(label, fn, timeout, isOnly);
}
test.only = (label, fn, timeout) => makeTest(label, fn, timeout, true);

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
];

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
];

const messages = [...strings, ...buffers];

const binaryTypes = [
  {
    label: "nodebuffer",
    type: Buffer,
  },
  {
    label: "arraybuffer",
    type: ArrayBuffer,
  },
] as const;

let server: Subprocess;
let serverUrl: URL;

beforeAll(async () => {
  serverUrl = await listen();
});

afterAll(() => {
  server?.kill();
});

describe("WebSocket", () => {
  test("url", (ws, done) => {
    expect(ws.url).toStartWith("ws://");
    done();
  });
  test("readyState", (ws, done) => {
    expect(ws.readyState).toBe(WebSocket.CONNECTING);
    ws.addEventListener("open", () => {
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    });
    ws.addEventListener("close", () => {
      expect(ws.readyState).toBe(WebSocket.CLOSED);
      done();
    });
  });
  describe("binaryType", () => {
    test("(default)", (ws, done) => {
      expect(ws.binaryType).toBe("nodebuffer");
      done();
    });
    test("(invalid) is ignored", (ws, done) => {
      ws.binaryType = "arraybuffer";
      // @ts-expect-error
      ws.binaryType = "invalid";
      expect(ws.binaryType).toBe("arraybuffer");
      done();
    });
    for (const { label, type } of binaryTypes) {
      test(label, (ws, done) => {
        ws.binaryType = label;
        ws.addEventListener("open", () => {
          expect(ws.binaryType).toBe(label);
          ws.send(new Uint8Array(1));
        });
        ws.addEventListener("message", ({ data }) => {
          expect(data).toBeInstanceOf(type);
          ws.ping();
        });
        ws.addEventListener("ping", ({ data }: any) => {
          expect(data).toBeInstanceOf(type);
          ws.pong();
        });
        ws.addEventListener("pong", ({ data }: any) => {
          expect(data).toBeInstanceOf(type);
          done();
        });
      });
    }
  });
  describe("send()", () => {
    for (const { label, message, bytes } of messages) {
      test(label, (ws, done) => {
        ws.addEventListener("open", () => {
          ws.send(message);
        });
        ws.addEventListener("message", ({ data }) => {
          if (typeof data === "string") {
            expect(data).toBe(message as string);
          } else {
            expect(data).toEqual(Buffer.from(bytes));
          }
          done();
        });
      });
    }
  });
  describe("ping()", () => {
    test("(no argument)", (ws, done) => {
      ws.addEventListener("open", () => {
        ws.ping();
      });
      ws.addEventListener("ping", ({ data }: any) => {
        expect(data).toBeInstanceOf(Buffer);
        expect(data).toEqual(Buffer.alloc(0));
        done();
      });
    });
    // The payload is optional. undefined and null mean "no payload", like in the `ws` package.
    // send() is different: its argument is required, so it stringifies them.
    for (const nullish of [undefined, null]) {
      test(`(${nullish})`, (ws, done) => {
        ws.addEventListener("open", () => {
          ws.ping(nullish as undefined);
        });
        ws.addEventListener("ping", ({ data }: any) => {
          expect(data).toEqual(Buffer.alloc(0));
          done();
        });
      });
    }
    test('(the string "undefined")', (ws, done) => {
      ws.addEventListener("open", () => {
        ws.ping("undefined");
      });
      ws.addEventListener("ping", ({ data }: any) => {
        expect(data).toEqual(Buffer.from("undefined"));
        done();
      });
    });
    for (const { label, message, bytes } of messages) {
      test(label, (ws, done) => {
        ws.addEventListener("open", () => {
          ws.ping(message);
        });
        ws.addEventListener("ping", ({ data }: any) => {
          expect(data).toEqual(Buffer.from(bytes));
          done();
        });
      });
    }
  });
  describe("pong()", () => {
    test("(no argument)", (ws, done) => {
      ws.addEventListener("open", () => {
        ws.pong();
      });
      ws.addEventListener("pong", ({ data }: any) => {
        expect(data).toBeInstanceOf(Buffer);
        expect(data).toEqual(Buffer.alloc(0));
        done();
      });
    });
    // The payload is optional. undefined and null mean "no payload", like in the `ws` package.
    // send() is different: its argument is required, so it stringifies them.
    for (const nullish of [undefined, null]) {
      test(`(${nullish})`, (ws, done) => {
        ws.addEventListener("open", () => {
          ws.pong(nullish as undefined);
        });
        ws.addEventListener("pong", ({ data }: any) => {
          expect(data).toEqual(Buffer.alloc(0));
          done();
        });
      });
    }
    test('(the string "undefined")', (ws, done) => {
      ws.addEventListener("open", () => {
        ws.pong("undefined");
      });
      ws.addEventListener("pong", ({ data }: any) => {
        expect(data).toEqual(Buffer.from("undefined"));
        done();
      });
    });
    for (const { label, message, bytes } of messages) {
      test(label, (ws, done) => {
        ws.addEventListener("open", () => {
          ws.pong(message);
        });
        ws.addEventListener("pong", ({ data }: any) => {
          expect(data).toEqual(Buffer.from(bytes));
          done();
        });
      });
    }
  });
  describe("close()", () => {
    test("(no arguments)", (ws, done) => {
      ws.addEventListener("open", () => {
        ws.close();
      });
      ws.addEventListener("close", ({ code, reason, wasClean }) => {
        expect(code).toBe(1005);
        expect(reason).toBe("");
        expect(wasClean).toBeTrue();
        done();
      });
    });
    test("(no reason)", (ws, done) => {
      ws.addEventListener("open", () => {
        ws.close(1001);
      });
      ws.addEventListener("close", ({ code, reason, wasClean }) => {
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
        ws.addEventListener("open", () => {
          ws.close(1002, message);
        });
        ws.addEventListener("close", ({ code, reason, wasClean }) => {
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
    ws.addEventListener("open", () => {
      ws.terminate();
    });
    ws.addEventListener("close", ({ code, reason, wasClean }) => {
      expect(code).toBe(1006);
      expect(reason).toBeString();
      expect(wasClean).toBeFalse();
      done();
    });
  });
});

describe.concurrent("WebSocket send(), ping() and pong() payloads", () => {
  // `received` collects every frame the server gets, as [kind, bytes].
  async function withOpenSocket(fn: (ws: WebSocket, received: [string, number[]][]) => void | Promise<void>) {
    const received: [string, number[]][] = [];
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("no", { status: 500 });
      },
      websocket: {
        message(ws, message) {
          received.push([typeof message === "string" ? "text" : "binary", [...Buffer.from(message)]]);
          if (message === "flush") ws.send("flushed");
        },
        ping(_ws, data) {
          received.push(["ping", [...data]]);
        },
        pong(_ws, data) {
          received.push(["pong", [...data]]);
        },
      },
    });
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/`);
    try {
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = e => reject((e as ErrorEvent).error);
      });
      await fn(ws, received);
    } finally {
      ws.terminate();
    }
  }

  // Resolves once the server has handled everything sent so far.
  function flush(ws: WebSocket) {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    ws.onmessage = () => resolve();
    ws.onclose = e => reject(new Error(`closed ${e.code} before the server replied`));
    ws.send("flush");
    return promise;
  }

  function detach<T extends ArrayBuffer | ArrayBufferView>(make: (buffer: ArrayBuffer) => T): T {
    const buffer = new ArrayBuffer(8);
    new Uint8Array(buffer).fill(0x41);
    const value = make(buffer);
    structuredClone(buffer, { transfer: [buffer] });
    expect(buffer.detached).toBe(true);
    return value;
  }

  // WebIDL "get a copy of the bytes held by the buffer source" returns an empty byte sequence for a detached
  // buffer. ServerWebSocket, Blob and Response do the same.
  it("sends a detached buffer as an empty payload", async () => {
    await withOpenSocket(async (ws, received) => {
      for (const method of ["send", "ping", "pong"] as const) {
        ws[method](detach(buffer => new Uint8Array(buffer)));
        ws[method](detach(buffer => new DataView(buffer)));
        ws[method](detach(buffer => buffer));
      }
      expect(ws.readyState).toBe(WebSocket.OPEN);
      await flush(ws);
      expect(received).toEqual([
        ...["binary", "binary", "binary", "ping", "ping", "ping", "pong", "pong", "pong"].map(kind => [kind, []]),
        ["text", [...Buffer.from("flush")]],
      ] as typeof received);
    });
  });

  it("sends only the view's bytes, not the whole underlying buffer", async () => {
    await withOpenSocket(async (ws, received) => {
      const view = new Uint8Array(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer, 2, 4);
      ws.send(view);
      ws.ping(view);
      ws.pong(view);
      ws.send(new DataView(view.buffer, 6));
      await flush(ws);
      expect(received.slice(0, -1)).toEqual([
        ["binary", [3, 4, 5, 6]],
        ["ping", [3, 4, 5, 6]],
        ["pong", [3, 4, 5, 6]],
        ["binary", [7, 8]],
      ]);
    });
  });

  it.each(["send", "ping", "pong"] as const)("%s() rejects shared and resizable buffers", async method => {
    await withOpenSocket(ws => {
      for (const data of [
        new SharedArrayBuffer(4),
        new Uint8Array(new SharedArrayBuffer(4)),
        new ArrayBuffer(4, { maxByteLength: 8 }),
        new Uint8Array(new ArrayBuffer(4, { maxByteLength: 8 })),
      ]) {
        expect(() => ws[method](data as never)).toThrow(TypeError);
      }
    });
  });

  // readyState is checked first, so only an open socket looks at the size.
  it("ping() and pong() over 125 bytes: InvalidStateError while connecting, ignored once closing", async () => {
    const silent = createServer(() => {}).listen(0, "127.0.0.1");
    await once(silent, "listening");
    const connecting = new WebSocket(`ws://127.0.0.1:${(silent.address() as AddressInfo).port}/`);
    connecting.onerror = () => {};
    try {
      expect(connecting.readyState).toBe(WebSocket.CONNECTING);
      const invalidState = expect.objectContaining({ name: "InvalidStateError" });
      expect(() => connecting.ping(new Uint8Array(126))).toThrow(invalidState);
      expect(() => connecting.pong(Buffer.alloc(126, "a").toString())).toThrow(invalidState);
      expect(() => connecting.ping(new Uint8Array(125))).toThrow(invalidState);
    } finally {
      connecting.terminate();
      silent.close();
    }

    await withOpenSocket(async ws => {
      expect(() => ws.ping(new Uint8Array(126))).toThrow(RangeError);
      const closed = new Promise(resolve => (ws.onclose = resolve));
      ws.close();
      for (const state of [WebSocket.CLOSING, WebSocket.CLOSED]) {
        expect(ws.readyState).toBe(state);
        ws.ping(new Uint8Array(126));
        ws.pong(new Blob([new Uint8Array(126)]) as never);
        ws.ping(new Uint8Array(125));
        expect(ws.bufferedAmount).toBe(0);
        await closed;
      }
    });
  });
});

function waitForOpen(ws: WebSocket) {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  ws.addEventListener("open", () => resolve(), { once: true });
  ws.addEventListener("error", e => reject((e as ErrorEvent).error), { once: true });
  return promise;
}

describe.concurrent("WebSocket closing handshake", () => {
  it("terminate() ends a closing handshake the peer never completes", async () => {
    await using server = await createPeer();
    const ws = new WebSocket(server.url);
    const events = clientEvents(ws);
    await waitForOpen(ws);
    ws.close(1000);
    expect(ws.readyState).toBe(WebSocket.CLOSING);
    ws.terminate();
    expect(ws.readyState).toBe(WebSocket.CLOSING);
    expect(await events).toEqual([{ code: 1006, reason: "", wasClean: false }]);
    expect(ws.readyState).toBe(WebSocket.CLOSED);
    ws.terminate();
  });

  it("pause() returns false and isPaused stays false unless CONNECTING or OPEN", async () => {
    await using server = await createPeer({
      respond(connection) {
        connection.echoClose();
        return response101(connection);
      },
    });
    const tryPause = (ws: WebSocket) => ({ isPaused: ws.isPaused, pause: ws.pause(), isPausedAfter: ws.isPaused });
    const notPausable = { isPaused: false, pause: false, isPausedAfter: false };

    const connecting = new WebSocket(server.url);
    const failed = clientEvents(connecting);
    expect(tryPause(connecting)).toEqual({ isPaused: false, pause: true, isPausedAfter: true });
    connecting.terminate();
    expect(tryPause(connecting)).toEqual(notPausable);
    expect(connecting.resume()).toBe(false);
    await failed;
    expect(tryPause(connecting)).toEqual(notPausable);

    const ws = new WebSocket(server.url);
    const events = clientEvents(ws);
    await waitForOpen(ws);
    expect(tryPause(ws)).toEqual({ isPaused: false, pause: true, isPausedAfter: true });
    ws.close();
    expect(tryPause(ws)).toEqual(notPausable);
    // The closing handshake still completes: close() resumed reading, so the peer's Close frame is seen.
    expect(await events).toEqual([{ code: 1005, reason: "", wasClean: true }]);
    expect(tryPause(ws)).toEqual(notPausable);
    expect(ws.resume()).toBe(false);
  });
});

describe.concurrent("WebSocket frames received while their event has no listener", () => {
  /** Returns `listen(type, then)`, which adds a listener that pushes `<type> <data>` to `received` and calls `then`. */
  const recordInto =
    (received: string[], ws: WebSocket) =>
    (type: "message" | "ping" | "pong", then = () => {}) =>
      ws.addEventListener(type, ({ data }: MessageEvent) => {
        received.push(`${type} ${data}`);
        then();
      });

  // Few programs listen for these, and a peer that floods them would otherwise grow the task queue without limit.
  it.each(["ping", "pong"] as const)("drops a %s", async type => {
    await using server = await createPeer();
    const ws = new WebSocket(server.url);
    try {
      const received: string[] = [];
      const listen = recordInto(received, ws);
      const messages = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
      let count = 0;
      listen("message", () => {
        if (count === 0) listen(type);
        messages[count++].resolve();
      });
      const peer = await server.connection();
      peer.write(Buffer.concat([peer.frame(OP[type], "before"), peer.frame(OP.text, "first")]));
      await messages[0].promise;
      // A queued event would be dispatched before these arrive.
      peer.write(Buffer.concat([peer.frame(OP[type], "after"), peer.frame(OP.text, "last")]));
      await messages[1].promise;
      expect(received).toEqual(["message first", `${type} after`, "message last"]);
    } finally {
      ws.terminate();
    }
  });

  it.each(["text", "binary"] as const)("queues a %s message for a listener attached in the same tick", async type => {
    await using server = await createPeer();
    const ws = new WebSocket(server.url);
    try {
      const received: string[] = [];
      const listen = recordInto(received, ws);
      const { promise: delivered, resolve } = Promise.withResolvers<void>();
      listen("pong", () => listen("message", resolve));
      const peer = await server.connection();
      peer.write(Buffer.concat([peer.frame(OP[type], "before"), peer.frame(OP.pong, "now")]));
      await delivered;
      expect(received).toEqual(["pong now", "message before"]);
    } finally {
      ws.terminate();
    }
  });
});

describe.concurrent("WebSocket AsyncLocalStorage context", () => {
  const als = new AsyncLocalStorage<unknown>();

  function startServer() {
    return Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("Upgrade failed", { status: 500 });
      },
      websocket: {
        open(ws) {
          ws.send("hello");
          ws.send(new Uint8Array([1]));
          ws.ping();
          ws.pong();
        },
        message(ws) {
          ws.close(1000, "done");
        },
      },
    });
  }

  it("every event runs in the constructor's async context, regardless of where its listener was added", async () => {
    using server = startServer();
    const seen: Record<string, unknown> = {};
    const { promise, resolve, reject } = Promise.withResolvers<void>();

    const ws = als.run("constructor", () => new WebSocket(`ws://127.0.0.1:${server.port}`));
    ws.onopen = () => (seen.open = als.getStore());
    ws.onerror = e => reject((e as ErrorEvent).error);
    ws.addEventListener("ping", () => (seen.ping = als.getStore()));
    als.run("elsewhere", () => {
      ws.onmessage = e => (seen[typeof e.data === "string" ? "text" : "binary"] = als.getStore());
      ws.addEventListener("pong", () => {
        seen.pong = als.getStore();
        ws.send("done");
      });
      ws.addEventListener("close", () => {
        seen.close = als.getStore();
        resolve();
      });
    });

    await promise;
    expect(seen).toEqual({
      open: "constructor",
      text: "constructor",
      binary: "constructor",
      ping: "constructor",
      pong: "constructor",
      close: "constructor",
    });
  });

  it("a manually dispatched event runs in the dispatchEvent() caller's context", async () => {
    using server = startServer();
    const ws = als.run("constructor", () => new WebSocket(`ws://127.0.0.1:${server.port}`));
    try {
      let seen: unknown;
      ws.addEventListener("custom", () => (seen = als.getStore()));
      als.run("dispatcher", () => ws.dispatchEvent(new Event("custom")));
      expect(seen).toBe("dispatcher");
    } finally {
      ws.onerror = () => {};
      ws.terminate();
    }
  });

  it("a failed connection's error and close events run in the constructor's context too", async () => {
    const tcpServer = createServer(socket => socket.destroy()).listen(0, "127.0.0.1");
    await once(tcpServer, "listening");
    try {
      const seen: Record<string, unknown> = {};
      const { promise, resolve } = Promise.withResolvers<void>();
      const ws = als.run(
        "constructor",
        () => new WebSocket(`ws://127.0.0.1:${(tcpServer.address() as AddressInfo).port}`),
      );
      ws.onerror = () => (seen.error = als.getStore());
      ws.onclose = () => {
        seen.close = als.getStore();
        resolve();
      };
      await promise;
      expect(seen).toEqual({ error: "constructor", close: "constructor" });
    } finally {
      tcpServer.close();
    }
  });

  it("a socket created inside a Bun.ModuleGraph fires events in its store and graph, and leaks neither", async () => {
    using server = startServer();
    const graph = new Bun.ModuleGraph();
    // Created outside any store, so it observes whatever context is current at the top of the event loop.
    const seenByTimer: unknown[] = [];
    const timer = setInterval(() => seenByTimer.push([als.getStore(), Bun.ModuleGraph.current]), 1);
    try {
      const seen: Record<string, unknown> = {};
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const ws = graph.run(() => als.run("constructor", () => new WebSocket(`ws://127.0.0.1:${server.port}`)));
      const record = (event: string) => (seen[event] = [als.getStore(), Bun.ModuleGraph.current === graph]);
      ws.onerror = e => reject((e as ErrorEvent).error);
      ws.onopen = () => record("open");
      ws.addEventListener("pong", () => {
        record("pong");
        ws.send("done");
      });
      ws.onclose = () => {
        record("close");
        resolve();
      };
      await promise;
      expect(seen).toEqual({ open: ["constructor", true], pong: ["constructor", true], close: ["constructor", true] });

      const ticks = seenByTimer.length;
      while (seenByTimer.length < ticks + 2) await new Promise(resolve => setImmediate(resolve));
      expect(seenByTimer.filter(([store, current]: any) => store !== undefined || current !== undefined)).toEqual([]);
    } finally {
      clearInterval(timer);
      graph.dispose();
    }
  });

  it("the WebSocket keeps its async context alive across GC", async () => {
    using server = startServer();
    const seen: Record<string, unknown> = {};
    const open = Promise.withResolvers<WebSocket>();
    const closed = Promise.withResolvers<void>();

    // Once this returns, only the WebSocket references the context.
    (function create() {
      als.run({ id: "constructor" }, () => {
        const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
        ws.onopen = () => open.resolve(ws);
        ws.onclose = () => {
          seen.close = als.getStore();
          closed.resolve();
        };
        ws.onerror = e => {
          open.reject((e as ErrorEvent).error);
          closed.reject((e as ErrorEvent).error);
        };
      });
    })();

    const ws = await open.promise;
    Bun.gc(true);
    Bun.gc(true);
    ws.send("done");
    await closed.promise;
    expect(seen).toEqual({ close: { id: "constructor" } });
  });
});

function makeTest(
  label: string,
  fn: (ws: WebSocket, done: (err?: unknown) => void) => void,
  timeout?: number,
  isOnly = false,
) {
  return (isOnly ? it.only : it.concurrent)(
    label,
    testDone => {
      let isDone = false;
      const ws = new WebSocket(serverUrl);
      const done = (err?: unknown) => {
        if (!isDone) {
          isDone = true;
          ws.terminate();
          testDone(err);
        }
      };
      try {
        fn(ws, done);
      } catch (err) {
        done(err);
      }
    },
    timeout,
  );
}

// RFC 6455 §5.5: control frame payloads are at most 125 bytes. ping()/pong()
// must reject oversized payloads instead of emitting an extended-length control
// frame that every conformant peer treats as a protocol error.
describe.concurrent("WebSocket ping()/pong() payload size limit", () => {
  const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

  type Frame = { opcode: number; payloadLen: number; extendedLen: boolean };

  // events.once() only auto-rejects on 'error' for EventEmitters; WebSocket is an
  // EventTarget, so wire error/close explicitly to surface handshake failures.
  function openOrFail(ws: WebSocket) {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", e => reject((e as ErrorEvent).error ?? new Error((e as ErrorEvent).message)), {
      once: true,
    });
    ws.addEventListener("close", e => reject(new Error(`closed ${e.code} before open`)), { once: true });
    return promise;
  }

  async function rawHandshakeServer() {
    const frames: Frame[] = [];
    const { promise: onFrames, resolve: gotFrames, reject: failFrames } = Promise.withResolvers<void>();
    onFrames.catch(() => {});
    let want = Infinity;
    let closing = false;
    const sockets = new Set<import("node:net").Socket>();
    const server = createServer(sock => {
      sockets.add(sock);
      sock.on("close", () => {
        sockets.delete(sock);
        if (!closing && frames.length < want) failFrames(new Error(`socket closed after ${frames.length} frames`));
      });
      sock.on("error", () => {});
      let buf = Buffer.alloc(0);
      let shaken = false;
      sock.on("data", (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk]);
        if (!shaken) {
          const i = buf.indexOf("\r\n\r\n");
          if (i < 0) return;
          const key = /sec-websocket-key: *([^\r\n]+)/i.exec(buf.toString("latin1"))![1];
          const accept = createHash("sha1")
            .update(key + GUID)
            .digest("base64");
          sock.write(
            "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
              `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
          );
          shaken = true;
          buf = buf.subarray(i + 4);
        }
        while (buf.length >= 2) {
          const opcode = buf[0] & 0x0f;
          const lenByte = buf[1] & 0x7f;
          let len = lenByte;
          let off = 2;
          if (lenByte === 126) {
            if (buf.length < 4) return;
            len = buf.readUInt16BE(2);
            off = 4;
          } else if (lenByte === 127) {
            if (buf.length < 10) return;
            len = Number(buf.readBigUInt64BE(2));
            off = 10;
          }
          // client frames are always masked: +4 for the masking key
          if (buf.length < off + 4 + len) return;
          frames.push({ opcode, payloadLen: len, extendedLen: lenByte >= 126 });
          buf = buf.subarray(off + 4 + len);
          if (frames.length >= want) gotFrames();
        }
      });
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const port = (server.address() as import("node:net").AddressInfo).port;
    return {
      frames,
      port,
      waitForFrames(n: number) {
        want = n;
        if (frames.length >= n) return Promise.resolve();
        return onFrames;
      },
      close: () =>
        new Promise<void>(r => {
          closing = true;
          for (const s of sockets) s.destroy();
          server.close(() => r());
        }),
    };
  }

  function expectRangeError(fn: () => void, bytes: number) {
    let err: Error | undefined;
    try {
      fn();
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeInstanceOf(RangeError);
    expect(err!.message).toContain("must not be greater than 125 bytes");
    expect(err!.message).toContain(`${bytes} bytes`);
  }

  it("throws RangeError for payloads > 125 bytes and never puts an extended-length control frame on the wire", async () => {
    const srv = await rawHandshakeServer();
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/`);
    try {
      await openOrFail(ws);

      const s125 = Buffer.alloc(125, "a").toString();
      const s126 = Buffer.alloc(126, "b").toString();
      const s300 = Buffer.alloc(300, "c").toString();
      // 63 × "é" (2 UTF-8 bytes each) = 63 JS chars but 126 bytes on the wire:
      // the limit is on the encoded length.
      const multibyte126 = Buffer.alloc(126, "é").toString();

      // 125 is the boundary: must succeed for every overload.
      ws.ping(s125);
      ws.ping(new Uint8Array(125));
      ws.pong(s125);
      ws.pong(new ArrayBuffer(125));

      // > 125: must throw for every overload. Matches the `ws` npm package (RangeError).
      expectRangeError(() => ws.ping(s126), 126);
      expectRangeError(() => ws.ping(s300), 300);
      expectRangeError(() => ws.ping(multibyte126), 126);
      expectRangeError(() => ws.ping(new Uint8Array(126)), 126);
      expectRangeError(() => ws.ping(new ArrayBuffer(200)), 200);
      expectRangeError(() => ws.ping(new Blob([new Uint8Array(130)]) as any), 130);
      expectRangeError(() => ws.pong(s126), 126);
      expectRangeError(() => ws.pong(new Uint8Array(400)), 400);
      expectRangeError(() => ws.pong(new ArrayBuffer(126)), 126);
      expectRangeError(() => ws.pong(new Blob([new Uint8Array(200)]) as any), 200);

      // socket must still be usable after the RangeErrors
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.ping();

      // Only the four 125-byte frames plus the final empty ping may have been sent.
      await srv.waitForFrames(5);
      expect(srv.frames).toEqual([
        { opcode: 0x9, payloadLen: 125, extendedLen: false },
        { opcode: 0x9, payloadLen: 125, extendedLen: false },
        { opcode: 0xa, payloadLen: 125, extendedLen: false },
        { opcode: 0xa, payloadLen: 125, extendedLen: false },
        { opcode: 0x9, payloadLen: 0, extendedLen: false },
      ]);
    } finally {
      ws.terminate();
      await srv.close();
    }
  });

  it("a 125-byte ping round-trips through Bun.serve without a protocol error", async () => {
    const { promise: gotPing, resolve: onPing, reject: failPing } = Promise.withResolvers<Buffer>();
    gotPing.catch(() => {});
    await using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("no", { status: 400 });
      },
      websocket: {
        message() {},
        ping(_ws, data) {
          onPing(Buffer.from(data));
        },
        close(_ws, code) {
          failPing(new Error(`server ws closed ${code} before ping`));
        },
      },
    });

    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/`);
    try {
      const { promise: closed, resolve: onClose } = Promise.withResolvers<CloseEvent>();
      ws.addEventListener("close", onClose);
      await openOrFail(ws);

      const payload = Buffer.alloc(125, "z");
      ws.ping(payload);
      const received = await gotPing;
      expect(received.equals(payload)).toBe(true);

      ws.close();
      const ev = await closed;
      expect(ev.code).toBe(1005);
    } finally {
      ws.terminate();
    }
  });

  it("require('ws') client throws RangeError synchronously for oversized ping/pong", async () => {
    const srv = await rawHandshakeServer();
    const ws = new NodeWS(`ws://127.0.0.1:${srv.port}/`);
    const errorEvents: unknown[] = [];
    ws.on("error", (e: unknown) => errorEvents.push(e));
    try {
      await once(ws, "open");

      // 125 is the boundary: cb is invoked with no error after the frame is written, like npm ws.
      let returned = false;
      const sent = new Promise(resolve => ws.ping(new Uint8Array(125), true, e => resolve({ error: e, returned })));
      returned = true;
      expect(await sent).toEqual({ error: null, returned: true });

      // > 125: npm ws throws synchronously from Sender.prototype.ping; cb is never invoked.
      const big = new Uint8Array(200);
      let pingCb = 0;
      const tooBig = new RangeError("The data size must not be greater than 125 bytes");
      expect(() => ws.ping(big, true, () => pingCb++)).toThrow(tooBig);
      expect(() => ws.pong(big, true, () => pingCb++)).toThrow(tooBig);
      expect(pingCb).toBe(0);

      await srv.waitForFrames(1);
      expect(srv.frames).toEqual([{ opcode: 0x9, payloadLen: 125, extendedLen: false }]);
      // the shim must not have routed the RangeError to an 'error' event
      expect(errorEvents).toEqual([]);
    } finally {
      ws.terminate();
      await srv.close();
    }
  });

  it("require('ws') ping()/pong() after close delivers a 'not open' error to the callback", async () => {
    // Server side (BunWebSocketMocked): #close() nulls #ws, so this would be a
    // TypeError without the not-OPEN guard.
    const wss = new WebSocketServer({ port: 0 });
    try {
      const { promise: closedCbErr, resolve: onCbErr, reject } = Promise.withResolvers<unknown>();
      closedCbErr.catch(() => {});
      wss.on("connection", serverWs => {
        serverWs.on("close", () => {
          try {
            serverWs.ping();
            serverWs.pong();
            serverWs.ping("data", true, onCbErr);
          } catch (e) {
            reject(e);
          }
        });
      });
      const port = (wss.address() as import("node:net").AddressInfo).port;
      const client = new NodeWS(`ws://127.0.0.1:${port}/`);
      try {
        await once(client, "open");
        client.close();
        const err = await closedCbErr;
        expect(err).toBeInstanceOf(Error);
        expect(err).not.toBeInstanceOf(TypeError);
        expect((err as Error).message).toContain("WebSocket is not open: readyState 3 (CLOSED)");
      } finally {
        client.terminate();
      }
    } finally {
      wss.close();
    }

    // Client side (BunWebSocket): native WebSocket no-ops on CLOSING/CLOSED, but
    // npm ws still delivers the error to cb.
    const srv = await rawHandshakeServer();
    const ws = new NodeWS(`ws://127.0.0.1:${srv.port}/`);
    try {
      await once(ws, "open");
      ws.close();
      const { promise: cbErr, resolve: onCb } = Promise.withResolvers<unknown>();
      ws.ping("data", true, onCb);
      const err = await cbErr;
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/WebSocket is not open: readyState [23] \((CLOSING|CLOSED)\)/);
    } finally {
      ws.terminate();
      await srv.close();
    }
  });

  it("Bun.serve ServerWebSocket.ping()/pong() throws RangeError for payloads > 125 bytes", async () => {
    const {
      promise: result,
      resolve,
      reject: failResult,
    } = Promise.withResolvers<{ errs: unknown[]; ok125: number }>();
    result.catch(() => {});
    await using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("no", { status: 400 });
      },
      websocket: {
        open(ws) {
          try {
            const errs: unknown[] = [];
            for (const fn of [
              () => ws.ping(new Uint8Array(126)),
              () => ws.ping(Buffer.alloc(300, "c").toString()),
              () => ws.pong(new Uint8Array(200)),
              () => ws.pong(Buffer.alloc(126, "d").toString()),
            ]) {
              try {
                fn();
                errs.push(undefined);
              } catch (e) {
                errs.push(e);
              }
            }
            const ok125 = ws.ping(new Uint8Array(125));
            resolve({ errs, ok125 });
          } catch (e) {
            failResult(e);
          }
        },
        message() {},
        close(_ws, code) {
          failResult(new Error(`server ws closed ${code} before result`));
        },
      },
    });

    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/`);
    try {
      const { promise: gotPing, resolve: onServerPing, reject: failPing } = Promise.withResolvers<Buffer>();
      gotPing.catch(() => {});
      ws.binaryType = "nodebuffer";
      ws.addEventListener("ping", e => onServerPing((e as MessageEvent).data as Buffer));
      ws.addEventListener("close", e => failPing(new Error(`closed ${e.code} before ping`)));
      await openOrFail(ws);

      const { errs, ok125 } = await result;
      expect(errs).toHaveLength(4);
      for (const e of errs) {
        expect(e).toBeInstanceOf(RangeError);
        expect((e as Error).message).toContain("must not be greater than 125 bytes");
      }
      expect(ok125).toBe(125);

      // the server's 125-byte ping reaches the client intact; no protocol error
      const ping = await gotPing;
      expect(ping.length).toBe(125);
      expect(ws.readyState).toBe(WebSocket.OPEN);
    } finally {
      ws.terminate();
    }
  });
});

// RFC 6455 §4.1: the 101's Connection header must *contain* an `Upgrade` token, not equal it.
describe("WebSocket handshake Connection header token list", () => {
  it.each([
    ["Connection: keep-alive, Upgrade"],
    ["Connection: upgrade,keep-alive"],
    ["Connection: keep-alive", "Connection: Upgrade"],
  ])("%s", async (...connectionHeaders) => {
    const server = createServer(sock => {
      sock.on("error", () => {});
      let buf = "";
      sock.on("data", chunk => {
        buf += chunk.toString("latin1");
        if (!buf.includes("\r\n\r\n")) return;
        const key = /sec-websocket-key: *([^\r\n]+)/i.exec(buf)![1];
        const accept = createHash("sha1")
          .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
          .digest("base64");
        sock.write(
          [
            "HTTP/1.1 101 Switching Protocols",
            "Upgrade: websocket",
            ...connectionHeaders,
            `Sec-WebSocket-Accept: ${accept}`,
            "",
            "",
          ].join("\r\n"),
        );
      });
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    try {
      const port = (server.address() as import("node:net").AddressInfo).port;
      const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      ws.onopen = () => resolve();
      ws.onclose = e => reject(new Error(`closed ${e.code} ${e.reason}`));
      await promise;
      ws.terminate();
    } finally {
      server.close();
    }
  });
});

describe.concurrent("WebSocket Proxy-Authorization", () => {
  ignoreAmbientNoProxy();

  /** `sent` is the decoded Basic credentials as latin1, or the raw value if it isn't Basic. `null` means no header. */
  type Row = [userinfo: string, sent: string | null];

  // One proxy per row. Each records the CONNECT request and rejects it.
  function proxyAuthorizationSent(rows: Row[], headers?: Record<string, string>): Promise<Row[]> {
    return Promise.all(
      rows.map(async ([userinfo]): Promise<Row> => {
        using proxy = await startRecordingProxy({ requireAuth: true });
        const url = `http://${userinfo}${userinfo ? "@" : ""}127.0.0.1:${proxy.port}`;
        await failingSession(new WebSocket("ws://127.0.0.1:1/", { proxy: headers ? { url, headers } : url }));
        if (proxy.requests.length !== 1) return [userinfo, `${proxy.requests.length} CONNECT requests`];
        const value = proxy.requests[0].headers["proxy-authorization"];
        if (value === undefined) return [userinfo, null];
        if (!value.startsWith("Basic ")) return [userinfo, value];
        return [userinfo, Buffer.from(value.slice("Basic ".length), "base64").toString("latin1")];
      }),
    );
  }

  const rows: Row[] = [
    ["user:pass", "user:pass"],
    ["user", "user:"],
    // A password with no user (RFC 7617 allows an empty user-id).
    [":pass", ":pass"],
    // Each percent-escape decodes to one byte, valid UTF-8 or not, like fetch() and curl.
    ["user:p%C3%A9ss", "user:p\xc3\xa9ss"],
    ["user:p%E9ss", "user:p\xe9ss"],
    ["us%ffer:pass", "us\xffer:pass"],
    ["user:pa%25ss", "user:pa%ss"],
    ["user:pa%zzss", "user:pa%zzss"],
    ["", null],
  ];

  it("is the percent-decoded userinfo from the proxy URL", async () => {
    expect(await proxyAuthorizationSent(rows)).toEqual(rows);
  });

  it("from proxy.headers overrides the userinfo, like fetch()", async () => {
    expect(await proxyAuthorizationSent(rows, { "proxy-authorization": "Bearer from-headers" })).toEqual(
      rows.map(([userinfo]) => [userinfo, "Bearer from-headers"]),
    );
  });

  it("still comes from the userinfo when proxy.headers has other headers", async () => {
    expect(await proxyAuthorizationSent(rows, { "X-Other": "1" })).toEqual(rows);
  });
});

describe("WebSocket TLS server identity", () => {
  ignoreAmbientNoProxy();

  // A TLS server that records the SNI of every handshake, answers one
  // WebSocket upgrade per connection, then echoes the client's Close frame and
  // ends the connection. The harness certificate has CN=server-bun
  // and SAN DNS:localhost, IP:127.0.0.1, IP:::1. With `hold`, a handshake that
  // sends SNI stops at the ClientHello until `hold` resolves.
  function startSniServer({
    requestCert = false,
    hold,
    version,
  }: { requestCert?: boolean; hold?: Promise<void>; version?: tls.SecureVersion } = {}) {
    const sni: (string | null)[] = [];
    const clientCertificates: (string | undefined)[] = [];
    let applicationData = "";
    const connectionEnded = Promise.withResolvers<void>();
    const clientHello = Promise.withResolvers<void>();
    const server = tls.createServer(
      {
        key: tlsCerts.key,
        cert: tlsCerts.cert,
        minVersion: version,
        maxVersion: version,
        // The client certificate is recorded, not verified.
        requestCert,
        rejectUnauthorized: false,
        SNICallback(servername, cb) {
          sni.push(servername);
          clientHello.resolve();
          const resume = () => cb(null, tls.createSecureContext({ key: tlsCerts.key, cert: tlsCerts.cert }));
          if (hold) hold.then(resume);
          else resume();
        },
      },
      socket => {
        let buffered = "";
        let connection: RawSocket | undefined;
        socket.on("data", (chunk: Buffer) => {
          applicationData += chunk.toString("latin1");
          if (connection) return connection.push(chunk);
          buffered += chunk.toString("latin1");
          const end = buffered.indexOf("\r\n\r\n");
          if (end === -1) return;
          const key = buffered
            .slice(0, end)
            .split("\r\n")
            .find(line => line.toLowerCase().startsWith("sec-websocket-key:"))
            ?.split(":", 2)[1]
            .trim();
          if (!key) {
            socket.end("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n");
            return;
          }
          const accept = createHash("sha1")
            .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
            .digest("base64");
          socket.write(
            "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
              `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
          );
          connection = new RawSocket(socket, false);
          connection.echoClose();
        });
        socket.on("error", () => {});
        socket.on("close", () => connectionEnded.resolve());
      },
    );
    server.on("tlsClientError", () => connectionEnded.resolve());
    // A handshake with no server_name extension never reaches SNICallback.
    server.on("secureConnection", socket => {
      if (!socket.servername) sni.push(null);
      if (requestCert) clientCertificates.push(socket.getPeerCertificate()?.fingerprint256);
    });
    const { promise, resolve } = Promise.withResolvers<number>();
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
    return {
      port: promise,
      sni,
      clientCertificates,
      // The server has the ClientHello of a handshake that sends SNI.
      clientHello: clientHello.promise,
      // What the client has sent over TLS so far.
      get received() {
        return applicationData;
      },
      // The same, once the server saw the connection end. A rejected peer must
      // get none of the upgrade request: it carries Authorization and Cookie.
      async receivedInTotal() {
        await connectionEnded.promise;
        return applicationData;
      },
      [Symbol.dispose]() {
        server.close();
      },
    };
  }

  function openSession(ws: WebSocket) {
    ws.addEventListener("open", () => ws.close(1000));
    return clientEvents(ws);
  }

  const opened = [{ code: 1000, reason: "", wasClean: true }];
  const expectedFingerprint256 = new X509Certificate(tlsCerts.cert).fingerprint256;
  const tlsFailed = (url: string) => [
    { error: expect.stringContaining(`WebSocket connection to '${url}' failed: TLS handshake failed`) },
    { code: 1006, reason: "", wasClean: false },
  ];

  describe.concurrent("WebSocket tls.serverName", () => {
    // `servername` is the node spelling of the same option.
    it.each(["serverName", "servername"] as const)(
      "%s is sent as SNI when the URL host is an IP address",
      async key => {
        using server = startSniServer();
        const url = `wss://127.0.0.1:${await server.port}/`;
        const ws = new WebSocket(url, { tls: { ca: tlsCerts.cert, [key]: "localhost" } });
        expect(await openSession(ws)).toEqual(opened);
        expect(server.sni).toEqual(["localhost"]);
      },
    );

    it("is the name the certificate is verified against", async () => {
      using server = startSniServer();
      const url = `wss://127.0.0.1:${await server.port}/`;
      // 127.0.0.1 is in the SAN, evil.test is not. Without serverName this would open.
      const ws = new WebSocket(url, { tls: { ca: tlsCerts.cert, serverName: "evil.test" } });
      expect(await openSession(ws)).toEqual(tlsFailed(url));
      expect(server.sni).toEqual(["evil.test"]);
      expect(await server.receivedInTotal()).toBe("");
    });

    it("is the bare address when it is an IPv6 literal in brackets, like fetch", async () => {
      using server = startSniServer();
      const url = `wss://127.0.0.1:${await server.port}/`;
      // ::1 is in the SAN as an IP address, and an IP address is never sent as SNI.
      const ws = new WebSocket(url, { tls: { ca: tlsCerts.cert, serverName: "[::1]" } });
      expect(await openSession(ws)).toEqual(opened);
      const hostnames: string[] = [];
      const withCallback = new WebSocket(url, {
        tls: { ca: tlsCerts.cert, serverName: "[::1]", checkServerIdentity: hostname => void hostnames.push(hostname) },
      });
      expect(await openSession(withCallback)).toEqual(opened);
      expect({ sni: server.sni, hostnames }).toEqual({ sni: [null, null], hostnames: ["::1"] });
    });

    it("is used for the tunnel handshake through an HTTP proxy", async () => {
      using server = startSniServer();
      using proxy = await startRecordingProxy();
      const url = `wss://127.0.0.1:${await server.port}/`;
      const ws = new WebSocket(url, {
        proxy: `http://127.0.0.1:${proxy.port}`,
        tls: { ca: tlsCerts.cert, serverName: "localhost" },
      });
      expect(await openSession(ws)).toEqual(opened);
      expect(server.sni).toEqual(["localhost"]);
      expect(proxy.requests).toHaveLength(1);
    });

    // The proxy is dialed by IP address, so its handshake has no SNI and its certificate is
    // checked against 127.0.0.1. `serverName` is for the handshake with the target.
    it.each([
      ["a name the certificate has", "localhost", undefined],
      ["a name that only the callback accepts", "target.test", () => undefined],
    ] as const)("names the target and not an HTTPS proxy: %s", async (_label, serverName, checkServerIdentity) => {
      using server = startSniServer();
      using proxy = await startRecordingProxy({ tls: true });
      const ws = new WebSocket(`wss://127.0.0.1:${await server.port}/`, {
        proxy: `https://127.0.0.1:${proxy.port}`,
        tls: { ca: tlsCerts.cert, serverName, checkServerIdentity },
      });
      expect(await openSession(ws)).toEqual(opened);
      expect({ proxy: proxy.sni, target: server.sni }).toEqual({ proxy: [null], target: [serverName] });
      expect(proxy.requests).toHaveLength(1);
    });

    it("proxy.tls.serverName names an HTTPS proxy and not the target", async () => {
      using server = startSniServer();
      using proxy = await startRecordingProxy({ tls: true });
      const url = `wss://127.0.0.1:${await server.port}/`;
      const connect = (serverName: string) =>
        openSession(
          new WebSocket(url, {
            proxy: { url: `https://127.0.0.1:${proxy.port}`, tls: { ca: tlsCerts.cert, serverName } },
            tls: { ca: tlsCerts.cert },
          }),
        );
      expect(await connect("localhost")).toEqual(opened);
      expect({ proxy: proxy.sni, target: server.sni }).toEqual({ proxy: ["localhost"], target: [null] });
      // 127.0.0.1 is in the SAN, evil.test is not. Without serverName this would open.
      expect(await connect("evil.test")).toEqual(tlsFailed(url));
      expect(proxy.requests).toHaveLength(1);
    });
  });

  describe.concurrent("WebSocket tls.checkServerIdentity", () => {
    it("is called with the hostname and the peer certificate", async () => {
      using server = startSniServer();
      const url = `wss://localhost:${await server.port}/`;
      const calls: { hostname: string; subject: string; altnames: string; fingerprint256: string; raw: boolean }[] = [];
      const ws = new WebSocket(url, {
        tls: {
          ca: tlsCerts.cert,
          checkServerIdentity(hostname: string, cert: tls.PeerCertificate) {
            calls.push({
              hostname,
              subject: cert.subject.CN as string,
              altnames: cert.subjectaltname!,
              fingerprint256: cert.fingerprint256,
              raw: Buffer.isBuffer(cert.raw),
            });
            return undefined;
          },
        },
      });
      expect(await openSession(ws)).toEqual(opened);
      expect(calls).toEqual([
        {
          hostname: "localhost",
          subject: "server-bun",
          altnames: "DNS:localhost, IP Address:127.0.0.1, IP Address:0:0:0:0:0:0:0:1",
          fingerprint256: expectedFingerprint256,
          raw: true,
        },
      ]);
      // Control for the rejection tests: the server does record the request.
      // It read all of it before the 101, so no wait for the connection to end.
      expect(server.received).toStartWith("GET / HTTP/1.1\r\n");
    });

    it("drains microtasks queued by the callback before the open event", async () => {
      using server = startSniServer();
      const url = `wss://localhost:${await server.port}/`;
      const order: string[] = [];
      const ws = new WebSocket(url, {
        tls: {
          ca: tlsCerts.cert,
          checkServerIdentity() {
            order.push("callback");
            queueMicrotask(() => order.push("microtask"));
            return undefined;
          },
        },
      });
      ws.addEventListener("open", () => order.push("open"));
      expect(await openSession(ws)).toEqual(opened);
      expect(order).toEqual(["callback", "microtask", "open"]);
    });

    it.each(["TLSv1.2", "TLSv1.3"] as const)("rejects the connection when it returns an Error: %s", async version => {
      using server = startSniServer({ version });
      const url = `wss://localhost:${await server.port}/`;
      let calls = 0;
      const ws = new WebSocket(url, {
        headers: { Authorization: "Bearer secret" },
        tls: {
          ca: tlsCerts.cert,
          checkServerIdentity() {
            calls++;
            return new Error("PIN-REJECT");
          },
        },
      });
      expect(await openSession(ws)).toEqual(tlsFailed(url));
      expect(calls).toBe(1);
      // Rejected before the upgrade: the peer never sees the request.
      expect(await server.receivedInTotal()).toBe("");
    });

    // The client runs in a child process: the exception it throws is reported as
    // uncaught, which would fail this test run.
    it("rejects the connection when it throws, and reports the exception", async () => {
      using server = startSniServer();
      const url = `wss://localhost:${await server.port}/`;
      await using client = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          const events = [];
          process.on("uncaughtException", error => events.push("uncaught: " + error.message));
          const ws = new WebSocket(process.env.WS_URL, {
            tls: {
              ca: process.env.WS_CA,
              checkServerIdentity() {
                throw new Error("PIN-REJECT");
              },
            },
          });
          ws.onopen = () => {
            events.push("open");
            ws.close();
          };
          ws.onerror = event => events.push("error: " + event.message);
          ws.onclose = event => {
            events.push("close " + event.code);
            console.log(JSON.stringify(events));
          };
        `,
        ],
        env: { ...bunEnv, WS_URL: url, WS_CA: tlsCerts.cert },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([client.stdout.text(), client.stderr.text(), client.exited]);
      expect({ stderr, events: JSON.parse(stdout || "null") }).toEqual({
        stderr: "",
        events: [
          "uncaught: PIN-REJECT",
          expect.stringContaining(`error: WebSocket connection to '${url}' failed: TLS handshake failed`),
          "close 1006",
        ],
      });
      expect(exitCode).toBe(0);
      expect(await server.receivedInTotal()).toBe("");
    });

    it("runs in the Bun.ModuleGraph that opened the WebSocket, so a throw goes to its onError", async () => {
      using server = startSniServer();
      const url = `wss://localhost:${await server.port}/`;
      const errors: unknown[] = [];
      const graph = new Bun.ModuleGraph({ onError: (error, kind) => errors.push([kind, (error as Error).message]) });
      try {
        let current: unknown;
        const events = await graph.run(() => {
          const ws = new WebSocket(url, {
            tls: {
              ca: tlsCerts.cert,
              checkServerIdentity() {
                current = Bun.ModuleGraph.current;
                throw new Error("PIN-REJECT");
              },
            },
          });
          return openSession(ws);
        });
        expect({ events, errors, ranInGraph: current === graph }).toEqual({
          events: tlsFailed(url),
          errors: [["uncaughtException", "PIN-REJECT"]],
          ranInGraph: true,
        });
      } finally {
        graph.dispose();
      }
    });

    describe.each(["direct", "through an HTTP proxy", "of an HTTPS proxy"] as const)(
      "from inside the callback, %s",
      route => {
        it.each(["close", "terminate"] as const)("may %s() the WebSocket", async method => {
          const ofProxy = route === "of an HTTPS proxy";
          using server = startSniServer();
          using proxy = await startRecordingProxy({ tls: ofProxy });
          const url = `wss://localhost:${await server.port}/`;
          const closes = {
            ca: tlsCerts.cert,
            checkServerIdentity() {
              ws[method]();
              return undefined;
            },
          };
          const ws: WebSocket = new WebSocket(url, {
            headers: { Authorization: "Bearer secret" },
            proxy: ofProxy
              ? { url: `https://127.0.0.1:${proxy.port}`, tls: closes }
              : route === "direct"
                ? undefined
                : `http://127.0.0.1:${proxy.port}`,
            tls: ofProxy ? { ca: tlsCerts.cert } : closes,
          });
          expect(await clientEvents(ws)).toEqual([
            {
              error: `WebSocket connection to '${url}' failed: WebSocket is closed before the connection is established`,
            },
            { code: 1006, reason: "", wasClean: false },
          ]);
          if (ofProxy) {
            await Promise.all(proxy.departures);
            expect(proxy.requests).toEqual([]);
          } else {
            expect(await server.receivedInTotal()).toBe("");
          }
        });
      },
    );

    it("replaces the built-in hostname check, like fetch", async () => {
      using server = startSniServer();
      const url = `wss://127.0.0.1:${await server.port}/`;
      const calls: string[] = [];
      // evil.test is not in the SAN. The callback approves it anyway.
      const ws = new WebSocket(url, {
        tls: {
          ca: tlsCerts.cert,
          serverName: "evil.test",
          checkServerIdentity(hostname: string) {
            calls.push(hostname);
            return undefined;
          },
        },
      });
      expect(await openSession(ws)).toEqual(opened);
      expect(calls).toEqual(["evil.test"]);
    });

    // mTLS. The callback, not the built-in check, still decides on the name.
    it("replaces the built-in hostname check when the server asks for a client certificate", async () => {
      using server = startSniServer({ requestCert: true });
      const url = `wss://127.0.0.1:${await server.port}/`;
      const calls: string[] = [];
      const ws = new WebSocket(url, {
        tls: {
          ca: tlsCerts.cert,
          cert: tlsCerts.cert,
          key: tlsCerts.key,
          serverName: "evil.test",
          checkServerIdentity(hostname: string) {
            calls.push(hostname);
            return undefined;
          },
        },
      });
      expect(await openSession(ws)).toEqual(opened);
      expect(calls).toEqual(["evil.test"]);
      expect(server.clientCertificates).toEqual([expectedFingerprint256]);
    });

    // The verdict is read as tls.connect() reads it: any truthy value rejects. An async
    // callback returns a Promise, which is never an Error, so it must not pass for approval.
    it.each([
      ["a Promise, from an async callback", async () => new Error("PIN-REJECT")],
      ["a string", () => "pin mismatch"],
    ] as const)("rejects the connection when it returns %s", async (_label, checkServerIdentity) => {
      using server = startSniServer();
      const url = `wss://localhost:${await server.port}/`;
      const ws = new WebSocket(url, {
        headers: { Authorization: "Bearer secret" },
        tls: { ca: tlsCerts.cert, checkServerIdentity: checkServerIdentity as never },
      });
      expect(await openSession(ws)).toEqual(tlsFailed(url));
      expect(await server.receivedInTotal()).toBe("");
    });

    it.each([
      ["undefined", undefined],
      ["false", false],
    ] as const)("approves when it returns %s, as tls.connect() does", async (_label, verdict) => {
      using server = startSniServer();
      const url = `wss://localhost:${await server.port}/`;
      let calls = 0;
      const checkServerIdentity = () => (calls++, verdict);
      const ws = new WebSocket(url, { tls: { ca: tlsCerts.cert, checkServerIdentity: checkServerIdentity as never } });
      expect(await openSession(ws)).toEqual(opened);
      expect(calls).toBe(1);
    });

    it.each([
      ["a string", "pin"],
      ["an object", {}],
    ] as const)("throws when it is %s, like fetch", (_label, value) => {
      const invalid = { checkServerIdentity: value as never };
      for (const [option, options] of [
        ["tls", { tls: invalid }],
        ["proxy.tls", { proxy: { url: "https://localhost:1", tls: invalid } }],
      ] as const) {
        let error: unknown;
        try {
          new WebSocket("wss://localhost:1/", options);
        } catch (e) {
          error = e;
        }
        expect(error).toMatchObject({
          code: "ERR_INVALID_ARG_TYPE",
          message: expect.stringContaining(`The "${option}.checkServerIdentity" property must be of type function`),
        });
      }
    });

    it("is ignored when it is null, and the built-in check applies", async () => {
      using server = startSniServer();
      const url = `wss://127.0.0.1:${await server.port}/`;
      const ws = new WebSocket(url, {
        tls: { ca: tlsCerts.cert, serverName: "evil.test", checkServerIdentity: null as never },
      });
      expect(await openSession(ws)).toEqual(tlsFailed(url));
    });

    it("is found on the prototype of the tls object, like the other tls options", async () => {
      using server = startSniServer();
      const url = `wss://localhost:${await server.port}/`;
      let calls = 0;
      const tlsOptions = Object.create({
        checkServerIdentity() {
          calls++;
          return new Error("PIN-REJECT");
        },
      });
      tlsOptions.ca = tlsCerts.cert;
      const ws = new WebSocket(url, { tls: tlsOptions });
      expect(await openSession(ws)).toEqual(tlsFailed(url));
      expect(calls).toBe(1);
    });

    describe("with rejectUnauthorized: false, like fetch", () => {
      it("runs only on a chain that verified, and its verdict is not enforced", async () => {
        using server = startSniServer();
        const url = `wss://localhost:${await server.port}/`;
        const calls: string[] = [];
        // Without `ca` the chain fails: the harness certificate is self-signed.
        for (const [label, ca] of [
          ["verified", tlsCerts.cert],
          ["unverified", undefined],
        ] as const) {
          const ws = new WebSocket(url, {
            tls: {
              ca,
              rejectUnauthorized: false,
              checkServerIdentity(hostname: string) {
                calls.push(`${label}: ${hostname}`);
                return new Error("PIN-REJECT");
              },
            },
          });
          expect(await openSession(ws)).toEqual(opened);
        }
        expect(calls).toEqual(["verified: localhost"]);
      });

      it("does the same for the target inside a proxy tunnel", async () => {
        using server = startSniServer();
        using proxy = await startRecordingProxy();
        const url = `wss://localhost:${await server.port}/`;
        const calls: string[] = [];
        const ws = new WebSocket(url, {
          proxy: `http://127.0.0.1:${proxy.port}`,
          tls: {
            ca: tlsCerts.cert,
            rejectUnauthorized: false,
            checkServerIdentity(hostname: string) {
              calls.push(hostname);
              return new Error("PIN-REJECT");
            },
          },
        });
        expect(await openSession(ws)).toEqual(opened);
        expect(calls).toEqual(["localhost"]);
        expect(proxy.requests).toHaveLength(1);
      });
    });

    // On a renegotiation BoringSSL requires the same certificate, so the verdict
    // of the callback still holds and the callback does not run again.
    (nodeExe() ? it : it.skip).each([
      ["a name the certificate does not have", { serverName: "evil.test" }, "evil.test"],
      ["an IP URL, which has no SNI", {}, "127.0.0.1"],
    ] as const)("a certificate it approved survives a TLS 1.2 renegotiation: %s", async (_label, names, hostname) => {
      await using server = await startRenegotiatingWssServer("after the 101");

      const calls: string[] = [];
      const ws = new WebSocket(`wss://127.0.0.1:${server.port}/`, {
        tls: {
          ca: tlsCerts.cert,
          ...names,
          checkServerIdentity(name: string) {
            calls.push(name);
            return undefined;
          },
        },
      });
      ws.addEventListener("open", () => ws.send("ready"));
      ws.addEventListener("message", () => ws.close(1000));
      expect(await clientEvents(ws)).toEqual(["after renegotiation", ...opened]);
      expect(calls).toEqual([hostname]);
    });

    it("is called for the target certificate through an HTTP proxy", async () => {
      using server = startSniServer();
      using proxy = await startRecordingProxy();
      const url = `wss://localhost:${await server.port}/`;
      const calls: string[] = [];
      const ws = new WebSocket(url, {
        proxy: `http://127.0.0.1:${proxy.port}`,
        tls: {
          ca: tlsCerts.cert,
          checkServerIdentity(hostname: string) {
            calls.push(hostname);
            return new Error("PIN-REJECT");
          },
        },
      });
      expect(await openSession(ws)).toEqual(tlsFailed(url));
      expect(calls).toEqual(["localhost"]);
      expect(proxy.requests).toHaveLength(1);
      expect(await server.receivedInTotal()).toBe("");
    });

    it("is not called for the certificate of an HTTPS proxy", async () => {
      using server = startSniServer();
      using proxy = await startRecordingProxy({ tls: true });
      const url = `wss://localhost:${await server.port}/`;
      const calls: string[] = [];
      // The proxy presents the harness certificate too. The built-in check
      // verifies it against 127.0.0.1; the callback sees only the target.
      const ws = new WebSocket(url, {
        proxy: `https://127.0.0.1:${proxy.port}`,
        tls: {
          ca: tlsCerts.cert,
          checkServerIdentity(hostname: string) {
            calls.push(hostname);
            return undefined;
          },
        },
      });
      expect(await openSession(ws)).toEqual(opened);
      expect(calls).toEqual(["localhost"]);
      expect(proxy.requests).toHaveLength(1);
    });

    // A call into a VM that is stopping is a no-op that returns undefined, which is also how the callback approves.
    it("does not approve when the handshake ends in a worker that terminate() has stopped", async () => {
      using server = startSniServer();
      const serverPort = await server.port;
      // Holds the server's first flight, so that the test decides when the handshake can end.
      const flight = Promise.withResolvers<() => Promise<void>>();
      const relay = net.createServer(client => {
        const upstream = net.connect(serverPort, "127.0.0.1");
        client.on("error", () => {});
        client.on("close", () => upstream.destroy());
        upstream.on("error", () => {});
        client.pipe(upstream);
        upstream.once("data", bytes =>
          flight.resolve(() => new Promise(sent => client.write(bytes, () => (upstream.pipe(client), sent())))),
        );
      });
      const other = Promise.withResolvers<net.Socket>();
      const otherServer = net.createServer(other.resolve);
      relay.listen(0, "127.0.0.1");
      otherServer.listen(0, "127.0.0.1");
      await Promise.all([once(relay, "listening"), once(otherServer, "listening")]);

      const [STAGE, BOTH_READABLE, STOPPED] = [0, 1, 2];
      const flags = new Int32Array(new SharedArrayBuffer(12));
      const stage = async (value: number) => {
        while (Atomics.load(flags, STAGE) !== value) await new Promise(resolve => setImmediate(resolve));
      };
      const raise = (flag: number) => (Atomics.store(flags, flag, 1), Atomics.notify(flags, flag));
      const worker = new Worker(
        `
        const { parentPort, workerData } = require("node:worker_threads");
        const { url, ca, otherPort, flags } = workerData;
        globalThis.ws = new WebSocket(url, {
          headers: { Authorization: "Bearer secret" },
          tls: { ca, checkServerIdentity: () => new Error("PIN-REJECT") },
        });
        Bun.connect({
          hostname: "127.0.0.1",
          port: otherPort,
          socket: {
            data() {
              Atomics.store(flags, ${STAGE}, 2);
              Atomics.wait(flags, ${STOPPED}, 0);
            },
          },
        });
        parentPort.on("message", () => {
          Atomics.store(flags, ${STAGE}, 1);
          Atomics.wait(flags, ${BOTH_READABLE}, 0);
        });
      `,
        {
          eval: true,
          workerData: {
            url: `wss://127.0.0.1:${(relay.address() as AddressInfo).port}/`,
            ca: tlsCerts.cert,
            otherPort: (otherServer.address() as AddressInfo).port,
            flags,
          },
        },
      );
      try {
        const [deliverFlight, otherSocket] = await Promise.all([flight.promise, other.promise]);
        // While the worker's thread is blocked, both of its sockets become readable, the other one first.
        worker.postMessage("block");
        await stage(1);
        await new Promise(sent => otherSocket.write("x", sent));
        await deliverFlight();
        raise(BOTH_READABLE);
        // One pass of the worker's event loop now reads both. terminate() lands between the two.
        await stage(2);
        const terminated = worker.terminate();
        raise(STOPPED);
        expect(await server.receivedInTotal()).toBe("");
        await terminated;
      } finally {
        raise(BOTH_READABLE);
        raise(STOPPED);
        await worker.terminate();
        relay.close();
        otherServer.close();
      }
    });

    // The `ws` package passes its `tls` object to the native client as it is.
    it("applies through the ws package, with tls.serverName", async () => {
      using server = startSniServer();
      const calls: string[] = [];
      const ws = new NodeWS(`wss://127.0.0.1:${await server.port}/`, {
        tls: {
          ca: tlsCerts.cert,
          serverName: "localhost",
          checkServerIdentity(hostname: string) {
            calls.push(hostname);
            return new Error("PIN-REJECT");
          },
        },
      } as ClientOptions);
      // The first event decides. A close with no error before it must fail the assertion, not hang.
      const outcome = await new Promise<string>(resolve => {
        ws.on("open", () => resolve("open"));
        ws.on("error", () => resolve("error"));
        ws.on("close", code => resolve(`close ${code}`));
      });
      expect({ outcome, calls, sni: server.sni }).toEqual({
        outcome: "error",
        calls: ["localhost"],
        sni: ["localhost"],
      });
      expect(await server.receivedInTotal()).toBe("");
    });
  });

  // Not concurrent: these count every live WebSocket in the process, or force a full GC.
  describe("WebSocket tls.checkServerIdentity lifetime", () => {
    it.each(["tls", "proxy.tls"] as const)(
      "%s: survives a GC before the handshake ends when only the WebSocket refers to it",
      async option => {
        const release = Promise.withResolvers<void>();
        using server = startSniServer({ hold: release.promise });
        const port = await server.port;
        const calls: string[] = [];
        // Nothing in this scope refers to the callback or to the tls object. The built-in check
        // rejects evil.test, so the connection opens only if the callback is still there to run.
        const ws = (() => {
          const checked = {
            ca: tlsCerts.cert,
            serverName: "evil.test",
            checkServerIdentity: (hostname: string) => void calls.push(hostname),
          };
          return option === "tls"
            ? new WebSocket(`wss://127.0.0.1:${port}/`, { tls: checked })
            : new WebSocket("ws://127.0.0.1:1/", { proxy: { url: `https://127.0.0.1:${port}`, tls: checked } });
        })();
        const session = openSession(ws);
        // A connection that ends before its ClientHello fails the assertion below and does not hang here.
        await Promise.race([server.clientHello, session]);
        Bun.gc(true);
        release.resolve();
        // The server isn't a proxy, so it turns down the CONNECT request that follows the handshake.
        const events = await session;
        if (option === "tls") expect(events).toEqual(opened);
        expect(calls).toEqual(["evil.test"]);
      },
    );

    it("does not keep a closed WebSocket alive when the callback captures it", async () => {
      using server = startSniServer();
      const url = `wss://localhost:${await server.port}/`;
      const liveWebSockets = () => {
        Bun.gc(true);
        return heapStats().objectTypeCounts.WebSocket || 0;
      };
      const before = liveWebSockets();
      const total = 16;
      let checks = 0;
      await Promise.all(
        Array.from({ length: total }, async () => {
          // The cycle: the WebSocket holds the callback, and the callback holds the WebSocket.
          const ws: WebSocket = new WebSocket(url, {
            tls: {
              ca: tlsCerts.cert,
              checkServerIdentity() {
                if (ws.readyState === WebSocket.CONNECTING) checks++;
                return undefined;
              },
            },
          });
          expect(await openSession(ws)).toEqual(opened);
        }),
      );
      expect(checks).toBe(total);
      // The WebSocket drops its pending activity in a task after the close event.
      let leaked = liveWebSockets() - before;
      for (let i = 0; i < 10 && leaked > 2; i++) {
        await new Promise(resolve => setImmediate(resolve));
        leaked = liveWebSockets() - before;
      }
      expect(leaked).toBeLessThanOrEqual(2);
    });
  });
});

async function listen(): Promise<URL> {
  const pathname = path.join(import.meta.dir, "./websocket-server-echo.mjs");
  const { promise, resolve, reject } = Promise.withResolvers<URL>();
  server = spawn({
    cmd: [nodeExe() ?? bunExe(), pathname],
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

  return await promise;
}
