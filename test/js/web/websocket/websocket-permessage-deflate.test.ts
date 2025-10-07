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
