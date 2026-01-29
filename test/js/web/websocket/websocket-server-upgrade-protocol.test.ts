// Test for https://github.com/oven-sh/bun/issues/25773
// Verifies that server.upgrade() works correctly with custom Sec-WebSocket-Protocol header

import { describe, expect, test } from "bun:test";
import { serve } from "bun";

describe("server.upgrade() with custom Sec-WebSocket-Protocol", () => {
  test("should work when selecting the first protocol", async () => {
    const server = serve({
      hostname: "localhost",
      port: 0,
      fetch(req, server) {
        const protocols =
          req.headers
            .get("Sec-WebSocket-Protocol")
            ?.split(",")
            .map(p => p.trim()) || [];

        server.upgrade(req, {
          headers: { "Sec-WebSocket-Protocol": protocols[0] },
        });
      },
      websocket: {
        open(ws) {},
        close(ws) {},
      },
    });

    const ws = new WebSocket(`ws://localhost:${server.port}`, ["ocpp1.6", "ocpp2.0.1"]);

    await new Promise((resolve, reject) => {
      ws.onopen = () => {
        expect(ws.protocol).toBe("ocpp1.6");
        ws.close();
        resolve();
      };
      ws.onerror = reject;
      ws.onclose = e => {
        if (e.code === 1002 && e.reason === "Mismatch client protocol") {
          reject(new Error("Connection failed with 'Mismatch client protocol'"));
        }
      };
    });

    server.stop();
  });

  test("should work when selecting the second protocol", async () => {
    const server = serve({
      hostname: "localhost",
      port: 0,
      fetch(req, server) {
        const protocols =
          req.headers
            .get("Sec-WebSocket-Protocol")
            ?.split(",")
            .map(p => p.trim()) || [];

        // Select the second protocol
        server.upgrade(req, {
          headers: { "Sec-WebSocket-Protocol": protocols[1] || protocols[0] },
        });
      },
      websocket: {
        open(ws) {},
        close(ws) {},
      },
    });

    const ws = new WebSocket(`ws://localhost:${server.port}`, ["ocpp1.6", "ocpp2.0.1"]);

    await new Promise((resolve, reject) => {
      ws.onopen = () => {
        expect(ws.protocol).toBe("ocpp2.0.1");
        ws.close();
        resolve();
      };
      ws.onerror = reject;
      ws.onclose = e => {
        if (e.code === 1002 && e.reason === "Mismatch client protocol") {
          reject(new Error("Connection failed with 'Mismatch client protocol'"));
        }
      };
    });

    server.stop();
  });

  test("should work when selecting any protocol from the list", async () => {
    const server = serve({
      hostname: "localhost",
      port: 0,
      fetch(req, server) {
        const protocols =
          req.headers
            .get("Sec-WebSocket-Protocol")
            ?.split(",")
            .map(p => p.trim()) || [];

        // Select a specific protocol from the middle of the list
        const selected = protocols.find(p => p === "chat");

        server.upgrade(req, {
          headers: { "Sec-WebSocket-Protocol": selected },
        });
      },
      websocket: {
        open(ws) {},
        close(ws) {},
      },
    });

    const ws = new WebSocket(`ws://localhost:${server.port}`, ["echo", "chat", "binary"]);

    await new Promise((resolve, reject) => {
      ws.onopen = () => {
        expect(ws.protocol).toBe("chat");
        ws.close();
        resolve();
      };
      ws.onerror = reject;
      ws.onclose = e => {
        if (e.code === 1002 && e.reason === "Mismatch client protocol") {
          reject(new Error("Connection failed with 'Mismatch client protocol'"));
        }
      };
    });

    server.stop();
  });

  test("should work with other custom headers alongside Sec-WebSocket-Protocol", async () => {
    const server = serve({
      hostname: "localhost",
      port: 0,
      fetch(req, server) {
        const protocols =
          req.headers
            .get("Sec-WebSocket-Protocol")
            ?.split(",")
            .map(p => p.trim()) || [];

        server.upgrade(req, {
          headers: {
            "Sec-WebSocket-Protocol": protocols[0],
            "X-Custom-Header": "custom-value",
          },
        });
      },
      websocket: {
        open(ws) {},
        close(ws) {},
      },
    });

    const ws = new WebSocket(`ws://localhost:${server.port}`, ["test-protocol"]);

    await new Promise((resolve, reject) => {
      ws.onopen = () => {
        expect(ws.protocol).toBe("test-protocol");
        ws.close();
        resolve();
      };
      ws.onerror = reject;
      ws.onclose = e => {
        if (e.code === 1002 && e.reason === "Mismatch client protocol") {
          reject(new Error("Connection failed with 'Mismatch client protocol'"));
        }
      };
    });

    server.stop();
  });
});
