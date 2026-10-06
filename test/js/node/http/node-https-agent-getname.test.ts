/**
 * Runs in Bun and in Node.js, where the cases that need Bun-only values or a Node.js release with the fix are skipped.
 *
 * https.Agent#getName() names the socket pool and the TLS session cache, so two requests whose options make a
 * different connection must get different names, whatever form the options take. Node fixed the
 * `pfx: [{ buf, passphrase }]` form in nodejs/node 9f03017f38 (CVE-2026-56850).
 */
import assert from "node:assert";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

const isBun = !!process.versions.bun;
// Node ships the fix from v22.23.2, v24.18.1 and v26.5.1. An older Node shares the pool, so
// the pfx cases only describe it from those versions on. Bun always runs them.
const runtimeHasFix = (() => {
  if (isBun) return true;
  const [major, minor, patch] = process.versions.node.split(".").map(Number);
  const atLeast = (fixedMinor: number, fixedPatch: number) =>
    minor > fixedMinor || (minor === fixedMinor && patch >= fixedPatch);
  if (major === 22) return atLeast(23, 2);
  if (major === 24) return atLeast(18, 1);
  if (major === 26) return atLeast(5, 1);
  return major > 26;
})();
const fixedTest = runtimeHasFix ? test : test.skip;
const bunTest = isBun ? test : test.skip;

const keys = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "keys");
const read = (name: string) => readFileSync(join(keys, name));
const readArrayBuffer = (name: string) => {
  const buffer = read(name);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
};

// agent1 is CN=agent1, agent10 is CN=agent10.example.com. Both .pfx files use "sample".
type Identity = "agent1" | "agent10";
type Forms = Record<string, (id: Identity) => object>;
const commonName = { agent1: "agent1", agent10: "agent10.example.com" };

const nodeForms: Forms = {
  "pfx: [{ buf, passphrase }]": id => ({ pfx: [{ buf: read(`${id}.pfx`), passphrase: "sample" }] }),
};
const bunForms: Forms = {
  "pfx: { buf, passphrase }": id => ({ pfx: { buf: read(`${id}.pfx`), passphrase: "sample" } }),
  "pfx: [ArrayBuffer]": id => ({ pfx: [readArrayBuffer(`${id}.pfx`)], passphrase: "sample" }),
  "cert, key: ArrayBuffer": id => ({
    cert: readArrayBuffer(`${id}-cert.pem`),
    key: readArrayBuffer(`${id}-key.pem`),
  }),
  "cert, key: BunFile": id => ({
    cert: Bun.file(join(keys, `${id}-cert.pem`)),
    key: Bun.file(join(keys, `${id}-key.pem`)),
  }),
  "certFile, keyFile": id => ({ certFile: join(keys, `${id}-cert.pem`), keyFile: join(keys, `${id}-key.pem`) }),
  // Node v26.5.1 shares the connection.
  "secureContext": id => ({
    secureContext: tls.createSecureContext({ cert: read(`${id}-cert.pem`), key: read(`${id}-key.pem`) }),
  }),
};
const forms: Forms = isBun ? { ...nodeForms, ...bunForms } : nodeForms;

