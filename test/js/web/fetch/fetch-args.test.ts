import { TCPSocketListener } from "bun";
import { afterAll, beforeAll, describe, expect, mock, spyOn, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

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

  test("a rejection that is handled is not reported", async () => {
    const { stdout, stderr, exitCode } = await runUnhandled(`
      process.on("unhandledRejection", () => console.log("unhandledRejection fired"));
      fetch("gopher://example.com/").catch(err => console.log("caught:", err.message));
    `);
    expect(stdout).toBe("caught: protocol must be http:, https: or s3:\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
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
