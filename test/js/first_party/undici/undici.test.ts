import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { once } from "node:events";
import net from "node:net";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
  Agent,
  Client,
  Dispatcher,
  EnvHttpProxyAgent,
  errors,
  getGlobalDispatcher,
  MockAgent,
  Pool,
  ProxyAgent,
  request,
  RetryAgent,
  setGlobalDispatcher,
  fetch as undiciFetch,
} from "undici";

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

// A minimal HTTP proxy that records every request it sees. Supports both
// absolute-form requests (http:// targets) and CONNECT (tunneled targets).
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
      const [method, target] = line.split(" ");
      if (method === "CONNECT") {
        const [host, port] = target.split(":");
        const upstream = net.connect({ host, port: Number(port) }, () => {
          socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          upstream.pipe(socket);
          socket.pipe(upstream);
        });
        upstream.on("error", () => socket.destroy());
        socket.on("error", () => upstream.destroy());
        socket.on("close", () => upstream.end());
      } else {
        const body = "PROXIED";
        socket.end(`HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`);
      }
    });
    socket.on("error", () => {});
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address() as net.AddressInfo;
  return {
    seen,
    seenHeaders,
    url: `http://127.0.0.1:${addr.port}`,
    [Symbol.asyncDispose]: () => new Promise<void>(r => server.close(() => r())),
  };
}

function recordingOrigin() {
  const seen: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: req => {
      seen.push(new URL(req.url).pathname);
      return new Response("ORIGIN");
    },
  });
  return { seen, url: `http://127.0.0.1:${server.port}`, [Symbol.asyncDispose]: () => server.stop(true) };
}

