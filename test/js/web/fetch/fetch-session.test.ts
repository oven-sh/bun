import { describe, expect, test } from "bun:test";
import { once } from "events";
import { bunEnv, bunExe, isIPv6, isWindows, tempDir, tls as tlsCert } from "harness";
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

/** A keep-alive http server whose `closed` settles when its first connection goes away. */
async function closeObservingServer() {
  const closed = Promise.withResolvers<void>();
  const server = net.createServer(socket => {
    socket.on("error", () => {});
    socket.on("close", () => closed.resolve());
    socket.on("data", () => socket.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok"));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    url: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}/`,
    closed: closed.promise,
    [Symbol.dispose]() {
      server.close();
    },
  };
}

describe("Bun.FetchSession", () => {
  test("owns its connection pool", async () => {
    const counting = connectionCountingServer();
    const port = await counting.listen();
    using a = new Bun.FetchSession({ tls: { ca: tlsCert.cert } });
    using b = new Bun.FetchSession({ tls: { ca: tlsCert.cert } });
    try {
      const url = `https://localhost:${port}/`;
      const get = async (init: BunFetchRequestInit) => (await fetch(url, init)).text();
      expect(await get({ session: a })).toBe("ok");
      expect(await get({ session: a })).toBe("ok");
      expect(counting.connections).toBe(1);
      // Same origin, same TLS options: still not a's socket.
      expect(await get({ session: b })).toBe("ok");
      expect(counting.connections).toBe(2);
      // Nor does plain fetch() take either.
      expect(await get({ tls: { ca: tlsCert.cert } })).toBe("ok");
      expect(counting.connections).toBe(3);
      expect(await get({ session: b })).toBe("ok");
      expect(await get({ session: a })).toBe("ok");
      expect(counting.connections).toBe(3);
    } finally {
      counting.close();
    }
  });

  test("close() closes the idle connections and the session stays usable", async () => {
    const counting = connectionCountingServer();
    const port = await counting.listen();
    const session = new Bun.FetchSession({ tls: { ca: tlsCert.cert } });
    try {
      const url = `https://localhost:${port}/`;
      const closed = Promise.withResolvers<void>();
      counting.server.once("secureConnection", socket => socket.once("close", () => closed.resolve()));
      expect(await (await fetch(url, { session })).text()).toBe("ok");
      session.close();
      await closed.promise;
      expect(await (await fetch(url, { session })).text()).toBe("ok");
      expect(counting.connections).toBe(2);
    } finally {
      session.close();
      counting.close();
    }
  });

  test("keepAlive: false closes each connection", async () => {
    const counting = connectionCountingServer();
    const port = await counting.listen();
    using session = new Bun.FetchSession({ tls: { ca: tlsCert.cert }, keepAlive: false });
    try {
      const url = `https://localhost:${port}/`;
      expect(await (await fetch(url, { session })).text()).toBe("ok");
      expect(await (await fetch(url, { session })).text()).toBe("ok");
      expect(counting.connections).toBe(2);
    } finally {
      counting.close();
    }
  });

  test("a request's keepalive: true wins over the session's keepAlive: false", async () => {
    const counting = connectionCountingServer();
    const port = await counting.listen();
    using session = new Bun.FetchSession({ tls: { ca: tlsCert.cert }, keepAlive: false });
    try {
      const url = `https://localhost:${port}/`;
      expect(await (await fetch(url, { session, keepalive: true })).text()).toBe("ok");
      expect(await (await fetch(url, { session, keepalive: true })).text()).toBe("ok");
      expect(counting.connections).toBe(1);
    } finally {
      counting.close();
    }
  });

  test("keepAlive.maxIdleSockets caps the idle connections of the session", async () => {
    const counting = connectionCountingServer();
    const port = await counting.listen();
    using session = new Bun.FetchSession({ tls: { ca: tlsCert.cert }, keepAlive: { maxIdleSockets: 1 } });
    try {
      const url = `https://localhost:${port}/`;
      // Two at once need two connections; only one may stay pooled afterwards.
      const closed = Promise.withResolvers<void>();
      counting.server.on("secureConnection", socket => socket.once("close", () => closed.resolve()));
      const bodies = await Promise.all(
        [fetch(url, { session }), fetch(url, { session })].map(p => p.then(r => r.text())),
      );
      expect(bodies).toEqual(["ok", "ok"]);
      expect(counting.connections).toBe(2);
      await closed.promise;
      expect(await (await fetch(url, { session })).text()).toBe("ok");
      expect(counting.connections).toBe(2);
    } finally {
      counting.close();
    }
  });

  // The socket timer sweeps every 4 seconds, so this takes two sweeps; it runs
  // alongside the tests below.
  test.concurrent(
    "keepAlive.idleTimeout closes a connection that sat idle for that long",
    async () => {
      using server = await closeObservingServer();
      using session = new Bun.FetchSession({ keepAlive: { idleTimeout: 1 } });
      expect(await (await fetch(server.url, { session })).text()).toBe("ok");
      // The client closes it; nothing else in this test would.
      await server.closed;
    },
    20_000,
  );

  test.concurrent("collecting a session closes its idle connections", async () => {
    using server = await closeObservingServer();
    await (async () => {
      const session = new Bun.FetchSession();
      expect(await (await fetch(server.url, { session })).text()).toBe("ok");
    })();
    let done = false;
    server.closed.then(() => (done = true));
    for (let i = 0; i < 10 && !done; i++) {
      Bun.gc(true);
      await new Promise(resolve => setImmediate(resolve));
    }
    // The close crosses two threads after the collection; give it until a
    // deadline, and fail with a message instead of hanging.
    for (const deadline = Date.now() + 5000; !done && Date.now() < deadline; ) {
      await new Promise(resolve => setImmediate(resolve));
    }
    expect(done).toBe(true);
  });

  test.concurrent("a session the init object drops while fetch() reads the rest of it stays alive", async () => {
    using server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("ok") });
    // `session` is a property of init, not an argument: a getter read after it
    // can drop the last reference and collect.
    for (let i = 0; i < 20; i++) {
      const init = {
        session: new Bun.FetchSession(),
        get signal() {
          delete (this as any).session;
          Bun.gc(true);
          return undefined;
        },
      };
      expect(await (await fetch(server.url, init)).text()).toBe("ok");
    }
  });

  test.concurrent(
    "a request with its own tls does not reuse a connection the session's checkServerIdentity approved",
    async () => {
      const server = connectionCountingServer();
      const port = await server.listen();
      try {
        let approved = 0;
        using session = new Bun.FetchSession({
          tls: { ca: tlsCert.cert, checkServerIdentity: () => void approved++ },
        });
        const url = `https://localhost:${port}/`;
        expect(await (await fetch(url, { session })).text()).toBe("ok");
        expect(await (await fetch(url, { session })).text()).toBe("ok");
        expect([approved, server.connections]).toEqual([1, 1]);
        // Its `tls` replaces the session's, callback included: the session's
        // verdict does not cover this request.
        expect(await (await fetch(url, { session, tls: { ca: tlsCert.cert } })).text()).toBe("ok");
        expect([approved, server.connections]).toEqual([1, 2]);
      } finally {
        server.close();
      }
    },
  );

  test.concurrent("concurrent requests of a session share its pool afterwards", async () => {
    const counting = connectionCountingServer();
    const port = await counting.listen();
    using session = new Bun.FetchSession({ tls: { ca: tlsCert.cert } });
    try {
      const url = `https://localhost:${port}/`;
      const burst = () => Promise.all(Array.from({ length: 8 }, () => fetch(url, { session }).then(r => r.text())));
      expect(await burst()).toEqual(Array(8).fill("ok"));
      const opened = counting.connections;
      expect(opened).toBeGreaterThanOrEqual(1);
      expect(opened).toBeLessThanOrEqual(8);
      // They are parked now; the next requests need no new connection.
      for (let i = 0; i < 3; i++) expect(await (await fetch(url, { session })).text()).toBe("ok");
      expect(counting.connections).toBe(opened);
    } finally {
      counting.close();
    }
  });

  test.concurrent("a redirect stays in the session's pool", async () => {
    const ports: number[] = [];
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req, srv) {
        ports.push(srv.requestIP(req)!.port);
        return new URL(req.url).pathname === "/a" ? Response.redirect("/b", 302) : new Response("b");
      },
    });
    using session = new Bun.FetchSession();
    expect(await (await fetch(`${server.url}a`, { session })).text()).toBe("b");
    expect(await (await fetch(`${server.url}b`, { session })).text()).toBe("b");
    // One client port: /a, the /b it redirected to, and the second /b shared a connection.
    expect(new Set(ports).size).toBe(1);
    expect(ports.length).toBe(3);
  });

  test("tls options come from the session, and a request's tls replaces them as a whole", async () => {
    using server = Bun.serve({ port: 0, tls: tlsCert, fetch: () => new Response("secure") });
    using trusting = new Bun.FetchSession({ tls: { ca: tlsCert.cert } });
    using lax = new Bun.FetchSession({ tls: { rejectUnauthorized: false } });
    const url = `https://localhost:${server.port}/`;
    const outcome = (init: BunFetchRequestInit) =>
      fetch(url, { keepalive: false, ...init }).then(
        r => r.text(),
        e => e.code,
      );
    expect(await outcome({})).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
    expect(await outcome({ session: trusting })).toBe("secure");
    expect(await outcome({ session: lax })).toBe("secure");
    expect(await outcome({ session: lax, tls: { rejectUnauthorized: true } })).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
    expect(await outcome({ session: trusting, tls: { serverName: "wrong.example", ca: tlsCert.cert } })).toBe(
      "ERR_TLS_CERT_ALTNAME_INVALID",
    );
    // The session's `ca` is not merged into a request's own `tls`.
    expect(await outcome({ session: trusting, tls: {} })).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
    expect(await outcome({ session: trusting, tls: { serverName: "localhost" } })).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
  });

  test.skipIf(isWindows)("unix comes from the session", async () => {
    using dir = tempDir("fetch-session-unix", {});
    const path = join(String(dir), "session.sock");
    using server = Bun.serve({ unix: path, fetch: req => new Response(new URL(req.url).pathname) });
    using session = new Bun.FetchSession({ unix: path });
    expect(await (await fetch("http://anything.invalid/over-unix", { session })).text()).toBe("/over-unix");
  });

  test.skipIf(isWindows)("a request's unix or proxy replaces the other one named by the session", async () => {
    using dir = tempDir("fetch-session-unix-proxy", {});
    const path = join(String(dir), "session.sock");
    using overUnix = Bun.serve({ unix: path, fetch: req => new Response("unix " + req.url) });
    using proxy = Bun.serve({ port: 0, fetch: req => new Response("proxy " + req.url) });
    using proxied = new Bun.FetchSession({ proxy: `http://127.0.0.1:${proxy.port}` });
    using socketed = new Bun.FetchSession({ unix: path });
    const text = (init: BunFetchRequestInit) => fetch("http://origin.invalid/x", init).then(r => r.text());
    expect(await text({ session: proxied })).toBe("proxy http://origin.invalid/x");
    expect(await text({ session: proxied, unix: path })).toBe("unix http://origin.invalid/x");
    expect(await text({ session: socketed })).toBe("unix http://origin.invalid/x");
    expect(await text({ session: socketed, proxy: `http://127.0.0.1:${proxy.port}` })).toBe(
      "proxy http://origin.invalid/x",
    );
  });

  test("rejects invalid options", () => {
    const construct = (options: any) => () => new Bun.FetchSession(options);
    expect(construct(1)).toThrow("FetchSession: options must be an object");
    expect(construct({ tls: 1 })).toThrow("FetchSession: 'tls' must be an object");
    expect(construct({ keepAlive: 1 })).toThrow("FetchSession: 'keepAlive' must be a boolean or an object");
    expect(construct({ keepAlive: { idleTimeout: 0 } })).toThrow(
      "FetchSession: 'keepAlive.idleTimeout' must be a positive number",
    );
    expect(construct({ keepAlive: { maxIdleSockets: 1.5 } })).toThrow(
      'The "keepAlive.maxIdleSockets" property must be of type integer',
    );
    expect(construct({ keepAlive: { maxIdleSockets: 0 } })).toThrow(
      'The value of "keepAlive.maxIdleSockets" is out of range. It must be >= 1 and <= 65535. Received 0',
    );
    expect(construct({ proxy: "not a url" })).toThrow("fetch() proxy URL is invalid");
    expect(construct({ proxy: { url: "http://p", respectNoProxy: 1 } })).toThrow(
      'The "respectNoProxy" property must be of type boolean',
    );
    expect(construct({ unix: "/tmp/x.sock", proxy: "http://p" })).toThrow(
      "FetchSession: cannot use a proxy with a unix socket",
    );
    expect(construct({ unix: 1 })).toThrow("FetchSession: 'unix' must be a non-empty string");
  });

  test("null means absent for every option", async () => {
    using server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("plain") });
    using session = new Bun.FetchSession({
      tls: null,
      proxy: null,
      keepAlive: null,
      unix: null,
    } as any);
    expect(await (await fetch(server.url, { session })).text()).toBe("plain");
    expect(await (await fetch(server.url, { session: null } as any)).text()).toBe("plain");
    using empty = new Bun.FetchSession(null as any);
    expect(await (await fetch(server.url, { session: empty })).text()).toBe("plain");
  });

  test("fetch rejects a session that is not a FetchSession", async () => {
    expect(await fetch("http://localhost:1/", { session: {} as any }).catch(e => e.message)).toBe(
      "fetch: 'session' must be a Bun.FetchSession",
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

  test.concurrent("proxy: false opts out of the environment proxy, per request and per session", async () => {
    using s = servers();
    const result = await run(
      `
      const url = "http://127.0.0.1:${s.origin.port}/";
      const text = init => fetch(url, { keepalive: false, ...init }).then(r => r.text());
      using direct = new Bun.FetchSession({ proxy: false });
      console.log(JSON.stringify({
        env: await text({}),
        requestFalse: await text({ proxy: false }),
        sessionFalse: await text({ session: direct }),
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
      sessionFalse: "origin",
      undefinedInherits: "proxy",
      nullInherits: "proxy",
      emptyInherits: "proxy",
    });
    expect(result.exitCode).toBe(0);
  });

  test.concurrent("proxy: false is part of what a connection is shared by, and covers HTTPS_PROXY too", async () => {
    using s = servers();
    using secure = Bun.serve({ port: 0, tls: tlsCert, fetch: () => new Response("secure origin") });
    using dead = await deadPort();
    const result = await run(
      `
      const text = (url, init) => fetch(url, init).then(r => r.text(), e => e.code);
      const plain = "http://127.0.0.1:${s.origin.port}/";
      const secure = "https://127.0.0.1:${secure.port}/";
      const tls = { ca: ${JSON.stringify(tlsCert.cert)} };
      console.log(JSON.stringify([
        // Keep-alive is on: the direct connection must not serve the proxied request, nor the other way around.
        await text(plain, { proxy: false }),
        await text(plain, {}),
        await text(plain, { proxy: false }),
        await text(plain, {}),
        await text(secure, { tls }),
        await text(secure, { tls, proxy: false }),
      ]));
      `,
      { HTTP_PROXY: `http://127.0.0.1:${s.proxy.port}`, HTTPS_PROXY: `http://127.0.0.1:${dead.port}` },
    );
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual(["origin", "proxy", "origin", "proxy", "ECONNREFUSED", "secure origin"]);
    expect(result.exitCode).toBe(0);
  });

  // fetch.preconnect() is a no-op on Windows.
  test.concurrent.todoIf(isWindows)("fetch.preconnect does not dial an origin the environment proxies", async () => {
    using proxy = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("proxy") });
    // The origin lives in the subprocess, which has to see its connections.
    const result = await run(
      `
      const net = require("node:net");
      const { once } = require("node:events");
      let connections = 0;
      const origin = net.createServer(socket => {
        connections++;
        socket.on("error", () => {});
        socket.on("data", () => socket.write("HTTP/1.1 200 OK\\r\\nContent-Length: 6\\r\\n\\r\\norigin"));
      });
      origin.listen(0, "127.0.0.1");
      await once(origin, "listening");
      const url = "http://127.0.0.1:" + origin.address().port + "/";
      const BARRIER = "http://127.0.0.1:${proxy.port}/";

      fetch.preconnect(url);
      const proxied = await (await fetch(url)).text();
      const afterProxied = connections;

      // Exempt from the proxy, the preconnected socket is there to use.
      process.env.NO_PROXY = "127.0.0.1";
      const accepted = once(origin, "connection");
      fetch.preconnect(url);
      await accepted;
      // The client parks the socket when its HTTP thread sees the connect
      // complete, which has no JS signal. A request that goes out and comes
      // back afterwards has been through that thread's event loop.
      await (await fetch(BARRIER, { proxy: false })).text();
      const direct = await (await fetch(url)).text();
      console.log(JSON.stringify({ proxied, afterProxied, direct, connections }));
      // The pooled connection would keep the origin, and so the process, open.
      process.exit(0);
      `,
      { HTTP_PROXY: `http://127.0.0.1:${proxy.port}` },
    );
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      proxied: "proxy",
      afterProxied: 0,
      direct: "origin",
      // One connection: the request rode the preconnected socket.
      connections: 1,
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
      using insisting = new Bun.FetchSession({ proxy: { url: "${proxyUrl}", respectNoProxy: false } });
      console.log(JSON.stringify({
        string: await text({ proxy: "${proxyUrl}" }),
        object: await text({ proxy: { url: "${proxyUrl}" } }),
        respected: await text({ proxy: { url: "${proxyUrl}", respectNoProxy: true } }),
        insisted: await text({ proxy: { url: "${proxyUrl}", respectNoProxy: false } }),
        session: await text({ session: insisting }),
        requestOverSession: await text({ session: insisting, proxy: false }),
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
      session: "proxy",
      requestOverSession: "origin",
    });
    expect(result.exitCode).toBe(0);
  });
});

