import { describe, expect, test } from "bun:test";
import net from "node:net";

test("undefined args don't throw", () => {
  const request = new Request("https://example.com/", {
    body: undefined,
    "credentials": undefined,
    "redirect": undefined,
    "method": undefined,
    "mode": undefined,
  });

  expect(request.method).toBe("GET");
});

test("request can receive undefined signal", async () => {
  const request = new Request("http://example.com/", {
    method: "POST",
    headers: {
      "Content-Type": "text/bun;charset=utf-8",
    },
    body: "bun",
    signal: undefined,
  });
  expect(request.method).toBe("POST");
  // @ts-ignore
  const clone = new Request(request);
  expect(clone.method).toBe("POST");
  expect(clone.headers.get("content-type")).toBe("text/bun;charset=utf-8");
  expect(await request.text()).toBe("bun");
  expect(await clone.text()).toBe("bun");
});

test("request can receive null signal", async () => {
  const request = new Request("http://example.com/", {
    method: "POST",
    headers: {
      "Content-Type": "text/bun;charset=utf-8",
    },
    body: "bun",
    signal: null,
  });
  expect(request.method).toBe("POST");
  // @ts-ignore
  const clone = new Request(request);
  expect(clone.method).toBe("POST");
  expect(clone.headers.get("content-type")).toBe("text/bun;charset=utf-8");
  expect(await request.text()).toBe("bun");
  expect(await clone.text()).toBe("bun");
});

test("clone() does not lock original body when body was accessed before clone", async () => {
  const readableStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("Hello, world!"));
      controller.close();
    },
  });

  const request = new Request("http://example.com", { method: "POST", body: readableStream });

  // Access body before clone (this triggers the bug in the unfixed version)
  const bodyBeforeClone = request.body;
  expect(bodyBeforeClone?.locked).toBe(false);

  const cloned = request.clone();

  // Both should be unlocked after clone
  expect(request.body?.locked).toBe(false);
  expect(cloned.body?.locked).toBe(false);

  // Both should be readable
  const [originalText, clonedText] = await Promise.all([request.text(), cloned.text()]);

  expect(originalText).toBe("Hello, world!");
  expect(clonedText).toBe("Hello, world!");
});

