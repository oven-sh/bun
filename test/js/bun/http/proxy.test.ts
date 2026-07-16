import axios from "axios";
import type { Server } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, tls as tlsCert } from "harness";
import { HttpsProxyAgent } from "https-proxy-agent";
import { once } from "node:events";
import net from "node:net";
import tls from "node:tls";
async function createProxyServer(is_tls: boolean) {
  const serverArgs = [];
  if (is_tls) {
    serverArgs.push({
      ...tlsCert,
      rejectUnauthorized: false,
    });
  }
  const log: Array<string> = [];
  serverArgs.push((clientSocket: net.Socket | tls.TLSSocket) => {
    // ignore client errors (can happen because of happy eye balls and now we error on write when not connected for node.js compatibility)
    clientSocket.on("error", () => {});

    clientSocket.once("data", data => {
      const request = data.toString();
      const [method, path] = request.split(" ");

      if (path.indexOf("http") === -1) {
        // Extract the host and port from the CONNECT request
        const [host, port] = path.split(":");
        const destinationPort = Number.parseInt((port || "443").toString(), 10);
        const destinationHost = host || "";
        log.push(`${method} ${host}:${port}`);

        // Establish a connection to the destination server
        const serverSocket = net.connect(destinationPort, destinationHost, () => {
          // 220 OK with host so the client knows the connection was successful
          clientSocket.write("HTTP/1.1 200 OK\r\nHost: localhost\r\n\r\n");

          // Pipe data between client and server
          clientSocket.pipe(serverSocket);
          serverSocket.pipe(clientSocket);

          // `pipe` only tears the upstream down on a clean 'end' from the
          // client. An abortive client teardown surfaces as 'error'/'close'
          // with no 'end' (notably on Windows), which would leave the target
          // holding a half-open connection forever. Propagate it; `end()`
          // still flushes any data already piped toward the target.
          clientSocket.on("close", () => serverSocket.end());
        });
        serverSocket.on("error", () => {
          clientSocket.end();
        });
        return;
      }

      // Absolute-form (non-tunneled) proxying. The client negotiates
      // keep-alive on the proxy connection, so after a redirect the next
      // request arrives on this same socket — forward every request that
      // shows up, not just the first one. The reused proxy connection is
      // keyed only by the proxy address, so consecutive requests may also
      // target different origins; keep one upstream per destination at a
      // time and reconnect when it changes.
      let upstream: net.Socket | undefined;
      let upstreamKey = "";
      let upstreamConnected = false;
      let pending: Buffer[] = [];

      const forward = (chunk: Buffer) => {
        const text = chunk.toString();
        const eol = text.indexOf("\r\n");
        const parts = eol === -1 ? [] : text.slice(0, eol).split(" ");

        if (parts.length === 3 && parts[1].startsWith("http")) {
          // A new absolute-form request line: rewrite it to origin form and
          // forward it to the destination it names.
          const url = new URL(parts[1]);
          const request_path = url.pathname + (url.search || "");
          log.push(`${parts[0]} ${url.hostname}:${url.port}${request_path}`);

          const key = `${url.hostname}:${url.port}`;
          if (upstream === undefined || upstreamKey !== key) {
            // First request on this connection, or the reused proxy
            // connection switched targets.
            if (upstream !== undefined) {
              upstream.unpipe(clientSocket);
              upstream.destroy();
            }
            upstreamKey = key;
            upstreamConnected = false;
            pending = [];
            const destinationPort = Number.parseInt((url.port || "80").toString(), 10);
            const serverSocket = net.connect(destinationPort, url.hostname, () => {
              upstreamConnected = true;
              for (const buffered of pending) serverSocket.write(buffered);
              pending = [];
              serverSocket.pipe(clientSocket);
            });
            serverSocket.on("error", () => {
              clientSocket.end();
            });
            upstream = serverSocket;
          }

          const head = Buffer.from(`${parts[0]} ${request_path} HTTP/1.1\r\n`);
          // Send the rest of the request to the destination server
          const rest = chunk.slice(text.indexOf("\r\n") + 2);
          if (upstreamConnected) {
            upstream.write(head);
            upstream.write(rest);
          } else {
            pending.push(head, rest);
          }
        } else if (upstream !== undefined) {
          // Continuation of the previous request's body.
          if (upstreamConnected) {
            upstream.write(chunk);
          } else {
            pending.push(chunk);
          }
        }
      };

      forward(data);
      clientSocket.on("data", forward);
    });
  });
  // Create a server to listen for incoming HTTPS connections
  //@ts-ignore
  const server = (is_tls ? tls : net).createServer(...serverArgs);

  server.listen(0);
  await once(server, "listening");
  const port = server.address().port;
  const url = `http${is_tls ? "s" : ""}://localhost:${port}`;
  return { server, url, log: log };
}

let httpServer: Server;
let httpsServer: Server;
let httpProxyServer: { server: net.Server; url: string; log: string[] };
let httpsProxyServer: { server: net.Server; url: string; log: string[] };

// Tests in this file that call fetch() in-process expect the explicit `proxy`
// option to be honored against localhost targets. An ambient NO_PROXY /
// HTTP_PROXY / HTTPS_PROXY in the environment (as some CI/dev containers set)
// would make those localhost fetches bypass the proxy and the assertions fail.
// Clear them for the duration of this file; subprocess-based tests below pass
// their own explicit `env` and are unaffected.
//
// Assign "" rather than `delete`: the HTTP client reads these via getenv, and
// (matching Node semantics) only an assignment propagates to it — a `delete`
// leaves the native value stale. An empty value disables the proxy/bypass.
const savedProxyEnv: Record<string, string | undefined> = {};
const PROXY_ENV_KEYS = ["NO_PROXY", "no_proxy", "HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy"];

beforeAll(async () => {
  for (const key of PROXY_ENV_KEYS) {
    savedProxyEnv[key] = process.env[key];
    process.env[key] = "";
  }

  httpServer = Bun.serve({
    port: 0,
    async fetch(req) {
      if (req.method === "POST") {
        const text = await req.text();
        return new Response(text, { status: 200 });
      }
      return new Response("", { status: 200 });
    },
  });

  httpsServer = Bun.serve({
    port: 0,
    tls: tlsCert,
    async fetch(req) {
      if (req.method === "POST") {
        const text = await req.text();
        return new Response(text, { status: 200 });
      }
      return new Response("", { status: 200 });
    },
  });

  httpProxyServer = await createProxyServer(false);
  httpsProxyServer = await createProxyServer(true);
});

afterAll(() => {
  httpServer.stop();
  httpsServer.stop();
  httpProxyServer.server.close();
  httpsProxyServer.server.close();

  for (const key of PROXY_ENV_KEYS) {
    // Restore the prior value; an absent var maps back to "" (see note above).
    process.env[key] = savedProxyEnv[key] ?? "";
  }
});

for (const proxy_tls of [false, true]) {
  for (const target_tls of [false, true]) {
    for (const body of [undefined, "Hello, World"]) {
      test.concurrent(
        `${body === undefined ? "GET" : "POST"} ${proxy_tls ? "TLS" : "non-TLS"} proxy -> ${target_tls ? "TLS" : "non-TLS"} body type ${typeof body}`,
        async () => {
          const response = await fetch(target_tls ? httpsServer.url : httpServer.url, {
            method: body === undefined ? "GET" : "POST",
            proxy: proxy_tls ? httpsProxyServer.url : httpProxyServer.url,
            headers: {
              "Content-Type": "plain/text",
            },
            keepalive: false,
            body: body,
            tls: {
              ca: tlsCert.cert,
              rejectUnauthorized: false,
            },
          });
          expect(response.ok).toBe(true);
          expect(response.status).toBe(200);
          expect(response.statusText).toBe("OK");
          const result = await response.text();

          expect(result).toBe(body || "");
        },
      );
    }
  }
}

for (const server_tls of [false, true]) {
  describe.concurrent(`proxy can handle redirects with ${server_tls ? "TLS" : "non-TLS"} server`, () => {
    test("with empty body #12007", async () => {
      using server = Bun.serve({
        tls: server_tls ? tlsCert : undefined,
        port: 0,
        async fetch(req) {
          if (req.url.endsWith("/bunbun")) {
            return Response.redirect("/bun", 302);
          }
          if (req.url.endsWith("/bun")) {
            return Response.redirect("/", 302);
          }
          return new Response("", { status: 403 });
        },
      });
      const response = await fetch(`${server.url.origin}/bunbun`, {
        proxy: httpsProxyServer.url,
        tls: {
          cert: tlsCert.cert,
          rejectUnauthorized: false,
        },
      });
      expect(response.ok).toBe(false);
      expect(response.status).toBe(403);
      expect(response.statusText).toBe("Forbidden");
    });

    test("with body #12007", async () => {
      using server = Bun.serve({
        tls: server_tls ? tlsCert : undefined,
        port: 0,
        async fetch(req) {
          if (req.url.endsWith("/bunbun")) {
            return new Response("Hello, bunbun", { status: 302, headers: { Location: "/bun" } });
          }
          if (req.url.endsWith("/bun")) {
            return new Response("Hello, bun", { status: 302, headers: { Location: "/" } });
          }
          return new Response("BUN!", { status: 200 });
        },
      });
      const response = await fetch(`${server.url.origin}/bunbun`, {
        proxy: httpsProxyServer.url,
        tls: {
          cert: tlsCert.cert,
          rejectUnauthorized: false,
        },
      });
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      expect(response.statusText).toBe("OK");

      const result = await response.text();
      expect(result).toBe("BUN!");
    });

    test("with chunked body #12007", async () => {
      using server = Bun.serve({
        tls: server_tls ? tlsCert : undefined,
        port: 0,
        async fetch(req) {
          async function* body() {
            await Bun.sleep(100);
            yield "bun";
            await Bun.sleep(100);
            yield "bun";
            await Bun.sleep(100);
            yield "bun";
            await Bun.sleep(100);
            yield "bun";
          }
          if (req.url.endsWith("/bunbun")) {
            return new Response(body, { status: 302, headers: { Location: "/bun" } });
          }
          if (req.url.endsWith("/bun")) {
            return new Response(body, { status: 302, headers: { Location: "/" } });
          }
          return new Response(body, { status: 200 });
        },
      });
      const response = await fetch(`${server.url.origin}/bunbun`, {
        proxy: httpsProxyServer.url,
        tls: {
          cert: tlsCert.cert,
          rejectUnauthorized: false,
        },
      });
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      expect(response.statusText).toBe("OK");

      const result = await response.text();
      expect(result).toBe("bunbunbunbun");
    });
  });
}

