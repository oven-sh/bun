import { serve } from "bun";
import { describe, test, expect } from "bun:test";

describe("WebSocket upgrade", () => {
  test("should send correct upgrade headers", async () => {
    const server = serve({
      hostname: "localhost",
      port: 0,
      fetch(request, server) {
        expect(server.upgrade(request)).toBeTrue();
        const { headers } = request;
        expect(headers.get("connection")).toBe("upgrade");
        expect(headers.get("upgrade")).toBe("websocket");
        expect(headers.get("sec-websocket-version")).toBe("13");
        expect(headers.get("sec-websocket-key")).toBeString();
        expect(headers.get("host")).toBe(`localhost:${server.port}`);
        return;
        // FIXME: types gets annoyed if this is not here
        return new Response();
      },
      websocket: {
        open(ws) {
          // FIXME: double-free issue
          // ws.close();
          server.stop();
        },
        message(ws, message) {},
      },
    });
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${server.port}/`);
      ws.addEventListener("open", resolve);
      ws.addEventListener("error", reject);
      ws.addEventListener("close", reject);
    });
  });
});
