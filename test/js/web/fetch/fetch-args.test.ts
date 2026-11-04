import { TCPSocketListener } from "bun";
import { afterAll, beforeAll, describe, expect, mock, spyOn, test } from "bun:test";
import { bunEnv, bunExe, expectRssDeltaBelow, tempDir } from "harness";
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
    ["no arguments", `fetch()`, 'The "input" argument must be specified'],
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

  // The S3 upload refuses a body stream that an option getter used. That has to reject the
  // promise fetch() returned. It used to reject a second promise that nothing could reach.
  test("s3: a refused body stream rejects the promise that fetch() returned", async () => {
    const { stdout, stderr, exitCode } = await runUnhandled(`
      process.on("unhandledRejection", (reason, promise) => {
        console.log(promise === returned, reason.message);
      });
      const body = new ReadableStream();
      const returned = fetch("s3://bucket/key", {
        method: "PUT",
        body,
        s3: {
          secretAccessKey: "b",
          get accessKeyId() {
            body.cancel();
            return "a";
          },
        },
      });
    `);
    expect(stdout).toBe("true ReadableStream is already disturbed\n");
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

// fetch() reads the body first and hands it to the request last. An all-ASCII
// string body is a reference on the caller's string, so an exit in between that
// drops the body without releasing it keeps the whole string.
describe("fetch() releases a string body when it ends before it queues a request", () => {
  const refused = `"ftp://127.0.0.1:1/", { method: "POST", body }`;
  const cases: [name: string, call: string, setup?: string][] = [
    ["unsupported protocol", `fetch(${refused})`],
    ["GET with a body", `fetch("http://127.0.0.1:1/", { body })`],
    ["invalid header name", `fetch("http://127.0.0.1:1/", { method: "POST", body, headers: { "a b": "1" } })`],
    [
      "init.headers getter throws",
      `fetch("http://127.0.0.1:1/", { method: "POST", body, get headers() { throw new Error("boom"); } })`,
    ],
    [
      "proxy combined with unix",
      `fetch("http://127.0.0.1:1/", { method: "POST", body, proxy: "http://127.0.0.1:1/", unix: "fetch-args.sock" })`,
    ],
    ["file: url with a host", `fetch("file://example.com/a", { method: "POST", body })`],
    [
      "blob: url that is not registered",
      `fetch("blob:00000000-0000-0000-0000-000000000000", { method: "POST", body })`,
    ],
    // These two resolve: the body is dropped on the way to a 200 response.
    [
      "blob: url that is registered",
      `fetch(blobUrl, { method: "POST", body })`,
      `const blobUrl = URL.createObjectURL(new Blob(["x"]));`,
    ],
    [
      "file: url",
      `fetch(fileUrl, { method: "POST", body })`,
      `const fileUrl = Bun.pathToFileURL(process.execPath).href;`,
    ],
    [
      "s3: request signing fails",
      `fetch("s3://bucket/key", { method: "PATCH", body, s3: { accessKeyId: "a", secretAccessKey: "b" } })`,
    ],
    ["s3: option of the wrong type", `fetch("s3://bucket/key", { method: "PUT", body, s3: { accessKeyId: 1 } })`],
    ["Bun.fetch", `Bun.fetch(${refused})`],
    ["FetchSession.fetch", `session.fetch(${refused})`, `const session = new Bun.FetchSession();`],
    ["node-fetch", `nodeFetch(${refused})`, `const nodeFetch = require("node-fetch");`],
    ["undici fetch", `undici.fetch(${refused})`, `const undici = require("undici");`],
    ["undici request", `undici.request(${refused})`, `const undici = require("undici");`],
    ["String object body", `fetch("ftp://127.0.0.1:1/", { method: "POST", body: new String(body) })`],
    ["Request that carries the body", `fetch(new Request(${refused}))`],
    ["init object as the first argument", `fetch({ url: "ftp://127.0.0.1:1/", method: "POST", body })`],
  ];

  // One child at a time: a debug build is too slow to run all of them at once.
  test.each(cases)("%s", async (_name, call, setup = "") => {
    const code = /* js */ `
      ${setup}
      const pad = Buffer.alloc(4 * 1024 * 1024, "a").toString();
      let seq = 0;
      async function run(calls) {
        for (let i = 0; i < calls; i++) {
          // A fresh string for each call: one reused string is one allocation.
          const body = ++seq + pad;
          try { await ${call}; } catch {}
        }
        Bun.gc(true);
        return process.memoryUsage.rss();
      }
      const before = await run(8);
      const after = await run(48);
      console.log(JSON.stringify({ deltaMiB: (after - before) / 1024 / 1024 }));
    `;
    // Unfixed: 192 MiB, the 48 bodies of 4 MiB. Fixed: under 4 MiB on a release
    // build and 8 to 45 MiB on a debug build, where a loop that only flattens
    // the string measures the same.
    await expectRssDeltaBelow(["--smol", "-e", code], { release: 48, debug: 96 });
  });
});

// fetch() checks a body stream when it reads the body. It reads `headers` and `s3` after that,
// so a getter there can use the stream before the S3 upload gets it. The upload refuses a used
// stream, and the fetch has to reject. It used to stay pending forever.
test("fetch(s3://) rejects when an option getter used the body stream", async () => {
  type Row = { call: string; start: string; method: string; getter: string; use: "read" | "cancel" };
  const first: Row = {
    call: "fetch(url, init)",
    start: `fetch(url, options({ method, body }))`,
    method: "PUT",
    getter: "s3.accessKeyId",
    use: "read",
  };
  const rows: Row[] = [
    first,
    // Each of the other rows changes one thing.
    { ...first, call: "Bun.fetch(url, init)", start: `Bun.fetch(url, options({ method, body }))` },
    { ...first, call: "FetchSession#fetch(url, init)", start: `session.fetch(url, options({ method, body }))` },
    { ...first, call: "node-fetch(url, init)", start: `nodeFetch(url, options({ method, body }))` },
    { ...first, call: "fetch(request, init)", start: `fetch(new Request(url, { method, body }), options({}))` },
    { ...first, call: "fetch(init with url, init)", start: `fetch({ url, method, body }, options({}))` },
    { ...first, method: "POST" },
    { ...first, getter: "headers" },
    { ...first, getter: "s3" },
    { ...first, use: "cancel" },
    // Controls: the S3 write calls take the promise of the same upload. They rejected before too.
    { ...first, call: "s3file.write(stream, options) (control)", start: `client.file("key").write(body, s3)` },
    {
      ...first,
      call: "Bun.write(s3file, stream, options) (control)",
      start: `Bun.write(client.file("key"), body, s3)`,
    },
    {
      ...first,
      call: "s3file.write(stream, options) (control)",
      start: `client.file("key").write(body, s3)`,
      use: "cancel",
    },
    {
      ...first,
      call: "Bun.write(s3file, stream, options) (control)",
      start: `Bun.write(client.file("key"), body, s3)`,
      use: "cancel",
    },
  ];
  const name = (row: Row) => `${row.call} ${row.method}, ${row.getter} getter: ${row.use}`;

  const code = /* js */ `
    const requests = [];
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(request) {
        requests.push(request.method);
        await request.arrayBuffer();
        return new Response("");
      },
    });
    const credentials = {
      endpoint: "http://127.0.0.1:" + server.port,
      bucket: "bucket",
      accessKeyId: "key",
      secretAccessKey: "secret",
      region: "us-east-1",
    };
    const unhandled = [];
    process.on("unhandledRejection", reason => unhandled.push(String(reason)));

    const url = "s3://bucket/key";
    const session = new Bun.FetchSession();
    const nodeFetch = require("node-fetch");
    const client = new Bun.S3Client(credentials);
    // What the getter does with the stream. The result is what the getter's own use of it got.
    const uses = {
      read: stream => stream.getReader().read().then(({ value }) => new TextDecoder().decode(value)),
      cancel: stream => stream.cancel().then(() => "cancelled"),
    };
    const rows = [
      ${rows
        .map(
          row =>
            `{ name: ${JSON.stringify(name(row))}, method: ${JSON.stringify(row.method)}, getter: ${JSON.stringify(row.getter)}, ` +
            `use: uses.${row.use}, start: (method, body, options, s3) => ${row.start} },`,
        )
        .join("\n")}
    ];

    const results = {};
    for (const row of rows) {
      const stream = new ReadableStream({
        pull(controller) {
          controller.enqueue(new TextEncoder().encode("hello"));
          controller.close();
        },
      });
      let used;
      const run = getter => {
        if (getter === row.getter) used ??= row.use(stream);
      };
      const s3 = {
        ...credentials,
        get accessKeyId() {
          run("s3.accessKeyId");
          return credentials.accessKeyId;
        },
      };
      const options = init => ({
        ...init,
        get headers() {
          run("headers");
          return undefined;
        },
        get s3() {
          run("s3");
          return s3;
        },
      });

      let result = "pending";
      row.start(row.method, stream, options, s3).then(
        value => (result = "resolved " + (value.status ?? value)),
        error => (result = "rejected " + error),
      );
      // A refusal needs no I/O, so one turn of the event loop is enough for it to settle.
      await new Promise(resolve => setImmediate(resolve));
      results[row.name] = result + ", getter: " + (await used);
    }
    await server.stop();
    console.log(JSON.stringify({ results, requests, unhandled }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    // An inherited proxy would take a request away from the stub.
    env: { ...bunEnv, HTTP_PROXY: undefined, HTTPS_PROXY: undefined, http_proxy: undefined, https_proxy: undefined },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const results = Object.fromEntries(
    rows.map(row => [
      name(row),
      `rejected Error: ReadableStream is already disturbed, getter: ${row.use === "read" ? "hello" : "cancelled"}`,
    ]),
  );
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ results, requests: [], unhandled: [] });
  expect({ exitCode, signalCode: proc.signalCode }).toEqual({ exitCode: 0, signalCode: null });
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