test("non-TLS origin redirect through HTTPS proxy forwards every hop through the proxy", async () => {
  // Dedicated proxy instance so its log is not polluted by the concurrent
  // tests that share httpsProxyServer.
  const proxy = await createProxyServer(true);
  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      if (req.url.endsWith("/bunbun")) {
        return Response.redirect("/bun", 302);
      }
      if (req.url.endsWith("/bun")) {
        return Response.redirect("/", 302);
      }
      return new Response("BUN!", { status: 200 });
    },
  });

  try {
    const response = await fetch(`${server.url.origin}/bunbun`, {
      proxy: proxy.url,
      tls: {
        rejectUnauthorized: false,
      },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("BUN!");

    // Every redirect hop must have been forwarded through the proxy as its own
    // absolute-form request — none dropped, none bypassing the proxy, and no
    // CONNECT fallback.
    expect(proxy.log).toEqual([
      `GET localhost:${server.port}/bunbun`,
      `GET localhost:${server.port}/bun`,
      `GET localhost:${server.port}/`,
    ]);
  } finally {
    // Not awaited: the client's pooled keep-alive connection keeps the server's
    // close event from firing (matches the afterAll teardown above).
    proxy.server.close();
  }
});

test("unsupported protocol", async () => {
  expect(
    fetch("https://httpbin.org/get", {
      proxy: "ftp://asdf.com",
    }),
  ).rejects.toThrowError(
    expect.objectContaining({
      code: "UnsupportedProxyProtocol",
    }),
  );
});

/**
 * Creates an HTTP proxy server that captures Proxy-Authorization headers.
 * The server forwards requests to their destination and pipes responses back.
 */
async function createAuthCapturingProxy() {
  const capturedAuths: string[] = [];
  const server = net.createServer((clientSocket: net.Socket) => {
    clientSocket.once("data", data => {
      const request = data.toString();
      const lines = request.split("\r\n");
      for (const line of lines) {
        if (line.toLowerCase().startsWith("proxy-authorization:")) {
          capturedAuths.push(line.substring("proxy-authorization:".length).trim());
        }
      }

      const [method, path] = request.split(" ");
      let host: string;
      let port: number | string = 0;
      let request_path = "";
      if (path.indexOf("http") !== -1) {
        const url = new URL(path);
        host = url.hostname;
        port = url.port;
        request_path = url.pathname + (url.search || "");
      } else {
        [host, port] = path.split(":");
      }
      const destinationPort = Number.parseInt((port || "80").toString(), 10);
      const destinationHost = host || "";

      const serverSocket = net.connect(destinationPort, destinationHost, () => {
        serverSocket.write(`${method} ${request_path} HTTP/1.1\r\n`);
        serverSocket.write(data.slice(request.indexOf("\r\n") + 2));
        serverSocket.pipe(clientSocket);
      });
      clientSocket.on("error", () => {});
      serverSocket.on("error", () => {
        clientSocket.end();
      });
    });
  });

  server.listen(0);
  await once(server, "listening");
  const port = (server.address() as net.AddressInfo).port;

  return {
    server,
    port,
    capturedAuths,
    async close() {
      server.close();
      await once(server, "close");
    },
  };
}

test("proxy with long password (> 4096 chars) sends correct authorization", async () => {
  const proxy = await createAuthCapturingProxy();

  // Create a password longer than 4096 chars (e.g., simulating a JWT token)
  // Use Buffer.alloc which is faster in debug JavaScriptCore builds
  const longPassword = Buffer.alloc(5000, "a").toString();
  const username = "testuser";
  const proxyUrl = `http://${username}:${longPassword}@localhost:${proxy.port}`;

  try {
    const response = await fetch(httpServer.url, {
      method: "GET",
      proxy: proxyUrl,
      keepalive: false,
    });
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);

    // Verify the auth header was sent and contains both username and password
    expect(proxy.capturedAuths.length).toBeGreaterThanOrEqual(1);
    const capturedAuth = proxy.capturedAuths[0];
    expect(capturedAuth.startsWith("Basic ")).toBe(true);

    // Decode and verify
    const encoded = capturedAuth.substring("Basic ".length);
    const decoded = Buffer.from(encoded, "base64").toString();
    expect(decoded).toBe(`${username}:${longPassword}`);
  } finally {
    await proxy.close();
  }
});

test("proxy with long password (> 4096 chars) works correctly after redirect", async () => {
  // This test verifies that the reset() code path (used during redirects)
  // also handles long passwords correctly
  const proxy = await createAuthCapturingProxy();

  // Create a server that issues a redirect
  using redirectServer = Bun.serve({
    port: 0,
    fetch(req) {
      if (req.url.endsWith("/redirect")) {
        return Response.redirect("/final", 302);
      }
      return new Response("OK", { status: 200 });
    },
  });

  // Use Buffer.alloc which is faster in debug JavaScriptCore builds
  const longPassword = Buffer.alloc(5000, "a").toString();
  const username = "testuser";
  const proxyUrl = `http://${username}:${longPassword}@localhost:${proxy.port}`;

  try {
    const response = await fetch(`${redirectServer.url.origin}/redirect`, {
      method: "GET",
      proxy: proxyUrl,
      keepalive: false,
    });
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toBe("OK");

    // Verify auth was sent on requests. Due to connection reuse, the proxy may
    // only see one request even though a redirect occurred (the redirected
    // request reuses the same connection). We verify at least one auth was sent
    // and that all captured auths are correct.
    expect(proxy.capturedAuths.length).toBeGreaterThanOrEqual(1);
    for (const capturedAuth of proxy.capturedAuths) {
      expect(capturedAuth.startsWith("Basic ")).toBe(true);
      const encoded = capturedAuth.substring("Basic ".length);
      const decoded = Buffer.from(encoded, "base64").toString();
      expect(decoded).toBe(`${username}:${longPassword}`);
    }
  } finally {
    await proxy.close();
  }
});

