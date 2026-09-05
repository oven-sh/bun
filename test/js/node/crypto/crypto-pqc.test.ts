import { describe, expect, test } from "bun:test";
import { createPrivateKey, createPublicKey, decapsulate, encapsulate, generateKeyPairSync, sign, verify } from "crypto";
import fs from "fs";
import { bunEnv, bunExe } from "harness";
import path from "path";
import { promisify } from "util";

const keysDir = path.join(import.meta.dir, "..", "test", "fixtures", "keys");
const parallelDir = path.join(import.meta.dir, "..", "test", "parallel");

function fixture(name: string) {
  return fs.readFileSync(path.join(keysDir, name));
}

// ML-DSA signature sizes and public-key sizes per FIPS 204.
const mlDsa = [
  { type: "ml-dsa-44", pubLen: 1312, sigLen: 2420 },
  { type: "ml-dsa-65", pubLen: 1952, sigLen: 3309 },
  { type: "ml-dsa-87", pubLen: 2592, sigLen: 4627 },
] as const;

// BoringSSL ships ML-KEM 768 and 1024 only; 512 is gated out upstream too.
// Ciphertext sizes per FIPS 203; the shared secret is always 32 bytes.
const mlKem = [
  { type: "ml-kem-768", pubLen: 1184, ciphertextLen: 1088 },
  { type: "ml-kem-1024", pubLen: 1568, ciphertextLen: 1568 },
] as const;

describe("ML-DSA", () => {
  describe.each(mlDsa)("$type", ({ type, pubLen, sigLen }) => {
    test("generateKeyPairSync", () => {
      const { publicKey, privateKey } = generateKeyPairSync(type as any);
      expect(publicKey.type).toBe("public");
      expect(publicKey.asymmetricKeyType).toBe(type);
      expect(privateKey.type).toBe("private");
      expect(privateKey.asymmetricKeyType).toBe(type);
    });

    test("sign and verify", () => {
      const { publicKey, privateKey } = generateKeyPairSync(type as any);
      const data = Buffer.from("hello bun");
      const sig = sign(undefined, data, privateKey);
      expect(sig.length).toBe(sigLen);
      expect(verify(undefined, data, publicKey, sig)).toBe(true);
      expect(verify(undefined, Buffer.from("tampered"), publicKey, sig)).toBe(false);
    });

    test("import PEM and JWK round-trip", () => {
      const stem = type.replaceAll("-", "_");
      const pub = createPublicKey(fixture(`${stem}_public.pem`));
      expect(pub.asymmetricKeyType).toBe(type);

      const jwk = pub.export({ format: "jwk" }) as Record<string, string>;
      expect({ kty: jwk.kty, alg: jwk.alg }).toEqual({ kty: "AKP", alg: type.toUpperCase() });
      expect(Buffer.from(jwk.pub, "base64url").length).toBe(pubLen);

      const fromJwk = createPublicKey({ key: jwk, format: "jwk" });
      expect(fromJwk.asymmetricKeyType).toBe(type);
      expect(fromJwk.export({ format: "jwk" })).toEqual(jwk);

      const priv = createPrivateKey(fixture(`${stem}_private_seed_only.pem`));
      expect(priv.asymmetricKeyType).toBe(type);
      const privJwk = priv.export({ format: "jwk" }) as Record<string, string>;
      expect({ kty: privJwk.kty, alg: privJwk.alg }).toEqual({ kty: "AKP", alg: type.toUpperCase() });
      expect(Buffer.from(privJwk.priv, "base64url").length).toBe(32);
    });
  });
});

