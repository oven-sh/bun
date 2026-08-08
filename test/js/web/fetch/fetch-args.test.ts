import { TCPSocketListener } from "bun";
import { afterAll, beforeAll, describe, expect, mock, spyOn, test } from "bun:test";

let server;
let requestCount = 0;
beforeAll(async () => {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      requestCount++;
      return new Response(undefined, { headers: request.headers });
    },
  });
});
afterAll(() => {
  server!.stop(true);
});

test("fetch(request subclass with headers)", async () => {
  class MyRequest extends Request {
    constructor(input: RequestInfo, init?: RequestInit) {
      super(input, init);
      this.headers.set("hello", "world");
    }
  }
  const myRequest = new MyRequest(server!.url + "/");
  const { headers } = await fetch(myRequest);

  expect(headers.get("hello")).toBe("world");
});

test("fetch(RequestInit, headers)", async () => {
  const myRequest = {
    headers: {
      "hello": "world",
    },
    url: server!.url,
  };
  const { headers } = await fetch(myRequest, {
    headers: {
      "hello": "world2",
    },
  });

  expect(headers.get("hello")).toBe("world2");
});

test("fetch(url, RequestSubclass)", async () => {
  class MyRequest extends Request {
    constructor(input: RequestInfo, init?: RequestInit) {
      super(input, init);
      this.headers.set("hello", "world");
    }
  }
  const myRequest = new MyRequest(server!.url);
  const { headers } = await fetch(server.url, myRequest);

  expect(headers.get("hello")).toBe("world");
});

test("fetch({toString throwing}, {headers} isn't accessed)", async () => {
  const obj = {
    headers: null,
  };
  const mocked = spyOn(obj, "headers");
  const str = {
    toString: mock(() => {
      throw new Error("bad2");
    }),
  };
  expect(async () => await fetch(str, obj)).toThrow("bad2");
  expect(mocked).not.toHaveBeenCalled();
  expect(str.toString).toHaveBeenCalledTimes(1);
});

// https://github.com/oven-sh/bun/issues/33644
describe("fetch() rejects instead of throwing synchronously when option conversion throws", () => {
  function expectRejects(factory: () => Promise<Response>, message: string) {
    let promise: Promise<Response>;
    try {
      promise = factory();
    } catch (e) {
      throw new Error(`fetch() threw synchronously (expected a rejected promise): ${(e as Error).message}`);
    }
    expect(promise).toBeInstanceOf(Promise);
    return expect(promise).rejects.toThrow(message);
  }

  test("url toString() throws", async () => {
    await expectRejects(
      () =>
        fetch({
          toString() {
            throw new Error("UBOOM");
          },
        } as any),
      "UBOOM",
    );
  });

  test("init.headers iterable throws", async () => {
    await expectRejects(
      () =>
        fetch("http://127.0.0.1:1/", {
          headers: {
            *[Symbol.iterator]() {
              throw new Error("HBOOM");
            },
          } as any,
        }),
      "HBOOM",
    );
  });

  const propertyNames = [
    "body",
    "decompress",
    "headers",
    "keepalive",
    "method",
    "proxy",
    "redirect",
    "signal",
    "timeout",
    "tls",
    "unix",
    "verbose",
  ];
  test.each(propertyNames)("init.%s getter throws", async name => {
    await expectRejects(
      () =>
        fetch("http://127.0.0.1:1/", {
          get [name]() {
            throw new Error(`${name}-BOOM`);
          },
        } as any),
      `${name}-BOOM`,
    );
  });
});

test("fetch(RequestSubclass, undefined)", async () => {
  class MyRequest extends Request {
    constructor(input: RequestInfo, init?: RequestInit) {
      super(input, init);
      this.headers.set("hello", "world");
    }
  }
  const myRequest = new MyRequest(server!.url);
  const { headers } = await fetch(myRequest, undefined);

  expect(headers.get("hello")).toBe("world");
});