// Answers every request with the CN of the client certificate the connection authenticated with.
async function listen() {
  const server = tls.createServer(
    { key: read("agent2-key.pem"), cert: read("agent2-cert.pem"), requestCert: true, rejectUnauthorized: false },
    socket => {
      socket.on("error", () => {});
      socket.on("data", () => {
        const body = String(socket.getPeerCertificate().subject?.CN);
        socket.write(`HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
      });
    },
  );
  await once(server.listen(0, "127.0.0.1"), "listening");
  return { server, port: (server.address() as AddressInfo).port };
}

async function get(agent: https.Agent, port: number, options: object) {
  const req = https.get({ host: "127.0.0.1", port, agent, rejectUnauthorized: false, ...options });
  const [res] = await once(req, "response");
  res.setEncoding("utf8");
  let peer = "";
  res.on("data", (chunk: string) => (peer += chunk));
  await once(res, "end");
  return { peer, reusedSocket: req.reusedSocket };
}

// One agent per form, all forms at once: { [form]: the answers to `identities` in order }.
async function answersByForm(agentOptions: https.AgentOptions, identities: Identity[], reuseOptions: boolean) {
  const { server, port } = await listen();
  try {
    const entries = await Promise.all(
      Object.entries(forms).map(async ([form, optionsFor]) => {
        const agent = new https.Agent(agentOptions);
        const cached: Partial<Record<Identity, object>> = {};
        try {
          const answers: object[] = [];
          for (const id of identities) {
            const options = reuseOptions ? (cached[id] ??= optionsFor(id)) : optionsFor(id);
            answers.push(await get(agent, port, options));
          }
          return [form, answers];
        } finally {
          agent.destroy();
        }
      }),
    );
    return Object.fromEntries(entries);
  } finally {
    server.close();
  }
}
const expectedByForm = (answers: object[]) => Object.fromEntries(Object.keys(forms).map(form => [form, answers]));

describe("https.Agent keeps client certificates apart", () => {
  fixedTest("a pooled socket is not shared across client certificates", async () => {
    // The third request passes the first request's option values again, so it pools.
    assert.deepStrictEqual(
      await answersByForm({ keepAlive: true }, ["agent1", "agent10", "agent1"], true),
      expectedByForm([
        { peer: commonName.agent1, reusedSocket: false },
        { peer: commonName.agent10, reusedSocket: false },
        { peer: commonName.agent1, reusedSocket: true },
      ]),
    );
  });

  // Without keepAlive every request opens a connection, but the agent still offers the
  // session it cached under the same name, and a resumed session keeps its first identity.
  fixedTest("a cached TLS session is not resumed across client certificates", async () => {
    assert.deepStrictEqual(
      await answersByForm({ keepAlive: false }, ["agent1", "agent10"], false),
      expectedByForm([
        { peer: commonName.agent1, reusedSocket: false },
        { peer: commonName.agent10, reusedSocket: false },
      ]),
    );
  });
});

// The server sends agent6 and ca3, the intermediate that signed it. ca1 signed ca3, ca2 signed neither.
describe("https.Agent keeps trust settings apart", () => {
  const rows: [string, () => object, () => object, string][] = [
    [
      "allowPartialTrustChain",
      () => ({ ca: read("ca3-cert.pem"), allowPartialTrustChain: true }),
      () => ({ ca: read("ca3-cert.pem") }),
      "UNABLE_TO_GET_ISSUER_CERT",
    ],
    [
      "caFile",
      () => ({ caFile: join(keys, "ca1-cert.pem") }),
      () => ({ caFile: join(keys, "ca2-cert.pem") }),
      "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    ],
    [
      "secureContext",
      () => ({ secureContext: tls.createSecureContext({ ca: read("ca1-cert.pem") }) }),
      () => ({ secureContext: tls.createSecureContext({ ca: read("ca2-cert.pem") }) }),
      "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    ],
  ];
  for (const [option, trusting, distrusting, code] of rows) {
    for (const keepAlive of [true, false]) {
      bunTest(`${option}: the second request is verified again, keepAlive: ${keepAlive}`, async () => {
        const server = tls.createServer({ key: read("agent6-key.pem"), cert: read("agent6-cert.pem") }, socket => {
          socket.on("error", () => {});
          socket.on("data", () => socket.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok"));
        });
        await once(server.listen(0, "127.0.0.1"), "listening");
        // On the Agent: a request with its own checkServerIdentity never shares a connection.
        const agent = new https.Agent({ keepAlive, checkServerIdentity: () => undefined });
        const outcome = async (options: object) => {
          const req = https.get({ host: "127.0.0.1", port: (server.address() as AddressInfo).port, agent, ...options });
          try {
            const [res] = await once(req, "response");
            res.resume();
            await once(res, "end");
            return res.statusCode;
          } catch (error) {
            return (error as NodeJS.ErrnoException).code;
          }
        };
        try {
          assert.deepStrictEqual([await outcome(trusting()), await outcome(distrusting())], [200, code]);
        } finally {
          agent.destroy();
          server.close();
        }
      });
    }
  }
});

describe("https.Agent#getName", () => {
  const agent = new https.Agent();
  const name = (options: object) => agent.getName({ host: "localhost", port: 443, ...options });

  // The names Node v26.5.1 gives, from getPfxAgentKey().
  fixedTest("a pfx array has Node's name", () => {
    assert.strictEqual(
      name({ pfx: [Buffer.from("a"), { buf: "b", passphrase: "p" }], passphrase: "q" }),
      "localhost:443::::::::a:q:b:p::::::::::::::",
    );
    assert.strictEqual(
      name({ pfx: [Buffer.from("a"), Buffer.from("b")] }),
      "localhost:443::::::::a:undefined:b:undefined::::::::::::::",
    );
    assert.strictEqual(name({ pfx: Buffer.from("a"), passphrase: "q" }), "localhost:443:::::::a::::::::::::::");
  });

  fixedTest("`pfx: [{ buf, passphrase }]` is keyed by buf and passphrase", () => {
    const buf = read("agent1.pfx");
    const base = name({ pfx: [{ buf, passphrase: "sample" }] });
    assert.strictEqual(name({ pfx: [{ buf: Buffer.from(buf), passphrase: "sample" }] }), base);
    assert.strictEqual(name({ pfx: [{ buf }], passphrase: "sample" }), base);
    assert.notStrictEqual(name({ pfx: [{ buf: read("agent10.pfx"), passphrase: "sample" }] }), base);
    assert.notStrictEqual(name({ pfx: [{ buf, passphrase: "different" }] }), base);
    assert.notStrictEqual(
      name({ pfx: [{ __proto__: { buf, passphrase: "sample" } }] }),
      name({ pfx: [{ __proto__: { buf: read("agent10.pfx"), passphrase: "sample" } }] }),
    );
  });

  for (const form of Object.keys(bunForms)) {
    bunTest(`differs by content or identity, ${form}`, () => {
      const agent1 = bunForms[form]("agent1");
      assert.strictEqual(name(agent1), name(agent1));
      assert.notStrictEqual(name(agent1), name(bunForms[form]("agent10")));
    });
  }

  bunTest("`key: [{ pem, passphrase }]` is keyed by pem and not by passphrase", () => {
    const pem = read("agent1-key.pem");
    const base = name({ key: pem });
    assert.strictEqual(name({ key: [{ pem, passphrase: "a" }] }), base);
    assert.strictEqual(name({ key: [{ pem: readArrayBuffer("agent1-key.pem"), passphrase: "b" }] }), base);
    assert.strictEqual(name({ key: { pem } }), base);
    assert.notStrictEqual(name({ key: [{ pem: read("agent10-key.pem"), passphrase: "a" }] }), base);
  });

  bunTest("equal bytes share a name across string, Buffer, ArrayBuffer, DataView and array forms", () => {
    const cert = read("agent1-cert.pem");
    const base = name({ cert: cert.toString() });
    assert.strictEqual(name({ cert }), base);
    assert.strictEqual(name({ cert: readArrayBuffer("agent1-cert.pem") }), base);
    assert.strictEqual(name({ cert: [readArrayBuffer("agent1-cert.pem")] }), base);
    assert.strictEqual(
      name({ pfx: [{ buf: readArrayBuffer("agent1.pfx"), passphrase: "sample" }] }),
      name({ pfx: [{ buf: read("agent1.pfx"), passphrase: "sample" }] }),
    );
    const pfx = read("agent1.pfx");
    assert.strictEqual(name({ pfx: new DataView(pfx.buffer, pfx.byteOffset, pfx.byteLength) }), name({ pfx }));
    // What Node names by contents keeps Node's name.
    assert.strictEqual(
      name({ ca: ["a", null, undefined, Buffer.from("b")], key: ["k1", new Uint8Array([1, 2])], pfx: "pfx" }),
      "localhost:443::a,,,b::::k1,1,2:pfx::::::::::::::",
    );
  });

  bunTest("certFile, keyFile and caFile are labelled parts of the name", () => {
    const base = name({});
    assert.strictEqual(
      name({ certFile: "a", keyFile: "b", caFile: "c" }),
      `${base}:certFile="a":keyFile="b":caFile="c"`,
    );
    assert.notStrictEqual(name({ certFile: "a" }), name({ keyFile: "a" }));
    assert.notStrictEqual(name({ caFile: "a" }), name({ caFile: "b" }));
    // A path cannot spell the next part.
    assert.notStrictEqual(name({ certFile: 'a":keyFile="b' }), name({ certFile: "a", keyFile: "b" }));
  });

  bunTest("allowPartialTrustChain and secureContext are parts of the name when they are set", () => {
    const base = name({});
    assert.strictEqual(name({ allowPartialTrustChain: true }), `${base}:allowPartialTrustChain`);
    assert.strictEqual(name({ allowPartialTrustChain: false, secureContext: undefined }), base);
    const secureContext = tls.createSecureContext();
    assert.strictEqual(name({ secureContext }), name({ secureContext }));
    assert.notStrictEqual(name({ secureContext }), name({ secureContext: tls.createSecureContext() }));
    assert.notStrictEqual(name({ secureContext }), base);
  });
});
