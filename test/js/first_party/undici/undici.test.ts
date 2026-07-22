import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { once } from "node:events";
import net from "node:net";
import {
  Agent,
  Client,
  EnvHttpProxyAgent,
  getGlobalDispatcher,
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

// A minimal HTTP proxy that records every request line it sees. Supports both
// absolute-form GET (for http:// targets) and CONNECT (for tunneled targets).
async function recordingProxy() {
  const seen: string[] = [];
  const seenAuth: string[] = [];
  const server = net.createServer(socket => {
    socket.once("data", data => {
      const head = data.toString("latin1");
      const [line, ...rest] = head.split("\r\n");
      seen.push(line);
      const auth = rest.find(h => /^proxy-authorization:/i.test(h));
      if (auth) seenAuth.push(auth.slice(auth.indexOf(":") + 1).trim());
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
    seenAuth,
    url: `http://127.0.0.1:${addr.port}`,
    [Symbol.asyncDispose]: () => new Promise<void>(r => server.close(() => r())),
  };
}

describe("undici ProxyAgent / dispatcher", () => {
  // These tests call undici.fetch()/request() in-process against a localhost
  // proxy. An ambient NO_PROXY/HTTP_PROXY in the environment would route
  // localhost requests differently. Clear them for this block; assign "" rather
  // than `delete` so the native getenv cache is updated.
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

  it("routes fetch() through the proxy when a ProxyAgent dispatcher is provided", async () => {
    const originSeen: string[] = [];
    await using origin = Bun.serve({
      port: 0,
      fetch: req => {
        originSeen.push(new URL(req.url).pathname);
        return new Response("ORIGIN");
      },
    });
    await using proxy = await recordingProxy();

    const agent = new ProxyAgent(proxy.url);
    // ProxyAgent must not be an empty stub: dispatch/close/request exist.
    expect(typeof agent.dispatch).toBe("function");
    expect(typeof agent.close).toBe("function");

    const res = await undiciFetch(`http://127.0.0.1:${origin.port}/via-dispatcher`, { dispatcher: agent });
    expect(await res.text()).toBe("PROXIED");

    // The egress-policy contract: the request must have reached the proxy, not
    // the origin directly. A silent direct connection here is a proxy bypass.
    expect(proxy.seen.length).toBe(1);
    expect(proxy.seen[0]).toContain("/via-dispatcher");
    expect(originSeen).toEqual([]);
    await agent.close();
  });

  it("routes request() through a ProxyAgent dispatcher and forwards token as proxy-authorization", async () => {
    const originSeen: string[] = [];
    await using origin = Bun.serve({
      port: 0,
      fetch: req => {
        originSeen.push(new URL(req.url).pathname);
        return new Response("ORIGIN");
      },
    });
    await using proxy = await recordingProxy();

    const agent = new ProxyAgent({ uri: proxy.url, token: "Bearer secret-token" });
    const { statusCode, body } = await request(`http://127.0.0.1:${origin.port}/req`, { dispatcher: agent });
    expect(statusCode).toBe(200);
    expect(await body!.text()).toBe("PROXIED");

    expect(proxy.seen.length).toBe(1);
    expect(proxy.seen[0]).toContain("/req");
    expect(proxy.seenAuth).toEqual(["Bearer secret-token"]);
    expect(originSeen).toEqual([]);
  });

  it("setGlobalDispatcher(ProxyAgent) applies to undici.fetch and undici.request without an explicit dispatcher", async () => {
    const originSeen: string[] = [];
    await using origin = Bun.serve({
      port: 0,
      fetch: req => {
        originSeen.push(new URL(req.url).pathname);
        return new Response("ORIGIN");
      },
    });
    await using proxy = await recordingProxy();

    const previous = getGlobalDispatcher();
    try {
      setGlobalDispatcher(new ProxyAgent(proxy.url));

      const res = await undiciFetch(`http://127.0.0.1:${origin.port}/global-fetch`);
      expect(await res.text()).toBe("PROXIED");

      const { body } = await request(`http://127.0.0.1:${origin.port}/global-request`);
      expect(await body!.text()).toBe("PROXIED");

      expect(proxy.seen.length).toBe(2);
      expect(originSeen).toEqual([]);
    } finally {
      setGlobalDispatcher(previous);
    }
  });

  it("RetryAgent wrapping a ProxyAgent still proxies", async () => {
    await using origin = Bun.serve({ port: 0, fetch: () => new Response("ORIGIN") });
    await using proxy = await recordingProxy();

    const agent = new RetryAgent(new ProxyAgent(proxy.url));
    const res = await undiciFetch(`http://127.0.0.1:${origin.port}/retry`, { dispatcher: agent });
    expect(await res.text()).toBe("PROXIED");
    expect(proxy.seen.length).toBe(1);
  });

  it("dispatcher.request() on a ProxyAgent proxies", async () => {
    await using origin = Bun.serve({ port: 0, fetch: () => new Response("ORIGIN") });
    await using proxy = await recordingProxy();

    const agent = new ProxyAgent(proxy.url);
    const { body } = await agent.request({ origin: `http://127.0.0.1:${origin.port}`, path: "/self", method: "GET" });
    expect(await body!.text()).toBe("PROXIED");
    expect(proxy.seen.length).toBe(1);
  });

  it("EnvHttpProxyAgent selects proxy by protocol and honours noProxy", async () => {
    await using origin = Bun.serve({ port: 0, fetch: () => new Response("ORIGIN") });
    await using proxy = await recordingProxy();

    const agent = new EnvHttpProxyAgent({ httpProxy: proxy.url, httpsProxy: proxy.url, noProxy: "example.com" });
    const res = await undiciFetch(`http://127.0.0.1:${origin.port}/env`, { dispatcher: agent });
    expect(await res.text()).toBe("PROXIED");
    expect(proxy.seen.length).toBe(1);

    // noProxy match goes direct.
    await using origin2 = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response("DIRECT"),
    });
    const agent2 = new EnvHttpProxyAgent({
      httpProxy: proxy.url,
      noProxy: `127.0.0.1:${origin2.port}`,
    });
    const res2 = await undiciFetch(`http://127.0.0.1:${origin2.port}/noproxy`, { dispatcher: agent2 });
    expect(await res2.text()).toBe("DIRECT");
    // Proxy must not have seen the noProxy request.
    expect(proxy.seen.length).toBe(1);
  });

  it("fetch(Request, {dispatcher}) resolves proxy from Request.url", async () => {
    await using origin = Bun.serve({ port: 0, fetch: () => new Response("ORIGIN") });
    await using proxy = await recordingProxy();

    // With ProxyAgent the target URL doesn't matter for routing, so this also
    // covers the basic "Request as first arg proxies" case.
    const res = await undiciFetch(new Request(`http://127.0.0.1:${origin.port}/req-obj`), {
      dispatcher: new ProxyAgent(proxy.url),
    });
    expect(await res.text()).toBe("PROXIED");
    expect(proxy.seen.length).toBe(1);

    // EnvHttpProxyAgent inspects the target URL; a Request has no `.protocol`
    // so the wrapper must extract `Request.url` for NO_PROXY to apply.
    const agent = new EnvHttpProxyAgent({ httpProxy: proxy.url, noProxy: `127.0.0.1:${origin.port}` });
    const res2 = await undiciFetch(new Request(`http://127.0.0.1:${origin.port}/req-noproxy`), { dispatcher: agent });
    expect(await res2.text()).toBe("ORIGIN");
    // Proxy must not have seen the noProxy'd Request.
    expect(proxy.seen.length).toBe(1);
  });

  it("Agent dispatcher means direct (no proxy) even when a global ProxyAgent is set", async () => {
    const originSeen: string[] = [];
    await using origin = Bun.serve({
      port: 0,
      fetch: req => {
        originSeen.push(new URL(req.url).pathname);
        return new Response("ORIGIN");
      },
    });
    await using proxy = await recordingProxy();

    const previous = getGlobalDispatcher();
    try {
      setGlobalDispatcher(new ProxyAgent(proxy.url));
      const res = await undiciFetch(`http://127.0.0.1:${origin.port}/direct`, { dispatcher: new Agent() });
      expect(await res.text()).toBe("ORIGIN");
      expect(originSeen).toEqual(["/direct"]);
      expect(proxy.seen).toEqual([]);
    } finally {
      setGlobalDispatcher(previous);
    }
  });

  it("ProxyAgent rejects invalid constructor arguments", () => {
    expect(() => new (ProxyAgent as any)()).toThrow();
    expect(() => new (ProxyAgent as any)({})).toThrow();
    expect(() => new (ProxyAgent as any)(123)).toThrow();
  });

  it("Client/Pool store constructor origin and close()/destroy() resolve (#14498, #21944, #7920)", async () => {
    await using origin = Bun.serve({
      port: 0,
      fetch: req => Response.json({ path: new URL(req.url).pathname }),
    });

    const client = new Client(`http://127.0.0.1:${origin.port}`);
    const { statusCode, body } = await client.request({ path: "/from-client", method: "GET" });
    expect(statusCode).toBe(200);
    expect(await body!.json()).toEqual({ path: "/from-client" });

    const pool = new Pool(`http://127.0.0.1:${origin.port}`);
    const r2 = await pool.request({ path: "/from-pool", method: "GET" });
    expect(await r2.body!.json()).toEqual({ path: "/from-pool" });

    await expect(new Agent().close()).resolves.toBeUndefined();
    await expect(client.close()).resolves.toBeUndefined();
    await expect(pool.destroy()).resolves.toBeUndefined();
  });
});
