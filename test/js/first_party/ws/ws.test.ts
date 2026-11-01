import type { Subprocess } from "bun";
import { spawn } from "bun";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import crypto from "crypto";
import { EventEmitter, once } from "events";
import { bunEnv, bunExe, tls as serverIdentity, tempDir } from "harness";
import { createServer, request } from "http";
import https from "https";
import { HttpsProxyAgent } from "https-proxy-agent";
import net, { AddressInfo, connect } from "net";
import fs from "node:fs";
import path from "node:path";
import tls, { type TLSSocket } from "tls";
import { type ClientOptions, WebSocket, WebSocketServer } from "ws";

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

// `type` is the class a binary message arrives as. Ping and pong payloads are always Buffers.
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
    label: "blob",
    type: Blob,
  },
] as const;

// Names match `type.name` above. A plain Uint8Array shows up as "[object Uint8Array]".
function shapeOf(data: unknown): string {
  if (Buffer.isBuffer(data)) return "Buffer";
  if (data instanceof ArrayBuffer) return "ArrayBuffer";
  if (data instanceof Blob) return "Blob";
  return Object.prototype.toString.call(data);
}

let servers: Subprocess[] = [];
let clients: WebSocket[] = [];

function cleanUp() {
  for (const client of clients.splice(0)) {
    // terminate() while CONNECTING emits 'error'.
    client.on("error", () => {});
    client.terminate();
  }
  for (const server of servers.splice(0)) {
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
      // @ts-expect-error
      ws.binaryType = "invalid";
      expect(ws.binaryType).toBe("nodebuffer");
      done();
    });
    for (const { label, type } of binaryTypes) {
      test(label, (ws, done) => {
        // @types/ws 8.5 does not list "blob", ws 8.18 accepts it
        ws.binaryType = label as WebSocket["binaryType"];
        const seen: Record<string, string> = {};
        // The echo server answers the message, pings back when pinged and pongs back when
        // ponged. It also auto-pongs the client's ping, so only the first pong is recorded.
        function record(event: string, data: unknown) {
          seen[event] ??= shapeOf(data);
          if (!(seen.message && seen.ping && seen.pong)) return;
          try {
            expect(seen).toEqual({
              binaryType: label,
              message: type.name,
              ping: "Buffer",
              pong: "Buffer",
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
        // The echo server receives every message as a Buffer and sends that back, so the echo is always binary.
        ws.on("message", (data, isBinary) => {
          expect(data).toEqual(Buffer.from(bytes));
          expect(isBinary).toBeTrue();
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
        expect(data).toEqual(Buffer.alloc(0));
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
        expect(data).toEqual(Buffer.alloc(0));
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
      ws.on("close", (...args) => {
        expect(args).toEqual([1005, Buffer.alloc(0)]);
        done();
      });
    });
    test("(no reason)", (ws, done) => {
      ws.on("open", () => {
        ws.close(1001);
      });
      ws.on("close", (...args) => {
        expect(args).toEqual([1001, Buffer.alloc(0)]);
        done();
      });
    });
    for (const { label, message, bytes } of strings) {
      test(label, (ws, done) => {
        ws.on("open", () => {
          ws.close(1002, message);
        });
        ws.on("close", (...args) => {
          expect(args).toEqual([1002, Buffer.from(bytes)]);
          done();
        });
      });
    }
  });
  test("terminate()", (ws, done) => {
    ws.on("open", () => {
      ws.terminate();
    });
    ws.on("close", (...args) => {
      expect(args).toEqual([1006, Buffer.alloc(0)]);
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

    new WebSocket("ws://localhost:" + (wss.address() as AddressInfo).port);
    await promise;
  });

  it("sockets can be terminated", async () => {
    const wss = new WebSocketServer({ port: 0 });
    const { resolve, reject, promise } = Promise.withResolvers();

    wss.on("connection", ws => {
      ws.on("close", () => {
        wss.close();
        resolve();
      });
      try {
        ws.terminate();
      } catch (err) {
        reject(err);
      }
    });

    new WebSocket("ws://localhost:" + (wss.address() as AddressInfo).port);
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
      "$label: binary frames arrive as $type.name, ping and pong payloads as Buffer",
      async ({ label, type }) => {
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
          { event: "ping", shape: "Buffer", bytes: [4] },
          { event: "pong", shape: "Buffer", bytes: [5] },
          { event: "message", shape: type.name, bytes: [1, 2, 3], isBinary: true },
          { event: "message", shape: type.name, bytes: [], isBinary: true },
        ]);
      },
    );

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
        { event: "ping", shape: "Buffer", bytes: [2] },
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

  const ws = new WebSocket("ws://localhost:" + (wss.address() as AddressInfo).port);
  ws.on("open", function open() {
    ws.send("hello");
    ws.send(Buffer.from([1, 2, 3]));
  });

  await promise;
});

it("onmessage", done => {
  const wss = new WebSocketServer({ port: 0 });
  wss.on("connection", ws => {
    ws.onmessage = e => {
      expect(e.data).toBe("hello");
      done();
      wss.close();
    };
  });

  const ws = new WebSocket("ws://localhost:" + (wss.address() as AddressInfo).port);
  clients.push(ws);
  ws.onopen = () => {
    ws.send("hello");
  };
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
      ws.onclose = () => resolve();
      return promise;
    },
  ];
  const wss = new WebSocketServer({ port: 0 });
  const received: unknown[] = [];
  wss.on("connection", ws => {
    ws.onmessage = e => {
      received.push(e.data);
      ws.close();
    };
  });
  await Promise.all(
    via.map(async version => {
      const ws = new WebSocket("ws://localhost:" + (wss.address() as AddressInfo).port);
      ws.onopen = () => {
        ws.send("hello");
      };
      return version(ws);
    }),
  );
  expect(received).toEqual(["hello", "hello", "hello", "hello"]);

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
      return server.upgrade(req) as any;
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
  } as ClientOptions);

  ws.once("open", () => {
    ws.send("Hello");
    ws.close();
    resolve();
  });

  await promise;
});

