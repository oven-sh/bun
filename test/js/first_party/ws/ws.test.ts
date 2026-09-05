import type { Subprocess } from "bun";
import { spawn } from "bun";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import crypto from "crypto";
import { EventEmitter, once } from "events";
import { bunEnv, bunExe, isDebug, isWindows } from "harness";
import { createServer } from "http";
import { AddressInfo, connect } from "net";
import path from "node:path";
import { Server, WebSocket, WebSocketServer } from "ws";

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
    ws.onmessage = e => {
      expect(e.data).toEqual(Buffer.from("hello"));
      done();
      wss.close();
    };
  });

  const ws = new WebSocket("ws://localhost:" + wss.address().port);
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
      // @ts-expect-error
      ws.onclose = () => resolve();
      return promise;
    },
  ];
  const wss = new WebSocketServer({ port: 0 });
  wss.on("connection", ws => {
    ws.onmessage = e => {
      expect(e.data).toEqual(Buffer.from("hello"));
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
    // well over 1s to spawn + connect on slow CI runners.
    { timeout: timeout ?? (isDebug ? 10000 : 1000) },
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
  async function receiveUpgrade(request: string, server = createServer()) {
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

// The server side socket sits on top of the Bun.serve websocket callbacks, and
// uws runs the close callback from inside ws.close()/ws.terminate(). These
// tests pin the npm ws lifecycle on top of that: CLOSING right after close(),
// 'close' emitted later with a Buffer reason, send() after close still calling
// back, and queued messages going out before the Close frame.
describe("server socket close lifecycle", () => {
  // A masked client frame (RFC 6455 5.3); an all-zero key leaves the payload as is.
  function clientFrame(opcode: number, payload: Buffer | string): Buffer {
    const data = Buffer.from(payload);
    return Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | data.length, 0, 0, 0, 0]), data]);
  }

  const textFrame = clientFrame(0x1, "x");
  const closeFrame4444 = clientFrame(0x8, Buffer.concat([Buffer.from([0x11, 0x5c]), Buffer.from("other")]));

  // Connects a raw TCP client and completes the handshake, so the server side
  // sees exactly the bytes each test writes. `rest` holds any frame bytes that
  // arrived in the same chunk as the handshake response. Disposing it destroys
  // the connection, which also takes the server side socket down.
  async function rawClient(
    wss: WebSocketServer,
  ): Promise<{ socket: ReturnType<typeof connect>; rest: Buffer } & Disposable> {
    const { port } = wss.address() as AddressInfo;
    const socket = connect({ port, host: "127.0.0.1" });
    socket.on("error", () => {});
    const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
    let response = "";
    const onData = (data: Buffer) => {
      response += data.toString("latin1");
      const end = response.indexOf("\r\n\r\n");
      if (end === -1) return;
      socket.off("data", onData);
      if (response.startsWith("HTTP/1.1 101 ")) resolve(Buffer.from(response.slice(end + 4), "latin1"));
      else reject(new Error(`upgrade failed: ${response}`));
    };
    socket.on("data", onData);
    socket.once("close", () => reject(new Error("socket closed before the upgrade completed")));
    socket.write(
      "GET / HTTP/1.1\r\n" +
        `Host: 127.0.0.1:${port}\r\n` +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
        "Sec-WebSocket-Version: 13\r\n\r\n",
    );
    const rest = await promise;
    return { socket, rest, [Symbol.dispose]: () => socket.destroy() };
  }

  // Everything the server writes after the handshake, once it has closed the connection.
  function wireBytes({ socket, rest }: Awaited<ReturnType<typeof rawClient>>): Promise<Buffer> {
    const chunks = [rest];
    socket.on("data", chunk => chunks.push(chunk));
    return new Promise(resolve => socket.once("end", () => resolve(Buffer.concat(chunks))));
  }

  function closeEvent(ws: WebSocket): Promise<{ code: number; reason: Buffer; readyState: number }> {
    return new Promise(resolve =>
      ws.once("close", (code, reason) => resolve({ code, reason, readyState: ws.readyState })),
    );
  }

  function sendResult(ws: WebSocket, data: string | Buffer): Promise<string> {
    return new Promise(resolve => ws.send(data, err => resolve(err ? err.message : "ok")));
  }

  it("close() leaves the socket CLOSING, then emits 'close' to a listener added after it", async () => {
    const wss = new WebSocketServer({ port: 0 });
    try {
      const { promise, resolve, reject } = Promise.withResolvers<Record<string, unknown>>();
      wss.on("connection", ws => {
        ws.on("message", async () => {
          try {
            ws.close(4000, "bye");
            expect(ws.readyState).toBe(WebSocket.CLOSING);
            const closed = closeEvent(ws);
            const lateSend = sendResult(ws, "late");
            const bufferedAmount = ws.bufferedAmount;
            resolve({ ...(await closed), lateSend: await lateSend, bufferedAmount, clients: wss.clients.size });
          } catch (err) {
            reject(err);
          }
        });
      });

      using client = await rawClient(wss);
      client.socket.write(textFrame);
      expect(await promise).toEqual({
        code: 4000,
        reason: Buffer.from("bye"),
        readyState: WebSocket.CLOSED,
        lateSend: "WebSocket is not open: readyState 2 (CLOSING)",
        bufferedAmount: 4,
        clients: 0,
      });
    } finally {
      wss.close();
    }
  });

  // 'connection' is emitted from inside the HTTP upgrade handler. Rejecting a
  // client right there is the common case for a listener added after close().
  it("close() inside the 'connection' handler emits 'close' to a listener added after it", async () => {
    const wss = new WebSocketServer({ port: 0 });
    try {
      const { promise, resolve, reject } = Promise.withResolvers<Record<string, unknown>>();
      wss.on("connection", async ws => {
        try {
          ws.close(4001, "unauthorized");
          expect(ws.readyState).toBe(WebSocket.CLOSING);
          resolve(await closeEvent(ws));
        } catch (err) {
          reject(err);
        }
      });

      using client = await rawClient(wss);
      const wire = wireBytes(client);
      const seen = await promise;
      const bytes = await wire;
      expect({ ...seen, closeFrameHeader: [...bytes.subarray(0, 2)] }).toEqual({
        code: 4001,
        reason: Buffer.from("unauthorized"),
        readyState: WebSocket.CLOSED,
        // a Close frame with the 2 byte code and the 12 byte reason
        closeFrameHeader: [0x88, 14],
      });
    } finally {
      wss.close();
    }
  });

  it("terminate() leaves the socket CLOSING, then emits 'close' with 1006", async () => {
    const wss = new WebSocketServer({ port: 0 });
    try {
      const { promise, resolve, reject } = Promise.withResolvers<Record<string, unknown>>();
      wss.on("connection", ws => {
        ws.on("message", async () => {
          try {
            ws.terminate();
            expect(ws.readyState).toBe(WebSocket.CLOSING);
            resolve(await closeEvent(ws));
          } catch (err) {
            reject(err);
          }
        });
      });

      using client = await rawClient(wss);
      client.socket.write(textFrame);
      expect(await promise).toEqual({ code: 1006, reason: Buffer.alloc(0), readyState: WebSocket.CLOSED });
    } finally {
      wss.close();
    }
  });

  it("a Close frame from the peer emits 'close' with its code and a Buffer reason", async () => {
    const wss = new WebSocketServer({ port: 0 });
    try {
      const { promise, resolve, reject } = Promise.withResolvers<Record<string, unknown>>();
      wss.on("connection", ws => {
        ws.on("close", async (code, reason) => {
          try {
            expect({ code, reason, readyState: ws.readyState }).toEqual({
              code: 4444,
              reason: Buffer.from("other"),
              readyState: WebSocket.CLOSED,
            });
            resolve({ lateSend: await sendResult(ws, "late") });
          } catch (err) {
            reject(err);
          }
        });
      });

      using client = await rawClient(wss);
      client.socket.write(closeFrame4444);
      expect(await promise).toEqual({ lateSend: "WebSocket is not open: readyState 3 (CLOSED)" });
    } finally {
      wss.close();
    }
  });

  // Bun.serve drops a message once 16 MiB is buffered; the shim queues it for
  // the drain callback. Skipped on Windows like the backpressure tests in
  // test/js/bun/websocket: Winsock's loopback takes the whole payload into the
  // kernel, so nothing ever builds up in user space.
  it.skipIf(isWindows)("close() sends the queued messages from drain before the Close frame", async () => {
    const wss = new WebSocketServer({ port: 0 });
    try {
      const connected = Promise.withResolvers<WebSocket>();
      wss.on("connection", ws => connected.resolve(ws));

      using client = await rawClient(wss);
      client.socket.pause();
      const ws = await connected.promise;

      const payload = Buffer.alloc(1024 * 1024, "a");
      const frameLength = payload.length + 10;
      // 16 MiB limit plus whatever the loopback kernel buffers take (under 8 MiB).
      const frames = 26;
      const sends: string[] = [];
      for (let i = 0; i < frames; i++) ws.send(payload, err => sends.push(err ? err.message : "ok"));

      ws.close(4000, "done");
      const readyStateAfterClose = ws.readyState;
      let closed: unknown = "not emitted";
      ws.on("close", (code, reason) => (closed = { code, reason, readyState: ws.readyState }));

      const wire = wireBytes(client);
      client.socket.resume();
      const bytes = await wire;

      const closeFrame = Buffer.concat([Buffer.from([0x88, 6, 0x0f, 0xa0]), Buffer.from("done")]);
      expect({
        readyStateAfterClose,
        sends,
        closeFrameAt: bytes.indexOf(closeFrame),
        totalBytes: bytes.length,
        closed,
        bufferedAmount: ws.bufferedAmount,
      }).toEqual({
        readyStateAfterClose: WebSocket.CLOSING,
        sends: Array(frames).fill("ok"),
        closeFrameAt: frames * frameLength,
        totalBytes: frames * frameLength + closeFrame.length,
        closed: { code: 4000, reason: Buffer.from("done"), readyState: WebSocket.CLOSED },
        bufferedAmount: 0,
      });
    } finally {
      wss.close();
    }
  });

  it.skipIf(isWindows)("terminate() with messages still queued fails their callbacks", async () => {
    const wss = new WebSocketServer({ port: 0 });
    try {
      const connected = Promise.withResolvers<WebSocket>();
      wss.on("connection", ws => connected.resolve(ws));

      using client = await rawClient(wss);
      client.socket.pause();
      const ws = await connected.promise;

      const payload = Buffer.alloc(1024 * 1024, "a");
      const frames = 26;
      const sends: string[] = [];
      for (let i = 0; i < frames; i++) ws.send(payload, err => sends.push(err ? err.message : "ok"));

      const closed = closeEvent(ws);
      ws.close(4000, "never sent");
      // waits for the queue, so the socket is still there to terminate
      expect(ws.readyState).toBe(WebSocket.CLOSING);
      const lateSend = sendResult(ws, "late");
      ws.terminate();

      const notOpen = "WebSocket is not open: readyState 2 (CLOSING)";
      expect({
        closed: await closed,
        lateSend: await lateSend,
        callbacks: sends.length,
        failed: sends.filter(result => result === notOpen).length > 0,
        other: sends.filter(result => result !== "ok" && result !== notOpen),
        // only the late send() still counts, the queued messages are gone
        bufferedAmount: ws.bufferedAmount,
      }).toEqual({
        closed: { code: 1006, reason: Buffer.alloc(0), readyState: WebSocket.CLOSED },
        lateSend: notOpen,
        callbacks: frames,
        failed: true,
        other: [],
        bufferedAmount: 4,
      });
    } finally {
      wss.close();
    }
  });

  it.skipIf(isWindows)("bufferedAmount includes what the native socket has buffered", async () => {
    const wss = new WebSocketServer({ port: 0 });
    try {
      const connected = Promise.withResolvers<WebSocket>();
      wss.on("connection", ws => connected.resolve(ws));

      using client = await rawClient(wss);
      client.socket.pause();
      const ws = await connected.promise;
      expect(ws.bufferedAmount).toBe(0);

      const payload = Buffer.alloc(1024 * 1024, "a");
      let frames = 0;
      while (ws.bufferedAmount === 0 && frames < 8) {
        ws.send(payload);
        frames++;
      }
      const buffered = ws.bufferedAmount;
      expect(buffered).toBeGreaterThan(0);
      expect(buffered).toBeLessThanOrEqual(frames * (payload.length + 10));

      const expectedBytes = frames * (payload.length + 10);
      let received = client.rest.length;
      const { promise: delivered, resolve } = Promise.withResolvers<void>();
      client.socket.on("data", chunk => {
        received += chunk.length;
        if (received >= expectedBytes) resolve();
      });
      client.socket.resume();
      await delivered;

      expect({ received, bufferedAmount: ws.bufferedAmount }).toEqual({ received: expectedBytes, bufferedAmount: 0 });
    } finally {
      wss.close();
    }
  });

  // The native send() reports the bytes written, so a delivered empty frame
  // returns 0 just like a message dropped at the backpressure limit.
  it("send() of an empty payload calls back without an error and goes out once", async () => {
    const wss = new WebSocketServer({ port: 0 });
    try {
      const sends: string[] = [];
      wss.on("connection", ws => {
        ws.send("", err => sends.push(err ? err.message : "text ok"));
        ws.send(Buffer.alloc(0), err => sends.push(err ? err.message : "binary ok"));
        ws.close();
      });

      using client = await rawClient(wss);
      const bytes = await wireBytes(client);
      expect({ sends, dataFrames: bytes.subarray(0, 4).toString("hex"), then: bytes[4] }).toEqual({
        sends: ["text ok", "binary ok"],
        // an empty text frame, an empty binary frame, then the Close frame
        dataFrames: "81008200",
        then: 0x88,
      });
    } finally {
      wss.close();
    }
  });
});
