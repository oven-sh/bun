import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir, tls as validCert } from "harness";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createReadStream, readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import net from "node:net";
import { join } from "node:path";
import { Duplex, pipeline } from "node:stream";
import tls from "node:tls";

function listen(server: http.Server): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  return promise;
}

// Resolves with everything the server wrote back to a bare HTTP/1.1 request.
function plaintextRequest(port: number): Promise<string> {
  const { promise, resolve } = Promise.withResolvers<string>();
  let received = "";
  const socket = net.connect(port, "127.0.0.1", () => {
    socket.write("GET /secret HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
  });
  socket.on("data", chunk => (received += chunk.toString("latin1")));
  socket.on("error", () => {});
  socket.on("close", () => resolve(received));
  return promise;
}

function tlsRequest(port: number): Promise<string> {
  const { promise, resolve } = Promise.withResolvers<string>();
  let received = "";
  const socket = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false }, () => {
    socket.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
  });
  socket.on("data", chunk => (received += chunk));
  socket.on("error", (err: NodeJS.ErrnoException) => resolve(String(err.code)));
  socket.on("close", () => resolve(received));
  return promise;
}

// Resolves with what a TLS client that sends nothing sees first: its handshake done, or the error that ended it.
function tlsHandshake(port: number): Promise<string> {
  const { promise, resolve } = Promise.withResolvers<string>();
  const socket = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false }, () => {
    resolve("secureConnect");
    socket.destroy();
  });
  socket.on("error", (err: NodeJS.ErrnoException) => resolve(String(err.code)));
  return promise;
}

describe.concurrent("https.Server with no usable key and cert", () => {
  test.each<[string, (handler: http.RequestListener) => http.Server]>([
    ["createServer(requestListener)", handler => https.createServer(handler)],
    ["createServer({}, requestListener)", handler => https.createServer({}, handler)],
    ["createServer(undefined, requestListener)", handler => https.createServer(undefined as any, handler)],
    ["createServer({ key: undefined, cert: undefined })", handler => https.createServer({ key: undefined, cert: undefined }, handler)], // prettier-ignore
    ["createServer({ requestCert: true })", handler => https.createServer({ requestCert: true }, handler)],
    ["new https.Server({}, requestListener)", handler => new https.Server({}, handler)],
    ["https.Server(requestListener)", handler => (https.Server as any)(handler)],
  ])("%s is a TLS listener that refuses every connection", async (_label, createServer) => {
    let requests = 0;
    await using server = createServer((_req, res) => {
      requests++;
      res.end("SECRET");
    });
    const port = await listen(server);

    const cleartext = await plaintextRequest(port);
    expect(cleartext).not.toContain("HTTP/");
    expect(cleartext).not.toContain("SECRET");
    // A cleartext listener yields ERR_SSL_WRONG_VERSION_NUMBER or ECONNRESET here.
    expect(await tlsRequest(port)).toContain("_ALERT_");
    expect(requests).toBe(0);
  });
});

test("https.Server is its own class and still serves TLS only when it has a key and cert", async () => {
  expect(https.Server).not.toBe(http.Server);
  expect(http.createServer()).not.toBeInstanceOf(https.Server);
  await using server = https.createServer({ ...validCert }, (req, res) => res.end(`encrypted=${(req.socket as tls.TLSSocket).encrypted}`)); // prettier-ignore
  expect(server).toBeInstanceOf(https.Server);
  const port = await listen(server);

  expect(await plaintextRequest(port)).not.toContain("HTTP/");
  expect(await tlsRequest(port)).toEndWith("encrypted=true");
});

// Bun only: Node's http.Server ignores key and cert. Deployments rely on this, it must never become cleartext.
test.skipIf(!process.versions.bun).each<[string, () => object]>([
  ["key and cert", () => ({ ...validCert })],
  ["key, cert and ca", () => ({ ...validCert, ca: validCert.cert })],
])("http.createServer() with %s serves TLS and never cleartext", async (_label, options) => {
  await using server = http.createServer(options(), (req, res) => res.end(`encrypted=${(req.socket as tls.TLSSocket).encrypted}`)); // prettier-ignore
  const port = await listen(server);

  expect(await plaintextRequest(port)).not.toContain("HTTP/");
  expect(await tlsRequest(port)).toEndWith("encrypted=true");
});

describe("new https.Server() applies the ALPN defaults of createServer()", () => {
  function wire(protocols: string[]) {
    const out = {} as { ALPNProtocols: Buffer };
    (tls as any).convertALPNProtocols(protocols, out);
    return out.ALPNProtocols;
  }

  test("defaults ALPNProtocols to http/1.1", () => {
    const server = new https.Server() as https.Server & { ALPNProtocols?: Buffer; ALPNCallback?: unknown };
    expect(server.ALPNProtocols).toEqual(wire(["http/1.1"]));
    expect(server.ALPNCallback).toBeUndefined();
  });

  test("keeps an explicit ALPNProtocols", () => {
    const server = new https.Server({ ALPNProtocols: ["h2", "http/1.1"] }) as https.Server & { ALPNProtocols?: Buffer };
    expect(server.ALPNProtocols).toEqual(wire(["h2", "http/1.1"]));
  });

  test("stores ALPNCallback and skips the default protocol list", () => {
    const ALPNCallback = () => "http/1.1";
    const server = new https.Server({ ALPNCallback }) as https.Server & { ALPNProtocols?: Buffer; ALPNCallback?: unknown }; // prettier-ignore
    expect(server.ALPNCallback).toBe(ALPNCallback);
    expect(server.ALPNProtocols).toBeUndefined();
  });
});

