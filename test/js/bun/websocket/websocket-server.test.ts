import type { Server, ServerWebSocket, Subprocess, WebSocketHandler } from "bun";
import { serve, spawn } from "bun";
import { estimateShallowMemoryUsageOf } from "bun:jsc";
import { afterEach, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, forceGuardMalloc, isWindows, tempDir } from "harness";
import net, { isIP } from "node:net";
import path from "node:path";

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

let servers: Server[] = [];
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

  var clients = [];
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
      },
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
      },
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
      },
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
      },
    });

    const ws = new WebSocket(`ws://localhost:${server.port}`);
    ws.onclose = () => onClose();

    const [subscriptions] = await Promise.all([promise, onClosePromise]);
    // Should only have one instance of topic1
    expect(subscriptions.length).toBe(1);
    expect(subscriptions).toContain("topic1");
  });

  it.concurrent("subscriptions - multiple cycles", async () => {
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
      },
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

    using server = serve({
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
        return new Error("returned, not thrown");
      },
      error(error) {
        done(error);
      },
    }));
    for (const hook of ["ping", "pong", "close"] as const) {
      test(`${hook} handler that throws passes its error to error()`, done => {
        const thrown = new Error(`${hook} threw`);
        return {
          open(ws) {
            if (hook === "ping") ws.ping();
            else if (hook === "pong") ws.pong();
            else ws.close();
          },
          [hook]() {
            throw thrown;
          },
          error(error) {
            try {
              expect(error).toBe(thrown);
              done();
            } catch (e) {
              done(e);
            }
          },
        };
      });
    }
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
    // FIXME: close() callback is called, but only after timeout?
    it.todo("closeOnBackpressureLimit");
    /*
      test("closeOnBackpressureLimit", done => ({
        closeOnBackpressureLimit: true,
        backpressureLimit: 1,
        open(ws) {
          const data = new Uint8Array(1 * 1024 * 1024);
          // send data until backpressure is triggered
          for (let i = 0; i < 10; i++) {
            if (ws.send(data) < 1) {
              return;
            }
          }
          done(new Error("backpressure not triggered"));
        },
        close(_, code) {
          expect(code).toBe(1006);
          done();
        },
      }));
      */
    it.todo("perMessageDeflate");
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
    describe("resetIdleTimeoutOnSend (validation)", () => {
      it.each([0, 1, "false", {}])("throws on %p", value => {
        expect(() => {
          serve({
            port: 0,
            fetch: () => new Response(),
            websocket: {
              message() {},
              // @ts-expect-error
              resetIdleTimeoutOnSend: value,
            },
          });
        }).toThrow("websocket expects resetIdleTimeoutOnSend to be a boolean");
      });
      it.each([true, false, null, undefined])("accepts %p", value => {
        using server = serve({
          port: 0,
          fetch: () => new Response(),
          websocket: {
            message() {},
            resetIdleTimeoutOnSend: value as boolean | undefined,
          },
        });
        expect(server.port).toBeGreaterThan(0);
      });
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
          for (const spelling of ["Buffer", "buffer", "ArrayBuffer", "Uint8Array", "nodebuffer"]) {
            ws.binaryType = spelling as typeof ws.binaryType;
            seen.push(ws.binaryType!);
          }
          expect(seen).toEqual(["nodebuffer", "nodebuffer", "arraybuffer", "uint8array", "nodebuffer"]);
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
            expect(received).toBe(message);
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
        const maxMessages = 10_000;
        let count = 0;
        return {
          open(ws) {
            if (ws.data.id < maxClients) {
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
      c.onerror = c.onclose = ev => {
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
        using server = serve({
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
        expect(() => ws.cork()).toThrow();
        expect(() => ws.cork(undefined)).toThrow();
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
  // TODO: terminate() inside open() doesn't call close().
  it.todo("terminate() inside open() calls close()");
  // test("terminate() immediately", done => ({
  //   open(ws) {
  //     ws.terminate();
  //   },
  //   close(_, code, reason) {
  //     console.log(code, reason);
  //     try {
  //       expect(code).toBe(1006);
  //       expect(reason).toBeEmpty();
  //     } catch (e) {
  //       done(e);
  //       return;
  //     }
  //     done();
  //   },
  // }));
});

function test(
  label: string,
  fn: (
    done: (err?: unknown) => void,
    connect: () => Promise<void>,
    options: { server: Server },
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
        server: undefined,
      };
      const server: Server = serve({
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

async function connect(server: Server, clientList: Subprocess[] = clients): Promise<void> {
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
         if (e.data === "echo:hi") ws.close();
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
    run: (ctx: { server: Server; slow: ServerWebSocket<string>; sender: ServerWebSocket<string> }) => void,
  ) {
    const sockets: Record<string, ServerWebSocket<string>> = {};
    const opened = { slow: Promise.withResolvers<void>(), sender: Promise.withResolvers<void>() };
    await using server = serve<string, {}>({
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
    const slow = net.connect({ port: server.port, host: "127.0.0.1" }, () => {
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
  let server: Server;
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
      const sock = net.connect({ port: server.port, host: "127.0.0.1" }, () => {
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
    expect(opened).toBe(3);

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
    expect(opened).toBe(3);
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
    beforeUpgrade?: (server: Server) => void;
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

    const socket = net.connect({ port: server.port, host: "127.0.0.1" });
    const socketClosed = Promise.withResolvers<never>();
    // Only observed through the races in `until` below.
    socketClosed.promise.catch(() => {});
    socket.on("error", error => socketClosed.reject(error));
    socket.on("close", () => socketClosed.reject(new Error("the server closed the socket")));

    let buffered = Buffer.alloc(0);
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
    await upgradeAfterAwait({ requestLine: "GET / HTTP/1.1", headers: [...handshake, "Connection: close"] });
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
      headers: [...handshake, "Connection: close"],
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

  function wsUrl(server: Server, pathname: string) {
    return new URL(pathname, server.url.href.replace(/^http/, "ws"));
  }

  // Resolves once the server has closed the socket (or the handshake failed).
  function connectUntilClosed(server: Server, pathname: string) {
    const { promise, resolve } = Promise.withResolvers<void>();
    const ws = new WebSocket(wsUrl(server, pathname));
    ws.onerror = () => resolve();
    ws.onclose = () => resolve();
    return promise;
  }

  const upgradeHandler = (order: string[]) => (req: Request, srv: Server) => {
    queueThen(order, () => {
      if (!srv.upgrade(req)) order.push("upgrade() failed");
    });
  };

  const websocket = (order: string[], onOpen: (ws: ServerWebSocket<unknown>) => void) =>
    ({
      open(ws) {
        onOpen(ws);
      },
      message() {},
      close() {
        order.push("close()");
      },
    }) satisfies WebSocketHandler<unknown>;

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
  async function openHeldSocket(server: Server, opened: Promise<ServerWebSocket<unknown>>) {
    const closed = connectUntilClosed(server, "/ws");
    const held = await opened;
    return { held, closed };
  }

  it("fetch() closing an open ServerWebSocket", async () => {
    const order: string[] = [];
    const opened = Promise.withResolvers<ServerWebSocket<unknown>>();
    let held: ServerWebSocket<unknown>;
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
    const opened = Promise.withResolvers<ServerWebSocket<unknown>>();
    let held: ServerWebSocket<unknown>;
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
    const opened = Promise.withResolvers<ServerWebSocket<unknown>>();
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
    const opened = Promise.withResolvers<ServerWebSocket<unknown>>();
    let held: ServerWebSocket<unknown>;
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

// uws runs idle timeouts on a 4 second tick and splits `idleTimeout` into an
// idle part and a ping part: once the idle part passes without traffic it pings
// the client, and if the ping part also passes it closes the socket with
// 1006 "WebSocket timed out from inactivity". These tests keep the server
// sending to a client that never writes anything after the handshake (no
// messages, no pongs), which must still get reaped.
describe.concurrent("idleTimeout while the server keeps sending", () => {
  const HANDSHAKE =
    "GET / HTTP/1.1\r\n" +
    "Host: x\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
    "Sec-WebSocket-Version: 13\r\n\r\n";

  // Raw RFC 6455 client that completes the handshake and then never writes
  // again, counting the frames the server sends it. `secondPing` rejects when
  // the server pings again instead of closing, so a server that never reaps
  // the client fails the test at the next tick instead of at the test timeout.
  function connectAndGoSilent(port: number) {
    const upgraded = Promise.withResolvers<void>();
    const secondPing = Promise.withResolvers<never>();
    const counts = { pings: 0, messages: 0 };
    let head: string | null = "";
    let frames = Buffer.alloc(0);
    const socket = net.connect({ port, host: "127.0.0.1" }, () => socket.write(HANDSHAKE));
    socket.on("data", (chunk: Buffer) => {
      if (head !== null) {
        head += chunk.toString("latin1");
        const end = head.indexOf("\r\n\r\n");
        if (end === -1) return;
        if (!head.startsWith("HTTP/1.1 101 ")) {
          upgraded.reject(new Error("upgrade failed: " + head));
          return;
        }
        chunk = Buffer.from(head.slice(end + 4), "latin1");
        head = null;
        upgraded.resolve();
      }
      frames = Buffer.concat([frames, chunk]);
      // Server frames are unmasked, and everything this server sends ("tick"
      // and empty pings) fits the 2 byte header with a 7 bit payload length.
      while (frames.length >= 2 && frames.length >= 2 + (frames[1] & 0x7f)) {
        const opcode = frames[0] & 0x0f;
        if (opcode === 0x9 && ++counts.pings === 2) {
          secondPing.reject(new Error("server pinged the silent client again instead of closing it"));
        } else if (opcode === 0x1) {
          counts.messages++;
        }
        frames = frames.subarray(2 + (frames[1] & 0x7f));
      }
    });
    socket.on("error", upgraded.reject);
    socket.on("close", () => upgraded.reject(new Error("socket closed before the upgrade completed")));
    return { socket, counts, upgraded: upgraded.promise, secondPing: secondPing.promise };
  }

  async function reapSilentClient(options: Pick<WebSocketHandler<undefined>, "sendPings" | "resetIdleTimeoutOnSend">) {
    const closed = Promise.withResolvers<{ code: number; reason: string }>();
    let pusher: ReturnType<typeof setInterval> | undefined;
    await using server = serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req, srv) {
        if (srv.upgrade(req)) return;
        return new Response("no", { status: 400 });
      },
      websocket: {
        ...options,
        // The smallest idleTimeout uws accepts.
        idleTimeout: 8,
        open(ws) {
          pusher = setInterval(() => ws.send("tick"), 100);
        },
        message() {},
        close(_, code, reason) {
          clearInterval(pusher);
          closed.resolve({ code, reason });
        },
      },
    });
    const client = connectAndGoSilent(server.port!);
    try {
      await client.upgraded;
      const { code, reason } = await Promise.race([closed.promise, client.secondPing]);
      return { code, reason, pings: client.counts.pings, serverWasSending: client.counts.messages > 0 };
    } finally {
      clearInterval(pusher);
      client.socket.destroy();
    }
  }

  const reaped = { code: 1006, reason: "WebSocket timed out from inactivity", serverWasSending: true };

  // With an 8 second idleTimeout the idle part is a single tick, so the ping
  // goes out even though every send() re-arms the idle timer. The sends made
  // after the ping must not cancel the ping deadline: the client never answered.
  it("a ping the client does not answer closes the connection even though the server keeps sending (default options)", async () => {
    expect(await reapSilentClient({})).toEqual({ ...reaped, pings: 1 });
  }, 20_000);

  // Without pings the idle part is the whole 8 seconds (two ticks), which the
  // default reset-on-send keeps re-arming forever while the server is sending.
  // resetIdleTimeoutOnSend: false makes only the client's traffic count.
  it("resetIdleTimeoutOnSend: false closes a silent client on idleTimeout regardless of what the server sends", async () => {
    expect(await reapSilentClient({ sendPings: false, resetIdleTimeoutOnSend: false })).toEqual({
      ...reaped,
      pings: 0,
    });
  }, 20_000);
});
