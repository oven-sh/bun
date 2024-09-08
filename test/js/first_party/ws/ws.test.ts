import type { Subprocess } from "bun";
import { spawn } from "bun";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
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
    for (const { label, type } of binaryTypes) {
      test(label, (ws, done) => {
        ws.binaryType = label;
        ws.on("open", () => {
          expect(ws.binaryType).toBe(label);
          ws.send(new Uint8Array(1));
        });
        ws.on("message", (data, isBinary) => {
          expect(data).toBeInstanceOf(type);
          expect(isBinary).toBeTrue();
          ws.ping();
        });
        ws.on("ping", data => {
          expect(data).toBeInstanceOf(type);
          ws.pong();
        });
        ws.on("pong", data => {
          expect(data).toBeInstanceOf(type);
          done();
        });
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
    { timeout: timeout ?? 1000 },
  );
}

async function listen(): Promise<URL> {
  const pathname = path.resolve(import.meta.dir, "../../web/websocket/websocket-server-echo.mjs");
  const server = spawn({
    cmd: [bunExe(), pathname],
    cwd: import.meta.dir,
    env: bunEnv,
    stderr: "inherit",
    stdout: "pipe",
  });
  servers.push(server);
  for await (const chunk of server.stdout) {
    const text = new TextDecoder().decode(chunk);
    try {
      return new URL(text);
    } catch {
      throw new Error(`Invalid URL: '${text}'`);
    }
  }
  throw new Error("No URL found?");
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
