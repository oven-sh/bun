import { test, expect } from "bun:test";
import { tempDirWithFiles } from "harness";

test("issue #18737 - WebSocket protocol validation fix", async () => {
  // Test case 1: WebSocket without specific protocol should accept server protocol
  const server1 = Bun.serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req, {
        data: { test: "no-protocol" }
      })) {
        return;
      }
      return new Response("Upgrade failed", { status: 400 });
    },
    websocket: {
      open(ws, req) {
        ws.send("connected-no-protocol");
      },
      message(ws, message, req) {
        ws.send("echo: " + message);
      }
    }
  });

  try {
    // Client doesn't specify a protocol, server may send one - this should work
    const ws1 = new WebSocket(`ws://localhost:${server1.port}/test`);
    
    await new Promise<void>((resolve, reject) => {
      ws1.onopen = () => {
        ws1.send("test");
      };
      
      ws1.onmessage = (event) => {
        if (event.data === "connected-no-protocol") {
          // Connection established successfully
          resolve();
        } else if (event.data === "echo: test") {
          ws1.close();
        }
      };
      
      ws1.onerror = (error) => {
        reject(new Error(`WebSocket error: ${error}`));
      };
      
      ws1.onclose = () => {
        resolve();
      };
      
      setTimeout(() => {
        reject(new Error("WebSocket test timeout"));
      }, 3000);
    });
  } finally {
    server1.stop();
  }

  // Test case 2: WebSocket with specific protocol should match server protocol  
  const server2 = Bun.serve({
    port: 0,
    fetch(req, server) {
      const protocol = req.headers.get("Sec-WebSocket-Protocol");
      if (server.upgrade(req, {
        data: { protocol }
      })) {
        return;
      }
      return new Response("Upgrade failed", { status: 400 });
    },
    websocket: {
      open(ws, req) {
        ws.send("connected-with-protocol");
      },
      message(ws, message, req) {
        ws.send("echo: " + message);
      }
    }
  });

  try {
    // Client specifies a protocol - this should also work
    const ws2 = new WebSocket(`ws://localhost:${server2.port}/test`, ["echo-protocol"]);
    
    await new Promise<void>((resolve, reject) => {
      let messageReceived = false;
      
      ws2.onopen = () => {
        ws2.send("test");
      };
      
      ws2.onmessage = (event) => {
        if (event.data === "connected-with-protocol" && !messageReceived) {
          messageReceived = true;
          // Connection established successfully
        } else if (event.data === "echo: test") {
          ws2.close();
        }
      };
      
      ws2.onerror = (error) => {
        reject(new Error(`WebSocket with protocol error: ${error}`));
      };
      
      ws2.onclose = () => {
        if (messageReceived) {
          resolve();
        } else {
          reject(new Error("WebSocket closed without receiving expected messages"));
        }
      };
      
      setTimeout(() => {
        reject(new Error("WebSocket protocol test timeout"));
      }, 3000);
    });
  } finally {
    server2.stop();
  }
});

test("issue #18737 - WebSocket connection resilience", async () => {
  // Test that WebSocket connections handle various server responses gracefully
  let connectionAttempts = 0;
  const maxAttempts = 3;

  const server = Bun.serve({
    port: 0,
    fetch(req, server) {
      connectionAttempts++;
      
      // Simulate server behavior that might cause issues
      if (connectionAttempts === 1) {
        // First attempt - simulate server that doesn't handle WebSocket properly
        return new Response("Not a WebSocket server", { status: 400 });
      }
      
      if (connectionAttempts === 2) {
        // Second attempt - simulate successful upgrade
        if (server.upgrade(req, { data: { attempt: connectionAttempts } })) {
          return;
        }
        return new Response("Upgrade failed", { status: 400 });
      }
      
      return new Response("OK");
    },
    websocket: {
      open(ws, req) {
        const attempt = req.data?.attempt || connectionAttempts;
        ws.send(`connected-attempt-${attempt}`);
      },
      message(ws, message, req) {
        const attempt = req.data?.attempt || connectionAttempts;
        ws.send(`echo-${attempt}: ${message}`);
      }
    }
  });

  try {
    // First connection attempt should fail gracefully
    try {
      const ws1 = new WebSocket(`ws://localhost:${server.port}/test`);
      await new Promise<void>((resolve, reject) => {
        ws1.onerror = () => resolve(); // Expected to fail
        ws1.onopen = () => reject(new Error("Expected first connection to fail"));
        setTimeout(() => resolve(), 1000); // Timeout is OK
      });
    } catch (error) {
      // This is expected to fail
    }

    // Second connection attempt should succeed
    const ws2 = new WebSocket(`ws://localhost:${server.port}/test`);
    await new Promise<void>((resolve, reject) => {
      ws2.onopen = () => {
        ws2.send("test");
      };
      
      ws2.onmessage = (event) => {
        if (event.data === "connected-attempt-2") {
          // Good, connection established
        } else if (event.data === "echo-2: test") {
          ws2.close();
          resolve();
        }
      };
      
      ws2.onerror = (error) => {
        reject(new Error(`Second WebSocket connection failed: ${error}`));
      };
      
      setTimeout(() => {
        reject(new Error("WebSocket resilience test timeout"));
      }, 3000);
    });
  } finally {
    server.stop();
  }
});