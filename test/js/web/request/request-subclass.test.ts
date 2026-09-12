import { expect, test } from "bun:test";
import type { RequestInit } from "undici-types";

// https://github.com/oven-sh/bun/issues/4718
// A Request subclass is still a Request: fetch() reads its internal state
// (the url, method, and headers captured by the constructor) and never
// consults JS-visible getter overrides, matching the fetch spec and Node.
test("fetch() uses a subclass Request's internal state, not getter overrides", async () => {
  using server = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response(req.method, { headers: req.headers });
    },
  });

  let getterCalls = 0;
  class MyRequest extends Request {
    constructor(input: string | URL, init?: RequestInit, decoy_url?: string) {
      super(input, init);

      Object.defineProperty(this, "url", {
        get() {
          getterCalls++;
          return decoy_url;
        },
      });

      Object.defineProperty(this, "headers", {
        get() {
          getterCalls++;
          return { "x-decoy": "1" };
        },
      });
    }

    // @ts-ignore
    get method() {
      getterCalls++;
      return "DELETE";
    }
  }

  // port 1 refuses connections, so the old getter-reading behavior fails fast
  // without touching the network.
  const request = new MyRequest(
    server.url,
    { method: "POST", headers: { "x-my-header": "123" } },
    "http://127.0.0.1:1/decoy",
  );

  const response = await fetch(request);
  expect(await response.text()).toBe("POST");
  expect(response.headers.get("x-my-header")).toBe("123");
  expect(response.headers.get("x-decoy")).toBeNull();
  expect(getterCalls).toBe(0);
});

test("fetch() ignores a subclass headers getter returning invalid header names", async () => {
  using server = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response("ok", { headers: req.headers });
    },
  });

  class MyRequest extends Request {
    constructor(input: string | URL, init?: RequestInit) {
      super(input, init);

      Object.defineProperty(this, "headers", {
        get() {
          return {
            "[I am not a valid header]!": "123",
          };
        },
      });
    }
  }

  const request = new MyRequest(server.url, { headers: { "x-ok": "1" } });
  const response = await fetch(request);
  expect(await response.text()).toBe("ok");
  expect(response.headers.get("x-ok")).toBe("1");
});
