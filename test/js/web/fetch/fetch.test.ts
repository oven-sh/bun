import { AnyFunction, serve, ServeOptions, Server, sleep, TCPSocketListener } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, rmSync, writeFileSync } from "fs";
import {
  bunEnv,
  bunExe,
  exampleSite,
  exampleHtml as fixture,
  gc,
  isASAN,
  isBroken,
  isDebug,
  isFlaky,
  isMacOS,
  isWindows,
  tls,
  tmpdirSync,
  withoutAggressiveGC,
} from "harness";

import { once } from "events";
import { mkfifo } from "mkfifo";
import type { AddressInfo } from "net";
import net from "net";
import { join } from "path";
import { Readable } from "stream";
import { gzipSync } from "zlib";
const tmp_dir = tmpdirSync();
const fetchFixture3 = join(import.meta.dir, "fetch-leak-test-fixture-3.js");
const fetchFixture4 = join(import.meta.dir, "fetch-leak-test-fixture-4.js");
let server: Server;
function startServer({ fetch, ...options }: ServeOptions) {
  server = serve({
    idleTimeout: 0,
    ...options,
    fetch,
    port: 0,
  });
  return server;
}

let httpServer = exampleSite("http");
let httpsServer = exampleSite("https");
afterEach(() => {
  server?.stop?.(true);
});

afterAll(() => {
  rmSync(tmp_dir, { force: true, recursive: true });
  httpServer.stop();
  httpsServer.stop();
});

const payload = new Uint8Array(1024 * 1024 * 2);
crypto.getRandomValues(payload);

it("new Request(invalid url) throws", () => {
  expect(() => new Request("http")).toThrow();
  expect(() => new Request("")).toThrow();
  expect(() => new Request("http://[::1")).toThrow();
  expect(() => new Request("https://[::1")).toThrow();
  expect(() => new Request("!")).toThrow();
});

describe("fetch data urls", () => {
  it("basic", async () => {
    var url =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4//8/w38GIAXDIBKE0DHxgljNBAAO9TXL0Y4OHwAAAABJRU5ErkJggg==";

    var res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.statusText).toBe("OK");
    expect(res.ok).toBe(true);

    var blob = await res.blob();
    expect(blob.size).toBe(85);
    expect(blob.type).toBe("image/png");
  });
  it("percent encoded", async () => {
    var url = "data:text/plain;base64,SGVsbG8sIFdvcmxkIQ%3D%3D";
    var res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.statusText).toBe("OK");
    expect(res.ok).toBe(true);

    var blob = await res.blob();
    expect(blob.size).toBe(13);
    expect(blob.type).toBe("text/plain");
    expect(blob.text()).resolves.toBe("Hello, World!");
  });
  it("percent encoded (invalid)", async () => {
    var url = "data:text/plain;base64,SGVsbG8sIFdvcmxkIQ%3D%3";
    expect(async () => {
      await fetch(url);
    }).toThrow("failed to fetch the data URL");
  });
  it("plain text", async () => {
    var url = "data:,Hello%2C%20World!";
    var res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.statusText).toBe("OK");
    expect(res.ok).toBe(true);

    var blob = await res.blob();
    expect(blob.size).toBe(13);
    expect(blob.type).toBe("text/plain;charset=US-ASCII");
    expect(blob.text()).resolves.toBe("Hello, World!");

    url = "data:,helloworld!";
    res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.statusText).toBe("OK");
    expect(res.ok).toBe(true);

    blob = await res.blob();
    expect(blob.size).toBe(11);
    expect(blob.type).toBe("text/plain;charset=US-ASCII");
    expect(blob.text()).resolves.toBe("helloworld!");
  });
  it("unstrict parsing of invalid URL characters", async () => {
    var url = "data:application/json,{%7B%7D}";
    var res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.statusText).toBe("OK");
    expect(res.ok).toBe(true);

    var blob = await res.blob();
    expect(blob.size).toBe(4);
    expect(blob.type).toBe("application/json");
    expect(blob.text()).resolves.toBe("{{}}");
  });
  it("unstrict parsing of double percent characters", async () => {
    var url = "data:application/json,{%%7B%7D%%}%%";
    var res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.statusText).toBe("OK");
    expect(res.ok).toBe(true);

    var blob = await res.blob();
    expect(blob.size).toBe(9);
    expect(blob.type).toBe("application/json");
    expect(blob.text()).resolves.toBe("{%{}%%}%%");
  });
  it("data url (invalid)", async () => {
    var url = "data:Hello%2C%20World!";
    expect(async () => {
      await fetch(url);
    }).toThrow("failed to fetch the data URL");
  });
  it("emoji", async () => {
    var url = "data:,😀";

    var res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.statusText).toBe("OK");
    expect(res.ok).toBe(true);

    var blob = await res.blob();
    expect(blob.size).toBe(4);
    expect(blob.type).toBe("text/plain;charset=US-ASCII");
    expect(blob.text()).resolves.toBe("😀");
  });
  it("should work with Request", async () => {
    var req = new Request("data:,Hello%2C%20World!");
    var res = await fetch(req);
    expect(res.status).toBe(200);
    expect(res.statusText).toBe("OK");
    expect(res.ok).toBe(true);

    var blob = await res.blob();
    expect(blob.size).toBe(13);
    expect(blob.type).toBe("text/plain;charset=US-ASCII");
    expect(blob.text()).resolves.toBe("Hello, World!");

    req = new Request("data:,😀");
    res = await fetch(req);
    expect(res.status).toBe(200);
    expect(res.statusText).toBe("OK");
    expect(res.ok).toBe(true);

    blob = await res.blob();
    expect(blob.size).toBe(4);
    expect(blob.type).toBe("text/plain;charset=US-ASCII");
    expect(blob.text()).resolves.toBe("😀");
  });
  it("should work with Request (invalid)", async () => {
    var req = new Request("data:Hello%2C%20World!");
    expect(async () => {
      await fetch(req);
    }).toThrow("failed to fetch the data URL");
    req = new Request("data:Hello%345632");
    expect(async () => {
      await fetch(req);
    }).toThrow("failed to fetch the data URL");
  });

  it("rejects with TypeError", async () => {
    for (const url of ["data:", "data:text/html", "data://test:test/,X"]) {
      try {
        await fetch(url);
        expect.unreachable(`${url} should reject`);
      } catch (e) {
        expect(e).toBeInstanceOf(TypeError);
      }
    }
  });

  // https://fetch.spec.whatwg.org/#data-url-processor
  // Cases from WPT fetch/data-urls/resources/data-urls.json.
  describe.each([
    ["data://test/,X", "text/plain;charset=US-ASCII", [88]],
    ["data:,X", "text/plain;charset=US-ASCII", [88]],
    ["data:,", "text/plain;charset=US-ASCII", []],
    ["data:,X#X", "text/plain;charset=US-ASCII", [88]],
    ["data:,%FF", "text/plain;charset=US-ASCII", [255]],
    ["data:text/plain,X", "text/plain", [88]],
    ["data:text/plain ,X", "text/plain", [88]],
    ["data:text/plain%20,X", "text/plain%20", [88]],
    ["data:text/plain\f,X", "text/plain%0c", [88]],
    ["data:text/plain%0C,X", "text/plain%0c", [88]],
    ["data:text/plain;,X", "text/plain", [88]],
    ["data:;x=x;charset=x,X", "text/plain;x=x;charset=x", [88]],
    ["data:;x=x,X", "text/plain;x=x", [88]],
    ["data:text/plain;charset=windows-1252,%C2%B1", "text/plain;charset=windows-1252", [194, 177]],
    ["data:text/plain;Charset=UTF-8,%C2%B1", "text/plain;charset=UTF-8", [194, 177]],
    ["data:image/gif,%C2%B1", "image/gif", [194, 177]],
    ["data:IMAGE/gif,%C2%B1", "image/gif", [194, 177]],
    ["data:IMAGE/gif;hi=x,%C2%B1", "image/gif;hi=x", [194, 177]],
    ["data:IMAGE/gif;CHARSET=x,%C2%B1", "image/gif;charset=x", [194, 177]],
    ["data: ,%FF", "text/plain;charset=US-ASCII", [255]],
    ["data:%20,%FF", "text/plain;charset=US-ASCII", [255]],
    ["data:\f,%FF", "text/plain;charset=US-ASCII", [255]],
    ["data:%1F,%FF", "text/plain;charset=US-ASCII", [255]],
    ["data:%00,%FF", "text/plain;charset=US-ASCII", [255]],
    ["data:text/html  ,X", "text/html", [88]],
    ["data:text / html,X", "text/plain;charset=US-ASCII", [88]],
    ["data:†,X", "text/plain;charset=US-ASCII", [88]],
    ["data:†/†,X", "%e2%80%a0/%e2%80%a0", [88]],
    ["data:X,X", "text/plain;charset=US-ASCII", [88]],
    ["data:image/png,X X", "image/png", [88, 32, 88]],
    ["data:application/xml,X X", "application/xml", [88, 32, 88]],
    ["data:unknown/unknown,X X", "unknown/unknown", [88, 32, 88]],
    ['data:text/plain;a=",",X', 'text/plain;a=""', [34, 44, 88]],
    ["data:text/plain;a=%2C,X", "text/plain;a=%2C", [88]],
    ["data:;base64;base64,WA", "text/plain", [88]],
    ["data:x/x;base64;base64,WA", "x/x", [88]],
    ["data:x/x;base64;charset=x,WA", "x/x;charset=x", [87, 65]],
    ["data:x/x;base64;charset=x;base64,WA", "x/x;charset=x", [88]],
    ["data:x/x;base64;base64x,WA", "x/x", [87, 65]],
    ["data:;base64,W%20A", "text/plain;charset=US-ASCII", [88]],
    ["data:;base64,W%0CA", "text/plain;charset=US-ASCII", [88]],
    ["data:x;base64x,WA", "text/plain;charset=US-ASCII", [87, 65]],
    ["data:x;base64;x,WA", "text/plain;charset=US-ASCII", [87, 65]],
    ["data:x;base64=x,WA", "text/plain;charset=US-ASCII", [87, 65]],
    ["data:; base64,WA", "text/plain;charset=US-ASCII", [88]],
    ["data:;  base64,WA", "text/plain;charset=US-ASCII", [88]],
    ["data:  ;charset=x   ;  base64,WA", "text/plain;charset=x", [88]],
    ["data:;base64;,WA", "text/plain", [87, 65]],
    ["data:;base64 ,WA", "text/plain;charset=US-ASCII", [88]],
    ["data:;base64   ,WA", "text/plain;charset=US-ASCII", [88]],
    ["data:;base 64,WA", "text/plain", [87, 65]],
    ["data:;BASe64,WA", "text/plain;charset=US-ASCII", [88]],
    ["data:;%62ase64,WA", "text/plain", [87, 65]],
    ["data:%3Bbase64,WA", "text/plain;charset=US-ASCII", [87, 65]],
    ["data:;charset=x,X", "text/plain;charset=x", [88]],
    ["data:; charset=x,X", "text/plain;charset=x", [88]],
    ["data:;charset =x,X", "text/plain", [88]],
    ["data:;charset= x,X", 'text/plain;charset=" x"', [88]],
    ["data:;charset=,X", "text/plain", [88]],
    ["data:;charset,X", "text/plain", [88]],
    ['data:;charset="x",X', "text/plain;charset=x", [88]],
    ['data:;CHARSET="X",X', "text/plain;charset=X", [88]],
    ["data:text/plain;a=b;base64,WA", "text/plain;a=b", [88]],
    ["data:;base64,W A", "text/plain;charset=US-ASCII", [88]],
    ["data:;base64,WA", "text/plain;charset=US-ASCII", [88]],
  ] as const)("data URL processing %j", (url, expectedType, expectedBody) => {
    it(`-> ${JSON.stringify(expectedType)} ${JSON.stringify(expectedBody)}`, async () => {
      const res = await fetch(url);
      const body = [...new Uint8Array(await res.arrayBuffer())];
      expect({ type: res.headers.get("content-type"), body }).toEqual({
        type: expectedType,
        body: [...expectedBody],
      });
    });
  });
});

