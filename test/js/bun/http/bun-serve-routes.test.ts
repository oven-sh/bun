import type { BunRequest, ServeOptions, Server } from "bun";
import { httpRouterScript } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import net from "node:net";

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

// uWS::HttpRouter with no server around it. A script line is one router call:
//
//   add <H|M|L> <method,method,...> <pattern> <percent>   H, M, L is the priority: high, medium, low
//   remove <H|M|L> <method> <pattern>                     prints r1 or r0
//   route <method> <url>                                  prints 1 or 0, then " id(param,...)" for each handler that ran
//   steps                                                 prints s and the loop iterations since the last steps line
//   sort                                                  ends a registration pass
//   reset                                                 a new router
//
// Handlers are numbered in the order they are added. The percent of an `add`
// line is the share of requests the handler yields to the next handler: 0
// answers every request, 100 yields every request.
describe("uWS::HttpRouter", () => {
  const run = (...lines: string[]) => httpRouterScript(lines.join("\n")).split("\n").slice(0, -1);

  // The cases of uWebSockets' tests/HttpRouter.cpp (Apache-2.0), with its
  // handler names as comments.
  describe("uWebSockets router tests", () => {
    test("method priority", () => {
      expect(
        run(
          "add L * /static/route 0", // 0 AS
          "add M PATCH /static/route 100", // 1 PS
          "add M GET /static/route 0", // 2 GS
          "route nonsense /static/route",
          "route GET /static",
          "route POST /static/route",
          "route GET /static/route",
          "route PATCH /static/route",
        ),
      ).toEqual(["1 0()", "0", "1 0()", "1 2()", "1 1() 0()"]);
    });

    test("deep parameter routes", () => {
      expect(
        run(
          "add M GET /something/:id/sync 100", // 0 ETT
          "add M GET /something/:somethingId/pin 100", // 1 TVÅ
          "add M GET /something/:id/:attribute 100", // 2 TRE
          "route GET /something/1234/pin",
          "route GET /something/1234/sync",
        ),
      ).toEqual(["0 1(1234) 2(1234,pin)", "0 0(1234) 2(1234,sync)"]);
    });

    test("pattern priority", () => {
      expect(
        run(
          "add L * /a/b/c 100", // 0 AS
          "add M GET /a/:b/c 100", // 1 GP
          "add M GET /a/* 100", // 2 GW
          "add M GET /a/b/c 100", // 3 GS
          "add M POST /a/:b/c 100", // 4 PP
          "add L * /a/:b/c 100", // 5 AP
          "route POST /a/b/c",
          "route GET /a/b/c",
        ),
      ).toEqual(["0 4(b) 0() 5(b)", "0 3() 1(b) 2() 0() 5(b)"]);
    });

    test("upgrade", () => {
      expect(
        run(
          "add M GET /something 0", // 0 GS
          "add M GET /* 100", // 1 GW
          "add H GET /* 100", // 2 WW
          "route GET /something",
          "route GET /",
        ),
      ).toEqual(["1 2() 0()", "0 2() 1()"]);
    });

    test("bug reports", () => {
      expect({
        removedParameterRoute: run(
          "add M GET /route 0",
          "add M GET /route/:id 0",
          "route GET /route/21",
          "route GET /route",
          "remove M GET /route",
          "route GET /route",
          "remove M GET /route/:id",
          "route GET /route/21",
        ),
        manySlashes: run(
          "add M GET /foo//////bar/baz/qux 100", // 0 MANYSLASH
          "add M GET /foo 100", // 1 FOO
          "route GET /foo",
          "route GET /foo/",
          "route GET /foo//bar/baz/qux",
          "route GET /foo//////bar/baz/qux",
        ),
        wildcardAfterSlash: run("add M GET /test/* 100", "route GET /test/"),
        upgradeBeforeStaticBeforeWildcard: run(
          "add H GET /* 100", // 0 WW
          "add M GET /ok 100", // 1 GS
          "add M GET /* 100", // 2 GW
          "route GET /ok",
        ),
        upgradeOnRoot: run("add H GET / 100", "add M GET / 100", "route GET /"),
        upgradeStaticAny: run(
          "add H GET /* 100", // 0 WW
          "add M GET /static 100", // 1 GSL
          "add L * /* 100", // 2 AW
          "route GET /static",
        ),
        upgradeRootStaticAny: run(
          "add H GET /* 100", // 0 WW
          "add M GET / 100", // 1 GSS
          "add M GET /static 100", // 2 GSL
          "add L * /* 100", // 3 AW
          "route GET /static",
        ),
        staticBeforeParameter: run(
          "add M GET /foo 100", // 0 FOO
          "add M GET /:id 100", // 1 ID
          "add M GET /1ab 100", // 2 ONEAB
          "route GET /1ab",
        ),
        staticBeforeWildcard: run(
          "add M GET /* 100", // 0 STAR
          "add M GET / 100", // 1 STATIC
          "route GET /",
        ),
      }).toEqual({
        removedParameterRoute: ["1 1(21)", "1 0()", "r1", "0", "r1", "0"],
        manySlashes: ["0 1()", "0", "0", "0 0()"],
        wildcardAfterSlash: ["0 0()"],
        upgradeBeforeStaticBeforeWildcard: ["0 0() 1() 2()"],
        upgradeOnRoot: ["0 0() 1()"],
        upgradeStaticAny: ["0 0() 1() 2()"],
        upgradeRootStaticAny: ["0 0() 2() 3()"],
        staticBeforeParameter: ["0 2() 1(1ab)"],
        staticBeforeWildcard: ["0 1() 0()"],
      });
    });

    test("parameters", () => {
      expect(
        run(
          "add M GET /candy/:kind/* 100", // 0 GPW
          "add M GET /candy/lollipop/* 100", // 1 GLW
          "add M GET /candy/:kind/:action 100", // 2 GPP
          "add M GET /candy/lollipop/:action 100", // 3 GLP
          "add M GET /candy/lollipop/eat 100", // 4 GLS
          "route GET /candy/lollipop/eat",
          "route GET /candy/lollipop/",
          "route GET /candy/lollipop",
          "route GET /candy/",
        ),
      ).toEqual(["0 4() 3(eat) 1() 2(lollipop,eat) 0(lollipop)", "0 1() 0(lollipop)", "0", "0"]);
    });
  });

  // A fixed pseudo-random sequence of router calls. The digests are the output
  // of the router on main at bf42a525d5, so a router change that sends any of
  // these requests to other handlers, in another order or with other
  // parameters changes a digest. To find the call, run the same script on a
  // build without the change and compare the two outputs line by line.
  describe("random call sequences", () => {
    function randomScript(seed: number, calls: number, names: number) {
      let state = (seed * 2654435761 + 1013904223) >>> 0;
      const below = (n: number) => {
        state ^= state << 13;
        state >>>= 0;
        state ^= state >>> 17;
        state ^= state << 5;
        state >>>= 0;
        return state % n;
      };
      const pick = <T>(list: readonly T[]) => list[below(list.length)];
      const patternSegments = ["a", "b", "c", "d", "", ":x", ":yy", ":", "*", "*z", "e", "a-longer-static-name", "a"];
      const urlSegments = ["a", "b", "c", "d", "", "e", "zz", ":x", ":", "*", "*z", "a-longer-static-name", "q"];
      const methods = ["GET", "POST", "HEAD", "PUT", "*"];
      const priorities = ["H", "M", "L"];
      const depth = 1 + below(4);
      const yields = below(3) === 0 ? 0 : 10 + below(70);
      const routeShare = 20 + below(60);
      const repeatShare = below(50);
      // An empty ANY node is dropped by the first removal. Half of the
      // sequences keep a route under ANY so that the node stays.
      const keeper = seed % 2 === 0 ? ["add L * /never-requested/keeper 100"] : [];
      const path = (segments: readonly string[], maxDepth: number) => {
        let out = "";
        for (let i = 1 + below(maxDepth); i > 0; i--) {
          out += "/" + (names && below(10) < 8 ? "name-" + below(names) : pick(segments));
        }
        return out;
      };
      const lines = [...keeper];
      let added: string[] = [];
      for (let i = 0; i < calls; i++) {
        if (below(16) === 0) lines.push("sort");
        const dice = below(100);
        if (dice < routeShare) {
          lines.push(`route ${below(8) === 0 ? "PATCH" : pick(methods)} ${path(urlSegments, depth + 1)}`);
        } else if (dice < routeShare + 8) {
          // Half of the removals name a route that was added.
          if (added.length && below(2) === 0) {
            const [, priority, list, pattern] = pick(added).split(" ");
            lines.push(`remove ${priority} ${pick(list.split(","))} ${pattern}`);
          } else {
            lines.push(`remove ${pick(priorities)} ${pick(methods)} ${path(patternSegments, depth)}`);
          }
        } else if (dice < routeShare + 9 && (!names || below(400) === 0)) {
          lines.push("reset", ...keeper);
          added = [];
        } else if (added.length && below(100) < repeatShare) {
          // The same method, pattern and priority again replaces the route.
          lines.push(pick(added));
        } else {
          const first = below(methods.length);
          const list = Array.from({ length: 1 + below(3) }, (_, k) => methods[(first + k) % methods.length]);
          // One method can be in the list twice.
          if (below(12) === 0) list.push(list[0]);
          const line = `add ${pick(priorities)} ${list.join(",")} ${path(patternSegments, depth)} ${yields}`;
          lines.push(line);
          added.push(line);
        }
      }
      lines.push("steps");
      return lines.join("\n");
    }
    const digest = (script: string) => {
      const output = httpRouterScript(script);
      // The last line is the step count, which is not part of the routing result.
      return new Bun.CryptoHasher("sha1").update(output.slice(0, output.lastIndexOf("\ns") + 1)).digest("hex");
    };

    test.each([
      [
        0,
        [
          "e32cf48c7ccbc3f1ea5229f847a46b7be1cdba68",
          "4fcb682b14ff6e5387dd9f9700ebbd13283131ee",
          "1e22b601cf88fe7765c1ea9fc38b07d48ec1adb1",
          "d00fb3e84a191d0a44a67d09e8ebbf616e6125fb",
        ],
      ],
      [
        4,
        [
          "4492dcb6307657b9f0634d1db3fb7d07863c16a7",
          "207433ed61f3a5a2d9f30f249838e24311cc9117",
          "ae5a7eb90e3dc0b88efe620769474505c9657983",
          "49032f562000d253cffbff9c201421edf9ab297b",
        ],
      ],
      [
        8,
        [
          "9ae60068227e476daf570cb1fe3777e56c682ccf",
          "f0ac51b2df94012c33e8be09619296559b09c1f2",
          "7d4785c1b68f0625c4d642027ec036f37bc26388",
          "da35183dafc0f36afd68f30da698fa21900800bc",
        ],
      ],
      [
        12,
        [
          "7a6b5156325fbc3b0fcf6e1188f34678c6a0b9c5",
          "a22d996ab3c3efccfb44b5bd2515d8febceb52fb",
          "21b3c4488493edbb6c8f377751bfc2c845a21f1d",
          "8cf4e9f84833c52a225e8a201074bbe12fd5000d",
        ],
      ],
    ])("short sibling lists, 4 sequences from seed %d", (first, digests) => {
      expect(Array.from({ length: 4 }, (_, i) => digest(randomScript(first + i, 300, 0)))).toEqual(digests);
    });

    test.each([
      [100, "4e57733ca6d82949f12ba81e2ff1fbad4bd78c19"],
      [101, "ac045a2e3a18d1e62615b435f1110d768fd1de5b"],
    ])("sibling lists of hundreds of names, seed %d", (seed, expected) => {
      expect(digest(randomScript(seed, 1500, 400))).toBe(expected);
    });
  });
});
