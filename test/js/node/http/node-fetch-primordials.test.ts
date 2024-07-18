import { test, expect } from "bun:test";

test("fetch, Response, Request can be overriden", async () => {
  const { Response, Request } = globalThis;
  globalThis.Response = class BadResponse {};
  globalThis.Request = class BadRequest {};
  globalThis.fetch = function badFetch() {};

  const fetch = require("node-fetch").fetch;

  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      return new Response("Hello, World!");
    },
  });

  const response = await fetch(server.url);
  expect(response).toBeInstanceOf(Response);
});