describe("AbortSignal", () => {
  beforeEach(() => {
    startServer({
      async fetch(request) {
        if (request.url.endsWith("/nodelay")) {
          return new Response("Hello");
        }
        if (request.url.endsWith("/stream")) {
          const reader = request.body!.getReader();
          const body = new ReadableStream({
            async pull(controller) {
              if (!reader) controller.close();
              const { done, value } = await reader.read();
              // When no more data needs to be consumed, close the stream
              if (done) {
                controller.close();
                return;
              }
              // Enqueue the next data chunk into our target stream
              controller.enqueue(value);
            },
          });
          return new Response(body);
        }
        if (request.method.toUpperCase() === "POST") {
          const body = await request.text();
          return new Response(body);
        }
        await sleep(15);
        return new Response("Hello");
      },
    });
  });
  afterEach(() => {
    server?.stop?.(true);
  });

  it("AbortError", async () => {
    const controller = new AbortController();
    const signal = controller.signal;

    expect(async () => {
      async function manualAbort() {
        await sleep(1);
        controller.abort();
      }
      await Promise.all([fetch(server.url, { signal: signal }).then(res => res.text()), manualAbort()]);
    }).toThrow(new DOMException("The operation was aborted."));
  });

  it("AbortAfterFinish", async () => {
    const controller = new AbortController();
    const signal = controller.signal;

    await fetch(`http://127.0.0.1:${server.port}/nodelay`, { signal: signal }).then(async res =>
      expect(await res.text()).toBe("Hello"),
    );
    controller.abort();
  });

  it("AbortErrorWithReason", async () => {
    const controller = new AbortController();
    const signal = controller.signal;

    expect(async () => {
      async function manualAbort() {
        await sleep(10);
        controller.abort(new Error("My Reason"));
      }
      await Promise.all([fetch(server.url, { signal: signal }).then(res => res.text()), manualAbort()]);
    }).toThrow("My Reason");
  });

  it("AbortErrorEventListener", async () => {
    const controller = new AbortController();
    const signal = controller.signal;
    signal.addEventListener("abort", ev => {
      const target = ev.currentTarget!;
      expect(target).toBeDefined();
      expect(target.aborted).toBe(true);
      expect(target.reason).toBeDefined();
      expect(target.reason!.name).toBe("AbortError");
    });

    async function manualAbort() {
      await sleep(10);
      controller.abort();
    }

    try {
      await Promise.all([fetch(server.url, { signal: signal }).then(res => res.text()), manualAbort()]);
      expect.unreachable();
    } catch (e) {
      expect(e?.message).toEqual("The operation was aborted.");
      expect(e?.name).toEqual("AbortError");
      expect(e?.constructor.name).toEqual("DOMException");
    }
  });

  it("AbortErrorWhileUploading", async () => {
    const controller = new AbortController();

    try {
      await fetch(`http://localhost:${server.port}`, {
        method: "POST",
        body: new ReadableStream({
          pull(event_controller) {
            console.count("pull");
            event_controller.enqueue(new Uint8Array([1, 2, 3, 4]));
            //this will abort immediately should abort before connected
            controller.abort();
          },
          cancel(reason) {
            console.log("cancel", reason);
          },
        }),
        signal: controller.signal,
      });
      expect.unreachable();
    } catch (ex: any) {
      expect(ex?.message).toEqual("The operation was aborted.");
      expect(ex?.name).toEqual("AbortError");
      expect(ex?.constructor.name).toEqual("DOMException");
    }
  });

  it("abort while uploading prevents pull() from being called", async () => {
    const controller = new AbortController();
    await fetch(`http://localhost:${server.port}`, {
      method: "POST",
      body: new Blob(["a"]),
    });

    try {
      await fetch(`http://localhost:${server.port}`, {
        method: "POST",
        body: new ReadableStream({
          async pull(event_controller) {
            expect(controller.signal.aborted).toBeFalse();
            const chunk = Buffer.alloc(256 * 1024, "abc");
            for (let i = 0; i < 64; i++) {
              event_controller.enqueue(chunk);
            }
            //this will abort immediately should abort before connected
            controller.abort();
          },
        }),
        signal: controller.signal,
      });
      expect.unreachable();
    } catch (ex: any) {
      expect(ex?.message).toEqual("The operation was aborted.");
      expect(ex?.name).toEqual("AbortError");
      expect(ex?.constructor.name).toEqual("DOMException");
    }
  });

  it("TimeoutError", async () => {
    const signal = AbortSignal.timeout(10);

    try {
      using server = Bun.serve({
        port: 0,
        async fetch() {
          await Bun.sleep(100);
          return new Response("Hello");
        },
      });
      await fetch(server.url, { signal: signal }).then(res => res.text());
      expect.unreachable();
    } catch (ex: any) {
      expect(ex.name).toBe("TimeoutError");
      expect(ex.message).toBe("The operation timed out.");
      expect(ex.constructor.name).toBe("DOMException");
    }
  });

  it("Request", async () => {
    const controller = new AbortController();
    const signal = controller.signal;
    async function manualAbort() {
      await sleep(10);
      controller.abort();
    }

    try {
      const request = new Request(server.url, { signal });
      await Promise.all([fetch(request).then(res => res.text()), manualAbort()]);
      expect(() => {}).toThrow();
    } catch (ex: any) {
      expect(ex.name).toBe("AbortError");
    }
  });

  it("already-aborted signal returns an already-rejected promise", async () => {
    // Fetch spec step 11: when the signal is already aborted, fetch() must
    // return an already-rejected promise (not a pending one that settles after
    // a round-trip to the HTTP thread).
    {
      const controller = new AbortController();
      const reason = new Error("pre-aborted");
      controller.abort(reason);
      const p = fetch("http://127.0.0.1:1/", { signal: controller.signal });
      expect(Bun.peek.status(p)).toBe("rejected");
      expect(Bun.peek(p)).toBe(reason);
      await p.catch(() => {});
    }
    {
      // default reason → DOMException AbortError, identical to signal.reason
      const controller = new AbortController();
      controller.abort();
      const p = fetch("http://127.0.0.1:1/", { signal: controller.signal });
      expect(Bun.peek.status(p)).toBe("rejected");
      const err = Bun.peek(p);
      expect(err).toBeInstanceOf(DOMException);
      expect((err as DOMException).name).toBe("AbortError");
      expect(err).toBe(controller.signal.reason);
      await p.catch(() => {});
    }
    {
      // via Request input
      const controller = new AbortController();
      const reason = new Error("pre-aborted-req");
      controller.abort(reason);
      const req = new Request("http://127.0.0.1:1/", { signal: controller.signal });
      const p = fetch(req);
      expect(Bun.peek.status(p)).toBe("rejected");
      expect(Bun.peek(p)).toBe(reason);
      await p.catch(() => {});
    }
    {
      // AbortSignal.abort() static
      const reason = new Error("pre-aborted-static");
      const p = fetch("http://127.0.0.1:1/", { signal: AbortSignal.abort(reason) });
      expect(Bun.peek.status(p)).toBe("rejected");
      expect(Bun.peek(p)).toBe(reason);
      await p.catch(() => {});
    }
    {
      // plain-object first argument (request_init_object branch)
      const controller = new AbortController();
      const reason = new Error("pre-aborted-init");
      controller.abort(reason);
      const p = fetch({ url: "http://127.0.0.1:1/", signal: controller.signal } as any);
      expect(Bun.peek.status(p)).toBe("rejected");
      expect(Bun.peek(p)).toBe(reason);
      await p.catch(() => {});
    }
    {
      // Request-constructor errors (spec step 4) still win over the abort:
      // GET with a body rejects with TypeError, not the abort reason.
      const reason = new Error("should-not-see-this");
      const p = fetch("http://127.0.0.1:1/", {
        method: "GET",
        body: "x",
        signal: AbortSignal.abort(reason),
      } as any);
      expect(Bun.peek.status(p)).toBe("rejected");
      expect(Bun.peek(p)).toBeInstanceOf(TypeError);
      expect(Bun.peek(p)).not.toBe(reason);
      await p.catch(() => {});
    }
    {
      // Request input body is consumed (step 4) before the abort (step 11).
      const controller = new AbortController();
      const reason = new Error("pre-aborted-bodyused");
      controller.abort(reason);
      const req = new Request("http://127.0.0.1:1/", {
        method: "POST",
        body: "hello",
        signal: controller.signal,
      });
      const p = fetch(req);
      expect(Bun.peek.status(p)).toBe("rejected");
      expect(Bun.peek(p)).toBe(reason);
      expect(req.bodyUsed).toBe(true);
      await p.catch(() => {});
    }
    {
      // ReadableStream body is cancelled with the abort reason (abort-a-fetch
      // step: "cancel request's body with error").
      let cancelReason: unknown = "not called";
      const stream = new ReadableStream({
        cancel(r) {
          cancelReason = r;
        },
      });
      const reason = new Error("pre-aborted-stream");
      const p = fetch("http://127.0.0.1:1/", {
        method: "POST",
        body: stream,
        signal: AbortSignal.abort(reason),
      });
      expect(Bun.peek.status(p)).toBe("rejected");
      expect(Bun.peek(p)).toBe(reason);
      await p.catch(() => {});
      expect(cancelReason).toBe(reason);
      expect(stream.locked).toBe(false);
    }
  });
});

describe("Headers", () => {
  it(".toJSON", () => {
    const headers = new Headers({
      "content-length": "123",
      "content-type": "text/plain",
      "x-another-custom-header": "Hello World",
      "x-custom-header": "Hello World",
    });
    expect(JSON.stringify(headers.toJSON(), null, 2)).toBe(
      JSON.stringify(Object.fromEntries(headers.entries()), null, 2),
    );
  });

  it(".getSetCookie() with object", () => {
    const headers = new Headers({
      "content-length": "123",
      "content-type": "text/plain",
      "x-another-custom-header": "Hello World",
      "x-custom-header": "Hello World",
      "Set-Cookie": "foo=bar; Path=/; HttpOnly",
    });
    expect(headers.count).toBe(5);
    expect(headers.getAll("set-cookie")).toEqual(["foo=bar; Path=/; HttpOnly"]);
  });

  it("presence of content-encoding header(issue #5668)", async () => {
    startServer({
      fetch(req) {
        const content = gzipSync(JSON.stringify({ message: "Hello world" }));
        return new Response(content, {
          status: 200,
          headers: {
            "content-encoding": "gzip",
            "content-type": "application/json",
          },
        });
      },
    });
    const result = await fetch(`http://${server.hostname}:${server.port}/`);
    const value = result.headers.get("content-encoding");
    const body = await result.json();
    expect(value).toBe("gzip");
    expect(body).toBeDefined();
    expect(body.message).toBe("Hello world");
  });

  it(".getSetCookie() with array", () => {
    const headers = new Headers([
      ["content-length", "123"],
      ["content-type", "text/plain"],
      ["x-another-custom-header", "Hello World"],
      ["x-custom-header", "Hello World"],
      ["Set-Cookie", "foo=bar; Path=/; HttpOnly"],
      ["Set-Cookie", "foo2=bar2; Path=/; HttpOnly"],
    ]);
    expect(headers.count).toBe(6);
    expect(headers.getAll("set-cookie")).toEqual(["foo=bar; Path=/; HttpOnly", "foo2=bar2; Path=/; HttpOnly"]);
  });

  it("Set-Cookies init", () => {
    const headers = new Headers([
      ["Set-Cookie", "foo=bar"],
      ["Set-Cookie", "bar=baz"],
      ["X-bun", "abc"],
      ["X-bun", "def"],
    ]);
    const actual = [...headers];
    expect(actual).toEqual([
      ["x-bun", "abc, def"],
      ["set-cookie", "foo=bar"],
      ["set-cookie", "bar=baz"],
    ]);
    expect([...headers.values()]).toEqual(["abc, def", "foo=bar", "bar=baz"]);
  });

  it("Set-Cookies toJSON", () => {
    const headers = new Headers([
      ["Set-Cookie", "foo=bar"],
      ["Set-Cookie", "bar=baz"],
      ["X-bun", "abc"],
      ["X-bun", "def"],
    ]).toJSON();
    expect(headers).toEqual({
      "x-bun": "abc, def",
      "set-cookie": ["foo=bar", "bar=baz"],
    });
  });

  it("Headers append multiple", () => {
    const headers = new Headers([
      ["Set-Cookie", "foo=bar"],
      ["X-bun", "foo"],
    ]);
    headers.append("Set-Cookie", "bar=baz");
    headers.append("x-bun", "bar");
    const actual = [...headers];

    // we do not preserve the order
    // which is kind of bad
    expect(actual).toEqual([
      ["x-bun", "foo, bar"],
      ["set-cookie", "foo=bar"],
      ["set-cookie", "bar=baz"],
    ]);
  });

  it("append duplicate set cookie key", () => {
    const headers = new Headers([["Set-Cookie", "foo=bar"]]);
    headers.append("set-Cookie", "foo=baz");
    headers.append("Set-cookie", "baz=bar");
    const actual = [...headers];
    expect(actual).toEqual([
      ["set-cookie", "foo=bar"],
      ["set-cookie", "foo=baz"],
      ["set-cookie", "baz=bar"],
    ]);
  });

  it("set duplicate cookie key", () => {
    const headers = new Headers([["Set-Cookie", "foo=bar"]]);
    headers.set("set-Cookie", "foo=baz");
    headers.set("set-cookie", "bar=qat");
    const actual = [...headers];
    expect(actual).toEqual([["set-cookie", "bar=qat"]]);
  });

  it("should include set-cookie headers in array", () => {
    const headers = new Headers();
    headers.append("Set-Cookie", "foo=bar");
    headers.append("Content-Type", "text/plain");
    const actual = [...headers];
    expect(actual).toEqual([
      ["content-type", "text/plain"],
      ["set-cookie", "foo=bar"],
    ]);
  });
});

