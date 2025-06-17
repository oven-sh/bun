import { expect, test } from "bun:test";

// numeric timeout option should abort fetch when exceeded

test("fetch timeout option aborts request", async () => {
  try {
    using server = Bun.serve({
      port: 0,
      async fetch() {
        await Bun.sleep(100);
        return new Response("unreachable");
      },
    });

    await fetch(server.url, { timeout: 10 });
    expect.unreachable();
  } catch (err: any) {
    expect(err.name).toBe("TimeoutError");
  }
});