// Regression test for https://github.com/oven-sh/bun/issues/31780
//
// The Proxy-Authorization: Basic <...> credential must be encoded with the
// STANDARD base64 alphabet (+ / with = padding, RFC 7617), not base64url
// (- _ with no padding). Credentials whose standard base64 contains + or /
// (common in DataImpulse session tokens) were previously mangled, so strict
// proxies rejected them and closed the socket.
//
// The fetch runs in a subprocess so we can clear NO_PROXY/HTTP_PROXY/HTTPS_PROXY
// (inherited from the environment in some setups) and guarantee the explicit
// `proxy` option is actually used. The proxy server runs in-process and
// captures the header.
describe("proxy Basic auth uses standard base64 (#31780)", () => {
  // Userinfo whose standard base64 contains both + and /, plus = padding:
  //   standard: c3ViLXVzZXI6c2Vzcz4+aWQ/ZmY=
  //   base64url: c3ViLXVzZXI6c2Vzcz4-aWQ_ZmY   (- and _, no padding)
  const username = "sub-user";
  const password = "sess>>id?ff";
  const expectedStandard = Buffer.from(`${username}:${password}`).toString("base64");
  const expectedUrlSafe = Buffer.from(`${username}:${password}`).toString("base64url");
  // Encode the userinfo so reserved characters don't break URL parsing.
  const userinfo = `${encodeURIComponent(username)}:${encodeURIComponent(password)}`;

  // Ensure the fixtures actually distinguish the two alphabets.
  expect(expectedStandard).toContain("+");
  expect(expectedStandard).toContain("/");
  expect(expectedStandard).not.toBe(expectedUrlSafe);

  // Clear proxy-bypass env so the explicit `proxy:` option is honored for
  // localhost targets regardless of the ambient environment.
  const noProxyEnv = { ...bunEnv };
  delete noProxyEnv.NO_PROXY;
  delete noProxyEnv.no_proxy;
  delete noProxyEnv.HTTP_PROXY;
  delete noProxyEnv.http_proxy;
  delete noProxyEnv.HTTPS_PROXY;
  delete noProxyEnv.https_proxy;

  test("absolute-form (HTTP target)", async () => {
    const proxy = await createAuthCapturingProxy();
    try {
      const proxyUrl = `http://${userinfo}@localhost:${proxy.port}`;
      await using fetchProc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const r = await fetch(${JSON.stringify(httpServer.url.href)}, { proxy: ${JSON.stringify(proxyUrl)}, keepalive: false }); console.log(r.status);`,
        ],
        env: noProxyEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        fetchProc.stdout.text(),
        fetchProc.stderr.text(),
        fetchProc.exited,
      ]);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("200");
      expect(exitCode).toBe(0);

      expect(proxy.capturedAuths.length).toBeGreaterThanOrEqual(1);
      expect(proxy.capturedAuths[0]).toBe(`Basic ${expectedStandard}`);
    } finally {
      await proxy.close();
    }
  });

  test("CONNECT tunnel (HTTPS target)", async () => {
    using target = Bun.serve({ port: 0, tls: tlsCert, fetch: () => new Response("ok") });

    const capturedAuths: string[] = [];
    const sockets = new Set<net.Socket>();
    const upstreamSockets = new Set<net.Socket>();
    const proxy = net.createServer(clientSocket => {
      sockets.add(clientSocket);
      clientSocket.on("error", () => {});
      clientSocket.once("data", data => {
        const req = data.toString();
        if (!req.startsWith("CONNECT")) return clientSocket.end();
        const authMatch = req.match(/Proxy-Authorization: (.+)\r\n/i);
        if (authMatch) capturedAuths.push(authMatch[1]);
        const serverSocket = net.connect(target.port, "localhost", () => {
          clientSocket.write("HTTP/1.1 200 OK\r\n\r\n");
          clientSocket.pipe(serverSocket);
          serverSocket.pipe(clientSocket);
        });
        upstreamSockets.add(serverSocket);
        serverSocket.on("close", () => upstreamSockets.delete(serverSocket));
        serverSocket.on("error", () => clientSocket.end());
      });
      clientSocket.on("close", () => sockets.delete(clientSocket));
    });
    proxy.listen(0);
    await once(proxy, "listening");
    const proxyPort = (proxy.address() as net.AddressInfo).port;

    try {
      const proxyUrl = `http://${userinfo}@localhost:${proxyPort}`;
      await using fetchProc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const r = await fetch(${JSON.stringify(target.url.href)}, { proxy: ${JSON.stringify(proxyUrl)}, keepalive: false, tls: { rejectUnauthorized: false } }); console.log(r.status);`,
        ],
        env: noProxyEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        fetchProc.stdout.text(),
        fetchProc.stderr.text(),
        fetchProc.exited,
      ]);
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("200");
      expect(exitCode).toBe(0);

      expect(capturedAuths.length).toBeGreaterThanOrEqual(1);
      expect(capturedAuths[0]).toBe(`Basic ${expectedStandard}`);
    } finally {
      for (const s of sockets) s.destroy();
      for (const s of upstreamSockets) s.destroy();
      proxy.close();
      await once(proxy, "close");
    }
  });
});

test("axios with https-proxy-agent", async () => {
  httpProxyServer.log.length = 0;
  // Like Node.js, the options passed to the HttpsProxyAgent constructor only
  // configure the connection to the proxy itself; the TLS options for the
  // tunneled target connection come from the request options. Axios cannot
  // pass per-request TLS options, so use an agent subclass that adds them to
  // the tunneled connection (the usual Node.js workaround).
  class SelfSignedHttpsProxyAgent extends HttpsProxyAgent<string> {
    connect(req: any, opts: any) {
      return super.connect(req, { ...opts, rejectUnauthorized: false });
    }
  }
  const httpsAgent = new SelfSignedHttpsProxyAgent(httpProxyServer.url);

  const result = await axios.get(httpsServer.url.href, {
    httpsAgent,
  });
  expect(result.data).toBe("");
  // did we got proxied?
  expect(httpProxyServer.log).toEqual([`CONNECT localhost:${httpsServer.port}`]);
});

test("HTTPS proxy tunnel keep-alive reuses CONNECT across sequential requests", async () => {
  httpProxyServer.log.length = 0;

  for (let i = 0; i < 3; i++) {
    const result = await fetch(httpsServer.url, {
      proxy: httpProxyServer.url,
      tls: { rejectUnauthorized: false },
    });
    expect(result.status).toBe(200);
    await result.text();
  }

  const connects = httpProxyServer.log.filter(l => l.startsWith("CONNECT"));
  expect(connects).toEqual([`CONNECT localhost:${httpsServer.port}`]);
});

test("HTTPS proxy tunnel keep-alive does not share tunnel across different targets", async () => {
  // Fresh servers so prior tests' pooled tunnels can't interfere.
  using serverA = Bun.serve({ port: 0, tls: tlsCert, fetch: () => new Response("a") });
  using serverB = Bun.serve({ port: 0, tls: tlsCert, fetch: () => new Response("b") });

  httpProxyServer.log.length = 0;

  // Same proxy, two different targets — each must get its own tunnel.
  const opts = { proxy: httpProxyServer.url, tls: { rejectUnauthorized: false } } as const;
  await (await fetch(serverA.url, opts)).text();
  await (await fetch(serverB.url, opts)).text();
  await (await fetch(serverA.url, opts)).text();
  await (await fetch(serverB.url, opts)).text();

  const connects = httpProxyServer.log.filter(l => l.startsWith("CONNECT"));
  expect(connects.sort()).toEqual([`CONNECT localhost:${serverA.port}`, `CONNECT localhost:${serverB.port}`].sort());
});

test("HTTPS proxy tunnel keep-alive does not share tunnel across different credentials", async () => {
  using target = Bun.serve({ port: 0, tls: tlsCert, fetch: () => new Response("ok") });

  let connectCount = 0;
  const authPerConnect: string[] = [];
  const sockets = new Set<net.Socket>();
  const upstreamSockets = new Set<net.Socket>();
  const proxy = net.createServer(clientSocket => {
    sockets.add(clientSocket);
    clientSocket.once("data", data => {
      const req = data.toString();
      if (!req.startsWith("CONNECT")) return clientSocket.end();
      connectCount++;
      const authMatch = req.match(/Proxy-Authorization: (.+)\r\n/i);
      authPerConnect.push(authMatch ? authMatch[1] : "<none>");
      const serverSocket = net.connect(target.port, "localhost", () => {
        clientSocket.write("HTTP/1.1 200 OK\r\n\r\n");
        clientSocket.pipe(serverSocket);
        serverSocket.pipe(clientSocket);
      });
      upstreamSockets.add(serverSocket);
      serverSocket.on("close", () => upstreamSockets.delete(serverSocket));
      serverSocket.on("error", () => clientSocket.end());
      clientSocket.on("error", () => {});
    });
    clientSocket.on("close", () => sockets.delete(clientSocket));
  });
  proxy.listen(0);
  await once(proxy, "listening");
  const proxyPort = (proxy.address() as net.AddressInfo).port;

  try {
    const opts = { tls: { rejectUnauthorized: false } } as const;

    // Same target, same proxy, different credentials — must NOT share.
    await (await fetch(target.url, { ...opts, proxy: `http://user1:pass1@localhost:${proxyPort}` })).text();
    await (await fetch(target.url, { ...opts, proxy: `http://user2:pass2@localhost:${proxyPort}` })).text();
    // Same creds as first — SHOULD reuse tunnel from request 1.
    await (await fetch(target.url, { ...opts, proxy: `http://user1:pass1@localhost:${proxyPort}` })).text();

    expect(connectCount).toBe(2);
    expect(authPerConnect.length).toBe(2);
    expect(authPerConnect[0]).not.toBe(authPerConnect[1]);
  } finally {
    for (const s of sockets) s.destroy();
    for (const s of upstreamSockets) s.destroy();
    proxy.close();
    await once(proxy, "close");
  }
});

test("HTTPS target through proxy with passing checkServerIdentity round-trips", async () => {
  // The CONNECT tunnel parks after the inner TLS handshake until the JS
  // checkServerIdentity callback approves the target's certificate. While
  // parked, raw inner-TLS records (e.g. TLS 1.3 NewSessionTicket) keep
  // arriving on the outer socket and must keep flowing into the SSL state
  // machine, otherwise the handshake never completes and this hangs.
  const verified: string[] = [];
  const response = await fetch(httpsServer.url, {
    method: "POST",
    proxy: httpProxyServer.url,
    body: "tunneled body",
    keepalive: false,
    tls: {
      ca: tlsCert.cert,
      checkServerIdentity(hostname: string) {
        verified.push(hostname);
        return undefined;
      },
    },
  });
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("tunneled body");
  expect(verified).toEqual(["localhost"]);
});

test("HTTPS target through proxy with rejecting checkServerIdentity transmits nothing to the target", async () => {
  // Raw TLS target so we can observe exactly which decrypted bytes (if any)
  // reach it before the pinning callback rejects the certificate.
  const receivedPerConnection: Buffer[][] = [];
  let rawConnections = 0;
  const { promise: firstConnectionClosed, resolve: onFirstConnectionClosed } = Promise.withResolvers<void>();
  const target = tls.createServer({ key: tlsCert.key, cert: tlsCert.cert }, socket => {
    const chunks: Buffer[] = [];
    receivedPerConnection.push(chunks);
    socket.on("data", chunk => chunks.push(chunk));
    socket.on("error", () => {});
  });
  // Track teardown on the raw TCP connection rather than the TLS socket: the
  // client tears the tunnel down as soon as checkServerIdentity rejects, so
  // the target may never finish its side of the inner handshake and the
  // secureConnection callback above may never fire.
  target.on("connection", rawSocket => {
    rawConnections++;
    rawSocket.on("close", onFirstConnectionClosed);
    rawSocket.on("error", () => {});
  });
  target.listen(0);
  await once(target, "listening");
  const targetPort = (target.address() as net.AddressInfo).port;

  try {
    let err: unknown;
    try {
      await fetch(`https://localhost:${targetPort}/`, {
        method: "POST",
        proxy: httpProxyServer.url,
        body: "secret tunneled body",
        headers: { Authorization: "Bearer super-secret-token" },
        keepalive: false,
        tls: {
          ca: tlsCert.cert,
          checkServerIdentity() {
            return new Error("pinned");
          },
        },
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("pinned");

    // The tunnel must be torn down without the request line, the
    // Authorization header, or the body ever reaching the target.
    await firstConnectionClosed;
    expect(rawConnections).toBe(1);
    const decryptedBytesSeenByTarget = receivedPerConnection.reduce(
      (sum, chunks) => sum + Buffer.concat(chunks).byteLength,
      0,
    );
    expect(decryptedBytesSeenByTarget).toBe(0);
  } finally {
    target.close();
  }
});

test("HTTPS over HTTP proxy preserves TLS record order with large bodies", async () => {
  // Create a custom HTTPS server that returns body size for this test
  using customServer = Bun.serve({
    port: 0,
    tls: tlsCert,
    async fetch(req) {
      // return the body size
      const buf = await req.arrayBuffer();
      return new Response(String(buf.byteLength), { status: 200 });
    },
  });

  // Test with multiple body sizes to ensure TLS record ordering is preserved
  // also testing several times because it's flaky otherwise
  const testCases = [
    16 * 1024 * 1024, // 16MB
    32 * 1024 * 1024, // 32MB
  ];

  for (const size of testCases) {
    const body = new Uint8Array(size).fill(0x61); // 'a'

    const response = await fetch(customServer.url, {
      method: "POST",
      proxy: httpProxyServer.url,
      headers: { "Content-Type": "application/octet-stream" },
      body,
      keepalive: false,
      tls: { ca: tlsCert.cert, rejectUnauthorized: false },
    });

    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    const result = await response.text();

    // recvd body size should exactly match the sent body size
    expect(result).toBe(String(size));
  }
});

test("HTTPS origin close-delimited body via HTTP proxy does not ECONNRESET", async () => {
  // Inline raw HTTPS origin: 200 + no Content-Length then close
  const originServer = tls.createServer(
    { ...tlsCert, rejectUnauthorized: false },
    (clientSocket: net.Socket | tls.TLSSocket) => {
      clientSocket.once("data", () => {
        const body = "ok";
        // ! Notice we are not using a Content-Length header here, this is what is causing the issue
        const resp = "HTTP/1.1 200 OK\r\n" + "content-type: text/plain\r\n" + "connection: close\r\n" + "\r\n" + body;
        clientSocket.write(resp);
        clientSocket.end();
      });
      clientSocket.on("error", () => {});
    },
  );
  originServer.listen(0);
  await once(originServer, "listening");
  const originURL = `https://localhost:${(originServer.address() as net.AddressInfo).port}`;
  try {
    const res = await fetch(originURL, {
      method: "POST",
      body: "x",
      proxy: httpProxyServer.url,
      keepalive: false,
      tls: { ca: tlsCert.cert, rejectUnauthorized: false },
    });
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("ok");
  } finally {
    originServer.close();
    await once(originServer, "close");
  }
});

// Use-after-free in the proxy tunnel close path: when the final response
// bytes and the TLS close_notify arrive in one TCP batch, SSLWrapper's
// handle_reading sets sent_ssl_shutdown before flushing the decrypted bytes.
// The data callback completes the response, and the done path's
// ProxyTunnel.shutdown() hit SSLWrapper.shutdown()'s already-shut-down early
// return without marking the wrapper closed_notified, so after the client was
// freed handle_reading still fired on_close into the stale handlers.ctx.
// Only deterministic under ASAN; release builds read freed-but-intact memory.
test.skipIf(!isASAN)(
  "response + close_notify in one packet via HTTPS proxy tunnel does not use-after-free the client",
  async () => {
    const fixture = `
      const net = require("node:net");
      const tlsCert = ${JSON.stringify({ cert: tlsCert.cert, key: tlsCert.key })};

      // HTTPS origin: fixed-length response, then immediate end() so the
      // close_notify alert directly follows the application-data record.
      const origin = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        tls: tlsCert,
        socket: {
          data(socket) {
            socket.write("HTTP/1.1 200 OK\\r\\nContent-Length: 5\\r\\nConnection: close\\r\\n\\r\\nhello");
            socket.end();
          },
          error() {},
        },
      });

      // CONNECT proxy that coalesces the tail of the tunnel: after the
      // client's second post-CONNECT flight (TLS 1.3 Finished + HTTP request;
      // no HelloRetryRequest happens between two BoringSSL peers),
      // origin->client bytes are held. The origin finishes its stream with
      // close_notify, a tiny alert record (~19 bytes of payload vs 79+ for
      // the response/session-ticket records), so once the held byte stream
      // ends on a complete alert-sized record everything (tickets + response
      // + close_notify) is delivered to the client in ONE write, making the
      // fetch client process last-data-then-EOF in a single onData pump.
      const proxy = net.createServer(client => {
        let upstream = null;
        let clientFlights = 0;
        let head = Buffer.alloc(0);
        let held = Buffer.alloc(0);
        const tryFlush = () => {
          let o = 0;
          let lastIsAlertSized = false;
          while (o + 5 <= held.length) {
            const len = held.readUInt16BE(o + 3);
            if (o + 5 + len > held.length) return; // incomplete record
            lastIsAlertSized = len <= 40;
            o += 5 + len;
          }
          if (o !== held.length || !lastIsAlertSized) return;
          client.write(held);
          held = Buffer.alloc(0);
          client.end();
        };
        client.on("error", () => {});
        client.on("close", () => upstream?.destroy());
        client.on("data", chunk => {
          if (!upstream) {
            head = Buffer.concat([head, chunk]);
            const end = head.indexOf("\\r\\n\\r\\n");
            if (end === -1) return;
            const leftover = head.subarray(end + 4);
            upstream = net.connect(origin.port, "127.0.0.1", () => {
              client.write("HTTP/1.1 200 Connection Established\\r\\n\\r\\n");
              if (leftover.length) upstream.write(leftover);
            });
            upstream.on("error", () => {});
            upstream.on("data", data => {
              if (clientFlights >= 2) {
                held = Buffer.concat([held, data]);
                tryFlush();
              } else {
                client.write(data);
              }
            });
            return;
          }
          clientFlights++;
          upstream.write(chunk);
        });
      });

      proxy.listen(0, "127.0.0.1", async () => {
        const res = await fetch("https://localhost:" + origin.port + "/", {
          proxy: "http://127.0.0.1:" + proxy.address().port,
          keepalive: false,
          tls: { ca: tlsCert.cert, rejectUnauthorized: false },
        });
        const text = await res.text();
        console.log(text);
        process.exit(0);
      });
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: {
        ...bunEnv,
        // the explicit per-request proxy must not be bypassed or rerouted by
        // ambient proxy configuration on CI hosts
        NO_PROXY: undefined,
        no_proxy: undefined,
        HTTP_PROXY: undefined,
        http_proxy: undefined,
        HTTPS_PROXY: undefined,
        https_proxy: undefined,
      },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) console.error("stderr:", stderr);
    expect(stdout).toBe("hello\n");
    expect(exitCode).toBe(0);
  },
);

test("response + corrupt TLS record in one packet via pooled HTTPS proxy tunnel does not use-after-free the client", async () => {
  const fixture = `
      const net = require("node:net");
      const tlsCert = ${JSON.stringify({ cert: tlsCert.cert, key: tlsCert.key })};

      const body = Buffer.alloc(4096, 0x42);
      const origin = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        tls: tlsCert,
        socket: {
          data(socket) {
            socket.write("HTTP/1.1 200 OK\\r\\nContent-Length: 4096\\r\\nConnection: keep-alive\\r\\n\\r\\n");
            socket.write(body);
          },
          error() {},
        },
      });

      const poison = Buffer.alloc(64, 0x41);
      const proxy = net.createServer(client => {
        let upstream = null;
        let clientFlights = 0;
        let head = Buffer.alloc(0);
        let held = Buffer.alloc(0);
        let poisoned = false;
        const tryFlush = () => {
          let o = 0;
          let hasResponseRecord = false;
          while (o + 5 <= held.length) {
            const len = held.readUInt16BE(o + 3);
            if (o + 5 + len > held.length) return;
            if (len >= 2048) hasResponseRecord = true;
            o += 5 + len;
          }
          if (o !== held.length || !hasResponseRecord) return;
          poisoned = true;
          client.write(Buffer.concat([held, poison]));
          held = Buffer.alloc(0);
        };
        client.on("error", () => {});
        client.on("close", () => upstream?.destroy());
        client.on("data", chunk => {
          if (!upstream) {
            head = Buffer.concat([head, chunk]);
            const end = head.indexOf("\\r\\n\\r\\n");
            if (end === -1) return;
            const leftover = head.subarray(end + 4);
            upstream = net.connect(origin.port, "127.0.0.1", () => {
              client.write("HTTP/1.1 200 Connection Established\\r\\n\\r\\n");
              if (leftover.length) upstream.write(leftover);
            });
            upstream.on("error", () => {});
            upstream.on("data", data => {
              if (poisoned) return;
              if (clientFlights >= 2) {
                held = Buffer.concat([held, data]);
                tryFlush();
              } else {
                client.write(data);
              }
            });
            return;
          }
          clientFlights++;
          upstream.write(chunk);
        });
      });

      proxy.listen(0, "127.0.0.1", async () => {
        const res = await fetch("https://localhost:" + origin.port + "/", {
          proxy: "http://127.0.0.1:" + proxy.address().port,
          keepalive: true,
          tls: { ca: tlsCert.cert, rejectUnauthorized: false },
        });
        const text = await res.text();
        // a second round-trip can only complete if the HTTP client thread
        // survived the first one; without it, process.exit(0) wins the race
        // against the ASAN abort on that thread and the bug goes unobserved
        const probe = await fetch("https://localhost:" + origin.port + "/", {
          tls: { ca: tlsCert.cert, rejectUnauthorized: false },
        });
        await probe.bytes();
        console.log(text.length, res.status, probe.status);
        process.exit(0);
      });
    `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: {
      ...bunEnv,
      NO_PROXY: undefined,
      no_proxy: undefined,
      HTTP_PROXY: undefined,
      http_proxy: undefined,
      HTTPS_PROXY: undefined,
      https_proxy: undefined,
    },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) console.error("stderr:", stderr);
  expect(stdout).toBe("4096 200 200\n");
  expect(exitCode).toBe(0);
});

// Sentry BUN-2V7Z: debug_assert!(!socket.is_shutdown()/is_closed()) in the
// ProxyHeaders arm of on_writable (and the matching assert in
// send_initial_request_payload) fired when the outer proxy socket died
// between the inner-TLS handshake completing and the first HTTP write.
// The assertion only fired in builds with debug-assertions on (Windows
// Zig release builds used ReleaseSafe, hence 100% Windows in Sentry);
// on other release builds the request would write into a dead outer
// socket and stall. The race is not deterministically reproducible on
// Linux loopback (the RST is processed as a separate event after
// on_writable returns), so this test verifies the fetch rejects cleanly
// with a connection error rather than asserting or hanging.
for (const scheme of ["http", "https"] as const) {
  // 5 iterations (was 10): two concurrent ASAN-debug subprocesses took
  // 4.7-4.9s of the default 5s budget after sustained runs. Fixture startup
  // dominates; 5 iterations still covers "rejects cleanly, doesn't hang".
  const iterations = 5;
  test(`outer ${scheme.toUpperCase()} proxy socket reset right after inner TLS handshake rejects cleanly`, async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), require.resolve("./proxy-handshake-closed-socket-fixture.ts"), scheme, String(iterations)],
      env: {
        ...bunEnv,
        // The explicit per-request proxy must not be bypassed or rerouted
        // by ambient proxy configuration on CI hosts; clear them in the
        // spawn env so the child starts clean (see PROXY_ENV_KEYS above).
        NO_PROXY: undefined,
        no_proxy: undefined,
        HTTP_PROXY: undefined,
        http_proxy: undefined,
        HTTPS_PROXY: undefined,
        https_proxy: undefined,
      },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) console.error("stderr:", stderr);
    const lines = stdout.trim().split("\n");
    // Every iteration must reject with a connection-flavored error, not
    // TimeoutError (which would mean the request stalled on a dead socket
    // and only the AbortSignal freed it) and not "resolved".
    expect(lines).toHaveLength(iterations);
    for (const line of lines) {
      expect(line).toMatch(/^rejected: (ECONNRESET|ConnectionClosed|ECONNREFUSED|ConnectionRefused)$/);
    }
    expect(stderr).not.toContain("hung");
    expect(exitCode).toBe(0);
  }, 15000);
}

describe.concurrent("proxy object format with headers", () => {
  test("proxy object with url string works same as string proxy", async () => {
    const response = await fetch(httpServer.url, {
      method: "GET",
      proxy: {
        url: httpProxyServer.url,
      },
      keepalive: false,
    });
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
  });

  // https://github.com/oven-sh/bun/issues/29103
  test("proxy object with url as a URL object works same as a string url", async () => {
    const response = await fetch(httpServer.url, {
      method: "GET",
      proxy: {
        url: new URL(httpProxyServer.url),
      },
      keepalive: false,
    });
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
  });

  test("proxy object with a non-URL object url throws error", async () => {
    await expect(
      fetch(httpServer.url, {
        method: "GET",
        proxy: { url: {} },
        keepalive: false,
      }),
    ).rejects.toThrow("fetch() proxy URL is invalid");
  });

  test("proxy object with url and headers sends headers to proxy (HTTP proxy)", async () => {
    // Create a proxy server that captures headers
    const capturedHeaders: string[] = [];
    const proxyServerWithCapture = net.createServer((clientSocket: net.Socket) => {
      clientSocket.once("data", data => {
        const request = data.toString();
        // Capture headers
        const lines = request.split("\r\n");
        for (const line of lines) {
          if (line.toLowerCase().startsWith("x-proxy-")) {
            capturedHeaders.push(line.toLowerCase());
          }
        }

        const [method, path] = request.split(" ");
        let host: string;
        let port: number | string = 0;
        let request_path = "";
        if (path.indexOf("http") !== -1) {
          const url = new URL(path);
          host = url.hostname;
          port = url.port;
          request_path = url.pathname + (url.search || "");
        } else {
          [host, port] = path.split(":");
        }
        const destinationPort = Number.parseInt((port || (method === "CONNECT" ? "443" : "80")).toString(), 10);
        const destinationHost = host || "";

        const serverSocket = net.connect(destinationPort, destinationHost, () => {
          if (method === "CONNECT") {
            clientSocket.write("HTTP/1.1 200 OK\r\nHost: localhost\r\n\r\n");
            clientSocket.pipe(serverSocket);
            serverSocket.pipe(clientSocket);
          } else {
            serverSocket.write(`${method} ${request_path} HTTP/1.1\r\n`);
            serverSocket.write(data.slice(request.indexOf("\r\n") + 2));
            serverSocket.pipe(clientSocket);
          }
        });
        clientSocket.on("error", () => {});
        serverSocket.on("error", () => {
          clientSocket.end();
        });
      });
    });

    proxyServerWithCapture.listen(0);
    await once(proxyServerWithCapture, "listening");
    const proxyPort = (proxyServerWithCapture.address() as net.AddressInfo).port;
    const proxyUrl = `http://localhost:${proxyPort}`;

    try {
      const response = await fetch(httpServer.url, {
        method: "GET",
        proxy: {
          url: proxyUrl,
          headers: {
            "X-Proxy-Custom-Header": "custom-value",
            "X-Proxy-Another": "another-value",
          },
        },
        keepalive: false,
      });
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      // Verify the custom headers were sent to the proxy (case-insensitive check)
      expect(capturedHeaders).toContainEqual(expect.stringContaining("x-proxy-custom-header: custom-value"));
      expect(capturedHeaders).toContainEqual(expect.stringContaining("x-proxy-another: another-value"));
    } finally {
      proxyServerWithCapture.close();
      await once(proxyServerWithCapture, "close");
    }
  });

  test("proxy object with url and headers sends headers in CONNECT request (HTTPS target)", async () => {
    // Create a proxy server that captures headers
    const capturedHeaders: string[] = [];
    const proxyServerWithCapture = net.createServer((clientSocket: net.Socket) => {
      clientSocket.once("data", data => {
        const request = data.toString();
        // Capture headers
        const lines = request.split("\r\n");
        for (const line of lines) {
          if (line.toLowerCase().startsWith("x-proxy-")) {
            capturedHeaders.push(line.toLowerCase());
          }
        }

        const [method, path] = request.split(" ");
        let host: string;
        let port: number | string = 0;
        if (path.indexOf("http") !== -1) {
          const url = new URL(path);
          host = url.hostname;
          port = url.port;
        } else {
          [host, port] = path.split(":");
        }
        const destinationPort = Number.parseInt((port || (method === "CONNECT" ? "443" : "80")).toString(), 10);
        const destinationHost = host || "";

        const serverSocket = net.connect(destinationPort, destinationHost, () => {
          if (method === "CONNECT") {
            clientSocket.write("HTTP/1.1 200 OK\r\nHost: localhost\r\n\r\n");
            clientSocket.pipe(serverSocket);
            serverSocket.pipe(clientSocket);
          } else {
            clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
            clientSocket.end();
          }
        });
        clientSocket.on("error", () => {});
        serverSocket.on("error", () => {
          clientSocket.end();
        });
      });
    });

    proxyServerWithCapture.listen(0);
    await once(proxyServerWithCapture, "listening");
    const proxyPort = (proxyServerWithCapture.address() as net.AddressInfo).port;
    const proxyUrl = `http://localhost:${proxyPort}`;

    try {
      const response = await fetch(httpsServer.url, {
        method: "GET",
        proxy: {
          url: proxyUrl,
          headers: new Headers({
            "X-Proxy-Auth-Token": "secret-token-123",
          }),
        },
        keepalive: false,
        tls: {
          ca: tlsCert.cert,
          rejectUnauthorized: false,
        },
      });
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      // Verify the custom headers were sent in the CONNECT request (case-insensitive check)
      expect(capturedHeaders).toContainEqual(expect.stringContaining("x-proxy-auth-token: secret-token-123"));
    } finally {
      proxyServerWithCapture.close();
      await once(proxyServerWithCapture, "close");
    }
  });

  test("proxy object without url is ignored (regression #25413)", async () => {
    // When proxy object doesn't have a 'url' property, it should be ignored
    // This ensures compatibility with libraries that pass URL objects as proxy
    const response = await fetch(httpServer.url, {
      method: "GET",
      proxy: {
        headers: { "X-Test": "value" },
      } as any,
      keepalive: false,
    });
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
  });

  test("proxy object with null url is ignored (regression #25413)", async () => {
    // When proxy.url is null, the proxy object should be ignored
    const response = await fetch(httpServer.url, {
      method: "GET",
      proxy: {
        url: null,
        headers: { "X-Test": "value" },
      } as any,
      keepalive: false,
    });
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
  });

  test("proxy object with empty string url throws error", async () => {
    await expect(
      fetch(httpServer.url, {
        method: "GET",
        proxy: {
          url: "",
          headers: { "X-Test": "value" },
        } as any,
        keepalive: false,
      }),
    ).rejects.toThrow("fetch() proxy URL is invalid");
  });

  test("proxy object with empty headers object works", async () => {
    const response = await fetch(httpServer.url, {
      method: "GET",
      proxy: {
        url: httpProxyServer.url,
        headers: {},
      },
      keepalive: false,
    });
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
  });

  test("proxy object with undefined headers works", async () => {
    const response = await fetch(httpServer.url, {
      method: "GET",
      proxy: {
        url: httpProxyServer.url,
        headers: undefined,
      },
      keepalive: false,
    });
    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
  });

  test("proxy object with headers as Headers instance", async () => {
    const capturedHeaders: string[] = [];
    const proxyServerWithCapture = net.createServer((clientSocket: net.Socket) => {
      clientSocket.once("data", data => {
        const request = data.toString();
        const lines = request.split("\r\n");
        for (const line of lines) {
          if (line.toLowerCase().startsWith("x-custom-")) {
            capturedHeaders.push(line.toLowerCase());
          }
        }

        const [method, path] = request.split(" ");
        let host: string;
        let port: number | string = 0;
        let request_path = "";
        if (path.indexOf("http") !== -1) {
          const url = new URL(path);
          host = url.hostname;
          port = url.port;
          request_path = url.pathname + (url.search || "");
        } else {
          [host, port] = path.split(":");
        }
        const destinationPort = Number.parseInt((port || "80").toString(), 10);
        const destinationHost = host || "";

        const serverSocket = net.connect(destinationPort, destinationHost, () => {
          serverSocket.write(`${method} ${request_path} HTTP/1.1\r\n`);
          serverSocket.write(data.slice(request.indexOf("\r\n") + 2));
          serverSocket.pipe(clientSocket);
        });
        clientSocket.on("error", () => {});
        serverSocket.on("error", () => {
          clientSocket.end();
        });
      });
    });

    proxyServerWithCapture.listen(0);
    await once(proxyServerWithCapture, "listening");
    const proxyPort = (proxyServerWithCapture.address() as net.AddressInfo).port;
    const proxyUrl = `http://localhost:${proxyPort}`;

    try {
      const headers = new Headers();
      headers.set("X-Custom-Header-1", "value1");
      headers.set("X-Custom-Header-2", "value2");

      const response = await fetch(httpServer.url, {
        method: "GET",
        proxy: {
          url: proxyUrl,
          headers: headers,
        },
        keepalive: false,
      });
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      // Case-insensitive check
      expect(capturedHeaders).toContainEqual(expect.stringContaining("x-custom-header-1: value1"));
      expect(capturedHeaders).toContainEqual(expect.stringContaining("x-custom-header-2: value2"));
    } finally {
      proxyServerWithCapture.close();
      await once(proxyServerWithCapture, "close");
    }
  });

  test("user-provided Proxy-Authorization header overrides URL credentials", async () => {
    const capturedHeaders: string[] = [];
    const proxyServerWithCapture = net.createServer((clientSocket: net.Socket) => {
      clientSocket.once("data", data => {
        const request = data.toString();
        const lines = request.split("\r\n");
        for (const line of lines) {
          if (line.toLowerCase().startsWith("proxy-authorization:")) {
            capturedHeaders.push(line.toLowerCase());
          }
        }

        const [method, path] = request.split(" ");
        let host: string;
        let port: number | string = 0;
        let request_path = "";
        if (path.indexOf("http") !== -1) {
          const url = new URL(path);
          host = url.hostname;
          port = url.port;
          request_path = url.pathname + (url.search || "");
        } else {
          [host, port] = path.split(":");
        }
        const destinationPort = Number.parseInt((port || "80").toString(), 10);
        const destinationHost = host || "";

        const serverSocket = net.connect(destinationPort, destinationHost, () => {
          serverSocket.write(`${method} ${request_path} HTTP/1.1\r\n`);
          serverSocket.write(data.slice(request.indexOf("\r\n") + 2));
          serverSocket.pipe(clientSocket);
        });
        clientSocket.on("error", () => {});
        serverSocket.on("error", () => {
          clientSocket.end();
        });
      });
    });

    proxyServerWithCapture.listen(0);
    await once(proxyServerWithCapture, "listening");
    const proxyPort = (proxyServerWithCapture.address() as net.AddressInfo).port;
    // Proxy URL with credentials that would generate Basic auth
    const proxyUrl = `http://urluser:urlpass@localhost:${proxyPort}`;

    try {
      const response = await fetch(httpServer.url, {
        method: "GET",
        proxy: {
          url: proxyUrl,
          headers: {
            // User-provided Proxy-Authorization should override the URL-based one
            "Proxy-Authorization": "Bearer custom-token-12345",
          },
        },
        keepalive: false,
      });
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      // Should only have one Proxy-Authorization header (the user-provided one)
      expect(capturedHeaders.length).toBe(1);
      expect(capturedHeaders[0]).toBe("proxy-authorization: bearer custom-token-12345");
    } finally {
      proxyServerWithCapture.close();
      await once(proxyServerWithCapture, "close");
    }
  });

  // https://github.com/oven-sh/bun/issues/33645
  test("proxy as URL instance routes through the proxy", async () => {
    // A URL instance has no own `.url` property, so it previously fell through
    // the `{url, headers}` object branch and was silently ignored (the request
    // went DIRECT). Verify a URL instance is honored like the equivalent string.
    let proxyHit = false;
    const proxySrv = net.createServer(sock => {
      proxyHit = true;
      sock.on("error", () => {});
      sock.on("data", () => {
        sock.end("HTTP/1.1 200 OK\r\nContent-Length: 10\r\nConnection: close\r\n\r\nFROM_PROXY");
      });
    });
    proxySrv.listen(0, "127.0.0.1");
    await once(proxySrv, "listening");
    try {
      const proxyUrl = new URL(`http://127.0.0.1:${(proxySrv.address() as net.AddressInfo).port}`);
      expect(proxyUrl).toBeInstanceOf(URL);
      const response = await fetch(httpServer.url, {
        method: "GET",
        proxy: proxyUrl,
        keepalive: false,
      });
      expect(await response.text()).toBe("FROM_PROXY");
      expect(response.status).toBe(200);
      expect(proxyHit).toBe(true);
    } finally {
      proxySrv.close();
      await once(proxySrv, "close");
    }
  });
});

// https://github.com/oven-sh/bun/issues/33645
test("WebSocket proxy as URL instance routes through the proxy", async () => {
  // Same bug on the WebSocket side (JSWebSocket.cpp constructJSWebSocket3): a
  // URL instance fell through the {url, headers} object branch and was silently
  // ignored (connected DIRECT). Run in a subprocess with NO_PROXY cleared so an
  // ambient NO_PROXY=127.0.0.1 cannot suppress the explicit proxy.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const net = require("node:net");
        let proxyHit = false;
        const proxySrv = net.createServer(sock => {
          proxyHit = true;
          sock.on("error", () => {});
          sock.destroy();
        });
        await new Promise(r => proxySrv.listen(0, "127.0.0.1", r));
        const proxyPort = proxySrv.address().port;
        using wsServer = Bun.serve({
          port: 0,
          fetch(req, server) { if (server.upgrade(req)) return; return new Response("no", { status: 400 }); },
          websocket: { open(ws) { ws.send("FROM_ORIGIN"); }, message() {} },
        });
        const proxyUrl = new URL("http://127.0.0.1:" + proxyPort);
        if (!(proxyUrl instanceof URL)) throw new Error("expected URL instance");
        let via = "";
        await new Promise(resolve => {
          const ws = new WebSocket("ws://127.0.0.1:" + wsServer.port, { proxy: proxyUrl });
          ws.onmessage = ev => { via ||= "origin:" + ev.data; ws.close(); };
          ws.onerror = () => { via ||= "error"; };
          ws.onclose = () => { via ||= "close"; resolve(); };
        });
        proxySrv.close();
        console.log(JSON.stringify({ proxyHit, via }));
      `,
    ],
    env: {
      ...bunEnv,
      NO_PROXY: undefined,
      no_proxy: undefined,
      HTTP_PROXY: undefined,
      http_proxy: undefined,
      HTTPS_PROXY: undefined,
      https_proxy: undefined,
    },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) console.error("stderr:", stderr);
  const out = JSON.parse(stdout.trim());
  // The proxy destroys the socket immediately, so the WebSocket errors; what
  // matters is that it hit the proxy instead of reaching the origin.
  expect(out).toEqual({ proxyHit: true, via: "error" });
  expect(exitCode).toBe(0);
});

describe.concurrent("NO_PROXY with explicit proxy option", () => {
  // These tests use subprocess spawning because NO_PROXY is read from the
  // process environment at startup. A dead proxy that immediately closes
  // connections is used so that if NO_PROXY doesn't work, the fetch fails
  // with a connection error.
  let deadProxyPort: number;
  let deadProxy: ReturnType<typeof Bun.listen>;

  beforeAll(() => {
    deadProxy = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(socket) {
          socket.end();
        },
        data() {},
      },
    });
    deadProxyPort = deadProxy.port;
  });

  afterAll(() => {
    deadProxy.stop(true);
  });

  test("NO_PROXY bypasses explicit proxy for fetch", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const resp = await fetch("http://localhost:${httpServer.port}", { proxy: "http://127.0.0.1:${deadProxyPort}" }); console.log(resp.status);`,
      ],
      env: { ...bunEnv, NO_PROXY: "localhost" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) console.error("stderr:", stderr);
    expect(stdout.trim()).toBe("200");
    expect(exitCode).toBe(0);
  });

  test("NO_PROXY with port bypasses explicit proxy for fetch", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const resp = await fetch("http://localhost:${httpServer.port}", { proxy: "http://127.0.0.1:${deadProxyPort}" }); console.log(resp.status);`,
      ],
      env: { ...bunEnv, NO_PROXY: `localhost:${httpServer.port}` },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) console.error("stderr:", stderr);
    expect(stdout.trim()).toBe("200");
    expect(exitCode).toBe(0);
  });

  test("NO_PROXY non-match does not bypass explicit proxy", async () => {
    // NO_PROXY doesn't match, so fetch should try the dead proxy and fail
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `try { await fetch("http://localhost:${httpServer.port}", { proxy: "http://127.0.0.1:${deadProxyPort}" }); process.exit(1); } catch { process.exit(0); }`,
      ],
      env: { ...bunEnv, NO_PROXY: "other.com" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    // exit(0) means fetch threw (proxy connection failed), proving proxy was used
    expect(exitCode).toBe(0);
  });

  test("NO_PROXY set at runtime via process.env is observed by fetch", async () => {
    // Subprocess so we control the initial env and can mutate process.env
    // mid-script without polluting the test runner's process.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          // Dead proxy — if fetch uses it, connection fails.
          const deadProxy = "http://127.0.0.1:${deadProxyPort}";
          const target = "http://localhost:${httpServer.port}";

          // No NO_PROXY yet — fetch with explicit proxy should fail.
          let threw = false;
          try { await fetch(target, { proxy: deadProxy }); } catch { threw = true; }
          if (!threw) { console.error("expected first fetch to fail"); process.exit(1); }

          // Set NO_PROXY at runtime — subsequent fetch should bypass proxy.
          process.env.NO_PROXY = "localhost";
          const resp = await fetch(target, { proxy: deadProxy });
          console.log(resp.status);

          // Unset via empty string — should use proxy again (and fail).
          process.env.NO_PROXY = "";
          // Node.js semantics: read-back is "", not undefined.
          if (process.env.NO_PROXY !== "") {
            console.error("expected NO_PROXY to read back as '', got", JSON.stringify(process.env.NO_PROXY));
            process.exit(1);
          }
          threw = false;
          try { await fetch(target, { proxy: deadProxy }); } catch { threw = true; }
          if (!threw) { console.error("expected third fetch to fail"); process.exit(1); }

          process.exit(0);
        `,
      ],
      // Strip inherited NO_PROXY/no_proxy so the first fetch reliably
      // hits the dead proxy. Setting to "" wouldn't work — isNoProxy
      // checks lowercase first and an empty no_proxy would mask the
      // runtime-set uppercase NO_PROXY.
      env: (() => {
        const e = { ...bunEnv };
        delete e.NO_PROXY;
        delete e.no_proxy;
        return e;
      })(),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) console.error("stderr:", stderr);
    expect(stdout.trim()).toBe("200");
    expect(exitCode).toBe(0);
  });

  test("S3 ops use runtime process.env.HTTP_PROXY and survive overwrite while in flight", async () => {
    // Covers two things this PR introduced:
    //  1) S3's getHttpProxy() observes a runtime process.env.HTTP_PROXY write.
    //  2) executeSimpleS3Request dupes the env-derived proxy slice — thrashing
    //     HTTP_PROXY mid-request must not UAF the bytes the HTTP thread reads.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          import net from "node:net";

          // Mock S3 endpoint — only the proxy is supposed to reach this.
          let endpointHits = 0;
          using endpoint = Bun.serve({
            port: 0,
            fetch(req) {
              endpointHits++;
              return new Response("", {
                headers: { "content-length": "5", "etag": "abc" },
              });
            },
          });

          // Minimal forwarding HTTP proxy. For plain-HTTP proxying the
          // client sends an absolute-URI request line; we strip it to
          // origin-form and forward to the endpoint.
          let proxyHits = 0;
          const proxy = net.createServer(client => {
            client.once("data", data => {
              proxyHits++;
              const text = data.toString();
              const firstLine = text.slice(0, text.indexOf("\\r\\n"));
              const [method, absUrl, ver] = firstLine.split(" ");
              const u = new URL(absUrl);
              const upstream = net.connect(+u.port, u.hostname, () => {
                upstream.write(method + " " + u.pathname + (u.search || "") + " " + ver + "\\r\\n");
                upstream.write(text.slice(text.indexOf("\\r\\n") + 2));
                client.pipe(upstream);
                upstream.pipe(client);
              });
              upstream.on("error", () => client.destroy());
            });
          });
          await new Promise(r => proxy.listen(0, "127.0.0.1", r));
          const proxyUrl = "http://127.0.0.1:" + proxy.address().port;

          process.env.HTTP_PROXY = proxyUrl;

          const stat = Bun.S3Client.stat("key", {
            accessKeyId: "x",
            secretAccessKey: "y",
            bucket: "b",
            endpoint: endpoint.url.href,
          });

          // Thrash HTTP_PROXY so the original RefCountedEnvValue is freed
          // and its bytes reallocated before the HTTP thread reads them.
          for (let i = 0; i < 64; i++) {
            process.env.HTTP_PROXY = "http://" + Buffer.alloc(32 + i, "z").toString() + ".invalid:1/";
          }

          const r = await stat;
          proxy.close();
          if (proxyHits === 0) { console.error("proxy never saw the request"); process.exit(1); }
          if (endpointHits === 0) { console.error("endpoint never saw the request"); process.exit(1); }
          console.log(r.size);
          process.exit(0);
        `,
      ],
      env: (() => {
        const e = { ...bunEnv };
        delete e.HTTP_PROXY;
        delete e.http_proxy;
        delete e.NO_PROXY;
        delete e.no_proxy;
        return e;
      })(),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) console.error("stderr:", stderr);
    expect(stdout.trim()).toBe("5");
    expect(exitCode).toBe(0);
  });
});

describe("http_proxy/NO_PROXY re-evaluated per redirect hop", () => {
  // curl and Node's undici EnvHttpProxyAgent both re-run the proxy/no_proxy
  // decision against the post-redirect URL. Previously Bun resolved it once
  // from the original URL, so a redirect into a NO_PROXY host still went via
  // the proxy (and a redirect out of one bypassed it).
  let originA: Server;
  let originB: Server;
  let proxyLog: string[];
  let proxyAuth: (string | null)[];
  let proxy: ReturnType<typeof Bun.listen>;

  beforeAll(() => {
    originB = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("FINAL-ORIGIN-B"),
    });
    originA = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: req => {
        const to = new URL(req.url).searchParams.get("to") ?? `http://127.0.0.1:${originB.port}/final`;
        return new Response(null, { status: 302, headers: { Location: to, Connection: "close" } });
      },
    });
    proxyLog = [];
    proxyAuth = [];
    // Recording forward proxy: serves absolute-form requests itself so the
    // assertions can tell which hops went through it.
    proxy = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(s) {
          (s as any).buf = "";
        },
        data(s, raw) {
          let buf = ((s as any).buf += new TextDecoder("latin1").decode(raw));
          const i = buf.indexOf("\r\n\r\n");
          if (i < 0) return;
          const head = buf.slice(0, i).split("\r\n");
          const line = head[0]!;
          proxyLog.push(line);
          proxyAuth.push(
            head
              .find(h => h.toLowerCase().startsWith("proxy-authorization:"))
              ?.slice("proxy-authorization:".length)
              .trim() ?? null,
          );
          (s as any).buf = "";
          const m = /^GET http:\/\/[^/]+\/r302(?:\?to=([^ ]+))? /.exec(line);
          const loc = m ? (m[1] ? decodeURIComponent(m[1]) : `http://127.0.0.1:${originB.port}/final`) : null;
          s.write(
            loc
              ? `HTTP/1.1 302 Found\r\nLocation: ${loc}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`
              : `HTTP/1.1 200 OK\r\nContent-Length: 11\r\nConnection: close\r\n\r\nFINAL-PROXY`,
          );
          s.flush();
        },
        error() {},
        close() {},
        drain() {},
      },
    });
  });

  afterAll(() => {
    originA.stop(true);
    originB.stop(true);
    proxy.stop(true);
  });

  async function runFetch(env: Record<string, string | undefined>, url: string, useProxyOption = false) {
    proxyLog.length = 0;
    proxyAuth.length = 0;
    const script = useProxyOption
      ? `console.log(await (await fetch(process.env.U, { proxy: process.env.P })).text())`
      : `console.log(await (await fetch(process.env.U)).text())`;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: {
        ...bunEnv,
        NO_PROXY: undefined,
        no_proxy: undefined,
        HTTP_PROXY: undefined,
        http_proxy: undefined,
        HTTPS_PROXY: undefined,
        https_proxy: undefined,
        ...env,
        U: url,
        P: `http://127.0.0.1:${proxy.port}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode, proxyLog: [...proxyLog], proxyAuth: [...proxyAuth] };
  }

  test("redirect into NO_PROXY-exempt host goes direct (env http_proxy)", async () => {
    const { stdout, stderr, exitCode, proxyLog } = await runFetch(
      { http_proxy: `http://127.0.0.1:${proxy.port}`, no_proxy: `127.0.0.1:${originB.port}` },
      `http://127.0.0.1:${originA.port}/r302`,
    );
    expect({ stdout, proxyLog }).toEqual({
      stdout: "FINAL-ORIGIN-B",
      proxyLog: [`GET http://127.0.0.1:${originA.port}/r302 HTTP/1.1`],
    });
    if (exitCode !== 0) console.error("stderr:", stderr);
    expect(exitCode).toBe(0);
  });

  test("redirect out of NO_PROXY-exempt host goes via proxy (env http_proxy)", async () => {
    const { stdout, stderr, exitCode, proxyLog } = await runFetch(
      { http_proxy: `http://127.0.0.1:${proxy.port}`, no_proxy: `127.0.0.1:${originA.port}` },
      `http://127.0.0.1:${originA.port}/r302`,
    );
    // Hop 1 went direct to originA (exempt); hop 2 must be absolute-form via the proxy.
    expect({ stdout, proxyLog }).toEqual({
      stdout: "FINAL-PROXY",
      proxyLog: [`GET http://127.0.0.1:${originB.port}/final HTTP/1.1`],
    });
    if (exitCode !== 0) console.error("stderr:", stderr);
    expect(exitCode).toBe(0);
  });

  test("redirect into NO_PROXY-exempt host goes direct (explicit proxy option)", async () => {
    const { stdout, stderr, exitCode, proxyLog } = await runFetch(
      { no_proxy: `127.0.0.1:${originB.port}` },
      `http://127.0.0.1:${originA.port}/r302`,
      true,
    );
    expect({ stdout, proxyLog }).toEqual({
      stdout: "FINAL-ORIGIN-B",
      proxyLog: [`GET http://127.0.0.1:${originA.port}/r302 HTTP/1.1`],
    });
    if (exitCode !== 0) console.error("stderr:", stderr);
    expect(exitCode).toBe(0);
  });

  test("redirect into NO_PROXY-exempt host with credentialed http_proxy", async () => {
    // Covers the proxy_authorization lifecycle: the Basic auth Vec must be
    // clone-owned so dropping it on redirect is not a double-free under ASAN.
    const { stdout, stderr, exitCode, proxyLog, proxyAuth } = await runFetch(
      { http_proxy: `http://user:pass@127.0.0.1:${proxy.port}`, no_proxy: `127.0.0.1:${originB.port}` },
      `http://127.0.0.1:${originA.port}/r302`,
    );
    expect({ stdout, proxyLog, proxyAuth }).toEqual({
      stdout: "FINAL-ORIGIN-B",
      proxyLog: [`GET http://127.0.0.1:${originA.port}/r302 HTTP/1.1`],
      proxyAuth: ["Basic dXNlcjpwYXNz"],
    });
    if (exitCode !== 0) console.error("stderr:", stderr);
    expect(exitCode).toBe(0);
  });

  test("http->https redirect drops http_proxy when https_proxy is unset", async () => {
    // ProxySettings::resolve() picks by scheme: hop 2 (https) must not inherit
    // the http_proxy hop 1 used.
    await using originTls = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      tls: tlsCert,
      fetch: () => new Response("FINAL-ORIGIN-TLS"),
    });
    const to = encodeURIComponent(`https://127.0.0.1:${originTls.port}/final`);
    const { stdout, stderr, exitCode, proxyLog } = await runFetch(
      { http_proxy: `http://127.0.0.1:${proxy.port}`, NODE_TLS_REJECT_UNAUTHORIZED: "0" },
      `http://127.0.0.1:${originA.port}/r302?to=${to}`,
    );
    // Hop 1 via proxy (absolute-form GET with ?to=); hop 2 is https so http_proxy
    // does not apply and https_proxy is unset: no CONNECT should reach the proxy.
    expect({ stdout, proxyLog }).toEqual({
      stdout: "FINAL-ORIGIN-TLS",
      proxyLog: [`GET http://127.0.0.1:${originA.port}/r302?to=${to} HTTP/1.1`],
    });
    if (exitCode !== 0) console.error("stderr:", stderr);
    expect(exitCode).toBe(0);
  });

  test("no redirect: proxy decision still honors NO_PROXY", async () => {
    const { stdout, stderr, exitCode, proxyLog } = await runFetch(
      { http_proxy: `http://127.0.0.1:${proxy.port}`, no_proxy: `127.0.0.1:${originB.port}` },
      `http://127.0.0.1:${originB.port}/final`,
    );
    expect({ stdout, proxyLog }).toEqual({ stdout: "FINAL-ORIGIN-B", proxyLog: [] });
    if (exitCode !== 0) console.error("stderr:", stderr);
    expect(exitCode).toBe(0);
  });
});

