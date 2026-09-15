// https://github.com/oven-sh/bun/issues/12157
// https.Server should expose the same SNI helpers as tls.Server.
import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import tls from "node:tls";

const fixtures = join(import.meta.dir, "..", "tls", "fixtures");
const load = (name: string) => readFileSync(join(fixtures, name), "utf8");

const agent1Cert = load("agent1-cert.pem");
const agent1Key = load("agent1-key.pem");
const agent2Cert = load("agent2-cert.pem");
const agent2Key = load("agent2-key.pem");
const agent3Cert = load("agent3-cert.pem");
const agent3Key = load("agent3-key.pem");
const ca1 = load("ca1-cert.pem");
const nodeKeys = join(import.meta.dir, "..", "test", "fixtures", "keys");
// agent1's key and certificate as a PKCS#12 bundle (passphrase "sample").
const agent1Pfx = readFileSync(join(nodeKeys, "agent1.pfx"));
// This generation of agent3 is issued by this ca2, and the CRL revokes it.
const revokedClient = {
  key: readFileSync(join(nodeKeys, "agent3-key.pem"), "utf8"),
  cert: readFileSync(join(nodeKeys, "agent3-cert.pem"), "utf8"),
};
const revokedClientCA = readFileSync(join(nodeKeys, "ca2-cert.pem"), "utf8");
const revokedClientCRL = readFileSync(join(nodeKeys, "ca2-crl-agent3.pem"), "utf8");
// This generation of agent1 is issued by this ca1, which is not a bundled root.
const privateCAClient = {
  key: readFileSync(join(nodeKeys, "agent1-key.pem"), "utf8"),
  cert: readFileSync(join(nodeKeys, "agent1-cert.pem"), "utf8"),
};
const privateCA = readFileSync(join(nodeKeys, "ca1-cert.pem"), "utf8");
// A passphrase-protected key (passphrase "password") and its certificate, CN "localhost".
const encryptedKey = readFileSync(join(nodeKeys, "rsa_private_encrypted.pem"), "utf8");
const encryptedKeyCert = readFileSync(join(nodeKeys, "rsa_cert.crt"), "utf8");

async function peerCN(port: number, servername?: string, extra: tls.ConnectionOptions = {}) {
  const socket = tls.connect({ host: "127.0.0.1", port, servername, rejectUnauthorized: false, ...extra });
  const errored = once(socket, "error");
  await Promise.race([once(socket, "secureConnect"), errored.then(([e]) => Promise.reject(e))]);
  const cert = socket.getPeerCertificate();
  socket.destroy();
  return cert.subject?.CN;
}

// peerCN() that resolves with the error code when the handshake is refused.
// Deliberately not `expect().rejects`: its nested event loop spin currently segfaults on Windows.
async function handshakeOutcome(port: number, extra: tls.ConnectionOptions) {
  try {
    return { cn: await peerCN(port, undefined, extra) };
  } catch (err) {
    return { code: (err as NodeJS.ErrnoException).code };
  }
}

// The cipher a TLS 1.2 client offering `ciphers` (in that order) ends up with.
async function negotiatedCipher(port: number, ciphers: string) {
  const socket = tls.connect({ host: "127.0.0.1", port, rejectUnauthorized: false, maxVersion: "TLSv1.2", ciphers });
  const errored = once(socket, "error").then(([e]) => Promise.reject(e));
  await Promise.race([once(socket, "secureConnect"), errored]);
  const { name } = socket.getCipher();
  socket.destroy();
  return name;
}

// Resolves with the server certificate's CN when a request round-trips, or with
// the error code when the server refuses the client (at the handshake or, for
// TLS 1.3 client-certificate failures, right after it).
async function requestOutcome(port: number, extra: https.RequestOptions = {}) {
  const { promise, resolve } = Promise.withResolvers<{ cn: string | undefined } | { code: string }>();
  https
    .get({ host: "127.0.0.1", port, rejectUnauthorized: false, agent: false, ...extra }, res => {
      res.resume();
      resolve({ cn: (res.socket as tls.TLSSocket).getPeerCertificate().subject?.CN });
    })
    .on("error", (err: NodeJS.ErrnoException) => resolve({ code: err.code ?? err.message }));
  return promise;
}

