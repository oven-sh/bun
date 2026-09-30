import type { BunRequest, ServeOptions, Server } from "bun";
import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, tempDir, tls } from "harness";
import net from "node:net";
import { join } from "node:path";
import { connect as connectQuic, QuicEndpoint } from "node:quic";
import { connectH2, request as requestH2 } from "./serve-http2-helpers";

describe("path parameters", () => {
  let server: Server;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch: () => new Response("fallback"),
      routes: {
        "/users/:id": req => {
          return new Response(
            JSON.stringify({
              id: req.params.id,
              method: req.method,
            }),
          );
        },
        "/posts/:postId/comments/:commentId": (req: BunRequest<"/posts/:postId/comments/:commentId">) => {
          console.log(req.params);
          return new Response(JSON.stringify(req.params));
        },
      },
    });
    server.unref();
  });

  afterAll(() => {
    server.stop(true);
  });

  it("handles single parameter", async () => {
    const res = await fetch(`${server.url}users/123`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({
      id: "123",
      method: "GET",
    });
  });

  it("handles multiple parameters", async () => {
    const res = await fetch(new URL(`/posts/456/comments/789`, server.url).href);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({
      postId: "456",
      commentId: "789",
    });
  });

  it("handles encoded parameters", async () => {
    const res = await fetch(new URL(`/users/user@example.com`, server.url).href);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({
      id: "user@example.com",
      method: "GET",
    });
  });

  it("handles unicode parameters", async () => {
    const res = await fetch(`${server.url}users/🦊`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({
      id: "🦊",
      method: "GET",
    });
  });

  it.each([
    ["valid UTF-8 bytes", [0xc3, 0xa9], "é"],
    ["an invalid UTF-8 byte", [0xe9], "�"],
  ])("decodes raw %s in a parameter segment", async (_label, bytes, expected) => {
    const request = Buffer.concat([
      Buffer.from("GET /users/"),
      Buffer.from(bytes),
      Buffer.from(" HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"),
    ]);
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const socket = net.connect(server.port, "127.0.0.1");
    const chunks: Buffer[] = [];
    socket.on("error", reject);
    socket.on("data", chunk => chunks.push(chunk));
    socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    socket.on("connect", () => socket.write(request));
    const response = await promise;
    expect(response).toContain("HTTP/1.1 200");
    expect(JSON.parse(response.slice(response.indexOf("\r\n\r\n") + 4))).toEqual({ id: expected, method: "GET" });
  });
});

describe("HTTP methods", () => {
  let server: Server;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch: () => new Response("fallback"),
      routes: {
        "/api": {
          GET: () => new Response("GET"),
          POST: () => new Response("POST"),
          PUT: () => new Response("PUT"),
          DELETE: () => new Response("DELETE"),
          PATCH: () => new Response("PATCH"),
          OPTIONS: () => new Response("OPTIONS"),
          HEAD: () => new Response("HEAD"),
        },
      },
    });
    server.unref();
  });

  afterAll(() => {
    server.stop(true);
  });

  test.each([["GET"], ["POST"], ["PUT"], ["DELETE"], ["PATCH"], ["OPTIONS"], ["HEAD"]])("%s request", async method => {
    const res = await fetch(`${server.url}api`, { method });
    expect(res.status).toBe(200);
    if (method === "HEAD") {
      expect(await res.text()).toBe("");
    } else {
      expect(await res.text()).toBe(method);
    }
  });
});

