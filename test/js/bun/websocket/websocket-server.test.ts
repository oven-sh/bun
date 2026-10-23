import type { Server, ServerWebSocket, Subprocess, WebSocketHandler } from "bun";
import { serve, spawn } from "bun";
import { estimateShallowMemoryUsageOf } from "bun:jsc";
import { afterEach, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, forceGuardMalloc, isASAN, isDebug, isWindows, tempDir, tls as tlsCert } from "harness";
import { once } from "node:events";
import net, { isIP } from "node:net";
import path from "node:path";
import tls from "node:tls";
import { constants, inflateRawSync } from "node:zlib";
import { closePayload, OP, RawClient } from "../../web/websocket/raw-peer";

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
    bytes: Buffer.from("utf8-😶"),
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
let topicI = 0;

const binaryTypes = [
  {
    label: "nodebuffer",
    type: Buffer,
  },
  {
    label: "arraybuffer",
    type: ArrayBuffer,
  },
  {
    label: "uint8array",
    type: Uint8Array,
  },
  {
    label: "blob",
    type: Blob,
  },
] as const;

let servers: Server<unknown>[] = [];
let clients: Subprocess[] = [];

it.concurrent("should work fine if you repeatedly call methods on closed websockets", async () => {
  let env = { ...bunEnv };
  forceGuardMalloc(env);

  const { exited } = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "websocket-server-fixture.js")],
    env,
    stderr: "inherit",
    stdout: "inherit",
    stdin: "inherit",
  });

  expect(await exited).toBe(0);
});

afterEach(() => {
  for (const server of servers) {
    server.stop(true);
  }
  for (const client of clients) {
    client.kill();
  }
});

// publish on a closed websocket
// connecct 2 websocket clients to one server
// wait for one to call close callback
// publish to the other client
// the other client should not receive the message
// the server should not crash
// https://github.com/oven-sh/bun/issues/4443
it.concurrent("websocket/4443", async () => {
  var serverSockets: ServerWebSocket<unknown>[] = [];
  var onFirstConnected = Promise.withResolvers();
  var onSecondMessageEchoedBack = Promise.withResolvers();
  using server = Bun.serve({
    port: 0,
    websocket: {
      open(ws) {
        serverSockets.push(ws);
        ws.subscribe("test");
        if (serverSockets.length === 2) {
          onFirstConnected.resolve();
        }
      },
      message(ws, message) {
        onSecondMessageEchoedBack.resolve();
        ws.close();
      },
      close(ws) {
        ws.publish("test", "close");
      },
    },
    fetch(req, server) {
      server.upgrade(req);
      return new Response();
    },
  });

  var clients: WebSocket[] = [];
  var closedCount = 0;
  var onClientsOpened = Promise.withResolvers();

  var { promise, resolve } = Promise.withResolvers();
  for (let i = 0; i < 2; i++) {
    const ws = new WebSocket(`ws://${server.hostname}:${server.port}`);
    ws.binaryType = "arraybuffer";

    const clientSocket = new WebSocket(`ws://${server.hostname}:${server.port}`);
    clientSocket.binaryType = "arraybuffer";
    clientSocket.onopen = () => {
      clients.push(clientSocket);
      if (clients.length === 2) {
        onClientsOpened.resolve();
      }
    };
    clientSocket.onmessage = e => {
      clientSocket.send(e.data);
    };
    clientSocket.onclose = () => {
      if (closedCount++ === 1) {
        resolve();
      }
    };
  }

  await Promise.all([onFirstConnected.promise, onClientsOpened.promise]);
  clients[0].close();
  await promise;
});

