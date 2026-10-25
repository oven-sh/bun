import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { isWindows, tempDir, tls } from "harness";
import diagnosticsChannel from "node:diagnostics_channel";
import { EventEmitter, once } from "node:events";
import http from "node:http";
import net from "node:net";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import {
  Agent,
  BalancedPool,
  Client,
  Dispatcher,
  // @ts-ignore undici 5's types don't declare EnvHttpProxyAgent
  EnvHttpProxyAgent,
  getGlobalDispatcher,
  MockAgent,
  // @ts-ignore undici 5's types don't declare ping()
  ping,
  Pool,
  ProxyAgent,
  request,
  // @ts-ignore undici 5's types don't declare RetryAgent
  RetryAgent,
  setGlobalDispatcher,
  stream,
  errors as undiciErrors,
  fetch as undiciFetch,
  Request as UndiciRequest,
  WebSocket as UndiciWebSocket,
} from "undici";

import { createServer } from "../../../http-test-server";
import { deadPort } from "../../bun/http/proxy-stress-helpers";

describe("undici", () => {
  let serverCtl: ReturnType<typeof createServer>;
  let hostUrl: string;
  let port: number;
  let host: string;

  beforeAll(() => {
    serverCtl = createServer();
    port = serverCtl.port!;
    host = `${serverCtl.hostname}:${port}`;
    hostUrl = `http://${host}`;
  });

  afterAll(() => {
    serverCtl.stop();
  });

  describe("request", () => {
    it("should make a GET request when passed a URL string", async () => {
      const { body } = await request(`${hostUrl}/get`);
      expect(body).toBeDefined();
      const json = (await body.json()) as { url: string };
      expect(json.url).toBe(`${hostUrl}/get`);
    });

    it("should error when body has already been consumed", async () => {
      const { body } = await request(`${hostUrl}/get`);
      await body.json();
      expect(body.bodyUsed).toBe(true);
      try {
        await body.json();
        throw new Error("Should have errored");
      } catch (e) {
        expect((e as Error).message).toBe("unusable");
      }
    });

    describe("body stream when a body method took the response", () => {
      // Starts `body` with `start` and resolves with what it emits until "close".
      function eventsUntilClose(body: Readable, start: () => void) {
        const events: unknown[] = [];
        const { promise, resolve } = Promise.withResolvers<unknown[]>();
        body.on("end", () => events.push("end"));
        body.on("error", error => events.push(error));
        body.on("close", () => {
          events.push("close");
          resolve(events);
        });
        start();
        return promise;
      }

      // Serves "first ", then "second" once `secondChunk` resolves.
      function serveTwoChunks(secondChunk: Promise<void>) {
        return Bun.serve({
          port: 0,
          fetch() {
            return new Response(
              new ReadableStream({
                async start(controller) {
                  controller.enqueue(new TextEncoder().encode("first "));
                  await secondChunk;
                  controller.enqueue(new TextEncoder().encode("second"));
                  controller.close();
                },
              }),
            );
          },
        });
      }

      const bodyActions = [
        ["resume", ["end", "close"]],
        ["destroy", ["close"]],
      ] as const;

      // A body method reads the web stream under `body` and keeps it locked. Nothing is left
      // for the node stream, so it ends, as the already-read body of undici does.
      it.each(["arrayBuffer", "blob", "formData", "json", "text"] as const)(
        "ends without an error after %s() consumed it",
        async method => {
          await using server = Bun.serve({
            port: 0,
            fetch(req) {
              if (new URL(req.url).pathname === "/formData") {
                return new Response("a=1", { headers: { "content-type": "application/x-www-form-urlencoded" } });
              }
              return Response.json({ a: 1 });
            },
          });
          const url = new URL(method, server.url).href;

          for (const [action, expected] of bodyActions) {
            const { body } = await request(url);
            await body[method]();
            expect(await eventsUntilClose(body, () => body[action]())).toEqual([...expected]);
          }
          {
            const { body } = await request(url);
            await body[method]();
            expect(await Array.fromAsync(body)).toEqual([]);
          }
        },
      );

      it.each(bodyActions)("%s() leaves a body method that is still reading alone", async (action, expected) => {
        const secondChunk = Promise.withResolvers<void>();
        await using server = serveTwoChunks(secondChunk.promise);

        const { body } = await request(server.url.href);
        const text = body.text();
        const events = await eventsUntilClose(body, () => body[action]());
        secondChunk.resolve();
        expect({ events, text: await text }).toEqual({ events: [...expected], text: "first second" });
      });

      // A body method that rejects still took the stream.
      it.each(bodyActions)("%s() after an aborted text() does not emit an error", async (action, expected) => {
        const secondChunk = Promise.withResolvers<void>();
        await using server = serveTwoChunks(secondChunk.promise);
        const controller = new AbortController();

        const { body } = await request(server.url.href, { signal: controller.signal });
        const text = body.text().then(
          () => "resolved",
          error => error.name,
        );
        controller.abort();
        const outcome = await text;
        const events = await eventsUntilClose(body, () => body[action]());
        secondChunk.resolve();
        expect({ outcome, events }).toEqual({ outcome: "AbortError", events: [...expected] });
      });

      it.each(bodyActions)(
        "%s() after formData() rejected the content type does not emit an error",
        async (action, expected) => {
          await using server = Bun.serve({ port: 0, fetch: () => Response.json({ a: 1 }) });

          const { body } = await request(server.url.href);
          const outcome = await body.formData().then(
            () => "resolved",
            error => error.name,
          );
          const events = await eventsUntilClose(body, () => body[action]());
          expect({ outcome, events }).toEqual({ outcome: "TypeError", events: [...expected] });
        },
      );

      // The lock that the node stream takes itself must not end it.
      it("delivers every chunk of a streamed response", async () => {
        const secondChunk = Promise.withResolvers<void>();
        await using server = serveTwoChunks(secondChunk.promise);

        const { body } = await request(server.url.href);
        const chunks: string[] = [];
        for await (const chunk of body) {
          chunks.push(chunk.toString());
          secondChunk.resolve();
        }
        expect(chunks.join("")).toBe("first second");
      });
    });

    describe("body.dump()", () => {
      it("drains the body and resolves null", async () => {
        const { body } = await request(`${hostUrl}/get`);
        expect(await body.dump()).toBeNull();
        expect(body.bodyUsed).toBe(true);
        expect(body.destroyed).toBe(true);
        expect(await body.dump()).toBeNull();
        expect(await body.text().catch(e => e.message)).toBe("unusable");
      });

      it.each([
        ["a Content-Length", () => new Response(Buffer.alloc(1024 * 1024, "x"))],
        [
          "no Content-Length",
          () =>
            new Response(
              new ReadableStream({
                pull(controller) {
                  controller.enqueue(Buffer.alloc(4096, "x"));
                },
              }),
            ),
        ],
      ])("destroys a body over the limit that has %s and resolves null", async (_, fetch) => {
        await using server = Bun.serve({ port: 0, fetch });
        const { body } = await request(server.url.href);
        expect(await body.dump({ limit: 1024 })).toBeNull();
        expect(body.destroyed).toBe(true);
      });

      it("rejects with the signal's reason", async () => {
        const reason = new Error("stop");
        const aborted = await request(`${hostUrl}/get`);
        expect(await aborted.body.dump({ signal: AbortSignal.abort(reason) } as never).catch(e => e)).toBe(reason);
        aborted.body.destroy();

        await using server = Bun.serve({
          port: 0,
          fetch: () => new Response(new ReadableStream({ start: controller => controller.enqueue(Buffer.from("x")) })),
        });
        const controller = new AbortController();
        const { body } = await request(server.url.href);
        const dumped = body.dump({ signal: controller.signal } as never);
        controller.abort(reason);
        expect(await dumped.catch(e => e)).toBe(reason);
      });

      it("rejects a signal that isn't an AbortSignal", async () => {
        const { body } = await request(`${hostUrl}/get`);
        expect(await body.dump({ signal: 42 } as never).catch(e => e)).toMatchObject({
          code: "UND_ERR_INVALID_ARG",
          message: "signal must be an AbortSignal",
        });
        body.destroy();
      });
    });

    it("body.bytes() resolves with a Uint8Array", async () => {
      await using server = Bun.serve({ port: 0, fetch: () => new Response("hello bytes") });
      const { body } = await request(server.url.href);
      // @ts-ignore undici 5's types don't declare bytes()
      const bytes = await body.bytes();
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(new TextDecoder().decode(bytes)).toBe("hello bytes");
      expect(body.bodyUsed).toBe(true);
    });

    it("should make a POST request when provided a body and POST method", async () => {
      const { body } = await request(`${hostUrl}/post`, {
        method: "POST",
        body: "Hello world",
      });
      expect(body).toBeDefined();
      const json = (await body.json()) as { data: string };
      expect(json.data).toBe("Hello world");
    });

    it("should stream a node:stream Readable body", async () => {
      const firstChunkReceived = Promise.withResolvers<void>();
      await using server = Bun.serve({
        port: 0,
        async fetch(req) {
          const received: number[] = [];
          for await (const chunk of req.body!) {
            received.push(...chunk);
            firstChunkReceived.resolve();
          }
          return Response.json({
            received,
            transferEncoding: req.headers.get("transfer-encoding"),
            contentLength: req.headers.get("content-length"),
          });
        },
      });

      // The second chunk exists only after the server has the first one, so
      // the body has to go out while the Readable is still open.
      async function* chunks() {
        yield Buffer.from([0x00, 0xff, 0xfe]); // not valid UTF-8
        await firstChunkReceived.promise;
        yield "h\u00e9llo"; // string chunks go out as UTF-8
      }

      const { statusCode, body } = await request(server.url.href, {
        method: "POST",
        body: Readable.from(chunks()),
      });
      expect(await body.json()).toEqual({
        received: [0x00, 0xff, 0xfe, ...Buffer.from("h\u00e9llo")],
        transferEncoding: "chunked",
        contentLength: null,
      });
      expect(statusCode).toBe(200);
    });

    it("should accept a URL class object", async () => {
      const { body } = await request(new URL(`${hostUrl}/get`));
      expect(body).toBeDefined();
      const json = (await body.json()) as { url: string };
      expect(json.url).toBe(`${hostUrl}/get`);
    });

    // it("should accept an undici UrlObject", async () => {
    //   // @ts-ignore
    //   const { body } = await request({ protocol: "https:", hostname: host, path: "/get" });
    //   expect(body).toBeDefined();
    //   const json = (await body.json()) as { url: string };
    //   expect(json.url).toBe(`${hostUrl}/get`);
    // });

    it("should prevent body from being attached to GET or HEAD requests", async () => {
      try {
        await request(`${hostUrl}/get`, {
          method: "GET",
          body: "Hello world",
        });
        throw new Error("Should have errored");
      } catch (e) {
        expect((e as Error).message).toBe("Body not allowed for GET or HEAD requests");
      }

      try {
        await request(`${hostUrl}/head`, {
          method: "HEAD",
          body: "Hello world",
        });
        throw new Error("Should have errored");
      } catch (e) {
        expect((e as Error).message).toBe("Body not allowed for GET or HEAD requests");
      }
    });

    // undici's fetch() gives these responses a null body, as the Fetch spec
    // says. undici's request() hands out a body object for every response,
    // and this one is empty.
    it.each([
      ["a 204", "/status/204", 204, {}],
      ["the response to a HEAD request", "/head", 200, { method: "HEAD" as const }],
    ])("%s has no body", async (_, path, expectedStatus, init) => {
      const response = await undiciFetch(`${hostUrl}${path}`, init);
      expect({ status: response.status, body: response.body }).toEqual({ status: expectedStatus, body: null });

      const { statusCode, body } = await request(`${hostUrl}${path}`, init);
      expect(statusCode).toBe(expectedStatus);
      expect(body.bodyUsed).toBe(false);
      expect(await body.text()).toBe("");
      expect(body.bodyUsed).toBe(true);

      const chunks: Uint8Array[] = [];
      for await (const chunk of (await request(`${hostUrl}${path}`, init)).body) chunks.push(chunk);
      expect(chunks).toEqual([]);
    });

    it.each([
      [true, "method must be a string"],
      [123, "method must be a string"],
      [["POST"], "method must be a string"],
      ["GET POST", "invalid request method"],
      [" GET", "invalid request method"],
      ["GET\r\n", "invalid request method"],
      ["CONNECT", "invalid method"],
    ])("rejects the method %p like undici", async (method, message) => {
      const error = await request(`${hostUrl}/get`, { method: method as never }).catch(e => e);
      expect(error).toBeInstanceOf(undiciErrors.InvalidArgumentError);
      expect({ code: error.code, message: error.message }).toEqual({ code: "UND_ERR_INVALID_ARG", message });
    });

    it.each([undefined, null, ""])("sends GET for the method %p", async method => {
      const { body } = await request(`${hostUrl}/get`, { method: method as never });
      expect(await body.json()).toMatchObject({ method: "GET" });
    });

    it("should allow a query string to be passed", async () => {
      const { body } = await request(`${hostUrl}/get?foo=bar`);
      expect(body).toBeDefined();
      const json = (await body.json()) as { args: { foo: string } };
      expect(json.args.foo).toBe("bar");

      const { body: body2 } = await request(`${hostUrl}/get`, {
        query: { foo: "bar" },
      });
      expect(body2).toBeDefined();
      const json2 = (await body2.json()) as { args: { foo: string } };
      expect(json2.args.foo).toBe("bar");
    });

    it("should throw on HTTP 4xx or 5xx error when throwOnError is true", async () => {
      try {
        await request(`${hostUrl}/status/404`, { throwOnError: true });
        throw new Error("Should have errored");
      } catch (e) {
        expect((e as Error).message).toBe("Request failed with status code 404");
      }

      try {
        await request(`${hostUrl}/status/500`, { throwOnError: true });
        throw new Error("Should have errored");
      } catch (e) {
        expect((e as Error).message).toBe("Request failed with status code 500");
      }
    });

    it("should allow us to abort the request with a signal", async () => {
      const controller = new AbortController();
      try {
        setTimeout(() => controller.abort(), 500);
        const req = await request(`${hostUrl}/delay/5`, {
          signal: controller.signal,
        });
        await req.body.json();
        throw new Error("Should have errored");
      } catch (e) {
        expect((e as Error).message).toBe("The operation was aborted.");
      }
    });

    it("should properly append headers to the request", async () => {
      const { body } = await request(`${hostUrl}/headers`, {
        headers: {
          "x-foo": "bar",
        },
      });
      expect(body).toBeDefined();
      const json = (await body.json()) as { headers: { "x-foo": string } };
      expect(json.headers["x-foo"]).toBe("bar");
    });

    // it("should allow the use of FormData", async () => {
    //   const form = new FormData();
    //   form.append("foo", "bar");
    //   const { body } = await request(`${hostUrl}/post`, {
    //     method: "POST",
    //     body: form,
    //   });

    //   expect(body).toBeDefined();
    //   const json = (await body.json()) as { form: { foo: string } };
    //   expect(json.form.foo).toBe("bar");
    // });
  });
});

