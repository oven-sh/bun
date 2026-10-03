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
import { once } from "node:events";
import fs from "node:fs";
import http2 from "node:http2";
import net from "node:net";
import path from "node:path";
import { Duplex } from "node:stream";
import { afterEach, describe, test } from "node:test";
import tls from "node:tls";
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
    if (body !== undefined) {
      req.end(body);
    } else {
      req.end();
    }
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

    const socketClosed = Promise.withResolvers<void>();
    rawSocket!.once("close", () => socketClosed.resolve());
    rawSocket!.destroy();
    await socketClosed.promise;
    if (h2Session) h2Session.close();

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
    const socketClosed = Promise.withResolvers<void>();
    rawSocket!.once("close", () => socketClosed.resolve());
    rawSocket!.destroy();
    await socketClosed.promise;

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

describe("HTTP/2 upgrade — server TLS options", () => {
  test("minVersion from createSecureServer is enforced on injected connections", async () => {
    const h2Server = http2.createSecureServer({ ...TLS, minVersion: "TLSv1.3" }, (_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    h2Server.on("error", () => {});
    h2Server.on("sessionError", () => {});

    const netServer = net.createServer(socket => {
      socket.on("error", () => {});
      h2Server.emit("connection", socket);
    });
    const port = await new Promise<number>(resolve => {
      netServer.listen(0, "127.0.0.1", () => resolve((netServer.address() as net.AddressInfo).port));
    });

    try {
      const okClient = tls.connect({ host: "127.0.0.1", port, rejectUnauthorized: false, ALPNProtocols: ["h2"] });
      okClient.on("error", () => {});
      await once(okClient, "secureConnect");
      const negotiated = { protocol: okClient.getProtocol(), alpn: okClient.alpnProtocol };
      okClient.destroy();
      assert.deepStrictEqual(negotiated, { protocol: "TLSv1.3", alpn: "h2" });

      const oldClient = tls.connect({
        host: "127.0.0.1",
        port,
        rejectUnauthorized: false,
        ALPNProtocols: ["h2"],
        maxVersion: "TLSv1.2",
      });
      const outcome = await new Promise<{ secureConnect: boolean; protocol: string | null }>(resolve => {
        oldClient.on("secureConnect", () => resolve({ secureConnect: true, protocol: oldClient.getProtocol() }));
        oldClient.on("error", () => resolve({ secureConnect: false, protocol: null }));
        oldClient.on("close", () => resolve({ secureConnect: false, protocol: null }));
      });
      oldClient.destroy();
      assert.deepStrictEqual(outcome, { secureConnect: false, protocol: null });
    } finally {
      netServer.close();
    }
  });
});

// The net.Server keeps counting a connection it accepted until the socket it handed to
// h2Server.emit("connection") is destroyed, and netServer.close(cb) only calls back once that count
// is zero. Node destroys that socket together with the TLSSocket it wrapped it in, so the connection
// is released no matter how the server side went down. Every case below tears the connection down
// from the server side while the peer deliberately keeps its end of the TCP connection open, so the
// accepted socket only gets released if the upgrade path releases it.
describe("HTTP/2 upgrade — the accepted socket is released when the server side goes down", () => {
  type Accepted = { raw: net.Socket; closed: Promise<boolean> };

  async function acceptInto(h2Server: http2.Http2SecureServer) {
    const accepted = Promise.withResolvers<Accepted>();
    const netServer = net.createServer(raw => {
      const closed = new Promise<boolean>(resolve => raw.once("close", hadError => resolve(hadError)));
      accepted.resolve({ raw, closed });
      h2Server.emit("connection", raw);
    });
    const port = await new Promise<number>(resolve => {
      netServer.listen(0, "127.0.0.1", () => resolve((netServer.address() as net.AddressInfo).port));
    });
    return { netServer, port, accepted: accepted.promise };
  }

  // A TCP connection the peer never ends or destroys itself: the server's FIN only produces 'end'
  // here (allowHalfOpen), so the server's accepted socket stays open until the server destroys it.
  function connectHeldOpen(port: number) {
    const tcp = net.connect({ port, host: "127.0.0.1", allowHalfOpen: true });
    // Writes into a connection the server has already closed are expected to fail.
    tcp.on("error", () => {});
    return tcp;
  }

  // A TLS client riding on a held-open TCP connection through an in-memory carrier: whatever the
  // client's TLS layer does when the server closes the TLS session (end, destroy) stays on the
  // carrier and never closes the TCP connection underneath.
  function connectTlsHeldOpen(port: number, options: tls.ConnectionOptions) {
    const tcp = connectHeldOpen(port);
    const carrier = new Duplex({
      read() {},
      write(chunk, _encoding, callback) {
        // The client's reply to the server's close_notify may be written after the server (or the
        // test's cleanup) has closed the connection; there is nobody left to deliver it to.
        if (tcp.destroyed) return callback();
        tcp.write(chunk, () => callback());
      },
      final(callback) {
        callback();
      },
    });
    tcp.on("data", chunk => carrier.push(chunk));
    tcp.on("end", () => carrier.push(null));
    const client = tls.connect({ socket: carrier, rejectUnauthorized: false, ...options });
    client.on("error", () => {});
    client.resume();
    return { tcp, client };
  }

  // With the peer holding its side open, the accepted socket's 'close' can only come from the
  // server destroying it; a server that merely end()s it leaves this waiting until the test times out.
  async function assertReleased(netServer: net.Server, accepted: Promise<Accepted>) {
    const { raw, closed } = await accepted;
    // Torn down without an error, like the socket underneath a node TLSSocket.
    assert.strictEqual(await closed, false);
    assert.strictEqual(raw.destroyed, true);
    const connections = await new Promise<number>((resolve, reject) => {
      netServer.getConnections((err, count) => (err ? reject(err) : resolve(count)));
    });
    assert.strictEqual(connections, 0);
    await new Promise<void>(resolve => netServer.close(() => resolve()));
  }

  function cleanup(netServer: net.Server, tcp: net.Socket) {
    tcp.destroy();
    if (netServer.listening) netServer.close();
  }

  for (const handleClientError of [false, true]) {
    const variant = handleClientError ? "with a clientError listener" : "without a clientError listener";
    test(`after a failed handshake (${variant})`, async () => {
      const h2Server = http2.createSecureServer(TLS);
      const reported: string[] = [];
      if (handleClientError) h2Server.on("clientError", () => reported.push("clientError"));
      const tlsClientError = once(h2Server, "tlsClientError").then(() => reported.push("tlsClientError"));
      const { netServer, port, accepted } = await acceptInto(h2Server);

      const tcp = connectHeldOpen(port);
      tcp.on("connect", () => tcp.write("GET / HTTP/1.1\r\nHost: example\r\n\r\n"));
      tcp.resume();
      try {
        await tlsClientError;
        assert.deepStrictEqual(reported, handleClientError ? ["clientError", "tlsClientError"] : ["tlsClientError"]);
        await assertReleased(netServer, accepted);
      } finally {
        cleanup(netServer, tcp);
      }
    });
  }

  for (const withError of [true, false]) {
    test(`after the session is destroyed ${withError ? "with" : "without"} an error`, async () => {
      const h2Server = http2.createSecureServer(TLS);
      const sessionClosed = new Promise<void>(resolve => {
        h2Server.once("session", (session: http2.ServerHttp2Session) => {
          session.on("error", () => {});
          session.once("close", resolve);
          if (withError) session.destroy(new Error("torn down by the test"));
          else session.destroy();
        });
      });
      const { netServer, port, accepted } = await acceptInto(h2Server);

      const { tcp } = connectTlsHeldOpen(port, { ALPNProtocols: ["h2"] });
      try {
        await sessionClosed;
        await assertReleased(netServer, accepted);
      } finally {
        cleanup(netServer, tcp);
      }
    });
  }

  test("after the client certificate is rejected", async () => {
    const h2Server = http2.createSecureServer({ ...TLS, requestCert: true, rejectUnauthorized: true });
    h2Server.on("session", () => assert.fail("a rejected client must not get a session"));
    const tlsClientError = once(h2Server, "tlsClientError");
    const { netServer, port, accepted } = await acceptInto(h2Server);

    // The client presents a certificate the server has no CA for.
    const { tcp } = connectTlsHeldOpen(port, { ALPNProtocols: ["h2"], key: TLS.key, cert: TLS.cert });
    try {
      const [err] = await tlsClientError;
      assert.ok(err instanceof Error);
      await assertReleased(netServer, accepted);
    } finally {
      cleanup(netServer, tcp);
    }
  });

  test("after a client that negotiated no protocol is turned away", async () => {
    // Nothing handles 'unknownProtocol', so the server answers with a 403 and destroys the
    // connection once unknownProtocolTimeout has passed.
    const h2Server = http2.createSecureServer({ ...TLS, unknownProtocolTimeout: 0 });
    h2Server.on("session", () => assert.fail("a client without ALPN must not get a session"));
    const { netServer, port, accepted } = await acceptInto(h2Server);

    const { tcp } = connectTlsHeldOpen(port, {});
    try {
      await assertReleased(netServer, accepted);
    } finally {
      cleanup(netServer, tcp);
    }
  });

  test("but not while the session is alive", async () => {
    const h2Server = http2.createSecureServer(TLS);
    let session: http2.ServerHttp2Session | undefined;
    const sessionStarted = once(h2Server, "session").then(([s]) => {
      session = s;
    });
    const { netServer, port, accepted } = await acceptInto(h2Server);

    const { tcp, client } = connectTlsHeldOpen(port, { ALPNProtocols: ["h2"] });
    try {
      await Promise.all([sessionStarted, once(client, "secureConnect")]);
      const { raw } = await accepted;
      assert.strictEqual(raw.destroyed, false);
      const connections = await new Promise<number>(resolve => netServer.getConnections((_, count) => resolve(count)));
      assert.strictEqual(connections, 1);
    } finally {
      session?.destroy();
      cleanup(netServer, tcp);
    }
  });
});

if (typeof Bun !== "undefined") {
  describe("Node.js compatibility", () => {
    test("tests should run on node.js", async () => {
      await using proc = Bun.spawn({
        cmd: [Bun.which("node") || "node", "--test", import.meta.filename],
        stdout: "inherit",
        stderr: "inherit",
        stdin: "ignore",
      });
      assert.strictEqual(await proc.exited, 0);
    });
  });
}
