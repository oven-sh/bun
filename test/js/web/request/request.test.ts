import { heapStats } from "bun:jsc";
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

describe("Request.signal is a new dependent signal", () => {
  // https://fetch.spec.whatwg.org/#dom-request step 30/31: each Request gets a
  // new AbortSignal that follows the input signal. Returning the caller's
  // controller signal directly means request-scoped mutation (onabort,
  // removeEventListener) reaches into the user's AbortController.

  test("new Request(url, { signal }) returns a distinct signal", () => {
    const c = new AbortController();
    const req = new Request("https://example.com/", { signal: c.signal });
    expect(req.signal).not.toBe(c.signal);
    expect(req.signal).toBe(req.signal);
  });

  test("mutating request.signal does not affect the controller's signal", () => {
    const c = new AbortController();
    let controllerHandlerCalls = 0;
    c.signal.onabort = () => {
      controllerHandlerCalls++;
    };
    const req = new Request("https://example.com/", { signal: c.signal });
    req.signal.onabort = null;
    expect(c.signal.onabort).toBeInstanceOf(Function);
    c.abort();
    expect(controllerHandlerCalls).toBe(1);
    expect(req.signal.aborted).toBe(true);
  });

  test("request.clone().signal is a distinct signal following the original", () => {
    const c = new AbortController();
    const req = new Request("https://example.com/", { signal: c.signal });
    const cloned = req.clone();
    expect(cloned.signal).not.toBe(req.signal);
    expect(cloned.signal).not.toBe(c.signal);

    let clonedAborted = false;
    cloned.signal.addEventListener("abort", () => {
      clonedAborted = true;
    });
    c.abort(new Error("stop"));
    expect(clonedAborted).toBe(true);
    expect(cloned.signal.aborted).toBe(true);
    expect((cloned.signal.reason as Error).message).toBe("stop");
  });

  test("new Request(request) gets a distinct signal following the input request's signal", () => {
    const c = new AbortController();
    const r1 = new Request("https://example.com/", { signal: c.signal });
    const r2 = new Request(r1);
    expect(r2.signal).not.toBe(r1.signal);
    expect(r2.signal).not.toBe(c.signal);
    c.abort();
    expect(r2.signal.aborted).toBe(true);
  });

  test("new Request(request, init) with init.signal uses a dependent of init.signal", () => {
    const c1 = new AbortController();
    const c2 = new AbortController();
    const r1 = new Request("https://example.com/", { signal: c1.signal });
    const r2 = new Request(r1, { signal: c2.signal });
    expect(r2.signal).not.toBe(c2.signal);
    expect(r2.signal).not.toBe(r1.signal);
    c1.abort();
    expect(r2.signal.aborted).toBe(false);
    c2.abort();
    expect(r2.signal.aborted).toBe(true);
  });

  test("dependent signal inherits already-aborted state", () => {
    const c = new AbortController();
    c.abort(new Error("early"));
    const req = new Request("https://example.com/", { signal: c.signal });
    expect(req.signal).not.toBe(c.signal);
    expect(req.signal.aborted).toBe(true);
    expect((req.signal.reason as Error).message).toBe("early");
  });

  test("dependent signals do not accumulate on a long-lived controller", () => {
    const c = new AbortController();
    const iterations = 2000;

    const measure = () => {
      for (let i = 0; i < iterations; i++) {
        const req = new Request("https://example.com/", { signal: c.signal });
        // Materialize the JS wrapper so the reachability path is exercised.
        req.signal;
      }
      Bun.gc(true);
    };

    measure();
    Bun.gc(true);
    const baseline = heapStats().objectTypeCounts.AbortSignal || 0;
    measure();
    measure();
    Bun.gc(true);
    const after = heapStats().objectTypeCounts.AbortSignal || 0;
    // If each Request's dependent signal were pinned by the parent, `after`
    // would exceed baseline by ~iterations. Allow generous headroom for the
    // controller's own signal and GC timing.
    expect(after - baseline).toBeLessThan(iterations / 4);
    // The controller still works after all that churn.
    const req = new Request("https://example.com/", { signal: c.signal });
    let fired = false;
    req.signal.addEventListener("abort", () => {
      fired = true;
    });
    c.abort();
    expect(fired).toBe(true);
  });
});
