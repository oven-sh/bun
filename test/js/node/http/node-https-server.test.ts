import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir, tls as validCert } from "harness";
import { spawn } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { once } from "node:events";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
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
    ["ca", false],
    ["ca", 0],
    ["ca", ""],
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

  // Node builds the context in the constructor, and listen() reads no option again:
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1384
  describe("when the server is constructed, and never again", () => {
    // ca1 signs agent1, which the server here presents and one client too. ca2 signs agent3 and agent4.
    const [ca1, ca2] = [read("ca1-cert.pem"), read("ca2-cert.pem")];
    const identity = { key: read("agent1-key.pem"), cert: read("agent1-cert.pem") };
    const authorized = "authorized=true error=null";

    type Construct = (options: https.ServerOptions, listener?: http.RequestListener) => http.Server;
    const constructors: [string, Construct][] = [
      ["https.createServer()", (options, listener) => https.createServer(options, listener)],
      ["new https.Server()", (options, listener) => new https.Server(options, listener)],
      ["https.Server()", (options, listener) => (https.Server as any)(options, listener)],
    ];
    // Bun only: Node's http.Server ignores TLS options.
    if (process.versions.bun) {
      constructors.push(
        ["http.createServer()", (options, listener) => http.createServer(options as http.ServerOptions, listener)],
        ["new http.Server()", (options, listener) => new http.Server(options as http.ServerOptions, listener)],
      );
    }

    // Each changes, after the server exists, what its options named. Unless it says otherwise, agent1 stays trusted and agent4 refused.
    type Change = { options: object; change(): void; served?: string; refused?: string };
    const changes: [string, (dir: string) => Change][] = [
      [
        "a CA is pushed into the `ca` array",
        () => {
          const ca = [ca1];
          return { options: { ...identity, ca, requestCert: true }, change: () => void ca.push(ca2) };
        },
      ],
      [
        "a Buffer in the `ca` array is overwritten with another CA",
        () => {
          // A PEM parser skips the newlines that pad the shorter certificate.
          const buffer = Buffer.alloc(Math.max(ca1.length, ca2.length), "\n");
          buffer.write(ca1);
          return {
            options: { ...identity, ca: [buffer], requestCert: true },
            change: () => void buffer.fill("\n").write(ca2),
          };
        },
      ],
      [
        "the `crl` array is emptied",
        () => {
          const crl = [read("ca2-crl-agent3.pem")];
          return {
            options: { ...identity, ca: ca2, crl, requestCert: true },
            change: () => void (crl.length = 0),
            served: "agent4",
            refused: "agent3",
          };
        },
      ],
      [
        "the `key` Buffer is zeroed",
        () => {
          const key = Buffer.from(identity.key);
          return { options: { ...identity, key, ca: ca1, requestCert: true }, change: () => void key.fill(0) };
        },
      ],
      [
        "the `cert` Buffer is zeroed",
        () => {
          const cert = Buffer.from(identity.cert);
          return { options: { ...identity, cert, ca: ca1, requestCert: true }, change: () => void cert.fill(0) };
        },
      ],
      [
        "the Buffer of a `{ pem }` key is zeroed",
        () => {
          const pem = Buffer.from(identity.key);
          return {
            options: { ...identity, key: [{ pem }], ca: ca1, requestCert: true },
            change: () => void pem.fill(0),
          };
        },
      ],
      [
        "the ArrayBuffer of the `key` is transferred",
        () => {
          const key = new Uint8Array(Buffer.from(identity.key));
          return {
            options: { ...identity, key, ca: ca1, requestCert: true },
            change: () => void (key.buffer as ArrayBuffer).transfer(),
          };
        },
      ],
    ];
    if (process.versions.bun) {
      changes.push(
        [
          "the file of a `ca` BunFile is rewritten with another CA",
          dir => {
            const path = join(dir, "ca.pem");
            writeFileSync(path, ca1);
            return {
              options: { ...identity, ca: Bun.file(path), requestCert: true },
              change: () => writeFileSync(path, ca2),
            };
          },
        ],
        [
          "the file of a `key` BunFile is deleted",
          dir => {
            const path = join(dir, "key.pem");
            writeFileSync(path, identity.key);
            return {
              options: { ...identity, key: Bun.file(path), ca: ca1, requestCert: true },
              change: () => rmSync(path),
            };
          },
        ],
      );
    }

    describe.concurrent.each(changes)("%s", (_label, build) => {
      test.each([
        ["before listen()", false],
        ["between close() and a second listen()", true],
      ])("%s", async (_when, relisten) => {
        using dir = tempDir("https-options-at-construction", {});
        const { options, change, served = "agent1", refused = "agent4" } = build(String(dir));
        let requests = 0;
        await using server = https.createServer(options as https.ServerOptions, (req, res) => {
          requests++;
          verdict(req, res);
        });
        if (relisten) {
          await listen(server);
          server.close();
          await once(server, "close");
        }
        change();
        const port = await listen(server);

        expect(await get(port, refused)).toBe("refused");
        expect(requests).toBe(0);
        expect(await get(port, served)).toBe(authorized);
      });
    });

    test.concurrent.each(constructors)("%s trusts the `ca` array as it was", async (_label, construct) => {
      const ca = [ca1];
      let requests = 0;
      await using server = construct({ ...identity, ca, requestCert: true }, (req, res) => {
        requests++;
        verdict(req, res);
      });
      ca.push(ca2);
      const port = await listen(server);

      expect(await get(port, "agent4")).toBe("refused");
      expect(requests).toBe(0);
      expect(await get(port, "agent1")).toBe(authorized);
    });

    test.each(constructors)(
      "%s throws for a key or a certificate that the TLS library rejects",
      (_label, construct) => {
        const thrown = (options: object) => {
          try {
            construct(options);
          } catch (error) {
            return (error as NodeJS.ErrnoException).code;
          }
        };
        // A fixed file: what a wrong passphrase makes of a key depends on the salt the key was encrypted with.
        const encrypted = {
          key: readFileSync(join(import.meta.dirname, "fixtures", "cert.encrypted.key"), "utf8"),
          cert: readFileSync(join(import.meta.dirname, "fixtures", "cert.pem"), "utf8"),
        };
        // agent3's key does not belong to agent1's certificate.
        const mismatched = { key: read("agent3-key.pem"), cert: identity.cert };

        expect({
          mismatched: thrown(mismatched),
          certificate: thrown({ key: identity.key, cert: "not a certificate" }),
          wrongPassphrase: thrown({ ...encrypted, passphrase: "wrong" }),
          noPassphrase: thrown(encrypted),
          // Node checks the HTTP options before it builds the context.
          httpOption: thrown({ ...mismatched, headersTimeout: "soon" }),
        }).toEqual({
          mismatched: "ERR_OSSL_X509_KEY_VALUES_MISMATCH",
          certificate: "ERR_OSSL_PEM_NO_START_LINE",
          wrongPassphrase: "ERR_OSSL_BAD_DECRYPT",
          noPassphrase: "ERR_OSSL_BAD_DECRYPT",
          httpOption: "ERR_INVALID_ARG_TYPE",
        });
      },
    );

    // Bun only: a BunFile is read when the context is built.
    test.skipIf(!process.versions.bun)(
      "throws for a BunFile that does not exist when the server is constructed",
      () => {
        using dir = tempDir("https-options-at-construction", {});
        const options: object = { ...identity, key: Bun.file(join(String(dir), "key.pem")) };
        expect(() => https.createServer(options as https.ServerOptions)).toThrow(
          expect.objectContaining({ code: "ENOENT" }),
        );
      },
    );

    test("keeps requestCert without rejectUnauthorized across close() and a second listen()", async () => {
      const options = { ...identity, ca: ca1, requestCert: true, rejectUnauthorized: false };
      await using server = https.createServer(options, verdict);
      const verdicts = async (port: number) => ({
        agent1: await get(port, "agent1"),
        agent4: await get(port, "agent4"),
      });
      const expected = { agent1: authorized, agent4: "authorized=false error=UNABLE_TO_VERIFY_LEAF_SIGNATURE" };

      expect(await verdicts(await listen(server))).toEqual(expected);
      server.close();
      await once(server, "close");
      expect(await verdicts(await listen(server))).toEqual(expected);
    });

    test("serves a client that names the `servername` of the server, and one that names another", async () => {
      await using server = https.createServer({ ...identity, servername: "agent1" } as https.ServerOptions);
      const port = await listen(server);

      expect(await handshake(port, { servername: "agent1" })).toStartWith("TLS_");
      expect(await handshake(port, { servername: "another.example" })).toStartWith("TLS_");
    });

    test("resumes a session across close() and a second listen()", async () => {
      await using server = https.createServer(identity);
      async function connect(port: number, session?: Buffer) {
        const client = tls.connect({
          port,
          host: "127.0.0.1",
          rejectUnauthorized: false,
          maxVersion: "TLSv1.2",
          session,
        });
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

    // The ticket carries the verdict of the handshake that earned it, and the context that issued it is still the server's.
    test("serves a session of before close() in place of the client certificate it was issued for", async () => {
      await using server = https.createServer({ ...identity, ca: ca1, requestCert: true }, verdict);
      // What the server answers, or "refused", and the session it issues.
      async function request(port: number, options: tls.ConnectionOptions) {
        const client = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false, maxVersion: "TLSv1.2", ...options }); // prettier-ignore
        let answer = "";
        let session: Buffer | undefined;
        client.on("session", issued => (session = issued));
        client.on("data", chunk => (answer += chunk));
        client.on("error", () => {});
        client.on("secureConnect", () =>
          client.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"),
        );
        const closed = Promise.withResolvers<void>();
        client.on("close", () => closed.resolve());
        await closed.promise;
        return { verdict: answer.match(/authorized=\w+/)?.[0] ?? "refused", session };
      }
      const first = await request(await listen(server), identity);
      server.close();
      await once(server, "close");
      const port = await listen(server);

      expect({
        certificate: first.verdict,
        session: (await request(port, { session: first.session })).verdict,
        neither: (await request(port, {})).verdict,
      }).toEqual({ certificate: "authorized=true", session: "authorized=true", neither: "refused" });
    });

    // In a process of its own: tls.DEFAULT_CIPHERS and the default CA list are process-wide, and neither can be put back.
    test("takes the process-wide TLS defaults as they are when it is constructed", async () => {
      const script = `
        const https = require("node:https"), tls = require("node:tls"), { once } = require("node:events");
        const { readFileSync } = require("node:fs"), { join } = require("node:path");
        const keys = name => readFileSync(join(process.env.TEST_KEYS, name));
        const identity = { key: keys("agent1-key.pem"), cert: keys("agent1-cert.pem") };
        const [aes128, aes256] = ["ECDHE-RSA-AES128-GCM-SHA256", "ECDHE-RSA-AES256-GCM-SHA384"];

        async function listen(server) {
          await once(server.listen(0, "127.0.0.1"), "listening");
          return server.address().port;
        }
        // What the server answers to a request, or the cipher of the handshake when there is no request, or the error code.
        function connect(port, options, request) {
          const { promise, resolve } = Promise.withResolvers();
          let answer = "";
          const client = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false, ...options }, () => {
            if (request) return client.write("GET / HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n");
            resolve(client.getCipher().name);
            client.destroy();
          });
          client.on("data", chunk => (answer += chunk));
          client.on("error", error => resolve(error.code));
          client.on("close", () => resolve(answer.slice(answer.indexOf("\\r\\n\\r\\n") + 4)));
          return promise;
        }
        // A server that is constructed while tls[name] is value.
        function constructedWith(name, value) {
          const saved = tls[name];
          tls[name] = value;
          try {
            return https.createServer(identity);
          } finally {
            tls[name] = saved;
          }
        }
        const result = {};

        const atLeast13 = constructedWith("DEFAULT_MIN_VERSION", "TLSv1.3");
        const atMost12 = constructedWith("DEFAULT_MAX_VERSION", "TLSv1.2");
        const [port13, port12] = [await listen(atLeast13), await listen(atMost12)];
        result.atLeast13 = await connect(port13, { maxVersion: "TLSv1.2" });
        // A TLS 1.2 suite: the names of TLS 1.3 suites start with TLS_.
        result.atMost12 = (await connect(port12, {})).slice(0, 6);

        // The list is narrowed only while listen() runs: that is where a late read would take it.
        const server = https.createServer(identity);
        const saved = tls.DEFAULT_CIPHERS;
        tls.DEFAULT_CIPHERS = aes128;
        const listening = listen(server);
        tls.DEFAULT_CIPHERS = saved;
        result.ciphers = await connect(await listening, { ciphers: aes256, maxVersion: "TLSv1.2" });

        // ca1 signs agent1, and agent1.pfx carries it. ca2 signs agent4.
        tls.setDefaultCACertificates([keys("ca2-cert.pem").toString()]);
        async function authorized(options) {
          const policy = { requestCert: true, rejectUnauthorized: false };
          const port = await listen(https.createServer({ ...options, ...policy }, (req, res) => res.end(String(req.socket.authorized))));
          const verdicts = {};
          for (const agent of ["agent1", "agent4"]) {
            verdicts[agent] = await connect(port, { key: keys(agent + "-key.pem"), cert: keys(agent + "-cert.pem") }, true);
          }
          return verdicts;
        }
        result.defaultCA = {
          plain: await authorized(identity),
          pfx: await authorized({ pfx: keys("agent1.pfx"), passphrase: "sample" }),
        };

        console.log(JSON.stringify(result));
        process.exit(0);
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: { ...bunEnv, TEST_KEYS: join(import.meta.dirname, "../test/fixtures/keys") },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stderr, result: JSON.parse(stdout || "null") }).toEqual({
        stderr: "",
        result: {
          atLeast13: "ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION",
          atMost12: "ECDHE-",
          ciphers: "ECDHE-RSA-AES256-GCM-SHA384",
          defaultCA: { plain: { agent1: "false", agent4: "true" }, pfx: { agent1: "true", agent4: "true" } },
        },
      });
      expect(exitCode).toBe(0);
    });

    // A subclass in the old style can swallow the throw of the constructor. What is left must not listen without TLS.
    // Bun only: in Node such a server neither listens nor reports an error.
    test.skipIf(!process.versions.bun)("does not listen when its context did not build", async () => {
      function Swallowing(this: https.Server, options: https.ServerOptions) {
        try {
          (https.Server as any).call(this, options);
        } catch {}
      }
      Object.setPrototypeOf(Swallowing.prototype, https.Server.prototype);
      // agent3's key does not belong to agent1's certificate.
      const server: https.Server = new (Swallowing as any)({ key: read("agent3-key.pem"), cert: identity.cert });
      const settled = Promise.withResolvers<string>();
      server.once("listening", () => settled.resolve("listening")).once("error", () => settled.resolve("error"));
      server.listen(0, "127.0.0.1");
      try {
        expect({ outcome: await settled.promise, address: server.address() }).toEqual({
          outcome: "error",
          address: null,
        });
      } finally {
        if (server.listening) server.close();
      }
    });

    // Bun only: the options of a listen() call take the place of those of the constructor.
    test.skipIf(!process.versions.bun)(
      "listen({ tls }) serves the options of that call and no context among them",
      async () => {
        const agent3 = { key: read("agent3-key.pem"), cert: read("agent3-cert.pem") };
        await using server = https.createServer(identity);
        const listening = once(server, "listening");
        const secureContext = (tls.createSecureContext(agent3) as any).context;
        (server as any).listen({ port: 0, host: "127.0.0.1", tls: { ...validCert, secureContext } });
        await listening;
        const { port } = server.address() as AddressInfo;

        async function presented(port: number) {
          const client = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
          await once(client, "secureConnect");
          const { fingerprint256 } = client.getPeerCertificate();
          client.destroy();
          return fingerprint256;
        }
        const byThatCall = await presented(port);
        server.close();
        await once(server, "close");

        expect({ byThatCall, byTheNext: await presented(await listen(server)) }).toEqual({
          byThatCall: new X509Certificate(validCert.cert).fingerprint256,
          byTheNext: new X509Certificate(identity.cert).fingerprint256,
        });
      },
    );

    // In a process of its own: a count taken here would include what other tests left for the GC.
    test.skipIf(!process.versions.bun)("holds one SSL_CTX, and gives it up when it is collected", async () => {
      const script = `
        const { sslCtxLiveCount } = require("bun:internal-for-testing");
        const https = require("node:https"), { once } = require("node:events");
        const identity = JSON.parse(process.env.TEST_TLS);
        const shapes = [identity, { ...identity, servername: "agent1" }];
        const before = sslCtxLiveCount();
        const live = () => sslCtxLiveCount() - before;

        async function collect(rounds, until = () => false) {
          for (let i = 0; i < rounds && !until(); i++) {
            Bun.gc(true);
            await new Promise(resolve => setImmediate(resolve));
          }
        }
        async function listen(server) {
          await once(server.listen(0, "127.0.0.1"), "listening");
        }
        async function close(server) {
          server.close();
          await once(server, "close");
        }

        // One server of each shape, referenced until the end: construction, then twice listen(), close(), collection.
        const held = shapes.map(options => https.createServer(options));
        const counts = [live()];
        for (let i = 0; i < 2; i++) {
          for (const server of held) await listen(server);
          counts.push(live());
          for (const server of held) await close(server);
          counts.push(live());
          // The listener of a closed server is destroyed on GC.
          await collect(3);
          counts.push(live());
        }

        // Servers that nothing references: a listener that kept a context would leave one for each.
        async function churn(n) {
          for (let i = 0; i < n; i++) {
            const server = https.createServer(shapes[i % shapes.length]);
            await listen(server);
            await close(server);
          }
        }
        await churn(20);
        const left = () => live() - held.length;
        await collect(10, () => left() === 0);
        console.log(JSON.stringify({ counts, left: left() }));
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: { ...bunEnv, TEST_TLS: JSON.stringify(identity) },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const { counts, left } = JSON.parse(stdout || "{}");
      expect({ stderr, counts }).toEqual({ stderr: "", counts: [2, 2, 2, 2, 2, 2, 2] });
      // One or two closed servers can outlive these collections, with or without TLS. A leak leaves 10 or 20.
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left).toBeLessThanOrEqual(2);
      expect(exitCode).toBe(0);
    });
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