// Resolve and vet a name yourself, then: the address in the URL, the name in
// `Host` and `tls.serverName`, and `proxy: false` so that the environment proxy
// is not judged against the address.
describe("pinning a request to an address", () => {
  /** Answers every request with what it saw. `sni` is `false` when the client sent none. */
  async function observingServer(hostname: string, secure: boolean) {
    const respond = (socket: net.Socket, sni: string | false | null) => {
      socket.on("error", () => {});
      socket.on("data", chunk => {
        const host = /^host: (.*)$/im.exec(chunk.toString())?.[1];
        const body = JSON.stringify({ sni, host });
        socket.write(`HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
      });
    };
    const server = secure
      ? tls.createServer({ key: tlsCert.key, cert: tlsCert.cert }, socket =>
          respond(socket, socket.servername ?? false),
        )
      : net.createServer(socket => respond(socket, null));
    server.listen(0, hostname);
    await once(server, "listening");
    return {
      port: (server.address() as net.AddressInfo).port,
      [Symbol.dispose]: () => void server.close(),
    };
  }

  for (const [family, address] of [
    ["IPv4", "127.0.0.1"],
    ["IPv6", "[::1]"],
  ] as const) {
    describe.skipIf(family === "IPv6" && !isIPv6())(family, () => {
      const listenOn = address.replace(/[[\]]/g, "");

      test("https: Host and tls.serverName name the origin; the certificate is verified against serverName", async () => {
        using server = await observingServer(listenOn, true);
        const url = `https://${address}:${server.port}/`;
        const pinned = (serverName: string) =>
          fetch(url, {
            headers: { Host: "localhost" },
            tls: { ca: tlsCert.cert, serverName },
            proxy: false,
            keepalive: false,
          }).then(
            r => r.json(),
            e => e.code,
          );
        expect(await pinned("localhost")).toEqual({ sni: "localhost", host: "localhost" });
        // The harness certificate lists the loopback addresses as well, so
        // only a name it does not list shows what is being verified.
        expect(await pinned("pinned.invalid")).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
      });

      // An address as serverName: no SNI, and the certificate's IP entries are what is verified.
      test("https: tls.serverName can be an address", async () => {
        using server = await observingServer(listenOn, true);
        const response = await fetch(`https://${address}:${server.port}/`, {
          headers: { Host: "localhost" },
          tls: { ca: tlsCert.cert, serverName: "::1" },
          proxy: false,
          keepalive: false,
        });
        expect(await response.json()).toEqual({ sni: false, host: "localhost" });
      });

      test("http: Host names the origin", async () => {
        using server = await observingServer(listenOn, false);
        const response = await fetch(`http://${address}:${server.port}/`, {
          headers: { Host: "pinned.example" },
          proxy: false,
          keepalive: false,
        });
        expect(await response.json()).toEqual({ sni: null, host: "pinned.example" });
      });
    });
  }

  test("connections are shared by address and serverName, not by Host", async () => {
    const server = connectionCountingServer();
    const port = await server.listen();
    try {
      using session = new Bun.FetchSession({ proxy: false });
      const get = (host: string, serverName?: string) =>
        fetch(`https://127.0.0.1:${port}/`, {
          session,
          headers: { Host: host },
          tls: { ca: tlsCert.cert, serverName },
        }).then(r => r.text());
      expect(await get("a.example", "localhost")).toBe("ok");
      expect(await get("b.example", "localhost")).toBe("ok");
      expect(server.connections).toBe(1);
      // Verified against the address instead of the name: another connection.
      expect(await get("a.example")).toBe("ok");
      expect(server.connections).toBe(2);
    } finally {
      server.close();
    }
  });
});

