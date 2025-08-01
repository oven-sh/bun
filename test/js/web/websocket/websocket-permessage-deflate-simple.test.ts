import { serve } from "bun";
import { expect, test } from "bun:test";

// Simple test to verify basic permessage-deflate functionality
test("WebSocket client basic permessage-deflate support", async () => {
  using server = serve({
    port: 0,
    fetch(req, server) {
      // Upgrade to WebSocket with permessage-deflate
      if (server.upgrade(req)) {
        return;
      }
      return new Response("Not found", { status: 404 });
    },
    websocket: {
      perMessageDeflate: true,
      open(ws) {
        console.log("Server: WebSocket opened");
      },
      message(ws, message) {
        // Echo the message back
        ws.send(typeof message === "string" ? message : message.toString(), true);
      },
    },
  });

  const client = new WebSocket(`ws://localhost:${server.port}`);

  await new Promise<void>((resolve, reject) => {
    client.onopen = () => {
      console.log("Client connected");
      console.log("Client extensions:", client.extensions);
      resolve();
    };
    client.onerror = reject;
  });

  // Verify that extensions property contains permessage-deflate
  expect(client.extensions).toContain("permessage-deflate");

  // Test sending and receiving a message
  const testMessage = "Hello, WebSocket with compression!";

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

// Test that compression actually works for large messages
test("WebSocket permessage-deflate compresses large messages", async () => {
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
        // Send a large repetitive message that should compress well
        const largeMessage = "A".repeat(10000);
        ws.send(largeMessage, true);
      },
      message(ws, message) {
        // Not used in this test
      },
    },
  });

  const client = new WebSocket(`ws://localhost:${server.port}`);

  const messagePromise = new Promise<string>(resolve => {
    client.onmessage = event => {
      resolve(event.data);
    };
  });

  await new Promise<void>((resolve, reject) => {
    client.onopen = () => resolve();
    client.onerror = reject;
  });

  const receivedMessage = await messagePromise;
  expect(receivedMessage).toBe("A".repeat(10000));

  client.close();
  server.stop();
});