describe("does not send a request when", () => {
  let requestCount = 0;
  let server: TCPSocketListener | undefined;
  let url: string;

  beforeAll(async () => {
    server = Bun.listen({
      port: 0,
      hostname: "127.0.0.1",
      socket: {
        open(socket) {
          requestCount++;
          socket.terminate();
        },
        data(socket, data) {
          socket.terminate();
        },
      },
    });
    url = "http://" + server!.hostname + ":" + server!.port;
  });
  afterAll(() => {
    server!.stop(true);
  });

  test("Invalid headers", async () => {
    const prevCount = requestCount;
    expect(
      async () =>
        await fetch(url, {
          headers: {
            "😀smile ": "😀",
          },
        }),
    ).toThrow("Invalid header name");
    // Give it a chance to possibly send the request.
    await Bun.sleep(2);
    expect(requestCount).toBe(prevCount);
  });

  test("Invalid url", async () => {
    const prevCount = requestCount;
    expect(async () => await fetch("😀")).toThrow();
    // Give it a chance to possibly send the request.
    await Bun.sleep(2);
    expect(requestCount).toBe(prevCount);
  });

  test("Invalid redirect", async () => {
    const prevCount = requestCount;
    expect(async () => await fetch(url, { redirect: "😀" })).toThrow("redirect must be");
    // Give it a chance to possibly send the request.
    await Bun.sleep(2);
    expect(requestCount).toBe(prevCount);
  });

  test("proxy and unix", async () => {
    const prevCount = requestCount;
    expect(async () => await fetch(url, { proxy: url, unix: "/tmp/abc.sock" })).toThrow(
      "cannot use a proxy with a unix socket",
    );
    // Give it a chance to possibly send the request.
    await Bun.sleep(2);
    expect(requestCount).toBe(prevCount);
  });

  test("Invalid ca in tls", async () => {
    const prevCount = requestCount;
    expect(async () => await fetch(url, { tls: { ca: 123 } })).toThrow("TLSOptions.ca");
    // Give it a chance to possibly send the request.
    await Bun.sleep(2);
    expect(requestCount).toBe(prevCount);
  });

  const propertyNamesToThrow = [
    "body",
    "decompress",
    "headers",
    "keepalive",
    "method",
    "proxy",
    "redirect",
    "signal",
    "timeout",
    "tls",
    "unix",
    "verbose",
  ];

  test(`body on GET`, async () => {
    const prevCount = requestCount;
    expect(
      async () =>
        await fetch(url, {
          body: async function* () {
            throw new Error("boom");
          },
        }),
    ).toThrow("cannot have body");
    // Give it a chance to possibly send the request.
    await Bun.sleep(2);
    expect(requestCount).toBe(prevCount);
  });

  for (const propertyName of propertyNamesToThrow) {
    test(`get "${propertyName}" throws (url, 1st arg)`, async () => {
      const prevCount = requestCount;
      expect(
        async () =>
          await fetch(url, {
            get [propertyName]() {
              throw new Error("boom");
            },
          }),
      ).toThrow("boom");
      // Give it a chance to possibly send the request.
      await Bun.sleep(2);
      expect(requestCount).toBe(prevCount);
    });

    test(`get "${propertyName}" throws (1st arg)`, async () => {
      const prevCount = requestCount;
      expect(
        async () =>
          await fetch({
            url,
            get [propertyName]() {
              throw new Error("boom");
            },
          }),
      ).toThrow("boom");
      // Give it a chance to possibly send the request.
      await Bun.sleep(2);
      expect(requestCount).toBe(prevCount);
    });

    test(`get "${propertyName}" throws (Request object, 1st arg)`, async () => {
      const prevCount = requestCount;
      expect(
        async () =>
          await fetch(new Request(url), {
            get [propertyName]() {
              throw new Error("boom");
            },
          }),
      ).toThrow("boom");

      // Give it a chance to possibly send the request.
      await Bun.sleep(2);
      expect(requestCount).toBe(prevCount);
    });
  }
});

