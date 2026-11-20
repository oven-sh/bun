import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import diagnosticsChannel from "node:diagnostics_channel";
import { Readable } from "node:stream";
import * as undici from "undici";
// @ts-ignore undici 5's types don't declare ping() and the undici 8 names
import {
  Agent,
  Dispatcher,
  Dispatcher1Wrapper,
  errors,
  ping,
  request,
  fetch as undiciFetch,
  WebSocket as UndiciWebSocket,
  WebSocketError,
} from "undici";
import undici8 from "undici8";

import { createServer } from "../../../http-test-server";

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

    it("should take a URL of another implementation", async () => {
      const { href, protocol } = new URL(`${hostUrl}/get`);
      const { body } = await request({ href, protocol } as URL, { query: { foo: "bar" } });
      expect(await body.json()).toMatchObject({ url: `${hostUrl}/get?foo=bar`, args: { foo: "bar" } });
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

// undici8 is undici 8.12.4 from test/package.json. The built-in shim shadows the bare "undici"
// specifier, so every name that the package exports and the shim does not is a link-time
// SyntaxError for a static import.
const missingFrom = (shim: object, upstream: object) => Object.keys(upstream).filter(name => !(name in shim));

describe.concurrent("undici 8 exports", () => {
  for (const specifier of ["undici", "next/dist/compiled/undici"]) {
    it(`"${specifier}" has every export of undici 8`, () => {
      const shim = require(specifier);
      expect({
        missing: missingFrom(shim, undici8),
        errors: missingFrom(shim.errors, undici8.errors),
        interceptors: missingFrom(shim.interceptors, undici8.interceptors),
        mockErrors: missingFrom(shim.mockErrors, undici8.mockErrors),
        cacheStores: missingFrom(shim.cacheStores, undici8.cacheStores),
      }).toEqual({ missing: [], errors: [], interceptors: [], mockErrors: [], cacheStores: [] });
    });

    it(`a static import of every undici 8 name links from "${specifier}"`, async () => {
      const names = Object.keys(undici8).filter(name => name !== "default");
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `import { ${names.join(", ")} } from ${JSON.stringify(specifier)};
           console.log(JSON.stringify({ ${names.map(name => `${name}: typeof ${name}`).join(", ")} }));`,
        ],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual(Object.fromEntries(names.map(name => [name, typeof undici8[name]])));
      expect(exitCode).toBe(0);
    });
  }

  it("Dispatcher1Wrapper accepts every dispatcher of the shim and rejects the rest", () => {
    const dispatchers = [
      "Agent",
      "Pool",
      "BalancedPool",
      "Client",
      "RoundRobinPool",
      "H2CClient",
      "ProxyAgent",
      "EnvHttpProxyAgent",
      "Socks5ProxyAgent",
      "RetryAgent",
      "MockAgent",
      "MockClient",
      "MockPool",
      "SnapshotAgent",
    ];
    for (const name of dispatchers) {
      const wrapper = new Dispatcher1Wrapper(new undici[name]("http://localhost"));
      expect(wrapper instanceof Dispatcher).toBe(true);
      expect(wrapper instanceof Dispatcher1Wrapper).toBe(true);
    }
    expect(undici.getGlobalDispatcher() instanceof Agent).toBe(true);
    expect(new Dispatcher1Wrapper(undici.getGlobalDispatcher()) instanceof Dispatcher).toBe(true);

    for (const bad of [undefined, null, {}, { dispatch: 1 }]) {
      expect(() => new Dispatcher1Wrapper(bad)).toThrow(errors.InvalidArgumentError);
      expect(() => new Dispatcher1Wrapper(bad)).toThrow(
        expect.objectContaining({
          name: "InvalidArgumentError",
          code: "UND_ERR_INVALID_ARG",
          message: "Argument dispatcher must implement dispatch",
        }),
      );
    }
  });

  it("close() and destroy() settle on every dispatcher of the shim, wrapped or not", async () => {
    for (const name of ["Agent", "Client", "Pool", "ProxyAgent", "RetryAgent", "MockAgent", "MockPool"]) {
      const dispatcher = new undici[name]("http://localhost");
      expect(await dispatcher.close()).toBe(null);
      expect(await dispatcher.destroy()).toBe(null);
      expect(await new Dispatcher1Wrapper(dispatcher).close()).toBe(null);
      expect(await new Dispatcher1Wrapper(dispatcher).destroy(new Error("why"))).toBe(null);
    }
    expect(await new Dispatcher1Wrapper(undici.getGlobalDispatcher()).close()).toBe(null);
    for (const bad of [null, 42, "done"]) {
      expect(() => new Agent().close(bad)).toThrow(
        expect.objectContaining({ name: "InvalidArgumentError", message: "invalid callback" }),
      );
      expect(() => new Agent().destroy(new Error("why"), bad)).toThrow(
        expect.objectContaining({ name: "InvalidArgumentError", message: "invalid callback" }),
      );
    }
    expect(new errors.InvalidArgumentError("bad", { cause: 1 }).cause).toBe(1);
    const closed = Promise.withResolvers<unknown[]>();
    const destroyed = Promise.withResolvers<unknown[]>();
    new Agent().close((...args: unknown[]) => closed.resolve(args));
    new Agent().destroy(new Error("why"), (...args: unknown[]) => destroyed.resolve(args));
    expect(await closed.promise).toEqual([null, null]);
    expect(await destroyed.promise).toEqual([null, null]);
  });

  it("Dispatcher1Wrapper forwards to the wrapped dispatcher with HTTP/2 off", async () => {
    const calls: unknown[] = [];
    const handler = { onRequestStart() {} };
    const inner = {
      dispatch(opts: unknown, h: unknown) {
        calls.push([opts, h]);
        return true;
      },
      close: (...args: unknown[]) => Promise.resolve(["closed", ...args]),
      destroy: (...args: unknown[]) => Promise.resolve(["destroyed", ...args]),
      webSocketOptions: { maxFragments: 1 },
      eventSourceOptions: { maxEventSize: 2 },
    };
    const wrapper = new Dispatcher1Wrapper(inner);

    expect(wrapper.dispatch({ origin: "http://localhost", method: "GET" }, handler)).toBe(true);
    expect(wrapper.dispatch({ origin: "http://localhost", allowH2: false }, handler)).toBe(true);
    expect(calls).toEqual([
      [{ origin: "http://localhost", method: "GET", allowH2: false }, handler],
      [{ origin: "http://localhost", allowH2: false }, handler],
    ]);
    expect(wrapper.webSocketOptions).toBe(inner.webSocketOptions);
    expect(wrapper.eventSourceOptions).toBe(inner.eventSourceOptions);
    await expect(wrapper.close(1)).resolves.toEqual(["closed", 1]);
    await expect(wrapper.destroy(new Error("x"), 2)).resolves.toEqual(["destroyed", expect.any(Error), 2]);
  });

  it("fetch() with a Dispatcher1Wrapper as the dispatcher works as in @vercel/sandbox", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch: req => Response.json({ method: req.method, path: new URL(req.url).pathname }),
    });
    const dispatcher = new Dispatcher1Wrapper(new Agent({ bodyTimeout: 0 }));
    const response = await undiciFetch(`${server.url.origin}/sandbox`, { method: "POST", dispatcher } as any);
    expect(await response.json()).toEqual({ method: "POST", path: "/sandbox" });
  });

  it("WebSocketError is a DOMException with closeCode and reason", () => {
    const error = new WebSocketError("gone", { closeCode: 3001, reason: "bye" });
    expect(error instanceof DOMException).toBe(true);
    expect([error.name, error.message, error.closeCode, error.reason]).toEqual(["WebSocketError", "gone", 3001, "bye"]);
    expect(new WebSocketError().closeCode).toBe(null);
    expect(new WebSocketError("", { reason: "r" }).closeCode).toBe(1000);
    expect(new WebSocketError("", { closeCode: "3001" }).closeCode).toBe(3001);
    expect(new WebSocketError("", { closeCode: 3001.9 }).closeCode).toBe(3001);
    const invalidCode = expect.objectContaining({ name: "InvalidAccessError", message: "invalid code" });
    for (const closeCode of [1001, 2999, 5000, NaN, "x"]) {
      expect(() => new WebSocketError("", { closeCode })).toThrow(invalidCode);
    }
    expect(() => new WebSocketError("", { reason: Buffer.alloc(124, "x").toString() })).toThrow(
      expect.objectContaining({ name: "SyntaxError", message: "Reason must be less than 123 bytes; received 124" }),
    );
  });

  it("install() sets the globals that are Bun's own and leaves EventSource alone", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const undici = require("undici");
         const names = ["fetch", "Headers", "Response", "Request", "FormData", "WebSocket", "CloseEvent", "ErrorEvent", "MessageEvent", "EventSource"];
         const before = Object.fromEntries(names.map(name => [name, globalThis[name]]));
         undici.install();
         console.log(JSON.stringify([
           names.filter(name => globalThis[name] !== before[name]),
           names.filter(name => globalThis[name] !== undici[name]),
         ]));`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual([["fetch", "WebSocket"], ["EventSource"]]);
    expect(exitCode).toBe(0);
  });
});
