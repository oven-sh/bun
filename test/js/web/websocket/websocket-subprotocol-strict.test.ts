import { describe, expect, it, mock } from "bun:test";
import crypto from "node:crypto";
import net from "node:net";

// A byte-controlled RFC 6455 server: replies with a valid 101 plus whatever
// extra response headers the test crafts. Used to exercise the client-side
// handshake response validation in process_response().
async function createTestServer(
  responseHeaders: string[],
): Promise<{ port: number; [Symbol.asyncDispose]: () => Promise<void> }> {
  const server = net.createServer();
  let port: number;

  await new Promise<void>(resolve => {
    server.listen(0, "127.0.0.1", () => {
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
      await new Promise<void>((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()));
      });
    },
  };
}

function connect(port: number, protocols: string[] | undefined) {
  const url = `ws://127.0.0.1:${port}`;
  // `undefined` means "no protocols argument at all", i.e. the default options.
  return protocols === undefined ? new WebSocket(url) : new WebSocket(url, protocols);
}

// A failed handshake must never reach `open`, must surface exactly one
// `error` event, and must close with `wasClean: false`.
async function expectConnectionFailure(
  port: number,
  protocols: string[] | undefined,
  expectedCode = 1002,
  expectedReason = "Mismatch client protocol",
) {
  const { promise: closePromise, resolve: resolveClose, reject: rejectClose } = Promise.withResolvers<CloseEvent>();

  const ws = connect(port, protocols);
  const onerrorMock = mock(() => {});
  ws.onopen = () => rejectClose(new Error("handshake unexpectedly succeeded: open event fired"));
  ws.onerror = onerrorMock;
  ws.onclose = resolveClose;

  try {
    const close = await closePromise;
    expect(onerrorMock).toHaveBeenCalledTimes(1);
    expect({ code: close.code, reason: close.reason, wasClean: close.wasClean }).toEqual({
      code: expectedCode,
      reason: expectedReason,
      wasClean: false,
    });
  } finally {
    ws.terminate();
  }
}

async function expectConnectionSuccess(port: number, protocols: string[] | undefined, expectedProtocol: string) {
  const { promise: openPromise, resolve: resolveOpen, reject } = Promise.withResolvers();
  const ws = connect(port, protocols);
  try {
    ws.onopen = () => resolveOpen();
    ws.onerror = reject;
    ws.onclose = e => reject(new Error(`closed: code=${e.code} reason=${e.reason}`));
    await openPromise;
    expect(ws.protocol).toBe(expectedProtocol);
  } finally {
    ws.terminate();
  }
}

