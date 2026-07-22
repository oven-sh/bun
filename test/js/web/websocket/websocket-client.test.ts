import type { Subprocess } from "bun";
import { spawn } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, nodeExe } from "harness";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import * as path from "node:path";
import { WebSocket as NodeWS } from "ws";
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
    test("(invalid)", (ws, done) => {
      try {
        // @ts-expect-error
        ws.binaryType = "invalid";
        done(new Error("Expected an error"));
      } catch {
        done();
      }
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
        ws.addEventListener("ping", ({ data }) => {
          expect(data).toBeInstanceOf(type);
          ws.pong();
        });
        ws.addEventListener("pong", ({ data }) => {
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
            expect(data).toBe(message);
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
      ws.addEventListener("ping", ({ data }) => {
        expect(data).toBeInstanceOf(Buffer);
        done();
      });
    });
    for (const { label, message, bytes } of messages) {
      test(label, (ws, done) => {
        ws.addEventListener("open", () => {
          ws.ping(message);
        });
        ws.addEventListener("ping", ({ data }) => {
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
      ws.addEventListener("pong", ({ data }) => {
        expect(data).toBeInstanceOf(Buffer);
        done();
      });
    });
    for (const { label, message, bytes } of messages) {
      test(label, (ws, done) => {
        ws.addEventListener("open", () => {
          ws.pong(message);
        });
        ws.addEventListener("pong", ({ data }) => {
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
        expect(code).toBe(1000);
        expect(reason).toBeString();
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
    { timeout: timeout ?? 1000 },
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
      sock.on("data", chunk => {
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
      expectRangeError(() => ws.ping(new Blob([new Uint8Array(130)])), 130);
      expectRangeError(() => ws.pong(s126), 126);
      expectRangeError(() => ws.pong(new Uint8Array(400)), 400);
      expectRangeError(() => ws.pong(new ArrayBuffer(126)), 126);
      expectRangeError(() => ws.pong(new Blob([new Uint8Array(200)])), 200);

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
      expect(ev.code).toBe(1000);
    } finally {
      ws.terminate();
    }
  });

  it("require('ws') client throws RangeError synchronously for oversized ping/pong", async () => {
    const srv = await rawHandshakeServer();
    const ws = new NodeWS(`ws://127.0.0.1:${srv.port}/`);
    try {
      await once(ws, "open");
      ws.on("error", (e: unknown) => {
        throw new Error("unexpected 'error' event: " + e);
      });

      // 125 is the boundary: cb invoked with no error.
      let cbErr: unknown = "not called";
      ws.ping(new Uint8Array(125), true, (e: unknown) => (cbErr = e));
      expect(cbErr).toBeUndefined();

      // > 125: npm ws throws synchronously from Sender.prototype.ping; cb is never invoked.
      const big = new Uint8Array(200);
      let pingCb = 0;
      expectRangeError(() => ws.ping(big, true, () => pingCb++), 200);
      expectRangeError(() => ws.pong(big, true, () => pingCb++), 200);
      expect(pingCb).toBe(0);

      await srv.waitForFrames(1);
      expect(srv.frames).toEqual([{ opcode: 0x9, payloadLen: 125, extendedLen: false }]);
    } finally {
      ws.terminate();
      await srv.close();
    }
  });

  it("Bun.serve ServerWebSocket.ping()/pong() throws RangeError for payloads > 125 bytes", async () => {
    const { promise: result, resolve } = Promise.withResolvers<{ errs: unknown[]; ok125: number }>();
    await using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("no", { status: 400 });
      },
      websocket: {
        open(ws) {
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
        },
        message() {},
      },
    });

    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/`);
    try {
      const { promise: gotPing, resolve: onServerPing, reject: failPing } = Promise.withResolvers<Buffer>();
      gotPing.catch(() => {});
      ws.binaryType = "nodebuffer";
      ws.addEventListener("ping", e => onServerPing(e.data as Buffer));
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

async function listen(): Promise<URL> {
  const pathname = path.join(import.meta.dir, "./websocket-server-echo.mjs");
  const { promise, resolve, reject } = Promise.withResolvers();
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
