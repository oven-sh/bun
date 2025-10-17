import { expect, test } from "bun:test";

test("server hooks - onRequestStart is called", async () => {
  let requestStarted = false;
  let requestUrl = "";

  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("Hello World");
    },
    hooks: {
      onRequestStart(req) {
        requestStarted = true;
        requestUrl = req.url;
      },
    },
  });

  const response = await fetch(`http://localhost:${server.port}/test-path`);
  const text = await response.text();

  expect(requestStarted).toBe(true);
  expect(requestUrl).toContain("/test-path");
  expect(text).toBe("Hello World");
});

test.todo("server hooks - onRequestEnd is called", async () => {
  // TODO: onRequestEnd needs safer implementation to avoid use-after-free
  let requestEnded = false;
  let requestCount = 0;

  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("test response");
    },
    hooks: {
      onRequestEnd(req) {
        requestEnded = true;
        requestCount++;
      },
    },
  });

  await fetch(`http://localhost:${server.port}/`);

  // Give it a moment for the hook to be called
  await Bun.sleep(10);

  expect(requestEnded).toBe(true);
  expect(requestCount).toBe(1);
});

test("server hooks - onRequestStart with fetch", async () => {
  const events: string[] = [];

  using server = Bun.serve({
    port: 0,
    fetch(req) {
      events.push("fetch");
      return new Response("OK");
    },
    hooks: {
      onRequestStart(req) {
        events.push("start");
      },
    },
  });

  await fetch(`http://localhost:${server.port}/`);

  expect(events).toEqual(["start", "fetch"]);
});

test("server hooks - hooks are optional", async () => {
  // Server without hooks should work normally
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("no hooks");
    },
  });

  const response = await fetch(`http://localhost:${server.port}/`);
  const text = await response.text();

  expect(text).toBe("no hooks");
});

test("server hooks - request object is accessible in hooks", async () => {
  let capturedMethod = "";
  let capturedHeaders: any = null;

  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("OK");
    },
    hooks: {
      onRequestStart(req) {
        capturedMethod = req.method;
        capturedHeaders = req.headers;
      },
    },
  });

  await fetch(`http://localhost:${server.port}/`, {
    method: "POST",
    headers: {
      "X-Custom-Header": "test-value",
    },
  });

  expect(capturedMethod).toBe("POST");
  expect(capturedHeaders.get("x-custom-header")).toBe("test-value");
});

test("server hooks - async operations in hooks", async () => {
  let asyncCompleted = false;

  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("async test");
    },
    hooks: {
      async onRequestStart(req) {
        await new Promise(resolve => setTimeout(resolve, 5));
        asyncCompleted = true;
      },
    },
  });

  await fetch(`http://localhost:${server.port}/`);

  // Wait for async hook to complete
  await Bun.sleep(20);

  expect(asyncCompleted).toBe(true);
});

test("server hooks - multiple requests", async () => {
  let startCount = 0;

  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("multi");
    },
    hooks: {
      onRequestStart() {
        startCount++;
      },
    },
  });

  // Make 3 requests
  await Promise.all([
    fetch(`http://localhost:${server.port}/1`),
    fetch(`http://localhost:${server.port}/2`),
    fetch(`http://localhost:${server.port}/3`),
  ]);

  expect(startCount).toBe(3);
});

// Test with WebSocket upgrade (hooks should work with WebSocket requests too)
test.todo("server hooks - WebSocket upgrade", async () => {
  let wsRequestStarted = false;

  using server = Bun.serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) {
        return;
      }
      return new Response("Not a WebSocket");
    },
    websocket: {
      message(ws, message) {
        ws.send(message);
      },
    },
    hooks: {
      onRequestStart(req) {
        if (req.headers.get("upgrade") === "websocket") {
          wsRequestStarted = true;
        }
      },
    },
  });

  const ws = new WebSocket(`ws://localhost:${server.port}/`);

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  ws.close();

  expect(wsRequestStarted).toBe(true);
});
