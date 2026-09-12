import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Readable } from "node:stream";
import {
  Agent,
  Client,
  Dispatcher,
  Pool,
  RetryAgent,
  errors,
  getGlobalDispatcher,
  request,
  fetch as undiciFetch,
} from "undici";

import { bunEnv, bunExe } from "harness";

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

  describe("Dispatcher", () => {
    // Drives dispatch() with the legacy handler interface and collects the response.
    function dispatchLegacy(dispatcher: any, opts: any) {
      return new Promise<{ statusCode: number; headers: Record<string, string>; body: string }>((resolve, reject) => {
        let statusCode = 0;
        const headers: Record<string, string> = {};
        const chunks: Buffer[] = [];
        dispatcher.dispatch(opts, {
          onConnect: () => {},
          onHeaders: (status: number, rawHeaders: Buffer[]) => {
            statusCode = status;
            for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
              headers[String(rawHeaders[i]).toLowerCase()] = String(rawHeaders[i + 1]);
            }
            return true;
          },
          onData: (chunk: Buffer) => {
            chunks.push(chunk);
            return true;
          },
          onComplete: () => resolve({ statusCode, headers, body: Buffer.concat(chunks).toString() }),
          onError: reject,
        });
      });
    }

    it("Pool exposes dispatch(), close() and destroy()", () => {
      const pool = new Pool(hostUrl);
      expect(typeof pool.dispatch).toBe("function");
      expect(typeof pool.close).toBe("function");
      expect(typeof pool.destroy).toBe("function");
      expect(typeof pool.request).toBe("function");
    });

    // Resolving null is what upstream undici's close()/destroy() resolve to.
    it("Agent.close() resolves null", async () => {
      const agent = new Agent();
      expect(typeof agent.close).toBe("function");
      expect(await agent.close()).toBe(null);
    });

    it("Agent.destroy() resolves null", async () => {
      const agent = new Agent();
      expect(typeof agent.destroy).toBe("function");
      expect(await agent.destroy()).toBe(null);
    });

    it("Pool.close() and destroy() resolve null", async () => {
      const pool = new Pool(hostUrl);
      expect(await pool.close()).toBe(null);
      expect(await pool.destroy()).toBe(null);
    });

    it("Client.close() and destroy() resolve null", async () => {
      const client = new Client(hostUrl);
      expect(typeof client.close).toBe("function");
      expect(typeof client.destroy).toBe("function");
      expect(await client.close()).toBe(null);
      expect(await client.destroy()).toBe(null);
    });

    it("Pool.dispatch performs a request with the legacy handler interface", async () => {
      const pool = new Pool(hostUrl);
      const res = await dispatchLegacy(pool, { path: "/get", method: "GET" });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("application/json");
      expect(JSON.parse(res.body)).toEqual({ url: `${hostUrl}/get`, method: "GET" });
      await pool.close();
    });

    it("Pool.dispatch performs a request with the controller handler interface", async () => {
      const pool = new Pool(hostUrl);
      const res = await new Promise<{ statusCode: number; headers: any; body: string; ended: boolean }>(
        (resolve, reject) => {
          let statusCode = 0;
          let headers: any;
          let started = false;
          const chunks: Buffer[] = [];
          pool.dispatch(
            { path: "/post", method: "POST", body: "Hello world" },
            {
              onRequestStart: () => {
                started = true;
              },
              onResponseStart: (_controller: any, status: number, responseHeaders: any) => {
                statusCode = status;
                headers = responseHeaders;
              },
              onResponseData: (_controller: any, chunk: Buffer) => {
                chunks.push(chunk);
              },
              onResponseEnd: () => {
                resolve({ statusCode, headers, body: Buffer.concat(chunks).toString(), ended: started });
              },
              onResponseError: (_controller: any, err: Error) => reject(err),
            },
          );
        },
      );
      expect(res.ended).toBe(true);
      expect(res.statusCode).toBe(201);
      expect(res.headers["content-type"]).toBe("application/json");
      expect((JSON.parse(res.body) as { data: string }).data).toBe("Hello world");
      await pool.destroy();
    });

    it("Pool.request body exposes the undici body mixin", async () => {
      const pool = new Pool(hostUrl);
      const { statusCode, body } = await pool.request({ path: "/get", method: "GET" });
      expect(statusCode).toBe(200);
      expect(body.bodyUsed).toBe(false);
      expect(await body.json()).toEqual({ url: `${hostUrl}/get`, method: "GET" });
      expect(body.bodyUsed).toBe(true);
      await expect(body.json()).rejects.toThrow("unusable");
      await pool.close();
    });

    it("request() body reports bodyUsed after direct iteration", async () => {
      const pool = new Pool(hostUrl);
      const { body } = await pool.request({ path: "/get", method: "GET" });
      for await (const chunk of body) {
        // drain directly instead of via the mixin
      }
      expect(body.bodyUsed).toBe(true);
      await expect(body.text()).rejects.toThrow("unusable");
      await pool.close();
    });

    it("Pool.request honors opts.signal", async () => {
      await using server = Bun.serve({
        port: 0,
        fetch() {
          // Never respond; the request can only finish by being aborted.
          return new Promise<Response>(() => {});
        },
      });
      const pool = new Pool(`http://localhost:${server.port}`);
      const ac = new AbortController();
      const pending = pool.request({ path: "/", method: "GET", signal: ac.signal });
      ac.abort();
      // The signal's reason (a DOMException named AbortError) propagates, like undici.
      await expect(pending).rejects.toHaveProperty("name", "AbortError");
      await pool.destroy();
    });

    it("request rejects a pre-aborted signal without dispatching", async () => {
      let dispatched = false;
      const dispatcher = new (class extends Dispatcher {
        dispatch() {
          dispatched = true;
          return true;
        }
      })();
      const ac = new AbortController();
      ac.abort();
      await expect(
        dispatcher.request({ origin: "http://localhost:1", path: "/", method: "GET", signal: ac.signal }),
      ).rejects.toHaveProperty("name", "AbortError");
      expect(dispatched).toBe(false);
    });

    it("fetch with a dispatcher rejects a pre-aborted signal without dispatching", async () => {
      let dispatched = false;
      const dispatcher = {
        dispatch() {
          dispatched = true;
          return true;
        },
      };
      const ac = new AbortController();
      ac.abort();
      await expect(undiciFetch("http://localhost:1/", { dispatcher, signal: ac.signal } as any)).rejects.toHaveProperty(
        "name",
        "AbortError",
      );
      expect(dispatched).toBe(false);
    });

    it("a throwing onHeaders routes the error to onError", async () => {
      const pool = new Pool(hostUrl);
      const boom = new Error("bad status");
      const err = await new Promise<any>((resolve, reject) => {
        pool.dispatch(
          { path: "/get", method: "GET" },
          {
            onConnect: () => {},
            onHeaders: () => {
              throw boom;
            },
            onData: () => reject(new Error("should not receive data")),
            onComplete: () => reject(new Error("should not complete")),
            onError: resolve,
          },
        );
      });
      expect(err).toBe(boom);
      await pool.close();
    });

    it("Pool.request resolves with a readable body", async () => {
      const pool = new Pool(hostUrl);
      const { statusCode, headers, body } = await pool.request({ path: "/get", method: "GET" });
      expect(statusCode).toBe(200);
      expect(headers["content-type"]).toBe("application/json");
      const chunks: Buffer[] = [];
      for await (const chunk of body) chunks.push(chunk);
      expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual({ url: `${hostUrl}/get`, method: "GET" });
      await pool.close();
    });

    it("Client.request sends a request body", async () => {
      const client = new Client(hostUrl);
      const { statusCode, body } = await client.request({ path: "/post", method: "POST", body: "ping" });
      expect(statusCode).toBe(201);
      const chunks: Buffer[] = [];
      for await (const chunk of body) chunks.push(chunk);
      expect((JSON.parse(Buffer.concat(chunks).toString()) as { data: string }).data).toBe("ping");
      await client.close();
    });

    it("a completed close() transitions to destroyed, like undici", async () => {
      const pool = new Pool(hostUrl);
      await pool.close();
      expect(pool.closed).toBe(true);
      expect(pool.destroyed).toBe(true);
      await expect(dispatchLegacy(pool, { path: "/get", method: "GET" })).rejects.toHaveProperty(
        "code",
        "UND_ERR_DESTROYED",
      );
      await expect(pool.request({ path: "/get", method: "GET" })).rejects.toBeInstanceOf(errors.ClientDestroyedError);
    });

    it("destroy() resolves and later requests fail with ClientDestroyedError", async () => {
      const pool = new Pool(hostUrl);
      await pool.destroy();
      expect(pool.destroyed).toBe(true);
      await expect(pool.request({ path: "/get", method: "GET" })).rejects.toHaveProperty("code", "UND_ERR_DESTROYED");
    });

    it("dispatch without an error callback throws synchronously", () => {
      const pool = new Pool(hostUrl);
      expect(() =>
        pool.dispatch({ path: "/get", method: "GET" }, {
          onHeaders: () => true,
          onData: () => {},
          onComplete: () => {},
        } as any),
      ).toThrow(errors.InvalidArgumentError);
    });

    it("dispatch keeps '//' paths on the configured origin", async () => {
      const pool = new Pool(hostUrl);
      const res = await dispatchLegacy(pool, { path: "//evil.example/x", method: "GET" });
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).url).toStartWith(hostUrl);
      await pool.close();
    });

    it("dispatch rejects opts.query combined with a path that already has one", async () => {
      const pool = new Pool(hostUrl);
      await expect(dispatchLegacy(pool, { path: "/get?a=1", method: "GET", query: { b: "2" } })).rejects.toHaveProperty(
        "code",
        "UND_ERR_INVALID_ARG",
      );
      await pool.close();
    });

    it("dispatch rejects paths that do not start with '/'", async () => {
      const pool = new Pool(hostUrl);
      await expect(dispatchLegacy(pool, { path: "http://evil.example/x", method: "GET" })).rejects.toHaveProperty(
        "code",
        "UND_ERR_INVALID_ARG",
      );
      await pool.close();
    });

    it("streams a node Readable request body", async () => {
      const client = new Client(hostUrl);
      const { statusCode, body } = await client.request({
        path: "/post",
        method: "POST",
        body: Readable.from(["pi", "ng"]),
      });
      expect(statusCode).toBe(201);
      expect(((await body.json()) as { data: string }).data).toBe("ping");
      await client.close();
    });

    it("body.destroy() cancels the underlying request", async () => {
      const cancelled = Promise.withResolvers<void>();
      await using server = Bun.serve({
        port: 0,
        fetch() {
          const stream = new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(1024));
            },
            cancel() {
              cancelled.resolve();
            },
          });
          return new Response(stream, { headers: { "content-type": "application/octet-stream" } });
        },
      });
      const pool = new Pool(`http://localhost:${server.port}`);
      const { body } = await pool.request({ path: "/", method: "GET" });
      // Read one chunk, then bail out; breaking destroys the body stream.
      for await (const chunk of body) break;
      await cancelled.promise;
      await pool.destroy();
    });

    it("close() waits for in-flight requests to finish", async () => {
      const gate = Promise.withResolvers<void>();
      await using server = Bun.serve({
        port: 0,
        async fetch() {
          await gate.promise;
          return new Response("done");
        },
      });
      const pool = new Pool(`http://localhost:${server.port}`);
      const events: string[] = [];
      const completed = new Promise<void>((resolve, reject) => {
        pool.dispatch(
          { path: "/", method: "GET" },
          {
            onConnect: () => {},
            onHeaders: () => true,
            onData: () => true,
            onComplete: () => {
              events.push("complete");
              resolve();
            },
            onError: reject,
          },
        );
      });
      const closed = pool.close().then(() => {
        events.push("closed");
      });
      gate.resolve();
      await Promise.all([completed, closed]);
      expect(events).toEqual(["complete", "closed"]);
    });

    it("destroy() aborts in-flight requests with ClientDestroyedError", async () => {
      await using server = Bun.serve({
        port: 0,
        fetch() {
          return new Promise<Response>(() => {});
        },
      });
      const pool = new Pool(`http://localhost:${server.port}`);
      const errPromise = new Promise<any>((resolve, reject) => {
        pool.dispatch(
          { path: "/", method: "GET" },
          {
            onConnect: () => {},
            onHeaders: () => reject(new Error("should not receive headers")),
            onData: () => {},
            onComplete: () => reject(new Error("should not complete")),
            onError: resolve,
          },
        );
      });
      await pool.destroy();
      const err = await errPromise;
      expect(err.code).toBe("UND_ERR_DESTROYED");
    });

    it("abort() from onData on the final chunk delivers onError, not onComplete", async () => {
      const pool = new Pool(hostUrl);
      let abortFn: ((reason?: Error) => void) | undefined;
      const err = await new Promise<any>((resolve, reject) => {
        pool.dispatch(
          { path: "/get", method: "GET" },
          {
            onConnect: (abort: (reason?: Error) => void) => {
              abortFn = abort;
            },
            onHeaders: () => true,
            onData: () => {
              abortFn!();
              return true;
            },
            onComplete: () => reject(new Error("should not complete")),
            onError: resolve,
          },
        );
      });
      expect(err.code).toBe("UND_ERR_ABORTED");
      await pool.destroy();
    });

    it("fetch routes through init.dispatcher like miniflare", async () => {
      await using target = Bun.serve({
        port: 0,
        fetch: req => new Response("routed:" + new URL(req.url).pathname),
      });
      const pool = new Pool(`http://localhost:${target.port}`);
      let dispatched = 0;
      // miniflare's pattern: a custom dispatcher that rewrites every request
      // into its own Pool, ignoring the URL's authority.
      const dispatcher = {
        dispatch(opts: any, handler: any) {
          dispatched++;
          return pool.dispatch(opts, handler);
        },
      };
      // Nothing listens on the URL's port; only dispatcher routing can answer.
      const res = await undiciFetch("http://localhost:1/test?q=1", { dispatcher } as any);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("routed:/test");
      expect(dispatched).toBe(1);
      await pool.close();
    });

    it("fetch with init.dispatcher sends the request body", async () => {
      await using target = Bun.serve({
        port: 0,
        fetch: async req => new Response("echo:" + (await req.text())),
      });
      const pool = new Pool(`http://localhost:${target.port}`);
      const dispatcher = {
        dispatch: (opts: any, handler: any) => pool.dispatch(opts, handler),
      };
      const res = await undiciFetch("http://localhost:1/", {
        method: "POST",
        body: "hello",
        dispatcher,
      } as any);
      expect(await res.text()).toBe("echo:hello");
      await pool.close();
    });

    it("async failures reach onResponseError on legacy-shaped handlers without onError", async () => {
      const pool = new Pool("http://127.0.0.1:1");
      const err = await new Promise<any>((resolve, reject) => {
        pool.dispatch(
          { path: "/", method: "GET" },
          {
            onHeaders: () => reject(new Error("should not receive headers")),
            onData: () => {},
            onComplete: () => reject(new Error("should not complete")),
            onResponseError: (_controller: any, e: Error) => resolve(e),
          },
        );
      });
      expect(err.code).toBe("ConnectionRefused");
      await pool.destroy();
    });

    it("request() destroys a stream body when dispatch fails", async () => {
      const pool = new Pool(hostUrl);
      await pool.close();
      const reqBody = Readable.from(["x"]);
      await expect(pool.request({ path: "/post", method: "POST", body: reqBody })).rejects.toBeInstanceOf(
        errors.ClientDestroyedError,
      );
      expect(reqBody.destroyed).toBe(true);
    });

    it("request({ signal }) cancels through a user Dispatcher subclass", async () => {
      class NeverResponds extends Dispatcher {
        dispatch(_opts: any, handler: any) {
          // A compliant dispatch() never reads opts.signal; it only hands out abort.
          handler.onConnect((reason?: Error) => handler.onError(reason ?? new Error("aborted")));
          return true;
        }
      }
      const ac = new AbortController();
      const pending = new NeverResponds().request({ path: "/", method: "GET", signal: ac.signal });
      ac.abort();
      await expect(pending).rejects.toHaveProperty("name", "AbortError");
    });

    it("request() exposes trailers and context from the dispatcher", async () => {
      class WithTrailers extends Dispatcher {
        dispatch(_opts: any, handler: any) {
          handler.onConnect(() => {}, { some: "context" });
          handler.onHeaders(200, [], () => {}, "OK");
          handler.onData(Buffer.from("hi"));
          handler.onComplete([Buffer.from("x-foo"), Buffer.from("bar")]);
          return true;
        }
      }
      const { trailers, context, body } = await new WithTrailers().request({ path: "/", method: "GET" });
      expect(await body.text()).toBe("hi");
      expect(context).toEqual({ some: "context" });
      expect(trailers).toEqual({ "x-foo": "bar" });
    });

    it("request(cb) does not invoke a throwing callback twice", async () => {
      const pool = new Pool(hostUrl);
      await pool.close();
      let calls = 0;
      expect(() =>
        pool.request({ path: "/", method: "GET" }, () => {
          calls++;
          throw new Error("user callback threw");
        }),
      ).not.toThrow();
      expect(calls).toBe(1);
    });

    it("request({ signal }) registers a single abort listener", async () => {
      const pool = new Pool(hostUrl);
      let adds = 0;
      const signal = {
        aborted: false,
        on: () => {
          adds++;
        },
        removeListener: () => {},
      };
      const { body } = await pool.request({ path: "/get", method: "GET", signal: signal as any });
      await body.text();
      expect(adds).toBe(1);
      await pool.close();
    });

    it("fetch with dispatcher normalizes only the WHATWG methods", async () => {
      const seen: string[] = [];
      const dispatcher = {
        dispatch(opts: any, handler: any) {
          seen.push(opts.method);
          handler.onConnect(() => {});
          handler.onHeaders(200, [], () => {}, "OK");
          handler.onComplete([]);
          return true;
        },
      };
      await undiciFetch("http://localhost:1/", { method: "get", dispatcher } as any);
      await undiciFetch("http://localhost:1/", { method: "patch", dispatcher } as any);
      expect(seen).toEqual(["GET", "patch"]);
    });

    it("fetch honors redirect 'error' set on a Request input", async () => {
      await using target = Bun.serve({
        port: 0,
        fetch: () => new Response(null, { status: 302, headers: { location: "/next" } }),
      });
      const pool = new Pool(`http://localhost:${target.port}`);
      const dispatcher = { dispatch: (opts: any, handler: any) => pool.dispatch(opts, handler) };
      const req = new Request("http://localhost:1/", { redirect: "error" });
      await expect(undiciFetch(req, { dispatcher } as any)).rejects.toBeInstanceOf(TypeError);
      await pool.destroy();
    });

    it("getGlobalDispatcher() does not reroute bare fetch", async () => {
      await using server = Bun.serve({
        port: 0,
        fetch: () => new Response("native"),
      });
      getGlobalDispatcher();
      const res = await undiciFetch(`http://localhost:${server.port}/x`);
      // nativeFetch populates res.url; the shim dispatcher path cannot.
      expect(res.url).toBe(`http://localhost:${server.port}/x`);
      expect(await res.text()).toBe("native");
    });

    it("request(cb) delivers opaque on the error path", async () => {
      const pool = new Pool(hostUrl);
      await pool.close();
      const { promise, resolve } = Promise.withResolvers<{ err: any; data: any }>();
      pool.request({ path: "/", method: "GET", opaque: { reqId: 42 } }, (err: any, data: any) =>
        resolve({ err, data }),
      );
      const { err, data } = await promise;
      expect(err.code).toBe("UND_ERR_DESTROYED");
      expect(data.opaque).toEqual({ reqId: 42 });
    });

    it("request() rejects when the dispatcher completes without a response", async () => {
      class CompletesEarly extends Dispatcher {
        dispatch(_opts: any, handler: any) {
          handler.onConnect(() => {});
          // A stray chunk before onHeaders is dropped rather than crashing the handler.
          handler.onData(Buffer.from("stray"));
          handler.onComplete([]);
          return true;
        }
      }
      const reqBody = Readable.from(["x"]);
      await expect(new CompletesEarly().request({ path: "/", method: "POST", body: reqBody })).rejects.toThrow(
        "onHeaders must be called before onComplete",
      );
      expect(reqBody.destroyed).toBe(true);
    });

    it("fetch rejects when the dispatcher completes without a response", async () => {
      const dispatcher = {
        dispatch(_opts: any, handler: any) {
          handler.onConnect(() => {});
          handler.onComplete([]);
          return true;
        },
      };
      await expect(undiciFetch("http://localhost:1/", { dispatcher } as any)).rejects.toThrow(
        "fetch failed for http://localhost:1: the dispatcher completed without calling onHeaders",
      );
    });

    it("request() keeps the first body when onHeaders fires twice", async () => {
      class DoubleHeaders extends Dispatcher {
        dispatch(_opts: any, handler: any) {
          handler.onConnect(() => {});
          handler.onHeaders(200, [], () => {}, "OK");
          // A second final onHeaders violates the contract; the first body must keep receiving data.
          handler.onHeaders(500, [], () => {}, "ERR");
          handler.onData(Buffer.from("hi"));
          handler.onComplete([]);
          return true;
        }
      }
      const { statusCode, body } = await new DoubleHeaders().request({ path: "/", method: "GET" });
      expect(statusCode).toBe(200);
      expect(await body.text()).toBe("hi");
    });

    it("fetch keeps the first response when onHeaders fires twice", async () => {
      const dispatcher = {
        dispatch(_opts: any, handler: any) {
          handler.onConnect(() => {});
          handler.onHeaders(200, [], () => {}, "OK");
          handler.onHeaders(500, [], () => {}, "ERR");
          handler.onData(Buffer.from("hi"));
          handler.onComplete([]);
          return true;
        },
      };
      const res = await undiciFetch("http://localhost:1/", { dispatcher } as any);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("hi");
    });

    it("fetch with redirect 'error' ignores a late redirect onHeaders", async () => {
      const dispatcher = {
        dispatch(_opts: any, handler: any) {
          handler.onConnect(() => {});
          handler.onHeaders(200, [], () => {}, "OK");
          // A contract-violating second onHeaders must not error the delivered 200 body.
          handler.onHeaders(302, [], () => {}, "Found");
          handler.onData(Buffer.from("hi"));
          handler.onComplete([]);
          return true;
        },
      };
      const res = await undiciFetch("http://localhost:1/", { dispatcher, redirect: "error" } as any);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("hi");
    });

    it("fetch ignores dispatcher callbacks after onComplete", async () => {
      let lateError: unknown = null;
      const dispatcher = {
        dispatch(_opts: any, handler: any) {
          handler.onConnect(() => {});
          handler.onHeaders(200, [], () => {}, "OK");
          handler.onData(Buffer.from("hi"));
          handler.onComplete([]);
          // Late callbacks must be no-ops, not TypeErrors thrown back into the dispatcher.
          try {
            handler.onData(Buffer.from("late"));
            handler.onComplete([]);
          } catch (err) {
            lateError = err;
          }
          return true;
        },
      };
      const res = await undiciFetch("http://localhost:1/", { dispatcher } as any);
      expect(await res.text()).toBe("hi");
      expect(lateError).toBe(null);
    });

    it("request(cb) ignores a terminal callback after onError", async () => {
      const boom = new Error("boom");
      class TwoTerminals extends Dispatcher {
        dispatch(_opts: any, handler: any) {
          handler.onConnect(() => {});
          handler.onError(boom);
          // A second terminal callback must not invoke the user callback again.
          handler.onComplete([]);
          return true;
        }
      }
      const calls: any[] = [];
      await new Promise<void>(resolve => {
        new TwoTerminals().request({ path: "/", method: "GET" }, (err: any) => {
          calls.push(err);
          resolve();
        });
      });
      expect(calls).toEqual([boom]);
    });

    it("request() ignores onData after onComplete", async () => {
      class LateData extends Dispatcher {
        dispatch(_opts: any, handler: any) {
          handler.onConnect(() => {});
          handler.onHeaders(200, [], () => {}, "OK");
          handler.onData(Buffer.from("hi"));
          handler.onComplete([]);
          // A late chunk must not push after EOF and error the delivered body.
          handler.onData(Buffer.from("late"));
          return true;
        }
      }
      const { body } = await new LateData().request({ path: "/", method: "GET" });
      expect(await body.text()).toBe("hi");
    });

    it("request() ignores onConnect after a terminal callback", async () => {
      let adds = 0;
      let removes = 0;
      const signal = {
        aborted: false,
        on: () => {
          adds++;
        },
        removeListener: () => {
          removes++;
        },
      };
      class LateConnect extends Dispatcher {
        dispatch(_opts: any, handler: any) {
          handler.onConnect(() => {});
          handler.onError(new Error("boom"));
          // A late onConnect must not re-register the abort listener with no cleanup path left.
          handler.onConnect(() => {});
          return true;
        }
      }
      await expect(new LateConnect().request({ path: "/", method: "GET", signal: signal as any })).rejects.toThrow(
        "boom",
      );
      expect(adds).toBe(removes);
    });

    it("fetch ignores onConnect after the dispatch settled", async () => {
      let adds = 0;
      let removes = 0;
      const signal = {
        aborted: false,
        addEventListener: () => {
          adds++;
        },
        removeEventListener: () => {
          removes++;
        },
      };
      const dispatcher = {
        dispatch(_opts: any, handler: any) {
          handler.onConnect(() => {});
          handler.onError(new Error("boom"));
          handler.onConnect(() => {});
          return true;
        },
      };
      await expect(undiciFetch("http://localhost:1/", { dispatcher, signal } as any)).rejects.toThrow("boom");
      expect(adds).toBe(removes);
    });

    it("request() ignores onHeaders after onError", async () => {
      const boom = new Error("boom");
      class ErrorsFirst extends Dispatcher {
        dispatch(_opts: any, handler: any) {
          handler.onConnect(() => {});
          handler.onError(boom);
          handler.onHeaders(200, [], () => {}, "OK");
          return true;
        }
      }
      const calls: any[] = [];
      await new Promise<void>(resolve => {
        new ErrorsFirst().request({ path: "/", method: "GET" }, (err: any) => {
          calls.push(err);
          resolve();
        });
      });
      expect(calls).toEqual([boom]);
    });

    it("request() does not fire onInfo for a 1xx after a terminal callback", async () => {
      class InfoAfterError extends Dispatcher {
        dispatch(_opts: any, handler: any) {
          handler.onConnect(() => {});
          handler.onError(new Error("boom"));
          // A late 1xx violates the contract and must not reach opts.onInfo.
          handler.onHeaders(100, [], () => {}, "Continue");
          return true;
        }
      }
      const infos: number[] = [];
      await expect(
        new InfoAfterError().request({ path: "/", method: "GET", onInfo: (i: any) => infos.push(i.statusCode) }),
      ).rejects.toThrow("boom");
      expect(infos).toEqual([]);
    });

    it("fetch with dispatcher rejects invalid URLs instead of throwing", async () => {
      const dispatcher = { dispatch: () => true };
      await expect(undiciFetch("not a url", { dispatcher } as any)).rejects.toBeInstanceOf(TypeError);
    });

    it("fetch routes through the global dispatcher when none is passed", async () => {
      // Spawned so installing a global dispatcher cannot leak into other tests.
      await using target = Bun.serve({
        port: 0,
        fetch: () => new Response("via-global"),
      });
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const { Pool, setGlobalDispatcher, fetch } = require("undici");
           const pool = new Pool("http://localhost:${target.port}");
           setGlobalDispatcher({ dispatch: (opts, handler) => pool.dispatch(opts, handler) });
           const res = await fetch("http://localhost:1/x");
           console.log(await res.text());
           await pool.close();`,
        ],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toBe("via-global\n");
      expect(exitCode).toBe(0);
    });

    it("request() body formData() parses using the response content-type", async () => {
      const fd = new FormData();
      fd.append("foo", "bar");
      const encoded = new Response(fd);
      const contentType = encoded.headers.get("content-type")!;
      const bytes = await encoded.bytes();
      class FormDataDispatcher extends Dispatcher {
        dispatch(_opts: any, handler: any) {
          handler.onConnect(() => {});
          handler.onHeaders(200, [Buffer.from("content-type"), Buffer.from(contentType)], () => {}, "OK");
          handler.onData(Buffer.from(bytes));
          handler.onComplete([]);
          return true;
        }
      }
      const { body } = await new FormDataDispatcher().request({ path: "/", method: "GET" });
      const parsed = await body.formData();
      expect(parsed.get("foo")).toBe("bar");
    });

    it("request() body dump() discards the body", async () => {
      const pool = new Pool(hostUrl);
      const { body } = await pool.request({ path: "/get", method: "GET" });
      await body.dump();
      expect(body.bodyUsed).toBe(true);
      await expect(body.text()).rejects.toThrow("unusable");
      await pool.close();
    });

    it("constructors reject origins carrying a path, query, or hash", () => {
      expect(() => new Pool("http://localhost:3000/api")).toThrow(errors.InvalidArgumentError);
      expect(() => new Client("http://localhost:3000/?q=1")).toThrow(errors.InvalidArgumentError);
    });

    it("constructors reject non-http(s) origins", () => {
      expect(() => new Pool("ws://localhost:3000")).toThrow(errors.InvalidArgumentError);
      expect(() => new Client("file:///tmp")).toThrow(errors.InvalidArgumentError);
    });

    it("fetch with dispatcher copies body chunks from the dispatcher", async () => {
      const buf = Buffer.alloc(4);
      const dispatcher = {
        dispatch(_opts: any, handler: any) {
          handler.onConnect(() => {});
          handler.onHeaders(200, [], () => {}, "OK");
          buf.write("AAAA");
          handler.onData(buf);
          buf.write("BBBB");
          handler.onData(buf);
          handler.onComplete([]);
          return true;
        },
      };
      const res = await undiciFetch("http://localhost:1/", { dispatcher } as any);
      expect(await res.text()).toBe("AAAABBBB");
    });

    it("request() body blob() carries the response content-type", async () => {
      const pool = new Pool(hostUrl);
      const { body } = await pool.request({ path: "/get", method: "GET" });
      const blob = await body.blob();
      expect(blob.type).toContain("application/json");
      await pool.close();
    });

    it("a lowercase head method keeps content-length in the handler headers", async () => {
      const pool = new Pool(hostUrl);
      const res = await dispatchLegacy(pool, { path: "/head", method: "head" });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-length"]).toBeDefined();
      await pool.close();
    });

    it("repeated onConnect keeps signal listeners balanced", async () => {
      let adds = 0;
      let removes = 0;
      const signal = {
        aborted: false,
        on: () => {
          adds++;
        },
        removeListener: () => {
          removes++;
        },
      };
      class TwoHops extends Dispatcher {
        dispatch(_opts: any, handler: any) {
          handler.onConnect(() => {});
          handler.onConnect(() => {});
          handler.onHeaders(200, [], () => {}, "OK");
          handler.onData(Buffer.from("hi"));
          handler.onComplete([]);
          return true;
        }
      }
      const { body } = await new TwoHops().request({ path: "/", method: "GET", signal: signal as any });
      await body.text();
      expect(adds).toBe(2);
      expect(removes).toBe(2);
    });

    it("request() copies body chunks from the dispatcher", async () => {
      const buf = Buffer.alloc(4);
      class ReusesBuffer extends Dispatcher {
        dispatch(_opts: any, handler: any) {
          handler.onConnect(() => {});
          handler.onHeaders(200, [], () => {}, "OK");
          buf.write("AAAA");
          handler.onData(buf);
          buf.write("BBBB");
          handler.onData(buf);
          handler.onComplete([]);
          return true;
        }
      }
      const { body } = await new ReusesBuffer().request({ path: "/", method: "GET" });
      expect(await body.text()).toBe("AAAABBBB");
    });

    it("RetryAgent.close() closes the wrapped dispatcher", async () => {
      const agent = new Agent();
      const retry = new RetryAgent(agent);
      await retry.close();
      expect(agent.closed).toBe(true);
      expect(retry.closed).toBe(true);
    });

    it("close() called from onConnect still waits for the request", async () => {
      const pool = new Pool(hostUrl);
      const events: string[] = [];
      let closed: Promise<unknown> | undefined;
      const completed = new Promise<void>((resolve, reject) => {
        pool.dispatch(
          { path: "/get", method: "GET" },
          {
            onConnect: () => {
              closed = pool.close().then(() => events.push("closed"));
            },
            onHeaders: () => true,
            onData: () => true,
            onComplete: () => {
              events.push("complete");
              resolve();
            },
            onError: reject,
          },
        );
      });
      await Promise.all([completed, closed!]);
      expect(events).toEqual(["complete", "closed"]);
    });

    it("request() skips 1xx informational responses", async () => {
      class Informational extends Dispatcher {
        dispatch(_opts: any, handler: any) {
          handler.onConnect(() => {});
          handler.onHeaders(100, [], () => {}, "Continue");
          handler.onHeaders(200, [Buffer.from("content-type"), Buffer.from("text/plain")], () => {}, "OK");
          handler.onData(Buffer.from("hi"));
          handler.onComplete([]);
          return true;
        }
      }
      const infos: number[] = [];
      const { statusCode, body } = await new Informational().request({
        path: "/",
        method: "GET",
        onInfo: (info: { statusCode: number }) => infos.push(info.statusCode),
      });
      expect(statusCode).toBe(200);
      expect(await body.text()).toBe("hi");
      expect(infos).toEqual([100]);
    });

    it("fetch({ dispatcher, signal }) aborts through the handler", async () => {
      const dispatcher = {
        dispatch(_opts: any, handler: any) {
          // A compliant dispatch() never reads opts.signal; it only hands out abort.
          handler.onConnect((reason?: Error) => handler.onError(reason ?? new Error("aborted")));
          return true;
        },
      };
      const ac = new AbortController();
      const pending = undiciFetch("http://localhost:1/", { dispatcher, signal: ac.signal } as any);
      ac.abort();
      await expect(pending).rejects.toHaveProperty("name", "AbortError");
    });

    it("fetch with dispatcher and redirect 'error' rejects on redirects", async () => {
      await using target = Bun.serve({
        port: 0,
        fetch: () => new Response(null, { status: 302, headers: { location: "/next" } }),
      });
      const pool = new Pool(`http://localhost:${target.port}`);
      const dispatcher = { dispatch: (opts: any, handler: any) => pool.dispatch(opts, handler) };
      await expect(undiciFetch("http://localhost:1/", { dispatcher, redirect: "error" } as any)).rejects.toBeInstanceOf(
        TypeError,
      );
      await pool.destroy();
    });

    it("fetch with dispatcher rejects on a non-constructible status instead of hanging", async () => {
      const dispatcher = {
        dispatch(_opts: any, handler: any) {
          // Route the onHeaders throw through onError, like the builtin dispatchers do.
          queueMicrotask(() => {
            try {
              handler.onHeaders(600, [], () => {}, "Weird");
            } catch (e) {
              handler.onError(e);
            }
          });
          handler.onConnect(() => {});
          return true;
        },
      };
      await expect(undiciFetch("http://localhost:1/", { dispatcher } as any)).rejects.toBeInstanceOf(RangeError);
    });

    it("fetch does not park the dispatcher on onData after onHeaders threw", async () => {
      const dataReturns: any[] = [];
      const dispatcher = {
        dispatch(_opts: any, handler: any) {
          handler.onConnect(() => {});
          try {
            handler.onHeaders(600, [], () => {}, "Weird");
          } catch (e) {
            handler.onError(e);
          }
          // Late chunks must be dropped, not enqueued into the orphaned stream until backpressure pauses us.
          dataReturns.push(handler.onData(Buffer.from("x")));
          dataReturns.push(handler.onData(Buffer.from("y")));
          return true;
        },
      };
      await expect(undiciFetch("http://localhost:1/", { dispatcher } as any)).rejects.toBeInstanceOf(RangeError);
      expect(dataReturns).toEqual([true, true]);
    });

    it("dispatch sends headers given as Headers or Map instances", async () => {
      const received: (string | null)[] = [];
      await using server = Bun.serve({
        port: 0,
        fetch(req) {
          received.push(req.headers.get("authorization"));
          return new Response("ok");
        },
      });
      const pool = new Pool(`http://localhost:${server.port}`);
      await dispatchLegacy(pool, { path: "/", method: "GET", headers: new Headers({ authorization: "Bearer a" }) });
      await dispatchLegacy(pool, { path: "/", method: "GET", headers: new Map([["authorization", "Bearer b"]]) });
      expect(received).toEqual(["Bearer a", "Bearer b"]);
      await pool.close();
    });

    it("dispatch sends array-valued request headers as separate lines", async () => {
      const seen = Promise.withResolvers<string | null>();
      await using server = Bun.serve({
        port: 0,
        fetch(req) {
          seen.resolve(req.headers.get("cookie"));
          return new Response("ok");
        },
      });
      const pool = new Pool(`http://localhost:${server.port}`);
      await dispatchLegacy(pool, { path: "/", method: "GET", headers: { cookie: ["a=1", "b=2"] } });
      // Separate Cookie lines combine with '; ' like undici; a record init would send 'a=1,b=2'.
      expect(await seen.promise).toBe("a=1; b=2");
      await pool.close();
    });

    it("request(cb) ignores callbacks scheduled by a throwing dispatch()", async () => {
      class ThrowsThenCallsBack extends Dispatcher {
        dispatch(_opts: any, handler: any) {
          queueMicrotask(() => {
            handler.onConnect(() => {});
            handler.onHeaders(200, [], () => {}, "OK");
            handler.onComplete([]);
          });
          throw new Error("sync boom");
        }
      }
      const calls: any[] = [];
      new ThrowsThenCallsBack().request({ path: "/", method: "GET" }, (err: any) => {
        calls.push(err?.message);
      });
      // Let the scheduled callbacks run before asserting the callback fired exactly once.
      await new Promise<void>(resolve => queueMicrotask(() => queueMicrotask(resolve)));
      expect(calls).toEqual(["sync boom"]);
    });

    it("fetch with dispatcher errors the body when dispatch throws after headers", async () => {
      const boom = new Error("post-headers boom");
      const dispatcher = {
        dispatch(_opts: any, handler: any) {
          handler.onConnect(() => {});
          handler.onHeaders(200, [], () => {}, "OK");
          throw boom;
        },
      };
      const res = await undiciFetch("http://localhost:1/", { dispatcher } as any);
      expect(res.status).toBe(200);
      await expect(res.text()).rejects.toBe(boom);
    });

    it("close(callback) invokes the callback", async () => {
      const pool = new Pool(hostUrl);
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      pool.close((err: Error | null) => (err ? reject(err) : resolve()));
      await promise;
      expect(pool.closed).toBe(true);
    });

    it("abort() while the body is paused delivers onError instead of hanging", async () => {
      let pulls = 0;
      await using server = Bun.serve({
        port: 0,
        fetch() {
          const stream = new ReadableStream({
            pull(controller) {
              pulls++;
              controller.enqueue(new Uint8Array(1024));
            },
          });
          return new Response(stream, { headers: { "content-type": "application/octet-stream" } });
        },
      });
      const pool = new Pool(`http://localhost:${server.port}`);
      let abortFn: ((reason?: Error) => void) | undefined;
      const err = await new Promise<any>((resolve, reject) => {
        pool.dispatch(
          { path: "/", method: "GET" },
          {
            onConnect: (abort: (reason?: Error) => void) => {
              abortFn = abort;
            },
            onHeaders: () => true,
            // Pause after the first chunk so the body loop parks.
            onData: () => false,
            onComplete: () => reject(new Error("should not complete")),
            onError: resolve,
          },
        );
        (async () => {
          // Wait until more chunks are in flight, so the paused loop is parked
          // holding an undelivered chunk, then abort.
          const deadline = Date.now() + 5_000;
          while (pulls < 3 && Date.now() < deadline) await Bun.sleep(5);
          if (pulls < 3) {
            reject(new Error(`body never parked while paused; pulls=${pulls}`));
            return;
          }
          abortFn!();
        })();
      });
      expect(err.code).toBe("UND_ERR_ABORTED");
      await pool.destroy();
    });

    it("aborting from onConnect rejects with UND_ERR_ABORTED", async () => {
      const pool = new Pool(hostUrl);
      const err = await new Promise<any>((resolve, reject) => {
        pool.dispatch(
          { path: "/get", method: "GET" },
          {
            onConnect: (abort: (reason?: Error) => void) => abort(),
            onHeaders: () => reject(new Error("should not receive headers")),
            onData: () => {},
            onComplete: () => reject(new Error("should not complete")),
            onError: resolve,
          },
        );
      });
      expect(err.code).toBe("UND_ERR_ABORTED");
      await pool.close();
    });

    it("Agent dispatches using opts.origin", async () => {
      const agent = new Agent();
      const res = await dispatchLegacy(agent, { origin: hostUrl, path: "/get", method: "GET" });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ url: `${hostUrl}/get`, method: "GET" });
      await agent.close();
    });

    it("getGlobalDispatcher returns a functional dispatcher", async () => {
      const dispatcher = getGlobalDispatcher();
      expect(typeof dispatcher.dispatch).toBe("function");
      expect(typeof dispatcher.close).toBe("function");
      expect(typeof dispatcher.destroy).toBe("function");
      const res = await dispatchLegacy(dispatcher, { origin: hostUrl, path: "/get", method: "GET" });
      expect(res.statusCode).toBe(200);
    });

    it("new Pool() without an origin throws InvalidArgumentError", () => {
      expect(() => new (Pool as any)()).toThrow(errors.InvalidArgumentError);
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
