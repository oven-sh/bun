// npm `ws` gives every option of the constructor to https.request(), so TLS options are top-level options or options
// of the agent. Every test here also passes on Node.js with the ws package, but for the rows marked Bun only.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir, tls as serverIdentity } from "harness";
import { HttpsProxyAgent } from "https-proxy-agent";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import https from "node:https";
import net, { type AddressInfo } from "node:net";
import { join } from "node:path";
import tls, { type TLSSocket } from "node:tls";
import WebSocket, { WebSocketServer } from "ws";

const isBun = !!process.versions.bun;
const read = (name: string) => readFileSync(join(import.meta.dirname, "../../node/test/fixtures/keys", name));
// The server's certificate is self-signed for localhost. ca1 signs agent1, the client, and nothing else here.
const ca = serverIdentity.cert;
const ca1 = read("ca1-cert.pem");
// agent1's key and certificate, with ca1.
const pfx = read("agent1.pfx");

/** Tells each client whether it presented a certificate that ca1 signed. */
async function serve(options?: https.ServerOptions) {
  const server = https.createServer({ ...serverIdentity, ca: ca1, requestCert: true, rejectUnauthorized: false, ...options }); // prettier-ignore
  server.on("tlsClientError", () => {});
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws, req) => ws.send(`authorized=${(req.socket as TLSSocket).authorized}`));
  await once(server.listen(0, "127.0.0.1"), "listening");
  return {
    url: `wss://localhost:${(server.address() as AddressInfo).port}`,
    [Symbol.dispose]() {
      for (const client of wss.clients) client.terminate();
      server.close();
    },
  };
}

/** Tells each client the protocol version and the cipher of its connection. */
async function serveNegotiated(options?: tls.TlsOptions) {
  const server = tls.createServer({ ...serverIdentity, ...options }, socket => {
    let head = "";
    socket.on("error", () => {});
    socket.on("data", chunk => {
      head += chunk.toString("latin1");
      if (!head.includes("\r\n\r\n")) return;
      const key = /sec-websocket-key: (.*)\r\n/i.exec(head)![1];
      const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
      const message = `${socket.getProtocol()} ${socket.getCipher().name}`;
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      socket.write(Buffer.concat([Buffer.from([0x81, message.length]), Buffer.from(message)]));
    });
  });
  server.on("tlsClientError", () => {});
  await once(server.listen(0, "127.0.0.1"), "listening");
  return {
    url: `wss://localhost:${(server.address() as AddressInfo).port}`,
    [Symbol.dispose]() {
      server.close();
    },
  };
}

/** The server's message, or "refused". */
function dial(url: string, options: object) {
  const { promise, resolve } = Promise.withResolvers<string>();
  const ws = new WebSocket(url, options);
  ws.on("message", data => {
    resolve(String(data));
    ws.terminate();
  });
  ws.on("error", () => resolve("refused"));
  return promise;
}

const anonymous = "authorized=false";
const identified = "authorized=true";