describe("Server", () => {
  test("subscribe", done => ({
    open(ws) {
      expect(() => ws.subscribe("")).toThrow("subscribe requires a non-empty topic name");
      ws.subscribe("topic");
      expect(ws.isSubscribed("topic")).toBeTrue();
      ws.unsubscribe("topic");
      expect(ws.isSubscribed("topic")).toBeFalse();
      ws.close();
    },
    close(ws, code, reason) {
      done();
    },
  }));

  it.concurrent("subscriptions - basic usage", async () => {
    const { promise, resolve } = Promise.withResolvers<string[]>();
    const { promise: onClosePromise, resolve: onClose } = Promise.withResolvers();

    using server = serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }
        return new Response("Not a websocket");
      },
      websocket: {
        open(ws) {
          // Initially no subscriptions
          const initialSubs = ws.subscriptions;
          expect(Array.isArray(initialSubs)).toBeTrue();
          expect(initialSubs.length).toBe(0);

          // Subscribe to multiple topics
          ws.subscribe("topic1");
          ws.subscribe("topic2");
          ws.subscribe("topic3");
          const threeSubs = ws.subscriptions;
          expect(threeSubs.length).toBe(3);
          expect(threeSubs).toContain("topic1");
          expect(threeSubs).toContain("topic2");
          expect(threeSubs).toContain("topic3");

          // Unsubscribe from one
          ws.unsubscribe("topic2");
          const finalSubs = ws.subscriptions;

          resolve(finalSubs);
          ws.close();
        },
        close() {
          onClose();
        },
      } as Partial<WebSocketHandler<undefined>> as WebSocketHandler<undefined>,
    });

    const ws = new WebSocket(`ws://localhost:${server.port}`);
    ws.onclose = () => onClose();

    const [subscriptions] = await Promise.all([promise, onClosePromise]);
    expect(subscriptions.length).toBe(2);
    expect(subscriptions).toContain("topic1");
    expect(subscriptions).toContain("topic3");
    expect(subscriptions).not.toContain("topic2");
  });

  it.concurrent("subscriptions - all unsubscribed", async () => {
    const { promise, resolve } = Promise.withResolvers<string[]>();
    const { promise: onClosePromise, resolve: onClose } = Promise.withResolvers();

    using server = serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }
        return new Response("Not a websocket");
      },
      websocket: {
        open(ws) {
          // Subscribe to topics
          ws.subscribe("topic1");
          ws.subscribe("topic2");
          ws.subscribe("topic3");
          expect(ws.subscriptions.length).toBe(3);

          // Unsubscribe from all
          ws.unsubscribe("topic1");
          ws.unsubscribe("topic2");
          ws.unsubscribe("topic3");
          const finalSubs = ws.subscriptions;

          resolve(finalSubs);
          ws.close();
        },
        close() {
          onClose();
        },
      } as Partial<WebSocketHandler<undefined>> as WebSocketHandler<undefined>,
    });

    const ws = new WebSocket(`ws://localhost:${server.port}`);
    ws.onclose = () => onClose();

    const [subscriptions] = await Promise.all([promise, onClosePromise]);
    expect(subscriptions).toEqual([]);
    expect(subscriptions.length).toBe(0);
  });

  it.concurrent("subscriptions - after close", async () => {
    const { promise, resolve } = Promise.withResolvers();
    const { promise: onClosePromise, resolve: onClose } = Promise.withResolvers();

    using server = serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }
        return new Response("Not a websocket");
      },
      websocket: {
        open(ws) {
          ws.subscribe("topic1");
          ws.subscribe("topic2");
          expect(ws.subscriptions.length).toBe(2);
          ws.close();
        },
        close(ws) {
          // After close, should return empty array
          const subsAfterClose = ws.subscriptions;
          resolve(subsAfterClose);
          onClose();
        },
      } as Partial<WebSocketHandler<undefined>> as WebSocketHandler<undefined>,
    });

    const ws = new WebSocket(`ws://localhost:${server.port}`);
    ws.onclose = () => onClose();

    const [subscriptions] = await Promise.all([promise, onClosePromise]);
    expect(subscriptions).toStrictEqual([]);
  });

  it.concurrent("subscribe/unsubscribe return false on a closed socket", async () => {
    const { promise, resolve } = Promise.withResolvers<ServerWebSocket<unknown>>();
    const { promise: onClosePromise, resolve: onClose } = Promise.withResolvers<void>();

    using server = serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("Not a websocket");
      },
      websocket: {
        open(ws) {
          expect({
            subscribe: ws.subscribe("ghost"),
            isSubscribed: ws.isSubscribed("ghost"),
            unsubscribe: ws.unsubscribe("ghost"),
            unsubscribeAgain: ws.unsubscribe("ghost"),
          }).toEqual({
            subscribe: true,
            isSubscribed: true,
            unsubscribe: true,
            unsubscribeAgain: false,
          });
          resolve(ws);
          ws.close();
        },
        close() {
          onClose();
        },
        message() {},
      },
    });

    const client = new WebSocket(`ws://localhost:${server.port}`);
    const [ws] = await Promise.all([promise, onClosePromise]);
    client.close();

    expect({
      readyState: ws.readyState,
      subscribe: ws.subscribe("ghost"),
      isSubscribed: ws.isSubscribed("ghost"),
      subscriberCount: server.subscriberCount("ghost"),
      unsubscribe: ws.unsubscribe("ghost"),
      send: ws.send("x"),
    }).toEqual({
      readyState: WebSocket.CLOSED,
      subscribe: false,
      isSubscribed: false,
      subscriberCount: 0,
      unsubscribe: false,
      send: 0,
    });
  });

  it.concurrent("unsubscribe() and close() only change the calling socket's share of subscriberCount", async () => {
    const opened = {
      a: Promise.withResolvers<ServerWebSocket<{ id: string }>>(),
      b: Promise.withResolvers<ServerWebSocket<{ id: string }>>(),
    };
    const closed = {
      a: Promise.withResolvers<void>(),
      b: Promise.withResolvers<void>(),
    };

    using server = serve({
      port: 0,
      fetch(req, server) {
        const id = new URL(req.url).searchParams.get("id") as "a" | "b";
        if (server.upgrade(req, { data: { id } })) return;
        return new Response("Not a websocket", { status: 400 });
      },
      websocket: {
        data: {} as { id: "a" | "b" },
        open(ws) {
          opened[ws.data.id].resolve(ws);
        },
        close(ws) {
          closed[ws.data.id].resolve();
        },
        message() {},
      },
    });

    const clientA = new WebSocket(`ws://localhost:${server.port}/?id=a`);
    const clientB = new WebSocket(`ws://localhost:${server.port}/?id=b`);
    const [a, b] = await Promise.all([opened.a.promise, opened.b.promise]);

    expect({
      b_shared: b.subscribe("shared"),
      b_only: b.subscribe("only-b"),
      a_shared: a.subscribe("shared"),
      shared: server.subscriberCount("shared"),
      onlyB: server.subscriberCount("only-b"),
    }).toEqual({ b_shared: true, b_only: true, a_shared: true, shared: 2, onlyB: 1 });

    // A topic that exists but that this socket never joined, and a topic that
    // does not exist at all: both are a no-op that reports false.
    expect({
      notJoined: a.unsubscribe("only-b"),
      unknown: a.unsubscribe("never-subscribed"),
      bStillSubscribed: b.isSubscribed("only-b"),
      onlyB: server.subscriberCount("only-b"),
      shared: server.subscriberCount("shared"),
    }).toEqual({ notJoined: false, unknown: false, bStillSubscribed: true, onlyB: 1, shared: 2 });

    // Leaving the last topic releases the socket's subscriber state. Joining
    // again afterwards works and is counted again.
    expect({
      left: a.unsubscribe("shared"),
      aSubscribed: a.isSubscribed("shared"),
      bSubscribed: b.isSubscribed("shared"),
      shared: server.subscriberCount("shared"),
      rejoined: a.subscribe("shared"),
      sharedAfterRejoin: server.subscriberCount("shared"),
    }).toEqual({ left: true, aSubscribed: false, bSubscribed: true, shared: 1, rejoined: true, sharedAfterRejoin: 2 });

    // Closing a socket with live subscriptions removes it from every topic and
    // leaves the other socket's subscriptions alone.
    b.close();
    await closed.b.promise;
    expect({
      shared: server.subscriberCount("shared"),
      onlyB: server.subscriberCount("only-b"),
      aSubscribed: a.isSubscribed("shared"),
      bSubscriptions: b.subscriptions,
    }).toEqual({ shared: 1, onlyB: 0, aSubscribed: true, bSubscriptions: [] });

    a.close();
    await closed.a.promise;
    expect(server.subscriberCount("shared")).toBe(0);
    clientA.close();
    clientB.close();
  });

  it.concurrent("subscriptions - duplicate subscriptions", async () => {
    const { promise, resolve } = Promise.withResolvers<string[]>();
    const { promise: onClosePromise, resolve: onClose } = Promise.withResolvers();

    using server = serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }
        return new Response("Not a websocket");
      },
      websocket: {
        open(ws) {
          // Subscribe to same topic multiple times
          ws.subscribe("topic1");
          ws.subscribe("topic1");
          ws.subscribe("topic1");
          const subs = ws.subscriptions;

          resolve(subs);
          ws.close();
        },
        close() {
          onClose();
        },
      } as Partial<WebSocketHandler<undefined>> as WebSocketHandler<undefined>,
    });

    const ws = new WebSocket(`ws://localhost:${server.port}`);
    ws.onclose = () => onClose();

    const [subscriptions] = await Promise.all([promise, onClosePromise]);
    // Should only have one instance of topic1
    expect(subscriptions.length).toBe(1);
    expect(subscriptions).toContain("topic1");
  });

  it.concurrent("subscriptions - multiple cycles", async () => {
    const { promise, resolve } = Promise.withResolvers<string[]>();
    const { promise: onClosePromise, resolve: onClose } = Promise.withResolvers();

    using server = serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }
        return new Response("Not a websocket");
      },
      websocket: {
        open(ws) {
          // First cycle
          ws.subscribe("topic1");
          expect(ws.subscriptions).toEqual(["topic1"]);

          ws.unsubscribe("topic1");
          expect(ws.subscriptions.length).toBe(0);

          // Second cycle with different topics
          ws.subscribe("topic2");
          ws.subscribe("topic3");
          expect(ws.subscriptions.length).toBe(2);

          ws.unsubscribe("topic2");
          expect(ws.subscriptions).toEqual(["topic3"]);

          // Third cycle - resubscribe to topic1
          ws.subscribe("topic1");
          const finalSubs = ws.subscriptions;

          resolve(finalSubs);
          ws.close();
        },
        close() {
          onClose();
        },
      } as Partial<WebSocketHandler<undefined>> as WebSocketHandler<undefined>,
    });

    const ws = new WebSocket(`ws://localhost:${server.port}`);
    ws.onclose = () => onClose();

    const [subscriptions] = await Promise.all([promise, onClosePromise]);
    expect(subscriptions.length).toBe(2);
    expect(subscriptions).toContain("topic1");
    expect(subscriptions).toContain("topic3");
  });

  it.concurrent("publish() then unsubscribe() from last topic in same tick delivers queued messages", async () => {
    const aDone = Promise.withResolvers<string[]>();
    const bDone = Promise.withResolvers<string[]>();
    const ready = { a: Promise.withResolvers<void>(), b: Promise.withResolvers<void>() };
    const publishResults: number[] = [];

    using server = serve<{ id: string }>({
      port: 0,
      fetch(req, server) {
        const id = new URL(req.url).searchParams.get("id")!;
        if (server.upgrade(req, { data: { id } })) return;
        return new Response("no", { status: 400 });
      },
      websocket: {
        open(ws) {
          ws.subscribe("room");
          ws.send("ready");
        },
        message(ws, msg) {
          if (msg !== "go") return;
          for (let i = 0; i < 5; i++) {
            publishResults.push(server.publish("room", "msg" + i));
          }
          // Unsubscribing from the only topic used to free the uWS Subscriber
          // without draining its queued publish() messages, dropping them.
          ws.unsubscribe("room");
          // Sentinel: once this arrives, anything queued for this socket
          // has either been delivered ahead of it or dropped.
          ws.send("done");
        },
      },
    });

    const collect = (id: "a" | "b", done: PromiseWithResolvers<string[]>, isDone: (data: string) => boolean) => {
      const received: string[] = [];
      const ws = new WebSocket(`ws://localhost:${server.port}/?id=${id}`);
      ws.onmessage = e => {
        const data = e.data as string;
        if (data === "ready") return ready[id].resolve();
        received.push(data);
        if (isDone(data)) done.resolve([...received]);
      };
      const fail = (e: unknown) => {
        ready[id].reject(e);
        done.reject(e);
      };
      ws.onerror = fail;
      ws.onclose = () => fail(new Error("closed before done"));
      return ws;
    };

    // A never unsubscribes and never receives "done"; resolve once the full batch arrives.
    const a = collect("a", aDone, data => data === "msg4");
    // B must wait for the sentinel so we capture everything delivered before it.
    const b = collect("b", bDone, data => data === "done");
    try {
      await Promise.all([ready.a.promise, ready.b.promise]);
      b.send("go");

      const [aReceived, bReceived] = await Promise.all([aDone.promise, bDone.promise]);
      // publish() reported the message as queued for every call
      expect(publishResults).toEqual([4, 4, 4, 4, 4]);
      // A never unsubscribed; it must receive the full batch.
      expect(aReceived).toEqual(["msg0", "msg1", "msg2", "msg3", "msg4"]);
      // B unsubscribed in the same tick; it must still receive the batch
      // that publish() had already accepted before the unsubscribe.
      expect(bReceived).toEqual(["msg0", "msg1", "msg2", "msg3", "msg4", "done"]);
    } finally {
      a.onclose = b.onclose = null;
      a.close();
      b.close();
    }
  });

  describe("websocket", () => {
    test("open", done => ({
      open(ws) {
        expect(ws).toBeDefined();
        expect(ws).toHaveProperty("data", { id: 0 });
        done();
      },
    }));
    test("close", done => ({
      open(ws) {
        ws.close();
      },
      close(ws, code, reason) {
        expect(ws).toBeDefined();
        expect(ws).toHaveProperty("data", { id: 0 });
        expect(code).toBeInteger();
        expect(reason).toBeString();
        done();
      },
    }));
    test("message", done => ({
      open(ws) {
        ws.send("Hello");
      },
      message(ws, data) {
        expect(ws).toBeDefined();
        expect(ws).toHaveProperty("data", { id: 0 });
        expect(data).toBeDefined();
        done();
      },
    }));
    test("drain", done => ({
      backpressureLimit: 1,
      open(ws) {
        const data = new Uint8Array(1 * 1024 * 1024);
        // send data until backpressure is triggered
        for (let i = 0; i < 10; i++) {
          if (ws.send(data) < 1) {
            // backpressure or dropped
            break;
          }
        }
      },
      drain(ws) {
        expect(ws).toBeDefined();
        expect(ws).toHaveProperty("data", { id: 0 });
        done();
      },
    }));
    test("ping", done => ({
      open(ws) {
        ws.ping();
      },
      ping(ws, data) {
        expect(ws).toBeDefined();
        expect(ws).toHaveProperty("data", { id: 0 });
        expect(data).toBeInstanceOf(Buffer);
        done();
      },
    }));
    test("pong", done => ({
      open(ws) {
        ws.pong();
      },
      pong(ws, data) {
        expect(ws).toBeDefined();
        expect(ws).toHaveProperty("data", { id: 0 });
        expect(data).toBeInstanceOf(Buffer);
        done();
      },
    }));
    test("returning an Error from message() is not treated as a throw", (done, connect) => ({
      open(ws) {
        ws.send("trigger");
      },
      message(ws) {
        queueMicrotask(() => done());
        return new Error("returned, not thrown") as any;
      },
      error(error) {
        done(error);
      },
    }));
    for (const hook of ["message", "ping", "pong", "close"] as const) {
      test(`${hook} handler that throws passes its error and the socket to error()`, done => {
        const thrown = new Error(`${hook} threw`);
        let socket: ServerWebSocket<{ id: number }>;
        return {
          open(ws) {
            socket = ws;
            if (hook === "message") ws.send("echoed");
            else if (hook === "ping") ws.ping();
            else if (hook === "pong") ws.pong();
            else ws.close();
          },
          [hook]() {
            throw thrown;
          },
          error(...args) {
            try {
              expect(args).toHaveLength(2);
              expect(args[0]).toBe(thrown);
              expect(args[1]).toBe(socket);
              done();
            } catch (e) {
              done(e);
            }
          },
        };
      });
    }
    it("open handler that throws passes its error and the socket to error()", async () => {
      const thrown = new Error("open threw");
      let socket: ServerWebSocket<undefined> | undefined;
      const { promise, resolve } = Promise.withResolvers<unknown[]>();
      using server = serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(request, server) {
          if (server.upgrade(request)) return;
          return new Response();
        },
        websocket: {
          open(ws) {
            socket = ws;
            throw thrown;
          },
          message() {},
          error(...args) {
            resolve(args);
          },
        },
      });
      const client = new WebSocket(`ws://127.0.0.1:${server.port}/`);
      client.onerror = () => {};
      const args = await promise;
      expect(args).toHaveLength(2);
      expect(args[0]).toBe(thrown);
      expect(args[1]).toBe(socket);
    });
    test("maxPayloadLength", done => ({
      maxPayloadLength: 4,
      open(ws) {
        ws.send("Hello!");
      },
      close(_, code) {
        expect(code).toBe(1006);
        done();
      },
    }));
    test("backpressureLimit", done => ({
      backpressureLimit: 1,
      open(ws) {
        const data = new Uint8Array(1 * 1024 * 1024);
        expect(ws.send(data.slice(0, 1))).toBe(1); // sent
        let backpressure;
        for (let i = 0; i < 10; i++) {
          if (ws.send(data) === -1) {
            backpressure = true;
            break;
          }
        }
        if (!backpressure) {
          done(new Error("backpressure not triggered"));
          return;
        }
        let dropped;
        for (let i = 0; i < 10; i++) {
          if (ws.send(data) === 0) {
            dropped = true;
            break;
          }
        }
        if (!dropped) {
          done(new Error("message not dropped"));
          return;
        }
        done();
      },
    }));
    test("closeOnBackpressureLimit", done => ({
      closeOnBackpressureLimit: true,
      backpressureLimit: 1,
      open(ws) {
        const data = new Uint8Array(1 * 1024 * 1024);
        let backpressure = false;
        for (let i = 0; i < 10 && !backpressure; i++) {
          backpressure = ws.send(data) === -1;
        }
        if (!backpressure) {
          done(new Error("backpressure not triggered"));
          return;
        }
        // The limit is checked before queueing, so the send that crossed it was accepted and the next send closes.
        if (ws.readyState !== 1) {
          done(new Error("closed by the send that caused backpressure"));
          return;
        }
        ws.send(data);
      },
      close(_, code) {
        expect(code).toBe(1006);
        done();
      },
    }));
    describe("perMessageDeflate (validation)", () => {
      it.each([1073741824, "hello", 1n, Symbol()])("throws when not a boolean or object", value => {
        expect(() => {
          serve({
            port: 0,
            fetch: () => new Response(),
            websocket: {
              message() {},
              // @ts-expect-error
              perMessageDeflate: value,
            },
          });
        }).toThrow("websocket expects perMessageDeflate to be a boolean or an object");
      });
      it.each([true, false, null, undefined, {}, { compress: true, decompress: "shared" }] as const)(
        "accepts %p",
        value => {
          using server = serve({
            port: 0,
            fetch: () => new Response(),
            websocket: {
              message() {},
              perMessageDeflate: value as any,
            },
          });
          expect(server.port).toBeGreaterThan(0);
        },
      );
    });
  });
});
describe("ServerWebSocket", () => {
  test("readyState", done => ({
    open(ws) {
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    },
    close(ws) {
      expect(ws.readyState).toBe(WebSocket.CLOSED);
      done();
    },
  }));
  test("remoteAddress", done => ({
    open(ws) {
      expect(isIP(ws.remoteAddress)).toBeGreaterThan(0);
      done();
    },
  }));
  describe("binaryType", () => {
    test("(default)", done => ({
      open(ws) {
        expect(ws.binaryType).toBe("nodebuffer");
        done();
      },
    }));
    test("(invalid)", done => ({
      open(ws) {
        try {
          // @ts-expect-error
          ws.binaryType = "invalid";
          done(new Error("Expected an error"));
        } catch (cause) {
          done();
        }
      },
    }));
    for (const { label, type } of binaryTypes) {
      test(label, done => ({
        open(ws) {
          ws.binaryType = label;
          expect(ws.binaryType).toBe(label);
          ws.send(new Uint8Array(1));
        },
        message(ws, received) {
          expect(received).toBeInstanceOf(type);
          ws.ping();
        },
        ping(ws, received) {
          expect(received).toBeInstanceOf(type);
          ws.pong();
        },
        pong(_, received) {
          expect(received).toBeInstanceOf(type);
          done();
        },
      }));
    }
    test("keeps accepting the capitalized and 'buffer' spellings", done => ({
      open(ws) {
        try {
          const seen: string[] = [];
          for (const spelling of ["Buffer", "buffer", "ArrayBuffer", "Uint8Array", "nodebuffer", new String("blob")]) {
            ws.binaryType = spelling as typeof ws.binaryType;
            seen.push(ws.binaryType!);
          }
          expect(seen).toEqual(["nodebuffer", "nodebuffer", "arraybuffer", "uint8array", "nodebuffer", "blob"]);
          done();
        } catch (err) {
          done(err);
        }
      },
    }));
    test("blob payloads carry the frame bytes", done => {
      const received: { event: string; size: number; type: string; bytes: number[] }[] = [];
      async function record(event: string, data: unknown) {
        const blob = data as Blob;
        received.push({ event, size: blob.size, type: blob.type, bytes: Array.from(await blob.bytes()) });
      }
      // The echo client answers a message with the same message, a pong with the same pong
      // and a ping with the same ping. The client's WebSocket also answers a ping with an
      // automatic pong, so the server pong is sent first and only the first pong is recorded.
      return {
        open(ws) {
          try {
            ws.binaryType = "blob";
            ws.send(new Uint8Array([1, 2, 3]));
          } catch (err) {
            done(err);
          }
        },
        async message(ws, data) {
          try {
            await record("message", data);
            ws.pong(new Uint8Array([5]));
          } catch (err) {
            done(err);
          }
        },
        async pong(ws, data) {
          if (received.some(({ event }) => event === "pong")) return;
          try {
            await record("pong", data);
            ws.ping(new Uint8Array([4]));
          } catch (err) {
            done(err);
          }
        },
        async ping(_, data) {
          try {
            await record("ping", data);
            expect(received).toEqual([
              { event: "message", size: 3, type: "", bytes: [1, 2, 3] },
              { event: "pong", size: 1, type: "", bytes: [5] },
              { event: "ping", size: 1, type: "", bytes: [4] },
            ]);
            done();
          } catch (err) {
            done(err);
          }
        },
      };
    });
    it("blob frames report their bytes to the garbage collector", async () => {
      const { promise, resolve, reject } = Promise.withResolvers<Blob>();
      using server = serve({
        port: 0,
        fetch(req, server) {
          if (server.upgrade(req)) return;
          return new Response(null, { status: 400 });
        },
        websocket: {
          open(ws) {
            try {
              ws.binaryType = "blob";
            } catch (err) {
              reject(err);
            }
          },
          message(_, data) {
            resolve(data as unknown as Blob);
          },
        },
      });
      const payload = new Uint8Array(2 * 1024 * 1024);
      const client = new WebSocket(`ws://${server.hostname}:${server.port}`);
      client.onerror = () => reject(new Error("client error"));
      client.onopen = () => client.send(payload);
      try {
        const blob = await promise;
        expect(blob.size).toBe(payload.byteLength);
        // The size the Blob's visitChildren reports; close to 0 when the bytes are not reported.
        expect(estimateShallowMemoryUsageOf(blob)).toBeGreaterThanOrEqual(payload.byteLength);
      } finally {
        client.close();
      }
    });
  });
  describe("send()", () => {
    for (const { label, message, bytes } of messages) {
      test(label, done => ({
        open(ws) {
          ws.send(message);
        },
        message(_, received) {
          if (typeof received === "string") {
            expect(received).toBe(message as string);
          } else {
            expect(received).toEqual(Buffer.from(bytes));
          }
          done();
        },
      }));
    }
    test(
      "(benchmark)",
      (done, connect) => {
        const maxClients = 10;
        // A round trip takes ~75us on a debug+ASAN build (vs <1us on release), so 10_000 runs for ~25s there.
        const maxMessages = isDebug || isASAN ? 1_000 : 10_000;
        let count = 0;
        return {
          open(ws) {
            // test() spawned the first client; each client spawns the next until maxClients are connected.
            if (ws.data.id < maxClients - 1) {
              connect();
            }
            for (let i = 0; i < maxMessages; i++) {
              ws.send(`${i}`, true);
              ws.sendText(`${i}`, true);
              ws.sendBinary(Buffer.from(`${i}`), true);
            }
          },
          message() {
            if (++count === maxClients * maxMessages * 3) {
              done();
            }
          },
        };
      },
      30_000,
    );
  });
  test("send/sendText/sendBinary error on invalid arguments", done => ({
    open(ws) {
      // @ts-expect-error
      expect(() => ws.send("hello", "world")).toThrow("send expects compress to be a boolean");
      // @ts-expect-error
      expect(() => ws.sendText("hello", "world")).toThrow("sendText expects compress to be a boolean");
      // @ts-expect-error
      expect(() => ws.sendBinary(Buffer.from("hello"), "world")).toThrow("sendBinary expects compress to be a boolean");
      done();
    },
  }));
  describe("Blob", () => {
    async function openOne() {
      const opened = Promise.withResolvers<ServerWebSocket<unknown>>();
      const flushed = Promise.withResolvers<void>();
      const received: unknown[] = [];
      const server = serve({
        port: 0,
        fetch: (req, s) => (s.upgrade(req) ? undefined : new Response()),
        websocket: { publishToSelf: true, open: ws => opened.resolve(ws), message() {} },
      });
      const c = new WebSocket(`ws://${server.hostname}:${server.port}/`);
      c.binaryType = "arraybuffer";
      c.onmessage = e => {
        if (e.data === "done") return flushed.resolve();
        received.push(typeof e.data === "string" ? e.data : Buffer.from(e.data));
      };
      c.onerror = c.onclose = (ev: Event) => {
        const err = new Error(`client ${ev.type}`);
        opened.reject(err);
        flushed.reject(err);
      };
      let ws: ServerWebSocket<unknown>;
      try {
        ws = await opened.promise;
      } catch (e) {
        c.onclose = c.onerror = null;
        c.close();
        server.stop(true);
        throw e;
      }
      return {
        server,
        ws,
        received,
        flush: () => (ws.send("done"), flushed.promise),
        [Symbol.dispose]() {
          c.onclose = c.onerror = null;
          c.close();
          server.stop(true);
        },
      };
    }

    it.concurrent("send/sendBinary/ping/pong send the blob's bytes, not '[object Blob]'", async () => {
      using h = await openOne();
      const blobs = [
        ["Blob", new Blob([new Uint8Array([1, 2, 3, 4])]), [1, 2, 3, 4]],
        ["Blob.slice", new Blob([new Uint8Array([9, 9, 1, 2, 3, 4, 9, 9])]).slice(2, 6), [1, 2, 3, 4]],
        ["File", new File([new Uint8Array([5, 6, 7, 8])], "name.bin"), [5, 6, 7, 8]],
      ] as const;
      const rcs: Record<string, unknown> = {};
      for (const [label, blob] of blobs) {
        rcs[`send ${label}`] = h.ws.send(blob);
        rcs[`sendBinary ${label}`] = h.ws.sendBinary(blob);
        rcs[`ping ${label}`] = h.ws.ping(blob);
        rcs[`pong ${label}`] = h.ws.pong(blob);
      }
      rcs["send empty"] = h.ws.send(new Blob([]));
      rcs["sendBinary empty"] = h.ws.sendBinary(new Blob([]));
      await h.flush();
      expect({ rcs, received: h.received }).toEqual({
        rcs: {
          "send Blob": 4,
          "sendBinary Blob": 4,
          "ping Blob": 4,
          "pong Blob": 4,
          "send Blob.slice": 4,
          "sendBinary Blob.slice": 4,
          "ping Blob.slice": 4,
          "pong Blob.slice": 4,
          "send File": 4,
          "sendBinary File": 4,
          "ping File": 4,
          "pong File": 4,
          "send empty": 0,
          "sendBinary empty": 0,
        },
        received: [
          ...blobs.flatMap(([, , bytes]) => [Buffer.from(bytes), Buffer.from(bytes)]),
          Buffer.alloc(0),
          Buffer.alloc(0),
        ],
      });
    });

    it.concurrent("publish/publishBinary/server.publish send the blob's bytes", async () => {
      using h = await openOne();
      h.ws.subscribe("t");
      const blob = new Blob([new Uint8Array([1, 2, 3, 4])]);
      const rcs = {
        "ws.publish": h.ws.publish("t", blob),
        "ws.publishBinary": h.ws.publishBinary("t", blob),
        "server.publish": h.server.publish("t", blob),
      };
      await h.flush();
      expect({ rcs, received: h.received }).toEqual({
        rcs: { "ws.publish": 4, "ws.publishBinary": 4, "server.publish": 4 },
        received: [Buffer.from([1, 2, 3, 4]), Buffer.from([1, 2, 3, 4]), Buffer.from([1, 2, 3, 4])],
      });
    });

    it.concurrent("throws on file- or S3-backed Blob", async () => {
      using h = await openOne();
      h.ws.subscribe("t");
      using dir = tempDir("ws-blob-file", { "a.bin": "abcd" });
      const file = Bun.file(path.join(String(dir), "a.bin"));
      const msg = (fn: string) => `${fn} cannot send a file- or S3-backed Blob synchronously; await blob.bytes() first`;
      expect(() => h.ws.send(file)).toThrow(msg("send"));
      expect(() => h.ws.sendBinary(file)).toThrow(msg("sendBinary"));
      expect(() => h.ws.publish("t", file)).toThrow(msg("publish"));
      expect(() => h.ws.publishBinary("t", file)).toThrow(msg("publishBinary"));
      expect(() => h.ws.ping(file)).toThrow(msg("ping"));
      expect(() => h.ws.pong(file)).toThrow(msg("pong"));
      expect(() => h.server.publish("t", file)).toThrow(msg("publish"));
    });
  });
  describe("sendBinary()", () => {
    for (const { label, message, bytes } of buffers) {
      test(label, done => ({
        open(ws) {
          ws.sendBinary(message);
        },
        message(_, received) {
          expect(received).toEqual(Buffer.from(bytes));
          done();
        },
      }));
    }
  });
  describe("sendText()", () => {
    for (const { label, message } of strings) {
      test(label, done => ({
        open(ws) {
          ws.sendText(message);
        },
        message(_, received) {
          expect(received).toEqual(message);
          done();
        },
      }));
    }
  });
  describe("subscribe()", () => {
    for (const { label, message } of strings) {
      const topic = label + topicI++;
      test(label, done => ({
        open(ws) {
          expect(ws.isSubscribed(topic)).toBeFalse();
          ws.subscribe(topic);
          expect(ws.isSubscribed(topic)).toBeTrue();
          ws.unsubscribe(topic);
          expect(ws.isSubscribed(topic)).toBeFalse();
          done();
        },
      }));
    }
  });
  describe("publish()", () => {
    for (const [group, messages] of [
      ["strings", strings],
      ["buffers", buffers],
    ] as const) {
      describe(group, () => {
        for (const { label, message, bytes } of messages) {
          const topic = label + topicI++;
          let didSend = false;
          const send = ws => {
            if (ws.data.id === 1 && !didSend) {
              if (ws.publish(topic, message)) {
                didSend = true;
              }
            }
          };
          test(label, (done, connect) => ({
            async open(ws) {
              ws.subscribe(topic);
              if (ws.data.id === 0) {
                await connect();
              } else {
                send(ws);
              }
            },
            drain(ws) {
              send(ws);
            },
            message(ws, received) {
              if (ws.data.id === 1) {
                throw new Error("Expected publish() to not send to self");
              }
              if (typeof message === "string") {
                expect(received).toBe(message);
              } else {
                expect(received).toEqual(Buffer.from(bytes));
              }
              done();
            },
          }));
        }
      });
    }
  });
  test("publish/publishText/publishBinary error on invalid arguments", done => ({
    async open(ws) {
      // @ts-expect-error
      expect(() => ws.publish("hello", Buffer.from("hi"), "invalid")).toThrow(
        "publish expects compress to be a boolean",
      );
      // @ts-expect-error
      expect(() => ws.publishText("hello", "hi", "invalid")).toThrow("publishText expects compress to be a boolean");
      // @ts-expect-error
      expect(() => ws.publishBinary("hello", Buffer.from("hi"), "invalid")).toThrow(
        "publishBinary expects compress to be a boolean",
      );
      done();
    },
  }));
  describe("publishBinary()", () => {
    for (const { label, message, bytes } of buffers) {
      const topic = label + topicI++;
      let didSend = false;
      const send = ws => {
        if (ws.data.id === 1 && !didSend) {
          if (ws.publishBinary(topic, message)) {
            didSend = true;
          }
        }
      };
      test(label, (done, connect) => ({
        async open(ws) {
          ws.subscribe(topic);
          if (ws.data.id === 0) {
            await connect();
          } else {
            send(ws);
          }
        },
        drain(ws) {
          send(ws);
        },
        message(ws, received) {
          if (ws.data.id === 1) {
            throw new Error("Expected publish() to not send to self");
          }
          expect(received).toEqual(Buffer.from(bytes));
          done();
        },
      }));
    }
  });
  describe("publishText()", () => {
    for (let { label, message } of strings) {
      const topic = label + topicI++;
      let didSend = false;
      const send = ws => {
        if (ws.data.id === 1 && !didSend) {
          if (ws.publishText(topic, message)) {
            didSend = true;
          }
        }
      };
      test(label, (done, connect, options) => ({
        async open(ws) {
          const initial = options.server.subscriberCount(topic);
          ws.subscribe(topic);
          expect(options.server.subscriberCount(topic)).toBe(initial + 1);
          if (ws.data.id === 0) {
            await connect();
          } else if (ws.data.id === 1) {
            send(ws);
          }
        },
        drain(ws) {
          send(ws);
        },
        message(ws, received) {
          if (ws.data.id === 1) {
            throw new Error("Expected publish() to not send to self");
          }
          expect(received).toEqual(message);
          done();
        },
      }));
    }
  });
  describe("publish() with { publishToSelf: true }", () => {
    for (const { label, message, bytes } of messages) {
      const topic = label + topicI++;
      let didSend = false;
      const send = ws => {
        if (!didSend) {
          if (ws.publish(topic, message)) {
            didSend = true;
          }
        }
      };
      test(label, (done, _, options) => ({
        publishToSelf: true,
        async open(ws) {
          const initial = options.server.subscriberCount(topic);
          ws.subscribe(topic);
          expect(options.server.subscriberCount(topic)).toBe(initial + 1);
          send(ws);
        },
        drain(ws) {
          send(ws);
        },
        message(_, received) {
          if (typeof message === "string") {
            expect(received).toBe(message);
          } else {
            expect(received).toEqual(Buffer.from(bytes));
          }
          done();
        },
      }));
    }
  });
  // With the default publishToSelf: false, a ws.publish() from a socket that has never
  // subscribed to anything must still deliver to other subscribers.
  describe("publish() from a socket not subscribed to anything", () => {
    const big = Buffer.alloc(20 * 1024, "x").toString();
    const cases = [
      ["publish", "publish", "small-text"],
      ["publishText", "publishText", "small-text"],
      ["publishBinary", "publishBinary", Buffer.from("small-binary")],
      ["publish (>= cork buffer)", "publish", big],
    ] as const;
    for (const [label, method, payload] of cases) {
      it.concurrent(label, async () => {
        const subscribed = Promise.withResolvers<void>();
        const received = Promise.withResolvers<string | ArrayBuffer>();
        const published = Promise.withResolvers<number>();
        let nextId = 0;
        using server = serve<{ id: number }>({
          port: 0,
          fetch(req, server) {
            if (server.upgrade(req, { data: { id: nextId++ } })) return;
            return new Response();
          },
          websocket: {
            open(ws) {
              if (ws.data.id === 0) {
                ws.subscribe("chat");
                subscribed.resolve();
              } else {
                expect(ws.isSubscribed("chat")).toBe(false);
                // @ts-expect-error dynamic method dispatch
                published.resolve(ws[method]("chat", payload));
              }
            },
            message() {},
          },
        });
        const url = `ws://${server.hostname}:${server.port}/`;
        // A socket that errors or closes before the server's open() handler ran would
        // otherwise leave one of the awaited slots pending until the test timeout.
        const fail = (who: string) => (ev: Event) => {
          const err = new Error(`${who} websocket ${ev.type}`);
          subscribed.reject(err);
          published.reject(err);
          received.reject(err);
        };
        const sub = new WebSocket(url);
        sub.binaryType = "arraybuffer";
        sub.onmessage = e => received.resolve(e.data);
        sub.onerror = sub.onclose = fail("subscriber");
        await subscribed.promise;
        expect(server.subscriberCount("chat")).toBe(1);
        const pub = new WebSocket(url);
        pub.onmessage = e => received.reject(new Error("publisher must not receive: " + e.data));
        pub.onerror = pub.onclose = fail("publisher");

        const ret = await published.promise;
        expect(ret).toBe(Buffer.byteLength(payload));
        const got = await received.promise;
        if (typeof payload === "string") {
          expect(got).toBe(payload);
        } else {
          expect(Buffer.from(got as ArrayBuffer)).toEqual(Buffer.from(payload));
        }
        sub.close();
        pub.close();
      });
    }
  });
  describe("ping()", () => {
    test("(no argument)", done => ({
      open(ws) {
        ws.ping();
      },
      ping(_, received) {
        expect(received).toBeEmpty();
        done();
      },
    }));
    for (const { label, message, bytes } of messages) {
      test(label, done => ({
        open(ws) {
          ws.ping(message);
        },
        ping(_, received) {
          expect(received).toEqual(Buffer.from(bytes));
          done();
        },
      }));
    }
  });
  describe("pong()", () => {
    test("(no argument)", done => ({
      open(ws) {
        ws.pong();
      },
      pong(_, received) {
        expect(received).toBeEmpty();
        done();
      },
    }));
    for (const { label, message, bytes } of messages) {
      test(label, done => ({
        open(ws) {
          ws.pong(message);
        },
        pong(_, received) {
          expect(received).toEqual(Buffer.from(bytes));
          done();
        },
      }));
    }
  });
  test("cork()", done => {
    let count = 0;
    return {
      open(ws) {
        // @ts-expect-error
        expect(() => ws.cork()).toThrow();
        // @ts-expect-error
        expect(() => ws.cork(undefined)).toThrow();
        // @ts-expect-error
        expect(() => ws.cork({})).toThrow();
        expect(() =>
          ws.cork(() => {
            throw new Error("boom");
          }),
        ).toThrow("boom");
        // A returned Error is a return value, not a throw.
        const returned = new Error("returned");
        expect(ws.cork(() => returned)).toBe(returned);

        setTimeout(() => {
          ws.cork(() => {
            ws.send("1");
            ws.sendText("2");
            ws.sendBinary(new TextEncoder().encode("3"));
          });
        }, 5);
      },
      message(_, message) {
        if (typeof message === "string") {
          expect(+message).toBe(++count);
        } else {
          expect(+new TextDecoder().decode(message)).toBe(++count);
        }
        if (count === 3) {
          done();
        }
      },
    };
  });
  // https://github.com/oven-sh/bun/issues/21588
  test("cork() passes ws to callback", done => {
    let count = 0;
    return {
      open(ws) {
        try {
          let thisInside;
          const ret = ws.cork(function (ctx) {
            thisInside = this;
            ctx.send("1");
            ctx.sendText("2");
            ctx.sendBinary(new TextEncoder().encode("3"));
            return ctx;
          });
          expect(ret).toBe(ws);
          expect(thisInside).toBe(ws);
          ws.cork(ctx => {
            expect(ctx).toBe(ws);
          });
        } catch (err) {
          done(err);
        }
      },
      message(_, message) {
        if (typeof message === "string") {
          expect(+message).toBe(++count);
        } else {
          expect(+new TextDecoder().decode(message)).toBe(++count);
        }
        if (count === 3) {
          done();
        }
      },
    };
  });
  describe("close()", () => {
    test("(no arguments)", done => ({
      open(ws) {
        ws.close();
      },
      close(_, code, reason) {
        expect(code).toBe(1000);
        expect(reason).toBeEmpty();
        done();
      },
    }));
    test("(undefined, undefined)", done => ({
      open(ws) {
        ws.close(undefined, undefined);
      },
      close(_, code, reason) {
        expect(code).toBe(1000);
        expect(reason).toBeEmpty();
        done();
      },
    }));
    test("(no reason)", done => ({
      open(ws) {
        ws.close(1001);
      },
      close(_, code, reason) {
        expect(code).toBe(1001);
        expect(reason).toBeEmpty();
        done();
      },
    }));
    for (const { label, message } of strings) {
      test(label, done => ({
        open(ws) {
          ws.close(1002, message);
        },
        close(_, code, reason) {
          expect(code).toBe(1002);
          expect(reason).toBe(message);
          done();
        },
      }));
    }
  });
  test("terminate() on next tick", done => ({
    open(ws) {
      setTimeout(() => {
        ws.terminate();
      });
    },
    close(_, code, reason) {
      expect(code).toBe(1006);
      expect(reason).toBeEmpty();
      done();
    },
  }));
  it("terminate() inside open() calls close()", async () => {
    const { promise: serverClose, resolve: onServerClose } = Promise.withResolvers<[number, string]>();
    using server = serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(request, server) {
        if (server.upgrade(request)) return;
        return new Response();
      },
      websocket: {
        open(ws) {
          ws.terminate();
        },
        message() {},
        close(_, code, reason) {
          onServerClose([code, reason]);
        },
      },
    });
    const { promise: clientClose, resolve: onClientClose } = Promise.withResolvers<CloseEvent>();
    const client = new WebSocket(`ws://127.0.0.1:${server.port}/`);
    client.onclose = onClientClose;
    expect(await serverClose).toEqual([1006, ""]);
    expect((await clientClose).code).toBe(1006);
  });
});

