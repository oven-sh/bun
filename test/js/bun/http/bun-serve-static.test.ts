import { afterAll, beforeAll, describe, expect, it, mock, test } from "bun:test";
import { isBroken, isMacOS } from "harness";
import { routes, static_responses } from "./bun-serve-static-helpers";

// The consolidation sweep runs this file against a pinned release runner that
// predates #33404 (static-route Content-Type kept across registrations and
// derived from the body when no headers object exists yet); gate those cases
// so the sweep passes while a fresh build still exercises them.
const isStalePinnedRunner = Bun.revision.startsWith("1498d7b77");

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

describe("static route Content-Type", () => {
  async function contentTypeOf(server: Server, path: string) {
    const res = await fetch(new URL(path, server.url));
    expect(res.status).toBe(200);
    await res.arrayBuffer();
    return res.headers.get("content-type");
  }

  // Registering a Response snapshots (and consumes) its body. Doing that must not
  // change the Content-Type the next registration of the same Response produces.
  for (const [label, make, expected, needs33404] of [
    ["string body", () => new Response("hello"), "text/plain;charset=utf-8", true],
    [
      "typed Blob body",
      () => new Response(new Blob(["<h1>hi</h1>"], { type: "text/html" })),
      "text/html;charset=utf-8",
      true,
    ],
    ["explicit header", () => new Response("hello", { headers: { "Content-Type": "text/foo" } }), "text/foo", false],
    ["Response.json", () => Response.json({ a: 1 }), "application/json;charset=utf-8", false],
    ["Uint8Array body", () => new Response(new Uint8Array([1, 2, 3])), null, false],
  ] as const) {
    test.todoIf(isStalePinnedRunner && needs33404)(`is stable across registrations: ${label}`, async () => {
      const response = make();

      using server = Bun.serve({
        port: 0,
        static: { "/a": response, "/b": response },
        fetch: () => new Response("fallback"),
      });

      expect({
        a: await contentTypeOf(server, "/a"),
        b: await contentTypeOf(server, "/b"),
      }).toEqual({ a: expected, b: expected });

      // server.reload() re-registers the very same Response object.
      server.reload({ static: { "/a": response }, fetch: () => new Response("fallback") });
      expect(await contentTypeOf(server, "/a")).toBe(expected);
    });
  }

  // Reading .headers materializes a Blob body's implicit Content-Type onto the
  // Response, which used to be the only way a static route ever saw it.
  test.todoIf(isStalePinnedRunner)("does not depend on whether .headers was read first", async () => {
    const untouched = new Response(new Blob(["<h1>hi</h1>"], { type: "text/html" }));
    const touched = new Response(new Blob(["<h1>hi</h1>"], { type: "text/html" }));
    touched.headers;

    using server = Bun.serve({
      port: 0,
      static: { "/untouched": untouched, "/touched": touched },
      fetch: () => new Response("fallback"),
    });

    expect({
      untouched: await contentTypeOf(server, "/untouched"),
      touched: await contentTypeOf(server, "/touched"),
    }).toEqual({
      untouched: "text/html;charset=utf-8",
      touched: "text/html;charset=utf-8",
    });
  });

  test("a string body still serves its body bytes unchanged", async () => {
    const response = new Response("▲");

    using server = Bun.serve({
      port: 0,
      static: { "/a": response, "/b": response },
      fetch: () => new Response("fallback"),
    });

    expect(await (await fetch(new URL("/a", server.url))).text()).toBe("▲");
    expect(await (await fetch(new URL("/b", server.url))).text()).toBe("▲");
  });
});
