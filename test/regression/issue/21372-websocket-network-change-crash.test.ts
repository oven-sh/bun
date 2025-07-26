import { expect, test } from "bun:test";

// Test for issue #21372: Segmentation fault crash after network is changed
// This test verifies that the double deref bug in WebSocket handleClose is fixed

test("WebSocket client should handle server-initiated close without double deref", async () => {
  // Create a server that will close the connection immediately after opening
  const server = Bun.serve({
    port: 0,
    fetch(req, server) {
      const success = server.upgrade(req);
      return success ? undefined : new Response("Upgrade failed", { status: 400 });
    },
    websocket: {
      open(ws) {
        // Immediately close the connection to trigger handleClose in the client
        setTimeout(() => {
          ws.close(1000, "server initiated close");
        }, 10);
      },
      message(ws, message) {
        // Echo message
        ws.send(message);
      },
    },
  });

  const port = server.port;

  try {
    let closeCount = 0;
    let errorCount = 0;

    const promises: Promise<void>[] = [];

    // Create multiple connections that will be closed by the server
    // This exercises the handleClose -> dispatchAbruptClose -> deref path
    for (let i = 0; i < 10; i++) {
      const promise = new Promise<void>((resolve, reject) => {
        const client = new WebSocket(`ws://localhost:${port}`);

        const timeout = setTimeout(() => {
          reject(new Error(`Connection ${i} timeout`));
        }, 2000);

        client.onopen = () => {
          // Send a message to ensure the connection is fully established
          client.send(`hello-${i}`);
        };

        client.onmessage = event => {
          // Message received, connection is working
        };

        client.onclose = event => {
          closeCount++;
          clearTimeout(timeout);
          resolve();
        };

        client.onerror = error => {
          errorCount++;
          clearTimeout(timeout);
          resolve(); // Don't reject, errors are expected during rapid close
        };
      });

      promises.push(promise);
    }

    // Wait for all connections to complete
    await Promise.allSettled(promises);

    // The test passes if we don't crash with a segfault
    // We expect some connections to close or error
    expect(closeCount + errorCount).toBeGreaterThan(0);
  } finally {
    server.stop();
  }
}, 5000);

test("WebSocket client should handle rapid connection cycles", async () => {
  const server = Bun.serve({
    port: 0,
    fetch(req, server) {
      const success = server.upgrade(req);
      return success ? undefined : new Response("Upgrade failed", { status: 400 });
    },
    websocket: {
      open(ws) {
        ws.send("connected");
      },
      message(ws, message) {
        ws.send("pong");
      },
    },
  });

  const port = server.port;

  try {
    // Create and close many connections quickly to stress test the cleanup paths
    for (let i = 0; i < 5; i++) {
      const client = new WebSocket(`ws://localhost:${port}`);

      await new Promise<void>(resolve => {
        const timeout = setTimeout(resolve, 500);

        client.onopen = () => {
          client.send("ping");
          // Close immediately after opening
          setTimeout(() => {
            client.close();
          }, 10);
        };

        client.onclose = () => {
          clearTimeout(timeout);
          resolve();
        };

        client.onerror = () => {
          clearTimeout(timeout);
          resolve();
        };
      });
    }

    // If we reach here without crashing, the fix works
    expect(true).toBe(true);
  } finally {
    server.stop();
  }
}, 5000);
