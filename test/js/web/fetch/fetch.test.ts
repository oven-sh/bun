import { AnyFunction, serve, ServeOptions, Server, sleep, TCPSocketListener } from "bun";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { chmodSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, gc, isWindows, tls, tmpdirSync, withoutAggressiveGC } from "harness";
import { mkfifo } from "mkfifo";
import net from "net";
import { join } from "path";
import { gzipSync } from "zlib";

const tmp_dir = tmpdirSync();

const fixture = readFileSync(join(import.meta.dir, "fetch.js.txt"), "utf8").replaceAll("\r\n", "\n");
const fetchFixture3 = join(import.meta.dir, "fetch-leak-test-fixture-3.js");
const fetchFixture4 = join(import.meta.dir, "fetch-leak-test-fixture-4.js");
let server: Server;
function startServer({ fetch, ...options }: ServeOptions) {
  server = serve({
    ...options,
    fetch,
    port: 0,
  });
}

afterEach(() => {
  server?.stop?.(true);
});

afterAll(() => {
  rmSync(tmp_dir, { force: true, recursive: true });
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
    expect(blob.type).toBe("text/plain;charset=utf-8");
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
    expect(blob.type).toBe("text/plain;charset=utf-8");
    expect(blob.text()).resolves.toBe("Hello, World!");

    url = "data:,helloworld!";
    res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.statusText).toBe("OK");
    expect(res.ok).toBe(true);

    blob = await res.blob();
    expect(blob.size).toBe(11);
    expect(blob.type).toBe("text/plain;charset=utf-8");
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
    expect(blob.type).toBe("application/json;charset=utf-8");
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
    expect(blob.type).toBe("application/json;charset=utf-8");
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
    expect(blob.type).toBe("text/plain;charset=utf-8");
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
    expect(blob.type).toBe("text/plain;charset=utf-8");
    expect(blob.text()).resolves.toBe("Hello, World!");

    req = new Request("data:,😀");
    res = await fetch(req);
    expect(res.status).toBe(200);
    expect(res.statusText).toBe("OK");
    expect(res.ok).toBe(true);

    blob = await res.blob();
    expect(blob.size).toBe(4);
    expect(blob.type).toBe("text/plain;charset=utf-8");
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

    expect(async () => {
      async function manualAbort() {
        await sleep(10);
        controller.abort();
      }
      await Promise.all([fetch(server.url, { signal: signal }).then(res => res.text()), manualAbort()]);
    }).toThrow(new DOMException("The operation was aborted."));
  });

  it("AbortErrorWhileUploading", async () => {
    const controller = new AbortController();

    expect(async () => {
      await fetch(`http://localhost:${server.port}`, {
        method: "POST",
        body: new ReadableStream({
          pull(event_controller) {
            event_controller.enqueue(new Uint8Array([1, 2, 3, 4]));
            //this will abort immediately should abort before connected
            controller.abort();
          },
        }),
        signal: controller.signal,
      });
    }).toThrow(new DOMException("The operation was aborted."));
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
    "https://example.com",
    "http://example.com",
    new URL("https://example.com"),
    new Request({ url: "https://example.com" }),
    { toString: () => "https://example.com" } as string,
  ];
  for (let url of urls) {
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
    it(name, async () => {
      gc();
      const response = await fetch(url, { verbose: true });
      gc();
      const text = await response.text();
      gc();
      expect(fixture).toBe(text);
    });
  }

  it('redirect: "manual"', async () => {
    startServer({
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

  it('redirect: "follow"', async () => {
    startServer({
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
      redirect: "follow",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBe(null);
    expect(response.redirected).toBe(true);
  });

  it('redirect: "error" #2819', async () => {
    startServer({
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

  it("should properly redirect to another port #7793", async () => {
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

  it("provide body", async () => {
    startServer({
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
    it(`fail on ${method} with body`, async () => {
      const url = `http://${server.hostname}:${server.port}`;
      expect(async () => {
        await fetch(url, { body: "buntastic" });
      }).toThrow("fetch() request with GET/HEAD/OPTIONS method cannot have body.");
    }),
  );

  it("content length is inferred", async () => {
    startServer({
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

  it("should work with ipv6 localhost", async () => {
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

it("simultaneous HTTPS fetch", async () => {
  const urls = ["https://example.com", "https://www.example.com"];
  for (let batch = 0; batch < 4; batch++) {
    const promises = new Array(20);
    for (let i = 0; i < 20; i++) {
      promises[i] = fetch(urls[i % 2]);
    }
    const result = await Promise.all(promises);
    expect(result.length).toBe(20);
    for (let i = 0; i < 20; i++) {
      expect(result[i].status).toBe(200);
      expect(await result[i].text()).toBe(fixture);
    }
  }
});

it("website with tlsextname", async () => {
  // irony
  await fetch("https://bun.sh", { method: "HEAD" });
});

function testBlobInterface(blobbyConstructor: { (..._: any[]): any }, hasBlobFn?: boolean) {
  for (let withGC of [false, true]) {
    for (let jsonObject of [
      { hello: true },
      {
        hello: "😀 😃 😄 😁 😆 😅 😂 🤣 🥲 ☺️ 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳",
      },
    ]) {
      it(`${jsonObject.hello === true ? "latin1" : "utf16"} json${withGC ? " (with gc) " : ""}`, async () => {
        if (withGC) gc();
        var response = blobbyConstructor(JSON.stringify(jsonObject));
        if (withGC) gc();
        expect(JSON.stringify(await response.json())).toBe(JSON.stringify(jsonObject));
        if (withGC) gc();
      });

      it(`${jsonObject.hello === true ? "latin1" : "utf16"} arrayBuffer -> json${
        withGC ? " (with gc) " : ""
      }`, async () => {
        if (withGC) gc();
        var response = blobbyConstructor(new TextEncoder().encode(JSON.stringify(jsonObject)));
        if (withGC) gc();
        expect(JSON.stringify(await response.json())).toBe(JSON.stringify(jsonObject));
        if (withGC) gc();
      });

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

describe("Bun.file", () => {
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
      expect(async () => await file[m]()).toThrow("Permission denied");
    });

    afterAll(() => {
      rmSync(path, { force: true });
    });
  });

  describe("non-existent file throws", () => {
    const path = join(tmp_dir, "does-not-exist");

    forEachMethod(m => async () => {
      const file = Bun.file(path);
      expect(async () => await file[m]()).toThrow("No such file or directory");
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
  });
  describe("Response.redirect", () => {
    it("works", () => {
      const inputs = [
        "http://example.com",
        "http://example.com/",
        "http://example.com/hello",
        "http://example.com/hello/",
        "http://example.com/hello/world",
        "http://example.com/hello/world/",
      ];
      for (let input of inputs) {
        expect(Response.redirect(input).headers.get("Location")).toBe(input);
      }
    });

    it("supports headers", () => {
      var response = Response.redirect("https://example.com", {
        headers: {
          "content-type": "potato",
          "x-hello": "world",
          Location: "https://wrong.com",
        },
        status: 408,
      });
      expect(response.headers.get("x-hello")).toBe("world");
      expect(response.headers.get("Location")).toBe("https://example.com");
      expect(response.status).toBe(302);
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
      var input = await response.arrayBuffer();
      var output = await Bun.file(import.meta.dir + "/fixtures/file.txt").stream();
      expect(new Uint8Array(input)).toEqual((await output.getReader().read()).value);
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
      },
    });

    expect(headers.get("Authorization")).toBeNull();
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
    },
  });

  expect(headers.get("Authorization")).toEqual("yes");
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

it("should allow very long redirect URLS", async () => {
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

it("304 not modified with missing content-length does not cause a request timeout", async () => {
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

  it("should ignore body on HEAD", async () => {
    const response = await fetch(`http://${getHost()}/text`, { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(response.arrayBuffer()).resolves.toHaveLength(0);
  });
});
describe("fetch Response life cycle", () => {
  it("should not keep Response alive if not consumed", async () => {
    const serverProcess = Bun.spawn({
      cmd: [bunExe(), "--smol", fetchFixture3],
      stderr: "inherit",
      stdout: "pipe",
      stdin: "ignore",
      env: bunEnv,
    });

    async function getServerUrl() {
      const reader = serverProcess.stdout.getReader();
      const { done, value } = await reader.read();
      return new TextDecoder().decode(value);
    }
    const serverUrl = await getServerUrl();
    const clientProcess = Bun.spawn({
      cmd: [bunExe(), "--smol", fetchFixture4, serverUrl],
      stderr: "inherit",
      stdout: "pipe",
      stdin: "ignore",
      env: bunEnv,
    });
    try {
      expect(await clientProcess.exited).toBe(0);
    } finally {
      serverProcess.kill();
    }
  });
  it("should allow to get promise result after response is GC'd", async () => {
    const server = Bun.serve({
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