describe("WebSocket strict RFC 6455 subprotocol handling", () => {
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

  // RFC 6455 §4.1 / WHATWG "establish a WebSocket connection" step 4: if
  // the client requested subprotocols, a 101 that selects none of them
  // must fail the connection.
  it("should reject a response with no Sec-WebSocket-Protocol when protocols were requested", async () => {
    await using server = await createTestServer([]);
    await expectConnectionFailure(server.port, ["chat", "echo"], 1002, "Server sent no subprotocol");
  });

  it("should reject a response with no Sec-WebSocket-Protocol when a single protocol was requested", async () => {
    await using server = await createTestServer([]);
    await expectConnectionFailure(server.port, ["chat"], 1002, "Server sent no subprotocol");
  });

  // Valid cases - should succeed
  it("should accept a response with no Sec-WebSocket-Protocol when none was requested", async () => {
    await using server = await createTestServer([]);
    await expectConnectionSuccess(server.port, undefined, "");
  });

  it("should accept a response with no Sec-WebSocket-Protocol when the protocol list is empty", async () => {
    await using server = await createTestServer([]);
    await expectConnectionSuccess(server.port, [], "");
  });

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

    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`, ["chat", "echo"]);
    const onopenMock = mock(() => {});
    ws.onopen = onopenMock;
    ws.onclose = close => resolveClose(close);

    const close = await closePromise;
    expect({ code: close.code, reason: close.reason, wasClean: close.wasClean }).toEqual({
      code: 1002,
      reason: "Server sent no subprotocol",
      wasClean: false,
    });
    expect(onopenMock).not.toHaveBeenCalled();

    const { promise: openPromise, resolve: resolveOpen, reject } = Promise.withResolvers<void>();
    const bare = new WebSocket(`ws://127.0.0.1:${server.port}`);
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

// RFC 6455 §4.1 step 4: a Sec-WebSocket-Extensions response that indicates an
// extension not present in the client's handshake must fail the connection.
// The default client offers only permessage-deflate.
describe("WebSocket strict RFC 6455 extension handling", () => {
  it("should reject an extension the client never offered", async () => {
    await using server = await createTestServer(["Sec-WebSocket-Extensions: x-bogus-ext"]);
    await expectConnectionFailure(server.port, undefined, 1002, "Invalid Sec-WebSocket-Extensions header");
  });

  it("should reject an unoffered extension listed after permessage-deflate", async () => {
    await using server = await createTestServer(["Sec-WebSocket-Extensions: permessage-deflate, x-bogus-ext"]);
    await expectConnectionFailure(server.port, undefined, 1002, "Invalid Sec-WebSocket-Extensions header");
  });

  it("should reject an unoffered extension listed before permessage-deflate", async () => {
    await using server = await createTestServer(["Sec-WebSocket-Extensions: x-bogus-ext, permessage-deflate"]);
    await expectConnectionFailure(server.port, undefined, 1002, "Invalid Sec-WebSocket-Extensions header");
  });

  it("should reject an unoffered extension carrying parameters", async () => {
    await using server = await createTestServer(["Sec-WebSocket-Extensions: x-bogus-ext; foo=bar"]);
    await expectConnectionFailure(server.port, undefined, 1002, "Invalid Sec-WebSocket-Extensions header");
  });

  // RFC 7692 §5: the response must not list permessage-deflate more than once.
  it("should reject a duplicate permessage-deflate in one header", async () => {
    await using server = await createTestServer([
      "Sec-WebSocket-Extensions: permessage-deflate; server_max_window_bits=12, permessage-deflate; server_max_window_bits=10",
    ]);
    await expectConnectionFailure(server.port, undefined, 1002, "Invalid Sec-WebSocket-Extensions header");
  });

  it("should reject permessage-deflate repeated across two Sec-WebSocket-Extensions headers", async () => {
    await using server = await createTestServer([
      "Sec-WebSocket-Extensions: permessage-deflate",
      "Sec-WebSocket-Extensions: permessage-deflate",
    ]);
    await expectConnectionFailure(server.port, undefined, 1002, "Invalid Sec-WebSocket-Extensions header");
  });

  it("should still accept a plain permessage-deflate response", async () => {
    await using server = await createTestServer(["Sec-WebSocket-Extensions: permessage-deflate"]);
    const { promise: openPromise, resolve: resolveOpen, reject } = Promise.withResolvers();
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
    try {
      ws.onopen = () => resolveOpen();
      ws.onerror = reject;
      ws.onclose = e => reject(new Error(`closed: code=${e.code} reason=${e.reason}`));
      await openPromise;
      expect(ws.extensions).toContain("permessage-deflate");
    } finally {
      ws.terminate();
    }
  });

  it("should still accept permessage-deflate with parameters", async () => {
    await using server = await createTestServer([
      "Sec-WebSocket-Extensions: permessage-deflate; server_no_context_takeover; client_no_context_takeover",
    ]);
    await expectConnectionSuccess(server.port, undefined, "");
  });

  it("should ignore empty list elements such as a trailing comma", async () => {
    await using server = await createTestServer(["Sec-WebSocket-Extensions: permessage-deflate,"]);
    await expectConnectionSuccess(server.port, undefined, "");
  });
});
