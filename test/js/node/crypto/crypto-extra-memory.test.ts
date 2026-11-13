import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls } from "harness";

// These tests verify that native node:crypto wrapper objects report their
// external memory usage to the GC via reportExtraMemoryAllocated and
// reportExtraMemoryVisited. Without this, the GC has no idea that e.g. a
// SecretKeyObject holding a 64KB key is keeping 64KB of native memory alive.

async function extraMemoryDelta(setup: string, create: string, count: number): Promise<number> {
  const script = `
    const crypto = require("crypto");
    const { heapStats } = require("bun:jsc");
    ${setup}

    Bun.gc(true);
    const before = heapStats().extraMemorySize;

    const live = [];
    for (let i = 0; i < ${count}; i++) {
      live.push(await (${create}));
    }

    Bun.gc(true);
    const after = heapStats().extraMemorySize;
    process.stdout.write(String(after - before));
    // keep live referenced until after the measurement
    if (live.length !== ${count}) throw new Error("unreachable");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const delta = Number(stdout);
  expect({ stderr, exitCode, delta }).toEqual({ stderr: expect.any(String), exitCode: 0, delta: expect.any(Number) });
  expect(Number.isFinite(delta)).toBe(true);
  return delta;
}

describe.concurrent("node:crypto external memory is reported to the GC", () => {
  test("SecretKeyObject reports symmetric key bytes", async () => {
    const keySize = 64 * 1024;
    const count = 100;
    const delta = await extraMemoryDelta(
      `const keyData = Buffer.alloc(${keySize}, 1);`,
      `crypto.createSecretKey(Buffer.from(keyData))`,
      count,
    );
    // Each SecretKeyObject owns a copy of the key bytes. Allow generous
    // headroom for baseline noise but require at least half the total.
    expect(delta).toBeGreaterThan((keySize * count) / 2);
  });

  test("PublicKeyObject / PrivateKeyObject report asymmetric key size", async () => {
    const count = 200;
    const delta = await extraMemoryDelta(
      `const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
       const pubDer = publicKey.export({ type: "spki", format: "der" });
       const privDer = privateKey.export({ type: "pkcs8", format: "der" });`,
      `[crypto.createPublicKey({ key: pubDer, format: "der", type: "spki" }), crypto.createPrivateKey({ key: privDer, format: "der", type: "pkcs8" })]`,
      count,
    );
    // RSA-2048: EVP_PKEY_size is 256 bytes per key, 2 keys per iteration.
    expect(delta).toBeGreaterThan(256 * 2 * count * 0.5);
  });

  test("Hash reports XOF outputLength", async () => {
    const outputLength = 64 * 1024;
    const count = 100;
    const delta = await extraMemoryDelta(``, `crypto.createHash("shake256", { outputLength: ${outputLength} })`, count);
    expect(delta).toBeGreaterThan((outputLength * count) / 2);
  });

  test("Hmac reports HMAC_CTX size", async () => {
    const count = 1000;
    const delta = await extraMemoryDelta(`const key = Buffer.alloc(32, 1);`, `crypto.createHmac("sha256", key)`, count);
    // HMAC_CTX is 3 EVP_MD_CTX structs (each ~400B) plus overhead.
    expect(delta).toBeGreaterThan(200 * count);
  });

  test("Cipher reports EVP_CIPHER_CTX size", async () => {
    const count = 1000;
    const delta = await extraMemoryDelta(
      `const key = Buffer.alloc(32, 1); const iv = Buffer.alloc(16, 2);`,
      `crypto.createCipheriv("aes-256-cbc", key, iv)`,
      count,
    );
    expect(delta).toBeGreaterThan(100 * count);
  });

  test("ECDH reports field size", async () => {
    const count = 1000;
    const delta = await extraMemoryDelta(``, `crypto.createECDH("prime256v1")`, count);
    // prime256v1 field is 256 bits = 32 bytes.
    expect(delta).toBeGreaterThan(16 * count);
  });

  test("Sign reports EVP_MD_CTX size", async () => {
    const count = 1000;
    const delta = await extraMemoryDelta(``, `crypto.createSign("sha256")`, count);
    expect(delta).toBeGreaterThan(100 * count);
  });

  test("Verify reports EVP_MD_CTX size", async () => {
    const count = 1000;
    const delta = await extraMemoryDelta(``, `crypto.createVerify("sha256")`, count);
    expect(delta).toBeGreaterThan(100 * count);
  });

  test("X509Certificate reports all of a certificate of 64 KiB or more", async () => {
    const extensionSize = 96 * 1024;
    const count = 50;
    const delta = await extraMemoryDelta(
      `const der = new crypto.X509Certificate(${JSON.stringify(tls.cert)}).raw;

       // [tag, content] of each element in a sequence of DER elements.
       function elements(bytes) {
         const result = [];
         for (let i = 0; i < bytes.length; ) {
           let length = bytes[i + 1], start = i + 2;
           if (length & 0x80) {
             const n = length & 0x7f;
             length = bytes.readUIntBE(start, n);
             start += n;
           }
           result.push([bytes[i], bytes.subarray(start, start + length)]);
           i = start + length;
         }
         return result;
       }
       function element(tag, content) {
         const header = Buffer.from([tag, 0x84, 0, 0, 0, 0]);
         header.writeUInt32BE(content.length, 2);
         // DER wants the shortest length.
         let n = 4;
         while (n > 1 && header[6 - n] === 0) n--;
         if (n === 1 && content.length < 0x80) return Buffer.concat([Buffer.from([tag, content.length]), content]);
         return Buffer.concat([Buffer.from([tag, 0x80 | n]), header.subarray(6 - n), content]);
       }

       // The same certificate with one more extension. Nothing here checks the signature.
       const [tbs, ...rest] = elements(elements(der)[0][1]);
       const fields = elements(tbs[1]);
       const extensions = fields.findIndex(([tag]) => tag === 0xa3);
       const list = elements(fields[extensions][1])[0][1];
       const extra = element(0x30, Buffer.concat([Buffer.from("06032a0304", "hex"), element(0x04, Buffer.alloc(${extensionSize}, 1))]));
       fields[extensions][1] = element(0x30, Buffer.concat([list, extra]));
       const join = list => Buffer.concat(list.map(([tag, content]) => element(tag, content)));
       const big = element(0x30, join([[0x30, join(fields)], ...rest]));
       if (new crypto.X509Certificate(big).raw.length < ${extensionSize}) throw new Error("the extension is missing");`,
      `new crypto.X509Certificate(big)`,
      count,
    );
    expect(delta).toBeGreaterThan(extensionSize * count * 0.75);
  });
});

describe.concurrent("CryptoKey external memory is reported to the GC", () => {
  test.each(["HKDF", "PBKDF2"])("%s key", async name => {
    const keySize = 64 * 1024;
    const count = 100;
    const delta = await extraMemoryDelta(
      `const bytes = new Uint8Array(${keySize}).fill(1);`,
      `crypto.webcrypto.subtle.importKey("raw", bytes, "${name}", false, ["deriveBits"])`,
      count,
    );
    expect(delta).toBeGreaterThan((keySize * count) / 2);
  });

  test("HMAC key", async () => {
    const keySize = 64 * 1024;
    const count = 100;
    const delta = await extraMemoryDelta(
      `const bytes = new Uint8Array(${keySize}).fill(1);`,
      `crypto.webcrypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])`,
      count,
    );
    expect(delta).toBeGreaterThan((keySize * count) / 2);
  });

  test.each([
    ["ML-DSA-65", 20_000],
    ["ML-KEM-768", 5_000],
  ])("%s key pair", async (name, minimum) => {
    const count = 50;
    const usages = name.startsWith("ML-DSA") ? ["sign", "verify"] : ["encapsulateBits", "decapsulateBits"];
    const delta = await extraMemoryDelta(
      ``,
      `crypto.webcrypto.subtle.generateKey("${name}", true, ${JSON.stringify(usages)})`,
      count,
    );
    expect(delta).toBeGreaterThan(minimum * count);
  });

  // Counting these would make a program that imports a key per request collect more often.
  test.each([
    ["RSA", "rsa", { modulusLength: 2048 }, { name: "RSA-PSS", hash: "SHA-256" }],
    ["EC", "ec", { namedCurve: "P-256" }, { name: "ECDSA", namedCurve: "P-256" }],
  ])("but not that of a small %s key", async (_name, type, options, algorithm) => {
    const count = 200;
    const delta = await extraMemoryDelta(
      `const algorithm = ${JSON.stringify(algorithm)};
       const der = crypto.generateKeyPairSync("${type}", ${JSON.stringify(options)}).privateKey.export({ type: "pkcs8", format: "der" });`,
      `crypto.webcrypto.subtle.importKey("pkcs8", der, algorithm, true, ["sign"])`,
      count,
    );
    expect(delta).toBeLessThan(100 * count);
  });

  test.each([
    ["ml-dsa-65", "ML-DSA-65", ["sign"]],
    ["ml-kem-768", "ML-KEM-768", ["decapsulateBits"]],
  ])(
    "but not once more for each toCryptoKey() of one %s KeyObject, which share its key",
    async (type, name, usages) => {
      const count = 200;
      const delta = await extraMemoryDelta(
        `const { privateKey } = crypto.generateKeyPairSync("${type}");`,
        `privateKey.toCryptoKey("${name}", true, ${JSON.stringify(usages)})`,
        count,
      );
      expect(delta).toBeLessThan(100 * count);
    },
  );

  // Nothing else in the loop allocates enough to make the GC run.
  test("dropped keys do not pile up until something else collects them", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { heapStats } = require("bun:jsc");
          const bytes = new Uint8Array(4 * 1024 * 1024);
          Bun.gc(true); // heapStats() collects by itself in a process that never has
          for (let i = 0; i < 128; i++) await crypto.subtle.importKey("raw", bytes, "HKDF", false, ["deriveBits"]);
          console.log((heapStats().objectTypeCounts.CryptoKey ?? 0) < 64);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "true\n", stderr: expect.any(String), exitCode: 0 });
  });
});
