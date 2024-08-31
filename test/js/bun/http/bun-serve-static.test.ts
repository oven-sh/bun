import { test, expect, mock, beforeAll, describe, afterAll, it } from "bun:test";
import { server } from "bun";
import { fillRepeating, isWindows } from "harness";

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

      for (let i = 0; i < 1024; i++) {
        buf[i] = (Math.random() * 256) | 0;
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

describe("static", () => {
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

  it.each(["/foo", "/big", "/foo/bar"])("-> %s", async path => {
    const previousCallCount = handler.mock.calls.length;
    const res = await fetch(`${server.url}${path}`);
    expect(res.status).toBe(200);
    expect(await res.bytes()).toEqual(await static_responses[path].bytes());
    expect(handler.mock.calls.length, "Handler should not be called").toBe(previousCallCount);
  });
  describe("stress test", () => {
    it.each(["/foo", "/big", "/foo/bar"])(
      "%s",
      async path => {
        const bytes = await static_responses[path].arrayBuffer();
        // macOS limits backlog to 128.
        // When we do the big request, reduce number of connections but increase number of iterations
        const batchSize = Math.ceil((bytes.size > 1024 * 1024 ? 48 : 64) / (isWindows ? 8 : 1));
        const iterations = Math.ceil((bytes.size > 1024 * 1024 ? 10 : 12) / (isWindows ? 8 : 1));

        async function iterate() {
          let array = new Array(batchSize);
          const route = `${server.url}${path.substring(1)}`;
          for (let i = 0; i < batchSize; i++) {
            array[i] = fetch(route)
              .then(res => {
                expect(res.status).toBe(200);

                expect(res.url).toBe(route);
                return res.arrayBuffer();
              })
              .then(output => {
                expect(output).toStrictEqual(bytes);
              });
          }

          await Promise.all(array);
          console.count("Iteration: " + path);
          Bun.gc();
        }

        for (let i = 0; i < iterations; i++) {
          await iterate();
        }

        Bun.gc(true);
        const baseline = (process.memoryUsage.rss() / 1024 / 1024) | 0;
        console.log("Baseline RSS", baseline);
        for (let i = 0; i < iterations; i++) {
          await iterate();
          console.log("RSS", (process.memoryUsage.rss() / 1024 / 1024) | 0);
        }
        Bun.gc(true);

        const rss = (process.memoryUsage.rss() / 1024 / 1024) | 0;
        expect(rss).toBeLessThan(baseline * 4);
      },
      30 * 1000,
    );
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
