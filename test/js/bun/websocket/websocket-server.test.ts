import type { Server, ServerWebSocket, Subprocess, WebSocketHandler } from "bun";
import { serve, spawn } from "bun";
import { afterEach, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, forceGuardMalloc, isWindows } from "harness";
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
        ).toThrow();

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

// publish() fans out to N subscribers and must report backpressure/drops the
// same way ws.send() does for a single socket.
describe.concurrent("publish() return value reflects subscriber backpressure", () => {
  // Raw RFC6455 client that handshakes then pauses its read side so the server
  // accumulates backpressure for it. Resolves once the upgrade 101 is seen.
  async function connectStalledSubscriber(port: number): Promise<net.Socket> {
    const handshake = Promise.withResolvers<void>();
    const slow = net.connect({ port, host: "127.0.0.1" }, () => {
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
    await handshake.promise;
    return slow;
  }

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

    const slow = await connectStalledSubscriber(server.port);
    try {
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

  // publish() returns the WORST subscriber status: one stalled subscriber makes
  // the call return 0 while every healthy subscriber still receives the
  // message. Retrying on 0 would re-deliver to healthy subscribers.
  it("healthy subscribers still receive messages when publish() returns 0", async () => {
    const opened = { slow: Promise.withResolvers<void>(), healthy: Promise.withResolvers<void>() };
    await using server = serve<string, {}>({
      port: 0,
      websocket: {
        backpressureLimit: 64 * 1024,
        idleTimeout: 0,
        open(ws) {
          ws.subscribe("t");
          opened[ws.data]?.resolve();
        },
        message() {},
      },
      fetch(req, server) {
        if (server.upgrade(req, { data: new URL(req.url).pathname.slice(1) })) return;
        return new Response("no upgrade", { status: 400 });
      },
    });

    // Healthy subscriber: a real WebSocket client that reads everything.
    let received = 0;
    const allReceived = Promise.withResolvers<void>();
    let expectedTotal = Infinity;
    const healthy = new WebSocket(`ws://127.0.0.1:${server.port}/healthy`);
    healthy.binaryType = "arraybuffer";
    healthy.onmessage = () => {
      received++;
      if (received >= expectedTotal) allReceived.resolve();
    };
    {
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      healthy.onopen = () => resolve();
      healthy.onerror = e => reject(e);
      healthy.onclose = () => reject(new Error("healthy closed before open"));
      await promise;
    }
    healthy.onerror = e => allReceived.reject(e);
    healthy.onclose = () => allReceived.reject(new Error(`healthy closed after ${received}/${expectedTotal}`));

    const slow = await connectStalledSubscriber(server.port);
    try {
      await opened.slow.promise;
      await opened.healthy.promise;

      // 20KB takes the direct (>=16KB) path; yielding to the event loop
      // between publishes lets the in-process healthy client read so only the
      // stalled subscriber is ever over the limit.
      const tick = () => new Promise<void>(r => setImmediate(r));
      const payload = new Uint8Array(20000);
      const results: number[] = [];
      let zeros = 0;
      for (let i = 0; i < 400 && zeros < 20; i++) {
        const rc = server.publish("t", payload);
        results.push(rc);
        if (rc === 0) zeros++;
        await tick();
      }
      expectedTotal = results.length;
      if (received >= expectedTotal) allReceived.resolve();
      await allReceived.promise;

      const h = histogram(results);
      expect({
        histogram: h,
        healthyReceived: received,
        // Every publish() landed on the healthy subscriber, including the ones
        // that returned 0 because the stalled subscriber was over its limit.
        healthyMissedAnyDropped: received < results.length,
      }).toEqual({
        histogram: { ...h, other: 0 },
        healthyReceived: results.length,
        healthyMissedAnyDropped: false,
      });
      expect(h.dropped).toBeGreaterThan(0);
    } finally {
      healthy.onclose = null;
      healthy.close();
      slow.destroy();
    }
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
