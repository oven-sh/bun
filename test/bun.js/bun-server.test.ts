import { describe, expect, test } from "bun:test";

describe("Server", () => {
  test("returns active port when initializing server with 0 port", () => {
    const server = Bun.serve({
      fetch() {
        return new Response("Hello");
      },
      port: 0,
    });

    expect(server.port).not.toBe(0);
    expect(server.port).toBeDefined();
    server.stop();
  });

  test("allows connecting to server", async () => {
    const server = Bun.serve({
      fetch() {
        return new Response("Hello");
      },
      port: 0,
    });

    const response = await fetch(`http://${server.hostname}:${server.port}`);
    expect(await response.text()).toBe("Hello");
    server.stop();
  });
});
