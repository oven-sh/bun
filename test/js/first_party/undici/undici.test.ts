import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, tls as tlsCert } from "harness";
import diagnosticsChannel from "node:diagnostics_channel";
import { join } from "node:path";
import { Readable } from "node:stream";
// @ts-ignore undici 5's types don't declare ping()
import {
  Agent,
  errors,
  getGlobalDispatcher,
  ping,
  request,
  setGlobalDispatcher,
  fetch as undiciFetch,
  WebSocket as UndiciWebSocket,
} from "undici";

import { mkfifo } from "mkfifo";
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

describe("undici dispatcher connect.lookup", () => {
  // Reserved TLD (RFC 2606): guaranteed not to resolve, so reaching the local
  // server proves the lookup hook supplied the address.
  const UNRESOLVABLE = "this-host-does-not-exist.invalid";

  function pinningAgent(address = "127.0.0.1") {
    const seen: string[] = [];
    const agent = new Agent({
      connect: {
        lookup: (hostname, _opts, cb) => {
          seen.push(hostname);
          cb(null, address, 4);
        },
      },
    });
    return { agent, seen };
  }

  it("fetch connects to the address returned by the lookup hook", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch: req => new Response(req.headers.get("host") ?? "none"),
    });
    const { agent, seen } = pinningAgent();
    const res = await undiciFetch(`http://${UNRESOLVABLE}:${server.port}/`, { dispatcher: agent });
    expect(await res.text()).toBe(`${UNRESOLVABLE}:${server.port}`);
    expect(res.status).toBe(200);
    expect(seen).toEqual([UNRESOLVABLE]);
    // The pinned IP does not leak into the Response.
    expect(res.url).toBe(`http://${UNRESOLVABLE}:${server.port}/`);
    expect(res.redirected).toBe(false);
  });

  it("fetch fails when the lookup hook reports an error, without contacting the server", async () => {
    let hits = 0;
    await using server = Bun.serve({
      port: 0,
      fetch: () => {
        hits++;
        return new Response("served");
      },
    });
    const agent = new Agent({
      connect: {
        lookup: (_hostname, _opts, cb) => cb(new Error("blocked by rebinding protection"), "", 0),
      },
    });
    expect(
      await undiciFetch(`http://localhost:${server.port}/`, { dispatcher: agent }).then(
        () => ({ name: "resolved" }),
        (err: TypeError) => ({
          name: err.constructor.name,
          message: err.message,
          cause: (err.cause as Error | undefined)?.message,
        }),
      ),
    ).toEqual({ name: "TypeError", message: "fetch failed", cause: "blocked by rebinding protection" });
    expect(hits).toBe(0);
  });

  it("lookup hook is skipped for IP literals", async () => {
    await using server = Bun.serve({ port: 0, fetch: () => new Response("direct") });
    const { agent, seen } = pinningAgent("192.0.2.1");
    const res = await undiciFetch(`http://127.0.0.1:${server.port}/`, { dispatcher: agent });
    expect(await res.text()).toBe("direct");
    expect(seen).toEqual([]);
  });

  it("lookup hook may return the all:true address-array shape", async () => {
    await using server = Bun.serve({ port: 0, fetch: () => new Response("array") });
    const agent = new Agent({
      connect: {
        lookup: (_hostname, _opts, cb) => cb(null, [{ address: "127.0.0.1", family: 4 }] as any, undefined as any),
      },
    });
    const res = await undiciFetch(`http://${UNRESOLVABLE}:${server.port}/`, { dispatcher: agent });
    expect(await res.text()).toBe("array");
  });

  it("the global dispatcher's lookup hook is honored", async () => {
    await using server = Bun.serve({ port: 0, fetch: () => new Response("global") });
    const previous = getGlobalDispatcher();
    setGlobalDispatcher(pinningAgent().agent);
    try {
      const res = await undiciFetch(`http://${UNRESOLVABLE}:${server.port}/`);
      expect(await res.text()).toBe("global");
    } finally {
      setGlobalDispatcher(previous);
    }
  });

  it("fetch with a Request input keeps method, headers and body through the pin", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch: async req => new Response(`${req.method} ${req.headers.get("x-probe")} ${await req.text()}`),
    });
    const { agent } = pinningAgent();
    const req = new Request(`http://${UNRESOLVABLE}:${server.port}/`, {
      method: "POST",
      headers: { "x-probe": "yes" },
      body: "hello",
    });
    const res = await undiciFetch(req, { dispatcher: agent });
    expect(await res.text()).toBe("POST yes hello");
  });

  it("request() honors the dispatcher's lookup hook", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch: req => new Response(req.headers.get("host") ?? "none"),
    });
    const { agent, seen } = pinningAgent();
    const { statusCode, body } = await request(`http://${UNRESOLVABLE}:${server.port}/`, { dispatcher: agent });
    expect(await body!.text()).toBe(`${UNRESOLVABLE}:${server.port}`);
    expect(statusCode).toBe(200);
    expect(seen).toEqual([UNRESOLVABLE]);
  });

  it("https: the pin keeps the original hostname for SNI and certificate verification", async () => {
    await using server = Bun.serve({
      port: 0,
      tls: tlsCert,
      fetch: req => new Response(req.headers.get("host") ?? "none"),
    });
    const { agent, seen } = pinningAgent();
    const verified: string[] = [];
    const res = await undiciFetch(`https://localhost:${server.port}/`, {
      dispatcher: agent,
      // @ts-expect-error Bun-specific fetch option
      tls: {
        ca: tlsCert.cert,
        checkServerIdentity: (hostname: string) => {
          verified.push(hostname);
          return undefined;
        },
      },
    });
    expect(await res.text()).toBe(`localhost:${server.port}`);
    expect(seen).toEqual(["localhost"]);
    expect(verified).toEqual(["localhost"]);
  });

  it("https: a user tls.serverName wins over the pinned hostname", async () => {
    await using server = Bun.serve({
      port: 0,
      tls: tlsCert,
      fetch: () => new Response("ok"),
    });
    const { agent } = pinningAgent();
    const verified: string[] = [];
    const res = await undiciFetch(`https://${UNRESOLVABLE}:${server.port}/`, {
      dispatcher: agent,
      // @ts-expect-error Bun-specific fetch option
      tls: {
        ca: tlsCert.cert,
        serverName: "localhost",
        checkServerIdentity: (hostname: string) => {
          verified.push(hostname);
          return undefined;
        },
      },
    });
    expect(await res.text()).toBe("ok");
    expect(verified).toEqual(["localhost"]);
  });

  it("https: the Agent's connect TLS options apply to pinned hops", async () => {
    await using server = Bun.serve({ port: 0, tls: tlsCert, fetch: () => new Response("connect-ca") });
    const seen: string[] = [];
    // The cert is self-signed for localhost: without connect.ca the pin fails verification.
    const noCa = new Agent({ connect: { lookup: (_h, _o, cb) => cb(null, "127.0.0.1", 4) } });
    expect(
      await undiciFetch(`https://localhost:${server.port}/`, { dispatcher: noCa }).then(
        () => "resolved",
        () => "rejected",
      ),
    ).toBe("rejected");
    const withCa = new Agent({
      connect: {
        ca: tlsCert.cert,
        lookup: (hostname, _o, cb) => {
          seen.push(hostname);
          cb(null, "127.0.0.1", 4);
        },
      },
    });
    const res = await undiciFetch(`https://localhost:${server.port}/`, { dispatcher: withCa });
    expect(await res.text()).toBe("connect-ca");
    expect(seen).toEqual(["localhost"]);
  });

  it("https: every redirect hop verifies against its own hostname", async () => {
    await using target = Bun.serve({
      port: 0,
      tls: tlsCert,
      fetch: req => new Response(req.headers.get("host") ?? "none"),
    });
    await using origin = Bun.serve({
      port: 0,
      tls: tlsCert,
      fetch: () => Response.redirect(`https://hop-two.invalid:${target.port}/`, 302),
    });
    const { agent, seen } = pinningAgent();
    const verified: string[] = [];
    const res = await undiciFetch(`https://hop-one.invalid:${origin.port}/`, {
      dispatcher: agent,
      // @ts-expect-error Bun-specific fetch option
      tls: {
        ca: tlsCert.cert,
        // Returning undefined accepts the certificate, so the hostnames need
        // not be in the certificate's SAN; the callback records what TLS saw.
        checkServerIdentity: (hostname: string) => {
          verified.push(hostname);
          return undefined;
        },
      },
    });
    expect(await res.text()).toBe(`hop-two.invalid:${target.port}`);
    expect(seen).toEqual(["hop-one.invalid", "hop-two.invalid"]);
    expect(verified).toEqual(["hop-one.invalid", "hop-two.invalid"]);
  });

  it("https: a Bun.FetchSession without request tls rejects instead of dropping the session's TLS config", async () => {
    const { agent, seen } = pinningAgent();
    using session = new Bun.FetchSession({ tls: { ca: tlsCert.cert } });
    expect(
      await undiciFetch(`https://${UNRESOLVABLE}:1/`, { dispatcher: agent, session } as any).then(
        () => "resolved",
        err => (err instanceof errors.NotSupportedError ? "NotSupportedError" : String(err)),
      ),
    ).toBe("NotSupportedError");
    expect(seen).toEqual([UNRESOLVABLE]);
  });

  it("a pinned hop is a direct connection: the environment proxy is not used", async () => {
    await using server = Bun.serve({ port: 0, fetch: () => new Response("direct") });
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { Agent, fetch } = require("undici");
         const agent = new Agent({ connect: { lookup: (_h, _o, cb) => cb(null, "127.0.0.1", 4) } });
         const res = await fetch("http://${UNRESOLVABLE}:${server.port}/", { dispatcher: agent });
         console.log(await res.text());`,
      ],
      env: { ...bunEnv, HTTP_PROXY: "http://127.0.0.1:1", HTTPS_PROXY: "http://127.0.0.1:1", NO_PROXY: "" },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("direct\n");
    expect(exitCode).toBe(0);
  });

  it("a lookup result the URL cannot carry fails the request instead of resolving the hostname", async () => {
    const agent = new Agent({
      connect: { lookup: (_hostname, _opts, cb) => cb(null, "fe80::1%eth0", 6) },
    });
    expect(
      await undiciFetch(`http://${UNRESOLVABLE}:1/`, { dispatcher: agent }).then(
        () => "resolved",
        (err: TypeError) => (err.cause as Error).message,
      ),
    ).toContain("cannot carry");
  });

  it("a lookup hook that never calls back fails after connect.timeout", async () => {
    const agent = new Agent({ connect: { timeout: 20, lookup: () => {} } });
    expect(
      await undiciFetch(`http://${UNRESOLVABLE}:1/`, { dispatcher: agent }).then(
        () => "resolved",
        (err: TypeError) => {
          const cause = err.cause as Error & { code?: string };
          return cause instanceof errors.ConnectTimeoutError ? `${cause.name}/${cause.code}` : String(cause);
        },
      ),
    ).toBe("ConnectTimeoutError/UND_ERR_CONNECT_TIMEOUT");
  });

  it("connect.timeout: 0 disables the lookup deadline", async () => {
    await using server = Bun.serve({ port: 0, fetch: () => new Response("unbounded") });
    const agent = new Agent({
      connect: {
        timeout: 0,
        // Answers on a later macrotask; a 0ms deadline would fire first.
        lookup: (_hostname, _opts, cb) => void setTimeout(() => cb(null, "127.0.0.1", 4), 2),
      },
    });
    const res = await undiciFetch(`http://${UNRESOLVABLE}:${server.port}/`, { dispatcher: agent });
    expect(await res.text()).toBe("unbounded");
  });

  it("a buffered Request body is replayed on a 307 through the pin", async () => {
    await using target = Bun.serve({
      port: 0,
      fetch: async req => new Response(`${req.method} ${await req.text()}`),
    });
    await using origin = Bun.serve({
      port: 0,
      fetch: () => new Response(null, { status: 307, headers: { location: `http://replay.invalid:${target.port}/` } }),
    });
    const { agent, seen } = pinningAgent();
    const res = await undiciFetch(
      new Request(`http://first.invalid:${origin.port}/`, { method: "PUT", body: "payload" }),
      { dispatcher: agent },
    );
    expect(await res.text()).toBe("PUT payload");
    expect(seen).toEqual(["first.invalid", "replay.invalid"]);

    // A Request carrying a user stream is not buffered, so the same 307 rejects.
    expect(
      await undiciFetch(
        new Request(`http://first.invalid:${origin.port}/`, {
          method: "PUT",
          body: new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode("payload"));
              c.close();
            },
          }),
          // @ts-expect-error duplex is required for stream bodies by the spec
          duplex: "half",
        }),
        { dispatcher: agent },
      ).then(
        () => "resolved",
        (err: TypeError) => (err.cause as Error).message,
      ),
    ).toContain("the request body is a stream that was already sent");
  });

  it("a Request stream body streams through the pin and a 307 cannot replay it", async () => {
    let targetHits = 0;
    await using target = Bun.serve({
      port: 0,
      fetch: () => {
        targetHits++;
        return new Response("target");
      },
    });
    await using origin = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = await req.text();
        if (new URL(req.url).pathname === "/echo") return new Response(body);
        return new Response(null, { status: 307, headers: { location: `http://hop.invalid:${target.port}/` } });
      },
    });
    const { agent } = pinningAgent();
    const chunks = async function* () {
      yield "a";
      yield "b";
    };
    // Streams to the origin, no buffering up front.
    const echoed = await undiciFetch(
      new Request(`http://src.invalid:${origin.port}/echo`, {
        method: "POST",
        body: new ReadableStream({
          async start(c) {
            for await (const chunk of chunks()) c.enqueue(new TextEncoder().encode(chunk));
            c.close();
          },
        }),
        // @ts-expect-error duplex is required for stream bodies by the spec
        duplex: "half",
      }),
      { dispatcher: agent },
    );
    expect(await echoed.text()).toBe("ab");
    // An async iterable body cannot be sent again on a 307.
    expect(
      await undiciFetch(`http://src.invalid:${origin.port}/`, {
        dispatcher: agent,
        method: "POST",
        body: chunks() as any,
        // @ts-expect-error duplex is required for stream bodies by the spec
        duplex: "half",
      }).then(
        () => "resolved",
        (err: TypeError) => (err.cause as Error).message,
      ),
    ).toContain("the request body is a stream that was already sent");
    expect(targetHits).toBe(0);
  });

  it("a live response body used as a Request body streams through the pin", async () => {
    const gate = Promise.withResolvers<void>();
    await using source = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          new ReadableStream({
            async start(c) {
              c.enqueue(new TextEncoder().encode("a"));
              // Only produced once the upload has delivered the first chunk;
              // buffering the body before the upload would deadlock here.
              await gate.promise;
              c.enqueue(new TextEncoder().encode("b"));
              c.close();
            },
          }),
        ),
    });
    await using echo = Bun.serve({
      port: 0,
      async fetch(req) {
        const chunks: string[] = [];
        for await (const chunk of req.body!) {
          chunks.push(new TextDecoder().decode(chunk));
          if (chunks.length === 1) gate.resolve();
        }
        return new Response(chunks.join(""));
      },
    });
    const { agent } = pinningAgent();
    const upstream = await fetch(`http://127.0.0.1:${source.port}/`);
    const res = await undiciFetch(
      new Request(`http://echo.invalid:${echo.port}/`, {
        method: "POST",
        body: upstream.body,
        // @ts-expect-error duplex is required for stream bodies by the spec
        duplex: "half",
      }),
      { dispatcher: agent },
    );
    expect(await res.text()).toBe("ab");
  });

  it("a plain { url } input object goes through the pin", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch: async req => new Response(`${req.method} ${await req.text()}`),
    });
    const { agent, seen } = pinningAgent();
    const res = await undiciFetch({ url: `http://${UNRESOLVABLE}:${server.port}/`, method: "POST", body: "x" } as any, {
      dispatcher: agent,
    });
    expect(await res.text()).toBe("POST x");
    expect(seen).toEqual([UNRESOLVABLE]);
  });

  it("a plain { url } input may carry the dispatcher itself", async () => {
    await using server = Bun.serve({ port: 0, fetch: () => new Response("in-object") });
    const { agent, seen } = pinningAgent();
    const res = await undiciFetch({ url: `http://${UNRESOLVABLE}:${server.port}/`, dispatcher: agent } as any);
    expect(await res.text()).toBe("in-object");
    expect(seen).toEqual([UNRESOLVABLE]);
  });

  it("a 3xx with an empty Location is returned, not followed", async () => {
    let hits = 0;
    await using server = Bun.serve({
      port: 0,
      fetch: () => {
        hits++;
        return new Response(null, { status: 302, headers: { location: "" } });
      },
    });
    const { agent } = pinningAgent();
    const res = await undiciFetch(`http://${UNRESOLVABLE}:${server.port}/`, { dispatcher: agent });
    expect(res.status).toBe(302);
    expect(hits).toBe(1);
  });

  it("a plain { url } input keeps its Bun-specific options such as tls", async () => {
    await using server = Bun.serve({ port: 0, tls: tlsCert, fetch: () => new Response("tls-ok") });
    const { agent } = pinningAgent();
    const verified: string[] = [];
    const res = await undiciFetch(
      {
        url: `https://${UNRESOLVABLE}:${server.port}/`,
        tls: {
          ca: tlsCert.cert,
          checkServerIdentity: (hostname: string) => {
            verified.push(hostname);
            return undefined;
          },
        },
      } as any,
      { dispatcher: agent },
    );
    expect(await res.text()).toBe("tls-ok");
    expect(verified).toEqual([UNRESOLVABLE]);
  });

  it("request() keeps the destination it was called with if the caller mutates the URL object", async () => {
    await using server = Bun.serve({ port: 0, fetch: req => new Response(new URL(req.url).pathname) });
    const { agent } = pinningAgent();
    // An IP literal skips the hook, but the call still yields once before sending.
    const url = new URL(`http://127.0.0.1:${server.port}/first`);
    const pending = request(url, { dispatcher: agent });
    url.pathname = "/second";
    const { body } = await pending;
    expect(await body!.text()).toBe("/first");
  });

  it("request() accepts flat-array headers on the unpinned path too", async () => {
    await using server = Bun.serve({ port: 0, fetch: req => new Response(req.headers.get("x-a") ?? "none") });
    const { body } = await request(`http://127.0.0.1:${server.port}/`, { headers: ["x-a", "1"] });
    expect(await body!.text()).toBe("1");
  });

  it("the lookup hook sees every redirect hop", async () => {
    await using target = Bun.serve({
      port: 0,
      fetch: req =>
        new Response(
          `${req.method} ${req.headers.get("host")} body-headers=${req.headers.has("content-type") || req.headers.has("content-encoding")}`,
        ),
    });
    await using origin = Bun.serve({
      port: 0,
      fetch: () => Response.redirect(`http://redirect-target.invalid:${target.port}/`, 302),
    });
    const { agent, seen } = pinningAgent();
    const res = await undiciFetch(`http://redirect-origin.invalid:${origin.port}/`, {
      dispatcher: agent,
      method: "POST",
      headers: { "content-encoding": "identity" },
      body: "payload",
    });
    // 302 + POST becomes GET and drops the body headers, like native redirect following.
    expect(await res.text()).toBe(`GET redirect-target.invalid:${target.port} body-headers=false`);
    expect(seen).toEqual(["redirect-origin.invalid", "redirect-target.invalid"]);
    expect(res.url).toBe(`http://redirect-target.invalid:${target.port}/`);
    expect(res.redirected).toBe(true);
  });

  it("the lookup hook can veto a redirect hop", async () => {
    let targetHits = 0;
    await using target = Bun.serve({
      port: 0,
      fetch: () => {
        targetHits++;
        return new Response("target");
      },
    });
    await using origin = Bun.serve({
      port: 0,
      fetch: () => Response.redirect(`http://blocked.invalid:${target.port}/`, 302),
    });
    const agent = new Agent({
      connect: {
        lookup: (hostname, _opts, cb) =>
          hostname === "blocked.invalid" ? cb(new Error("blocked"), "", 0) : cb(null, "127.0.0.1", 4),
      },
    });
    expect(
      await undiciFetch(`http://ok.invalid:${origin.port}/`, { dispatcher: agent }).then(
        () => ({ name: "resolved" }),
        (err: TypeError) => ({
          name: err.constructor.name,
          message: err.message,
          cause: (err.cause as Error | undefined)?.message,
        }),
      ),
    ).toEqual({ name: "TypeError", message: "fetch failed", cause: "blocked" });
    expect(targetHits).toBe(0);
  });

  it("redirects to non-http schemes are rejected", async () => {
    await using origin = Bun.serve({
      port: 0,
      fetch: () => new Response(null, { status: 302, headers: { location: "file:///etc/hostname" } }),
    });
    const { agent, seen } = pinningAgent();
    expect(
      await undiciFetch(`http://scheme.invalid:${origin.port}/`, { dispatcher: agent }).then(
        () => "resolved",
        (err: TypeError) => (err.cause as Error).message,
      ),
    ).toContain("URL scheme must be http or https");
    expect(seen).toEqual(["scheme.invalid"]);
  });

  it("request() re-applies the lookup hook across maxRedirections hops", async () => {
    await using target = Bun.serve({
      port: 0,
      fetch: req => new Response(req.headers.get("host") ?? "none"),
    });
    await using origin = Bun.serve({
      port: 0,
      fetch: () => Response.redirect(`http://hop2.invalid:${target.port}/`, 302),
    });
    const { agent, seen } = pinningAgent();
    const { statusCode, body } = await request(`http://hop1.invalid:${origin.port}/`, {
      dispatcher: agent,
      maxRedirections: 5,
    });
    expect(await body!.text()).toBe(`hop2.invalid:${target.port}`);
    expect(statusCode).toBe(200);
    expect(seen).toEqual(["hop1.invalid", "hop2.invalid"]);
  });

  it("a custom connect function rejects loudly instead of being silently ignored", async () => {
    await using server = Bun.serve({ port: 0, fetch: () => new Response("served") });
    const agent = new Agent({ connect: (() => {}) as any });
    expect(
      await undiciFetch(`http://localhost:${server.port}/`, { dispatcher: agent }).then(
        () => "resolved",
        (err: Error & { code?: string }) =>
          err instanceof errors.NotSupportedError ? `${err.name}/${err.code}` : String(err),
      ),
    ).toBe("NotSupportedError/UND_ERR_NOT_SUPPORTED");
  });

  it("redirect manual and error modes still pin the first hop", async () => {
    await using origin = Bun.serve({
      port: 0,
      fetch: () => Response.redirect("http://elsewhere.invalid/", 302),
    });
    const { agent, seen } = pinningAgent();
    const res = await undiciFetch(`http://manual.invalid:${origin.port}/`, { dispatcher: agent, redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.url).toBe(`http://manual.invalid:${origin.port}/`);

    // A Request input goes through the same branch.
    const req = new Request(`http://manual.invalid:${origin.port}/`, { redirect: "manual" });
    const res2 = await undiciFetch(req, { dispatcher: agent });
    expect(res2.status).toBe(302);

    expect(
      await undiciFetch(`http://manual.invalid:${origin.port}/`, { dispatcher: agent, redirect: "error" }).then(
        () => "resolved",
        () => "rejected",
      ),
    ).toBe("rejected");
    expect(seen).toEqual(["manual.invalid", "manual.invalid", "manual.invalid"]);
  });

  it("an abort signal rejects a lookup that never completes", async () => {
    const controller = new AbortController();
    const agent = new Agent({
      connect: {
        // Never calls cb; aborting must reject the pending fetch.
        lookup: () => controller.abort(new Error("abort during lookup")),
      },
    });
    expect(
      await undiciFetch(`http://${UNRESOLVABLE}:1/`, { dispatcher: agent, signal: controller.signal }).then(
        () => "resolved",
        (err: Error) => err.message,
      ),
    ).toBe("abort during lookup");

    // An already-aborted signal rejects before the hook runs.
    const { agent: pinner, seen } = pinningAgent();
    expect(
      await undiciFetch(`http://${UNRESOLVABLE}:1/`, {
        dispatcher: pinner,
        signal: AbortSignal.abort(new Error("pre-aborted")),
      }).then(
        () => "resolved",
        (err: Error) => err.message,
      ),
    ).toBe("pre-aborted");
    expect(seen).toEqual([]);
  });

  it("request() accepts flat-array headers on the pinned path", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch: req => new Response(`${req.headers.get("x-a")} ${req.headers.get("cookie")}`),
    });
    const { agent } = pinningAgent();
    const { body } = await request(`http://${UNRESOLVABLE}:${server.port}/`, {
      dispatcher: agent,
      maxRedirections: 1,
      headers: ["x-a", "1", "cookie", "a=1", "cookie", "b=2"],
    });
    // Bun's Headers joins repeated cookie entries with "; ".
    expect(await body!.text()).toBe("1 a=1; b=2");
  });

  it("request() enforces maxRedirections on the pinned path", async () => {
    let port = 0;
    await using server = Bun.serve({
      port: 0,
      fetch: req => {
        const n = Number(new URL(req.url).pathname.slice(1));
        return n >= 2 ? new Response("done") : Response.redirect(`http://chain.invalid:${port}/${n + 1}`, 302);
      },
    });
    port = server.port;
    const { agent } = pinningAgent();

    // Exactly at the limit succeeds (two redirects, cap 2).
    const { statusCode, body } = await request(`http://chain.invalid:${port}/0`, {
      dispatcher: agent,
      maxRedirections: 2,
    });
    expect(await body!.text()).toBe("done");
    expect(statusCode).toBe(200);

    // One past the limit rejects.
    await expect(request(`http://chain.invalid:${port}/0`, { dispatcher: agent, maxRedirections: 1 })).rejects.toThrow(
      "redirected too many times",
    );
  });

  it("URLs without a network authority skip the hook", async () => {
    const { agent, seen } = pinningAgent();
    const res = await undiciFetch("data:text/plain,hello", { dispatcher: agent });
    expect(await res.text()).toBe("hello");
    expect(seen).toEqual([]);
  });

  it("a connect object without a lookup hook keeps native redirect following", async () => {
    await using target = Bun.serve({ port: 0, fetch: () => new Response("followed") });
    await using origin = Bun.serve({
      port: 0,
      fetch: () => Response.redirect(`http://127.0.0.1:${target.port}/`, 302),
    });
    const agent = new Agent({ connect: { timeout: 5000 } });
    const res = await undiciFetch(`http://127.0.0.1:${origin.port}/`, { dispatcher: agent });
    expect(await res.text()).toBe("followed");
    expect(res.redirected).toBe(true);
  });

  it("a caller's Host header survives a same-origin hop and is dropped cross-origin", async () => {
    const hosts: string[] = [];
    await using other = Bun.serve({
      port: 0,
      fetch: req => {
        hosts.push(`other:${req.headers.get("host")}`);
        return new Response("done");
      },
    });
    await using origin = Bun.serve({
      port: 0,
      fetch: req => {
        hosts.push(`origin:${req.headers.get("host")}`);
        const { pathname } = new URL(req.url);
        if (pathname === "/a") return Response.redirect("/b", 302);
        return Response.redirect(`http://cross.invalid:${other.port}/`, 302);
      },
    });
    const { agent } = pinningAgent();
    const res = await undiciFetch(`http://same.invalid:${origin.port}/a`, {
      dispatcher: agent,
      headers: { host: "vhost.example" },
    });
    expect(await res.text()).toBe("done");
    expect(hosts).toEqual(["origin:vhost.example", "origin:vhost.example", `other:cross.invalid:${other.port}`]);
  });

  it("a file-backed Request body is sent with Content-Length and replayed on a 307", async () => {
    using dir = tempDir("undici-file-body", { "upload.txt": "file payload" });
    const seen: string[] = [];
    await using target = Bun.serve({
      port: 0,
      fetch: async req => {
        seen.push(`${req.headers.get("transfer-encoding")} ${req.headers.get("content-length")} ${await req.text()}`);
        return new Response("stored");
      },
    });
    await using origin = Bun.serve({
      port: 0,
      fetch: async req => {
        seen.push(`${req.headers.get("transfer-encoding")} ${req.headers.get("content-length")} ${await req.text()}`);
        return new Response(null, { status: 307, headers: { location: `http://store.invalid:${target.port}/` } });
      },
    });
    const { agent } = pinningAgent();
    const res = await undiciFetch(
      new Request(`http://first.invalid:${origin.port}/`, {
        method: "PUT",
        body: Bun.file(join(String(dir), "upload.txt")),
      }),
      { dispatcher: agent },
    );
    expect(await res.text()).toBe("stored");
    expect(seen).toEqual(["null 12 file payload", "null 12 file payload"]);
  });

  it("fetch honors Bun's maxRedirects option on the pinned path", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch: req => {
        const { pathname } = new URL(req.url);
        if (pathname === "/a") return Response.redirect("/b", 302);
        if (pathname === "/b") return Response.redirect("/c", 302);
        return new Response("c");
      },
    });
    const { agent } = pinningAgent();
    const url = `http://hops.invalid:${server.port}/a`;
    const outcome = (n: number) =>
      // @ts-expect-error Bun-specific fetch option
      undiciFetch(url, { dispatcher: agent, maxRedirects: n }).then(
        res => res.status,
        (err: TypeError) => (err.cause as Error).message,
      );
    expect(await outcome(2)).toBe(200);
    expect(await outcome(1)).toBe("redirect count exceeded");
    expect(await outcome(0)).toBe("redirect count exceeded");
  });

  it("a URL whose scheme is really a hostname fails closed instead of skipping the hook", async () => {
    let hits = 0;
    await using server = Bun.serve({
      port: 0,
      fetch: () => {
        hits++;
        return new Response("reached");
      },
    });
    const { agent, seen } = pinningAgent();
    const url = `localhost:${server.port}/admin`;
    // Without a dispatcher native fetch reads this as http://localhost:PORT/admin.
    expect((await undiciFetch(url)).status).toBe(200);
    expect(
      await undiciFetch(url, { dispatcher: agent }).then(
        () => "resolved",
        (err: TypeError) => `${err.message}: ${(err.cause as Error).message}`,
      ),
    ).toBe("fetch failed: URL scheme must be http or https (received localhost:)");
    expect(
      await request(url, { dispatcher: agent }).then(
        () => "resolved",
        (err: Error) => err.message,
      ),
    ).toBe("URL scheme must be http or https (received localhost:)");
    expect(seen).toEqual([]);
    expect(hits).toBe(1);
  });

  it("https: the Agent's connect TLS options apply to IP-literal hops too", async () => {
    await using target = Bun.serve({ port: 0, tls: tlsCert, fetch: () => new Response("ip-hop") });
    await using origin = Bun.serve({
      port: 0,
      tls: tlsCert,
      fetch: () => Response.redirect(`https://127.0.0.1:${target.port}/`, 302),
    });
    const seen: string[] = [];
    const agent = new Agent({
      connect: {
        ca: tlsCert.cert,
        // The cert is for localhost; accept the IP-literal hop and record it.
        checkServerIdentity: (hostname: string) => {
          seen.push(`verify:${hostname}`);
          return undefined;
        },
        lookup: (hostname, _o, cb) => {
          seen.push(`lookup:${hostname}`);
          cb(null, "127.0.0.1", 4);
        },
      },
    });
    const res = await undiciFetch(`https://localhost:${origin.port}/`, { dispatcher: agent });
    expect(await res.text()).toBe("ip-hop");
    expect(seen).toEqual(["lookup:localhost", "verify:localhost", "verify:127.0.0.1"]);
    // The same applies to a first hop that is already an IP literal.
    const direct = await undiciFetch(`https://127.0.0.1:${target.port}/`, { dispatcher: agent });
    expect(await direct.text()).toBe("ip-hop");
  });

  it("request() snapshots the headers before the lookup runs", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch: req => new Response(req.headers.get("authorization") ?? "none"),
    });
    const headers = { authorization: "token-A" };
    const agent = new Agent({
      connect: {
        lookup: (_h, _o, cb) => {
          headers.authorization = "token-B";
          cb(null, "127.0.0.1", 4);
        },
      },
    });
    const { body } = await request(`http://snap.invalid:${server.port}/`, { dispatcher: agent, headers });
    expect(await body!.text()).toBe("token-A");
  });

  it("https: an Agent's connect TLS options apply without a lookup hook, across native redirects", async () => {
    await using target = Bun.serve({ port: 0, tls: tlsCert, fetch: () => new Response("tls-only") });
    await using origin = Bun.serve({
      port: 0,
      tls: tlsCert,
      fetch: () => Response.redirect(`https://localhost:${target.port}/`, 302),
    });
    const url = `https://localhost:${origin.port}/`;
    expect(
      await undiciFetch(url, { dispatcher: new Agent({ connect: { timeout: 5000 } }) }).then(
        () => "resolved",
        () => "rejected",
      ),
    ).toBe("rejected");
    const agent = new Agent({ connect: { ca: tlsCert.cert } });
    const res = await undiciFetch(url, { dispatcher: agent });
    expect(await res.text()).toBe("tls-only");
    expect(res.redirected).toBe(true);
    const { body } = await request(url, { dispatcher: agent, maxRedirections: 1 });
    expect(await body!.text()).toBe("tls-only");
  });

  it.skipIf(isWindows)(
    "a pipe-backed Request body streams through the pin instead of being read to EOF first",
    async () => {
      using dir = tempDir("undici-fifo-body", {});
      const fifo = join(String(dir), "fifo");
      mkfifo(fifo, 0o666);
      let received = "";
      await using server = Bun.serve({
        port: 0,
        fetch: async req => {
          received = `${req.headers.get("transfer-encoding")} ${await req.text()}`;
          return new Response("ok");
        },
      });
      const { agent } = pinningAgent();
      const pending = undiciFetch(
        new Request(`http://fifo.invalid:${server.port}/`, {
          method: "POST",
          body: Bun.file(fifo).stream(),
          // @ts-expect-error duplex is required for stream bodies by the spec
          duplex: "half",
        }),
        { dispatcher: agent },
      );
      // The writer blocks until the reader opens the pipe, so a body read to EOF
      // before the request starts would arrive with a Content-Length instead.
      await using writer = Bun.spawn({ cmd: ["sh", "-c", `printf piped > "${fifo}"`], stderr: "pipe" });
      const res = await pending;
      expect(await res.text()).toBe("ok");
      expect(received).toBe("chunked piped");
      expect(await writer.exited).toBe(0);
    },
  );

  it("a Bun.FetchSession's own proxy is kept on pinned hops", async () => {
    await using server = Bun.serve({ port: 0, fetch: () => new Response("reached") });
    const { agent } = pinningAgent();
    const url = `http://session.invalid:${server.port}/`;
    expect(await (await undiciFetch(url, { dispatcher: agent })).text()).toBe("reached");
    // Port 1 is closed: a request that honors the session's proxy cannot reach the server.
    using session = new Bun.FetchSession({ proxy: "http://127.0.0.1:1" });
    expect(
      await undiciFetch(url, { dispatcher: agent, session }).then(
        () => "resolved",
        (err: TypeError) => err.name,
      ),
    ).toBe("TypeError");
  });

  it("an Agent without connect options leaves requests untouched", async () => {
    await using server = Bun.serve({ port: 0, fetch: () => new Response("plain") });
    const res = await undiciFetch(`http://127.0.0.1:${server.port}/`, { dispatcher: new Agent() });
    expect(await res.text()).toBe("plain");
  });
});
