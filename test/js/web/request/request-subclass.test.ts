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

      Object.defineProperty(this, "headers", {
        get() {
          return {
            "X-My-Header": "123",
          };
        },
      });
    }

    // @ts-ignore
    get method() {
      return "POST";
    }
  }

  using server = Bun.serve({
    fetch(req) {
      return new Response(req.method, { headers: req.headers });
    },
    port: 0,
  });

  const request = new MyRequest("https://example.com", {}, server.url.href);

  expect(request.method).toBe("POST");
  const response = await fetch(request);
  expect(await response.text()).toBe("POST");
  expect(response.headers.get("X-My-Header")).toBe("123");
});

test("fetch() with subclass containing invalid HTTP headers throws without crashing", async () => {
  class MyRequest extends Request {
    constructor(input: string, init?: RequestInit, actual_url?: string) {
      super(input, init);

      Object.defineProperty(this, "url", {
        get() {
          return actual_url;
        },
      });

      Object.defineProperty(this, "headers", {
        get() {
          return {
            "[I am not a valid header]!": "123",
          };
        },
      });
    }

    // @ts-ignore
    get method() {
      return "POST";
    }
  }

  const request = new MyRequest("https://example.com", {}, "https://example.com");
  expect(request.method).toBe("POST");
  expect(() => fetch(request)).toThrow("Invalid header name");

  // quick gc test
  for (let i = 0; i < 1e4; i++) {
    try {
      fetch(request);
    } catch (e) {}
  }

  expect(() => fetch(request)).toThrow("Invalid header name");
});
