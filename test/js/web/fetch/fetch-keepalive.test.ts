import { expect, test } from "bun:test";

test("keepalive", async () => {
  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      return new Response(JSON.stringify(req.headers.toJSON()));
    },
  });
  {
    const res = await fetch(`http://localhost:${server.port}`, {
      keepalive: false,
    });
    const headers = await res.json();
    expect(headers.connection).toBeUndefined();
  }

  {
    const res = await fetch(`http://localhost:${server.port}`, {
      keepalive: true,
    });
    const headers = await res.json();
    expect(headers.connection).toBe("keep-alive");
  }

  {
    const res = await fetch(`http://localhost:${server.port}`, {
      keepalive: false,
      headers: {
        "Connection": "HELLO!",
      },
    });
    const headers = await res.json();
    expect(headers.connection).toBe("HELLO!");
  }
});
