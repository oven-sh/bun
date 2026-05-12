import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  Agent,
  Client,
  Dispatcher,
  MockAgent,
  Pool,
  errors,
  getCookies,
  getGlobalDispatcher,
  getSetCookies,
  interceptors,
  parseMIMEType,
  request,
  serializeAMimeType,
  setCookie,
  setGlobalDispatcher,
} from "undici";

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

// Counter for retry endpoint
let retryAttempts = 0;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      if (path === "/json") {
        return Response.json({ hello: "world" });
      }

      if (path === "/echo") {
        const body = await req.text();
        return Response.json({
          method: req.method,
          body,
          url: req.url,
        });
      }

      if (path === "/headers") {
        const headers: Record<string, string> = {};
        req.headers.forEach((value, key) => {
          headers[key] = value;
        });
        return Response.json(headers);
      }

      if (path.startsWith("/status/")) {
        const code = parseInt(path.split("/")[2], 10);
        return new Response(`status ${code}`, { status: code });
      }

      if (path === "/redirect") {
        return new Response(null, {
          status: 302,
          headers: { location: `${baseUrl}/json` },
        });
      }

      if (path === "/redirect-chain") {
        return new Response(null, {
          status: 302,
          headers: { location: `${baseUrl}/redirect` },
        });
      }

      if (path === "/retry") {
        retryAttempts++;
        if (retryAttempts <= 2) {
          return new Response("fail", { status: 500 });
        }
        return Response.json({ retried: true, attempts: retryAttempts });
      }

      return new Response("not found", { status: 404 });
    },
  });
  baseUrl = `http://localhost:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------
describe("module exports", () => {
  it("exports all expected top-level APIs", async () => {
    const undici = await import("undici");
    const expectedExports = [
      "Agent",
      "BalancedPool",
      "Client",
      "Dispatcher",
      "MockAgent",
      "MockClient",
      "MockPool",
      "Pool",
      "ProxyAgent",
      "RetryAgent",
      "RetryHandler",
      "DecoratorHandler",
      "RedirectHandler",
      "EnvHttpProxyAgent",
      "errors",
      "interceptors",
      "request",
      "fetch",
      "stream",
      "pipeline",
      "connect",
      "upgrade",
      "setGlobalDispatcher",
      "getGlobalDispatcher",
      "setGlobalOrigin",
      "getGlobalOrigin",
      "getCookies",
      "setCookie",
      "deleteCookie",
      "getSetCookies",
      "parseMIMEType",
      "serializeAMimeType",
      "buildConnector",
      "caches",
      "mockErrors",
      "util",
    ];
    for (const name of expectedExports) {
      expect((undici as any)[name]).toBeDefined();
    }
  });

  it("undici is not a builtin module", () => {
    expect(require("module").isBuiltin("undici")).toBe(false);
  });

  it("require and import resolve the same module", async () => {
    const cjsUndici = require("undici");
    const esmUndici = await import("undici");
    expect(typeof cjsUndici.request).toBe("function");
    expect(typeof esmUndici.request).toBe("function");
    expect(typeof cjsUndici.Client).toBe("function");
    expect(typeof esmUndici.Client).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// request()
// ---------------------------------------------------------------------------
describe("request()", () => {
  it("makes a GET request with URL string", async () => {
    const { statusCode, body } = await request(`${baseUrl}/json`);
    expect(statusCode).toBe(200);
    expect(await body.json()).toEqual({ hello: "world" });
  });

  it("makes a GET request with URL object", async () => {
    const { statusCode, body } = await request(new URL(`${baseUrl}/json`));
    expect(statusCode).toBe(200);
    expect(await body.json()).toEqual({ hello: "world" });
  });

  it("makes a POST request with string body", async () => {
    const { statusCode, body } = await request(`${baseUrl}/echo`, {
      method: "POST",
      body: "hello",
    });
    expect(statusCode).toBe(200);
    const data = await body.json();
    expect(data.method).toBe("POST");
    expect(data.body).toBe("hello");
  });

  it("makes a POST request with JSON body", async () => {
    const payload = { key: "value", num: 42 };
    const { statusCode, body } = await request(`${baseUrl}/echo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(statusCode).toBe(200);
    const data = await body.json();
    expect(data.method).toBe("POST");
    expect(JSON.parse(data.body)).toEqual(payload);
  });

  it("sends custom headers", async () => {
    const { statusCode, body } = await request(`${baseUrl}/headers`, {
      headers: { "x-custom-header": "test-value" },
    });
    expect(statusCode).toBe(200);
    const headers = await body.json();
    expect(headers["x-custom-header"]).toBe("test-value");
  });

  it("handles query parameters in URL", async () => {
    const { statusCode, body } = await request(`${baseUrl}/echo?foo=bar&baz=1`);
    expect(statusCode).toBe(200);
    const data = await body.json();
    expect(data.url).toContain("foo=bar");
    expect(data.url).toContain("baz=1");
  });

  it("consumes body as text", async () => {
    const { body } = await request(`${baseUrl}/status/200`);
    const text = await body.text();
    expect(text).toBe("status 200");
  });

  it("supports AbortSignal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(request(`${baseUrl}/json`, { signal: controller.signal })).rejects.toThrow();
  });

  it("handles various status codes without throwing", async () => {
    const res404 = await request(`${baseUrl}/status/404`);
    expect(res404.statusCode).toBe(404);
    await res404.body.text();

    const res500 = await request(`${baseUrl}/status/500`);
    expect(res500.statusCode).toBe(500);
    await res500.body.text();
  });
});

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------
describe("Client", () => {
  it("creates a client and makes a GET request", async () => {
    const client = new Client(baseUrl);
    const { statusCode, body } = await client.request({ path: "/json", method: "GET" });
    expect(statusCode).toBe(200);
    expect(await body.json()).toEqual({ hello: "world" });
    await client.close();
  });

  it("makes multiple sequential requests on same client", async () => {
    const client = new Client(baseUrl);
    for (let i = 0; i < 3; i++) {
      const { statusCode, body } = await client.request({ path: "/json", method: "GET" });
      expect(statusCode).toBe(200);
      await body.json();
    }
    await client.close();
  });

  it("supports POST with body", async () => {
    const client = new Client(baseUrl);
    const { statusCode, body } = await client.request({
      path: "/echo",
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "client-data",
    });
    expect(statusCode).toBe(200);
    const data = await body.json();
    expect(data.method).toBe("POST");
    expect(data.body).toBe("client-data");
    await client.close();
  });

  it("close() and destroy() resolve cleanly", async () => {
    const client1 = new Client(baseUrl);
    await client1.close();

    const client2 = new Client(baseUrl);
    await client2.destroy();
  });
});