function test(
  label: string,
  fn: (
    done: (err?: unknown) => void,
    connect: () => Promise<void>,
    options: { server: Server<{ id: number }> },
  ) => Partial<WebSocketHandler<{ id: number }>>,
  timeout?: number,
) {
  it.concurrent(
    label,
    async () => {
      let isDone = false;
      const localClients: Subprocess[] = [];
      const { promise: donePromise, resolve: resolveDone, reject: rejectDone } = Promise.withResolvers<void>();
      const done = (err?: unknown) => {
        if (!isDone) {
          isDone = true;
          server.stop();
          if (err) rejectDone(err);
          else resolveDone();
        }
      };
      let id = 0;
      var options = {
        server: undefined as Server<{ id: number }> | undefined,
      };
      const server: Server<{ id: number }> = serve({
        port: 0,
        fetch(request, server) {
          const data = { id: id++ };
          if (server.upgrade(request, { data })) {
            return;
          }
          return new Response();
        },
        websocket: {
          sendPings: false,
          message() {},
          ...fn(done, () => connect(server, localClients), options as any),
        },
      });
      options.server = server;
      expect(server.subscriberCount("empty topic")).toBe(0);
      const connected = connect(server, localClients);
      try {
        await Promise.all([donePromise, connected]);
      } finally {
        server.stop(true);
        for (const client of localClients) {
          client.kill();
        }
      }
    },
    { timeout: timeout ?? 10000 },
  );
}