describe("undici ProxyAgent / dispatcher", () => {
  // These tests call undici.fetch()/request() in-process against loopback
  // servers; an ambient HTTP_PROXY/NO_PROXY would change the routing. Clear
  // them for this block (assign "" rather than delete so native sees it).
  const savedProxyEnv: Record<string, string | undefined> = {};
  const PROXY_ENV_KEYS = ["NO_PROXY", "no_proxy", "HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy"];
  beforeAll(() => {
    for (const key of PROXY_ENV_KEYS) {
      savedProxyEnv[key] = process.env[key];
      process.env[key] = "";
    }
  });
  afterAll(() => {
    for (const key of PROXY_ENV_KEYS) {
      if (savedProxyEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedProxyEnv[key];
    }
  });

  it("fetch keeps the shape of the native function", () => {
    // init is optional, as in the Fetch IDL and upstream undici.
    expect(undiciFetch.length).toBe(1);
    expect(undiciFetch.preconnect).toBe(Bun.fetch.preconnect);
  });

  it("fetch({dispatcher: ProxyAgent}) goes through the proxy, not to the origin", async () => {
    await using origin = recordingOrigin();
    await using proxy = await recordingProxy();

    const agent = new ProxyAgent(proxy.url);
    const res = await undiciFetch(`${origin.url}/via-dispatcher`, { dispatcher: agent });
    expect(await res.text()).toBe("PROXIED");

    expect(proxy.seen).toEqual([`GET ${origin.url}/via-dispatcher HTTP/1.1`]);
    expect(origin.seen).toEqual([]);
    await agent.close();
  });

  it("fetch(Request, {dispatcher: ProxyAgent}) goes through the proxy", async () => {
    await using origin = recordingOrigin();
    await using proxy = await recordingProxy();

    const res = await undiciFetch(new Request(`${origin.url}/request-object`), {
      dispatcher: new ProxyAgent(proxy.url),
    });
    expect(await res.text()).toBe("PROXIED");
    expect(proxy.seen).toEqual([`GET ${origin.url}/request-object HTTP/1.1`]);
    expect(origin.seen).toEqual([]);
  });

  it("fetch(url, Request) as init still goes through a global ProxyAgent and keeps the Request's fields", async () => {
    await using origin = recordingOrigin();
    await using proxy = await recordingProxy();

    const init = new Request("http://ignored.invalid/", {
      method: "POST",
      headers: { "x-from-init": "yes" },
      body: "b",
    });
    const previous = getGlobalDispatcher();
    try {
      setGlobalDispatcher(new ProxyAgent(proxy.url));
      const res = await undiciFetch(`${origin.url}/request-as-init`, init);
      expect(await res.text()).toBe("PROXIED");
    } finally {
      setGlobalDispatcher(previous);
    }

    expect(proxy.seen).toEqual([`POST ${origin.url}/request-as-init HTTP/1.1`]);
    expect(proxy.seenHeaders[0]["x-from-init"]).toBe("yes");
    expect(origin.seen).toEqual([]);
  });

  it("request({dispatcher: ProxyAgent}) goes through the proxy and sends token as proxy-authorization", async () => {
    await using origin = recordingOrigin();
    await using proxy = await recordingProxy();

    const agent = new ProxyAgent({ uri: proxy.url, token: "Bearer secret-token" });
    const { statusCode, body } = await request(`${origin.url}/req`, { dispatcher: agent });
    expect(statusCode).toBe(200);
    expect(await body!.text()).toBe("PROXIED");

    expect(proxy.seen).toEqual([`GET ${origin.url}/req HTTP/1.1`]);
    expect(proxy.seenHeaders[0]["proxy-authorization"]).toBe("Bearer secret-token");
    expect(origin.seen).toEqual([]);
  });

  it("ProxyAgent opts.headers are sent to the proxy", async () => {
    await using origin = recordingOrigin();
    await using proxy = await recordingProxy();

    const agent = new ProxyAgent({
      uri: proxy.url,
      headers: { "x-proxy-tenant": "acme" },
      auth: Buffer.from("user:pass").toString("base64"),
    });
    await (await undiciFetch(`${origin.url}/headers`, { dispatcher: agent })).text();

    expect(proxy.seenHeaders[0]["x-proxy-tenant"]).toBe("acme");
    expect(proxy.seenHeaders[0]["proxy-authorization"]).toBe(`Basic ${Buffer.from("user:pass").toString("base64")}`);
    expect(origin.seen).toEqual([]);
  });

  it("setGlobalDispatcher(ProxyAgent) applies to fetch and request without an explicit dispatcher", async () => {
    await using origin = recordingOrigin();
    await using proxy = await recordingProxy();

    const previous = getGlobalDispatcher();
    try {
      setGlobalDispatcher(new ProxyAgent(proxy.url));
      await (await undiciFetch(`${origin.url}/global-fetch`)).text();
      await (await request(`${origin.url}/global-request`)).body!.text();
    } finally {
      setGlobalDispatcher(previous);
    }

    expect(proxy.seen).toEqual([
      `GET ${origin.url}/global-fetch HTTP/1.1`,
      `GET ${origin.url}/global-request HTTP/1.1`,
    ]);
    expect(origin.seen).toEqual([]);
  });

  it("an explicit non-proxy dispatcher overrides a global ProxyAgent", async () => {
    await using origin = recordingOrigin();
    await using proxy = await recordingProxy();

    const previous = getGlobalDispatcher();
    try {
      setGlobalDispatcher(new ProxyAgent(proxy.url));
      const res = await undiciFetch(`${origin.url}/explicit-agent`, { dispatcher: new Agent() });
      expect(await res.text()).toBe("ORIGIN");
    } finally {
      setGlobalDispatcher(previous);
    }

    expect(origin.seen).toEqual(["/explicit-agent"]);
    expect(proxy.seen).toEqual([]);
  });

  it("a unix socket request ignores a global ProxyAgent instead of failing the proxy/unix conflict", async () => {
    await using proxy = await recordingProxy();
    using dir = tempDir("undici-unix", {});
    const unix = join(String(dir), "s.sock");
    const seen: string[] = [];
    await using origin = Bun.serve({
      unix,
      fetch: req => {
        seen.push(new URL(req.url).pathname);
        return new Response("UNIX");
      },
    });

    const previous = getGlobalDispatcher();
    try {
      setGlobalDispatcher(new ProxyAgent(proxy.url));
      const res = await undiciFetch("http://localhost/over-unix", { unix });
      expect(await res.text()).toBe("UNIX");
    } finally {
      setGlobalDispatcher(previous);
    }

    expect(seen).toEqual(["/over-unix"]);
    expect(proxy.seen).toEqual([]);
  });

  it("setGlobalDispatcher accepts dispatchers without proxy support (MockAgent) and requests go direct", async () => {
    await using origin = recordingOrigin();

    const previous = getGlobalDispatcher();
    try {
      setGlobalDispatcher(new MockAgent());
      const res = await undiciFetch(`${origin.url}/mock-agent`);
      expect(await res.text()).toBe("ORIGIN");
    } finally {
      setGlobalDispatcher(previous);
    }

    expect(origin.seen).toEqual(["/mock-agent"]);
  });

  it("RetryAgent wrapping a ProxyAgent goes through the proxy", async () => {
    await using origin = recordingOrigin();
    await using proxy = await recordingProxy();

    const res = await undiciFetch(`${origin.url}/retry`, { dispatcher: new RetryAgent(new ProxyAgent(proxy.url)) });
    expect(await res.text()).toBe("PROXIED");
    expect(proxy.seen).toEqual([`GET ${origin.url}/retry HTTP/1.1`]);
    expect(origin.seen).toEqual([]);
  });

  it("proxyAgent.request({origin, path}) goes through the proxy", async () => {
    await using origin = recordingOrigin();
    await using proxy = await recordingProxy();

    const { body } = await new ProxyAgent(proxy.url).request({ origin: origin.url, path: "/self", method: "GET" });
    expect(await body!.text()).toBe("PROXIED");
    expect(proxy.seen).toEqual([`GET ${origin.url}/self HTTP/1.1`]);
    expect(origin.seen).toEqual([]);
  });

  it("ProxyAgent rejects a missing or empty uri", () => {
    for (const arg of [undefined, {}, 123, "", { uri: "" }]) {
      expect(() => new (ProxyAgent as any)(arg)).toThrow("Proxy uri is mandatory");
    }
  });

  it("ProxyAgent rejects credentials it would otherwise drop", () => {
    const uri = "http://127.0.0.1:1";
    expect(() => new (ProxyAgent as any)({ uri, token: Buffer.from("t") })).toThrow(errors.InvalidArgumentError);
    expect(() => new (ProxyAgent as any)({ uri, auth: 123 })).toThrow(errors.InvalidArgumentError);
    expect(() => new ProxyAgent({ uri, token: "t", auth: "a" })).toThrow(errors.InvalidArgumentError);
  });

  it("RetryAgent requires a dispatcher to wrap", () => {
    expect(() => new (RetryAgent as any)()).toThrow(errors.InvalidArgumentError);
    expect(() => new (RetryAgent as any)(null)).toThrow(errors.InvalidArgumentError);
    expect(() => new RetryAgent(new Agent())).not.toThrow();
  });

  it("Client and Pool reject a missing, empty or unparsable origin, and stay siblings", () => {
    for (const Ctor of [Client, Pool]) {
      for (const arg of [undefined, null, "", 123, "not a url"]) {
        expect(() => new (Ctor as any)(arg)).toThrow(errors.InvalidArgumentError);
      }
    }
    const pool = new Pool("http://127.0.0.1:1");
    expect(pool).toBeInstanceOf(Dispatcher);
    expect(pool).not.toBeInstanceOf(Client);
    expect(new Client("http://127.0.0.1:1")).not.toBeInstanceOf(Pool);
    expect(pool.constructor.name).toBe("Pool");
  });

  it("EnvHttpProxyAgent() re-evaluates NO_PROXY per redirect hop", async () => {
    // The routing here is native's; this pins that a global EnvHttpProxyAgent
    // stays out of its way: hop 1 (NO_PROXY host) goes direct, hop 2 (not
    // exempt) must reach the proxy, which answers itself.
    await using proxy = await recordingProxy();
    const hop1Seen: string[] = [];
    await using exempt = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: req => {
        hop1Seen.push(new URL(req.url).pathname);
        return Response.redirect("http://127.0.0.2:9/hop2", 302);
      },
    });

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { EnvHttpProxyAgent, fetch, setGlobalDispatcher } = require("undici");
         setGlobalDispatcher(new EnvHttpProxyAgent());
         console.log(await (await fetch(process.argv[1])).text());`,
        `http://127.0.0.1:${exempt.port}/hop1`,
      ],
      env: { ...bunEnv, HTTP_PROXY: proxy.url, http_proxy: proxy.url, NO_PROXY: "127.0.0.1", no_proxy: "127.0.0.1" },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("PROXIED");
    expect(exitCode).toBe(0);

    expect(hop1Seen).toEqual(["/hop1"]);
    expect(proxy.seen).toEqual(["GET http://127.0.0.2:9/hop2 HTTP/1.1"]);
  });

  it("EnvHttpProxyAgent rejects per-instance overrides instead of ignoring them", () => {
    expect(() => new EnvHttpProxyAgent()).not.toThrow();
    expect(() => new EnvHttpProxyAgent({})).not.toThrow();
    expect(() => new EnvHttpProxyAgent({ httpProxy: "http://127.0.0.1:1" })).toThrow("not implemented");
    expect(() => new EnvHttpProxyAgent({ httpsProxy: "http://127.0.0.1:1" })).toThrow("not implemented");
    expect(() => new EnvHttpProxyAgent({ noProxy: "example.com" })).toThrow("not implemented");
  });
});