// `agent: false` so every call opens a fresh connection and therefore a fresh
// SNI lookup; a pooled keep-alive socket would keep serving the cert (and
// router) selected when it was first opened.
async function httpsGetViaSNI(port: number, servername: string, extra: https.RequestOptions = {}) {
  const { promise, resolve, reject } = Promise.withResolvers<{ cn: string | undefined; body: string }>();
  https
    .get(
      {
        host: "127.0.0.1",
        port,
        servername,
        headers: { Host: servername },
        rejectUnauthorized: false,
        agent: false,
        ...extra,
      },
      res => {
        const cn = (res.socket as tls.TLSSocket).getPeerCertificate().subject?.CN;
        res.setEncoding("utf8");
        let body = "";
        res.on("data", chunk => (body += chunk));
        res.on("error", reject);
        res.on("end", () => resolve({ cn, body }));
      },
    )
    .on("error", reject);
  return promise;
}

async function listen(server: http.Server) {
  const listenErr = once(server, "error");
  server.listen(0);
  await Promise.race([once(server, "listening"), listenErr.then(([e]) => Promise.reject(e))]);
  return (server.address() as AddressInfo).port;
}

describe("https.Server", () => {
  test("exposes tls.Server methods and is an http.Server subclass", () => {
    const server = https.createServer({ key: agent1Key, cert: agent1Cert });
    expect({
      addContext: typeof server.addContext,
      setSecureContext: typeof server.setSecureContext,
      getTicketKeys: typeof server.getTicketKeys,
      setTicketKeys: typeof server.setTicketKeys,
    }).toEqual({
      addContext: "function",
      setSecureContext: "function",
      getTicketKeys: "function",
      setTicketKeys: "function",
    });
    expect(server instanceof https.Server).toBe(true);
    expect(server instanceof http.Server).toBe(true);
    expect(() => server.addContext(123 as any, {})).toThrow(TypeError);
    expect(() => server.addContext(123 as any, {})).toThrow("hostname must be a string");
  });

  // https://github.com/oven-sh/bun/issues/31125
  // supertest <= 6.1.6 and @astrojs/node pick the protocol with
  // `app instanceof https.Server`, so a plain http.Server must not match.
  test("is a distinct class from http.Server", () => {
    expect(https.Server).not.toBe(http.Server);
    const plain = http.createServer();
    const secure = new https.Server({ key: agent1Key, cert: agent1Cert });
    expect({
      plainIsHttp: plain instanceof http.Server,
      plainIsHttps: plain instanceof https.Server,
      secureIsHttp: secure instanceof http.Server,
      secureIsHttps: secure instanceof https.Server,
      httpServerHasAddContext: "addContext" in plain,
    }).toEqual({
      plainIsHttp: true,
      plainIsHttps: false,
      secureIsHttp: true,
      secureIsHttps: true,
      httpServerHasAddContext: false,
    });
  });

  test("http.Server is a TLS server only when given key material", async () => {
    // Like Node, a plain http.Server does not look at TLS-only options (this passphrase would be rejected by a
    // TLS server), while key material still turns it into one.
    const plain = http.createServer({ passphrase: 123 } as any, (req, res) => res.end("plain"));
    const secure = http.createServer({ key: agent1Key, cert: agent1Cert } as any, (req, res) => res.end("secure"));
    try {
      const plainPort = await listen(plain);
      const securePort = await listen(secure);
      expect({
        plain: await (await fetch(`http://127.0.0.1:${plainPort}/`)).text(),
        secure: await peerCN(securePort),
      }).toEqual({ plain: "plain", secure: "agent1" });
    } finally {
      plain.close();
      secure.close();
    }
  });

  test("addContext registers a SNI context before listen", async () => {
    const server = https.createServer({ key: agent2Key, cert: agent2Cert }, (req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    try {
      server.addContext("a.example.com", { key: agent1Key, cert: agent1Cert });
      server.addContext("b.example.com", { key: agent3Key, cert: agent3Cert });

      const port = await listen(server);

      expect(await peerCN(port, "a.example.com")).toBe("agent1");
      expect(await peerCN(port, "b.example.com")).toBe("agent3");
      // A hostname with no SNI match falls through to the default context.
      expect(await peerCN(port, "unknown.example.com")).toBe("agent2");
    } finally {
      server.close();
    }
  });

  test("addContext registers a SNI context after listen", async () => {
    const server = https.createServer({ key: agent2Key, cert: agent2Cert }, (req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    try {
      const port = await listen(server);
      expect(await peerCN(port, "a.example.com")).toBe("agent2");

      server.addContext("a.example.com", { key: agent1Key, cert: agent1Cert });
      server.addContext("b.example.com", { key: agent3Key, cert: agent3Cert });

      expect(await peerCN(port, "a.example.com")).toBe("agent1");
      expect(await peerCN(port, "b.example.com")).toBe("agent3");
      expect(await peerCN(port, "unknown.example.com")).toBe("agent2");

      // The SNI-selected domain must also have routes installed (not just
      // a TLS context), so an HTTP request over that SNI reaches the
      // request handler.
      expect(await httpsGetViaSNI(port, "a.example.com")).toEqual({ cn: "agent1", body: "ok" });
      expect(await httpsGetViaSNI(port, "b.example.com")).toEqual({ cn: "agent3", body: "ok" });
    } finally {
      server.close();
    }
  });

  test("addContext with a repeated hostname replaces the previous context", async () => {
    const server = https.createServer({ key: agent2Key, cert: agent2Cert }, (req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    try {
      server.addContext("a.example.com", { key: agent1Key, cert: agent1Cert });
      server.addContext("a.example.com", { key: agent3Key, cert: agent3Cert });

      const port = await listen(server);
      // pre-listen: the most recently added context wins
      expect(await peerCN(port, "a.example.com")).toBe("agent3");

      // post-listen: re-adding the same hostname replaces rather than throws
      server.addContext("a.example.com", { key: agent1Key, cert: agent1Cert });
      expect(await peerCN(port, "a.example.com")).toBe("agent1");
      expect(await httpsGetViaSNI(port, "a.example.com")).toEqual({ cn: "agent1", body: "ok" });

      server.addContext("a.example.com", { key: agent3Key, cert: agent3Cert });
      expect(await peerCN(port, "a.example.com")).toBe("agent3");

      // A re-add with a malformed cert throws, and must not strip the
      // previous working SNI entry.
      expect(() =>
        server.addContext("a.example.com", { key: agent1Key, cert: "-----BEGIN CERTIFICATE-----\ntruncated" }),
      ).toThrow("PEM routines");
      expect(await peerCN(port, "a.example.com")).toBe("agent3");
    } finally {
      server.close();
    }
  });

  test("addContext re-add does not break keep-alive connections on the previous SNI context", async () => {
    const server = https.createServer({ key: agent2Key, cert: agent2Cert }, (req, res) => {
      res.writeHead(200, { "Content-Length": "2" });
      res.end("ok");
    });
    try {
      const port = await listen(server);
      server.addContext("a.example.com", { key: agent1Key, cert: agent1Cert });

      const socket = tls.connect({ host: "127.0.0.1", port, servername: "a.example.com", rejectUnauthorized: false });
      const errored = once(socket, "error").then(([e]) => Promise.reject(e));
      const closed = once(socket, "close").then(() => Promise.reject(new Error("socket closed before response")));
      try {
        await Promise.race([once(socket, "secureConnect"), errored, closed]);
        expect(socket.getPeerCertificate().subject?.CN).toBe("agent1");

        const readResponse = async () => {
          const chunks: Buffer[] = [];
          while (true) {
            const [chunk] = await Promise.race([once(socket, "data"), closed, errored]);
            chunks.push(chunk);
            const raw = Buffer.concat(chunks).toString("utf8");
            const sep = raw.indexOf("\r\n\r\n");
            if (sep >= 0 && raw.length >= sep + 4 + 2) return raw.slice(sep + 4, sep + 4 + 2);
          }
        };

        socket.write("GET / HTTP/1.1\r\nHost: a.example.com\r\n\r\n");
        expect(await readResponse()).toBe("ok");

        // Replace the SNI context while the keep-alive connection is open;
        // the per-domain router for the previous SSL_CTX is freed here.
        server.addContext("a.example.com", { key: agent3Key, cert: agent3Cert });

        // A second request on the same connection must fall back to the
        // default router rather than dereferencing the freed per-domain one.
        socket.write("GET / HTTP/1.1\r\nHost: a.example.com\r\n\r\n");
        expect(await readResponse()).toBe("ok");
      } finally {
        socket.destroy();
      }
    } finally {
      server.close();
    }
  });

  test("addContext rejects an empty hostname before and after listen", async () => {
    const server = https.createServer({ key: agent2Key, cert: agent2Cert });
    try {
      const requiredServerName = '"servername" is required parameter for Server.addContext';
      expect(() => server.addContext("", { key: agent1Key, cert: agent1Cert })).toThrow(requiredServerName);
      // The rejected call must not have queued anything that breaks listen().
      const port = await listen(server);
      expect(await peerCN(port)).toBe("agent2");
      expect(() => server.addContext("", { key: agent1Key, cert: agent1Cert })).toThrow(requiredServerName);
      expect(await peerCN(port)).toBe("agent2");
    } finally {
      server.close();
    }
  });

  test("addContext accepts the same options as the constructor (pfx) before and after listen", async () => {
    const server = https.createServer({ key: agent2Key, cert: agent2Cert });
    try {
      server.addContext("a.example.com", { pfx: agent1Pfx, passphrase: "sample" });
      const port = await listen(server);
      server.addContext("b.example.com", { pfx: agent1Pfx, passphrase: "sample" });
      expect({
        a: await peerCN(port, "a.example.com"),
        b: await peerCN(port, "b.example.com"),
        other: await peerCN(port, "c.example.com"),
      }).toEqual({ a: "agent1", b: "agent1", other: "agent2" });
    } finally {
      server.close();
    }
  });

  test("setSecureContext replaces the default context before listen", async () => {
    const server = https.createServer({ key: agent2Key, cert: agent2Cert }, (req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    try {
      server.setSecureContext({ key: agent3Key, cert: agent3Cert });
      const port = await listen(server);
      expect(await peerCN(port)).toBe("agent3");
    } finally {
      server.close();
    }
  });

  test("setSecureContext with an invalid option applies nothing", async () => {
    const server = https.createServer({ key: agent2Key, cert: agent2Cert }, (req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    try {
      // Rejected on `key`, after `cert` was already read: the new cert must not
      // be left paired with the old key.
      expect(() => server.setSecureContext({ cert: agent3Cert, key: 123 as any })).toThrow(
        'The "options.key" property must be of type string or an instance of Buffer, TypedArray, or DataView.',
      );
      const port = await listen(server);
      expect(await peerCN(port)).toBe("agent2");
    } finally {
      server.close();
    }
  });

  test("setSecureContext on a server with no initial TLS options does not require a client certificate", async () => {
    const server = https.createServer((req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    try {
      server.setSecureContext({ key: agent1Key, cert: agent1Cert, ca: ca1 });
      const port = await listen(server);
      expect(await peerCN(port)).toBe("agent1");
    } finally {
      server.close();
    }
  });

  test("setSecureContext accepts the same options as the constructor (pfx, minVersion)", async () => {
    const server = https.createServer({ key: agent2Key, cert: agent2Cert });
    try {
      server.setSecureContext({ pfx: agent1Pfx, passphrase: "sample", minVersion: "TLSv1.3" });
      const port = await listen(server);
      expect(await peerCN(port)).toBe("agent1");
      expect(await handshakeOutcome(port, { maxVersion: "TLSv1.2" })).toEqual({
        code: "ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION",
      });
    } finally {
      server.close();
    }
  });

  test("setSecureContext clears options the constructor had set but the new call omits", async () => {
    const server = https.createServer({ key: agent2Key, cert: agent2Cert, minVersion: "TLSv1.3" });
    try {
      server.setSecureContext({ key: agent3Key, cert: agent3Cert });
      const port = await listen(server);
      expect(await peerCN(port, undefined, { maxVersion: "TLSv1.2" })).toBe("agent3");
    } finally {
      server.close();
    }
  });

  test("setSecureContext rejects an unknown secureProtocol and applies nothing", async () => {
    const server = https.createServer({ key: agent2Key, cert: agent2Cert });
    try {
      expect(() =>
        server.setSecureContext({ key: agent3Key, cert: agent3Cert, secureProtocol: "bogus_method" }),
      ).toThrow(
        expect.objectContaining({ code: "ERR_TLS_INVALID_PROTOCOL_METHOD", message: "Unknown method: bogus_method" }),
      );
      const port = await listen(server);
      expect(await peerCN(port)).toBe("agent2");
    } finally {
      server.close();
    }
  });

  test("setSecureContext keeps the client certificate policy the server was created with", async () => {
    const server = https.createServer(
      { key: agent2Key, cert: agent2Cert, ca: ca1, requestCert: true, rejectUnauthorized: true },
      (req, res) => res.end("ok"),
    );
    try {
      // Like Node, requestCert/rejectUnauthorized are server settings; swapping
      // the certificate (with a call that does not mention them) keeps them.
      server.setSecureContext({ key: agent3Key, cert: agent3Cert, ca: ca1 });
      const port = await listen(server);
      // agent1 is issued by ca1, so it is the one client the server accepts.
      expect(await requestOutcome(port, { key: agent1Key, cert: agent1Cert })).toEqual({ cn: "agent3" });
      expect(await requestOutcome(port)).toEqual({ code: expect.stringMatching(/^ERR_SSL_|^ECONNRESET$/) });
    } finally {
      server.close();
    }
  });

  test("setSecureContext applies ecdhCurve", async () => {
    const server = https.createServer({ key: agent2Key, cert: agent2Cert });
    try {
      server.setSecureContext({ key: agent2Key, cert: agent2Cert, ecdhCurve: "secp384r1" });
      const port = await listen(server);
      expect({
        p256Only: await handshakeOutcome(port, { ecdhCurve: "prime256v1" }),
        p384: await handshakeOutcome(port, { ecdhCurve: "secp384r1" }),
      }).toEqual({
        p256Only: { code: "ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE" },
        p384: { cn: "agent2" },
      });
    } finally {
      server.close();
    }
  });

  test("addContext applies crl to a context added after listen", async () => {
    const server = https.createServer({ key: agent2Key, cert: agent2Cert }, (req, res) => res.end("ok"));
    try {
      const port = await listen(server);
      const mtls = {
        key: agent1Key,
        cert: agent1Cert,
        ca: revokedClientCA,
        requestCert: true,
        rejectUnauthorized: true,
      };
      server.addContext("lenient.example.com", mtls);
      server.addContext("strict.example.com", { ...mtls, crl: revokedClientCRL });
      expect({
        lenient: await requestOutcome(port, { ...revokedClient, servername: "lenient.example.com" }),
        strict: await requestOutcome(port, { ...revokedClient, servername: "strict.example.com" }),
      }).toEqual({
        lenient: { cn: "agent1" },
        strict: { code: expect.stringMatching(/^ERR_SSL_|^ECONNRESET$/) },
      });
    } finally {
      server.close();
    }
  });

  test("setSecureContext validates the secure context options tls.Server does, before applying anything", async () => {
    const server = https.createServer({ key: agent2Key, cert: agent2Cert });
    try {
      const next = { key: agent3Key, cert: agent3Cert };
      expect(() => server.setSecureContext({ ...next, sigalgs: "" })).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
      );
      expect(() => server.setSecureContext({ ...next, ecdhCurve: 1 as any })).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
      );
      expect(() => server.setSecureContext({ ...next, sessionTimeout: -1 })).toThrow(
        expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }),
      );
      expect(() => server.setSecureContext({ ...next, crl: 42 as any })).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
      );
      expect(() => server.setSecureContext({ ...next, ciphers: "@SECLEVEL=0:ECDHE-RSA-AES128-GCM-SHA256" })).toThrow(
        expect.objectContaining({ code: "ERR_SSL_INVALID_COMMAND" }),
      );
      expect(() => server.setSecureContext({ ...next, ciphers: "NOT-A-CIPHER" })).toThrow(
        expect.objectContaining({ code: "ERR_SSL_NO_CIPHER_MATCH" }),
      );
      const port = await listen(server);
      expect(await peerCN(port)).toBe("agent2");
    } finally {
      server.close();
    }
  });

  test("the constructor, setSecureContext and addContext reject an unknown minVersion/maxVersion, like tls.Server", async () => {
    const invalidMin = expect.objectContaining({
      code: "ERR_TLS_INVALID_PROTOCOL_VERSION",
      message: "TLSv1.4 is not a valid minimum TLS protocol version",
    });
    const invalidMax = expect.objectContaining({
      code: "ERR_TLS_INVALID_PROTOCOL_VERSION",
      message: "tlsv1.3 is not a valid maximum TLS protocol version",
    });
    const badMin = { minVersion: "TLSv1.4" as any };
    const badMax = { maxVersion: "tlsv1.3" as any };
    expect(() => https.createServer({ key: agent2Key, cert: agent2Cert, ...badMin })).toThrow(invalidMin);
    expect(() => https.createServer({ key: agent2Key, cert: agent2Cert, ...badMax })).toThrow(invalidMax);
    const server = https.createServer({ key: agent2Key, cert: agent2Cert });
    try {
      const next = { key: agent3Key, cert: agent3Cert };
      expect(() => server.setSecureContext({ ...next, ...badMin })).toThrow(invalidMin);
      expect(() => server.setSecureContext({ ...next, ...badMax })).toThrow(invalidMax);
      expect(() => server.addContext("a.example.com", { ...next, ...badMin })).toThrow(invalidMin);
      const port = await listen(server);
      expect(() => server.addContext("a.example.com", { ...next, ...badMax })).toThrow(invalidMax);
      expect({ default: await peerCN(port), sni: await peerCN(port, "a.example.com") }).toEqual({
        default: "agent2",
        sni: "agent2",
      });
    } finally {
      server.close();
    }
  });

  test("the constructor, setSecureContext and addContext accept key: [{ pem, passphrase }], like tls.Server", async () => {
    const encrypted = { key: [{ pem: encryptedKey, passphrase: "password" }], cert: encryptedKeyCert };
    const fromConstructor = https.createServer(encrypted);
    const replaced = https.createServer({ key: agent2Key, cert: agent2Cert });
    const withContexts = https.createServer({ key: agent2Key, cert: agent2Cert });
    try {
      // A key that does not decrypt fails at the call, not later at listen().
      expect(() =>
        replaced.setSecureContext({ key: [{ pem: encryptedKey, passphrase: "wrong" }], cert: encryptedKeyCert }),
      ).toThrow(expect.objectContaining({ code: "ERR_OSSL_BAD_DECRYPT" }));
      replaced.setSecureContext(encrypted);
      withContexts.addContext("a.example.com", encrypted);
      const constructorPort = await listen(fromConstructor);
      const replacedPort = await listen(replaced);
      const contextsPort = await listen(withContexts);
      withContexts.addContext("b.example.com", encrypted);
      expect({
        constructor: await peerCN(constructorPort),
        setSecureContext: await peerCN(replacedPort),
        addContextBeforeListen: await peerCN(contextsPort, "a.example.com"),
        addContextAfterListen: await peerCN(contextsPort, "b.example.com"),
        noMatch: await peerCN(contextsPort, "c.example.com"),
      }).toEqual({
        constructor: "localhost",
        setSecureContext: "localhost",
        addContextBeforeListen: "localhost",
        addContextAfterListen: "localhost",
        noMatch: "agent2",
      });
    } finally {
      fromConstructor.close();
      replaced.close();
      withContexts.close();
    }
  });

  test("the server's cipher order wins unless honorCipherOrder is false, like tls.Server", async () => {
    const serverOrder = "ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-GCM-SHA256";
    const clientOrder = "ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384";
    const tlsOptions = { key: agent2Key, cert: agent2Cert, ciphers: serverOrder };
    const byDefault = https.createServer(tlsOptions);
    const clientDecides = https.createServer(tlsOptions);
    try {
      clientDecides.setSecureContext({ ...tlsOptions, honorCipherOrder: false });
      const [defaultPort, clientDecidesPort] = [await listen(byDefault), await listen(clientDecides)];
      expect({
        byDefault: await negotiatedCipher(defaultPort, clientOrder),
        clientDecides: await negotiatedCipher(clientDecidesPort, clientOrder),
      }).toEqual({
        byDefault: "ECDHE-RSA-AES256-GCM-SHA384",
        clientDecides: "ECDHE-RSA-AES128-GCM-SHA256",
      });
    } finally {
      byDefault.close();
      clientDecides.close();
    }
  });

  test("a ciphers list of only TLS 1.3 suites is accepted and pins TLS 1.3, like tls.Server", async () => {
    const server = https.createServer({ key: agent2Key, cert: agent2Cert });
    try {
      server.setSecureContext({ key: agent2Key, cert: agent2Cert, ciphers: "TLS_AES_256_GCM_SHA384" });
      const port = await listen(server);
      expect({
        tls12Client: await handshakeOutcome(port, { minVersion: "TLSv1.2", maxVersion: "TLSv1.2" }),
        tls13Client: await handshakeOutcome(port, { minVersion: "TLSv1.3" }),
      }).toEqual({
        tls12Client: { code: "ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION" },
        tls13Client: { cn: "agent2" },
      });
    } finally {
      server.close();
    }
  });

  test("the constructor and setSecureContext apply tls.DEFAULT_MIN_VERSION like tls.Server", async () => {
    // An EC certificate keeps the debug-build handshakes short.
    const material = { key: load("ec10-key.pem"), cert: load("ec10-cert.pem") };
    const tls12Client = { minVersion: "TLSv1.2", maxVersion: "TLSv1.2" } as const;
    const previousDefault = tls.DEFAULT_MIN_VERSION;
    tls.DEFAULT_MIN_VERSION = "TLSv1.3";
    let fromConstructor: https.Server | undefined;
    let fromSetSecureContext: https.Server | undefined;
    try {
      fromConstructor = https.createServer(material);
      fromSetSecureContext = https.createServer(material);
      fromSetSecureContext.setSecureContext(material);
      const [constructorPort, setSecureContextPort] = [
        await listen(fromConstructor),
        await listen(fromSetSecureContext),
      ];
      expect({
        fromConstructor: {
          tls12Client: await handshakeOutcome(constructorPort, tls12Client),
          tls13Client: await handshakeOutcome(constructorPort, { minVersion: "TLSv1.3" }),
        },
        fromSetSecureContext: { tls12Client: await handshakeOutcome(setSecureContextPort, tls12Client) },
      }).toEqual({
        fromConstructor: {
          tls12Client: { code: "ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION" },
          tls13Client: { cn: "agent10.example.com" },
        },
        fromSetSecureContext: { tls12Client: { code: "ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION" } },
      });
    } finally {
      tls.DEFAULT_MIN_VERSION = previousDefault;
      fromConstructor?.close();
      fromSetSecureContext?.close();
    }
  });

  test("socket.authorized follows the SNI context's requestCert, not only the default context's", async () => {
    const server = https.createServer({ key: agent2Key, cert: agent2Cert }, (req, res) =>
      res.end(JSON.stringify({ authorized: req.socket.authorized, authorizationError: req.socket.authorizationError })),
    );
    try {
      const port = await listen(server);
      server.addContext("mtls.example.com", {
        key: agent1Key,
        cert: agent1Cert,
        ca: privateCA,
        requestCert: true,
        rejectUnauthorized: false,
      });
      const verdict = async (servername: string, extra?: https.RequestOptions) =>
        JSON.parse((await httpsGetViaSNI(port, servername, extra)).body);
      expect({
        mtlsWithCert: await verdict("mtls.example.com", privateCAClient),
        mtlsWithoutCert: await verdict("mtls.example.com"),
        // The default context never asked, so a certificate offered anyway is not consulted.
        defaultWithCert: await verdict("other.example.com", privateCAClient),
      }).toEqual({
        mtlsWithCert: { authorized: true, authorizationError: null },
        mtlsWithoutCert: { authorized: false, authorizationError: "UNABLE_TO_GET_ISSUER_CERT" },
        defaultWithCert: { authorized: false, authorizationError: null },
      });
    } finally {
      server.close();
    }
  });

  // Last on purpose: setDefaultCACertificates() can only be replaced, never removed, so later servers would inherit it.
  test("an mTLS server without `ca` verifies clients against tls.setDefaultCACertificates(), like tls.Server", async () => {
    const mtls = { key: agent2Key, cert: agent2Cert, requestCert: true, rejectUnauthorized: true };
    const handler: https.RequestListener = (req, res) => res.end("ok");
    const servers: https.Server[] = [];
    const previousDefaults = tls.getCACertificates("default");
    try {
      const createdBeforeOverride = https.createServer(mtls, handler);
      servers.push(createdBeforeOverride);
      tls.setDefaultCACertificates([privateCA]);
      createdBeforeOverride.setSecureContext(mtls);
      const createdUnderOverride = https.createServer(mtls, handler);
      servers.push(createdUnderOverride);
      tls.setDefaultCACertificates(previousDefaults);
      const createdAfterRestore = https.createServer(mtls, handler);
      servers.push(createdAfterRestore);

      const [setSecureContextPort, constructorPort, restoredPort] = await Promise.all(servers.map(listen));
      expect({
        setSecureContext: await requestOutcome(setSecureContextPort, privateCAClient),
        constructor: await requestOutcome(constructorPort, privateCAClient),
        withoutOverride: await requestOutcome(restoredPort, privateCAClient),
      }).toEqual({
        setSecureContext: { cn: "agent2" },
        constructor: { cn: "agent2" },
        withoutOverride: { code: expect.stringMatching(/^ERR_SSL_|^ECONNRESET$/) },
      });
    } finally {
      tls.setDefaultCACertificates(previousDefaults);
      for (const server of servers) server.close();
    }
  });
});
