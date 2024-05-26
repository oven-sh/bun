import { test, expect } from "bun:test";

// https://github.com/oven-sh/bun/issues/9180
test("weird headers", async () => {
  using server = Bun.serve({
    port: 0,
    development: false,
    fetch(req) {
      const headers = new Headers();
      req.headers.forEach((value, key) => {
        headers.append(key, value);
      });

      return new Response("OK", {
        headers,
      });
    },
  });

  {
    for (let i = 0; i < 255; i++) {
      const headers = new Headers();
      const name = "X-" + String.fromCharCode(i);
      try {
        headers.set(name, "1");
      } catch {
        continue;
      }

      const res = await fetch(server.url, {
        headers,
      });
      expect(res.headers.get(name)).toBe("1");
    }
  }
});