describe("undici.request UrlObject", () => {
  it("accepts {origin, path} and {protocol, hostname, port, path}", async () => {
    await using origin = Bun.serve({
      port: 0,
      fetch: req => {
        const url = new URL(req.url);
        return Response.json({ path: url.pathname + url.search });
      },
    });
    const base = { hostname: "127.0.0.1", port: origin.port };

    const r1 = await request({ origin: `http://127.0.0.1:${origin.port}`, path: "/origin-path" } as any);
    expect(await r1.body!.json()).toEqual({ path: "/origin-path" });

    // Trailing slash on origin (always present on URL#href) and a missing
    // leading slash on path must not produce `//x` or `hostx`.
    const r2 = await request({ origin: `http://127.0.0.1:${origin.port}/`, path: "no-leading-slash" } as any);
    expect(await r2.body!.json()).toEqual({ path: "/no-leading-slash" });

    const r3 = await request({ protocol: "http:", ...base, path: "/proto-host-port" } as any);
    expect(await r3.body!.json()).toEqual({ path: "/proto-host-port" });

    const r4 = await request({ protocol: "http:", ...base, pathname: "/pn", search: "?a=1" } as any);
    expect(await r4.body!.json()).toEqual({ path: "/pn?a=1" });
  });

  it("rejects a UrlObject that does not form a URL with InvalidArgumentError naming it", async () => {
    const err = await request({ path: "/no-origin" } as any).then(
      () => null,
      e => e,
    );
    expect(err).toBeInstanceOf(errors.InvalidArgumentError);
    expect({ name: err.name, code: err.code }).toEqual({ name: "InvalidArgumentError", code: "UND_ERR_INVALID_ARG" });
    expect(err.message).toContain('"//:80/no-origin"');
  });
});

