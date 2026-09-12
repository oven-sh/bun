import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { Readable } from "node:stream";
// @ts-expect-error the undici@5 types in test/node_modules predate EventSource
import { EventSource, request, fetch as undiciFetch } from "undici";

import { createServer } from "../../../http-test-server";

describe("undici", () => {
  let serverCtl: ReturnType<typeof createServer>;
  let hostUrl: string;
  let port: number;
  let host: string;

  beforeAll(() => {
    serverCtl = createServer();
    port = serverCtl.port;
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
      ["the response to a HEAD request", "/head", 200, { method: "HEAD" }],
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

describe.concurrent("undici.EventSource", () => {
  function sse(body: BodyInit | null, init: ResponseInit = {}) {
    return new Response(body, { ...init, headers: { "content-type": "text/event-stream", ...init.headers } });
  }

  // Records events in dispatch order, along with the readyState each listener observed, until `until` matches one.
  function record(es: EventSource, until: (event: Event) => boolean, types = ["open", "message", "error"]) {
    const seen: Record<string, unknown>[] = [];
    const { promise: done, resolve } = Promise.withResolvers<void>();
    const listener = (event: Event) => {
      const entry: Record<string, unknown> = { type: event.type, readyState: es.readyState };
      if (event instanceof MessageEvent) {
        entry.data = event.data;
        entry.lastEventId = event.lastEventId;
      }
      seen.push(entry);
      if (until(event)) resolve();
    };
    for (const type of types) es.addEventListener(type, listener);
    return { seen, done };
  }

  const isError = (event: Event) => event.type === "error";
  function nthError(n: number) {
    let errors = 0;
    return (event: Event) => isError(event) && ++errors === n;
  }

  it("has the WebIDL shape and validates its arguments", () => {
    const readOnly = (value: number) => ({ value, writable: false, enumerable: true, configurable: false });
    expect(Object.getOwnPropertyDescriptors(EventSource)).toMatchObject({
      CONNECTING: readOnly(0),
      OPEN: readOnly(1),
      CLOSED: readOnly(2),
    });
    expect(Object.getOwnPropertyDescriptors(EventSource.prototype)).toMatchObject({
      CONNECTING: readOnly(0),
      OPEN: readOnly(1),
      CLOSED: readOnly(2),
    });
    expect(Object.keys(EventSource.prototype).sort()).toEqual([
      "CLOSED",
      "CONNECTING",
      "OPEN",
      "close",
      "onerror",
      "onmessage",
      "onopen",
      "readyState",
      "url",
      "withCredentials",
    ]);

    // @ts-expect-error the url argument is required
    expect(() => new EventSource()).toThrow(TypeError);
    expect(() => new EventSource("not a url")).toThrow(expect.objectContaining({ name: "SyntaxError" }));
    expect(() => new EventSource("/relative")).toThrow(expect.objectContaining({ name: "SyntaxError" }));
    expect(() => new EventSource("http://localhost/", { node: { reconnectionTime: -1 } })).toThrow(
      expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }),
    );
    expect(() => new EventSource("http://localhost/", { node: { reconnectionTime: "5" } })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
    expect(() => new EventSource("http://localhost/", "with-credentials" as any)).toThrow(TypeError);
    // A dictionary argument accepts null and undefined as "no options".
    for (const init of [null, undefined]) {
      const es = new EventSource("http://127.0.0.1:1/", init as any);
      es.close();
      expect(es.readyState).toBe(EventSource.CLOSED);
    }
  });

  it("connects and dispatches MessageEvents", async () => {
    const requestHeaders: Record<string, string | null> = {};
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        for (const name of ["accept", "cache-control", "last-event-id"]) requestHeaders[name] = req.headers.get(name);
        return sse('id: 1\ndata: hello\n\nevent: ping\ndata: {"n":2}\n\n');
      },
    });

    const es = new EventSource(new URL("/stream?x=1", server.url), { withCredentials: true });
    try {
      const { seen, done } = record(es, isError, ["open", "message", "ping", "error"]);
      const { promise: firstMessage, resolve, reject } = Promise.withResolvers<MessageEvent>();
      es.onmessage = resolve;
      es.onerror = reject;
      expect(es.readyState).toBe(EventSource.CONNECTING);
      expect(es.url).toBe(`${server.url.origin}/stream?x=1`);
      expect(es.withCredentials).toBe(true);
      expect(String(es)).toBe("[object EventSource]");

      const message = await firstMessage;
      expect(message).toBeInstanceOf(MessageEvent);
      expect(message.origin).toBe(server.url.origin);

      // The server ended the stream after the second event, which reports an error and schedules a reconnect.
      await done;
      expect(seen).toEqual([
        { type: "open", readyState: 1 },
        { type: "message", readyState: 1, data: "hello", lastEventId: "1" },
        { type: "ping", readyState: 1, data: '{"n":2}', lastEventId: "1" },
        { type: "error", readyState: 0 },
      ]);
      expect(requestHeaders).toEqual({
        "accept": "text/event-stream",
        "cache-control": "no-cache",
        "last-event-id": null,
      });
    } finally {
      es.close();
    }
    expect(es.readyState).toBe(EventSource.CLOSED);
  });

  it("interprets the event stream format", async () => {
    const stream = [
      "\uFEFF: a leading BOM and comment lines are ignored\n",
      "data: first line\ndata: second line\n\n",
      "data:no space after the colon\n\n",
      "data:  only one leading space is stripped\n\n",
      "event: custom\ndata: typed\n\n",
      "event: dropped\n\n", // no data: nothing is dispatched and the type buffer is reset
      "data: back to message\n\n",
      "data\n\n", // a field without a colon has an empty value
      "id: 42\n\n", // the blank line commits the id even without data
      "id: bad\0id\ndata: keeps 42\n\n",
      "id\ndata: empty id\n\n",
      "unknown: field\ndata: unknown fields are ignored\n\n",
      "data: never dispatched, the stream ends before the blank line",
    ].join("");
    using server = Bun.serve({
      port: 0,
      fetch: () => sse(stream, { headers: { "content-type": "TEXT/Event-Stream; charset=utf-8" } }),
    });

    const es = new EventSource(server.url);
    try {
      const { seen, done } = record(es, isError, ["message", "custom", "dropped", "error"]);
      await done;
      expect(seen).toEqual([
        { type: "message", readyState: 1, data: "first line\nsecond line", lastEventId: "" },
        { type: "message", readyState: 1, data: "no space after the colon", lastEventId: "" },
        { type: "message", readyState: 1, data: " only one leading space is stripped", lastEventId: "" },
        { type: "custom", readyState: 1, data: "typed", lastEventId: "" },
        { type: "message", readyState: 1, data: "back to message", lastEventId: "" },
        { type: "message", readyState: 1, data: "", lastEventId: "" },
        { type: "message", readyState: 1, data: "keeps 42", lastEventId: "42" },
        { type: "message", readyState: 1, data: "empty id", lastEventId: "" },
        { type: "message", readyState: 1, data: "unknown fields are ignored", lastEventId: "" },
        { type: "error", readyState: 0 },
      ]);
    } finally {
      es.close();
    }
  });

  it("handles line endings and UTF-8 sequences that are split across chunks", async () => {
    let push!: (bytes: Uint8Array) => void;
    using server = Bun.serve({
      port: 0,
      fetch() {
        return sse(
          new ReadableStream({
            start(controller) {
              push = bytes => controller.enqueue(bytes);
              push(Buffer.from("data: 1\r\n\r\ndata: a\rdata: b\r"));
            },
          }),
        );
      },
    });

    const es = new EventSource(server.url);
    try {
      const data: string[] = [];
      let waiter = Promise.withResolvers<void>();
      es.onmessage = event => {
        data.push(event.data);
        waiter.resolve();
      };
      es.onerror = () => waiter.reject(new Error(`unexpected error event, readyState ${es.readyState}`));
      const nextMessage = () => (waiter = Promise.withResolvers<void>()).promise;

      // Each chunk below is only sent once the client has dispatched the previous chunk's last event, so every
      // boundary is really observed by the parser.
      await nextMessage();
      expect(data).toEqual(["1"]);

      // The LF completes the CR that ended the previous chunk; it is not an empty line.
      let received = nextMessage();
      push(Buffer.from("\ndata: c\r\r"));
      await received;
      expect(data).toEqual(["1", "a\nb\nc"]);

      // The previous chunk ended in a CR that is not followed by a LF, and this one ends mid-character.
      received = nextMessage();
      push(new Uint8Array([...Buffer.from("data: d\n\ndata: "), 0xe2, 0x82]));
      await received;
      expect(data).toEqual(["1", "a\nb\nc", "d"]);

      received = nextMessage();
      push(new Uint8Array([0xac, 0x0a, 0x0a]));
      await received;
      expect(data).toEqual(["1", "a\nb\nc", "d", "\u20ac"]);
    } finally {
      es.close();
    }
  });

  it("reconnects after the server ends the stream, sending Last-Event-ID and honoring retry:", async () => {
    // One character inside Latin-1 and one outside it: the header has to carry the id's UTF-8 bytes.
    const id = "\u00e9v\u00e9nement \u2026 7";
    const lastEventIdHeaders: (string | null)[] = [];
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        // Header values arrive one character per byte; decode them as UTF-8 like an SSE server would.
        const header = req.headers.get("last-event-id");
        lastEventIdHeaders.push(header === null ? null : Buffer.from(header, "latin1").toString());
        if (lastEventIdHeaders.length === 1) {
          // `id: 8` is never followed by a blank line, so it must not become the last event id.
          return sse(`retry: 10\n\nid: ${id}\ndata: first\n\nid: 8\ndata: incomplete`);
        }
        return sse("data: second\n\n");
      },
    });

    const es = new EventSource(server.url);
    try {
      const { seen, done } = record(es, nthError(2));
      await done;
      expect(seen).toEqual([
        { type: "open", readyState: 1 },
        { type: "message", readyState: 1, data: "first", lastEventId: id },
        { type: "error", readyState: 0 },
        { type: "open", readyState: 1 },
        { type: "message", readyState: 1, data: "second", lastEventId: id },
        { type: "error", readyState: 0 },
      ]);
      expect(lastEventIdHeaders).toEqual([null, id]);
    } finally {
      es.close();
    }
  });

  it("reconnects after the connection drops mid-stream", async () => {
    const firstEventDelivered = Promise.withResolvers<void>();
    const head = "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ntransfer-encoding: chunked\r\n\r\n";
    const chunk = (body: string) => `${body.length.toString(16)}\r\n${body}\r\n`;
    let connections = 0;
    using listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        async open(socket) {
          if (++connections > 1) {
            socket.end(head + chunk("data: after the drop\n\n") + "0\r\n\r\n");
            return;
          }
          socket.write(head + chunk("retry: 10\ndata: before the drop\n\n"));
          await firstEventDelivered.promise;
          // Hanging up before the terminating chunk is what a dropped connection looks like to the client.
          socket.end();
        },
        data() {},
      },
    });

    const es = new EventSource(`http://127.0.0.1:${listener.port}/`);
    try {
      const { seen, done } = record(es, nthError(2));
      es.addEventListener("message", () => firstEventDelivered.resolve(), { once: true });
      await done;
      expect(seen).toEqual([
        { type: "open", readyState: 1 },
        { type: "message", readyState: 1, data: "before the drop", lastEventId: "" },
        { type: "error", readyState: 0 },
        { type: "open", readyState: 1 },
        { type: "message", readyState: 1, data: "after the drop", lastEventId: "" },
        { type: "error", readyState: 0 },
      ]);
      expect(connections).toBe(2);
    } finally {
      es.close();
    }
  });

  it("uses node.reconnectionTime until the server sends retry:", async () => {
    let connections = 0;
    using server = Bun.serve({ port: 0, fetch: () => sse(`data: ${++connections}\n\n`) });

    const es = new EventSource(server.url, { node: { reconnectionTime: 5 } });
    try {
      const { seen, done } = record(es, nthError(2));
      await done;
      expect(seen).toEqual([
        { type: "open", readyState: 1 },
        { type: "message", readyState: 1, data: "1", lastEventId: "" },
        { type: "error", readyState: 0 },
        { type: "open", readyState: 1 },
        { type: "message", readyState: 1, data: "2", lastEventId: "" },
        { type: "error", readyState: 0 },
      ]);
    } finally {
      es.close();
    }
  });

  it.each([
    ["a 204", () => new Response(null, { status: 204 })],
    ["a non-200 event stream", () => sse("data: x\n\n", { status: 500 })],
    [
      "a 200 with another content type",
      () => new Response("data: x\n\n", { headers: { "content-type": "text/plain" } }),
    ],
    ["a 401 when the URL carries no credentials", () => new Response(null, { status: 401 })],
  ])("fails the connection without reconnecting on %s", async (_, respond) => {
    using server = Bun.serve({ port: 0, fetch: respond });

    const es = new EventSource(server.url);
    try {
      const { seen, done } = record(es, isError);
      await done;
      expect(seen).toEqual([{ type: "error", readyState: 2 }]);
      expect(es.readyState).toBe(EventSource.CLOSED);
    } finally {
      es.close();
    }
  });

  it("reports the origin of the URL that served the stream after a redirect", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        if (new URL(req.url).pathname === "/redirect") {
          return Response.redirect(`http://127.0.0.1:${server.port}/target`, 302);
        }
        return sse("data: redirected\n\n");
      },
    });

    const url = `http://localhost:${server.port}/redirect`;
    const es = new EventSource(url);
    try {
      const { promise, resolve, reject } = Promise.withResolvers<MessageEvent>();
      es.onmessage = resolve;
      es.onerror = reject;
      const event = await promise;
      expect({ url: es.url, data: event.data, origin: event.origin }).toEqual({
        url,
        data: "redirected",
        origin: `http://127.0.0.1:${server.port}`,
      });
    } finally {
      es.close();
    }
  });

  it("close() while connecting fires no events and hangs up the request", async () => {
    const requestArrived = Promise.withResolvers<void>();
    const requestAborted = Promise.withResolvers<void>();
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        requestArrived.resolve();
        req.signal.addEventListener("abort", () => requestAborted.resolve());
        // Never respond; the client is expected to hang up.
        return new Promise<Response>(() => {});
      },
    });

    const es = new EventSource(server.url);
    const { seen } = record(es, () => false);
    await requestArrived.promise;
    expect(es.readyState).toBe(EventSource.CONNECTING);

    es.close();
    expect(es.readyState).toBe(EventSource.CLOSED);
    await requestAborted.promise;
    expect(seen).toEqual([]);
  });

  it("close() inside a listener drops the rest of the chunk and releases the connection", async () => {
    const streamCancelled = Promise.withResolvers<void>();
    using server = Bun.serve({
      port: 0,
      fetch() {
        return sse(
          new ReadableStream({
            start(controller) {
              controller.enqueue(Buffer.from("data: 1\n\ndata: 2\n\ndata: 3\n\n"));
            },
            cancel() {
              streamCancelled.resolve();
            },
          }),
        );
      },
    });

    const es = new EventSource(server.url);
    es.onmessage = () => es.close();
    const { seen, done } = record(es, event => event instanceof MessageEvent);
    await done;
    await streamCancelled.promise;
    expect(seen).toEqual([
      { type: "open", readyState: 1 },
      { type: "message", readyState: 2, data: "1", lastEventId: "" },
    ]);
  });

  it("close() inside the error listener cancels the reconnect", async () => {
    let streamRequests = 0;
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        if (new URL(req.url).pathname !== "/stream") return new Response();
        streamRequests++;
        return sse("retry: 1\ndata: only\n\n");
      },
    });

    const es = new EventSource(new URL("/stream", server.url));
    const { seen, done } = record(es, isError);
    es.onerror = () => es.close();
    await done;
    expect(seen).toEqual([
      { type: "open", readyState: 1 },
      { type: "message", readyState: 1, data: "only", lastEventId: "" },
      { type: "error", readyState: 0 },
    ]);
    expect(es.readyState).toBe(EventSource.CLOSED);

    // A reconnect was due after 1ms; a full round trip to the server later, none has happened.
    await fetch(new URL("/probe", server.url));
    expect(streamRequests).toBe(1);
  });

  it("implements onopen/onmessage/onerror as event handler attributes", async () => {
    using server = Bun.serve({ port: 0, fetch: () => sse("data: x\n\n") });

    const es = new EventSource(server.url);
    try {
      const calls: string[] = [];
      const handler = function (this: unknown, event: MessageEvent) {
        calls.push(`handler:${event.data}:${this === es}`);
      };

      expect([es.onopen, es.onmessage, es.onerror]).toEqual([null, null, null]);
      es.onmessage = handler;
      expect(es.onmessage).toBe(handler);
      // The attribute is a listener of its own, so the same function can also be registered explicitly.
      es.addEventListener("message", handler);
      es.onopen = "not a handler" as any;
      expect(es.onopen).toBeNull();
      const notCallable = {};
      es.onopen = notCallable as any;
      expect(es.onopen).toBe(notCallable);
      es.onerror = () => calls.push("replaced");
      es.onerror = () => calls.push("error");

      const { done } = record(es, isError, ["error"]);
      await done;
      expect(calls).toEqual(["handler:x:true", "handler:x:true", "error"]);

      es.onmessage = null;
      expect(es.onmessage).toBeNull();
    } finally {
      es.close();
    }
  });

  it("does not route its own events and handler registration through subclass overrides", async () => {
    using server = Bun.serve({ port: 0, fetch: () => sse("data: x\n\n") });
    const overrideCalls: string[] = [];
    class Logged extends EventSource {
      addEventListener(type: string, listener: any, options?: any) {
        overrideCalls.push(`addEventListener:${type}`);
        super.addEventListener(type, listener, options);
      }
      dispatchEvent(event: Event) {
        overrideCalls.push(`dispatchEvent:${event.type}`);
        return super.dispatchEvent(event);
      }
    }

    const es = new Logged(server.url);
    try {
      const { seen, done } = record(es, isError);
      es.onmessage = () => {};
      es.dispatchEvent(new Event("custom"));
      await done;
      expect(seen).toEqual([
        { type: "open", readyState: 1 },
        { type: "message", readyState: 1, data: "x", lastEventId: "" },
        { type: "error", readyState: 0 },
      ]);
      // Only the explicit calls made by the test went through the overrides, as with a native EventTarget subclass.
      expect(overrideCalls).toEqual([
        "addEventListener:open",
        "addEventListener:message",
        "addEventListener:error",
        "dispatchEvent:custom",
      ]);
    } finally {
      es.close();
    }
  });

  it("answers a 401 challenge with the credentials embedded in the URL, and keeps sending them when reconnecting", async () => {
    const authorizations: (string | null)[] = [];
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        const authorization = req.headers.get("authorization");
        authorizations.push(authorization);
        if (authorization === null) {
          return new Response(null, { status: 401, headers: { "www-authenticate": 'Basic realm="events"' } });
        }
        return sse(`retry: 10\ndata: stream ${authorizations.length}\n\n`);
      },
    });

    const url = `http://user:p%40ss@127.0.0.1:${server.port}/events`;
    const es = new EventSource(url);
    try {
      const { seen, done } = record(es, nthError(2));
      await done;
      expect(es.url).toBe(url);
      // The challenge round trip is invisible: the first observable event is the open of the authenticated request.
      expect(seen).toEqual([
        { type: "open", readyState: 1 },
        { type: "message", readyState: 1, data: "stream 2", lastEventId: "" },
        { type: "error", readyState: 0 },
        { type: "open", readyState: 1 },
        { type: "message", readyState: 1, data: "stream 3", lastEventId: "" },
        { type: "error", readyState: 0 },
      ]);
      const basic = `Basic ${btoa("user:p@ss")}`;
      expect(authorizations).toEqual([null, basic, basic]);
    } finally {
      es.close();
    }
  });

  it("fails the connection with an ErrorEvent when the stream cannot be parsed", async () => {
    // Parsing only throws on resource exhaustion (a line too long to hold in a string), which is too expensive to
    // provoke in a test, so the decoder is made to throw instead. The client runs in a subprocess to contain the
    // patched prototype; the subprocess has nothing else keeping it alive, so it exits as soon as the connection is gone.
    const streamCancelled = Promise.withResolvers<void>();
    using server = Bun.serve({
      port: 0,
      fetch: () =>
        sse(
          new ReadableStream({
            start(controller) {
              controller.enqueue(Buffer.from("data: x\n\n"));
            },
            cancel() {
              streamCancelled.resolve();
            },
          }),
        ),
    });

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { EventSource } = require("undici");
         TextDecoder.prototype.decode = () => { throw new RangeError("decoder boom"); };
         const es = new EventSource(process.env.SSE_URL);
         es.onmessage = () => console.log("unexpected message");
         es.onerror = event => {
           console.log(JSON.stringify({
             event: event.constructor.name,
             message: event.message,
             error: event.error instanceof RangeError,
             readyState: es.readyState,
           }));
         };`,
      ],
      env: { ...bunEnv, SSE_URL: server.url.href },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe(
      JSON.stringify({ event: "ErrorEvent", message: "decoder boom", error: true, readyState: 2 }) + "\n",
    );
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    await streamCancelled.promise;
  });

  it("a refused connection reports an error without keeping the process alive for the reconnect", async () => {
    // Nothing listens on port 1 (tcpmux); the same address the shape test above uses.
    const url = "http://127.0.0.1:1/";

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { EventSource } = require("undici");
         const es = new EventSource(${JSON.stringify(url)});
         es.onopen = () => console.log("unexpected open");
         es.onerror = () => console.log(JSON.stringify({ readyState: es.readyState, url: es.url, close: typeof es.close }));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe(JSON.stringify({ readyState: 0, url, close: "function" }) + "\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});
