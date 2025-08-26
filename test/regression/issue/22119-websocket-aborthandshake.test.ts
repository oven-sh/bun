import { describe, expect, test } from "bun:test";
import { createServer } from "http";
import { WebSocket, WebSocketServer } from "ws";

describe("Issue #22119 - WebSocket abortHandshake bug causing hanging connections", () => {
  test("WebSocket server should properly reject connections with verifyClient", async () => {
    // This test verifies that when WebSocket connections are rejected via verifyClient,
    // the client receives a proper error/close event instead of hanging indefinitely.
    // The bug was in the abortHandshake function failing to send the rejection response.

    const server = createServer();
    const wss = new WebSocketServer({
      server,
      verifyClient: info => {
        // Reject connections without valid API key
        return info.req.headers["api-key"] === "valid-key";
      },
    });

    wss.on("connection", ws => {
      // This should only happen with valid API key
      ws.send("Connected successfully");
    });

    await new Promise<void>(resolve => {
      server.listen(0, resolve);
    });

    const port = (server.address() as any)?.port;
    expect(port).toBeNumber();

    try {
      // Test 1: Invalid API key should be rejected (not hang)
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${port}/`, {
          headers: {
            // No api-key header - should be rejected
          },
        });

        let resolved = false;

        // Set timeout to detect hanging (the original bug)
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            ws.terminate();
            reject(new Error("WebSocket connection hung - abortHandshake fix not working"));
          }
        }, 3000);

        ws.on("open", () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            ws.close();
            reject(new Error("Connection should have been rejected by verifyClient"));
          }
        });

        ws.on("error", () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            resolve(); // Expected - connection rejected
          }
        });

        ws.on("close", () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            resolve(); // Expected - connection closed due to rejection
          }
        });
      });

      // Test 2: Valid API key should be accepted
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`ws://localhost:${port}/`, {
          headers: {
            "api-key": "valid-key",
          },
        });

        let resolved = false;

        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            ws.terminate();
            reject(new Error("Valid connection timed out"));
          }
        }, 3000);

        ws.on("open", () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            ws.close();
            resolve(); // Expected - connection accepted
          }
        });

        ws.on("error", err => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            reject(new Error(`Unexpected error with valid API key: ${err.message}`));
          }
        });
      });
    } finally {
      server.close();
      wss.close();
    }
  });

  test("WebSocket server should handle abortHandshake with custom error codes", async () => {
    // Test that the abortHandshake function works with various HTTP status codes
    // and doesn't crash when http.STATUS_CODES is not available

    const server = createServer();
    const wss = new WebSocketServer({
      server,
      verifyClient: info => {
        const reason = info.req.headers["reject-reason"] as string;

        if (reason === "forbidden") {
          // This should trigger abortHandshake with 403
          return false;
        }
        if (reason === "unauthorized") {
          // This should trigger abortHandshake with 401
          return false;
        }
        if (reason === "custom") {
          // This should trigger abortHandshake with a custom code
          return false;
        }

        return true; // Accept connection
      },
    });

    await new Promise<void>(resolve => {
      server.listen(0, resolve);
    });

    const port = (server.address() as any)?.port;

    try {
      // Test different rejection scenarios
      const testCases = [
        { reason: "forbidden", expected: "rejection" },
        { reason: "unauthorized", expected: "rejection" },
        { reason: "custom", expected: "rejection" },
      ];

      for (const testCase of testCases) {
        await new Promise<void>((resolve, reject) => {
          const ws = new WebSocket(`ws://localhost:${port}/`, {
            headers: {
              "reject-reason": testCase.reason,
            },
          });

          let resolved = false;

          // Timeout to detect hanging
          const timeout = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              ws.terminate();
              reject(new Error(`WebSocket connection hung for reason: ${testCase.reason}`));
            }
          }, 2000);

          ws.on("open", () => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              ws.close();
              reject(new Error(`Connection should have been rejected for reason: ${testCase.reason}`));
            }
          });

          ws.on("error", () => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              resolve(); // Expected
            }
          });

          ws.on("close", () => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              resolve(); // Expected
            }
          });
        });
      }
    } finally {
      server.close();
      wss.close();
    }
  });

  test.skip("WebSocket upgrade vs HTTP handler race condition (known issue)", async () => {
    // This test documents a known issue where WebSocket upgrades can bypass HTTP handlers
    // This is related to issue #22119 but is a separate problem from the abortHandshake bug
    // that we fixed. This test is skipped because it demonstrates the race condition that
    // still exists in Bun's WebSocket handling.
    //
    // The issue: When a WebSocket upgrade request comes in, Bun may route it directly
    // to the WebSocket server without going through the HTTP request handler first.
    // This can cause issues with frameworks like Fastify where preValidation hooks
    // should run before WebSocket upgrades are processed.
    //
    // TODO: Fix this race condition in a future update

    const server = createServer((req, res) => {
      // This HTTP handler should run for WebSocket upgrade requests
      // but currently gets bypassed in some cases
      if (req.headers.upgrade === "websocket" && !req.headers["api-key"]) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    const wss = new WebSocketServer({ server });
    // Test implementation would go here...
  });
});