describe("fetch", () => {
  const urls = [
    { url: httpsServer.url.href, tls: { ca: httpsServer.ca } },
    { url: httpServer.url.href, tls: undefined },
    { url: httpsServer.url, tls: { ca: httpsServer.ca } },
    { url: new Request({ url: httpsServer.url.href }), tls: { ca: httpsServer.ca } },
    { url: { toString: () => httpServer.url.href } as string, tls: undefined },
  ];
  for (let { url, tls } of urls) {
    gc();
    let name: string;
    if (url instanceof URL) {
      name = "URL: " + url;
    } else if (url instanceof Request) {
      name = "Request: " + url.url;
    } else if (url.hasOwnProperty("toString")) {
      name = "Object: " + url.toString();
    } else {
      name = url as string;
    }
    it.concurrent(name, async () => {
      gc();
      const response = await fetch(url, { verbose: true, tls });
      gc();
      const text = await response.text();
      gc();
      expect(fixture).toBe(text);
    });
  }

  it.concurrent('redirect: "manual"', async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: "https://example.com",
          },
        });
      },
    });
    const response = await fetch(`http://${server.hostname}:${server.port}`, {
      redirect: "manual",
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com");
    expect(response.redirected).toBe(false); // not redirected
  });

  it.concurrent('redirect: "follow"', async () => {
    using target = Bun.serve({
      port: 0,
      tls,
      fetch() {
        return new Response("redirected!");
      },
    });
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: target.url.href,
          },
        });
      },
    });
    const response = await fetch(`http://${server.hostname}:${server.port}`, {
      redirect: "follow",
      tls: { ca: tls.cert },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBe(null);
    expect(response.redirected).toBe(true);
  });

  it.concurrent('redirect: "error" #2819', async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: "https://example.com",
          },
        });
      },
    });
    try {
      const response = await fetch(`http://${server.hostname}:${server.port}`, {
        redirect: "error",
      });
      expect(response).toBeUndefined();
    } catch (err: any) {
      expect(err.code).toBe("UnexpectedRedirect");
    }
  });

  it.concurrent("should properly redirect to another port #7793", async () => {
    var socket: net.Server | null = null;
    try {
      using server = Bun.serve({
        port: 0,
        tls,
        fetch() {
          return new Response("Hello, world!");
        },
      });

      socket = net.createServer(socket => {
        socket.on("data", () => {
          // we redirect and close the connection here
          socket.end(`HTTP/1.1 301 Moved Permanently\r\nLocation: ${server?.url}\r\nConnection: close\r\n\r\n`);
        });
      });

      const { promise, resolve, reject } = Promise.withResolvers();
      socket.on("error", reject);
      socket.listen(0, "localhost", async () => {
        const url = server?.url.href;
        const http_url = server?.url.href.replace("https://", "http://");
        try {
          await fetch(http_url, { tls: { rejectUnauthorized: false } });
        } catch {}
        const response = await fetch(url, { tls: { rejectUnauthorized: false } }).then(res => res.text());
        resolve(response);
      });

      expect(await promise).toBe("Hello, world!");
    } finally {
      socket?.close();
    }
  });

  it.concurrent("provide body", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response(req.body);
      },
      hostname: "localhost",
    });

    // POST with body
    const url = `http://${server.hostname}:${server.port}`;
    const response = await fetch(url, { method: "POST", body: "buntastic" });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("buntastic");
  });

  ["GET", "HEAD", "OPTIONS"].forEach(method =>
    it.concurrent(`fail on ${method} with body`, async () => {
      const url = `http://${server.hostname}:${server.port}`;
      expect(async () => {
        await fetch(url, { body: "buntastic" });
      }).toThrow("fetch() request with GET/HEAD/OPTIONS method cannot have body.");
    }),
  );

  it.concurrent("content length is inferred", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response(req.headers.get("content-length"));
      },
      hostname: "localhost",
    });

    // POST with body
    const url = `http://${server.hostname}:${server.port}`;
    const response = await fetch(url, { method: "POST", body: "buntastic" });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("9");

    const response2 = await fetch(url, { method: "POST", body: "" });
    expect(response2.status).toBe(200);
    expect(await response2.text()).toBe("0");
  });

  it.concurrent("should work with ipv6 localhost", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response("Pass!");
      },
    });
    let res = await fetch(`http://[::1]:${server.port}`);
    expect(await res.text()).toBe("Pass!");
    res = await fetch(`http://[::]:${server.port}/`);
    expect(await res.text()).toBe("Pass!");
    res = await fetch(`http://[0:0:0:0:0:0:0:1]:${server.port}/`);
    expect(await res.text()).toBe("Pass!");
    res = await fetch(`http://[0000:0000:0000:0000:0000:0000:0000:0001]:${server.port}/`);
    expect(await res.text()).toBe("Pass!");
  });
});

it.concurrent("simultaneous HTTPS fetch", async () => {
  const urls = [httpsServer.url.href, httpsServer.url.href];
  for (let batch = 0; batch < 4; batch++) {
    const promises = new Array(20);
    for (let i = 0; i < 20; i++) {
      promises[i] = fetch(urls[i % 2], { tls: { ca: httpsServer.ca } });
    }
    const result = await Promise.all(promises);
    expect(result.length).toBe(20);
    for (let i = 0; i < 20; i++) {
      expect(result[i].status).toBe(200);
      expect(await result[i].text()).toBe(fixture);
    }
  }
});

it.concurrent("website with tlsextname", async () => {
  using server = Bun.serve({
    port: 0,
    tls,
    fetch() {
      return new Response("OK");
    },
  });
  const resp = await fetch(server.url, { method: "HEAD", tls: { ca: tls.cert } });
  expect(resp.status).toBe(200);
});

function testBlobInterface(blobbyConstructor: { (..._: any[]): any }, hasBlobFn?: boolean) {
  for (let withGC of [false, true]) {
    for (let jsonObject of [
      { hello: true },
      {
        hello: "😀 😃 😄 😁 😆 😅 😂 🤣 🥲 ☺️ 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳",
      },
    ]) {
      it.concurrent(
        `${jsonObject.hello === true ? "latin1" : "utf16"} json${withGC ? " (with gc) " : ""}`,
        async () => {
          if (withGC) gc();
          var response = blobbyConstructor(JSON.stringify(jsonObject));
          if (withGC) gc();
          expect(JSON.stringify(await response.json())).toBe(JSON.stringify(jsonObject));
          if (withGC) gc();
        },
      );

      it.concurrent(
        `${jsonObject.hello === true ? "latin1" : "utf16"} arrayBuffer -> json${withGC ? " (with gc) " : ""}`,
        async () => {
          if (withGC) gc();
          var response = blobbyConstructor(new TextEncoder().encode(JSON.stringify(jsonObject)));
          if (withGC) gc();
          expect(JSON.stringify(await response.json())).toBe(JSON.stringify(jsonObject));
          if (withGC) gc();
        },
      );

      it(`${jsonObject.hello === true ? "latin1" : "utf16"} arrayBuffer -> invalid json${
        withGC ? " (with gc) " : ""
      }`, async () => {
        if (withGC) gc();
        var response = blobbyConstructor(
          new TextEncoder().encode(JSON.stringify(jsonObject) + " NOW WE ARE INVALID JSON"),
        );
        if (withGC) gc();
        var failed = false;
        try {
          await response.json();
        } catch (e) {
          failed = true;
        }
        expect(failed).toBe(true);
        if (withGC) gc();
      });

      it(`${jsonObject.hello === true ? "latin1" : "utf16"} text${withGC ? " (with gc) " : ""}`, async () => {
        if (withGC) gc();
        var response = blobbyConstructor(JSON.stringify(jsonObject));
        if (withGC) gc();
        expect(await response.text()).toBe(JSON.stringify(jsonObject));
        if (withGC) gc();
      });

      it(`${jsonObject.hello === true ? "latin1" : "utf16"} arrayBuffer -> text${
        withGC ? " (with gc) " : ""
      }`, async () => {
        if (withGC) gc();
        var response = blobbyConstructor(new TextEncoder().encode(JSON.stringify(jsonObject)));
        if (withGC) gc();
        expect(await response.text()).toBe(JSON.stringify(jsonObject));
        if (withGC) gc();
      });

      it(`${jsonObject.hello === true ? "latin1" : "utf16"} arrayBuffer${withGC ? " (with gc) " : ""}`, async () => {
        if (withGC) gc();

        var response = blobbyConstructor(JSON.stringify(jsonObject));
        if (withGC) gc();

        const bytes = new TextEncoder().encode(JSON.stringify(jsonObject));
        if (withGC) gc();

        const compare = new Uint8Array(await response.arrayBuffer());
        if (withGC) gc();

        withoutAggressiveGC(() => {
          for (let i = 0; i < compare.length; i++) {
            if (withGC) gc();

            expect(compare[i]).toBe(bytes[i]);
            if (withGC) gc();
          }
        });
        if (withGC) gc();
      });

      it(`${jsonObject.hello === true ? "latin1" : "utf16"} bytes${withGC ? " (with gc) " : ""}`, async () => {
        if (withGC) gc();

        var response = blobbyConstructor(JSON.stringify(jsonObject));
        if (withGC) gc();

        const bytes = new TextEncoder().encode(JSON.stringify(jsonObject));
        if (withGC) gc();

        const compare = await response.bytes();
        if (withGC) gc();

        withoutAggressiveGC(() => {
          for (let i = 0; i < compare.length; i++) {
            if (withGC) gc();

            expect(compare[i]).toBe(bytes[i]);
            if (withGC) gc();
          }
        });
        if (withGC) gc();
      });

      it(`${jsonObject.hello === true ? "latin1" : "utf16"} arrayBuffer -> arrayBuffer${
        withGC ? " (with gc) " : ""
      }`, async () => {
        if (withGC) gc();

        var response = blobbyConstructor(new TextEncoder().encode(JSON.stringify(jsonObject)));
        if (withGC) gc();

        const bytes = new TextEncoder().encode(JSON.stringify(jsonObject));
        if (withGC) gc();

        const compare = new Uint8Array(await response.arrayBuffer());
        if (withGC) gc();

        withoutAggressiveGC(() => {
          for (let i = 0; i < compare.length; i++) {
            if (withGC) gc();

            expect(compare[i]).toBe(bytes[i]);
            if (withGC) gc();
          }
        });
        if (withGC) gc();
      });

      it(`${jsonObject.hello === true ? "latin1" : "utf16"} arrayBuffer -> bytes${
        withGC ? " (with gc) " : ""
      }`, async () => {
        if (withGC) gc();

        var response = blobbyConstructor(new TextEncoder().encode(JSON.stringify(jsonObject)));
        if (withGC) gc();

        const bytes = new TextEncoder().encode(JSON.stringify(jsonObject));
        if (withGC) gc();

        const compare = await response.bytes();
        if (withGC) gc();

        withoutAggressiveGC(() => {
          for (let i = 0; i < compare.length; i++) {
            if (withGC) gc();

            expect(compare[i]).toBe(bytes[i]);
            if (withGC) gc();
          }
        });
        if (withGC) gc();
      });

      hasBlobFn &&
        it(`${jsonObject.hello === true ? "latin1" : "utf16"} blob${withGC ? " (with gc) " : ""}`, async () => {
          if (withGC) gc();
          const text = JSON.stringify(jsonObject);
          var response = blobbyConstructor(text);
          if (withGC) gc();
          const size = new TextEncoder().encode(text).byteLength;
          if (withGC) gc();
          const blobed = await response.blob();
          if (withGC) gc();
          expect(blobed instanceof Blob).toBe(true);
          if (withGC) gc();
          expect(blobed.size).toBe(size);
          if (withGC) gc();
          expect(blobed.type).toBe("text/plain;charset=utf-8");
          const out = await blobed.text();
          expect(out).toBe(text);
          if (withGC) gc();
          await new Promise(resolve => setTimeout(resolve, 1));
          if (withGC) gc();
          expect(out).toBe(text);
          const first = await blobed.arrayBuffer();
          const initial = first[0];
          first[0] = 254;
          const second = await blobed.arrayBuffer();
          expect(second[0]).toBe(initial);
          expect(first[0]).toBe(254);
        });
    }
  }
}