describe.concurrent("ws TLS options", () => {
  test("top-level ca and rejectUnauthorized", async () => {
    using server = await serve();
    expect({
      none: await dial(server.url, {}),
      ca: await dial(server.url, { ca }),
      otherCa: await dial(server.url, { ca: ca1 }),
      emptyCa: await dial(server.url, { ca: "" }),
      unverified: await dial(server.url, { rejectUnauthorized: false, ALPNProtocols: ["http/1.1"] }),
      serverOption: await dial(server.url, { agent: new https.Agent({ ca, dhparam: "auto" }) }),
    }).toEqual({
      none: "refused",
      ca: anonymous,
      otherCa: "refused",
      emptyCa: "refused",
      unverified: anonymous,
      serverOption: anonymous,
    });
  });

  test("only an own rejectUnauthorized: false disables verification", async () => {
    using server = await serve();
    expect(await dial(server.url, { rejectUnauthorized: false })).toBe(anonymous);
    for (const rejectUnauthorized of [0, null, "false", "", undefined, true]) {
      expect(await dial(server.url, { rejectUnauthorized })).toBe("refused");
      expect(await dial(server.url, { agent: new https.Agent({ rejectUnauthorized } as any) })).toBe("refused");
    }
    expect(await dial(server.url, Object.create({ rejectUnauthorized: false }))).toBe("refused");
    // Bun only: Node's Agent reads its own inherited `options`.
    const inherited = Object.create(new https.Agent({ rejectUnauthorized: false }));
    if (isBun) expect(await dial(server.url, { agent: inherited })).toBe("refused");
  });

  test("the options of the agent win over the top-level options", async () => {
    using server = await serve();
    const agent = (options: object) => new https.Agent(options);
    expect({
      agentOff: await dial(server.url, { agent: agent({ rejectUnauthorized: false }), rejectUnauthorized: true }),
      agentOn: await dial(server.url, { agent: agent({ rejectUnauthorized: true }), rejectUnauthorized: false }),
      agentUndefined: await dial(server.url, { agent: agent({ rejectUnauthorized: undefined }), rejectUnauthorized: false }), // prettier-ignore
      agentSilent: await dial(server.url, { agent: agent({}), rejectUnauthorized: false }),
      agentCa: await dial(server.url, { agent: agent({ ca }), ca: ca1 }),
      agentOtherCa: await dial(server.url, { agent: agent({ ca: ca1 }), ca }),
      merged: await dial(server.url, { agent: agent({ ca }), cert: read("agent1-cert.pem"), key: read("agent1-key.pem") }), // prettier-ignore
    }).toEqual({
      agentOff: anonymous,
      agentOn: "refused",
      agentUndefined: "refused",
      agentSilent: anonymous,
      agentCa: anonymous,
      agentOtherCa: "refused",
      merged: identified,
    });
  });

  test("the client identity, in every form", async () => {
    using server = await serve();
    const cert = read("agent1-cert.pem");
    const key = read("agent1-key.pem");
    expect({
      pem: await dial(server.url, { ca, cert, key }),
      pemObject: await dial(server.url, { ca, cert, key: [{ pem: key }] }),
      pfx: await dial(server.url, { ca, pfx, passphrase: "sample" }),
      pfxObject: await dial(server.url, { ca, pfx: [{ buf: pfx, passphrase: "sample" }] }),
      agentPfx: await dial(server.url, { agent: new https.Agent({ ca, pfx, passphrase: "sample" }) }),
      // Bun only.
      tlsPfx: isBun ? await dial(server.url, { tls: { ca, pfx, passphrase: "sample" } }) : identified,
    }).toEqual({
      pem: identified,
      pemObject: identified,
      pfx: identified,
      pfxObject: identified,
      agentPfx: identified,
      tlsPfx: identified,
    });
  });

  test("minVersion and maxVersion", async () => {
    using tls12 = await serve({ maxVersion: "TLSv1.2" });
    using tls13 = await serve({ minVersion: "TLSv1.3" });
    expect({
      min13to12: await dial(tls12.url, { ca, minVersion: "TLSv1.3" }),
      max12to12: await dial(tls12.url, { ca, maxVersion: "TLSv1.2" }),
      max12to13: await dial(tls13.url, { ca, maxVersion: "TLSv1.2" }),
      min13to13: await dial(tls13.url, { ca, minVersion: "TLSv1.3" }),
    }).toEqual({ min13to12: "refused", max12to12: anonymous, max12to13: "refused", min13to13: anonymous });
  });

  test("ciphers", async () => {
    using server = await serveNegotiated();
    using tls12 = await serveNegotiated({ maxVersion: "TLSv1.2" });
    const aes256 = "ECDHE-RSA-AES256-GCM-SHA384";
    const version = (negotiated: string) => negotiated.split(" ")[0];
    expect({
      // BoringSSL has no list of TLS 1.3 suites to restrict, so only Node negotiates the one that is named.
      only13: version(await dial(server.url, { ca, ciphers: "TLS_AES_256_GCM_SHA384" })),
      only13Agent: version(
        await dial(server.url, { agent: new https.Agent({ ca, ciphers: "TLS_AES_256_GCM_SHA384" }) }),
      ),
      only13To12: await dial(tls12.url, { ca, ciphers: "TLS_AES_256_GCM_SHA384" }),
      only13Max12: await dial(server.url, { ca, ciphers: "TLS_AES_256_GCM_SHA384", maxVersion: "TLSv1.2" }),
      mixed: version(await dial(server.url, { ca, ciphers: `TLS_AES_256_GCM_SHA384:${aes256}` })),
      mixedTo12: await dial(tls12.url, { ca, ciphers: `TLS_AES_256_GCM_SHA384:${aes256}` }),
      only12: version(await dial(server.url, { ca, ciphers: aes256 })),
      only12To12: await dial(tls12.url, { ca, ciphers: aes256 }),
    }).toEqual({
      only13: "TLSv1.3",
      only13Agent: "TLSv1.3",
      only13To12: "refused",
      only13Max12: "refused",
      mixed: "TLSv1.3",
      mixedTo12: `TLSv1.2 ${aes256}`,
      only12: "TLSv1.3",
      only12To12: `TLSv1.2 ${aes256}`,
    });
  });

  test("secureProtocol", async () => {
    using server = await serveNegotiated();
    const version = (negotiated: string) => negotiated.split(" ")[0];
    expect({
      tls12: version(await dial(server.url, { ca, secureProtocol: "TLSv1_2_method" })),
      tls12Agent: version(await dial(server.url, { agent: new https.Agent({ ca, secureProtocol: "TLSv1_2_client_method" }) })), // prettier-ignore
      tls11: await dial(server.url, { ca, secureProtocol: "TLSv1_1_method" }),
      any: version(await dial(server.url, { ca, secureProtocol: "TLS_method" })),
    }).toEqual({ tls12: "TLSv1.2", tls12Agent: "TLSv1.2", tls11: "refused", any: "TLSv1.3" });
    // There is no such method.
    expect(() => new WebSocket(server.url, { agent: new https.Agent({ secureProtocol: "TLSv1_3_method" }) })).toThrow(
      expect.objectContaining({ code: "ERR_TLS_INVALID_PROTOCOL_METHOD" }),
    );
    expect(
      () =>
        new WebSocket(server.url, {
          agent: new https.Agent({ secureProtocol: "TLSv1_2_method", minVersion: "TLSv1.3" }),
        }),
    ).toThrow(
      // prettier-ignore
      expect.objectContaining({ code: "ERR_TLS_PROTOCOL_VERSION_CONFLICT" }),
    );
  });

  test("an option that tls.connect() rejects throws", () => {
    const url = "wss://localhost:1";
    // BoringSSL and OpenSSL word it differently.
    expect(() => new WebSocket(url, { agent: new https.Agent({ pfx, passphrase: "wrong" }) })).toThrow(/mac verif/i);
    expect(() => new WebSocket(url, { agent: new https.Agent({ minVersion: "TLSv9" as any }) })).toThrow(
      expect.objectContaining({ code: "ERR_TLS_INVALID_PROTOCOL_VERSION" }),
    );
  });

  test("top-level options reach the target through an HttpsProxyAgent", async () => {
    using server = await serve();
    const connects: string[] = [];
    const proxy = net.createServer(client => {
      client.on("error", () => {});
      client.once("data", head => {
        const target = head.toString("latin1").split(" ")[1];
        connects.push(target);
        const upstream = net.connect(Number(target.split(":")[1]), "127.0.0.1", () => {
          client.write("HTTP/1.1 200 Connection established\r\n\r\n");
          client.pipe(upstream).pipe(client);
        });
        upstream.on("error", () => client.destroy());
      });
    });
    await once(proxy.listen(0, "127.0.0.1"), "listening");
    try {
      const agent = new HttpsProxyAgent(`http://127.0.0.1:${(proxy.address() as AddressInfo).port}`);
      expect(await dial(server.url, { agent, ca, pfx, passphrase: "sample" })).toBe(identified);
      expect(connects).toEqual([server.url.slice("wss://".length)]);
    } finally {
      proxy.close();
    }
  });

  test.skipIf(!isBun)("an explicit tls option replaces the agent's and the top-level options", async () => {
    using server = await serve();
    const off = { rejectUnauthorized: false };
    expect(await dial(server.url, { ...off })).toBe(anonymous);
    expect(await dial(server.url, { ...off, agent: new https.Agent(off), tls: { ca: ca1 } })).toBe("refused");
    expect(await dial(server.url, { ca: ca1, agent: new https.Agent({ ca: ca1 }), tls: { ca } })).toBe(anonymous);
  });
});

