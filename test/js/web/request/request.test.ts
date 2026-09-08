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

// `RequestInit` is a WebIDL dictionary: a member is present only when the init object has that
// property (and it is not undefined). An init without a `method` keeps the input Request's method.
describe("RequestInit method presence", () => {
  const put = () =>
    new Request("http://h.example/x", { method: "PUT", body: "a", headers: { "x-k": "1" }, redirect: "manual" });
  // Only the custom headers: a Content-Type derived from the body is not the subject here.
  const xHeaders = (r: Request) => Object.fromEntries([...r.headers].filter(([name]) => name.startsWith("x-")));

  test("a Response passed as init contributes headers and body, not a method", async () => {
    // @ts-expect-error a Response is not a RequestInit, but it is an object with `headers`/`body`.
    const r = new Request(put(), new Response("b", { headers: { "x-r": "2" } }));
    expect(r.method).toBe("PUT");
    expect(r.url).toBe("http://h.example/x");
    expect(r.redirect).toBe("manual");
    expect(xHeaders(r)).toEqual({ "x-r": "2" });
    expect(await r.text()).toBe("b");
  });

  test("a Response with a null body passed as init keeps the input Request's method", () => {
    // @ts-expect-error
    const r = new Request(put(), new Response(null, { status: 204 }));
    expect(r.method).toBe("PUT");
    expect(r.url).toBe("http://h.example/x");
    // Bun lets ResponseInit carry a `method` (HTMLRewriter uses it). It is internal state, not a
    // property, so it must not leak into a Request either.
    // @ts-expect-error
    expect(new Request(put(), new Response(null, { method: "DELETE" })).method).toBe("PUT");
    // @ts-expect-error
    expect(new Request("http://h.example/y", new Response(null, { method: "DELETE" })).method).toBe("GET");
  });

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
  ])("%s init without a method keeps the input Request's method", async (_, makeInit) => {
    const r = new Request(put(), makeInit() as RequestInit);
    expect(r.method).toBe("PUT");
    expect(r.redirect).toBe("manual");
    expect(xHeaders(r)).toEqual({ "x-o": "3" });
    expect(await r.text()).toBe("a");
  });

  test.each([
    ["Headers", () => new Headers({ "x-o": "3" })],
    ["URL", () => new URL("http://other.example/")],
    ["Blob", () => new Blob(["zz"])],
    ["Map", () => new Map([["method", "DELETE"]])],
  ])("%s as init has no RequestInit members at all", async (_, makeInit) => {
    const r = new Request(put(), makeInit() as unknown as RequestInit);
    expect(r.method).toBe("PUT");
    expect(r.url).toBe("http://h.example/x");
    expect(xHeaders(r)).toEqual({ "x-k": "1" });
    expect(await r.text()).toBe("a");
  });

  test("a method on a non-plain init object is still honoured", () => {
    expect(new Request(put(), new Proxy({ method: "POST" }, {})).method).toBe("POST");
    expect(new Request(put(), Object.assign([], { method: "DELETE" })).method).toBe("DELETE");
    class WithMethod extends Response {
      get method() {
        return "PATCH";
      }
    }
    // @ts-expect-error
    expect(new Request(put(), new WithMethod()).method).toBe("PATCH");
    let reads = 0;
    const init = {
      get method() {
        reads++;
        return "OPTIONS";
      },
    };
    expect(new Request(put(), init).method).toBe("OPTIONS");
    expect(reads).toBe(1);
  });

  test("an object input keeps its method when init has none", () => {
    // A plain object with a `url` as input is a Bun extension.
    // @ts-expect-error
    const r = new Request({ url: "http://h.example/x", method: "PUT" }, { headers: { "x-o": "3" } });
    expect(r.method).toBe("PUT");
    expect(r.url).toBe("http://h.example/x");
    expect(xHeaders(r)).toEqual({ "x-o": "3" });
  });

  test("ResponseInit-only members on a RequestInit are not read", () => {
    const init = {
      method: "POST",
      get status() {
        throw new Error("status must not be read");
      },
      get statusText() {
        throw new Error("statusText must not be read");
      },
    };
    expect(new Request("http://h.example/x", init).method).toBe("POST");
    expect(new Request(put(), init).method).toBe("POST");
    // @ts-expect-error
    expect(new Request("http://h.example/x", { status: 0 }).method).toBe("GET");
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
