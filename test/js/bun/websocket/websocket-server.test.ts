import type { Server, Subprocess, WebSocketHandler } from "bun";
import { serve, spawn } from "bun";
import { afterEach, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, forceGuardMalloc, tempDir } from "harness";
import { isIP } from "node:net";
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

it("should work fine if you repeatedly call methods on closed websockets", async () => {
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
it("websocket/4443", async () => {
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

  it("subscriptions - basic usage", async () => {
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

  it("subscriptions - all unsubscribed", async () => {
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

  it("subscriptions - after close", async () => {
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

  it("subscriptions - duplicate subscriptions", async () => {
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

  it("subscriptions - multiple cycles", async () => {
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
  it(
    label,
    async testDone => {
      let isDone = false;
      const done = (err?: unknown) => {
        if (!isDone) {
          isDone = true;
          server.stop();
          testDone(err);
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
          ...fn(done, () => connect(server), options as any),
        },
      });
      options.server = server;
      expect(server.subscriberCount("empty topic")).toBe(0);
      await connect(server);
    },
    { timeout: timeout ?? 1000 },
  );
}

async function connect(server: Server): Promise<void> {
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
  clients.push(client);
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

// Regression test for #23474
it("request.cookies.set() should set websocket upgrade response cookie", async () => {
  using server = Bun.serve({
    port: 0,
    routes: {
      "/ws": req => {
        // Set a cookie before upgrading
        req.cookies.set("test", "123", {
          httpOnly: true,
          path: "/",
        });

        const upgraded = server.upgrade(req);
        if (upgraded) {
          return undefined;
        }
        return new Response("Upgrade failed", { status: 500 });
      },
    },
    websocket: {
      message(ws, message) {
        ws.close();
      },
    },
  });

  const { promise, resolve, reject } = Promise.withResolvers();

  // Use Bun.connect to send a WebSocket upgrade request and check response headers
  const socket = await Bun.connect({
    hostname: "localhost",
    port: server.port,
    socket: {
      data(socket, data) {
        try {
          const response = new TextDecoder().decode(data);

          // Check that we got a successful upgrade response
          expect(response).toContain("HTTP/1.1 101");
          expect(response).toContain("Upgrade: websocket");

          // The critical check: Set-Cookie header should be present
          expect(response).toContain("Set-Cookie:");
          expect(response).toContain("test=123");

          socket.end();
          resolve();
        } catch (err) {
          reject(err);
        }
      },
      error(socket, error) {
        reject(error);
      },
    },
  });

  // Send a valid WebSocket upgrade request
  socket.write(
    "GET /ws HTTP/1.1\r\n" +
      `Host: localhost:${server.port}\r\n` +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
      "Sec-WebSocket-Version: 13\r\n" +
      "\r\n",
  );

  await promise;
});

// Regression test for #23474
it("request.cookies.set() should work with custom headers in upgrade", async () => {
  using server = Bun.serve({
    port: 0,
    routes: {
      "/ws": req => {
        // Set cookies before upgrading
        req.cookies.set("session", "abc123", { path: "/" });
        req.cookies.set("user", "john", { httpOnly: true });

        const upgraded = server.upgrade(req, {
          headers: {
            "X-Custom-Header": "test",
          },
        });
        if (upgraded) {
          return undefined;
        }
        return new Response("Upgrade failed", { status: 500 });
      },
    },
    websocket: {
      message(ws, message) {
        ws.close();
      },
    },
  });

  const { promise, resolve, reject } = Promise.withResolvers();

  const socket = await Bun.connect({
    hostname: "localhost",
    port: server.port,
    socket: {
      data(socket, data) {
        try {
          const response = new TextDecoder().decode(data);

          // Check that we got a successful upgrade response
          expect(response).toContain("HTTP/1.1 101");
          expect(response).toContain("Upgrade: websocket");

          // Check custom header
          expect(response).toContain("X-Custom-Header: test");

          // Check that both cookies are present
          expect(response).toContain("Set-Cookie:");
          expect(response).toContain("session=abc123");
          expect(response).toContain("user=john");

          socket.end();
          resolve();
        } catch (err) {
          reject(err);
        }
      },
      error(socket, error) {
        reject(error);
      },
    },
  });

  socket.write(
    "GET /ws HTTP/1.1\r\n" +
      `Host: localhost:${server.port}\r\n` +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
      "Sec-WebSocket-Version: 13\r\n" +
      "\r\n",
  );

  await promise;
});

// Regression test for #24593
// Generate a realistic ~109KB JSON message similar to the original reproduction
function generateLargeMessage(): string {
  const items = [];
  for (let i = 0; i < 50; i++) {
    items.push({
      id: 6000 + i,
      pickListId: 444,
      externalRef: null,
      sku: `405053843${String(i).padStart(4, "0")}`,
      sequence: i + 1,
      requestedQuantity: 1,
      pickedQuantity: 0,
      dischargedQuantity: 0,
      state: "allocated",
      allocatedAt: new Date().toISOString(),
      startedAt: null,
      cancelledAt: null,
      pickedAt: null,
      placedAt: null,
      dischargedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      allocations: Array.from({ length: 20 }, (_, j) => ({
        id: 9000 + i * 20 + j,
        pickListItemId: 6000 + i,
        productId: 36000 + j,
        state: "reserved",
        reservedAt: new Date().toISOString(),
        startedAt: null,
        pickedAt: null,
        placedAt: null,
        cancelledAt: null,
        quantity: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        location: {
          id: 1000 + j,
          name: `Location-${j}`,
          zone: `Zone-${Math.floor(j / 5)}`,
          aisle: `Aisle-${j % 10}`,
          shelf: `Shelf-${j % 20}`,
          position: j,
        },
        product: {
          id: 36000 + j,
          sku: `SKU-${String(j).padStart(6, "0")}`,
          name: `Product Name ${j} with some additional description text`,
          category: `Category-${j % 5}`,
          weight: 1.5 + j * 0.1,
          dimensions: { width: 10, height: 20, depth: 30 },
        },
      })),
    });
  }
  return JSON.stringify({
    id: 444,
    externalRef: null,
    description: "Generated pick list",
    stockId: null,
    priority: 0,
    state: "allocated",
    picksInSequence: true,
    allocatedAt: new Date().toISOString(),
    startedAt: null,
    pausedAt: null,
    pickedAt: null,
    placedAt: null,
    cancelledAt: null,
    dischargedAt: null,
    collectedAt: null,
    totalRequestedQuantity: 50,
    totalPickedQuantity: 0,
    totalDischargedQuantity: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    items,
  });
}

// Regression test for #24593
describe("WebSocket server.publish with perMessageDeflate", () => {
  it("should handle large message publish without crash", async () => {
    // Create a ~109KB JSON message (similar to the reproduction)
    const largeMessage = generateLargeMessage();
    expect(largeMessage.length).toBeGreaterThan(100000);

    using server = serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }
        return new Response("WebSocket server");
      },
      websocket: {
        perMessageDeflate: true,
        open(ws) {
          ws.subscribe("test");
        },
        message() {},
        close() {},
      },
    });

    const client = new WebSocket(`ws://localhost:${server.port}`);

    const { promise: openPromise, resolve: resolveOpen, reject: rejectOpen } = Promise.withResolvers<void>();
    const { promise: messagePromise, resolve: resolveMessage, reject: rejectMessage } = Promise.withResolvers<string>();

    client.onopen = () => resolveOpen();
    client.onerror = e => {
      rejectOpen(e);
      rejectMessage(new Error("WebSocket error"));
    };
    client.onmessage = event => resolveMessage(event.data);

    await openPromise;

    // This is the critical test - server.publish() with a large compressed message
    // On Windows, this was causing a segfault in memcpy during the compression path
    const published = server.publish("test", largeMessage);
    expect(published).toBeGreaterThan(0); // Returns bytes sent, should be > 0

    const received = await messagePromise;
    expect(received.length).toBe(largeMessage.length);
    expect(received).toBe(largeMessage);

    client.close();
  });

  it("should handle multiple large message publishes", async () => {
    // Test multiple publishes in succession to catch potential buffer corruption
    const largeMessage = generateLargeMessage();

    let messagesReceived = 0;
    const expectedMessages = 5;

    using server = serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }
        return new Response("WebSocket server");
      },
      websocket: {
        perMessageDeflate: true,
        open(ws) {
          ws.subscribe("multi-test");
        },
        message() {},
        close() {},
      },
    });

    const client = new WebSocket(`ws://localhost:${server.port}`);

    const { promise: openPromise, resolve: resolveOpen, reject: rejectOpen } = Promise.withResolvers<void>();
    const {
      promise: allMessagesReceived,
      resolve: resolveMessages,
      reject: rejectMessages,
    } = Promise.withResolvers<void>();

    client.onopen = () => resolveOpen();
    client.onerror = e => {
      rejectOpen(e);
      rejectMessages(e instanceof Error ? e : new Error("WebSocket error"));
    };
    client.onmessage = event => {
      messagesReceived++;
      expect(event.data.length).toBe(largeMessage.length);
      if (messagesReceived === expectedMessages) {
        resolveMessages();
      }
    };

    await openPromise;

    // Publish multiple times in quick succession
    for (let i = 0; i < expectedMessages; i++) {
      const published = server.publish("multi-test", largeMessage);
      expect(published).toBeGreaterThan(0); // Returns bytes sent
    }

    await allMessagesReceived;
    expect(messagesReceived).toBe(expectedMessages);

    client.close();
  });

  it("should handle publish to multiple subscribers", async () => {
    // Test publishing to multiple clients - this exercises the publishBig loop
    const largeMessage = generateLargeMessage();

    const numClients = 3;
    const clientsReceived: boolean[] = new Array(numClients).fill(false);

    using server = serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }
        return new Response("WebSocket server");
      },
      websocket: {
        perMessageDeflate: true,
        open(ws) {
          ws.subscribe("broadcast");
        },
        message() {},
        close() {},
      },
    });

    const clients: WebSocket[] = [];
    try {
      const allClientsOpen = Promise.all(
        Array.from({ length: numClients }, (_, i) => {
          return new Promise<void>((resolve, reject) => {
            const client = new WebSocket(`ws://localhost:${server.port}`);
            clients.push(client);
            client.onopen = () => resolve();
            client.onerror = e => reject(e);
          });
        }),
      );

      await allClientsOpen;

      const allMessagesReceived = Promise.all(
        clients.map(
          (client, i) =>
            new Promise<void>(resolve => {
              client.onmessage = event => {
                expect(event.data.length).toBe(largeMessage.length);
                clientsReceived[i] = true;
                resolve();
              };
            }),
        ),
      );

      // Publish to all subscribers
      const published = server.publish("broadcast", largeMessage);
      expect(published).toBeGreaterThan(0); // Returns bytes sent

      await allMessagesReceived;
      expect(clientsReceived.every(r => r)).toBe(true);
    } finally {
      for (const c of clients) {
        try {
          c.close();
        } catch {}
      }
    }
  });

  // CORK_BUFFER_SIZE is 16KB - test messages right at this boundary
  // since messages >= CORK_BUFFER_SIZE use publishBig path
  const CORK_BUFFER_SIZE = 16 * 1024;

  it.each([
    { name: "just under 16KB", size: CORK_BUFFER_SIZE - 100 },
    { name: "exactly 16KB", size: CORK_BUFFER_SIZE },
    { name: "just over 16KB", size: CORK_BUFFER_SIZE + 100 },
  ])("should handle message at CORK_BUFFER_SIZE boundary: $name", async ({ size }) => {
    const message = Buffer.alloc(size, "D").toString();

    using server = serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }
        return new Response("WebSocket server");
      },
      websocket: {
        perMessageDeflate: true,
        open(ws) {
          ws.subscribe("boundary-test");
        },
        message() {},
        close() {},
      },
    });

    const client = new WebSocket(`ws://localhost:${server.port}`);

    const { promise: openPromise, resolve: resolveOpen, reject: rejectOpen } = Promise.withResolvers<void>();
    const { promise: messagePromise, resolve: resolveMessage, reject: rejectMessage } = Promise.withResolvers<string>();

    let openSettled = false;
    client.onopen = () => {
      openSettled = true;
      resolveOpen();
    };
    client.onerror = e => {
      if (!openSettled) {
        openSettled = true;
        rejectOpen(e);
      } else {
        rejectMessage(e);
      }
    };
    client.onmessage = event => resolveMessage(event.data);

    await openPromise;

    server.publish("boundary-test", message);

    const received = await messagePromise;
    expect(received.length).toBe(size);

    client.close();
  });
});