async function connect(server: Server<unknown>, clientList: Subprocess[] = clients): Promise<void> {
  const url = new URL(`ws://${server.hostname}:${server.port}/`);
  const pathname = path.resolve(import.meta.dir, "./websocket-client-echo.mjs");
  const { promise, resolve } = Promise.withResolvers();
  const client = spawn({
    cmd: [bunExe(), pathname, url.href],
    cwd: import.meta.dir,
    env: { ...bunEnv, "LOG_MESSAGES": "0" },
    stdio: ["inherit", "inherit", "inherit"],
    ipc(message) {
      if (message === "connected") {
        resolve();
      }
    },
    serialization: "json",
  });
  clientList.push(client);
  await promise;
}

// RFC 6455 caps the close reason at 123 bytes. Truncating in the middle of a
// multi-byte character sends invalid UTF-8, and the peer fails with 1007.
describe.concurrent("close() truncates a long reason on a character boundary", () => {
  it.each([
    // 40 emoji (160 bytes) -> 30 emoji (120 bytes): byte 123 is inside the 31st.
    ["emoji (4-byte)", Buffer.alloc(160, "😀").toString(), Buffer.alloc(120, "😀").toString()],
    // "x" + 41 CJK (124 bytes) -> "x" + 40 CJK (121 bytes): byte 123 is inside the 41st.
    ["cjk (3-byte) off by one", "x" + Buffer.alloc(123, "中").toString(), "x" + Buffer.alloc(120, "中").toString()],
    ["ascii", Buffer.alloc(200, "a").toString(), Buffer.alloc(123, "a").toString()],
  ])("%s", async (_label, reason, expected) => {
    const { promise: serverClose, resolve: resolveServerClose } = Promise.withResolvers<[number, string]>();
    using server = serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response();
      },
      websocket: {
        open(ws) {
          ws.close(1000, reason);
        },
        message() {},
        close(_, code, reason) {
          resolveServerClose([code, reason]);
        },
      },
    });
    const { promise: clientClose, resolve: resolveClientClose } = Promise.withResolvers<CloseEvent>();
    const ws = new WebSocket(server.url.href.replace(/^http/, "ws"));
    ws.onclose = resolveClientClose;
    const [event, [serverCode, serverReason]] = await Promise.all([clientClose, serverClose]);
    expect([event.code, event.wasClean, event.reason]).toEqual([1000, true, expected]);
    expect([serverCode, serverReason]).toEqual([1000, expected]);
  });
});

it("you can call server.subscriberCount() when its not a websocket server", async () => {
  using server = serve({
    port: 0,
    fetch(request, server) {
      return new Response();
    },
  });
  expect(server.subscriberCount("boop")).toBe(0);
});

it.concurrent("server.upgrade() from the error() handler after fetch() threw completes the handshake", async () => {
  await using proc = spawn({
    cmd: [
      bunExe(),
      "-e",
      `const server = Bun.serve({
         port: 0,
         development: true,
         fetch(req) { throw Object.assign(new Error("boom"), { req }); },
         error(err) {
           if (err.req && server.upgrade(err.req, { data: { from: "error" } })) return;
           return new Response("err", { status: 500 });
         },
         websocket: {
           open(ws) { ws.send("opened:" + ws.data.from); },
           message(ws, m) { ws.send("echo:" + m); },
         },
       });
       const ws = new WebSocket(server.url.href.replace(/^http/, "ws"));
       ws.onerror = () => { console.log("ws error"); process.exit(1); };
       ws.onmessage = e => {
         console.log(e.data);
         if (e.data === "echo:hi") ws.close(1000);
         else ws.send("hi");
       };
       ws.onclose = e => { console.log("closed", e.code); server.stop(true); };`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe("opened:error\necho:hi\nclosed 1000\n");
  expect(exitCode).toBe(0);
});

// A handler that calls server.upgrade() before it returns leaves the server no
// response to send, so the server does not subscribe to the handler's promise.
// A rejection of that promise must stay unhandled and reach
// process.on("unhandledRejection"), whether it has settled when the handler
// returns or not. The server subscribes to the promise of a handler that
// upgrades after an await, so that case is not covered here.
describe.concurrent("a handler that calls server.upgrade() before it returns", () => {
  async function runChild(handlers: string) {
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `process.on("unhandledRejection", e => console.log("unhandledRejection:", e.message));
         const server = Bun.serve({
           port: 0,
           ${handlers}
           websocket: {
             open(ws) { ws.send("hi"); },
             message() {},
           },
         });
         const ws = new WebSocket(server.url.href.replace(/^http/, "ws"));
         ws.onerror = () => { console.log("ws error"); process.exit(1); };
         ws.onmessage = e => { console.log("ws got:", e.data); ws.close(); };
         ws.onclose = () => server.stop(true);`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  // A then() or catch() promise is rejected by a reaction job. It is a
  // separate case: JSC does not set its first-resolving-function flag.
  it.each([
    [
      "fetch() is async and throws after an await",
      `async fetch(req, srv) { srv.upgrade(req); await 0; throw new Error("E"); },
       error(e) { console.log("error() saw:", e.message); },`,
    ],
    [
      "fetch() returns Promise.reject()",
      `fetch(req, srv) { srv.upgrade(req); return Promise.reject(new Error("E")); },
       error(e) { console.log("error() saw:", e.message); },`,
    ],
    [
      "fetch() returns a then() promise that throws",
      `fetch(req, srv) { srv.upgrade(req); return Promise.resolve().then(() => { throw new Error("E"); }); },
       error(e) { console.log("error() saw:", e.message); },`,
    ],
    [
      "fetch() returns a catch() promise that rethrows",
      `fetch(req, srv) { srv.upgrade(req); return Promise.reject(new Error("E")).catch(e => { throw e; }); },
       error(e) { console.log("error() saw:", e.message); },`,
    ],
    [
      "fetch() returns a then() promise that passes a rejection through",
      `fetch(req, srv) { srv.upgrade(req); return Promise.reject(new Error("E")).then(x => x); },
       error(e) { console.log("error() saw:", e.message); },`,
    ],
    [
      "error() upgrades and returns Promise.reject()",
      `fetch(req) { throw Object.assign(new Error("boom"), { req }); },
       error(err) { server.upgrade(err.req); return Promise.reject(new Error("E")); },`,
    ],
  ])("reports a rejection to unhandledRejection when %s", async (_, handlers) => {
    const { stdout, stderr, exitCode } = await runChild(handlers);
    expect({ stdoutLines: stdout.trim().split("\n").sort(), stderr, exitCode }).toEqual({
      stdoutLines: ["unhandledRejection: E", "ws got: hi"],
      stderr: "",
      exitCode: 0,
    });
  });
});

it("server.upgrade() does not blank the Request's url/headers read afterwards", async () => {
  // req.url and req.headers are lifted lazily from the uws request. upgrade()
  // detaches that context, so fields not touched before the call must be
  // snapshotted onto the Request at detach time (same as the async path).
  let captured: { ok: boolean; url: string; host: string | null; ua: string | null; headerCount: number } | undefined;

  await using server = serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req, srv) {
      const ok = srv.upgrade(req);
      captured = {
        ok,
        url: req.url,
        host: req.headers.get("host"),
        ua: req.headers.get("user-agent"),
        headerCount: [...req.headers].length,
      };
      if (ok) return;
      return new Response("no", { status: 400 });
    },
    websocket: {
      open(ws) {
        ws.close();
      },
      message() {},
    },
  });

  const done = Promise.withResolvers<void>();
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/some/path?q=1`, {
    headers: { "user-agent": "bun-test" },
  });
  // close fires on both the happy path and a failed handshake, so the
  // expect() below always runs and shows `captured` instead of timing out.
  ws.onerror = () => done.resolve();
  ws.onclose = () => done.resolve();
  await done.promise;

  expect(captured).toEqual({
    ok: true,
    url: `http://127.0.0.1:${server.port}/some/path?q=1`,
    host: `127.0.0.1:${server.port}`,
    ua: "bun-test",
    headerCount: expect.any(Number),
  });
  expect(captured!.headerCount).toBeGreaterThan(0);
});

it("ws methods are safe when an argument's Symbol.toPrimitive terminates the socket", async () => {
  await using proc = spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const evil = (ws, value) =>
          Object.assign(new String(value), { [Symbol.toPrimitive]() { ws.terminate(); return value; } });
        const results = [];
        const { promise, resolve } = Promise.withResolvers();
        const methods = ["subscribe", "unsubscribe", "isSubscribed", "send", "sendText", "ping", "pong", "close"];
        let pending = methods.length;
        const server = Bun.serve({
          port: 0,
          fetch(req, srv) {
            if (srv.upgrade(req, { data: new URL(req.url).pathname.slice(1) })) return;
            return new Response("no");
          },
          websocket: {
            open(ws) {
              const which = ws.data;
              let rc;
              if (which === "subscribe") rc = ws.subscribe(evil(ws, "room"));
              else if (which === "unsubscribe") { ws.subscribe("room"); rc = ws.unsubscribe(evil(ws, "room")); }
              else if (which === "isSubscribed") { ws.subscribe("room"); rc = ws.isSubscribed(evil(ws, "room")); }
              else if (which === "send") rc = ws.send(evil(ws, "hello"));
              else if (which === "sendText") rc = ws.sendText(evil(ws, "hello"));
              else if (which === "ping") rc = ws.ping(evil(ws, "hello"));
              else if (which === "pong") rc = ws.pong(evil(ws, "hello"));
              else if (which === "close") rc = ws.close(1000, evil(ws, "hello"));
              results.push(which + "=" + rc + " subscribed=" + ws.isSubscribed("room"));
              if (--pending === 0) resolve();
            },
            message() {},
            close() {},
          },
        });
        for (const which of methods) {
          new WebSocket("ws://127.0.0.1:" + server.port + "/" + which).onerror = () => {};
        }
        await promise;
        results.sort();
        for (const r of results) console.log(r);
        console.log("publish=" + server.publish("room", "hello"));
        server.stop(true);
        process.exit(0);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe(
    [
      "close=undefined subscribed=false",
      "isSubscribed=false subscribed=false",
      "ping=0 subscribed=false",
      "pong=0 subscribed=false",
      "send=0 subscribed=false",
      "sendText=0 subscribed=false",
      "subscribe=false subscribed=false",
      "unsubscribe=false subscribed=false",
      "publish=0",
      "",
    ].join("\n"),
  );
  expect(exitCode).toBe(0);
});

