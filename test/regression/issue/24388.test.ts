import { expect, test } from "bun:test";

// Test for GitHub issue #24388
// WebSocket should forward Basic Authentication credentials from URL to server

test("WebSocket URL with embedded credentials sends Authorization header", async () => {
  using server = Bun.serve({
    port: 0,
    fetch(req, server) {
      if (req.headers.get("upgrade") === "websocket") {
        const authHeader = req.headers.get("authorization");
        if (server.upgrade(req, { data: { authHeader } })) {
          return undefined;
        }
        return new Response("Upgrade failed", { status: 500 });
      }
      return new Response("Not Found", { status: 404 });
    },
    websocket: {
      open(ws) {
        ws.send((ws.data as { authHeader: string | null }).authHeader ?? "null");
      },
      message() {},
      close() {},
    },
  });

  const { promise: messagePromise, resolve: resolveMessage, reject } = Promise.withResolvers<string>();
  const { promise: closePromise, resolve: resolveClose } = Promise.withResolvers<void>();
  const ws = new WebSocket(`ws://testuser:testpass@localhost:${server.port}/`);

  ws.onmessage = event => {
    resolveMessage(event.data);
    ws.close();
  };
  ws.onerror = () => reject(new Error("WebSocket error"));
  ws.onclose = () => resolveClose();

  const authHeader = await messagePromise;
  const expected = `Basic ${Buffer.from("testuser:testpass").toString("base64")}`;
  expect(authHeader).toBe(expected);
  await closePromise;
});

test("WebSocket URL with empty password sends Authorization header", async () => {
  using server = Bun.serve({
    port: 0,
    fetch(req, server) {
      if (req.headers.get("upgrade") === "websocket") {
        const authHeader = req.headers.get("authorization");
        if (server.upgrade(req, { data: { authHeader } })) {
          return undefined;
        }
        return new Response("Upgrade failed", { status: 500 });
      }
      return new Response("Not Found", { status: 404 });
    },
    websocket: {
      open(ws) {
        ws.send((ws.data as { authHeader: string | null }).authHeader ?? "null");
      },
      message() {},
      close() {},
    },
  });

  const { promise: messagePromise, resolve: resolveMessage, reject } = Promise.withResolvers<string>();
  const { promise: closePromise, resolve: resolveClose } = Promise.withResolvers<void>();
  const ws = new WebSocket(`ws://testuser:@localhost:${server.port}/`);

  ws.onmessage = event => {
    resolveMessage(event.data);
    ws.close();
  };
  ws.onerror = () => reject(new Error("WebSocket error"));
  ws.onclose = () => resolveClose();

  const authHeader = await messagePromise;
  const expected = `Basic ${Buffer.from("testuser:").toString("base64")}`;
  expect(authHeader).toBe(expected);
  await closePromise;
});

test("WebSocket URL without credentials does not send Authorization header", async () => {
  using server = Bun.serve({
    port: 0,
    fetch(req, server) {
      if (req.headers.get("upgrade") === "websocket") {
        const authHeader = req.headers.get("authorization");
        if (server.upgrade(req, { data: { authHeader } })) {
          return undefined;
        }
        return new Response("Upgrade failed", { status: 500 });
      }
      return new Response("Not Found", { status: 404 });
    },
    websocket: {
      open(ws) {
        ws.send((ws.data as { authHeader: string | null }).authHeader ?? "null");
      },
      message() {},
      close() {},
    },
  });

  const { promise: messagePromise, resolve: resolveMessage, reject } = Promise.withResolvers<string>();
  const { promise: closePromise, resolve: resolveClose } = Promise.withResolvers<void>();
  const ws = new WebSocket(`ws://localhost:${server.port}/`);

  ws.onmessage = event => {
    resolveMessage(event.data);
    ws.close();
  };
  ws.onerror = () => reject(new Error("WebSocket error"));
  ws.onclose = () => resolveClose();

  const authHeader = await messagePromise;
  expect(authHeader).toBe("null");
  await closePromise;
});

test("WebSocket custom Authorization header takes precedence over URL credentials", async () => {
  using server = Bun.serve({
    port: 0,
    fetch(req, server) {
      if (req.headers.get("upgrade") === "websocket") {
        const authHeader = req.headers.get("authorization");
        if (server.upgrade(req, { data: { authHeader } })) {
          return undefined;
        }
        return new Response("Upgrade failed", { status: 500 });
      }
      return new Response("Not Found", { status: 404 });
    },
    websocket: {
      open(ws) {
        ws.send((ws.data as { authHeader: string | null }).authHeader ?? "null");
      },
      message() {},
      close() {},
    },
  });

  const { promise: messagePromise, resolve: resolveMessage, reject } = Promise.withResolvers<string>();
  const { promise: closePromise, resolve: resolveClose } = Promise.withResolvers<void>();
  const ws = new WebSocket(`ws://testuser:testpass@localhost:${server.port}/`, {
    headers: {
      Authorization: "Bearer custom-token",
    },
  });

  ws.onmessage = event => {
    resolveMessage(event.data);
    ws.close();
  };
  ws.onerror = () => reject(new Error("WebSocket error"));
  ws.onclose = () => resolveClose();

  const authHeader = await messagePromise;
  expect(authHeader).toBe("Bearer custom-token");
  await closePromise;
});

test("WebSocket URL with special characters in credentials sends Authorization header", async () => {
  using server = Bun.serve({
    port: 0,
    fetch(req, server) {
      if (req.headers.get("upgrade") === "websocket") {
        const authHeader = req.headers.get("authorization");
        if (server.upgrade(req, { data: { authHeader } })) {
          return undefined;
        }
        return new Response("Upgrade failed", { status: 500 });
      }
      return new Response("Not Found", { status: 404 });
    },
    websocket: {
      open(ws) {
        ws.send((ws.data as { authHeader: string | null }).authHeader ?? "null");
      },
      message() {},
      close() {},
    },
  });

  const { promise: messagePromise, resolve: resolveMessage, reject } = Promise.withResolvers<string>();
  const { promise: closePromise, resolve: resolveClose } = Promise.withResolvers<void>();
  // URL-encoded special characters (user@example.com:p@ss:word)
  const ws = new WebSocket(`ws://user%40example.com:p%40ss%3Aword@localhost:${server.port}/`);

  ws.onmessage = event => {
    resolveMessage(event.data);
    ws.close();
  };
  ws.onerror = () => reject(new Error("WebSocket error"));
  ws.onclose = () => resolveClose();

  const authHeader = await messagePromise;
  const expected = `Basic ${Buffer.from("user@example.com:p@ss:word").toString("base64")}`;
  expect(authHeader).toBe(expected);
  await closePromise;
});
