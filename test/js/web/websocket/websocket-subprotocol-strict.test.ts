import { describe, expect, it } from "bun:test";
import crypto from "node:crypto";
import net from "node:net";
import { WebSocket as WsWebSocket } from "ws";

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

  /** The connection fails: an 'error' event, then a 'close' that is not clean. */
  async function expectConnectionFailure(
    port: number,
    protocols: string[],
    expectedCode = 1002,
    reason = "Mismatch client protocol",
  ) {
    const { promise: closePromise, resolve: resolveClose, reject } = Promise.withResolvers<void>();

    const ws = new WebSocket(`ws://localhost:${port}`, protocols);
    ws.onopen = () => {
      reject(new Error(`the connection opened with the protocol "${ws.protocol}"`));
      ws.terminate();
    };

    const events: string[] = [];
    ws.onerror = error => events.push(`error: ${(error as ErrorEvent).message}`);
    ws.onclose = close => {
      events.push(`close: ${close.code} ${close.reason}, wasClean ${close.wasClean}`);
      resolveClose();
    };

    await closePromise;
    expect(events).toEqual([
      `error: WebSocket connection to 'ws://localhost:${port}/' failed: ${reason}`,
      `close: ${expectedCode} ${reason}, wasClean false`,
    ]);
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
    await expectConnectionFailure(server.port, ["chat", "echo"], 1002, "Missing client protocol");

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

  it.each([
    ["a subprotocol that was not requested", ["Sec-WebSocket-Protocol: unknown"], "Mismatch client protocol"],
    ["no subprotocol", [], "Missing client protocol"],
  ])("the client of the ws module gets 'error', then 'close', for %s", async (_answer, headers, reason) => {
    await using server = await createTestServer(headers);
    const { promise: closePromise, resolve: resolveClose, reject } = Promise.withResolvers<void>();

    const ws = new WsWebSocket(`ws://localhost:${server.port}`, ["chat", "echo"]);
    ws.on("open", () => {
      reject(new Error(`the connection opened with the protocol "${ws.protocol}"`));
      ws.terminate();
    });

    const events: string[] = [];
    ws.on("error", error => events.push(`error: ${error.message}`));
    ws.on("close", code => {
      events.push(`close: ${code}`);
      resolveClose();
    });

    await closePromise;
    expect(events).toEqual([
      `error: WebSocket connection to 'ws://localhost:${server.port}/' failed: ${reason}`,
      "close: 1002",
    ]);
  });
});
