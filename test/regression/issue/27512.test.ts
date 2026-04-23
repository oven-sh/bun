import { expect, test } from "bun:test";

test("413 responses should include a Date header", async () => {
  using server = Bun.serve({
    port: 0,
    maxRequestBodySize: 1,
    fetch() {
      return new Response("Hello Bun");
    },
  });

  const res = await fetch(`http://localhost:${server.port}/`, {
    method: "POST",
    body: "12",
  });
  expect(res.status).toBe(413);
  expect(res.headers.get("date")).not.toBeNull();
});