// Regression: onUpgrade stored the ZigString returned by FetchHeaders.fastGet()
// (which borrows directly from the header map entry's WTF::StringImpl) and then
// called fastRemove(), which frees that StringImpl when the map holds the only
// reference. The dangling pointer was later read in toSlice() and written to the
// socket as the Sec-WebSocket-Protocol response header.
//
// To make the map entry the sole owner of the StringImpl (so fastRemove actually
// frees it), we append() twice: the second append causes FetchHeaders to combine
// the values with ", " via makeString(), producing a fresh StringImpl that no JS
// string references. `Malloc=1` routes bmalloc through the system allocator so
// ASAN-enabled builds detect the use-after-free; release builds fall through and
// validate the header value round-trips correctly.
it("server.upgrade() with Sec-WebSocket-Protocol in options.headers does not use-after-free the header value", async () => {
  const part = Buffer.alloc(128, "abcdefghijklmnopqrstuvwxyz0123456789").toString();

  await using proc = spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const part = ${JSON.stringify(part)};
        using server = Bun.serve({
          port: 0,
          websocket: { message() {} },
          fetch(req, server) {
            const h = new Headers();
            // Double-append so the stored value is a freshly-combined StringImpl
            // owned solely by the header map.
            h.append("Sec-WebSocket-Protocol", part);
            h.append("Sec-WebSocket-Protocol", "tail");
            h.set("X-Custom", "hello");
            if (server.upgrade(req, { headers: h })) return;
            return new Response("no upgrade", { status: 400 });
          },
        });
        const res = await fetch(server.url, {
          headers: {
            "Upgrade": "websocket",
            "Connection": "Upgrade",
            "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
            "Sec-WebSocket-Version": "13",
            "Sec-WebSocket-Protocol": "client-offered",
          },
        });
        console.log(JSON.stringify({
          status: res.status,
          protocol: res.headers.get("sec-websocket-protocol"),
          custom: res.headers.get("x-custom"),
        }));
      `,
    ],
    env: {
      ...bunEnv,
      // Route bmalloc through the system heap so ASAN can observe the
      // StringImpl allocation in sanitizer-enabled builds. On Windows
      // bmalloc's SystemHeap is unimplemented and would RELEASE_BASSERT,
      // so leave bmalloc in place there — Windows builds have no ASAN
      // lane anyway.
      ...(isWindows ? {} : { Malloc: "1" }),
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // uWS selects the first subprotocol (substring before the first comma) from
  // the value passed to resp.upgrade(), so the expected response protocol is
  // `part`, not the combined "part, tail".
  const expected = JSON.stringify({ status: 101, protocol: part, custom: "hello" });
  // Don't truncate stderr — when this previously crashed on Windows ci_assert
  // builds the panic line was past line 3, leaving "" and a misleading diff.
  expect({ stdout: stdout.trim(), stderr: stderr.trim() }).toEqual({
    stdout: expected,
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

it("server.publish() keeps the topic alive while converting the message", async () => {
  await using proc = spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const TOPIC = "t_".repeat(4000);
        const server = Bun.serve({
          port: 0,
          fetch(req, s) { return s.upgrade(req) ? undefined : new Response("x"); },
          websocket: { open(ws) { ws.subscribe(TOPIC); }, message() {} },
        });
        const client = new WebSocket("ws://127.0.0.1:" + server.port + "/");
        const got = Promise.withResolvers();
        client.onmessage = e => got.resolve(e.data);
        client.onclose = () => got.resolve("closed");
        await new Promise((resolve, reject) => { client.onopen = resolve; client.onerror = reject; });
        // A String object so toPrimitive hands back a fresh, otherwise-unreferenced JSString.
        const topic = Object.assign(new String("z"), { [Symbol.toPrimitive]() { return "t_".repeat(4000).slice(0) + ""; } });
        const data = Object.assign(new String("z"), {
          [Symbol.toPrimitive]() {
            Bun.gc(true);
            const k = [];
            for (let i = 0; i < 300; i++) k.push("Q".repeat(40000 + i));
            globalThis.keep = k;
            Bun.gc(true);
            return "payload";
          },
        });
        const rc = server.publish(topic, data);
        // If the first publish went to a garbage topic, this one arrives first.
        server.publish(TOPIC, "sentinel");
        const result = await got.promise;
        console.log(JSON.stringify({ rc, result }));
        client.close();
        server.stop(true);
      `,
    ],
    env: {
      ...bunEnv,
      // Route bmalloc through the system heap so ASAN builds observe the freed
      // StringImpl (see the Sec-WebSocket-Protocol test above).
      ...(isWindows ? {} : { Malloc: "1" }),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr: stderr.trim() }).toEqual({
    stdout: JSON.stringify({ rc: 7, result: "payload" }),
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

// publish() fans out to N subscribers and must report backpressure/drops the
// same way ws.send() does for a single socket.
describe.concurrent("publish() return value reflects subscriber backpressure", () => {
  // One paused raw-TCP subscriber; the server-side handle is captured so the
  // test can compare publish() to send() on the same socket.
  async function withSlowSubscriber(
    run: (ctx: { server: Server<string>; slow: ServerWebSocket<string>; sender: ServerWebSocket<string> }) => void,
  ) {
    const sockets: Record<string, ServerWebSocket<string>> = {};
    const opened = { slow: Promise.withResolvers<void>(), sender: Promise.withResolvers<void>() };
    await using server = serve<string>({
      port: 0,
      websocket: {
        backpressureLimit: 64 * 1024,
        idleTimeout: 0,
        open(ws) {
          sockets[ws.data] = ws;
          ws.subscribe("t");
          opened[ws.data]?.resolve();
        },
        message() {},
        close(ws) {
          delete sockets[ws.data];
        },
      },
      fetch(req, server) {
        if (server.upgrade(req, { data: new URL(req.url).pathname.slice(1) })) return;
        return new Response("no upgrade", { status: 400 });
      },
    });

    // "sender": ws.publish() excludes the sender, so we need a second socket
    // distinct from the slow subscriber to exercise the per-socket path.
    const sender = new WebSocket(`ws://127.0.0.1:${server.port}/sender`);
    sender.binaryType = "arraybuffer";
    sender.onmessage = () => {};
    {
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      sender.onopen = () => resolve();
      sender.onerror = e => reject(e);
      sender.onclose = () => reject(new Error("sender closed before open"));
      await promise;
    }

    // "slow": raw RFC6455 client that handshakes then pauses its read side so
    // the server accumulates backpressure for it.
    const handshake = Promise.withResolvers<void>();
    const slow = net.connect({ port: server.port!, host: "127.0.0.1" }, () => {
      slow.write(
        "GET /slow HTTP/1.1\r\n" +
          "Host: x\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
          "Sec-WebSocket-Version: 13\r\n\r\n",
      );
    });
    // Buffer until the response headers are complete; the 101 may be split
    // across TCP segments.
    let response = "";
    slow.on("data", (d: Buffer) => {
      response += d.toString("latin1");
      if (!response.includes("\r\n\r\n")) return;
      if (response.includes(" 101 ")) {
        slow.pause();
        handshake.resolve();
      } else {
        handshake.reject(new Error("upgrade failed: " + response));
      }
    });
    slow.on("error", handshake.reject);
    slow.on("close", () => handshake.reject(new Error("slow socket closed before upgrade")));
    try {
      await handshake.promise;
      await opened.slow.promise;
      await opened.sender.promise;
      run({ server, slow: sockets.slow, sender: sockets.sender });
    } finally {
      sender.close();
      slow.destroy();
    }
  }

  function histogram(results: number[]) {
    let positive = 0;
    let dropped = 0;
    let backpressure = 0;
    let other = 0;
    for (const r of results) {
      if (r > 0) positive++;
      else if (r === 0) dropped++;
      else if (r === -1) backpressure++;
      else other++;
    }
    return { positive, dropped, backpressure, other };
  }

  it("returns 0 when the topic has no subscribers", async () => {
    await withSlowSubscriber(({ server, sender }) => {
      expect(server.publish("no-such-topic", "x")).toBe(0);
      expect(sender.publish("no-such-topic", "x")).toBe(0);
    });
  });

  it("ws.publish() returns 0 when the sender is the sole subscriber", async () => {
    await withSlowSubscriber(({ sender }) => {
      // "self" only has the sender subscribed; ws.publish() excludes the
      // sender, so there are zero receivers on both the batched and direct
      // send paths.
      sender.subscribe("self");
      expect({
        small: sender.publish("self", Buffer.alloc(8000, "x").toString()),
        big: sender.publish("self", Buffer.alloc(20000, "x").toString()),
      }).toEqual({ small: 0, big: 0 });
    });
  });

  for (const [label, size] of [
    ["batched (<16KB)", 8000],
    ["direct (>=16KB)", 20000],
  ] as const) {
    it(`server.publish() ${label} reports dropped / backpressure`, async () => {
      await withSlowSubscriber(({ server, slow }) => {
        const payload = Buffer.alloc(size, "x").toString();
        // Enough iterations to blow well past backpressureLimit regardless of
        // how much the kernel accepts before blocking.
        const N = 1000;
        const results: number[] = [];
        for (let i = 0; i < N; i++) results.push(server.publish("t", payload));
        const h = histogram(results);
        // ws.send() on the same over-limit socket agrees the data is dropped;
        // publish() must have reported the same for the majority of calls.
        expect({ sendProbe: slow.send("probe"), histogram: h }).toEqual({
          sendProbe: 0,
          histogram: { ...h, other: 0 },
        });
        expect(h.dropped).toBeGreaterThan(0);
        // Every call returned one of the documented values.
        expect(h.positive + h.backpressure + h.dropped).toBe(N);
      });
    });

    it(`ws.publish() ${label} reports dropped / backpressure`, async () => {
      await withSlowSubscriber(({ slow, sender }) => {
        const payload = Buffer.alloc(size, "x").toString();
        const N = 1000;
        const results: number[] = [];
        for (let i = 0; i < N; i++) results.push(sender.publish("t", payload));
        const h = histogram(results);
        expect({ sendProbe: slow.send("probe"), histogram: h }).toEqual({
          sendProbe: 0,
          histogram: { ...h, other: 0 },
        });
        expect(h.dropped).toBeGreaterThan(0);
        expect(h.positive + h.backpressure + h.dropped).toBe(N);
      });
    });
  }

  it("ws.publishText() and ws.publishBinary() report dropped", async () => {
    await withSlowSubscriber(({ slow, sender }) => {
      const text = Buffer.alloc(8000, "x").toString();
      const bin = Buffer.alloc(8000, 0x61);
      let sawDroppedText = false;
      let sawDroppedBinary = false;
      for (let i = 0; i < 1000; i++) {
        if (sender.publishText("t", text) === 0) sawDroppedText = true;
        if (sender.publishBinary("t", bin) === 0) sawDroppedBinary = true;
        if (sawDroppedText && sawDroppedBinary) break;
      }
      expect({ sawDroppedText, sawDroppedBinary, sendProbe: slow.send("probe") }).toEqual({
        sawDroppedText: true,
        sawDroppedBinary: true,
        sendProbe: 0,
      });
    });
  });
});

// `compress` is a per-call hint that only applies to sockets that negotiated
// permessage-deflate. It defaults to false for ws.send() and ws.publish(), and
// to true for server.publish(). Both defaults are documented, so check the
// frames on the wire.
describe.concurrent("compress argument defaults", () => {
  const offerDeflate = { "Sec-WebSocket-Extensions": "permessage-deflate; client_max_window_bits" };

  // The next `count` text frames. The server negotiates server_no_context_takeover, so each RSV1 payload
  // can be inflated independently.
  async function textFrames(client: RawClient, count: number) {
    const frames: { text: string; compressed: boolean }[] = [];
    while (frames.length < count) {
      const frame = await client.nextFrame();
      if (!frame) throw new Error(`socket closed after ${frames.length} frame(s)`);
      if (frame.opcode !== OP.text) continue;
      const compressed = (frame.rsv & 4) !== 0;
      const payload = compressed
        ? inflateRawSync(frame.payload, { finishFlush: constants.Z_SYNC_FLUSH })
        : frame.payload;
      frames.push({ text: payload.toString(), compressed });
    }
    return frames;
  }

  it("server.publish() compresses by default; ws.send() and ws.publish() only with compress: true", async () => {
    const sockets: Record<string, ServerWebSocket<string>> = {};
    const opened = { deflate: Promise.withResolvers<void>(), plain: Promise.withResolvers<void>() };
    await using server = serve<string, {}>({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req, server) {
        if (server.upgrade(req, { data: new URL(req.url).pathname.slice(1) })) return;
        return new Response("no upgrade", { status: 400 });
      },
      websocket: {
        perMessageDeflate: true,
        open(ws) {
          sockets[ws.data] = ws;
          ws.subscribe("t");
          opened[ws.data as keyof typeof opened].resolve();
        },
        message() {},
      },
    });

    using deflate = await RawClient.upgrade(server.port, { path: "/deflate", headers: offerDeflate });
    using plain = await RawClient.upgrade(server.port, { path: "/plain" });
    expect({
      deflate: deflate.header("sec-websocket-extensions"),
      plain: plain.header("sec-websocket-extensions"),
    }).toEqual({ deflate: expect.stringMatching(/^permessage-deflate/), plain: undefined });
    await Promise.all([opened.deflate.promise, opened.plain.promise]);

    server.publish("t", "server.publish()");
    server.publish("t", "server.publish(undefined)", undefined);
    server.publish("t", "server.publish(false)", false);
    server.publish("t", "server.publish(true)", true);
    // ws.publish() skips the publishing socket, so publish from the plain socket
    // and check the frames on the deflate one.
    sockets.plain.publish("t", "ws.publish()");
    sockets.plain.publish("t", "ws.publish(true)", true);
    sockets.deflate.send("ws.send()");
    sockets.deflate.send("ws.send(true)", true);
    // Sent last, so once it arrives the plain socket has received everything
    // it's going to get.
    sockets.plain.send("end");

    expect(await textFrames(deflate, 8)).toEqual([
      { text: "server.publish()", compressed: true },
      { text: "server.publish(undefined)", compressed: true },
      { text: "server.publish(false)", compressed: false },
      { text: "server.publish(true)", compressed: true },
      { text: "ws.publish()", compressed: false },
      { text: "ws.publish(true)", compressed: true },
      { text: "ws.send()", compressed: false },
      { text: "ws.send(true)", compressed: true },
    ]);
    // A subscriber that didn't negotiate the extension gets uncompressed frames
    // regardless of `compress`.
    expect(await textFrames(plain, 5)).toEqual([
      { text: "server.publish()", compressed: false },
      { text: "server.publish(undefined)", compressed: false },
      { text: "server.publish(false)", compressed: false },
      { text: "server.publish(true)", compressed: false },
      { text: "end", compressed: false },
    ]);
  });

  it("server.publish() sends plain frames when perMessageDeflate is off, even with compress: true", async () => {
    const opened = Promise.withResolvers<ServerWebSocket<undefined>>();
    await using server = serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("no upgrade", { status: 400 });
      },
      websocket: {
        open(ws) {
          ws.subscribe("t");
          opened.resolve(ws);
        },
        message() {},
      },
    });

    using raw = await RawClient.upgrade(server.port, { headers: offerDeflate });
    expect(raw.header("sec-websocket-extensions")).toBeUndefined();
    const ws = await opened.promise;

    server.publish("t", "server.publish()");
    server.publish("t", "server.publish(true)", true);
    ws.send("ws.send(true)", true);

    expect(await textFrames(raw, 3)).toEqual([
      { text: "server.publish()", compressed: false },
      { text: "server.publish(true)", compressed: false },
      { text: "ws.send(true)", compressed: false },
    ]);
  });
});

// https://github.com/oven-sh/bun/issues/34158
it.each(["server", "client"] as const)(
  "server.stop() promise resolves after the last websocket closes (%s-initiated close)",
  async initiator => {
    const server = serve({
      port: 0,
      fetch(req, srv) {
        if (srv.upgrade(req)) return;
        return new Response("x");
      },
      websocket: {
        open(ws) {
          if (initiator === "server") queueMicrotask(() => ws.close());
        },
        message() {},
        close() {},
      },
    });
    const ws = new WebSocket(server.url.href.replace("http", "ws"));
    const { promise: wsClosed, resolve: onWsClosed, reject: onWsError } = Promise.withResolvers<void>();
    ws.onerror = e => onWsError(new Error(`ws error: ${e}`));
    ws.onclose = () => onWsClosed();
    if (initiator === "client") {
      const { promise: opened, resolve: onOpen } = Promise.withResolvers<void>();
      ws.onopen = () => onOpen();
      await opened;
      ws.close();
    }
    await wsClosed;
    await server.stop();
  },
);

// RFC 6455 §4.2.1 / §4.4: server.upgrade() must refuse a client handshake
// whose Upgrade token, Sec-WebSocket-Key, or Sec-WebSocket-Version is invalid.
describe("server.upgrade() validates the opening handshake", () => {
  let opened = 0;
  let server: Server<undefined>;
  afterEach(() => server?.stop(true));

  const rawHandshake = (headers: string[]) =>
    new Promise<{ status: number | null; headers: string }>(resolve => {
      let buf = "";
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        sock.destroy();
        const head = buf.split("\r\n\r\n", 1)[0] ?? "";
        const m = head.match(/^HTTP\/1\.[01] (\d+)/);
        resolve({ status: m ? +m[1] : null, headers: head });
      };
      const sock = net.connect({ port: server.port!, host: "127.0.0.1" }, () => {
        sock.write("GET /ws HTTP/1.1\r\nHost: x\r\n" + headers.join("\r\n") + "\r\n\r\n");
      });
      sock.on("data", d => {
        buf += d.toString("latin1");
        if (buf.includes("\r\n\r\n")) done();
      });
      sock.on("error", done);
      sock.on("close", done);
    });

  const K = "dGhlIHNhbXBsZSBub25jZQ==";
  const U = "Upgrade: websocket";
  const C = "Connection: Upgrade";
  const V = "Sec-WebSocket-Version: 13";

  it("accepts a well-formed request and rejects malformed ones", async () => {
    opened = 0;
    server = serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req, srv) {
        if (srv.upgrade(req)) return;
        return new Response("no", { status: 400 });
      },
      websocket: {
        open() {
          opened++;
        },
        message() {},
      },
    });

    // A valid handshake still upgrades.
    expect((await rawHandshake([U, C, `Sec-WebSocket-Key: ${K}`, V])).status).toBe(101);
    // Upgrade token is case-insensitive.
    expect((await rawHandshake(["Upgrade: WebSocket", C, `Sec-WebSocket-Key: ${K}`, V])).status).toBe(101);
    // Upgrade is an RFC 7230 token list; any "websocket" token suffices.
    expect((await rawHandshake(["Upgrade: keep-alive, websocket", C, `Sec-WebSocket-Key: ${K}`, V])).status).toBe(101);
    // So is Connection (Firefox sends this one).
    expect((await rawHandshake([U, "Connection: keep-alive, upgrade", `Sec-WebSocket-Key: ${K}`, V])).status).toBe(101);
    // Connection is hop-by-hop, so a proxy may have dropped or rewritten it.
    expect((await rawHandshake([U, `Sec-WebSocket-Key: ${K}`, V])).status).toBe(101);
    expect((await rawHandshake([U, "Connection: keep-alive", `Sec-WebSocket-Key: ${K}`, V])).status).toBe(101);
    expect(opened).toBe(6);

    // Upgrade token other than "websocket": not a WebSocket handshake.
    expect((await rawHandshake(["Upgrade: h2c", C, `Sec-WebSocket-Key: ${K}`, V])).status).toBe(400);

    // Sec-WebSocket-Key is not valid base64 of 16 bytes.
    for (const key of [
      "!!!!!!!!!!!!!!!!!!!!!!==", // non-alphabet bytes
      "dGhlIHNhbXBsZSBub25jZQ=A", // byte 23 != '='
      "dGhlIHNhbXBsZSBub25jZQA=", // byte 22 != '='
    ]) {
      expect((await rawHandshake([U, C, `Sec-WebSocket-Key: ${key}`, V])).status).toBe(400);
    }

    // Sec-WebSocket-Version missing or unsupported: RFC 6455 §4.4 requires
    // a 4xx with a Sec-WebSocket-Version header naming the supported version.
    for (const hs of [
      [U, C, `Sec-WebSocket-Key: ${K}`, "Sec-WebSocket-Version: 8"],
      [U, C, `Sec-WebSocket-Key: ${K}`],
    ]) {
      const { status, headers } = await rawHandshake(hs);
      expect(status).toBe(426);
      expect(headers.toLowerCase()).toContain("sec-websocket-version: 13");
    }

    // None of the rejected handshakes reached open().
    expect(opened).toBe(6);
  });

  // upgrade() validates and answers the handshake from `req.headers`, the only
  // view of the headers the handler can read and modify. It used to fall back to
  // the raw request for any handshake header missing from `req.headers`, so a
  // header the handler deleted came back, and a repeated header had one value for
  // the handler and another for upgrade().
  describe("reads the handshake headers from req.headers", () => {
    it.each([
      ["the handler never touches req.headers", false],
      ["the handler reads req.headers", true],
    ])("rejects a repeated Sec-WebSocket-Key when %s", async (_label, readHeaders) => {
      opened = 0;
      server = serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(req, srv) {
          if (readHeaders) void req.headers.get("host");
          if (srv.upgrade(req)) return;
          return new Response("no", { status: 400 });
        },
        websocket: {
          open() {
            opened++;
          },
          message() {},
        },
      });

      // Repeated headers are joined with ", ", which isn't a valid key
      // (RFC 6455 §11.3.1: the header must not appear more than once). Reading
      // only the first one would accept the handshake.
      const dup = await rawHandshake([U, C, `Sec-WebSocket-Key: ${K}`, `Sec-WebSocket-Key: ${K}`, V]);
      expect(dup.status).toBe(400);
      expect(opened).toBe(0);

      // Control: a single Sec-WebSocket-Key still upgrades.
      expect((await rawHandshake([U, C, `Sec-WebSocket-Key: ${K}`, V])).status).toBe(101);
      expect(opened).toBe(1);
    });

    // The "after an await" case already worked. By then the request is detached
    // from the raw uWS request, so there was nothing to fall back to.
    it.each(["before any await", "after an await"])(
      "upgrade() doesn't see a handshake header deleted from req.headers (%s)",
      async when => {
        server = serve({
          port: 0,
          hostname: "127.0.0.1",
          async fetch(req, srv) {
            const headerToDelete = req.headers.get("x-delete")!;
            // Use setImmediate, not a microtask, to get off the HTTP parser's stack so
            // the request is detached from the raw uWS request before upgrade() runs.
            if (when === "after an await") await new Promise(resolve => setImmediate(resolve));
            req.headers.delete(headerToDelete);
            if (srv.upgrade(req)) return;
            return new Response("no", { status: 400 });
          },
          websocket: { message() {} },
        });
        const handshakeDeleting = (header: string) =>
          rawHandshake([
            U,
            C,
            `Sec-WebSocket-Key: ${K}`,
            V,
            "Sec-WebSocket-Protocol: chat, superchat",
            `X-Delete: ${header}`,
          ]);

        // Control: with no handshake header deleted, the first offered subprotocol is selected.
        const control = await handshakeDeleting("x-unrelated");
        expect(control.status).toBe(101);
        expect(control.headers.toLowerCase()).toContain("sec-websocket-protocol: chat");

        const noProtocol = await handshakeDeleting("sec-websocket-protocol");
        expect(noProtocol.status).toBe(101);
        expect(noProtocol.headers.toLowerCase()).not.toContain("sec-websocket-protocol");

        // Without the key or the Upgrade header it's no longer a WebSocket handshake.
        expect((await handshakeDeleting("sec-websocket-key")).status).toBe(400);
        expect((await handshakeDeleting("upgrade")).status).toBe(400);

        const noVersion = await handshakeDeleting("sec-websocket-version");
        expect(noVersion.status).toBe(426);
        expect(noVersion.headers.toLowerCase()).toContain("sec-websocket-version: 13");
      },
    );
  });

  it("returns false for an invalid handshake even when fetch() is async", async () => {
    let upgradeResult: boolean | undefined;
    server = serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req, srv) {
        // Force the headers to be materialized on the Request before upgrade().
        void req.headers.get("host");
        await Promise.resolve();
        upgradeResult = srv.upgrade(req);
        if (upgradeResult) return;
        return new Response("no", { status: 400 });
      },
      websocket: { message() {} },
    });

    const h2c = await rawHandshake(["Upgrade: h2c", C, `Sec-WebSocket-Key: ${K}`, V]);
    expect(h2c.status).toBe(400);
    expect(upgradeResult).toBe(false);

    // The 426 path writes the response itself and detaches it; the Response
    // returned from fetch() after the await must not be written a second time.
    const v8 = await rawHandshake([U, C, `Sec-WebSocket-Key: ${K}`, "Sec-WebSocket-Version: 8"]);
    expect(v8.status).toBe(426);
    expect(v8.headers.toLowerCase()).toContain("sec-websocket-version: 13");
    expect(upgradeResult).toBe(false);
  });
});

