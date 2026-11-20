import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, nodeExeAtLeast } from "harness";
import { X509Certificate } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import * as tls from "node:tls";
import { pathToFileURL } from "node:url";
import * as keyEntries from "./tls-key-entries-fixture.mjs";

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

// Node checks the type of the key of an entry and then the type of its passphrase, in setKey(). Then it loads the key
// and goes on to the next entry: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/secure-context.js#L89-L94
// Bun decrypts an entry there only when a passphrase is in effect for it. The native config loads the other keys later.
describe("key: [{ pem, passphrase }]", () => {
  const { answer, arrayBufferOf, cert, encrypted, entryPoints, plain } = keyEntries;
  const fixtureURL = pathToFileURL(join(import.meta.dirname, "tls-key-entries-fixture.mjs")).href;
  type Answer = "ok" | { name?: string; code: string; message?: string };

  const invalidKey = (received: string): Answer => ({
    name: "TypeError",
    code: "ERR_INVALID_ARG_TYPE",
    message: `The "options.key" property must be of type string or an instance of Buffer, TypedArray, or DataView. Received ${received}`,
  });
  const invalidPassphrase = (received: string): Answer => ({
    name: "TypeError",
    code: "ERR_INVALID_ARG_TYPE",
    message: `The "options.passphrase" property must be of type string. Received ${received}`,
  });
  const badDecrypt: Answer = { code: "ERR_OSSL_BAD_DECRYPT" };

  // What Node answers at every entry point. "node gives the same answers" asks it.
  const answers: Record<keyof typeof keyEntries.rows, Answer> = {
    "a passphrase that is a number": invalidPassphrase("type number (5)"),
    "a passphrase that is zero": invalidPassphrase("type number (0)"),
    "a passphrase that is a Buffer": invalidPassphrase("an instance of Buffer"),
    "a passphrase that is a Uint8Array": invalidPassphrase("an instance of Uint8Array"),
    "a passphrase that is a String object": invalidPassphrase("an instance of String"),
    "a pem that is a number": invalidKey("type number (5)"),
    "a pem that is a number, before its passphrase that is one": invalidKey("type number (5)"),
    "a pem that is a number, after a valid entry": invalidKey("type number (5)"),
    "a pem that is null": invalidKey("null"),
    // An entry with no pem is the key itself.
    "a pem that is undefined": invalidKey("an instance of Object"),
    "a pem that is a Blob, with a passphrase": invalidKey("an instance of Blob"),
    "a pem that is a SharedArrayBuffer, with a passphrase": invalidKey("an instance of SharedArrayBuffer"),
    "the pem of the first entry, before the passphrase of the second": invalidKey("type number (5)"),
    "the passphrase of the first entry, before the pem of the second": invalidPassphrase("type number (5)"),
    "the wrong passphrase of the first entry, before the pem of the second": badDecrypt,
    "the wrong passphrase of the context for the first entry, before the pem of the second": badDecrypt,
    "a null passphrase, which does not become the passphrase of the context": badDecrypt,
    "an empty passphrase, which does not become the passphrase of the context": badDecrypt,
    "its own passphrase": "ok",
    "its own passphrase, next to a wrong one for the context": "ok",
    "the passphrase of the context": "ok",
    "a null passphrase for a key that is not encrypted": "ok",
    "a pem that is a string": "ok",
    "a pem that is a DataView": "ok",
  };
  const answersNextToAPfx: Record<keyof typeof keyEntries.rowsNextToAPfx, Answer> = {
    "its own passphrase, next to an empty pfx list": "ok",
    "a pem that is a number, next to an empty pfx list": invalidKey("type number (5)"),
    "a passphrase that is a number, next to an empty pfx list": invalidPassphrase("type number (5)"),
    "no passphrase, next to a pfx with a key of its own": "ok",
  };
  const answersBunDoesNotGive: Record<keyof typeof keyEntries.rowsBunAnswersInAnotherWay, Answer> = {
    // Bun: the options.key error for "an instance of Object". Its check of the whole array refuses an array that is not all entries.
    "a PEM after an entry": "ok",
    // Bun: the same error.
    "an entry with a pem that is a number, after a PEM": invalidKey("type number (5)"),
    // Bun: the options.key error of the second entry. The native config loads a key with no passphrase after every entry is checked.
    "an encrypted key with no passphrase, before the pem of the second": badDecrypt,
    // Bun: the options.passphrase error. The native config loads the certificate after every entry is checked.
    "a certificate that does not load, before a passphrase that is a Buffer": { code: "ERR_OSSL_PEM_NO_START_LINE" },
  };

  // Bun takes an ArrayBuffer and a BunFile for a key, in an entry too. Node refuses both.
  const plainFile = () => Bun.file(join(import.meta.dirname, "fixtures", "rsa_private.pem"));
  const rowsOfBun: [string, () => object, Answer][] = [
    ["a pem that is an ArrayBuffer", () => ({ key: [{ pem: arrayBufferOf(plain) }] }), "ok"],
    ["a pem that is an ArrayBuffer, with a passphrase", () => ({ key: [{ pem: arrayBufferOf(encrypted), passphrase: "password" }] }), "ok"], // prettier-ignore
    ["a pem that is a BunFile", () => ({ key: [{ pem: plainFile() }] }), "ok"],
    // Only the native config reads a file, and the one passphrase it has is the passphrase of the context.
    ["a pem that is a BunFile, with a null passphrase", () => ({ key: [{ pem: plainFile(), passphrase: null }], passphrase: "password" }), "ok"], // prettier-ignore
    ["a pem that is a BunFile, with a passphrase", () => ({ key: [{ pem: plainFile(), passphrase: "password" }] }), invalidKey("an instance of Blob")], // prettier-ignore
  ];

  describe.each(Object.entries(entryPoints))("%s", (entryPoint, create) => {
    it.each(Object.entries(answers))("%s", (row, expected) => {
      expect(answer(create, keyEntries.rows[row]())).toEqual(expected);
    });

    it.each(rowsOfBun)("%s", (_, options, expected) => {
      expect(answer(create, options())).toEqual(expected);
    });

    // The other four check the list that Bun makes of the keys of `pfx` and of `key`, and refuse these rows there.
    const checksTheKeysAsWritten = ["tls.createSecureContext()", "tls.connect()", "new tls.TLSSocket()", "server.addContext()"]; // prettier-ignore
    it.skipIf(!checksTheKeysAsWritten.includes(entryPoint)).each(Object.entries(answersNextToAPfx))(
      "%s",
      (row, expected) => {
        expect(answer(create, keyEntries.rowsNextToAPfx[row]())).toEqual(expected);
      },
    );

    it.todo.each(Object.entries(answersBunDoesNotGive))("%s", (row, expected) => {
      expect(answer(create, keyEntries.rowsBunAnswersInAnotherWay[row]())).toEqual(expected);
    });
  });

  // http.createServer() with a key serves TLS in Bun, so it checks the key as https.createServer() does. Node ignores the key.
  it("http.createServer()", () => {
    const create = (options: object) => void http.createServer(options);
    expect({
      passphrase: answer(create, keyEntries.rows["a passphrase that is a number"]()),
      pem: answer(create, keyEntries.rows["a pem that is a number"]()),
      accepted: answer(create, keyEntries.rows["its own passphrase"]()),
    }).toEqual({
      passphrase: answers["a passphrase that is a number"],
      pem: answers["a pem that is a number"],
      accepted: "ok",
    });
  });

  const node = nodeExeAtLeast("26.0.0");
  it.skipIf(!node)("node gives the same answers", async () => {
    const script = `
      import { report } from ${JSON.stringify(fixtureURL)};
      console.log(JSON.stringify(report()));
      process.exit(0);
    `;
    await using proc = Bun.spawn({
      cmd: [node!, "--input-type=module", "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const atEveryEntryPoint = (answers: object) => Object.fromEntries(Object.keys(entryPoints).map(name => [name, answers])); // prettier-ignore
    expect(JSON.parse(stdout)).toEqual({
      rows: atEveryEntryPoint(answers),
      rowsNextToAPfx: atEveryEntryPoint(answersNextToAPfx),
      rowsBunAnswersInAnotherWay: atEveryEntryPoint(answersBunDoesNotGive),
    });
    expect(exitCode).toBe(0);
  });

  const accepted: [string, object][] = [
    ...Object.entries(answers).flatMap(([row, expected]): [string, object][] => (expected === "ok" ? [[row, keyEntries.rows[row]()]] : [])), // prettier-ignore
    ...rowsOfBun.flatMap(([row, options, expected]): [string, object][] => (expected === "ok" ? [[row, options()]] : [])), // prettier-ignore
  ];
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

  it("gives no key to a setter of Array.prototype", async () => {
    // The setter is global, so the context is made in a process of its own.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          import tls from "node:tls";
          import { cert, encrypted, plain } from ${JSON.stringify(fixtureURL)};
          let keysSeen = 0;
          for (const index of [0, 1]) {
            Object.defineProperty(Array.prototype, index, {
              configurable: true,
              get() {},
              set(value) {
                if (value === plain || String(value).includes("PRIVATE KEY")) keysSeen++;
              },
            });
          }
          tls.createSecureContext({ cert, key: [{ pem: plain }, { pem: encrypted, passphrase: "password" }] });
          delete Array.prototype[0];
          delete Array.prototype[1];
          console.log(JSON.stringify({ keysSeen }));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: '{"keysSeen":0}\n', stderr: "", exitCode: 0 });
  });
});
