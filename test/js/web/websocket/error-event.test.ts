import { describe, expect, test } from "bun:test";
import { tempDir, tls } from "harness";
import { once } from "node:events";
import net from "node:net";
import { join } from "node:path";
import { closedPort } from "./raw-peer";

test("WebSocket error event snapshot", async () => {
  const ws = new WebSocket("ws://127.0.0.1:8080");
  const { promise, resolve } = Promise.withResolvers();
  ws.onerror = error => {
    resolve(error);
  };
  const error = await promise;
  expect(error).toMatchInlineSnapshot(`ErrorEvent {
  type: "error",
  message: "WebSocket connection to 'ws://127.0.0.1:8080/' failed: Failed to connect", 
  error: [Error: WebSocket connection to 'ws://127.0.0.1:8080/' failed: Failed to connect]
}`);
  expect(Bun.inspect(error)).toMatchInlineSnapshot(`
    "ErrorEvent {
      type: "error",
      message: "WebSocket connection to 'ws://127.0.0.1:8080/' failed: Failed to connect",
      error: error: WebSocket connection to 'ws://127.0.0.1:8080/' failed: Failed to connect
     code: "ECONNREFUSED"

    ,
    }"
  `);
});

test("ErrorEvent with no message", async () => {
  const error = new ErrorEvent("error");
  expect(error.message).toBe("");
  expect(Bun.inspect(error)).toMatchInlineSnapshot(`
    "ErrorEvent {
      type: "error",
      message: "",
      error: null,
    }"
  `);
  expect(error).toMatchInlineSnapshot(`ErrorEvent {
  type: "error",
  message: "", 
  error: null
}`);
});

// Records the events one connection fires, in order. The URL in the error message is replaced with "<url>".
async function recordEvents(ws: WebSocket) {
  const events: unknown[] = [`readyState ${ws.readyState}`];
  const { promise, resolve } = Promise.withResolvers<void>();
  ws.onopen = () => events.push("open");
  ws.onerror = event => {
    const { message, error } = event as ErrorEvent;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(message);
    events.push({ readyState: ws.readyState, message: message.replace(ws.url, "<url>"), code: error.code });
  };
  ws.onclose = ({ code, reason, wasClean }) => {
    events.push({ readyState: ws.readyState, code, reason, wasClean });
    resolve();
  };
  await promise;
  return events;
}

const closed1006 = { readyState: WebSocket.CLOSED, code: 1006, reason: "", wasClean: false };