describe("undici dispatchers", () => {
  let server: ReturnType<typeof Bun.serve>;
  let origin: string;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const { pathname, search } = new URL(req.url);
        if (pathname === "/hang") return new Promise<Response>(() => {});
        if (pathname === "/gzip") {
          return new Response(Bun.gzipSync("gzipped text"), { headers: { "content-encoding": "gzip" } });
        }
        if (pathname === "/compress") return new Response("as sent", { headers: { "content-encoding": "compress" } });
        if (pathname === "/redirect") return Response.redirect("/echo?redirected", 302);
        if (pathname === "/204") return new Response(null, { status: 204 });
        if (pathname === "/first-chunk-only") {
          return new Response(new ReadableStream({ start: controller => controller.enqueue(Buffer.from("first")) }));
        }
        return Response.json(
          { method: req.method, url: pathname + search, headers: req.headers.toJSON(), body: await req.text() },
          { headers: { "x-test": "yes" } },
        );
      },
    });
    origin = `http://127.0.0.1:${server.port}`;
  });

  afterAll(() => server.stop(true));

  describe("request()", () => {
    it.each([Pool, Client])("%p sends the request to its origin", async Dispatcher => {
      const dispatcher = new Dispatcher(origin);
      const opaque = { id: 1 };
      const { statusCode, headers, body, trailers, ...rest } = await dispatcher.request({
        // Ignored, as in undici 6 and later.
        origin: "http://127.0.0.1:1",
        path: "/echo?a=1",
        method: "POST",
        headers: { "x-a": "1" },
        body: "hello",
        opaque,
      });
      expect({ statusCode, test: headers["x-test"], trailers }).toEqual({ statusCode: 200, test: "yes", trailers: {} });
      expect(rest.opaque).toBe(opaque);
      expect(await body.json()).toMatchObject({
        method: "POST",
        url: "/echo?a=1",
        headers: { "x-a": "1" },
        body: "hello",
      });
      await dispatcher.close();
    });

    it("Agent takes the origin from the options", async () => {
      const agent = new Agent();
      const { body } = await agent.request({ origin, path: "/echo", method: "GET" });
      expect(await body.json()).toMatchObject({ method: "GET", url: "/echo" });
      expect(await agent.request({ path: "/echo", method: "GET" }).catch(e => e)).toMatchObject({
        code: "UND_ERR_INVALID_ARG",
        message: "opts.origin must be a non-empty string or URL.",
      });
    });

    it.each([
      ["a flat array", ["x-a", "1", "x-b", "2"], { "x-a": "1", "x-b": "2" }],
      ["an array of one pair", [["x-a", "1"]], { "x-a": "1" }],
      [
        "an array of pairs",
        [
          ["x-a", "1"],
          ["x-b", "2"],
        ],
        { "x-a": "1", "x-b": "2" },
      ],
      ["array values", { "x-a": ["1", "2"], "x-b": undefined }, { "x-a": "1, 2" }],
      ["an iterable of pairs", new Map([["x-a", "1"]]), { "x-a": "1" }],
      ["a Headers object", new Headers({ "x-a": "1" }), { "x-a": "1" }],
    ])("accepts headers as %s", async (_, headers, expected) => {
      const pool = new Pool(origin);
      const { body } = await pool.request({ path: "/echo", method: "GET", headers: headers as never });
      const received = ((await body.json()) as { headers: Record<string, string> }).headers;
      expect({ "x-a": received["x-a"], "x-b": received["x-b"] }).toEqual({ "x-b": undefined, ...expected } as never);
    });

    it("calls the callback instead of returning a promise", async () => {
      const pool = new Pool(origin);
      const { promise, resolve } = Promise.withResolvers<unknown[]>();
      expect(pool.request({ path: "/echo", method: "GET", opaque: 1 }, (...args) => resolve(args))).toBeUndefined();
      const [error, data] = (await promise) as [null, Dispatcher.ResponseData];
      expect(error).toBeNull();
      expect(data.statusCode).toBe(200);
      await data.body.dump();

      const failed = Promise.withResolvers<unknown[]>();
      pool.request({ path: "echo", method: "GET", opaque: 1 }, (...args) => failed.resolve(args));
      expect(await failed.promise).toEqual([expect.objectContaining({ code: "UND_ERR_INVALID_ARG" }), { opaque: 1 }]);
      // @ts-expect-error
      expect(() => pool.request({ path: "/echo", method: "GET" }, 1)).toThrow("invalid callback");
    });

    it.each([
      ["echo", "UND_ERR_INVALID_ARG", "path must be an absolute URL or start with a slash"],
      ["ftp://other.invalid/echo", "UND_ERR_INVALID_ARG", "path must be an absolute URL or start with a slash"],
      [undefined, "UND_ERR_INVALID_ARG", "path must be a string"],
      ["http://other.invalid/echo", "UND_ERR_NOT_SUPPORTED", "An absolute URL as `path` is not yet implemented in Bun"],
      [
        "https://other.invalid/echo",
        "UND_ERR_NOT_SUPPORTED",
        "An absolute URL as `path` is not yet implemented in Bun",
      ],
    ])("rejects the path %p", async (path, code, message) => {
      const error = await new Pool(origin).request({ path: path as never, method: "GET" }).catch(e => e);
      expect({ code: error.code, message: error.message }).toEqual({ code, message });
    });

    it("keeps its origin when the path starts with two slashes", async () => {
      const { statusCode, body } = await new Pool(origin).request({ path: "//other.invalid/echo", method: "GET" });
      expect(statusCode).toBe(200);
      expect(((await body.json()) as { headers: Record<string, string> }).headers.host).toBe(
        `127.0.0.1:${server.port}`,
      );
    });

    it.each([
      [undefined, "Invalid URL: The URL argument must be a non-null object."],
      ["ftp://127.0.0.1", "Invalid URL protocol: the URL must start with `http:` or `https:`."],
      ["http://127.0.0.1/path", "invalid url"],
      ["http://127.0.0.1/?query", "invalid url"],
    ])("Pool and Client reject the origin %p", (badOrigin, message) => {
      for (const Dispatcher of [Pool, Client]) {
        expect(() => new Dispatcher(badOrigin as never)).toThrow(
          expect.objectContaining({ code: "UND_ERR_INVALID_ARG", message }),
        );
      }
    });

    it("drops Content-Encoding and Content-Length from a response whose body was decoded", async () => {
      for (const response of [
        await new Pool(origin).request({ path: "/gzip", method: "GET" }),
        await request(`${origin}/gzip`),
      ]) {
        expect(response.headers["content-encoding"]).toBeUndefined();
        expect(response.headers["content-length"]).toBeUndefined();
        expect(await response.body.text()).toBe("gzipped text");
      }
    });

    it("keeps Content-Encoding and Content-Length of a response whose body was not decoded", async () => {
      for (const response of [
        await new Pool(origin).request({ path: "/compress", method: "GET" }),
        await request(`${origin}/compress`),
      ]) {
        expect(response.headers["content-encoding"]).toBe("compress");
        expect(response.headers["content-length"]).toBe("7");
        expect(await response.body.text()).toBe("as sent");
      }
    });

    it("works the way @elastic/transport uses a Pool", async () => {
      const pool = new Pool(origin, { keepAliveTimeout: 600e3, pipelining: 1 });
      const emitter = new EventEmitter();
      const response = await pool.request({
        path: "/echo",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"query":{}}',
        signal: emitter,
      });
      response.body.setEncoding("utf8");
      let payload = "";
      for await (const chunk of response.body) payload += chunk;
      expect(JSON.parse(payload)).toMatchObject({ method: "POST", body: '{"query":{}}' });
      await pool.close();
    });

    it("accepts a UrlObject", async () => {
      const urls = [
        { origin, path: "/echo?a=1" },
        { origin: `${origin}/`, path: "echo?a=1" },
        { protocol: "http:", hostname: "127.0.0.1", port: server.port, pathname: "/echo", search: "?a=1" },
      ];
      for (const url of urls) {
        expect(await (await request(url)).body.json()).toMatchObject({ url: "/echo?a=1" });
      }
    });

    describe("validates a UrlObject's members like undici", () => {
      const port = "Invalid URL: port must be a valid integer or a string representation of an integer.";
      const protocol = "Invalid URL protocol: the URL must start with `http:` or `https:`.";
      const text = (member: string) => `Invalid URL ${member}: the ${member} must be a string or null/undefined.`;
      it.each<[string, unknown, string]>([
        ...["80@localhost", "80/", "abc", "1e3", "0x50", -1, 65536, 1.5, NaN, true, {}, [], [80, 1]].map(
          (value): [string, unknown, string] => ["port", value, port],
        ),
        ...[undefined, null, "", "ftp:", "http", "HTTP:", "httpx:", 1, {}, ["http:"]].map(
          (value): [string, unknown, string] => ["protocol", value, protocol],
        ),
        ...["hostname", "path", "pathname", "origin"].flatMap(member =>
          [1, true, {}, ["x"]].map((value): [string, unknown, string] => [member, value, text(member)]),
        ),
        ["origin", "ftp://127.0.0.1", protocol],
        ["origin", "HTTP://127.0.0.1", protocol],
      ])("%s, row %#", async (member, value, message) => {
        const url = { protocol: "http:", hostname: "127.0.0.1", port: server.port, [member]: value };
        for (const send of [() => request(url as never), () => stream(url as never, { method: "GET" }, () => null!)]) {
          await expect(send()).rejects.toMatchObject({
            name: "InvalidArgumentError",
            code: "UND_ERR_INVALID_ARG",
            message,
          });
        }
      });

      it.each([() => String(server.port), () => `0${server.port}`, () => [server.port]])(
        "takes a port that converts to an integer",
        async port => {
          const url = { protocol: "http:", hostname: "127.0.0.1", port: port(), path: "/echo" };
          expect(await (await request(url as never)).body.json()).toMatchObject({ url: "/echo" });
        },
      );
    });
  });

  describe("signal", () => {
    it("aborts on the 'abort' event of an EventEmitter and removes its listener", async () => {
      const emitter = new EventEmitter();
      const pending = new Pool(origin).request({ path: "/hang", method: "GET", signal: emitter });
      expect(emitter.listenerCount("abort")).toBe(1);
      emitter.emit("abort");
      expect(await pending.catch(e => e)).toMatchObject({ name: "AbortError", code: "UND_ERR_ABORTED" });
      expect(emitter.listenerCount("abort")).toBe(0);
    });

    it("aborts on an 'abort' event dispatched at a signal that isn't aborted", async () => {
      const { signal } = new AbortController();
      const pending = new Pool(origin).request({ path: "/hang", method: "GET", signal });
      signal.dispatchEvent(new Event("abort"));
      expect(await pending.catch(e => e)).toMatchObject({ name: "AbortError", code: "UND_ERR_ABORTED" });
    });

    it("rejects with the reason of an AbortSignal", async () => {
      const reason = new Error("stop");
      const pool = new Pool(origin);
      expect(
        await pool.request({ path: "/echo", method: "GET", signal: AbortSignal.abort(reason) }).catch(e => e),
      ).toBe(reason);
      const controller = new AbortController();
      const { body } = await pool.request({ path: "/first-chunk-only", method: "GET", signal: controller.signal });
      const text = body.text();
      controller.abort(reason);
      expect(await text.catch(e => e)).toBe(reason);
    });

    it.each(["text", "stream", "dump"])("removes the abort listener once the body was read with %s", async how => {
      const emitter = new EventEmitter();
      const { body } = await new Pool(origin).request({ path: "/echo", method: "GET", signal: emitter });
      expect(emitter.listenerCount("abort")).toBe(1);
      if (how === "text") await body.text();
      else if (how === "dump") await body.dump();
      else await Promise.all([once(body, "close"), body.resume()]);
      expect(emitter.listenerCount("abort")).toBe(0);
    });

    it("removes the abort listener of a body that is dropped unread", async () => {
      const emitter = new EventEmitter().setMaxListeners(0);
      const pool = new Pool(origin);
      for (let i = 0; i < 50; i++) await pool.request({ path: "/echo", method: "GET", signal: emitter });
      while (emitter.listenerCount("abort") >= 10) {
        Bun.gc(true);
        await new Promise(resolve => setImmediate(resolve));
      }
    });

    it("rejects a signal that is neither an EventEmitter nor an EventTarget", async () => {
      expect(await request(`${origin}/echo`, { signal: {} as never }).catch(e => e)).toMatchObject({
        code: "UND_ERR_INVALID_ARG",
        message: "signal must be an EventEmitter or EventTarget",
      });
    });
  });

  describe("close() and destroy()", () => {
    it("throw 'not implemented' on the abstract Dispatcher", () => {
      const dispatcher = new Dispatcher();
      // @ts-expect-error
      expect(() => dispatcher.dispatch()).toThrow("not implemented");
      expect(() => dispatcher.close()).toThrow("not implemented");
      expect(() => dispatcher.destroy()).toThrow("not implemented");
    });

    it.each([
      ["Agent", () => new Agent()],
      ["Pool", () => new Pool(origin)],
      ["Client", () => new Client(origin)],
      ["EnvHttpProxyAgent", () => new EnvHttpProxyAgent()],
      ["RetryAgent", () => new RetryAgent(new Agent())],
      ["the global dispatcher", () => getGlobalDispatcher().constructor === Agent && new Agent()],
    ])("%s closes and destroys", async (_, create) => {
      const closed = create() as Agent;
      expect(await closed.close()).toBeNull();
      expect(await closed.close().catch(e => e)).toMatchObject({ code: "UND_ERR_DESTROYED" });

      const destroyed = create() as Agent;
      expect(await destroyed.destroy()).toBeNull();
      expect(await destroyed.destroy()).toBeNull();
    });

    it("update closed and destroyed", async () => {
      const closed = new Agent();
      expect([closed.closed, closed.destroyed]).toEqual([false, false]);
      const closing = closed.close();
      expect([closed.closed, closed.destroyed]).toEqual([true, false]);
      await closing;
      expect([closed.closed, closed.destroyed]).toEqual([true, true]);

      const destroyed = new Agent();
      await destroyed.destroy();
      expect([destroyed.closed, destroyed.destroyed]).toEqual([false, true]);
    });

    it("call the callback instead of returning a promise", async () => {
      const closed = Promise.withResolvers<unknown[]>();
      expect(new Pool(origin).close((...args: unknown[]) => closed.resolve(args))).toBeUndefined();
      expect(await closed.promise).toEqual([null, null]);

      const destroyed = Promise.withResolvers<unknown[]>();
      expect(new Pool(origin).destroy(new Error("x"), (...args: unknown[]) => destroyed.resolve(args))).toBeUndefined();
      expect(await destroyed.promise).toEqual([null, null]);

      // @ts-expect-error
      expect(() => new Pool(origin).close(1)).toThrow("invalid callback");
      // @ts-expect-error
      expect(() => new Pool(origin).destroy(null, 1)).toThrow("invalid callback");
    });

    it("reject later requests", async () => {
      const closed = new Pool(origin);
      await closed.close();
      const destroyed = new Agent();
      await destroyed.destroy();
      const closing = new Pool(origin);
      const pending = closing.request({ path: "/echo", method: "GET" });
      const close = closing.close();

      expect(await closing.request({ path: "/echo", method: "GET" }).catch(e => e)).toMatchObject({
        name: "ClientClosedError",
        code: "UND_ERR_CLOSED",
      });
      expect(await closed.request({ path: "/echo", method: "GET" }).catch(e => e)).toMatchObject({
        name: "ClientDestroyedError",
        code: "UND_ERR_DESTROYED",
      });
      expect(await request(`${origin}/echo`, { dispatcher: destroyed }).catch(e => e)).toMatchObject({
        code: "UND_ERR_DESTROYED",
      });
      expect((await pending).statusCode).toBe(200);
      await close;
    });

    it("close() waits for the response to a pending request", async () => {
      const arrived = Promise.withResolvers<void>();
      const respond = Promise.withResolvers<Response>();
      using gated = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => (arrived.resolve(), respond.promise) });
      const pool = new Pool(`http://127.0.0.1:${gated.port}`);
      const pending = pool.request({ path: "/", method: "GET" });
      let closed = false;
      const closing = pool.close().then(() => (closed = true));
      await arrived.promise;
      expect(closed).toBe(false);
      respond.resolve(new Response("late"));
      expect(await (await pending).body.text()).toBe("late");
      await closing;
    });

    it("destroy() aborts a pending request", async () => {
      const pool = new Pool(origin);
      const pending = pool.request({ path: "/hang", method: "GET" }).catch(e => e);
      await pool.destroy();
      expect(await pending).toMatchObject({ name: "ClientDestroyedError", code: "UND_ERR_DESTROYED" });

      const agent = new Agent();
      const error = new Error("shutting down");
      const other = agent.request({ origin, path: "/hang", method: "GET" }).catch(e => e);
      await agent.destroy(error);
      expect(await other).toBe(error);
    });

    it("destroy() aborts a response body that is still arriving", async () => {
      const pool = new Pool(origin);
      const { body } = await pool.request({ path: "/first-chunk-only", method: "GET" });
      const text = body.text();
      const error = new Error("shutting down");
      await pool.destroy(error);
      expect(await text.catch(e => e)).toBe(error);
    });
  });

  describe("connections", () => {
    // A raw keep-alive origin that counts its connections and says when each one closes.
    async function keepAliveOrigin() {
      const sockets: net.Socket[] = [];
      const listener = net.createServer(socket => {
        sockets.push(socket);
        socket.on("error", () => {});
        socket.on("data", () => socket.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok"));
      });
      listener.listen(0, "127.0.0.1");
      await once(listener, "listening");
      return {
        origin: `http://127.0.0.1:${(listener.address() as net.AddressInfo).port}`,
        sockets,
        [Symbol.dispose]() {
          for (const socket of sockets) socket.destroy();
          listener.close();
        },
      };
    }
    const get = async (dispatcher: Agent, origin: string) =>
      (await dispatcher.request({ origin, path: "/", method: "GET" })).body.text();

    it.each(["close", "destroy"] as const)("%s() closes the dispatcher's idle connections", async method => {
      using server = await keepAliveOrigin();
      const agent = new Agent();
      expect([await get(agent, server.origin), await get(agent, server.origin)]).toEqual(["ok", "ok"]);
      expect(server.sockets.length).toBe(1);
      const closed = once(server.sockets[0], "close");
      await agent[method]();
      await closed;
    });

    it("are not shared between dispatchers", async () => {
      using server = await keepAliveOrigin();
      const agents = [new Agent(), new Agent()];
      for (const agent of [...agents, ...agents]) expect(await get(agent, server.origin)).toBe("ok");
      expect(server.sockets.length).toBe(2);
      await Promise.all(agents.map(agent => agent.close()));
    });

    it("of fetch() belong to its dispatcher", async () => {
      using server = await keepAliveOrigin();
      const dispatcher = new Agent();
      expect(await (await undiciFetch(server.origin, { dispatcher })).text()).toBe("ok");
      const closed = once(server.sockets[0], "close");
      await dispatcher.close();
      await closed;
    });
  });

  describe("options that aren't own enumerable properties", () => {
    const members = { method: "POST", headers: { "x-from": "options" }, body: "payload" };
    const shapes: [string, (extra: object) => any][] = [
      ["inherited", extra => Object.assign(Object.create(members), extra)],
      [
        "non-enumerable",
        extra => {
          const options = { ...extra };
          for (const name in members) Object.defineProperty(options, name, { value: members[name], enumerable: false });
          return options;
        },
      ],
      [
        "class getters",
        extra =>
          Object.assign(
            new (class {
              get method() {
                return members.method;
              }
              get headers() {
                return members.headers;
              }
              get body() {
                return members.body;
              }
            })(),
            extra,
          ),
      ],
    ];
    const sent = ({ method, headers, body }: any) => ({ method, from: headers["x-from"], body });
    const expected = { method: "POST", from: "options", body: "payload" };

    it.each(shapes)("%s: fetch() with a dispatcher that has connect options", async (_, shape) => {
      const dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
      expect(sent(await (await undiciFetch(`${origin}/echo`, shape({ dispatcher }))).json())).toEqual(expected);
    });

    it.each(shapes)("%s: pool.request()", async (_, shape) => {
      const { body } = await new Pool(origin).request(shape({ path: "/echo" }));
      expect(sent(await body.json())).toEqual(expected);
    });

    it("fetch() with a dispatcher that has connect options honors an inherited signal", async () => {
      const dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
      const init = Object.assign(Object.create({ signal: AbortSignal.abort(new Error("stop")) }), { dispatcher });
      expect(await undiciFetch(`${origin}/echo`, init).catch(e => e.message)).toBe("stop");
    });
  });

  describe("connect options", () => {
    it("apply ca and rejectUnauthorized to the TLS connection", async () => {
      using secure = Bun.serve({ port: 0, hostname: "127.0.0.1", tls, fetch: () => new Response("secure") });
      const secureOrigin = `https://127.0.0.1:${secure.port}`;
      const get = (pool: Pool) => pool.request({ path: "/", method: "GET" }).then(({ body }) => body.text());

      expect(await get(new Pool(secureOrigin, { connect: { ca: tls.cert } }))).toBe("secure");
      expect(await get(new Pool(secureOrigin, { connect: { rejectUnauthorized: false } }))).toBe("secure");
      expect(await get(new Pool(secureOrigin)).catch(e => e.code)).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
    });

    it.skipIf(isWindows)("connect to socketPath", async () => {
      using dir = tempDir("undici-socket-path", {});
      const socketPath = join(String(dir), "undici.sock");
      using unix = Bun.serve({ unix: socketPath, fetch: req => new Response(new URL(req.url).pathname) });
      for (const options of [{ socketPath }, { connect: { socketPath } }]) {
        const { body } = await new Client("http://localhost", options).request({ path: "/over-unix", method: "GET" });
        expect(await body.text()).toBe("/over-unix");
      }
    });

    it("ignores the own properties of a connect function", async () => {
      using secure = Bun.serve({ port: 0, hostname: "127.0.0.1", tls, fetch: () => new Response("secure") });
      const connect = Object.assign(() => {}, { rejectUnauthorized: false });
      const dispatcher = new Agent({ connect });
      expect(
        await undiciFetch(`https://127.0.0.1:${secure.port}/`, { dispatcher }).then(
          response => response.text(),
          e => e.code,
        ),
      ).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
    });

    it("rejects requests through a dispatcher with a connect function, which can't run", async () => {
      const pool = new Pool(origin, { connect: (_options, callback) => callback(new Error("unreached"), null) });
      expect(await pool.request({ path: "/echo", method: "GET" }).catch(e => e)).toMatchObject({
        name: "NotSupportedError",
        code: "UND_ERR_NOT_SUPPORTED",
      });
    });
  });

  describe("stream()", () => {
    function collect() {
      const chunks: Buffer[] = [];
      const writable = new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(chunk);
          callback();
        },
      });
      return { writable, json: () => JSON.parse(Buffer.concat(chunks).toString()) };
    }

    it("pipes the response body into the Writable that the factory returns", async () => {
      const { writable, json } = collect();
      const opaque = { id: 1 };
      let info: Dispatcher.StreamFactoryData | undefined;
      const result = await stream(`${origin}/echo`, { method: "POST", body: "x", opaque }, data => {
        info = data;
        return writable;
      });
      expect(info).toMatchObject({ statusCode: 200, headers: { "x-test": "yes" }, opaque });
      expect(json()).toMatchObject({ method: "POST", body: "x" });
      expect(result).toEqual({ opaque, trailers: {} });
    });

    it("is a method of Pool, Client and Agent", async () => {
      const { writable, json } = collect();
      await new Pool(origin).stream({ path: "/echo", method: "GET" }, () => writable);
      expect(json()).toMatchObject({ method: "GET", url: "/echo" });
    });

    it("rejects a bad factory, a factory that throws and a Writable that fails", async () => {
      const options = { method: "GET" } as const;
      // @ts-expect-error
      expect(await stream(`${origin}/echo`, options, 1).catch(e => e)).toMatchObject({ message: "invalid factory" });
      // @ts-expect-error
      expect(await stream(`${origin}/echo`, options, () => 1).catch(e => e)).toMatchObject({
        code: "UND_ERR_INVALID_RETURN_VALUE",
        message: "expected Writable",
      });
      const error = new Error("disk full");
      expect(
        await stream(`${origin}/echo`, options, () => {
          throw error;
        }).catch(e => e),
      ).toBe(error);
      const failing = new Writable({ write: (_chunk, _encoding, callback) => callback(error) });
      expect(await stream(`${origin}/echo`, options, () => failing).catch(e => e)).toBe(error);
    });
  });

  describe("ProxyAgent", () => {
    // Records what reaches the proxy. Handles absolute-form requests and CONNECT tunnels.
    let proxy: http.Server;
    let proxyUrl: string;
    let proxied: { target: string; authorization?: string; custom?: string }[] = [];

    function record(req: http.IncomingMessage) {
      proxied.push({
        target: req.url!.replace(/^http:\/\//, "").replace(/\/.*$/, ""),
        authorization: req.headers["proxy-authorization"],
        custom: req.headers["x-proxy-header"] as string | undefined,
      });
    }

    // Returns the requests the proxy has seen since the last call.
    function takeProxied() {
      return proxied.splice(0);
    }

    beforeAll(async () => {
      proxy = http.createServer((req, res) => {
        record(req);
        const { hostname, port, pathname, search } = new URL(req.url!);
        const upstream = http.request(
          { host: hostname, port, path: pathname + search, method: req.method, headers: req.headers },
          response => {
            res.writeHead(response.statusCode!, response.headers);
            response.pipe(res);
          },
        );
        upstream.on("error", () => res.destroy());
        req.pipe(upstream);
      });
      proxy.on("connect", (req, socket, head) => {
        record(req);
        const [host, port] = req.url!.split(":");
        const upstream = net.connect(Number(port), host, () => {
          socket.write("HTTP/1.1 200 OK\r\n\r\n");
          upstream.write(head);
          upstream.pipe(socket).pipe(upstream);
        });
        upstream.on("error", () => socket.destroy());
        socket.on("error", () => upstream.destroy());
      });
      await once(proxy.listen(0, "127.0.0.1"), "listening");
      proxyUrl = `http://127.0.0.1:${(proxy.address() as net.AddressInfo).port}`;
    });

    afterAll(() => {
      proxy.closeAllConnections();
      proxy.close();
    });

    it.each([
      ["a string", () => proxyUrl],
      ["a URL", () => new URL(proxyUrl)],
      ["{ uri }", () => ({ uri: proxyUrl })],
    ])("fetch({ dispatcher }) goes through the proxy given as %s", async (_, options) => {
      const response = await undiciFetch(`${origin}/echo`, { dispatcher: new ProxyAgent(options() as string) });
      expect(await response.json()).toMatchObject({ url: "/echo" });
      expect(takeProxied()).toEqual([{ target: `127.0.0.1:${server.port}` }]);
    });

    it("keeps the fields of a Request passed as input or as init", async () => {
      const dispatcher = new ProxyAgent(proxyUrl);
      const create = () => new UndiciRequest(`${origin}/echo`, { method: "POST", body: "body" });
      expect(await (await undiciFetch(create(), { dispatcher })).json()).toMatchObject({
        method: "POST",
        body: "body",
      });
      expect(takeProxied()).toHaveLength(1);

      const previous = getGlobalDispatcher();
      setGlobalDispatcher(dispatcher);
      try {
        // @ts-expect-error A Request as init is a Bun extension.
        expect(await (await undiciFetch(`${origin}/echo`, create())).json()).toMatchObject({
          method: "POST",
          body: "body",
        });
        expect(takeProxied()).toHaveLength(1);
      } finally {
        setGlobalDispatcher(previous);
      }
    });

    it("request({ dispatcher }), request() and stream() of the agent go through the proxy", async () => {
      const dispatcher = new ProxyAgent(proxyUrl);
      await (await request(`${origin}/echo`, { dispatcher })).body.dump();
      expect(takeProxied()).toHaveLength(1);
      await (await dispatcher.request({ origin, path: "/echo", method: "GET" })).body.dump();
      expect(takeProxied()).toHaveLength(1);
      await dispatcher.stream(
        { origin, path: "/echo", method: "GET" },
        () => new Writable({ write: (_c, _e, cb) => cb() }),
      );
      expect(takeProxied()).toHaveLength(1);
      await dispatcher.close();
    });

    it.each([
      ["token", { token: "Bearer secret" }, { authorization: "Bearer secret" }],
      ["auth", { auth: "dXNlcjpwYXNz" }, { authorization: "Basic dXNlcjpwYXNz" }],
      ["headers", { headers: { "x-proxy-header": "value" } }, { custom: "value" }],
    ])("sends %s to the proxy", async (_, options, expected) => {
      await (await undiciFetch(`${origin}/echo`, { dispatcher: new ProxyAgent({ uri: proxyUrl, ...options }) })).text();
      expect(takeProxied()).toEqual([{ target: `127.0.0.1:${server.port}`, ...expected }]);
    });

    it("setGlobalDispatcher() applies it to fetch() and request(), and an explicit dispatcher overrides it", async () => {
      const previous = getGlobalDispatcher();
      setGlobalDispatcher(new ProxyAgent(proxyUrl));
      try {
        await (await undiciFetch(`${origin}/echo`)).text();
        expect(takeProxied()).toHaveLength(1);
        await (await request(`${origin}/echo`)).body.dump();
        expect(takeProxied()).toHaveLength(1);
        await (await undiciFetch(`${origin}/echo`, { dispatcher: new Agent() })).text();
        await (await request(`${origin}/echo`, { dispatcher: new Agent() })).body.dump();
        expect(takeProxied()).toEqual([]);
      } finally {
        setGlobalDispatcher(previous);
      }
    });

    it("RetryAgent uses the proxy of the agent it wraps", async () => {
      await (await undiciFetch(`${origin}/echo`, { dispatcher: new RetryAgent(new ProxyAgent(proxyUrl)) })).text();
      expect(takeProxied()).toHaveLength(1);
    });

    it("fails instead of connecting directly when the proxy is down", async () => {
      using dead = await deadPort();
      const dispatcher = new ProxyAgent(`http://127.0.0.1:${dead.port}`);
      expect(await undiciFetch(`${origin}/echo`, { dispatcher }).catch(e => e.code)).toBe("ECONNREFUSED");
    });

    it("an explicit proxy option of fetch() wins", async () => {
      using dead = await deadPort();
      const dispatcher = new ProxyAgent(`http://127.0.0.1:${dead.port}`);
      // @ts-expect-error `proxy` is a Bun extension.
      await (await undiciFetch(`${origin}/echo`, { dispatcher, proxy: proxyUrl })).text();
      expect(takeProxied()).toHaveLength(1);
    });

    it("applies requestTls to the connection to the origin", async () => {
      using secure = Bun.serve({ port: 0, hostname: "127.0.0.1", tls, fetch: () => new Response("secure") });
      const url = `https://127.0.0.1:${secure.port}/`;
      const trusted = new ProxyAgent({ uri: proxyUrl, requestTls: { ca: tls.cert } });
      expect(await (await undiciFetch(url, { dispatcher: trusted })).text()).toBe("secure");
      expect(await undiciFetch(url, { dispatcher: new ProxyAgent(proxyUrl) }).catch(e => e.code)).toBe(
        "DEPTH_ZERO_SELF_SIGNED_CERT",
      );
      expect(takeProxied()).toEqual(Array(2).fill({ target: `127.0.0.1:${secure.port}` }));
    });

    it("refuses requestTls with an https: proxy, which it would apply to as well", () => {
      expect(() => new ProxyAgent({ uri: "https://127.0.0.1:1", requestTls: { ca: tls.cert } })).toThrow(
        expect.objectContaining({
          name: "InvalidArgumentError",
          code: "UND_ERR_INVALID_ARG",
          message: "requestTls is not supported with an https: proxy",
        }),
      );
      expect(new ProxyAgent({ uri: "https://127.0.0.1:1", requestTls: undefined })).toBeInstanceOf(ProxyAgent);
    });

    describe("sends every request through its proxy, whatever the environment says", () => {
      const discard = () => new Writable({ write: (_chunk, _encoding, callback) => callback() });
      const target = () => `127.0.0.1:${server.port}`;

      async function withEnv(env: Record<string, string>, fn: () => Promise<void>) {
        const previous = Object.keys(env).map(name => [name, process.env[name]] as const);
        Object.assign(process.env, env);
        try {
          await fn();
        } finally {
          for (const [name, value] of previous) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
          }
        }
      }

      it.each<[string, (dispatcher: ProxyAgent) => Promise<unknown>, number]>([
        ["fetch()", dispatcher => undiciFetch(`${origin}/echo`, { dispatcher }).then(res => res.text()), 1],
        [
          "fetch() that follows a redirect",
          d => undiciFetch(`${origin}/redirect`, { dispatcher: d }).then(r => r.text()),
          2,
        ],
        ["request()", dispatcher => request(`${origin}/echo`, { dispatcher }).then(res => res.body.text()), 1],
        ["its own request()", d => d.request({ origin, path: "/echo", method: "GET" }).then(res => res.body.text()), 1],
        ["stream()", dispatcher => stream(`${origin}/echo`, { dispatcher, method: "GET" }, discard), 1],
        [
          "dispatch()",
          dispatcher =>
            new Promise((resolve, reject) => {
              dispatcher.dispatch(
                { origin, path: "/echo", method: "GET" },
                { onConnect() {}, onHeaders: () => true, onData: () => true, onComplete: resolve, onError: reject },
              );
            }),
          1,
        ],
      ])("%s", async (_, send, hops) => {
        for (const exempt of ["127.0.0.1", "*"]) {
          await withEnv({ NO_PROXY: exempt, no_proxy: exempt }, async () => {
            takeProxied();
            await send(new ProxyAgent(proxyUrl));
            expect(takeProxied()).toEqual(Array.from({ length: hops }, () => ({ target: target() })));
          });
        }
      });

      it("EnvHttpProxyAgent follows the environment", async () => {
        const seen: unknown[] = [];
        for (const exempt of ["", "127.0.0.1"]) {
          await withEnv(
            { HTTP_PROXY: proxyUrl, http_proxy: proxyUrl, NO_PROXY: exempt, no_proxy: exempt },
            async () => {
              takeProxied();
              await (await undiciFetch(`${origin}/echo`, { dispatcher: new EnvHttpProxyAgent() })).text();
              seen.push(takeProxied());
            },
          );
        }
        expect(seen).toEqual([[{ target: target() }], []]);
      });
    });

    it.each([
      ["no options", undefined, "Proxy uri is mandatory"],
      ["an empty string", "", "Proxy uri is mandatory"],
      ["options without a uri", {}, "Proxy uri is mandatory"],
      [
        "auth together with token",
        { uri: "http://127.0.0.1:1", auth: "a", token: "b" },
        "opts.auth cannot be used in combination with opts.token",
      ],
    ])("rejects %s", (_, options, message) => {
      expect(() => new ProxyAgent(options as never)).toThrow(
        expect.objectContaining({ code: "UND_ERR_INVALID_ARG", message }),
      );
    });

    it("leaves fetch() alone for a global dispatcher that isn't one of undici's", async () => {
      const previous = getGlobalDispatcher();
      setGlobalDispatcher(new MockAgent());
      try {
        expect(await (await undiciFetch(`${origin}/echo`)).json()).toMatchObject({ url: "/echo" });
      } finally {
        setGlobalDispatcher(previous);
      }
    });

    it("fetch({ dispatcher }) applies the connect options of an Agent", async () => {
      using secure = Bun.serve({ port: 0, hostname: "127.0.0.1", tls, fetch: () => new Response("secure") });
      const dispatcher = new Agent({ connect: { ca: tls.cert } });
      expect(await (await undiciFetch(`https://127.0.0.1:${secure.port}/`, { dispatcher })).text()).toBe("secure");
    });
  });

  describe("dispatch()", () => {
    type Event = [name: string, ...details: unknown[]];

    // Runs one dispatch() with the handler interface of undici 6 and resolves with the calls it received.
    function dispatchLegacy(
      dispatcher: Dispatcher,
      options: Partial<Dispatcher.DispatchOptions>,
      hooks: {
        onConnect?: (abort: (err?: Error) => void) => void;
        onHeaders?: (resume: () => void) => boolean | void;
        onData?: (chunk: Buffer) => boolean | void;
      } = {},
    ) {
      const events: Event[] = [];
      const { promise, resolve } = Promise.withResolvers<Event[]>();
      const returned = dispatcher.dispatch(
        options as Dispatcher.DispatchOptions,
        {
          onConnect(abort) {
            events.push(["onConnect"]);
            hooks.onConnect?.(abort);
          },
          onHeaders(statusCode, rawHeaders, resume, statusText) {
            const isBuffers = rawHeaders!.every(Buffer.isBuffer);
            events.push(["onHeaders", statusCode, statusText, isBuffers, rawHeaders!.join("|").includes("x-test|yes")]);
            return hooks.onHeaders?.(resume) ?? true;
          },
          onData(chunk) {
            events.push(["onData", chunk.toString()]);
            return hooks.onData?.(chunk) ?? true;
          },
          onComplete(trailers) {
            events.push(["onComplete", trailers]);
            resolve(events);
          },
          onError(error) {
            events.push(["onError", error]);
            resolve(events);
          },
        } as Dispatcher.DispatchHandlers,
      );
      return { events, returned, done: promise };
    }
    const names = (events: Event[]) => events.map(([name]) => name);

    it("calls onConnect, onHeaders, onData and onComplete", async () => {
      const pool = new Pool(origin);
      const { returned, done } = dispatchLegacy(pool, {
        path: "/echo",
        method: "POST",
        body: "payload",
        headers: new Headers({ "x-a": "1" }) as never,
      });
      expect(returned).toBe(true);
      const events = await done;
      expect(names(events)).toEqual(["onConnect", "onHeaders", "onData", "onComplete"]);
      expect(events[1]).toEqual(["onHeaders", 200, "OK", true, true]);
      expect(JSON.parse(events[2][1] as string)).toMatchObject({
        method: "POST",
        body: "payload",
        headers: { "x-a": "1" },
      });
      expect(events[3]).toEqual(["onComplete", []]);
      await pool.close();
    });

    it("calls the controller callbacks of undici 7", async () => {
      const events: Event[] = [];
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      new Agent().dispatch({ origin, path: "/echo", method: "GET" }, {
        onRequestStart(controller: any) {
          events.push(["onRequestStart", controller.aborted, controller.paused, controller.reason]);
        },
        onResponseStart(_controller: any, statusCode: number, headers: Record<string, string>, statusText: string) {
          events.push(["onResponseStart", statusCode, headers["x-test"], statusText]);
        },
        onResponseData(_controller: any, chunk: Buffer) {
          events.push(["onResponseData", JSON.parse(chunk.toString()).url]);
        },
        onResponseEnd(_controller: any, trailers: unknown) {
          events.push(["onResponseEnd", trailers]);
          resolve();
        },
        onResponseError: (_controller: any, error: Error) => reject(error),
      } as never);
      await promise;
      expect(events).toEqual([
        ["onRequestStart", false, false, null],
        ["onResponseStart", 200, "yes", "OK"],
        ["onResponseData", "/echo"],
        ["onResponseEnd", {}],
      ]);
    });

    it("controller.pause() holds the body until resume(), and abort() ends in onResponseError", async () => {
      const events: string[] = [];
      const { promise, resolve } = Promise.withResolvers<[boolean, Error]>();
      const error = new Error("enough");
      new Pool(origin).dispatch({ path: "/echo", method: "GET" }, {
        onRequestStart() {},
        onResponseStart(controller: any) {
          controller.pause();
          setImmediate(() => {
            events.push("resume");
            controller.resume();
          });
        },
        onResponseData(controller: any) {
          events.push("data");
          controller.abort(error);
        },
        onResponseEnd: () => events.push("end"),
        onResponseError: (controller: any, err: Error) => resolve([controller.aborted, err]),
      } as never);
      expect(await promise).toEqual([true, error]);
      expect(events).toEqual(["resume", "data"]);
    });

    it("returning false from onHeaders or onData holds the body until resume()", async () => {
      const order: string[] = [];
      let resume!: () => void;
      const { done } = dispatchLegacy(
        new Pool(origin),
        { path: "/echo", method: "GET" },
        {
          onHeaders(resumeBody) {
            resume = resumeBody;
            setImmediate(() => (order.push("resumed after onHeaders"), resume()));
            return false;
          },
          onData() {
            order.push("onData");
            setImmediate(() => (order.push("resumed after onData"), resume()));
            return false;
          },
        },
      );
      expect(names(await done)).toEqual(["onConnect", "onHeaders", "onData", "onComplete"]);
      expect(order).toEqual(["resumed after onHeaders", "onData", "resumed after onData"]);
    });

    it.each(["onConnect", "onHeaders", "onData"] as const)("abort() from %s ends in onError", async where => {
      const error = new Error("stop");
      let abort!: (err?: Error) => void;
      const { done } = dispatchLegacy(
        new Pool(origin),
        { path: "/echo", method: "GET" },
        {
          onConnect(abortRequest) {
            abort = abortRequest;
            if (where === "onConnect") abort(error);
          },
          onHeaders: () => (where === "onHeaders" ? abort(error) : undefined),
          onData: () => (where === "onData" ? abort(error) : undefined),
        },
      );
      const events = await done;
      expect(events.at(-1)).toEqual(["onError", error]);
      expect(names(events).slice(0, -1).at(-1)).toBe(where);
    });

    it("abort() without a reason reports a RequestAbortedError", async () => {
      const { done } = dispatchLegacy(
        new Pool(origin),
        { path: "/echo", method: "GET" },
        { onConnect: abort => abort() },
      );
      expect((await done).at(-1)![1]).toMatchObject({ name: "AbortError", code: "UND_ERR_ABORTED" });
    });

    it("reports an error that a handler callback throws", async () => {
      const error = new Error("handler bug");
      const { done } = dispatchLegacy(
        new Pool(origin),
        { path: "/echo", method: "GET" },
        {
          onHeaders() {
            throw error;
          },
        },
      );
      expect((await done).at(-1)).toEqual(["onError", error]);
    });

    it.each([
      ["a path without a slash", { path: "echo", method: "GET" }, "path must be an absolute URL or start with a slash"],
      ["a method that isn't a token", { path: "/echo", method: "A B" }, "invalid request method"],
      ["no origin on an Agent", { path: "/echo", method: "GET" }, "opts.origin must be a non-empty string or URL."],
    ])("reports %s to onError and returns false", (name, options, message) => {
      const dispatcher = name.includes("Agent") ? new Agent() : new Pool(origin);
      const { returned, events } = dispatchLegacy(dispatcher, options as never);
      expect(returned).toBe(false);
      expect(events).toEqual([["onError", expect.objectContaining({ code: "UND_ERR_INVALID_ARG", message })]]);
    });

    it("validates its arguments", () => {
      const pool = new Pool(origin);
      // @ts-expect-error
      expect(() => pool.dispatch({ path: "/", method: "GET" })).toThrow("handler must be an object");
      // @ts-expect-error
      expect(() => pool.dispatch(null, {})).toThrow("opts must be an object.");
      // @ts-expect-error
      expect(() => pool.dispatch({ path: "/", method: "GET" }, {})).toThrow("invalid onError method");
    });

    it("reports ClientClosedError and ClientDestroyedError after close() and destroy()", async () => {
      const pool = new Pool(origin);
      const first = dispatchLegacy(pool, { path: "/echo", method: "GET" });
      const closing = pool.close();
      const second = dispatchLegacy(pool, { path: "/echo", method: "GET" });
      expect(second.returned).toBe(false);
      expect(second.events).toEqual([["onError", expect.objectContaining({ code: "UND_ERR_CLOSED" })]]);
      // close() waits for the whole response of a dispatch().
      let closed = false;
      closing.then(() => (closed = true));
      await first.done;
      expect(closed).toBe(false);
      await closing;
      expect(dispatchLegacy(pool, { path: "/echo", method: "GET" }).events).toEqual([
        ["onError", expect.objectContaining({ code: "UND_ERR_DESTROYED" })],
      ]);
    });

    it.each(["/hang", "/first-chunk-only"])("destroy() aborts the dispatch of %s", async path => {
      const pool = new Pool(origin);
      const received = Promise.withResolvers<void>();
      const { done, events } = dispatchLegacy(pool, { path, method: "GET" }, { onData: () => received.resolve() });
      if (path !== "/hang") await received.promise;
      const error = new Error("shutting down");
      await pool.destroy(error);
      expect(events.at(-1)).toEqual(["onError", error]);
      await done;
    });

    it("sends no onData for a HEAD request or a 204", async () => {
      const pool = new Pool(origin);
      for (const options of [
        { path: "/echo", method: "HEAD" },
        { path: "/204", method: "GET" },
      ]) {
        expect(names(await dispatchLegacy(pool, options as never).done)).toEqual([
          "onConnect",
          "onHeaders",
          "onComplete",
        ]);
      }
    });
  });

  describe("fetch() with a dispatcher that has its own dispatch()", () => {
    // What miniflare does: rewrite each request and hand it to a Pool.
    class Forward extends Dispatcher {
      seen: unknown[] = [];
      constructor(readonly pool: Pool) {
        super();
      }
      dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandlers) {
        this.seen.push([String(options.origin), options.path, options.method]);
        options.headers = new Headers({
          ...(options.headers as Record<string, string>),
          "x-forwarded-by": "custom",
        }) as never;
        return this.pool.dispatch(options, handler);
      }
      close() {
        return this.pool.close();
      }
      destroy() {
        return this.pool.destroy();
      }
    }

    it("sends the request through dispatch()", async () => {
      const dispatcher = new Forward(new Pool(origin));
      const response = await undiciFetch("http://user.example/echo?a=1", {
        dispatcher,
        method: "POST",
        body: "data",
        headers: { "x-own": "1" },
      });
      expect(dispatcher.seen).toEqual([["http://user.example", "/echo?a=1", "POST"]]);
      expect([response.status, response.ok, response.headers.get("x-test"), response.url]).toEqual([
        200,
        true,
        "yes",
        "http://user.example/echo?a=1",
      ]);
      expect(await response.json()).toMatchObject({
        method: "POST",
        url: "/echo?a=1",
        body: "data",
        headers: { "x-own": "1", "x-forwarded-by": "custom", "content-length": "4" },
      });
      await dispatcher.close();
    });

    it("takes the fields of a Request", async () => {
      const dispatcher = new Forward(new Pool(origin));
      const response = await undiciFetch(new UndiciRequest(`${origin}/echo`, { method: "PUT", body: "rq" }), {
        dispatcher,
      });
      expect(await response.json()).toMatchObject({
        method: "PUT",
        body: "rq",
        headers: { "x-forwarded-by": "custom" },
      });
    });

    it("calls the dispatch() of a subclass of Agent, and of the global dispatcher", async () => {
      class Counting extends Agent {
        count = 0;
        dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandlers) {
          this.count++;
          return super.dispatch(options, handler);
        }
      }
      const dispatcher = new Counting();
      expect(await (await undiciFetch(`${origin}/echo`, { dispatcher })).json()).toMatchObject({ url: "/echo" });
      expect(dispatcher.count).toBe(1);

      const previous = getGlobalDispatcher();
      setGlobalDispatcher(dispatcher);
      try {
        await (await undiciFetch(`${origin}/echo`)).text();
        expect(dispatcher.count).toBe(2);
      } finally {
        setGlobalDispatcher(previous);
      }
    });

    it("request() and stream() go through it too", async () => {
      const dispatcher = new Forward(new Pool(origin));
      const { body } = await request(`${origin}/echo`, { dispatcher, method: "POST", body: "data", query: { a: "1" } });
      expect(await body.json()).toMatchObject({
        method: "POST",
        url: "/echo?a=1",
        body: "data",
        headers: { "x-forwarded-by": "custom" },
      });

      class Counting extends Pool {
        count = 0;
        dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandlers) {
          this.count++;
          return super.dispatch(options, handler);
        }
      }
      const counting = new Counting(origin);
      expect(await (await counting.request({ path: "/echo", method: "GET" })).body.json()).toMatchObject({
        url: "/echo",
      });
      await counting.stream({ path: "/echo", method: "GET" }, () => new Writable({ write: (_c, _e, cb) => cb() }));
      expect(counting.count).toBe(2);
      await counting.close();
    });

    it("streams a large response body", async () => {
      using big = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(Buffer.alloc(1 << 20, "b")) });
      const dispatcher = new Forward(new Pool(`http://127.0.0.1:${big.port}`));
      const response = await undiciFetch(`http://127.0.0.1:${big.port}/`, { dispatcher });
      expect((await response.arrayBuffer()).byteLength).toBe(1 << 20);
    });

    it("has no body for a 204 or a HEAD request", async () => {
      const dispatcher = new Forward(new Pool(origin));
      const noContent = await undiciFetch(`${origin}/204`, { dispatcher });
      expect([noContent.status, noContent.body]).toEqual([204, null]);
      const head = await undiciFetch(`${origin}/echo`, { dispatcher, method: "HEAD" });
      expect([head.status, head.body]).toEqual([200, null]);
    });

    it("honors redirect", async () => {
      const dispatcher = new Forward(new Pool(origin));
      const followed = await undiciFetch(`${origin}/redirect`, { dispatcher });
      expect(await followed.json()).toMatchObject({ url: "/echo?redirected" });
      const manual = await undiciFetch(`${origin}/redirect`, { dispatcher, redirect: "manual" });
      expect([manual.status, manual.headers.get("location")]).toEqual([302, "/echo?redirected"]);
      expect(await undiciFetch(`${origin}/redirect`, { dispatcher, redirect: "error" }).catch(e => e)).toBeInstanceOf(
        TypeError,
      );
    });

    it.each([
      ["ignores the abort", true],
      ["never calls onConnect()", false],
    ])("redirect: 'error' rejects at a redirect from a dispatcher that %s", async (_, connects) => {
      class Canned extends Dispatcher {
        dispatch(_options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandlers) {
          if (connects) handler.onConnect!(() => {});
          queueMicrotask(() => {
            handler.onHeaders!(302, [Buffer.from("location"), Buffer.from("/echo")], () => {}, "Found");
            handler.onComplete!([]);
          });
          return true;
        }
      }
      const failure = await undiciFetch(`${origin}/`, { dispatcher: new Canned(), redirect: "error" }).catch(e => e);
      expect(failure).toBeInstanceOf(TypeError);
      expect(failure.message).toBe("unexpected redirect");
    });

    it.each([
      ["ignores the abort", true],
      ["never calls onConnect()", false],
    ])("rejects with the signal's reason through a dispatcher that %s", async (_, connects) => {
      const dispatched = Promise.withResolvers<void>();
      class Silent extends Dispatcher {
        dispatch(_options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandlers) {
          if (connects) handler.onConnect!(() => {});
          dispatched.resolve();
          return true;
        }
      }
      const controller = new AbortController();
      const reason = new Error("stop");
      const pending = undiciFetch(`${origin}/`, { dispatcher: new Silent(), signal: controller.signal }).catch(e => e);
      await dispatched.promise;
      controller.abort(reason);
      expect(await pending).toBe(reason);
    });

    it("rejects with the signal's reason, before and during the request", async () => {
      const dispatcher = new Forward(new Pool(origin));
      const reason = new Error("stop");
      expect(await undiciFetch(`${origin}/echo`, { dispatcher, signal: AbortSignal.abort(reason) }).catch(e => e)).toBe(
        reason,
      );
      expect(dispatcher.seen).toEqual([]);

      const controller = new AbortController();
      const pending = undiciFetch(`${origin}/hang`, { dispatcher, signal: controller.signal });
      controller.abort(reason);
      expect(await pending.catch(e => e)).toBe(reason);
    });

    it("errors the body when the signal aborts after the response, and aborts the request when the body is canceled", async () => {
      const dispatcher = new Forward(new Pool(origin));
      const controller = new AbortController();
      const reason = new Error("stop");
      const aborted = await undiciFetch(`${origin}/first-chunk-only`, { dispatcher, signal: controller.signal });
      const text = aborted.text();
      controller.abort(reason);
      expect(await text.catch(e => e)).toBe(reason);

      const canceled = await undiciFetch(`${origin}/first-chunk-only`, { dispatcher });
      await canceled.body!.cancel();
      // Resolves only if the canceled request is no longer pending.
      await dispatcher.close();
    });

    it("rejects with the error that the dispatcher reports", async () => {
      using dead = await deadPort();
      const dispatcher = new Forward(new Pool(`http://127.0.0.1:${dead.port}`));
      expect(await undiciFetch(`http://127.0.0.1:${dead.port}/`, { dispatcher }).catch(e => e.code)).toBe(
        "ECONNREFUSED",
      );
    });

    it("RetryAgent forwards dispatch(), request(), close() and destroy()", async () => {
      const inner = new Forward(new Pool(origin));
      const dispatcher = new RetryAgent(inner);
      expect(await (await undiciFetch(`${origin}/echo`, { dispatcher })).json()).toMatchObject({
        headers: { "x-forwarded-by": "custom" },
      });
      const native = new RetryAgent(new Pool(origin));
      expect((await native.request({ path: "/echo", method: "GET" })).statusCode).toBe(200);
      await dispatcher.close();
      expect(inner.pool.closed).toBe(true);
    });

    it.each([
      ["BalancedPool", () => new BalancedPool(origin)],
      ["Dispatcher", () => new Dispatcher()],
    ])("sends the request natively when the dispatcher is a %s without its own dispatch()", async (_, create) => {
      expect((await undiciFetch(`${origin}/echo`, { dispatcher: create() })).status).toBe(200);
      expect((await request(`${origin}/echo`, { dispatcher: create() })).statusCode).toBe(200);
      const previous = getGlobalDispatcher();
      setGlobalDispatcher(create());
      try {
        expect((await undiciFetch(`${origin}/echo`)).status).toBe(200);
      } finally {
        setGlobalDispatcher(previous);
      }
    });
  });
});

