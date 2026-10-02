/**
 * Tests for the net.Server → Http2SecureServer upgrade path: a connection
 * handed in with `emit('connection')` gets tls.Server's own wrap.
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

describe("HTTP/2 upgrade — the server's whole TLS configuration applies", () => {
  const read = (name: string) => fs.readFileSync(path.join(FIXTURES_PATH, name));
  const agent1 = { key: read("agent1-key.pem"), cert: read("agent1-cert.pem") }; // issued by ca1
  const agent2 = { key: read("agent2-key.pem"), cert: read("agent2-cert.pem") }; // self-signed
  const agent3 = { key: read("agent3-key.pem"), cert: read("agent3-cert.pem") }; // issued by ca2
  const ca1 = read("ca1-cert.pem");
  const ca2 = read("ca2-cert.pem");

  type Door = "socket" | "Duplex";

  // A stream that is not a net.Socket in front of the raw connection.
  function asDuplex(raw: net.Socket) {
    const duplex = new Duplex({
      read() {},
      write(chunk, _encoding, callback) {
        raw.write(chunk, callback);
      },
      final(callback) {
        raw.end();
        callback();
      },
      destroy(err, callback) {
        raw.destroy();
        callback(err);
      },
    });
    raw.on("data", chunk => duplex.push(chunk));
    raw.on("end", () => duplex.push(null));
    raw.on("error", () => duplex.destroy());
    return duplex;
  }

  // A net.Server that hands each connection to `h2Server`, as the raw socket or behind a Duplex.
  async function inFront(h2Server: http2.Http2SecureServer, door: Door) {
    h2Server.on("error", () => {});
    const netServer = net.createServer(raw => {
      raw.on("error", () => {});
      h2Server.emit("connection", door === "Duplex" ? asDuplex(raw) : raw);
    });
    netServer.listen(0, "127.0.0.1");
    await once(netServer, "listening");
    return { netServer, port: (netServer.address() as net.AddressInfo).port };
  }

  type Answer = { cn?: string; status?: number; body?: string; failed?: true };

  // One HTTP/2 request over a TLS connection made with `options`: the
  // certificate the client was served and the answer, or `failed`.
  function get(port: number, options: tls.ConnectionOptions, body?: Buffer): Promise<Answer> {
    return new Promise(resolve => {
      let cn: string | undefined;
      const socket = tls.connect({
        port,
        host: "127.0.0.1",
        ALPNProtocols: ["h2"],
        rejectUnauthorized: false,
        ...options,
      });
      socket.on("secureConnect", () => {
        cn = socket.getPeerCertificate().subject?.CN;
      });
      const client = http2.connect("https://localhost", { createConnection: () => socket });
      let settled = false;
      const settle = (answer: Answer) => {
        if (settled) return;
        settled = true;
        client.destroy();
        resolve({ cn, ...answer });
      };
      client.on("error", () => settle({ failed: true }));
      client.on("close", () => settle({ failed: true }));
      const req = client.request({ ":path": "/", ":method": body ? "POST" : "GET" });
      let status: number | undefined;
      let text = "";
      req.on("response", headers => {
        status = headers[":status"];
      });
      req.setEncoding("utf8");
      req.on("data", chunk => {
        text += chunk;
      });
      // A stream that ends with no response headers was cut with its connection.
      req.on("end", () => settle(status === undefined ? { failed: true } : { status, body: text }));
      req.on("error", () => settle({ failed: true }));
      req.end(body);
    });
  }

  for (const door of ["socket", "Duplex"] as const) {
    test(`${door}: addContext() serves the name's certificate, and its ca judges the client`, async () => {
      // The default name trusts clients of ca1. *.tenant.test trusts only clients of ca2.
      const h2Server = http2.createSecureServer(
        { ...agent2, ca: ca1, requestCert: true, rejectUnauthorized: true },
        (_req, res) => res.end("ok"),
      );
      h2Server.addContext("*.tenant.test", { ...agent3, ca: ca2 });
      let refused = 0;
      h2Server.on("tlsClientError", () => refused++);
      const { netServer, port } = await inFront(h2Server, door);
      try {
        const clientOfCa1 = agent1;
        const clientOfCa2 = agent3;
        assert.deepStrictEqual(await get(port, { servername: "a.tenant.test", ...clientOfCa2 }), {
          cn: "agent3",
          status: 200,
          body: "ok",
        });
        assert.deepStrictEqual(await get(port, { servername: "other.test", ...clientOfCa1 }), {
          cn: "agent2",
          status: 200,
          body: "ok",
        });
        assert.strictEqual(refused, 0);
        const wrongCa = await get(port, { servername: "a.tenant.test", ...clientOfCa1 });
        assert.deepStrictEqual({ failed: wrongCa.failed, refused }, { failed: true, refused: 1 });
      } finally {
        netServer.close();
      }
    });

    test(`${door}: SNICallback and ALPNCallback are called`, async () => {
      const names: string[] = [];
      const offers: string[][] = [];
      const h2Server = http2.createSecureServer(
        {
          ...agent2,
          SNICallback(name, callback) {
            names.push(name);
            callback(null, tls.createSecureContext({ ...agent3 }));
          },
          ALPNCallback({ protocols }) {
            offers.push(protocols);
            return "h2";
          },
        },
        (_req, res) => res.end("ok"),
      );
      const { netServer, port } = await inFront(h2Server, door);
      try {
        assert.deepStrictEqual(await get(port, { servername: "tenant.test" }), {
          cn: "agent3",
          status: 200,
          body: "ok",
        });
        assert.deepStrictEqual({ names, offers }, { names: ["tenant.test"], offers: [["h2"]] });
      } finally {
        netServer.close();
      }
    });

    test(`${door}: handshakeTimeout closes a peer that sends nothing`, async () => {
      const h2Server = http2.createSecureServer({ ...agent2, handshakeTimeout: 100 });
      const timedOut = new Promise<string>(resolve => h2Server.on("tlsClientError", err => resolve(err.code)));
      const { netServer, port } = await inFront(h2Server, door);
      const silent = net.connect(port, "127.0.0.1");
      silent.on("error", () => {});
      try {
        const closed = once(silent, "close");
        assert.strictEqual(await timedOut, "ERR_TLS_HANDSHAKE_TIMEOUT");
        await closed;
      } finally {
        silent.destroy();
        netServer.close();
      }
    });

    test(`${door}: the server's 'connection' listeners run, and one of them can refuse the socket`, async () => {
      const seen: string[] = [];
      let shut = false;
      const h2Server = http2.createSecureServer({ ...agent2 }, (_req, res) => res.end("ok"));
      h2Server.on("connection", () => seen.push("on"));
      h2Server.prependListener("connection", socket => {
        seen.push("prepend");
        if (shut) socket.destroy();
      });
      const { netServer, port } = await inFront(h2Server, door);
      try {
        assert.deepStrictEqual(await get(port, {}), { cn: "agent2", status: 200, body: "ok" });
        shut = true;
        assert.strictEqual((await get(port, {})).failed, true);
        assert.deepStrictEqual(seen, ["prepend", "on", "prepend", "on"]);
      } finally {
        netServer.close();
      }
    });

    test(`${door}: the session's socket is a TLSSocket`, async () => {
      const seen = { secureConnection: [] as boolean[], session: [] as unknown[], keylog: 0 };
      const h2Server = http2.createSecureServer({ ...agent2 }, (req, res) => {
        req.setTimeout(60_000);
        res.end("ok");
      });
      h2Server.on("secureConnection", socket => seen.secureConnection.push(socket instanceof tls.TLSSocket));
      h2Server.on("session", session => seen.session.push([session.encrypted, session.alpnProtocol]));
      h2Server.on("keylog", () => seen.keylog++);
      const { netServer, port } = await inFront(h2Server, door);
      try {
        assert.deepStrictEqual(await get(port, {}), { cn: "agent2", status: 200, body: "ok" });
        assert.deepStrictEqual(
          { ...seen, keylog: seen.keylog > 0 },
          { secureConnection: [true], session: [[true, "h2"]], keylog: true },
        );
      } finally {
        netServer.close();
      }
    });

    test(`${door}: three concurrent 100 KB uploads are answered`, async () => {
      const h2Server = http2.createSecureServer({ ...agent2 }, (req, res) => {
        let received = 0;
        req.on("data", chunk => {
          received += chunk.length;
        });
        req.on("end", () => res.end(String(received)));
      });
      const { netServer, port } = await inFront(h2Server, door);
      try {
        const upload = Buffer.alloc(100_000, "x");
        const answers = await Promise.all([get(port, {}, upload), get(port, {}, upload), get(port, {}, upload)]);
        assert.deepStrictEqual(
          answers.map(answer => answer.body),
          ["100000", "100000", "100000"],
        );
      } finally {
        netServer.close();
      }
    });
  }

  test("allowHTTP1: an HTTP/1.1 peer that resets its connection leaves the server alive", async () => {
    const chunk = Buffer.alloc(64 * 1024, "b");
    const stalled = Promise.withResolvers<void>();
    const h2Server = http2.createSecureServer({ ...agent2, allowHTTP1: true }, (req, res) => {
      if (req.url !== "/big") return void res.end("ok");
      // 12 MB with backpressure. The peer reads nothing, so the connection stops taking bytes.
      let written = 0;
      const write = () => {
        while (written++ < 200) {
          if (!res.write(chunk)) {
            stalled.resolve();
            return void res.once("drain", write);
          }
        }
        res.end();
      };
      write();
    });
    h2Server.on("error", () => {});
    // The front puts no 'error' listener on the socket it hands over: the wrap owns it.
    const netServer = net.createServer(raw => void h2Server.emit("connection", raw));
    netServer.listen(0, "127.0.0.1");
    await once(netServer, "listening");
    const port = (netServer.address() as net.AddressInfo).port;
    // Resolves when the server side of the next connection has closed.
    const nextServerSideClose = () =>
      new Promise<void>(resolve => h2Server.once("secureConnection", socket => socket.on("close", () => resolve())));
    const dial = () =>
      new Promise<{ raw: net.Socket; client: tls.TLSSocket }>(resolve => {
        const raw = net.connect(port, "127.0.0.1");
        raw.on("error", () => {});
        const client = tls.connect({ socket: raw, rejectUnauthorized: false, ALPNProtocols: ["http/1.1"] }, () =>
          resolve({ raw, client }),
        );
        client.on("error", () => {});
      });
    try {
      // A download that the peer gives up: the server has bytes to write when the reset comes.
      let closed = nextServerSideClose();
      const download = await dial();
      download.client.pause();
      download.client.write("GET /big HTTP/1.1\r\nHost: x\r\n\r\n");
      await stalled.promise;
      download.raw.resetAndDestroy();
      await closed;

      // A reset right behind a request head that makes the server write '100 Continue'.
      closed = nextServerSideClose();
      const upload = await dial();
      upload.client.write("POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 10\r\nExpect: 100-continue\r\n\r\n", () =>
        upload.raw.resetAndDestroy(),
      );
      await closed;

      const healthy = await dial();
      let answer = "";
      healthy.client.setEncoding("latin1");
      healthy.client.on("data", data => {
        answer += data;
      });
      const ended = new Promise(resolve => healthy.client.on("end", resolve));
      healthy.client.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
      await ended;
      assert.match(answer, /^HTTP\/1\.1 200 OK\r\n[^]*\r\n\r\nok$/);
    } finally {
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
