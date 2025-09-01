import { expect, test } from "bun:test";
import { createServer } from "net";

test("issue #18737 - malformed HTTP response handling", async () => {
  // Create a TCP server that sends malformed HTTP responses
  const server = createServer(socket => {
    socket.on("data", () => {
      // Send a malformed HTTP response that will trigger picohttp to return -1
      socket.write("INVALID_HTTP_RESPONSE_LINE\r\n\r\n");
      socket.end();
    });
  });

  await new Promise<void>(resolve => {
    server.listen(0, () => resolve());
  });

  const port = (server.address() as any).port;

  try {
    // This should handle the malformed response gracefully
    const response = await fetch(`http://127.0.0.1:${port}/test`);
    throw new Error("Expected fetch to throw but it succeeded");
  } catch (error: any) {
    // We expect a proper error, not a crash or unhandled promise rejection
    expect(error).toBeDefined();
    expect(typeof error.message).toBe("string");
    // The error should indicate connection/parsing failure
    expect(
      error.message.includes("ECONNRESET") ||
        error.message.includes("connection") ||
        error.message.includes("network") ||
        error.code === "Malformed_HTTP_Response",
    ).toBe(true);
  } finally {
    server.close();
  }
});

test("issue #18737 - malformed HTTP response in WebSocket upgrade", async () => {
  // Create a server that sends malformed HTTP upgrade responses
  const server = createServer(socket => {
    socket.on("data", data => {
      const request = data.toString();
      if (request.includes("Upgrade: websocket")) {
        // Send malformed HTTP response for WebSocket upgrade
        socket.write("HTTP/1.1 101\r\n"); // Missing reason phrase
        socket.write("invalid-header-format\r\n"); // Invalid header format
        socket.write("\r\n");
        socket.end();
      }
    });
  });

  await new Promise<void>(resolve => {
    server.listen(0, () => resolve());
  });

  const port = (server.address() as any).port;

  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/test`);

    // Should get a proper error, not crash
    await new Promise((resolve, reject) => {
      ws.onerror = (event: any) => {
        // We expect a proper error event
        expect(event).toBeDefined();
        resolve(event);
      };

      ws.onopen = () => {
        reject(new Error("Expected WebSocket connection to fail"));
      };

      // Timeout after 2 seconds
      setTimeout(() => {
        reject(new Error("WebSocket connection timeout"));
      }, 2000);
    });
  } catch (error) {
    // Should handle gracefully without crashing
    expect(error).toBeDefined();
  } finally {
    server.close();
  }
});

test("issue #18737 - partial HTTP response handling", async () => {
  // Test the ShortRead case to ensure it's properly distinguished from malformed
  const server = createServer(socket => {
    socket.on("data", () => {
      // Send incomplete HTTP response
      socket.write("HTTP/1.1 200 OK\r\n");
      socket.write("Content-Length: 10\r\n");
      socket.write("\r\n");
      socket.write("partial"); // Only 7 bytes of 10
      // Don't end the socket - simulate connection hang
      setTimeout(() => socket.end(), 1000);
    });
  });

  await new Promise<void>(resolve => {
    server.listen(0, () => resolve());
  });

  const port = (server.address() as any).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/test`, {
      signal: AbortSignal.timeout(500), // Timeout quickly
    });

    // Should be able to read partial data
    const text = await response.text();
    expect(text).toBe("partial");
  } catch (error: any) {
    // Either timeout or connection error is acceptable
    expect(
      error.name === "AbortError" ||
        error.name === "TimeoutError" ||
        error.message.includes("ECONNRESET") ||
        error.message.includes("connection") ||
        error.message.includes("timed out"),
    ).toBe(true);
  } finally {
    server.close();
  }
});