// Per the fetch spec, a Request input is read through its internal state, even
// when it is a subclass instance or has own properties added (a transitioned
// Structure). JS-visible getters must never be consulted.
describe("fetch(request) reads internal state, not JS-visible getters", () => {
  type Seen = { url: string; method: string; headers: Record<string, string>; body: string };
  let echo: Bun.Server;
  beforeAll(() => {
    echo = Bun.serve({
      port: 0,
      async fetch(req) {
        return Response.json({
          url: req.url,
          method: req.method,
          headers: Object.fromEntries(req.headers),
          body: await req.text(),
        } satisfies Seen);
      },
    });
  });
  afterAll(() => {
    echo.stop(true);
  });

  test.concurrent("own url getter on a genuine Request is ignored", async () => {
    const request = new Request(new URL("/original", echo.url));
    let getterCalls = 0;
    Object.defineProperty(request, "url", {
      get() {
        getterCalls++;
        return new URL("/from-getter", echo.url).href;
      },
    });
    const seen = (await (await fetch(request)).json()) as Seen;
    expect(new URL(seen.url).pathname).toBe("/original");
    expect(getterCalls).toBe(0);
  });

  test.concurrent("own url data property does not redirect the fetch", async () => {
    const request = new Request(new URL("/original", echo.url));
    Object.defineProperty(request, "url", { value: new URL("/rewritten", echo.url).href });
    const seen = (await (await fetch(request)).json()) as Seen;
    expect(new URL(seen.url).pathname).toBe("/original");
  });

  test.concurrent("subclass overriding every getter fetches via internal state", async () => {
    class Evil extends Request {
      get url(): string {
        throw new Error("url getter called");
      }
      get method(): string {
        throw new Error("method getter called");
      }
      get headers(): Headers {
        throw new Error("headers getter called");
      }
      get body(): ReadableStream<Uint8Array<ArrayBuffer>> | null {
        throw new Error("body getter called");
      }
      get signal(): AbortSignal {
        throw new Error("signal getter called");
      }
      get redirect(): RequestRedirect {
        throw new Error("redirect getter called");
      }
      get keepalive(): boolean {
        throw new Error("keepalive getter called");
      }
    }
    const request = new Evil(new URL("/sub", echo.url), {
      method: "POST",
      headers: { "x-real": "1" },
      body: "real-body",
    });
    const seen = (await (await fetch(request)).json()) as Seen;
    expect(new URL(seen.url).pathname).toBe("/sub");
    expect(seen.method).toBe("POST");
    expect(seen.headers["x-real"]).toBe("1");
    expect(seen.body).toBe("real-body");
  });

  test.concurrent("fetch(subclassRequest, init) still honors init overrides", async () => {
    class Sub extends Request {
      get headers(): Headers {
        throw new Error("headers getter called");
      }
    }
    const request = new Sub(new URL("/override", echo.url), { method: "POST", body: "from-request" });
    const seen = (await (await fetch(request, { headers: { "x-extra": "1" } })).json()) as Seen;
    expect(new URL(seen.url).pathname).toBe("/override");
    expect(seen.method).toBe("POST");
    expect(seen.headers["x-extra"]).toBe("1");
    expect(seen.body).toBe("from-request");
  });

  test.concurrent("Bun.serve request with a rewritten url own property proxies its internal url", async () => {
    let depth = 0;
    let getterCalls = 0;
    await using proxy = Bun.serve({
      port: 0,
      async fetch(req) {
        if (++depth > 1) {
          return Response.json({ url: req.url, depth });
        }
        Object.defineProperty(req, "url", {
          get() {
            getterCalls++;
            return new URL("/from-getter", echo.url).href;
          },
        });
        const inner = await (await fetch(req)).json();
        return Response.json({ ...inner, getterCalls });
      },
    });
    const seen = await (await fetch(new URL("/loopback", proxy.url))).json();
    // The inner fetch(req) must go to req's internal url (the proxy itself),
    // not the echo server the getter points at.
    expect(seen.depth).toBe(2);
    expect(seen.getterCalls).toBe(0);
    expect(new URL(seen.url).pathname).toBe("/loopback");
  });
});