describe.concurrent("Bun.file", () => {
  let count = 0;
  testBlobInterface(data => {
    const blob = new Blob([data]);
    const buffer = Bun.peek(blob.arrayBuffer()) as ArrayBuffer;
    const path = join(tmp_dir, `tmp-${count++}.bytes`);
    writeFileSync(path, buffer);
    const file = Bun.file(path);
    expect(blob.size).toBe(file.size);
    expect(file.lastModified).toBeGreaterThan(0);
    return file;
  });

  // this test uses libc.so or dylib so we skip on windows
  it.skipIf(isWindows)("size is Infinity on a fifo", () => {
    const path = join(tmp_dir, "test-fifo");
    mkfifo(path);
    const { size } = Bun.file(path);
    expect(size).toBe(Infinity);
  });

  const method = ["arrayBuffer", "text", "json", "bytes"] as const;
  function forEachMethod(fn: (m: (typeof method)[number]) => any, skip?: AnyFunction) {
    for (const m of method) {
      (skip ? it.skip : it)(m, fn(m));
    }
  }

  // on Windows the creator of the file will be able to read from it so this test is disabled on it
  describe.skipIf(isWindows)("bad permissions throws", () => {
    const path = join(tmp_dir, "my-new-file");
    beforeAll(async () => {
      await Bun.write(path, "hey");
      chmodSync(path, 0x000);
    });

    forEachMethod(m => () => {
      const file = Bun.file(path);
      expect(async () => await file[m]()).toThrow("permission denied");
    });

    afterAll(() => {
      rmSync(path, { force: true });
    });
  });

  describe("non-existent file throws", () => {
    const path = join(tmp_dir, "does-not-exist");

    forEachMethod(m => async () => {
      const file = Bun.file(path);
      expect(async () => await file[m]()).toThrow("no such file or directory");
    });
  });
});

describe("Blob", () => {
  testBlobInterface(data => new Blob([data]));

  it("should have expected content type", async () => {
    var response = new Response("<div>hello</div>", {
      headers: {
        "content-type": "multipart/form-data;boundary=boundary",
      },
    });
    expect((await response.blob()).type).toBe("multipart/form-data;boundary=boundary");

    response = new Response("<div>hello</div>", {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    });
    expect((await response.blob()).type).toBe("text/html;charset=utf-8");

    response = new Response("<div>hello</div>", {
      headers: {
        "content-type": "octet/stream",
      },
    });
    expect((await response.blob()).type).toBe("octet/stream");

    response = new Response("<div>hello</div>", {
      headers: {
        "content-type": "text/plain;charset=utf-8",
      },
    });
    expect((await response.blob()).type).toBe("text/plain;charset=utf-8");
  });

  var blobConstructorValues = [
    ["123", "456"],
    ["123", 456],
    ["123", "456", "789"],
    ["123", 456, 789],
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
    [Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 9])],
    [Uint8Array.from([1, 2, 3, 4]), "5678", 9],
    [new Blob([Uint8Array.from([1, 2, 3, 4])]), "5678", 9],
    [
      new Blob([
        new TextEncoder().encode(
          "😀 😃 😄 😁 😆 😅 😂 🤣 🥲 ☺️ 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳",
        ),
      ]),
    ],
    [
      new TextEncoder().encode(
        "😀 😃 😄 😁 😆 😅 😂 🤣 🥲 ☺️ 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳",
      ),
    ],
  ] as any[];

  var expected = [
    "123456",
    "123456",
    "123456789",
    "123456789",
    "123456789",
    "\x01\x02\x03\x04\x05\x06\x07\t",
    "\x01\x02\x03\x0456789",
    "\x01\x02\x03\x0456789",
    "😀 😃 😄 😁 😆 😅 😂 🤣 🥲 ☺️ 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳",
    "😀 😃 😄 😁 😆 😅 😂 🤣 🥲 ☺️ 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳",
  ];

  it(`blobConstructorValues`, async () => {
    for (let i = 0; i < blobConstructorValues.length; i++) {
      var response = new Blob(blobConstructorValues[i]);
      const res = await response.text();
      if (res !== expected[i]) {
        throw new Error(
          `Failed: ${expected[i].split("").map(a => a.charCodeAt(0))}, received: ${res
            .split("")
            .map(a => a.charCodeAt(0))}`,
        );
      }

      expect(res).toBe(expected[i]);
    }
  });

  for (let withGC of [false, true]) {
    it(`Blob.slice() ${withGC ? " with gc" : ""}`, async () => {
      var parts = ["hello", " ", "world"];
      if (withGC) gc();
      var str = parts.join("");
      if (withGC) gc();
      var combined = new Blob(parts);
      if (withGC) gc();
      for (let part of parts) {
        if (withGC) gc();
        expect(await combined.slice(str.indexOf(part), str.indexOf(part) + part.length).text()).toBe(part);
        if (withGC) gc();
      }
      if (withGC) gc();
      for (let part of parts) {
        if (withGC) gc();
        expect(await combined.slice(str.indexOf(part), str.indexOf(part) + part.length).text()).toBe(part);
        if (withGC) gc();
      }
    });
  }
});

{
  const sample = new TextEncoder().encode("Hello World!");
  const typedArrays = [
    Uint8Array,
    Uint8ClampedArray,
    Int8Array,
    Uint16Array,
    Int16Array,
    Uint32Array,
    Int32Array,
    Float32Array,
    Float64Array,
  ];
  const Constructors = [Blob, Response, Request];

  for (let withGC of [false, true]) {
    for (let TypedArray of typedArrays) {
      for (let Constructor of Constructors) {
        it(`${Constructor.name} arrayBuffer() with ${TypedArray.name}${withGC ? " with gc" : ""}`, async () => {
          const data = new TypedArray(sample);
          if (withGC) gc();
          const input =
            Constructor === Blob ? [data] : Constructor === Request ? { body: data, url: "http://example.com" } : data;
          if (withGC) gc();
          const blob = new Constructor(input as any);
          if (withGC) gc();
          const out = await blob.arrayBuffer();
          if (withGC) gc();
          expect(out instanceof ArrayBuffer).toBe(true);
          if (withGC) gc();
          expect(out.byteLength).toBe(data.byteLength);
          if (withGC) gc();
        });
      }
    }
  }
}

describe("Response", () => {
  describe("Response.json", () => {
    it("works", async () => {
      const inputs = ["hellooo", [[123], 456, 789], { hello: "world" }, { ok: "😉 😌 😍 🥰 😘 " }];
      for (let input of inputs) {
        const output = JSON.stringify(input);
        expect(await Response.json(input).text()).toBe(output);
      }
      // JSON.stringify() returns undefined
      expect(await Response.json().text()).toBe("");
      // JSON.stringify("") returns '""'
      expect(await Response.json("").text()).toBe('""');
    });
    it("sets the content-type header", () => {
      let response = Response.json("hello");
      expect(response.type).toBe("default");
      expect(response.headers.get("content-type")).toBe("application/json;charset=utf-8");
      expect(response.status).toBe(200);
    });
    it("supports number status code", () => {
      let response = Response.json("hello", 407);
      expect(response.type).toBe("default");
      expect(response.headers.get("content-type")).toBe("application/json;charset=utf-8");
      expect(response.status).toBe(407);
    });

    it("supports headers", () => {
      var response = Response.json("hello", {
        headers: {
          "content-type": "potato",
          "x-hello": "world",
        },
        status: 408,
      });

      expect(response.headers.get("x-hello")).toBe("world");
      expect(response.status).toBe(408);
    });

    it("throws TypeError for non-JSON serializable top-level values (Node.js compatibility)", () => {
      // Symbol, Function, and undefined should throw "Value is not JSON serializable"
      expect(() => Response.json(Symbol("test"))).toThrow("Value is not JSON serializable");
      expect(() => Response.json(function () {})).toThrow("Value is not JSON serializable");
      expect(() => Response.json(undefined)).toThrow("Value is not JSON serializable");

      // These should not throw (valid values)
      expect(() => Response.json(null)).not.toThrow();
      expect(() => Response.json({})).not.toThrow();
      expect(() => Response.json("string")).not.toThrow();
      expect(() => Response.json(123)).not.toThrow();
      expect(() => Response.json(true)).not.toThrow();
      expect(() => Response.json([1, 2, 3])).not.toThrow();

      // Objects containing non-serializable values should not throw at top-level
      // (they get filtered out by JSON.stringify)
      expect(() => Response.json({ symbol: Symbol("test") })).not.toThrow();
      expect(() => Response.json({ func: function () {} })).not.toThrow();
      expect(() => Response.json({ undef: undefined })).not.toThrow();

      // BigInt should throw with Node.js compatible error message
      expect(() => Response.json(123n)).toThrow("Do not know how to serialize a BigInt");
    });
  });
  describe("Response.redirect", () => {
    it("works", () => {
      // Location is the serialization of the parsed url, so an empty path
      // gains a trailing "/". https://fetch.spec.whatwg.org/#dom-response-redirect
      const inputs = [
        ["http://example.com", "http://example.com/"],
        ["http://example.com/", "http://example.com/"],
        ["http://example.com/hello", "http://example.com/hello"],
        ["http://example.com/hello/", "http://example.com/hello/"],
        ["http://example.com/hello/world", "http://example.com/hello/world"],
        ["http://example.com/hello/world/", "http://example.com/hello/world/"],
      ];
      for (const [input, expected] of inputs) {
        expect(Response.redirect(input).headers.get("Location")).toBe(expected);
      }
    });

    it("supports headers", () => {
      var response = Response.redirect("https://example.com", {
        headers: {
          "content-type": "potato",
          "x-hello": "world",
          Location: "https://wrong.com",
        },
        status: 307,
      });
      expect(response.headers.get("x-hello")).toBe("world");
      expect(response.headers.get("Location")).toBe("https://example.com/");
      expect(response.status).toBe(307);
      expect(response.type).toBe("default");
      expect(response.ok).toBe(false);
    });
  });
  describe("Response.error", () => {
    it("works", () => {
      expect(Response.error().type).toBe("error");
      expect(Response.error().ok).toBe(false);
      expect(Response.error().status).toBe(0);
    });
  });
  it("clone", async () => {
    gc();
    var body = new Response("<div>hello</div>", {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    });
    gc();
    var clone = body.clone();
    gc();
    body.headers.set("content-type", "text/plain");
    gc();
    expect(clone.headers.get("content-type")).toBe("text/html; charset=utf-8");
    gc();
    expect(body.headers.get("content-type")).toBe("text/plain");
    gc();
    expect(await clone.text()).toBe("<div>hello</div>");
    gc();
  });
  it("invalid json", async () => {
    gc();
    var body = new Response("<div>hello</div>", {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    });
    try {
      await body.json();
      expect.unreachable();
    } catch (exception) {
      expect(exception instanceof SyntaxError).toBe(true);
    }
  });
  describe("should consume body correctly", async () => {
    it("with text first", async () => {
      var response = new Response("<div>hello</div>");
      expect(response.bodyUsed).toBe(false);
      const promise = response.text();
      expect(response.bodyUsed).toBe(true);
      expect(await promise).toBe("<div>hello</div>");
      expect(response.bodyUsed).toBe(true);
      expect(async () => {
        await response.text();
      }).toThrow("Body already used");
      expect(async () => {
        await response.json();
      }).toThrow("Body already used");
      expect(async () => {
        await response.formData();
      }).toThrow("Body already used");
      expect(async () => {
        await response.blob();
      }).toThrow("Body already used");
      expect(async () => {
        await response.arrayBuffer();
      }).toThrow("Body already used");
    });
    it("with json first", async () => {
      var response = new Response('{ "hello": "world" }');
      expect(response.bodyUsed).toBe(false);
      const promise = response.json();
      expect(response.bodyUsed).toBe(true);
      expect(await promise).toEqual({ "hello": "world" });
      expect(response.bodyUsed).toBe(true);
      expect(async () => {
        await response.json();
      }).toThrow("Body already used");
      expect(async () => {
        await response.text();
      }).toThrow("Body already used");
      expect(async () => {
        await response.formData();
      }).toThrow("Body already used");
      expect(async () => {
        await response.blob();
      }).toThrow("Body already used");
      expect(async () => {
        await response.arrayBuffer();
      }).toThrow("Body already used");
    });
    it("with formData first", async () => {
      var response = new Response("--boundary--", {
        headers: {
          "content-type": "multipart/form-data;boundary=boundary",
        },
      });
      expect(response.bodyUsed).toBe(false);
      const promise = response.formData();
      expect(response.bodyUsed).toBe(true);
      expect(await promise).toBeInstanceOf(FormData);
      expect(response.bodyUsed).toBe(true);
      expect(async () => {
        await response.formData();
      }).toThrow("Body already used");
      expect(async () => {
        await response.text();
      }).toThrow("Body already used");
      expect(async () => {
        await response.json();
      }).toThrow("Body already used");
      expect(async () => {
        await response.blob();
      }).toThrow("Body already used");
      expect(async () => {
        await response.arrayBuffer();
      }).toThrow("Body already used");
    });
    it("with blob first", async () => {
      var response = new Response("<div>hello</div>");
      expect(response.bodyUsed).toBe(false);
      const promise = response.blob();
      expect(response.bodyUsed).toBe(true);
      expect(await promise).toBeInstanceOf(Blob);
      expect(response.bodyUsed).toBe(true);
      expect(async () => {
        await response.blob();
      }).toThrow("Body already used");
      expect(async () => {
        await response.bytes();
      }).toThrow("Body already used");
      expect(async () => {
        await response.text();
      }).toThrow("Body already used");
      expect(async () => {
        await response.json();
      }).toThrow("Body already used");
      expect(async () => {
        await response.formData();
      }).toThrow("Body already used");
      expect(async () => {
        await response.arrayBuffer();
      }).toThrow("Body already used");
    });
    it("with arrayBuffer first", async () => {
      var response = new Response("<div>hello</div>");
      expect(response.bodyUsed).toBe(false);
      const promise = response.arrayBuffer();
      expect(response.bodyUsed).toBe(true);
      expect(await promise).toBeInstanceOf(ArrayBuffer);
      expect(response.bodyUsed).toBe(true);
      expect(async () => {
        await response.arrayBuffer();
      }).toThrow("Body already used");
      expect(async () => {
        await response.text();
      }).toThrow("Body already used");
      expect(async () => {
        await response.json();
      }).toThrow("Body already used");
      expect(async () => {
        await response.formData();
      }).toThrow("Body already used");
      expect(async () => {
        await response.blob();
      }).toThrow("Body already used");
    });
    it("with Bun.file() streams", async () => {
      var stream = Bun.file(join(import.meta.dir, "fixtures/file.txt")).stream();
      expect(stream instanceof ReadableStream).toBe(true);
      var input = new Response((await new Response(stream).blob()).stream()).arrayBuffer();
      var output = Bun.file(join(import.meta.dir, "/fixtures/file.txt")).arrayBuffer();
      expect(await input).toEqual(await output);
    });
    it("with Bun.file() with request/response", async () => {
      startServer({
        async fetch(request: Request) {
          var text = await request.text();
          expect(async () => {
            await request.arrayBuffer();
          }).toThrow();
          return (response = new Response((await new Response(text).blob()).stream()));
        },
      });

      var response = await fetch(server.url, {
        method: "POST",
        body: await Bun.file(import.meta.dir + "/fixtures/file.txt").arrayBuffer(),
      });
      const input = await response.bytes();
      var output = await Bun.file(import.meta.dir + "/fixtures/file.txt").stream();
      let chunks: Uint8Array[] = [];
      const reader = output.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      expect(input).toEqual(Buffer.concat(chunks));
    });
  });

  it("should work with bigint", () => {
    var r = new Response("hello status", { status: 200n });
    expect(r.status).toBe(200);
    r = new Response("hello status", { status: 599n });
    expect(r.status).toBe(599);
    r = new Response("hello status", { status: BigInt(200) });
    expect(r.status).toBe(200);
    r = new Response("hello status", { status: BigInt(599) });
    expect(r.status).toBe(599);
  });
  testBlobInterface(data => new Response(data), true);
});

