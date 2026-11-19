import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import diagnosticsChannel from "node:diagnostics_channel";
import { once } from "node:events";
import net from "node:net";
import { join } from "node:path";
import { Readable } from "node:stream";
import zlib from "node:zlib";
// @ts-ignore undici 5's types don't declare ping()
import {
  Agent,
  Client,
  Dispatcher,
  errors,
  getGlobalDispatcher,
  ping,
  Pool,
  ProxyAgent,
  request,
  RetryAgent,
  fetch as undiciFetch,
  WebSocket as UndiciWebSocket,
} from "undici";

import { bunEnv, bunExe, isWindows, tempDir } from "harness";

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
      expect(err.code).toBe("ECONNREFUSED");
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

    it("request(cb) defers the error callback, like undici", async () => {
      const pool = new Pool(hostUrl);
      await pool.close();
      const { promise, resolve } = Promise.withResolvers<any>();
      let calls = 0;
      pool.request({ path: "/", method: "GET" }, (err: any) => {
        calls++;
        resolve(err);
      });
      // Not called inside request(): a callback that throws must not land in the dispatcher.
      expect(calls).toBe(0);
      expect((await promise).code).toBe("UND_ERR_DESTROYED");
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

    it("a controller handler's onResponseData return value does not pause the body", async () => {
      const firstChunkSeen = Promise.withResolvers<void>();
      await using server = Bun.serve({
        port: 0,
        fetch: () =>
          new Response(
            new ReadableStream({
              async start(controller) {
                controller.enqueue(new TextEncoder().encode("a"));
                // The second chunk exists only after the handler saw the first, so the body has two chunks.
                await firstChunkSeen.promise;
                controller.enqueue(new TextEncoder().encode("b"));
                controller.close();
              },
            }),
          ),
      });
      const pool = new Pool(`http://localhost:${server.port}`);
      const body = await new Promise<string>((resolve, reject) => {
        let text = "";
        pool.dispatch({ path: "/", method: "GET" }, {
          onRequestStart() {},
          onResponseStart() {},
          // undici ignores this return value; only controller.pause() pauses.
          onResponseData(_controller: any, chunk: Buffer) {
            text += chunk.toString();
            firstChunkSeen.resolve();
            return false;
          },
          onResponseEnd: () => resolve(text),
          onResponseError: (_controller: any, err: Error) => reject(err),
        } as any);
      });
      expect(body).toBe("ab");
      await pool.close();
    });

    it("a controller handler may omit onResponseError, like undici", async () => {
      const pool = new Pool(hostUrl);
      const status = await new Promise<number>(resolve => {
        let status = 0;
        pool.dispatch({ path: "/get", method: "GET" }, {
          onRequestStart() {},
          onResponseStart(_controller: any, statusCode: number) {
            status = statusCode;
          },
          onResponseData() {},
          onResponseEnd: () => resolve(status),
        } as any);
      });
      expect(status).toBe(200);
      await pool.close();
    });

    it("keeps content-length unless fetch decoded the body", async () => {
      await using server = Bun.serve({
        port: 0,
        fetch(req) {
          if (new URL(req.url).pathname === "/gzip") {
            return new Response(Bun.gzipSync("hello"), { headers: { "content-encoding": "gzip" } });
          }
          return new Response("hello");
        },
      });
      const pool = new Pool(`http://localhost:${server.port}`);
      const plain = await pool.request({ path: "/plain", method: "GET" });
      const gzip = await pool.request({ path: "/gzip", method: "GET" });
      expect({
        plainLength: plain.headers["content-length"],
        plainText: await plain.body.text(),
        gzipLength: gzip.headers["content-length"],
        gzipEncoding: gzip.headers["content-encoding"],
        gzipText: await gzip.body.text(),
      }).toEqual({
        plainLength: "5",
        plainText: "hello",
        gzipLength: undefined,
        gzipEncoding: undefined,
        gzipText: "hello",
      });
      await pool.close();
    });

    it("keeps content-encoding and content-length when fetch did not decode the body", async () => {
      const text = Buffer.alloc(600, "hello ").toString();
      // Native fetch decodes one coding. It hands over a stacked or unknown coding as it came.
      const bodies: Record<string, Buffer> = {
        "gzip, br": zlib.brotliCompressSync(zlib.gzipSync(text)),
        "foobar": Buffer.from(text),
        "identity": Buffer.from(text),
      };
      await using server = Bun.serve({
        port: 0,
        fetch(req) {
          const encoding = decodeURIComponent(new URL(req.url).pathname.slice(1));
          return new Response(bodies[encoding], { headers: { "content-encoding": encoding } });
        },
      });
      const pool = new Pool(`http://localhost:${server.port}`);
      const results: Record<string, unknown> = {};
      for (const encoding of Object.keys(bodies)) {
        const path = `/${encodeURIComponent(encoding)}`;
        const { headers, body } = await pool.request({ path, method: "GET" });
        const res = await undiciFetch(`http://localhost:${server.port}${path}`, { dispatcher: pool } as any);
        results[encoding] = {
          encoding: headers["content-encoding"],
          length: headers["content-length"],
          asSent: Buffer.from(await body.arrayBuffer()).equals(bodies[encoding]),
          fetchEncoding: res.headers.get("content-encoding"),
          fetchText: (await res.text()) === text,
        };
      }
      expect(results).toEqual(
        Object.fromEntries(
          Object.keys(bodies).map(encoding => [
            encoding,
            {
              encoding,
              length: String(bodies[encoding].length),
              asSent: true,
              fetchEncoding: encoding,
              fetchText: true,
            },
          ]),
        ),
      );
      await pool.close();
    });

    it("a throwing error callback is an uncaught exception, not a swallowed one", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const { Pool } = require("undici");
           process.on("uncaughtException", err => console.log("uncaught: " + err.message));
           const refused = new Pool("http://127.0.0.1:1");
           refused.dispatch({ path: "/", method: "GET" }, {
             onConnect() {}, onHeaders() {}, onData() {}, onComplete() {},
             onError() { throw new Error("from onError"); },
           });
           const closed = new Pool("http://127.0.0.1:1");
           closed.close().then(() => closed.request({ path: "/", method: "GET" }, () => { throw new Error("from callback"); }));`,
        ],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout: stdout.trim().split("\n").sort(), stderr }).toEqual({
        stdout: ["uncaught: from callback", "uncaught: from onError"],
        stderr: "",
      });
      expect(exitCode).toBe(0);
    });

    it("fetch with a dispatcher sends every redirect hop through the dispatcher", async () => {
      const seen: string[] = [];
      await using target = Bun.serve({
        port: 0,
        fetch(req) {
          const url = new URL(req.url);
          seen.push(`${req.method} ${url.pathname} via=${req.headers.get("x-via")}`);
          if (url.pathname === "/start") return new Response(null, { status: 302, headers: { location: "/end" } });
          return new Response("done");
        },
      });
      const pool = new Pool(`http://localhost:${target.port}`);
      const hops: string[] = [];
      const dispatcher = {
        dispatch(opts: any, handler: any) {
          hops.push(`${opts.origin}${opts.path} maxRedirections=${opts.maxRedirections}`);
          return pool.dispatch({ ...opts, headers: { ...opts.headers, "x-via": "dispatcher" } }, handler);
        },
      };
      // Nothing listens on the URL's port; only the dispatcher can answer either hop.
      const res = await undiciFetch("http://localhost:1/start", { dispatcher } as any);
      expect(await res.text()).toBe("done");
      expect(hops).toEqual(["http://localhost:1/start maxRedirections=0", "http://localhost:1/end maxRedirections=0"]);
      expect(seen).toEqual(["GET /start via=dispatcher", "GET /end via=dispatcher"]);
      await pool.close();
    });

    it("fetch with a dispatcher applies the redirect rules to method, body and credentials", async () => {
      const seen: any[] = [];
      const dispatcher = {
        dispatch(opts: any, handler: any) {
          (async () => {
            seen.push({
              url: opts.origin + opts.path,
              method: opts.method,
              body: opts.body == null ? null : await new Response(opts.body).text(),
              authorization: opts.headers.authorization ?? null,
              type: opts.headers["content-type"] ?? null,
            });
            handler.onConnect(() => {});
            if (opts.path === "/a") {
              handler.onHeaders(307, [Buffer.from("location"), Buffer.from("/b")], () => {}, "");
            } else if (opts.path === "/b") {
              handler.onHeaders(303, [Buffer.from("Location"), Buffer.from("http://other.test/c")], () => {}, "");
            } else {
              handler.onHeaders(200, [], () => {}, "OK");
              handler.onData(Buffer.from("ok"));
              handler.onComplete([]);
            }
          })();
          return true;
        },
      };
      const res = await undiciFetch("http://first.test/a", {
        dispatcher,
        method: "POST",
        body: "payload",
        headers: { authorization: "Bearer t", "content-type": "text/plain" },
      } as any);
      expect(await res.text()).toBe("ok");
      expect(seen).toEqual([
        { url: "http://first.test/a", method: "POST", body: "payload", authorization: "Bearer t", type: "text/plain" },
        // 307 keeps the method and the body.
        { url: "http://first.test/b", method: "POST", body: "payload", authorization: "Bearer t", type: "text/plain" },
        // 303 becomes a GET without a body, and the cross-origin hop loses the credentials.
        { url: "http://other.test/c", method: "GET", body: null, authorization: null, type: null },
      ]);
    });

    it("fetch(Request) with a dispatcher sends a buffered body again on a 307", async () => {
      const seen: string[] = [];
      const dispatcher = {
        dispatch(opts: any, handler: any) {
          (async () => {
            seen.push(`${opts.method} ${opts.path} ${await new Response(opts.body).text()}`);
            handler.onConnect(() => {});
            if (opts.path === "/a") {
              handler.onHeaders(307, [Buffer.from("location"), Buffer.from("/b")], () => {}, "");
            } else {
              handler.onHeaders(200, [], () => {}, "OK");
              handler.onComplete([]);
            }
          })();
          return true;
        },
      };
      const request = new Request("http://localhost:1/a", { method: "PUT", body: "payload" });
      const res = await undiciFetch(request, { dispatcher } as any);
      expect({ status: res.status, seen }).toEqual({ status: 200, seen: ["PUT /a payload", "PUT /b payload"] });
    });

    it("fetch(Request) with a dispatcher does not send a stream body twice", async () => {
      const seen: string[] = [];
      const dispatcher = {
        dispatch(opts: any, handler: any) {
          (async () => {
            seen.push(`${opts.method} ${opts.path} ${await new Response(opts.body).text()}`);
            handler.onConnect(() => {});
            handler.onHeaders(307, [Buffer.from("location"), Buffer.from("/b")], () => {}, "");
          })();
          return true;
        },
      };
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("payload"));
          controller.close();
        },
      });
      const request = new Request("http://localhost:1/a", { method: "PUT", body, duplex: "half" } as any);
      await expect(undiciFetch(request, { dispatcher } as any)).rejects.toThrow("a stream body cannot be sent twice");
      expect(seen).toEqual(["PUT /a payload"]);
    });

    it("a request() body that failed rejects with the failure, not with 'unusable'", async () => {
      const boom = new Error("boom");
      class FailsAfterHeaders extends Dispatcher {
        dispatch(_opts: any, handler: any) {
          handler.onConnect(() => {});
          handler.onHeaders(200, [], () => {}, "OK");
          handler.onError(boom);
          return true;
        }
      }
      const { body } = await new FailsAfterHeaders().request({ path: "/", method: "GET" });
      // Once while the 'error' event is still pending, once after the stream closed.
      await expect(body.text()).rejects.toBe(boom);
      await expect(body.text()).rejects.toBe(boom);
    });

    it("fetch with a dispatcher and redirect 'manual' returns the redirect response", async () => {
      let dispatched = 0;
      const dispatcher = {
        dispatch(_opts: any, handler: any) {
          dispatched++;
          handler.onConnect(() => {});
          handler.onHeaders(302, [Buffer.from("location"), Buffer.from("/next")], () => {}, "Found");
          handler.onComplete([]);
          return true;
        },
      };
      const res = await undiciFetch("http://localhost:1/", { dispatcher, redirect: "manual" } as any);
      expect({ status: res.status, location: res.headers.get("location"), dispatched }).toEqual({
        status: 302,
        location: "/next",
        dispatched: 1,
      });
    });

    it("fetch with a dispatcher stops after 20 redirects", async () => {
      let dispatched = 0;
      const dispatcher = {
        dispatch(_opts: any, handler: any) {
          dispatched++;
          handler.onConnect(() => {});
          handler.onHeaders(302, [Buffer.from("location"), Buffer.from("/again")], () => {}, "Found");
          return true;
        },
      };
      await expect(undiciFetch("http://localhost:1/", { dispatcher } as any)).rejects.toThrow(
        "redirect count exceeded",
      );
      expect(dispatched).toBe(21);
    });

    it("fetch with a dispatcher derives the content-type of the body, like native fetch", async () => {
      const seen: any[] = [];
      const dispatcher = {
        dispatch(opts: any, handler: any) {
          (async () => {
            seen.push({ type: opts.headers["content-type"] ?? null, body: await new Response(opts.body).text() });
            handler.onConnect(() => {});
            handler.onHeaders(200, [], () => {}, "OK");
            handler.onComplete([]);
          })();
          return true;
        },
      };
      const post = (body: any, headers?: any) =>
        undiciFetch("http://localhost:1/", { dispatcher, method: "POST", body, headers } as any);
      const form = new FormData();
      form.append("field", "value");
      await post(new URLSearchParams({ a: "1", b: "x y" }));
      await post(new Blob(["blob"], { type: "text/x-test" }));
      await post(new URLSearchParams({ a: "1" }), { "content-type": "text/plain" });
      await post(new Uint8Array([104, 105]));
      await post(form);
      const multipart = seen.pop();
      expect(seen).toEqual([
        { type: "application/x-www-form-urlencoded;charset=UTF-8", body: "a=1&b=x+y" },
        { type: "text/x-test", body: "blob" },
        // The caller's own content-type wins.
        { type: "text/plain", body: "a=1" },
        { type: null, body: "hi" },
      ]);
      // The boundary in the header is the one in the body.
      const parsed = await new Response(multipart.body, { headers: { "content-type": multipart.type } }).formData();
      expect({ type: multipart.type.split(";")[0], field: parsed.get("field") }).toEqual({
        type: "multipart/form-data",
        field: "value",
      });
    });

    it("fetch with a dispatcher ignores URL credentials that do not decode, like native fetch", async () => {
      const seen: any[] = [];
      const dispatcher = {
        dispatch(opts: any, handler: any) {
          seen.push(opts.headers.authorization ?? null);
          handler.onConnect(() => {});
          handler.onHeaders(200, [], () => {}, "OK");
          handler.onComplete([]);
          return true;
        },
      };
      const res = await undiciFetch("http://user:100%@localhost:1/", { dispatcher } as any);
      expect({ status: res.status, seen }).toEqual({ status: 200, seen: [null] });
    });

    it("fetch(Request, { signal: null }) detaches the Request's signal, like native fetch", async () => {
      await using server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
      const pool = new Pool(`http://localhost:${server.port}`);
      const custom = { dispatch: (opts: any, handler: any) => pool.dispatch(opts, handler) };
      const aborted = AbortSignal.abort();
      const texts: string[] = [];
      for (const dispatcher of [custom, new Agent()]) {
        const request = new Request(`http://localhost:${server.port}/`, { signal: aborted });
        texts.push(await (await undiciFetch(request, { dispatcher, signal: null } as any)).text());
      }
      expect(texts).toEqual(["ok", "ok"]);
      await pool.close();
    });

    it("fetch with a dispatcher sends URL credentials as Basic auth", async () => {
      let authorization: string | undefined;
      const dispatcher = {
        dispatch(opts: any, handler: any) {
          authorization = opts.headers.authorization;
          handler.onConnect(() => {});
          handler.onHeaders(200, [], () => {}, "OK");
          handler.onComplete([]);
          return true;
        },
      };
      await undiciFetch("http://user:p%40ss@localhost:1/", { dispatcher } as any);
      expect(authorization).toBe(`Basic ${Buffer.from("user:p@ss").toString("base64")}`);
    });

    it("fetch with a dispatcher leaves non-http(s) URLs to native fetch", async () => {
      let dispatched = 0;
      const dispatcher = {
        dispatch() {
          dispatched++;
          return true;
        },
      };
      const res = await undiciFetch("data:text/plain;base64,aGk=", { dispatcher } as any);
      expect(await res.text()).toBe("hi");
      expect(dispatched).toBe(0);
    });

    it("fetch through a stock Agent is native fetch", async () => {
      await using server = Bun.serve({
        port: 0,
        fetch(req) {
          if (new URL(req.url).pathname === "/start") {
            return new Response(null, { status: 302, headers: { location: "/end" } });
          }
          return new Response("hello");
        },
      });
      const origin = `http://localhost:${server.port}`;
      const agent = new Agent();
      const res = await undiciFetch(`${origin}/start`, { dispatcher: agent } as any);
      // A Response assembled from dispatch() callbacks has none of these.
      expect({
        url: res.url,
        redirected: res.redirected,
        length: res.headers.get("content-length"),
        text: await res.text(),
      }).toEqual({ url: `${origin}/end`, redirected: true, length: "5", text: "hello" });
      await agent.close();
      await expect(undiciFetch(`${origin}/end`, { dispatcher: agent } as any)).rejects.toBeInstanceOf(
        errors.ClientDestroyedError,
      );
    });

    it("fetch through a stock Agent hands the caller's init to native fetch as it is", async () => {
      await using server = Bun.serve({
        port: 0,
        fetch: async req => new Response(`${req.method} ${await req.text()} ${req.headers.get("x-test")}`),
      });
      class Init {
        get method() {
          return "POST";
        }
        get body() {
          return "payload";
        }
        get headers() {
          return { "x-test": "1" };
        }
      }
      const inherited = Object.create({ method: "POST", body: "payload", headers: { "x-test": "1" } });
      const agent = new Agent();
      // Native fetch reads each option with a property get. A copy of the own properties would send a bare GET.
      expect({
        getters: await (await undiciFetch(server.url, { __proto__: new Init(), dispatcher: agent } as any)).text(),
        inherited: await (await undiciFetch(server.url, { __proto__: inherited, dispatcher: agent } as any)).text(),
      }).toEqual({ getters: "POST payload 1", inherited: "POST payload 1" });
    });

    it("fetch through a Pool takes Bun's object-form input, and init ranks above it", async () => {
      await using server = Bun.serve({
        port: 0,
        fetch: async req => new Response(`${req.method} ${await req.text()} ${req.headers.get("x-test")}`),
      });
      const dispatcher = new Pool(`http://localhost:${server.port}`);
      const input = () => ({ url: `${server.url}echo`, method: "POST", body: "payload", headers: { "x-test": "1" } });
      expect({
        input: await (await undiciFetch(input() as any, { dispatcher } as any)).text(),
        init: await (await undiciFetch(input() as any, { method: "PUT", body: "other", dispatcher } as any)).text(),
      }).toEqual({ input: "POST payload 1", init: "PUT other 1" });
      await dispatcher.close();
    });

    it("fetch through a Pool takes an object whose string is a URL, in the order of native fetch", async () => {
      await using server = Bun.serve({
        port: 0,
        fetch: req => new Response(`${req.method} ${new URL(req.url).pathname}`),
      });
      const dispatcher = new Pool(`http://localhost:${server.port}`);
      // Such an object is the URL. Native fetch reads no options from it.
      const urlLike = { method: "POST", toString: () => `${server.url}url-like` };
      expect({
        native: await (await fetch(urlLike as any)).text(),
        pool: await (await undiciFetch(urlLike as any, { dispatcher } as any)).text(),
      }).toEqual({ native: "GET /url-like", pool: "GET /url-like" });
      await dispatcher.close();
    });

    it("fetch through a dispatcher sends the content-length of a body that has one", async () => {
      using dir = tempDir("undici-content-length", { "upload.bin": Buffer.alloc(70000, "x").toString() });
      await using server = Bun.serve({
        port: 0,
        fetch: async req =>
          Response.json({
            length: req.headers.get("content-length"),
            encoding: req.headers.get("transfer-encoding"),
            received: (await req.arrayBuffer()).byteLength,
          }),
      });
      const pool = new Pool(`http://localhost:${server.port}`);
      // What a dispatcher over another transport gets: a stream, so the header is its only source for the length.
      let dispatched: unknown;
      const dispatcher = {
        dispatch(opts, handler) {
          dispatched = opts.headers["content-length"];
          return pool.dispatch(opts, handler);
        },
      };
      const form = new FormData();
      form.set("field", "value");
      const bodies: Record<string, () => any> = {
        string: () => "h\u00e9llo",
        bytes: () => new Uint8Array(7),
        blob: () => new Blob(["abc"]),
        file: () => Bun.file(join(String(dir), "upload.bin")),
        search: () => new URLSearchParams("a=b"),
        form: () => form,
        stream: () => new Blob(["streamed"]).stream(),
      };
      const results: Record<string, unknown> = {};
      for (const [name, body] of Object.entries(bodies)) {
        const init = { method: "PUT", body: body(), dispatcher, duplex: "half" };
        const seen: any = await (await undiciFetch(server.url, init as any)).json();
        results[name] = {
          dispatched,
          sent: seen.length,
          encoding: seen.encoding,
          whole: seen.received === +seen.length,
        };
      }
      const known = (length: string) => ({ dispatched: length, sent: length, encoding: null, whole: true });
      const formLength = String((await new Response(form).arrayBuffer()).byteLength);
      expect(results).toEqual({
        string: known("6"),
        bytes: known("7"),
        blob: known("3"),
        file: known("70000"),
        search: known("3"),
        form: known(formLength),
        // Native fetch still holds this stream in memory, so it sends the length that the dispatcher did not get.
        stream: { dispatched: undefined, sent: "8", encoding: null, whole: true },
      });

      const request = new Request(server.url, { method: "POST", body: "from a request" });
      await (await undiciFetch(request, { dispatcher } as any)).json();
      const fromRequest = dispatched;
      await (await undiciFetch(server.url, { method: "POST", dispatcher } as any)).json();
      const bodilessPost = dispatched;
      await (await undiciFetch(server.url, { dispatcher } as any)).json();
      expect({ fromRequest, bodilessPost, bodilessGet: dispatched }).toEqual({
        fromRequest: "14",
        bodilessPost: "0",
        bodilessGet: undefined,
      });
      await pool.close();
    });

    it("fetch through a dispatcher sends the content-type that native fetch sends for the body", async () => {
      await using server = Bun.serve({
        port: 0,
        async fetch(req) {
          // The client sends the body again to the new path.
          if (new URL(req.url).pathname === "/redirect") {
            return new Response(null, { status: 307, headers: { location: "/" } });
          }
          await req.arrayBuffer();
          // A form gets a new boundary for each request.
          return new Response(String(req.headers.get("content-type")).replace(/boundary=.*/, "boundary"));
        },
      });
      const dispatcher = new Pool(`http://localhost:${server.port}`);
      const form = new FormData();
      form.set("field", "value");
      const bodies: Record<string, () => any> = {
        string: () => "text",
        bytes: () => new Uint8Array(7),
        buffer: () => new ArrayBuffer(7),
        view: () => new DataView(new ArrayBuffer(7)),
        blob: () => new Blob(["abc"]),
        typed: () => new Blob(["abc"], { type: "x/y" }),
        search: () => new URLSearchParams("a=b"),
        form: () => form,
      };
      const redirect = `${server.url}redirect`;
      const text = async (response: Promise<Response>) => (await response).text();
      const native: Record<string, string[]> = {};
      const dispatched: Record<string, string[]> = {};
      for (const [name, body] of Object.entries(bodies)) {
        const init = () => ({ method: "PUT", body: body() });
        native[name] = [
          await text(fetch(server.url, init())),
          await text(fetch(redirect, init())),
          await text(fetch(new Request(redirect, init()))),
        ];
        dispatched[name] = [
          await text(undiciFetch(server.url, { ...init(), dispatcher } as any)),
          await text(undiciFetch(redirect, { ...init(), dispatcher } as any)),
          await text(undiciFetch(new Request(redirect, init()), { dispatcher } as any)),
        ];
      }
      expect(dispatched).toEqual(native);
      // The dispatcher gets a stream of the body, and that stream must not give bytes a type.
      expect(dispatched.bytes).toEqual(["null", "null", "null"]);
      await dispatcher.close();
    });

    it("fetch through a stock Agent adds no abort signal of its own", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const { Agent, fetch, setGlobalDispatcher } = require("undici");
           const { heapStats } = require("bun:jsc");
           const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
           setGlobalDispatcher(new Agent());
           const signal = new AbortController().signal;
           const signals = () => heapStats().objectTypeCounts.AbortSignal ?? 0;
           const before = signals();
           for (let i = 0; i < 300; i++) await (await fetch(server.url, { signal })).text();
           // No collection in between: a signal made for each fetch would still be counted here.
           console.log(signals() - before < 30 ? "none" : signals() - before + " more signals");
           server.stop(true);`,
        ],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout: stdout.trim(), stderr }).toEqual({ stdout: "none", stderr: "" });
      expect(exitCode).toBe(0);
    });

    it("a request() body drops a UTF-8 byte order mark in text() and json(), like undici", async () => {
      await using server = Bun.serve({
        port: 0,
        fetch: () => new Response(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"a":1}')])),
      });
      const pool = new Pool(`http://localhost:${server.port}`);
      const text = await (await pool.request({ path: "/", method: "GET" })).body.text();
      const json = await (await pool.request({ path: "/", method: "GET" })).body.json();
      const bytes = await (await pool.request({ path: "/", method: "GET" })).body.bytes();
      // The bytes keep the mark; only the text forms drop it.
      expect({ text, json, bytes: bytes.length }).toEqual({ text: '{"a":1}', json: { a: 1 }, bytes: 10 });
      await pool.close();
    });

    it("fetch through an Agent subclass that overrides dispatch() calls the override", async () => {
      let calls = 0;
      class Counting extends Agent {
        dispatch(opts: any, handler: any) {
          calls++;
          return super.dispatch(opts, handler);
        }
      }
      const res = await undiciFetch(`${hostUrl}/get`, { dispatcher: new Counting() } as any);
      expect(await res.json()).toEqual({ url: `${hostUrl}/get`, method: "GET" });
      expect(calls).toBe(1);
    });

    it("close() resolves after an unread fetch() Response is collected", async () => {
      await using server = Bun.serve({
        port: 0,
        // The body never ends, so the dispatch can only finish by being cancelled.
        fetch: () =>
          new Response(
            new ReadableStream({
              pull(controller) {
                controller.enqueue(new Uint8Array(65536));
              },
            }),
          ),
      });
      const pool = new Pool(`http://localhost:${server.port}`);
      // In a function of its own, so that no local of the test holds the Response.
      const status = await (async () => (await undiciFetch(server.url, { dispatcher: pool } as any)).status)();
      expect(status).toBe(200);
      let closed = false;
      const closing = pool.close().then(() => {
        closed = true;
      });
      while (!closed) {
        Bun.gc(true);
        await new Promise(resolve => setImmediate(resolve));
      }
      await closing;
    });

    it.each(["identity", "gzip"])("a collected %s fetch() body cancels its dispatch", async encoding => {
      const cancelled = Promise.withResolvers<void>();
      let cancelledYet = false;
      const dispatcher = {
        dispatch(_opts: any, handler: any) {
          handler.onConnect(() => {
            cancelledYet = true;
            cancelled.resolve();
          });
          handler.onHeaders(200, [Buffer.from("content-encoding"), Buffer.from(encoding)], () => {}, "OK");
          // One chunk, and the response never completes.
          handler.onData(encoding === "gzip" ? zlib.gzipSync("partial").subarray(0, 10) : Buffer.from("partial"));
          return true;
        },
      };
      const status = await (async () => (await undiciFetch("http://localhost:1/", { dispatcher } as any)).status)();
      expect(status).toBe(200);
      while (!cancelledYet) {
        Bun.gc(true);
        await new Promise(resolve => setImmediate(resolve));
      }
      await cancelled.promise;
    });

    it("a fetch() body stays readable while the caller holds only the stream", async () => {
      const chunk = Buffer.alloc(65536, "a");
      await using server = Bun.serve({
        port: 0,
        fetch() {
          let sent = 0;
          return new Response(
            new ReadableStream({
              pull(controller) {
                if (sent++ < 8) controller.enqueue(chunk);
                else controller.close();
              },
            }),
          );
        },
      });
      const pool = new Pool(`http://localhost:${server.port}`);
      const body = (await undiciFetch(server.url, { dispatcher: pool } as any)).body!;
      // The Response is garbage now. The dispatch must not be cancelled with it.
      for (let i = 0; i < 10; i++) {
        Bun.gc(true);
        await new Promise(resolve => setImmediate(resolve));
      }
      expect((await new Response(body).bytes()).length).toBe(8 * chunk.length);
      await pool.close();
    });

    it("fetch with a dispatcher decodes a body that the dispatcher delivers encoded, like undici", async () => {
      const text = Buffer.alloc(4096, "hello ").toString();
      const bodies: Record<string, Buffer> = {
        "gzip": zlib.gzipSync(text),
        "x-gzip": zlib.gzipSync(text),
        "deflate": zlib.deflateSync(text),
        "br": zlib.brotliCompressSync(text),
        "zstd": zlib.zstdCompressSync(text),
        "br, gzip": zlib.gzipSync(zlib.brotliCompressSync(text)),
        "x-unknown": Buffer.from(text),
      };
      const dispatcher = {
        dispatch(opts: any, handler: any) {
          const encoding = decodeURIComponent(opts.path.slice(1));
          handler.onConnect(() => {});
          handler.onHeaders(200, [Buffer.from("Content-Encoding"), Buffer.from(encoding)], () => {}, "OK");
          const body = bodies[encoding];
          // Two chunks, so a decoder sees its input split.
          handler.onData(body.subarray(0, 7));
          handler.onData(body.subarray(7));
          handler.onComplete([]);
          return true;
        },
      };
      const results: Record<string, unknown> = {};
      for (const encoding of Object.keys(bodies)) {
        const res = await undiciFetch(`http://localhost:1/${encodeURIComponent(encoding)}`, { dispatcher } as any);
        // The header stays, as in undici and in native fetch.
        results[encoding] = [res.headers.get("content-encoding"), (await res.text()) === text];
      }
      expect(results).toEqual(Object.fromEntries(Object.keys(bodies).map(encoding => [encoding, [encoding, true]])));
    });

    it("fetch with a dispatcher decodes an empty, a truncated and a raw-deflate body like undici", async () => {
      const text = Buffer.alloc(6000, "hello ").toString();
      const gzip = zlib.gzipSync(text);
      const bodies: Record<string, [string, Buffer[]]> = {
        // A server may announce a coding and then send no bytes at all.
        empty: ["gzip", []],
        // "deflate" is the zlib format, but some servers send the raw deflate stream.
        rawDeflate: ["deflate", [zlib.deflateRawSync(text)]],
        // The connection closed early: the caller gets the bytes that arrived.
        truncated: ["gzip", [gzip.subarray(0, gzip.length - 12)]],
      };
      const dispatcher = {
        dispatch(opts: any, handler: any) {
          const [encoding, chunks] = bodies[opts.path.slice(1)];
          handler.onConnect(() => {});
          handler.onHeaders(200, [Buffer.from("content-encoding"), Buffer.from(encoding)], () => {}, "OK");
          for (const chunk of chunks) handler.onData(chunk);
          handler.onComplete([]);
          return true;
        },
      };
      const read = async (name: string) =>
        (await undiciFetch(`http://localhost:1/${name}`, { dispatcher } as any)).text();
      const truncated = await read("truncated");
      expect({ empty: await read("empty"), rawDeflate: (await read("rawDeflate")) === text }).toEqual({
        empty: "",
        rawDeflate: true,
      });
      expect(truncated.length).toBeGreaterThan(0);
      expect(truncated.length).toBeLessThan(text.length);
      expect(text.startsWith(truncated)).toBe(true);
    });

    it("fetch with a dispatcher rejects a response with more than five content codings, like undici", async () => {
      let aborted = false;
      const dispatcher = {
        dispatch(_opts: any, handler: any) {
          handler.onConnect(() => {
            aborted = true;
          });
          handler.onHeaders(
            200,
            [Buffer.from("content-encoding"), Buffer.from("gzip,gzip,gzip,gzip,gzip,gzip")],
            () => {},
            "",
          );
          return true;
        },
      };
      await expect(undiciFetch("http://localhost:1/", { dispatcher } as any)).rejects.toThrow(
        "too many content-encodings in response: 6, maximum allowed is 5",
      );
      expect(aborted).toBe(true);
    });

    it.each(["identity", "gzip"])(
      "a %s fetch() body that is being read survives garbage collection",
      async encoding => {
        const text = "chunk1chunk2chunk3chunk4";
        const bytes = encoding === "gzip" ? zlib.gzipSync(text) : Buffer.from(text);
        let aborted = false;
        const dispatcher = {
          dispatch(_opts: any, handler: any) {
            handler.onConnect(() => {
              aborted = true;
            });
            handler.onHeaders(200, [Buffer.from("content-encoding"), Buffer.from(encoding)], () => {}, "OK");
            let sent = 0;
            // A collection before every chunk, while the caller's read waits for it.
            const next = () => {
              Bun.gc(true);
              if (sent < bytes.length) {
                handler.onData(bytes.subarray(sent, (sent += 6)));
                setImmediate(next);
              } else {
                handler.onComplete([]);
              }
            };
            setImmediate(next);
            return true;
          },
        };
        // The Response is not kept: only the pending read holds the body.
        expect(await (await undiciFetch("http://localhost:1/", { dispatcher } as any)).text()).toBe(text);
        expect(aborted).toBe(false);
      },
    );

    it("a fetch() body read through a Pool survives garbage collection", async () => {
      const chunk = Buffer.alloc(65536, "a");
      await using server = Bun.serve({
        port: 0,
        fetch() {
          let sent = 0;
          return new Response(
            new ReadableStream({
              pull(controller) {
                Bun.gc(true);
                if (sent++ < 8) controller.enqueue(chunk);
                else controller.close();
              },
            }),
          );
        },
      });
      const pool = new Pool(`http://localhost:${server.port}`);
      const reading = (async () =>
        (await (await undiciFetch(server.url, { dispatcher: pool } as any)).bytes()).length)();
      let read: number | undefined;
      reading.then(length => {
        read = length;
      });
      while (read === undefined) {
        Bun.gc(true);
        await new Promise(resolve => setImmediate(resolve));
      }
      expect(read).toBe(8 * chunk.length);
      await pool.close();
    });

    it.each(["identity", "gzip"])(
      "a collected %s fetch() body that got no data yet cancels its dispatch",
      async encoding => {
        let cancelled = false;
        const dispatcher = {
          dispatch(_opts: any, handler: any) {
            handler.onConnect(() => {
              cancelled = true;
            });
            // Headers, and then the server goes silent.
            handler.onHeaders(200, [Buffer.from("content-encoding"), Buffer.from(encoding)], () => {}, "OK");
            return true;
          },
        };
        const status = await (async () => (await undiciFetch("http://localhost:1/", { dispatcher } as any)).status)();
        expect(status).toBe(200);
        while (!cancelled) {
          Bun.gc(true);
          await new Promise(resolve => setImmediate(resolve));
        }
      },
    );

    it("request() and dispatch() serialize an array in query like undici", async () => {
      await using server = Bun.serve({ port: 0, fetch: req => new Response(new URL(req.url).search) });
      const pool = new Pool(`http://localhost:${server.port}`);
      const query = { ids: [1, 2], page: undefined, q: "a b" };
      const viaPool = await (await pool.request({ path: "/", method: "GET", query })).body.text();
      const viaRequest = await (await request(server.url.href, { query } as any)).body.text();
      // node:querystring, as in undici: a key per array element, and an empty value for undefined.
      expect({ viaPool, viaRequest }).toEqual({
        viaPool: "?ids=1&ids=2&page=&q=a%20b",
        viaRequest: "?ids=1&ids=2&page=&q=a%20b",
      });
      await pool.close();
    });

    it("cancelling an encoded fetch() body in the middle of a read is clean", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const { fetch } = require("undici");
           const zlib = require("node:zlib");
           process.on("uncaughtException", err => console.log("uncaught: " + err.message));
           // One small chunk in, many chunks out: the decoder still has output when the reader cancels.
           const body = zlib.gzipSync(Buffer.alloc(4 << 20, "a"));
           const dispatcher = {
             dispatch(opts, handler) {
               handler.onConnect(() => {});
               handler.onHeaders(200, [Buffer.from("content-encoding"), Buffer.from("gzip")], () => {}, "OK");
               handler.onData(body);
               handler.onComplete([]);
               return true;
             },
           };
           const reader = (await fetch("http://localhost:1/", { dispatcher })).body.getReader();
           const first = await reader.read();
           await reader.cancel();
           console.log("read " + (first.value.length > 0));`,
        ],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout: stdout.trim(), stderr }).toEqual({ stdout: "read true", stderr: "" });
      expect(exitCode).toBe(0);
    });

    it("close() does not wait for a small fetch() body that nobody read", async () => {
      await using server = Bun.serve({ port: 0, fetch: () => new Response("tiny") });
      const pool = new Pool(`http://localhost:${server.port}`);
      const res = await undiciFetch(server.url, { dispatcher: pool } as any);
      await pool.close();
      // The body was buffered, so it is still there.
      expect(await res.text()).toBe("tiny");
    });

    it("a legacy handler that paused on the last chunk gets onComplete after resume(), like undici", async () => {
      await using server = Bun.serve({ port: 0, fetch: () => new Response("x") });
      const pool = new Pool(`http://localhost:${server.port}`);
      const events: string[] = [];
      const paused = Promise.withResolvers<void>();
      const completed = Promise.withResolvers<void>();
      let resume: (() => void) | undefined;
      pool.dispatch(
        { path: "/", method: "GET" },
        {
          onConnect() {},
          onHeaders(_status: number, _headers: Buffer[], resumeFn: () => void) {
            resume = resumeFn;
            return true;
          },
          onData() {
            events.push("data");
            paused.resolve();
            return false;
          },
          onComplete() {
            events.push("complete");
            completed.resolve();
          },
          onError: completed.reject,
        },
      );
      await paused.promise;
      // A whole second request runs to its end while the first one stays paused.
      expect(await (await pool.request({ path: "/", method: "GET" })).body.text()).toBe("x");
      events.push("resume");
      resume!();
      await completed.promise;
      expect(events).toEqual(["data", "resume", "complete"]);
      await pool.close();
    });

    it("request() takes a string, a URLSearchParams and a list of pairs as query", async () => {
      await using server = Bun.serve({ port: 0, fetch: req => new Response(new URL(req.url).search) });
      const pool = new Pool(`http://localhost:${server.port}`);
      const search = async (query: any) => [
        await (await request(server.url.href, { query } as any)).body.text(),
        await (await pool.request({ path: "/", method: "GET", query })).body.text(),
      ];
      expect({
        string: await search("a=1&b=2"),
        params: await search(new URLSearchParams({ a: "1" })),
        pairs: await search([["a", "1"]]),
      }).toEqual({
        string: ["?a=1&b=2", "?a=1&b=2"],
        params: ["?a=1", "?a=1"],
        pairs: ["?a=1", "?a=1"],
      });
      await pool.close();
    });

    it("a deflate fetch() body ends when bytes follow the end of the deflate stream, like undici", async () => {
      const text = Buffer.alloc(5000, "hello ").toString();
      const junk = Buffer.alloc(40000, "J");
      const bodies: Record<string, Buffer> = { zlib: zlib.deflateSync(text), raw: zlib.deflateRawSync(text) };
      const completed = { zlib: Promise.withResolvers<string>(), raw: Promise.withResolvers<string>() };
      const dispatcher = {
        dispatch(opts: any, handler: any) {
          const name = opts.path.slice(1);
          // More than the decoders buffer, so this dispatcher is paused on the way and has to be resumed.
          const parts = [bodies[name], ...Array.from({ length: 12 }, () => junk)];
          let sent = 0;
          const send = () => {
            while (sent < parts.length) if (handler.onData(parts[sent++]) === false) return;
            handler.onComplete([]);
            completed[name as "zlib" | "raw"].resolve("sent all");
          };
          handler.onConnect(() => {});
          handler.onHeaders(200, [Buffer.from("content-encoding"), Buffer.from("deflate")], send, "OK");
          send();
          return true;
        },
      };
      const read = async (name: string) =>
        (await (await undiciFetch(`http://localhost:1/${name}`, { dispatcher } as any)).text()) === text;
      expect({ zlib: await read("zlib"), raw: await read("raw") }).toEqual({ zlib: true, raw: true });
      // The bytes after the end are dropped, and the dispatcher is not left paused on them: it sends the rest.
      expect({ zlib: await completed.zlib.promise, raw: await completed.raw.promise }).toEqual({
        zlib: "sent all",
        raw: "sent all",
      });
    });

    it("an unread deflate fetch() body does not inflate without bound", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const { fetch } = require("undici");
           const zlib = require("node:zlib");
           const { heapStats } = require("bun:jsc");
           // 64 MiB of zeros is about 64 KiB of deflate: one chunk for a dispatcher, in both forms of the coding.
           const zeros = Buffer.alloc(64 << 20);
           const bombs = [zlib.deflateSync(zeros), zlib.deflateRawSync(zeros)];
           const responses = [];
           Bun.gc(true);
           const before = heapStats().extraMemorySize;
           for (const bomb of bombs) {
             const dispatcher = {
               dispatch(opts, handler) {
                 handler.onConnect(() => {});
                 handler.onHeaders(200, [Buffer.from("content-encoding"), Buffer.from("deflate")], () => {}, "OK");
                 handler.onData(bomb);
                 handler.onComplete([]);
                 return true;
               },
             };
             // Held and never read.
             responses.push(await fetch("http://localhost:1/", { dispatcher }));
           }
           // Runs when nothing is left to do, so the decoders have stopped.
           process.once("beforeExit", () => {
             Bun.gc(true);
             const buffered = Math.round((heapStats().extraMemorySize - before) / 1048576);
             console.log(buffered < 32 ? "bounded" : buffered + " MiB buffered");
           });`,
        ],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout: stdout.trim(), stderr }).toEqual({ stdout: "bounded", stderr: "" });
      expect(exitCode).toBe(0);
    });

    it("a deflate fetch() body that is read after its decoder finished is complete", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const { fetch } = require("undici");
           const zlib = require("node:zlib");
           // More than the decoder hands over before it pauses, and less than it holds: it finishes with bytes inside.
           const text = Buffer.alloc(100000, "hello world ").toString();
           const responses = [];
           for (const packed of [zlib.deflateSync(text), zlib.deflateRawSync(text)]) {
             const dispatcher = {
               dispatch(opts, handler) {
                 handler.onConnect(() => {});
                 handler.onHeaders(200, [Buffer.from("content-encoding"), Buffer.from("deflate")], () => {}, "OK");
                 handler.onData(packed);
                 handler.onComplete([]);
                 return true;
               },
             };
             responses.push(await fetch("http://localhost:1/", { dispatcher }));
           }
           // Runs when nothing is left to do, so the decoders are done. Only now the bodies are read.
           process.once("beforeExit", async () => {
             const lengths = [];
             for (const response of responses) {
               const read = await response.text().catch(err => String(err));
               lengths.push(read === text ? "complete" : read.length);
             }
             console.log(JSON.stringify(lengths));
           });`,
        ],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout: stdout.trim(), stderr }).toEqual({ stdout: '["complete","complete"]', stderr: "" });
      expect(exitCode).toBe(0);
    });

    it("fetch with a dispatcher does not follow a 301 with a stream body, like undici", async () => {
      const paths: string[] = [];
      const dispatcher = {
        dispatch(opts: any, handler: any) {
          paths.push(`${opts.method} ${opts.path}`);
          handler.onConnect(() => {});
          handler.onHeaders(301, [Buffer.from("location"), Buffer.from("/next")], () => {}, "");
          return true;
        },
      };
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("payload"));
          controller.close();
        },
      });
      // A POST becomes a GET on a 301, but the standard rejects before that: the stream has no source to send again.
      await expect(
        undiciFetch("http://localhost:1/a", { dispatcher, method: "POST", body, duplex: "half" } as any),
      ).rejects.toThrow("a stream body cannot be sent twice");
      expect(paths).toEqual(["POST /a"]);
    });

    it("request({ throwOnError }) on a dispatcher rejects with ResponseStatusCodeError, like undici 6", async () => {
      await using server = Bun.serve({
        port: 0,
        fetch(req) {
          const path = new URL(req.url).pathname;
          if (path === "/json") return Response.json({ why: "no" }, { status: 500 });
          if (path === "/text") return new Response("gone", { status: 404, headers: { "content-type": "text/plain" } });
          return new Response("ok");
        },
      });
      const pool = new Pool(`http://localhost:${server.port}`);
      const failure = async (path: string) => {
        const err: any = await pool.request({ path, method: "GET", throwOnError: true }).catch(err => err);
        return { name: err.name, code: err.code, statusCode: err.statusCode, status: err.status, body: err.body };
      };
      const base = { name: "ResponseStatusCodeError", code: "UND_ERR_RESPONSE_STATUS_CODE" };
      expect({ json: await failure("/json"), text: await failure("/text") }).toEqual({
        json: { ...base, statusCode: 500, status: 500, body: { why: "no" } },
        text: { ...base, statusCode: 404, status: 404, body: "gone" },
      });
      const ok = await pool.request({ path: "/ok", method: "GET", throwOnError: true });
      expect(await ok.body.text()).toBe("ok");
      await pool.close();
    });

    it("the top-level request({ dispatcher, throwOnError }) rejects with its own error and ends the response", async () => {
      await using server = Bun.serve({
        port: 0,
        fetch: () =>
          new Response(
            new ReadableStream({
              // One chunk, then the body stays open.
              start(controller) {
                controller.enqueue(new TextEncoder().encode("first"));
              },
            }),
            { status: 503 },
          ),
      });
      const url = `http://localhost:${server.port}/fail`;
      const failure = async (dispatcher: unknown) => {
        const err: any = await request(url, { dispatcher, throwOnError: true } as any).catch(err => err);
        return { name: err.name, message: err.message, code: err.code };
      };
      const expected = { name: "Error", message: "Request failed with status code 503", code: undefined };

      const pool = new Pool(`http://localhost:${server.port}`);
      expect(await failure(pool)).toEqual(expected);
      // The body stays open on the server, so close() resolves only when request() ended the response.
      await pool.close();

      const inner = new Pool(`http://localhost:${server.port}`);
      let aborted = false;
      const custom = {
        dispatch(opts, handler) {
          return inner.dispatch(opts, {
            onConnect(abort, context) {
              handler.onConnect(reason => {
                aborted = true;
                abort(reason);
              }, context);
            },
            onHeaders: (...args) => handler.onHeaders(...args),
            onData: chunk => handler.onData(chunk),
            onComplete: trailers => handler.onComplete(trailers),
            onError: err => handler.onError(err),
          });
        },
      };
      expect({ ...(await failure(custom)), aborted }).toEqual({ ...expected, aborted: true });
      await inner.close();
    });

    it("destroy() of a request() body that is being read rejects the read with RequestAbortedError", async () => {
      await using server = Bun.serve({
        port: 0,
        fetch: () =>
          new Response(
            new ReadableStream({
              // One chunk, then the body stays open.
              start(controller) {
                controller.enqueue(new TextEncoder().encode("first"));
              },
            }),
          ),
      });
      const pool = new Pool(`http://localhost:${server.port}`);
      const { body } = await pool.request({ path: "/", method: "GET" });
      const reading = body.text();
      body.destroy();
      await expect(reading).rejects.toHaveProperty("code", "UND_ERR_ABORTED");
      // A body that nobody reads closes without an error, so there is nothing to leave uncaught.
      const unread = (await pool.request({ path: "/", method: "GET" })).body;
      const closed = Promise.withResolvers<void>();
      unread.on("close", closed.resolve).destroy();
      await closed.promise;
      expect(unread.errored).toBeNull();
      await pool.destroy();
    });

    it("request() through a closed stock Agent rejects, like fetch()", async () => {
      const agent = new Agent();
      await agent.close();
      await expect(request(`${hostUrl}/get`, { dispatcher: agent } as any)).rejects.toBeInstanceOf(
        errors.ClientDestroyedError,
      );
    });

    it("request(url, { dispatcher }) routes through a custom dispatcher", async () => {
      const seen: any[] = [];
      const pool = new Pool(hostUrl);
      const dispatcher = {
        dispatch(opts: any, handler: any) {
          seen.push({ origin: opts.origin, path: opts.path, method: opts.method });
          return pool.dispatch(opts, handler);
        },
      };
      // Nothing listens on the URL's port; only the dispatcher can answer.
      const { statusCode, body } = await request("http://localhost:1/get", { dispatcher, query: { x: "1" } } as any);
      expect(statusCode).toBe(200);
      expect(((await body.json()) as { url: string }).url).toBe(`${hostUrl}/get?x=1`);
      expect(seen).toEqual([{ origin: "http://localhost:1", path: "/get?x=1", method: "GET" }]);
      await pool.close();
    });
  });
});

