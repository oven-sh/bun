import { describe, expect, test } from "bun:test";
import { once } from "events";
import { bunEnv, bunExe, isWindows, tempDir, tls as tlsCert } from "harness";
import { lookup as dnsLookup } from "node:dns/promises";
import net from "node:net";
import { join } from "node:path";
import tls from "node:tls";
import { deadPort, proxyFreeEnv } from "../../bun/http/proxy-stress-helpers";

/** An https server that counts TLS connections, so tests can tell reuse from a new handshake. */
function connectionCountingServer() {
  let connections = 0;
  const sockets = new Set<net.Socket>();
  const server = tls.createServer({ key: tlsCert.key, cert: tlsCert.cert }, socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let buffered = "";
    socket.on("data", chunk => {
      buffered += chunk.toString("latin1");
      let end;
      while ((end = buffered.indexOf("\r\n\r\n")) !== -1) {
        buffered = buffered.slice(end + 4);
        socket.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: keep-alive\r\n\r\nok");
      }
    });
  });
  // Counted at accept: a client cannot finish a handshake before this has run.
  server.on("connection", () => connections++);
  return {
    server,
    get connections() {
      return connections;
    },
    async listen() {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      return (server.address() as net.AddressInfo).port;
    },
    close() {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}

describe("Bun.FetchContext", () => {
  test("owns its connection pool", async () => {
    const counting = connectionCountingServer();
    const port = await counting.listen();
    using a = new Bun.FetchContext({ tls: { ca: tlsCert.cert } });
    using b = new Bun.FetchContext({ tls: { ca: tlsCert.cert } });
    try {
      const url = `https://localhost:${port}/`;
      const get = async (init: BunFetchRequestInit) => (await fetch(url, init)).text();
      expect(await get({ context: a })).toBe("ok");
      expect(await get({ context: a })).toBe("ok");
      expect(counting.connections).toBe(1);
      // Same origin, same TLS options: still not a's socket.
      expect(await get({ context: b })).toBe("ok");
      expect(counting.connections).toBe(2);
      // Nor does plain fetch() take either.
      expect(await get({ tls: { ca: tlsCert.cert } })).toBe("ok");
      expect(counting.connections).toBe(3);
      expect(await get({ context: b })).toBe("ok");
      expect(await get({ context: a })).toBe("ok");
      expect(counting.connections).toBe(3);
    } finally {
      counting.close();
    }
  });

  test("close() closes the idle connections and the context stays usable", async () => {
    const counting = connectionCountingServer();
    const port = await counting.listen();
    const context = new Bun.FetchContext({ tls: { ca: tlsCert.cert } });
    try {
      const url = `https://localhost:${port}/`;
      const closed = Promise.withResolvers<void>();
      counting.server.once("secureConnection", socket => socket.once("close", () => closed.resolve()));
      expect(await (await fetch(url, { context })).text()).toBe("ok");
      context.close();
      await closed.promise;
      expect(await (await fetch(url, { context })).text()).toBe("ok");
      expect(counting.connections).toBe(2);
    } finally {
      context.close();
      counting.close();
    }
  });

  test("keepAlive: false closes each connection", async () => {
    const counting = connectionCountingServer();
    const port = await counting.listen();
    using context = new Bun.FetchContext({ tls: { ca: tlsCert.cert }, keepAlive: false });
    try {
      const url = `https://localhost:${port}/`;
      expect(await (await fetch(url, { context })).text()).toBe("ok");
      expect(await (await fetch(url, { context })).text()).toBe("ok");
      expect(counting.connections).toBe(2);
    } finally {
      counting.close();
    }
  });

  test("a request's keepalive: true wins over the context's keepAlive: false", async () => {
    const counting = connectionCountingServer();
    const port = await counting.listen();
    using context = new Bun.FetchContext({ tls: { ca: tlsCert.cert }, keepAlive: false });
    try {
      const url = `https://localhost:${port}/`;
      expect(await (await fetch(url, { context, keepalive: true })).text()).toBe("ok");
      expect(await (await fetch(url, { context, keepalive: true })).text()).toBe("ok");
      expect(counting.connections).toBe(1);
    } finally {
      counting.close();
    }
  });

  test("keepAlive.maxIdleSockets caps the idle connections of the context", async () => {
    const counting = connectionCountingServer();
    const port = await counting.listen();
    using context = new Bun.FetchContext({ tls: { ca: tlsCert.cert }, keepAlive: { maxIdleSockets: 1 } });
    try {
      const url = `https://localhost:${port}/`;
      // Two at once need two connections; only one may stay pooled afterwards.
      const closed = Promise.withResolvers<void>();
      counting.server.on("secureConnection", socket => socket.once("close", () => closed.resolve()));
      const bodies = await Promise.all(
        [fetch(url, { context }), fetch(url, { context })].map(p => p.then(r => r.text())),
      );
      expect(bodies).toEqual(["ok", "ok"]);
      expect(counting.connections).toBe(2);
      await closed.promise;
      expect(await (await fetch(url, { context })).text()).toBe("ok");
      expect(counting.connections).toBe(2);
    } finally {
      counting.close();
    }
  });

  test("tls options come from the context, and a request's tls replaces them as a whole", async () => {
    using server = Bun.serve({ port: 0, tls: tlsCert, fetch: () => new Response("secure") });
    using trusting = new Bun.FetchContext({ tls: { ca: tlsCert.cert } });
    using lax = new Bun.FetchContext({ tls: { rejectUnauthorized: false } });
    const url = `https://localhost:${server.port}/`;
    const outcome = (init: BunFetchRequestInit) =>
      fetch(url, { keepalive: false, ...init }).then(
        r => r.text(),
        e => e.code,
      );
    expect(await outcome({})).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
    expect(await outcome({ context: trusting })).toBe("secure");
    expect(await outcome({ context: lax })).toBe("secure");
    expect(await outcome({ context: lax, tls: { rejectUnauthorized: true } })).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
    expect(await outcome({ context: trusting, tls: { serverName: "wrong.example", ca: tlsCert.cert } })).toBe(
      "ERR_TLS_CERT_ALTNAME_INVALID",
    );
    // The context's `ca` is not merged into a request's own `tls`.
    expect(await outcome({ context: trusting, tls: {} })).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
    expect(await outcome({ context: trusting, tls: { serverName: "localhost" } })).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
  });

  test.skipIf(isWindows)("unix comes from the context", async () => {
    using dir = tempDir("fetch-context-unix", {});
    const path = join(String(dir), "context.sock");
    using server = Bun.serve({ unix: path, fetch: req => new Response(new URL(req.url).pathname) });
    using context = new Bun.FetchContext({ unix: path });
    expect(await (await fetch("http://anything.invalid/over-unix", { context })).text()).toBe("/over-unix");
  });

  test.skipIf(isWindows)("a request's unix or proxy replaces the other one named by the context", async () => {
    using dir = tempDir("fetch-context-unix-proxy", {});
    const path = join(String(dir), "context.sock");
    using overUnix = Bun.serve({ unix: path, fetch: req => new Response("unix " + req.url) });
    using proxy = Bun.serve({ port: 0, fetch: req => new Response("proxy " + req.url) });
    using proxied = new Bun.FetchContext({ proxy: `http://127.0.0.1:${proxy.port}` });
    using socketed = new Bun.FetchContext({ unix: path });
    const text = (init: BunFetchRequestInit) => fetch("http://origin.invalid/x", init).then(r => r.text());
    expect(await text({ context: proxied })).toBe("proxy http://origin.invalid/x");
    expect(await text({ context: proxied, unix: path })).toBe("unix http://origin.invalid/x");
    expect(await text({ context: socketed })).toBe("unix http://origin.invalid/x");
    expect(await text({ context: socketed, proxy: `http://127.0.0.1:${proxy.port}` })).toBe(
      "proxy http://origin.invalid/x",
    );
  });

  test("rejects invalid options", () => {
    const construct = (options: any) => () => new Bun.FetchContext(options);
    expect(construct(1)).toThrow("FetchContext: options must be an object");
    expect(construct({ tls: 1 })).toThrow("FetchContext: 'tls' must be an object");
    expect(construct({ keepAlive: 1 })).toThrow("FetchContext: 'keepAlive' must be a boolean or an object");
    expect(construct({ keepAlive: { idleTimeout: 0 } })).toThrow(
      "FetchContext: 'keepAlive.idleTimeout' must be a positive number",
    );
    expect(construct({ keepAlive: { maxIdleSockets: 1.5 } })).toThrow(
      'The "keepAlive.maxIdleSockets" property must be of type integer',
    );
    expect(construct({ keepAlive: { maxIdleSockets: 0 } })).toThrow(
      'The value of "keepAlive.maxIdleSockets" is out of range. It must be >= 1 and <= 65535. Received 0',
    );
    expect(construct({ lookup: "127.0.0.1" })).toThrow("lookup must be a function");
    expect(construct({ onStats: 1 })).toThrow("onStats must be a function");
    expect(construct({ proxy: "not a url" })).toThrow("fetch() proxy URL is invalid");
    expect(construct({ proxy: { url: "http://p", respectNoProxy: 1 } })).toThrow(
      'The "respectNoProxy" property must be of type boolean',
    );
    expect(construct({ unix: "/tmp/x.sock", proxy: "http://p" })).toThrow(
      "FetchContext: cannot use a proxy with a unix socket",
    );
    expect(construct({ unix: 1 })).toThrow("FetchContext: 'unix' must be a non-empty string");
  });

  test("null means absent for every option", async () => {
    using server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("plain") });
    using context = new Bun.FetchContext({
      tls: null,
      proxy: null,
      lookup: null,
      keepAlive: null,
      unix: null,
      onStats: null,
    } as any);
    expect(await (await fetch(server.url, { context })).text()).toBe("plain");
    expect(await (await fetch(server.url, { context: null, lookup: null, onStats: null } as any)).text()).toBe("plain");
    using empty = new Bun.FetchContext(null as any);
    expect(await (await fetch(server.url, { context: empty })).text()).toBe("plain");
  });

  test("fetch rejects a context that is not a FetchContext", async () => {
    expect(await fetch("http://localhost:1/", { context: {} as any }).catch(e => e.message)).toBe(
      "fetch: 'context' must be a Bun.FetchContext",
    );
  });
});

