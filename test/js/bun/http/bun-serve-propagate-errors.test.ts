import { expect, test } from "bun:test";

test("Bun.serve() propagates errors to the parent", async () => {
  expect(async () => {
    using server = Bun.serve({
      development: false,
      port: 0,
      fetch(req) {
        throw new Error("woopsie");
      },
    });
    await fetch(server.url);
  }).toThrow("woopsie");
});