// ---------------------------------------------------------------------------
// Pool
// ---------------------------------------------------------------------------
describe("Pool", () => {
  it("creates a pool and makes a request", async () => {
    const pool = new Pool(baseUrl);
    const { statusCode, body } = await pool.request({ path: "/json", method: "GET" });
    expect(statusCode).toBe(200);
    expect(await body.json()).toEqual({ hello: "world" });
    await pool.close();
  });

  it("handles concurrent requests", async () => {
    const pool = new Pool(baseUrl);
    const results = await Promise.all(Array.from({ length: 5 }, () => pool.request({ path: "/json", method: "GET" })));
    for (const { statusCode, body } of results) {
      expect(statusCode).toBe(200);
      expect(await body.json()).toEqual({ hello: "world" });
    }
    await pool.close();
  });
});

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------
describe("Agent", () => {
  it("creates an agent and dispatches requests", async () => {
    const agent = new Agent();
    const { statusCode, body } = await request(`${baseUrl}/json`, { dispatcher: agent });
    expect(statusCode).toBe(200);
    expect(await body.json()).toEqual({ hello: "world" });
    await agent.close();
  });

  it("can be used as global dispatcher", async () => {
    const original = getGlobalDispatcher();
    try {
      const agent = new Agent();
      setGlobalDispatcher(agent);
      expect(getGlobalDispatcher()).toBe(agent);
      await agent.close();
    } finally {
      setGlobalDispatcher(original);
    }
  });
});

// ---------------------------------------------------------------------------
// Dispatcher.compose() and interceptors
// ---------------------------------------------------------------------------
describe("Dispatcher.compose() and interceptors", () => {
  it("compose() exists on Agent and Client instances", () => {
    const agent = new Agent();
    expect(typeof agent.compose).toBe("function");
    agent.close();

    const client = new Client(baseUrl);
    expect(typeof client.compose).toBe("function");
    client.close();
  });

  it("compose() with a custom interceptor that adds a header", async () => {
    const client = new Client(baseUrl);
    const intercepted = client.compose((dispatch: Dispatcher.DispatchInterceptor) => {
      return (opts: any, handler: any) => {
        if (!opts.headers) opts.headers = [];
        if (Array.isArray(opts.headers)) {
          opts.headers.push("x-intercepted", "true");
        }
        return dispatch(opts, handler);
      };
    });
    const { statusCode, body } = await intercepted.request({
      path: "/headers",
      method: "GET",
    });
    expect(statusCode).toBe(200);
    const headers = await body.json();
    expect(headers["x-intercepted"]).toBe("true");
    await client.close();
  });

  it("interceptors.redirect follows redirects", async () => {
    const client = new Client(baseUrl).compose(interceptors.redirect({ maxRedirections: 3 }));
    const { statusCode, body } = await client.request({
      path: "/redirect",
      method: "GET",
    });
    expect(statusCode).toBe(200);
    expect(await body.json()).toEqual({ hello: "world" });
    await client.close();
  });

  it("interceptors.retry retries on failure", async () => {
    retryAttempts = 0;
    const client = new Client(baseUrl).compose(
      interceptors.retry({
        maxRetries: 3,
        minTimeout: 10,
        maxTimeout: 100,
        timeoutFactor: 1,
        retryAfter: false,
      }),
    );
    const { statusCode, body } = await client.request({
      path: "/retry",
      method: "GET",
    });
    expect(statusCode).toBe(200);
    const data = await body.json();
    expect(data.retried).toBe(true);
    expect(data.attempts).toBeGreaterThan(1);
    await client.close();
  });

  it("compose() chains multiple interceptors", async () => {
    const client = new Client(baseUrl).compose(
      interceptors.redirect({ maxRedirections: 3 }),
      (dispatch: Dispatcher.DispatchInterceptor) => {
        return (opts: any, handler: any) => {
          if (!opts.headers) opts.headers = [];
          if (Array.isArray(opts.headers)) {
            opts.headers.push("x-chained", "yes");
          }
          return dispatch(opts, handler);
        };
      },
    );
    const { statusCode, body } = await client.request({
      path: "/headers",
      method: "GET",
    });
    expect(statusCode).toBe(200);
    const headers = await body.json();
    expect(headers["x-chained"]).toBe("yes");
    await client.close();
  });
});