describe("https.createServer forwards every TLS server option", () => {
  const read = (name: string) => readFileSync(join(import.meta.dirname, "../test/fixtures/keys", name), "utf8");
  // ca2 signs agent3 and agent4; ca2-crl-agent3.pem revokes agent3 only.
  const mtls = {
    key: read("agent1-key.pem"),
    cert: read("agent1-cert.pem"),
    ca: read("ca2-cert.pem"),
    crl: read("ca2-crl-agent3.pem"),
    requestCert: true,
  };

  function verdict(req: http.IncomingMessage, res: http.ServerResponse) {
    const { authorized, authorizationError } = req.socket as tls.TLSSocket;
    res.end(`authorized=${authorized} error=${authorizationError}`);
  }

  function get(port: number, agent: string, options?: https.RequestOptions) {
    const { promise, resolve } = Promise.withResolvers<string>();
    const req = https.get(
      {
        host: "127.0.0.1",
        port,
        key: read(`${agent}-key.pem`),
        cert: read(`${agent}-cert.pem`),
        rejectUnauthorized: false,
        agent: false,
        ...options,
      },
      res => {
        let body = "";
        res.on("data", chunk => (body += chunk)).on("end", () => resolve(body));
      },
    );
    req.on("error", () => resolve("refused"));
    return promise;
  }

  function handshake(port: number, options: tls.ConnectionOptions) {
    const { promise, resolve } = Promise.withResolvers<string>();
    const client = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false, ...options }, () => {
      resolve(client.getCipher().name);
      client.destroy();
    });
    client.on("error", (err: NodeJS.ErrnoException) => resolve(String(err.code)));
    return promise;
  }

  test.each(["TLSv1.2", "TLSv1.3"] as const)("refuses a client certificate the crl revokes on %s", async version => {
    let requests = 0;
    await using server = https.createServer({ ...mtls, minVersion: version, maxVersion: version }, (req, res) => {
      requests++;
      verdict(req, res);
    });
    const port = await listen(server);

    expect(await get(port, "agent3")).toBe("refused");
    expect(requests).toBe(0);
    expect(await get(port, "agent4")).toBe("authorized=true error=null");
  });

  test("reports CERT_REVOKED on req.socket when rejectUnauthorized is false", async () => {
    await using server = https.createServer({ ...mtls, crl: [mtls.crl], rejectUnauthorized: false }, verdict);
    const port = await listen(server);

    expect(await get(port, "agent3")).toBe("authorized=false error=CERT_REVOKED");
    expect(await get(port, "agent4")).toBe("authorized=true error=null");
  });

  test("restricts the key-share groups to ecdhCurve, or to tls.DEFAULT_ECDH_CURVE", async () => {
    const saved = tls.DEFAULT_ECDH_CURVE;
    await using explicit = https.createServer({ ...validCert, ecdhCurve: "P-384" });
    tls.DEFAULT_ECDH_CURVE = "P-384";
    try {
      await using fallback = https.createServer({ ...validCert });
      for (const server of [explicit, fallback]) {
        const port = await listen(server);
        expect(await handshake(port, { ecdhCurve: "X25519" })).toContain("HANDSHAKE_FAILURE");
        expect(await handshake(port, { ecdhCurve: "P-384" })).toStartWith("TLS_");
      }
    } finally {
      tls.DEFAULT_ECDH_CURVE = saved;
    }
  });

  test("signs the handshake with sigalgs only", async () => {
    await using server = https.createServer({ ...validCert, sigalgs: "rsa_pss_rsae_sha512" });
    const port = await listen(server);

    expect(await handshake(port, { sigalgs: "rsa_pss_rsae_sha256" })).toContain("HANDSHAKE_FAILURE");
    expect(await handshake(port, { sigalgs: "rsa_pss_rsae_sha512" })).toStartWith("TLS_");
  });

  test("honors the server cipher order unless honorCipherOrder is false", async () => {
    const aes256 = "ECDHE-RSA-AES256-GCM-SHA384";
    const aes128 = "ECDHE-RSA-AES128-GCM-SHA256";
    async function negotiated(honorCipherOrder: boolean | undefined) {
      await using server = https.createServer({ ...validCert, ciphers: `${aes256}:${aes128}`, honorCipherOrder });
      return await handshake(await listen(server), { ciphers: `${aes128}:${aes256}`, maxVersion: "TLSv1.2" });
    }
    expect(await negotiated(undefined)).toBe(aes256);
    expect(await negotiated(false)).toBe(aes128);
  });

  test("takes TLS 1.3 suite names in ciphers", async () => {
    const aes256 = "ECDHE-RSA-AES256-GCM-SHA384";
    await using only13 = https.createServer({ ...validCert, ciphers: "TLS_AES_256_GCM_SHA384" });
    await using mixed = https.createServer({ ...validCert, ciphers: `TLS_AES_256_GCM_SHA384:${aes256}` });
    const only13Port = await listen(only13);
    const mixedPort = await listen(mixed);

    expect(await handshake(only13Port, {})).toStartWith("TLS_");
    expect(await handshake(only13Port, { maxVersion: "TLSv1.2" })).toContain("_ALERT_");
    expect(await handshake(mixedPort, {})).toStartWith("TLS_");
    expect(await handshake(mixedPort, { maxVersion: "TLSv1.2" })).toBe(aes256);
  });

  test("takes a key as [{ pem, passphrase }]", async () => {
    const pem = readFileSync(join(import.meta.dirname, "fixtures", "cert.encrypted.key"), "utf8");
    const cert = readFileSync(join(import.meta.dirname, "fixtures", "cert.pem"), "utf8");
    await using server = https.createServer({ key: [{ pem, passphrase: "testpassword" }], cert });
    expect(await handshake(await listen(server), {})).toStartWith("TLS_");
  });

  test("sends sessionTimeout as the ticket lifetime", async () => {
    await using server = https.createServer({ ...validCert, sessionTimeout: 1234 });
    const client = tls.connect({ port: await listen(server), host: "127.0.0.1", rejectUnauthorized: false, maxVersion: "TLSv1.2" }); // prettier-ignore
    await once(client, "secureConnect");
    const session = client.getSession()!.toString("hex");
    client.destroy();
    // SSL_SESSION ::= ... ticketLifetimeHint [9] INTEGER
    expect(session).toContain("a904020204d2");
  });

  test.each([
    ["ecdhCurve", "not-a-curve", "ERR_CRYPTO_OPERATION_FAILED"],
    ["sessionTimeout", -1, "ERR_OUT_OF_RANGE"],
    ["sigalgs", "", "ERR_INVALID_ARG_VALUE"],
    ["crl", 42, "ERR_INVALID_ARG_TYPE"],
    ["minVersion", "TLSv9", "ERR_TLS_INVALID_PROTOCOL_VERSION"],
  ])("throws on an invalid %s like tls.createServer", (name, value, code) => {
    expect(() => https.createServer({ ...validCert, [name]: value })).toThrow(expect.objectContaining({ code }));
    expect(() => https.createServer({ [name]: value })).toThrow(expect.objectContaining({ code }));
  });

  test.each([
    // BoringSSL has no DHE suites to apply it to.
    ["dhparam", "auto"],
    // tls.Server#setSecureContext() drops these when they are falsy.
    ["clientCertEngine", 0],
    ["clientCertEngine", ""],
    ["ciphers", 0],
    ["sessionTimeout", false],
    ["ticketKeys", ""],
    ["crl", ""],
    ["crl", 0],
    ["passphrase", 0],
  ])("listens with %s: %p like Node", async (name, value) => {
    await using server = https.createServer({ ...validCert, [name]: value });
    expect(await handshake(await listen(server), {})).toStartWith("TLS_");
    if (!process.versions.bun) return;
    await using viaHttp = http.createServer({ ...validCert, [name]: value } as http.ServerOptions);
    expect(await handshake(await listen(viaHttp), {})).toStartWith("TLS_");
  });

  // OpenSSL has X448, so Node listens. BoringSSL cannot apply the list as written.
  test.skipIf(!process.versions.bun)(
    "throws on an ecdhCurve that names a group BoringSSL lacks, like tls.createServer",
    () => {
      const error = expect.objectContaining({ code: "ERR_CRYPTO_OPERATION_FAILED" });
      expect(() => tls.createServer({ ...validCert, ecdhCurve: "X448:prime256v1" })).toThrow(error);
      expect(() => https.createServer({ ...validCert, ecdhCurve: "X448:prime256v1" })).toThrow(error);
    },
  );
});

