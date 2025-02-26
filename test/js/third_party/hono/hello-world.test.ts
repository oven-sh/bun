import { describe, expect, it } from "bun:test";
import { Hono } from "hono";

describe("Hono Hello World", () => {
  it("should respond with hello world", async () => {
    const app = new Hono();
    app.get("/", c => c.text("Hello World!"));

    using server = Bun.serve({
      fetch: app.fetch,
      port: 0,
    });

    const response = await fetch(server.url);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Hello World!");
  });
});
