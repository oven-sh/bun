import type { Subprocess } from "bun";
import { spawn } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, nodeExe } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import type { AddressInfo } from "node:net";
import { createServer } from "node:net";
import * as path from "node:path";
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

describe("WebSocket AsyncLocalStorage context", () => {
  it("dispatches events in the context active at construction", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("Upgrade failed", { status: 500 });
      },
      websocket: {
        open(ws) {
          ws.send("hello");
        },
        message(ws) {
          ws.close(1000, "done");
        },
      },
    });

    const als = new AsyncLocalStorage<string>();
    const contexts: Record<string, string | undefined> = {};
    const { promise, resolve, reject } = Promise.withResolvers<void>();

    als.run("creation-context", () => {
      const ws = new WebSocket(`ws://${server.hostname}:${server.port}`);
      ws.onopen = () => {
        contexts.open = als.getStore();
        ws.send("x");
      };
      ws.onmessage = () => {
        contexts.message = als.getStore();
      };
      ws.addEventListener("close", () => {
        contexts.closeListener = als.getStore();
      });
      ws.onclose = () => {
        contexts.close = als.getStore();
        resolve();
      };
      ws.onerror = () => reject(new Error("unexpected error event"));
    });

    await promise;
    expect(contexts).toEqual({
      open: "creation-context",
      message: "creation-context",
      closeListener: "creation-context",
      close: "creation-context",
    });
  });

  it("keeps the captured context alive across garbage collection", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("Upgrade failed", { status: 500 });
      },
      websocket: {
        open() {},
        message(ws) {
          ws.send("pong");
          ws.close(1000, "done");
        },
      },
    });

    const als = new AsyncLocalStorage<{ id: string }>();
    const contexts: Record<string, unknown> = {};
    const opened = Promise.withResolvers<WebSocket>();
    const closed = Promise.withResolvers<void>();

    // Once this IIFE returns, the captured async context is only reachable
    // through the WebSocket, so it must be visited from the JS wrapper.
    (function create() {
      als.run({ id: "creation-context" }, () => {
        const ws = new WebSocket(`ws://${server.hostname}:${server.port}`);
        ws.onopen = () => {
          contexts.open = als.getStore();
          opened.resolve(ws);
        };
        ws.onmessage = () => {
          contexts.message = als.getStore();
        };
        ws.onclose = () => {
          contexts.close = als.getStore();
          closed.resolve();
        };
        ws.onerror = () => closed.reject(new Error("unexpected error event"));
      });
    })();

    const ws = await opened.promise;
    Bun.gc(true);
    Bun.gc(true);
    ws.send("ping");
    await closed.promise;
    expect(contexts).toEqual({
      open: { id: "creation-context" },
      message: { id: "creation-context" },
      close: { id: "creation-context" },
    });
  });

  it("dispatches error and close events in the context active at construction", async () => {
    // The upgrade never completes: the server destroys the socket, so the
    // client goes down the connection-error path (error + close events).
    const tcpServer = createServer(socket => socket.destroy());
    const listening = Promise.withResolvers<void>();
    tcpServer.once("error", listening.reject);
    tcpServer.listen(0, "127.0.0.1", listening.resolve);
    await listening.promise;
    const { port } = tcpServer.address() as AddressInfo;

    try {
      const als = new AsyncLocalStorage<string>();
      const contexts: Record<string, string | undefined> = {};
      const { promise, resolve } = Promise.withResolvers<void>();

      als.run("creation-context", () => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        ws.onerror = () => {
          contexts.error = als.getStore();
        };
        ws.onclose = () => {
          contexts.close = als.getStore();
          resolve();
        };
      });

      await promise;
      expect(contexts).toEqual({
        error: "creation-context",
        close: "creation-context",
      });
    } finally {
      tcpServer.close();
    }
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