describe("Request", () => {
  it("clone", async () => {
    gc();
    var body = new Request("https://hello.com", {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
      body: "<div>hello</div>",
    });
    gc();
    expect(body.signal).toBeDefined();
    gc();
    expect(body.headers.get("content-type")).toBe("text/html; charset=utf-8");
    gc();
    var clone = body.clone();
    gc();
    expect(clone.signal).toBeDefined();
    gc();
    body.headers.set("content-type", "text/plain");
    gc();
    expect(clone.headers.get("content-type")).toBe("text/html; charset=utf-8");
    gc();
    expect(body.headers.get("content-type")).toBe("text/plain");
    gc();
    expect(await clone.text()).toBe("<div>hello</div>");
  });

  it("signal", async () => {
    gc();
    const controller = new AbortController();
    const req = new Request("https://hello.com", { signal: controller.signal });
    expect(req.signal.aborted).toBe(false);
    gc();
    controller.abort();
    gc();
    expect(req.signal.aborted).toBe(true);
  });

  it("copies method (#6144)", () => {
    const request = new Request("http://localhost:1337/test", {
      method: "POST",
    });
    const new_req = new Request(request, {
      body: JSON.stringify({ message: "Hello world" }),
    });
    expect(new_req.method).toBe("POST");
  });

  it("cloned signal", async () => {
    gc();
    const controller = new AbortController();
    const req = new Request("https://hello.com", { signal: controller.signal });
    expect(req.signal.aborted).toBe(false);
    gc();
    controller.abort();
    gc();
    expect(req.signal.aborted).toBe(true);
    gc();
    const cloned = req.clone();
    expect(cloned.signal.aborted).toBe(true);
  });

  testBlobInterface(data => new Request("https://hello.com", { body: data }), true);
});

describe("Headers", () => {
  it("writes", async () => {
    var headers = new Headers({
      "content-type": "text/html; charset=utf-8",
    });
    gc();
    expect(headers.get("content-type")).toBe("text/html; charset=utf-8");
    gc();
    headers.delete("content-type");
    gc();
    expect(headers.get("content-type")).toBe(null);
    gc();
    headers.append("content-type", "text/plain");
    gc();
    expect(headers.get("content-type")).toBe("text/plain");
    gc();
    headers.append("content-type", "text/plain");
    gc();
    expect(headers.get("content-type")).toBe("text/plain, text/plain");
    gc();
    headers.set("content-type", "text/html; charset=utf-8");
    gc();
    expect(headers.get("content-type")).toBe("text/html; charset=utf-8");

    headers.delete("content-type");
    gc();
    expect(headers.get("content-type")).toBe(null);
    gc();
  });
});

it("body nullable", async () => {
  gc();
  {
    const req = new Request("https://hello.com", { body: null });
    expect(req.body).toBeNull();
  }
  gc();
  {
    const req = new Request("https://hello.com", { body: undefined });
    expect(req.body).toBeNull();
  }
  gc();
  {
    const req = new Request("https://hello.com");
    expect(req.body).toBeNull();
  }
  gc();
  {
    const req = new Request("https://hello.com", { body: "" });
    expect(req.body).not.toBeNull();
  }
});

it("Request({}) throws", async () => {
  // @ts-expect-error
  expect(() => new Request({})).toThrow();
});

it("Request({toString() { throw 'wat'; } }) throws", async () => {
  expect(
    () =>
      // @ts-expect-error
      new Request({
        toString() {
          throw "wat";
        },
      }),
  ).toThrow("wat");
});

it("should not be able to parse json from empty body", () => {
  expect(async () => await new Response().json()).toThrow(SyntaxError);
  expect(async () => await new Request("http://example.com/").json()).toThrow(SyntaxError);
});

it("#874", () => {
  expect(new Request(new Request("https://example.com"), {}).url).toBe("https://example.com/");
  expect(new Request(new Request("https://example.com")).url).toBe("https://example.com/");
  expect(new Request({ url: "https://example.com" }).url).toBe("https://example.com/");
});

it("#2794", () => {
  expect(typeof globalThis.fetch.bind).toBe("function");
  expect(typeof Bun.fetch.bind).toBe("function");
});

it("#3545", () => {
  expect(() => fetch("http://example.com?a=b")).not.toThrow();
});

it("invalid header doesnt crash", () => {
  expect(() =>
    fetch("http://example.com", {
      headers: {
        ["lol!!!!!" + "emoji" + "😀"]: "hello",
      },
    }),
  ).toThrow();
});

it("new Request(https://example.com, otherRequest) uses url from left instead of right", () => {
  const req1 = new Request("http://localhost/abc", {
    headers: {
      foo: "bar",
    },
  });

  // Want to rewrite the URL with keeping header values
  const req2 = new Request("http://localhost/def", req1);

  // Should be `http://localhost/def` But actual: http://localhost/abc
  expect(req2.url).toBe("http://localhost/def");
  expect(req2.headers.get("foo")).toBe("bar");
});

it("fetch() file:// works", async () => {
  expect(await (await fetch(import.meta.url)).text()).toEqual(await Bun.file(import.meta.path).text());
  expect(await (await fetch(new URL("fetch.test.ts", import.meta.url))).text()).toEqual(
    await Bun.file(Bun.fileURLToPath(new URL("fetch.test.ts", import.meta.url))).text(),
  );
  gc(true);
  var fileResponse = await fetch(new URL("file with space in the name.txt", import.meta.url));
  gc(true);
  var fileResponseText = await fileResponse.text();
  gc(true);
  var bunFile = Bun.file(Bun.fileURLToPath(new URL("file with space in the name.txt", import.meta.url)));
  gc(true);
  var bunFileText = await bunFile.text();
  gc(true);
  expect(fileResponseText).toEqual(bunFileText);
  gc(true);
});
it("cloned response headers are independent before accessing", () => {
  const response = new Response("hello", {
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
  });
  const cloned = response.clone();
  cloned.headers.set("content-type", "text/plain");
  expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
});

it("cloned response headers are independent after accessing", () => {
  const response = new Response("hello", {
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
  });

  // create the headers
  response.headers;

  const cloned = response.clone();
  cloned.headers.set("content-type", "text/plain");
  expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
});

it("should work with http 100 continue", async () => {
  let server: net.Server | undefined;
  try {
    server = net.createServer(socket => {
      socket.on("data", data => {
        const lines = data.toString().split("\r\n");
        for (const line of lines) {
          if (line.length == 0) {
            socket.write("HTTP/1.1 100 Continue\r\n\r\n");
            socket.write("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 13\r\n\r\nHello, World!");
            break;
          }
        }
      });
    });

    const { promise: start, resolve } = Promise.withResolvers();
    server.listen(8080, resolve);

    await start;

    const address = server.address() as net.AddressInfo;
    const result = await fetch(`http://localhost:${address.port}`).then(r => r.text());
    expect(result).toBe("Hello, World!");
  } finally {
    server?.close();
  }
});

it("should work with http 100 continue on the same buffer", async () => {
  let server: net.Server | undefined;
  try {
    server = net.createServer(socket => {
      socket.on("data", data => {
        const lines = data.toString().split("\r\n");
        for (const line of lines) {
          if (line.length == 0) {
            socket.write(
              "HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 13\r\n\r\nHello, World!",
            );
            break;
          }
        }
      });
    });

    const { promise: start, resolve } = Promise.withResolvers();
    server.listen(8080, resolve);

    await start;

    const address = server.address() as net.AddressInfo;
    const result = await fetch(`http://localhost:${address.port}`).then(r => r.text());
    expect(result).toBe("Hello, World!");
  } finally {
    server?.close();
  }
});