describe("proxy policy", () => {
  // Runs in a subprocess so the proxy environment is the test's alone.
  async function run(script: string, env: Record<string, string | undefined>) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: { ...bunEnv, ...proxyFreeEnv, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode };
  }

  function servers() {
    const origin = Bun.serve({ port: 0, fetch: () => new Response("origin") });
    // Answers every absolute-form request itself, so "proxy" in the output means the proxy was used.
    const proxy = Bun.serve({ port: 0, fetch: () => new Response("proxy") });
    return {
      origin,
      proxy,
      [Symbol.dispose]() {
        origin.stop(true);
        proxy.stop(true);
      },
    };
  }

  test.concurrent("proxy: false opts out of the environment proxy, per request and per context", async () => {
    using s = servers();
    const result = await run(
      `
      const url = "http://127.0.0.1:${s.origin.port}/";
      const text = init => fetch(url, { keepalive: false, ...init }).then(r => r.text());
      using direct = new Bun.FetchContext({ proxy: false });
      console.log(JSON.stringify({
        env: await text({}),
        requestFalse: await text({ proxy: false }),
        contextFalse: await text({ context: direct }),
        // undefined, null and "" keep meaning "inherit"
        undefinedInherits: await text({ proxy: undefined }),
        nullInherits: await text({ proxy: null }),
        emptyInherits: await text({ proxy: "" }),
      }));
      `,
      { HTTP_PROXY: `http://127.0.0.1:${s.proxy.port}` },
    );
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      env: "proxy",
      requestFalse: "origin",
      contextFalse: "origin",
      undefinedInherits: "proxy",
      nullInherits: "proxy",
      emptyInherits: "proxy",
    });
    expect(result.exitCode).toBe(0);
  });

  test.concurrent("respectNoProxy: false insists on the proxy over NO_PROXY", async () => {
    using s = servers();
    const proxyUrl = `http://127.0.0.1:${s.proxy.port}`;
    const result = await run(
      `
      const url = "http://127.0.0.1:${s.origin.port}/";
      const text = init => fetch(url, { keepalive: false, ...init }).then(r => r.text());
      using insisting = new Bun.FetchContext({ proxy: { url: "${proxyUrl}", respectNoProxy: false } });
      console.log(JSON.stringify({
        string: await text({ proxy: "${proxyUrl}" }),
        object: await text({ proxy: { url: "${proxyUrl}" } }),
        respected: await text({ proxy: { url: "${proxyUrl}", respectNoProxy: true } }),
        insisted: await text({ proxy: { url: "${proxyUrl}", respectNoProxy: false } }),
        context: await text({ context: insisting }),
        requestOverContext: await text({ context: insisting, proxy: false }),
      }));
      `,
      { NO_PROXY: "*" },
    );
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      string: "origin",
      object: "origin",
      respected: "origin",
      insisted: "proxy",
      context: "proxy",
      requestOverContext: "origin",
    });
    expect(result.exitCode).toBe(0);
  });
});

