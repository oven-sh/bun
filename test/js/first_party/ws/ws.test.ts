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
import { inflateRawSync, constants as zlibConstants } from "zlib";
import NpmWebSocketServerModule from "../../../node_modules/ws/lib/websocket-server.js";
import NpmWebSocketModule from "../../../node_modules/ws/lib/websocket.js";
import { BINARY, frame, openToRawPeer, TEXT, type WireFrame } from "./raw-peer-test-utils";

const NpmWebSocket: typeof WebSocket = NpmWebSocketModule;
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

// https://github.com/oven-sh/bun/issues/21376
// Bun.serve drops a message once 16 MiB is buffered for the socket. The server
// socket queues a dropped message and sends it from the drain callback.
it("WebSocketServer sends a message that waited at the backpressure limit once", async () => {
  // A client that does not read lets the kernel take only a few MiB, so the
  // end of this burst is dropped and queued.
  const messages = 32;
  const payloadLength = 1024 * 1024;
  const frameLength = 10 + payloadLength; // a header with a 64-bit length, then the payload
  const wss = new WebSocketServer({ port: 0 });
  const socket = connect({ port: (wss.address() as AddressInfo).port, host: "127.0.0.1" });
  try {
    const connection = once(wss, "connection");
    let step = Promise.withResolvers<void>();
    socket.on("error", err => step.reject(err));

    let head = "";
    let upgraded = false;
    let received = 0;
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => {
      if (!upgraded) {
        head += chunk.toString("latin1");
        if (!head.includes("\r\n\r\n")) return;
        upgraded = true;
        // Read nothing more until the whole burst is sent.
        socket.pause();
        step.resolve();
        return;
      }
      chunks.push(chunk);
      received += chunk.length;
      if (received >= messages * frameLength) step.resolve();
    });
    socket.write(
      "GET / HTTP/1.1\r\n" +
        "Host: 127.0.0.1\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
        "Sec-WebSocket-Version: 13\r\n\r\n",
    );
    await step.promise;
    expect(head).toStartWith("HTTP/1.1 101 ");
    const [ws] = await connection;

    let callbacks = 0;
    for (let i = 0; i < messages; i++) {
      const message = Buffer.alloc(payloadLength);
      message.writeUInt32BE(i, 0);
      ws.send(message, (err?: Error) => {
        if (!err) callbacks++;
      });
    }

    step = Promise.withResolvers<void>();
    socket.resume();
    await step.promise;

    // The number at the start of each of the first `messages` frames the client got.
    const bytes = Buffer.concat(chunks);
    const order = Array.from({ length: messages }, (_, i) => bytes.readUInt32BE(i * frameLength + 10));
    expect({ order, callbacks }).toEqual({
      order: Array.from({ length: messages }, (_, i) => i),
      callbacks: messages,
    });
  } finally {
    socket.destroy();
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

// What send(data, options) puts on the wire, read by a peer that has no websocket implementation. The rule of npm ws
// for a string, a number, bytes and a Blob:
//   if (typeof data === "number") data = data.toString();
//   opcode = { binary: typeof data !== "string", ...options }.binary ? 2 : 1
//   payload = the bytes of `data`, as they are
// https://github.com/websockets/ws/blob/8.18.3/lib/websocket.js#L448-L478
// https://github.com/websockets/ws/blob/8.18.3/lib/sender.js#L346-L363
// The "npm" half runs the package itself, so each table below is the output of npm ws and not a reading of its source.
describe.each([
  { implementation: "built-in", WebSocket, WebSocketServer },
  { implementation: "npm", WebSocket: NpmWebSocket, WebSocketServer: NpmWebSocketServer },
])("send(data, options) of the $implementation ws", ({ implementation, WebSocket, WebSocketServer }) => {
  const END = Buffer.from("END").toString("hex");
  const open = (side: "server" | "client", secure: boolean, onFrame: (got: WireFrame) => void, extensions?: string) =>
    openToRawPeer({ WebSocket, WebSocketServer }, side, secure, onFrame, extensions);

  const text = "text-\u4e16-\u{1f636}";
  const utf8 = Buffer.from(text);
  const hex = utf8.toString("hex");
  const padded = Buffer.concat([Buffer.from([0xff, 0xff]), utf8, Buffer.from([0xff])]);
  const bytes = () => Buffer.from(utf8);
  const arrayBuffer = () => new Uint8Array(utf8).buffer;
  const dataView = () => new DataView(new Uint8Array(padded).buffer, 2, utf8.length);
  const blob = () => new Blob([utf8]);
  const shared = () => {
    const buffer = new SharedArrayBuffer(utf8.length);
    new Uint8Array(buffer).set(utf8);
    return buffer;
  };
  const resizable = () => {
    const buffer = new ArrayBuffer(utf8.length, { maxByteLength: 64 });
    new Uint8Array(buffer).set(utf8);
    return buffer;
  };
  const hidden = (binary: unknown) => Object.defineProperty({}, "binary", { value: binary, enumerable: false });

  type Row = [label: string, data: () => unknown, options: object | undefined, opcode: number, payload: string];

  // A string, bytes or a Blob: `binary` selects the frame type, and the payload is not converted.
  const payloads: Row[] = [
    // a falsy own `binary`: a text frame with the same bytes
    ["Buffer", bytes, { binary: false }, TEXT, hex],
    ["Uint8Array", () => new Uint8Array(utf8), { binary: false }, TEXT, hex],
    [
      "Uint8Array with an offset",
      () => new Uint8Array(padded.buffer, padded.byteOffset + 2, utf8.length),
      { binary: false },
      TEXT,
      hex,
    ],
    [
      "Uint16Array",
      () => new Uint16Array(new Uint8Array([0x68, 0x69, 0x6a, 0x6b]).buffer),
      { binary: false },
      TEXT,
      "68696a6b",
    ],
    ["DataView with an offset", dataView, { binary: false }, TEXT, hex],
    ["ArrayBuffer", arrayBuffer, { binary: false }, TEXT, hex],
    ["SharedArrayBuffer", shared, { binary: false }, TEXT, hex],
    ["resizable ArrayBuffer", resizable, { binary: false }, TEXT, hex],
    ["Blob", blob, { binary: false }, TEXT, hex],
    ["empty Buffer", () => Buffer.alloc(0), { binary: false }, TEXT, ""],
    ["empty ArrayBuffer", () => new ArrayBuffer(0), { binary: false }, TEXT, ""],
    ["empty Blob", () => new Blob([]), { binary: false }, TEXT, ""],
    // npm ws does not validate what it sends. Bytes that are not UTF-8 go into the text frame as they are, and a
    // peer that validates text frames then fails the connection.
    ["Buffer that is not UTF-8", () => Buffer.from([0xff, 0x68]), { binary: false }, TEXT, "ff68"],
    ["Float64Array that is not UTF-8", () => new Float64Array([1]), { binary: false }, TEXT, "000000000000f03f"],
    ["Buffer that ends inside a character", () => utf8.subarray(0, 6), { binary: false }, TEXT, hex.slice(0, 12)],
    // a truthy own `binary`: a binary frame
    ["string", () => text, { binary: true }, BINARY, hex],
    ["empty string", () => "", { binary: true }, BINARY, ""],
    ["number", () => 12, { binary: true }, BINARY, "3132"],
    ["Buffer", bytes, { binary: true }, BINARY, hex],
    ["DataView with an offset", dataView, { binary: true }, BINARY, hex],
    ["ArrayBuffer", arrayBuffer, { binary: true }, BINARY, hex],
    ["SharedArrayBuffer", shared, { binary: true }, BINARY, hex],
    ["Blob", blob, { binary: true }, BINARY, hex],
    ["string", () => text, { binary: false }, TEXT, hex],
    ["number", () => 12, { binary: false }, TEXT, "3132"],
    // a string of 8-bit characters, one of them over 0x7f
    ["Latin-1 string", () => "caf\u00e9", { binary: true }, BINARY, "636166c3a9"],
    ["Latin-1 string", () => "caf\u00e9", undefined, TEXT, "636166c3a9"],
    // only the truth of `binary` counts
    ["Buffer", bytes, { binary: 0 }, TEXT, hex],
    ["Buffer", bytes, { binary: null }, TEXT, hex],
    ["Buffer", bytes, { binary: "" }, TEXT, hex],
    ["Buffer", bytes, { binary: NaN }, TEXT, hex],
    ["Buffer", bytes, { binary: undefined }, TEXT, hex],
    ["Buffer", bytes, { binary: 1 }, BINARY, hex],
    ["string", () => text, { binary: 1 }, BINARY, hex],
    ["string", () => text, { binary: "yes" }, BINARY, hex],
    ["string", () => text, { binary: {} }, BINARY, hex],
    ["string", () => text, { binary: undefined }, TEXT, hex],
    // `{ ...options }` copies own properties only
    ["Buffer, inherited false", bytes, Object.create({ binary: false }), BINARY, hex],
    ["Buffer, inherited undefined", bytes, Object.create({ binary: undefined }), BINARY, hex],
    ["string, inherited true", () => text, Object.create({ binary: true }), TEXT, hex],
    ["Buffer, not enumerable undefined", bytes, hidden(undefined), BINARY, hex],
    [
      "Buffer, own false over inherited true",
      bytes,
      Object.assign(Object.create({ binary: true }), { binary: false }),
      TEXT,
      hex,
    ],
    // `binary` beside other options
    ["Buffer", bytes, { compress: false, binary: false, fin: true }, TEXT, hex],
    ["string", () => text, { compress: false, binary: true }, BINARY, hex],
    // no `binary`: the type of the data selects the frame type
    ["string", () => text, undefined, TEXT, hex],
    ["empty string", () => "", undefined, TEXT, ""],
    ["number", () => 12, undefined, TEXT, "3132"],
    ["number", () => 0, undefined, TEXT, "30"],
    ["Buffer", bytes, undefined, BINARY, hex],
    ["empty Buffer", () => Buffer.alloc(0), undefined, BINARY, ""],
    ["DataView with an offset", dataView, undefined, BINARY, hex],
    ["ArrayBuffer", arrayBuffer, undefined, BINARY, hex],
    ["Blob", blob, undefined, BINARY, hex],
    ["Buffer", bytes, {}, BINARY, hex],
    ["Buffer", bytes, { compress: false }, BINARY, hex],
    ["string", () => text, { compress: false }, TEXT, hex],
  ];

  function describeOptions(options: object | undefined) {
    if (options === undefined) return "no options";
    const own = Object.entries(options).map(([key, value]) => `${key}: ${Bun.inspect(value)}`);
    return own.length ? `{ ${own.join(", ")} }` : "{}";
  }

  const onTheWire = (rows: Row[]) =>
    rows.map(([label, , options, opcode, payload]) => ({
      row: `${label}, ${describeOptions(options)}`,
      ...frame(opcode, payload),
    }));

  // Sends every row. Resolves with the frames the peer got, and with the count of send() callbacks that had run
  // when the last frame arrived: a frame reaches the peer after its socket wrote it.
  async function sendRows(side: "server" | "client", secure: boolean, rows: Row[]) {
    const frames: WireFrame[] = [];
    const all = Promise.withResolvers<number>();
    let callbacks = 0;
    const connection = await open(side, secure, got => {
      if (frames.push(got) === rows.length) all.resolve(callbacks);
    });
    try {
      const callback = (error?: Error | null) => {
        if (error) all.reject(error);
        else callbacks++;
      };
      for (const [, data, options] of rows) {
        // A send() with no options is a call with two arguments, as a program makes it.
        if (options === undefined) connection.ws.send(data() as Buffer, callback);
        else connection.ws.send(data() as Buffer, options, callback);
      }
      const callbacksRun = await Promise.race([all.promise, connection.failure]);
      const expected = onTheWire(rows);
      return { frames: frames.map((got, i) => ({ row: expected[i].row, ...got })), callbacksRun };
    } finally {
      connection.close();
    }
  }

  describe.each([
    { side: "server", transport: "TCP" },
    { side: "server", transport: "TLS" },
    { side: "client", transport: "TCP" },
    { side: "client", transport: "TLS" },
  ] as const)("a $side socket over $transport", ({ side, transport }) => {
    it("sends a string, bytes and a Blob as they are, with the frame type that `binary` selects", async () => {
      expect(await sendRows(side, transport === "TLS", payloads)).toEqual({
        frames: onTheWire(payloads),
        callbacksRun: payloads.length,
      });
    });
  });

  // npm ws sends `Buffer.from(data)` for any other value. The built-in module does not have that rule: such a value
  // goes out as the public send() of the native socket sends it, and `binary` does not apply to it.
  it.skipIf(implementation !== "built-in").each(["server", "client"] as const)(
    "a %s socket sends a value that is not a string, a number, bytes or a Blob as the text of String(data)",
    async side => {
      const asText = (value: unknown) => frame(TEXT, Buffer.from(String(value)).toString("hex"));
      const values = [[104, 105], true, { length: 2 }, 10n];
      const frames: WireFrame[] = [];
      const all = Promise.withResolvers<void>();
      let callbacks = 0;
      const connection = await open(side, false, got => {
        if (frames.push(got) === values.length * 2 + (side === "client" ? 2 : 0)) all.resolve();
      });
      try {
        const callback = (error?: Error | null) => {
          if (error) all.reject(error);
          else callbacks++;
        };
        const expected: WireFrame[] = [];
        for (const value of values) {
          connection.ws.send(value as unknown as Buffer, callback);
          connection.ws.send(value as unknown as Buffer, { binary: true }, callback);
          expected.push(asText(value), asText(value));
        }
        for (const value of [null, undefined]) {
          if (side === "server") {
            // The native server socket rejects these two.
            expect(() => connection.ws.send(value as unknown as Buffer, callback)).toThrow(
              "send requires a non-empty message",
            );
          } else {
            connection.ws.send(value as unknown as Buffer, callback);
            expected.push(asText(value));
          }
        }
        await Promise.race([all.promise, connection.failure]);
        expect({ frames, callbacks }).toEqual({ frames: expected, callbacks: expected.length });
      } finally {
        connection.close();
      }
    },
  );

  // The broadcast of the npm ws README: `client.send(data, { binary: isBinary })` with the data of 'message'.
  it.each(["nodebuffer", "arraybuffer", "blob"] as const)(
    "a server socket with binaryType %s echoes a text frame as a text frame",
    async binaryType => {
      const frames: WireFrame[] = [];
      const all = Promise.withResolvers<void>();
      const connection = await open("server", false, got => {
        if (frames.push(got) === 2) all.resolve();
      });
      try {
        // @types/ws 8.5 does not list "blob", ws 8.18 accepts it
        connection.ws.binaryType = binaryType as WebSocket["binaryType"];
        connection.ws.on("message", (data, isBinary) => connection.ws.send(data, { binary: isBinary }));
        // two frames of a client, with a masking key of zeros: the text "hi", then the bytes 01 02 03
        connection.peer.write(Buffer.from([0x81, 0x82, 0, 0, 0, 0, 0x68, 0x69]));
        connection.peer.write(Buffer.from([0x82, 0x83, 0, 0, 0, 0, 1, 2, 3]));
        await Promise.race([all.promise, connection.failure]);
        expect(frames).toEqual([frame(TEXT, "6869"), frame(BINARY, "010203")]);
      } finally {
        connection.close();
      }
    },
  );

  // The same echo on a client socket. In "fragments" mode a binary message is an array of Buffers, and what send()
  // makes of an array is not the same in the two modules, so that mode echoes the text frame only.
  it.each(["nodebuffer", "arraybuffer", "blob", "fragments"] as const)(
    "a client socket with binaryType %s echoes a text frame as a text frame",
    async binaryType => {
      const expected = [frame(TEXT, "6869"), ...(binaryType === "fragments" ? [] : [frame(BINARY, "010203")])];
      const frames: WireFrame[] = [];
      const all = Promise.withResolvers<void>();
      const connection = await open("client", false, got => {
        if (frames.push(got) === expected.length) all.resolve();
      });
      try {
        connection.ws.binaryType = binaryType as WebSocket["binaryType"];
        connection.ws.on("message", (data, isBinary) => connection.ws.send(data, { binary: isBinary }));
        // frames of a server, which have no mask: the text "hi", then the bytes 01 02 03
        connection.peer.write(Buffer.from([0x81, 0x02, 0x68, 0x69]));
        if (expected.length === 2) connection.peer.write(Buffer.from([0x82, 0x03, 1, 2, 3]));
        await Promise.race([all.promise, connection.failure]);
        expect(frames).toEqual(expected);
      } finally {
        connection.close();
      }
    },
  );

  // A peer that does not read makes the server socket keep what it cannot write. Each message must reach the
  // peer one time, in the order of the calls, with the frame type that send() selected.
  it("a server socket sends a message that had to wait one time, in order, with its frame type", async () => {
    const size = 4 * 1024 * 1024;
    const frames: WireFrame[] = [];
    const seen = new Set<string>();
    const done = Promise.withResolvers<number>();
    let callbacks = 0;
    const connection = await open("server", false, got => {
      frames.push(got);
      // The end mark, or a second copy of a message, ends the test.
      if (got.payload === END || seen.has(got.payload)) done.resolve(callbacks);
      seen.add(got.payload);
    });
    try {
      const { ws, peer } = connection;
      peer.pause();
      const expected: WireFrame[] = [];
      let sent = 0;
      const callback = (error?: Error | null) => {
        if (error) done.reject(error);
        else callbacks++;
      };
      const send = () => {
        const tag = 0x41 + sent++;
        // bytes as a text frame and a string as a binary frame, in turn
        if (sent % 2) ws.send(Buffer.alloc(size, tag), { binary: false }, callback);
        else ws.send(Buffer.alloc(size, tag).toString(), { binary: true }, callback);
        expected.push(frame(sent % 2 ? TEXT : BINARY, `${tag.toString(16)}+${size - 1}`));
      };
      // The callback of a message that the socket wrote or buffered runs before the next macrotask. The first
      // message whose callback does not run is one that waits for the peer.
      do {
        send();
        await new Promise(resolve => setImmediate(resolve));
      } while (callbacks === sent && sent < 16);
      // Winsock can take every message from a peer that does not read. No message waits then.
      if (process.platform !== "win32") expect(callbacks).toBeLessThan(sent);

      // Behind it: two more messages, then bytes and a Blob as text frames, then the end mark.
      send();
      send();
      ws.send(new Uint8Array([0x68, 0x69]).buffer, { binary: false }, callback);
      ws.send(new Blob(["hi"]) as unknown as Buffer, { binary: false }, callback);
      expected.push(frame(TEXT, "6869"), frame(TEXT, "6869"));
      if (implementation === "built-in") {
        // What the native socket rejects throws at the call, also when messages wait. npm ws takes all three.
        expect(() => ws.send(null as unknown as Buffer, callback)).toThrow("send requires a non-empty message");
        expect(() => ws.send("x", { compress: 1 as unknown as boolean }, callback)).toThrow(
          "send expects compress to be a boolean",
        );
        expect(() => ws.send(Bun.file(import.meta.path) as unknown as Buffer, callback)).toThrow(
          "file- or S3-backed Blob",
        );
      }
      ws.send("END", callback);
      expected.push(frame(TEXT, END));

      peer.resume();
      const callbacksRun = await Promise.race([done.promise, connection.failure]);
      expect({ frames, callbacksRun, bufferedAmount: ws.bufferedAmount }).toEqual({
        frames: expected,
        callbacksRun: sent + 3,
        bufferedAmount: 0,
      });
    } finally {
      connection.close();
    }
  });

  // What a closing or closed client socket gets is not sent. It counts in bufferedAmount, in the built-in socket
  // with the 6 bytes of a frame head and its mask.
  it("a client socket that is not open sends nothing and counts what send() gets", async () => {
    const frames: WireFrame[] = [];
    const connection = await open("client", false, got => frames.push(got));
    try {
      const { ws, peer } = connection;
      const rows: [label: string, data: () => unknown, options: object | undefined][] = [
        ["string", () => "four", undefined],
        ["string, { binary: true }", () => "four", { binary: true }],
        ["Buffer", () => Buffer.from("four"), undefined],
        ["Buffer, { binary: false }", () => Buffer.from("four"), { binary: false }],
        ["ArrayBuffer", () => new ArrayBuffer(4), undefined],
        ["DataView", () => new DataView(new ArrayBuffer(4)), undefined],
        ["Blob", () => new Blob(["four"]), undefined],
      ];
      const counted = () =>
        rows.map(([label, data, options]) => {
          const before = ws.bufferedAmount;
          if (options === undefined) ws.send(data() as Buffer);
          else ws.send(data() as Buffer, options);
          return [label, ws.bufferedAmount - before];
        });
      ws.close();
      const closing = { readyState: ws.readyState, counted: counted() };
      peer.destroy();
      await once(ws, "close");
      const closed = { readyState: ws.readyState, counted: counted() };

      const each = rows.map(([label]) => [label, implementation === "built-in" ? 10 : 4]);
      expect({ closing, closed, data: frames.filter(got => got.opcode !== 8) }).toEqual({
        closing: { readyState: 2, counted: each },
        closed: { readyState: 3, counted: each },
        data: [],
      });
    } finally {
      connection.close();
    }
  });

  // npm ws throws the error. The built-in socket gives it to the callback.
  it("a client socket that is not open yet reports an error for send()", async () => {
    // A TCP server that never answers the upgrade.
    const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const ws = new WebSocket("ws://127.0.0.1:" + listener.port);
    ws.on("error", () => {});
    try {
      const reported: object[] = [];
      for (const data of ["four", Buffer.from("four"), new Blob(["four"])]) {
        try {
          ws.send(data as Buffer, error => void reported.push({ callback: error?.name }));
        } catch (error) {
          reported.push({ thrown: (error as Error).message });
        }
      }
      await new Promise(resolve => setImmediate(resolve));
      const each =
        implementation === "built-in"
          ? { callback: "InvalidStateError" }
          : { thrown: "WebSocket is not open: readyState 0 (CONNECTING)" };
      expect({ readyState: ws.readyState, reported }).toEqual({ readyState: 0, reported: [each, each, each] });
    } finally {
      ws.terminate();
      listener.stop(true);
    }
  });

  // Not as npm ws, on purpose. npm ws copies the options with `{ ...options }`, which leaves out a property that is
  // not enumerable. The built-in module reads an own `binary` of either kind: the check that it is enumerable is a
  // call of propertyIsEnumerable() for each frame whose `binary` differs from the type of the data, the text echo.
  it("reads a `binary` that is not enumerable in the built-in module only", async () => {
    const [ofBytes, ofString] = implementation === "built-in" ? [TEXT, BINARY] : [BINARY, TEXT];
    const rows: Row[] = [
      ["Buffer, not enumerable false", bytes, hidden(false), ofBytes, hex],
      ["ArrayBuffer, not enumerable 0", arrayBuffer, hidden(0), ofBytes, hex],
      ["string, not enumerable true", () => text, hidden(true), ofString, hex],
    ];
    expect((await sendRows("server", false, rows)).frames).toEqual(onTheWire(rows));
  });

  // The raw server accepts permessage-deflate, and RSV1 in the frame head shows that the client compressed. The
  // frame type must be the one that `binary` selects, and the bytes must inflate to what send() got.
  it("a client socket compresses bytes that it sends as a text frame, and a string that it sends as a binary frame", async () => {
    const sent = Buffer.alloc(2048, "text-\u4e16-");
    const frames: WireFrame[] = [];
    const all = Promise.withResolvers<void>();
    const connection = await open(
      "client",
      false,
      got => {
        if (frames.push(got) === 2) all.resolve();
      },
      "permessage-deflate; client_no_context_takeover; server_no_context_takeover",
    );
    try {
      connection.ws.send(Buffer.from(sent), { binary: false });
      connection.ws.send(sent.toString(), { binary: true });
      await Promise.race([all.promise, connection.failure]);
      // A deflate block of a message ends with 00 00 ff ff, which the sender leaves out.
      const inflate = (payload: string) =>
        inflateRawSync(Buffer.concat([Buffer.from(payload, "hex"), Buffer.from([0, 0, 0xff, 0xff])]), {
          finishFlush: zlibConstants.Z_SYNC_FLUSH,
        }).toString("hex");
      expect(frames.map(({ payload, ...head }) => ({ ...head, inflated: inflate(payload) }))).toEqual([
        { fin: true, rsv1: true, opcode: TEXT, inflated: sent.toString("hex") },
        { fin: true, rsv1: true, opcode: BINARY, inflated: sent.toString("hex") },
      ]);
    } finally {
      connection.close();
    }
  });

  // What send() of the built-in module does not do yet. The npm half runs each test, so each expectation is the
  // output of npm ws.
  const notYet = implementation === "built-in";

  // npm ws sends data with `fin: false` as a fragment of a message. The first frame has the frame type, each frame
  // after it is a continuation frame, and the first send() with no `fin: false` ends the message. The built-in
  // module sends each one as a whole message.
  it.todoIf(notYet)("sends data with `fin: false` as a fragment", async () => {
    const frames: WireFrame[] = [];
    const all = Promise.withResolvers<void>();
    const connection = await open("server", false, got => {
      if (frames.push(got) === 3) all.resolve();
    });
    try {
      connection.ws.send(Buffer.from("a"), { binary: false, fin: false });
      connection.ws.send("b", { fin: false });
      connection.ws.send("c");
      await Promise.race([all.promise, connection.failure]);
      expect(frames).toEqual([{ ...frame(TEXT, "61"), fin: false }, { ...frame(0, "62"), fin: false }, frame(0, "63")]);
    } finally {
      connection.close();
    }
  });

  // npm ws makes a Buffer over the memory of an ArrayBuffer, and of a view that is not a Buffer. That throws when
  // the memory is detached. The built-in module sends an empty frame.
  it.todoIf(notYet)("throws for a detached ArrayBuffer and for a detached view", async () => {
    const connection = await open("server", false, () => {});
    try {
      const detached = () => {
        const view = new Uint8Array(4);
        structuredClone(view.buffer, { transfer: [view.buffer] });
        return view;
      };
      expect(() => connection.ws.send(detached().buffer)).toThrow(TypeError);
      expect(() => connection.ws.send(detached(), { binary: false })).toThrow(TypeError);
    } finally {
      connection.close();
    }
  });
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
