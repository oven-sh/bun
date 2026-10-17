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

describe("tls.createSecureContext dhparam argument", () => {
  const readKey = (name: string) => readFileSync(join(import.meta.dir, "../test/fixtures/keys", name));
  // `openssl dhparam 1020`: Node measures the prime in bits, not whole bytes.
  const dh1020 = `-----BEGIN DH PARAMETERS-----
MIGGAoGACOInxoOj9RDQXpM4O4JnjfSu54ArxtF+xVSn1/oZlX+MJyxRE78IZKBTpr4K+JTXYm9l
eynoIQlnoXbKLjpHcp6VJ2IFLJ+NqTHIkQwMKcHHbAqIEd7F4MYFVkO2/fF29/Wb6bMSr1jcfywZ
47LuxCK85oCYclGov1+ta6ZZZtsCAQI=
-----END DH PARAMETERS-----
`;
  const tooSmall = expect.objectContaining({
    name: "TypeError",
    code: "ERR_INVALID_ARG_VALUE",
    message: "DH parameter is less than 1024 bits",
  });

  it.each([
    ["a 512-bit string", readKey("dh512.pem").toString()],
    ["a 512-bit Buffer", readKey("dh512.pem")],
    ["a 512-bit Uint8Array", new Uint8Array(readKey("dh512.pem"))],
    ["a 512-bit DataView", new DataView(new Uint8Array(readKey("dh512.pem")).buffer)],
    ["a 1020-bit string", dh1020],
  ])("throws on %s like Node", (_, dhparam) => {
    expect(() => tls.createSecureContext({ dhparam })).toThrow(tooSmall);
    expect(() => new tls.SecureContext({ dhparam })).toThrow(tooSmall);
    expect(() => tls.createServer({ dhparam })).toThrow(tooSmall);
    expect(() => tls.createServer({}).addContext("a", { dhparam })).toThrow(tooSmall);
    expect(() => tls.connect({ port: 1, host: "127.0.0.1", dhparam })).toThrow(tooSmall);
  });

  it.each([
    ["a number", 42],
    ["an object", {}],
    ["an ArrayBuffer", new ArrayBuffer(8)],
    ["false", false],
  ])("throws on %s like Node", (_, dhparam) => {
    // @ts-expect-error
    expect(() => tls.createSecureContext({ dhparam })).toThrow(
      expect.objectContaining({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE" }),
    );
  });

  // Node: `if (options.dhparam) this.dhparam = options.dhparam; else this.dhparam = undefined;`
  it.each([0, false, ""])("tls.createServer drops a falsy dhparam (%p) like Node", dhparam => {
    // @ts-expect-error
    expect(tls.createServer({ dhparam })).toBeInstanceOf(tls.Server);
  });

  it.each([
    ["a string that is not a PEM", "not a pem"],
    ["an empty string", ""],
    ["a PEM with a bad body", readKey("dherror.pem").toString()],
  ])("ignores %s like Node", (_, dhparam) => {
    expect(tls.createSecureContext({ dhparam })).toHaveProperty("context");
  });

  // Node warns below 2048 bits. Its OpenSSL then rejects the 1024-bit group at
  // security level 2; BoringSSL has no security levels, so Bun keeps the context.
  it("warns once per context below 2048 bits, and not above", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          import tls from "node:tls";
          import { readFileSync } from "node:fs";
          const key = readFileSync(process.env.KEYS + "/agent1-key.pem");
          const cert = readFileSync(process.env.KEYS + "/agent1-cert.pem");
          let warnings = 0;
          process.on("warning", w => { if (w.name === "SecurityWarning") warnings++; });
          const settle = () => new Promise(r => setImmediate(r));
          const count = async (name, fn) => {
            warnings = 0;
            fn();
            await settle();
            console.log(name + " " + warnings);
          };
          for (const file of ["dh1024.pem", "dh2048.pem", "dh3072.pem"]) {
            const dhparam = readFileSync(process.env.KEYS + "/" + file);
            await count(file + " createSecureContext", () => tls.createSecureContext({ dhparam }));
            await count(file + " createServer", () => tls.createServer({ key, cert, dhparam }).close());
            await count(file + " setSecureContext", () => {
              const server = tls.createServer({ key, cert });
              server.setSecureContext({ key, cert, dhparam });
              server.close();
            });
            await count(file + " addContext", () => {
              const server = tls.createServer({ key, cert });
              server.addContext("a", { key, cert, dhparam });
              server.close();
            });
          }
        `,
      ],
      env: { ...bunEnv, KEYS: join(import.meta.dir, "../test/fixtures/keys") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.split("\n").filter(Boolean)).toEqual([
      "dh1024.pem createSecureContext 1",
      "dh1024.pem createServer 1",
      "dh1024.pem setSecureContext 1",
      "dh1024.pem addContext 1",
      "dh2048.pem createSecureContext 0",
      "dh2048.pem createServer 0",
      "dh2048.pem setSecureContext 0",
      "dh2048.pem addContext 0",
      "dh3072.pem createSecureContext 0",
      "dh3072.pem createServer 0",
      "dh3072.pem setSecureContext 0",
      "dh3072.pem addContext 0",
    ]);
    expect(stderr).toContain("SecurityWarning: DH parameter is less than 2048 bits");
    expect(exitCode).toBe(0);
  });
});