// RFC 6455 §4.2.2 dictates the 101's Upgrade, Connection and
// Sec-WebSocket-Accept headers, and a 1xx can't have Content-Length or
// Transfer-Encoding (RFC 9110 §8.6). upgrade() writes the handshake headers
// itself. It used to also write the ones passed in options.headers, so the client
// saw two Sec-WebSocket-Accept values (or `Upgrade: h2c` next to
// `Upgrade: websocket`) and failed the handshake after the server had already
// called open().
describe.concurrent("server.upgrade() ignores reserved handshake headers in options.headers", () => {
  // RFC 6455 §1.3: the accept value for the sample nonce, which is the key RawClient sends.
  const ACCEPT = "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=";

  async function rawHandshake(port: number, headers?: Record<string, string>) {
    using client = new RawClient(port, { path: "/ws", headers });
    await client.response;
    return client.headLines;
  }

  // Lowercases header names, drops Date, and sorts, so the comparison doesn't
  // depend on write order.
  const fields = (lines: string[]) =>
    lines
      .slice(1)
      .map(line => {
        const i = line.indexOf(":");
        return line.slice(0, i).toLowerCase() + ":" + line.slice(i + 1);
      })
      .filter(line => !line.startsWith("date:"))
      .sort();

  const connectClient = (url: string, protocols?: string[]) =>
    new Promise<string>(resolve => {
      const ws = new WebSocket(url, protocols);
      ws.onopen = () => {
        resolve(`open protocol=${ws.protocol}`);
        ws.close();
      };
      ws.onerror = e => resolve(`error: ${(e as ErrorEvent).message}`);
    });

  it("from a plain object", async () => {
    const opened: string[] = [];
    using server = serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req, srv) {
        if (
          srv.upgrade(req, {
            data: new URL(req.url).pathname,
            headers: {
              "Upgrade": "h2c",
              "Connection": "close",
              "Sec-WebSocket-Accept": "AAAAAAAAAAAAAAAAAAAAAAAAAAA=",
              "Sec-WebSocket-Key": "not-for-a-response",
              "Sec-WebSocket-Version": "8",
              "Content-Length": "5",
              "Transfer-Encoding": "chunked",
              "X-Custom": "yes",
              "Set-Cookie": "a=b",
            },
          })
        )
          return;
        return new Response("no", { status: 400 });
      },
      websocket: {
        open(ws) {
          opened.push(ws.data as string);
        },
        message() {},
      },
    });

    const lines = await rawHandshake(server.port);
    expect(lines[0]).toBe("HTTP/1.1 101 Switching Protocols");
    expect(fields(lines)).toEqual(
      [
        "connection: Upgrade",
        `sec-websocket-accept: ${ACCEPT}`,
        "set-cookie: a=b",
        "upgrade: websocket",
        "x-custom: yes",
      ].sort(),
    );
    expect(await connectClient(`ws://127.0.0.1:${server.port}/client`)).toBe("open protocol=");
    expect(opened).toEqual(["/ws", "/client"]);
  });

  it("from a Headers object, without modifying it", async () => {
    const headers = new Headers({
      "Sec-WebSocket-Protocol": "chat",
      "Connection": "keep-alive",
      "X-H": "1",
    });
    using server = serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req, srv) {
        if (srv.upgrade(req, { headers })) return;
        return new Response("no", { status: 400 });
      },
      websocket: { message() {} },
    });

    const lines = await rawHandshake(server.port, { "Sec-WebSocket-Protocol": "superchat, chat" });
    expect(lines[0]).toBe("HTTP/1.1 101 Switching Protocols");
    // Sec-WebSocket-Protocol in options.headers picks the subprotocol.
    // upgrade() writes it exactly once.
    expect(fields(lines)).toEqual(
      [
        "connection: Upgrade",
        `sec-websocket-accept: ${ACCEPT}`,
        "sec-websocket-protocol: chat",
        "upgrade: websocket",
        "x-h: 1",
      ].sort(),
    );
    expect(await connectClient(`ws://127.0.0.1:${server.port}/`, ["superchat", "chat"])).toBe("open protocol=chat");
    expect([...headers]).toEqual([
      ["connection", "keep-alive"],
      ["sec-websocket-protocol", "chat"],
      ["x-h", "1"],
    ]);
  });

  // https://github.com/oven-sh/bun/issues/18243
  it.each([
    ["{}", () => ({})],
    ["[]", () => []],
    ["new Headers()", () => new Headers()],
  ])("accepts empty headers: %s", async (_label, headers) => {
    using server = serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req, srv) {
        if (srv.upgrade(req, { headers: headers() })) return;
        return new Response("no", { status: 400 });
      },
      websocket: { message() {} },
    });
    const lines = await rawHandshake(server.port);
    expect(lines[0]).toBe("HTTP/1.1 101 Switching Protocols");
    expect(fields(lines)).toEqual(["connection: Upgrade", `sec-websocket-accept: ${ACCEPT}`, "upgrade: websocket"]);
  });

  it("an empty Sec-WebSocket-Protocol selects none of the offered subprotocols", async () => {
    using server = serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req, srv) {
        const decline = new URL(req.url).pathname === "/ws";
        if (srv.upgrade(req, { headers: decline ? { "Sec-WebSocket-Protocol": "" } : { "X-H": "1" } })) return;
        return new Response("no", { status: 400 });
      },
      websocket: { message() {} },
    });
    const lines = await rawHandshake(server.port, { "Sec-WebSocket-Protocol": "superchat, chat" });
    expect(lines[0]).toBe("HTTP/1.1 101 Switching Protocols");
    expect(fields(lines)).toEqual(["connection: Upgrade", `sec-websocket-accept: ${ACCEPT}`, "upgrade: websocket"]);
    // Control: without Sec-WebSocket-Protocol in options.headers, the first offered subprotocol is selected.
    expect(await connectClient(`ws://127.0.0.1:${server.port}/echo`, ["superchat", "chat"])).toBe(
      "open protocol=superchat",
    );
  });

  it("Sec-WebSocket-Extensions can't negotiate an extension the client didn't offer", async () => {
    using server = serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req, srv) {
        if (srv.upgrade(req, { headers: { "Sec-WebSocket-Extensions": "permessage-deflate" } })) return;
        return new Response("no", { status: 400 });
      },
      websocket: { perMessageDeflate: true, message() {} },
    });
    const lines = await rawHandshake(server.port);
    expect(lines[0]).toBe("HTTP/1.1 101 Switching Protocols");
    expect(fields(lines)).toEqual(["connection: Upgrade", `sec-websocket-accept: ${ACCEPT}`, "upgrade: websocket"]);
  });
});

// The 101 switches protocols: the connection stops being HTTP, so the HTTP
// layer's "close after this response" (the request said Connection: close or
// was HTTP/1.0, or a graceful server.stop() marked the connection to close
// once idle) does not apply to the WebSocket that takes over the socket. A
// synchronous server.upgrade() always behaved that way. One made after an
// await used to send the 101 and shut the socket down right under the new
// WebSocket: open() ran on a dead socket, close() never ran, and the
// ServerWebSocket leaked.
describe.concurrent("server.upgrade() after an await on a connection the HTTP layer marked to close", () => {
  const K = "dGhlIHNhbXBsZSBub25jZQ==";

  function maskedFrame(opcode: number, payload: Buffer): Buffer {
    const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
    const masked = Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]));
    return Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | payload.length]), mask, masked]);
  }

  // Server frames are unmasked; every frame in this test has a short payload.
  function parseServerFrames(buf: Buffer): { frames: { opcode: number; payload: Buffer }[]; rest: Buffer } {
    const frames: { opcode: number; payload: Buffer }[] = [];
    let offset = 0;
    while (buf.length - offset >= 2) {
      const opcode = buf[offset] & 0x0f;
      const length = buf[offset + 1] & 0x7f;
      if (length >= 126 || buf[offset + 1] & 0x80) throw new Error(`unexpected server frame header ${buf[offset + 1]}`);
      if (buf.length - offset - 2 < length) break;
      frames.push({ opcode, payload: buf.subarray(offset + 2, offset + 2 + length) });
      offset += 2 + length;
    }
    return { frames, rest: buf.subarray(offset) };
  }

  async function upgradeAfterAwait(opts: {
    requestLine: string;
    headers: string[];
    beforeUpgrade?: (server: Server<undefined>) => void;
    sync?: boolean;
  }) {
    const events: string[] = [];
    const serverClosed = Promise.withResolvers<void>();
    let upgradeResult: boolean | undefined;
    using server = serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req, srv) {
        // Leave the parser's stack, where the socket is corked.
        if (!opts.sync) await new Promise(resolve => setImmediate(resolve));
        opts.beforeUpgrade?.(srv);
        upgradeResult = srv.upgrade(req);
        if (upgradeResult) return;
        return new Response("no", { status: 400 });
      },
      websocket: {
        open(ws) {
          events.push("open");
          ws.send("from open()");
        },
        message(ws, message) {
          events.push(`message:${message}`);
          ws.send(`echo:${message}`);
        },
        close(ws, code) {
          events.push(`close:${code}`);
          serverClosed.resolve();
        },
      },
    });

    const socket = net.connect({ port: server.port!, host: "127.0.0.1" });
    const socketClosed = Promise.withResolvers<never>();
    // Only observed through the races in `until` below.
    socketClosed.promise.catch(() => {});
    socket.on("error", error => socketClosed.reject(error));
    socket.on("close", () => socketClosed.reject(new Error("the server closed the socket")));

    let buffered: Buffer = Buffer.alloc(0);
    let onData = () => {};
    socket.on("data", (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      onData();
    });
    // Rejects if the server closes the socket before the condition holds.
    const until = <T>(condition: () => T | undefined) =>
      Promise.race([
        socketClosed.promise,
        new Promise<T>(resolve => {
          onData = () => {
            const value = condition();
            if (value !== undefined) resolve(value);
          };
          onData();
        }),
      ]);
    const nextFrame = () =>
      until(() => {
        const { frames, rest } = parseServerFrames(buffered);
        if (frames.length === 0) return undefined;
        buffered = rest;
        return frames[0];
      });

    await new Promise<void>(resolve => socket.once("connect", resolve));
    socket.write(`${opts.requestLine}\r\nHost: 127.0.0.1\r\n${opts.headers.join("\r\n")}\r\n\r\n`);

    const head = await until(() => {
      const end = buffered.indexOf("\r\n\r\n");
      if (end === -1) return undefined;
      const head = buffered.subarray(0, end).toString();
      buffered = buffered.subarray(end + 4);
      return head;
    });
    expect(head.split("\r\n")[0]).toBe("HTTP/1.1 101 Switching Protocols");
    expect(upgradeResult).toBe(true);

    // The socket is a live WebSocket in both directions.
    expect(await nextFrame()).toEqual({ opcode: 1, payload: Buffer.from("from open()") });
    socket.write(maskedFrame(1, Buffer.from("hi")));
    expect(await nextFrame()).toEqual({ opcode: 1, payload: Buffer.from("echo:hi") });

    // A clean close reaches close() with the client's code.
    socket.write(maskedFrame(8, Buffer.from([0x03, 0xe8])));
    expect(await nextFrame()).toEqual({ opcode: 8, payload: Buffer.from([0x03, 0xe8]) });
    socket.end();
    await serverClosed.promise;
    expect(events).toEqual(["open", "message:hi", "close:1000"]);
  }

  const handshake = [`Upgrade: websocket`, `Sec-WebSocket-Key: ${K}`, `Sec-WebSocket-Version: 13`];

  it("Connection: close", async () => {
    await upgradeAfterAwait({ requestLine: "GET / HTTP/1.1", headers: [...handshake, "Connection: Upgrade, close"] });
  });

  it("HTTP/1.0", async () => {
    await upgradeAfterAwait({ requestLine: "GET / HTTP/1.0", headers: [...handshake, "Connection: Upgrade"] });
  });

  it("a graceful server.stop() during the await", async () => {
    await upgradeAfterAwait({
      requestLine: "GET / HTTP/1.1",
      headers: [...handshake, "Connection: Upgrade"],
      beforeUpgrade: srv => srv.stop(),
    });
  });

  it("the synchronous path (Connection: close) is unchanged", async () => {
    await upgradeAfterAwait({
      requestLine: "GET / HTTP/1.1",
      headers: [...handshake, "Connection: Upgrade, close"],
      sync: true,
    });
  });
});

