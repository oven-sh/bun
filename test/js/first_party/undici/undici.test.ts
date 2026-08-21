import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tls as tlsCert } from "harness";
import { Readable } from "node:stream";
import { Agent, errors, getGlobalDispatcher, request, setGlobalDispatcher, fetch as undiciFetch } from "undici";

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
        err => (err instanceof errors.NotSupportedError ? "NotSupportedError" : String(err)),
      ),
    ).toBe("NotSupportedError");
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

  it("an Agent without connect options leaves requests untouched", async () => {
    await using server = Bun.serve({ port: 0, fetch: () => new Response("plain") });
    const res = await undiciFetch(`http://127.0.0.1:${server.port}/`, { dispatcher: new Agent() });
    expect(await res.text()).toBe("plain");
  });
});
