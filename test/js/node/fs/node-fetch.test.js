import fetch2, { fetch, Response, Request, Headers } from "node-fetch";
import * as iso from "isomorphic-fetch";
import * as vercelFetch from "@vercel/fetch";

import { test, expect } from "bun:test";

test("node-fetch", () => {
  expect(Response).toBe(globalThis.Response);
  expect(Request).toBe(globalThis.Request);
  expect(Headers).toBe(globalThis.Headers);
});

for (const [impl, name] of [
  [fetch, "node-fetch.fetch"],
  [fetch2, "node-fetch.default"],
  [fetch2.default, "node-fetch.default.default"],
  [iso.fetch, "isomorphic-fetch.fetch"],
  [iso.default.fetch, "isomorphic-fetch.default.fetch"],
  [iso.default, "isomorphic-fetch.default"],
  [vercelFetch.default(fetch), "@vercel/fetch.default"],
]) {
  test(name + " fetches", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req, server) {
        server.stop();
        return new Response();
      },
    });
    expect(await impl("http://" + server.hostname + ":" + server.port)).toBeInstanceOf(Response);
    server.stop(true);
  });
}