describe.concurrent("ws with a pfx that bundles a CA", () => {
  // agent1's key and certificate, with the server's certificate as the CA. From the repository root:
  //   bun -e 'await Bun.write("/tmp/server.pem", (await import("./test/harness.ts")).tls.cert)'
  //   openssl pkcs12 -export -passout pass:sample -certfile /tmp/server.pem \
  //     -inkey test/js/node/test/fixtures/keys/agent1-key.pem -in test/js/node/test/fixtures/keys/agent1-cert.pem \
  //     -out test/js/first_party/ws/fixtures/agent1-with-server-ca.pfx
  const pfxWithServerCa = readFileSync(join(import.meta.dirname, "fixtures/agent1-with-server-ca.pfx"));

  test("adds the CA to the ca option", async () => {
    using server = await serve();
    expect(await dial(server.url, { ca: ca1, pfx: pfxWithServerCa, passphrase: "sample" })).toBe(identified);
    expect(await dial(server.url, { ca: [ca1], pfx: [{ buf: pfxWithServerCa, passphrase: "sample" }] })).toBe(identified); // prettier-ignore
    // Node adds it to the default store too. The native `ca` can only replace that store, so Bun leaves it out.
    if (isBun) expect(await dial(server.url, { pfx: pfxWithServerCa, passphrase: "sample" })).toBe("refused");
  });

  // `openssl x509 -subject_hash` of the server's certificate.
  const hashedName = "c62891c1.0";
  test.each([
    ["NODE_EXTRA_CA_CERTS", "server.pem", true],
    // Node reads these two with --use-openssl-ca only.
    ["SSL_CERT_FILE", "server.pem", isBun],
    ["SSL_CERT_DIR", "hashed", isBun],
  ] as const)("keeps trusting %s", async (name, path, applies) => {
    if (!applies) return;
    using server = await serve();
    using dir = tempDir("ws-pfx-default-store", { "server.pem": ca, [`hashed/${hashedName}`]: ca });
    const child = spawn(
      bunExe(),
      [
        "-e",
        `
        const WebSocket = require("ws");
        const ws = new WebSocket(process.env.TEST_URL, { pfx: require("fs").readFileSync(process.env.TEST_PFX), passphrase: "sample" });
        ws.on("message", data => { console.log(String(data)); ws.terminate(); });
        ws.on("error", err => console.log("refused", err.message));
        `,
      ],
      {
        cwd: import.meta.dirname,
        env: {
          ...bunEnv,
          TEST_URL: server.url,
          TEST_PFX: join(import.meta.dirname, "../../node/test/fixtures/keys/agent1.pfx"),
          [name]: join(String(dir), path),
        },
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
    let stdout = "";
    child.stdout.on("data", chunk => (stdout += chunk));
    const [exitCode] = await once(child, "exit");
    expect(stdout.trim()).toBe(identified);
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("ws TLS options that name or pin the server", () => {
  // CN=agent1, no subjectAltName, signed by ca1.
  const agent1 = { key: read("agent1-key.pem"), cert: read("agent1-cert.pem") };

  test("servername", async () => {
    using server = await serve(agent1);
    expect({
      none: await dial(server.url, { ca: ca1 }),
      topLevel: await dial(server.url, { ca: ca1, servername: "agent1" }),
      agent: await dial(server.url, { agent: new https.Agent({ ca: ca1, servername: "agent1" }) }),
      agentWins: await dial(server.url, { agent: new https.Agent({ servername: "agent1" }), ca: ca1, servername: "other" }), // prettier-ignore
      agentWinsWrong: await dial(server.url, { agent: new https.Agent({ servername: "other" }), ca: ca1, servername: "agent1" }), // prettier-ignore
    }).toEqual({
      none: "refused",
      topLevel: anonymous,
      agent: anonymous,
      agentWins: anonymous,
      agentWinsWrong: "refused",
    });
  });

  test("checkServerIdentity", async () => {
    using server = await serve(agent1);
    const seen: unknown[] = [];
    function accept(hostname: string, cert: { subject: { CN: string } }) {
      seen.push(hostname, cert.subject.CN);
      return undefined;
    }
    const refuse = () => new Error("not the pinned certificate");
    expect(await dial(server.url, { ca: ca1, checkServerIdentity: accept })).toBe(anonymous);
    expect(seen).toEqual(["localhost", "agent1"]);
    expect(await dial(server.url, { ca: ca1, servername: "agent1", checkServerIdentity: refuse })).toBe("refused");
    expect(await dial(server.url, { agent: new https.Agent({ ca: ca1, checkServerIdentity: accept as any }) })).toBe(anonymous); // prettier-ignore
    // It does not replace the verification of the chain.
    expect(await dial(server.url, { checkServerIdentity: accept })).toBe("refused");
  });

  test("crl", async () => {
    // ca2 signs agent3. ca2-crl.pem revokes agent4 only.
    using server = await serve({ key: read("agent3-key.pem"), cert: read("agent3-cert.pem") });
    const trust = { ca: read("ca2-cert.pem"), servername: "agent3" };
    expect(await dial(server.url, { ...trust, crl: read("ca2-crl.pem") })).toBe(anonymous);
    expect(await dial(server.url, { ...trust, crl: read("ca2-crl-agent3.pem") })).toBe("refused");
  });
});
