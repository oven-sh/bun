import { afterAll, beforeAll, describe, expect, it, mock, test } from "bun:test";
import { isBroken, isMacOS, tempDir } from "harness";
import { routes, static_responses } from "./bun-serve-static-helpers";

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
  test.each([
    ["string body", () => new Response("hello"), "text/plain;charset=utf-8"],
    [
      "typed Blob body",
      () => new Response(new Blob(["<h1>hi</h1>"], { type: "text/html" })),
      "text/html;charset=utf-8",
    ],
    ["explicit header", () => new Response("hello", { headers: { "Content-Type": "text/foo" } }), "text/foo"],
    ["Response.json", () => Response.json({ a: 1 }), "application/json;charset=utf-8"],
    ["Uint8Array body", () => new Response(new Uint8Array([1, 2, 3])), null],
  ])("is stable across registrations: %s", async (_label, make, expected) => {
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

  // Reading .headers materializes a Blob body's implicit Content-Type onto the
  // Response, which used to be the only way a static route ever saw it.
  test("does not depend on whether .headers was read first", async () => {
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

// RFC 9110 §6.6.1: Date is a singleton field. When a Response already carries a
// Date header, the static-route serializer must not append Bun's own clock.
describe("static route Date header", () => {
  const pinned = "Mon, 01 Jan 2001 00:00:00 GMT";

  async function rawDateLines(port: number, path: string, method = "GET") {
    const { promise, resolve } = Promise.withResolvers<string>();
    let buf = "";
    await Bun.connect({
      hostname: "127.0.0.1",
      port,
      socket: {
        open(s) {
          s.write(`${method} ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
        },
        data(_s, d) {
          buf += Buffer.from(d).toString("latin1");
        },
        close() {
          resolve(buf);
        },
        error() {
          resolve(buf);
        },
      },
    });
    const head = (await promise).split("\r\n\r\n")[0];
    return head.split("\r\n").filter(l => /^date:/i.test(l));
  }

  test("a user-set Date is sent exactly once", async () => {
    await using server = Bun.serve({
      port: 0,
      development: false,
      routes: {
        "/static": new Response("B", { headers: { date: pinned } }),
        "/handler": () => new Response("B", { headers: { date: pinned } }),
      },
      fetch: () => new Response("B", { headers: { date: pinned } }),
    });

    expect({
      static: await rawDateLines(server.port, "/static"),
      handler: await rawDateLines(server.port, "/handler"),
      fallback: await rawDateLines(server.port, "/fallback"),
    }).toEqual({
      static: [`Date: ${pinned}`],
      handler: [`Date: ${pinned}`],
      fallback: [`Date: ${pinned}`],
    });

    // HEAD and 304 go through the same header-writing path.
    expect(await rawDateLines(server.port, "/static", "HEAD")).toEqual([`Date: ${pinned}`]);
  });

  test("a user-set Date on a Bun.file route is sent exactly once", async () => {
    using dir = tempDir("static-date", { "a.txt": "hi" });
    await using server = Bun.serve({
      port: 0,
      development: false,
      routes: {
        "/file": new Response(Bun.file(`${dir}/a.txt`), { headers: { date: pinned } }),
      },
      fetch: () => new Response("fallback"),
    });

    expect(await rawDateLines(server.port, "/file")).toEqual([`Date: ${pinned}`]);
  });

  test("without a user-set Date, exactly one auto Date is sent", async () => {
    await using server = Bun.serve({
      port: 0,
      development: false,
      routes: { "/static": new Response("B") },
      fetch: () => new Response("fallback"),
    });

    const dates = await rawDateLines(server.port, "/static");
    expect(dates).toHaveLength(1);
    expect(dates[0]).not.toContain(pinned);
  });
});

// RFC 9110 §13.2.2: preconditions evaluate in order (1) If-Match, else
// (2) If-Unmodified-Since; then (3) If-None-Match, else (4) If-Modified-Since.
// Steps 1/2 must short-circuit with 412 before steps 3/4 can yield 304.
describe("static route preconditions (RFC 9110 §13.2.2)", () => {
  const LM = "Wed, 21 Oct 2015 07:28:00 GMT";
  const EARLIER = "Mon, 01 Jan 2001 00:00:00 GMT";
  const LATER = "Sat, 01 Jan 2028 00:00:00 GMT";
  let server: Server;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      routes: {
        "/s": new Response("static-body", { headers: { etag: '"s1"', "last-modified": LM } }),
        "/weak": new Response("static-body", { headers: { etag: 'W/"w1"', "last-modified": LM } }),
      },
      fetch: () => new Response("nf", { status: 404 }),
    });
  });
  afterAll(() => server.stop(true));

  const get = (path: string, headers: Record<string, string>, method = "GET") =>
    fetch(new URL(path, server.url), { method, headers }).then(async r => ({
      status: r.status,
      body: await r.text(),
      etag: r.headers.get("etag"),
    }));

  describe.each(["GET", "HEAD"])("%s", method => {
    it("If-Match: non-matching tag → 412", async () => {
      expect(await get("/s", { "If-Match": '"zz"' }, method)).toEqual({ status: 412, body: "", etag: '"s1"' });
    });

    it("If-Match: matching strong tag → 200", async () => {
      const r = await get("/s", { "If-Match": '"s1"' }, method);
      expect(r.status).toBe(200);
      if (method === "GET") expect(r.body).toBe("static-body");
    });

    it("If-Match: list with one matching tag → 200", async () => {
      expect((await get("/s", { "If-Match": '"a", "s1", "b"' }, method)).status).toBe(200);
    });

    it("If-Match: * → 200", async () => {
      expect((await get("/s", { "If-Match": "*" }, method)).status).toBe(200);
    });

    it('If-Match: W/"s1" uses strong compare → 412', async () => {
      // §8.8.3.2 strong comparison: a weak client tag never matches.
      expect((await get("/s", { "If-Match": 'W/"s1"' }, method)).status).toBe(412);
    });

    it("If-Match against a weak stored ETag → 412 (strong compare)", async () => {
      expect((await get("/weak", { "If-Match": '"w1"' }, method)).status).toBe(412);
    });

    it("If-Unmodified-Since earlier than Last-Modified → 412", async () => {
      expect(await get("/s", { "If-Unmodified-Since": EARLIER }, method)).toEqual({
        status: 412,
        body: "",
        etag: '"s1"',
      });
    });

    it("If-Unmodified-Since equal to Last-Modified → 200", async () => {
      expect((await get("/s", { "If-Unmodified-Since": LM }, method)).status).toBe(200);
    });

    it("If-Unmodified-Since later than Last-Modified → 200", async () => {
      expect((await get("/s", { "If-Unmodified-Since": LATER }, method)).status).toBe(200);
    });

    it("If-Match failure + matching If-None-Match → 412 (not 304)", async () => {
      // Step 1 fails: 412 is mandatory; step 3 must not run.
      expect((await get("/s", { "If-Match": '"zz"', "If-None-Match": '"s1"' }, method)).status).toBe(412);
    });

    it("If-Unmodified-Since failure + matching If-None-Match → 412 (not 304)", async () => {
      expect((await get("/s", { "If-Unmodified-Since": EARLIER, "If-None-Match": '"s1"' }, method)).status).toBe(412);
    });

    it("If-Match present suppresses If-Unmodified-Since", async () => {
      // Step 2 only runs when If-Match is absent: a passing If-Match with a
      // failing IUS still yields 200.
      expect((await get("/s", { "If-Match": '"s1"', "If-Unmodified-Since": EARLIER }, method)).status).toBe(200);
    });

    it("If-Match pass then If-None-Match match → 304", async () => {
      expect((await get("/s", { "If-Match": '"s1"', "If-None-Match": '"s1"' }, method)).status).toBe(304);
    });
  });
});