describe("implicit HEAD for per-method route objects", () => {
  // HEAD must return the same representation as GET without the body
  // (RFC 9110 section 9.3.2).
  test("HEAD is served by the GET handler when no HEAD handler is declared", async () => {
    await using server = Bun.serve({
      port: 0,
      routes: {
        "/m": { GET: () => new Response("hello-get") },
        "/*": () => new Response("from-catch-all"),
      },
    });

    const get = await fetch(new URL("/m", server.url));
    expect(await get.text()).toBe("hello-get");
    expect(get.status).toBe(200);

    const head = await fetch(new URL("/m", server.url), { method: "HEAD" });
    expect(await head.text()).toBe("");
    expect(head.headers.get("content-length")).toBe("9");
    expect(head.status).toBe(200);

    // Other methods still fall through to the next matching route.
    const post = await fetch(new URL("/m", server.url), { method: "POST" });
    expect(await post.text()).toBe("from-catch-all");
  });

  test("HEAD does not 404 when there is no later route to fall through to", async () => {
    await using server = Bun.serve({
      port: 0,
      routes: { "/only-get": { GET: () => new Response("ok") } },
    });

    const res = await fetch(new URL("/only-get", server.url), { method: "HEAD" });
    expect(await res.text()).toBe("");
    expect(res.headers.get("content-length")).toBe("2");
    expect(res.status).toBe(200);
  });

  test("the GET handler observes the real request method", async () => {
    await using server = Bun.serve({
      port: 0,
      routes: {
        "/echo": { GET: req => new Response("body", { headers: { "x-seen-method": req.method } }) },
      },
    });

    const res = await fetch(new URL("/echo", server.url), { method: "HEAD" });
    expect(res.headers.get("x-seen-method")).toBe("HEAD");
    expect(res.headers.get("content-length")).toBe("4");
    expect(await res.text()).toBe("");
    expect(res.status).toBe(200);
  });

  test("an explicit HEAD handler takes precedence over the GET handler", async () => {
    await using server = Bun.serve({
      port: 0,
      routes: {
        "/explicit": {
          GET: () => new Response("get-body"),
          HEAD: () => new Response(null, { headers: { "x-explicit-head": "1" } }),
        },
      },
    });

    const res = await fetch(new URL("/explicit", server.url), { method: "HEAD" });
    expect(res.headers.get("x-explicit-head")).toBe("1");
    expect(res.status).toBe(200);
  });

  test("an explicit static HEAD Response takes precedence over the GET handler", async () => {
    await using server = Bun.serve({
      port: 0,
      routes: {
        "/explicit-static": {
          GET: () => new Response("get-body"),
          HEAD: new Response(null, { headers: { "x-static-head": "1" } }),
        },
      },
    });

    const res = await fetch(new URL("/explicit-static", server.url), { method: "HEAD" });
    expect(res.headers.get("x-static-head")).toBe("1");
    expect(res.status).toBe(200);
  });

  test("an explicit HEAD handler takes precedence over a static GET Response", async () => {
    await using server = Bun.serve({
      port: 0,
      routes: {
        "/static-get": {
          GET: new Response("get-static"),
          HEAD: () => new Response(null, { headers: { "x-callable-head": "1" } }),
        },
      },
    });

    const head = await fetch(new URL("/static-get", server.url), { method: "HEAD" });
    expect(head.headers.get("x-callable-head")).toBe("1");
    expect(head.status).toBe(200);

    const get = await fetch(new URL("/static-get", server.url));
    expect(await get.text()).toBe("get-static");
    expect(get.status).toBe(200);
  });

  test("a static Response for another method does not capture HEAD away from GET", async () => {
    await using server = Bun.serve({
      port: 0,
      routes: {
        "/mixed": {
          GET: () => new Response("hello-get"),
          POST: new Response("static-post-response"),
        },
      },
    });

    const head = await fetch(new URL("/mixed", server.url), { method: "HEAD" });
    expect(await head.text()).toBe("");
    expect(head.headers.get("content-length")).toBe("9");
    expect(head.status).toBe(200);

    const get = await fetch(new URL("/mixed", server.url));
    expect(await get.text()).toBe("hello-get");
    const post = await fetch(new URL("/mixed", server.url), { method: "POST" });
    expect(await post.text()).toBe("static-post-response");
  });

  // The default handler used to be registered for HEAD on "/*" over the static
  // route's own HEAD, so fetch() answered.
  test('a static GET Response on "/*" answers HEAD like on any other path', async () => {
    await using server = Bun.serve({
      port: 0,
      routes: {
        "/*": { GET: new Response("star", { headers: { "x-from": "static" } }) },
      },
      fetch: () => new Response("from fetch", { headers: { "x-from": "fetch" } }),
    });

    const head = await fetch(new URL("/anything", server.url), { method: "HEAD" });
    expect({
      from: head.headers.get("x-from"),
      length: head.headers.get("content-length"),
      body: await head.text(),
      status: head.status,
    }).toEqual({ from: "static", length: "4", body: "", status: 200 });

    // A method the route does not name still reaches fetch().
    const post = await fetch(new URL("/anything", server.url), { method: "POST" });
    expect(await post.text()).toBe("from fetch");
  });

  test("HEAD is not derived for route objects without a GET handler", async () => {
    await using server = Bun.serve({
      port: 0,
      routes: { "/post-only": { POST: () => new Response("p") } },
    });

    const res = await fetch(new URL("/post-only", server.url), { method: "HEAD" });
    expect(res.status).toBe(404);
  });

  test("HEAD is not derived for a static Response under a non-GET method", async () => {
    await using server = Bun.serve({
      port: 0,
      routes: { "/post-only-static": { POST: new Response("post-only") } },
    });

    const head = await fetch(new URL("/post-only-static", server.url), { method: "HEAD" });
    expect(head.status).toBe(404);

    const post = await fetch(new URL("/post-only-static", server.url), { method: "POST" });
    expect(await post.text()).toBe("post-only");
    expect(post.status).toBe(200);
  });
});

describe("static responses", () => {
  let server: Server;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch: () => new Response("fallback"),
      routes: {
        "/static": new Response("static response", {
          headers: { "content-type": "text/plain" },
        }),
        "/html": new Response("<h1>Hello</h1>", {
          headers: { "content-type": "text/html" },
        }),
        "/skip": false,
      },
    });
    server.unref();
  });

  afterAll(() => {
    server.stop(true);
  });

  it("serves static Response", async () => {
    const res = await fetch(`${server.url}static`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(await res.text()).toBe("static response");
  });

  it("serves HTML response", async () => {
    const res = await fetch(`${server.url}html`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html");
    expect(await res.text()).toBe("<h1>Hello</h1>");
  });

  it("skips route when false", async () => {
    const res = await fetch(`${server.url}skip`);
    expect(await res.text()).toBe("fallback");
  });
});

describe("route precedence", () => {
  let server: Server;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch: () => new Response("fallback"),
      routes: {
        "/api/users": () => new Response("users list"),
        "/api/users/:id": (req: BunRequest<"/api/users/:id">) => new Response(`user ${req.params.id}`),
        "/api/*": () => new Response("api catchall"),
        "/api/users/:id/posts": (req: BunRequest<"/api/users/:id/posts">) => new Response(`posts for ${req.params.id}`),
        "/*": () => new Response("root catchall"),
      },
    });
    server.unref();
  });

  afterAll(() => {
    server.stop(true);
  });

  it("matches exact routes before parameters", async () => {
    const res = await fetch(`${server.url}api/users`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("users list");
  });

  it("matches parameterized routes before wildcards", async () => {
    const res = await fetch(`${server.url}api/users/123`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("user 123");
  });

  it("matches specific wildcards before root wildcard", async () => {
    const res = await fetch(`${server.url}api/unknown`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("api catchall");
  });

  it("matches root wildcard as last resort", async () => {
    const res = await fetch(`${server.url}unknown`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("root catchall");
  });

  it("prefers earlier routes when patterns overlap", async () => {
    const res = await fetch(`${server.url}api/users/123/posts`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("posts for 123");
  });
});

describe("error handling", () => {
  let server: Server;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch: () => new Response("fallback"),
      routes: {
        "/error": () => {
          throw new Error("Intentional error");
        },
        "/async-error": async () => {
          throw new Error("Async error");
        },
      },
      error(error) {
        return new Response(`Error: ${error.message}`, { status: 500 });
      },
    });
    server.unref();
  });

  afterAll(() => {
    server.stop(true);
  });

  it("handles synchronous errors", async () => {
    const res = await fetch(`${server.url}error`);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Error: Intentional error");
  });

  it("handles asynchronous errors", async () => {
    const res = await fetch(`${server.url}async-error`);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Error: Async error");
  });
});