describe("server.blockList", () => {
  type ServerWithBlockList = http.Server & { blockList?: net.BlockList };

  function blockListOf(address: string) {
    const blockList = new net.BlockList();
    blockList.addAddress(address);
    return blockList;
  }

  function get(mod: typeof http | typeof https, options: https.RequestOptions) {
    const { promise, resolve } = Promise.withResolvers<string>();
    mod
      .get({ host: "127.0.0.1", agent: false, rejectUnauthorized: false, ...options }, res => {
        let body = "";
        res.on("data", chunk => (body += chunk)).on("end", () => resolve(body));
      })
      .on("error", (err: NodeJS.ErrnoException) => resolve(String(err.code)));
    return promise;
  }

  test.each<[string, (options: https.ServerOptions, listener: http.RequestListener) => ServerWithBlockList]>([
    ["https.createServer()", (options, listener) => https.createServer(options, listener)],
    ["new https.Server()", (options, listener) => new https.Server(options, listener)],
  ])("%s closes a peer on options.blockList without an event", async (_label, construct) => {
    const blockList = blockListOf("127.0.0.1");
    const events: string[] = [];
    await using server = construct({ ...validCert, blockList }, (_req, res) => {
      events.push("request");
      res.end("served");
    });
    for (const event of ["connection", "secureConnection", "drop"]) server.on(event, () => events.push(event));
    expect(server.blockList).toBe(blockList);
    const port = await listen(server);

    // The server refuses the peer at accept, before the handshake. A client with no request queued behind its
    // handshake reports that as ECONNRESET, whether the close reaches it as a FIN or as a reset.
    expect(await tlsHandshake(port)).toBe("ECONNRESET");
    expect(events).toEqual([]);

    server.blockList = blockListOf("10.0.0.1");
    expect(await get(https, { port })).toBe("served");
    expect(events).toEqual(["connection", "secureConnection", "request"]);
  });

  test("https.createServer() rejects a blockList that is not a net.BlockList, with or without a certificate", () => {
    const blockList = { check: () => true } as any;
    const error = expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" });
    expect(() => https.createServer({ ...validCert, blockList })).toThrow(error);
    expect(() => https.createServer({ blockList })).toThrow(error);
  });

  test("http.Server ignores the option and enforces an assigned list on the next connection", async () => {
    let requests = 0;
    function listener(_req: http.IncomingMessage, res: http.ServerResponse) {
      requests++;
      res.end("served");
    }
    await using server: ServerWithBlockList = http.createServer(
      { blockList: blockListOf("127.0.0.1") } as any,
      listener,
    );
    expect(server.blockList).toBeUndefined();
    const port = await listen(server);
    expect(await get(http, { port })).toBe("served");

    server.blockList = blockListOf("127.0.0.1");
    expect(await get(http, { port })).toBe("ECONNRESET");
    expect(requests).toBe(1);

    server.blockList = undefined;
    expect(await get(http, { port })).toBe("served");

    // A unix socket peer has no address to check.
    using dir = tempDir("http-blocklist", {});
    const socketPath = join(String(dir), "server.sock");
    await using unix: ServerWithBlockList = http.createServer(listener);
    unix.blockList = blockListOf("127.0.0.1");
    await once(unix.listen(socketPath), "listening");
    expect(await get(http, { socketPath })).toBe("served");
  });

  test("matches an IPv4 rule against the IPv4-mapped peer of a dual-stack listener", async () => {
    await using server: ServerWithBlockList = http.createServer((req, res) => res.end(req.socket.remoteAddress));
    await once(server.listen(0, "::"), "listening");
    const { port } = server.address() as AddressInfo;
    expect(await get(http, { port })).toBe("::ffff:127.0.0.1");

    server.blockList = blockListOf("127.0.0.1");
    expect(await get(http, { port })).toBe("ECONNRESET");
  });

  // Node never serves the peer either, but leaks the accepted handle instead of closing it.
  test.skipIf(!process.versions.bun)("closes the connection when check() throws", async () => {
    const child = spawn(
      bunExe(),
      [
        "-e",
        `
        const errors = [];
        process.on("uncaughtException", err => errors.push(err.message));
        async function run(name, options) {
          const mod = require(name);
          let requests = 0;
          const server = mod.createServer(options, (req, res) => { requests++; res.end("served"); });
          server.blockList = { check() { throw new Error(name + " check failed"); } };
          await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
          const target = { host: "127.0.0.1", port: server.address().port, agent: false, rejectUnauthorized: false };
          // https: the refusal is at accept, before the handshake, so a TLS client with no request queued.
          const outcome = await new Promise(resolve =>
            (name === "node:https"
              ? require("node:tls").connect(target, () => resolve("secureConnect"))
              : mod.get(target, res => resolve(res.statusCode))
            ).on("error", err => resolve(err.code)));
          server.close();
          return { outcome, requests };
        }
        (async () => {
          const results = [await run("node:http", {}), await run("node:https", JSON.parse(process.env.TEST_TLS))];
          console.log(JSON.stringify({ results, errors }));
        })();
        `,
      ],
      { env: { ...bunEnv, TEST_TLS: JSON.stringify(validCert) }, stdio: ["ignore", "pipe", "inherit"] },
    );
    let stdout = "";
    child.stdout.on("data", chunk => (stdout += chunk));
    const [exitCode] = await once(child, "exit");
    expect(JSON.parse(stdout)).toEqual({
      results: [
        { outcome: "ECONNRESET", requests: 0 },
        { outcome: "ECONNRESET", requests: 0 },
      ],
      errors: ["node:http check failed", "node:https check failed"],
    });
    expect(exitCode).toBe(0);
  });
});

