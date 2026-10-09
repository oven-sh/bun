import { TCPSocketListener } from "bun";
import { afterAll, beforeAll, describe, expect, mock, spyOn, test } from "bun:test";
import { bunEnv, bunExe, tempDir, tls } from "harness";
import nodeFetch from "node-fetch";
import { once } from "node:events";
import http2 from "node:http2";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { serve as serveS3 } from "s3-server";
import { request as undiciRequest } from "undici";

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
    constructor(input: string | URL | Request, init?: RequestInit) {
      super(input as string, init);
      this.headers.set("hello", "world");
    }
  }
  const myRequest = new MyRequest(server!.url + "/");
  const { headers } = await fetch(myRequest);

  expect(headers.get("hello")).toBe("world");
});

test("fetch(host:port/path) without a scheme is an http request", async () => {
  // `new URL()` reads `localhost` as the scheme of this string. The client reads a host and a port.
  const response = await fetch(`localhost:${server!.port}/hello`, { headers: { hello: "world" } });
  expect({ status: response.status, hello: response.headers.get("hello") }).toEqual({ status: 200, hello: "world" });
});

test("fetch(RequestInit, headers)", async () => {
  const myRequest = {
    headers: {
      "hello": "world",
    },
    url: server!.url,
  };
  const { headers } = await fetch(myRequest as any, {
    headers: {
      "hello": "world2",
    },
  });

  expect(headers.get("hello")).toBe("world2");
});

