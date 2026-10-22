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

describe("RequestInit method presence", () => {
  const put = () => new Request("http://h.example/x", { method: "PUT", body: "a", headers: { "x-k": "1" } });
  const xHeaders = (r: Request) => Object.fromEntries([...r.headers].filter(([name]) => name.startsWith("x-")));

  // https://github.com/oven-sh/bun/issues/42759
  test("a Request look-alike keeps its method when init has none", async () => {
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
    expect(new Request(requestLike()).method).toBe("PUT");
    expect(new Request(requestLike(), {}).method).toBe("PUT");
    expect(new Request(requestLike(), { method: "POST" }).method).toBe("POST");

    const replaced = new Request(requestLike(), { headers: { "x-o": "3" } });
    expect(replaced.method).toBe("PUT");
    expect(replaced.url).toBe("http://h.example/x");
    expect(xHeaders(replaced)).toEqual({ "x-o": "3" });
    expect(await replaced.text()).toBe("a");
  });

  test("a plain object input keeps its method when init has none", async () => {
    const input = () =>
      ({ url: "http://h.example/x", method: "PUT", body: "a", headers: { "x-k": "1" } }) as unknown as Request;
    expect(new Request(input(), { method: "POST" }).method).toBe("POST");
    const kept = new Request(input(), {});
    expect(kept.method).toBe("PUT");
    expect(xHeaders(kept)).toEqual({ "x-k": "1" });
    expect(await kept.text()).toBe("a");
  });

  test.each([
    ["a Proxy", () => new Proxy({}, {})],
    ["an array", () => []],
    ["a function", () => function () {}],
    ["a Headers", () => new Headers({ "x-o": "3" })],
    ["a URL", () => new URL("http://other.example/")],
    ["a Blob", () => new Blob(["zz"])],
  ])("keeps the input Request's method when init is %s", async (_, makeInit) => {
    const r = new Request(put(), makeInit() as any);
    expect(r.method).toBe("PUT");
    expect(r.url).toBe("http://h.example/x");
    expect(xHeaders(r)).toEqual({ "x-k": "1" });
    expect(await r.text()).toBe("a");
  });

  test("a Response passed as init sets headers and body, not the method", async () => {
    const r = new Request(put(), new Response("b", { headers: { "x-r": "2" } }) as any);
    expect(r.method).toBe("PUT");
    expect(xHeaders(r)).toEqual({ "x-r": "2" });
    expect(await r.text()).toBe("b");
    expect(new Request(put(), new Response(null, { status: 204 }) as any).method).toBe("PUT");
  });

  test("reads init.method once and never reads status or statusText", () => {
    let reads = 0;
    const init = {
      get method() {
        reads++;
        return "OPTIONS";
      },
      get status() {
        throw new Error("status must not be read");
      },
      get statusText() {
        throw new Error("statusText must not be read");
      },
    };
    expect(new Request(put(), init).method).toBe("OPTIONS");
    expect(reads).toBe(1);
    expect(new Request("http://h.example/x", { status: 0 } as any).method).toBe("GET");
  });
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
