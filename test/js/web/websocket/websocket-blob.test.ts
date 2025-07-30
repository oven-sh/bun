import { expect, test } from "bun:test";

test("WebSocket should send Blob data", async () => {
  const server = Bun.serve({
    port: 0,
    websocket: {
      open(ws) {
        console.log("Server: WebSocket opened");
      },
      message(ws, message) {
        console.log("Server received:", message);
        if (message instanceof Uint8Array) {
          // Echo back the binary data
          ws.send(message);
        } else {
          // Echo back text messages
          ws.send(message);
        }
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

  try {
    const url = `ws://localhost:${server.port}`;

    const promise = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      let messageReceived = false;

      ws.onopen = () => {
        console.log("Client: WebSocket opened");

        // Set binary type to arraybuffer for consistent testing
        ws.binaryType = "arraybuffer";

        // Create a blob with test data
        const testData = new Uint8Array([72, 101, 108, 108, 111]); // "Hello" in bytes
        const blob = new Blob([testData], { type: "application/octet-stream" });

        console.log("Sending blob with length:", blob.size);
        ws.send(blob);
      };

      ws.onmessage = event => {
        console.log("Client received message:", event.data);
        messageReceived = true;

        if (event.data instanceof ArrayBuffer) {
          const received = new Uint8Array(event.data);
          console.log("Received bytes:", Array.from(received));

          // Verify we received the correct data
          expect(received).toEqual(new Uint8Array([72, 101, 108, 108, 111]));
          resolve();
        } else {
          reject(new Error("Expected binary data, got: " + typeof event.data));
        }
      };

      ws.onerror = error => {
        console.error("WebSocket error:", error);
        reject(error);
      };

      ws.onclose = event => {
        console.log("Client: WebSocket closed", event.code, event.reason);
        if (!messageReceived) {
          reject(new Error("Connection closed without receiving message"));
        }
      };

      // Timeout after 5 seconds
      setTimeout(() => {
        if (!messageReceived) {
          ws.close();
          reject(new Error("Test timed out"));
        }
      }, 5000);
    });

    await promise;
  } finally {
    server.stop();
  }
});

test("WebSocket should send empty Blob", async () => {
  const server = Bun.serve({
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

  try {
    const url = `ws://localhost:${server.port}`;

    const promise = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      let messageReceived = false;

      ws.onopen = () => {
        // Set binary type to arraybuffer for consistent testing
        ws.binaryType = "arraybuffer";

        // Create an empty blob
        const blob = new Blob([], { type: "application/octet-stream" });

        console.log("Sending empty blob with length:", blob.size);
        ws.send(blob);
      };

      ws.onmessage = event => {
        console.log("Client received message:", event.data);
        messageReceived = true;

        if (event.data instanceof ArrayBuffer) {
          const received = new Uint8Array(event.data);
          console.log("Received bytes length:", received.length);

          // Verify we received empty data
          expect(received.length).toBe(0);
          resolve();
        } else {
          reject(new Error("Expected binary data, got: " + typeof event.data));
        }
      };

      ws.onerror = error => {
        console.error("WebSocket error:", error);
        reject(error);
      };

      ws.onclose = event => {
        console.log("Client: WebSocket closed", event.code, event.reason);
        if (!messageReceived) {
          reject(new Error("Connection closed without receiving message"));
        }
      };

      // Timeout after 5 seconds
      setTimeout(() => {
        if (!messageReceived) {
          ws.close();
          reject(new Error("Test timed out"));
        }
      }, 5000);
    });

    await promise;
  } finally {
    server.stop();
  }
});

test("WebSocket should ping with Blob", async () => {
  const server = Bun.serve({
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

  try {
    const url = `ws://localhost:${server.port}`;

    const promise = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      let pongReceived = false;

      ws.onopen = () => {
        console.log("Client: WebSocket opened");

        // Set binary type to arraybuffer for consistent testing
        ws.binaryType = "arraybuffer";

        // Create a blob with ping data
        const pingData = new Uint8Array([80, 73, 78, 71]); // "PING" in bytes
        const blob = new Blob([pingData], { type: "application/octet-stream" });

        console.log("Sending ping with blob");
        (ws as any).ping(blob);
      };

      ws.addEventListener("pong", (event: any) => {
        console.log("Client received pong:", event.data);
        pongReceived = true;

        if (event.data instanceof ArrayBuffer) {
          const received = new Uint8Array(event.data);
          console.log("Received pong bytes:", Array.from(received));

          // Verify we received the correct ping data back
          expect(received).toEqual(new Uint8Array([80, 73, 78, 71]));
          resolve();
        } else {
          reject(new Error("Expected binary data in pong, got: " + typeof event.data));
        }
      });

      ws.onerror = error => {
        console.error("WebSocket error:", error);
        reject(error);
      };

      ws.onclose = event => {
        console.log("Client: WebSocket closed", event.code, event.reason);
        if (!pongReceived) {
          reject(new Error("Connection closed without receiving pong"));
        }
      };

      // Timeout after 5 seconds
      setTimeout(() => {
        if (!pongReceived) {
          ws.close();
          reject(new Error("Test timed out"));
        }
      }, 5000);
    });

    await promise;
  } finally {
    server.stop();
  }
});
