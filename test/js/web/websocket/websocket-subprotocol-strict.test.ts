import { setSyntheticAllocationLimitForTesting } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import crypto from "node:crypto";
import net from "node:net";

describe("WebSocket strict RFC 6455 subprotocol handling", () => {
  async function createTestServer(
    responseHeaders: string[],
  ): Promise<{ port: number; [Symbol.asyncDispose]: () => Promise<void> }> {
    const server = net.createServer();
    let port: number;

    await new Promise<void>(resolve => {
      server.listen(0, () => {
        port = (server.address() as any).port;
        resolve();
      });
    });

    server.on("connection", socket => {
      // Raw test server: tolerate client aborts, surface anything unexpected.
      socket.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code !== "ECONNRESET" && err.code !== "EPIPE" && err.code !== "ECONNABORTED") throw err;
      });
      let requestData = "";

      socket.on("data", data => {
        requestData += data.toString();

        if (requestData.includes("\r\n\r\n")) {
          const lines = requestData.split("\r\n");
          let websocketKey = "";

          for (const line of lines) {
            if (line.startsWith("Sec-WebSocket-Key:")) {
              websocketKey = line.split(":")[1].trim();
              break;
            }
          }

          const acceptKey = crypto
            .createHash("sha1")
            .update(websocketKey + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
            .digest("base64");

          const response = [
            "HTTP/1.1 101 Switching Protocols",
            "Upgrade: websocket",
            "Connection: Upgrade",
            `Sec-WebSocket-Accept: ${acceptKey}`,
            ...responseHeaders,
            "\r\n",
          ].join("\r\n");

          socket.write(response);
        }
      });
    });

    return {
      port: port!,
      [Symbol.asyncDispose]: async () => {
        server.close();
      },
    };
  }

  async function expectConnectionFailure(port: number, protocols: string[], expectedCode = 1002) {
    const { promise: closePromise, resolve: resolveClose } = Promise.withResolvers();

    const ws = new WebSocket(`ws://localhost:${port}`, protocols);
    const onopenMock = mock(() => {});
    ws.onopen = onopenMock;

    ws.onclose = close => {
      expect(close.code).toBe(expectedCode);
      expect(close.reason).toBe("Mismatch client protocol");
      resolveClose();
    };

    await closePromise;
    expect(onopenMock).not.toHaveBeenCalled();
  }

  async function expectConnectionSuccess(port: number, protocols: string[], expectedProtocol: string) {
    const { promise: openPromise, resolve: resolveOpen, reject } = Promise.withResolvers();
    const ws = new WebSocket(`ws://localhost:${port}`, protocols);
    try {
      ws.onopen = () => resolveOpen();
      ws.onerror = reject;
      await openPromise;
      expect(ws.protocol).toBe(expectedProtocol);
    } finally {
      ws.terminate();
    }
  }
  // Multiple protocols in single header (comma-separated) - should fail
  it("should reject multiple comma-separated protocols", async () => {
    await using server = await createTestServer(["Sec-WebSocket-Protocol: chat, echo"]);
    await expectConnectionFailure(server.port, ["chat", "echo"]);
  });

  it("should reject multiple comma-separated protocols with spaces", async () => {
    await using server = await createTestServer(["Sec-WebSocket-Protocol: chat , echo , binary"]);
    await expectConnectionFailure(server.port, ["chat", "echo", "binary"]);
  });

  it("should reject multiple comma-separated protocols (3 protocols)", async () => {
    await using server = await createTestServer(["Sec-WebSocket-Protocol: a,b,c"]);
    await expectConnectionFailure(server.port, ["a", "b", "c"]);
  });

  // Multiple headers - should fail
  it("should reject duplicate Sec-WebSocket-Protocol headers (same value)", async () => {
    await using server = await createTestServer(["Sec-WebSocket-Protocol: chat", "Sec-WebSocket-Protocol: chat"]);
    await expectConnectionFailure(server.port, ["chat", "echo"]);
  });

  it("should reject duplicate Sec-WebSocket-Protocol headers (different values)", async () => {
    await using server = await createTestServer(["Sec-WebSocket-Protocol: chat", "Sec-WebSocket-Protocol: echo"]);
    await expectConnectionFailure(server.port, ["chat", "echo"]);
  });

  it("should reject three Sec-WebSocket-Protocol headers", async () => {
    await using server = await createTestServer([
      "Sec-WebSocket-Protocol: a",
      "Sec-WebSocket-Protocol: b",
      "Sec-WebSocket-Protocol: c",
    ]);
    await expectConnectionFailure(server.port, ["a", "b", "c"]);
  });

  // Empty values - should fail
  it("should reject empty Sec-WebSocket-Protocol header", async () => {
    await using server = await createTestServer(["Sec-WebSocket-Protocol: "]);
    await expectConnectionFailure(server.port, ["chat", "echo"]);
  });

  it("should reject Sec-WebSocket-Protocol with only comma", async () => {
    await using server = await createTestServer(["Sec-WebSocket-Protocol: ,"]);
    await expectConnectionFailure(server.port, ["chat", "echo"]);
  });

  it("should reject Sec-WebSocket-Protocol with only spaces", async () => {
    await using server = await createTestServer(["Sec-WebSocket-Protocol:    "]);
    await expectConnectionFailure(server.port, ["chat", "echo"]);
  });

  // Unknown protocols - should fail
  it("should reject unknown single protocol", async () => {
    await using server = await createTestServer(["Sec-WebSocket-Protocol: unknown"]);
    await expectConnectionFailure(server.port, ["chat", "echo"]);
  });

  it("should reject unknown protocol (not in client list)", async () => {
    await using server = await createTestServer(["Sec-WebSocket-Protocol: binary"]);
    await expectConnectionFailure(server.port, ["chat", "echo"]);
  });

  // Valid cases - should succeed
  it("should accept single valid protocol (first in client list)", async () => {
    await using server = await createTestServer(["Sec-WebSocket-Protocol: chat"]);
    await expectConnectionSuccess(server.port, ["chat", "echo", "binary"], "chat");
  });

  it("should accept single valid protocol (middle in client list)", async () => {
    await using server = await createTestServer(["Sec-WebSocket-Protocol: echo"]);
    await expectConnectionSuccess(server.port, ["chat", "echo", "binary"], "echo");
  });

  it("should accept single valid protocol (last in client list)", async () => {
    await using server = await createTestServer(["Sec-WebSocket-Protocol: binary"]);
    await expectConnectionSuccess(server.port, ["chat", "echo", "binary"], "binary");
  });

  it("should accept single protocol with extra whitespace", async () => {
    await using server = await createTestServer(["Sec-WebSocket-Protocol:   echo   "]);
    await expectConnectionSuccess(server.port, ["chat", "echo"], "echo");
  });

  it("should accept single protocol with single character", async () => {
    await using server = await createTestServer(["Sec-WebSocket-Protocol: a"]);
    await expectConnectionSuccess(server.port, ["a", "b"], "a");
  });

  // Edge cases with special characters
  it("should handle protocol with special characters", async () => {
    await using server = await createTestServer(["Sec-WebSocket-Protocol: chat-v2.0"]);
    await expectConnectionSuccess(server.port, ["chat-v1.0", "chat-v2.0"], "chat-v2.0");
  });

  it("should handle protocol with dots", async () => {
    await using server = await createTestServer(["Sec-WebSocket-Protocol: com.example.chat"]);
    await expectConnectionSuccess(server.port, ["com.example.chat", "other"], "com.example.chat");
  });

  it("should fail the connection when subprotocols were requested but the server omits the Sec-WebSocket-Protocol header, and should connect without a subprotocol when none were requested and the server sends none", async () => {
    await using server = await createTestServer([]);
    const { promise: closePromise, resolve: resolveClose } = Promise.withResolvers<CloseEvent>();

    const ws = new WebSocket(`ws://localhost:${server.port}`, ["chat", "echo"]);
    const onopenMock = mock(() => {});
    ws.onopen = onopenMock;
    ws.onclose = close => resolveClose(close);

    const close = await closePromise;
    expect(close.code).toBe(1002);
    expect(close.reason).toBe("Missing client protocol");
    expect(onopenMock).not.toHaveBeenCalled();

    const { promise: openPromise, resolve: resolveOpen, reject } = Promise.withResolvers<void>();
    const bare = new WebSocket(`ws://localhost:${server.port}`);
    try {
      bare.onopen = () => resolveOpen();
      bare.onerror = reject;
      bare.onclose = close => reject(new Error(`unexpected close: ${close.code} ${close.reason}`));
      await openPromise;
      expect(bare.protocol).toBe("");
    } finally {
      bare.terminate();
    }
  });
});

