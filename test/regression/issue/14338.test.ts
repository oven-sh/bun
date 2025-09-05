import { expect, test } from "bun:test";

test("WebSocket should emit error event before close event on handshake failure (issue #14338)", async () => {
  const { promise: errorPromise, resolve: resolveError } = Promise.withResolvers<Event>();
  const { promise: closePromise, resolve: resolveClose } = Promise.withResolvers<CloseEvent>();
  const events: string[] = [];

  // Create a server that returns a 302 redirect response instead of a WebSocket upgrade
  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      // Return a 302 redirect response to simulate handshake failure
      return new Response(null, {
        status: 302,
        headers: {
          Location: "http://example.com",
        },
      });
    },
  });

  const ws = new WebSocket(`ws://localhost:${server.port}`);

  ws.addEventListener("error", event => {
    events.push("error");
    resolveError(event);
  });

  ws.addEventListener("close", event => {
    events.push("close");
    resolveClose(event);
  });

  ws.addEventListener("open", () => {
    events.push("open");
  });

  // Wait for close event (which should always fire)
  await closePromise;

  // After the fix, both error and close events should be emitted
  // The error event should come before the close event
  expect(events).toEqual(["error", "close"]);
});

test("WebSocket successful connection should NOT emit error event", async () => {
  const { promise: openPromise, resolve: resolveOpen } = Promise.withResolvers<Event>();
  const { promise: messagePromise, resolve: resolveMessage } = Promise.withResolvers<MessageEvent>();
  const { promise: closePromise, resolve: resolveClose } = Promise.withResolvers<CloseEvent>();
  const events: string[] = [];

  // Create a proper WebSocket server
  await using server = Bun.serve({
    port: 0,
    websocket: {
      message(ws, message) {
        ws.send(message);
      },
    },
    fetch(req, server) {
      if (server.upgrade(req)) {
        return;
      }
      return new Response("Not found", { status: 404 });
    },
  });

  const ws = new WebSocket(`ws://localhost:${server.port}`);

  ws.addEventListener("error", event => {
    events.push("error");
  });

  ws.addEventListener("open", event => {
    events.push("open");
    resolveOpen(event);
  });

  ws.addEventListener("message", event => {
    events.push("message");
    resolveMessage(event);
  });

  ws.addEventListener("close", event => {
    events.push("close");
    resolveClose(event);
  });

  // Wait for connection to open
  await openPromise;

  // Send a test message
  ws.send("test");

  // Wait for echo
  const msg = await messagePromise;
  expect(msg.data).toBe("test");

  // Close the connection normally
  ws.close();

  // Wait for close event
  await closePromise;

  // Should have open, message, and close events, but NO error event
  expect(events).toContain("open");
  expect(events).toContain("message");
  expect(events).toContain("close");
  expect(events).not.toContain("error");
});

test("WebSocket should emit error and close events on connection to non-WebSocket server", async () => {
  const { promise: closePromise, resolve: resolveClose } = Promise.withResolvers<CloseEvent>();
  const events: string[] = [];

  // Create a regular HTTP server (not WebSocket)
  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      // Return a normal HTTP response
      return new Response("Not a WebSocket server", {
        status: 200,
        headers: {
          "Content-Type": "text/plain",
        },
      });
    },
  });

  const ws = new WebSocket(`ws://localhost:${server.port}`);

  ws.addEventListener("error", event => {
    events.push("error");
  });

  ws.addEventListener("close", event => {
    events.push("close");
    resolveClose(event);
  });

  ws.addEventListener("open", () => {
    events.push("open");
  });

  // Wait for close event
  await closePromise;

  // After the fix, both error and close events should be emitted
  expect(events).toEqual(["error", "close"]);
});
