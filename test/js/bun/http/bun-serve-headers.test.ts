import { afterAll, describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { once } from "node:events";
import { request } from "node:http";
import * as net from "node:net";
import { join } from "node:path";
import { brotliCompressSync, deflateSync, gunzipSync, gzipSync, zstdCompressSync } from "node:zlib";

// https://github.com/oven-sh/bun/issues/9180
test("weird headers", async () => {
  using server = Bun.serve({
    port: 0,
    development: false,
    fetch(req) {
      const headers = new Headers();
      req.headers.forEach((value, key) => {
        headers.append(key, value);
      });

      return new Response("OK", {
        headers,
      });
    },
  });

  {
    for (let i = 0; i < 255; i++) {
      const headers = new Headers();
      const name = "X-" + String.fromCharCode(i);
      try {
        headers.set(name, "1");
      } catch {
        continue;
      }

      const res = await fetch(server.url, {
        headers,
      });
      expect(res.headers.get(name)).toBe("1");
    }
  }
});

// https://fetch.spec.whatwg.org/#concept-header-value
// Header values are ByteStrings: U+00E9 goes out as the single byte 0xE9, not as
// UTF-8 0xC3 0xA9. The bytes must not depend on whether JSC stores the string as
// 8-bit (a literal) or 16-bit (TextDecoder, normalize(), JSON.parse output).
describe("response header values are isomorphic-encoded on the wire", () => {
  const eightBit = "caf\u00e9-\u0080\u00ff";
  // A utf-16le decode always yields a 16-bit string, even for latin-1 content.
  const sixteenBit = new TextDecoder("utf-16le").decode(new Uint16Array([0x63, 0x61, 0x66, 0xe9, 0x2d, 0x80, 0xff]));
  const expectedHex = "63 61 66 e9 2d 80 ff";

  async function rawResponse(port: number, path: string): Promise<string> {
    const socket = net.connect(port, "127.0.0.1");
    try {
      socket.on("error", () => {});
      await once(socket, "connect");
      socket.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
      let raw = "";
      await new Promise<void>(resolve => {
        socket.on("data", chunk => (raw += chunk.toString("latin1")));
        socket.on("close", resolve);
      });
      return raw;
    } finally {
      socket.destroy();
    }
  }

  function headerHex(raw: string, name: string): string[] {
    const head = raw.split("\r\n\r\n")[0];
    return head
      .split("\r\n")
      .filter(line => line.toLowerCase().startsWith(name + ":"))
      .map(line =>
        [...Buffer.from(line.slice(name.length + 2), "latin1")].map(c => c.toString(16).padStart(2, "0")).join(" "),
      );
  }

  test("Response headers", async () => {
    expect(sixteenBit).toBe(eightBit);
    using server = Bun.serve({
      port: 0,
      development: false,
      fetch(req) {
        const value = new URL(req.url).pathname === "/16" ? sixteenBit : eightBit;
        return new Response("ok", { headers: { "x-t": value } });
      },
    });

    expect(headerHex(await rawResponse(server.port!, "/8"), "x-t")).toEqual([expectedHex]);
    expect(headerHex(await rawResponse(server.port!, "/16"), "x-t")).toEqual([expectedHex]);

    // A fetch() client reads the same value back, not mojibake.
    const res = await fetch(`http://127.0.0.1:${server.port}/16`);
    expect(res.headers.get("x-t")).toBe(eightBit);
  });

  test("Set-Cookie headers", async () => {
    using server = Bun.serve({
      port: 0,
      development: false,
      fetch(req) {
        const value = new URL(req.url).pathname === "/16" ? sixteenBit : eightBit;
        const headers = new Headers();
        headers.append("set-cookie", `a=${value}`);
        headers.append("set-cookie", `b=${value}`);
        return new Response("ok", { headers });
      },
    });

    const expected = ["61 3d " + expectedHex, "62 3d " + expectedHex];
    expect(headerHex(await rawResponse(server.port!, "/8"), "set-cookie")).toEqual(expected);
    expect(headerHex(await rawResponse(server.port!, "/16"), "set-cookie")).toEqual(expected);
  });

  test("long values and values that start with a non-ASCII char", async () => {
    // 300 ASCII code units, then latin-1, then digits: longer than the writer's inline buffer.
    const units = Array.from({ length: 300 }, (_, i) => 0x41 + (i % 26));
    units.push(0xe9, 0x80, 0xff, ...Array.from({ length: 100 }, (_, i) => 0x30 + (i % 10)));
    const values: Record<string, Uint16Array> = {
      long: new Uint16Array(units),
      lead: new Uint16Array([0xe9, 0x61]),
      ascii: new Uint16Array([0x61, 0x62, 0x63]),
    };
    using server = Bun.serve({
      port: 0,
      development: false,
      fetch(req) {
        const url = new URL(req.url);
        const codeUnits = values[url.pathname.slice(1)];
        const value =
          url.searchParams.get("bits") === "16"
            ? new TextDecoder("utf-16le").decode(codeUnits)
            : String.fromCharCode(...codeUnits);
        return new Response("ok", { headers: { "x-t": value } });
      },
    });

    for (const [name, codeUnits] of Object.entries(values)) {
      const expected = [[...codeUnits].map(c => c.toString(16).padStart(2, "0")).join(" ")];
      expect(headerHex(await rawResponse(server.port!, `/${name}?bits=8`), "x-t")).toEqual(expected);
      expect(headerHex(await rawResponse(server.port!, `/${name}?bits=16`), "x-t")).toEqual(expected);
    }
  });
});

// RFC 9112 §9.6: a server that sends "Connection: close" MUST close the
// connection after that response. Bun was emitting the header but leaving the
// socket in the keep-alive pool, servicing further requests on the "closed"
// connection.
describe("response Connection: close closes the socket", () => {
  async function check(makeResponse: () => Response) {
    let handled = 0;
    using server = Bun.serve({
      port: 0,
      development: false,
      idleTimeout: 0,
      fetch() {
        handled++;
        return makeResponse();
      },
    });

    const socket = net.connect(server.port!, "127.0.0.1");
    try {
      socket.on("error", () => {});
      await once(socket, "connect");
      socket.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");

      // Collect everything the server sends until it closes the connection, or
      // until it services a second request on the same socket (the bug). Either
      // event resolves the promise, so this never relies on a wall-clock wait.
      const result = await new Promise<{ raw: string; closedByServer: boolean }>(resolve => {
        let raw = "";
        let sentSecond = false;
        socket.on("data", chunk => {
          raw += chunk.toString("latin1");
          // Once the first response body has fully arrived, send a follow-up
          // request. A correct server has already closed (or is about to) and
          // will never answer it; a buggy server answers and we resolve below.
          if (!sentSecond && raw.includes("\r\n\r\n") && raw.includes("bye")) {
            sentSecond = true;
            socket.write("GET /second HTTP/1.1\r\nHost: x\r\n\r\n");
          }
          if ((raw.match(/HTTP\/1\.1 200/g) ?? []).length > 1) {
            resolve({ raw, closedByServer: false });
          }
        });
        socket.on("close", () => resolve({ raw, closedByServer: true }));
      });

      const responses = (result.raw.match(/HTTP\/1\.1 200/g) ?? []).length;
      const head = result.raw.split("\r\n\r\n")[0];
      expect(head).toMatch(/\r\nconnection:[^\r\n]*\bclose\b/i);
      expect({ responses, handled, closedByServer: result.closedByServer }).toEqual({
        responses: 1,
        handled: 1,
        closedByServer: true,
      });
    } finally {
      socket.destroy();
    }
  }

  test("string body", async () => {
    await check(() => new Response("bye", { headers: { Connection: "close" } }));
  });

  test("case-insensitive value", async () => {
    await check(() => new Response("bye", { headers: { connection: "Close" } }));
  });

  test("token list", async () => {
    // Connection is 1#connection-option: "close" as one of several tokens must
    // still trigger closure.
    await check(() => new Response("bye", { headers: { Connection: "TE, close" } }));
  });

  test("streaming body", async () => {
    await check(
      () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode("bye"));
              c.close();
            },
          }),
          { headers: { Connection: "close" } },
        ),
    );
  });

  test("keep-alive still the default", async () => {
    // Negative: without Connection: close, a second request on the same socket
    // must be serviced.
    let handled = 0;
    using server = Bun.serve({
      port: 0,
      development: false,
      idleTimeout: 0,
      fetch() {
        handled++;
        return new Response("bye");
      },
    });

    const socket = net.connect(server.port!, "127.0.0.1");
    try {
      socket.on("error", () => {});
      await once(socket, "connect");
      socket.write("GET / HTTP/1.1\r\nHost: x\r\n\r\nGET / HTTP/1.1\r\nHost: x\r\n\r\n");

      let raw = "";
      await new Promise<void>((resolve, reject) => {
        socket.on("data", chunk => {
          raw += chunk.toString("latin1");
          if ((raw.match(/HTTP\/1\.1 200/g) ?? []).length >= 2) resolve();
        });
        socket.on("close", () => reject(new Error("server closed a keep-alive connection")));
      });

      expect(handled).toBe(2);
      expect(raw.toLowerCase()).not.toContain("connection: close");
    } finally {
      socket.destroy();
    }
  });
});