function test(label: string, fn: (ws: WebSocket, done: (err?: unknown) => void) => void) {
  it(label, testDone => {
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
  });
}

async function listen(): Promise<URL> {
  const pathname = path.resolve(import.meta.dir, "../../web/websocket/websocket-server-echo.mjs");
  const { promise, resolve, reject } = Promise.withResolvers<URL>();
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

    function commit(err?: Error | null) {
      if (err) {
        reject(err);
        return;
      }

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
    const ws = new WebSocket("ws://localhost:" + (wss.address() as AddressInfo).port);
    ws.onmessage = event => {
      received += (event.data as Buffer).byteLength;
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
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  const connections: unknown[] = [];
  wss.on("connection", ws => connections.push(ws));

  try {
    await once(wss, "listening");
    const socket = connect((wss.address() as AddressInfo).port, "127.0.0.1");
    socket.on("error", () => {});
    let response = "";
    socket.on("data", chunk => (response += chunk.toString("latin1")));
    const closed = new Promise<void>(resolve => socket.once("close", resolve));
    socket.write(
      [
        "GET / HTTP/1.1",
        "Host: localhost",
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Sec-WebSocket-Key: invalid-key",
        "Sec-WebSocket-Version: 13",
        "",
        "",
      ].join("\r\n"),
    );
    await closed;

    expect(response).toBe(
      [
        "HTTP/1.1 400 Bad Request",
        "Connection: close",
        "Content-Type: text/html",
        "Content-Length: 43",
        "",
        "Missing or invalid Sec-WebSocket-Key header",
      ].join("\r\n"),
    );
    expect(connections).toEqual([]);
  } finally {
    wss.close();
  }
});

it("Server should be able to send empty pings", async () => {
  // WebSocket frame creation function with masking
  function createWebSocketFrame(message: string) {
    const messageBuffer = Buffer.from(message);
    const frame: number[] = [];

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
          // @ts-expect-error falls through
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

describe("handleUpgrade without an Upgrade header", () => {
  it("responds with 400 Invalid Upgrade header instead of throwing", async () => {
    const wss = new WebSocketServer({ noServer: true });
    let called = false;
    // Without an Upgrade header node:http emits 'request', not 'upgrade'.
    const server = createServer(req =>
      wss.handleUpgrade(req, req.socket, Buffer.alloc(0), () => {
        called = true;
      }),
    );
    await once(server.listen(0, "127.0.0.1"), "listening");
    try {
      const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`, {
        headers: { "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version": "13" },
      });
      expect({
        status: response.status,
        connection: response.headers.get("connection"),
        contentType: response.headers.get("content-type"),
        body: await response.text(),
      }).toEqual({ status: 400, connection: "close", contentType: "text/html", body: "Invalid Upgrade header" });
      expect(called).toBe(false);
    } finally {
      server.closeAllConnections();
      server.close();
    }
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
    expect(await closed.promise).toBe(1000);
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

  // Bun-only: npm ws writes /other's 400 to the connection that /chat already upgraded.
  it("leaves a connection alone that another WebSocketServer on the same http.Server took", async () => {
    const server = createServer();
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

    it("are delivered when handleUpgrade() runs in a later task", async () => {
      const wss = new WebSocketServer({ noServer: true });
      const messages = messagesOf(wss);

      await using upgrade = await receiveUpgrade(requestAndEarlyFrame());
      await new Promise(resolve => setImmediate(resolve));
      wss.handleUpgrade(upgrade.req, upgrade.socket, upgrade.head, ws => wss.emit("connection", ws, upgrade.req));

      expect(await sendLater(upgrade, messages)).toEqual(["early", "later"]);
    });

    it("are delivered when verifyClient answers in a later task", async () => {
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

    it("are delivered when they arrive in a separate read before handleUpgrade()", async () => {
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
  // Bun-only: npm ws requires "http" at the top of lib/websocket.js.
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

// npm `ws` gives every option of the constructor to https.request(), so TLS options are top-level options or options
// of the agent. The verdicts are those of Node.js v26.3.0 with ws 8.18.3, but where a comment says what Node does.
describe("client TLS options", () => {
  const read = (name: string) => fs.readFileSync(path.join(import.meta.dirname, "../../node/test/fixtures/keys", name));
  // The server's certificate is self-signed for localhost. ca1 signs agent1, the client, and nothing else here.
  const ca = serverIdentity.cert;
  const ca1 = read("ca1-cert.pem");
  // agent1's key and certificate, with ca1.
  const pfx = read("agent1.pfx");

  /** Tells each client whether it presented a certificate that ca1 signed. */
  async function serve(options?: https.ServerOptions) {
    const server = https.createServer({ ...serverIdentity, ca: ca1, requestCert: true, rejectUnauthorized: false, ...options }); // prettier-ignore
    server.on("tlsClientError", () => {});
    const wss = new WebSocketServer({ server });
    wss.on("connection", (ws, req) => ws.send(`authorized=${(req.socket as TLSSocket).authorized}`));
    await once(server.listen(0, "127.0.0.1"), "listening");
    return {
      url: `wss://localhost:${(server.address() as AddressInfo).port}`,
      [Symbol.dispose]() {
        for (const client of wss.clients) client.terminate();
        server.close();
      },
    };
  }

  /** Tells each client the protocol version and the cipher of its connection. */
  async function serveNegotiated(options?: tls.TlsOptions) {
    const server = tls.createServer({ ...serverIdentity, ...options }, socket => {
      let head = "";
      socket.on("error", () => {});
      socket.on("data", chunk => {
        head += chunk.toString("latin1");
        if (!head.includes("\r\n\r\n")) return;
        const key = /sec-websocket-key: (.*)\r\n/i.exec(head)![1];
        const accept = crypto.createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
        const message = `${socket.getProtocol()} ${socket.getCipher().name}`;
        socket.write(
          `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
        );
        socket.write(Buffer.concat([Buffer.from([0x81, message.length]), Buffer.from(message)]));
      });
    });
    server.on("tlsClientError", () => {});
    await once(server.listen(0, "127.0.0.1"), "listening");
    return {
      url: `wss://localhost:${(server.address() as AddressInfo).port}`,
      [Symbol.dispose]() {
        server.close();
      },
    };
  }

  /** The server's message, or "refused". */
  function dial(url: string, options: object) {
    const { promise, resolve } = Promise.withResolvers<string>();
    const ws = new WebSocket(url, options);
    ws.on("message", data => {
      resolve(String(data));
      ws.terminate();
    });
    ws.on("error", () => resolve("refused"));
    return promise;
  }

  const anonymous = "authorized=false";
  const identified = "authorized=true";

  describe.concurrent("ws TLS options", () => {
    it("top-level ca and rejectUnauthorized", async () => {
      using server = await serve();
      expect({
        none: await dial(server.url, {}),
        ca: await dial(server.url, { ca }),
        otherCa: await dial(server.url, { ca: ca1 }),
        emptyCa: await dial(server.url, { ca: "" }),
        unverified: await dial(server.url, { rejectUnauthorized: false, ALPNProtocols: ["http/1.1"] }),
      }).toEqual({
        none: "refused",
        ca: anonymous,
        otherCa: "refused",
        emptyCa: "refused",
        unverified: anonymous,
      });
    });

    // npm ws fails this test when run on Bun, because Bun's tls.connect() throws for `dhparam: "auto"`.
    it("ignores server-only TLS options", async () => {
      using server = await serve();
      expect(await dial(server.url, { agent: new https.Agent({ ca, dhparam: "auto" }) })).toBe(anonymous);
    });

    it("only an own rejectUnauthorized: false disables verification", async () => {
      using server = await serve();
      expect(await dial(server.url, { rejectUnauthorized: false })).toBe(anonymous);
      for (const rejectUnauthorized of [0, null, "false", "", undefined, true]) {
        expect(await dial(server.url, { rejectUnauthorized })).toBe("refused");
        expect(await dial(server.url, { agent: new https.Agent({ rejectUnauthorized } as any) })).toBe("refused");
      }
      expect(await dial(server.url, Object.create({ rejectUnauthorized: false }))).toBe("refused");
    });

    // Bun is stricter than npm ws here. Node's Agent reads its inherited `options`, so npm ws connects.
    it("an agent's inherited options don't disable verification", async () => {
      using server = await serve();
      const inherited = Object.create(new https.Agent({ rejectUnauthorized: false }));
      expect(await dial(server.url, { agent: inherited })).toBe("refused");
    });

    it("the options of the agent win over the top-level options", async () => {
      using server = await serve();
      const agent = (options: object) => new https.Agent(options);
      expect({
        agentOff: await dial(server.url, { agent: agent({ rejectUnauthorized: false }), rejectUnauthorized: true }),
        agentOn: await dial(server.url, { agent: agent({ rejectUnauthorized: true }), rejectUnauthorized: false }),
        agentUndefined: await dial(server.url, { agent: agent({ rejectUnauthorized: undefined }), rejectUnauthorized: false }), // prettier-ignore
        agentSilent: await dial(server.url, { agent: agent({}), rejectUnauthorized: false }),
        agentCa: await dial(server.url, { agent: agent({ ca }), ca: ca1 }),
        agentOtherCa: await dial(server.url, { agent: agent({ ca: ca1 }), ca }),
        merged: await dial(server.url, { agent: agent({ ca }), cert: read("agent1-cert.pem"), key: read("agent1-key.pem") }), // prettier-ignore
      }).toEqual({
        agentOff: anonymous,
        agentOn: "refused",
        agentUndefined: "refused",
        agentSilent: anonymous,
        agentCa: anonymous,
        agentOtherCa: "refused",
        merged: identified,
      });
    });

    it("the client identity, in every form", async () => {
      using server = await serve();
      const cert = read("agent1-cert.pem");
      const key = read("agent1-key.pem");
      expect({
        pem: await dial(server.url, { ca, cert, key }),
        pemObject: await dial(server.url, { ca, cert, key: [{ pem: key }] }),
        pfx: await dial(server.url, { ca, pfx, passphrase: "sample" }),
        pfxObject: await dial(server.url, { ca, pfx: [{ buf: pfx, passphrase: "sample" }] }),
        agentPfx: await dial(server.url, { agent: new https.Agent({ ca, pfx, passphrase: "sample" }) }),
      }).toEqual({
        pem: identified,
        pemObject: identified,
        pfx: identified,
        pfxObject: identified,
        agentPfx: identified,
      });
    });

    it("minVersion and maxVersion", async () => {
      using tls12 = await serve({ maxVersion: "TLSv1.2" });
      using tls13 = await serve({ minVersion: "TLSv1.3" });
      expect({
        min13to12: await dial(tls12.url, { ca, minVersion: "TLSv1.3" }),
        max12to12: await dial(tls12.url, { ca, maxVersion: "TLSv1.2" }),
        max12to13: await dial(tls13.url, { ca, maxVersion: "TLSv1.2" }),
        min13to13: await dial(tls13.url, { ca, minVersion: "TLSv1.3" }),
      }).toEqual({ min13to12: "refused", max12to12: anonymous, max12to13: "refused", min13to13: anonymous });
    });

    it("ciphers", async () => {
      using server = await serveNegotiated();
      using tls12 = await serveNegotiated({ maxVersion: "TLSv1.2" });
      const aes256 = "ECDHE-RSA-AES256-GCM-SHA384";
      const version = (negotiated: string) => negotiated.split(" ")[0];
      expect({
        // BoringSSL has no list of TLS 1.3 suites to restrict, so only Node negotiates the one that is named.
        only13: version(await dial(server.url, { ca, ciphers: "TLS_AES_256_GCM_SHA384" })),
        only13Agent: version(
          await dial(server.url, { agent: new https.Agent({ ca, ciphers: "TLS_AES_256_GCM_SHA384" }) }),
        ),
        only13To12: await dial(tls12.url, { ca, ciphers: "TLS_AES_256_GCM_SHA384" }),
        only13Max12: await dial(server.url, { ca, ciphers: "TLS_AES_256_GCM_SHA384", maxVersion: "TLSv1.2" }),
        mixed: version(await dial(server.url, { ca, ciphers: `TLS_AES_256_GCM_SHA384:${aes256}` })),
        mixedTo12: await dial(tls12.url, { ca, ciphers: `TLS_AES_256_GCM_SHA384:${aes256}` }),
        only12: version(await dial(server.url, { ca, ciphers: aes256 })),
        only12To12: await dial(tls12.url, { ca, ciphers: aes256 }),
      }).toEqual({
        only13: "TLSv1.3",
        only13Agent: "TLSv1.3",
        only13To12: "refused",
        only13Max12: "refused",
        mixed: "TLSv1.3",
        mixedTo12: `TLSv1.2 ${aes256}`,
        only12: "TLSv1.3",
        only12To12: `TLSv1.2 ${aes256}`,
      });
    });

    // npm ws fails this test when run on Bun, because BoringSSL has no @SECLEVEL and Bun's tls.connect() throws.
    it("accepts ciphers with OpenSSL's @SECLEVEL", async () => {
      using server = await serveNegotiated();
      using tls12 = await serveNegotiated({ maxVersion: "TLSv1.2" });
      const aes256 = "ECDHE-RSA-AES256-GCM-SHA384";
      const version = (negotiated: string) => negotiated.split(" ")[0];
      expect({
        secLevel: version(await dial(server.url, { ca, ciphers: "DEFAULT@SECLEVEL=0" })),
        secLevelAgent: version(await dial(server.url, { agent: new https.Agent({ ca, ciphers: "DEFAULT:@SECLEVEL=1" }) })), // prettier-ignore
        secLevelTo12: await dial(tls12.url, { ca, ciphers: `${aes256}:@SECLEVEL=0` }),
      }).toEqual({
        secLevel: "TLSv1.3",
        secLevelAgent: "TLSv1.3",
        secLevelTo12: `TLSv1.2 ${aes256}`,
      });
    });

    it("secureProtocol", async () => {
      using server = await serveNegotiated();
      const version = (negotiated: string) => negotiated.split(" ")[0];
      expect({
        tls12: version(await dial(server.url, { ca, secureProtocol: "TLSv1_2_method" })),
        tls12Agent: version(await dial(server.url, { agent: new https.Agent({ ca, secureProtocol: "TLSv1_2_client_method" }) })), // prettier-ignore
        tls11: await dial(server.url, { ca, secureProtocol: "TLSv1_1_method" }),
        any: version(await dial(server.url, { ca, secureProtocol: "TLS_method" })),
      }).toEqual({ tls12: "TLSv1.2", tls12Agent: "TLSv1.2", tls11: "refused", any: "TLSv1.3" });
      // There is no such method.
      expect(() => new WebSocket(server.url, { agent: new https.Agent({ secureProtocol: "TLSv1_3_method" }) })).toThrow(
        expect.objectContaining({ code: "ERR_TLS_INVALID_PROTOCOL_METHOD" }),
      );
      expect(
        () =>
          new WebSocket(server.url, {
            agent: new https.Agent({ secureProtocol: "TLSv1_2_method", minVersion: "TLSv1.3" }),
          }),
      ).toThrow(
        // prettier-ignore
        expect.objectContaining({ code: "ERR_TLS_PROTOCOL_VERSION_CONFLICT" }),
      );
    });

    it("an option that tls.connect() rejects throws", () => {
      const url = "wss://localhost:1";
      // BoringSSL and OpenSSL word it differently.
      expect(() => new WebSocket(url, { agent: new https.Agent({ pfx, passphrase: "wrong" }) })).toThrow(/mac verif/i);
      expect(() => new WebSocket(url, { agent: new https.Agent({ minVersion: "TLSv9" as any }) })).toThrow(
        expect.objectContaining({ code: "ERR_TLS_INVALID_PROTOCOL_VERSION" }),
      );
    });

    it("top-level options reach the target through an HttpsProxyAgent", async () => {
      using server = await serve();
      const connects: string[] = [];
      const proxy = net.createServer(client => {
        client.on("error", () => {});
        client.once("data", head => {
          const target = head.toString("latin1").split(" ")[1];
          connects.push(target);
          const upstream = net.connect(Number(target.split(":")[1]), "127.0.0.1", () => {
            client.write("HTTP/1.1 200 Connection established\r\n\r\n");
            client.pipe(upstream).pipe(client);
          });
          upstream.on("error", () => client.destroy());
        });
      });
      await once(proxy.listen(0, "127.0.0.1"), "listening");
      try {
        const agent = new HttpsProxyAgent(`http://127.0.0.1:${(proxy.address() as AddressInfo).port}`);
        expect(await dial(server.url, { agent, ca, pfx, passphrase: "sample" })).toBe(identified);
        expect(connects).toEqual([server.url.slice("wss://".length)]);
      } finally {
        proxy.close();
      }
    });

    // Bun-only: npm ws has no `tls` option.
    it("an explicit tls option replaces the agent's and the top-level options", async () => {
      using server = await serve();
      const off = { rejectUnauthorized: false };
      expect(await dial(server.url, { ...off })).toBe(anonymous);
      expect(await dial(server.url, { tls: { ca, pfx, passphrase: "sample" } })).toBe(identified);
      expect(await dial(server.url, { ...off, agent: new https.Agent(off), tls: { ca: ca1 } })).toBe("refused");
      expect(await dial(server.url, { ca: ca1, agent: new https.Agent({ ca: ca1 }), tls: { ca } })).toBe(anonymous);
    });
  });

  describe.concurrent("ws with a pfx that bundles a CA", () => {
    // agent1's key and certificate, with the server's certificate as the CA. From the repository root:
    //   bun -e 'await Bun.write("/tmp/server.pem", (await import("./test/harness.ts")).tls.cert)'
    //   openssl pkcs12 -export -passout pass:sample -certfile /tmp/server.pem \
    //     -inkey test/js/node/test/fixtures/keys/agent1-key.pem -in test/js/node/test/fixtures/keys/agent1-cert.pem \
    //     -out test/js/first_party/ws/fixtures/agent1-with-server-ca.pfx
    const pfxWithServerCa = fs.readFileSync(path.join(import.meta.dirname, "fixtures/agent1-with-server-ca.pfx"));

    it("adds the CA to the ca option", async () => {
      using server = await serve();
      expect(await dial(server.url, { ca: ca1, pfx: pfxWithServerCa, passphrase: "sample" })).toBe(identified);
      expect(await dial(server.url, { ca: [ca1], pfx: [{ buf: pfxWithServerCa, passphrase: "sample" }] })).toBe(identified); // prettier-ignore
    });

    it("adds the CA to a `ca` that the `tls` option inherits from a frozen object", async () => {
      using server = await serve();
      const tls = Object.assign(Object.create(Object.freeze({ ca: ca1 })), {
        pfx: pfxWithServerCa,
        passphrase: "sample",
      });
      expect(await dial(server.url, { tls })).toBe(identified);
    });

    // Differs from npm ws: Node also adds the CA to the default store. The native `ca` can only replace that store.
    it("doesn't add the CA to the default store", async () => {
      using server = await serve();
      expect(await dial(server.url, { pfx: pfxWithServerCa, passphrase: "sample" })).toBe("refused");
    });

    it("sends the intermediates of the archive with the client certificate", async () => {
      // agent10 <- ca4 <- ca2. The archive has ca4, and the server knows ca2 alone.
      using server = await serve({ ca: read("ca2-cert.pem") });
      const identity = { pfx: read("agent10.pfx"), passphrase: "sample", rejectUnauthorized: false };
      expect({
        topLevel: await dial(server.url, identity),
        agent: await dial(server.url, { agent: new https.Agent(identity) }),
        withCa: await dial(server.url, { ...identity, ca }),
      }).toEqual({ topLevel: identified, agent: identified, withCa: identified });
    });

    // `openssl x509 -subject_hash` of the server's certificate.
    const hashedName = "c62891c1.0";
    it.each([
      ["NODE_EXTRA_CA_CERTS", "server.pem"],
      ["SSL_CERT_FILE", "server.pem"],
      ["SSL_CERT_DIR", "hashed"],
    ])("keeps trusting %s", async (name, file) => {
      using server = await serve();
      using dir = tempDir("ws-pfx-default-store", { "server.pem": ca, [`hashed/${hashedName}`]: ca });
      await using child = spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          const WebSocket = require("ws");
          const ws = new WebSocket(process.env.TEST_URL, { pfx: require("fs").readFileSync(process.env.TEST_PFX), passphrase: "sample" });
          ws.on("message", data => { console.log(String(data)); ws.terminate(); });
          ws.on("error", err => console.log("refused", err.message));
          `,
        ],
        env: {
          ...bunEnv,
          TEST_URL: server.url,
          TEST_PFX: path.join(import.meta.dirname, "../../node/test/fixtures/keys/agent1.pfx"),
          [name]: path.join(String(dir), file),
        },
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([child.stdout.text(), child.exited]);
      expect(stdout.trim()).toBe(identified);
      expect(exitCode).toBe(0);
    });
  });

  describe.concurrent("ws TLS options that name or pin the server", () => {
    // CN=agent1, no subjectAltName, signed by ca1.
    const agent1 = { key: read("agent1-key.pem"), cert: read("agent1-cert.pem") };

    it("servername", async () => {
      using server = await serve(agent1);
      expect({
        none: await dial(server.url, { ca: ca1 }),
        topLevel: await dial(server.url, { ca: ca1, servername: "agent1" }),
        agent: await dial(server.url, { agent: new https.Agent({ ca: ca1, servername: "agent1" }) }),
        agentWins: await dial(server.url, { agent: new https.Agent({ servername: "agent1" }), ca: ca1, servername: "other" }), // prettier-ignore
        agentWinsWrong: await dial(server.url, { agent: new https.Agent({ servername: "other" }), ca: ca1, servername: "agent1" }), // prettier-ignore
      }).toEqual({
        none: "refused",
        topLevel: anonymous,
        agent: anonymous,
        agentWins: anonymous,
        agentWinsWrong: "refused",
      });
    });

    it("checkServerIdentity", async () => {
      using server = await serve(agent1);
      const seen: unknown[] = [];
      function accept(hostname: string, cert: { subject: { CN: string } }) {
        seen.push(hostname, cert.subject.CN);
        return undefined;
      }
      const refuse = () => new Error("not the pinned certificate");
      expect(await dial(server.url, { ca: ca1, checkServerIdentity: accept })).toBe(anonymous);
      expect(seen).toEqual(["localhost", "agent1"]);
      expect(await dial(server.url, { ca: ca1, servername: "agent1", checkServerIdentity: refuse })).toBe("refused");
      expect(await dial(server.url, { agent: new https.Agent({ ca: ca1, checkServerIdentity: accept as any }) })).toBe(anonymous); // prettier-ignore
      // It does not replace the verification of the chain.
      expect(await dial(server.url, { checkServerIdentity: accept })).toBe("refused");
    });

    // Options like `finishRequest`, `family` and `lookup` make the client connect through http.request(), which has no
    // `tls` option of its own.
    it("the `tls` option applies whether the client connects natively or through node:http", async () => {
      using server = await serve(agent1);
      const refuse = () => new Error("not the pinned certificate");
      const connectPaths: Record<string, object> = {
        native: {},
        finishRequest: { finishRequest: (req: { end(): void }) => req.end() },
        family: { family: 4 },
        // The agent's options override the request's options, but not `tls`.
        agent: { agent: new https.Agent({ rejectUnauthorized: false }) },
        agentAndFamily: { agent: new https.Agent({ rejectUnauthorized: false, servername: "other" }), family: 4 },
        lookup: { lookup: (_host: string, _options: object, done: Function) => done(null, [{ address: "127.0.0.1", family: 4 }]) }, // prettier-ignore
      };
      const results = await Promise.all(
        Object.entries(connectPaths).map(async ([name, pathOptions]) => {
          // `tls` replaces the top-level options, which would otherwise skip verification.
          const options = { ...pathOptions, rejectUnauthorized: false };
          const outcomes = await Promise.all([
            // `serverName` is Bun's spelling and takes precedence over `servername`.
            dial(server.url, { ...options, tls: { ca: ca1, serverName: "agent1", servername: "other" } }),
            dial(server.url, { ...options, tls: { ca: ca1, serverName: "agent1", checkServerIdentity: refuse } }),
            dial(server.url, { ...options, tls: { ca: ca1 } }),
            dial(server.url, { ...options, tls: {} }),
          ]);
          return [name, outcomes] as [string, string[]];
        }),
      );
      const expected = [anonymous, "refused", "refused", "refused"];
      expect(results).toEqual(Object.keys(connectPaths).map((name): [string, string[]] => [name, expected]));
    });

    // `ws` wraps the callback. The native client reads inherited properties and getters, so a spread would lose them.
    it("keeps the `tls` option's inherited properties and getters when it has a checkServerIdentity", async () => {
      using server = await serve(agent1);
      const checkServerIdentity = () => undefined;
      class Options {
        checkServerIdentity = checkServerIdentity;
        get ca() {
          return ca1;
        }
      }
      expect({
        inherited: await dial(server.url, { tls: Object.assign(Object.create({ ca: ca1 }), { checkServerIdentity }) }),
        getter: await dial(server.url, { tls: new Options() }),
      }).toEqual({ inherited: anonymous, getter: anonymous });
    });

    it("an own `pfx` in the `tls` option keeps the inherited options", async () => {
      using server = await serve(agent1);
      const connect = (inherited: object, own: object) =>
        dial(server.url, { tls: Object.assign(Object.create(inherited), own, { pfx, passphrase: "sample" }) });
      const refuse = () => new Error("not the pinned certificate");
      expect({
        ca: await connect({ ca: ca1 }, { serverName: "agent1" }),
        serverName: await connect({ serverName: "agent1" }, { ca: ca1 }),
        checkServerIdentity: await connect({ checkServerIdentity: refuse }, { ca: ca1, serverName: "agent1" }),
      }).toEqual({ ca: identified, serverName: identified, checkServerIdentity: "refused" });
    });

    it("an own `pfx` in the `tls` option keeps options that a spread can't see", async () => {
      using server = await serve(agent1);
      const checkServerIdentity = () => new Error("not the pinned certificate");
      const visible = { ca: ca1, serverName: "agent1", pfx, passphrase: "sample" };
      expect({
        control: await dial(server.url, { tls: visible }),
        nonEnumerable: await dial(server.url, {
          tls: Object.defineProperty({ ...visible }, "checkServerIdentity", { value: checkServerIdentity }),
        }),
        proxyTraps: await dial(server.url, {
          tls: new Proxy(visible, {
            has: (target, key) => key === "checkServerIdentity" || key in target,
            get: (target, key) => (key === "checkServerIdentity" ? checkServerIdentity : Reflect.get(target, key)),
          }),
        }),
      }).toEqual({ control: identified, nonEnumerable: "refused", proxyTraps: "refused" });
    });

    it("accepts a `pfx` and `passphrase` that the `tls` option inherits or that a spread can't see", async () => {
      using server = await serve();
      expect({
        inherited: await dial(server.url, { tls: Object.assign(Object.create({ pfx, passphrase: "sample" }), { ca }) }),
        nonEnumerable: await dial(server.url, {
          tls: Object.defineProperties({ ca }, { pfx: { value: pfx }, passphrase: { value: "sample" } }),
        }),
      }).toEqual({ inherited: identified, nonEnumerable: identified });
    });

    it("ignores a pfx set on Object.prototype", async () => {
      using server = await serve();
      await using child = spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          const WebSocket = require("ws");
          const { TEST_URL, TEST_CA: ca, TEST_PFX } = process.env;
          Object.prototype.pfx = require("fs").readFileSync(TEST_PFX);
          Object.prototype.passphrase = "sample";
          for (const options of [{ tls: { ca } }, { ca }]) {
            const ws = new WebSocket(TEST_URL, options);
            ws.on("message", data => { console.log(String(data)); ws.terminate(); });
            ws.on("error", error => console.log("refused", error.code));
            await new Promise(resolve => ws.on("close", resolve));
          }
          `,
        ],
        env: {
          ...bunEnv,
          TEST_URL: server.url,
          TEST_CA: ca,
          TEST_PFX: path.join(import.meta.dirname, "../../node/test/fixtures/keys/agent1.pfx"),
        },
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([child.stdout.text(), child.exited]);
      expect(stdout.trim().split("\n")).toEqual([anonymous, anonymous]);
      expect(exitCode).toBe(0);
    });

    it("ignores a checkServerIdentity set on Object.prototype", async () => {
      using server = await serve(agent1);
      await using child = spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          const WebSocket = require("ws");
          const ca = require("fs").readFileSync(process.env.TEST_CA);
          Object.prototype.checkServerIdentity = () => undefined;
          for (const options of [{ tls: { ca } }, { ca }]) {
            const ws = new WebSocket(process.env.TEST_URL, options);
            ws.on("message", data => { console.log(String(data)); ws.terminate(); });
            ws.on("error", error => console.log("refused", error.code));
            await new Promise(resolve => ws.on("close", resolve));
          }
          `,
        ],
        env: {
          ...bunEnv,
          TEST_URL: server.url,
          TEST_CA: path.join(import.meta.dirname, "../../node/test/fixtures/keys/ca1-cert.pem"),
        },
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([child.stdout.text(), child.exited]);
      const refused = "refused ERR_TLS_CERT_ALTNAME_INVALID";
      expect(stdout.trim().split("\n")).toEqual([refused, refused]);
      expect(exitCode).toBe(0);
    });

    it("ignores options set on Object.prototype", async () => {
      using server = await serve();
      const plain = new WebSocketServer({ port: 0, host: "127.0.0.1" });
      plain.on("connection", (ws, req) => ws.send(`x-polluted: ${req.headers["x-polluted"]}`));
      await once(plain, "listening");
      try {
        await using child = spawn({
          cmd: [
            bunExe(),
            "-e",
            `
            const WebSocket = require("ws");
            const connect = (url, ...options) => new Promise(resolve => {
              const ws = new WebSocket(url, ...options);
              ws.on("message", data => { resolve(String(data)); ws.terminate(); });
              ws.on("error", error => resolve("refused " + error.code));
            });
            const { TEST_URL, TEST_PLAIN_URL } = process.env;
            const agents = [new (require("node:https").Agent)(), new (require("node:http").Agent)()];
            Object.prototype.tls = { rejectUnauthorized: false };
            Object.prototype.proxy = "http://127.0.0.1:9";
            Object.prototype["x-polluted"] = "yes";
            for (const options of [[], [{}], [{ agent: agents[0] }]]) console.log(await connect(TEST_URL, ...options));
            for (const options of [[], [{}], [{ agent: agents[1] }], [{ headers: { a: "b" } }]]) console.log(await connect(TEST_PLAIN_URL, ...options));
            `,
          ],
          env: {
            ...bunEnv,
            TEST_URL: server.url,
            TEST_PLAIN_URL: `ws://127.0.0.1:${(plain.address() as AddressInfo).port}`,
          },
          stdout: "pipe",
          stderr: "inherit",
        });
        const [stdout, exitCode] = await Promise.all([child.stdout.text(), child.exited]);
        const refused = "refused DEPTH_ZERO_SELF_SIGNED_CERT";
        const direct = "x-polluted: undefined";
        expect(stdout.trim().split("\n")).toEqual([refused, refused, refused, direct, direct, direct, direct]);
        expect(exitCode).toBe(0);
      } finally {
        plain.close();
      }
    });

    it("crl", async () => {
      // ca2 signs agent3. ca2-crl.pem revokes agent4 only.
      using server = await serve({ key: read("agent3-key.pem"), cert: read("agent3-cert.pem") });
      const trust = { ca: read("ca2-cert.pem"), servername: "agent3" };
      expect(await dial(server.url, { ...trust, crl: read("ca2-crl.pem") })).toBe(anonymous);
      expect(await dial(server.url, { ...trust, crl: read("ca2-crl-agent3.pem") })).toBe("refused");
    });
  });
});
