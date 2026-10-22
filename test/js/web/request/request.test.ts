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

// https://fetch.spec.whatwg.org/#dom-request: a method is any RFC 9110 token.
describe("Request method", () => {
  const url = "http://example.com/";

  // https://fetch.spec.whatwg.org/#concept-method-normalize
  test("DELETE, GET, HEAD, OPTIONS, POST and PUT are normalized from any case", () => {
    const methods = ["Delete", "gEt", "hEaD", "oPtIoNs", "pOsT", "Put"];
    expect(methods.map(method => new Request(url, { method }).method)).toEqual([
      "DELETE",
      "GET",
      "HEAD",
      "OPTIONS",
      "POST",
      "PUT",
    ]);
  });

  const tokens = ["PatCh", "Propfind", "BREW", "LIST", "M-search", "!#$%&'*+-.^_`|~09AZaz"];

  test.each(tokens)("every other token is the method as written: %p", method => {
    const request = new Request(url, { method });
    expect({
      method: request.method,
      again: request.method,
      clone: request.clone().method,
      cloneOfClone: request.clone().clone().method,
      copy: new Request(request).method,
      copyWithInit: new Request(request, { headers: { a: "b" } }).method,
      asInit: new Request(url, request).method,
      fromObject: new Request({ url, method } as any).method,
      overDelete: new Request(new Request(url, { method: "DELETE" }), { method }).method,
      replaced: new Request(request, { method: "Put" }).method,
    }).toEqual({
      method,
      again: method,
      clone: method,
      cloneOfClone: method,
      copy: method,
      copyWithInit: method,
      asInit: method,
      fromObject: method,
      overDelete: method,
      replaced: "PUT",
    });
  });

  // WebIDL converts the member to a string. `false` is what `cond && "POST"` gives.
  test.each([
    [false, "false"],
    [0, "0"],
    [NaN, "NaN"],
    [0n, "0"],
    [123, "123"],
  ])("a method that is not a string is converted to one: %p", (method, expected) => {
    expect(new Request(url, { method } as any).method).toBe(expected);
  });

  test("console.log shows a token", () => {
    expect(Bun.inspect(new Request(url, { method: "BREW" }))).toContain('method: "BREW"');
  });

  test("a token outlives the Request it was cloned from", () => {
    let request = new Request(url, { method: "BREW" });
    for (let i = 0; i < 64; i++) {
      request = i % 2 ? request.clone() : new Request(request);
    }
    Bun.gc(true);
    expect(request.method).toBe("BREW");
  });

  const construct: [string, (method: any) => Request][] = [
    ["new Request(url, { method })", method => new Request(url, { method })],
    ["new Request(request, { method })", method => new Request(new Request(url, { method: "DELETE" }), { method })],
    ["new Request({ url, method })", method => new Request({ url, method } as any)],
  ];

  const notTokens: [method: unknown, asString: string][] = [
    ["GET POST", "GET POST"],
    [" GET", " GET"],
    ["GET ", "GET "],
    ["GET\r\nX-Injected: 1", "GET\r\nX-Injected: 1"],
    ["G\0T", "G\0T"],
    ["caf\u00e9", "caf\u00e9"],
    ["\u0100", "\u0100"],
    ["(GET)", "(GET)"],
    ["GET/1", "GET/1"],
    [[], ""],
    [{}, "[object Object]"],
    [new String(""), ""],
  ];

  describe.each(construct)("%s", (_, construct) => {
    test.each(notTokens)("throws a TypeError for a method that is not a token: %p", (method, asString) => {
      expect(() => construct(method)).toThrow(
        expect.objectContaining({
          name: "TypeError",
          code: "ERR_INVALID_ARG_VALUE",
          message: `${JSON.stringify(asString)} is not a valid HTTP method.`,
        }),
      );
    });

    // https://fetch.spec.whatwg.org/#forbidden-method. Bun's table holds CONNECT
    // and TRACE in all-upper and all-lower case. Those two spellings stay accepted.
    test.each(["TRACK", "track", "tRaCk", "Trace", "Connect"])("throws a TypeError for %p", method => {
      expect(() => construct(method)).toThrow(
        expect.objectContaining({
          name: "TypeError",
          code: "ERR_INVALID_ARG_VALUE",
          message: `${JSON.stringify(method)} HTTP method is unsupported.`,
        }),
      );
    });
  });

  test("undefined, null and the empty string name no method", () => {
    expect([undefined, null, ""].map(method => new Request(url, { method } as any).method)).toEqual([
      "GET",
      "GET",
      "GET",
    ]);
  });

  test("a method of the table keeps its treatment", () => {
    // All-lower spellings are upper-cased, and CONNECT and TRACE are accepted.
    const methods = ["patch", "propfind", "m-search", "CONNECT", "connect", "TRACE", "trace"];
    expect(methods.map(method => new Request(url, { method }).method)).toEqual([
      "PATCH",
      "PROPFIND",
      "M-SEARCH",
      "CONNECT",
      "CONNECT",
      "TRACE",
      "TRACE",
    ]);
  });

  test("a Response does not give a Request a method", () => {
    // A ResponseInit has no `method`. One with it must still construct.
    const response = new Response("", { method: "POST" } as any);
    const invalid = new Response("", { method: "GET POST" } as any);
    expect({
      response: new Request(url, response).method,
      invalid: new Request(url, invalid).method,
      fromRequest: new Request(url, new Response("", new Request(url, { method: "BREW" }) as any)).method,
    }).toEqual({ response: "GET", invalid: "GET", fromRequest: "GET" });
  });
});