test("non-200 CONNECT response from proxy is surfaced and its Location header is not followed", async () => {
  // RFC 9110 §9.3.6: a non-2xx response to CONNECT means the tunnel was not
  // established. The proxy's response must be returned to the caller, but a
  // Location header on it must never be followed — otherwise the original
  // method, body, and custom headers would be re-sent to whatever plaintext
  // origin the proxy names.

  // Records anything that reaches the address named in the proxy's Location
  // header. Nothing should ever arrive here.
  const reachedRedirectTarget: { method: string; apiKey: string | null; body: string }[] = [];
  using redirectTarget = Bun.serve({
    port: 0,
    async fetch(req) {
      reachedRedirectTarget.push({
        method: req.method,
        apiKey: req.headers.get("x-api-key"),
        body: await req.text(),
      });
      return new Response("redirect target reached");
    },
  });

  // Proxy that refuses the CONNECT with a redirect pointing at the plaintext
  // target above, instead of establishing the tunnel.
  const proxySockets = new Set<net.Socket>();
  const sawConnect: string[] = [];
  const proxy = net.createServer(clientSocket => {
    proxySockets.add(clientSocket);
    clientSocket.on("close", () => proxySockets.delete(clientSocket));
    clientSocket.on("error", () => {});
    clientSocket.once("data", data => {
      sawConnect.push(data.toString().split("\r\n")[0]);
      clientSocket.write(
        "HTTP/1.1 307 Temporary Redirect\r\n" +
          `Location: ${redirectTarget.url.origin}/\r\n` +
          "Content-Length: 0\r\n" +
          "\r\n",
      );
    });
  });
  proxy.listen(0);
  await once(proxy, "listening");
  const proxyPort = (proxy.address() as net.AddressInfo).port;

  try {
    const response = await fetch(httpsServer.url, {
      method: "POST",
      body: "secret request body",
      headers: { "X-Api-Key": "super-secret" },
      proxy: `http://localhost:${proxyPort}`,
      keepalive: false,
      tls: { ca: tlsCert.cert, rejectUnauthorized: false },
    });

    // The request did go through the proxy as a CONNECT...
    expect(sawConnect.length).toBe(1);
    expect(sawConnect[0]!.startsWith("CONNECT ")).toBe(true);
    // ...the proxy's refusal is surfaced to the caller as-is...
    expect(response.status).toBe(307);
    // ...and the Location header on the failed CONNECT is never followed:
    // the body and the X-Api-Key header must not reach the plaintext server
    // it points at.
    expect(reachedRedirectTarget).toEqual([]);
  } finally {
    for (const s of proxySockets) s.destroy();
    proxy.close();
    await once(proxy, "close");
  }
});