test("fetch(url, RequestSubclass)", async () => {
  class MyRequest extends Request {
    constructor(input: string | URL | Request, init?: RequestInit) {
      super(input as string, init);
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
  expect(async () => await fetch(str as any, obj as any)).toThrow("bad2");
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

// Every early exit in fetch() (bad arguments, unsupported scheme, unresolvable
// blob:, pre-aborted signal, unreadable Bun.file() body, ...) returns an already
// rejected promise. Those promises used to be created without notifying the VM,
// so when nothing handled them the process printed nothing and exited 0.
describe.concurrent("fetch() early rejections are reported when unhandled", () => {
  async function runUnhandled(code: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", code],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  const cases: [name: string, code: string, expectedStderr: string][] = [
    ["no arguments", `fetch()`, "fetch() expects a string but received no arguments"],
    ["blank url", `fetch("")`, "fetch() URL must not be a blank string"],
    ["invalid url", `fetch("not a url")`, "fetch() URL is invalid"],
    ["unsupported protocol", `fetch("gopher://example.com/")`, "protocol must be http:, https: or s3:"],
    // No host may be read behind the second scheme, and the request still has to be refused.
    ["a scheme in front of a scheme", `fetch("blob:http://example.com/id")`, "protocol must be http:, https: or s3:"],
    ["view-source:", `fetch("view-source:http://example.com/")`, "protocol must be http:, https: or s3:"],
    [
      "revoked blob: url",
      `const url = URL.createObjectURL(new Blob(["x"])); URL.revokeObjectURL(url); fetch(url);`,
      "Failed to resolve blob:",
    ],
    ["data: url without a comma", `fetch("data:text/plain")`, "failed to fetch the data URL"],
    ["data: url with invalid base64", `fetch("data:text/plain;base64,@@@")`, "failed to fetch the data URL"],
    ["url toString() throws", `fetch({ toString() { throw new Error("UBOOM"); } })`, "UBOOM"],
    [
      "GET with a body",
      `fetch("http://127.0.0.1:1/", { body: "x" })`,
      "fetch() request with GET/HEAD method cannot have body",
    ],
    [
      "proxy combined with unix",
      `fetch("http://127.0.0.1:1/", { proxy: "http://127.0.0.1:1/", unix: "/tmp/fetch-args.sock" })`,
      "fetch() cannot use a proxy with a unix socket",
    ],
    ["invalid proxy url", `fetch("http://127.0.0.1:1/", { proxy: "not a url" })`, "fetch() proxy URL is invalid"],
    [
      "invalid proxy.url",
      `fetch("http://127.0.0.1:1/", { proxy: { url: "not a url" } })`,
      "fetch() proxy URL is invalid",
    ],
    [
      "init.signal is not an AbortSignal",
      `fetch("http://127.0.0.1:1/", { signal: 1 })`,
      "signal is not of type AbortSignal",
    ],
    [
      "input.signal is not an AbortSignal",
      `fetch({ url: "http://127.0.0.1:1/", signal: 1 })`,
      "signal is not of type AbortSignal",
    ],
    [
      "already aborted signal",
      `fetch("http://127.0.0.1:1/", { signal: AbortSignal.abort() })`,
      "The operation was aborted",
    ],
    [
      "s3: request signing fails",
      `fetch("s3://bucket/key", { method: "PATCH", s3: { accessKeyId: "a", secretAccessKey: "b" } })`,
      "Method must be GET, PUT, DELETE or HEAD when using s3:// protocol",
    ],
    [
      "s3: ReadableStream body with a non-upload method",
      `fetch("s3://bucket/key", { method: "DELETE", body: new ReadableStream() })`,
      "Only POST and PUT do support body when using S3",
    ],
    [
      // The endpoint refuses connections: nothing may be signed and sent for this method.
      "s3: a method that S3 does not sign",
      `fetch("s3://bucket/key", { method: "BREW", s3: { accessKeyId: "a", secretAccessKey: "b", endpoint: "http://127.0.0.1:1" } })`,
      "Method must be GET, PUT, DELETE or HEAD when using s3:// protocol",
    ],
    [
      "a method that is not a token",
      `fetch("http://127.0.0.1:1/", { method: "GET POST" })`,
      '"GET POST" is not a valid HTTP method.',
    ],
  ];

  test.each(cases)("%s", async (_name, code, expectedStderr) => {
    const { stderr, exitCode } = await runUnhandled(code);
    expect(stderr).toContain(expectedStderr);
    expect(exitCode).toBe(1);
  });

  test("Bun.file() body that does not exist", async () => {
    using dir = tempDir("fetch-unhandled-body", {});
    const missing = JSON.stringify(join(String(dir), "missing.bin"));
    const { stderr, exitCode } = await runUnhandled(
      `fetch("http://127.0.0.1:1/", { method: "POST", body: Bun.file(${missing}) })`,
    );
    expect(stderr).toContain("ENOENT");
    expect(exitCode).toBe(1);
  });

  test("Bun.file() body that is a directory", async () => {
    using dir = tempDir("fetch-unhandled-body", {});
    const directory = JSON.stringify(String(dir));
    const { stderr, exitCode } = await runUnhandled(
      `fetch("http://127.0.0.1:1/", { method: "POST", body: Bun.file(${directory}) })`,
    );
    expect(stderr).toContain("EISDIR");
    expect(exitCode).toBe(1);
  });

  test("the rejection is delivered to process.on('unhandledRejection')", async () => {
    const { stdout, stderr, exitCode } = await runUnhandled(`
      process.on("unhandledRejection", (reason, promise) => {
        console.log(promise === returned, reason.code, reason.message);
      });
      const returned = fetch("gopher://example.com/");
    `);
    expect(stdout).toBe("true ERR_INVALID_ARG_VALUE protocol must be http:, https: or s3:\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  // Before the rejection was registered, handling it still reached the tracker's
  // "handled" side, which emitted a spurious rejectionHandled event.
  test("a rejection that is handled is not reported", async () => {
    const { stdout, stderr, exitCode } = await runUnhandled(`
      process.on("unhandledRejection", () => console.log("unhandledRejection fired"));
      process.on("rejectionHandled", () => console.log("rejectionHandled fired"));
      fetch("gopher://example.com/").catch(err => console.log("caught:", err.message));
    `);
    expect(stdout).toBe("caught: protocol must be http:, https: or s3:\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});

test("fetch(RequestSubclass, undefined)", async () => {
  class MyRequest extends Request {
    constructor(input: string | URL | Request, init?: RequestInit) {
      super(input as string, init);
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
    expect(async () => await fetch(url, { redirect: "😀" as any })).toThrow("redirect must be");
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
    expect(async () => await fetch(url, { tls: { ca: 123 as any } })).toThrow("TLSOptions.ca");
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
          } as any),
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

// https://fetch.spec.whatwg.org/#methods: a method is any RFC 9110 token.
// The server is a raw socket, because Bun.serve does not take a method outside its own table.
describe("fetch() method", () => {
  function listen() {
    const requests: { line: string; contentLength?: string; transferEncoding?: string; body: string }[] = [];
    let sockets = 0;
    const listener = Bun.listen<{ received: string; done: boolean }>({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(socket) {
          sockets++;
          socket.data = { received: "", done: false };
        },
        data(socket, chunk) {
          const state = socket.data;
          if (state.done) return;
          state.received += chunk.toString("latin1");
          const headEnd = state.received.indexOf("\r\n\r\n");
          if (headEnd === -1) return;
          const [line, ...headers] = state.received.slice(0, headEnd).split("\r\n");
          const header = (name: string) =>
            headers
              .find(h => h.toLowerCase().startsWith(name + ":"))
              ?.slice(name.length + 1)
              .trim();
          const contentLength = header("content-length");
          const transferEncoding = header("transfer-encoding");
          const body = state.received.slice(headEnd + 4);
          if (transferEncoding ? !body.endsWith("0\r\n\r\n") : body.length < Number(contentLength ?? 0)) return;
          state.done = true;
          requests.push({ line, contentLength, transferEncoding, body });
          socket.end("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        },
      },
    });
    return {
      url: `http://127.0.0.1:${listener.port}/`,
      requests,
      get sockets() {
        return sockets;
      },
      [Symbol.dispose]() {
        listener.stop(true);
      },
    };
  }
  const requestLines = (server: ReturnType<typeof listen>) => server.requests.map(request => request.line);

  type Send = (url: string, method: any) => Promise<Response>;
  const native: [name: string, send: Send][] = [
    ["fetch(url, { method })", (url, method) => fetch(url, { method })],
    ["fetch(new Request(url, { method }))", (url, method) => fetch(new Request(url, { method }))],
    ["fetch({ url, method })", (url, method) => fetch({ url, method } as any)],
    [
      "fetch(new Request(url, { method: 'DELETE' }), { method })",
      (url, method) => fetch(new Request(url, { method: "DELETE" }), { method }),
    ],
    ["Bun.fetch(url, { method })", (url, method) => Bun.fetch(url, { method })],
    [
      "new Bun.FetchSession().fetch(url, { method })",
      async (url, method) => {
        using session = new Bun.FetchSession();
        return await session.fetch(url, { method });
      },
    ],
  ];
  // The npm package puts every method in upper case. Only spellings that it
  // and this replacement send alike go through it here.
  const viaNodeFetch: [name: string, send: Send] = [
    "node-fetch",
    (url, method) => nodeFetch(url, { method }) as unknown as Promise<Response>,
  ];

  // https://fetch.spec.whatwg.org/#concept-method-normalize: these six, in any case.
  const normalized: [method: unknown, onTheWire: string][] = [
    ["Delete", "DELETE"],
    ["gEt", "GET"],
    ["hEaD", "HEAD"],
    ["oPtIoNs", "OPTIONS"],
    ["pOsT", "POST"],
    ["Put", "PUT"],
  ];
  const upperCaseTokens: [method: unknown, onTheWire: string][] = [
    ["BREW", "BREW"],
    ["LIST", "LIST"],
  ];
  // Every other token goes out as written. A value that is not a string is converted to one.
  const asWritten: [method: unknown, onTheWire: string][] = [
    ["PatCh", "PatCh"],
    ["Propfind", "Propfind"],
    ["M-search", "M-search"],
    ["!#$%&'*+-.^_`|~09AZaz", "!#$%&'*+-.^_`|~09AZaz"],
    [false, "false"],
    [0, "0"],
    [123, "123"],
  ];

  describe.each([
    ...native.map(entry => [...entry, [...normalized, ...upperCaseTokens, ...asWritten]] as const),
    [...viaNodeFetch, [...normalized, ...upperCaseTokens]] as const,
  ])("%s", (_, send, sent) => {
    test("sends the method it is given", async () => {
      using server = listen();
      for (const [method] of sent) {
        await (await send(server.url, method)).arrayBuffer();
      }
      expect(requestLines(server)).toEqual(sent.map(([, onTheWire]) => `${onTheWire} / HTTP/1.1`));
    });

    test("rejects a method that is not a token or that Fetch forbids, and sends nothing", async () => {
      using server = listen();
      const rejected: [method: unknown, message: string][] = [
        ["GET POST", `"GET POST" is not a valid HTTP method.`],
        [" GET", `" GET" is not a valid HTTP method.`],
        ["GET ", `"GET " is not a valid HTTP method.`],
        ["GET\r\nX-Injected: 1", `"GET\\r\\nX-Injected: 1" is not a valid HTTP method.`],
        ["G\0T", `"G\\u0000T" is not a valid HTTP method.`],
        ["caf\u00e9", `"caf\u00e9" is not a valid HTTP method.`],
        ["(GET)", `"(GET)" is not a valid HTTP method.`],
        [[], `"" is not a valid HTTP method.`],
        [{}, `"[object Object]" is not a valid HTTP method.`],
        // https://fetch.spec.whatwg.org/#forbidden-method
        ["TRACK", `"TRACK" HTTP method is unsupported.`],
        ["track", `"track" HTTP method is unsupported.`],
        ["Trace", `"Trace" HTTP method is unsupported.`],
        ["Connect", `"Connect" HTTP method is unsupported.`],
      ];
      const errors: unknown[] = [];
      for (const [method] of rejected) {
        // `new Request()` throws and `fetch()` rejects.
        errors.push(
          await (async () => send(server.url, method))().then(
            () => "no error",
            e => ({ name: e.name, code: e.code, message: e.message }),
          ),
        );
      }
      expect(errors).toEqual(
        rejected.map(([, message]) => ({ name: "TypeError", code: "ERR_INVALID_ARG_VALUE", message })),
      );
      // The server saw none of them: the one request after them is its first socket.
      await (await fetch(server.url)).arrayBuffer();
      expect({ sockets: server.sockets, requests: requestLines(server) }).toEqual({
        sockets: 1,
        requests: ["GET / HTTP/1.1"],
      });
    });
  });

  test("undici.request() sends a token", async () => {
    using server = listen();
    const { statusCode, body } = await undiciRequest(server.url, { method: "BREW" });
    await body.text();
    expect({ statusCode, requests: requestLines(server) }).toEqual({ statusCode: 200, requests: ["BREW / HTTP/1.1"] });
  });

  test("a Request keeps its token for every fetch()", async () => {
    using server = listen();
    const request = new Request(server.url, { method: "BREW" });
    for (const send of [
      () => fetch(request),
      () => fetch(request),
      () => fetch(request.clone()),
      () => fetch(new Request(request)),
      () => fetch(request, {}),
      () => fetch(request, { method: "" }),
      () => fetch(request, { method: "Put" }),
      () => fetch(request, { method: "PatCh" }),
    ]) {
      await (await send()).arrayBuffer();
    }
    expect(requestLines(server)).toEqual([
      "BREW / HTTP/1.1",
      "BREW / HTTP/1.1",
      "BREW / HTTP/1.1",
      "BREW / HTTP/1.1",
      "BREW / HTTP/1.1",
      "BREW / HTTP/1.1",
      "PUT / HTTP/1.1",
      "PatCh / HTTP/1.1",
    ]);
  });

  test("a token carries a body, and declares no length when it has none", async () => {
    using server = listen();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("coffee"));
        controller.close();
      },
    });
    for (const init of [
      { method: "BREW" },
      { method: "BREW", body: "coffee" },
      { method: "BREW", body: stream },
      // A verb of the table that takes a body still declares an empty one.
      { method: "POST" },
    ]) {
      await (await fetch(server.url, init)).arrayBuffer();
    }
    expect(server.requests).toEqual([
      { line: "BREW / HTTP/1.1", contentLength: undefined, transferEncoding: undefined, body: "" },
      { line: "BREW / HTTP/1.1", contentLength: "6", transferEncoding: undefined, body: "coffee" },
      {
        line: "BREW / HTTP/1.1",
        contentLength: undefined,
        transferEncoding: "chunked",
        body: "6\r\ncoffee\r\n0\r\n\r\n",
      },
      { line: "POST / HTTP/1.1", contentLength: "0", transferEncoding: undefined, body: "" },
    ]);
  });

  test("a token is sent on a reused connection and is not sent again after a reset", async () => {
    // Answers on one connection, and closes it unanswered for /reset.
    const lines: string[][] = [];
    using listener = Bun.listen<{ received: string; lines: string[] }>({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(socket) {
          socket.data = { received: "", lines: [] };
          lines.push(socket.data.lines);
        },
        data(socket, chunk) {
          const state = socket.data;
          state.received += chunk.toString("latin1");
          for (;;) {
            const headEnd = state.received.indexOf("\r\n\r\n");
            if (headEnd === -1) return;
            const head = state.received.slice(0, headEnd).split("\r\n");
            const length = Number(head.find(h => h.toLowerCase().startsWith("content-length:"))?.split(":")[1] ?? 0);
            if (state.received.length < headEnd + 4 + length) return;
            state.received = state.received.slice(headEnd + 4 + length);
            state.lines.push(head[0]);
            if (head[0].includes(" /reset ")) return socket.terminate();
            socket.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
          }
        },
      },
    });
    const url = `http://127.0.0.1:${listener.port}`;
    const results: string[] = [];
    for (const [path, init] of [
      ["/1", { method: "BREW" }],
      ["/2", { method: "BREW", body: "coffee" }],
      ["/3", {}],
      ["/reset", { method: "BREW" }],
    ] as const) {
      results.push(
        await fetch(url + path, init).then(
          res => res.text(),
          e => e.code,
        ),
      );
    }
    expect({ results, lines }).toEqual({
      results: ["ok", "ok", "ok", "ECONNRESET"],
      lines: [["BREW /1 HTTP/1.1", "BREW /2 HTTP/1.1", "GET /3 HTTP/1.1", "BREW /reset HTTP/1.1"]],
    });
  });

  test("a token goes to an HTTP proxy", async () => {
    using proxy = listen();
    // The proxy answers, so the host of the URL is never resolved.
    await (await fetch("http://method.test/path", { method: "BREW", proxy: proxy.url })).arrayBuffer();
    expect(requestLines(proxy)).toEqual(["BREW http://method.test/path HTTP/1.1"]);
  });

  test("a token is the :method pseudo-header over HTTP/2", async () => {
    const server = http2.createSecureServer({ ...tls, allowHTTP1: false }, (req, res) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", chunk => (body += chunk));
      req.on("end", () => res.end(JSON.stringify({ method: req.headers[":method"], body })));
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    try {
      // The session closes its connection with the test, so the server can close.
      using session = new Bun.FetchSession();
      const url = `https://127.0.0.1:${(server.address() as { port: number }).port}/`;
      const seen: unknown[] = [];
      for (const init of [{ method: "BREW" }, { method: "PatCh", body: "the payload" }, { method: "Put" }]) {
        const response = await session.fetch(url, { ...init, protocol: "http2", tls: { rejectUnauthorized: false } });
        seen.push(await response.json());
      }
      expect(seen).toEqual([
        { method: "BREW", body: "" },
        { method: "PatCh", body: "the payload" },
        { method: "PUT", body: "" },
      ]);
    } finally {
      server.close();
    }
  });

  // S3 signs DELETE, GET, HEAD and PUT, and a POST is a PUT. Each row starts with an
  // object that holds "original" and ends with what the object holds after the call.
  test("an s3: URL takes its verbs in any case and refuses every other method", async () => {
    await using server = serveS3({ buckets: ["buntest"] });
    const s3 = server.clientOptions();
    const client = new Bun.S3Client(server.clientOptions("buntest"));
    const stream = () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("streamed"));
          controller.close();
        },
      });
    const invalidMethod = {
      code: "ERR_S3_INVALID_METHOD",
      message: "Method must be GET, PUT, DELETE or HEAD when using s3:// protocol",
    };
    const rows: [method: string, body: BodyInit | undefined, expected: object][] = [
      ["Delete", undefined, { status: 204, text: "", after: null }],
      ["hEaD", undefined, { status: 200, text: "", after: "original" }],
      ["Put", "new", { status: 200, text: "", after: "new" }],
      ["POST", "new", { status: 200, text: "", after: "new" }],
      ["pOsT", "new", { status: 200, text: "", after: "new" }],
      ["pOsT", stream(), { status: 200, text: "", after: "streamed" }],
      ["PatCh", undefined, { ...invalidMethod, after: "original" }],
      ["BREW", "new", { ...invalidMethod, after: "original" }],
      [
        "BREW",
        stream(),
        { code: undefined, message: "Only POST and PUT do support body when using S3", after: "original" },
      ],
    ];
    const seen: object[] = [];
    for (const [index, [method, body]] of rows.entries()) {
      const key = `key-${index}`;
      await client.write(key, "original");
      const outcome = await fetch(`s3://buntest/${key}`, { method, body, s3 }).then(
        async response => ({ status: response.status, text: await response.text() }),
        e => ({ code: e.code, message: e.message }),
      );
      const file = client.file(key);
      seen.push({ ...outcome, after: (await file.exists()) ? await file.text() : null });
    }
    expect(seen).toEqual(rows.map(([, , expected]) => expected));
  });

  // These schemes answer without a request. The method is still checked.
  test.each([
    // https://fetch.spec.whatwg.org/#scheme-fetch: a data: URL answers every method.
    ["data:", () => "data:text/plain,hi", "BREW"],
    // Fetch answers a blob: URL for GET only, so only GET is asserted to answer for these two.
    ["file:", () => pathToFileURL(join(import.meta.dir, "fixture.html")).href, "GET"],
    ["blob:", () => URL.createObjectURL(new Blob(["hi"])), "GET"],
  ])("a %s URL rejects a method that is not a token", async (_, makeUrl, answered) => {
    const url = makeUrl();
    const response = await fetch(url, { method: answered });
    expect(response.status).toBe(200);
    await response.arrayBuffer();
    const error = await fetch(url, { method: "GET POST" }).then(
      () => "no error",
      e => ({ name: e.name, code: e.code, message: e.message }),
    );
    expect(error).toEqual({
      name: "TypeError",
      code: "ERR_INVALID_ARG_VALUE",
      message: `"GET POST" is not a valid HTTP method.`,
    });
  });

  test("undefined, null and the empty string name no method", async () => {
    using server = listen();
    for (const method of [undefined, null, ""]) {
      await (await fetch(server.url, { method } as any)).arrayBuffer();
    }
    expect(requestLines(server)).toEqual(["GET / HTTP/1.1", "GET / HTTP/1.1", "GET / HTTP/1.1"]);
  });

  test("a method of the table keeps its treatment", async () => {
    using server = listen();
    // All-lower spellings go out in upper case, and CONNECT and TRACE are sent.
    for (const method of ["patch", "propfind", "m-search", "CONNECT", "connect", "TRACE", "trace"]) {
      await (await fetch(server.url, { method })).arrayBuffer();
    }
    expect(requestLines(server)).toEqual([
      "PATCH / HTTP/1.1",
      "PROPFIND / HTTP/1.1",
      "M-SEARCH / HTTP/1.1",
      "CONNECT / HTTP/1.1",
      "CONNECT / HTTP/1.1",
      "TRACE / HTTP/1.1",
      "TRACE / HTTP/1.1",
    ]);
  });

  // Bun.serve answers a method of its table only (#6556). It can refuse the
  // other two, but it must not run the handler with a method that was not sent.
  test("a Bun.serve handler does not see GET for another method over HTTP/1.1", async () => {
    const seen: string[] = [];
    using server = Bun.serve({
      port: 0,
      fetch(request) {
        seen.push(request.method);
        return new Response(request.method);
      },
    });
    const methods = ["PATCH", "PURGE", "PatCh", "custom"];
    for (const method of methods) {
      await fetch(server.url, { method }).then(
        res => res.arrayBuffer(),
        () => {},
      );
    }
    expect({
      inTheTable: seen.slice(0, 2),
      notSent: seen.filter(method => !methods.includes(method)),
    }).toEqual({ inTheTable: ["PATCH", "PURGE"], notSent: [] });
  });
});