// A minimal HTTP proxy that answers absolute-form requests itself and records every request line and header it sees.
async function recordingProxy() {
  const seen: string[] = [];
  const seenHeaders: Record<string, string>[] = [];
  const server = net.createServer(socket => {
    socket.once("data", data => {
      const [line, ...rest] = data.toString("latin1").split("\r\n");
      seen.push(line);
      const headers: Record<string, string> = {};
      for (const h of rest) {
        const i = h.indexOf(":");
        if (i > 0) headers[h.slice(0, i).toLowerCase()] = h.slice(i + 1).trim();
      }
      seenHeaders.push(headers);
      socket.end("HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\nPROXIED");
    });
    socket.on("error", () => {});
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    seen,
    seenHeaders,
    url: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`,
    [Symbol.asyncDispose]: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

function recordingOrigin() {
  const seen: string[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      seen.push(new URL(req.url).pathname);
      return new Response("ORIGIN");
    },
  });
  return { seen, url: `http://127.0.0.1:${server.port}`, [Symbol.asyncDispose]: () => server.stop(true) };
}

describe("undici ProxyAgent", () => {
  it("fetch({ dispatcher: ProxyAgent }) goes through the proxy, not to the origin", async () => {
    await using origin = recordingOrigin();
    await using proxy = await recordingProxy();
    const agent = new ProxyAgent(proxy.url);
    const res = await undiciFetch(`${origin.url}/via-fetch`, { dispatcher: agent } as any);
    expect(await res.text()).toBe("PROXIED");
    expect({ proxy: proxy.seen, origin: origin.seen }).toEqual({
      proxy: [`GET ${origin.url}/via-fetch HTTP/1.1`],
      origin: [],
    });
    await agent.close();
  });

  it("request({ dispatcher: ProxyAgent }) goes through the proxy and sends the token to it", async () => {
    await using origin = recordingOrigin();
    await using proxy = await recordingProxy();
    const agent = new ProxyAgent({ uri: proxy.url, token: "Bearer secret-token" });
    const { statusCode, body } = await request(`${origin.url}/via-request`, { dispatcher: agent } as any);
    expect({ statusCode, text: await body.text() }).toEqual({ statusCode: 200, text: "PROXIED" });
    expect({ proxy: proxy.seen, token: proxy.seenHeaders[0]["proxy-authorization"], origin: origin.seen }).toEqual({
      proxy: [`GET ${origin.url}/via-request HTTP/1.1`],
      token: "Bearer secret-token",
      origin: [],
    });
  });

  it("ProxyAgent sends opts.headers and opts.auth to the proxy", async () => {
    await using origin = recordingOrigin();
    await using proxy = await recordingProxy();
    const auth = Buffer.from("user:pass").toString("base64");
    const agent = new ProxyAgent({ uri: proxy.url, headers: { "x-proxy-tenant": "acme" }, auth });
    await (await undiciFetch(`${origin.url}/headers`, { dispatcher: agent } as any)).text();
    expect({
      tenant: proxy.seenHeaders[0]["x-proxy-tenant"],
      authorization: proxy.seenHeaders[0]["proxy-authorization"],
      origin: origin.seen,
    }).toEqual({ tenant: "acme", authorization: `Basic ${auth}`, origin: [] });
  });

  it("proxyAgent.request() and a RetryAgent around a ProxyAgent go through the proxy", async () => {
    await using origin = recordingOrigin();
    await using proxy = await recordingProxy();
    const agent = new ProxyAgent(proxy.url);
    const { body } = await agent.request({ origin: origin.url, path: "/dispatch", method: "GET" });
    const res = await undiciFetch(`${origin.url}/retry`, { dispatcher: new RetryAgent(agent) } as any);
    expect({ dispatch: await body.text(), retry: await res.text() }).toEqual({ dispatch: "PROXIED", retry: "PROXIED" });
    expect({ proxy: proxy.seen, origin: origin.seen }).toEqual({
      proxy: [`GET ${origin.url}/dispatch HTTP/1.1`, `GET ${origin.url}/retry HTTP/1.1`],
      origin: [],
    });
  });

  it.skipIf(isWindows)("a unix socket request ignores the ProxyAgent", async () => {
    await using proxy = await recordingProxy();
    using dir = tempDir("undici-unix", {});
    const unix = join(String(dir), "s.sock");
    await using origin = Bun.serve({ unix, fetch: req => new Response("UNIX " + new URL(req.url).pathname) });
    const res = await undiciFetch("http://localhost/over-unix", {
      unix,
      dispatcher: new ProxyAgent(proxy.url),
    } as any);
    expect({ text: await res.text(), proxy: proxy.seen }).toEqual({ text: "UNIX /over-unix", proxy: [] });
  });

  it("fetch through a ProxyAgent keeps the options that the caller's init inherits", async () => {
    await using origin = recordingOrigin();
    await using proxy = await recordingProxy();
    class Init {
      get method() {
        return "POST";
      }
      get body() {
        return "payload";
      }
      get headers() {
        return { "x-test": "getters" };
      }
    }
    const inherited = Object.create({ method: "PUT", body: "payload", headers: { "x-test": "inherited" } });
    const dispatcher = new ProxyAgent(proxy.url);
    // Native fetch reads each option with a property get. A copy of the own properties would send a bare GET.
    await (await undiciFetch(`${origin.url}/getters`, { __proto__: new Init(), dispatcher } as any)).text();
    await (await undiciFetch(`${origin.url}/inherited`, { __proto__: inherited, dispatcher } as any)).text();
    expect({ proxy: proxy.seen, test: proxy.seenHeaders.map(h => h["x-test"]), origin: origin.seen }).toEqual({
      proxy: [`POST ${origin.url}/getters HTTP/1.1`, `PUT ${origin.url}/inherited HTTP/1.1`],
      test: ["getters", "inherited"],
      origin: [],
    });
  });

  it("a route that the caller chose outranks the ProxyAgent", async () => {
    await using origin = recordingOrigin();
    await using agentProxy = await recordingProxy();
    await using callerProxy = await recordingProxy();
    const dispatcher = new ProxyAgent(agentProxy.url);
    using proxied = new Bun.FetchSession({ proxy: callerProxy.url });
    using plain = new Bun.FetchSession();
    const texts = [
      await (await undiciFetch(`${origin.url}/session-proxy`, { session: proxied, dispatcher } as any)).text(),
      await (await undiciFetch(`${origin.url}/session`, { session: plain, dispatcher } as any)).text(),
      await (await undiciFetch(`${origin.url}/init-proxy`, { proxy: callerProxy.url, dispatcher } as any)).text(),
      await (
        await undiciFetch({ url: `${origin.url}/input-proxy`, proxy: callerProxy.url } as any, { dispatcher } as any)
      ).text(),
    ];
    expect({ texts, agentProxy: agentProxy.seen, callerProxy: callerProxy.seen, origin: origin.seen }).toEqual({
      texts: ["PROXIED", "ORIGIN", "PROXIED", "PROXIED"],
      agentProxy: [],
      callerProxy: [
        `GET ${origin.url}/session-proxy HTTP/1.1`,
        `GET ${origin.url}/init-proxy HTTP/1.1`,
        `GET ${origin.url}/input-proxy HTTP/1.1`,
      ],
      origin: ["/session"],
    });
  });

  it.skipIf(isWindows)("a session with a unix socket ignores the ProxyAgent", async () => {
    await using proxy = await recordingProxy();
    using dir = tempDir("undici-session-unix", {});
    const unix = join(String(dir), "s.sock");
    await using origin = Bun.serve({ unix, fetch: req => new Response("UNIX " + new URL(req.url).pathname) });
    using session = new Bun.FetchSession({ unix });
    const res = await undiciFetch("http://localhost/session-unix", {
      session,
      dispatcher: new ProxyAgent(proxy.url),
    } as any);
    expect({ text: await res.text(), proxy: proxy.seen }).toEqual({ text: "UNIX /session-unix", proxy: [] });
  });

  it("a global ProxyAgent proxies fetch and request, and ignores NO_PROXY", async () => {
    await using origin = recordingOrigin();
    await using proxy = await recordingProxy();
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { Agent, MockAgent, ProxyAgent, fetch, request, setGlobalDispatcher } = require("undici");
         const [origin, proxy] = process.argv.slice(1);
         setGlobalDispatcher(new ProxyAgent(proxy));
         const out = [];
         out.push(await (await fetch(origin + "/global-fetch")).text());
         out.push(await (await request(origin + "/global-request")).body.text());
         // Bun accepts a Request as init; its fields must survive the proxy being added.
         const init = new Request("http://ignored.invalid/", { method: "POST", headers: { "x-from-init": "yes" }, body: "b" });
         out.push(await (await fetch(origin + "/request-as-init", init)).text());
         out.push(await (await fetch(origin + "/explicit-agent", { dispatcher: new Agent() })).text());
         // Interception is not implemented: a MockAgent behaves like an Agent.
         setGlobalDispatcher(new MockAgent());
         out.push(await (await fetch(origin + "/mock-agent")).text());
         console.log(JSON.stringify(out));`,
        origin.url,
        proxy.url,
      ],
      env: { ...bunEnv, NO_PROXY: "127.0.0.1", no_proxy: "127.0.0.1" },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr }).toEqual({
      stdout: JSON.stringify(["PROXIED", "PROXIED", "PROXIED", "ORIGIN", "ORIGIN"]),
      stderr: "",
    });
    expect({ proxy: proxy.seen, fromInit: proxy.seenHeaders[2]?.["x-from-init"], origin: origin.seen }).toEqual({
      proxy: [
        `GET ${origin.url}/global-fetch HTTP/1.1`,
        `GET ${origin.url}/global-request HTTP/1.1`,
        `POST ${origin.url}/request-as-init HTTP/1.1`,
      ],
      fromInit: "yes",
      origin: ["/explicit-agent", "/mock-agent"],
    });
    expect(exitCode).toBe(0);
  });

  it("a global EnvHttpProxyAgent leaves the proxy environment variables to native fetch", async () => {
    await using origin = recordingOrigin();
    await using proxy = await recordingProxy();
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { EnvHttpProxyAgent, fetch, setGlobalDispatcher } = require("undici");
         setGlobalDispatcher(new EnvHttpProxyAgent());
         console.log(await (await fetch(process.argv[1])).text());`,
        `${origin.url}/env`,
      ],
      env: { ...bunEnv, HTTP_PROXY: proxy.url, http_proxy: proxy.url, NO_PROXY: "", no_proxy: "" },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr }).toEqual({ stdout: "PROXIED", stderr: "" });
    expect({ proxy: proxy.seen, origin: origin.seen }).toEqual({
      proxy: [`GET ${origin.url}/env HTTP/1.1`],
      origin: [],
    });
    expect(exitCode).toBe(0);
  });

  it("ProxyAgent rejects options it would otherwise drop", () => {
    const uri = "http://127.0.0.1:1";
    for (const arg of [undefined, {}, 123, "", { uri: "" }]) {
      expect(() => new (ProxyAgent as any)(arg)).toThrow("Proxy uri is mandatory");
    }
    expect(() => new (ProxyAgent as any)({ uri, token: Buffer.from("t") })).toThrow(errors.InvalidArgumentError);
    expect(() => new (ProxyAgent as any)({ uri, auth: 123 })).toThrow(errors.InvalidArgumentError);
    expect(() => new ProxyAgent({ uri, token: "t", auth: "a" })).toThrow(errors.InvalidArgumentError);
  });

  it("a Pool and a Client connect to their origin when a proxy variable is set, and wrangler's proxy setup runs", async () => {
    await using origin = recordingOrigin();
    await using proxy = await recordingProxy();
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { Client, EnvHttpProxyAgent, Pool, fetch, setGlobalDispatcher } = require("undici");
         const origin = process.argv[1];
         // What wrangler 4 runs at startup when a proxy variable is set.
         setGlobalDispatcher(new EnvHttpProxyAgent({ noProxy: "localhost,127.0.0.1,::1" }));
         const out = [];
         // miniflare reaches workerd on the loopback interface through a Pool.
         out.push(await (await new Pool(origin).request({ path: "/pool", method: "GET" })).body.text());
         out.push(await (await new Client(origin).request({ path: "/client", method: "GET" })).body.text());
         const pool = new Pool(origin);
         out.push(await (await fetch(origin + "/wrapped", { dispatcher: { dispatch: (o, h) => pool.dispatch(o, h) } })).text());
         // The global EnvHttpProxyAgent leaves the variables to native fetch.
         out.push(await (await fetch(origin + "/global")).text());
         console.log(JSON.stringify(out));`,
        origin.url,
      ],
      env: { ...bunEnv, HTTP_PROXY: proxy.url, http_proxy: proxy.url, NO_PROXY: "", no_proxy: "" },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr }).toEqual({
      stdout: JSON.stringify(["ORIGIN", "ORIGIN", "ORIGIN", "PROXIED"]),
      stderr: "",
    });
    expect({ origin: origin.seen, proxy: proxy.seen }).toEqual({
      origin: ["/pool", "/client", "/wrapped"],
      proxy: [`GET ${origin.url}/global HTTP/1.1`],
    });
    expect(exitCode).toBe(0);
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
