import { serve } from "bun";
import { expect, test } from "bun:test";

test("WebSocket client negotiates permessage-deflate", async () => {
  let serverReceivedExtensions = "";
  let serverReceivedMessage = "";

  using server = serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) {
        return;
      }
      return new Response("Not found", { status: 404 });
    },
    websocket: {
      perMessageDeflate: true,
      open(ws) {
        // Store the headers from the upgrade request
        // For now we'll check the extensions after connection
      },
      message(ws, message) {
        serverReceivedMessage = typeof message === "string" ? message : message.toString();
        // Echo back the message
        ws.send(message, true);
      },
    },
  });

  const client = new WebSocket(`ws://localhost:${server.port}`);

  await new Promise((resolve, reject) => {
    client.onopen = resolve;
    client.onerror = reject;
  });

  // Check that the client negotiated the extension
  // Since we can't easily access request headers in Bun's server, we'll check client.extensions
  expect(client.extensions).toContain("permessage-deflate");

  // Test sending and receiving compressed messages
  const testMessage = "Hello, this is a test message that should be compressed!".repeat(10);

  const messagePromise = new Promise<string>(resolve => {
    client.onmessage = event => {
      resolve(event.data);
    };
  });

  client.send(testMessage);

  const receivedMessage = await messagePromise;
  expect(receivedMessage).toBe(testMessage);

  client.close();
  server.stop();
});

test("WebSocket client handles compressed text messages", async () => {
  const messages: string[] = [];

  using server = serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) {
        return;
      }
      return new Response("Not found", { status: 404 });
    },
    websocket: {
      perMessageDeflate: true,
      open(ws) {
        // Send various text messages
        ws.send("Short message", true);
        ws.send("A".repeat(1000), true); // Repetitive message that compresses well
        ws.send("Random text with unicode: 你好世界 🌍", true);
      },
      message(ws, message) {
        // Required by the type but not used in this test
      },
    },
  });

  const client = new WebSocket(`ws://localhost:${server.port}`);

  client.onmessage = event => {
    messages.push(event.data);
  };

  await new Promise(resolve => {
    client.onopen = resolve;
  });

  await new Promise(resolve => setTimeout(resolve, 100));

  expect(messages).toHaveLength(3);
  expect(messages[0]).toBe("Short message");
  expect(messages[1]).toBe("A".repeat(1000));
  expect(messages[2]).toBe("Random text with unicode: 你好世界 🌍");

  client.close();
  server.stop();
});

test("WebSocket client handles compressed binary messages", async () => {
  const messages: ArrayBuffer[] = [];

  using server = serve({
    port: 0,
    fetch(req, server) {
      if (
        server.upgrade(req, {
          headers: {
            "Sec-WebSocket-Extensions": "permessage-deflate",
          },
        })
      ) {
        return;
      }
      return new Response("Not found", { status: 404 });
    },
    websocket: {
      perMessageDeflate: true,
      open(ws) {
        // Send binary data
        const buffer1 = new Uint8Array([1, 2, 3, 4, 5]);
        const buffer2 = new Uint8Array(1000).fill(0xff); // Repetitive binary data

        ws.send(buffer1);
        ws.send(buffer2);
      },
      message(ws, message) {
        // Required by the type but not used in this test
      },
    },
  });

  const client = new WebSocket(`ws://localhost:${server.port}`);

  client.binaryType = "arraybuffer";
  client.onmessage = event => {
    messages.push(event.data);
  };

  await new Promise(resolve => {
    client.onopen = resolve;
  });

  await new Promise(resolve => setTimeout(resolve, 100));

  expect(messages).toHaveLength(2);
  expect(new Uint8Array(messages[0])).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  expect(new Uint8Array(messages[1]).every(b => b === 0xff)).toBe(true);
  expect(messages[1].byteLength).toBe(1000);

  client.close();
  server.stop();
});

test("WebSocket client handles fragmented compressed messages", async () => {
  using server = serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) {
        return;
      }
      return new Response("Not found", { status: 404 });
    },
    websocket: {
      perMessageDeflate: true,
      open(ws) {
        // Send a large message
        const largeMessage = "X".repeat(100000); // 100KB message
        ws.send(largeMessage, true);
      },
      message(ws, message) {
        // Required by the type but not used in this test
      },
    },
  });

  const client = new WebSocket(`ws://localhost:${server.port}`);

  const messagePromise = new Promise<string>(resolve => {
    client.onmessage = event => {
      resolve(event.data);
    };
  });

  await new Promise(resolve => {
    client.onopen = resolve;
  });

  const receivedMessage = await messagePromise;
  expect(receivedMessage).toBe("X".repeat(100000));

  client.close();
  server.stop();
});

test("WebSocket client handles context takeover options", async () => {
  const messages: string[] = [];

  using server = serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) {
        return;
      }
      return new Response("Not found", { status: 404 });
    },
    websocket: {
      perMessageDeflate: true,
      open(ws) {
        // Send multiple messages - with no context takeover, each should be compressed independently
        ws.send("Message 1: AAAAAAAAAA", true);
        ws.send("Message 2: AAAAAAAAAA", true);
        ws.send("Message 3: BBBBBBBBBB", true);
      },
      message(ws, message) {
        // Required by the type but not used in this test
      },
    },
  });

  const client = new WebSocket(`ws://localhost:${server.port}`);

  client.onmessage = event => {
    messages.push(event.data);
  };

  await new Promise(resolve => {
    client.onopen = resolve;
  });

  await new Promise(resolve => setTimeout(resolve, 100));

  expect(messages).toHaveLength(3);
  expect(messages[0]).toBe("Message 1: AAAAAAAAAA");
  expect(messages[1]).toBe("Message 2: AAAAAAAAAA");
  expect(messages[2]).toBe("Message 3: BBBBBBBBBB");

  client.close();
  server.stop();
});