describe("should strip headers", () => {
  it("status code 303", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(request: Request) {
        if (request.url.endsWith("/redirect")) {
          return new Response("hello", {
            headers: {
              ...request.headers,
              "Location": "/redirected",
            },
            status: 303,
          });
        }

        return new Response("hello", {
          headers: request.headers,
        });
      },
    });

    const { headers, url, redirected } = await fetch(`http://${server.hostname}:${server.port}/redirect`, {
      method: "POST",
      headers: {
        "I-Am-Here": "yes",
        "Content-Language": "This should be stripped",
      },
    });

    expect(headers.get("I-Am-Here")).toBe("yes");
    expect(headers.get("Content-Language")).toBeNull();
    expect(url).toEndWith("/redirected");
    expect(redirected).toBe(true);
  });

  it("cross-origin status code 302", async () => {
    await using server1 = Bun.serve({
      port: 0,
      async fetch(request: Request) {
        if (request.url.endsWith("/redirect")) {
          return new Response("hello", {
            headers: {
              ...request.headers,
              "Location": `http://${server2.hostname}:${server2.port}/redirected`,
            },
            status: 302,
          });
        }

        return new Response("hello", {
          headers: request.headers,
        });
      },
    });

    await using server2 = Bun.serve({
      port: 0,
      async fetch(request: Request, server) {
        if (request.url.endsWith("/redirect")) {
          return new Response("hello", {
            headers: {
              ...request.headers,
              "Location": `http://${server.hostname}:${server.port}/redirected`,
            },
            status: 302,
          });
        }

        return new Response("hello", {
          headers: request.headers,
        });
      },
    });
    const { headers, url, redirected } = await fetch(`http://${server1.hostname}:${server1.port}/redirect`, {
      method: "GET",
      headers: {
        "Authorization": "yes",
        "Proxy-Authorization": "yes",
        "Cookie": "yes",
      },
    });

    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("Proxy-Authorization")).toBeNull();
    expect(headers.get("Cookie")).toBeNull();
    expect(url).toEndWith("/redirected");
    expect(redirected).toBe(true);
  });
});

it("same-origin status code 302 should not strip headers", async () => {
  using server = Bun.serve({
    port: 0,
    async fetch(request: Request, server) {
      if (request.url.endsWith("/redirect")) {
        return new Response("hello", {
          headers: {
            ...request.headers,
            "Location": `http://${server.hostname}:${server.port}/redirected`,
          },
          status: 302,
        });
      }

      return new Response("hello", {
        headers: request.headers,
      });
    },
  });

  const { headers, url, redirected } = await fetch(`http://${server.hostname}:${server.port}/redirect`, {
    method: "GET",
    headers: {
      "Authorization": "yes",
      "Proxy-Authorization": "yes",
      "Cookie": "yes",
    },
  });

  expect(headers.get("Authorization")).toEqual("yes");
  expect(headers.get("Proxy-Authorization")).toEqual("yes");
  expect(headers.get("Cookie")).toEqual("yes");
  expect(url).toEndWith("/redirected");
  expect(redirected).toBe(true);
});

describe("should handle relative location in the redirect, issue#5635", () => {
  let server: Server;
  beforeAll(async () => {
    server = Bun.serve({
      port: 0,
      async fetch(request: Request) {
        return new Response("Not Found", {
          status: 404,
        });
      },
    });
  });
  afterAll(() => {
    server.stop(true);
  });

  it.each([
    ["/a/b", "/c", "/c"],
    ["/a/b", "c", "/a/c"],
    ["/a/b", "/c/d", "/c/d"],
    ["/a/b", "c/d", "/a/c/d"],
    ["/a/b", "../c", "/c"],
    ["/a/b", "../c/d", "/c/d"],
    ["/a/b", "../../../c", "/c"],
    // slash
    ["/a/b/", "/c", "/c"],
    ["/a/b/", "c", "/a/b/c"],
    ["/a/b/", "/c/d", "/c/d"],
    ["/a/b/", "c/d", "/a/b/c/d"],
    ["/a/b/", "../c", "/a/c"],
    ["/a/b/", "../c/d", "/a/c/d"],
    ["/a/b/", "../../../c", "/c"],
  ])("('%s', '%s')", async (pathname, location, expected) => {
    server.reload({
      async fetch(request: Request) {
        const url = new URL(request.url);
        if (url.pathname == pathname) {
          return new Response("redirecting", {
            headers: {
              "Location": location,
            },
            status: 302,
          });
        } else if (url.pathname == expected) {
          return new Response("Fine.");
        }
        return new Response("Not Found", {
          status: 404,
        });
      },
    });

    const resp = await fetch(`http://${server.hostname}:${server.port}${pathname}`);
    expect(resp.redirected).toBe(true);
    expect(new URL(resp.url).pathname).toStrictEqual(expected);
    expect(resp.status).toBe(200);
    expect(await resp.text()).toBe("Fine.");
  });
});

describe("maxRedirects", () => {
  let server: Server;
  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      async fetch(request: Request) {
        const url = new URL(request.url);
        if (url.pathname.startsWith("/hop/")) {
          const hop = Number(url.pathname.slice("/hop/".length));
          if (hop >= 4) {
            return new Response("done");
          }
          return new Response(null, { status: 302, headers: { Location: `/hop/${hop + 1}` } });
        }
        return new Response("Not Found", { status: 404 });
      },
    });
  });
  afterAll(() => {
    server.stop(true);
  });

  it("rejects once the chain exceeds maxRedirects", async () => {
    expect(fetch(`${server.url}hop/0`, { maxRedirects: 2 })).rejects.toThrow("redirected too many times");
  });

  it("follows the chain when maxRedirects is large enough", async () => {
    const resp = await fetch(`${server.url}hop/0`, { maxRedirects: 4 });
    expect(resp.status).toBe(200);
    expect(await resp.text()).toBe("done");
    expect(new URL(resp.url).pathname).toBe("/hop/4");
  });

  it("rejects invalid values", async () => {
    expect(async () => await fetch(`${server.url}hop/0`, { maxRedirects: -1 })).toThrow();
    expect(async () => await fetch(`${server.url}hop/0`, { maxRedirects: 1.5 })).toThrow();
    expect(async () => await fetch(`${server.url}hop/0`, { maxRedirects: NaN })).toThrow();
  });
});

it.concurrent("should allow very long redirect URLS", async () => {
  const Location = "/" + "B".repeat(7 * 1024);
  using server = Bun.serve({
    port: 0,
    async fetch(request: Request) {
      gc();
      const url = new URL(request.url);
      if (url.pathname == "/redirect") {
        return new Response("redirecting", {
          headers: {
            Location,
          },
          status: 302,
        });
      }
      return new Response("Not Found", {
        status: 404,
      });
    },
  });
  // run it more times to check Malformed_HTTP_Response errors
  for (let i = 0; i < 100; i++) {
    const { url, status } = await fetch(`${server.url.origin}/redirect`);
    expect(url).toBe(`${server.url.origin}${Location}`);
    expect(status).toBe(404);
  }
});

it.concurrent("304 not modified with missing content-length does not cause a request timeout", async () => {
  const server = await Bun.listen({
    socket: {
      open(socket) {
        socket.write("HTTP/1.1 304 Not Modified\r\n\r\n");
        socket.flush();
        setTimeout(() => {
          socket.end();
        }, 9999).unref();
      },
      data() {},
      close() {},
    },
    port: 0,
    hostname: "localhost",
  });

  const response = await fetch(`http://${server.hostname}:${server.port}/`);
  expect(response.status).toBe(304);
  expect(await response.arrayBuffer()).toHaveLength(0);
  server.stop(true);
});

it("304 not modified with missing content-length and connection close does not cause a request timeout", async () => {
  const server = await Bun.listen({
    socket: {
      open(socket) {
        socket.write("HTTP/1.1 304 Not Modified\r\nConnection: close\r\n\r\n");
        socket.flush();
        setTimeout(() => {
          socket.end();
        }, 9999).unref();
      },
      data() {},
      close() {},
    },
    port: 0,
    hostname: "localhost",
  });

  const response = await fetch(`http://${server.hostname}:${server.port}/`);
  expect(response.status).toBe(304);
  expect(await response.arrayBuffer()).toHaveLength(0);
  server.stop(true);
});

