import { describe, expect, it, mock } from "bun:test";
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

  async function createSplitFrameServer(
    protocol: string,
    payload: Buffer,
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
      let requestData = "";
      let upgraded = false;

      socket.on("error", () => {});

      socket.on("data", data => {
        if (upgraded) return;

        requestData += data.toString("latin1");

        if (!requestData.includes("\r\n\r\n")) {
          return;
        }

        upgraded = true;

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
          `Sec-WebSocket-Protocol: ${protocol}`,
          "\r\n",
        ].join("\r\n");

        socket.write(response);

        const frameHeader = Buffer.from([0x82, 0x7e, payload.length >> 8, payload.length & 0xff]);
        socket.write(frameHeader);
        socket.write(payload);
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

  it("should keep protocol stable after receiving a split frame", async () => {
    const protocol = "v1.kernel.websocket.jupyter.org";
    // 178 bytes fully overwrote the negotiated protocol string before the fix.
    const payload = Buffer.alloc(178, "A");

    await using server = await createSplitFrameServer(protocol, payload);

    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const ws = new WebSocket(`ws://localhost:${server.port}`, [protocol]);
    ws.binaryType = "arraybuffer";

    let protocolAtOpen = "";
    let settled = false;

    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    try {
      ws.onopen = () => {
        protocolAtOpen = ws.protocol;
      };

      ws.onerror = event => {
        rejectOnce(new Error(`unexpected error event: ${event.type}`));
      };

      ws.onclose = event => {
        rejectOnce(new Error(`unexpected close: ${event.code} ${event.reason} (protocolAtOpen=${protocolAtOpen})`));
      };

      ws.onmessage = event => {
        try {
          expect(ws.protocol).toBe(protocol);
          expect(protocolAtOpen).toBe(protocol);
          expect(event.data).toBeInstanceOf(ArrayBuffer);
          expect((event.data as ArrayBuffer).byteLength).toBe(payload.length);
          resolveOnce();
        } catch (error) {
          rejectOnce(error);
        } finally {
          ws.terminate();
        }
      };

      await promise;
    } finally {
      ws.terminate();
    }
  });
});
