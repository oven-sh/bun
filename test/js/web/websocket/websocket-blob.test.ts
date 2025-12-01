import { expect, test } from "bun:test";

test("WebSocket should send Blob data", async () => {
  await using server = Bun.serve({
    port: 0,
    websocket: {
      open(ws) {
        console.log("Server: WebSocket opened");
      },
      message(ws, message) {
        console.log("Server received:", message);
        // Echo back text messages
        ws.send(message);
      },
      close(ws) {
        console.log("Server: WebSocket closed");
      },
    },
    fetch(req, server) {
      if (server.upgrade(req)) {
        return undefined;
      }
      return new Response("Upgrade failed", { status: 500 });
    },
  });

  const url = `ws://localhost:${server.port}`;

  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const ws = new WebSocket(url);
  ws.binaryType = "blob";
  let messageReceived = false;

  ws.onopen = () => {
    console.log("Client: WebSocket opened");

    // Create a blob with test data
    const testData = new Uint8Array([72, 101, 108, 108, 111]); // "Hello" in bytes
    const blob = new Blob([testData], { type: "application/octet-stream" });

    console.log("Sending blob with length:", blob.size);
    ws.send(blob);
  };

  ws.onmessage = async event => {
    console.log("Client received message:", event.data);
    messageReceived = true;

    if (event.data instanceof Blob) {
      const received = new Uint8Array(await event.data.arrayBuffer());
      console.log("Received bytes:", Array.from(received));

      // Verify we received the correct data
      expect(received).toEqual(new Uint8Array([72, 101, 108, 108, 111]));
      ws.close();
      resolve();
    } else {
      ws.close();
      reject(new Error("Expected blob data, got: " + typeof event.data));
    }
  };

  ws.onerror = error => {
    console.error("WebSocket error:", error);
    ws.close();
    reject(error);
  };

  ws.onclose = event => {
    console.log("Client: WebSocket closed", event.code, event.reason);
    if (!messageReceived) {
      reject(new Error("Connection closed without receiving message"));
    }
  };

  await promise;
});

test("WebSocket should send empty Blob", async () => {
  await using server = Bun.serve({
    port: 0,
    websocket: {
      message(ws, message) {
        // Echo back the message
        ws.send(message);
      },
    },
    fetch(req, server) {
      if (server.upgrade(req)) {
        return undefined;
      }
      return new Response("Upgrade failed", { status: 500 });
    },
  });

  const url = `ws://localhost:${server.port}`;

  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const ws = new WebSocket(url);
  ws.binaryType = "blob";
  let messageReceived = false;

  ws.onopen = () => {
    // Create an empty blob
    const blob = new Blob([], { type: "application/octet-stream" });

    console.log("Sending empty blob with length:", blob.size);
    ws.send(blob);
  };

  ws.onmessage = async event => {
    console.log("Client received message:", event.data);
    messageReceived = true;

    if (event.data instanceof Blob) {
      const received = new Uint8Array(await event.data.arrayBuffer());
      console.log("Received bytes length:", received.length);

      // Verify we received empty data
      expect(received.length).toBe(0);
      ws.close();
      resolve();
    } else {
      ws.close();
      reject(new Error("Expected blob data, got: " + typeof event.data));
    }
  };

  ws.onerror = error => {
    console.error("WebSocket error:", error);
    ws.close();
    reject(error);
  };

  ws.onclose = event => {
    console.log("Client: WebSocket closed", event.code, event.reason);
    if (!messageReceived) {
      reject(new Error("Connection closed without receiving message"));
    }
  };

  await promise;
});

test("WebSocket should ping with Blob", async () => {
  await using server = Bun.serve({
    port: 0,
    websocket: {
      ping(ws, data) {
        console.log("Server received ping with data:", data);
        // Respond with pong containing the same data
        ws.pong(data);
      },
    },
    fetch(req, server) {
      if (server.upgrade(req)) {
        return undefined;
      }
      return new Response("Upgrade failed", { status: 500 });
    },
  });

  const url = `ws://localhost:${server.port}`;

  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const ws = new WebSocket(url);
  ws.binaryType = "blob";
  let pongReceived = false;

  ws.onopen = () => {
    console.log("Client: WebSocket opened");

    // Create a blob with ping data
    const pingData = new Uint8Array([80, 73, 78, 71]); // "PING" in bytes
    const blob = new Blob([pingData], { type: "application/octet-stream" });

    console.log("Sending ping with blob");
    ws.ping(blob);
  };

  ws.addEventListener("pong", async (event: any) => {
    console.log("Client received pong:", event.data);
    pongReceived = true;

    if (event.data instanceof Blob) {
      const received = new Uint8Array(await event.data.arrayBuffer());

      // Verify we received the correct ping data back
      expect(new Uint8Array(received)).toEqual(new Uint8Array([80, 73, 78, 71]));
      ws.close();
      resolve();
    } else {
      ws.close();
      reject(new Error("Expected blob data in pong, got: " + typeof event.data));
    }
  });

  ws.onerror = error => {
    console.error("WebSocket error:", error);
    ws.close();
    reject(error);
  };

  ws.onclose = event => {
    console.log("Client: WebSocket closed", event.code, event.reason);
    if (!pongReceived) {
      reject(new Error("Connection closed without receiving pong"));
    }
  };

  await promise;
});
