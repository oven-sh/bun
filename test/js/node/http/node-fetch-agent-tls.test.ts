// @kubernetes/client-node passes an https.Agent (with ca/cert/key) to node-fetch: https://github.com/oven-sh/bun/issues/19754
// Uses node:test so that it runs unchanged on Node.js with the node-fetch package.
import nodeFetch from "node-fetch";
import assert from "node:assert";
import { constants, createPrivateKey } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import https from "node:https";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { describe, test } from "node:test";
import tls, { type TLSSocket } from "node:tls";

const read = (name: string) => readFileSync(path.join(import.meta.dirname, "..", "test", "fixtures", "keys", name));
// ca1 signs agent1, ca2 signs agent3. No certificate has a SAN, so clients verify CN under `servername`.
const ca = read("ca1-cert.pem");
const key = read("agent1-key.pem");
const cert = read("agent1-cert.pem");
const servername = "agent1";

async function serve(options: https.ServerOptions = { key, cert }) {
  const server = https.createServer(options, (req, res) => {
    res.writeHead(200, { connection: "close" });
    res.end(`authorized=${(req.socket as TLSSocket).authorized}`);
  });
  server.on("tlsClientError", () => {});
  await once(server.listen(0, "127.0.0.1"), "listening");
  return {
    port: (server.address() as AddressInfo).port,
    async [Symbol.asyncDispose]() {
      server.close();
      await once(server, "close");
    },
  };
}