describe("encapsulate and decapsulate", () => {
  describe.each(mlKem)("$type", ({ type, ciphertextLen }) => {
    const stem = type.replaceAll("-", "_");

    test("sync round-trip with generated keys", () => {
      const { publicKey, privateKey } = generateKeyPairSync(type as any);
      const { sharedKey, ciphertext } = encapsulate(publicKey);
      expect(Buffer.isBuffer(sharedKey)).toBe(true);
      expect(Buffer.isBuffer(ciphertext)).toBe(true);
      expect(sharedKey.byteLength).toBe(32);
      expect(ciphertext.byteLength).toBe(ciphertextLen);

      const recovered = decapsulate(privateKey, ciphertext);
      expect(Buffer.isBuffer(recovered)).toBe(true);
      expect(recovered.equals(sharedKey)).toBe(true);
    });

    test("accepts a private key for encapsulation", () => {
      const { privateKey } = generateKeyPairSync(type as any);
      const { sharedKey, ciphertext } = encapsulate(privateKey);
      expect(decapsulate(privateKey, ciphertext).equals(sharedKey)).toBe(true);
    });

    test("accepts PEM strings, DER, and JWK key inputs", () => {
      const publicPem = fixture(`${stem}_public.pem`).toString();
      const privatePem = fixture(`${stem}_private_seed_only.pem`).toString();
      const publicKey = createPublicKey(publicPem);
      const privateKey = createPrivateKey(privatePem);

      const keyPairs = [
        { publicKey: publicPem, privateKey: privatePem },
        {
          publicKey: { key: publicKey.export({ format: "der", type: "spki" }), format: "der", type: "spki" },
          privateKey: { key: privateKey.export({ format: "der", type: "pkcs8" }), format: "der", type: "pkcs8" },
        },
        {
          publicKey: { key: publicKey.export({ format: "jwk" }), format: "jwk" },
          privateKey: { key: privateKey.export({ format: "jwk" }), format: "jwk" },
        },
      ] as const;

      for (const kp of keyPairs) {
        const { sharedKey, ciphertext } = encapsulate(kp.publicKey as any);
        expect(sharedKey.byteLength).toBe(32);
        expect(ciphertext.byteLength).toBe(ciphertextLen);
        expect(decapsulate(kp.privateKey as any, ciphertext).equals(sharedKey)).toBe(true);
      }
    });

    test("callback form", async () => {
      const { publicKey, privateKey } = generateKeyPairSync(type as any);
      const { sharedKey, ciphertext } = await promisify(encapsulate)(publicKey);
      expect(Buffer.isBuffer(sharedKey)).toBe(true);
      expect(sharedKey.byteLength).toBe(32);
      expect(ciphertext.byteLength).toBe(ciphertextLen);

      const recovered = await promisify(decapsulate)(privateKey, ciphertext);
      expect(recovered.equals(sharedKey)).toBe(true);
    });

    test("decapsulating with the wrong private key fails", () => {
      const { publicKey } = generateKeyPairSync(type as any);
      const wrongType = type === "ml-kem-768" ? "ml-kem-1024" : "ml-kem-768";
      const { privateKey: wrongKey } = generateKeyPairSync(wrongType as any);
      const { ciphertext } = encapsulate(publicKey);
      expect(() => decapsulate(wrongKey, ciphertext)).toThrow(
        expect.objectContaining({ code: "ERR_CRYPTO_OPERATION_FAILED", message: "Failed to perform decapsulation" }),
      );
    });

    test("a truncated ciphertext fails", () => {
      const { publicKey, privateKey } = generateKeyPairSync(type as any);
      const { ciphertext } = encapsulate(publicKey);
      expect(() => decapsulate(privateKey, ciphertext.subarray(0, ciphertext.byteLength - 1))).toThrow(
        expect.objectContaining({ code: "ERR_CRYPTO_OPERATION_FAILED" }),
      );
    });

    test("an empty or detached ciphertext fails without crashing", () => {
      const { privateKey } = generateKeyPairSync(type as any);
      expect(() => decapsulate(privateKey, Buffer.alloc(0))).toThrow(
        expect.objectContaining({ code: "ERR_CRYPTO_OPERATION_FAILED" }),
      );

      const detached = new Uint8Array(ciphertextLen);
      structuredClone(detached.buffer, { transfer: [detached.buffer] });
      expect(() => decapsulate(privateKey, detached)).toThrow(
        expect.objectContaining({ code: "ERR_CRYPTO_OPERATION_FAILED" }),
      );
    });

    test("an async failure reports the Node error message", async () => {
      const { publicKey } = generateKeyPairSync(type as any);
      const wrongType = type === "ml-kem-768" ? "ml-kem-1024" : "ml-kem-768";
      const { privateKey: wrongKey } = generateKeyPairSync(wrongType as any);
      const { ciphertext } = encapsulate(publicKey);

      const { promise, resolve } = Promise.withResolvers<Error | null>();
      decapsulate(wrongKey, ciphertext, err => resolve(err));
      const err = await promise;
      expect(err?.message).toBe("Deriving bits failed");
    });
  });

  test("invalid arguments", () => {
    // @ts-expect-error missing key
    expect(() => encapsulate()).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE", message: expect.stringContaining('The "key" argument') }),
    );
    // @ts-expect-error missing key
    expect(() => decapsulate()).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE", message: expect.stringContaining('The "key" argument') }),
    );

    const { publicKey, privateKey } = generateKeyPairSync("ml-kem-768" as any);
    expect(() => decapsulate(privateKey, null as any)).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        message: expect.stringContaining('The "ciphertext" argument'),
      }),
    );

    // decapsulate requires a private key.
    const { ciphertext } = encapsulate(publicKey);
    expect(() => decapsulate(publicKey as any, ciphertext)).toThrow(
      expect.objectContaining({ code: "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE" }),
    );

    expect(() => encapsulate(publicKey, "not a function" as any)).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE", message: expect.stringContaining("callback") }),
    );
  });

  // BoringSSL implements EVP_PKEY_encapsulate only for KEM key types, so key
  // types Node supports through OpenSSL 3 (RSA, EC, X25519) fail the
  // operation, like upstream's test expects on a BoringSSL build.
  test.each(["rsa_public_2048.pem", "ec_p256_public.pem", "x25519_public.pem"])(
    "%s is not a KEM key on BoringSSL",
    name => {
      const publicKey = createPublicKey(fixture(name));
      expect(() => encapsulate(publicKey)).toThrow(
        expect.objectContaining({ code: "ERR_CRYPTO_OPERATION_FAILED", message: "Failed to perform encapsulation" }),
      );
    },
  );
});