describe("request properties", () => {
  let server: Server;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch: () => new Response("fallback"),
      routes: {
        "/echo-headers": req => new Response(JSON.stringify(Object.fromEntries(req.headers))),
        "/echo-method": req => new Response(req.method),
        "/echo-url": req =>
          new Response(
            JSON.stringify({
              url: req.url,
              pathname: new URL(req.url).pathname,
            }),
          ),
        "/echo-body": async req => new Response(await req.text()),
        "/echo-query": req => new Response(JSON.stringify(Object.fromEntries(new URL(req.url).searchParams))),
      },
    });
    server.unref();
  });

  afterAll(() => {
    server.stop(true);
  });

  it("preserves request headers", async () => {
    const res = await fetch(`${server.url}echo-headers`, {
      headers: {
        "x-test": "value",
        "user-agent": "test-agent",
      },
    });
    expect(res.status).toBe(200);
    const headers = await res.json();
    expect(headers["x-test"]).toBe("value");
    expect(headers["user-agent"]).toBe("test-agent");
  });

  it("preserves request method", async () => {
    const res = await fetch(`${server.url}echo-method`, { method: "PATCH" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("PATCH");
  });

  it("provides correct URL properties", async () => {
    const res = await fetch(`${server.url}echo-url?foo=bar`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.url).toInclude("echo-url?foo=bar");
    expect(data.pathname).toBe("/echo-url");
  });

  it("handles request body", async () => {
    const body = "test body content";
    const res = await fetch(`${server.url}echo-body`, {
      method: "POST",
      body,
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(body);
  });

  it("preserves query parameters", async () => {
    const res = await fetch(`${server.url}echo-query?foo=bar&baz=qux`);
    expect(res.status).toBe(200);
    const query = await res.json();
    expect(query).toEqual({
      foo: "bar",
      baz: "qux",
    });
  });
});

describe("route reloading", () => {
  let server: Server;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch: () => new Response("fallback"),
      routes: {
        "/test": () => new Response("original"),
      },
    });
    server.unref();
  });

  afterAll(() => {
    server.stop(true);
  });

  it("updates routes on reload", async () => {
    // Check original route
    let res = await fetch(new URL(`/test`, server.url).href);
    expect(await res.text()).toBe("original");

    // Reload with new routes
    server.reload({
      fetch: () => new Response("fallback"),
      routes: {
        "/test": () => new Response("updated"),
      },
    } as ServeOptions);

    // Check updated route
    res = await fetch(new URL(`/test`, server.url).href);
    expect(await res.text()).toBe("updated");
  });

  it("handles different HTTP methods on reload", async () => {
    // Reload with routes for different HTTP methods
    server.reload({
      fetch: () => new Response("fallback"),
      routes: {
        "/method-test": {
          GET: () => new Response("GET response"),
          POST: () => new Response("POST response"),
          PUT: () => new Response("PUT response"),
          DELETE: () => new Response("DELETE response"),
          OPTIONS: () => new Response("OPTIONS response"),
        },
      },
    } as ServeOptions);

    // Test GET request
    let res = await fetch(new URL(`/method-test`, server.url).href);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("GET response");

    // Test POST request
    res = await fetch(new URL(`/method-test`, server.url).href, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("POST response");

    // Test PUT request
    res = await fetch(new URL(`/method-test`, server.url).href, { method: "PUT" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("PUT response");

    // Test DELETE request
    res = await fetch(new URL(`/method-test`, server.url).href, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("DELETE response");

    // Test OPTIONS request
    res = await fetch(new URL(`/method-test`, server.url).href, { method: "OPTIONS" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OPTIONS response");

    server.reload({
      fetch: () => new Response("fallback"),
      routes: {
        "/method-test": {
          OPTIONS: new Response("OPTIONS response 2"),
          GET: () => new Response("GET response 2"),
          POST: () => new Response("POST response 2"),
          PUT: () => new Response("PUT response 2"),
          DELETE: () => new Response("DELETE response 2"),
        },
      },
    } as ServeOptions);

    res = await fetch(new URL(`/method-test`, server.url).href, { method: "GET" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("GET response 2");

    res = await fetch(new URL(`/method-test`, server.url).href, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("POST response 2");

    res = await fetch(new URL(`/method-test`, server.url).href, { method: "PUT" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("PUT response 2");

    res = await fetch(new URL(`/method-test`, server.url).href, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("DELETE response 2");

    res = await fetch(new URL(`/method-test`, server.url).href, { method: "OPTIONS" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OPTIONS response 2");
  });

  it("handles removing routes on reload", async () => {
    // Reload with empty routes
    server.reload({
      fetch: () => new Response("fallback"),
      routes: {},
    } as ServeOptions);

    // Should fall back to fetch handler
    const res = await fetch(`${server.url}test`);
    expect(await res.text()).toBe("fallback");
  });
});

describe("reload() keeps the server able to answer", () => {
  it("rejects routes: {} on a routes-only server, and keeps serving the old routes", async () => {
    using server = Bun.serve({
      port: 0,
      routes: { "/": () => new Response("routes") },
    });
    // The routes are the only handler; taking them away without adding a fetch
    // would leave nothing to answer requests, which is what the same check
    // refuses at Bun.serve() time.
    expect(() => server.reload({ routes: {} } as ServeOptions)).toThrow("Bun.serve() needs either:");
    expect(await (await fetch(server.url)).text()).toBe("routes");
  });

  it("allows routes: {} when the server keeps its fetch handler", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: () => new Response("fetch"),
      routes: { "/": () => new Response("routes") },
    });
    server.reload({ routes: {} } as ServeOptions);
    expect(await (await fetch(server.url)).text()).toBe("fetch");
  });

  it("allows a reload that names no handler at all on a routes-only server", async () => {
    using server = Bun.serve({
      port: 0,
      routes: { "/": () => new Response("routes") },
    });
    server.reload({ development: false } as ServeOptions);
    expect(await (await fetch(server.url)).text()).toBe("routes");
  });

  it("allows a reload that names no handler at all on a fetch-only server", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: () => new Response("fetch"),
    });
    server.reload({ error: _err => new Response("error") } as ServeOptions);
    expect(await (await fetch(server.url)).text()).toBe("fetch");
  });

  // Unlike callback routes, static routes are replaced by every reload, even
  // one without a routes object, so they cannot stand in for a missing handler.
  it("rejects a reload that names no handler on a server whose only routes are static", async () => {
    using server = Bun.serve({
      port: 0,
      routes: { "/": new Response("static") },
    });
    expect(() => server.reload({ development: false } as ServeOptions)).toThrow("Bun.serve() needs either:");
    expect(await (await fetch(server.url)).text()).toBe("static");
  });

  // Same for node:http's request handler: a reload that omits it clears it.
  it("rejects a reload that names no handler on a server whose only handler is onNodeHTTPRequest", () => {
    using server = Bun.serve({
      port: 0,
      // @ts-expect-error internal option used by node:http's Server
      onNodeHTTPRequest() {},
    });
    expect(() => server.reload({ development: false } as ServeOptions)).toThrow("Bun.serve() needs either:");
  });
});

describe("many route params", () => {
  let server: Server;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch: () => new Response("fallback"),
      routes: {
        "/test/:p1/:p2/:p3/:p4/:p5/:p6/:p7/:p8/:p9/:p10/:p11/:p12/:p13/:p14/:p15/:p16/:p17/:p18/:p19/:p20/:p21/:p22/:p23/:p24/:p25/:p26/:p27/:p28/:p29/:p30/:p31/:p32/:p33/:p34/:p35/:p36/:p37/:p38/:p39/:p40/:p41/:p42/:p43/:p44/:p45/:p46/:p47/:p48/:p49/:p50/:p51/:p52/:p53/:p54/:p55/:p56/:p57/:p58/:p59/:p60/:p61/:p62/:p63/:p64/:p65":
          (
            req: BunRequest<"/test/:p1/:p2/:p3/:p4/:p5/:p6/:p7/:p8/:p9/:p10/:p11/:p12/:p13/:p14/:p15/:p16/:p17/:p18/:p19/:p20/:p21/:p22/:p23/:p24/:p25/:p26/:p27/:p28/:p29/:p30/:p31/:p32/:p33/:p34/:p35/:p36/:p37/:p38/:p39/:p40/:p41/:p42/:p43/:p44/:p45/:p46/:p47/:p48/:p49/:p50/:p51/:p52/:p53/:p54/:p55/:p56/:p57/:p58/:p59/:p60/:p61/:p62/:p63/:p64/:p65">,
          ) => {
            // @ts-expect-error
            return new Response(JSON.stringify(req.params));
          },
      },
    });
    server.unref();
  });

  afterAll(() => {
    server.stop(true);
  });

  // JSFinalObject::maxInlineCapacity
  it("handles 65 route parameters", async () => {
    const values = Array.from({ length: 65 }, (_, i) => `value${i + 1}`);
    const path = `/test/${values.join("/")}`;
    const res = await fetch(new URL(path, server.url).href);
    expect(res.status).toBe(200);

    const params = await res.json();
    expect(Object.keys(params)).toHaveLength(65);

    for (let i = 1; i <= 65; i++) {
      expect(params[`p${i}`]).toBe(`value${i}`);
    }
  });
});

it("throws a validation error when a route parameter name starts with a number", () => {
  expect(() => {
    Bun.serve({
      routes: { "/test/:123": () => new Response("test") },
      fetch(req) {
        return new Response("test");
      },
    });
  }).toThrow("Route parameter names cannot start with a number.");
});

it("throws a validation error when a route parameter name is duplicated", () => {
  expect(() => {
    Bun.serve({
      routes: { "/test/:a123/:a123": () => new Response("test") },
      fetch(req) {
        return new Response("test");
      },
    });
  }).toThrow("Support for duplicate route parameter names is not yet implemented.");
});

it("fetch() is optional when routes are specified", async () => {
  await using server = Bun.serve({
    port: 0,
    routes: { "/test": () => new Response("test") },
  });

  expect(await fetch(new URL("/test", server.url)).then(res => res.text())).toBe("test");
  expect(await fetch(new URL("/test1", server.url)).then(res => res.status)).toBe(404);

  server.reload({
    routes: {
      "/test": () => new Response("test2"),
    },
  });

  expect(await fetch(new URL("/test", server.url)).then(res => res.text())).toBe("test2");
});

it("throws a validation error when passing invalid routes", () => {
  expect(() => {
    Bun.serve({ routes: { "/test": 123 } });
  }).toThrowErrorMatchingInlineSnapshot(`
    "'routes' expects a Record<string, Response | HTMLBundle | {[method: string]: (req: BunRequest) => Response|Promise<Response>}>

    To bundle frontend apps on-demand with Bun.serve(), import HTML files.

    Example:

    \`\`\`js
    import { serve } from "bun";
    import app from "./app.html";

    serve({
      routes: {
        "/index.json": Response.json({ message: "Hello World" }),
        "/app": app,
        "/path/:param": (req) => {
          const param = req.params.param;
          return Response.json({ message: \`Hello \${param}\` });
        },
        "/path": {
          GET(req) {
            return Response.json({ message: "Hello World" });
          },
          POST(req) {
            return Response.json({ message: "Hello World" });
          },
        },
      },

      fetch(request) {
        return new Response("fallback response");
      },
    });
    \`\`\`

    See https://bun.com/docs/api/http for more information."
  `);
});

it("throws a validation error when routes object is empty and fetch is not specified", async () => {
  expect(() =>
    Bun.serve({
      port: 0,
      routes: {},
    }),
  ).toThrowErrorMatchingInlineSnapshot(`
    "Bun.serve() needs either:

      - A routes object:
         routes: {
           "/path": {
             GET: (req) => new Response("Hello")
           }
         }

      - Or a fetch handler:
         fetch: (req) => {
           return new Response("Hello")
         }

    Learn more at https://bun.com/docs/api/http"
  `);
});

it("throws a validation error when routes object is undefined and fetch is not specified", async () => {
  expect(() =>
    Bun.serve({
      port: 0,
      routes: undefined,
    }),
  ).toThrowErrorMatchingInlineSnapshot(`
    "Bun.serve() needs either:

      - A routes object:
         routes: {
           "/path": {
             GET: (req) => new Response("Hello")
           }
         }

      - Or a fetch handler:
         fetch: (req) => {
           return new Response("Hello")
         }

    Learn more at https://bun.com/docs/api/http"
  `);
});

it("don't crash on server.fetch()", async () => {
  await using server = Bun.serve({
    port: 0,
    routes: { "/test": () => new Response("test") },
  });

  expect(server.fetch("/test")).rejects.toThrow("fetch() requires the server to have a fetch handler");
});

it("route precedence for any routes", async () => {
  await using server = Bun.serve({
    port: 0,
    routes: {
      "/test": () => new Response("test"),
      "/test/GET": () => new Response("GET /test/GET"),
      "/*": () => new Response("/*"),
    },
    fetch(req) {
      return new Response("fallback");
    },
  });

  expect(await fetch(new URL("/test", server.url)).then(res => res.text())).toBe("test");
  expect(await fetch(new URL("/test/GET", server.url)).then(res => res.text())).toBe("GET /test/GET");
});

it("route precedence for method-specific routes", async () => {
  await using server = Bun.serve({
    port: 0,
    routes: {
      "/test": {
        GET: () => new Response("GET /test"),
        POST: () => new Response("POST /test"),
      },
      "/test/POST": {
        POST: () => new Response("POST /test/POST"),
      },
      "/test/GET": {
        GET: () => new Response("GET /test/GET"),
      },
      "/*": () => new Response("/*"),
    },
    fetch(req) {
      return new Response("fallback");
    },
  });

  expect(await fetch(new URL("/test", server.url), { method: "GET" }).then(res => res.text())).toBe("GET /test");
  expect(await fetch(new URL("/test/GET", server.url), { method: "GET" }).then(res => res.text())).toBe(
    "GET /test/GET",
  );
  expect(await fetch(new URL("/test/POST", server.url), { method: "POST" }).then(res => res.text())).toBe(
    "POST /test/POST",
  );
});

it("route precedence for mix of method-specific routes and any routes", async () => {
  await using server = Bun.serve({
    port: 0,
    routes: {
      "/test": {
        GET: () => new Response("GET /test"),
        POST: () => new Response("POST /test"),
      },
      "/test/POST": {
        POST: () => new Response("POST /test/POST"),
      },
      "/test/GET": {
        GET: () => new Response("GET /test/GET"),
      },
      "/test/ANY": () => new Response("ANY /test/ANY"),
      "/test/ANY/POST": {
        POST: () => new Response("POST /test/ANY/POST"),
      },
      "/*": {
        GET: () => new Response("GET /*"),
        POST: () => new Response("POST /*"),
      },
    },
    fetch(req) {
      return new Response("fallback");
    },
  });

  expect(await fetch(new URL("/test", server.url), { method: "GET" }).then(res => res.text())).toBe("GET /test");
  expect(await fetch(new URL("/test/GET", server.url), { method: "GET" }).then(res => res.text())).toBe(
    "GET /test/GET",
  );
  expect(await fetch(new URL("/test/POST", server.url), { method: "POST" }).then(res => res.text())).toBe(
    "POST /test/POST",
  );
  expect(await fetch(new URL("/test/ANY", server.url), { method: "GET" }).then(res => res.text())).toBe(
    "ANY /test/ANY",
  );
  expect(await fetch(new URL("/test/ANY/POST", server.url), { method: "POST" }).then(res => res.text())).toBe(
    "POST /test/ANY/POST",
  );
  expect(await fetch(new URL("/test/ANY/POST", server.url), { method: "GET" }).then(res => res.text())).toBe("GET /*");
  expect(await fetch(new URL("/test/ANY/POST", server.url), { method: "POST" }).then(res => res.text())).toBe(
    "POST /test/ANY/POST",
  );
});

it("routes absolute-form request targets by path and derives request.url from the Host header", async () => {
  const seen: { matched: string; url: string }[] = [];
  await using server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    routes: {
      "/admin/secret": req => {
        seen.push({ matched: "route", url: req.url });
        return new Response("named route");
      },
    },
    fetch(req) {
      seen.push({ matched: "fallback", url: req.url });
      return new Response("fallback");
    },
  });

  const hostHeader = `127.0.0.1:${server.port}`;

  // Send an absolute-form request-target (RFC 9112 §3.2.2) over a raw socket;
  // fetch() always uses origin-form so we have to write the request line ourselves.
  const responseText = await new Promise<string>((resolve, reject) => {
    let received = "";
    Bun.connect({
      hostname: "127.0.0.1",
      port: server.port,
      socket: {
        open(socket) {
          socket.write(
            `GET https://spoofed.example/admin/secret HTTP/1.1\r\nHost: ${hostHeader}\r\nConnection: close\r\n\r\n`,
          );
        },
        data(socket, chunk) {
          received += chunk.toString();
        },
        close() {
          resolve(received);
        },
        error(socket, err) {
          reject(err);
        },
      },
    }).catch(reject);
  });

  // The named route handles the request, not the catch-all fetch handler.
  expect(responseText).toContain("named route");
  expect(responseText).toContain("200");
  expect(seen).toHaveLength(1);
  expect(seen[0].matched).toBe("route");

  // request.url is derived from the Host header, not from the authority in the request line.
  expect(seen[0].url).not.toContain("spoofed.example");
  const url = new URL(seen[0].url);
  expect(url.protocol).toBe("http:");
  expect(url.host).toBe(hostHeader);
  expect(url.pathname).toBe("/admin/secret");

  // A normal origin-form request still hits the same named route.
  seen.length = 0;
  const res = await fetch(new URL("/admin/secret", server.url));
  expect(await res.text()).toBe("named route");
  expect(seen).toHaveLength(1);
  expect(seen[0].matched).toBe("route");
  expect(new URL(seen[0].url).pathname).toBe("/admin/secret");

  for (const target of ["http://spoofed.example?a=b", "http://spoofed.example?redirect=/elsewhere"]) {
    seen.length = 0;
    const rawResponse = await new Promise<string>((resolve, reject) => {
      let received = "";
      Bun.connect({
        hostname: "127.0.0.1",
        port: server.port,
        socket: {
          open(socket) {
            socket.write(`GET ${target} HTTP/1.1\r\nHost: ${hostHeader}\r\nConnection: close\r\n\r\n`);
          },
          data(socket, chunk) {
            received += chunk.toString();
          },
          close() {
            resolve(received);
          },
          error(socket, err) {
            reject(err);
          },
        },
      }).catch(reject);
    });

    expect(rawResponse).toContain("fallback");
    expect(seen).toHaveLength(1);
    expect(seen[0].matched).toBe("fallback");
    expect(seen[0].url).not.toContain("spoofed.example");
    const rawUrl = new URL(seen[0].url);
    expect(rawUrl.host).toBe(hostHeader);
    expect(rawUrl.pathname).toBe("/");
    expect(rawUrl.search).toBe(new URL(target).search);
  }
});