/** Answers each request with the protocol version and the cipher of its connection. */
async function serveNegotiated(options?: tls.TlsOptions) {
  const server = tls.createServer({ key, cert, ...options }, socket => {
    socket.on("error", () => {});
    socket.once("data", () => {
      const body = `${socket.getProtocol()} ${socket.getCipher().name}`;
      socket.end(`HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
    });
  });
  server.on("tlsClientError", () => {});
  await once(server.listen(0, "127.0.0.1"), "listening");
  return {
    port: (server.address() as AddressInfo).port,
    async [Symbol.asyncDispose]() {
      server.close();
      await once(server, "close");
    },
  };
}

type Init = { agent?: https.Agent | ((url: URL) => https.Agent); tls?: object };

/** The response body, or the code of the rejection. */
async function outcome(port: number, options: https.AgentOptions | Init["agent"], init?: Init) {
  const agent = typeof options === "function" || options instanceof https.Agent ? options : new https.Agent(options);
  try {
    return await (await nodeFetch(`https://127.0.0.1:${port}/`, { agent, ...init } as any)).text();
  } catch (err) {
    return String((err as NodeJS.ErrnoException).code);
  } finally {
    if (typeof agent !== "function") agent.destroy();
  }
}

describe("node-fetch applies the TLS options of the agent", () => {
  test("ca and servername", async () => {
    await using server = await serve();
    assert.strictEqual(await outcome(server.port, { ca, servername }), "authorized=false");
    assert.strictEqual(await outcome(server.port, { ca }), "ERR_TLS_CERT_ALTNAME_INVALID");
    assert.strictEqual(await outcome(server.port, { servername }), "UNABLE_TO_VERIFY_LEAF_SIGNATURE");
  });

  test("the client identity, in every form", async () => {
    await using server = await serve({ key, cert, ca, requestCert: true, rejectUnauthorized: false });
    const trust = { ca, servername };
    const encryptedKey = createPrivateKey(key).export({
      type: "pkcs8",
      format: "pem",
      cipher: "aes-256-cbc",
      passphrase: "sample",
    });
    assert.deepStrictEqual(
      {
        none: await outcome(server.port, trust),
        pem: await outcome(server.port, { ...trust, cert, key }),
        pemObject: await outcome(server.port, { ...trust, cert, key: [{ pem: key }] }),
        encrypted: await outcome(server.port, {
          ...trust,
          cert,
          key: encryptedKey,
          passphrase: "sample",
        }),
        pfx: await outcome(server.port, { ...trust, pfx: read("agent1.pfx"), passphrase: "sample" }),
        pfxObject: await outcome(server.port, { ...trust, pfx: [{ buf: read("agent1.pfx"), passphrase: "sample" }] }),
      },
      {
        none: "authorized=false",
        pem: "authorized=true",
        pemObject: "authorized=true",
        encrypted: "authorized=true",
        pfx: "authorized=true",
        pfxObject: "authorized=true",
      },
    );
  });

  test("rejectUnauthorized disables verification only when it is false", async () => {
    await using server = await serve();
    assert.strictEqual(await outcome(server.port, { rejectUnauthorized: false }), "authorized=false");
    for (const rejectUnauthorized of [0, null, "false", undefined, true] as any[]) {
      assert.strictEqual(await outcome(server.port, { rejectUnauthorized }), "UNABLE_TO_VERIFY_LEAF_SIGNATURE");
    }
    if (process.versions.bun) {
      // Node reads both through the prototype chain.
      const off = new https.Agent({ rejectUnauthorized: false });
      assert.strictEqual(await outcome(server.port, Object.create(off)), "UNABLE_TO_VERIFY_LEAF_SIGNATURE");
      await assert.rejects(nodeFetch(`https://127.0.0.1:${server.port}/`, Object.create({ agent: off })), {
        code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      });
      const tls = { rejectUnauthorized: true };
      assert.strictEqual(
        await outcome(server.port, { rejectUnauthorized: false }, { tls }),
        "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      );
    }
  });

  test("crl", async () => {
    await using server = await serve({ key: read("agent3-key.pem"), cert: read("agent3-cert.pem") });
    const trust = { ca: read("ca2-cert.pem"), servername: "agent3" };
    // ca2-crl.pem revokes agent4 only.
    assert.strictEqual(await outcome(server.port, { ...trust, crl: read("ca2-crl.pem") }), "authorized=false");
    assert.strictEqual(await outcome(server.port, { ...trust, crl: read("ca2-crl-agent3.pem") }), "CERT_REVOKED");
  });

  test("checkServerIdentity", async () => {
    await using server = await serve();
    const seen: unknown[] = [];
    function accept(hostname: string, peer: { subject: { CN: string } }) {
      seen.push(hostname, peer.subject.CN);
      return undefined;
    }
    function refuse() {
      return Object.assign(new Error("not the pinned certificate"), { code: "ERR_TEST_PIN" });
    }
    assert.strictEqual(await outcome(server.port, { ca, checkServerIdentity: accept as any }), "authorized=false");
    assert.deepStrictEqual(seen, ["127.0.0.1", "agent1"]);
    assert.strictEqual(await outcome(server.port, { ca, servername, checkServerIdentity: refuse }), "ERR_TEST_PIN");
  });

  test("minVersion and maxVersion", async () => {
    await using server = await serve({ key, cert, minVersion: "TLSv1.3" });
    const trust = { ca, servername };
    assert.strictEqual(await outcome(server.port, { ...trust, minVersion: "TLSv1.2" }), "authorized=false");
    // Node reports the alert as EPROTO.
    assert.match(await outcome(server.port, { ...trust, maxVersion: "TLSv1.2" }), /EPROTO|PROTOCOL_VERSION/);
    assert.strictEqual(
      await outcome(server.port, { ...trust, minVersion: "TLSv9" as any }),
      "ERR_TLS_INVALID_PROTOCOL_VERSION",
    );
  });

  test("allowPartialTrustChain", async () => {
    // ca1 signs ca3, ca3 signs agent6. The server sends agent6 and ca3.
    await using server = await serve({ key: read("agent6-key.pem"), cert: read("agent6-cert.pem") });
    const trust = { ca: read("ca3-cert.pem"), checkServerIdentity: () => undefined };
    assert.strictEqual(await outcome(server.port, { ...trust, allowPartialTrustChain: true }), "authorized=false");
    assert.strictEqual(await outcome(server.port, trust), "UNABLE_TO_GET_ISSUER_CERT");
    // Node takes any truthy value.
    if (process.versions.bun) {
      assert.strictEqual(
        await outcome(server.port, { ...trust, allowPartialTrustChain: 1 as any }),
        "UNABLE_TO_GET_ISSUER_CERT",
      );
    }
  });

  test("ciphers, sigalgs, ecdhCurve and secureOptions", async () => {
    const trust = { ca, servername };
    const refused = /EPROTO|HANDSHAKE_FAILURE|PROTOCOL_VERSION|NO_PROTOCOLS_AVAILABLE/;
    await using aes256 = await serve({ key, cert, maxVersion: "TLSv1.2", ciphers: "ECDHE-RSA-AES256-GCM-SHA384" });
    await using sha512 = await serve({ key, cert, sigalgs: "rsa_pss_rsae_sha512" });
    await using p384 = await serve({ key, cert, ecdhCurve: "P-384" });
    await using tls13 = await serve({ key, cert, minVersion: "TLSv1.3" });
    for (const [port, accepted, rejected] of [
      [aes256.port, { ciphers: "ECDHE-RSA-AES256-GCM-SHA384" }, { ciphers: "ECDHE-RSA-AES128-GCM-SHA256" }],
      [sha512.port, { sigalgs: "rsa_pss_rsae_sha512" }, { sigalgs: "rsa_pss_rsae_sha256" }],
      [p384.port, { ecdhCurve: "P-384" }, { ecdhCurve: "X25519" }],
      [tls13.port, { secureOptions: constants.SSL_OP_NO_TLSv1_2 }, { secureOptions: constants.SSL_OP_NO_TLSv1_3 }],
    ] as const) {
      assert.strictEqual(await outcome(port, { ...trust, ...accepted }), "authorized=false");
      assert.match(await outcome(port, { ...trust, ...rejected }), refused, JSON.stringify(rejected));
    }
  });

  test("ciphers that name TLS 1.3 suites", async () => {
    await using server = await serveNegotiated();
    await using tls12 = await serveNegotiated({ maxVersion: "TLSv1.2" });
    const trust = { ca, servername };
    const aes256 = "ECDHE-RSA-AES256-GCM-SHA384";
    const refused = /EPROTO|PROTOCOL_VERSION|NO_CIPHERS_AVAILABLE|NO_PROTOCOLS_AVAILABLE/;
    // BoringSSL has no list of TLS 1.3 suites to restrict, so only Node negotiates the one that is named.
    assert.match(await outcome(server.port, { ...trust, ciphers: "TLS_AES_256_GCM_SHA384" }), /^TLSv1\.3 /);
    assert.match(await outcome(tls12.port, { ...trust, ciphers: "TLS_AES_256_GCM_SHA384" }), refused);
    assert.match(
      await outcome(server.port, { ...trust, ciphers: "TLS_AES_256_GCM_SHA384", maxVersion: "TLSv1.2" }),
      refused,
    );
    assert.match(await outcome(server.port, { ...trust, ciphers: `TLS_AES_256_GCM_SHA384:${aes256}` }), /^TLSv1\.3 /);
    assert.strictEqual(
      await outcome(tls12.port, { ...trust, ciphers: `TLS_AES_256_GCM_SHA384:${aes256}` }),
      `TLSv1.2 ${aes256}`,
    );
    assert.match(await outcome(server.port, { ...trust, ciphers: aes256 }), /^TLSv1\.3 /);
    assert.strictEqual(await outcome(tls12.port, { ...trust, ciphers: aes256 }), `TLSv1.2 ${aes256}`);
  });

  test("an agent that is a function of the request URL", async () => {
    await using server = await serve();
    const agent = new https.Agent({ ca, servername });
    // node-fetch v2 passes a legacy url.parse() object and v3 a WHATWG URL. Both have these fields.
    let calledWith: URL | undefined;
    try {
      assert.strictEqual(await outcome(server.port, url => ((calledWith = url), agent)), "authorized=false");
      assert.deepStrictEqual(
        { protocol: calledWith?.protocol, hostname: calledWith?.hostname, port: String(calledWith?.port) },
        { protocol: "https:", hostname: "127.0.0.1", port: String(server.port) },
      );
    } finally {
      agent.destroy();
    }
  });
});