describe("undici.errors", () => {
  // undici 5's types lack some of the classes and constructor arguments.
  const errors: Record<string, any> = undiciErrors;

  it.each([
    ["AbortError", "AbortError", "UND_ERR_ABORT", "The operation was aborted"],
    [
      "BalancedPoolMissingUpstreamError",
      "MissingUpstreamError",
      "UND_ERR_BPL_MISSING_UPSTREAM",
      "No upstream has been added to the BalancedPool",
    ],
    ["BodyTimeoutError", "BodyTimeoutError", "UND_ERR_BODY_TIMEOUT", "Body Timeout Error"],
    ["ClientClosedError", "ClientClosedError", "UND_ERR_CLOSED", "The client is closed"],
    ["ClientDestroyedError", "ClientDestroyedError", "UND_ERR_DESTROYED", "The client is destroyed"],
    ["ConnectTimeoutError", "ConnectTimeoutError", "UND_ERR_CONNECT_TIMEOUT", "Connect Timeout Error"],
    ["HeadersOverflowError", "HeadersOverflowError", "UND_ERR_HEADERS_OVERFLOW", "Headers Overflow Error"],
    ["HeadersTimeoutError", "HeadersTimeoutError", "UND_ERR_HEADERS_TIMEOUT", "Headers Timeout Error"],
    ["InformationalError", "InformationalError", "UND_ERR_INFO", "Request information"],
    ["InvalidArgumentError", "InvalidArgumentError", "UND_ERR_INVALID_ARG", "Invalid Argument Error"],
    [
      "InvalidReturnValueError",
      "InvalidReturnValueError",
      "UND_ERR_INVALID_RETURN_VALUE",
      "Invalid Return Value Error",
    ],
    ["NotSupportedError", "NotSupportedError", "UND_ERR_NOT_SUPPORTED", "Not supported error"],
    ["RequestAbortedError", "AbortError", "UND_ERR_ABORTED", "Request aborted"],
    [
      "RequestContentLengthMismatchError",
      "RequestContentLengthMismatchError",
      "UND_ERR_REQ_CONTENT_LENGTH_MISMATCH",
      "Request body length does not match content-length header",
    ],
    ["RequestRetryError", "RequestRetryError", "UND_ERR_REQ_RETRY", "Request retry error"],
    [
      "ResponseContentLengthMismatchError",
      "ResponseContentLengthMismatchError",
      "UND_ERR_RES_CONTENT_LENGTH_MISMATCH",
      "Response body length does not match content-length header",
    ],
    [
      "ResponseExceededMaxSizeError",
      "ResponseExceededMaxSizeError",
      "UND_ERR_RES_EXCEEDED_MAX_SIZE",
      "Response content exceeded max size",
    ],
    [
      "ResponseStatusCodeError",
      "ResponseStatusCodeError",
      "UND_ERR_RESPONSE_STATUS_CODE",
      "Response Status Code Error",
    ],
    ["SocketError", "SocketError", "UND_ERR_SOCKET", "Socket error"],
  ])("%s has undici's name, code and default message", (className, name, code, defaultMessage) => {
    const ErrorClass = errors[className];
    expect(ErrorClass.name).toBe(className);
    const error = new ErrorClass();
    expect(error).toBeInstanceOf(errors.UndiciError);
    expect({ name: error.name, code: error.code, message: error.message }).toEqual({
      name,
      code,
      message: defaultMessage,
    });
    expect(new ErrorClass("custom")).toMatchObject({ name, code, message: "custom" });
  });

  it("keeps the extra constructor arguments", () => {
    expect(new errors.RequestAbortedError()).toBeInstanceOf(errors.AbortError);
    expect(new errors.UndiciError("custom")).toMatchObject({ name: "UndiciError", code: "UND_ERR", message: "custom" });
    expect(new errors.HTTPParserError("bad", "INVALID_CONSTANT", Buffer.from("x"))).toMatchObject({
      name: "HTTPParserError",
      code: "HPE_INVALID_CONSTANT",
      data: "x",
    });
    expect(new errors.SocketError("other side closed", { remotePort: 80 }).socket).toEqual({ remotePort: 80 });
    expect(new errors.ResponseStatusCodeError("bad", 500, { a: "b" }, "body")).toMatchObject({
      status: 500,
      statusCode: 500,
      headers: { a: "b" },
      body: "body",
    });
    expect(new errors.RequestRetryError("retry", 503, { headers: { a: "b" }, data: { count: 1 } })).toMatchObject({
      statusCode: 503,
      headers: { a: "b" },
      data: { count: 1 },
    });
    const cause = new Error("tls");
    expect(new errors.SecureProxyConnectionError(cause)).toMatchObject({
      name: "SecureProxyConnectionError",
      code: "UND_ERR_PRX_TLS",
      message: "Secure Proxy Connection failed",
      cause,
    });
  });
});