describe.concurrent("connection fails before open", () => {
  test("connection refused", async () => {
    expect(await recordEvents(new WebSocket(`ws://127.0.0.1:${await closedPort()}/`))).toEqual([
      "readyState 0",
      {
        readyState: WebSocket.CLOSED,
        message: "WebSocket connection to '<url>' failed: Failed to connect",
        code: "ECONNREFUSED",
      },
      closed1006,
    ]);
  });

  test("hostname doesn't resolve", async () => {
    // getaddrinfo rejects DNS labels longer than 63 bytes without sending a query.
    const host = Buffer.alloc(64, "a").toString() + ".com";
    expect(await recordEvents(new WebSocket(`ws://${host}/`))).toEqual([
      "readyState 0",
      {
        readyState: WebSocket.CLOSED,
        message: "WebSocket connection to '<url>' failed: Failed to connect",
        code: "ENOTFOUND",
      },
      closed1006,
    ]);
  });

  // The native connect() fails synchronously here, before the constructor returns.
  test("missing unix socket fires the same events as connection refused", async () => {
    using dir = tempDir("ws-missing-unix-socket", {});
    expect(await recordEvents(new WebSocket(`ws+unix://${join(String(dir), "missing.sock")}`))).toEqual([
      "readyState 0",
      {
        readyState: WebSocket.CLOSED,
        message: "WebSocket connection to '<url>' failed: Failed to connect",
        code: "ENOENT",
      },
      closed1006,
    ]);
  });

  test.each([
    [
      "closes the connection during the handshake",
      (socket: net.Socket) => socket.end(),
      "Connection ended",
      "ECONNRESET",
    ],
    [
      "resets the connection during the handshake",
      (socket: net.Socket) => socket.resetAndDestroy(),
      "Connection ended: read ECONNRESET",
      "ECONNRESET",
    ],
    [
      "doesn't speak HTTP",
      (socket: net.Socket) => socket.end("220 smtp ready\r\n\r\n"),
      "Invalid response",
      "HPE_INVALID_CONSTANT",
    ],
  ])("server %s", async (_label, respond, reason, code) => {
    const server = net.createServer(socket => socket.on("error", () => {}).once("data", () => respond(socket)));
    await once(server.listen(0, "127.0.0.1"), "listening");
    try {
      expect(
        await recordEvents(new WebSocket(`ws://127.0.0.1:${(server.address() as net.AddressInfo).port}/`)),
      ).toEqual([
        "readyState 0",
        { readyState: WebSocket.CLOSED, message: `WebSocket connection to '<url>' failed: ${reason}`, code },
        closed1006,
      ]);
    } finally {
      server.close();
    }
  });

  test("non-101 response", async () => {
    using server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("busy", { status: 503 }) });
    expect(await recordEvents(new WebSocket(`ws://127.0.0.1:${server.port}/`))).toEqual([
      "readyState 0",
      {
        readyState: WebSocket.CLOSED,
        message: "WebSocket connection to '<url>' failed: Expected 101 status code: 503",
        code: undefined,
      },
      closed1006,
    ]);
  });

  test.each([
    ["untrusted certificate", {}, "self signed certificate", "DEPTH_ZERO_SELF_SIGNED_CERT"],
    [
      "certificate hostname mismatch",
      { tls: { ca: tls.cert, serverName: "evil.test" } },
      "Hostname/IP does not match certificate's altnames",
      "ERR_TLS_CERT_ALTNAME_INVALID",
    ],
  ])("%s", async (_label, options, reason, code) => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls,
      fetch: (req, server) => (server.upgrade(req) ? undefined : new Response("no", { status: 400 })),
      websocket: { message() {} },
    });
    const events = await recordEvents(new WebSocket(`wss://127.0.0.1:${server.port}/`, options));
    expect(events).toEqual([
      "readyState 0",
      {
        readyState: WebSocket.CLOSED,
        message: `WebSocket connection to '<url>' failed: TLS handshake failed: ${reason}`,
        code,
      },
      closed1006,
    ]);
  });
});

describe.concurrent("URL credentials are stripped from", () => {
  test("ErrorEvent.message and ErrorEvent.error", async () => {
    using server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("no", { status: 404 }) });
    const ws = new WebSocket(`ws://alice:sekret-password@127.0.0.1:${server.port}/feed?token=tok`);
    const { promise, resolve } = Promise.withResolvers<Event>();
    ws.onerror = resolve;
    const error = (await promise) as ErrorEvent;
    expect(error.message).toStartWith(`WebSocket connection to 'ws://127.0.0.1:${server.port}/feed?token=tok' failed`);
    expect(error.error.message).toBe(error.message);
  });

  test.each([
    [
      "wrong scheme",
      "ftp://alice:sekret-password@127.0.0.1/feed",
      "Wrong url scheme for WebSocket ftp://127.0.0.1/feed",
    ],
    ["fragment", "ws://alice:sekret-password@127.0.0.1/feed#x", "URL has fragment component ws://127.0.0.1/feed#x"],
    ["token as username", "ws://sekret-token@127.0.0.1/feed#x", "URL has fragment component ws://127.0.0.1/feed#x"],
  ])("the constructor's SyntaxError (%s)", (_, url, message) => {
    expect(() => new WebSocket(url)).toThrow(new SyntaxError(message));
  });

  test("MessageEvent.origin", async () => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (req, server) => (server.upgrade(req) ? undefined : new Response("no", { status: 400 })),
      websocket: {
        open(ws) {
          ws.send("text");
          ws.send(new Uint8Array([1]));
        },
        message() {},
      },
    });
    const ws = new WebSocket(`ws://alice:sekret-password@127.0.0.1:${server.port}/feed?token=tok`);
    const origins: string[] = [];
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    ws.onerror = event => reject((event as ErrorEvent).error);
    ws.onmessage = event => {
      if (origins.push(event.origin) === 2) resolve();
    };
    try {
      await promise;
    } finally {
      ws.terminate();
    }
    expect(origins).toEqual([`ws://127.0.0.1:${server.port}`, `ws://127.0.0.1:${server.port}`]);
  });
});
