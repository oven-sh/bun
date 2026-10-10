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

  test("an error on rawSocket is the session's error, not an uncaught exception", async () => {
    // Nothing but the upgrade listens on rawSocket once it has been handed
    // over, so its error (a reset, EPIPE, a destroy(err) by its owner) has to
    // be reported the way a TLSSocket reports its wrapped socket's errors: the
    // session is destroyed with it and the server sees 'sessionError'.
    let rawSocket: net.Socket | undefined;
    const sessionReady = Promise.withResolvers<http2.Http2Session>();
    const sessionErrored = Promise.withResolvers<{ err: Error; session: http2.Http2Session }>();

    const h2Server = http2.createSecureServer(TLS, (_req, res) => {
      res.writeHead(200);
      res.end("done");
    });
    h2Server.on("error", () => {});
    h2Server.on("session", s => sessionReady.resolve(s));
    h2Server.on("sessionError", (err: Error, session: http2.Http2Session) => sessionErrored.resolve({ err, session }));

    const netServer = net.createServer(socket => {
      rawSocket = socket;
      h2Server.emit("connection", socket);
    });

    const port = await new Promise<number>(resolve => {
      netServer.listen(0, "127.0.0.1", () => resolve((netServer.address() as net.AddressInfo).port));
    });

    const client = connectClient(port);
    await request(client, "GET", "/");
    const h2Session = await sessionReady.promise;
    // Not events.once(): the session emits 'error' on its way to 'close'.
    const sessionClosed = new Promise<void>(resolve => h2Session.once("close", resolve));

    const transportError = new Error("transport failed");
    rawSocket!.destroy(transportError);

    await sessionClosed;
    const { err, session } = await sessionErrored.promise;
    assert.strictEqual(err, transportError);
    assert.deepStrictEqual(
      { sameSession: session === h2Session, destroyed: h2Session.destroyed },
      { sameSession: true, destroyed: true },
    );

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

  test("a client that offers no protocol the server speaks gets the server's alert, not a reset", async () => {
    const h2Server = http2.createSecureServer(TLS);
    h2Server.on("error", () => {});
    h2Server.on("tlsClientError", () => {});
    const netServer = net.createServer(socket => {
      socket.on("error", () => {});
      h2Server.emit("connection", socket);
    });
    await once(netServer.listen(0, "127.0.0.1"), "listening");
    const port = (netServer.address() as net.AddressInfo).port;

    // The server speaks only h2. It fails the handshake with a
    // no_application_protocol alert.
    const client = tls.connect({ host: "127.0.0.1", port, rejectUnauthorized: false, ALPNProtocols: ["xyz"] });
    try {
      const outcome = await new Promise<string>(resolve => {
        client.on("secureConnect", () => resolve("secureConnect"));
        client.on("error", (err: NodeJS.ErrnoException) => resolve(`error:${err.code}`));
        client.on("close", () => resolve("close"));
      });
      assert.strictEqual(outcome, "error:ERR_SSL_TLSV1_ALERT_NO_APPLICATION_PROTOCOL");
    } finally {
      client.destroy();
      netServer.close();
    }
  });
});

