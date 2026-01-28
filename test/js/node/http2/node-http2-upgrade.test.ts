/**
 * Tests for the net.Server → Http2SecureServer upgrade path
 * (upgradeRawSocketToH2 in _http2_upgrade.ts).
 *
 * This pattern is used by http2-wrapper, crawlee, and other libraries that
 * accept raw TCP connections and upgrade them to HTTP/2 via
 * `h2Server.emit('connection', rawSocket)`.
 *
 * Works with both:
 *   bun bd test test/js/node/http2/node-http2-upgrade.test.ts
 *   node --experimental-strip-types --test test/js/node/http2/node-http2-upgrade.test.ts
 */
import assert from "node:assert";
import fs from "node:fs";
import http2 from "node:http2";
import net from "node:net";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = path.join(__dirname, "..", "test", "fixtures", "keys");

const TLS = {
  key: fs.readFileSync(path.join(FIXTURES_PATH, "agent1-key.pem")),
  cert: fs.readFileSync(path.join(FIXTURES_PATH, "agent1-cert.pem")),
  ALPNProtocols: ["h2"],
};

function createUpgradeServer(
  handler: (req: http2.Http2ServerRequest, res: http2.Http2ServerResponse) => void,
  opts: { onSession?: (session: http2.Http2Session) => void } = {},
): Promise<{ netServer: net.Server; h2Server: http2.Http2SecureServer; port: number }> {
  return new Promise(resolve => {
    const h2Server = http2.createSecureServer(TLS, handler);
    h2Server.on("error", () => {});
    if (opts.onSession) h2Server.on("session", opts.onSession);

    const netServer = net.createServer(socket => {
      h2Server.emit("connection", socket);
    });

    netServer.listen(0, "127.0.0.1", () => {
      resolve({ netServer, h2Server, port: (netServer.address() as net.AddressInfo).port });
    });
  });
}

function connectClient(port: number): http2.ClientHttp2Session {
  const client = http2.connect(`https://127.0.0.1:${port}`, { rejectUnauthorized: false });
  client.on("error", () => {});
  return client;
}

function request(
  client: http2.ClientHttp2Session,
  method: string,
  reqPath: string,
  body?: string,
): Promise<{ status: number; headers: http2.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = client.request({ ":method": method, ":path": reqPath });
    let responseBody = "";
    let responseHeaders: http2.IncomingHttpHeaders = {};
    req.on("response", hdrs => {
      responseHeaders = hdrs;
    });
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      responseBody += chunk;
    });
    req.on("end", () => {
      resolve({
        status: responseHeaders[":status"] as unknown as number,
        headers: responseHeaders,
        body: responseBody,
      });
    });
    req.on("error", reject);
    if (body !== undefined) req.end(body);
  });
}

describe("HTTP/2 upgrade via net.Server", () => {
  let servers: { netServer: net.Server }[] = [];
  let clients: http2.ClientHttp2Session[] = [];

  afterEach(() => {
    for (const c of clients) c.close();
    for (const s of servers) s.netServer.close();
    clients = [];
    servers = [];
  });

  test("GET request succeeds with 200 and custom headers", async () => {
    const srv = await createUpgradeServer((_req, res) => {
      res.writeHead(200, { "x-upgrade-test": "yes" });
      res.end("hello from upgraded server");
    });
    servers.push(srv);

    const client = connectClient(srv.port);
    clients.push(client);

    const result = await request(client, "GET", "/");
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.headers["x-upgrade-test"], "yes");
    assert.strictEqual(result.body, "hello from upgraded server");
  });

  test("POST request with body echoed back", async () => {
    const srv = await createUpgradeServer((_req, res) => {
      let body = "";
      _req.on("data", (chunk: string) => {
        body += chunk;
      });
      _req.on("end", () => {
        res.writeHead(200);
        res.end("echo:" + body);
      });
    });
    servers.push(srv);

    const client = connectClient(srv.port);
    clients.push(client);

    const result = await request(client, "POST", "/echo", "test payload");
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.body, "echo:test payload");
  });
});

