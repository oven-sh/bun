import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
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

// The Fetch standard copies the request of the input: https://fetch.spec.whatwg.org/#dom-request
// A property of the input can be the program's own, so the copy reads none.
describe("new Request(input, init) with a Request or a Response as the input", () => {
  const real = "http://example.com/real";
  const seenOf = async (request: Request) => ({
    url: request.url,
    method: request.method,
    headers: [...request.headers],
    text: await request.text(),
  });

  test("a body that is null stays null, and an empty body is the stream of the input", async () => {
    const withoutBody = new Request(real, { method: "POST" });
    const copyWithoutBody = new Request(withoutBody, {});
    const withEmptyBody = new Request(real, { method: "POST", body: "" });
    const copyOfEmptyBody = new Request(withEmptyBody, {});
    expect({
      withoutBody: [copyWithoutBody.body, await copyWithoutBody.text(), withoutBody.bodyUsed],
      withEmptyBody: [await copyOfEmptyBody.text(), withEmptyBody.bodyUsed],
    }).toEqual({ withoutBody: [null, "", false], withEmptyBody: ["", true] });
  });

  test("an input whose body is used needs a body in init", async () => {
    const input = new Request(real, { method: "POST", body: "x" });
    await input.text();
    expect(() => new Request(input, {})).toThrow(new TypeError("Body object should not be disturbed or locked"));
    expect(await new Request(input, { body: "y" }).text()).toBe("y");
  });

  test("the copy has the signal of the input, and one of its own where the input has none", () => {
    const controller = new AbortController();
    const input = new Request(real, { signal: controller.signal });
    const copy = new Request(input, {});
    controller.abort();
    expect({ same: copy.signal === input.signal, aborted: copy.signal.aborted }).toEqual({ same: true, aborted: true });

    // As after `new Request(input)`, and as in Node.js.
    const withoutSignal = new Request(real);
    expect(new Request(withoutSignal, {}).signal).not.toBe(withoutSignal.signal);
  });

  test("copies the url of a request of Bun.serve before and after the handler awaits", async () => {
    const urls: string[] = [];
    await using server = Bun.serve({
      port: 0,
      async fetch(request) {
        urls.push(new Request(request, { headers: { a: "1" } }).url);
        await new Promise(resolve => setImmediate(resolve));
        urls.push(new Request(request, { headers: { a: "1" } }).url);
        return new Response("ok");
      },
    });
    const href = new URL("/path?query=1", server.url).href;
    expect(await (await fetch(href)).text()).toBe("ok");
    expect(urls).toEqual([href, href]);
  });

  // `init.url` and a Response as the input are Bun's own.
  test("init, and a Request or a Response in the place of init, are read as any other object", async () => {
    const a = () => new Request("http://example.com/a", { method: "POST", headers: { a: "1" } });
    const b = () => new Request("http://example.com/b", { method: "PUT", headers: { b: "2" } });
    expect({
      "init.url": new Request(a(), { url: "http://example.com/other" } as RequestInit).url,
      "(a, b)": await seenOf(new Request(a(), b())),
      "(url, response)": await seenOf(new Request(real, new Response("x", { headers: { a: "1" } }) as RequestInit)),
    }).toEqual({
      "init.url": "http://example.com/other",
      "(a, b)": { url: "http://example.com/b", method: "PUT", headers: [["b", "2"]], text: "" },
      "(url, response)": { url: real, method: "GET", headers: [["a", "1"]], text: "x" },
    });
  });

  test("a Response as the input gives its method, headers and body", async () => {
    const copy = (response: Response, init?: object) => new Request(response as any, init as RequestInit);
    expect({
      "with a body": await seenOf(copy(new Response("x", { headers: { a: "1" } }), { url: real, method: "POST" })),
      "with an empty body": await seenOf(copy(new Response(""), { url: real, method: "POST" })),
      "without a body": await seenOf(copy(new Response(null), { url: real })),
    }).toEqual({
      "with a body": { url: real, method: "POST", headers: [["a", "1"]], text: "x" },
      "with an empty body": { url: real, method: "POST", headers: [], text: "" },
      "without a body": { url: real, method: "GET", headers: [], text: "" },
    });
    expect(() => copy(new Response("x"))).toThrow("url is required");
  });

  // A case changes prototypes that the test runner itself uses, so it runs in a process of its own.
  async function seenBy(script: string) {
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { seen: stdout.startsWith("{") ? JSON.parse(stdout) : stdout, stderr, exitCode };
  }

  test.concurrent("a name that a program adds to the prototype is not read", async () => {
    const script = `
      const attempt = work => {
        try {
          return work();
        } catch (error) {
          return error.name + ": " + error.message;
        }
      };
      const url = Object.getOwnPropertyDescriptor(Request.prototype, "url").get;
      const real = ${JSON.stringify(real)};
      const seen = {};

      Object.defineProperty(Request.prototype, "keepalive", { get: () => true, configurable: true });
      seen.keepalive = attempt(() => url.call(new Request(new Request(real, { method: "POST", body: "" }), {})));
      delete Request.prototype.keepalive;

      // Every name that neither the input nor its prototype has arrives here.
      const missed = [];
      const behind = new Proxy(Object.create(null), { get: (target, key) => void missed.push(String(key)) });
      Object.setPrototypeOf(Request.prototype, behind);
      Object.setPrototypeOf(Response.prototype, behind);
      const copies = {
        "(request, {})": () => new Request(new Request(real, { method: "POST" }), {}),
        "(request with an empty body, {})": () => new Request(new Request(real, { method: "POST", body: "" }), {}),
        "(response, { url })": () => new Request(new Response("x"), { url: real }),
        "(response with an empty body, { url })": () => new Request(new Response(""), { url: real }),
        "(response)": () => new Request(new Response(null)),
      };
      for (const [name, copy] of Object.entries(copies)) {
        missed.length = 0;
        const copied = attempt(copy);
        seen[name] = [typeof copied === "string" ? copied : url.call(copied), ...missed];
      }
      console.log(JSON.stringify(seen));
    `;
    expect(await seenBy(script)).toEqual({
      seen: {
        keepalive: real,
        "(request, {})": [real],
        "(request with an empty body, {})": [real],
        "(response, { url })": [real],
        "(response with an empty body, { url })": [real],
        "(response)": ["Error: Failed to construct 'Request': url is required."],
      },
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("a spy on a getter of Request.prototype is not called", async () => {
    const script = `
      import { spyOn } from "bun:test";
      const real = ${JSON.stringify(real)};
      const mocked = { url: () => "http://example.com/mock", signal: () => AbortSignal.abort(), body: () => "mock" };
      const seen = {};
      for (const name of Object.keys(mocked)) {
        const input = new Request(real, { method: "POST" });
        const spy = spyOn(Request.prototype, name, "get").mockImplementation(mocked[name]);
        const copy = new Request(input, {});
        const calls = spy.mock.calls.length;
        spy.mockRestore();
        seen[name] = { url: copy.url, aborted: copy.signal.aborted, body: copy.body, calls };
      }
      console.log(JSON.stringify(seen));
    `;
    const ofTheInput = { url: real, aborted: false, body: null, calls: 0 };
    expect(await seenBy(script)).toEqual({
      seen: { url: ofTheInput, signal: ofTheInput, body: ofTheInput },
      stderr: "",
      exitCode: 0,
    });
  });
});