describe("lookup", () => {
  test("dials the returned address and keeps the URL's host for Host, SNI and the certificate", async () => {
    let servername: string | false | undefined;
    const hosts: (string | undefined)[] = [];
    const server = tls.createServer({ key: tlsCert.key, cert: tlsCert.cert }, socket => {
      servername = (socket as tls.TLSSocket & { servername?: string | false }).servername;
      socket.on("error", () => {});
      socket.once("data", chunk => {
        hosts.push(/^host: (.*)$/im.exec(chunk.toString())?.[1]);
        socket.end("HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\npinned");
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as net.AddressInfo).port;
    try {
      const seen: unknown[] = [];
      // `localhost` is in the certificate; the name below does not resolve at all.
      const response = await fetch(`https://localhost:${port}/`, {
        keepalive: false,
        tls: { ca: tlsCert.cert },
        lookup(hostname, options) {
          seen.push([hostname, options]);
          return "127.0.0.1";
        },
      });
      expect(await response.text()).toBe("pinned");
      expect(response.url).toBe(`https://localhost:${port}/`);
      expect(seen).toEqual([["localhost", { port }]]);
      expect({ servername, hosts }).toEqual({ servername: "localhost", hosts: [`localhost:${port}`] });

      // A name only `lookup` can resolve, verified against a certificate that does not list it.
      const mismatch = await fetch(`https://pinned.invalid:${port}/`, {
        keepalive: false,
        tls: { ca: tlsCert.cert },
        lookup: () => ({ address: "127.0.0.1", family: 4 }),
      }).then(
        r => r.status,
        e => e.code,
      );
      expect(mismatch).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
    } finally {
      server.close();
    }
  });

  test("accepts what dns.promises.lookup resolves to, including { all: true }", async () => {
    using server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: req => new Response(req.headers.get("host")) });
    const url = `http://name.invalid:${server.port}/`;
    for (const lookup of [
      async () => ({ address: "127.0.0.1", family: 4 }),
      async () => [
        { address: "127.0.0.1", family: 4 },
        { address: "10.255.255.1", family: 4 },
      ],
      () => ["127.0.0.1"],
      // A thenable that is not a native promise.
      () => ({ then: (resolve: (address: string) => void) => resolve("127.0.0.1") }),
      (hostname: string) => (hostname === "name.invalid" ? dnsLookup("localhost", { family: 4 }) : "0.0.0.0"),
    ]) {
      const response = await fetch(url, { keepalive: false, lookup });
      expect(await response.text()).toBe(`name.invalid:${server.port}`);
    }
  });

  test("runs again for the host a redirect leads to", async () => {
    using target = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("target") });
    using origin = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => Response.redirect(`http://second.invalid:${target.port}/`, 302),
    });
    const seen: string[] = [];
    const lookup = (hostname: string, { port }: { port: number }) => {
      seen.push(`${hostname}:${port}`);
      return "127.0.0.1";
    };
    const response = await fetch(`http://first.invalid:${origin.port}/`, { lookup });
    expect(await response.text()).toBe("target");
    expect(seen).toEqual([`first.invalid:${origin.port}`, `second.invalid:${target.port}`]);

    // A lookup that refuses the second host stops the chain before anything is dialed.
    let reachedTarget = false;
    using guarded = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch() {
        reachedTarget = true;
        return new Response("should not be reached");
      },
    });
    using redirector = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => Response.redirect(`http://internal.invalid:${guarded.port}/`, 302),
    });
    const refused = await fetch(`http://first.invalid:${redirector.port}/`, {
      lookup(hostname) {
        if (hostname === "internal.invalid") throw new Error("refusing to connect to internal.invalid");
        return "127.0.0.1";
      },
    }).then(
      r => r.status,
      e => e.message,
    );
    expect({ refused, reachedTarget }).toEqual({
      refused: "refusing to connect to internal.invalid",
      reachedTarget: false,
    });
  });

  test("a rejection, a throw or a non-address fails the request with that error", async () => {
    using server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("unreachable") });
    const url = `http://name.invalid:${server.port}/`;
    const outcome = (lookup: any) =>
      fetch(url, { lookup }).then(
        r => r.status,
        e => `${e.code ?? e.name}: ${e.message}`,
      );
    expect(await outcome(() => Promise.reject(new RangeError("no such host")))).toBe("RangeError: no such host");
    expect(await outcome(() => "not-an-address")).toBe("ERR_INVALID_IP_ADDRESS: Invalid IP address: not-an-address");
    expect(await outcome(() => undefined)).toBe("ERR_INVALID_IP_ADDRESS: fetch: 'lookup' must return an IP address");
    expect(await outcome(() => ({ address: 5 }))).toBe(
      "ERR_INVALID_IP_ADDRESS: fetch: 'lookup' must return an IP address",
    );
  });

  test("an abort while lookup is pending rejects the request and ignores the late answer", async () => {
    const paths: string[] = [];
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        paths.push(new URL(req.url).pathname);
        return new Response("served");
      },
    });
    const controller = new AbortController();
    const answer = Promise.withResolvers<string>();
    const asked = Promise.withResolvers<void>();
    const request = fetch(`http://name.invalid:${server.port}/aborted`, {
      signal: controller.signal,
      lookup() {
        asked.resolve();
        return answer.promise;
      },
    });
    await asked.promise;
    controller.abort();
    expect(await request.catch(e => e.name)).toBe("AbortError");
    answer.resolve("127.0.0.1");
    await answer.promise;
    // The HTTP thread handles the late answer before this later request, so
    // had it still dialed, /aborted would be in the list.
    expect(await (await fetch(`http://127.0.0.1:${server.port}/after`, { keepalive: false })).text()).toBe("served");
    expect(paths).toEqual(["/after"]);
  });

  test("the address lookup returned is part of the pool key", async () => {
    const counting = connectionCountingServer();
    const port = await counting.listen();
    using context = new Bun.FetchContext({ tls: { ca: tlsCert.cert } });
    const lookup = () => "127.0.0.1";
    try {
      const url = `https://localhost:${port}/`;
      expect(await (await fetch(url, { context })).text()).toBe("ok");
      expect(counting.connections).toBe(1);
      // A pinned request does not take the connection an unpinned one left.
      expect(await (await fetch(url, { context, lookup })).text()).toBe("ok");
      expect(counting.connections).toBe(2);
      // Each kind reuses its own.
      expect(await (await fetch(url, { context, lookup })).text()).toBe("ok");
      expect(await (await fetch(url, { context })).text()).toBe("ok");
      expect(counting.connections).toBe(2);
    } finally {
      counting.close();
    }
  });

  test("is refused together with protocol http2", async () => {
    expect(
      await fetch("https://localhost:1/", { protocol: "http2", lookup: () => "127.0.0.1" }).catch(e => e.message),
    ).toBe(`fetch: 'lookup' is only supported with protocol "http1.1"`);
  });
});