describe("undici.request maxRedirections", () => {
  it("does not follow more redirects than maxRedirections allows", async () => {
    const hits: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const { pathname } = new URL(req.url);
        hits.push(pathname);
        if (pathname.startsWith("/redirect/")) {
          const hop = Number(pathname.slice("/redirect/".length));
          if (hop >= 5) {
            return Response.json({ done: true, hop });
          }
          return new Response(null, {
            status: 302,
            headers: { location: `/redirect/${hop + 1}` },
          });
        }
        return new Response("not found", { status: 404 });
      },
    });

    try {
      const origin = `http://localhost:${server.port}`;

      // The caller's cap must be enforced: with maxRedirections: 1 only one
      // redirect may be followed, so the client stops at /redirect/1 instead
      // of chasing the chain to the end.
      hits.length = 0;
      await expect(request(`${origin}/redirect/0`, { maxRedirections: 1 })).rejects.toThrow(
        "redirected too many times",
      );
      expect(hits).toEqual(["/redirect/0", "/redirect/1"]);

      // A cap large enough for the whole chain still reaches the final response.
      hits.length = 0;
      const followed = await request(`${origin}/redirect/0`, { maxRedirections: 10 });
      expect(hits).toEqual(["/redirect/0", "/redirect/1", "/redirect/2", "/redirect/3", "/redirect/4", "/redirect/5"]);
      expect(followed.statusCode).toBe(200);
      expect(((await followed.body!.json()) as { done: boolean; hop: number }).hop).toBe(5);

      // Invalid caps are rejected up front instead of being silently ignored.
      await expect(request(`${origin}/redirect/0`, { maxRedirections: -1 })).rejects.toThrow(
        "maxRedirections must be a positive number",
      );
    } finally {
      server.stop(true);
    }
  });
});