// Regression test for #3613
// WebSocketServer handleProtocols option should set the selected protocol in the upgrade response
it("ws WebSocketServer handleProtocols sets selected protocol", async () => {
  using dir = tempDir("ws-handle-protocols", {
    "server.js": `
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({
  port: 0,
  handleProtocols: (protocols, request) => {
    return 'selected-protocol';
  }
});

wss.on('listening', async () => {
  const port = wss.address().port;
  console.log('PORT:' + port);

  // Test using fetch to verify the actual response headers
  try {
    const res = await fetch('http://127.0.0.1:' + port, {
      headers: {
        "Upgrade": "websocket",
        "Connection": "Upgrade",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Protocol": "custom-protocol, selected-protocol"
      }
    });
    console.log("STATUS:" + res.status);
    console.log("PROTOCOL:" + res.headers.get("sec-websocket-protocol"));
  } catch (e) {
    console.log("ERROR:" + e.message);
  }

  wss.close();
  process.exit(0);
});

wss.on('connection', (ws) => {
  console.log('SERVER_WS_PROTOCOL:' + ws.protocol);
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The server should respond with the protocol selected by handleProtocols
  expect(stdout).toContain("STATUS:101");
  expect(stdout).toContain("PROTOCOL:selected-protocol");
  expect(stdout).toContain("SERVER_WS_PROTOCOL:selected-protocol");
  expect(exitCode).toBe(0);
}, 10000);

// Regression test for #3613
it("ws WebSocketServer handleProtocols with no protocol", async () => {
  using dir = tempDir("ws-handle-protocols-empty", {
    "server.js": `
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({
  port: 0,
  handleProtocols: (protocols, request) => {
    // Return empty string - should not set a protocol header
    return '';
  }
});

wss.on('listening', async () => {
  const port = wss.address().port;
  console.log('PORT:' + port);

  try {
    const res = await fetch('http://127.0.0.1:' + port, {
      headers: {
        "Upgrade": "websocket",
        "Connection": "Upgrade",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Protocol": "custom-protocol"
      }
    });
    console.log("STATUS:" + res.status);
    // When handleProtocols returns empty, Bun falls back to client's first protocol
    console.log("PROTOCOL:" + res.headers.get("sec-websocket-protocol"));
  } catch (e) {
    console.log("ERROR:" + e.message);
  }

  wss.close();
  process.exit(0);
});

wss.on('connection', (ws) => {
  console.log('SERVER_WS_PROTOCOL:' + JSON.stringify(ws.protocol));
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The server should respond with 101 status
  expect(stdout).toContain("STATUS:101");
  expect(exitCode).toBe(0);
}, 10000);

// Regression test for #3613
it("ws WebSocketServer without handleProtocols uses first client protocol", async () => {
  using dir = tempDir("ws-no-handle-protocols", {
    "server.js": `
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({
  port: 0,
  // No handleProtocols - should default to first client protocol
});

wss.on('listening', async () => {
  const port = wss.address().port;
  console.log('PORT:' + port);

  try {
    const res = await fetch('http://127.0.0.1:' + port, {
      headers: {
        "Upgrade": "websocket",
        "Connection": "Upgrade",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Protocol": "first-protocol, second-protocol"
      }
    });
    console.log("STATUS:" + res.status);
    console.log("PROTOCOL:" + res.headers.get("sec-websocket-protocol"));
  } catch (e) {
    console.log("ERROR:" + e.message);
  }

  wss.close();
  process.exit(0);
});

wss.on('connection', (ws) => {
  console.log('SERVER_WS_PROTOCOL:' + ws.protocol);
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Without handleProtocols, should default to first client protocol
  expect(stdout).toContain("STATUS:101");
  expect(stdout).toContain("PROTOCOL:first-protocol");
  expect(stdout).toContain("SERVER_WS_PROTOCOL:first-protocol");
  expect(exitCode).toBe(0);
}, 10000);
