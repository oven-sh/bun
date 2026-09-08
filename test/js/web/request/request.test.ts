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

// WHATWG `RequestInit` has no `url` member. The URL comes from `input` only.
describe("RequestInit has no url member", () => {
  test("new Request(request, { url }) keeps the input Request's url", () => {
    const base = new Request("http://a.example/x", { method: "DELETE" });
    const r = new Request(base, { url: "http://b.example/y" } as RequestInit);
    expect(r.url).toBe("http://a.example/x");
    expect(r.method).toBe("DELETE");
  });

  test("new Request(request, { url: <invalid> }) does not throw", () => {
    const base = new Request("http://a.example/x");
    expect(new Request(base, { url: "/relative" } as RequestInit).url).toBe("http://a.example/x");
    expect(new Request(base, { url: 123 } as RequestInit).url).toBe("http://a.example/x");
  });

  test("init.url getter is never read", () => {
    const base = new Request("http://a.example/x");
    let called = false;
    const init = {
      method: "POST",
      get url() {
        called = true;
        return "http://b.example/y";
      },
    };
    const r = new Request(base, init);
    expect(r.url).toBe("http://a.example/x");
    expect(r.method).toBe("POST");
    expect(called).toBe(false);
  });

  test("new Request(string, { url }) keeps the string url", () => {
    expect(new Request("http://a.example/x", { url: "http://b.example/y" } as RequestInit).url).toBe(
      "http://a.example/x",
    );
    // An empty-string input does not fall back to init.url.
    expect(() => new Request("", { url: "http://b.example/y" } as RequestInit)).toThrow("url is required");
  });

  test("new Request({ url }, { url }) takes the url from input only", () => {
    // A plain object with a `url` as *input* is a Bun extension and keeps working.
    // @ts-expect-error
    const r = new Request({ url: "http://a.example/x" }, { url: "http://b.example/y", method: "PATCH" });
    expect(r.url).toBe("http://a.example/x");
    expect(r.method).toBe("PATCH");
  });

  test("a Response passed as init does not contribute its url", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch: () => new Response("hi"),
    });
    const res = await fetch(server.url);
    expect(res.url).toBe(server.url.href);
    const base = new Request("http://a.example/x");
    // @ts-expect-error
    expect(new Request(base, res).url).toBe("http://a.example/x");
  });

  test("fetch(new Request(request, { url })) goes to the input Request's url", async () => {
    await using a = Bun.serve({ port: 0, fetch: () => new Response("a") });
    await using b = Bun.serve({ port: 0, fetch: () => new Response("b") });
    const req = new Request(new Request(a.url), { url: b.url.href } as RequestInit);
    expect(req.url).toBe(a.url.href);
    const res = await fetch(req);
    expect(await res.text()).toBe("a");
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