describe.concurrent("WebSocket ping", () => {
  function serve(websocket: Partial<Bun.WebSocketHandler<undefined>> = {}) {
    return Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response(null, { status: 400 });
      },
      websocket: { message() {}, ...websocket },
    });
  }

  function once(ws: EventTarget, type: "open" | "close") {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    ws.addEventListener(type, () => resolve());
    ws.addEventListener("error", (e: any) => reject(e.error ?? new Error(e.message)));
    return promise;
  }

  // Resolves with the first message published for `ws`. Channels are process-wide and these tests
  // run concurrently, so filter by socket.
  async function firstPublished(name: "ping" | "pong", ws: EventTarget) {
    const { promise, resolve, reject } = Promise.withResolvers<{ payload: Buffer; websocket: unknown }>();
    const onMessage = (message: any) => {
      if (message.websocket === ws) resolve(message);
    };
    ws.addEventListener("error", (e: any) => reject(e.error ?? new Error(e.message)));
    ws.addEventListener("close", (e: any) => reject(new Error(`closed with ${e.code} before a ${name} was published`)));
    diagnosticsChannel.subscribe(`undici:websocket:${name}`, onMessage);
    try {
      return await promise;
    } finally {
      diagnosticsChannel.unsubscribe(`undici:websocket:${name}`, onMessage);
    }
  }

  it("ping() sends a Ping frame and publishes the Pong on undici:websocket:pong", async () => {
    const received = Promise.withResolvers<Buffer>();
    await using server = serve({
      ping(ws, data) {
        received.resolve(data);
        ws.close(1000);
      },
    });
    const ws = new UndiciWebSocket(`ws://127.0.0.1:${server.port}`);
    expect(ws).toBeInstanceOf(WebSocket);
    const pong = firstPublished("pong", ws);
    await once(ws, "open");

    ping(ws, Buffer.from("hello slack"));

    expect((await received.promise).toString()).toBe("hello slack");
    const { payload, websocket } = await pong;
    expect(payload).toBeInstanceOf(Buffer);
    expect(payload.toString()).toBe("hello slack");
    expect(websocket).toBe(ws);
  });

  it("ping() without a body sends an empty Ping frame", async () => {
    const received = Promise.withResolvers<Buffer>();
    await using server = serve({
      ping(ws, data) {
        received.resolve(data);
        ws.close(1000);
      },
    });
    const ws = new UndiciWebSocket(`ws://127.0.0.1:${server.port}`);
    const pong = firstPublished("pong", ws);
    await once(ws, "open");

    ping(ws);

    expect((await received.promise).toString()).toBe("");
    expect((await pong).payload).toEqual(Buffer.alloc(0));
  });

  it("ping() accepts a global WebSocket", async () => {
    const received = Promise.withResolvers<Buffer>();
    await using server = serve({
      ping(ws, data) {
        received.resolve(data);
        ws.close(1000);
      },
    });
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await once(ws, "open");

    ping(ws, Buffer.from("global"));

    expect((await received.promise).toString()).toBe("global");
  });

  it.each(["nodebuffer", "arraybuffer", "blob"])(
    "publishes a Ping from the server as a Buffer when binaryType is %s",
    async binaryType => {
      await using server = serve({
        open(ws) {
          ws.ping("from server");
          ws.close(1000);
        },
      });
      const ws = new UndiciWebSocket(`ws://127.0.0.1:${server.port}`);
      ws.binaryType = binaryType as any;
      expect(ws.binaryType).toBe(binaryType as any);

      const { payload, websocket } = await firstPublished("ping", ws);
      expect(payload).toBeInstanceOf(Buffer);
      expect(payload.toString()).toBe("from server");
      expect(websocket).toBe(ws);
    },
  );

  it("ping() is a no-op unless the socket is OPEN", async () => {
    const pings: string[] = [];
    const serverClosed = Promise.withResolvers<void>();
    await using server = serve({
      ping(_ws, data) {
        pings.push(data.toString());
      },
      close() {
        serverClosed.resolve();
      },
    });
    const ws = new UndiciWebSocket(`ws://127.0.0.1:${server.port}`);

    expect(ws.readyState).toBe(UndiciWebSocket.CONNECTING);
    ping(ws, Buffer.from("connecting"));
    await once(ws, "open");
    ping(ws, Buffer.from("open"));
    const closed = once(ws, "close");
    ws.close();
    expect(ws.readyState).toBe(UndiciWebSocket.CLOSING);
    ping(ws, Buffer.from("closing"));
    await closed;
    expect(ws.readyState).toBe(UndiciWebSocket.CLOSED);
    ping(ws, Buffer.from("closed"));

    await serverClosed.promise;
    expect(pings).toEqual(["open"]);
  });

  it("ping() validates its arguments like undici", async () => {
    await using server = serve();
    const ws = new UndiciWebSocket(`ws://127.0.0.1:${server.port}`);
    try {
      expect(() => ping(undefined)).toThrow(TypeError);
      expect(() => ping(null)).toThrow(TypeError);
      expect(() => ping({})).toThrow(TypeError);
      expect(() => ping(ws, "not a buffer")).toThrow(new TypeError("Expected buffer payload"));
      expect(() => ping(ws, null)).toThrow(new TypeError("Expected buffer payload"));
      expect(() => ping(ws, new Uint8Array(4))).toThrow(new TypeError("Expected buffer payload"));
      expect(() => ping({}, "not a buffer")).toThrow(new TypeError("Expected buffer payload"));
      expect(() => ping(ws, Buffer.alloc(126))).toThrow(
        new TypeError("A PING frame cannot have a body larger than 125 bytes."),
      );
      expect(() => ping(ws, Buffer.alloc(125))).not.toThrow();
    } finally {
      ws.close();
    }
  });
});