describe.concurrent("false route with no fetch handler", () => {
  // A route value of `false` must fall through to the default handler. With no
  // `fetch` configured that default is the built-in 404, not a call through an
  // empty handler slot (which crashed the server process).
  const serverSrc = /* ts */ `
    const srv = Bun.serve({
      port: 0,
      development: false,
      routes: {
        "/x": new Response("x"),
        "/off": false,
        "/off/:id": false,
        "/wild/*": false,
      },
    });
    process.send!({ port: srv.port });
  `;

  test.each([
    ["exact", "/off"],
    ["param", "/off/7"],
    ["wildcard", "/wild/z"],
  ])("%s route 404s and the server survives", async (_label, path) => {
    const { promise: portPromise, resolve: gotPort } = Promise.withResolvers<number>();
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", serverSrc],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      ipc(message: { port: number }) {
        gotPort(message.port);
      },
    });
    const port = await Promise.race([
      portPromise,
      proc.exited.then(code => Promise.reject(new Error(`server exited (${code}) before listening`))),
    ]);

    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    expect(res.status).toBe(404);

    // The server must still be serving after the request above.
    const ok = await fetch(`http://127.0.0.1:${port}/x`);
    expect(await ok.text()).toBe("x");
    expect(ok.status).toBe(200);

    proc.kill();
    await proc.exited;
  });
});