describe("HTTP/2 upgrade — the client closes its side first", () => {
  test("what the server still has to send arrives, over a raw socket that got the client's FIN", async () => {
    const h2Server = http2.createSecureServer(TLS);
    const log: string[] = [];
    const first = Buffer.alloc(16 * 1024 * 1024, "a");
    const writing = Promise.withResolvers<void>();
    h2Server.on("error", (err: NodeJS.ErrnoException) => log.push(`server 'error': ${err.code}`));
    h2Server.on("unknownProtocol", socket => {
      socket.on("error", (err: NodeJS.ErrnoException) => log.push(`'error': ${err.code}`));
      socket.resume();
      // More than the kernel takes at once, so the writes behind it are still queued when the FIN arrives.
      socket.write(first, err => log.push(`write callback: ${(err as NodeJS.ErrnoException)?.code}`));
      socket.write("tail", err => log.push(`queued write callback: ${(err as NodeJS.ErrnoException)?.code}`));
      socket.write("third", err => log.push(`last write callback: ${(err as NodeJS.ErrnoException)?.code}`));
      writing.resolve();
    });
    let raw: net.Socket | undefined;
    const netServer = net.createServer(socket => void h2Server.emit("connection", (raw = socket)));
    await once(netServer.listen(0, "127.0.0.1"), "listening");
    const port = (netServer.address() as net.AddressInfo).port;
    const options = { host: "127.0.0.1", port, rejectUnauthorized: false, allowHalfOpen: true };
    const client = tls.connect(options as tls.ConnectionOptions);
    try {
      client.on("error", err => log.push(`client 'error': ${(err as NodeJS.ErrnoException).code}`));
      await once(client, "secureConnect");
      await writing.promise;
      // A turn later only what the kernel did not take is left.
      await new Promise(resolve => setImmediate(resolve));
      if (process.versions.bun !== undefined) assert.notStrictEqual(raw?.writableLength, 0);
      let received = 0;
      const ended = once(client, "end");
      client.end();
      // Its FIN is out before it reads the first byte.
      await once(client, "finish");
      client.on("data", chunk => (received += chunk.length));
      await ended;
      assert.deepStrictEqual(
        { received, log },
        {
          received: first.length + "tail".length + "third".length,
          log: ["write callback: undefined", "queued write callback: undefined", "last write callback: undefined"],
        },
      );
    } finally {
      client.destroy();
      raw?.destroy();
      netServer.close();
    }
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

  test("unusable credentials are the server's error, and the injected connection is closed", async () => {
    // Node rejects the key inside createSecureServer(). Bun builds the
    // credentials on first use, which for a server that never listens is the
    // first injected connection, and then reports the failure the way
    // tls.Server does for server.emit('connection'): on the server's 'error'
    // event, with the connection closed quietly. In neither runtime is the
    // injected socket, which nothing listens to, where the error surfaces.
    let h2Server: http2.Http2SecureServer;
    try {
      h2Server = http2.createSecureServer({ key: "not a key", cert: "not a cert" });
    } catch (err) {
      assert.strictEqual((err as NodeJS.ErrnoException).code, "ERR_OSSL_PEM_NO_START_LINE");
      return;
    }
    const surfaced = Promise.withResolvers<NodeJS.ErrnoException>();
    h2Server.on("error", surfaced.resolve);

    let rawSocket: net.Socket | undefined;
    let emitReturned: boolean | undefined;
    const netServer = net.createServer(socket => {
      rawSocket = socket;
      emitReturned = h2Server.emit("connection", socket);
    });
    const port = await new Promise<number>(resolve => {
      netServer.listen(0, "127.0.0.1", () => resolve((netServer.address() as net.AddressInfo).port));
    });

    const client = net.connect(port, "127.0.0.1");
    client.on("error", () => {});
    try {
      const err = await surfaced.promise;
      assert.deepStrictEqual(
        { code: err.code, emitReturned, rawDestroyed: rawSocket!.destroyed },
        { code: "ERR_OSSL_PEM_NO_START_LINE", emitReturned: true, rawDestroyed: true },
      );
    } finally {
      client.destroy();
      netServer.close();
    }
  });
});

// The peer keeps its end of the TCP connection open in every case.
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

  function connectHeldOpen(port: number) {
    const tcp = net.connect({ port, host: "127.0.0.1", allowHalfOpen: true });
    tcp.on("error", () => {});
    return tcp;
  }

  // Whatever the client's TLS layer does when the server closes the session stays on the carrier.
  function connectTlsHeldOpen(port: number, options: tls.ConnectionOptions) {
    const tcp = connectHeldOpen(port);
    const carrier = new Duplex({
      read() {},
      write(chunk, _encoding, callback) {
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

  async function assertReleased(netServer: net.Server, accepted: Promise<Accepted>) {
    const { raw, closed } = await accepted;
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

  // Once the application has the socket, what it wrote may still be on its way when the session goes down: in Bun a write
  // over a stream completes before the stream has sent it. So the accepted socket is ended, not destroyed, and a client
  // that never closes its side holds it. Releasing it needs a write that completes as in Node (#43877).
  const heldByTheClient = process.versions.bun !== undefined && "the accepted socket waits for the client's FIN";

  test("after a failed handshake", async () => {
    const h2Server = http2.createSecureServer(TLS);
    const tlsClientError = once(h2Server, "tlsClientError");
    const { netServer, port, accepted } = await acceptInto(h2Server);

    const tcp = connectHeldOpen(port);
    tcp.on("connect", () => tcp.write("GET / HTTP/1.1\r\nHost: example\r\n\r\n"));
    tcp.resume();
    try {
      await tlsClientError;
      await assertReleased(netServer, accepted);
    } finally {
      cleanup(netServer, tcp);
    }
  });

  test("after the session is destroyed", { todo: heldByTheClient }, async () => {
    const h2Server = http2.createSecureServer(TLS);
    const sessionClosed = new Promise<void>(resolve => {
      h2Server.once("session", (session: http2.ServerHttp2Session) => {
        session.once("close", resolve);
        session.destroy();
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

  test("after the client certificate is rejected", async () => {
    const h2Server = http2.createSecureServer({ ...TLS, requestCert: true, rejectUnauthorized: true });
    h2Server.on("session", () => assert.fail("a rejected client must not get a session"));
    const tlsClientError = once(h2Server, "tlsClientError");
    const { netServer, port, accepted } = await acceptInto(h2Server);

    const { tcp } = connectTlsHeldOpen(port, { ALPNProtocols: ["h2"], key: TLS.key, cert: TLS.cert });
    try {
      const [err] = await tlsClientError;
      assert.ok(err instanceof Error);
      await assertReleased(netServer, accepted);
    } finally {
      cleanup(netServer, tcp);
    }
  });

  test("after a client that negotiated no protocol is turned away", { todo: heldByTheClient }, async () => {
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
});

describe("HTTP/2 upgrade — failed handshake", () => {
  type Outcome = { event: string; code?: string; library?: string; message?: string };

  async function handshakeOutcome(onConnect: (client: net.Socket) => void): Promise<Outcome> {
    const { promise, resolve } = Promise.withResolvers<Outcome>();
    const h2Server = http2.createSecureServer(TLS);
    h2Server.on("error", () => {});
    h2Server.on("tlsClientError", (err: NodeJS.ErrnoException & { library?: string }) =>
      resolve({ event: "tlsClientError", code: err.code, library: err.library, message: err.message }),
    );
    h2Server.on("secureConnection", () => resolve({ event: "secureConnection" }));

    const netServer = net.createServer(socket => {
      socket.on("error", () => {});
      h2Server.emit("connection", socket);
    });
    await once(netServer.listen(0, "127.0.0.1"), "listening");

    const client = net.connect((netServer.address() as net.AddressInfo).port, "127.0.0.1", () => onConnect(client));
    client.on("error", () => {});
    client.on("close", () => resolve({ event: "close" }));
    try {
      return await promise;
    } finally {
      client.destroy();
      netServer.close();
    }
  }

  test("a first record that is not TLS is reported as ERR_SSL_*", async () => {
    const { event, code, library } = await handshakeOutcome(client => client.write("not a TLS record\r\n\r\n"));
    assert.deepStrictEqual(
      { event, code, library },
      { event: "tlsClientError", code: "ERR_SSL_WRONG_VERSION_NUMBER", library: "SSL routines" },
    );
  });

  test("a client that hangs up before the handshake is reported as ECONNRESET", async () => {
    const { event, code, message } = await handshakeOutcome(client => client.end());
    assert.deepStrictEqual(
      { event, code, message },
      { event: "tlsClientError", code: "ECONNRESET", message: "socket hang up" },
    );
  });

  test("a client that ends the handshake with close_notify and stays connected is reported", async () => {
    const { event, code } = await handshakeOutcome(client =>
      client.write(Buffer.from([0x15, 0x03, 0x03, 0x00, 0x02, 0x01, 0x00])),
    );
    // BoringSSL reads the alert as the peer's close. OpenSSL refuses an alert ahead of the ClientHello.
    const expected = (process.features as { openssl_is_boringssl?: boolean }).openssl_is_boringssl
      ? "ECONNRESET"
      : "ERR_SSL_UNEXPECTED_MESSAGE";
    assert.deepStrictEqual({ event, code }, { event: "tlsClientError", code: expected });
  });
});

describe("HTTP/2 upgrade — fatal TLS error after the handshake", () => {
  test("a record that fails to decrypt reaches the server as sessionError", async () => {
    const h2Server = http2.createSecureServer(TLS, (_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    h2Server.on("error", () => {});
    // A clean session 'close' with no error before it is the bug.
    const outcome = new Promise<{ event: string; code?: string }>(resolve => {
      h2Server.on("sessionError", (err: NodeJS.ErrnoException) => resolve({ event: "sessionError", code: err.code }));
      h2Server.on("session", session => session.on("close", () => resolve({ event: "close" })));
    });
    const netServer = net.createServer(socket => {
      socket.on("error", () => {});
      h2Server.emit("connection", socket);
    });
    // A plain proxy in front of the net.Server, to inject bytes toward it.
    let toServer: net.Socket | undefined;
    const proxy = net.createServer(c => {
      toServer = net.connect((netServer.address() as net.AddressInfo).port, "127.0.0.1");
      c.pipe(toServer);
      toServer.pipe(c);
      c.on("error", () => {});
      toServer.on("error", () => {});
    });
    let client: http2.ClientHttp2Session | undefined;
    try {
      await once(netServer.listen(0, "127.0.0.1"), "listening");
      await once(proxy.listen(0, "127.0.0.1"), "listening");
      client = connectClient((proxy.address() as net.AddressInfo).port);
      const first = await request(client, "GET", "/");
      assert.strictEqual(first.status, 200);

      // application_data, 32 bytes of ciphertext that cannot authenticate.
      toServer!.write(Buffer.concat([Buffer.from([0x17, 0x03, 0x03, 0x00, 0x20]), Buffer.alloc(32, 0x42)]));

      assert.deepStrictEqual(await outcome, {
        event: "sessionError",
        code: "ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC",
      });
    } finally {
      client?.destroy();
      toServer?.destroy();
      proxy.close();
      netServer.close();
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
