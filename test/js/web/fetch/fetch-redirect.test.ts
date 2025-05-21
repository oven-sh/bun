import { expect, it } from "bun:test";

// https://github.com/oven-sh/bun/issues/12701
it("fetch() preserves body on redirect", async () => {
  using server = Bun.serve({
    port: 0,

    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === "/redirect") {
        return new Response(null, {
          status: 308,
          headers: {
            Location: "/redirect2",
          },
        });
      }
      if (pathname === "/redirect2") {
        return new Response(req.body, { status: 200 });
      }
      return new Response("you shouldnt see this?", { status: 200 });
    },
  });

  const res = await fetch(new URL("/redirect", server.url), {
    method: "POST",
    body: "hello",
  });

  expect(res.status).toBe(200);
  expect(await res.text()).toBe("hello");
});
