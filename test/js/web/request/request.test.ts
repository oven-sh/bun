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

describe("Request integrity", () => {
  const url = "https://example.com/";

  test("the getter returns the init member, or the empty string when there is none", () => {
    expect([
      new Request(url).integrity,
      new Request(url, {}).integrity,
      new Request(url, { integrity: undefined }).integrity,
      new Request(url, { integrity: "" }).integrity,
      new Request(url, { integrity: "sha256-abc" }).integrity,
      // The string is kept as it is given: it is parsed when the request is fetched.
      new Request(url, { integrity: "  sha256-abc\tmd5-x " }).integrity,
    ]).toEqual(["", "", "", "", "sha256-abc", "  sha256-abc\tmd5-x "]);
  });

  test("it is a DOMString: every value but undefined is converted to a string", () => {
    const values = [null, 123, true, { toString: () => "sha256-abc" }, ["a", "b"]];
    expect(values.map(integrity => new Request(url, { integrity: integrity as any }).integrity)).toEqual([
      "null",
      "123",
      "true",
      "sha256-abc",
      "a,b",
    ]);
    expect(() => new Request(url, { integrity: Symbol("x") as any })).toThrow(TypeError);
  });

  test("a Request that is the input gives its integrity, and the init replaces it", () => {
    class SubclassedRequest extends Request {}
    const input = new Request(url, { integrity: "sha256-abc" });
    const subclassed = new SubclassedRequest(url, { integrity: "sha256-abc" });
    expect({
      copy: new Request(input).integrity,
      withEmptyInit: new Request(input, {}).integrity,
      withUndefined: new Request(input, { integrity: undefined }).integrity,
      replaced: new Request(input, { integrity: "sha512-def" }).integrity,
      cleared: new Request(input, { integrity: "" }).integrity,
      clone: input.clone().integrity,
      cloneOfCopy: new Request(input).clone().integrity,
      subclass: subclassed.integrity,
      copyOfSubclass: new Request(subclassed).integrity,
      subclassOfCopy: new SubclassedRequest(input).integrity,
      fromPlainObject: new Request({ url, integrity: "sha256-abc" } as any).integrity,
      input: input.integrity,
    }).toEqual({
      copy: "sha256-abc",
      withEmptyInit: "sha256-abc",
      withUndefined: "sha256-abc",
      replaced: "sha512-def",
      cleared: "",
      clone: "sha256-abc",
      cloneOfCopy: "sha256-abc",
      subclass: "sha256-abc",
      copyOfSubclass: "sha256-abc",
      subclassOfCopy: "sha256-abc",
      fromPlainObject: "sha256-abc",
      input: "sha256-abc",
    });
  });

  test("a property of a Request that is the input does not replace what the Request stores", () => {
    let getterReads = 0;
    class GetterRequest extends Request {
      get integrity() {
        getterReads++;
        return "sha512-from-the-getter";
      }
    }
    const withGetter = new GetterRequest(url, { integrity: "sha256-abc" });
    const withOwnProperty = Object.defineProperty(new Request(url, { integrity: "sha256-abc" }), "integrity", {
      value: "",
    });
    expect({
      copyOfGetter: new Request(withGetter).integrity,
      copyOfGetterWithInit: new Request(withGetter, {}).integrity,
      cloneOfGetter: Object.getOwnPropertyDescriptor(Request.prototype, "integrity")!.get!.call(withGetter.clone()),
      copyOfOwnProperty: new Request(withOwnProperty).integrity,
      copyOfOwnPropertyWithInit: new Request(withOwnProperty, { method: "POST" }).integrity,
      getterReads,
      // As the init, a Request is a dictionary like every other object: its properties are read.
      getterAsInit: new Request(url, withGetter).integrity,
      ownPropertyAsInit: new Request(url, withOwnProperty).integrity,
    }).toEqual({
      copyOfGetter: "sha256-abc",
      copyOfGetterWithInit: "sha256-abc",
      cloneOfGetter: "sha256-abc",
      copyOfOwnProperty: "sha256-abc",
      copyOfOwnPropertyWithInit: "sha256-abc",
      getterReads: 0,
      getterAsInit: "sha512-from-the-getter",
      ownPropertyAsInit: "",
    });
  });

  test("the init's integrity is read once, before its other members", () => {
    const keys: string[] = [];
    const init = new Proxy(
      {},
      {
        get(_, key) {
          if (typeof key === "string") keys.push(key);
          return undefined;
        },
      },
    );
    expect(new Request(url, init).integrity).toBe("");
    expect({ first: keys[0], reads: keys.filter(key => key === "integrity").length }).toEqual({
      first: "integrity",
      reads: 1,
    });
  });

  test("a throwing getter or toString() makes the constructor throw that error", () => {
    const boom = (message: string): string => {
      throw new Error(message);
    };
    expect(
      () =>
        new Request(url, {
          get integrity() {
            return boom("from the getter");
          },
        }),
    ).toThrow("from the getter");
    expect(() => new Request(url, { integrity: { toString: () => boom("from toString()") } as any })).toThrow(
      "from toString()",
    );
  });

  test("it has no setter", () => {
    const request = new Request(url, { integrity: "sha256-abc" });
    expect(() => {
      (request as any).integrity = "sha512-def";
    }).toThrow(TypeError);
    expect(request.integrity).toBe("sha256-abc");
  });
});