test.skip("WebSocket client rejects compressed control frames", async () => {
  // This test would require a custom server that sends invalid compressed control frames
  // Skip for now as it requires low-level WebSocket frame manipulation
});

// The "dedicated" decompressor is the only server mode whose handshake response
// omits client_no_context_takeover, so a compliant client may let message N's
// deflate stream back-reference message N-1's sliding window (RFC 7692 7.2.1).
// Such a stream must go through the server's stateful inflater; the stateless
// 4096-byte libdeflate fast path can neither resolve those back-references nor
// keep the zlib stream's window in sync for later messages.
const takeoverBody = Buffer.alloc(1040, "abcdefghijklmnopqrstuvwxyz").toString();
const takeoverLargeBody = Buffer.alloc(8320, "abcdefghijklmnopqrstuvwxyz").toString();
test.each([
  // Message 1's back-references are unresolvable without message 0's window.
  ["every message fits the fast-path buffer", [0, 1, 2, 3].map(i => `message ${i}: ${takeoverBody}`)],
  // Message 0 fits the fast path (bypassing the zlib stream); message 1
  // overflows it and falls back to a zlib stream missing message 0's window.
  [
    "message 1 overflows the fast-path buffer",
    [takeoverBody, takeoverLargeBody, takeoverBody, takeoverBody].map((body, i) => `message ${i}: ${body}`),
  ],
])("server with decompress: 'dedicated' inflates a client context-takeover stream (%s)", async (_name, messages) => {
  const serverReceived: string[] = [];
  let serverClose: { code: number; reason: string } | null = null;

  using server = serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) {
        return;
      }
      return new Response("Not found", { status: 404 });
    },
    websocket: {
      perMessageDeflate: { decompress: "dedicated" },
      message(ws, message) {
        serverReceived.push(String(message));
        ws.send(String(message));
      },
      close(ws, code, reason) {
        serverClose = { code, reason };
      },
    },
  });

  const client = new WebSocket(`ws://localhost:${server.port}`);
  await new Promise((resolve, reject) => {
    client.onopen = resolve;
    client.onerror = reject;
  });

  // The server must grant the client context takeover, otherwise the client
  // resets its deflater per message and this test exercises nothing.
  expect(client.extensions).toContain("permessage-deflate");
  expect(client.extensions).not.toContain("client_no_context_takeover");

  const echoed: string[] = [];
  const { promise: done, resolve: finish, reject: fail } = Promise.withResolvers<void>();
  // An inflation error makes the server force-close the connection.
  client.onclose = event => fail(new Error(`client closed: code=${event.code} reason=${event.reason}`));
  client.onerror = () => fail(new Error("client errored"));
  client.onmessage = event => {
    echoed.push(event.data);
    if (echoed.length === messages.length) finish();
  };

  // Every message is over Bun's 860-byte compression threshold and shares its
  // body with the previous one, so the client's deflater emits back-references
  // that cross the message boundary.
  for (const message of messages) client.send(message);
  await done;

  expect(serverReceived).toEqual(messages);
  expect(echoed).toEqual(messages);
  expect(serverClose).toBeNull();

  client.onclose = null;
  client.close();
});

test("server enforces maxPayloadLength on compressed messages inflated through the fast path", async () => {
  // The server limits messages to 1024 bytes. A compressed frame is tiny on the
  // wire but can inflate to 4000 bytes, which is over the configured limit yet
  // still small enough to fit the inflater's 4096-byte fast-path output buffer.
  // The server must drop the connection instead of delivering the oversized
  // message to the handler.
  const serverReceived: number[] = [];

  using server = serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) {
        return;
      }
      return new Response("Not found", { status: 404 });
    },
    websocket: {
      perMessageDeflate: true,
      maxPayloadLength: 1024,
      message(ws, message) {
        const text = typeof message === "string" ? message : message.toString();
        serverReceived.push(text.length);
        ws.send(text, true);
      },
    },
  });

  const client = new WebSocket(`ws://localhost:${server.port}`);

  await new Promise((resolve, reject) => {
    client.onopen = resolve;
    client.onerror = reject;
  });
  expect(client.extensions).toContain("permessage-deflate");

  // Tiny async event queue so we can await each client-side event in order
  // without timers.
  const events: string[] = [];
  let notify = () => {};
  const record = (event: string) => {
    events.push(event);
    notify();
  };
  const waitForEventCount = async (count: number) => {
    while (events.length < count) {
      await new Promise<void>(resolve => {
        notify = resolve;
      });
    }
  };
  client.onmessage = event => record(`message:${event.data.length}`);
  client.onclose = () => record("close");

  // A compressible message within the limit is still delivered and echoed back.
  client.send(Buffer.alloc(900, "B").toString());
  await waitForEventCount(1);
  expect(events[0]).toBe("message:900");

  // A compressible message that inflates past the limit must not be delivered;
  // the server drops the connection instead of echoing it back.
  client.send(Buffer.alloc(4000, "A").toString());
  await waitForEventCount(2);
  expect(events[1]).toBe("close");

  expect(serverReceived).toEqual([900]);
});
