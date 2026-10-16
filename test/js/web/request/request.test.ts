import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { Request as NodeFetchRequest } from "node-fetch";
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

describe("Request.signal is the Request's own signal", () => {
  const url = "http://example.com/";
  class SubRequest extends Request {}

  const forms: [string, (signal: AbortSignal) => Request][] = [
    ["new Request(url, { signal })", signal => new Request(url, { signal })],
    ["new Request(URL, { signal })", signal => new Request(new URL(url), { signal })],
    ["new Request({ url, signal })", signal => new Request({ url, signal } as any)],
    ["new Request(request)", signal => new Request(new Request(url, { signal }))],
    ["new Request(request, {})", signal => new Request(new Request(url, { signal }), {})],
    [
      "new Request(request, { signal: undefined })",
      signal => new Request(new Request(url, { signal }), { signal: undefined }),
    ],
    [
      "new Request(other, { signal })",
      signal => new Request(new Request(url, { signal: new AbortController().signal }), { signal }),
    ],
    ["new Request(url, request)", signal => new Request(url, new Request(url, { signal }))],
    ["request.clone()", signal => new Request(url, { signal }).clone()],
    ["request.clone().clone()", signal => new Request(url, { signal }).clone().clone()],
    ["new Subclass(url, { signal })", signal => new SubRequest(url, { signal })],
    ["new Request(subclassInstance, {})", signal => new Request(new SubRequest(url, { signal }), {})],
    ["subclassInstance.clone()", signal => new SubRequest(url, { signal }).clone()],
    ["node-fetch's Request", signal => new NodeFetchRequest(url, { signal }) as unknown as Request],
  ];

  describe.each(forms)("%s", (_, make) => {
    test("keeps its handlers apart from the caller's and aborts with the caller's reason", () => {
      const controller = new AbortController();
      const calls: string[] = [];
      controller.signal.onabort = () => calls.push("caller");
      const request = make(controller.signal);
      const own = request.signal;
      own.onabort = () => calls.push("request");
      const reason = new Error("stop");
      controller.abort(reason);
      expect({
        isOwnSignal: own !== controller.signal,
        sameOnEveryRead: request.signal === own,
        calls,
        aborted: own.aborted,
        hasCallersReason: own.reason === reason,
      }).toEqual({
        isOwnSignal: true,
        sameOnEveryRead: true,
        calls: ["caller", "request"],
        aborted: true,
        hasCallersReason: true,
      });
    });

    test("is born aborted, with the same reason, from a signal that already aborted", () => {
      const controller = new AbortController();
      controller.abort();
      const request = make(controller.signal);
      expect({
        isOwnSignal: request.signal !== controller.signal,
        aborted: request.signal.aborted,
        reasonName: request.signal.reason?.name,
        hasCallersReason: request.signal.reason === controller.signal.reason,
      }).toEqual({ isOwnSignal: true, aborted: true, reasonName: "AbortError", hasCallersReason: true });
    });

    test("is aborted, with the caller's reason, when .signal is first read after the abort", () => {
      const controller = new AbortController();
      const request = make(controller.signal);
      const reason = new Error("stop");
      controller.abort(reason);
      expect({
        isOwnSignal: request.signal !== controller.signal,
        aborted: request.signal.aborted,
        hasCallersReason: request.signal.reason === reason,
      }).toEqual({ isOwnSignal: true, aborted: true, hasCallersReason: true });
    });
  });

  test("two Requests on one signal do not share a handler", () => {
    const controller = new AbortController();
    const first = new Request(url, { signal: controller.signal });
    const second = new Request(url, { signal: controller.signal });
    const calls: string[] = [];
    first.signal.onabort = () => calls.push("first");
    second.signal.onabort = () => calls.push("second");
    controller.abort();
    expect(calls).toEqual(["first", "second"]);
  });

  test("a Request and its clone do not share a handler", () => {
    const controller = new AbortController();
    const request = new Request(url, { signal: controller.signal });
    const clone = request.clone();
    const calls: string[] = [];
    request.signal.onabort = () => calls.push("request");
    clone.signal.onabort = () => calls.push("clone");
    controller.abort();
    expect(calls).toEqual(["request", "clone"]);
  });

  test("the caller's listeners run before the Request's", () => {
    const controller = new AbortController();
    const request = new Request(url, { signal: controller.signal });
    const calls: string[] = [];
    request.signal.addEventListener("abort", () => calls.push("request"));
    controller.signal.addEventListener("abort", () => calls.push("caller"));
    controller.abort();
    expect(calls).toEqual(["caller", "request"]);
  });

  test("a listener added to the Request's signal while the caller's listeners run still fires", () => {
    const controller = new AbortController();
    const request = new Request(url, { signal: controller.signal });
    const own = request.signal;
    const calls: string[] = [];
    controller.signal.addEventListener("abort", () => {
      own.addEventListener("abort", () => calls.push("added late"));
    });
    controller.abort();
    expect(calls).toEqual(["added late"]);
  });

  test("a copy does not share the default signal of a Request that was given none", () => {
    const original = new Request(url);
    const originalSignal = original.signal;
    expect({
      copy: new Request(original, {}).signal === originalSignal,
      clone: original.clone().signal === originalSignal,
      unchanged: original.signal === originalSignal,
    }).toEqual({ copy: false, clone: false, unchanged: true });
  });

  test("a Request creates no AbortSignal until .signal is read", () => {
    const controller = new AbortController();
    const withSignal = new Request(url, { signal: controller.signal });
    const plain = new Request(url);
    const plainSignal = plain.signal;
    Bun.gc(true);
    const before = heapStats().objectTypeCounts.AbortSignal ?? 0;
    const derived: Request[] = [];
    for (let i = 0; i < 100; i++) {
      derived.push(
        new Request(url, { signal: controller.signal }),
        withSignal.clone(),
        new Request(withSignal),
        new Request(withSignal, {}),
        plain.clone(),
        new Request(plain),
        new Request(plain, {}),
      );
    }
    const created = (heapStats().objectTypeCounts.AbortSignal ?? 0) - before;
    const signals = new Set(derived.map(request => request.signal));
    expect({
      created: created < 10 ? "none" : created,
      distinctSignals: signals.size,
      shared: signals.has(controller.signal) || signals.has(plainSignal),
    }).toEqual({ created: "none", distinctSignals: derived.length, shared: false });
  });

  test("{ signal: other } follows only the other signal", () => {
    const first = new AbortController();
    const other = new AbortController();
    const request = new Request(new Request(url, { signal: first.signal }), { signal: other.signal });
    first.abort();
    const afterFirst = request.signal.aborted;
    other.abort();
    expect({ afterFirst, afterOther: request.signal.aborted }).toEqual({ afterFirst: false, afterOther: true });
  });

  test("follows AbortSignal.timeout()", async () => {
    const source = AbortSignal.timeout(1);
    const request = new Request(url, { signal: source });
    const { promise, resolve } = Promise.withResolvers<void>();
    request.signal.addEventListener("abort", () => resolve());
    await promise;
    expect({
      isOwnSignal: request.signal !== source,
      reasonName: request.signal.reason.name,
      hasSourcesReason: request.signal.reason === source.reason,
    }).toEqual({ isOwnSignal: true, reasonName: "TimeoutError", hasSourcesReason: true });
  });

  describe.each([
    [
      "fetch(request), .signal not read",
      (target: string, signal: AbortSignal) => fetch(new Request(target, { signal })),
    ],
    [
      "fetch(request), .signal read",
      (target: string, signal: AbortSignal) => {
        const request = new Request(target, { signal });
        request.signal;
        return fetch(request);
      },
    ],
    ["fetch(url, request)", (target: string, signal: AbortSignal) => fetch(target, new Request(target, { signal }))],
    ["fetch(subclassInstance)", (target: string, signal: AbortSignal) => fetch(new SubRequest(target, { signal }))],
  ])("%s", (_, start) => {
    test("rejects with the caller's reason when the caller aborts", async () => {
      const { promise: requested, resolve: onRequest } = Promise.withResolvers<void>();
      await using server = Bun.serve({
        port: 0,
        fetch() {
          onRequest();
          return new Promise<Response>(() => {});
        },
      });
      const controller = new AbortController();
      const response = start(server.url.href, controller.signal);
      await requested;
      const reason = new Error("stop");
      controller.abort(reason);
      expect(
        await response.then(
          () => "resolved",
          e => e,
        ),
      ).toBe(reason);
    });
  });

  test("fetch(url, request) and fetch(subclassInstance) create no AbortSignal on the Request", async () => {
    await using server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
    const controller = new AbortController();
    const init = new Request(server.url, { signal: controller.signal });
    const subclassInstance = new SubRequest(server.url, { signal: controller.signal });
    Bun.gc(true);
    const before = heapStats().objectTypeCounts.AbortSignal ?? 0;
    for (let i = 0; i < 20; i++) {
      await (await fetch(server.url, init)).text();
      await (await fetch(subclassInstance)).text();
    }
    const created = (heapStats().objectTypeCounts.AbortSignal ?? 0) - before;
    expect({ created, isOwnSignal: init.signal !== controller.signal }).toEqual({ created: 0, isOwnSignal: true });
  });
});

