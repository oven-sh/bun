import { serve } from "bun";
import { describe, expect, test } from "bun:test";

describe("WebSocket upgrade", () => {
  test("should send correct upgrade headers", async () => {
    const server = serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request, server) {
        // Read the headers before upgrade(): a successful upgrade detaches the
        // request, so request.headers is no longer reliable afterwards.
        const { headers } = request;
        expect(headers.get("connection")).toBe("Upgrade");
        expect(headers.get("upgrade")).toBe("websocket");
        expect(headers.get("sec-websocket-version")).toBe("13");
        expect(headers.get("sec-websocket-key")).toBeString();
        expect(headers.get("host")).toBe(`127.0.0.1:${server.port}`);
        expect(server.upgrade(request)).toBeTrue();
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
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/`);
      ws.addEventListener("open", resolve);
      ws.addEventListener("error", reject);
      ws.addEventListener("close", reject);
    });
  });
});
