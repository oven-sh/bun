import { describe, expect, test } from "bun:test";

// https://fetch.spec.whatwg.org/#http-network-or-cache-fetch steps 15-17:
// the request's `cache` mode must reach the wire as Cache-Control / Pragma
// headers so shared caches (CDNs, proxies) along the path observe it.
describe("fetch() cache mode", () => {
  describe.each(["init", "Request"] as const)("via %s", kind => {
    const opts = (url: string, init: RequestInit) => (kind === "init" ? [url, init] : [new Request(url, init)]);

    test.each([
      ["no-store", "no-cache", "no-cache"],
      ["reload", "no-cache", "no-cache"],
    ] as const)("cache: %s sends Pragma/Cache-Control: no-cache", async (cache, cc, pragma) => {
      await using server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: req => new Response(JSON.stringify(Object.fromEntries(req.headers))),
      });
      const args = opts(server.url.href, { cache }) as [any, any?];
      const h = (await (await fetch(...args)).json()) as Record<string, string>;
      expect({ "cache-control": h["cache-control"], "pragma": h["pragma"] }).toEqual({
        "cache-control": cc,
        "pragma": pragma,
      });
    });

    test("cache: no-cache sends Cache-Control: max-age=0", async () => {
      await using server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: req => new Response(JSON.stringify(Object.fromEntries(req.headers))),
      });
      const args = opts(server.url.href, { cache: "no-cache" }) as [any, any?];
      const h = (await (await fetch(...args)).json()) as Record<string, string>;
      expect(h["cache-control"]).toBe("max-age=0");
      expect(h["pragma"]).toBeUndefined();
    });

    test.each(["default", "force-cache"] as const)("cache: %s sends no cache headers", async cache => {
      await using server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: req => new Response(JSON.stringify(Object.fromEntries(req.headers))),
      });
      const args = opts(server.url.href, { cache }) as [any, any?];
      const h = (await (await fetch(...args)).json()) as Record<string, string>;
      expect(h["cache-control"]).toBeUndefined();
      expect(h["pragma"]).toBeUndefined();
    });
  });

  test("explicit Cache-Control/Pragma are not overwritten", async () => {
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: req => new Response(JSON.stringify(Object.fromEntries(req.headers))),
    });
    const h = (await (
      await fetch(server.url, {
        cache: "no-store",
        headers: { "Cache-Control": "max-age=123", "Pragma": "custom" },
      })
    ).json()) as Record<string, string>;
    expect({ "cache-control": h["cache-control"], "pragma": h["pragma"] }).toEqual({
      "cache-control": "max-age=123",
      "pragma": "custom",
    });
  });

  test("conditional header with default cache mode sends no-cache", async () => {
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: req => new Response(JSON.stringify(Object.fromEntries(req.headers))),
    });
    const h = (await (await fetch(server.url, { headers: { "If-None-Match": '"abc"' } })).json()) as Record<
      string,
      string
    >;
    expect({
      "cache-control": h["cache-control"],
      "pragma": h["pragma"],
      "if-none-match": h["if-none-match"],
    }).toEqual({
      "cache-control": "no-cache",
      "pragma": "no-cache",
      "if-none-match": '"abc"',
    });
  });

  test("init overrides Request cache mode", async () => {
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: req => new Response(JSON.stringify(Object.fromEntries(req.headers))),
    });
    const req = new Request(server.url, { cache: "no-cache" });
    const h = (await (await fetch(req, { cache: "no-store" })).json()) as Record<string, string>;
    expect({ "cache-control": h["cache-control"], "pragma": h["pragma"] }).toEqual({
      "cache-control": "no-cache",
      "pragma": "no-cache",
    });
  });
});

describe("cache: only-if-cached", () => {
  test("new Request() throws TypeError unless mode is same-origin", () => {
    expect(() => new Request("http://example.com/", { cache: "only-if-cached" })).toThrow(TypeError);
    expect(() => new Request("http://example.com/", { cache: "only-if-cached", mode: "cors" })).toThrow(TypeError);
    expect(() => new Request("http://example.com/", { cache: "only-if-cached", mode: "no-cors" })).toThrow(TypeError);
    expect(() => new Request("http://example.com/", { cache: "only-if-cached", mode: "same-origin" })).not.toThrow();
  });

  test("new Request(request) inherits and still validates", () => {
    const ok = new Request("http://example.com/", { cache: "only-if-cached", mode: "same-origin" });
    expect(() => new Request(ok, { mode: "cors" })).toThrow(TypeError);
    expect(() => new Request(ok)).not.toThrow();
  });

  test("fetch() rejects with TypeError unless mode is same-origin", async () => {
    await expect(fetch("http://127.0.0.1:1/", { cache: "only-if-cached" })).rejects.toThrow(TypeError);
    await expect(fetch("http://127.0.0.1:1/", { cache: "only-if-cached", mode: "cors" })).rejects.toThrow(TypeError);
  });
});