describe("onStats", () => {
  test("reports the connection of a completed request, and reuse on the next one", async () => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        return new Response(String((await req.arrayBuffer()).byteLength));
      },
    });
    using context = new Bun.FetchContext({});
    const body = Buffer.alloc(100_000, "b");
    const collected: Bun.FetchConnectionStats[] = [];
    for (let i = 0; i < 2; i++) {
      const response = await fetch(server.url, { method: "POST", body, context, onStats: s => collected.push(s) });
      expect(await response.text()).toBe("100000");
    }
    expect(collected.length).toBe(2);
    const [first, second] = collected;
    expect(first).toEqual({
      bytesWritten: expect.any(Number),
      requestBodyBytesSent: body.length,
      responseStarted: true,
      socketReused: false,
      remoteAddress: "127.0.0.1",
      remotePort: server.port,
      remoteFamily: "IPv4",
    });
    expect(first.bytesWritten).toBeGreaterThan(body.length);
    expect(first.bytesWritten).toBeLessThan(body.length + 1024);
    expect(second).toEqual({ ...first, socketReused: true });
  });

  test("runs before the rejection and shows an upload that never left", async () => {
    // Accepts the connection, reads nothing, and resets it once the client is mid-upload.
    const sockets: net.Socket[] = [];
    const accepted = Promise.withResolvers<void>();
    const server = net.createServer(socket => {
      sockets.push(socket);
      socket.on("error", () => {});
      socket.pause();
      accepted.resolve();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as net.AddressInfo).port;
    try {
      // Far more than the socket buffers hold, so the write has to stall.
      const body = Buffer.alloc(64 * 1024 * 1024, "u");
      const order: string[] = [];
      let stats: Bun.FetchConnectionStats | undefined;
      const controller = new AbortController();
      const request = fetch(`http://127.0.0.1:${port}/upload`, {
        method: "POST",
        body,
        signal: controller.signal,
        onStats(s) {
          order.push("stats");
          stats = s;
        },
      }).catch(e => {
        order.push("rejected");
        return e;
      });
      await Promise.race([accepted.promise, request.then(e => Promise.reject(e))]);
      controller.abort();
      const error = await request;
      expect(error.name).toBe("AbortError");
      expect(order).toEqual(["stats", "rejected"]);
      expect(stats).toBeDefined();
      expect(stats!.responseStarted).toBe(false);
      expect(stats!.socketReused).toBe(false);
      // Windows' send() accepts the whole buffer at once.
      expect(stats!.requestBodyBytesSent)[isWindows ? "toBeLessThanOrEqual" : "toBeLessThan"](body.length);
      expect(stats!.bytesWritten).toBeGreaterThanOrEqual(stats!.requestBodyBytesSent);
      expect(stats!.remoteAddress).toBe("127.0.0.1");
    } finally {
      for (const socket of sockets) socket.destroy();
      server.close();
    }
  });

  test("reports a connection that was never established", async () => {
    using dead = await deadPort();
    let stats: Bun.FetchConnectionStats | undefined;
    const error = await fetch(`http://127.0.0.1:${dead.port}/`, { onStats: s => (stats = s) }).catch(e => e);
    expect(error.code).toBe("ECONNREFUSED");
    expect(stats).toEqual({
      bytesWritten: 0,
      requestBodyBytesSent: 0,
      responseStarted: false,
      socketReused: false,
      remoteAddress: null,
      remotePort: null,
      remoteFamily: null,
    });
  });

  test("may touch the response body of a request that resolved earlier", async () => {
    const release = Promise.withResolvers<void>();
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () =>
        new Response(
          new ReadableStream({
            type: "direct",
            async pull(controller: any) {
              controller.write("first ");
              await controller.flush();
              await release.promise;
              controller.write("second");
              controller.close();
            },
          } as any),
        ),
    });
    const reported = Promise.withResolvers<boolean>();
    const response: Response = await fetch(server.url, {
      onStats: () => reported.resolve(response.body instanceof ReadableStream),
    });
    // The head is here and the body is not: onStats runs with the final chunk.
    release.resolve();
    expect(await reported.promise).toBe(true);
    expect(await response.text()).toBe("first second");
  });

  test("comes from the context, and a throwing callback does not break the request", async () => {
    using server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("fine") });
    let fromContext = 0;
    using context = new Bun.FetchContext({ onStats: () => void fromContext++ });
    expect(await (await fetch(server.url, { context })).text()).toBe("fine");
    expect(fromContext).toBe(1);

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        process.on("uncaughtException", e => console.log("uncaught:", e.message));
        const r = await fetch("${server.url}", { onStats() { throw new Error("from onStats"); } });
        console.log(await r.text());
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim().split("\n"), stderr }).toEqual({
      stdout: ["uncaught: from onStats", "fine"],
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });
});