it("304 not modified with content-length 0 and connection close does not cause a request timeout", async () => {
  const server = await Bun.listen({
    socket: {
      open(socket) {
        socket.write("HTTP/1.1 304 Not Modified\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
        socket.flush();
        setTimeout(() => {
          socket.end();
        }, 9999).unref();
      },
      data() {},
      close() {},
    },
    port: 0,
    hostname: "localhost",
  });

  const response = await fetch(`http://${server.hostname}:${server.port}/`);
  expect(response.status).toBe(304);
  expect(await response.arrayBuffer()).toHaveLength(0);
  server.stop(true);
});

it("304 not modified with 0 content-length does not cause a request timeout", async () => {
  const server = await Bun.listen({
    socket: {
      open(socket) {
        socket.write("HTTP/1.1 304 Not Modified\r\nContent-Length: 0\r\n\r\n");
        socket.flush();
        setTimeout(() => {
          socket.end();
        }, 9999).unref();
      },
      data() {},
      close() {},
    },
    port: 0,
    hostname: "localhost",
  });

  const response = await fetch(`http://${server.hostname}:${server.port}/`);
  expect(response.status).toBe(304);
  expect(await response.arrayBuffer()).toHaveLength(0);
  server.stop(true);
});

describe("http/1.1 response body length", () => {
  // issue #6932 (support response without Content-Length and Transfer-Encoding) + some regression tests

  let server: TCPSocketListener | undefined;
  beforeAll(async () => {
    server = Bun.listen({
      socket: {
        open(socket) {
          setTimeout(() => {
            socket.end();
          }, 9999).unref();
        },
        data(socket, data) {
          const text = data.toString();
          if (text.startsWith("GET /text")) {
            socket.end("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n\r\nHello, World!");
          } else if (text.startsWith("GET /json")) {
            socket.end('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{"hello":"World"}');
          } else if (text.startsWith("GET /chunked")) {
            socket.end(
              "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nTransfer-Encoding: chunked\r\n\r\nd\r\nHello, World!\r\n0\r\n\r\n",
            );
          } else if (text.startsWith("GET /empty")) {
            socket.end("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
          } else if (text.startsWith("GET /keepalive/bad")) {
            const resp = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nConnection: keep-alive\r\n\r\nHello, World!";
            socket.end(`${resp}${resp}`);
          } else if (text.startsWith("GET /keepalive")) {
            const resp =
              "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nConnection: keep-alive\r\nContent-Length: 13\r\n\r\nHello, World!";
            socket.end(`${resp}${resp}`);
          } else {
            socket.end(`HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 13\r\n\r\nHello, World!`);
          }
        },
        close() {},
      },
      port: 0,
      hostname: "localhost",
    });
  });
  afterAll(() => {
    server?.stop?.();
  });

  const getHost = () => `${server!.hostname}:${server!.port}`;

  describe("without content-length", () => {
    it("should read text until socket closed", async () => {
      const response = await fetch(`http://${getHost()}/text`);
      expect(response.status).toBe(200);
      expect(response.text()).resolves.toBe("Hello, World!");
    });

    it("should read json until socket closed", async () => {
      const response = await fetch(`http://${getHost()}/json`);
      expect(response.status).toBe(200);
      expect(response.json<unknown>()).resolves.toEqual({ "hello": "World" });
    });

    it("should disable keep-alive", async () => {
      // according to http/1.1 spec, the keep-alive persistence behavior should be disabled when
      // "Content-Length" header is not set (and response is not chunked)
      // therefore the response text for this test should contain
      // the 1st http response body + the full 2nd http response as text
      const response = await fetch(`http://${getHost()}/keepalive/bad`);
      expect(response.status).toBe(200);
      expect(response.text()).resolves.toHaveLength(95);
    });
  });

  it("should support keep-alive", async () => {
    const response = await fetch(`http://${getHost()}/keepalive`);
    expect(response.status).toBe(200);
    expect(response.text()).resolves.toBe("Hello, World!");
  });

  it("should support transfer-encoding: chunked", async () => {
    const response = await fetch(`http://${getHost()}/chunked`);
    expect(response.status).toBe(200);
    expect(response.text()).resolves.toBe("Hello, World!");
  });

  it("should support non-zero content-length", async () => {
    const response = await fetch(`http://${getHost()}/non-empty`);
    expect(response.status).toBe(200);
    expect(response.text()).resolves.toBe("Hello, World!");
  });

  it("should support content-length: 0", async () => {
    const response = await fetch(`http://${getHost()}/empty`);
    expect(response.status).toBe(200);
    expect(response.arrayBuffer()).resolves.toHaveLength(0);
  });

  it.todoIf(isBroken)("should ignore body on HEAD", async () => {
    const response = await fetch(`http://${getHost()}/text`, { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(response.arrayBuffer()).resolves.toHaveLength(0);
  });
});
describe("fetch Response life cycle", () => {
  // error: Malformed_HTTP_Response fetching "http://localhost:58888/". For more information, pass `verbose: true` in the second argument to fetch()
  //   path: "http://localhost:58888/",
  //  errno: 0,
  //   code: "Malformed_HTTP_Response"
  // 2054 |       stderr: "inherit",
  // 2055 |       stdout: "inherit",
  // 2056 |       stdin: "inherit",
  // 2057 |       env: bunEnv,
  // 2058 |     });
  // 2059 |     expect(await clientProcess.exited).toBe(0);
  //                                               ^
  // error: expect(received).toBe(expected)
  // Expected: 0
  // Received: 1
  //       at <anonymous> (/opt/homebrew/etc/buildkite-agent/builds/macOS-13-aarch64-1/bun/bun/test/js/web/fetch/fetch.test.ts:2059:40)
  // ✗ fetch Response life cycle > should not keep Response alive if not consumed [205.17ms]
  it.skipIf(isFlaky && isMacOS)("should not keep Response alive if not consumed", async () => {
    let deferred = Promise.withResolvers<string>();

    await using serverProcess = Bun.spawn({
      cmd: [bunExe(), "--smol", fetchFixture3],
      stderr: "inherit",
      stdout: "inherit",
      stdin: "inherit",
      env: bunEnv,
      ipc(message) {
        deferred.resolve(message);
      },
    });

    const serverUrl = await deferred.promise;
    await using clientProcess = Bun.spawn({
      cmd: [bunExe(), "--smol", fetchFixture4, serverUrl],
      stderr: "inherit",
      stdout: "inherit",
      stdin: "inherit",
      env: bunEnv,
    });
    expect(await clientProcess.exited).toBe(0);
  });
  it("should allow to get promise result after response is GC'd", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(request: Request) {
        return new Response(
          new ReadableStream({
            async pull(controller) {
              await Bun.sleep(100);
              controller.enqueue(new TextEncoder().encode("Hello, World!"));
              await Bun.sleep(100);
              controller.close();
            },
          }),
          { status: 200 },
        );
      },
    });
    async function fetchResponse() {
      const url = new URL("non-empty", server.url);
      const response = await fetch(url);
      return response.text();
    }
    try {
      const response_promise = fetchResponse();
      Bun.gc(true);
      expect(await response_promise).toBe("Hello, World!");
    } finally {
      server.stop(true);
    }
  });
});

describe("fetch should allow duplex", () => {
  it("should allow duplex streaming", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        return new Response(req.body);
      },
    });
    const intervalStream = new ReadableStream({
      start(c) {
        let count = 0;
        const timer = setInterval(() => {
          c.enqueue("Hello\n");
          if (count === 5) {
            clearInterval(timer);
            c.close();
          }
          count++;
        }, 20);
      },
    }).pipeThrough(new TextEncoderStream());

    const resp = await fetch(server.url, {
      method: "POST",
      body: intervalStream,
      duplex: "half",
    });

    const reader = resp.body.pipeThrough(new TextDecoderStream()).getReader();
    var result = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      result += value;
    }
    expect(result).toBe("Hello\n".repeat(6));
  });

  it("should allow duplex extending Readable (sync)", async () => {
    class HelloWorldStream extends Readable {
      constructor(options) {
        super(options);
        this.chunks = ["Hello", " ", "World!"];
        this.index = 0;
      }

      _read(size) {
        if (this.index < this.chunks.length) {
          this.push(this.chunks[this.index]);
          this.index++;
        } else {
          this.push(null);
        }
      }
    }

    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        return new Response(req.body);
      },
    });
    const response = await fetch(server.url, {
      body: new HelloWorldStream(),
      method: "POST",
      duplex: "half",
    });

    expect(await response.text()).toBe("Hello World!");
  });
  it("should allow duplex extending Readable (async)", async () => {
    class HelloWorldStream extends Readable {
      constructor(options) {
        super(options);
        this.chunks = ["Hello", " ", "World!"];
        this.index = 0;
      }

      _read(size) {
        setTimeout(() => {
          if (this.index < this.chunks.length) {
            this.push(this.chunks[this.index]);
            this.index++;
          } else {
            this.push(null);
          }
        }, 20);
      }
    }

    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        return new Response(req.body);
      },
    });
    const response = await fetch(server.url, {
      body: new HelloWorldStream(),
      method: "POST",
      duplex: "half",
    });

    expect(await response.text()).toBe("Hello World!");
  });

  it("should allow duplex using async iterator (async)", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        return new Response(req.body);
      },
    });
    const response = await fetch(server.url, {
      body: async function* iter() {
        yield "Hello";
        await Bun.sleep(20);
        yield " ";
        await Bun.sleep(20);
        yield "World!";
      },
      method: "POST",
      duplex: "half",
    });

    expect(await response.text()).toBe("Hello World!");
  });

  it("should fail in redirects .follow when using duplex", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        if (req.url.indexOf("/redirect") === -1) {
          return Response.redirect("/");
        }
        return new Response(req.body);
      },
    });

    expect(async () => {
      const response = await fetch(server.url, {
        body: async function* iter() {
          yield "Hello";
          await Bun.sleep(20);
          yield " ";
          await Bun.sleep(20);
          yield "World!";
        },
        method: "POST",
        duplex: "half",
      });

      await response.text();
    }).toThrow();
  });

  it("should work in redirects .manual when using duplex", async () => {
    using server = Bun.serve({
      port: 0,
      idleTimeout: 0,
      async fetch(req) {
        if (req.url.indexOf("/redirect") === -1) {
          return Response.redirect("/");
        }
        return new Response(req.body);
      },
    });

    expect(async () => {
      const response = await fetch(server.url, {
        body: async function* iter() {
          yield "Hello";
          await Bun.sleep(20);
          yield " ";
          await Bun.sleep(20);
          yield "World!";
        },
        method: "POST",
        duplex: "half",
        redirect: "manual",
      });

      await response.text();
    }).not.toThrow();
  });
});

it("should allow to follow redirect if connection is closed, abort should work even if the socket was closed before the redirect", async () => {
  for (const type of ["normal", "delay"]) {
    await using server = net.createServer(socket => {
      // Raw test server: tolerate client aborts, surface anything unexpected.
      socket.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code !== "ECONNRESET" && err.code !== "EPIPE" && err.code !== "ECONNABORTED") throw err;
      });
      let body = "";
      socket.on("data", data => {
        body += data.toString("utf8");

        const headerEndIndex = body.indexOf("\r\n\r\n");
        if (headerEndIndex !== -1) {
          // headers received
          const headers = body.split("\r\n\r\n")[0];
          const path = headers.split("\r\n")[0].split(" ")[1];
          if (path === "/redirect") {
            socket.end(
              "HTTP/1.1 308 Permanent Redirect\r\nCache-Control: public, max-age=0, must-revalidate\r\nContent-Type: text/plain\r\nLocation: /\r\nConnection: close\r\n\r\n",
            );
          } else {
            if (type === "delay") {
              setTimeout(() => {
                if (!socket.destroyed)
                  socket.end(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 9\r\nConnection: close\r\n\r\nHello Bun",
                  );
              }, 200);
            } else {
              socket.end(
                "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 9\r\nConnection: close\r\n\r\nHello Bun",
              );
            }
          }
        }
      });
    });
    await once(server.listen(0), "listening");

    try {
      let { address, port } = server.address() as AddressInfo;
      if (address === "::") {
        address = "[::]";
      }
      const response = await fetch(`http://${address}:${port}/redirect`, {
        signal: AbortSignal.timeout(150),
      });
      if (type === "delay") {
        console.error(response, type);
        expect.unreachable();
      } else {
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("Hello Bun");
      }
    } catch (err) {
      if (type === "delay") {
        expect((err as Error).name).toBe("TimeoutError");
      } else {
        expect.unreachable();
      }
    }
  }
});

it("rejects a response with an unparseable Content-Length instead of treating it as empty", async () => {
  // RFC 9112 section 6.3: an invalid Content-Length (or duplicate Content-Length
  // headers with differing values) is an unrecoverable framing error. Falling
  // back to "0" would deliver an empty body and return a desynchronized socket
  // to the keep-alive pool with the unread response bytes still in flight,
  // where they would be read as the response to the next request.
  await using server = net.createServer(socket => {
    socket.once("data", data => {
      const path = data.toString("utf8").split(" ")[1];
      if (path === "/invalid") {
        socket.end(
          "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: x\r\nConnection: keep-alive\r\n\r\n" +
            "HTTP/1.1 200 OK\r\nContent-Length: 25\r\n\r\ninjected follow-up bytes!",
        );
      } else if (path === "/conflicting") {
        socket.end(
          "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 5\r\nContent-Length: 6\r\n\r\nhello!",
        );
      } else {
        socket.end(
          "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello",
        );
      }
    });
  });
  await once(server.listen(0, "localhost"), "listening");
  const { port } = server.address() as AddressInfo;

  for (const path of ["invalid", "conflicting"]) {
    const result = await fetch(`http://localhost:${port}/${path}`)
      .then(res => res.text())
      .catch(e => e);
    expect(result).toBeInstanceOf(Error);
    expect((result as any).code).toBe("InvalidContentLength");
  }

  // A well-formed Content-Length is still delivered normally.
  const ok = await fetch(`http://localhost:${port}/valid`);
  expect(await ok.text()).toBe("hello");
});

it("combines duplicate response headers per the Fetch spec", async () => {
  // WHATWG Fetch requires repeated header fields to be combined with ", " when
  // read via Headers.get(), except Set-Cookie which is stored as separate
  // values exposed by getSetCookie(). Previously Bun overwrote duplicate
  // non-common header names with the last value, dropping earlier values.
  await using server = net.createServer(socket => {
    socket.once("data", () => {
      socket.end(
        "HTTP/1.1 200 OK\r\n" +
          "Content-Length: 2\r\n" +
          "X-Dup: first\r\n" +
          "X-Dup: second\r\n" +
          "X-Dup: third\r\n" +
          "X-Once: only\r\n" +
          "X-Gap: a\r\n" +
          "X-Gap:\r\n" +
          "X-Gap: c\r\n" +
          "X-Empty:\r\n" +
          "Accept: text/html\r\n" +
          "Accept: application/json\r\n" +
          "Set-Cookie: a=1\r\n" +
          "Set-Cookie: b=2\r\n" +
          "Connection: close\r\n" +
          "\r\n" +
          "ok",
      );
    });
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as AddressInfo;

  const res = await fetch(`http://127.0.0.1:${port}/`);
  expect(await res.text()).toBe("ok");
  expect(res.headers.get("x-dup")).toBe("first, second, third");
  expect(res.headers.get("x-once")).toBe("only");
  // the combine step has no empty-value exception, and a lone empty header is
  // still visible — undici returns "a, , c" and "" here, not "a, c" and null
  expect(res.headers.get("x-gap")).toBe("a, , c");
  expect(res.headers.get("x-empty")).toBe("");
  expect(res.headers.get("accept")).toBe("text/html, application/json");
  expect(res.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
});

it("drops a custom Host header when following a cross-origin redirect", async () => {
  // A per-request Host override must not survive a change of origin: the
  // follow-up request's Host header (and the TLS SNI / certificate identity
  // derived from the same field) has to be re-computed from the redirect
  // target's URL, not carried over from the previous origin.
  await using target = Bun.serve({
    port: 0,
    async fetch(request) {
      return new Response(request.headers.get("host") ?? "<no host header>");
    },
  });

  await using origin = Bun.serve({
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname === "/redirect") {
        return new Response(null, {
          status: 302,
          headers: { "Location": `http://${target.hostname}:${target.port}/landed` },
        });
      }
      return new Response(request.headers.get("host") ?? "<no host header>");
    },
  });

  // Cross-origin redirect: the redirect target must see its own authority,
  // not the caller-supplied Host override naming the previous origin.
  const redirected = await fetch(`http://${origin.hostname}:${origin.port}/redirect`, {
    headers: { "Host": "tenant.shared-cdn.example" },
  });
  expect(redirected.redirected).toBe(true);
  expect(await redirected.text()).toBe(`${target.hostname}:${target.port}`);

  // Without a redirect the explicit Host header is still honored.
  const direct = await fetch(`http://${origin.hostname}:${origin.port}/direct`, {
    headers: { "Host": "tenant.shared-cdn.example" },
  });
  expect(await direct.text()).toBe("tenant.shared-cdn.example");
});

it("fetch() with a fixed-size body drops a caller-supplied Transfer-Encoding header and sends only Content-Length", async () => {
  // RFC 9112 section 6.2/6.3: a sender must never emit both Transfer-Encoding and
  // Content-Length on the same message. For a fixed-size (non-streaming) body,
  // fetch() writes the body as raw bytes framed by a computed Content-Length, so a
  // caller-supplied "Transfer-Encoding: chunked" header (e.g. headers copied wholesale
  // from an inbound request in a gateway) must be dropped rather than forwarded
  // alongside Content-Length, where a TE-preferring upstream would mis-frame the body.
  const requests: string[] = [];
  await using server = net.createServer(socket => {
    let raw = "";
    socket.on("data", data => {
      raw += data.toString("latin1");
      const headerEnd = raw.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const head = raw.slice(0, headerEnd);
      const contentLength = Number(/^content-length:\s*(\d+)\s*$/im.exec(head)?.[1] ?? 0);
      if (raw.length < headerEnd + 4 + contentLength) return;
      requests.push(raw);
      raw = "";
      socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK");
    });
  });
  await once(server.listen(0, "localhost"), "listening");
  const { port } = server.address() as AddressInfo;

  // A body whose raw bytes look like a terminal chunk followed by a second request.
  const body = "0\r\n\r\nGET /other HTTP/1.1\r\nHost: upstream\r\nX-Pad: junk";
  const bodyLength = Buffer.byteLength(body);

  // Caller-supplied Transfer-Encoding header alongside a buffered (string) body.
  const withTE = await fetch(`http://localhost:${port}/`, {
    method: "POST",
    headers: { "Transfer-Encoding": "chunked", "Content-Type": "text/plain" },
    body,
  });
  expect(await withTE.text()).toBe("OK");

  // The same request without the header still works the same way.
  const plain = await fetch(`http://localhost:${port}/`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body,
  });
  expect(await plain.text()).toBe("OK");

  expect(requests).toHaveLength(2);
  for (const rawRequest of requests) {
    const [head, ...bodyParts] = rawRequest.split("\r\n\r\n");
    const headerLines = head
      .split("\r\n")
      .slice(1)
      .map(line => line.toLowerCase());
    // Exactly one framing header reaches the wire: the computed Content-Length.
    expect(headerLines.filter(line => line.startsWith("transfer-encoding:"))).toEqual([]);
    expect(headerLines.filter(line => line.startsWith("content-length:"))).toEqual([`content-length: ${bodyLength}`]);
    // The body is the raw bytes described by Content-Length, with no chunk framing added.
    expect(bodyParts.join("\r\n\r\n")).toBe(body);
  }
});