// The Request subtests of WPT fetch/api/abort/general.any.js, with the harness calls kept.
// The URLs are absolute here: every fetch in them rejects before a connection is made.
describe("WPT fetch/api/abort/general.any.js: Request", () => {
  const assert_true = (actual: unknown, description?: string) => expect(actual, description).toBe(true);
  const assert_equals = (actual: unknown, expected: unknown, description?: string) =>
    expect(actual, description).toBe(expected);
  const assert_not_equals = (actual: unknown, expected: unknown, description?: string) =>
    expect(actual, description).not.toBe(expected);
  const assert_array_equals = (actual: unknown[], expected: unknown[], description?: string) =>
    expect(actual, description).toEqual(expected);
  const promise_rejects_dom = async (_t: unknown, name: string, promise: Promise<unknown>) => {
    const error = await promise.then(
      () => undefined,
      e => e,
    );
    expect(error).toBeInstanceOf(DOMException);
    expect(error.name).toBe(name);
  };
  const promise_rejects_exactly = async (
    _t: unknown,
    expected: unknown,
    promise: Promise<unknown>,
    description?: string,
  ) =>
    expect(
      await promise.then(
        () => undefined,
        e => e,
      ),
      description,
    ).toBe(expected);
  const t = undefined;
  const dataUrl = "http://127.0.0.1:1/resources/data.json";

  const error1 = new Error("error1");
  error1.name = "error1";

  test("Request objects have a signal property", () => {
    const request = new Request(dataUrl);
    assert_true(Boolean(request.signal), "Signal member is present & truthy");
    assert_equals(request.signal.constructor, AbortSignal);
  });

  test("Signal on request object", async () => {
    const controller = new AbortController();
    const signal = controller.signal;
    controller.abort();

    const request = new Request(dataUrl, { signal });

    assert_true(Boolean(request.signal), "Signal member is present & truthy");
    assert_equals(request.signal.constructor, AbortSignal);
    assert_not_equals(request.signal, signal, "Request has a new signal, not a reference");
    assert_true(request.signal.aborted, `Request's signal has aborted`);

    const fetchPromise = fetch(request);

    await promise_rejects_dom(t, "AbortError", fetchPromise);
  });

  test("Signal on request object should also have abort reason", async () => {
    const controller = new AbortController();
    const signal = controller.signal;
    controller.abort(error1);

    const request = new Request(dataUrl, { signal });

    assert_not_equals(request.signal, signal, "Request has a new signal, not a reference");
    assert_true(request.signal.aborted, `Request's signal has aborted`);
    assert_equals(request.signal.reason, error1, `Request's signal's abort reason is error1`);

    const fetchPromise = fetch(request);

    await promise_rejects_exactly(t, error1, fetchPromise, "fetch() should reject with abort reason");
  });

  test("Signal on request object created from request object", async () => {
    const controller = new AbortController();
    const signal = controller.signal;
    controller.abort();

    const request = new Request(dataUrl, { signal });
    const requestFromRequest = new Request(request);

    const fetchPromise = fetch(requestFromRequest);

    await promise_rejects_dom(t, "AbortError", fetchPromise);
  });

  test("Signal on request object created from request object, with signal on second request", async () => {
    const controller = new AbortController();
    const signal = controller.signal;
    controller.abort();

    const request = new Request(dataUrl);
    const requestFromRequest = new Request(request, { signal });

    const fetchPromise = fetch(requestFromRequest);

    await promise_rejects_dom(t, "AbortError", fetchPromise);
  });

  test("Signal on request object created from request object, with signal on second request overriding another", async () => {
    const controller = new AbortController();
    const signal = controller.signal;
    controller.abort();

    const request = new Request(dataUrl, { signal: new AbortController().signal });
    const requestFromRequest = new Request(request, { signal });

    const fetchPromise = fetch(requestFromRequest);

    await promise_rejects_dom(t, "AbortError", fetchPromise);
  });

  test("Signal state is cloned", () => {
    const controller = new AbortController();
    const signal = controller.signal;
    controller.abort();

    const request = new Request(dataUrl, { signal });
    const requestSignal = request.signal;

    const clonedRequest = request.clone();

    assert_equals(requestSignal, request.signal, "Original request signal the same after cloning");
    assert_true(request.signal.aborted, "Original request signal aborted");
    assert_not_equals(clonedRequest.signal, request.signal, "Cloned request has different signal");
    assert_true(clonedRequest.signal.aborted, "Cloned request signal aborted");
  });

  test("Clone aborts with original controller", () => {
    const controller = new AbortController();
    const signal = controller.signal;

    const request = new Request(dataUrl, { signal });
    const clonedRequest = request.clone();

    const log: string[] = [];

    request.signal.addEventListener("abort", () => log.push("original-aborted"));
    clonedRequest.signal.addEventListener("abort", () => log.push("clone-aborted"));

    controller.abort();

    assert_array_equals(log, ["original-aborted", "clone-aborted"], "Abort events fired in correct order");
    assert_true(request.signal.aborted, "Signal aborted");
    assert_true(clonedRequest.signal.aborted, "Signal aborted");
  });
});

