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

// WebIDL converts every RequestInit member before the body is extracted. A body that is read by
// reference (URLSearchParams, FormData, a typed array) sees a getter on another member that mutates
// it. A body that converts to a string is converted when `body` is read.
describe("RequestInit body is extracted after the other members are read (#48468)", () => {
  function requestWithMutatingGetter(body: BodyInit, mutate: () => void) {
    return new Request("https://example.com/", {
      body,
      get method() {
        mutate();
        return "POST";
      },
    });
  }

  test("URLSearchParams", async () => {
    const params = new URLSearchParams("a=1");
    const request = requestWithMutatingGetter(params, () => params.append("b", "2"));
    expect(request.method).toBe("POST");
    expect(await request.text()).toBe("a=1&b=2");
  });

  test("FormData", async () => {
    const form = new FormData();
    form.append("a", "1");
    const request = requestWithMutatingGetter(form, () => form.append("b", "2"));
    expect([...(await request.formData()).keys()]).toEqual(["a", "b"]);
  });

  test("Uint8Array", async () => {
    const bytes = new TextEncoder().encode("a=1");
    const request = requestWithMutatingGetter(bytes, () => {
      bytes[2] = "2".charCodeAt(0);
    });
    expect(await request.text()).toBe("a=2");
  });

  test("DataView", async () => {
    const bytes = new TextEncoder().encode("a=1");
    const request = requestWithMutatingGetter(new DataView(bytes.buffer), () => {
      bytes[2] = "2".charCodeAt(0);
    });
    expect(await request.text()).toBe("a=2");
  });

  test("DataView with a byte offset", async () => {
    const bytes = new TextEncoder().encode("xa=1y");
    const request = requestWithMutatingGetter(new DataView(bytes.buffer, 1, 3), () => {
      bytes[3] = "2".charCodeAt(0);
    });
    expect(await request.text()).toBe("a=2");
  });

  test("a detached Uint8Array is empty", async () => {
    const bytes = new TextEncoder().encode("a=1");
    const request = requestWithMutatingGetter(bytes, () => {
      structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
    });
    expect(await request.text()).toBe("");
  });

  test("an Array of parts", async () => {
    const bytes = new TextEncoder().encode("a=1");
    const request = requestWithMutatingGetter([bytes] as unknown as BodyInit, () => {
      bytes[2] = "2".charCodeAt(0);
    });
    expect(await request.text()).toBe("a=2");
  });

  test("headers getter", async () => {
    const params = new URLSearchParams("a=1");
    const request = new Request("https://example.com/", {
      body: params,
      get headers() {
        params.append("b", "2");
        return { "x-test": "1" };
      },
    });
    expect(request.headers.get("x-test")).toBe("1");
    expect(await request.text()).toBe("a=1&b=2");
  });

  test("an object body is converted to a string when `body` is read", async () => {
    let text = "a=1";
    const request = new Request("https://example.com/", {
      body: { toString: () => text } as unknown as BodyInit,
      get method() {
        text = "mutated";
        return "POST";
      },
    });
    expect(await request.text()).toBe("a=1");
  });

  test("init body still overrides the input request body", async () => {
    const input = new Request("https://example.com/", { method: "POST", body: "old" });
    const params = new URLSearchParams("a=1");
    const request = new Request(input, {
      body: params,
      get redirect() {
        params.append("b", "2");
        return "manual" as const;
      },
    });
    expect(request.redirect).toBe("manual");
    expect(await request.text()).toBe("a=1&b=2");
    expect(await input.text()).toBe("old");
  });

  test("keepalive with a ReadableStream body throws after the other members are read", () => {
    let methodReads = 0;
    expect(
      () =>
        new Request("https://example.com/", {
          get method() {
            methodReads++;
            return "POST";
          },
          body: new ReadableStream(),
          keepalive: true,
        }),
    ).toThrow("keepalive");
    expect(methodReads).toBe(1);
  });

  test("an invalid URL throws before the body is extracted", () => {
    expect(() => new Request("not a url", { method: "POST", body: new ReadableStream(), keepalive: true })).toThrow(
      `Failed to construct 'Request': Invalid URL "not a url"`,
    );
  });

  test("an invalid header throws before a locked stream body is checked", () => {
    const stream = new ReadableStream();
    stream.getReader();
    expect(
      () => new Request("https://example.com/", { method: "POST", body: stream, headers: { "a b": "1" } }),
    ).toThrow("Invalid header name: 'a b'");
  });
});