describe.concurrent("a request method that is not one of Bun's 36 methods", () => {
  type Exchange = { status: number; body: string }[];

  // Sends the bytes on one connection. Resolves with every response on it, in
  // order, once the server closes the connection. `methods` names the request
  // methods when one of them is HEAD, whose response has no body.
  async function exchange(port: number, bytes: string, methods: string[] = []): Promise<Exchange> {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const chunks: Buffer[] = [];
    const socket = net.connect(port, "127.0.0.1");
    socket.on("connect", () => socket.write(bytes));
    socket.on("data", chunk => chunks.push(chunk));
    socket.on("error", reject);
    socket.on("close", () => resolve(Buffer.concat(chunks).toString("latin1")));
    let rest = await promise;
    const responses: Exchange = [];
    while (rest.length > 0) {
      const headEnd = rest.indexOf("\r\n\r\n");
      if (headEnd === -1) throw new Error(`incomplete response head: ${JSON.stringify(rest)}`);
      const head = rest.slice(0, headEnd);
      const length =
        methods[responses.length] === "HEAD" ? 0 : Number(/^content-length: (\d+)$/im.exec(head)?.[1] ?? 0);
      responses.push({ status: Number(head.slice(9, 12)), body: rest.slice(headEnd + 4, headEnd + 4 + length) });
      rest = rest.slice(headEnd + 4 + length);
    }
    return responses;
  }

  const request = (method: string, path: string, fields = "") =>
    `${method} ${path} HTTP/1.1\r\nHost: localhost\r\n${fields}\r\n`;

  // Every handler reports the method it was given.
  const handler = (calls: string[], name: string) => (req: Request) => {
    calls.push(`${name} ${req.method}`);
    return new Response(`${name} ${req.method}`);
  };

  const missingFile = "/bun-serve-routes-this-file-does-not-exist";

  // Route tables. With some of them the router used to hand such a request to
  // the routes of another method, and the handler saw it as a GET. With the
  // others the socket closed with no response. `get` is the answer to
  // `GET /nope`, and `getCalls` the handler calls that answer makes.
  const tables: Record<string, { routes: (calls: string[]) => any; get: string; getCalls: string[] }> = {
    "no routes": { routes: () => ({}), get: "fetch GET", getCalls: ["fetch GET"] },
    "a static route": { routes: () => ({ "/x": new Response("x") }), get: "fetch GET", getCalls: ["fetch GET"] },
    "a static route for HEAD": {
      routes: () => ({ "/x": { HEAD: new Response("h") } }),
      get: "fetch GET",
      getCalls: ["fetch GET"],
    },
    "static routes for GET and HEAD": {
      routes: () => ({ "/x": { GET: new Response("g"), HEAD: new Response("h") } }),
      get: "fetch GET",
      getCalls: ["fetch GET"],
    },
    "two parameter routes of one shape": {
      routes: calls => ({ "/u/:id": handler(calls, "id"), "/u/:name": handler(calls, "name") }),
      get: "fetch GET",
      getCalls: ["fetch GET"],
    },
    "a function route and a static route for HEAD": {
      routes: calls => ({ "/x": handler(calls, "x"), "/y": { HEAD: new Response("h") } }),
      get: "fetch GET",
      getCalls: ["fetch GET"],
    },
    "a GET function route on /*": {
      routes: calls => ({ "/*": { GET: handler(calls, "star") } }),
      get: "star GET",
      getCalls: ["star GET"],
    },
    "static routes for GET and POST on /*": {
      routes: () => ({ "/*": { GET: new Response("star"), POST: new Response("post") } }),
      get: "star",
      getCalls: [],
    },
    "a GET file route on /* whose file is missing": {
      routes: () => ({ "/*": { GET: new Response(Bun.file(missingFile)) } }),
      get: "fetch GET",
      getCalls: ["fetch GET"],
    },
  };

  const unknown = [
    ["BREW", "/nope"],
    ["BREW", "/x"],
    ["get", "/nope"],
    ["Get", "/x"],
    ["GETS", "/u/1"],
  ];

  // The unknown methods get 501 and run no handler. The connection stays
  // open: the requests after them on it are served. PROPFIND is a method Bun
  // knows and no route names, so `fetch` takes it.
  async function expectNotImplemented(port: number, calls: string[], table: (typeof tables)[string]) {
    calls.length = 0;
    const responses = await exchange(
      port,
      unknown.map(([method, path]) => request(method, path)).join("") +
        request("PROPFIND", "/nope") +
        request("GET", "/nope", "Connection: close\r\n"),
    );
    expect({ responses, calls }).toEqual({
      responses: [
        ...unknown.map(() => ({ status: 501, body: "" })),
        { status: 200, body: "fetch PROPFIND" },
        { status: 200, body: table.get },
      ],
      calls: ["fetch PROPFIND", ...table.getCalls],
    });
  }

  test.each(Object.keys(tables))("gets 501 and runs no handler with %s", async name => {
    const calls: string[] = [];
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      routes: tables[name].routes(calls),
      fetch: handler(calls, "fetch"),
    });
    await expectNotImplemented(server.port, calls, tables[name]);
  });

  test("gets 501 whatever routes an earlier reload() registered", async () => {
    const calls: string[] = [];
    const fetch = handler(calls, "fetch");
    await using server = Bun.serve({ port: 0, hostname: "127.0.0.1", routes: {}, fetch });
    for (const name of [
      "no routes",
      "a static route for HEAD",
      "a static route",
      "static routes for GET and POST on /*",
      "two parameter routes of one shape",
      "no routes",
    ]) {
      server.reload({ routes: tables[name].routes(calls), fetch });
      await expectNotImplemented(server.port, calls, tables[name]);
    }
  });

  test("gets 501 before a websocket upgrade, a 100 Continue, or its body is read", async () => {
    const calls: string[] = [];
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      routes: { "/x": new Response("x") },
      fetch: handler(calls, "fetch"),
      websocket: {
        open() {
          calls.push("websocket open");
        },
        message() {},
      },
    });
    const upgrade =
      "Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n";
    const responses = await exchange(
      server.port,
      request("BREW", "/x", upgrade) +
        request("BREW", "/x", "Expect: 100-continue\r\nContent-Length: 5\r\n") +
        "hello" +
        request("BREW", "/x", "Transfer-Encoding: chunked\r\n") +
        "5\r\nhello\r\n0\r\n\r\n" +
        request("GET", "/x", "Connection: close\r\n"),
    );
    expect({ responses, calls }).toEqual({
      responses: [
        { status: 501, body: "" },
        { status: 501, body: "" },
        { status: 501, body: "" },
        { status: 200, body: "x" },
      ],
      calls: [],
    });
  });

  // node:http turns on a strict method check in the parser, which answers 400.
  // A server that has only node:http's request handler does not.
  test("gets 501 from a server whose handler is onNodeHTTPRequest", async () => {
    const calls: string[] = [];
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      // @ts-expect-error internal option used by node:http's Server
      onNodeHTTPRequest(_server: unknown, url: string, method: string) {
        calls.push(`${method} ${url}`);
      },
    });
    const responses = await exchange(
      server.port,
      request("BREW", "/x") + request("get", "/x", "Connection: close\r\n"),
    );
    expect({ responses, calls }).toEqual({
      responses: [
        { status: 501, body: "" },
        { status: 501, body: "" },
      ],
      calls: [],
    });
  });

  // With that handler a request can be dispatched while an earlier response
  // is not complete. The unknown method then has no response state of its own
  // to answer with, so the connection closes, as it did before.
  test("closes the connection when the request is queued behind a pending onNodeHTTPRequest response", async () => {
    const calls: string[] = [];
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      // @ts-expect-error internal option used by node:http's Server
      onNodeHTTPRequest(_server: unknown, url: string, method: string) {
        calls.push(`${method} ${url}`);
      },
    });
    const responses = await exchange(server.port, request("GET", "/first") + request("BREW", "/second"));
    expect({ responses, calls }).toEqual({ responses: [], calls: ["GET /first"] });
  });

  // Over HTTP/3 the any-method routes used to take the request, on every
  // server, and the handler saw a GET. "get" and "Get" are unknown too: a
  // method is case-sensitive. HTTP/2 has its own tests for the 501.
  test("gets 501 over HTTP/3, before any handler and before a 100 Continue", async () => {
    using dir = tempDir("serve-routes-h3-method", { "file.txt": "file" });
    const calls: string[] = [];
    await using server = Bun.serve({
      port: 0,
      tls,
      http3: true,
      routes: {
        "/any": handler(calls, "any"),
        "/get": { GET: handler(calls, "get") },
        "/static": new Response("static"),
        "/file": new Response(Bun.file(join(String(dir), "file.txt"))),
      },
      fetch: handler(calls, "fetch"),
    });

    // One connection, one request after the other. A result names each
    // informational response too: "info 100 200 body".
    await using endpoint = new QuicEndpoint();
    const client = await connectQuic(`127.0.0.1:${server.port}`, {
      endpoint,
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout: 5 },
      onerror() {},
    });
    const closed = client.closed.then(
      () => "closed",
      () => "closed",
    );
    await client.opened;
    async function h3(method: string, path: string, fields: Record<string, string> = {}) {
      const seen: string[] = [];
      const stream = await client.createBidirectionalStream({
        headers: { ":method": method, ":path": path, ":scheme": "https", ":authority": "localhost", ...fields },
        oninfo(received: Record<string, string>) {
          seen.push("info " + received[":status"]);
        },
        onheaders(received: Record<string, string>) {
          seen.push(received[":status"]);
        },
      });
      stream.closed.catch(() => {});
      let body = "";
      for await (const batch of stream as AsyncIterable<Uint8Array[]>) {
        for (const chunk of batch) body += Buffer.from(chunk).toString("latin1");
      }
      return [...seen, body].join(" ");
    }

    const results: Record<string, string> = {};
    for (const method of ["BREW", "GETX", "get", "Get"]) {
      for (const path of ["/nope", "/any", "/get", "/static", "/file"]) {
        results[`${method} ${path}`] = await Promise.race([h3(method, path), closed]);
      }
    }
    results["BREW /nope, Expect"] = await Promise.race([h3("BREW", "/nope", { expect: "100-continue" }), closed]);
    const unknown = Object.keys(results);
    for (const [method, path] of [
      ["PROPFIND", "/nope"],
      ["GET", "/get"],
      ["GET", "/static"],
      ["GET", "/file"],
    ]) {
      results[`${method} ${path}`] = await Promise.race([h3(method, path), closed]);
    }
    if (!client.destroyed) client.close().catch(() => {});

    expect({ results, calls }).toEqual({
      results: {
        ...Object.fromEntries(unknown.map(key => [key, "501 "])),
        "PROPFIND /nope": "200 fetch PROPFIND",
        "GET /get": "200 get GET",
        "GET /static": "200 static",
        "GET /file": "200 file",
      },
      calls: ["fetch PROPFIND", "get GET"],
    });
  });

  // CONNECT is left out: its request target has another form.
  const known = [
    ...["ACL", "BIND", "CHECKOUT", "COPY", "DELETE", "GET", "HEAD", "LINK", "LOCK", "M-SEARCH", "MERGE", "MKACTIVITY"],
    ...["MKADDRESSBOOK", "MKCALENDAR", "MKCOL", "MOVE", "NOTIFY", "OPTIONS", "PATCH", "POST", "PROPFIND", "PROPPATCH"],
    ...["PURGE", "PUT", "QUERY", "REBIND", "REPORT", "SEARCH", "SOURCE", "SUBSCRIBE", "TRACE", "UNBIND", "UNLINK"],
    ...["UNLOCK", "UNSUBSCRIBE"],
  ];
  const routed = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT", "TRACE"];

  test("each of Bun's methods reaches the route of that method, or fetch", async () => {
    const calls: string[] = [];
    await using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      routes: { "/m": Object.fromEntries(routed.map(method => [method, handler(calls, `route ${method}`)])) },
      fetch: handler(calls, "fetch"),
    });
    const responses = await exchange(
      server.port,
      known.map((method, i) => request(method, "/m", i === known.length - 1 ? "Connection: close\r\n" : "")).join(""),
      known,
    );
    const expected = known.map(method => (routed.includes(method) ? `route ${method} ${method}` : `fetch ${method}`));
    expect({ statuses: responses.map(response => response.status), calls }).toEqual({
      statuses: known.map(() => 200),
      calls: expected,
    });
  });
});

