import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { X509Certificate } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import * as http2 from "node:http2";
import * as https from "node:https";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { Duplex } from "node:stream";
import * as tls from "node:tls";

describe("tls.createSecureContext extra arguments test", () => {
  it("should throw an error if the privateKeyEngine is not a string", () => {
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: "valid", privateKeyEngine: 0 })).toThrow(
      "string or one of null or undefined",
    );
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: "valid", privateKeyEngine: true })).toThrow(
      "string or one of null or undefined",
    );
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: "valid", privateKeyEngine: {} })).toThrow(
      "string or one of null or undefined",
    );
  });

  it("should throw an error if the privateKeyIdentifier is not a string", () => {
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: 0, privateKeyEngine: "valid" })).toThrow(
      "string or one of null or undefined",
    );
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: true, privateKeyEngine: "valid" })).toThrow(
      "string or one of null or undefined",
    );
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: {}, privateKeyEngine: "valid" })).toThrow(
      "string or one of null or undefined",
    );
  });

  it("should throw with a valid privateKeyIdentifier but missing privateKeyEngine", () => {
    expect(() => tls.createSecureContext({ privateKeyIdentifier: "valid" })).toThrow(
      "The property 'options.privateKeyEngine' is invalid. Received undefined",
    );
  });

  it("should not throw for invalid privateKeyEngine when privateKeyIdentifier is not provided", () => {
    // Node.js does not throw an error in the case where only privateKeyEngine is provided, even if
    // the key is invalid. The checks for both keys are only done when privateKeyIdentifier is passed.
    // Verifiable with: `node -p 'tls.createSecureContext({ privateKeyEngine: 0 })'`

    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyEngine: 0 })).not.toThrow();
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyEngine: true })).not.toThrow();
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyEngine: {} })).not.toThrow();
  });

  it("should throw for invalid privateKeyIdentifier", () => {
    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: 0 })).toThrow(
      "The property 'options.privateKeyEngine' is invalid. Received undefined",
    );

    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: true })).toThrow(
      "The property 'options.privateKeyEngine' is invalid. Received undefined",
    );

    // @ts-expect-error
    expect(() => tls.createSecureContext({ privateKeyIdentifier: {} })).toThrow(
      "The property 'options.privateKeyEngine' is invalid. Received undefined",
    );
  });

  it.each([
    ["tls.createSecureContext", tls.createSecureContext],
    ["tls.createServer", tls.createServer],
  ] as const)("%s refuses an engine key instead of building a context with no key", (_, create) => {
    const engineKey = { privateKeyIdentifier: "key", privateKeyEngine: "engine" };
    // Node v26.3.0 has ENGINE support and fails to load "engine" instead.
    expect(() => create(engineKey)).toThrow(
      process.versions.bun ? expect.objectContaining({ code: "ERR_CRYPTO_CUSTOM_ENGINE_NOT_SUPPORTED" }) : undefined,
    );
    const key = readFileSync(join(import.meta.dirname, "fixtures", "agent1-key.pem"));
    expect(() => create({ ...engineKey, key })).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_VALUE",
        message: "The property 'options.privateKeyIdentifier' is invalid. Received 'key'",
      }),
    );
    // @ts-expect-error
    expect(() => create({ privateKeyIdentifier: 0, privateKeyEngine: 0 })).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        message: expect.stringContaining('"options.privateKeyIdentifier"'),
      }),
    );
  });
});