// RFC 9112 9.6. A pooling client that doesn't see "close" reuses the socket and loses its next request.
describe.concurrent("sends Connection: close in the last response on a connection", () => {
  const dir = tempDir("serve-connection-close", {
    "small.txt": "bye",
    // Above the sendfile() threshold on Linux.
    "big.bin": Buffer.alloc(1536 * 1024, 0x61),
  });
  afterAll(() => dir[Symbol.dispose]());
  const smallFile = join(String(dir), "small.txt");
  const bigFile = join(String(dir), "big.bin");

  // Sends `payload`, reads until the server closes, and returns the status line with the Connection and Date lines.
  async function exchange(port: number, payload: string, afterWrite?: () => Promise<void>) {
    const socket = net.connect(port, "127.0.0.1");
    try {
      let raw = "";
      socket.on("data", chunk => (raw += chunk.toString("latin1")));
      const closed = once(socket, "close");
      await once(socket, "connect");
      socket.write(payload);
      await afterWrite?.();
      await closed;
      const [status, ...lines] = raw.split("\r\n\r\n")[0].split("\r\n");
      return {
        status,
        connection: lines.filter(line => /^connection:/i.test(line)).map(line => line.toLowerCase()),
        dates: lines.filter(line => /^date:/i.test(line)).length,
      };
    } finally {
      socket.destroy();
    }
  }

  const stream = () =>
    new ReadableStream({
      async pull(controller) {
        await 1;
        controller.enqueue(new TextEncoder().encode("bye"));
        controller.close();
      },
    });
  const routes = {
    "/static": new Response("bye"),
    "/static-close": new Response("bye", { headers: { connection: "close" } }),
    "/static-304": new Response(null, { status: 304 }),
    "/file-route": new Response(Bun.file(smallFile)),
    "/file-route-big": new Response(Bun.file(bigFile)),
  };
  const handlers: Record<string, () => Response> = {
    "/string": () => new Response("bye"),
    "/204": () => new Response(null, { status: 204 }),
    "/304": () => new Response(null, { status: 304 }),
    "/stream": () => new Response(stream()),
    "/file": () => new Response(Bun.file(smallFile)),
    "/file-big": () => new Response(Bun.file(bigFile)),
    "/close": () => new Response("bye", { headers: { connection: "close" } }),
  };
  const serve = () =>
    Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      development: false,
      routes,
      fetch: req => handlers[new URL(req.url).pathname]?.() ?? new Response("not found", { status: 404 }),
    });

  const paths = [...Object.keys(routes), ...Object.keys(handlers), "/404"];
  test.each([
    [
      "a Connection: close request",
      (method: string, path: string) => `${method} ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`,
    ],
    ["an HTTP/1.0 request", (method: string, path: string) => `${method} ${path} HTTP/1.0\r\nHost: x\r\n\r\n`],
  ])("for %s", async (_name, payload) => {
    using server = serve();
    const results: Record<string, unknown> = {};
    for (const path of paths) {
      for (const method of ["GET", "HEAD"]) {
        const { connection, dates } = await exchange(server.port, payload(method, path));
        results[`${method} ${path}`] = { connection, dates };
      }
    }
    expect(results).toEqual(
      Object.fromEntries(
        paths.flatMap(path =>
          ["GET", "HEAD"].map(method => [`${method} ${path}`, { connection: ["connection: close"], dates: 1 }]),
        ),
      ),
    );
  });

  test("doesn't override the handler's Connection header", async () => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response("bye", { headers: { connection: "keep-alive" } }),
    });
    expect(await exchange(server.port, "GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")).toEqual({
      status: "HTTP/1.1 200 OK",
      connection: ["connection: keep-alive"],
      dates: 1,
    });
  });

  test("doesn't send it on a keep-alive connection", async () => {
    using server = serve();
    const socket = net.connect(server.port, "127.0.0.1");
    try {
      let raw = "";
      const { promise: done, resolve, reject } = Promise.withResolvers<void>();
      socket.on("data", chunk => {
        raw += chunk.toString("latin1");
        if (raw.endsWith("not found")) resolve();
      });
      socket.on("error", reject);
      socket.on("close", () => reject(new Error("the server closed the connection")));
      socket.write(
        ["/static", "/string", "/204", "/404"].map(path => `GET ${path} HTTP/1.1\r\nHost: x\r\n\r\n`).join(""),
      );
      await done;
      expect(raw.match(/HTTP\/1\.1 \d+|\nconnection:.*/gi)).toEqual([
        "HTTP/1.1 200",
        "HTTP/1.1 200",
        "HTTP/1.1 204",
        "HTTP/1.1 404",
      ]);
    } finally {
      socket.destroy();
    }
  });

  test("before a graceful stop() closes the connection", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch() {
        started.resolve();
        await release.promise;
        return new Response("bye");
      },
    });
    let stopped: Promise<void> | undefined;
    const result = await exchange(server.port, "GET / HTTP/1.1\r\nHost: x\r\n\r\n", async () => {
      await started.promise;
      stopped = server.stop();
      release.resolve();
    });
    await stopped;
    expect(result).toEqual({ status: "HTTP/1.1 200 OK", connection: ["connection: close"], dates: 1 });
  });

  // https://github.com/oven-sh/bun/issues/43853
  test("node:http's default agent doesn't reuse the closed socket", async () => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        await req.text();
        return new Response("ok");
      },
    });
    const results: (number | string)[] = [];
    for (let i = 0; i < 4; i++) {
      const { promise, resolve } = Promise.withResolvers<number | string>();
      const req = request(
        { host: "127.0.0.1", port: server.port, path: "/", method: "POST", headers: { connection: "close" } },
        res => {
          res.resume();
          res.on("end", () => resolve(res.statusCode!));
        },
      );
      req.on("error", error => resolve((error as NodeJS.ErrnoException).code!));
      req.end("x");
      results.push(await promise);
    }
    expect(results).toEqual([200, 200, 200, 200]);
  });
});

