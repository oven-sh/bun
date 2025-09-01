import { test, expect } from "bun:test";

test("issue #18737 - WebSocket protocol validation fix", async () => {
  // Test the specific bug: client without protocol should accept server with protocol
  const server = Bun.serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) {
        return;
      }
      return new Response("Upgrade failed", { status: 400 });
    },
    websocket: {
      open(ws) {
        ws.send("connected");
      },
      message(ws, message) {
        ws.send("echo: " + message);
        ws.close();
      }
    }
  });

  try {
    // Client doesn't specify a protocol - this should work even if server sends one
    const ws = new WebSocket(`ws://localhost:${server.port}/test`);
    
    await new Promise<void>((resolve, reject) => {
      let connected = false;
      
      ws.onopen = () => {
        connected = true;
        ws.send("test");
      };
      
      ws.onmessage = (event) => {
        if (event.data === "connected") {
          // Good, connection established
        } else if (event.data === "echo: test") {
          // Echo received, connection working
        }
      };
      
      ws.onclose = () => {
        if (connected) {
          resolve(); // Success - connection worked without protocol mismatch error
        } else {
          reject(new Error("WebSocket closed before connecting"));
        }
      };
      
      ws.onerror = (error) => {
        reject(new Error(`WebSocket error: ${error}`));
      };
      
      setTimeout(() => {
        reject(new Error("WebSocket test timeout"));
      }, 3000);
    });
  } finally {
    server.stop();
  }
});

test("issue #18737 - WebSocket with specific protocol", async () => {
  // Test that specific protocol matching still works
  const server = Bun.serve({
    port: 0,
    fetch(req, server) {
      const protocol = req.headers.get("sec-websocket-protocol");
      if (protocol?.includes("echo-protocol")) {
        // Accept the echo-protocol
        if (server.upgrade(req)) {
          return;
        }
      }
      return new Response("Protocol not supported", { status: 400 });
    },
    websocket: {
      open(ws) {
        ws.send("protocol-connected");
      },
      message(ws, message) {
        ws.send("protocol-echo: " + message);
        ws.close();
      }
    }
  });

  try {
    // Client specifies a protocol - this should also work
    const ws = new WebSocket(`ws://localhost:${server.port}/test`, ["echo-protocol"]);
    
    await new Promise<void>((resolve, reject) => {
      let connected = false;
      
      ws.onopen = () => {
        connected = true;
        ws.send("test");
      };
      
      ws.onmessage = (event) => {
        if (event.data === "protocol-connected") {
          // Good, connection established
        } else if (event.data === "protocol-echo: test") {
          // Echo received, connection working
        }
      };
      
      ws.onclose = () => {
        if (connected) {
          resolve(); // Success
        } else {
          reject(new Error("WebSocket closed before connecting"));
        }
      };
      
      ws.onerror = (error) => {
        reject(new Error(`WebSocket with protocol error: ${error}`));
      };
      
      setTimeout(() => {
        reject(new Error("WebSocket protocol test timeout"));
      }, 3000);
    });
  } finally {
    server.stop();
  }
});