describe("undici Client / Pool / Dispatcher.request (#14498, #21944)", () => {
  it("Client and Pool bind to their constructor origin", async () => {
    await using origin = Bun.serve({
      port: 0,
      fetch: async req =>
        Response.json({
          method: req.method,
          path: new URL(req.url).pathname,
          body: Buffer.from(await req.arrayBuffer()).toString("hex"),
        }),
    });
    const originUrl = `http://127.0.0.1:${origin.port}`;
    const hex = (s: string | Buffer) => Buffer.from(s).toString("hex");

    const client = new Client(originUrl);
    const r1 = await client.request({ path: "/from-client", method: "GET" });
    expect(r1.statusCode).toBe(200);
    expect(await r1.body!.json()).toEqual({ method: "GET", path: "/from-client", body: "" });

    // URL#href carries a trailing slash; must not turn into `//from-pool`.
    const pool = new Pool(new URL(originUrl));
    const r2 = await pool.request({ path: "/from-pool", method: "GET" });
    expect(await r2.body!.json()).toEqual({ method: "GET", path: "/from-pool", body: "" });

    // options.origin does not redirect a Client away from its bound origin.
    const r3 = await client.request({ origin: "http://127.0.0.1:1", path: "/bound", method: "GET" } as any);
    expect(await r3.body!.json()).toEqual({ method: "GET", path: "/bound", body: "" });

    // Readable bodies: string chunks, and binary chunks that are not valid UTF-8.
    const r4 = await client.request({ path: "/post", method: "POST", body: Readable.from(["hello ", "world"]) });
    expect(await r4.body!.json()).toEqual({ method: "POST", path: "/post", body: hex("hello world") });
    const bin = Buffer.from([0x00, 0xff, 0xfe, 0x80, 0xc3]);
    const r5 = await client.request({ path: "/post-bin", method: "POST", body: Readable.from([bin]) });
    expect(await r5.body!.json()).toEqual({ method: "POST", path: "/post-bin", body: hex(bin) });

    // RetryAgent forwards request() to the dispatcher it wraps, so it keeps
    // the Client's origin.
    const r6 = await new RetryAgent(client).request({ path: "/via-retry", method: "GET" });
    expect(await r6.body!.json()).toEqual({ method: "GET", path: "/via-retry", body: "" });

    await expect(client.close()).resolves.toBeUndefined();
    await expect(pool.destroy()).resolves.toBeUndefined();
  });

  it("Agent.request({origin, path}) and close()/destroy() work", async () => {
    await using origin = Bun.serve({
      port: 0,
      fetch: req => Response.json({ path: new URL(req.url).pathname }),
    });

    const originUrl = (s: { port: number }) => `http://127.0.0.1:${s.port}`;
    const agent = new Agent();
    const res = await agent.request({ origin: new URL(originUrl(origin)), path: "/agent", method: "GET" });
    expect(await res.body!.json()).toEqual({ path: "/agent" });

    // Callback form: (null, data) on success, (err, null) on failure.
    const ok = Promise.withResolvers<[unknown, any]>();
    expect(agent.request({ origin: originUrl(origin), path: "/cb", method: "GET" }, (e, d) => ok.resolve([e, d]))).toBe(
      undefined,
    );
    const [okErr, okData] = await ok.promise;
    expect(okErr).toBeNull();
    expect(await okData.body.json()).toEqual({ path: "/cb" });

    const failed = Promise.withResolvers<[unknown, unknown]>();
    agent.request({ origin: originUrl(origin), path: "/cb", method: "GET", body: "x" }, (e, d) =>
      failed.resolve([e, d]),
    );
    const [failErr, failData] = await failed.promise;
    expect((failErr as Error).message).toBe("Body not allowed for GET or HEAD requests");
    expect(failData).toBeNull();

    expect({ closed: agent.closed, destroyed: agent.destroyed }).toEqual({ closed: false, destroyed: false });
    await expect(agent.close()).resolves.toBeUndefined();
    expect({ closed: agent.closed, destroyed: agent.destroyed }).toEqual({ closed: true, destroyed: false });

    const other = new Agent();
    await expect(other.destroy()).resolves.toBeUndefined();
    expect(other.destroyed).toBe(true);

    const { promise, resolve } = Promise.withResolvers<void>();
    new Agent().close(resolve);
    await promise;
  });
});
