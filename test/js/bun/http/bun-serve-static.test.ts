import { afterAll, beforeAll, describe, expect, it, mock, test } from "bun:test";
import { isBroken, isMacOS, isWindows, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { closeSync, openSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { routes, static_responses } from "./bun-serve-static-helpers";

describe.todoIf(isBroken && isMacOS)("static", () => {
  let server: Bun.Server<undefined>;
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
      // @ts-expect-error legacy option name
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
      // @ts-expect-error legacy option name
      static: modified,

      fetch: handler,
    });

    const res = await fetch(`${server.url}foo`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("modified");
    server.reload({
      // @ts-expect-error legacy option name
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
  async function contentTypeOf(server: Bun.Server<undefined>, path: string) {
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
      // @ts-expect-error legacy option name
      static: { "/a": response, "/b": response },
      fetch: () => new Response("fallback"),
    });

    expect({
      a: await contentTypeOf(server, "/a"),
      b: await contentTypeOf(server, "/b"),
    }).toEqual({ a: expected, b: expected });

    // server.reload() re-registers the very same Response object.
    // @ts-expect-error legacy option name
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
      // @ts-expect-error legacy option name
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
      // @ts-expect-error legacy option name
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
      static: await rawDateLines(server.port!, "/static"),
      handler: await rawDateLines(server.port!, "/handler"),
      fallback: await rawDateLines(server.port!, "/fallback"),
    }).toEqual({
      static: [`Date: ${pinned}`],
      handler: [`Date: ${pinned}`],
      fallback: [`Date: ${pinned}`],
    });

    // HEAD and 304 go through the same header-writing path.
    expect(await rawDateLines(server.port!, "/static", "HEAD")).toEqual([`Date: ${pinned}`]);
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

    expect(await rawDateLines(server.port!, "/file")).toEqual([`Date: ${pinned}`]);
  });

  test("without a user-set Date, exactly one auto Date is sent", async () => {
    await using server = Bun.serve({
      port: 0,
      development: false,
      routes: { "/static": new Response("B") },
      fetch: () => new Response("fallback"),
    });

    const dates = await rawDateLines(server.port!, "/static");
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
  let server: Bun.Server<undefined>;

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

// A route shares the payload of its Response: the Response stays unused. A
// stream the program took off `.body` before is still the body afterwards,
// unlocked and with every byte. A Bun.file() body is a file route, the rest
// are static routes.
describe("a Response whose .body was read stays the program's after it is used as a route", () => {
  const text = "every byte of a small file on disk\n";
  const bodies: [string, (dir: string) => BodyInit][] = [
    ["a string", () => text],
    ["a Uint8Array", () => new TextEncoder().encode(text)],
    ["a Blob", () => new Blob([text])],
    ["a Bun.file()", dir => Bun.file(join(dir, "a.txt"))],
  ];
  const uses: [string, (response: Response, stream: ReadableStream, dir: string) => Promise<string>][] = [
    ["a read of the stream", (response, stream) => new Response(stream).text()],
    ["stream.tee()", (response, stream) => new Response(stream.tee()[0]).text()],
    ["response.text()", response => response.text()],
    ["response.clone().text()", response => response.clone().text()],
    [
      "Bun.write(path, response)",
      async (response, stream, dir) => {
        await Bun.write(join(dir, "out.txt"), response);
        return Bun.file(join(dir, "out.txt")).text();
      },
    ],
  ];

  describe.each(bodies)("over %s", (bodyName, body) => {
    test.each(uses)("%s gives the whole body", async (useName, use) => {
      using dir = tempDir("serve-route-body-stream", { "a.txt": text });
      const response = new Response(body(String(dir)));
      const stream = response.body!;
      await using server = Bun.serve({
        port: 0,
        // One Response on two routes: a route does not use its Response up.
        routes: { "/a": response, "/b": response },
        fetch: () => new Response("not found", { status: 404 }),
      });
      const head = await fetch(new URL("/a", server.url), { method: "HEAD" });
      expect({
        a: await (await fetch(new URL("/a", server.url))).text(),
        b: await (await fetch(new URL("/b", server.url))).text(),
        head: [head.status, head.headers.get("content-length")],
        locked: stream.locked,
        sameStream: response.body === stream,
        bodyUsed: response.bodyUsed,
      }).toEqual({
        a: text,
        b: text,
        head: [200, String(text.length)],
        locked: false,
        sameStream: true,
        bodyUsed: false,
      });
      expect(await use(response, stream, String(dir))).toBe(text);
      // The route has its own share of the payload.
      expect(await (await fetch(new URL("/a", server.url))).text()).toBe(text);
    });
  });

  // The share has the window and the type of the payload behind the stream.
  // [name, body, the bytes it holds, the Content-Type the route serves]
  const windows: [string, (dir: string) => BodyInit, string, string | null][] = [
    ["a slice of a Blob", () => new Blob([text]).slice(6, 10), "byte", null],
    ["a Blob with a type", () => new Blob([text], { type: "text/html" }), text, "text/html;charset=utf-8"],
    [
      "a slice of a Blob with a type",
      () => new Blob([text], { type: "text/html" }).slice(6, 10, "text/x-part"),
      "byte",
      "text/x-part",
    ],
    ["a slice of a Bun.file()", dir => Bun.file(join(dir, "a.txt")).slice(6, 10), "byte", "text/plain;charset=utf-8"],
    ["a ReadableStream that closed with nothing in it", () => new ReadableStream({ start: c => c.close() }), "", null],
  ];
  test.each(windows)("over %s, the route and the stream give the same bytes", async (name, body, bytes, type) => {
    using dir = tempDir("serve-route-body-window", { "a.txt": text });
    const response = new Response(body(String(dir)));
    const stream = response.body!;
    await using server = Bun.serve({
      port: 0,
      routes: { "/a": response },
      fetch: () => new Response("not found", { status: 404 }),
    });
    const served = await fetch(new URL("/a", server.url));
    expect({
      served: await served.text(),
      type: served.headers.get("content-type"),
      length: served.headers.get("content-length"),
      locked: stream.locked,
      sameStream: response.body === stream,
      bodyUsed: response.bodyUsed,
    }).toEqual({
      served: bytes,
      type,
      length: String(bytes.length),
      locked: false,
      sameStream: true,
      bodyUsed: false,
    });
    expect(await new Response(stream).text()).toBe(bytes);
  });

  // Two readers would compete for the bytes of a pipe. So the route takes the
  // pipe over, as it did before, and the stream is spent.
  test.skipIf(isWindows)("a pipe behind .body goes to the route, not to two readers", async () => {
    using dir = tempDir("serve-route-fifo", {});
    const fifo = join(String(dir), "body.fifo");
    mkfifo(fifo);
    const response = new Response(Bun.file(fifo));
    const stream = response.body!;
    await using server = Bun.serve({
      port: 0,
      routes: { "/a": response },
      fetch: () => new Response("not found", { status: 404 }),
    });
    expect(stream.locked).toBe(true);
  });

  // A network body that arrives after `.body` was read sits in a byte stream.
  // The route copies it and the stream keeps it.
  test("over a fetched Response, a read of the stream gives the whole body", async () => {
    const { promise: rest, resolve: sendRest } = Promise.withResolvers<void>();
    await using origin = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          new ReadableStream({
            async start(controller) {
              controller.enqueue(text.slice(0, 11));
              await rest;
              controller.enqueue(text.slice(11));
              controller.close();
            },
          }),
        ),
    });
    const response = await fetch(origin.url);
    const stream = response.body!;
    sendRest();
    // A route needs the whole body. Until the rest arrives, Bun.serve refuses
    // the Response and leaves it as it is. Nothing else shows that the rest
    // arrived, so this polls. After the deadline the refusal is the failure.
    const serveOnceArrived = async () => {
      const deadline = Date.now() + 4000;
      for (;;) {
        try {
          return Bun.serve({
            port: 0,
            routes: { "/a": response },
            fetch: () => new Response("not found", { status: 404 }),
          });
        } catch (error) {
          if (Date.now() > deadline) throw error;
          expect(String(error)).toContain("Body must be fully buffered");
          await new Promise(resolve => setImmediate(resolve));
        }
      }
    };
    await using server = await serveOnceArrived();
    expect({
      a: await (await fetch(new URL("/a", server.url))).text(),
      locked: stream.locked,
      sameStream: response.body === stream,
      bodyUsed: response.bodyUsed,
    }).toEqual({ a: text, locked: false, sameStream: true, bodyUsed: false });
    expect(await new Response(stream).text()).toBe(text);
    expect(await (await fetch(new URL("/a", server.url))).text()).toBe(text);
  });

  // The route looks at the file, it does not stat it into the store that the
  // program's Bun.file() answers from.
  test("a route over a Bun.file() stream leaves that Bun.file() following the file", async () => {
    using dir = tempDir("serve-route-file-size", { "a.txt": "12345" });
    const path = join(String(dir), "a.txt");
    const file = Bun.file(path);
    const response = new Response(file.stream());
    await using server = Bun.serve({
      port: 0,
      routes: { "/a": response },
      fetch: () => new Response("not found", { status: 404 }),
    });
    expect(await (await fetch(new URL("/a", server.url))).text()).toBe("12345");
    writeFileSync(path, "123456789");
    expect(file.size).toBe(9);
  });

  // A file descriptor cannot be a route. The refusal comes from a look at the
  // body, so the stream is not spent for a route that was never made.
  test("a refused Bun.file(fd) route leaves the stream that was read off .body unlocked", async () => {
    using dir = tempDir("serve-route-fd", { "a.txt": text });
    const fd = openSync(join(String(dir), "a.txt"), "r");
    try {
      const response = new Response(Bun.file(fd));
      const stream = response.body!;
      expect(() =>
        Bun.serve({ port: 0, routes: { "/a": response }, fetch: () => new Response("not found", { status: 404 }) }),
      ).toThrow("Support serving files from a file descriptor. Please pass a path instead.");
      expect({
        locked: stream.locked,
        sameStream: response.body === stream,
        bodyUsed: response.bodyUsed,
        text: await response.text(),
      }).toEqual({ locked: false, sameStream: true, bodyUsed: false, text });
    } finally {
      closeSync(fd);
    }
  });
});