describe("session.fetch", () => {
  test("is fetch() with the session, bound so that it can be handed to anything taking a fetch", async () => {
    const server = connectionCountingServer();
    const port = await server.listen();
    try {
      using session = new Bun.FetchSession({ tls: { ca: tlsCert.cert } });
      const { fetch: bound } = session;
      expect(bound).toBe(session.fetch);
      expect(bound.length).toBe(fetch.length);
      const url = `https://localhost:${port}/`;
      // A string, a URL and a Request, with and without init.
      expect(await (await bound(url)).text()).toBe("ok");
      expect(await (await bound(new URL(url), { method: "POST", body: "x" })).text()).toBe("ok");
      expect(await (await bound(new Request(url))).text()).toBe("ok");
      // The same pool as `{ session }` on the global fetch.
      expect(await (await fetch(url, { session })).text()).toBe("ok");
      expect(server.connections).toBe(1);
      // A `session` in the init does not replace the one the function is bound to.
      using other = new Bun.FetchSession({ tls: { ca: tlsCert.cert } });
      expect(await (await bound(url, { session: other })).text()).toBe("ok");
      expect(server.connections).toBe(1);
    } finally {
      server.close();
    }
  });

  test("rejects like fetch() does", async () => {
    using session = new Bun.FetchSession();
    expect(await (session.fetch as any)().catch((e: Error) => e.message)).toBe(
      "fetch() expects a string but received no arguments.",
    );
    using dead = await deadPort();
    expect(await session.fetch(`http://127.0.0.1:${dead.port}/`).catch(e => e.code)).toBe("ECONNREFUSED");
  });

  test("keeps its session alive", async () => {
    using server = Bun.serve({ port: 0, tls: tlsCert, fetch: () => new Response("ok") });
    // Only the session knows the CA; nothing else references the session.
    const bound = (() => new Bun.FetchSession({ tls: { ca: tlsCert.cert } }).fetch)();
    Bun.gc(true);
    expect(await (await bound(`https://localhost:${server.port}/`)).text()).toBe("ok");
  });

  test("a request in flight completes after its session is no longer reachable", async () => {
    // Holds its response until released, so the collector runs while the request is in flight.
    const held = Promise.withResolvers<() => void>();
    const sockets: net.Socket[] = [];
    const server = net.createServer(socket => {
      sockets.push(socket);
      socket.on("error", () => {});
      socket.once("data", () => held.resolve(() => socket.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok")));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const url = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}/`;
      // The session is not referenced after this returns.
      const body = (() => new Bun.FetchSession().fetch(url).then(r => r.text()))();
      const release = await held.promise;
      Bun.gc(true);
      release();
      expect(await body).toBe("ok");
    } finally {
      for (const socket of sockets) socket.destroy();
      server.close();
    }
  });
});
