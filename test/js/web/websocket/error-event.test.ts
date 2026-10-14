import { describe, expect, test } from "bun:test";
import { isWindows, tempDir, tls } from "harness";
import { once } from "node:events";
import net from "node:net";
import { join } from "node:path";

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

// What script sees of one connection, in order. `url` is replaced in the error's text.
async function record(ws: WebSocket) {
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

async function refusedPort() {
  const server = net.createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as net.AddressInfo;
  server.close();
  await once(server, "close");
  return port;
}

describe.concurrent("a connection that fails before it opens", () => {
  test("a refused connection", async () => {
    expect(await record(new WebSocket(`ws://127.0.0.1:${await refusedPort()}/`))).toEqual([
      "readyState 0",
      {
        readyState: WebSocket.CLOSED,
        message: "WebSocket connection to '<url>' failed: Failed to connect",
        code: "ECONNREFUSED",
      },
      closed1006,
    ]);
  });

  // The native connect() finds this one out before the constructor returns.
  test.skipIf(isWindows)("a unix socket that does not exist looks like a refused connection", async () => {
    using dir = tempDir("ws-missing-unix-socket", {});
    expect(await record(new WebSocket(`ws+unix://${join(String(dir), "missing.sock")}`))).toEqual([
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
    ["ends during the handshake", (socket: net.Socket) => socket.end(), "Connection ended", "ECONNRESET"],
    [
      "does not speak HTTP",
      (socket: net.Socket) => socket.end("220 smtp ready\r\n\r\n"),
      "Invalid response",
      "HPE_INVALID_CONSTANT",
    ],
  ])("a server that %s", async (_label, answer, text, code) => {
    const server = net.createServer(socket => socket.on("error", () => {}).once("data", () => answer(socket)));
    await once(server.listen(0, "127.0.0.1"), "listening");
    try {
      expect(await record(new WebSocket(`ws://127.0.0.1:${(server.address() as net.AddressInfo).port}/`))).toEqual([
        "readyState 0",
        { readyState: WebSocket.CLOSED, message: `WebSocket connection to '<url>' failed: ${text}`, code },
        closed1006,
      ]);
    } finally {
      server.close();
    }
  });

  test("a response that is not a 101", async () => {
    using server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("busy", { status: 503 }) });
    expect(await record(new WebSocket(`ws://127.0.0.1:${server.port}/`))).toEqual([
      "readyState 0",
      {
        readyState: WebSocket.CLOSED,
        message: "WebSocket connection to '<url>' failed: Expected 101 status code: 503",
        code: undefined,
      },
      closed1006,
    ]);
  });

  test("a certificate that is not trusted", async () => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls,
      fetch: (req, server) => (server.upgrade(req) ? undefined : new Response("no", { status: 400 })),
      websocket: { message() {} },
    });
    const events = await record(new WebSocket(`wss://127.0.0.1:${server.port}/`));
    expect(events).toEqual([
      "readyState 0",
      {
        readyState: WebSocket.CLOSED,
        message: "WebSocket connection to '<url>' failed: TLS handshake failed: self signed certificate",
        code: "DEPTH_ZERO_SELF_SIGNED_CERT",
      },
      closed1006,
    ]);
  });
});

describe.concurrent("the URL's credentials stay out of", () => {
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
    ["a token as the user", "ws://sekret-token@127.0.0.1/feed#x", "URL has fragment component ws://127.0.0.1/feed#x"],
  ])("the constructor's SyntaxError (%s)", (_, url, message) => {
    expect(() => new WebSocket(url)).toThrow(new SyntaxError(message));
  });

  test("MessageEvent.origin, which is the origin of the URL", async () => {
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