// Each of these error messages quotes a value that script supplies. An
// unbounded quote builds a string past String::MaxLength (2^31-1) and aborts
// the process, because makeString() and StringBuilder both crash on overflow.
// Every quote is bounded to 1024 characters plus an ellipsis now.
describe("WebSocket error messages bound the value they quote", () => {
  // 200000 characters: far below String::MaxLength, far above the 1024 bound.
  const longAscii = Buffer.alloc(200_000, 0x61).toString("latin1");
  const longLatin1 = Buffer.alloc(200_000, 0xff).toString("latin1");

  function thrown(run: () => void): Error {
    try {
      run();
    } catch (error) {
      return error as Error;
    }
    throw new Error("the call did not throw");
  }

  it("an invalid subprotocol", () => {
    const error = thrown(() => new WebSocket("ws://127.0.0.1:1/", [longLatin1]));
    expect(error.name).toBe("SyntaxError");
    expect(error.message).toStartWith("Wrong protocol for WebSocket '\\u00FF\\u00FF");
    expect(error.message).toEndWith("\\u00FF...'");
    expect(error.message.length).toBeLessThan(1200);
  });

  it("a duplicate subprotocol", () => {
    const error = thrown(() => new WebSocket("ws://127.0.0.1:1/", [longAscii, longAscii]));
    expect(error.name).toBe("SyntaxError");
    expect(error.message).toStartWith("WebSocket protocols contain duplicates: 'aa");
    expect(error.message).toEndWith("a...'");
    expect(error.message.length).toBeLessThan(1200);
  });

  it("an invalid proxy URL", () => {
    const error = thrown(() => new WebSocket("ws://127.0.0.1:1/", { proxy: longAscii }));
    expect(error.name).toBe("SyntaxError");
    expect(error.message).toStartWith("Invalid proxy URL: aa");
    expect(error.message).toContain("...");
    expect(error.message.length).toBeLessThan(1200);
  });

  it("an unsupported proxy protocol", () => {
    const error = thrown(() => new WebSocket("ws://127.0.0.1:1/", { proxy: `${longAscii}://host` }));
    expect(error.name).toBe("SyntaxError");
    expect(error.message).toStartWith('Unsupported proxy protocol "aa');
    expect(error.message).toEndWith('a..." (expected "http" or "https")');
    expect(error.message.length).toBeLessThan(1200);
  });

  it("an invalid binaryType", () => {
    const socket = new WebSocket("ws://127.0.0.1:1/");
    socket.onerror = () => {};
    try {
      const error = thrown(() => {
        socket.binaryType = longAscii as any;
      });
      expect(error.name).toBe("SyntaxError");
      expect(error.message).toStartWith("'aa");
      expect(error.message).toEndWith("a...' is not a valid value for binaryType; binaryType remains unchanged.");
      expect(error.message.length).toBeLessThan(1200);
    } finally {
      socket.terminate();
    }
  });
});