it("fetch() does not forward a caller-supplied Content-Length on a request without a body", async () => {
  // The Content-Length emitted on the wire must always describe the body fetch() is
  // actually about to send. A Content-Length copied from an inbound request (e.g. by a
  // gateway forwarding headers wholesale) on a request with no body would make the
  // upstream wait for body bytes that never arrive and read the start of the next
  // request on a kept-alive connection as that body.
  const requests: string[] = [];
  await using server = net.createServer(socket => {
    let raw = "";
    socket.on("data", data => {
      raw += data.toString("latin1");
      const headerEnd = raw.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const head = raw.slice(0, headerEnd);
      const method = head.split(" ")[0];
      if (method !== "GET") {
        // wait for the declared body before replying
        const contentLength = Number(/^content-length:\s*(\d+)\s*$/im.exec(head)?.[1] ?? 0);
        if (raw.length < headerEnd + 4 + contentLength) return;
      }
      requests.push(raw);
      raw = "";
      socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK");
    });
  });
  await once(server.listen(0, "localhost"), "listening");
  const { port } = server.address() as AddressInfo;

  // GET request with no body: a caller-supplied Content-Length must not reach the wire.
  const bodyless = await fetch(`http://localhost:${port}/`, {
    headers: { "Content-Length": "52", "X-Custom": "still-forwarded" },
  });
  expect(await bodyless.text()).toBe("OK");

  // POST request with a real body: the emitted Content-Length is computed from the
  // body, not taken from the caller-supplied header.
  const withBody = await fetch(`http://localhost:${port}/`, {
    method: "POST",
    headers: { "Content-Length": "999" },
    body: "hi",
  });
  expect(await withBody.text()).toBe("OK");

  expect(requests).toHaveLength(2);
  const headerLinesOf = (request: string) =>
    request
      .split("\r\n\r\n")[0]
      .split("\r\n")
      .slice(1)
      .map(line => line.toLowerCase());

  const bodylessHeaders = headerLinesOf(requests[0]);
  // No Content-Length at all on the bodyless request: the bogus value is dropped.
  expect(bodylessHeaders.filter(line => line.startsWith("content-length:"))).toEqual([]);
  // Other caller-supplied headers are still forwarded.
  expect(bodylessHeaders).toContain("x-custom: still-forwarded");

  const withBodyHeaders = headerLinesOf(requests[1]);
  expect(withBodyHeaders.filter(line => line.startsWith("content-length:"))).toEqual(["content-length: 2"]);
});

it("releases interim 1xx response bytes as they are parsed while waiting for the final response", async () => {
  // A misbehaving origin can stream an arbitrarily long sequence of interim (1xx)
  // responses before the final status line. Bytes belonging to interim responses that
  // have already been parsed must be released from the header accumulation buffer as
  // they are consumed, instead of being retained (and re-parsed) for the lifetime of
  // the request. The flood below totals ~48 MB of interim responses, so process RSS
  // must not grow by anywhere near that amount while the request is still waiting for
  // its final status line, and the final response must still be delivered normally.
  const informational = "HTTP/1.1 103 Early Hints\r\nx-filler: " + "a".repeat(1024) + "\r\n\r\n";
  const responseLength = informational.length;
  const writeSize = 256 * 1024 - 13; // never a multiple of responseLength, so writes end mid-response
  const pattern = Buffer.from(informational.repeat(Math.ceil(writeSize / responseLength) + 2), "latin1");
  const floodBytes = 48 * 1024 * 1024;

  let floodedBytes = 0;
  const { promise: floodDone, resolve: floodDoneResolve } = Promise.withResolvers<void>();
  const sockets: net.Socket[] = [];
  const server = net.createServer(socket => {
    sockets.push(socket);
    socket.once("data", () => {
      const writeMore = () => {
        while (floodedBytes < floodBytes) {
          const offset = floodedBytes % responseLength;
          const slice = pattern.subarray(offset, offset + writeSize);
          floodedBytes += slice.length;
          if (!socket.write(slice)) {
            socket.once("drain", writeMore);
            return;
          }
        }
        floodDoneResolve();
      };
      writeMore();
    });
  });
  await once(server.listen(0, "localhost"), "listening");
  const { port } = server.address() as AddressInfo;

  try {
    Bun.gc(true);
    const rssBefore = process.memoryUsage.rss();
    const responsePromise = fetch(`http://localhost:${port}/`);
    await floodDone;
    Bun.gc(true);
    const rssDuringFlood = process.memoryUsage.rss();

    // Complete the partially written interim response, then send the real response.
    const socket = sockets[0];
    const tail = floodedBytes % responseLength;
    if (tail !== 0) socket.write(pattern.subarray(tail, responseLength));
    socket.end("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 4\r\nConnection: close\r\n\r\ndone");

    // The final response after the interim responses is still delivered normally.
    const response = await responsePromise;
    expect(await response.text()).toBe("done");

    // Only a small parse tail may be retained while the interim responses stream in;
    // the ~48 MB of already-consumed 1xx bytes must not accumulate in the process.
    const deltaMB = (rssDuringFlood - rssBefore) / 1024 / 1024;
    // A local `bun bd` debug build is ASAN-instrumented but not named
    // `bun-asan`, so isASAN is false there; its quarantine retains the freed
    // flood bytes the same way - give it the same allowance.
    expect(deltaMB).toBeLessThan(isASAN || isDebug ? 48 : 16);
  } finally {
    for (const socket of sockets) socket.destroy();
    server.close();
  }
}, 60_000);

it("does not reuse a keep-alive connection whose response carried more bytes than its Content-Length", async () => {
  // Surplus bytes past the declared Content-Length mean the connection's framing can
  // no longer be trusted: anything still buffered on (or later delivered to) that
  // socket would be parsed as the response to whichever request next reuses it from
  // the keep-alive pool. The mis-framed response itself is still delivered (truncated
  // to its declared length), but the connection must be closed instead of pooled.
  let connections = 0;
  const sockets: net.Socket[] = [];
  const server = net.createServer(socket => {
    connections++;
    sockets.push(socket);
    let buffered = "";
    socket.on("data", data => {
      buffered += data.toString("latin1");
      while (true) {
        const headerEnd = buffered.indexOf("\r\n\r\n");
        if (headerEnd === -1) break;
        const head = buffered.slice(0, headerEnd);
        buffered = buffered.slice(headerEnd + 4);
        const path = head.split("\r\n")[0].split(" ")[1];
        if (path === "/overshoot") {
          // Declares 5 body bytes but sends those 5 plus a complete pipelined
          // "injected" response that the declared framing never accounted for.
          socket.write(
            "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 5\r\nConnection: keep-alive\r\n\r\nhello" +
              "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 8\r\n\r\ninjected",
          );
        } else {
          socket.write(
            "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 6\r\nConnection: keep-alive\r\n\r\nlegit!",
          );
        }
      }
    });
  });
  await once(server.listen(0, "localhost"), "listening");
  const { port } = server.address() as AddressInfo;

  try {
    // The mis-framed response is still delivered, truncated to its declared length.
    const first = await fetch(`http://localhost:${port}/overshoot`);
    expect(await first.text()).toBe("hello");

    // The follow-up request must go out on a fresh connection, so it can never be
    // answered by the leftover "injected" bytes on the desynchronized socket.
    const second = await fetch(`http://localhost:${port}/after`);
    expect(await second.text()).toBe("legit!");
    expect(connections).toBe(2);

    // A correctly framed keep-alive response is still pooled and reused.
    const third = await fetch(`http://localhost:${port}/again`);
    expect(await third.text()).toBe("legit!");
    expect(connections).toBe(2);
  } finally {
    for (const socket of sockets) socket.destroy();
    server.close();
  }
});

// https://github.com/oven-sh/bun/issues/16682
it("an explicit numeric `timeout` extends the socket idle deadline past the default", async () => {
  // The child runs with a 1s idle default (BUN_CONFIG_HTTP_IDLE_TIMEOUT=1) and
  // talks to an in-process server whose handler holds every request idle for
  // 10s (longer than the worst-case firing window of the 1s idle timer, which
  // is swept on uSockets' 4s tick) before responding.
  //
  //   - `timeout: 60_000` must override the 1s idle default and resolve.
  //   - `timeout: 0` must keep meaning "no timeout" and resolve.
  //   - no `timeout` at all must still hit the 1s idle default (control that
  //     proves the env override and the stall are both real).
  const script = /* js */ `
    const HOLD_MS = 10_000;
    using server = Bun.serve({
      port: 0,
      // Disable Bun.serve's own request idle timeout; only the client-side
      // idle timer under test may abort anything here.
      idleTimeout: 0,
      async fetch(req) {
        const arrived = Date.now();
        // Hold the connection idle (no bytes in either direction) until the
        // hold window has really elapsed on the server's clock.
        while (Date.now() - arrived < HOLD_MS) {
          await Bun.sleep(HOLD_MS - (Date.now() - arrived));
        }
        return new Response("hello");
      },
    });
    const get = init => fetch(server.url, init).then(r => r.text(), e => "ERR:" + (e?.code ?? e?.name ?? e));
    const [withTimeout, withZero, withInfinity, withDefault] = await Promise.all([
      get({ timeout: 60_000 }),
      get({ timeout: 0 }),
      get({ timeout: Infinity }),
      get(undefined),
    ]);
    console.log(JSON.stringify({ withTimeout, withZero, withInfinity, withDefault }));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, BUN_CONFIG_HTTP_IDLE_TIMEOUT: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const out = JSON.parse(stdout.trim().split("\n").pop()!) as Record<string, string>;
  expect({ withTimeout: out.withTimeout, withZero: out.withZero, withInfinity: out.withInfinity }).toEqual({
    withTimeout: "hello",
    withZero: "hello",
    withInfinity: "hello",
  });
  // Control: without an explicit `timeout`, the 1s idle default still aborts
  // the stalled request.
  expect(out.withDefault).toStartWith("ERR:");
  expect(exitCode).toBe(0);
}, 60_000);
