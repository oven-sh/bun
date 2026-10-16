import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

// `openssl dhparam 512` and `openssl dhparam 1024`.
const dh512 = `-----BEGIN DH PARAMETERS-----
MEkCQQDC31d/lprCPy5Q5Zk0PpZvSAlwFGE0qTRG6WGxVF7KVWLyjHs59LjjdAHv
wqiwog1pBprJxEwQKX2BiMzgfjI3AgECAgF9
-----END DH PARAMETERS-----
`;
const dh1024 = `-----BEGIN DH PARAMETERS-----
MIGLAoGBAMLQCJ5WTwa/ZA0sFs1q77v7MAmiJquR/mkXoTiXB39SRH5D69D1Jep1
ZuDKsy9pi3EaEXaec+zbhHVZs1S2vtQsMaE/BeIs6UxBPXJXHDrmpOPwhKaGi4sN
7gR8tLiPfoloi5biQJPmIipFD7EMIxM4fEKUVwpto9DRQjrlRZdHAgECAgIArw==
-----END DH PARAMETERS-----
`;

describe("tls.createSecureContext dhparam argument", () => {
  const tooSmall = expect.objectContaining({
    name: "TypeError",
    code: "ERR_INVALID_ARG_VALUE",
    message: "DH parameter is less than 1024 bits",
  });

  it.each([
    ["string", dh512],
    ["Buffer", Buffer.from(dh512)],
    ["Uint8Array", new Uint8Array(Buffer.from(dh512))],
  ])("throws on a 512-bit dhparam given as a %s, like Node", (_, dhparam) => {
    expect(() => tls.createSecureContext({ dhparam })).toThrow(tooSmall);
    expect(() => new tls.SecureContext({ dhparam })).toThrow(tooSmall);
    expect(() => tls.createServer({ dhparam })).toThrow(tooSmall);
  });

  it("warns on a 1024-bit dhparam, like Node", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          import tls from "node:tls";
          process.on("warning", w => console.log(w.name + ": " + w.message));
          tls.createSecureContext({ dhparam: process.env.DHPARAM });
          console.log("created");
          await new Promise(r => setImmediate(r));
        `,
      ],
      env: { ...bunEnv, DHPARAM: dh1024 },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("created\nSecurityWarning: DH parameter is less than 2048 bits\n");
    expect(stderr).toContain("SecurityWarning: DH parameter is less than 2048 bits");
    expect(exitCode).toBe(0);
  });

  it.each([
    ["a string that is not a PEM", "not a pem"],
    ["an empty string", ""],
    ["a number", 42],
    ["an object", {}],
  ])("ignores %s, like Node", (_, dhparam) => {
    // @ts-expect-error
    expect(tls.createSecureContext({ dhparam })).toHaveProperty("context");
  });
});
