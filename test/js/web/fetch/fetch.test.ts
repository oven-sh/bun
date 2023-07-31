import { AnyFunction, serve, ServeOptions, Server, sleep } from "bun";
import { afterAll, afterEach, beforeAll, describe, expect, it, beforeEach } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { mkfifo } from "mkfifo";
import { tmpdir } from "os";
import { join } from "path";
import { gc, withoutAggressiveGC } from "harness";

const tmp_dir = mkdtempSync(join(realpathSync(tmpdir()), "fetch.test"));

const fixture = readFileSync(join(import.meta.dir, "fetch.js.txt"), "utf8");

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
      await Promise.all([
        fetch(`http://127.0.0.1:${server.port}`, { signal: signal }).then(res => res.text()),
        manualAbort(),
      ]);
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
      await Promise.all([
        fetch(`http://127.0.0.1:${server.port}`, { signal: signal }).then(res => res.text()),
        manualAbort(),
      ]);
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
      await Promise.all([
        fetch(`http://127.0.0.1:${server.port}`, { signal: signal }).then(res => res.text()),
        manualAbort(),
      ]);
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
      await fetch(`http://127.0.0.1:${server.port}`, { signal: signal }).then(res => res.text());
      expect(() => {}).toThrow();
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
      const request = new Request(`http://127.0.0.1:${server.port}`, { signal });
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
      ["set-cookie", "foo=bar"],
      ["set-cookie", "bar=baz"],
      ["x-bun", "abc, def"],
    ]);
    expect([...headers.values()]).toEqual(["foo=bar", "bar=baz", "abc, def"]);
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
      ["set-cookie", "foo=bar"],
      ["set-cookie", "bar=baz"],
      ["x-bun", "foo, bar"],
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
    expect(actual).toEqual([
      ["set-cookie", "foo=baz"],
      ["set-cookie", "bar=qat"],
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
    expect(response.redirected).toBe(true);
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

  it("size is Infinity on a fifo", () => {
    const path = join(tmp_dir, "test-fifo");
    mkfifo(path);
    const { size } = Bun.file(path);
    expect(size).toBe(Infinity);
  });

  const method = ["arrayBuffer", "text", "json"] as const;
  function forEachMethod(fn: (m: (typeof method)[number]) => any, skip?: AnyFunction) {
    for (const m of method) {
      (skip ? it.skip : it)(m, fn(m));
    }
  }

  describe("bad permissions throws", () => {
    const path = join(tmp_dir, "my-new-file");
    beforeAll(async () => {
      await Bun.write(path, "hey");
      chmodSync(path, 0o000);
    });

    forEachMethod(
      m => () => {
        const file = Bun.file(path);
        expect(async () => await file[m]()).toThrow("Permission denied");
      },
      () => {
        try {
          readFileSync(path);
        } catch {
          return false;
        }
        return true;
      },
    );
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
      expect(false).toBe(true);
    } catch (exception) {
      expect(exception instanceof SyntaxError).toBe(true);
    }
  });
  describe("should consume body correctly", async () => {
    it("with text first", async () => {
      var response = new Response("<div>hello</div>");
      expect(await response.text()).toBe("<div>hello</div>");
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
      expect(await response.json()).toEqual({ "hello": "world" });
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
      expect(await response.formData()).toBeInstanceOf(FormData);
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
      expect(response.body instanceof ReadableStream).toBe(true);
      expect(response.headers instanceof Headers).toBe(true);
      expect(response.type).toBe("default");
      var blob = await response.blob();
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.stream()).toBeInstanceOf(ReadableStream);
      expect(async () => {
        await response.blob();
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
      expect(await response.arrayBuffer()).toBeInstanceOf(ArrayBuffer);
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
      var stream = Bun.file(import.meta.dir + "/fixtures/file.txt").stream();
      expect(stream instanceof ReadableStream).toBe(true);
      var input = new Response((await new Response(stream).blob()).stream()).arrayBuffer();
      var output = Bun.file(import.meta.dir + "/fixtures/file.txt").arrayBuffer();
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

      var response = await fetch(`http://127.0.0.1:${server.port}`, {
        method: "POST",
        body: await Bun.file(import.meta.dir + "/fixtures/file.txt").arrayBuffer(),
      });
      var input = await response.arrayBuffer();
      var output = await Bun.file(import.meta.dir + "/fixtures/file.txt").stream();
      expect(input).toEqual((await output.getReader().read()).value?.buffer);
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
  expect(await (await fetch(new URL("file with space in the name.txt", import.meta.url))).text()).toEqual(
    await Bun.file(Bun.fileURLToPath(new URL("file with space in the name.txt", import.meta.url))).text(),
  );
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