describe("HTTP/2 upgrade — multiple requests on one connection", () => {
  test("three sequential requests share the same session", async () => {
    let count = 0;
    const srv = await createUpgradeServer((_req, res) => {
      count++;
      res.writeHead(200);
      res.end(String(count));
    });

    const client = connectClient(srv.port);

    const r1 = await request(client, "GET", "/");
    const r2 = await request(client, "GET", "/");
    const r3 = await request(client, "GET", "/");

    assert.strictEqual(r1.body, "1");
    assert.strictEqual(r2.body, "2");
    assert.strictEqual(r3.body, "3");

    client.close();
    srv.netServer.close();
  });
});

describe("HTTP/2 upgrade — session event", () => {
  test("h2Server emits session event", async () => {
    let sessionFired = false;
    const srv = await createUpgradeServer(
      (_req, res) => {
        res.writeHead(200);
        res.end("ok");
      },
      {
        onSession: () => {
          sessionFired = true;
        },
      },
    );

    const client = connectClient(srv.port);

    await request(client, "GET", "/");

    assert.strictEqual(sessionFired, true);

    client.close();
    srv.netServer.close();
  });
});

describe("HTTP/2 upgrade — concurrent clients", () => {
  test("two clients get independent sessions", async () => {
    const srv = await createUpgradeServer((_req, res) => {
      res.writeHead(200);
      res.end(_req.url);
    });

    const c1 = connectClient(srv.port);
    const c2 = connectClient(srv.port);

    const [r1, r2] = await Promise.all([request(c1, "GET", "/from-client-1"), request(c2, "GET", "/from-client-2")]);

    assert.strictEqual(r1.body, "/from-client-1");
    assert.strictEqual(r2.body, "/from-client-2");

    c1.close();
    c2.close();
    srv.netServer.close();
  });
});

describe("HTTP/2 upgrade — socket close ordering", () => {
  test("no crash when rawSocket.destroy() precedes session.close()", async () => {
    let rawSocket: net.Socket | undefined;
    let h2Session: http2.Http2Session | undefined;

    const h2Server = http2.createSecureServer(TLS, (_req, res) => {
      res.writeHead(200);
      res.end("done");
    });
    h2Server.on("error", () => {});
    h2Server.on("session", s => {
      h2Session = s;
    });

    const netServer = net.createServer(socket => {
      rawSocket = socket;
      h2Server.emit("connection", socket);
    });

    const port = await new Promise<number>(resolve => {
      netServer.listen(0, "127.0.0.1", () => resolve((netServer.address() as net.AddressInfo).port));
    });

    const client = connectClient(port);
    await request(client, "GET", "/");

    rawSocket!.destroy();
    await new Promise(r => setTimeout(r, 20));
    if (h2Session) h2Session.close();
    await new Promise(r => setTimeout(r, 20));

    client.close();
    netServer.close();
  });

  test("no crash when session.close() precedes rawSocket.destroy()", async () => {
    let rawSocket: net.Socket | undefined;
    let h2Session: http2.Http2Session | undefined;

    const h2Server = http2.createSecureServer(TLS, (_req, res) => {
      res.writeHead(200);
      res.end("done");
    });
    h2Server.on("error", () => {});
    h2Server.on("session", s => {
      h2Session = s;
    });

    const netServer = net.createServer(socket => {
      rawSocket = socket;
      h2Server.emit("connection", socket);
    });

    const port = await new Promise<number>(resolve => {
      netServer.listen(0, "127.0.0.1", () => resolve((netServer.address() as net.AddressInfo).port));
    });

    const client = connectClient(port);
    await request(client, "GET", "/");

    if (h2Session) h2Session.close();
    await new Promise(r => setTimeout(r, 20));
    rawSocket!.destroy();
    await new Promise(r => setTimeout(r, 20));

    client.close();
    netServer.close();
  });
});