// ---------------------------------------------------------------------------
// MockAgent
// ---------------------------------------------------------------------------
describe("MockAgent", () => {
  let originalDispatcher: Dispatcher;

  beforeEach(() => {
    originalDispatcher = getGlobalDispatcher();
  });

  afterEach(() => {
    setGlobalDispatcher(originalDispatcher);
  });

  it("intercepts requests with mock responses", async () => {
    const mockAgent = new MockAgent();
    setGlobalDispatcher(mockAgent);
    const mockPool = mockAgent.get(baseUrl);
    mockPool.intercept({ path: "/mock", method: "GET" }).reply(200, { mocked: true });
    const { statusCode, body } = await request(`${baseUrl}/mock`);
    expect(statusCode).toBe(200);
    expect(await body.json()).toEqual({ mocked: true });
    await mockAgent.close();
  });

  it("assertNoPendingInterceptors() works", async () => {
    const mockAgent = new MockAgent();
    setGlobalDispatcher(mockAgent);
    const mockPool = mockAgent.get(baseUrl);
    mockPool.intercept({ path: "/pending", method: "GET" }).reply(200, "ok");

    // Unconsumed interceptor should throw
    expect(() => mockAgent.assertNoPendingInterceptors()).toThrow();

    // Consume it
    await request(`${baseUrl}/pending`).then(r => r.body.text());

    // Now should not throw
    expect(() => mockAgent.assertNoPendingInterceptors()).not.toThrow();
    await mockAgent.close();
  });

  it("disableNetConnect() blocks real requests", async () => {
    const mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);
    await expect(request(`${baseUrl}/json`)).rejects.toThrow();
    await mockAgent.close();
  });
});

// ---------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------
describe("errors", () => {
  it("has expected error classes", () => {
    const expectedErrors = [
      "UndiciError",
      "ConnectTimeoutError",
      "HeadersTimeoutError",
      "BodyTimeoutError",
      "InvalidArgumentError",
      "RequestAbortedError",
      "ResponseStatusCodeError",
      "ClientDestroyedError",
      "ClientClosedError",
    ];
    for (const name of expectedErrors) {
      expect((errors as any)[name]).toBeDefined();
      expect(typeof (errors as any)[name]).toBe("function");
    }
  });

  it("error instances follow correct hierarchy", () => {
    const err = new errors.InvalidArgumentError("test");
    expect(err).toBeInstanceOf(errors.UndiciError);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("test");
  });
});

// ---------------------------------------------------------------------------
// Cookie and MIME utilities
// ---------------------------------------------------------------------------
describe("cookie and MIME utilities", () => {
  it("getCookies() parses cookies from headers", () => {
    const headers = new Headers({ cookie: "foo=bar; baz=qux" });
    const cookies = getCookies(headers);
    expect(cookies).toEqual({ foo: "bar", baz: "qux" });
  });

  it("setCookie() and getSetCookies() work together", () => {
    const headers = new Headers();
    setCookie(headers, { name: "session", value: "abc123", path: "/" });
    const cookies = getSetCookies(headers);
    expect(cookies.length).toBeGreaterThanOrEqual(1);
    expect(cookies[0].name).toBe("session");
    expect(cookies[0].value).toBe("abc123");
  });

  it("parseMIMEType() and serializeAMimeType() round-trip", () => {
    const parsed = parseMIMEType("text/html; charset=utf-8");
    expect(parsed).toBeDefined();
    expect(parsed!.type).toBe("text");
    expect(parsed!.subtype).toBe("html");
    const serialized = serializeAMimeType(parsed!);
    expect(serialized).toContain("text/html");
  });
});
