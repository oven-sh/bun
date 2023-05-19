import { fetch, Response, Request, Headers } from "node-fetch";

import { test, expect } from "bun:test";

test("node-fetch", () => {
  expect(Response).toBe(globalThis.Response);
  expect(Request).toBe(globalThis.Request);
  expect(Headers).toBe(globalThis.Headers);
  expect(fetch).toBe(Bun.fetch);
});