describe("HTTP/2 upgrade — ALPN negotiation", () => {
  test("alpnProtocol is h2 after upgrade", async () => {
    let observedAlpn: string | undefined;
    const srv = await createUpgradeServer((_req, res) => {
      const session = _req.stream.session;
      if (session && session.socket) {
        observedAlpn = (session.socket as any).alpnProtocol;
      }
      res.writeHead(200);
      res.end("alpn-ok");
    });

    const client = connectClient(srv.port);
    await request(client, "GET", "/");

    assert.strictEqual(observedAlpn, "h2");

    client.close();
    srv.netServer.close();
  });
});

describe("HTTP/2 upgrade — varied status codes", () => {
  test("404 response with custom header", async () => {
    const srv = await createUpgradeServer((_req, res) => {
      res.writeHead(404, { "x-reason": "not-found" });
      res.end("not found");
    });

    const client = connectClient(srv.port);
    const result = await request(client, "GET", "/missing");

    assert.strictEqual(result.status, 404);
    assert.strictEqual(result.headers["x-reason"], "not-found");
    assert.strictEqual(result.body, "not found");

    client.close();
    srv.netServer.close();
  });

  test("302 redirect response", async () => {
    const srv = await createUpgradeServer((_req, res) => {
      res.writeHead(302, { location: "/" });
      res.end();
    });

    const client = connectClient(srv.port);
    const result = await request(client, "GET", "/redirect");

    assert.strictEqual(result.status, 302);
    assert.strictEqual(result.headers["location"], "/");

    client.close();
    srv.netServer.close();
  });

  test("large response body (8KB) through upgraded socket", async () => {
    const srv = await createUpgradeServer((_req, res) => {
      res.writeHead(200);
      res.end("x".repeat(8192));
    });

    const client = connectClient(srv.port);
    const result = await request(client, "GET", "/large");

    assert.strictEqual(result.body.length, 8192);

    client.close();
    srv.netServer.close();
  });
});

describe("HTTP/2 upgrade — client disconnect mid-response", () => {
  test("server does not crash when client destroys stream early", async () => {
    const streamClosed = Promise.withResolvers<void>();

    const srv = await createUpgradeServer((_req, res) => {
      res.writeHead(200);
      const interval = setInterval(() => {
        if (res.destroyed || res.writableEnded) {
          clearInterval(interval);
          return;
        }
        res.write("chunk\n");
      }, 5);
      _req.stream.on("close", () => {
        clearInterval(interval);
        streamClosed.resolve();
      });
    });

    const client = connectClient(srv.port);

    const streamReady = Promise.withResolvers<http2.ClientHttp2Stream>();
    const req = client.request({ ":method": "GET", ":path": "/" });
    req.on("response", () => streamReady.resolve(req));
    req.on("error", () => {});

    const stream = await streamReady.promise;
    stream.destroy();

    await streamClosed.promise;

    client.close();
    srv.netServer.close();
  });
});

describe("HTTP/2 upgrade — independent upgrade per connection", () => {
  test("three clients produce three distinct sessions", async () => {
    const sessions: http2.Http2Session[] = [];

    const srv = await createUpgradeServer(
      (_req, res) => {
        res.writeHead(200);
        res.end("ok");
      },
      { onSession: s => sessions.push(s) },
    );

    const c1 = connectClient(srv.port);
    const c2 = connectClient(srv.port);
    const c3 = connectClient(srv.port);

    await Promise.all([request(c1, "GET", "/"), request(c2, "GET", "/"), request(c3, "GET", "/")]);

    assert.strictEqual(sessions.length, 3);
    assert.notStrictEqual(sessions[0], sessions[1]);
    assert.notStrictEqual(sessions[1], sessions[2]);

    c1.close();
    c2.close();
    c3.close();
    srv.netServer.close();
  });
});
