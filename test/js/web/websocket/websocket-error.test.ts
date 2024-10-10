import { describe, expect, test } from "bun:test";

describe("WebSocket error", () => {
  // regression test for https://github.com/oven-sh/bun/issues/14338
  test("should throw websocket connection error", async () => {
    const server = Bun.serve({
      fetch: () => new Response,
    });

    let errorCount = 0;
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${server.port}`);
      ws.addEventListener("open", reject);
      ws.addEventListener("error", (e) => {
        errorCount += 1;
      });
      ws.addEventListener("close", resolve);
    });
    expect(errorCount).toBe(1);

    server.stop();
  });
});
