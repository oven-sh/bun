import { describe, expect, test } from "bun:test";
import { tls as validCert } from "harness";
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
    ["createServer(undefined, requestListener)", handler => https.createServer(undefined, handler)],
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
    tls.convertALPNProtocols(protocols, out);
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
});
