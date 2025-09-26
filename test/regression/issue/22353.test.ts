import { expect, test } from "bun:test";

test("issue #22353 - server should handle oversized request without crashing", async () => {
  using server = Bun.serve({
    port: 0,
    maxRequestBodySize: 1024, // 1KB limit
    async fetch(req) {
      const body = await req.text();
      return new Response(
        JSON.stringify({
          received: true,
          size: body.length,
        }),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
    },
  });

  const resp = await fetch(server.url, {
    method: "POST",
    body: "A".repeat(1025),
  });
  expect(resp.status).toBe(413);
  expect(await resp.text()).toBeEmpty();
  const resp2 = await fetch(server.url, {
    method: "POST",
    body: "A".repeat(1023),
  });
  expect(resp2.status).toBe(200);
  expect(await resp2.json()).toEqual({
    received: true,
    size: 1023,
  });
}, 10000);
