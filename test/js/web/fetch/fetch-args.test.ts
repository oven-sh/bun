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

describe("non-HTTP(S) URL scheme rejection", () => {
  // WHATWG URL parses `localhost:3000/x` as scheme "localhost:" with an empty
  // host. fetch() must reject these without any network activity rather than
  // treating the scheme name as a hostname.
  test.each(["about:blank", "javascript:alert(1)", "chrome:flags", "foo:bar"])(
    "fetch(%j) rejects with TypeError",
    async input => {
      const prevCount = requestCount;
      const err = await fetch(input).then(
        () => null,
        e => e,
      );
      expect(err).toBeInstanceOf(TypeError);
      expect(requestCount).toBe(prevCount);
    },
  );

  test("fetch('localhost:<port>/path') does not reach the network", async () => {
    const prevCount = requestCount;
    const input = `localhost:${server!.port}/api/x?q=1`;
    expect(new URL(input).host).toBe("");
    const err = await fetch(input).then(
      () => null,
      e => e,
    );
    expect(err).toBeInstanceOf(TypeError);
    expect(requestCount).toBe(prevCount);
  });

  test("fetch(new Request('about:blank')) rejects with TypeError", async () => {
    const err = await fetch(new Request("about:blank")).then(
      () => null,
      e => e,
    );
    expect(err).toBeInstanceOf(TypeError);
  });

  test("http:// and data: still work", async () => {
    const res = await fetch(server!.url);
    expect(res.status).toBe(200);
    const dataRes = await fetch("data:text/plain,hello");
    expect(await dataRes.text()).toBe("hello");
  });
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
