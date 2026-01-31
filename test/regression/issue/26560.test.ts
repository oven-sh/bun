import { expect, test } from "bun:test";

// Test that WebSocket messages sent immediately after handshake are not lost
// when onmessage handler is not set at the time of message arrival.
// Browsers queue these messages until a handler is attached.
// See: https://github.com/oven-sh/bun/issues/26560

test("WebSocket messages should be buffered when no listener is attached", async () => {
  const server = Bun.serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response("Not found", { status: 404 });
    },
    websocket: {
      open(ws) {
        // Send messages immediately when the connection opens
        ws.send("message1");
        ws.send("message2");
        ws.send("message3");
      },
      message() {},
      close() {},
    },
  });

  try {
    const ws = new WebSocket(`ws://localhost:${server.port}`);

    const received: string[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();

    // Wait a bit before attaching the handler to ensure messages arrive first
    await Bun.sleep(50);

    ws.onmessage = event => {
      received.push(event.data);
      if (received.length === 3) {
        resolve();
      }
    };

    // Wait for all messages or timeout
    await Promise.race([
      promise,
      Bun.sleep(1000).then(() => {
        throw new Error(`Timeout: Only received ${received.length} messages: ${JSON.stringify(received)}`);
      }),
    ]);

    expect(received).toEqual(["message1", "message2", "message3"]);

    ws.close();
  } finally {
    server.stop();
  }
});

test("WebSocket messages should be buffered using addEventListener", async () => {
  const server = Bun.serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response("Not found", { status: 404 });
    },
    websocket: {
      open(ws) {
        ws.send("hello");
        ws.send("world");
      },
      message() {},
      close() {},
    },
  });

  try {
    const ws = new WebSocket(`ws://localhost:${server.port}`);

    const received: string[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();

    // Wait before adding event listener
    await Bun.sleep(50);

    ws.addEventListener("message", event => {
      received.push(event.data);
      if (received.length === 2) {
        resolve();
      }
    });

    await Promise.race([
      promise,
      Bun.sleep(1000).then(() => {
        throw new Error(`Timeout: Only received ${received.length} messages: ${JSON.stringify(received)}`);
      }),
    ]);

    expect(received).toEqual(["hello", "world"]);

    ws.close();
  } finally {
    server.stop();
  }
});

test("WebSocket binary messages should be buffered when no listener is attached", async () => {
  const server = Bun.serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response("Not found", { status: 404 });
    },
    websocket: {
      open(ws) {
        ws.send(new Uint8Array([1, 2, 3]));
        ws.send(new Uint8Array([4, 5, 6]));
      },
      message() {},
      close() {},
    },
  });

  try {
    const ws = new WebSocket(`ws://localhost:${server.port}`);
    ws.binaryType = "arraybuffer";

    const received: ArrayBuffer[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();

    // Wait before adding handler
    await Bun.sleep(50);

    ws.onmessage = event => {
      received.push(event.data);
      if (received.length === 2) {
        resolve();
      }
    };

    await Promise.race([
      promise,
      Bun.sleep(1000).then(() => {
        throw new Error(`Timeout: Only received ${received.length} messages`);
      }),
    ]);

    expect(received.length).toBe(2);
    expect(new Uint8Array(received[0])).toEqual(new Uint8Array([1, 2, 3]));
    expect(new Uint8Array(received[1])).toEqual(new Uint8Array([4, 5, 6]));

    ws.close();
  } finally {
    server.stop();
  }
});

test("WebSocket messages sent after listener attached should be received immediately", async () => {
  const server = Bun.serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response("Not found", { status: 404 });
    },
    websocket: {
      open(ws) {
        // Don't send immediately, wait for client to be ready
      },
      message(ws, message) {
        // Echo back
        ws.send("response: " + message);
      },
      close() {},
    },
  });

  try {
    const ws = new WebSocket(`ws://localhost:${server.port}`);

    const received: string[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();

    // Attach listener immediately
    ws.onmessage = event => {
      received.push(event.data);
      if (received.length === 1) {
        resolve();
      }
    };

    ws.onopen = () => {
      ws.send("test");
    };

    await Promise.race([
      promise,
      Bun.sleep(1000).then(() => {
        throw new Error(`Timeout: Only received ${received.length} messages`);
      }),
    ]);

    expect(received).toEqual(["response: test"]);

    ws.close();
  } finally {
    server.stop();
  }
});

test("WebSocket should handle mixed queued and live messages", async () => {
  let serverWs: any = null;

  const server = Bun.serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response("Not found", { status: 404 });
    },
    websocket: {
      open(ws) {
        serverWs = ws;
        // Send some messages immediately
        ws.send("queued1");
        ws.send("queued2");
      },
      message() {},
      close() {},
    },
  });

  try {
    const ws = new WebSocket(`ws://localhost:${server.port}`);

    const received: string[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();

    // Wait for queued messages to arrive
    await Bun.sleep(50);

    ws.onmessage = event => {
      received.push(event.data);
      if (received.length === 4) {
        resolve();
      }
    };

    // Give flush a moment to happen, then send more messages
    await Bun.sleep(10);
    serverWs.send("live1");
    serverWs.send("live2");

    await Promise.race([
      promise,
      Bun.sleep(1000).then(() => {
        throw new Error(`Timeout: Only received ${received.length} messages: ${JSON.stringify(received)}`);
      }),
    ]);

    expect(received).toEqual(["queued1", "queued2", "live1", "live2"]);

    ws.close();
  } finally {
    server.stop();
  }
});
