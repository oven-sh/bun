import { expect, test } from "bun:test";

test("server.fetch should reject invalid argument types without crashing", async () => {
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response("Hello World!");
    },
  });
  // @ts-expect-error
  await expect(server.fetch(1n)).rejects.toThrow("fetch() expects a string, but received BigInt");
  // @ts-expect-error
  await expect(server.fetch(Symbol("x"))).rejects.toThrow("fetch() expects a string, but received Symbol");
  // @ts-expect-error
  await expect(server.fetch(true)).rejects.toThrow("fetch() expects a string, but received Boolean");
  // @ts-expect-error
  await expect(server.fetch(1)).rejects.toThrow("fetch() expects a string, but received Number");
});