// A "/*" route that names one method. The default handler is an any-method
// route: it runs after the any-method routes, for every method the "/*" route
// does not name. Over HTTP/2 and HTTP/3 it used to be registered under POST and
// the other eight verbs, ahead of "/any", and under none of the other methods.
test('over HTTP/2, a "/*" route for one method leaves the other methods to the any-method routes, then to fetch', async () => {
  const answer = (name: string) => (req: Request) => new Response(`${name} ${req.method}`);
  await using server = Bun.serve({
    port: 0,
    http2: true,
    routes: { "/*": { GET: answer("star") }, "/any": answer("any") },
    fetch: answer("fetch"),
  });
  const session = await connectH2(server.port, false);
  const results: Record<string, string> = {};
  for (const method of ["GET", "POST", "PROPFIND"]) {
    for (const path of ["/any", "/nope"]) {
      const res = await requestH2(session, { ":method": method, ":path": path });
      results[`${method} ${path}`] = `${res.status} ${res.body}`;
    }
  }
  await new Promise<void>(resolve => session.close(() => resolve()));
  expect(results).toEqual({
    "GET /any": "200 star GET",
    "GET /nope": "200 star GET",
    "POST /any": "200 any POST",
    "POST /nope": "200 fetch POST",
    "PROPFIND /any": "200 any PROPFIND",
    "PROPFIND /nope": "200 fetch PROPFIND",
  });
});
