import type { Server, Subprocess, WebSocketHandler } from "bun";
import { serve, spawn } from "bun";
import { afterEach, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, forceGuardMalloc } from "harness";
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