// joinStrings() builds the Sec-WebSocket-Protocol header value, so it cannot
// truncate. A list that does not fit in one string has to throw. The real
// limit is String::MaxLength, which needs 2 GiB of live strings to reach, so
// lower the process-wide string limit instead.
describe("WebSocket subprotocol list that does not fit in one string", () => {
  const ALLOCATION_LIMIT = 4 * 1024 * 1024;

  // The limit is process-wide, so put it back for whatever runs after this.
  let previousLimit: number;
  beforeAll(() => {
    previousLimit = setSyntheticAllocationLimitForTesting(ALLOCATION_LIMIT);
  });
  afterAll(() => {
    setSyntheticAllocationLimitForTesting(previousLimit);
  });

  it("throws RangeError: Out of memory instead of aborting", () => {
    const first = Buffer.alloc(3 * 1024 * 1024, 0x61).toString("latin1");
    const second = Buffer.alloc(3 * 1024 * 1024, 0x62).toString("latin1");

    let socket: WebSocket | undefined;
    try {
      expect(() => {
        socket = new WebSocket("ws://127.0.0.1:1/", [first, second]);
      }).toThrow(expect.objectContaining({ name: "RangeError", message: "Out of memory" }));
    } finally {
      socket?.terminate();
    }
  });

  it("still accepts a list that fits", () => {
    const socket = new WebSocket("ws://127.0.0.1:1/", ["chat", "echo"]);
    socket.onerror = () => {};
    socket.terminate();
  });
});