describe("ML-KEM", () => {
  describe.each(mlKem)("$type", ({ type, pubLen }) => {
    test("generateKeyPairSync", () => {
      const { publicKey, privateKey } = generateKeyPairSync(type as any);
      expect(publicKey.type).toBe("public");
      expect(publicKey.asymmetricKeyType).toBe(type);
      expect(privateKey.type).toBe("private");
      expect(privateKey.asymmetricKeyType).toBe(type);
    });

    test("import PEM and JWK round-trip", () => {
      const stem = type.replaceAll("-", "_");
      const pub = createPublicKey(fixture(`${stem}_public.pem`));
      expect(pub.asymmetricKeyType).toBe(type);

      const jwk = pub.export({ format: "jwk" }) as Record<string, string>;
      expect({ kty: jwk.kty, alg: jwk.alg }).toEqual({ kty: "AKP", alg: type.toUpperCase() });
      expect(Buffer.from(jwk.pub, "base64url").length).toBe(pubLen);

      const fromJwk = createPublicKey({ key: jwk, format: "jwk" });
      expect(fromJwk.asymmetricKeyType).toBe(type);

      const priv = createPrivateKey(fixture(`${stem}_private_seed_only.pem`));
      expect(priv.asymmetricKeyType).toBe(type);
    });
  });
});

describe("encrypted PKCS#8", () => {
  for (const [name, type] of [
    ["ml_dsa_44_private_encrypted.pem", "ml-dsa-44"],
    ["ml_kem_768_private_encrypted.pem", "ml-kem-768"],
  ] as const) {
    test(name, () => {
      expect(() => createPrivateKey(fixture(name))).toThrow(
        expect.objectContaining({ code: "ERR_MISSING_PASSPHRASE" }),
      );
      const key = createPrivateKey({ key: fixture(name), passphrase: "password" });
      expect(key.asymmetricKeyType).toBe(type);
    });
  }

  test("error from a missing passphrase does not leak into the next parse", () => {
    expect(() => createPrivateKey(fixture("ml_dsa_44_private_encrypted.pem"))).toThrow(
      expect.objectContaining({ code: "ERR_MISSING_PASSPHRASE" }),
    );
    const next = createPrivateKey(fixture("ml_dsa_65_private_seed_only.pem"));
    expect(next.asymmetricKeyType).toBe("ml-dsa-65");
  });
});

// Run the upstream Node v26.3.0 suites this change enables. Each is a plain
// script that exits 0 on success; they are not bun:test files. Sequential:
// seven concurrent ASAN debug bun processes doing full PQC workloads OOM.
describe("upstream node/test/parallel", () => {
  test.each([
    "test-crypto-pqc-keygen-ml-dsa.js",
    "test-crypto-pqc-keygen-ml-kem.js",
    "test-crypto-pqc-key-objects-ml-dsa.js",
    "test-crypto-pqc-key-objects-ml-kem.js",
    "test-crypto-pqc-sign-verify-ml-dsa.js",
    "test-crypto-pqc-encrypted-pkcs8.js",
    "test-crypto-keygen-raw.js",
    "test-crypto-encap-decap.js",
  ])("%s", async file => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--no-addons", path.join(parallelDir, file)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) {
      // Surface the actual assertion failure instead of just the exit code.
      expect({ file, stderr: stderr || stdout }).toEqual({ file, stderr: "" });
    }
    expect(exitCode).toBe(0);
  });
});
