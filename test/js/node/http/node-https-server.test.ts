import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir, tls as validCert } from "harness";
import { spawn } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { once } from "node:events";
import { createReadStream, readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import net from "node:net";
import { join } from "node:path";
import { pipeline } from "node:stream";
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

// Resolves with what a TLS client that sends no request sees first: "secureConnect", or the error code.
function tlsHandshake(port: number): Promise<string> {
  const { promise, resolve } = Promise.withResolvers<string>();
  const socket = tls.connect({ port, host: "127.0.0.1", ca: validCert.cert }, () => {
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
    ["crl", "not a crl", "ERR_CRYPTO_OPERATION_FAILED"],
    ["ciphers", "no-such-cipher", "ERR_SSL_NO_CIPHER_MATCH"],
    ["minVersion", "TLSv9", "ERR_TLS_INVALID_PROTOCOL_VERSION"],
  ])("throws on an invalid %s: %p like tls.createServer", (name, value, code) => {
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
    ["ca", ""],
    ["ca", 0],
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

  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1384
  describe("builds the TLS context in the constructor", () => {
    // ca1 signs agent1. ca2 signs agent3 and agent4.
    const ca1 = read("ca1-cert.pem");
    const identity = { key: read("agent1-key.pem"), cert: read("agent1-cert.pem") };
    const verified = { ca: ca1, servername: "agent1", rejectUnauthorized: true };

    type Construct = (options: https.ServerOptions, listener?: http.RequestListener) => http.Server;
    const constructors: [string, Construct][] = [
      ["https.createServer()", (options, listener) => https.createServer(options, listener)],
      ["new https.Server()", (options, listener) => new https.Server(options, listener)],
    ];
    // Node's http.Server ignores TLS options.
    if (process.versions.bun) {
      constructors.push(["http.createServer()", (options, listener) => http.createServer(options as {}, listener)]);
    }

    test.each(constructors)("%s ignores changes to its options after it returns", async (_label, construct) => {
      const ca = [ca1];
      const key = Buffer.from(identity.key);
      let requests = 0;
      await using server = construct({ key, cert: identity.cert, ca, requestCert: true }, (req, res) => {
        requests++;
        verdict(req, res);
      });
      ca.push(mtls.ca);
      key.fill(0);
      const port = await listen(server);

      expect(await get(port, "agent4", verified)).toBe("refused");
      expect(requests).toBe(0);
      expect(await get(port, "agent1", verified)).toBe("authorized=true error=null");
    });

    test.each(constructors)("%s throws on a key or certificate that BoringSSL rejects", (_label, construct) => {
      function thrown(options: https.ServerOptions) {
        try {
          construct(options);
        } catch (error) {
          return (error as NodeJS.ErrnoException).code;
        }
      }
      const encrypted = {
        key: readFileSync(join(import.meta.dirname, "fixtures", "cert.encrypted.key"), "utf8"),
        cert: readFileSync(join(import.meta.dirname, "fixtures", "cert.pem"), "utf8"),
      };
      const mismatched = { key: read("agent3-key.pem"), cert: identity.cert };

      expect({
        mismatched: thrown(mismatched),
        certificate: thrown({ key: identity.key, cert: "not a certificate" }),
        wrongPassphrase: thrown({ ...encrypted, passphrase: "wrong" }),
        // Node validates the HTTP options first.
        httpOption: thrown({ ...mismatched, headersTimeout: "soon" as any }),
      }).toEqual({
        mismatched: "ERR_OSSL_X509_KEY_VALUES_MISMATCH",
        certificate: "ERR_OSSL_PEM_NO_START_LINE",
        wrongPassphrase: "ERR_OSSL_BAD_DECRYPT",
        httpOption: "ERR_INVALID_ARG_TYPE",
      });
    });

    test("can't listen in cleartext after the constructor threw", async () => {
      function Legacy(this: https.Server, options: https.ServerOptions) {
        try {
          (https.Server as any).call(this, options);
        } catch {}
      }
      Object.setPrototypeOf(Legacy.prototype, https.Server.prototype);
      const legacy: https.Server = new (Legacy as any)({ key: read("agent3-key.pem"), cert: identity.cert });
      const { promise, resolve } = Promise.withResolvers<string>();
      legacy.on("error", () => resolve("error"));
      legacy.listen(0, "127.0.0.1", () => resolve("listening"));
      try {
        expect(await promise).toBe("error");
      } finally {
        legacy.close();
      }
    });

    test("applies tls.DEFAULT_MIN_VERSION", async () => {
      const saved = tls.DEFAULT_MIN_VERSION;
      tls.DEFAULT_MIN_VERSION = "TLSv1.3";
      try {
        await using server = https.createServer(identity);
        tls.DEFAULT_MIN_VERSION = saved;
        const port = await listen(server);
        expect(await handshake(port, { ...verified, maxVersion: "TLSv1.2" })).toContain("PROTOCOL_VERSION");
        expect(await handshake(port, verified)).toStartWith("TLS_");
      } finally {
        tls.DEFAULT_MIN_VERSION = saved;
      }
    });

    test("resumes a session across close() and a second listen()", async () => {
      await using server = https.createServer(identity);
      async function connect(port: number, session?: Buffer) {
        const client = tls.connect({ port, host: "127.0.0.1", ...verified, maxVersion: "TLSv1.2", session });
        await once(client, "secureConnect");
        return client;
      }
      const first = await connect(await listen(server));
      const session = first.getSession()!;
      first.destroy();
      server.close();
      await once(server, "close");

      const second = await connect(await listen(server), session);
      const reused = second.isSessionReused();
      second.destroy();
      expect(reused).toBe(true);
    });

    // The default CA list is process-wide and can't be restored.
    test("verifies client certificates against tls.setDefaultCACertificates()", async () => {
      const script = `
        const https = require("node:https"), tls = require("node:tls"), fs = require("node:fs");
        const read = name => fs.readFileSync(process.env.KEYS + "/" + name, "utf8");
        tls.setDefaultCACertificates([read("ca2-cert.pem")]);
        const server = https.createServer(
          { key: read("agent1-key.pem"), cert: read("agent1-cert.pem"), requestCert: true, rejectUnauthorized: false },
          (req, res) => res.end("authorized=" + req.socket.authorized),
        );
        server.listen(0, "127.0.0.1", () => {
          https.get({
            port: server.address().port, host: "127.0.0.1", servername: "agent1", ca: read("ca1-cert.pem"), agent: false,
            key: read("agent4-key.pem"), cert: read("agent4-cert.pem"),
          }, res => res.on("data", chunk => console.log(String(chunk))).on("end", () => server.close()));
        });
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: { ...bunEnv, KEYS: join(import.meta.dirname, "../test/fixtures/keys") },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "authorized=true\n", stderr: "", exitCode: 0 });
    });
  });
});

describe("https.Server has the methods of tls.Server", () => {
  const read = (name: string) => readFileSync(join(import.meta.dirname, "../test/fixtures/keys", name), "utf8");
  // agent2 is self-signed. ca1 signs agent1, ca2 signs agent3.
  const agent1 = { key: read("agent1-key.pem"), cert: read("agent1-cert.pem") };
  const agent2 = { key: read("agent2-key.pem"), cert: read("agent2-cert.pem") };
  const agent3 = { key: read("agent3-key.pem"), cert: read("agent3-cert.pem") };
  const ca = [read("ca1-cert.pem"), read("ca2-cert.pem"), agent2.cert];

  // The chain is verified. The names in these tests aren't the ones in the certificates.
  function connect(port: number, options?: tls.ConnectionOptions) {
    return tls.connect({ port, host: "127.0.0.1", ca, checkServerIdentity: () => undefined, ...options });
  }

  // Resolves with the CN of the certificate the server presents, or the error code.
  function servedCN(port: number, servername?: string, options?: tls.ConnectionOptions) {
    const { promise, resolve } = Promise.withResolvers<string>();
    const client = connect(port, { servername, ...options });
    client.on("secureConnect", () => {
      resolve(client.getPeerCertificate().subject.CN);
      client.destroy();
    });
    client.on("error", (err: NodeJS.ErrnoException) => resolve(String(err.code)));
    return promise;
  }

  test("http.Server doesn't have them", () => {
    const server = http.createServer() as Partial<https.Server>;
    expect([server.addContext, server.setSecureContext, server.getTicketKeys, server.setTicketKeys]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  test("addContext() selects a certificate by SNI, before and after listen()", async () => {
    await using server = https.createServer(agent2, (req, res) => res.end((req.socket as tls.TLSSocket).servername));
    server.addContext("a.example.com", agent1);
    const port = await listen(server);
    server.addContext("*.b.example.com", tls.createSecureContext(agent3));

    expect({
      a: await servedCN(port, "a.example.com"),
      b: await servedCN(port, "x.b.example.com"),
      other: await servedCN(port, "c.example.com"),
      none: await servedCN(port),
    }).toEqual({ a: "agent1", b: "agent3", other: "agent2", none: "agent2" });

    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const options = { port, host: "127.0.0.1", servername: "a.example.com", ca, checkServerIdentity: () => undefined };
    https
      .get({ ...options, agent: false }, res => {
        let body = "";
        res.on("data", chunk => (body += chunk)).on("end", () => resolve(body));
      })
      .on("error", reject);
    expect(await promise).toBe("a.example.com");

    // The contexts belong to the server, not to one listener.
    server.close();
    await once(server, "close");
    expect(await servedCN(await listen(server), "x.b.example.com")).toBe("agent3");
  });

  test("addContext() with a hostname it already has replaces the context", async () => {
    await using server = https.createServer(agent2);
    server.addContext("a.example.com", agent1);
    const port = await listen(server);
    expect(await servedCN(port, "a.example.com")).toBe("agent1");
    server.addContext("a.example.com", agent3);
    expect(await servedCN(port, "a.example.com")).toBe("agent3");
  });

  test("addContext() throws without a hostname or with a bad certificate", async () => {
    await using server = https.createServer(agent2);
    const check = () => {
      expect(() => server.addContext("", agent1)).toThrow(
        expect.objectContaining({ code: "ERR_TLS_REQUIRED_SERVER_NAME" }),
      );
      expect(() => server.addContext("a.example.com", { key: agent3.key, cert: agent1.cert })).toThrow(
        expect.objectContaining({ code: "ERR_OSSL_X509_KEY_VALUES_MISMATCH" }),
      );
    };
    check();
    const port = await listen(server);
    check();
    expect(await servedCN(port, "a.example.com")).toBe("agent2");
  });

  test("setSecureContext() applies to new handshakes and keeps open connections", async () => {
    await using server = https.createServer(agent2, (_req, res) => res.end("ok"));
    const port = await listen(server);

    const open = connect(port);
    await once(open, "secureConnect");
    expect(open.getPeerCertificate().subject.CN).toBe("agent2");
    server.setSecureContext(agent1);
    expect(await servedCN(port)).toBe("agent1");

    let response = "";
    open.on("data", chunk => (response += chunk));
    open.end("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    await once(open, "close");
    expect(response).toEndWith("ok");

    // The next listener serves the new context too.
    server.close();
    await once(server, "close");
    expect(await servedCN(await listen(server))).toBe("agent1");
  });

  test("setSecureContext() before listen() replaces the constructor's context", async () => {
    await using server = https.createServer({ ...agent2, minVersion: "TLSv1.3" });
    const pfx = readFileSync(join(import.meta.dirname, "../test/fixtures/keys/agent1.pfx"));
    server.setSecureContext({ pfx, passphrase: "sample" });
    const port = await listen(server);
    // An option the call leaves out goes back to its default.
    expect(await servedCN(port, undefined, { maxVersion: "TLSv1.2" })).toBe("agent1");
  });

  test("setSecureContext() keeps the server's requestCert and rejectUnauthorized", async () => {
    await using server = https.createServer({ ...agent2, ca: ca[0], requestCert: true }, (req, res) =>
      res.end(`authorized=${(req.socket as tls.TLSSocket).authorized}`),
    );
    const port = await listen(server);
    server.setSecureContext({ ...agent3, ca: ca[0] });

    function request(options: tls.ConnectionOptions) {
      const { promise, resolve } = Promise.withResolvers<string>();
      let response = "";
      const client = connect(port, options);
      client.on("secureConnect", () => client.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"));
      client.on("data", chunk => (response += chunk));
      client.on("error", () => {});
      client.on("close", () => resolve(response.match(/authorized=\w+/)?.[0] ?? "refused"));
      return promise;
    }
    expect(await request(agent1)).toBe("authorized=true");
    expect(await request({})).toBe("refused");
  });

  test("setSecureContext() throws on bad options and leaves the context alone", async () => {
    await using server = https.createServer(agent2);
    const port = await listen(server);
    expect(() => server.setSecureContext(undefined as any)).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
    expect(() => server.setSecureContext({ ...agent1, minVersion: "TLSv9" as any })).toThrow(
      expect.objectContaining({ code: "ERR_TLS_INVALID_PROTOCOL_VERSION" }),
    );
    expect(() => server.setSecureContext({ key: agent3.key, cert: agent1.cert })).toThrow(
      expect.objectContaining({ code: "ERR_OSSL_X509_KEY_VALUES_MISMATCH" }),
    );
    expect(await servedCN(port)).toBe("agent2");
  });

  describe("SNICallback", () => {
    test.each<[string, (callback: () => void) => void]>([
      ["synchronously", callback => callback()],
      ["in a microtask", queueMicrotask],
      ["in a later turn of the event loop", setImmediate],
    ])("serves the context it selects %s", async (_label, defer) => {
      const calls: string[] = [];
      await using server: https.Server = https.createServer(
        {
          ...agent2,
          SNICallback(this: tls.TLSSocket & { server: unknown }, servername, callback) {
            calls.push(`${servername} ${this instanceof net.Socket} ${this.server === server}`);
            defer(() => {
              if (servername === "a.example.com") callback(null, tls.createSecureContext(agent1));
              else if (servername === "raw.example.com") callback(null, tls.createSecureContext(agent3).context);
              else callback(null, undefined);
            });
          },
        },
        (req, res) => res.end((req.socket as tls.TLSSocket).servername),
      );
      // Only the default SNICallback reads these.
      server.addContext("b.example.com", agent3);
      const port = await listen(server);

      expect({
        a: await servedCN(port, "a.example.com"),
        raw: await servedCN(port, "raw.example.com"),
        b: await servedCN(port, "b.example.com"),
        none: await servedCN(port),
      }).toEqual({ a: "agent1", raw: "agent3", b: "agent2", none: "agent2" });
      expect(calls).toEqual(["a.example.com true true", "raw.example.com true true", "b.example.com true true"]);

      const { promise, resolve, reject } = Promise.withResolvers<string>();
      const options = {
        port,
        host: "127.0.0.1",
        servername: "a.example.com",
        ca,
        checkServerIdentity: () => undefined,
      };
      https
        .get({ ...options, agent: false }, res => {
          let body = "";
          res.on("data", chunk => (body += chunk)).on("end", () => resolve(body));
        })
        .on("error", reject);
      expect(await promise).toBe("a.example.com");
    });

    test("must be a function", () => {
      expect(() => https.createServer({ ...agent2, SNICallback: 1 as any })).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
      );
    });

    test.each([false, 0, "", null])("SNICallback and ALPNCallback set to %p count as absent", async value => {
      await using server = https.createServer({ ...agent2, SNICallback: value as any, ALPNCallback: value as any });
      expect(await servedCN(await listen(server), "a.example.com")).toBe("agent2");
    });

    test.each<[string, NonNullable<tls.TlsOptions["SNICallback"]>, string]>([
      ["passes an error", (_name, callback) => callback(new Error("no context")), "no context"],
      [
        "passes an error later",
        (_name, callback) => void setImmediate(callback, new Error("no context")),
        "no context",
      ],
      [
        "passes an object that isn't a SecureContext",
        (_name, callback) => callback(null, {} as any),
        "Invalid SNI context",
      ],
      ["throws", () => { throw new Error("thrown"); }, "thrown"], // prettier-ignore
    ])("drops the connection and emits 'tlsClientError' when it %s", async (_label, SNICallback, message) => {
      const events: string[] = [];
      await using server = https.createServer({ ...agent2, SNICallback }, () => events.push("request"));
      const reported = Promise.withResolvers<void>();
      server.on("secureConnection", () => events.push("secureConnection"));
      server.on("clientError", (err, socket) => {
        events.push(`clientError ${err.message}`);
        socket.destroy();
      });
      server.on("tlsClientError", (err, socket) => {
        events.push(`tlsClientError ${err.message} ${socket instanceof net.Socket}`);
        reported.resolve();
      });

      expect(await servedCN(await listen(server), "a.example.com")).toBe("ECONNRESET");
      await reported.promise;
      expect(events).toEqual([`clientError ${message}`, `tlsClientError ${message} true`]);
    });

    test("close() finishes after a 'clientError' listener threw for a refused name", async () => {
      const script = `
        const https = require("node:https");
        const tls = require("node:tls");
        const { key, cert } = ${JSON.stringify(agent2)};
        const connect = servername =>
          tls.connect({ port: server.address().port, host: "127.0.0.1", ca: cert, servername, checkServerIdentity() {} });
        let response;
        const SNICallback = (name, callback) => callback(name === "refused.example.com" ? new Error("refused") : null);
        const server = https.createServer({ key, cert, SNICallback }, (req, res) => {
          response = res;
          connect("refused.example.com").on("error", () => {});
        });
        server.on("clientError", () => {
          throw new Error("listener threw");
        });
        process.on("uncaughtException", err => {
          console.log(err.message);
          // The first connection is still open, so 'close' waits for the connection count to reach zero.
          server.close(() => server.getConnections((_, count) => console.log("closed", count)));
          response.end();
        });
        server.listen(0, "127.0.0.1", () => {
          connect("a.example.com").resume().write("GET / HTTP/1.1\\r\\nHost: a.example.com\\r\\nConnection: close\\r\\n\\r\\n");
        });
      `;
      await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr }).toEqual({ stdout: "listener threw\nclosed 0\n", stderr: "" });
      expect(exitCode).toBe(0);
    });
  });

  test("servers with the same ticket keys resume each other's sessions", async () => {
    await using first = https.createServer(agent2);
    await using second = https.createServer(agent2);
    await using third = https.createServer(agent2);
    expect(first.getTicketKeys()).toHaveLength(48);
    expect(first.getTicketKeys()).not.toEqual(second.getTicketKeys());
    expect(() => first.setTicketKeys(Buffer.alloc(47))).toThrow(
      expect.objectContaining({ code: "ERR_INTERNAL_ASSERTION" }),
    );
    const ports = [await listen(first), await listen(second), await listen(third)];
    second.setTicketKeys(first.getTicketKeys());

    async function handshake(port: number, session?: Buffer) {
      const client = connect(port, { maxVersion: "TLSv1.2", session });
      await once(client, "secureConnect");
      const result = { session: client.getSession()!, reused: client.isSessionReused() };
      client.destroy();
      return result;
    }
    const { session } = await handshake(ports[0]);
    expect((await handshake(ports[1], session)).reused).toBe(true);
    expect((await handshake(ports[2], session)).reused).toBe(false);
  });
});

describe("req.socket of an https.Server", () => {
  const read = (name: string) => readFileSync(join(import.meta.dirname, "../test/fixtures/keys", name), "utf8");
  // ca1 signs agent1, ca2 signs agent3.
  const options = {
    key: read("agent1-key.pem"),
    cert: read("agent1-cert.pem"),
    ca: read("ca2-cert.pem"),
    requestCert: true,
  };
  const client = {
    host: "127.0.0.1",
    servername: "agent1",
    ca: read("ca1-cert.pem"),
    key: read("agent3-key.pem"),
    cert: read("agent3-cert.pem"),
    agent: false,
  };

  function get(port: number, options?: https.RequestOptions) {
    const { promise, resolve, reject } = Promise.withResolvers<any>();
    https
      .get({ ...client, port, ...options }, res => {
        let body = "";
        res.on("data", chunk => (body += chunk)).on("end", () => resolve(JSON.parse(body)));
      })
      .on("error", reject);
    return promise;
  }

  test("is a tls.TLSSocket that reports the client certificate and the session", async () => {
    await using server = https.createServer(options, (req, res) => {
      const socket = req.socket as tls.TLSSocket;
      const peer = socket.getPeerCertificate(true);
      res.end(
        JSON.stringify({
          constructor: socket.constructor.name,
          isTLSSocket: socket instanceof tls.TLSSocket,
          isNetSocket: socket instanceof net.Socket,
          authorized: socket.authorized,
          peer: socket.getPeerCertificate().subject.CN,
          issuer: peer.issuerCertificate.subject.CN,
          peerX509: socket.getPeerX509Certificate()!.subject.includes("CN=agent3"),
          own: (socket.getCertificate() as tls.PeerCertificate).subject.CN,
          ownX509: socket.getX509Certificate()!.subject.includes("CN=agent1"),
          cipher: socket.getCipher().name,
          protocol: socket.getProtocol(),
          reused: socket.isSessionReused(),
          ephemeralKeyInfo: socket.getEphemeralKeyInfo(),
          finished: socket.getFinished()!.length,
          peerFinished: socket.getPeerFinished()!.length,
          keyingMaterial: socket.exportKeyingMaterial(16, "label").length,
        }),
      );
    });
    expect(await get(await listen(server), { maxVersion: "TLSv1.2", ciphers: "ECDHE-RSA-AES128-GCM-SHA256" })).toEqual({
      constructor: "TLSSocket",
      isTLSSocket: true,
      isNetSocket: true,
      authorized: true,
      peer: "agent3",
      issuer: "ca2",
      peerX509: true,
      own: "agent1",
      ownX509: true,
      cipher: "ECDHE-RSA-AES128-GCM-SHA256",
      protocol: "TLSv1.2",
      reused: false,
      ephemeralKeyInfo: null,
      finished: 12,
      peerFinished: 12,
      keyingMaterial: 16,
    });
  });

  test.each(["TLSv1.2", "TLSv1.3"] as const)(
    "answers every tls.TLSSocket member like a tls.Server's socket on %s",
    async version => {
      // Buffers differ between two connections, so only their presence is compared.
      const summarize = (value: unknown): unknown =>
        Buffer.isBuffer(value)
          ? `Buffer ${value.length > 0}`
          : value instanceof X509Certificate
            ? value.subject
            : value && typeof value === "object" && "subject" in value
              ? (value as tls.PeerCertificate).subject.CN
              : value;
      function members(socket: tls.TLSSocket) {
        const answers: Record<string, unknown> = {};
        for (const name of Object.getOwnPropertyNames(tls.TLSSocket.prototype).sort()) {
          if (/^(get|is)[A-Z]/.test(name)) answers[name] = summarize(socket[name]());
        }
        answers.exportKeyingMaterial = summarize(socket.exportKeyingMaterial(16, "label"));
        answers.setMaxSendFragment = [511, 512, 16384, 16385].map(size => socket.setMaxSendFragment(size));
        answers.disableRenegotiation = socket.disableRenegotiation();
        for (const name of ["servername", "alpnProtocol", "authorized", "authorizationError", "encrypted"]) {
          answers[name] = socket[name];
        }
        return JSON.stringify(answers);
      }
      const head = "HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n";
      await using overHttps = https.createServer(options, (req, res) => res.end(members(req.socket as tls.TLSSocket)));
      await using overTls = tls.createServer(options, socket => socket.once("data", () => socket.end(head + members(socket)))); // prettier-ignore
      overTls.listen(0, "127.0.0.1");
      await once(overTls, "listening");
      const range = { minVersion: version, maxVersion: version };
      const [fromHttps, fromTls] = await Promise.all([
        get(await listen(overHttps), range),
        get((overTls.address() as AddressInfo).port, range),
      ]);
      expect(fromHttps).toEqual(fromTls);
      expect(fromHttps).toMatchObject({
        getProtocol: version,
        getSession: "Buffer true",
        getPeerCertificate: "agent3",
        setMaxSendFragment: [false, true, true, false],
        servername: "agent1",
        authorized: true,
      });
      expect(fromHttps.getSharedSigalgs).toBeArray();
    },
  );

  test("returns an empty certificate without a client certificate, and null once closed", async () => {
    const closed = Promise.withResolvers<tls.TLSSocket>();
    await using server = https.createServer({ ...options, rejectUnauthorized: false }, (req, res) => {
      const socket = req.socket as tls.TLSSocket;
      socket.on("close", () => closed.resolve(socket));
      res.end(JSON.stringify({ authorized: socket.authorized, peer: socket.getPeerCertificate() }));
    });
    const port = await listen(server);
    expect(await get(port, { key: undefined, cert: undefined })).toEqual({ authorized: false, peer: {} });
    const socket = await closed.promise;
    expect([socket.getPeerCertificate(), socket.getCertificate(), socket.getProtocol()]).toEqual([null, null, null]);
  });

  test("is still a plain net.Socket on an http.Server", async () => {
    await using server = http.createServer((req, res) => res.end(String(req.socket instanceof tls.TLSSocket)));
    const response = await fetch(`http://127.0.0.1:${await listen(server)}/`);
    expect(await response.text()).toBe("false");
  });
});

describe("https.Server wraps a socket passed to emit('connection') in TLS", () => {
  const read = (name: string) => readFileSync(join(import.meta.dirname, "../test/fixtures/keys", name), "utf8");
  const identity = { key: read("agent1-key.pem"), cert: read("agent1-cert.pem") };
  const verified = { ca: read("ca1-cert.pem"), servername: "agent1" };

  function describeSocket(this: http.Server, req: http.IncomingMessage, res: http.ServerResponse) {
    const socket = req.socket as tls.TLSSocket & { server: unknown };
    res.writeHead(200, { Connection: "close" });
    res.end(`${socket instanceof tls.TLSSocket} ${socket.encrypted} ${socket.alpnProtocol} ${socket.server === this}`);
  }

  test.each<[string, https.ServerOptions]>([
    ["the default ALPNProtocols", {}],
    ["ALPNProtocols", { ALPNProtocols: ["x", "http/1.1"] }],
    ["ALPNCallback", { ALPNCallback: ({ protocols }) => protocols.at(-1) }],
  ])("a net.Socket, with %s", async (_label, options) => {
    const server = https.createServer({ ...identity, ...options }, describeSocket);
    const secureConnection = once(server, "secureConnection");
    await using front = net.createServer(socket => void server.emit("connection", socket));
    const port = await listen(front as any);

    const { promise, resolve, reject } = Promise.withResolvers<string>();
    https
      .get({ port, host: "127.0.0.1", ...verified, ALPNProtocols: ["http/1.1"], agent: false }, res => {
        let body = "";
        res.on("data", chunk => (body += chunk)).on("end", () => resolve(body));
      })
      .on("error", reject);
    expect(await promise).toBe("true true http/1.1 true");
    expect((await secureConnection)[0]).toBeInstanceOf(tls.TLSSocket);
  });

  test("the socket of another server's 'connect' event", async () => {
    const server = https.createServer(identity, describeSocket);
    const front = http.createServer();
    const frontClosed = Promise.withResolvers<void>();
    front.on("connect", (_req, socket) => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      server.emit("connection", socket);
      // The tunnel still counts as a connection of the server that accepted it.
      front.close(() => frontClosed.resolve());
    });
    const port = await listen(front);

    const tunnel = http.request({ port, host: "127.0.0.1", method: "CONNECT", path: "agent1:443" }).end();
    const [, socket] = await once(tunnel, "connect");
    const client = tls.connect({ socket, ...verified });
    let response = "";
    client.on("data", chunk => (response += chunk));
    client.write("GET / HTTP/1.1\r\nHost: agent1\r\n\r\n");
    await once(client, "close");
    expect(response).toContain("true true false true");
    await frontClosed.promise;
  });

  test.each(["connect", "upgrade"])(
    "emit('secureConnection') parses HTTP on its own '%s' socket, which is already decrypted",
    async event => {
      await using server = https.createServer(identity, (req, res) => res.end(`${req.url} ${req.socket.encrypted}`));
      server.on(event, (_req, socket) => {
        socket.write("HTTP/1.1 200 OK\r\n\r\n");
        server.emit("secureConnection", socket);
      });
      const client = tls.connect({ port: await listen(server), host: "127.0.0.1", ...verified });
      client.write(
        event === "connect"
          ? "CONNECT agent1:443 HTTP/1.1\r\nHost: agent1:443\r\n\r\n"
          : "GET / HTTP/1.1\r\nHost: agent1\r\nConnection: Upgrade\r\nUpgrade: x\r\n\r\n",
      );
      await once(client, "data");
      let response = "";
      client.on("data", chunk => (response += chunk));
      client.write("GET /tunneled HTTP/1.1\r\nHost: agent1\r\nConnection: close\r\n\r\n");
      await once(client, "close");
      expect(response).toEndWith("\r\n\r\n/tunneled true");
    },
  );

  test.each([
    ["calls 'clientError' listeners", true],
    ["destroys the socket without a 'clientError' listener", false],
  ])("%s when the handshake times out", async (_label, handled) => {
    const server = https.createServer({ ...identity, handshakeTimeout: 1 });
    const events: string[] = [];
    server.on("tlsClientError", (err: NodeJS.ErrnoException) => events.push(`tlsClientError ${err.code}`));
    if (handled) {
      server.on("clientError", (err: NodeJS.ErrnoException, socket) => {
        events.push(`clientError ${err.code} destroyed=${socket.destroyed}`);
        socket.destroy();
      });
    }
    await using front = net.createServer(socket => void server.emit("connection", socket));
    const client = net.connect(await listen(front as any), "127.0.0.1");
    client.on("error", () => {});
    await once(client, "close");
    expect(events).toEqual([
      ...(handled ? ["clientError ERR_TLS_HANDSHAKE_TIMEOUT destroyed=false"] : []),
      "tlsClientError ERR_TLS_HANDSHAKE_TIMEOUT",
    ]);
  });
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

    // The server closes the peer at accept, before the handshake.
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
          // An https server closes the peer at accept, before the handshake.
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

// https://nodejs.org/api/tls.html#event-connection
describe.concurrent("an https connection before its TLS handshake", () => {
  type Socket = net.Socket & { _secureEstablished?: boolean; parser?: object | null };

  function listenWithTls(server: http.Server): Promise<number> {
    const { promise, resolve, reject } = Promise.withResolvers<number>();
    server.once("error", reject);
    server.listen({ port: 0, host: "127.0.0.1", tls: validCert }, () =>
      resolve((server.address() as AddressInfo).port),
    );
    return promise;
  }

  type Create = (listener?: http.RequestListener) => http.Server;
  const entryPoints: [string, Create, (server: http.Server) => Promise<number>][] = [
    ["https.createServer()", listener => https.createServer(validCert, listener), listen],
  ];
  // Node's http.Server ignores key and cert, and its listen() takes no tls option.
  if (process.versions.bun) {
    entryPoints.push(
      ["http.createServer({ key, cert })", listener => http.createServer({ ...validCert } as {}, listener), listen],
      ["http.createServer().listen({ tls })", listener => http.createServer(listener), listenWithTls],
    );
  }

  function connections(server: http.Server) {
    const { promise, resolve, reject } = Promise.withResolvers<number>();
    server.getConnections((err, count) => (err ? reject(err) : resolve(count)));
    return promise;
  }

  // Sends the first byte of a TLS record and stalls. With a byte to read, TCP_DEFER_ACCEPT doesn't delay the accept.
  async function stalledClient(port: number) {
    const socket = net.connect(port, "127.0.0.1");
    socket.on("error", () => {});
    socket.resume();
    await once(socket, "connect");
    socket.write(Buffer.from([0x16]));
    return socket;
  }

  // events.once() would reject if the peer's reset arrives before 'close'.
  function closed(socket: net.Socket) {
    const { promise, resolve } = Promise.withResolvers<void>();
    socket.on("close", () => resolve());
    return promise;
  }

  function get(port: number) {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    https
      .get({ host: "127.0.0.1", port, agent: false, ca: validCert.cert }, res => {
        let body = "";
        res.on("data", chunk => (body += chunk)).on("end", () => resolve(body));
      })
      .on("error", reject);
    return promise;
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
      server.timeout = 60_000;
      const state = (socket: Socket) =>
        `secure=${!!socket._secureEstablished} parser=${socket.parser != null} timeout=${socket.timeout || 0}`;
      server.on("connection", (socket: Socket) => events.push(`connection ${state(socket)}`));
      server.on("secureConnection", (socket: Socket) => events.push(`secureConnection ${state(socket)}`));
      const port = await listenOn(server);
      const stalled = await stalledClient(port);
      try {
        // The listener accepts in order, so the stalled client is a connection before this request is served.
        expect(await get(port)).toBe("ok");
        expect(events).toEqual([
          "connection secure=false parser=false timeout=0",
          "connection secure=false parser=false timeout=0",
          "secureConnection secure=true parser=true timeout=60000",
          "request encrypted=true",
        ]);
        expect(counts).toEqual([2]);
      } finally {
        stalled.destroy();
        server.close();
      }
    },
  );

  test("emits no second 'connection' when the handshake fails", async () => {
    const events: string[] = [];
    const server = https.createServer(validCert, () => expect.unreachable());
    for (const event of ["connection", "secureConnection"]) server.on(event, () => events.push(event));
    const accepted = once(server, "connection");
    const client = await stalledClient(await listen(server));
    try {
      const [socket] = (await accepted) as [Socket];
      const socketClosed = once(socket, "close");
      client.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
      await Promise.all([socketClosed, closed(client)]);
      expect(events).toEqual(["connection"]);
      expect(await connections(server)).toBe(0);
    } finally {
      client.destroy();
      server.close();
    }
  });

  test("a 'connection' listener can destroy the socket", async () => {
    const events: string[] = [];
    const server = https.createServer(validCert, () => expect.unreachable());
    server.on("connection", socket => {
      events.push("connection");
      socket.destroy();
    });
    server.on("secureConnection", () => events.push("secureConnection"));
    try {
      expect(await tlsHandshake(await listen(server))).toBe("ECONNRESET");
      expect(events).toEqual(["connection"]);
    } finally {
      server.close();
    }
  });

  // server-destroy and http-shutdown destroy the sockets they collected from 'connection'.
  test("close() finishes once the sockets from 'connection' are destroyed", async () => {
    const sockets = new Set<net.Socket>();
    const server = https.createServer(validCert, () => expect.unreachable());
    server.on("connection", socket => sockets.add(socket));
    const accepted = once(server, "connection");
    const stalled = await stalledClient(await listen(server));
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

  test("counts toward server.maxConnections, which drops the next peer before its handshake", async () => {
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

  test.each([
    ["close()", (server: http.Server) => void server.close()],
    ["closeIdleConnections()", (server: http.Server) => server.closeIdleConnections()],
  ])("%s in a 'connection' listener doesn't close it", async (_label, sweep) => {
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
    try {
      expect(await get(await listen(server))).toBe("ok");
      expect(events).toEqual(["connection", "secureConnection", "request"]);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  test("closeAllConnections() and the headersTimeout sweep skip it", async () => {
    const server = https.createServer({ ...validCert, headersTimeout: 50, connectionsCheckingInterval: 10 }, () =>
      expect.unreachable(),
    );
    const accepted = once(server, "connection");
    const port = await listen(server);
    const stalled = await stalledClient(port);
    const [stalledSocket] = (await accepted) as [Socket];
    // Finishes its handshake and sends no request, so the sweep answers 408. The stalled connection is older.
    const idle = tls.connect({ port, host: "127.0.0.1", ca: validCert.cert });
    idle.on("error", () => {});
    let response = "";
    idle.on("data", chunk => (response += chunk));
    try {
      await closed(idle);
      expect(response).toStartWith("HTTP/1.1 408 ");
      server.closeAllConnections();
      expect(stalledSocket.destroyed).toBe(false);
      expect(await connections(server)).toBe(1);
    } finally {
      stalled.destroy();
      idle.destroy();
      server.close();
    }
  });

  test("a socket timeout neither reaches the server's 'timeout' event nor destroys the socket", async () => {
    const events: string[] = [];
    const server = https.createServer(validCert, () => expect.unreachable());
    server.on("timeout", () => events.push("server timeout"));
    const timedOut = Promise.withResolvers<Socket>();
    server.on("connection", socket => {
      socket.setTimeout(1);
      socket.on("timeout", () => timedOut.resolve(socket));
    });
    const stalled = await stalledClient(await listen(server));
    try {
      const socket = await timedOut.promise;
      expect({ events, destroyed: socket.destroyed }).toEqual({ events: [], destroyed: false });
    } finally {
      stalled.destroy();
      server.close();
    }
  });

  // Runs in a child because the sweeps also advance every other socket's timeout on the thread.
  test.skipIf(!process.versions.bun)("is closed after handshakeTimeout, 120 seconds by default", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        import { sweepSocketTimers } from "bun:internal-for-testing";
        import { once } from "node:events";
        import https from "node:https";
        import net from "node:net";
        const { key, cert } = JSON.parse(process.env.CERT);
        for (const handshakeTimeout of [undefined, 1, 30_000, 400_000]) {
          const events = [];
          const server = https.createServer({ key, cert, handshakeTimeout });
          server.on("clientError", (err, socket) => {
            events.push("clientError " + err.code + " " + socket.destroyed + " " + socket._secureEstablished);
            socket.destroy();
          });
          server.on("tlsClientError", (err, socket) => events.push("tlsClientError " + err.code + " " + socket.destroyed));
          server.listen(0, "127.0.0.1");
          const accepted = once(server, "connection");
          await once(server, "listening");
          // A sweep runs every 4 seconds. The timeout is set right after this one, so it's due at the first that comes no earlier.
          sweepSocketTimers(1);
          const client = net.connect(server.address().port, "127.0.0.1");
          // The close finds an unread byte, so the client may see a reset.
          client.on("error", () => {});
          const closed = new Promise(resolve => client.on("close", resolve));
          client.resume();
          // With a byte to read, TCP_DEFER_ACCEPT doesn't delay the accept.
          client.write(Buffer.from([0x16]));
          await accepted;
          sweepSocketTimers(Math.floor((handshakeTimeout ?? 120_000) / 4000));
          const early = events.length;
          sweepSocketTimers(1);
          await closed;
          console.log(handshakeTimeout, early, events.join(", "));
          server.close();
        }
        `,
      ],
      env: { ...bunEnv, CERT: JSON.stringify(validCert) },
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    const events = "clientError ERR_TLS_HANDSHAKE_TIMEOUT false false, tlsClientError ERR_TLS_HANDSHAKE_TIMEOUT true";
    expect(stdout.trim().split("\n")).toEqual([undefined, 1, 30_000, 400_000].map(ms => `${ms} 0 ${events}`));
    expect(exitCode).toBe(0);
  });

  test("server.timeout replaces a longer timeout from a 'connection' listener after the handshake", async () => {
    const server = https.createServer(validCert, () => {});
    server.timeout = 50;
    server.on("connection", socket => socket.setTimeout(60_000));
    const timedOut = once(server, "timeout");
    const client = tls.connect({ port: await listen(server), host: "127.0.0.1", ca: validCert.cert });
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

describe("https.Server reads its TLS options the way Node does", () => {
  const keysDir = join(import.meta.dir, "../test/fixtures/keys");
  const keys = (file: string) => readFileSync(join(keysDir, file));
  const agent1 = { key: keys("agent1-key.pem"), cert: keys("agent1-cert.pem") }; // issued by ca1
  const agent3 = { key: keys("agent3-key.pem"), cert: keys("agent3-cert.pem") }; // issued by ca2
  const agent3Files = { keyFile: join(keysDir, "agent3-key.pem"), certFile: join(keysDir, "agent3-cert.pem") };
  const asksForCertificate = { requestCert: true, rejectUnauthorized: false };

  const createServer = (options: object) =>
    https
      .createServer(options, (req, res) => res.end(String((req.socket as tls.TLSSocket).authorized)))
      .on("tlsClientError", () => {});

  // The name in the server's certificate, and whether the server trusts the issuer of the client's.
  async function request(server: https.Server, client: { key: Buffer; cert: Buffer }) {
    const port = server.listening ? (server.address() as AddressInfo).port : await listen(server);
    const { promise, resolve } = Promise.withResolvers<string>();
    const req = https.get({ port, host: "127.0.0.1", ca: [keys("ca1-cert.pem"), keys("ca2-cert.pem")], checkServerIdentity: () => undefined, agent: false, ...client }, res => {
      const name = (res.socket as tls.TLSSocket).getPeerCertificate().subject.CN;
      res.setEncoding("utf8").on("data", authorized => resolve(`${name}, client authorized: ${authorized}`));
    }); // prettier-ignore
    req.on("error", () => resolve("refused"));
    return promise;
  }

  test("ca isn't replaced by caFile", async () => {
    const options = {
      ...agent1,
      ...asksForCertificate,
      ca: keys("ca1-cert.pem"),
      caFile: join(keysDir, "ca2-cert.pem"),
    };
    const server = createServer(options);
    try {
      expect(await request(server, agent1)).toBe("agent1, client authorized: true");
      expect(await request(server, agent3)).toBe("agent1, client authorized: false");
    } finally {
      server.close();
    }
  });

  test("key and cert aren't replaced by keyFile and certFile", async () => {
    const server = createServer({ ...agent1, ...agent3Files });
    try {
      expect(await request(server, agent1)).toBe("agent1, client authorized: false");
    } finally {
      server.close();
    }
  });

  test("a certFile that doesn't match key is ignored", async () => {
    const server = createServer({ ...agent1, certFile: agent3Files.certFile });
    try {
      expect(await request(server, agent1)).toBe("agent1, client authorized: false");
    } finally {
      server.close();
    }
  });

  test("keyFile and certFile alone are no certificate", async () => {
    const server = createServer(agent3Files);
    try {
      expect(await request(server, agent1)).toBe("refused");
    } finally {
      server.close();
    }
  });

  const given = { ...agent3, ca: keys("ca2-cert.pem") };
  test.each([
    ["inherited", () => Object.create(given)],
    [
      "class getters",
      () => {
        class Options {}
        for (const [name, value] of Object.entries(given)) Object.defineProperty(Options.prototype, name, { get: () => value }); // prettier-ignore
        return new Options();
      },
    ],
    [
      "non-enumerable",
      () => Object.defineProperties({}, Object.fromEntries(Object.entries(given).map(([name, value]) => [name, { value }]))), // prettier-ignore
    ],
  ])("setSecureContext() takes options that are %s", async (_, options) => {
    const server = createServer({ ...agent1, ...asksForCertificate });
    try {
      expect(await request(server, agent3)).toBe("agent1, client authorized: false");
      server.setSecureContext(options());
      expect(await request(server, agent3)).toBe("agent3, client authorized: true");
    } finally {
      server.close();
    }
  });
});