// server.upgrade() runs open() before it returns, and ws.close() runs close()
// before it returns. A request handler (or a request's abort listener) that
// calls one of them must still run to completion first: the nextTick and
// promise callbacks it queued run once it has returned, as they do for a timer
// or socket callback that does the same thing. They used to run inside the
// upgrade()/close() call.
describe.concurrent("request handlers run to completion before the callbacks they queued", () => {
  function queueThen(order: string[], nativeCall: () => void) {
    process.nextTick(() => order.push("nextTick"));
    Promise.resolve().then(() => order.push("microtask"));
    nativeCall();
    order.push("rest of handler");
  }

  function wsUrl(server: Server<undefined>, pathname: string) {
    return new URL(pathname, server.url.href.replace(/^http/, "ws"));
  }

  // Resolves once the server has closed the socket (or the handshake failed).
  function connectUntilClosed(server: Server<undefined>, pathname: string) {
    const { promise, resolve } = Promise.withResolvers<void>();
    const ws = new WebSocket(wsUrl(server, pathname));
    ws.onerror = () => resolve();
    ws.onclose = () => resolve();
    return promise;
  }

  const upgradeHandler = (order: string[]) => (req: Request, srv: Server<undefined>) => {
    queueThen(order, () => {
      if (!srv.upgrade(req)) order.push("upgrade() failed");
    });
  };

  const websocket = (order: string[], onOpen: (ws: ServerWebSocket<undefined>) => void) =>
    ({
      open(ws) {
        onOpen(ws);
      },
      message() {},
      close() {
        order.push("close()");
      },
    }) satisfies WebSocketHandler<undefined>;

  it("fetch() calling server.upgrade()", async () => {
    const order: string[] = [];
    using server = serve({
      port: 0,
      fetch: upgradeHandler(order),
      websocket: websocket(order, ws => {
        order.push("open()");
        ws.close();
      }),
    });

    await connectUntilClosed(server, "/");
    expect(order).toEqual(["open()", "close()", "rest of handler", "nextTick", "microtask"]);
  });

  it("a route handler calling server.upgrade()", async () => {
    const order: string[] = [];
    using server = serve({
      port: 0,
      routes: { "/ws": upgradeHandler(order) },
      websocket: websocket(order, ws => {
        order.push("open()");
        ws.close();
      }),
    });

    await connectUntilClosed(server, "/ws");
    expect(order).toEqual(["open()", "close()", "rest of handler", "nextTick", "microtask"]);
  });

  // Opens a websocket on `/ws` and hands back the server side of it.
  async function openHeldSocket(server: Server<undefined>, opened: Promise<ServerWebSocket<undefined>>) {
    const closed = connectUntilClosed(server, "/ws");
    const held = await opened;
    return { held, closed };
  }

  it("fetch() closing an open ServerWebSocket", async () => {
    const order: string[] = [];
    const opened = Promise.withResolvers<ServerWebSocket<undefined>>();
    let held: ServerWebSocket<undefined>;
    using server = serve({
      port: 0,
      fetch(req, srv) {
        if (new URL(req.url).pathname === "/ws") {
          return srv.upgrade(req) ? undefined : new Response("upgrade() failed", { status: 500 });
        }
        queueThen(order, () => held.close());
        return new Response("ok");
      },
      websocket: websocket(order, opened.resolve),
    });

    const sockets = await openHeldSocket(server, opened.promise);
    held = sockets.held;
    expect(await fetch(new URL("/close-it", server.url)).then(res => res.text())).toBe("ok");
    await sockets.closed;
    expect(order).toEqual(["close()", "rest of handler", "nextTick", "microtask"]);
  });

  it("a route handler closing an open ServerWebSocket", async () => {
    const order: string[] = [];
    const opened = Promise.withResolvers<ServerWebSocket<undefined>>();
    let held: ServerWebSocket<undefined>;
    using server = serve({
      port: 0,
      routes: {
        "/ws": (req, srv) => (srv.upgrade(req) ? undefined : new Response("upgrade() failed", { status: 500 })),
        "/close-it": () => {
          queueThen(order, () => held.close());
          return new Response("ok");
        },
      },
      websocket: websocket(order, opened.resolve),
    });

    const sockets = await openHeldSocket(server, opened.promise);
    held = sockets.held;
    expect(await fetch(new URL("/close-it", server.url)).then(res => res.text())).toBe("ok");
    await sockets.closed;
    expect(order).toEqual(["close()", "rest of handler", "nextTick", "microtask"]);
  });

  it("a request's abort listener closing an open ServerWebSocket", async () => {
    const order: string[] = [];
    const opened = Promise.withResolvers<ServerWebSocket<undefined>>();
    const reachedHandler = Promise.withResolvers<void>();
    let held: ServerWebSocket<unknown>;
    using server = serve({
      port: 0,
      fetch(req, srv) {
        if (new URL(req.url).pathname === "/ws") {
          return srv.upgrade(req) ? undefined : new Response("upgrade() failed", { status: 500 });
        }
        req.signal.addEventListener("abort", () => queueThen(order, () => held.close()));
        reachedHandler.resolve();
        // Never responds: the client aborts the request instead.
        return new Promise<Response>(() => {});
      },
      websocket: websocket(order, opened.resolve),
    });

    const sockets = await openHeldSocket(server, opened.promise);
    held = sockets.held;
    const controller = new AbortController();
    const aborted = fetch(new URL("/abort-me", server.url), { signal: controller.signal });
    await reachedHandler.promise;
    controller.abort();
    await expect(aborted).rejects.toThrow();
    await sockets.closed;
    expect(order).toEqual(["close()", "rest of handler", "nextTick", "microtask"]);
  });

  // After an await, the rest of an async handler runs from the microtask
  // checkpoint the server performs as soon as the handler returns its promise.
  // Only a promise callback is queued here: a nextTick queued from inside a
  // microtask is ordered differently from one queued by synchronous code, and
  // that ordering is not what this test is about.
  it("the continuation of an async fetch() closing an open ServerWebSocket", async () => {
    const order: string[] = [];
    const opened = Promise.withResolvers<ServerWebSocket<undefined>>();
    let held: ServerWebSocket<undefined>;
    using server = serve({
      port: 0,
      async fetch(req, srv) {
        if (new URL(req.url).pathname === "/ws") {
          return srv.upgrade(req) ? undefined : new Response("upgrade() failed", { status: 500 });
        }
        await Promise.resolve();
        Promise.resolve().then(() => order.push("microtask"));
        held.close();
        order.push("rest of handler");
        return new Response("ok");
      },
      websocket: websocket(order, opened.resolve),
    });

    const sockets = await openHeldSocket(server, opened.promise);
    held = sockets.held;
    expect(await fetch(new URL("/close-it", server.url)).then(res => res.text())).toBe("ok");
    await sockets.closed;
    expect(order).toEqual(["close()", "rest of handler", "microtask"]);
  });
});

// Once fetch() has returned a Response, the connection is busy sending it. Calling upgrade() at that
// point used to write the 101 into the middle of the body and turn the socket into a WebSocket while
// the body stream was still writing to it.
describe.concurrent("server.upgrade() after fetch() already returned a Response", () => {
  it.each(["direct", "default", "generator"])("returns false while a %s stream body is being sent", async kind => {
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const net = require("node:net");
        const upgraded = Promise.withResolvers();
        // Waits until fetch() has returned, so the server already has the Response.
        const nextMacrotask = () => new Promise(resolve => setImmediate(resolve));
        const bodies = {
          direct: (req, srv) => new ReadableStream({
            type: "direct",
            async pull(controller) {
              controller.write("chunk1");
              await controller.flush();
              await nextMacrotask();
              upgraded.resolve(srv.upgrade(req));
              controller.write("chunk2");
              controller.close();
            },
          }),
          default: (req, srv) => new ReadableStream({
            async pull(controller) {
              controller.enqueue("chunk1");
              await nextMacrotask();
              upgraded.resolve(srv.upgrade(req));
              controller.enqueue("chunk2");
              controller.close();
            },
          }),
          generator: (req, srv) => (async function* () {
            yield "chunk1";
            await nextMacrotask();
            upgraded.resolve(srv.upgrade(req));
            yield "chunk2";
          })(),
        };
        const server = Bun.serve({
          port: 0,
          hostname: "127.0.0.1",
          fetch: (req, srv) => new Response(bodies[${JSON.stringify(kind)}](req, srv)),
          websocket: { open() { console.log("open"); }, message() {} },
        });
        const received = Promise.withResolvers();
        let data = "";
        const socket = net.connect(server.port, "127.0.0.1", () => {
          socket.write(
            "GET / HTTP/1.1\\r\\nHost: x\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\n" +
              "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\\r\\nSec-WebSocket-Version: 13\\r\\n\\r\\n",
          );
        });
        socket.on("data", chunk => {
          data += chunk.toString("latin1");
          if (data.endsWith("\\r\\n0\\r\\n\\r\\n")) received.resolve();
        });
        socket.on("close", () => received.resolve());
        console.log("upgrade:", await upgraded.promise);
        if (await upgraded.promise) process.exit(1);
        await received.promise;
        console.log(data.split("\\r\\n", 1)[0]);
        let body = "";
        for (let rest = data.slice(data.indexOf("\\r\\n\\r\\n") + 4); ; ) {
          const size = parseInt(rest, 16);
          if (!size) break;
          const start = rest.indexOf("\\r\\n") + 2;
          body += rest.slice(start, start + size);
          rest = rest.slice(start + size + 2);
        }
        console.log("body:", body);
        console.log("pendingWebSockets:", server.pendingWebSockets);
        socket.destroy();
        server.stop(true);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim().split("\n"), stderr }).toEqual({
      stdout: ["upgrade: false", "HTTP/1.1 200 OK", "body: chunk1chunk2", "pendingWebSockets: 0"],
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });
});

// upgrade() after an await runs outside the HTTP parser's cork, so every piece of the 101
// ("HTTP/1.1 ", "101 Switching Protocols", "\r\n", a name, ": ", ...) used to be its own write: one
// syscall, one TCP segment and one TLS record each. TCP reads can coalesce segments, so count TLS
// records instead, which map one-to-one to the server's writes.
it("server.upgrade() after an await sends the 101 and open()'s messages in a single write", async () => {
  using server = serve({
    port: 0,
    hostname: "127.0.0.1",
    tls: tlsCert,
    async fetch(req, srv) {
      await new Promise(resolve => setImmediate(resolve));
      if (srv.upgrade(req, { headers: { "X-A": "1", "X-B": "2", "Set-Cookie": "a=b" } })) return;
      return new Response("no", { status: 400 });
    },
    websocket: {
      open(ws) {
        ws.send("first");
      },
      message() {},
    },
  });

  let applicationDataRecords = 0;
  const proxy = net.createServer(downstream => {
    const upstream = net.connect(server.port!, "127.0.0.1");
    let pending = Buffer.alloc(0);
    upstream.on("data", chunk => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 5 && pending.length >= 5 + pending.readUInt16BE(3)) {
        if (pending[0] === 23) applicationDataRecords++;
        pending = pending.subarray(5 + pending.readUInt16BE(3));
      }
      downstream.write(chunk);
    });
    downstream.pipe(upstream);
    for (const socket of [upstream, downstream]) socket.on("error", () => {});
    downstream.on("close", () => upstream.destroy());
  });
  proxy.listen(0, "127.0.0.1");
  await once(proxy, "listening");

  try {
    const received = Promise.withResolvers<string>();
    // Use TLS 1.2. In 1.3 the end of the handshake and the session tickets are also application data records.
    const client = tls.connect({
      port: (proxy.address() as net.AddressInfo).port,
      host: "127.0.0.1",
      rejectUnauthorized: false,
      maxVersion: "TLSv1.2",
    });
    client.on("error", received.reject);
    client.on("close", () => received.reject(new Error("closed")));
    client.once("secureConnect", () => {
      client.write(
        "GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
      );
    });
    let data = "";
    client.on("data", chunk => {
      data += chunk.toString("latin1");
      if (data.endsWith("\r\n\r\n\x81\x05first")) received.resolve(data);
    });
    expect(await received.promise).toStartWith("HTTP/1.1 101 Switching Protocols\r\n");
    expect(applicationDataRecords).toBe(1);
    client.destroy();
  } finally {
    proxy.close();
  }
});

describe.concurrent("ServerWebSocket.close(code, reason)", () => {
  // Calls ws.close(...args) in open(). Returns what it threw, the Close frame sent, and what close() received.
  async function closeWith(...args: unknown[]) {
    const handler = Promise.withResolvers<[number, string]>();
    let thrown: string | undefined;
    using server = serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("no", { status: 400 });
      },
      websocket: {
        open(ws) {
          try {
            // @ts-expect-error
            ws.close(...args);
          } catch (e) {
            thrown = `${(e as Error).name} readyState=${ws.readyState}`;
            ws.close(4999, "after the throw");
          }
        },
        message() {},
        close(_, code, reason) {
          handler.resolve([code, reason]);
        },
      },
    });
    using client = await RawClient.upgrade(server.port!);
    const frame = await client.nextFrame();
    expect(frame?.opcode).toBe(OP.close);
    const payload = frame!.payload;
    return {
      thrown,
      wire: payload.length ? [payload.readUInt16BE(0), payload.subarray(2).toString()] : [],
      handler: await handler.promise,
    };
  }

  it.each([
    [[], 1000, ""],
    [[undefined], 1000, ""],
    [[undefined, "bye"], 1000, "bye"],
    [[1000, "bye"], 1000, "bye"],
    [[1001], 1001, ""],
    [[1003], 1003, ""],
    [[1007], 1007, ""],
    [[1014, "bad gateway"], 1014, "bad gateway"],
    [[3000], 3000, ""],
    [[4999, "mine"], 4999, "mine"],
    [[1000.5, "bye"], 1000, "bye"],
  ] as const)("close(...%j) sends the code and reason", async (args, code, reason) => {
    expect(await closeWith(...args)).toEqual({ thrown: undefined, wire: [code, reason], handler: [code, reason] });
  });

  // A close() handler gets these codes when the peer sent none, and a proxy forwards them to its other connection.
  it.each([
    [[0], 0, ""],
    [[1005], 1005, ""],
    [[1006], 1006, ""],
    [[NaN], 0, ""],
    [[2 ** 32], 0, ""],
    [[Infinity], 0, ""],
    [[-Infinity], 0, ""],
    [[1005, "reason"], 1005, "reason"],
    [[1006, "Connection ended"], 1006, "Connection ended"],
  ] as const)("close(...%j) sends an empty Close frame", async (args, code, reason) => {
    expect(await closeWith(...args)).toEqual({ thrown: undefined, wire: [], handler: [code, reason] });
  });

  // RFC 6455 §7.4 doesn't allow these on the wire, but close() has always closed the connection with them. The code goes
  // through ToInt32, and the frame has its low 16 bits.
  it.each([
    [999, 999, 999],
    [1004, 1004, 1004],
    [1015, 1015, 1015],
    [1016, 1016, 1016],
    [2999, 2999, 2999],
    [5000, 5000, 5000],
    [-1, 65535, -1],
    [66536, 1000, 66536],
    [1.5, 1, 1],
    [2 ** 32 + 1000, 1000, 1000],
    [1000 - 2 ** 32, 1000, 1000],
  ])("close(%p) closes the connection", async (code, onTheWire, inTheHandler) => {
    expect(await closeWith(code)).toEqual({ thrown: undefined, wire: [onTheWire, ""], handler: [inTheHandler, ""] });
  });
});

