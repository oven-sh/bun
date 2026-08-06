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

// The fetch spec copies a Request `input`'s internal state ("Set request to
// input's request") without consulting JS-visible getters, even when the input
// is a subclass instance or carries shadowing own properties. Node behaves the
// same. Only the `init` argument has dictionary (getter) semantics.
describe("new Request(request) copies internal state without calling getters", () => {
  test("own-property getters on the input are never called", () => {
    let getterHits = 0;
    const input = new Request("http://localhost/original", {
      method: "PUT",
      headers: { "x-real": "1" },
    });
    for (const name of ["url", "method", "headers", "body", "signal", "redirect", "cache", "mode"]) {
      Object.defineProperty(input, name, {
        get() {
          getterHits++;
          return undefined;
        },
      });
    }

    const copy = new Request(input);
    expect({
      url: copy.url,
      method: copy.method,
      headers: [...copy.headers],
      redirect: copy.redirect,
      getterHits,
    }).toEqual({
      url: "http://localhost/original",
      method: "PUT",
      headers: [["x-real", "1"]],
      redirect: "follow",
      getterHits: 0,
    });
  });

  test("subclass getter overrides on the input are ignored", () => {
    let getterHits = 0;
    class MyRequest extends Request {
      get url() {
        getterHits++;
        return "http://localhost/from-getter";
      }
      get method() {
        getterHits++;
        return "DELETE";
      }
      get headers() {
        getterHits++;
        return new Headers({ "x-from-getter": "1" });
      }
    }

    const copy = new Request(new MyRequest("http://localhost/original", { headers: { "x-real": "1" } }));
    expect({
      url: copy.url,
      method: copy.method,
      headers: [...copy.headers],
      getterHits,
    }).toEqual({
      url: "http://localhost/original",
      method: "GET",
      headers: [["x-real", "1"]],
      getterHits: 0,
    });
  });

  test("init members win; everything else comes from the input's internal state", () => {
    class MyRequest extends Request {
      get url() {
        return "http://localhost/from-getter";
      }
      get headers() {
        return new Headers({ "x-from-getter": "1" });
      }
      get redirect() {
        return "error";
      }
    }

    const input = new MyRequest("http://localhost/original", { headers: { "x-real": "1" } });
    const copy = new Request(input, { method: "POST" });
    expect({
      url: copy.url,
      method: copy.method,
      headers: [...copy.headers],
      redirect: copy.redirect,
    }).toEqual({
      url: "http://localhost/original",
      method: "POST",
      headers: [["x-real", "1"]],
      redirect: "follow",
    });
  });

  test("body comes from the input's internal state, not the body getter", async () => {
    const make = () => {
      const input = new Request("http://localhost/original", { method: "POST", body: "real-body" });
      Object.defineProperty(input, "body", {
        get() {
          return "getter-body";
        },
      });
      return input;
    };
    expect(await new Request(make()).text()).toBe("real-body");
    expect(await new Request(make(), {}).text()).toBe("real-body");
  });

  test("init body: null contributes no body, so the input's body is copied", async () => {
    const input = new Request("http://localhost/", { method: "POST", body: "hello" });
    const copy = new Request(input, { body: null });
    expect(copy.body).not.toBeNull();
    expect(await copy.text()).toBe("hello");
  });

  test("an empty-string body input copies as a non-null empty body", async () => {
    const make = () => new Request("http://localhost/", { method: "POST", body: "" });
    const single = new Request(make());
    const withInit = new Request(make(), {});
    expect(single.body).not.toBeNull();
    expect(withInit.body).not.toBeNull();
    expect(await single.text()).toBe("");
    expect(await withInit.text()).toBe("");
  });

  test("the input's signal carries over even when its signal getter is shadowed", () => {
    const ctl = new AbortController();
    const input = new Request("http://localhost/", { signal: ctl.signal });
    Object.defineProperty(input, "signal", {
      get() {
        return undefined;
      },
    });
    const copy = new Request(input, {});
    ctl.abort();
    expect(copy.signal.aborted).toBe(true);
  });

  test("throws TypeError when the input's body is already used", async () => {
    const input = new Request("http://localhost/", { method: "POST", body: "x" });
    await input.text();
    expect(() => new Request(input)).toThrow(TypeError);
    for (const init of [undefined, {}, { body: null }] as const) {
      expect(() => new Request(input, init)).toThrow(
        "Cannot construct a Request with a Request object that has already been used.",
      );
    }

    // Node throws "Request with GET/HEAD method cannot have body." here
    // because its GET/HEAD-body check precedes the unusable check. Bun has no
    // constructor-level GET/HEAD-body check (it enforces at fetch() time), so
    // the unusable error fires; adding that check later must consciously flip
    // this precedence.
    expect(() => new Request(input, { method: "GET" })).toThrow(
      "Cannot construct a Request with a Request object that has already been used.",
    );

    // an init-provided body replaces the input's, so the used input body is
    // never read and nothing throws
    const replaced = new Request(input, { body: "fresh" });
    expect(await replaced.text()).toBe("fresh");
  });

  test("throws TypeError when the input's body stream is locked", () => {
    const input = new Request("http://localhost/", {
      method: "POST",
      body: new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array([97]));
          c.close();
        },
      }),
    });
    input.body!.getReader();
    expect(() => new Request(input)).toThrow(
      "Cannot construct a Request with a Request object that has already been used.",
    );
  });

  test("an unlocked stream-body input still copies fine", async () => {
    const input = new Request("http://localhost/", {
      method: "POST",
      body: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode("st"));
          c.close();
        },
      }),
    });
    expect(await new Request(input).text()).toBe("st");
  });

  test("a Bun.serve request's lazily materialized url is copied, not read via getter", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        let hits = 0;
        Object.defineProperty(req, "url", {
          get() {
            hits++;
            return "http://127.0.0.1:9/from-getter";
          },
        });
        const copy = new Request(req, { method: "POST" });
        const single = new Request(req);
        return Response.json({ hits, url: copy.url, method: copy.method, single: single.url });
      },
    });
    const res = await fetch(`http://localhost:${server.port}/real-path`);
    expect(await res.json()).toEqual({
      hits: 0,
      url: `http://localhost:${server.port}/real-path`,
      method: "POST",
      single: `http://localhost:${server.port}/real-path`,
    });
  });

  test("a Request passed as init (second argument) keeps dictionary getter semantics", () => {
    let getterHits = 0;
    const asInit = new Request("http://localhost/original", { method: "PUT" });
    Object.defineProperty(asInit, "method", {
      get() {
        getterHits++;
        return "PATCH";
      },
    });
    const built = new Request("http://localhost/base", asInit);
    expect({ url: built.url, method: built.method, getterHits }).toEqual({
      url: "http://localhost/base",
      method: "PATCH",
      getterHits: 1,
    });
  });
});
