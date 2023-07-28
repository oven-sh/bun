import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import type { Subprocess } from "bun";
import { spawn } from "bun";
import { bunEnv, bunExe, nodeExe } from "harness";
import { WebSocket } from "ws";

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
  const { pathname } = new URL("../../web/websocket/websocket-server-echo.mjs", import.meta.url);
  const server = spawn({
    cmd: [nodeExe() ?? bunExe(), pathname],
    cwd: import.meta.dir,
    env: bunEnv,
    stderr: "ignore",
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