describe.concurrent("ServerWebSocket argument validation", () => {
  async function openAndClosedSocket() {
    const sockets: ServerWebSocket<undefined>[] = [];
    const bothOpen = Promise.withResolvers<void>();
    const oneClosed = Promise.withResolvers<void>();
    const server = serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("no", { status: 400 });
      },
      websocket: {
        open(ws) {
          if (sockets.push(ws) === 2) bothOpen.resolve();
        },
        message() {},
        close() {
          oneClosed.resolve();
        },
      },
    });
    const clients = [await RawClient.upgrade(server.port!), await RawClient.upgrade(server.port!)];
    await bothOpen.promise;
    sockets[1].terminate();
    await oneClosed.promise;
    return {
      server,
      open: sockets[0],
      closed: sockets[1],
      [Symbol.dispose]() {
        for (const client of clients) client.destroy();
        server.stop(true);
      },
    };
  }

  // The last column is what a closed socket does. undefined means it throws the same error, because publish() still
  // publishes and cork() still runs its callback there.
  const invalidCalls: [string, (ws: any) => unknown, string, string?][] = [
    ["send()", ws => ws.send(), "send requires a non-empty message", "returned 0"],
    ["send(null)", ws => ws.send(null), "send requires a non-empty message", "returned 0"],
    ["send('x', 'y')", ws => ws.send("x", "y"), "send expects compress to be a boolean", "returned 0"],
    ["sendText(1)", ws => ws.sendText(1), "sendText expects a string", "returned 0"],
    ["sendBinary('x')", ws => ws.sendBinary("x"), "sendBinary expects a Blob or BufferSource", "returned 0"],
    ["ping(5)", ws => ws.ping(5), "ping expects a string, Blob, or BufferSource", "returned 0"],
    ["pong({})", ws => ws.pong({}), "pong expects a string, Blob, or BufferSource", "returned 0"],
    [
      "ping(126 bytes)",
      ws => ws.ping(new Uint8Array(126)),
      "The data size must not be greater than 125 bytes",
      "returned 0",
    ],
    ["subscribe(1)", ws => ws.subscribe(1), 'The "topic" argument must be of type string', "returned false"],
    ["subscribe('')", ws => ws.subscribe(""), "subscribe requires a non-empty topic name", "returned false"],
    ["unsubscribe(1)", ws => ws.unsubscribe(1), 'The "topic" argument must be of type string', "returned false"],
    [
      "unsubscribe(undefined)",
      ws => ws.unsubscribe(undefined),
      'The "topic" argument must be of type string',
      "returned false",
    ],
    ["isSubscribed('')", ws => ws.isSubscribed(""), "isSubscribed requires a non-empty topic name", "returned false"],
    ["publish(1, 'x')", ws => ws.publish(1, "x"), 'The "topic" argument must be of type string'],
    ["publish('', 'x')", ws => ws.publish("", "x"), "publish requires a non-empty topic"],
    ["publish('t', null)", ws => ws.publish("t", null), "publish requires a non-empty message"],
    ["publishText()", ws => ws.publishText(), 'The "topic" argument must be of type string'],
    ["publishText('t', 1)", ws => ws.publishText("t", 1), "publishText expects a string"],
    ["publishBinary('t', 'x')", ws => ws.publishBinary("t", "x"), "publishBinary expects a Blob or BufferSource"],
    ["close('x')", ws => ws.close("x"), "close requires a numeric code or undefined", "returned undefined"],
    ["cork()", ws => ws.cork(), 'The "callback" argument must be of type function'],
    ["cork(1)", ws => ws.cork(1), 'The "callback" argument must be of type function'],
  ];

  it("invalid arguments throw on an open socket, and a closed socket ignores the call", async () => {
    using sockets = await openAndClosedSocket();
    const getErrorMessage = (call: () => unknown) => {
      try {
        return `returned ${call()}`;
      } catch (e) {
        return (e as Error).message;
      }
    };
    for (const [label, call, message, onClosedSocket] of invalidCalls) {
      expect({ label, open: getErrorMessage(() => call(sockets.open)) }).toEqual({
        label,
        open: expect.stringContaining(message),
      });
      expect({ label, closed: getErrorMessage(() => call(sockets.closed)) }).toEqual({
        label,
        closed: onClosedSocket ?? expect.stringContaining(message),
      });
    }
    expect([sockets.open.readyState, sockets.closed.readyState]).toEqual([1, 3]);
  });

  it("a close handler that passes undefined to unsubscribe() and send() runs to its end", async () => {
    const finished = Promise.withResolvers<unknown[]>();
    using server = serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req, server) {
        if (server.upgrade(req, { data: {} })) return;
        return new Response("no", { status: 400 });
      },
      websocket: {
        message() {},
        close(ws) {
          const { room, farewell } = ws.data as { room?: string; farewell?: string };
          finished.resolve([ws.unsubscribe(room!), ws.isSubscribed(room!), ws.send(farewell!), ws.close(room as any)]);
        },
      },
    });
    const client = await RawClient.upgrade(server.port!);
    client.destroy();
    expect(await finished.promise).toEqual([false, false, 0, undefined]);
  });

  it('publishText("") returns 0 instead of throwing like publish("") and publishBinary("")', async () => {
    using sockets = await openAndClosedSocket();
    expect([sockets.open.publishText("", "x"), sockets.open.publishText("", "")]).toEqual([0, 0]);
    // The message is still validated.
    expect(() => sockets.open.publishText("", 1 as any)).toThrow("publishText expects a string");
  });

  it("valid calls on a closed socket are no-ops", async () => {
    using sockets = await openAndClosedSocket();
    const ws = sockets.closed;
    expect({
      send: ws.send("x"),
      sendText: ws.sendText("x"),
      sendBinary: ws.sendBinary(new Uint8Array(1)),
      ping: ws.ping(),
      pong: ws.pong("x"),
      subscribe: ws.subscribe("t"),
      unsubscribe: ws.unsubscribe("t"),
      isSubscribed: ws.isSubscribed("t"),
      close: ws.close(1000, "x"),
      terminate: ws.terminate(),
      pause: ws.pause(),
      resume: ws.resume(),
      isPaused: ws.isPaused,
      // The callback still runs. Its side effects other than sending shouldn't depend on the peer being connected.
      cork: ws.cork(socket => [socket === ws, socket.send("x")]),
    }).toEqual({
      send: 0,
      sendText: 0,
      sendBinary: 0,
      ping: 0,
      pong: 0,
      subscribe: false,
      unsubscribe: false,
      isSubscribed: false,
      close: undefined,
      terminate: undefined,
      pause: undefined,
      resume: undefined,
      isPaused: false,
      cork: [true, 0],
    });
  });

  // Unlike the ServerWebSocket methods, it coerces the topic and the message to strings and `compress` to a boolean.
  it("server.publish() coerces its arguments", async () => {
    const opened = Promise.withResolvers<void>();
    using server = serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("no", { status: 400 });
      },
      websocket: {
        open(ws) {
          for (const topic of ["42", "true", "1,2", "named", "[object Object]", "t"]) ws.subscribe(topic);
          opened.resolve();
        },
        message() {},
      },
    });
    using client = await RawClient.upgrade(server.port!);
    await opened.promise;
    const publish = server.publish.bind(server) as (...args: unknown[]) => number;
    const named = { toString: () => "named" };

    const delivered: [unknown[], number, string][] = [
      [[42, "a"], 1, "a"],
      [[true, "b"], 1, "b"],
      [[[1, 2], "c"], 1, "c"],
      [[named, "d"], 1, "d"],
      [[{}, "e"], 1, "e"],
      [["t", undefined], 9, "undefined"],
      [["t", null], 4, "null"],
      [["t", 7], 1, "7"],
      [["t", true], 4, "true"],
      [["t", named], 5, "named"],
      [["t", {}], 15, "[object Object]"],
      [["t", "f", undefined], 1, "f"],
      [["t", "g", null], 1, "g"],
      [["t", "h", 0], 1, "h"],
      [["t", "i", 1], 1, "i"],
      [["t", "j", "x"], 1, "j"],
      [["t", "k", Symbol()], 1, "k"],
    ];
    for (const [args, returned, text] of delivered) {
      expect({ args, returned: publish(...args), frame: await client.next() }).toEqual({
        args,
        returned,
        frame: `text ${JSON.stringify(text)}`,
      });
    }
    expect(publish(10n, "no subscribers")).toBe(0);

    const thrown: [unknown[], string][] = [
      [[], "Expected string"],
      [["t"], "Missing argument"],
      [[""], "Missing argument"],
      [[undefined], "Expected string"],
      [[undefined, "x"], "Expected string"],
      [[null, "x"], "Expected string"],
      [["", "x"], "publish requires a topic string"],
      [[Symbol(), "x"], "Cannot convert a symbol to a string"],
      [[Symbol()], "Cannot convert a symbol to a string"],
      [["t", Symbol()], "Cannot convert a symbol to a string"],
    ];
    for (const [args, message] of thrown) expect(() => publish(...args)).toThrow(message);
  });

  it("server.publish() without a websocket handler returns 0, even for an empty topic", () => {
    using server = serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("no") });
    const publish = server.publish.bind(server) as (...args: unknown[]) => number;
    expect([publish("t", "x"), publish("", "x"), publish(42, undefined, 1)]).toEqual([0, 0, 0]);
    expect(() => publish(null, "x")).toThrow("Expected string");
    expect(() => publish("t")).toThrow("Missing argument");
  });
});

// The fd is closed before close() runs, so the address has to be read while the socket is still open.
describe.concurrent("ws.remoteAddress read in open() is still available in close()", () => {
  it.each(["the client sends a Close frame", "the client drops the connection", "ws.close()", "ws.terminate()"])(
    "when %s",
    async how => {
      const address = Promise.withResolvers<string>();
      using server = serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(req, server) {
          if (server.upgrade(req)) return;
          return new Response("no", { status: 400 });
        },
        websocket: {
          open(ws) {
            void ws.remoteAddress;
            if (how === "ws.close()") ws.close();
            else if (how === "ws.terminate()") ws.terminate();
          },
          message() {},
          close(ws) {
            address.resolve(ws.remoteAddress);
          },
        },
      });
      using client = new RawClient(server.port!);
      await client.response;
      if (how === "the client sends a Close frame") client.close(1000);
      else if (how === "the client drops the connection") client.destroy();
      expect(await address.promise).toBe("127.0.0.1");
    },
  );
});

describe.concurrent.each([
  ["ws", false],
  ["wss", true],
] as const)("ServerWebSocket.pause() and resume() (%s)", (_scheme, secure) => {
  // "/paused" is the socket under test and "/echo" just echoes. A round trip on "/echo" proves the
  // server's event loop polled its sockets in the meantime.
  function pausedServer(onOpen: (ws: ServerWebSocket<string>) => void = () => {}) {
    const state = {
      messages: 0,
      bytes: 0,
      onMessage: () => {},
      opened: Promise.withResolvers<ServerWebSocket<string>>(),
      closed: Promise.withResolvers<[number, string, number]>(),
    };
    const server = serve({
      port: 0,
      hostname: "127.0.0.1",
      tls: secure ? tlsCert : undefined,
      fetch(req, server) {
        if (server.upgrade(req, { data: new URL(req.url).pathname })) return;
        return new Response("no", { status: 400 });
      },
      websocket: {
        open(ws) {
          if (ws.data !== "/paused") return;
          ws.pause();
          onOpen(ws);
          state.opened.resolve(ws);
        },
        message(ws, message) {
          if (ws.data !== "/paused") return void ws.send(message);
          state.messages++;
          state.bytes += message.length;
          state.onMessage();
        },
        close(ws, code, reason) {
          if (ws.data === "/paused") state.closed.resolve([code, reason, state.messages]);
        },
      },
    });
    return Object.assign(state, { server });
  }

  async function roundTrips(echo: RawClient, count: number) {
    for (let i = 0; i < count; i++) {
      echo.text("fence");
      expect(await echo.next()).toBe('text "fence"');
    }
  }

  it("a paused socket stops reading, so the client hits backpressure; resume() delivers everything", async () => {
    const state = pausedServer();
    using _server = state.server;
    using client = await RawClient.upgrade(state.server.port!, { path: "/paused", secure });
    using echo = await RawClient.upgrade(state.server.port!, { path: "/echo", secure });
    const ws = await state.opened.promise;
    expect(ws.isPaused).toBe(true);

    // Fill the kernel buffers on both sides: write until write() returns false and no 'drain'
    // fires while the server's event loop keeps running.
    const frame = client.frame(OP.binary, Buffer.alloc(64 * 1024, "x"));
    let sent = 0;
    let drained = true;
    client.socket.on("drain", () => (drained = true));
    while (drained) {
      drained = false;
      do sent++;
      while (client.socket.write(frame));
      await roundTrips(echo, 3);
    }
    expect(client.socket.writableLength).toBeGreaterThan(0);
    expect({ messages: state.messages, isPaused: ws.isPaused }).toEqual({ messages: 0, isPaused: true });

    const allReceived = Promise.withResolvers<void>();
    state.onMessage = () => {
      if (state.messages === sent) allReceived.resolve();
    };
    ws.resume();
    expect(ws.isPaused).toBe(false);
    await allReceived.promise;
    expect({ messages: state.messages, bytes: state.bytes }).toEqual({ messages: sent, bytes: sent * 64 * 1024 });
  });

  it("pause() and resume() are idempotent, and a paused socket can still send", async () => {
    const state = pausedServer();
    using _server = state.server;
    using client = await RawClient.upgrade(state.server.port!, { path: "/paused", secure });
    using echo = await RawClient.upgrade(state.server.port!, { path: "/echo", secure });
    const ws = await state.opened.promise;
    ws.pause();
    expect(ws.send("from a paused socket")).toBeGreaterThan(0);
    expect(await client.next()).toBe('text "from a paused socket"');

    client.text("one");
    await roundTrips(echo, 3);
    expect(state.messages).toBe(0);

    const first = Promise.withResolvers<void>();
    state.onMessage = first.resolve;
    ws.resume();
    ws.resume();
    await first.promise;
    expect({ messages: state.messages, isPaused: ws.isPaused }).toEqual({ messages: 1, isPaused: false });
  });

  it("delivers the client's messages and Close frame only after resume()", async () => {
    const state = pausedServer();
    using _server = state.server;
    using client = await RawClient.upgrade(state.server.port!, { path: "/paused", secure });
    const ws = await state.opened.promise;
    client.write(
      Buffer.concat([client.frame(OP.text, "last words"), client.frame(OP.close, closePayload(4000, "bye"))]),
    );
    client.end();
    await once(client.socket, "finish");
    ws.resume();
    expect(await state.closed.promise).toEqual([4000, "bye", 1]);
    expect(ws.isPaused).toBe(false);
    await client.closed;
  });

  it("terminate() closes a paused socket", async () => {
    const state = pausedServer();
    using _server = state.server;
    using client = await RawClient.upgrade(state.server.port!, { path: "/paused", secure });
    const ws = await state.opened.promise;
    ws.terminate();
    expect(await state.closed.promise).toEqual([1006, "", 0]);
    expect({ isPaused: ws.isPaused, readyState: ws.readyState }).toEqual({ isPaused: false, readyState: 3 });
    await client.closed;
  });

  it("close() on a paused socket sends the Close frame and disconnects once the client echoes it", async () => {
    const state = pausedServer();
    using _server = state.server;
    using client = await RawClient.upgrade(state.server.port!, { path: "/paused", secure });
    const ws = await state.opened.promise;
    ws.close(4001, "done");
    expect(await state.closed.promise).toEqual([4001, "done", 0]);
    expect({ isPaused: ws.isPaused, readyState: ws.readyState }).toEqual({ isPaused: false, readyState: 3 });
    expect(await client.next()).toBe('close 4001 "done"');
    client.socket.end(client.frame(OP.close, closePayload(4001)));
    await client.closed;
  });
});
