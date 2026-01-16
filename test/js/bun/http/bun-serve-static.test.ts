import { afterAll, beforeAll, describe, expect, it, mock, test } from "bun:test";
import { fillRepeating, isBroken, isMacOS, isWindows } from "harness";

const routes = {
  "/foo": new Response("foo", {
    headers: {
      "Content-Type": "text/plain",
      "X-Foo": "bar",
    },
  }),
  "/big": new Response(
    (() => {
      const buf = Buffer.alloc(1024 * 1024 * 4);
      const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_*^!@#$%^&*()+=?><:;{}[]|\\ \n";

      function randomAnyCaseLetter() {
        return alphabet[(Math.random() * alphabet.length) | 0];
      }

      for (let i = 0; i < 1024; i++) {
        buf[i] = randomAnyCaseLetter();
      }
      fillRepeating(buf, 0, 1024);
      return buf;
    })(),
  ),
  "/redirect": Response.redirect("/foo/bar", 302),
  "/foo/bar": new Response("/foo/bar", {
    headers: {
      "Content-Type": "text/plain",
      "X-Foo": "bar",
    },
  }),
  "/redirect/fallback": Response.redirect("/foo/bar/fallback", 302),
};
const static_responses = {};
for (const [path, response] of Object.entries(routes)) {
  static_responses[path] = await response.clone().blob();
}

describe.todoIf(isBroken && isMacOS)("static", () => {
  let server: Server;
  let handler = mock(req => {
    return new Response(req.url, {
      headers: {
        ...req.headers,
        Location: undefined,
      },
    });
  });
  afterAll(() => {
    server.stop(true);
  });

  beforeAll(async () => {
    server = Bun.serve({
      static: routes,
      port: 0,
      fetch: handler,
    });
    server.unref();
  });

  it("reload", async () => {
    const modified = { ...routes };
    modified["/foo"] = new Response("modified", {
      headers: {
        "Content-Type": "text/plain",
      },
    });
    server.reload({
      static: modified,

      fetch: handler,
    });

    const res = await fetch(`${server.url}foo`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("modified");
    server.reload({
      static: routes,
      fetch: handler,
    });
  });

  describe.each(["/foo", "/big", "/foo/bar"])("%s", path => {
    it("GET", async () => {
      const previousCallCount = handler.mock.calls.length;

      const res = await fetch(`${server.url}${path}`);
      expect(res.status).toBe(200);
      expect(await res.bytes()).toEqual(await static_responses[path].bytes());
      expect(handler.mock.calls.length, "Handler should not be called").toBe(previousCallCount);
    });

    it("HEAD", async () => {
      const previousCallCount = handler.mock.calls.length;

      const res = await fetch(`${server.url}${path}`, { method: "HEAD" });
      expect(res.status).toBe(200);
      expect(await res.bytes()).toHaveLength(0);
      expect(res.headers.get("Content-Length")).toBe(static_responses[path].size.toString());
      expect(handler.mock.calls.length, "Handler should not be called").toBe(previousCallCount);
    });

    describe.each(["access .body", "don't access .body"])("stress (%s)", label => {
      test.each(["arrayBuffer", "blob", "bytes", "text"])(
        "%s",
        async method => {
          const byteSize = static_responses[path][method]?.size;

          const bytes = method === "blob" ? static_responses[path] : await static_responses[path][method]();

          // macOS limits backlog to 128.
          // When we do the big request, reduce number of connections but increase number of iterations
          const batchSize = Math.ceil((byteSize > 1024 * 1024 ? 48 : 64) / (isWindows ? 8 : 1));
          const iterations = Math.ceil((byteSize > 1024 * 1024 ? 10 : 12) / (isWindows ? 8 : 1));

          async function iterate() {
            let array = new Array(batchSize);
            const route = `${server.url}${path.substring(1)}`;
            for (let i = 0; i < batchSize; i++) {
              array[i] = fetch(route)
                .then(res => {
                  expect(res.status).toBe(200);
                  expect(res.url).toBe(route);
                  if (label === "access .body") {
                    res.body;
                  }
                  return res[method]();
                })
                .then(output => {
                  expect(output).toStrictEqual(bytes);
                });
            }

            await Promise.all(array);

            Bun.gc();
          }

          for (let i = 0; i < iterations; i++) {
            await iterate();
          }

          Bun.gc(true);
          const baseline = (process.memoryUsage.rss() / 1024 / 1024) | 0;
          let lastRSS = baseline;
          console.log("Start RSS", baseline);
          for (let i = 0; i < iterations; i++) {
            await iterate();
            const rss = (process.memoryUsage.rss() / 1024 / 1024) | 0;
            if (lastRSS + 50 < rss) {
              console.log("RSS Growth", rss - lastRSS);
            }
            lastRSS = rss;
          }
          Bun.gc(true);

          const rss = (process.memoryUsage.rss() / 1024 / 1024) | 0;
          expect(rss).toBeLessThan(4092);
          const delta = rss - baseline;
          console.log("Final RSS", rss);
          console.log("Delta RSS", delta);
        },
        40 * 1000,
      );
    });
  });

  it("/redirect", async () => {
    const previousCallCount = handler.mock.calls.length;
    const res = await fetch(`${server.url}/redirect`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/foo/bar");
    expect(handler.mock.calls.length, "Handler should not be called").toBe(previousCallCount);
  });

  it("/redirect (follow)", async () => {
    const previousCallCount = handler.mock.calls.length;
    const res = await fetch(`${server.url}/redirect`);
    expect(res.status).toBe(200);
    expect(res.url).toBe(`${server.url}foo/bar`);
    expect(await res.text()).toBe("/foo/bar");
    expect(handler.mock.calls.length, "Handler should not be called").toBe(previousCallCount);
    expect(res.redirected).toBeTrue();
  });

  it("/redirect/fallback", async () => {
    const previousCallCount = handler.mock.calls.length;
    const res = await fetch(`${server.url}/redirect/fallback`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(`${server.url}foo/bar/fallback`);
    expect(handler.mock.calls.length, "Handler should be called").toBe(previousCallCount + 1);
  });
});

// Regression test for #24817
// https://github.com/oven-sh/bun/issues/24817
// Unicode not working with static route
test("static routes should handle unicode correctly", async () => {
  using server = Bun.serve({
    port: 0,
    routes: {
      "/dynamic": () => new Response("▲"),
      "/static": new Response("▲"),
      "/unicode-string": new Response("こんにちは世界"),
      "/emoji": new Response("🎉🚀✨"),
    },
  });

  const baseUrl = server.url.href;

  // Test basic unicode character
  {
    const staticResp = await fetch(`${baseUrl}/static`);

    const staticText = await staticResp.text();
    expect(staticText).toBe("▲");
    expect(staticResp.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  }

  // Test Japanese characters
  {
    const resp = await fetch(`${baseUrl}/unicode-string`);
    const text = await resp.text();

    expect(text).toBe("こんにちは世界");
    expect(resp.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  }

  // Test emoji
  {
    const resp = await fetch(`${baseUrl}/emoji`);
    const text = await resp.text();

    expect(text).toBe("🎉🚀✨");
    expect(resp.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  }
});

// Regression test for #24817
test("static routes with explicit content-type should not override", async () => {
  using server = Bun.serve({
    port: 0,
    routes: {
      "/custom": new Response("▲", { headers: { "content-type": "text/html" } }),
    },
  });

  const baseUrl = server.url.href;

  const resp = await fetch(`${baseUrl}/custom`);
  const text = await resp.text();

  expect(text).toBe("▲");
  // Should respect the explicit content-type
  expect(resp.headers.get("content-type")).toBe("text/html");
});