describe("Content-Encoding of a fetch() Response returned from the handler", () => {
  const payload = Buffer.alloc(2700, "The quick brown fox jumps over the lazy dog. ").toString();
  const gzipped = gzipSync(payload);

  function serveEncoded(encoding: string, body: Uint8Array, contentType = "text/plain") {
    return Bun.serve({
      port: 0,
      fetch: () => new Response(body, { headers: { "content-encoding": encoding, "content-type": contentType } }),
    });
  }

  // `decompress: false` shows the header and the bytes as they are on the wire.
  async function readWire(server: Bun.Server<undefined>, method = "GET") {
    const res = await fetch(`http://127.0.0.1:${server.port}/`, { method, decompress: false });
    return {
      encoding: res.headers.get("content-encoding"),
      length: res.headers.get("content-length"),
      body: Buffer.from(await res.arrayBuffer()).toString("latin1"),
    };
  }

  test.each([
    ["gzip", gzipped],
    ["deflate", deflateSync(payload)],
    ["br", brotliCompressSync(payload)],
    ["zstd", zstdCompressSync(payload)],
  ])("is dropped when fetch() decoded %s", async (encoding, body) => {
    using upstream = serveEncoded(encoding, body);
    let seenByHandler: string | null = null;
    using proxy = Bun.serve({
      port: 0,
      async fetch() {
        const res = await fetch(`http://127.0.0.1:${upstream.port}/`);
        seenByHandler = res.headers.get("content-encoding");
        return res;
      },
    });
    expect(await readWire(proxy)).toEqual({ encoding: null, length: String(payload.length), body: payload });
    expect(seenByHandler).toBe(encoding);
  });

  test("is dropped from a clone", async () => {
    using upstream = serveEncoded("gzip", gzipped);
    using proxy = Bun.serve({
      port: 0,
      fetch: async () => (await fetch(`http://127.0.0.1:${upstream.port}/`)).clone(),
    });
    expect(await readWire(proxy)).toEqual({ encoding: null, length: String(payload.length), body: payload });
  });

  test("is dropped from a static route", async () => {
    using upstream = serveEncoded("gzip", gzipped);
    const response = await fetch(`http://127.0.0.1:${upstream.port}/`);
    // A static route only accepts a fully buffered body.
    await response.clone().arrayBuffer();
    using proxy = Bun.serve({ port: 0, routes: { "/": response } });
    expect(await readWire(proxy)).toEqual({ encoding: null, length: String(payload.length), body: payload });
  });

  test("is dropped after HTMLRewriter.transform()", async () => {
    using upstream = serveEncoded("gzip", gzipSync("<a href=/x>hi</a>"), "text/html");
    using proxy = Bun.serve({
      port: 0,
      fetch: async () =>
        new HTMLRewriter()
          .on("a", { element: el => void el.setAttribute("href", "/y") })
          .transform(await fetch(`http://127.0.0.1:${upstream.port}/`)),
    });
    const { encoding, body } = await readWire(proxy);
    expect({ encoding, body }).toEqual({ encoding: null, body: '<a href="/y">hi</a>' });
  });

  test("is kept with `decompress: false`", async () => {
    using upstream = serveEncoded("gzip", gzipped);
    using proxy = Bun.serve({
      port: 0,
      fetch: () => fetch(`http://127.0.0.1:${upstream.port}/`, { decompress: false }),
    });
    expect(await readWire(proxy)).toEqual({
      encoding: "gzip",
      length: String(gzipped.length),
      body: gzipped.toString("latin1"),
    });
  });

  test("is kept for HEAD, which has no body to decode", async () => {
    using upstream = serveEncoded("gzip", gzipped);
    using proxy = Bun.serve({
      port: 0,
      fetch: req => fetch(`http://127.0.0.1:${upstream.port}/`, { method: req.method }),
    });
    expect(await readWire(proxy, "HEAD")).toEqual({ encoding: "gzip", length: String(gzipped.length), body: "" });
  });

  // With `late`, the upstream holds most of the body back until fetch() has resolved.
  let fetched = Promise.withResolvers<void>();
  function serveGzip(late: boolean) {
    const headers = { "content-encoding": "gzip", "content-type": "text/plain", "x-upstream": "1" };
    if (!late) return Bun.serve({ port: 0, fetch: () => new Response(gzipped, { headers }) });
    return Bun.serve({
      port: 0,
      fetch() {
        fetched = Promise.withResolvers();
        return new Response(
          async function* () {
            yield gzipped.subarray(0, 10);
            await fetched.promise;
            yield gzipped.subarray(10);
          },
          { headers },
        );
      },
    });
  }
  async function fetchUpstream(upstream: Bun.Server<undefined>, init?: BunFetchRequestInit) {
    const res = await fetch(`http://127.0.0.1:${upstream.port}/`, init);
    fetched.resolve();
    return res;
  }

  async function proxied(late: boolean, shapes: Record<string, (res: Response) => Response | Promise<Response>>) {
    using upstream = serveGzip(late);
    using proxy = Bun.serve({
      port: 0,
      fetch: async req =>
        shapes[decodeURIComponent(new URL(req.url).pathname.slice(1))](
          await fetchUpstream(upstream, { decompress: !req.url.endsWith("?raw") }),
        ),
    });
    const seen: Record<string, unknown> = {};
    for (const name of Object.keys(shapes)) {
      for (const raw of ["", "?raw"]) {
        const res = await fetch(`http://127.0.0.1:${proxy.port}/${encodeURIComponent(name)}${raw}`, {
          decompress: false,
        });
        const body = Buffer.from(await res.arrayBuffer());
        seen[name + raw] = {
          encoding: res.headers.get("content-encoding"),
          upstream: res.headers.get("x-upstream"),
          body: body.equals(gzipped) ? "gzip" : body.toString() === payload ? "plain" : body.toString("latin1"),
        };
      }
    }
    return seen;
  }

  const expected = (shapes: object, decoded: object) =>
    Object.fromEntries(
      Object.keys(shapes).flatMap(name => [
        [name, decoded],
        // fetch() left these bytes alone, so the header still describes them.
        [name + "?raw", { encoding: "gzip", upstream: "1", body: "gzip" }],
      ]),
    );

  describe.each([
    ["the body arrives with the head", false],
    ["the body arrives after the head", true],
  ])("%s", (_, late) => {
    test("is dropped from a Response that wraps the decoded body", async () => {
      const shapes: Record<string, (res: Response) => Response> = {
        "new Response(res.body, res)": res => new Response(res.body, res),
        "{ headers: res.headers }": res => new Response(res.body, { headers: res.headers }),
        "{ status, statusText, headers }": res =>
          new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers }),
        "{ headers: new Headers(res.headers) }": res => new Response(res.body, { headers: new Headers(res.headers) }),
        "{ headers: Object.fromEntries(res.headers) }": res =>
          new Response(res.body, { headers: Object.fromEntries(res.headers) }),
        "wrapped twice": res => {
          const once = new Response(res.body, res);
          return new Response(once.body, once);
        },
        "clone of a wrapper": res => new Response(res.body, res).clone(),
        "body of a clone": res => new Response(res.clone().body, res),
        "through a Request": res =>
          new Response(new Request("http://example.com/", { method: "POST", body: res.body }).body, res),
      };
      expect(await proxied(late, shapes)).toEqual(expected(shapes, { encoding: null, upstream: "1", body: "plain" }));
    });

    test("is dropped from both branches of tee()", async () => {
      const shapes: Record<string, (res: Response) => Response> = {
        "first": res => new Response(res.body!.tee()[0], res),
        "second": res => new Response(res.body!.tee()[1], res),
        "tee of a branch": res => new Response(res.body!.tee()[0].tee()[1], res),
      };
      expect(await proxied(late, shapes)).toEqual(expected(shapes, { encoding: null, upstream: "1", body: "plain" }));
    });

    test("is dropped from a Response that wraps the decoded Blob", async () => {
      const shapes: Record<string, (res: Response) => Promise<Response>> = {
        "blob()": async res => new Response(await res.blob(), res),
        "blob().stream()": async res => new Response((await res.blob()).stream(), res),
        "blob().slice()": async res => new Response((await res.blob()).slice(), res),
      };
      expect(await proxied(late, shapes)).toEqual(expected(shapes, { encoding: null, upstream: "1", body: "plain" }));
    });

    // What comes out of a transform is the program's own bytes, and only the program knows their encoding.
    test("is kept on the output of the program's own transform", async () => {
      using upstream = serveGzip(late);
      const shapes: Record<string, (res: Response) => Response> = {
        "CompressionStream, upstream headers": res =>
          new Response(res.body!.pipeThrough(new CompressionStream("gzip")), res),
        "CompressionStream, own header": res =>
          new Response(res.body!.pipeThrough(new CompressionStream("gzip")), {
            headers: { "content-encoding": "gzip" },
          }),
      };
      using proxy = Bun.serve({
        port: 0,
        fetch: async req =>
          shapes[decodeURIComponent(new URL(req.url).pathname.slice(1))](await fetchUpstream(upstream)),
      });
      for (const name of Object.keys(shapes)) {
        const res = await fetch(`http://127.0.0.1:${proxy.port}/${encodeURIComponent(name)}`, { decompress: false });
        expect({
          name,
          encoding: res.headers.get("content-encoding"),
          body: gunzipSync(await res.bytes()).toString(),
        }).toEqual({ name, encoding: "gzip", body: payload });
      }
    });
  });

  test("is kept on bytes the program compressed itself", async () => {
    using upstream = serveGzip(false);
    const own = { headers: { "content-encoding": "gzip" } };
    const shapes: Record<string, () => Response | Promise<Response>> = {
      "bytes": () => new Response(gzipped, own),
      "Blob": () => new Response(new Blob([gzipped]), own),
      "stream": () => new Response(new Blob([gzipped]).stream(), own),
      "wrapped": () => {
        const res = new Response(gzipped, own);
        return new Response(res.body, res);
      },
      "clone": () => new Response(gzipped, own).clone(),
      "fetched, decoded and compressed again": async () => {
        const res = await fetch(`http://127.0.0.1:${upstream.port}/`);
        return new Response(gzipSync(await res.bytes()), res);
      },
    };
    using server = Bun.serve({
      port: 0,
      fetch: req => shapes[decodeURIComponent(new URL(req.url).pathname.slice(1))](),
    });
    for (const name of Object.keys(shapes)) {
      const res = await fetch(`http://127.0.0.1:${server.port}/${encodeURIComponent(name)}`, { decompress: false });
      expect({
        name,
        encoding: res.headers.get("content-encoding"),
        body: gunzipSync(await res.bytes()).toString(),
      }).toEqual({ name, encoding: "gzip", body: payload });
    }
  });

  test("is dropped from a static route that wraps the decoded body", async () => {
    using upstream = serveGzip(false);
    const res = await fetch(`http://127.0.0.1:${upstream.port}/`);
    // A static route only accepts a fully buffered body.
    await res.clone().arrayBuffer();
    using proxy = Bun.serve({ port: 0, routes: { "/": new Response(res.body, res) } });
    expect(await readWire(proxy)).toEqual({ encoding: null, length: String(payload.length), body: payload });
  });
});
