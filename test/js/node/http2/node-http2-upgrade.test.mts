/**
 * Tests for the net.Server → Http2SecureServer upgrade path: the 'connection'
 * listener of tls.Server, which Http2SecureServer inherits, wraps the socket.
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
import { EventEmitter, once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import net from "node:net";
import os from "node:os";
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

// A Duplex that forwards to `socket`. It is no net.Socket, so the TLS layer reads it as a stream. A write completes
// when the socket has sent it, so the Duplex holds what the kernel has not taken.
function duplexOver(socket: net.Socket): Duplex {
  const duplex = new Duplex({
    read() {
      socket.resume();
    },
    write(chunk, encoding, callback) {
      socket.write(chunk, encoding, callback);
    },
    final(callback) {
      socket.end(callback);
    },
    destroy(err, callback) {
      socket.destroy();
      callback(err);
    },
  });
  socket.on("data", chunk => duplex.push(chunk) || socket.pause());
  socket.on("end", () => duplex.push(null));
  socket.on("error", err => duplex.destroy(err));
  socket.on("close", () => duplex.destroy());
  return duplex;
}

// A duplex of another streams implementation: it has the methods that Node's JSStreamSocket calls and is no
// stream.Duplex.
class EmitterDuplex extends EventEmitter {
  readable = true;
  writable = true;
  destroyed = false;
  #socket: net.Socket;
  #paused = false;
  #queued: Buffer[] = [];
  #ended = false;
  constructor(socket: net.Socket) {
    super();
    this.#socket = socket;
    socket.on("data", (chunk: Buffer) => {
      if (this.#paused) this.#queued.push(chunk);
      else this.emit("data", chunk);
    });
    socket.on("end", () => {
      this.#ended = true;
      this.#deliver();
    });
    socket.on("close", () => {
      this.destroyed = true;
      this.emit("close");
    });
    socket.on("error", err => this.emit("error", err));
    socket.on("drain", () => this.emit("drain"));
  }
  #deliver() {
    while (!this.#paused && this.#queued.length > 0) this.emit("data", this.#queued.shift());
    if (this.#ended && !this.#paused) {
      this.#ended = false;
      this.emit("end");
    }
  }
  pause() {
    this.#paused = true;
    return this;
  }
  resume() {
    this.#paused = false;
    process.nextTick(() => this.#deliver());
    return this;
  }
  cork() {}
  uncork() {}
  write(chunk: Buffer, ...rest: any[]) {
    return this.#socket.write(chunk, ...rest);
  }
  end(...args: any[]) {
    this.#socket.end(...args);
    return this;
  }
  destroy(err?: Error) {
    this.destroyed = true;
    this.#socket.destroy(err);
    return this;
  }
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
    // Nothing but the TLS wrap listens on rawSocket once it has been handed over. The TLSSocket reports the errors
    // of the socket it wraps: the session is destroyed with the error and the server sees 'sessionError'.
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
  type Inject = (h2Server: http2.Http2SecureServer, socket: net.Socket) => void;
  type Connect = (options: tls.ConnectionOptions) => tls.TLSSocket | Promise<tls.TLSSocket>;
  const injections: [string, Inject, Connect][] = [
    ["a raw socket", (h2Server, socket) => void h2Server.emit("connection", socket), options => tls.connect(options)],
    [
      // The TLS layer cannot take over the fd of a socket that has a plain write queued: it reads and writes the
      // socket as a stream.
      "a raw socket with a plain write still queued",
      (h2Server, socket) => {
        socket.cork();
        socket.write("!");
        h2Server.emit("connection", socket);
        socket.uncork();
      },
      async ({ host, port, ...options }) => {
        const socket = net.connect({ host, port: port as number, allowHalfOpen: true });
        // The server's plain byte comes ahead of its TLS records.
        assert.strictEqual(String((await once(socket, "data"))[0]), "!");
        return tls.connect({ ...options, socket });
      },
    ],
  ];
  for (const [name, inject, connect] of injections) {
    test(`what the server still has to send arrives, over ${name} that got the client's FIN`, async () => {
      const h2Server = http2.createSecureServer(TLS);
      const log: string[] = [];
      const first = Buffer.alloc(16 * 1024 * 1024, "a");
      const writing = Promise.withResolvers<tls.TLSSocket>();
      h2Server.on("error", (err: NodeJS.ErrnoException) => log.push(`server 'error': ${err.code}`));
      h2Server.on("unknownProtocol", socket => {
        socket.on("error", (err: NodeJS.ErrnoException) => log.push(`'error': ${err.code}`));
        socket.resume();
        // More than the kernel takes at once, so the writes behind it are still queued when the FIN arrives.
        socket.write(first, err => log.push(`write callback: ${(err as NodeJS.ErrnoException)?.code}`));
        socket.write("tail", err => log.push(`queued write callback: ${(err as NodeJS.ErrnoException)?.code}`));
        socket.write("third", err => log.push(`last write callback: ${(err as NodeJS.ErrnoException)?.code}`));
        writing.resolve(socket);
      });
      let raw: net.Socket | undefined;
      const netServer = net.createServer(socket => inject(h2Server, (raw = socket)));
      await once(netServer.listen(0, "127.0.0.1"), "listening");
      const port = (netServer.address() as net.AddressInfo).port;
      const options = { host: "127.0.0.1", port, rejectUnauthorized: false, allowHalfOpen: true };
      const client = await connect(options as tls.ConnectionOptions);
      try {
        client.on("error", err => log.push(`client 'error': ${(err as NodeJS.ErrnoException).code}`));
        await once(client, "secureConnect");
        const serverSide = await writing.promise;
        // A turn later only what the kernel did not take is left: on the TLS socket, or on the raw socket where the
        // TLS layer writes to it as a stream.
        await new Promise(resolve => setImmediate(resolve));
        assert.notStrictEqual(serverSide.writableLength + raw!.writableLength, 0);
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
  }
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

  test("after the session is destroyed", async () => {
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

  test("after a client that negotiated no protocol is turned away", async () => {
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

describe("HTTP/2 upgrade — a stream that is not reading when it is injected", () => {
  type Inject = (h2Server: http2.Http2SecureServer, socket: net.Socket) => void;
  const injections: [string, net.ServerOpts, Inject][] = [
    [
      "a paused net.Socket",
      {},
      (h2Server, socket) => {
        socket.pause();
        h2Server.emit("connection", socket);
      },
    ],
    [
      "the net.Socket of a pauseOnConnect server",
      { pauseOnConnect: true },
      (h2Server, socket) => void h2Server.emit("connection", socket),
    ],
    [
      "a net.Socket that is paused right after the emit",
      {},
      (h2Server, socket) => {
        h2Server.emit("connection", socket);
        socket.pause();
      },
    ],
    [
      "a net.Socket that is paused with the ClientHello put back",
      {},
      (h2Server, socket) => {
        socket.once("data", chunk => {
          socket.pause();
          socket.unshift(chunk);
          h2Server.emit("connection", socket);
        });
      },
    ],
    [
      "a paused Duplex",
      {},
      (h2Server, socket) => {
        const duplex = duplexOver(socket);
        duplex.pause();
        h2Server.emit("connection", duplex);
      },
    ],
    [
      "a paused stream that is no stream.Duplex",
      {},
      (h2Server, socket) => void h2Server.emit("connection", new EmitterDuplex(socket).pause()),
    ],
  ];
  for (const [name, netOptions, inject] of injections) {
    test(`${name} answers a GET and echoes a 1 MiB POST`, async () => {
      const h2Server = http2.createSecureServer(TLS, (req, res) => {
        if (req.method === "POST") req.pipe(res);
        else res.end("pong");
      });
      h2Server.on("error", () => {});
      const netServer = net.createServer(netOptions, socket => inject(h2Server, socket));
      await once(netServer.listen(0, "127.0.0.1"), "listening");
      const client = connectClient((netServer.address() as net.AddressInfo).port);
      try {
        const got = await request(client, "GET", "/");
        const body = Buffer.alloc(1024 * 1024, "x").toString();
        const echoed = await request(client, "POST", "/", body);
        assert.deepStrictEqual({ got: got.body, echoed: echoed.body.length }, { got: "pong", echoed: body.length });
      } finally {
        client.close();
        netServer.close();
      }
    });
  }

  test("a paused net.Socket of an allowHTTP1 server answers an HTTP/1.1 request", async () => {
    const h2Server = http2.createSecureServer({ ...TLS, allowHTTP1: true }, (_req, res) => res.end("pong"));
    h2Server.on("error", () => {});
    const netServer = net.createServer(socket => {
      socket.pause();
      h2Server.emit("connection", socket);
    });
    await once(netServer.listen(0, "127.0.0.1"), "listening");
    const port = (netServer.address() as net.AddressInfo).port;
    try {
      const answer = await new Promise<string>((resolve, reject) => {
        const req = https.get({ host: "127.0.0.1", port, rejectUnauthorized: false, agent: false }, res => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", chunk => (body += chunk));
          res.on("end", () => resolve(`${res.httpVersion} ${body}`));
        });
        req.on("error", reject);
      });
      assert.strictEqual(answer, "1.1 pong");
    } finally {
      netServer.close();
    }
  });

  test("a paused net.Socket stays paused, and nothing listens to its 'data'", async () => {
    // The TLS layer reads the socket below its stream, so the stream's flow state is the owner's.
    let raw: net.Socket | undefined;
    const h2Server = http2.createSecureServer(TLS, (_req, res) => res.end("pong"));
    h2Server.on("error", () => {});
    const netServer = net.createServer(socket => {
      raw = socket;
      socket.pause();
      h2Server.emit("connection", socket);
    });
    await once(netServer.listen(0, "127.0.0.1"), "listening");
    const client = connectClient((netServer.address() as net.AddressInfo).port);
    try {
      const got = await request(client, "GET", "/");
      assert.deepStrictEqual(
        { got: got.body, paused: raw!.isPaused(), dataListeners: raw!.listenerCount("data") },
        { got: "pong", paused: true, dataListeners: 0 },
      );
    } finally {
      client.close();
      netServer.close();
    }
  });
});

const frame = (type: number, flags: number, streamId: number, payload: Buffer = Buffer.alloc(0)) => {
  const header = Buffer.alloc(9);
  header.writeUIntBE(payload.length, 0, 3);
  header[3] = type;
  header[4] = flags;
  header.writeUInt32BE(streamId, 5);
  return Buffer.concat([header, payload]);
};
const PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
const [DATA, HEADERS, SETTINGS, WINDOW_UPDATE] = [0, 1, 4, 8];
const [ACK, END_STREAM, END_HEADERS] = [0x1, 0x1, 0x4];
// :method GET, :scheme https, :path /, :authority localhost
const GET = Buffer.concat([Buffer.from([0x82, 0x87, 0x84, 0x41, 0x09]), Buffer.from("localhost")]);
// The client's preface, with a window for a body of any size on the stream and on the connection.
function prefaceWithOpenWindows() {
  const settings = Buffer.alloc(6);
  settings.writeUInt16BE(4, 0);
  settings.writeUInt32BE(0x7fffffff, 2);
  const windowUpdate = Buffer.alloc(4);
  windowUpdate.writeUInt32BE(0x7fffffff - 65535, 0);
  return Buffer.concat([PREFACE, frame(SETTINGS, 0, 0, settings), frame(WINDOW_UPDATE, 0, 0, windowUpdate)]);
}
// Calls onFrame for every complete frame in what the client reads.
function readFrames(
  client: net.Socket,
  onFrame: (type: number, flags: number, streamId: number, length: number) => void,
) {
  let pending: Buffer = Buffer.alloc(0);
  client.on("data", (chunk: Buffer) => {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (pending.length >= 9) {
      const length = pending.readUIntBE(0, 3);
      if (pending.length < 9 + length) break;
      onFrame(pending[3], pending[4], pending.readUInt32BE(5) & 0x7fffffff, length);
      pending = pending.subarray(9 + length);
    }
  });
}
// What the kernel has not taken of the session's frames. In Bun it is in the session, in the stream of the TLS socket,
// or in the injected stream. Node keeps it below all three, so there the tests that need a held response rely on its
// size alone.
function assertHeldByTheServer(session: http2.Http2Session, socket: tls.TLSSocket, injected: net.Socket | Duplex) {
  if (process.versions.bun === undefined) return;
  const parser = (session as unknown as Record<symbol, { bufferSize(): number } | undefined>)[
    Symbol.for("::bunhttp2native::")
  ];
  assert.notStrictEqual((parser?.bufferSize() ?? 0) + socket.writableLength + injected.writableLength, 0);
}

describe("HTTP/2 upgrade — the server's TLS listener wraps the injected socket", () => {
  test("'connection' and 'secureConnection' listeners run, and the session is encrypted", async () => {
    const seen: Record<string, unknown> = {};
    let raw: net.Socket | undefined;
    const h2Server = http2.createSecureServer(TLS, (_req, res) => res.end("pong"));
    h2Server.on("error", () => {});
    h2Server.on("connection", socket => (seen["'connection' gets the raw socket"] = socket === raw));
    h2Server.on("secureConnection", (socket: tls.TLSSocket) => {
      seen["'secureConnection' gets a TLSSocket"] = socket instanceof tls.TLSSocket;
      seen["its alpnProtocol"] = socket.alpnProtocol;
    });
    h2Server.on("session", session => {
      seen["session.encrypted"] = session.encrypted;
      seen["session.alpnProtocol"] = session.alpnProtocol;
    });
    const netServer = net.createServer(socket => void h2Server.emit("connection", (raw = socket)));
    await once(netServer.listen(0, "127.0.0.1"), "listening");
    const client = connectClient((netServer.address() as net.AddressInfo).port);
    try {
      await request(client, "GET", "/");
      assert.deepStrictEqual(seen, {
        "'connection' gets the raw socket": true,
        "'secureConnection' gets a TLSSocket": true,
        "its alpnProtocol": "h2",
        "session.encrypted": true,
        "session.alpnProtocol": "h2",
      });
    } finally {
      client.close();
      netServer.close();
    }
  });

  test("a peer that never starts the handshake gets the server's handshakeTimeout", async () => {
    const h2Server = http2.createSecureServer({ ...TLS, handshakeTimeout: 50 });
    h2Server.on("error", () => {});
    const tlsClientError = once(h2Server, "tlsClientError");
    const netServer = net.createServer(socket => {
      socket.on("error", () => {});
      h2Server.emit("connection", socket);
    });
    await once(netServer.listen(0, "127.0.0.1"), "listening");
    const silent = net.connect((netServer.address() as net.AddressInfo).port, "127.0.0.1");
    silent.on("error", () => {});
    try {
      const [err] = await tlsClientError;
      assert.strictEqual(err.code, "ERR_TLS_HANDSHAKE_TIMEOUT");
    } finally {
      silent.destroy();
      netServer.close();
    }
  });

  test("a socket that is left flowing with the ClientHello put back gets no handshake", async () => {
    // The TLS layer reads below the socket's stream, and a flowing stream has dropped the chunk by the time the layer
    // looks for what the stream holds. A front that reads ahead has to pause the socket, as the rows above do.
    const h2Server = http2.createSecureServer({ ...TLS, handshakeTimeout: 50 });
    h2Server.on("error", () => {});
    h2Server.on("secureConnection", () => assert.fail("the ClientHello was dropped"));
    const tlsClientError = once(h2Server, "tlsClientError");
    const netServer = net.createServer(socket => {
      socket.on("error", () => {});
      socket.once("data", chunk => {
        socket.unshift(chunk);
        h2Server.emit("connection", socket);
      });
    });
    await once(netServer.listen(0, "127.0.0.1"), "listening");
    const port = (netServer.address() as net.AddressInfo).port;
    const client = tls.connect({ host: "127.0.0.1", port, rejectUnauthorized: false, ALPNProtocols: ["h2"] });
    client.on("error", () => {});
    try {
      const [err] = await tlsClientError;
      assert.strictEqual(err.code, "ERR_TLS_HANDSHAKE_TIMEOUT");
    } finally {
      client.destroy();
      netServer.close();
    }
  });

  test("what is no stream is refused with a TypeError out of emit()", () => {
    const h2Server = http2.createSecureServer(TLS);
    for (const value of [{}, 42, "text", new EventEmitter()]) {
      assert.throws(() => h2Server.emit("connection", value), TypeError);
    }
  });

  // The server asks for a certificate and lets a client in that shows none.
  const clients: [string, tls.ConnectionOptions, object][] = [
    [
      "a client with a certificate the server trusts",
      { key: TLS.key, cert: TLS.cert },
      { authorized: true, peer: "agent1", remoteAddress: "127.0.0.1" },
    ],
    ["a client without a certificate", {}, { authorized: false, peer: undefined, remoteAddress: "127.0.0.1" }],
  ];
  for (const [name, clientOptions, expected] of clients) {
    test(`requestCert without rejectUnauthorized: ${name} is served, and the socket tells who it is`, async () => {
      const seen = Promise.withResolvers<object>();
      const h2Server = http2.createSecureServer(
        {
          ...TLS,
          ca: fs.readFileSync(path.join(FIXTURES_PATH, "ca1-cert.pem")),
          requestCert: true,
          rejectUnauthorized: false,
        },
        (_req, res) => res.end("pong"),
      );
      h2Server.on("error", () => {});
      h2Server.on("secureConnection", (socket: tls.TLSSocket) => {
        seen.resolve({
          authorized: socket.authorized,
          peer: socket.getPeerCertificate()?.subject?.CN,
          remoteAddress: socket.remoteAddress,
        });
      });
      const netServer = net.createServer(socket => void h2Server.emit("connection", socket));
      await once(netServer.listen(0, "127.0.0.1"), "listening");
      const port = (netServer.address() as net.AddressInfo).port;
      const client = http2.connect(`https://127.0.0.1:${port}`, { rejectUnauthorized: false, ...clientOptions });
      client.on("error", () => {});
      try {
        const got = await request(client, "GET", "/");
        assert.deepStrictEqual({ got: got.body, ...(await seen.promise) }, { got: "pong", ...expected });
      } finally {
        client.close();
        netServer.close();
      }
    });
  }

  test("the server's ALPNCallback chooses the protocol", async () => {
    const offered: string[][] = [];
    const { ALPNProtocols: _, ...withoutProtocols } = TLS;
    const h2Server = http2.createSecureServer(
      {
        ...withoutProtocols,
        ALPNCallback: ({ protocols }: { protocols: string[] }) => {
          offered.push(protocols);
          return protocols.includes("h2") ? "h2" : undefined;
        },
      },
      (req, res) => res.end(`pong ${req.stream.session!.alpnProtocol}`),
    );
    h2Server.on("error", () => {});
    h2Server.on("tlsClientError", () => {});
    const netServer = net.createServer(socket => {
      socket.on("error", () => {});
      h2Server.emit("connection", socket);
    });
    await once(netServer.listen(0, "127.0.0.1"), "listening");
    const port = (netServer.address() as net.AddressInfo).port;
    const connect = (ALPNProtocols: string[]) =>
      tls.connect({ host: "127.0.0.1", port, rejectUnauthorized: false, ALPNProtocols });
    const client = http2.connect("https://localhost", { createConnection: () => connect(["h2"]) });
    client.on("error", () => {});
    const refused = connect(["xyz"]);
    try {
      const outcome = new Promise<string>(resolve => {
        refused.on("secureConnect", () => resolve("secureConnect"));
        refused.on("error", (err: NodeJS.ErrnoException) => resolve(`error:${err.code}`));
      });
      const got = await request(client, "GET", "/");
      assert.deepStrictEqual(
        { got: got.body, refused: await outcome, offered: offered.sort() },
        { got: "pong h2", refused: "error:ERR_SSL_TLSV1_ALERT_NO_APPLICATION_PROTOCOL", offered: [["h2"], ["xyz"]] },
      );
    } finally {
      client.close();
      refused.destroy();
      netServer.close();
    }
  });

  // A tunnel through the server itself: the client asks for it in the clear of the outer session, and the server
  // hands that session's socket to its own TLS listener for a second session inside the first.
  for (const how of ["a socket the server accepted", "an injected socket"]) {
    test(`${how}, emitted again after its handshake, gets a second TLS session inside the first`, async () => {
      const h2Server = http2.createSecureServer(TLS, (req, res) => res.end(`pong ${req.stream.session!.alpnProtocol}`));
      h2Server.on("error", () => {});
      // The outer session offers no protocol, so the server hands its socket over here.
      h2Server.on("unknownProtocol", (outer: tls.TLSSocket) => {
        outer.on("error", () => {});
        outer.write("TUNNEL");
        h2Server.emit("connection", outer);
      });
      const listener =
        how === "an injected socket" ? net.createServer(socket => void h2Server.emit("connection", socket)) : h2Server;
      await once(listener.listen(0, "127.0.0.1"), "listening");
      const port = (listener.address() as net.AddressInfo).port;
      const outer = tls.connect({ host: "127.0.0.1", port, rejectUnauthorized: false });
      outer.on("error", () => {});
      let client: http2.ClientHttp2Session | undefined;
      try {
        assert.strictEqual(String((await once(outer, "data"))[0]), "TUNNEL");
        client = http2.connect("https://localhost", {
          createConnection: () => tls.connect({ socket: outer, ALPNProtocols: ["h2"], rejectUnauthorized: false }),
        });
        client.on("error", () => {});
        const got = await request(client, "GET", "/");
        assert.strictEqual(got.body, "pong h2");
      } finally {
        client?.destroy();
        outer.destroy();
        listener.close();
      }
    });
  }
});

describe("HTTP/2 upgrade — the socket of an http 'connect' or 'upgrade' event", () => {
  const fronts = [
    [
      "connect",
      "CONNECT example.test:443 HTTP/1.1\r\nHost: example.test:443\r\n\r\n",
      "HTTP/1.1 200 Connection Established\r\n\r\n",
    ],
    [
      "upgrade",
      "GET / HTTP/1.1\r\nHost: example.test\r\nConnection: Upgrade\r\nUpgrade: tls\r\n\r\n",
      "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: tls\r\n\r\n",
    ],
  ];
  for (const [event, head, answer] of fronts) {
    test(`'${event}': the session is connected, and its destroy() closes the connection`, async () => {
      const sessionReady = Promise.withResolvers<http2.ServerHttp2Session>();
      const h2Server = http2.createSecureServer(TLS, (_req, res) => res.end("pong"));
      h2Server.on("error", () => {});
      h2Server.on("session", session => sessionReady.resolve(session));
      const front = http.createServer();
      front.on(event, (_req, socket: net.Socket) => {
        socket.write(answer);
        h2Server.emit("connection", socket);
      });
      await once(front.listen(0, "127.0.0.1"), "listening");
      const raw = net.connect((front.address() as net.AddressInfo).port, "127.0.0.1");
      try {
        raw.write(head);
        const answered = Promise.withResolvers<void>();
        let read = "";
        raw.on("data", function readAnswer(chunk) {
          read += chunk;
          if (!read.includes("\r\n\r\n")) return;
          raw.removeListener("data", readAnswer);
          answered.resolve();
        });
        await answered.promise;
        const client = http2.connect("https://example.test", {
          createConnection: () => tls.connect({ socket: raw, ALPNProtocols: ["h2"], rejectUnauthorized: false }),
        });
        client.on("error", () => {});
        const got = await request(client, "GET", "/");
        const session = await sessionReady.promise;
        assert.deepStrictEqual(
          { got: got.body, connecting: session.connecting, headerTableSize: session.localSettings.headerTableSize },
          { got: "pong", connecting: false, headerTableSize: 4096 },
        );
        const closed = once(client, "close");
        session.destroy();
        await closed;
      } finally {
        raw.destroy();
        front.closeAllConnections();
        front.close();
      }
    });
  }
});

describe("HTTP/2 upgrade — where the injected socket comes from", () => {
  test("a socket that the server dialed, handed over while it connects", async () => {
    // A reverse tunnel: the server dials a relay, and the relay joins a client to that connection.
    const h2Server = http2.createSecureServer(TLS, (req, res) => res.end(`pong ${req.socket.remoteAddress}`));
    h2Server.on("error", () => {});
    const sides: net.Socket[] = [];
    const join = (socket: net.Socket) => {
      socket.on("error", () => {});
      if (sides.push(socket) < 2) return;
      sides[0].pipe(sides[1]);
      sides[1].pipe(sides[0]);
    };
    const relayForServer = net.createServer(join);
    const relayForClient = net.createServer(join);
    await once(relayForServer.listen(0, "127.0.0.1"), "listening");
    await once(relayForClient.listen(0, "127.0.0.1"), "listening");
    const dialed = net.connect((relayForServer.address() as net.AddressInfo).port, "127.0.0.1");
    dialed.on("error", () => {});
    h2Server.emit("connection", dialed);
    const client = connectClient((relayForClient.address() as net.AddressInfo).port);
    try {
      const got = await request(client, "GET", "/");
      assert.strictEqual(got.body, "pong 127.0.0.1");
    } finally {
      client.close();
      dialed.destroy();
      relayForServer.close();
      relayForClient.close();
    }
  });

  test("a socket of a server that listens on a path", async () => {
    const socketPath =
      process.platform === "win32"
        ? `\\\\.\\pipe\\h2-upgrade-${process.pid}`
        : path.join(os.tmpdir(), `h2-upgrade-${process.pid}.sock`);
    const h2Server = http2.createSecureServer(TLS, (req, res) => {
      res.setHeader("x-encrypted", String(req.stream.session!.encrypted));
      req.pipe(res);
    });
    h2Server.on("error", () => {});
    const front = net.createServer(socket => void h2Server.emit("connection", socket));
    await once(front.listen(socketPath), "listening");
    const client = http2.connect("https://localhost", {
      createConnection: () => tls.connect({ path: socketPath, ALPNProtocols: ["h2"], rejectUnauthorized: false }),
    });
    client.on("error", () => {});
    try {
      const body = Buffer.alloc(1024 * 1024, "x").toString();
      const echoed = await request(client, "POST", "/", body);
      assert.deepStrictEqual(
        { encrypted: echoed.headers["x-encrypted"], echoed: echoed.body.length },
        { encrypted: "true", echoed: body.length },
      );
    } finally {
      client.close();
      front.close();
      if (process.platform !== "win32") fs.rmSync(socketPath, { force: true });
    }
  });

  // Node reads what a net.Socket holds through its handle, and throws when there is none.
  const needsHandle = process.versions.bun === undefined && "Node needs a handle under a net.Socket";
  test(
    "a net.Socket that has no handle: the session is connected, and its destroy() closes the connection",
    {
      skip: needsHandle,
    },
    async () => {
      // How a library puts a socket over a transport of its own.
      class Tunnel extends net.Socket {
        #under: net.Socket;
        constructor(under: net.Socket) {
          super();
          this.#under = under;
          under.on("data", chunk => this.push(chunk) || under.pause());
          under.on("end", () => this.push(null));
          under.on("error", err => this.destroy(err));
          under.on("close", () => this.destroy());
        }
        _read() {
          this.#under.resume();
        }
        _write(chunk: Buffer, encoding: BufferEncoding, callback: (err?: Error | null) => void) {
          this.#under.write(chunk, encoding, callback);
        }
        _final(callback: (err?: Error | null) => void) {
          this.#under.end(callback);
        }
        _destroy(err: Error | null, callback: (err?: Error | null) => void) {
          this.#under.destroy();
          callback(err);
        }
      }
      const sessionReady = Promise.withResolvers<http2.ServerHttp2Session>();
      const h2Server = http2.createSecureServer(TLS, (_req, res) => res.end("pong"));
      h2Server.on("error", () => {});
      h2Server.on("session", session => sessionReady.resolve(session));
      const netServer = net.createServer(socket => void h2Server.emit("connection", new Tunnel(socket)));
      await once(netServer.listen(0, "127.0.0.1"), "listening");
      const client = connectClient((netServer.address() as net.AddressInfo).port);
      try {
        const got = await request(client, "GET", "/");
        const session = await sessionReady.promise;
        assert.deepStrictEqual({ got: got.body, connecting: session.connecting }, { got: "pong", connecting: false });
        const closed = once(client, "close");
        session.destroy();
        await closed;
      } finally {
        client.destroy();
        netServer.close();
      }
    },
  );
});

describe("HTTP/2 upgrade — the peer ends the connection", () => {
  const shapes: [string, (socket: net.Socket) => net.Socket | Duplex][] = [
    ["an injected net.Socket", socket => socket],
    ["an injected Duplex", duplexOver],
  ];
  for (const [shape, streamOver] of shapes) {
    test(`a client that closes its session over ${shape} leaves no 'sessionError'`, async () => {
      const errors: (string | undefined)[] = [];
      const closed = Promise.withResolvers<void>();
      const h2Server = http2.createSecureServer(TLS, (_req, res) => res.end("pong"));
      h2Server.on("error", () => {});
      h2Server.on("sessionError", (err: NodeJS.ErrnoException) => errors.push(err.code));
      h2Server.on("session", session => session.on("close", () => closed.resolve()));
      const netServer = net.createServer(socket => {
        socket.on("error", () => {});
        const stream = streamOver(socket);
        stream.on("error", () => {});
        h2Server.emit("connection", stream);
      });
      await once(netServer.listen(0, "127.0.0.1"), "listening");
      const client = connectClient((netServer.address() as net.AddressInfo).port);
      try {
        const got = await request(client, "GET", "/");
        // Its GOAWAY and the close of its TLS session arrive together.
        client.close();
        await closed.promise;
        assert.deepStrictEqual({ got: got.body, errors }, { got: "pong", errors: [] });
      } finally {
        client.destroy();
        netServer.close();
      }
    });
  }

  // The server has most of the response still to send when the client goes away. Node's session does not read while
  // it writes, so the write meets the loss, and the session closes with no error.
  const departures: [
    string,
    (socket: net.Socket) => net.Socket | Duplex,
    (raw: net.Socket, secure: tls.TLSSocket) => void,
  ][] = [
    ["an injected net.Socket, the client destroys its socket", socket => socket, raw => void raw.destroy()],
    ["an injected net.Socket, the client ends its TLS session", socket => socket, (_raw, secure) => void secure.end()],
    ["an injected Duplex, the client ends its TLS session", duplexOver, (_raw, secure) => void secure.end()],
  ];
  for (const [name, streamOver, leave] of departures) {
    test(`under a response, the stream is cancelled and nothing reports an error: ${name}`, async () => {
      const body = Buffer.alloc(64 * 1024 * 1024, "a");
      const errors: string[] = [];
      const streamClosed = Promise.withResolvers<number>();
      const sessionClosed = Promise.withResolvers<void>();
      const h2Server = http2.createSecureServer(TLS);
      h2Server.on("error", () => {});
      h2Server.on("sessionError", (err: NodeJS.ErrnoException) => errors.push(`sessionError ${err.code}`));
      h2Server.on("session", session => session.on("close", () => sessionClosed.resolve()));
      h2Server.on("stream", (stream: http2.ServerHttp2Stream) => {
        stream.on("error", (err: NodeJS.ErrnoException) => errors.push(`stream 'error' ${err.code}`));
        stream.on("close", () => streamClosed.resolve(stream.rstCode));
        stream.respond({ ":status": 200 });
        stream.end(body);
      });
      const netServer = net.createServer(socket => {
        socket.on("error", () => {});
        const stream = streamOver(socket);
        stream.on("error", () => {});
        h2Server.emit("connection", stream);
      });
      await once(netServer.listen(0, "127.0.0.1"), "listening");
      const raw = net.connect((netServer.address() as net.AddressInfo).port, "127.0.0.1");
      raw.on("error", () => {});
      const secure = tls.connect({ socket: raw, ALPNProtocols: ["h2"], rejectUnauthorized: false });
      secure.on("error", () => {});
      const client = http2.connect("https://localhost", {
        createConnection: () => secure,
        settings: { initialWindowSize: 16 * 1024 * 1024 },
      });
      client.on("error", () => {});
      client.on("connect", () => client.setLocalWindowSize(body.length));
      try {
        const req = client.request({ ":path": "/" });
        req.on("error", () => {});
        let received = 0;
        req.on("data", function leaveOnce(chunk: Buffer) {
          if ((received += chunk.length) < 256 * 1024) return;
          req.removeListener("data", leaveOnce);
          leave(raw, secure);
        });
        const rstCode = await streamClosed.promise;
        await sessionClosed.promise;
        assert.deepStrictEqual({ rstCode, errors }, { rstCode: http2.constants.NGHTTP2_CANCEL, errors: [] });
      } finally {
        client.destroy();
        raw.destroy();
        netServer.close();
      }
    });
  }

  test("a reset with a stream open: the stream gets the error, and the server gets 'sessionError'", async () => {
    const streamOutcome = Promise.withResolvers<{ error: string | undefined; rstCode: number }>();
    const sessionError = Promise.withResolvers<string | undefined>();
    const h2Server = http2.createSecureServer(TLS);
    h2Server.on("error", () => {});
    h2Server.on("sessionError", (err: NodeJS.ErrnoException) => sessionError.resolve(err.code));
    h2Server.on("stream", (stream: http2.ServerHttp2Stream) => {
      let error: string | undefined;
      stream.on("error", (err: NodeJS.ErrnoException) => (error = err.code));
      stream.on("close", () => streamOutcome.resolve({ error, rstCode: stream.rstCode }));
      stream.respond({ ":status": 200 });
      stream.write("x");
    });
    const netServer = net.createServer(socket => {
      socket.on("error", () => {});
      h2Server.emit("connection", socket);
    });
    await once(netServer.listen(0, "127.0.0.1"), "listening");
    const raw = net.connect((netServer.address() as net.AddressInfo).port, "127.0.0.1");
    raw.on("error", () => {});
    const secure = tls.connect({ socket: raw, ALPNProtocols: ["h2"], rejectUnauthorized: false });
    secure.on("error", () => {});
    const client = http2.connect("https://localhost", { createConnection: () => secure });
    client.on("error", () => {});
    try {
      const req = client.request({ ":path": "/" });
      req.on("error", () => {});
      req.once("data", () => raw.resetAndDestroy());
      assert.deepStrictEqual(
        { stream: await streamOutcome.promise, sessionError: await sessionError.promise },
        {
          stream: { error: "ECONNRESET", rstCode: http2.constants.NGHTTP2_INTERNAL_ERROR },
          sessionError: "ECONNRESET",
        },
      );
    } finally {
      client.destroy();
      raw.destroy();
      netServer.close();
    }
  });
});

describe("HTTP/2 upgrade — the server closes the connection behind a large response", () => {
  const shapes: [string, (socket: net.Socket) => net.Socket | Duplex][] = [
    ["an injected net.Socket", socket => socket],
    ["an injected Duplex", duplexOver],
  ];
  for (const [shape, streamOver] of shapes) {
    for (const closer of ["session.close()", "server.close()"]) {
      test(`a response that is queued behind ${closer} arrives whole over ${shape}`, async () => {
        const body = Buffer.alloc(16 * 1024 * 1024, "a");
        const answered = Promise.withResolvers<http2.ServerHttp2Session>();
        const secured = Promise.withResolvers<tls.TLSSocket>();
        const h2Server = http2.createSecureServer(TLS);
        h2Server.on("error", () => {});
        h2Server.on("secureConnection", socket => secured.resolve(socket));
        h2Server.on("stream", (stream: http2.ServerHttp2Stream) => {
          stream.on("error", () => {});
          stream.respond({ ":status": 200 });
          stream.end(body);
          if (closer === "session.close()") stream.session!.close();
          else h2Server.close();
          answered.resolve(stream.session as http2.ServerHttp2Session);
        });
        let injected: net.Socket | Duplex | undefined;
        const netServer = net.createServer(socket => {
          socket.on("error", () => {});
          injected = streamOver(socket);
          injected.on("error", () => {});
          h2Server.emit("connection", injected);
        });
        await once(netServer.listen(0, "127.0.0.1"), "listening");
        const port = (netServer.address() as net.AddressInfo).port;
        const client = tls.connect({ host: "127.0.0.1", port, rejectUnauthorized: false, ALPNProtocols: ["h2"] });
        try {
          client.on("error", () => {});
          await once(client, "secureConnect");
          // The client reads nothing until the server has closed behind the response.
          client.pause();
          client.write(Buffer.concat([prefaceWithOpenWindows(), frame(HEADERS, END_STREAM | END_HEADERS, 1, GET)]));
          const session = await answered.promise;
          await new Promise(resolve => setImmediate(resolve));
          assertHeldByTheServer(session, await secured.promise, injected!);
          const seen = { data: 0, endStream: false };
          readFrames(client, (type, flags, streamId, length) => {
            if (type !== DATA || streamId !== 1) return;
            seen.data += length;
            if (flags & END_STREAM) seen.endStream = true;
          });
          client.resume();
          await once(client, "end");
          assert.deepStrictEqual(seen, { data: body.length, endStream: true });
        } finally {
          client.destroy();
          netServer.close();
        }
      });
    }
  }

  // A write over a stream completes when the stream has taken it, so 'finish' comes while the Duplex still holds most of
  // the response, and the HTTP/1.1 server destroys the socket at 'finish' (#43877).
  const finishesEarly = process.versions.bun !== undefined && "'finish' does not wait for the Duplex yet";
  for (const [shape, streamOver] of shapes) {
    test(
      `an HTTP/1.1 response with "Connection: close" arrives whole over ${shape}`,
      {
        todo: shape === "an injected Duplex" && finishesEarly,
      },
      async () => {
        const body = Buffer.alloc(16 * 1024 * 1024, "a");
        const h2Server = http2.createSecureServer({ ...TLS, allowHTTP1: true }, (_req, res) => {
          res.writeHead(200, { "content-length": body.length, "connection": "close" });
          res.end(body);
        });
        h2Server.on("error", () => {});
        const netServer = net.createServer(socket => {
          socket.on("error", () => {});
          const stream = streamOver(socket);
          stream.on("error", () => {});
          h2Server.emit("connection", stream);
        });
        await once(netServer.listen(0, "127.0.0.1"), "listening");
        const port = (netServer.address() as net.AddressInfo).port;
        const client = tls.connect({ host: "127.0.0.1", port, rejectUnauthorized: false, ALPNProtocols: ["http/1.1"] });
        try {
          client.on("error", () => {});
          await once(client, "secureConnect");
          client.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
          let received = 0;
          client.on("data", chunk => (received += chunk.length));
          await once(client, "close");
          // The status line and the headers come on top of the body.
          assert.ok(received > body.length, `received ${received} of more than ${body.length} bytes`);
        } finally {
          client.destroy();
          netServer.close();
        }
      },
    );
  }
});

describe("HTTP/2 upgrade — what the session of an injected socket still holds", () => {
  type Sockets = { raw: net.Socket; secure: tls.TLSSocket };
  type Injected = { port: number; sockets: Promise<Sockets>; close(): void };
  async function serve(onStream: (stream: http2.ServerHttp2Stream) => void): Promise<Injected> {
    const sockets = Promise.withResolvers<Sockets>();
    let raw: net.Socket;
    const h2Server = http2.createSecureServer(TLS);
    h2Server.on("error", () => {});
    h2Server.on("secureConnection", secure => sockets.resolve({ raw, secure }));
    h2Server.on("stream", onStream);
    const netServer = net.createServer(socket => void h2Server.emit("connection", (raw = socket)));
    await once(netServer.listen(0, "127.0.0.1"), "listening");
    const port = (netServer.address() as net.AddressInfo).port;
    return { port, sockets: sockets.promise, close: () => void netServer.close() };
  }

  test("a response that is still queued when the client sends its FIN arrives whole", async () => {
    const body = Buffer.alloc(16 * 1024 * 1024, "a");
    const log: string[] = [];
    const written = Promise.withResolvers<http2.ServerHttp2Session>();
    const server = await serve(stream => {
      stream.on("error", (err: NodeJS.ErrnoException) => log.push(`stream 'error': ${err.code}`));
      stream.on("close", () => log.push(`stream 'close' rstCode=${stream.rstCode}`));
      stream.respond({ ":status": 200 });
      // More than the kernel takes at once, so most of it is still the session's when the FIN arrives.
      stream.write(body, err => log.push(`write callback: ${(err as NodeJS.ErrnoException)?.code}`));
      stream.end("tail", () => log.push("end callback"));
      written.resolve(stream.session as http2.ServerHttp2Session);
    });
    const client = tls.connect({
      host: "127.0.0.1",
      port: server.port,
      allowHalfOpen: true,
      rejectUnauthorized: false,
      ALPNProtocols: ["h2"],
    } as tls.ConnectionOptions);
    try {
      client.on("error", () => {});
      await once(client, "secureConnect");
      client.write(Buffer.concat([prefaceWithOpenWindows(), frame(HEADERS, END_STREAM | END_HEADERS, 1, GET)]));
      const session = await written.promise;
      await new Promise(resolve => setImmediate(resolve));
      const { raw, secure } = await server.sockets;
      assertHeldByTheServer(session, secure, raw);
      client.end();
      // Its FIN is out before it reads the first byte.
      await once(client, "finish");
      let received = 0;
      readFrames(client, (type, _flags, streamId, length) => {
        if (type === DATA && streamId === 1) received += length;
      });
      await once(client, "end");
      // The stream's 'close' follows the last write callback.
      await new Promise(resolve => setImmediate(resolve));
      assert.deepStrictEqual(
        { received, log },
        {
          received: body.length + "tail".length,
          log: ["write callback: undefined", "end callback", "stream 'close' rstCode=0"],
        },
      );
    } finally {
      client.destroy();
      server.close();
    }
  });

  test("the responses to requests that arrive in one read leave in one TLS record", async () => {
    const requests = 32;
    const server = await serve(stream => {
      stream.respond({ ":status": 200 });
      stream.end("pong");
    });
    // Counts the TLS records (5-byte header, the length in its last two bytes) that the server sends.
    let records = 0;
    let bodyLeft = 0;
    let header = Buffer.alloc(0);
    function countRecords(chunk: Buffer) {
      for (let i = 0; i < chunk.length;) {
        if (bodyLeft > 0) {
          const take = Math.min(bodyLeft, chunk.length - i);
          bodyLeft -= take;
          i += take;
          continue;
        }
        const take = Math.min(5 - header.length, chunk.length - i);
        header = Buffer.concat([header, chunk.subarray(i, i + take)]);
        i += take;
        if (header.length === 5) {
          records++;
          bodyLeft = header.readUInt16BE(3);
          header = Buffer.alloc(0);
        }
      }
    }
    const forwarder = net.createServer(downstream => {
      const upstream = net.connect(server.port, "127.0.0.1");
      downstream.on("data", chunk => upstream.write(chunk));
      upstream.on("data", (chunk: Buffer) => {
        countRecords(chunk);
        downstream.write(chunk);
      });
      downstream.on("close", () => upstream.destroy());
      upstream.on("close", () => downstream.destroy());
      downstream.on("error", () => {});
      upstream.on("error", () => {});
    });
    await once(forwarder.listen(0, "127.0.0.1"), "listening");
    const port = (forwarder.address() as net.AddressInfo).port;
    const client = tls.connect({ host: "127.0.0.1", port, rejectUnauthorized: false, ALPNProtocols: ["h2"] });
    try {
      client.on("error", () => {});
      await once(client, "secureConnect");
      const settled = Promise.withResolvers<void>();
      const answered = Promise.withResolvers<void>();
      let settingsFrames = 0;
      let ended = 0;
      readFrames(client, (type, flags) => {
        // The server's SETTINGS and its ACK of ours.
        if (type === SETTINGS && ++settingsFrames === 2) settled.resolve();
        if (type === DATA && flags & END_STREAM && ++ended === requests) answered.resolve();
      });
      client.write(Buffer.concat([PREFACE, frame(SETTINGS, 0, 0)]));
      await settled.promise;
      const before = records;
      // One write is one TLS record, so the server gets every request in one read.
      client.write(
        Buffer.concat([
          frame(SETTINGS, ACK, 0),
          ...Array.from({ length: requests }, (_, i) => frame(HEADERS, END_STREAM | END_HEADERS, 1 + 2 * i, GET)),
        ]),
      );
      await answered.promise;
      assert.strictEqual(records - before, 1);
    } finally {
      client.destroy();
      forwarder.close();
      server.close();
    }
  });
});

if (typeof Bun !== "undefined") {
  describe("Node.js compatibility", () => {
    // The whole file again, in another runtime: the default timeout is for one test.
    test("tests should run on node.js", { timeout: 30_000 }, async () => {
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