test.each([
  ["no arguments", [], "expected non-empty string or object, got undefined"],
  ["undefined", [undefined], "expected non-empty string or object, got undefined"],
  ["null", [null], "expected non-empty string or object, got null"],
  ["a number", [5], "expected non-empty string or object, got number"],
  ["a boolean", [true], "expected non-empty string or object, got boolean"],
  ["a symbol", [Symbol()], "expected non-empty string or object"],
  ["an empty string", [""], "url is required."],
  ["an object without a url", [{}], "url is required."],
])("new Request() throws a TypeError for %s", (_, args, message) => {
  let error: unknown;
  try {
    // @ts-expect-error
    new Request(...args);
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(TypeError);
  expect((error as TypeError).message).toBe(`Failed to construct 'Request': ${message}`);
});

// https://github.com/oven-sh/bun/issues/42497
describe("a method outside the method table", () => {
  test.each([
    ["LIST", "LIST"],
    ["custom", "custom"],
    ["PatCh", "PatCh"],
    ["Put", "PUT"],
    ["pOsT", "POST"],
    ["patch", "PATCH"],
    ["GET POST", "GET"],
    [false, "GET"],
  ])("new Request(url, { method: %j }).method is %j", (method, expected) => {
    expect(new Request("http://h.example/", { method } as RequestInit).method).toBe(expected);
  });

  test("survives clone(), new Request(request) and Bun.inspect()", async () => {
    const request = new Request("http://h.example/", { method: "LIST", body: "a" });
    expect(request.clone().method).toBe("LIST");
    expect(new Request(request.clone()).method).toBe("LIST");
    expect(new Request(request.clone(), { headers: { "x-k": "1" } }).method).toBe("LIST");
    expect(new Request(request.clone(), { method: "BREW" }).method).toBe("BREW");
    expect(new Request(request.clone(), { method: "PUT" }).method).toBe("PUT");
    expect(Bun.inspect(request)).toContain('method: "LIST"');
    expect(await request.text()).toBe("a");
  });
});

describe("RequestInit signal presence", () => {
  // Fetch spec step 27: "If init['signal'] exists, then set signal to it."
  // A present `signal: null` must replace (detach from) the input Request's signal.
  test("new Request(request, { signal: null }) detaches from input's signal", () => {
    const ctl = new AbortController();
    const orig = new Request("http://example.com/", { signal: ctl.signal });
    const bare = new Request(orig, { signal: null });
    expect(bare.signal).not.toBe(ctl.signal);
    ctl.abort(new Error("orig aborted"));
    expect(bare.signal.aborted).toBe(false);
  });

  test("new Request(request, { signal: undefined }) inherits input's signal", () => {
    const ctl = new AbortController();
    const orig = new Request("http://example.com/", { signal: ctl.signal });
    const derived = new Request(orig, { signal: undefined });
    ctl.abort(new Error("orig aborted"));
    expect(derived.signal.aborted).toBe(true);
  });

  test("new Request(request, {}) inherits input's signal", () => {
    const ctl = new AbortController();
    const orig = new Request("http://example.com/", { signal: ctl.signal });
    const derived = new Request(orig, {});
    ctl.abort(new Error("orig aborted"));
    expect(derived.signal.aborted).toBe(true);
  });

  test.each(["", {}, 0, false, true])("signal: %p throws TypeError", signal => {
    expect(() => new Request("http://example.com/", { signal } as any)).toThrow(TypeError);
  });

  test.each([null, undefined])("signal: %p does not throw", signal => {
    expect(() => new Request("http://example.com/", { signal } as any)).not.toThrow();
  });

  async function withServer(fn: (url: string) => Promise<void>) {
    const srv = net.createServer(s => {
      s.on("error", () => {});
      s.on("data", () => s.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"));
    });
    try {
      await new Promise<void>(r => srv.listen(0, "127.0.0.1", () => r()));
      await fn(`http://127.0.0.1:${(srv.address() as net.AddressInfo).port}/`);
    } finally {
      srv.close();
    }
  }

  test("fetch(new Request(request, { signal: null })) is not aborted by input's controller", async () => {
    await withServer(async url => {
      const ctl = new AbortController();
      const orig = new Request(url, { signal: ctl.signal });
      const bare = new Request(orig, { signal: null });
      ctl.abort(new Error("orig aborted"));
      const res = await fetch(bare);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
    });
  });

  test("fetch(request, { signal: null }) detaches from request's pre-aborted signal", async () => {
    await withServer(async url => {
      const pre = new Request(url, { signal: AbortSignal.abort(new Error("pre")) });
      const res = await fetch(pre, { signal: null });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
    });
  });

  test("fetch(request, { signal: undefined }) inherits request's signal", async () => {
    await withServer(async url => {
      const pre = new Request(url, { signal: AbortSignal.abort(new Error("pre")) });
      const result = await fetch(pre, { signal: undefined }).then(
        r => ({ ok: true, status: r.status }),
        e => ({ ok: false, message: String(e) }),
      );
      expect(result).toEqual({ ok: false, message: "Error: pre" });
    });
  });

  test("fetch(request, { signal: other }) overrides request's signal", async () => {
    await withServer(async url => {
      const pre = new Request(url, { signal: AbortSignal.abort(new Error("pre")) });
      const other = new AbortController();
      const res = await fetch(pre, { signal: other.signal });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
    });
  });

  test("fetch(request, { signal: <invalid> }) rejects with TypeError", async () => {
    await withServer(async url => {
      const pre = new Request(url, { signal: AbortSignal.abort(new Error("pre")) });
      await expect(fetch(pre, { signal: {} as any })).rejects.toThrow(TypeError);
      await expect(fetch(url, { signal: "" as any })).rejects.toThrow(TypeError);
    });
  });
});

// https://github.com/oven-sh/bun/issues/49395
// Fetch spec, Request constructor: "If init['headers'] exists, then set headers to init['headers']."
// The member exists when it is not undefined. An empty HeadersInit exists.
describe("RequestInit headers presence", () => {
  const input = () => new Request("http://h.example/x", { method: "POST", headers: { "x-a": "1" } });
  const names = (r: Request) => [...r.headers.keys()];
  const emptied = () => {
    const headers = new Headers({ "x-e": "1" });
    headers.delete("x-e");
    return headers;
  };
  class SubRequest extends Request {}

  describe.each([
    ["{}", () => ({})],
    ["[]", () => []],
    ["new Headers()", () => new Headers()],
    ["a Headers emptied with delete()", emptied],
    ["a null-prototype object", () => Object.create(null)],
  ])("headers: %s", (_, makeHeaders) => {
    test.each([
      ["a plain object", (headers: HeadersInit) => ({ headers })],
      ["an object that inherits the member", (headers: HeadersInit) => Object.create({ headers })],
      [
        "a class instance with a getter",
        (headers: HeadersInit) =>
          new (class {
            get headers() {
              return headers;
            }
          })(),
      ],
      ["a Proxy", (headers: HeadersInit) => new Proxy({ headers }, {})],
      ["an array", (headers: HeadersInit) => Object.assign([], { headers })],
      ["a function", (headers: HeadersInit) => Object.assign(function init() {}, { headers })],
    ])("in %s replaces the headers of the input", (_, makeInit) => {
      const derived = new Request(input(), makeInit(makeHeaders()) as RequestInit);
      expect({ method: derived.method, headers: names(derived) }).toEqual({ method: "POST", headers: [] });
    });
  });

  test.each([
    ["a Request with no headers", () => new Request("http://h.example/y")],
    ["a Request subclass with no headers", () => new SubRequest("http://h.example/y")],
    ["a Response with no headers", () => new Response(null)],
    ["a Response with no headers, after a read of its headers", () => (r => (r.headers, r))(new Response(null))],
  ])("%s as init replaces the headers of the input", (_, makeInit) => {
    expect(names(new Request(input(), makeInit() as RequestInit))).toEqual([]);
  });

  test("a Request subclass takes empty headers from init, as constructor and as input", () => {
    expect(names(new SubRequest(input(), { headers: {} }))).toEqual([]);
    expect(names(new Request(new SubRequest(input()), { headers: {} }))).toEqual([]);
    expect(names(new Request(new SubRequest(input())))).toEqual(["x-a"]);
  });

  // Bun accepts a plain object and a Response as `input`.
  test("empty headers in init replace the headers of a non-Request input", () => {
    const object = { url: "http://h.example/x", headers: { "x-a": "1" } } as unknown as Request;
    expect(names(new Request(object, { headers: {} }))).toEqual([]);
    expect(names(new Request(object, {}))).toEqual(["x-a"]);
    const response = () => new Response(null, { headers: { "x-a": "1" } }) as unknown as Request;
    // @ts-expect-error
    expect(names(new Request(response(), { url: "http://h.example/x", headers: {} }))).toEqual([]);
    // @ts-expect-error
    expect(names(new Request(response(), { url: "http://h.example/x" }))).toEqual(["x-a"]);
  });

  test.each([
    ["no init", () => undefined],
    ["{}", () => ({})],
    ["{ method }", () => ({ method: "POST" })],
    ["{ headers: undefined }", () => ({ headers: undefined })],
    ["a Map with a headers entry", () => new Map([["headers", {}]])],
  ])("init with no headers member keeps the headers of the input: %s", (_, makeInit) => {
    const derived = new Request(input(), makeInit() as RequestInit);
    expect({ method: derived.method, headers: [...derived.headers] }).toEqual({
      method: "POST",
      headers: [["x-a", "1"]],
    });
  });

  test("non-empty headers in init replace the headers of the input", () => {
    expect([...new Request(input(), { headers: { "x-b": "2" } }).headers]).toEqual([["x-b", "2"]]);
    expect([...new Request(input(), { headers: new Headers({ "x-b": "2" }) }).headers]).toEqual([["x-b", "2"]]);
  });

  test("headers that are not a HeadersInit throw", () => {
    for (const headers of [null, 0, "", [[]]]) {
      expect(() => new Request(input(), { headers } as unknown as RequestInit)).toThrow(TypeError);
    }
    const init = {
      get headers(): HeadersInit {
        throw new RangeError("from the getter");
      },
    };
    expect(() => new Request(input(), init)).toThrow(new RangeError("from the getter"));
  });

  test("a request with emptied headers stays empty through clone() and a copy", () => {
    const derived = () => new Request(input(), { headers: {} });
    expect(names(derived().clone())).toEqual([]);
    expect(names(new Request(derived()))).toEqual([]);
    expect(names(new Request(derived(), { method: "PUT" }))).toEqual([]);
  });

  test("the new request does not share headers with the input or with init", () => {
    const original = input();
    const headers = new Headers();
    const derived = new Request(original, { headers });
    expect(derived.headers).toBe(derived.headers);
    derived.headers.set("x-d", "1");
    headers.set("x-h", "1");
    expect([names(original), names(derived), [...headers.keys()]]).toEqual([["x-a"], ["x-d"], ["x-h"]]);
  });

  test("fetch() and Bun.serve() do not see the replaced headers", async () => {
    const seen = (req: Request) => ["x-a", "x-forwarded-for"].filter(name => req.headers.has(name));
    using server = Bun.serve({
      port: 0,
      routes: {
        // A route handler gets a BunRequest, not a plain Request.
        "/route": req => Response.json(seen(new Request(req, { headers: {} }))),
      },
      fetch: req =>
        Response.json(new URL(req.url).pathname === "/echo" ? seen(req) : seen(new Request(req, { headers: {} }))),
    });
    const request = (path: string) =>
      new Request(new URL(path, server.url), { headers: { "x-a": "1", "x-forwarded-for": "10.0.0.1" } });

    expect(await (await fetch(request("/echo"))).json()).toEqual(["x-a", "x-forwarded-for"]);
    expect(await (await fetch(new Request(request("/echo"), { headers: {} }))).json()).toEqual([]);
    expect(await (await fetch(request("/handler"))).json()).toEqual([]);
    expect(await (await fetch(request("/route"))).json()).toEqual([]);
  });
});

// `RequestInit` is a WebIDL dictionary: a member is present only when the init object has that
// property (and it is not undefined). An init without a `method` keeps the method of the input.
describe("RequestInit method presence", () => {
  const put = () =>
    new Request("http://h.example/x", { method: "PUT", body: "a", headers: { "x-k": "1" }, redirect: "manual" });

  // The kind of object does not matter, only which properties it has.
  test.each([
    ["Proxy", () => new Proxy({ headers: { "x-o": "3" } }, {})],
    ["array", () => Object.assign([], { headers: { "x-o": "3" } })],
    ["function", () => Object.assign(function init() {}, { headers: { "x-o": "3" } })],
    [
      "class instance",
      () =>
        new (class Init {
          headers = { "x-o": "3" };
        })(),
    ],
    ["null-prototype object", () => Object.assign(Object.create(null), { headers: { "x-o": "3" } })],
  ])("%s init without a method keeps the method of the input", async (_, makeInit) => {
    const r = new Request(put(), makeInit() as RequestInit);
    expect({ method: r.method, redirect: r.redirect, headers: [...r.headers], body: await r.text() }).toEqual({
      method: "PUT",
      redirect: "manual",
      headers: [["x-o", "3"]],
      body: "a",
    });
  });

  test.each([
    ["Headers", () => new Headers({ "x-o": "3" })],
    ["URL", () => new URL("http://other.example/")],
    ["Blob", () => new Blob(["zz"])],
    ["Map", () => new Map([["method", "DELETE"]])],
  ])("%s as init has no RequestInit members at all", async (_, makeInit) => {
    const r = new Request(put(), makeInit() as unknown as RequestInit);
    expect({ method: r.method, url: r.url, xk: r.headers.get("x-k"), body: await r.text() }).toEqual({
      method: "PUT",
      url: "http://h.example/x",
      xk: "1",
      body: "a",
    });
  });

  test("a Response passed as init sets headers and body, not a method", async () => {
    // A Response is not a RequestInit, but it is an object with `headers` and `body`.
    const r = new Request(put(), new Response("b", { headers: { "x-r": "2" } }));
    expect({
      method: r.method,
      url: r.url,
      redirect: r.redirect,
      xr: r.headers.get("x-r"),
      xk: r.headers.get("x-k"),
    }).toEqual({
      method: "PUT",
      url: "http://h.example/x",
      redirect: "manual",
      xr: "2",
      xk: null,
    });
    expect(await r.text()).toBe("b");
    expect(new Request(put(), new Response(null, { status: 204 })).method).toBe("PUT");

    // Bun lets ResponseInit carry a `method`. It is internal state, not a property, so only a
    // Response passed as `input` gives it to the Request.
    const withMethod = () => new Response(null, { method: "DELETE" } as ResponseInit);
    expect(new Request(put(), withMethod() as RequestInit).method).toBe("PUT");
    expect(new Request("http://h.example/y", withMethod() as RequestInit).method).toBe("GET");
    // @ts-expect-error
    expect(new Request(withMethod(), { url: "http://h.example/y" }).method).toBe("DELETE");
  });

  test("a method on init overrides the method of the input", () => {
    expect(new Request(put(), { method: "POST" }).method).toBe("POST");
    expect(new Request(put(), new Proxy({ method: "POST" }, {})).method).toBe("POST");
    expect(new Request(put(), Object.assign([], { method: "DELETE" })).method).toBe("DELETE");
  });

  // https://github.com/oven-sh/bun/issues/42759
  // An object that is not a native Request is accepted as `input` (a Bun extension). Its members
  // are read as properties, and `init` overrides only the members it has.
  describe("a non-native input", () => {
    // Not a native Request, but every getter and method forwards to one, and it passes
    // `instanceof Request`. srvx hands Node.js requests to fetch handlers in this form.
    function requestLike() {
      const backing = put();
      class RequestLike {}
      for (const [key, desc] of Object.entries(Object.getOwnPropertyDescriptors(Request.prototype))) {
        if (key === "constructor") continue;
        Object.defineProperty(
          RequestLike.prototype,
          key,
          desc.get
            ? { get: () => Reflect.get(backing, key) }
            : { value: (...args: unknown[]) => Reflect.apply(Reflect.get(backing, key), backing, args) },
        );
      }
      Object.setPrototypeOf(RequestLike.prototype, Request.prototype);
      return new RequestLike() as unknown as Request;
    }

    test("a Request look-alike keeps its method when init has none", async () => {
      expect(requestLike()).toBeInstanceOf(Request);
      // A fresh look-alike each time: a copy consumes the body of its input.
      expect(new Request(requestLike()).method).toBe("PUT");
      expect(new Request(requestLike(), { method: "POST" }).method).toBe("POST");

      const kept = new Request(requestLike(), {});
      expect({ method: kept.method, xk: kept.headers.get("x-k"), body: await kept.text() }).toEqual({
        method: "PUT",
        xk: "1",
        body: "a",
      });

      const replaced = new Request(requestLike(), { headers: {} });
      expect({ method: replaced.method, xk: replaced.headers.get("x-k"), body: await replaced.text() }).toEqual({
        method: "PUT",
        xk: null,
        body: "a",
      });
    });

    test("a plain object keeps its method when init has none", async () => {
      const object = () =>
        ({ url: "http://h.example/x", method: "PUT", body: "a", headers: { "x-k": "1" } }) as unknown as Request;
      expect(new Request(object()).method).toBe("PUT");
      expect(new Request(object(), { method: "POST" }).method).toBe("POST");

      const kept = new Request(object(), {});
      expect({ method: kept.method, xk: kept.headers.get("x-k"), body: await kept.text() }).toEqual({
        method: "PUT",
        xk: "1",
        body: "a",
      });
    });
  });

  test("each of headers and method is read once, and no ResponseInit member is read", () => {
    const reads = (input: () => Request | string) => {
      const counts: Record<string, number> = { headers: 0, method: 0, status: 0, statusText: 0 };
      const init = new Proxy(
        {},
        {
          get(_, key) {
            if (typeof key === "string" && key in counts) counts[key]++;
            return undefined;
          },
        },
      );
      new Request(input(), init);
      return counts;
    };
    expect(reads(() => "http://h.example/x")).toEqual({ headers: 1, method: 1, status: 0, statusText: 0 });
    expect(reads(put)).toEqual({ headers: 1, method: 1, status: 0, statusText: 0 });

    let plainReads = 0;
    const plain = {
      get headers() {
        return (plainReads++, {});
      },
    };
    new Request(put(), plain);
    expect(plainReads).toBe(1);

    // `status` belongs to ResponseInit. Its range check does not apply to a Request.
    // @ts-expect-error
    expect(new Request("http://h.example/x", { status: 999 }).method).toBe("GET");
  });

  describe("a member that init has is not read from the input", () => {
    // A subclass instance is read through its getters.
    class Counting extends Request {
      static reads = { headers: 0, method: 0 };
      get headers() {
        Counting.reads.headers++;
        return super.headers;
      }
      get method() {
        Counting.reads.method++;
        return super.method;
      }
    }
    const reads = (init: RequestInit) => {
      const input = new Counting("http://h.example/x", { method: "PUT", headers: { "x-k": "1" } });
      Counting.reads = { headers: 0, method: 0 };
      new Request(input, init);
      return Counting.reads;
    };

    test.each([
      ["{ headers }", () => ({ headers: { "x-o": "3" } }), { headers: 0 }],
      ["{ headers: {} }", () => ({ headers: {} }), { headers: 0 }],
      ["{ method }", () => ({ method: "POST" }), { method: 0 }],
      ["{ headers: {}, method }", () => ({ headers: {}, method: "POST" }), { headers: 0, method: 0 }],
      ["a Request with no headers", () => new Request("http://h.example/y"), { headers: 0, method: 0 }],
    ])("init is %s", (_, makeInit, expected) => {
      expect(reads(makeInit())).toMatchObject(expected);
    });

    test("a throwing headers getter on the input is reached only when init has no headers", () => {
      const input = {
        url: "http://h.example/x",
        get headers(): HeadersInit {
          throw new RangeError("from the input");
        },
      } as unknown as Request;
      expect([...new Request(input, { headers: {} }).headers]).toEqual([]);
      expect(() => new Request(input, {})).toThrow(new RangeError("from the input"));
    });
  });
});