describe.concurrent("Request.signal and the garbage collector", () => {
  // Debug and ASAN builds run these loops 10 to 100 times slower.
  const slow = isDebug || isASAN;

  async function run(script: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode };
  }

  test("a Request keeps the abort reason after the caller's controller is collected", async () => {
    const iterations = slow ? 40 : 2000;
    const { stdout, stderr, exitCode } = await run(`
      const url = "http://example.com/";
      const orders = {
        "aborted before the Request exists": i => {
          const controller = new AbortController();
          controller.abort(new Error("reason " + i));
          return new Request(url, { signal: controller.signal });
        },
        "aborted after, .signal not read": i => {
          const controller = new AbortController();
          const request = new Request(url, { signal: controller.signal });
          controller.abort(new Error("reason " + i));
          return request;
        },
        "aborted after, .signal read": i => {
          const controller = new AbortController();
          const request = new Request(url, { signal: controller.signal });
          request.signal;
          controller.abort(new Error("reason " + i));
          return request;
        },
        "clone": i => {
          const controller = new AbortController();
          const request = new Request(url, { signal: controller.signal }).clone();
          controller.abort(new Error("reason " + i));
          return request;
        },
        "copy": i => {
          const controller = new AbortController();
          const request = new Request(new Request(url, { signal: controller.signal }));
          controller.abort(new Error("reason " + i));
          return request;
        },
        "AbortSignal.abort(reason)": i => new Request(url, { signal: AbortSignal.abort(new Error("reason " + i)) }),
      };
      const kept = {};
      for (const name in orders) {
        kept[name] = [];
        for (let i = 0; i < ${iterations}; i++) kept[name].push(orders[name](i));
      }
      Bun.gc(true);
      Bun.gc(true);
      const lost = {};
      for (const name in kept) {
        lost[name] = kept[name].filter((request, i) => request.signal.reason?.message !== "reason " + i).length;
      }
      console.log(JSON.stringify(lost));
    `);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      "aborted before the Request exists": 0,
      "aborted after, .signal not read": 0,
      "aborted after, .signal read": 0,
      "clone": 0,
      "copy": 0,
      "AbortSignal.abort(reason)": 0,
    });
    expect(exitCode).toBe(0);
  });

  test("the signal of a dropped Request still runs its listener and its abort algorithm", async () => {
    const iterations = slow ? 50 : 500;
    const { stdout, stderr, exitCode } = await run(`
      const url = "http://example.com/";
      const controller = new AbortController();
      const target = new EventTarget();
      let fired = 0;
      let stray = 0;
      let timedOut = 0;
      (function () {
        for (let i = 0; i < ${iterations}; i++) {
          new Request(url, { signal: controller.signal }).signal.addEventListener("abort", () => fired++);
          const signal = new Request(url, { signal: controller.signal }).signal;
          target.addEventListener("ping", () => stray++, { signal });
          new Request(url, { signal: AbortSignal.timeout(1) }).signal.addEventListener("abort", () => timedOut++);
        }
      })();
      Bun.gc(true);
      Bun.gc(true);
      controller.abort();
      target.dispatchEvent(new Event("ping"));
      // Armed after the 1 ms timeouts, so it fires after all of them.
      await new Promise(resolve => AbortSignal.timeout(20).addEventListener("abort", resolve));
      console.log(JSON.stringify({ fired, stray, timedOut }));
    `);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ fired: iterations, stray: 0, timedOut: iterations });
    expect(exitCode).toBe(0);
  });

  test("a listener on request.signal keeps neither the controller nor a sibling Request that it reaches", async () => {
    const iterations = slow ? 50 : 500;
    const { stdout, stderr, exitCode } = await run(`
      const { heapStats } = require("bun:jsc");
      const url = "http://example.com/";
      (function () {
        for (let i = 0; i < ${iterations}; i++) {
          const controller = new AbortController();
          const request = new Request(url, { signal: controller.signal });
          const sibling = request.clone();
          request.signal.addEventListener("abort", () => [controller, sibling]);
        }
      })();
      Bun.gc(true);
      Bun.gc(true);
      Bun.gc(true);
      const { AbortController: controllers = 0, Request: requests = 0 } = heapStats().objectTypeCounts;
      console.log(JSON.stringify({ controllers, requests }));
    `);
    expect(stderr).toBe("");
    const { controllers, requests } = JSON.parse(stdout);
    expect(controllers).toBeLessThanOrEqual(iterations / 10);
    expect(requests).toBeLessThanOrEqual(iterations / 10);
    expect(exitCode).toBe(0);
  });

  test.each(["new Request(req, init).signal", "req.clone().signal"])(
    "a listener on %s does not keep a finished Bun.serve request",
    async derive => {
      const iterations = slow ? 40 : 300;
      const { stdout, stderr, exitCode } = await run(`
        const { heapStats } = require("bun:jsc");
        const init = { method: "POST" };
        const server = Bun.serve({
          port: 0,
          fetch(req) {
            const signal = ${derive};
            signal.addEventListener("abort", () => req);
            return new Response("ok");
          },
        });
        for (let i = 0; i < ${iterations}; i++) await (await fetch(server.url)).text();
        await server.stop(true);
        Bun.gc(true);
        await new Promise(resolve => setImmediate(resolve));
        Bun.gc(true);
        console.log(JSON.stringify({ requests: heapStats().objectTypeCounts.Request ?? 0 }));
      `);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout).requests).toBeLessThanOrEqual(iterations / 10);
      expect(exitCode).toBe(0);
    },
  );

  test("a listener on a signal that follows a default signal does not keep its Request", async () => {
    const iterations = slow ? 50 : 500;
    const { stdout, stderr, exitCode } = await run(`
      const { heapStats } = require("bun:jsc");
      const url = "http://example.com/";
      (function () {
        for (let i = 0; i < ${iterations}; i++) {
          const original = new Request(url);
          new Request(url, { signal: original.signal }).signal.addEventListener("abort", () => original);
        }
      })();
      Bun.gc(true);
      Bun.gc(true);
      console.log(JSON.stringify({ requests: heapStats().objectTypeCounts.Request ?? 0 }));
    `);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout).requests).toBeLessThanOrEqual(iterations / 10);
    expect(exitCode).toBe(0);
  });
});
