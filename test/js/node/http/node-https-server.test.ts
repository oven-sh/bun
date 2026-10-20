import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isCI, isDebug, tempDir, tls as validCert } from "harness";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import net from "node:net";
import { join } from "node:path";
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

    expect(await get(https, { port })).toBe("ECONNRESET");
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
          const outcome = await new Promise(resolve =>
            mod.get({ host: "127.0.0.1", port: server.address().port, agent: false, rejectUnauthorized: false }, res => resolve(res.statusCode))
              .on("error", err => resolve(err.code)));
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

// 'connection' and 'secureConnection' are two callbacks in Node.js. When something handles the error that a
// 'connection' listener throws, 'secureConnection' is still emitted, and a guard in its listener refuses the peer.
// The fixture is the server and its peer. It runs unchanged under Node.js.
describe.concurrent("https.Server whose 'connection' listener throws", () => {
  const fixture = join(import.meta.dir, "node-https-connection-listener-throw-fixture.js");
  // CI has its own time for each test. A local debug or ASAN build needs several seconds to start one fixture.
  const timeout = (isASAN || isDebug) && !isCI ? 90_000 : undefined;
  const threw = ["connection", "uncaught:connection"];
  const refused = { marks: [...threw, "secureConnection"], served: false };
  // What the fixture prints, and the exit code of the process.
  const expected: Record<string, [object, number]> = {
    // What Node.js v26.3.0 prints for the same case.
    "handled": [refused, 0],
    "captured": [refused, 0],
    "worker-handled": [refused, 0],
    "handled-keeps": [{ ...refused, served: true }, 0],
    // The ticks of the listener that threw run before 'secureConnection'.
    "handled-ticks": [{ ...refused, marks: [...threw, "tick", "secureConnection"] }, 0],
    // A listener that the 'connection' listener added hears this 'secureConnection'.
    "handled-adds": [{ ...refused, marks: [...refused.marks, "secureConnection:added"] }, 0],
    "captured-monitor": [{ ...refused, marks: ["connection", "monitor:connection", "uncaught:connection", "secureConnection"] }, 0], // prettier-ignore
    "handled-secureThrows-keeps": [{ marks: [...refused.marks, "uncaught:secureConnection"], served: true }, 0],
    // 'secureConnection' is emitted once when its own listener throws.
    "handled-quiet-secureThrows-keeps": [{ marks: ["connection", "connection:second", "secureConnection", "uncaught:secureConnection"], served: true }, 0], // prettier-ignore
    // No 'secureConnection' for a socket that the 'connection' listener destroyed. With "writes" the close waits.
    "handled-destroys": [{ marks: threw, served: false }, 0],
    "handled-writes-destroys": [{ marks: threw, served: false }, 0],
    // And none after an error that ends the process.
    "handled-exits": [{ marks: threw, exit: 3 }, 3],
    "worker-handled-exits": [{ marks: threw, exit: 3 }, 0],
    "unhandled": [{ marks: ["connection"], exit: 1 }, 1],
    "monitor": [{ marks: ["connection", "monitor:connection"], exit: 1 }, 1],

    // Not what Node.js prints.
    // A plain http.Server with a certificate in listen() emits no 'secureConnection', with or without the error.
    "handled-listenTls": [{ marks: threw, served: true }, 0],
    // The socket cannot be made, so there is none for 'secureConnection'. The connection callback reports the
    // error once, and the request does once more. Node.js reports it once and never answers the peer.
    "handled-fractionalHighWaterMark": [{ marks: ["uncaught:ERR_INVALID_ARG_VALUE", "uncaught:ERR_INVALID_ARG_VALUE"], served: false }, 0], // prettier-ignore
    // The socket is made, and its constructor throws: server.timeout is not valid. The guard still runs.
    // Node.js throws from its own 'secureConnection' listener, runs no other, and never answers the peer.
    "handled-badTimeout": [{ marks: ["uncaught:ERR_OUT_OF_RANGE", "secureConnection"], served: false }, 0],
  };

  test.each(Object.keys(expected))(
    "%s",
    async name => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), fixture, name],
        env: { ...bunEnv, TLS_FIXTURE: JSON.stringify(validCert) },
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const [result, exit] = expected[name];
      expect({ result: stdout ? JSON.parse(stdout) : undefined, stderr, exitCode }).toEqual({
        result,
        // Only an error that nothing handles is printed.
        stderr: exit === 1 ? expect.stringContaining("error: connection\n") : "",
        exitCode: exit,
      });
    },
    timeout,
  );
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
