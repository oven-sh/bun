import { test, expect, describe } from "bun:test";
import { RequestInit } from "undici-types";

// https://github.com/oven-sh/bun/issues/4718
test("fetch() calls request.method & request.url getters on subclass", async () => {
  class MyRequest extends Request {
    constructor(input: string, init?: RequestInit, actual_url?: string) {
      super(input, init);

      Object.defineProperty(this, "url", {
        get() {
          return actual_url;
        },
      });
    }

    // @ts-ignore
    get method() {
      return "POST";
    }
  }

  const server = Bun.serve({
    fetch(req) {
      return new Response(req.method);
    },
    port: 0,
  });

  const request = new MyRequest("https://example.com", {}, server.url.href);
  expect(request.method).toBe("POST");
  const response = await fetch(request);
  expect(await response.text()).toBe("POST");
  server.stop(true);
});