// Node reports a TLS connection when TCP accepts it: 'connection', getConnections(), maxConnections and blockList act
// before the handshake. The http connection state (parser, server.timeout, the timeout sweeps) comes with 'secureConnection'.
describe.concurrent("a TLS connection before its handshake", () => {
  type Socket = net.Socket & { _secureEstablished?: boolean; parser?: object | null };
  type Listener = http.RequestListener;

  function listenWithTls(server: http.Server): Promise<number> {
    const { promise, resolve, reject } = Promise.withResolvers<number>();
    server.once("error", reject);
    server.listen({ port: 0, host: "127.0.0.1", tls: validCert }, () =>
      resolve((server.address() as AddressInfo).port),
    );
    return promise;
  }

  // The last two are Bun only: Node's http.Server ignores key and cert, and its listen() takes no tls option.
  const entryPoints: [string, (listener?: Listener) => http.Server, (server: http.Server) => Promise<number>][] = [
    ["https.createServer()", listener => https.createServer(validCert, listener), listen],
    ["new https.Server()", listener => new https.Server(validCert, listener), listen],
  ];
  if (process.versions.bun) {
    entryPoints.push(
      ["http.createServer({ key, cert })", listener => http.createServer({ ...validCert } as http.ServerOptions, listener), listen], // prettier-ignore
      ["http.createServer().listen({ tls })", listener => http.createServer(listener), listenWithTls],
    );
  }

  function connections(server: http.Server) {
    const { promise, resolve, reject } = Promise.withResolvers<number>();
    server.getConnections((err, count) => (err ? reject(err) : resolve(count)));
    return promise;
  }

  // The first byte of a TLS record and no more: the handshake cannot go on. With a byte to read, TCP_DEFER_ACCEPT on
  // Linux does not hold the accept back for 1 s.
  async function stalledClient(port: number) {
    const socket = net.connect(port, "127.0.0.1");
    socket.on("error", () => {});
    // A failed handshake can end with an alert: unread, it would hold the 'close' of this socket back.
    socket.resume();
    await once(socket, "connect");
    socket.write(Buffer.from([0x16]));
    return socket;
  }

  // Not events.once(): it rejects when the reset of the peer reaches the socket before its 'close'.
  function closed(socket: net.Socket) {
    const { promise, resolve } = Promise.withResolvers<void>();
    socket.on("close", () => resolve());
    return promise;
  }

  function get(port: number) {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    https
      .get({ host: "127.0.0.1", port, agent: false, rejectUnauthorized: false }, res => {
        let body = "";
        res.on("data", chunk => (body += chunk)).on("end", () => resolve(body));
      })
      .on("error", reject);
    return promise;
  }

  // A TLS client whose handshake waits: what the server sends stays here until release().
  async function heldHandshake(port: number) {
    const raw = net.connect(port, "127.0.0.1");
    raw.on("error", () => {});
    await once(raw, "connect");
    let hold = true;
    const held: Buffer[] = [];
    const wire = new Duplex({
      read() {},
      write(chunk, _encoding, callback) {
        raw.write(chunk, callback);
      },
    });
    raw.on("data", (chunk: Buffer) => (hold ? held.push(chunk) : wire.push(chunk)));
    raw.on("close", () => wire.push(null));
    const client = tls.connect({ socket: wire, rejectUnauthorized: false });
    client.on("error", () => {});
    return {
      raw,
      client,
      release() {
        hold = false;
        for (const chunk of held) wire.push(chunk);
      },
    };
  }

  test.each(entryPoints)(
    "%s emits 'connection' at accept and 'secureConnection' after the handshake",
    async (_label, create, listenOn) => {
      const events: string[] = [];
      const counts: number[] = [];
      const server = create((req, res) => {
        events.push(`request encrypted=${(req.socket as tls.TLSSocket).encrypted}`);
        server.getConnections((_err, count) => {
          counts.push(count);
          res.end("ok");
        });
      });
      server.on("connection", (socket: Socket) => {
        events.push(`connection server=${(socket as any).server === server} secure=${!!socket._secureEstablished}`);
        process.nextTick(() => events.push("tick"));
      });
      server.on("secureConnection", (socket: tls.TLSSocket & Socket) => {
        events.push(`secureConnection encrypted=${socket.encrypted} secure=${!!socket._secureEstablished}`);
      });
      const port = await listenOn(server);
      const stalled = await stalledClient(port);
      try {
        // The listener accepts in order: the stalled client is a connection before this one is served.
        expect(await get(port)).toBe("ok");
        expect(events).toEqual([
          "connection server=true secure=false",
          "tick",
          "connection server=true secure=false",
          "tick",
          "secureConnection encrypted=true secure=true",
          "request encrypted=true",
        ]);
        expect(counts).toEqual([2]);
      } finally {
        stalled.destroy();
        server.close();
      }
    },
  );

  test("a client that sends nothing is a connection until it leaves", async () => {
    const events: string[] = [];
    const server = https.createServer(validCert, () => expect.unreachable());
    for (const event of ["connection", "secureConnection"]) server.on(event, () => events.push(event));
    const port = await listen(server);
    const accepted = once(server, "connection");
    const silent = net.connect(port, "127.0.0.1");
    silent.on("error", () => {});
    try {
      const [[socket]] = (await Promise.all([accepted, once(silent, "connect")])) as [[Socket], unknown];
      expect({ remotePort: socket.remotePort, destroyed: socket.destroyed }).toEqual({
        remotePort: silent.localPort,
        destroyed: false,
      });
      expect(await connections(server)).toBe(1);

      const socketClosed = once(socket, "close");
      silent.destroy();
      await socketClosed;
      expect(await connections(server)).toBe(0);
      expect(events).toEqual(["connection"]);
    } finally {
      silent.destroy();
      server.close();
    }
  });

  test("a handshake that fails emits no second 'connection'", async () => {
    const events: string[] = [];
    const server = https.createServer(validCert, () => expect.unreachable());
    for (const event of ["connection", "secureConnection"]) server.on(event, () => events.push(event));
    const port = await listen(server);
    const accepted = once(server, "connection");
    const client = await stalledClient(port);
    try {
      const [socket] = (await accepted) as [Socket];
      const socketClosed = once(socket, "close");
      // Not a TLS record: the handshake fails and the server closes the connection.
      client.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
      await Promise.all([socketClosed, closed(client)]);
      expect(events).toEqual(["connection"]);
      expect(await connections(server)).toBe(0);
    } finally {
      client.destroy();
      server.close();
    }
  });

  test("a 'connection' listener can destroy the socket before the handshake", async () => {
    const events: string[] = [];
    const server = https.createServer(validCert, () => expect.unreachable());
    server.on("connection", socket => {
      events.push("connection");
      socket.destroy();
    });
    server.on("secureConnection", () => events.push("secureConnection"));
    const port = await listen(server);
    try {
      expect(await tlsHandshake(port)).toBe("ECONNRESET");
      expect(events).toEqual(["connection"]);
    } finally {
      server.close();
    }
  });

  test("a 'connection' listener can time out a client that stalls in its handshake", async () => {
    const server = https.createServer(validCert, () => expect.unreachable());
    const timedOut = Promise.withResolvers<void>();
    server.on("connection", socket => {
      socket.setTimeout(1, () => {
        socket.destroy();
        timedOut.resolve();
      });
    });
    const port = await listen(server);
    const stalled = await stalledClient(port);
    try {
      await Promise.all([timedOut.promise, closed(stalled)]);
      expect(await connections(server)).toBe(0);
    } finally {
      stalled.destroy();
      server.close();
    }
  });

  // Node's http layer listens for 'timeout' on the socket from 'secureConnection' on.
  test.each([
    ["is not the 'timeout' event of the server", true],
    ["does not destroy the socket", false],
  ])("a timeout before the handshake %s", async (_label, serverListens) => {
    const events: string[] = [];
    const server = https.createServer(validCert, () => expect.unreachable());
    if (serverListens) server.on("timeout", () => events.push("server timeout"));
    const timedOut = Promise.withResolvers<Socket>();
    server.on("connection", socket => {
      socket.setTimeout(1);
      socket.on("timeout", () => timedOut.resolve(socket));
    });
    const port = await listen(server);
    const stalled = await stalledClient(port);
    try {
      const socket = await timedOut.promise;
      expect({ events, destroyed: socket.destroyed }).toEqual({ events: [], destroyed: false });
      expect(await connections(server)).toBe(1);
    } finally {
      stalled.destroy();
      server.close();
    }
  });

  test("a timeout that a 'connection' listener arms still counts after the handshake, below server.timeout", async () => {
    // No answer: the end of a response starts the keep-alive timeout.
    const requested = Promise.withResolvers<void>();
    const server = https.createServer(validCert, () => requested.resolve());
    server.timeout = 60_000;
    let secure = false;
    const timedOut = Promise.withResolvers<void>();
    server.on("connection", socket => {
      socket.setTimeout(20);
      // It can fire once during the handshake. The request then starts it again.
      socket.on("timeout", () => secure && timedOut.resolve());
    });
    server.on("secureConnection", () => (secure = true));
    const port = await listen(server);
    const client = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
    client.on("error", () => {});
    try {
      client.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
      await Promise.all([requested.promise, timedOut.promise]);
    } finally {
      client.destroy();
      server.close();
    }
  });

  test("server.maxConnections counts it and refuses the next peer before its handshake", async () => {
    const events: string[] = [];
    const server = https.createServer(validCert, () => expect.unreachable());
    server.maxConnections = 1;
    for (const event of ["connection", "secureConnection", "drop"]) server.on(event, () => events.push(event));
    const port = await listen(server);
    const stalled = await stalledClient(port);
    try {
      expect(await tlsHandshake(port)).toBe("ECONNRESET");
      expect(events).toEqual(["connection", "drop"]);
      expect(await connections(server)).toBe(1);
    } finally {
      stalled.destroy();
      server.close();
    }
  });

  test("server.blockList closes the peer before its handshake", async () => {
    const events: string[] = [];
    const blockList = new net.BlockList();
    blockList.addAddress("127.0.0.1");
    const server = https.createServer({ ...validCert, blockList } as https.ServerOptions, () => expect.unreachable());
    for (const event of ["connection", "secureConnection", "drop"]) server.on(event, () => events.push(event));
    const port = await listen(server);
    const stalled = await stalledClient(port);
    try {
      await closed(stalled);
      expect(events).toEqual([]);
      expect(await connections(server)).toBe(0);
    } finally {
      stalled.destroy();
      server.close();
    }
  });

  test("the http connection state comes with 'secureConnection'", async () => {
    const states: object[] = [];
    const state = (event: string, socket: Socket) =>
      states.push({ event, timeout: socket.timeout || 0, parser: socket.parser != null });
    const server = https.createServer(validCert, (_req, res) => res.end("ok"));
    server.timeout = 60_000;
    server.on("connection", socket => state("connection", socket));
    server.on("secureConnection", socket => state("secureConnection", socket));
    const port = await listen(server);
    try {
      expect(await get(port)).toBe("ok");
      expect(states).toEqual([
        { event: "connection", timeout: 0, parser: false },
        { event: "secureConnection", timeout: 60_000, parser: true },
      ]);
    } finally {
      server.close();
    }
  });

  test("the headersTimeout sweep leaves it alone", async () => {
    const server = https.createServer(
      { ...validCert, headersTimeout: 50, connectionsCheckingInterval: 10 } as https.ServerOptions,
      () => expect.unreachable(),
    );
    const accepted = once(server, "connection");
    const port = await listen(server);
    const stalled = await stalledClient(port);
    const [stalledSocket] = (await accepted) as [Socket];
    // This one finishes its handshake and sends no request: the sweep answers 408 and closes it. The stalled
    // connection is older, so a sweep that took it would have closed it first.
    const idle = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
    idle.on("error", () => {});
    let response = "";
    idle.on("data", chunk => (response += chunk));
    try {
      await closed(idle);
      expect(response).toStartWith("HTTP/1.1 408 ");
      expect(stalledSocket.destroyed).toBe(false);
      expect(await connections(server)).toBe(1);
    } finally {
      stalled.destroy();
      idle.destroy();
      server.close();
    }
  });

  test("closeAllConnections() leaves it", async () => {
    const server = https.createServer(validCert, (_req, res) => res.end("ok"));
    const accepted = once(server, "connection");
    const port = await listen(server);
    const stalled = await stalledClient(port);
    const [stalledSocket] = (await accepted) as [Socket];
    const established = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
    established.on("error", () => {});
    try {
      established.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
      let response = "";
      while (!response.endsWith("ok")) response += (await once(established, "data"))[0];
      expect(await connections(server)).toBe(2);

      const establishedClosed = closed(established);
      server.closeAllConnections();
      await establishedClosed;
      expect(stalledSocket.destroyed).toBe(false);
      expect(await connections(server)).toBe(1);

      const stalledSocketClosed = once(stalledSocket, "close");
      stalled.destroy();
      await stalledSocketClosed;
      expect(await connections(server)).toBe(0);
    } finally {
      stalled.destroy();
      established.destroy();
      server.close();
    }
  });

  // The sweep of close() and closeIdleConnections() takes the idle connections of the http layer. A TLS connection
  // joins them at 'secureConnection', so the one that a 'connection' listener is told about stays.
  test.each([
    ["close()", (server: http.Server) => void server.close()],
    ["closeIdleConnections()", (server: http.Server) => server.closeIdleConnections()],
  ])("%s in a 'connection' listener leaves the connection, and its request is served", async (_label, sweep) => {
    const events: string[] = [];
    const server = https.createServer(validCert, (_req, res) => {
      events.push("request");
      res.end("ok");
    });
    server.on("connection", () => {
      events.push("connection");
      sweep(server);
    });
    server.on("secureConnection", () => events.push("secureConnection"));
    const port = await listen(server);
    try {
      expect(await get(port)).toBe("ok");
      expect(events).toEqual(["connection", "secureConnection", "request"]);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  // What server-destroy and http-shutdown do: they destroy the sockets that 'connection' gave them.
  test("close() completes when the sockets of 'connection' are destroyed, with a handshake pending", async () => {
    const sockets = new Set<net.Socket>();
    const server = https.createServer(validCert, () => expect.unreachable());
    server.on("connection", socket => sockets.add(socket));
    const accepted = once(server, "connection");
    const port = await listen(server);
    const stalled = await stalledClient(port);
    try {
      await accepted;
      const serverClosed = Promise.withResolvers<Error | undefined>();
      server.close(serverClosed.resolve);
      for (const socket of sockets) socket.destroy();
      expect(await serverClosed.promise).toBeUndefined();
    } finally {
      stalled.destroy();
    }
  });

  test("socket.destroy(err) in a 'connection' listener reaches 'clientError'", async () => {
    const error = new Error("refused");
    const server = https.createServer(validCert, () => expect.unreachable());
    server.on("connection", socket => socket.destroy(error));
    const clientError = once(server, "clientError");
    const port = await listen(server);
    const stalled = await stalledClient(port);
    try {
      const [received] = await Promise.all([clientError, closed(stalled)]);
      expect(received[0]).toBe(error);
      expect(await connections(server)).toBe(0);
    } finally {
      stalled.destroy();
      server.close();
    }
  });

  test("socket.end() in a 'connection' listener leaves the connection until the peer closes it", async () => {
    const events: string[] = [];
    const server = https.createServer(validCert, () => expect.unreachable());
    const ended = Promise.withResolvers<Socket>();
    server.on("connection", socket => {
      events.push("connection");
      socket.end();
      ended.resolve(socket);
    });
    server.on("secureConnection", () => events.push("secureConnection"));
    const port = await listen(server);
    // Keeps its side open behind the FIN of the server.
    const client = net.connect({ port, host: "127.0.0.1", allowHalfOpen: true });
    client.on("error", () => {});
    client.resume();
    try {
      await once(client, "connect");
      client.write(Buffer.from([0x16]));
      const [socket] = await Promise.all([ended.promise, once(client, "end")]);
      expect({ destroyed: socket.destroyed, count: await connections(server) }).toEqual({ destroyed: false, count: 1 });
      server.closeAllConnections();
      expect({ destroyed: socket.destroyed, count: await connections(server) }).toEqual({ destroyed: false, count: 1 });

      const socketClosed = once(socket, "close");
      client.destroy();
      await socketClosed;
      expect(events).toEqual(["connection"]);
      expect(await connections(server)).toBe(0);
    } finally {
      client.destroy();
      server.close();
    }
  });

  // Node's http layer arms server.timeout on the TLSSocket at 'secureConnection', whatever the raw socket has.
  test("server.timeout applies after the handshake when a 'connection' listener armed a longer timeout", async () => {
    // No answer: the end of a response starts the keep-alive timeout.
    const server = https.createServer(validCert, () => {});
    server.timeout = 50;
    server.on("connection", socket => socket.setTimeout(60_000));
    const timedOut = once(server, "timeout");
    const port = await listen(server);
    const client = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
    client.on("error", () => {});
    try {
      client.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
      const [socket] = (await timedOut) as [Socket];
      expect(socket.timeout).toBe(50);
      socket.destroy();
    } finally {
      client.destroy();
      server.close();
    }
  });

  test("a timeout that fired during the handshake does not leave the connection without one", async () => {
    const server = https.createServer(validCert, () => expect.unreachable());
    server.timeout = 100;
    const fired = Promise.withResolvers<void>();
    server.on("connection", socket => {
      socket.setTimeout(20);
      socket.once("timeout", () => fired.resolve());
    });
    const port = await listen(server);
    const { raw, client, release } = await heldHandshake(port);
    try {
      await fired.promise;
      const rawClosed = closed(raw);
      release();
      // The handshake completes and the client sends nothing: a timeout of the server closes the connection.
      await rawClosed;
      expect(await connections(server)).toBe(0);
    } finally {
      client.destroy();
      raw.destroy();
      server.close();
    }
  });

  // A server behind a TLS proxy marks its plain sockets like this. They are not connections in a handshake.
  describe("a plain connection whose socket.encrypted the application sets", () => {
    test("is still closed by closeAllConnections()", async () => {
      const responding = Promise.withResolvers<void>();
      const server = http.createServer((req, res) => {
        (req.socket as any).encrypted = true;
        res.write("x");
        responding.resolve();
      });
      const port = await listen(server);
      const client = net.connect(port, "127.0.0.1");
      client.on("error", () => {});
      client.resume();
      try {
        await once(client, "connect");
        client.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
        await responding.promise;
        const clientClosed = closed(client);
        server.closeAllConnections();
        await clientClosed;
        expect(await connections(server)).toBe(0);
      } finally {
        client.destroy();
        server.close();
      }
    });

    test("is still answered 408 by the headersTimeout sweep", async () => {
      const server = http.createServer({ headersTimeout: 50, connectionsCheckingInterval: 10 }, () =>
        expect.unreachable(),
      );
      server.on("connection", socket => ((socket as any).encrypted = true));
      const port = await listen(server);
      const client = net.connect(port, "127.0.0.1");
      client.on("error", () => {});
      let response = "";
      client.on("data", chunk => (response += chunk));
      try {
        await once(client, "connect");
        client.write("GET / HTTP/1.1\r\nHost: localhost\r\n");
        await closed(client);
        expect(response).toStartWith("HTTP/1.1 408 ");
      } finally {
        client.destroy();
        server.close();
      }
    });
  });

  // Node emits 'secureConnection' from the handshake, on its own stack: a 'connection' listener that threw does not
  // take it away. The servers run in a child: under `bun test` an uncaught exception fails the test, handled or not.
  test("a 'connection' listener that throws does not take 'secureConnection' away when the process handles the error", async () => {
    const labels = entryPoints.map(([label]) => label);
    const child = spawn(
      bunExe(),
      [
        "-e",
        `
        const http = require("node:http");
        const https = require("node:https");
        const cert = JSON.parse(process.env.TEST_TLS);
        let events = [];
        process.on("uncaughtException", err => events.push("uncaught " + err.message));
        function run(entry) {
          events = [];
          const listener = (req, res) => { events.push("request"); res.end("ok"); };
          let server;
          let listen = cb => server.listen(0, "127.0.0.1", cb);
          if (entry === "https.createServer()") server = https.createServer(cert, listener);
          else if (entry === "new https.Server()") server = new https.Server(cert, listener);
          else if (entry === "http.createServer({ key, cert })") server = http.createServer({ ...cert }, listener);
          else {
            server = http.createServer(listener);
            listen = cb => server.listen({ port: 0, host: "127.0.0.1", tls: cert }, cb);
          }
          server.timeout = 60_000;
          server.on("connection", () => { events.push("connection"); throw new Error("boom"); });
          server.on("secureConnection", socket =>
            events.push("secureConnection parser=" + (socket.parser != null) + " timeout=" + socket.timeout));
          return new Promise(resolve => listen(() => {
            const done = outcome => { server.close(); resolve({ entry, outcome, events }); };
            https.get({ host: "127.0.0.1", port: server.address().port, agent: false, rejectUnauthorized: false }, res => {
              let body = "";
              res.on("data", chunk => (body += chunk)).on("end", () => done(body));
            }).on("error", err => done(err.code));
          }));
        }
        (async () => {
          const results = [];
          for (const entry of JSON.parse(process.env.TEST_ENTRY_POINTS)) results.push(await run(entry));
          console.log(JSON.stringify(results));
        })();
        `,
      ],
      {
        env: { ...bunEnv, TEST_TLS: JSON.stringify(validCert), TEST_ENTRY_POINTS: JSON.stringify(labels) },
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    let stdout = "";
    child.stdout.on("data", chunk => (stdout += chunk));
    const [exitCode] = await once(child, "close");
    expect(JSON.parse(stdout)).toEqual(
      labels.map(entry => ({
        entry,
        outcome: "ok",
        events: ["connection", "uncaught boom", "secureConnection parser=true timeout=60000", "request"],
      })),
    );
    expect(exitCode).toBe(0);
  });
});

// A close waits, up to 10 s, for ciphertext that write() reported and the kernel has not taken. closeAllConnections() does not.
test.each([
  ["in the middle of its request", 0],
  ["behind its request", 3],
])("closeAllConnections() does not wait for a client that stopped reading, %s", async (_when, turns) => {
  const stalled = Promise.withResolvers<string>();
  const server = https.createServer(validCert, (_req, res) => {
    const chunk = Buffer.alloc(1024 * 1024, "a");
    let left = 16;
    (function more() {
      while (left-- > 0) {
        if (!res.write(chunk)) {
          stalled.resolve("a write that the client does not take");
          return void res.once("drain", more);
        }
      }
      res.end();
    })();
  });
  const port = await listen(server);
  // In a process of its own: nothing on this loop reads for it.
  await using client = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const socket = require("node:tls").connect({ port: ${port}, host: "127.0.0.1", rejectUnauthorized: false }, () => {
        socket.pause();
        socket.end("GET / HTTP/1.1\\r\\nHost: localhost\\r\\n\\r\\n");
      });
      socket.on("error", () => {});
      process.stdin.resume();`,
    ],
    env: bunEnv,
    stdin: "pipe",
    stdout: "inherit",
    stderr: "inherit",
  });
  // Closed from here on, whatever becomes of the client.
  const closed = stalled.promise.then(async closedAt => {
    for (let i = 0; i < turns; i++) await new Promise(setImmediate);
    const from = performance.now();
    const { promise, resolve } = Promise.withResolvers<void>();
    server.close(() => resolve());
    server.closeAllConnections();
    await promise;
    // The deadline, 10 s on a 4 s tick, is 8 s away at the least.
    return { closedAt, wellAheadOfTheDeadline: performance.now() - from < 5_000 };
  });
  client.exited.then(() => stalled.resolve("the exit of the client"));
  expect(await closed).toEqual({ closedAt: "a write that the client does not take", wellAheadOfTheDeadline: true });
});

// Linux only: epoll is the one poller that reports a hangup while reads are paused.
test.skipIf(!isLinux)(
  "a response ends when its client leaves with a request body that nobody reads",
  async () => {
    using dir = tempDir("https-unread-body", { "big.bin": Buffer.alloc(4 << 20, "b").toString() });
    let requests = 0;
    let ended = 0;
    let clientsLeft = false;
    const allEnded = Promise.withResolvers<void>();
    const server = https.createServer(validCert, (_req, res) => {
      requests++;
      pipeline(createReadStream(join(String(dir), "big.bin")), res, () => {
        ended++;
        if (clientsLeft && ended === requests) allEnded.resolve();
      });
    });
    const port = await listen(server);
    // In a process of its own: each client is gone while this loop still writes to it.
    await using clients = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const post = Buffer.concat([
        Buffer.from("POST / HTTP/1.1\\r\\nHost: localhost\\r\\nContent-Length: 16777216\\r\\n\\r\\n"),
        Buffer.alloc(4 << 20, 97),
      ]);
      for (let i = 0; i < 20; i++) {
        await new Promise(done => {
          const socket = require("node:tls").connect({ port: ${port}, host: "127.0.0.1", rejectUnauthorized: false }, () => {
            socket.write(post);
            socket.destroy();
          });
          socket.on("error", () => {}).on("close", done);
        });
      }`,
      ],
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
    });
    expect(await clients.exited).toBe(0);
    expect(requests).toBeGreaterThan(0);
    clientsLeft = true;
    if (ended === requests) allEnded.resolve();
    await allEnded.promise;
    // Calls back only once every connection is closed.
    await new Promise<void>(resolve => server.close(() => resolve()));
    expect(ended).toBe(requests);
    // A debug build takes seconds to start the clients' process.
  },
  30_000,
);

// Linux still hands over what it received ahead of the reset that the first answer provokes.
test.skipIf(!isLinux)("every request of one read is dispatched when the client leaves without reading", async () => {
  let requests = 0;
  let closed = 0;
  const connectionClosed = Promise.withResolvers<void>();
  const server = https.createServer(validCert, (req, res) => {
    if (++requests === 1) req.socket.once("close", () => connectionClosed.resolve());
    res.once("close", () => closed++);
    req.resume().once("end", () => res.end("stored"));
  });
  const port = await listen(server);
  // In a process of its own: it is gone while this loop still answers.
  await using client = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const socket = require("node:tls").connect({ port: ${port}, host: "127.0.0.1", rejectUnauthorized: false }, () => {
        socket.write("POST / HTTP/1.1\\r\\nHost: localhost\\r\\nContent-Length: 5\\r\\n\\r\\nhello".repeat(20));
        socket.destroy();
      });
      socket.on("error", () => {});`,
    ],
    env: bunEnv,
    stdout: "inherit",
    stderr: "inherit",
  });
  expect(await client.exited).toBe(0);
  await connectionClosed.promise;
  await new Promise<void>(resolve => server.close(() => resolve()));
  expect({ requests, closed }).toEqual({ requests: 20, closed: 20 });
});