describe("tls.createSecureContext pfx argument", () => {
  it("throws instead of crashing when the pfx buffer is detached", async () => {
    // A detached view reaches the native PKCS#12 parser as a null pointer. Run
    // in a child so a regression aborts that process, not the test runner.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          import tls from "node:tls";
          const report = (label, fn) => {
            try {
              fn();
              console.log(label + ": no error");
            } catch (e) {
              console.log(label + ": " + e.message);
            }
          };
          const view = new Uint8Array(64);
          structuredClone(view.buffer, { transfer: [view.buffer] });
          report("detached view", () => tls.createSecureContext({ pfx: view }));
          const arrayBuffer = new ArrayBuffer(64);
          structuredClone(arrayBuffer, { transfer: [arrayBuffer] });
          report("detached ArrayBuffer", () => tls.createSecureContext({ pfx: arrayBuffer }));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe(
      [
        "detached view: PFX certificate argument is mandatory",
        "detached ArrayBuffer: PFX certificate argument is mandatory",
        "",
      ].join("\n"),
    );
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  it("reads the whole byte range of a non-Uint8Array view", () => {
    // agent10.pfx is 4736 bytes, so it can be viewed exactly as 8-byte elements.
    const pfx = readFileSync(join(import.meta.dir, "../test/fixtures/keys/agent10.pfx"));
    const bytes = new Uint8Array(pfx).buffer;
    expect(bytes.byteLength % 8).toBe(0);
    for (const view of [new Uint16Array(bytes), new Float64Array(bytes)]) {
      // @ts-expect-error the types only admit Buffer, the runtime accepts any view
      expect(() => tls.createSecureContext({ pfx: view, passphrase: "sample" })).not.toThrow();
    }
  });
});

// Node checks an entry in setKey(): its key, then its passphrase. Then it loads the key, and goes on to the next entry.
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/secure-context.js#L89-L94
describe("key: [{ pem, passphrase }]", () => {
  const fixture = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", name));
  const plain = fixture("rsa_private.pem");
  // The passphrase is "password".
  const encrypted = fixture("rsa_private_encrypted.pem");
  const cert = fixture("rsa_cert.crt");
  const bytes = (pem: Buffer) => pem.buffer.slice(pem.byteOffset, pem.byteOffset + pem.byteLength);

  const invalidKey = (received: string) => ({
    name: "TypeError",
    code: "ERR_INVALID_ARG_TYPE",
    message: `The "options.key" property must be of type string or an instance of Buffer, TypedArray, or DataView. Received ${received}`,
  });
  const invalidPassphrase = (received: string) => ({
    name: "TypeError",
    code: "ERR_INVALID_ARG_TYPE",
    message: `The "options.passphrase" property must be of type string. Received ${received}`,
  });
  const badDecrypt = { code: "ERR_OSSL_BAD_DECRYPT" };

  const refused: [string, object, object][] = [
    ["a passphrase that is a number", { key: [{ pem: encrypted, passphrase: 5 }] }, invalidPassphrase("type number (5)")], // prettier-ignore
    ["a passphrase that is a Buffer", { key: [{ pem: encrypted, passphrase: Buffer.from("password") }] }, invalidPassphrase("an instance of Buffer")], // prettier-ignore
    ["a passphrase that is a String object", { key: [{ pem: encrypted, passphrase: new String("password") }] }, invalidPassphrase("an instance of String")], // prettier-ignore
    ["a pem that is a number", { key: [{ pem: 5, passphrase: "x" }] }, invalidKey("type number (5)")],
    ["a pem that is a number, before its passphrase that is one", { key: [{ pem: 5, passphrase: 5 }] }, invalidKey("type number (5)")], // prettier-ignore
    ["a pem that is a number, after a valid entry", { key: [{ pem: plain }, { pem: 5 }] }, invalidKey("type number (5)")], // prettier-ignore
    ["a pem that is null", { key: [{ pem: null }] }, invalidKey("null")],
    // An entry with no pem is the key itself.
    ["a pem that is undefined", { key: [{ pem: undefined, passphrase: "x" }] }, invalidKey("an instance of Object")],
    ["a pem that is a Blob, with a passphrase", { key: [{ pem: new Blob([encrypted]), passphrase: "password" }] }, invalidKey("an instance of Blob")], // prettier-ignore
    ["the pem of the first entry, before the passphrase of the second", { key: [{ pem: 5 }, { pem: encrypted, passphrase: 5 }] }, invalidKey("type number (5)")], // prettier-ignore
    ["the passphrase of the first entry, before the pem of the second", { key: [{ pem: encrypted, passphrase: 5 }, { pem: 5 }] }, invalidPassphrase("type number (5)")], // prettier-ignore
    ["the wrong passphrase of the first entry, before the pem of the second", { key: [{ pem: encrypted, passphrase: "wrong" }, { pem: 5 }] }, badDecrypt], // prettier-ignore
    ["a null passphrase, which does not become the passphrase of the context", { key: [{ pem: encrypted, passphrase: null }], passphrase: "password" }, badDecrypt], // prettier-ignore
  ];

  const accepted: [string, object][] = [
    ["its own passphrase", { key: [{ pem: encrypted, passphrase: "password" }] }],
    ["its own passphrase, next to a wrong one for the context", { key: [{ pem: encrypted, passphrase: "password" }], passphrase: "wrong" }], // prettier-ignore
    ["the passphrase of the context", { key: [{ pem: encrypted }], passphrase: "password" }],
    ["a null passphrase for a key that is not encrypted", { key: [{ pem: plain, passphrase: null }], passphrase: "password" }], // prettier-ignore
    ["a pem that is a DataView", { key: [{ pem: new DataView(bytes(encrypted)), passphrase: "password" }] }],
    // Node refuses an ArrayBuffer. Bun takes one for a key, a cert and a ca.
    ...(process.versions.bun
      ? ([["a pem that is an ArrayBuffer", { key: [{ pem: bytes(encrypted), passphrase: "password" }] }]] as [string, object][]) // prettier-ignore
      : []),
  ];

  const transport = () =>
    new Duplex({
      read() {},
      write(_chunk, _encoding, callback) {
        callback();
      },
    });

  describe.each<[string, (options: any) => void]>([
    ["tls.createSecureContext()", options => void tls.createSecureContext(options)],
    ["tls.connect()", options => void tls.connect({ socket: transport(), ...options }).destroy()],
    ["new tls.TLSSocket()", options => void new tls.TLSSocket(undefined as any, options).destroy()],
    ["tls.createServer()", options => void tls.createServer(options)],
    ["server.setSecureContext()", options => void tls.createServer({}).setSecureContext(options)],
    ["server.addContext()", options => void tls.createServer({}).addContext("a.example", options)],
    ["https.createServer()", options => void https.createServer(options)],
    ["http2.createSecureServer()", options => void http2.createSecureServer(options)],
  ])("%s", (_, create) => {
    it.each(refused)("refuses %s", (_, options, error) => {
      expect(() => create({ cert, ...options })).toThrow(expect.objectContaining(error));
    });

    it.each(accepted)("takes %s", (_, options) => {
      expect(() => create({ cert, ...options })).not.toThrow();
    });
  });

  it.each(accepted)("a server with %s completes a handshake", async (_, options) => {
    const server = tls.createServer({ cert, ...options }, socket => socket.end());
    try {
      await once(server.listen(0, "127.0.0.1"), "listening");
      const { port } = server.address() as AddressInfo;
      const client = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
      await once(client, "secureConnect");
      const served = client.getPeerCertificate().fingerprint256;
      client.destroy();
      expect(served).toBe(new X509Certificate(cert).fingerprint256);
    } finally {
      server.close();
    }
  });

  it("leaves the array and its entries as the caller wrote them", () => {
    const entry = { pem: encrypted, passphrase: "password" };
    const key = [entry];
    const server = tls.createServer({ key, cert });
    expect((server as any).key).toBe(key);
    expect(key).toEqual([entry]);
    expect(entry).toEqual({ pem: encrypted, passphrase: "password" });
  });
});
