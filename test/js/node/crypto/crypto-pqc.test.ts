import { describe, expect, test } from "bun:test";
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, subtle, verify } from "crypto";
import fs from "fs";
import { bunEnv, bunExe } from "harness";
import path from "path";

const keysDir = path.join(import.meta.dir, "..", "test", "fixtures", "keys");
const parallelDir = path.join(import.meta.dir, "..", "test", "parallel");

function fixture(name: string) {
  return fs.readFileSync(path.join(keysDir, name));
}

function fixtureDer(name: string) {
  const pem = fixture(name).toString("ascii");
  return Buffer.from(pem.replace(/-----(BEGIN|END) PRIVATE KEY-----|\s/g, ""), "base64");
}

// ML-DSA signature sizes and public-key sizes per FIPS 204.
const mlDsa = [
  { type: "ml-dsa-44", pubLen: 1312, sigLen: 2420 },
  { type: "ml-dsa-65", pubLen: 1952, sigLen: 3309 },
  { type: "ml-dsa-87", pubLen: 2592, sigLen: 4627 },
] as const;

// BoringSSL ships ML-KEM 768 and 1024 only; 512 is gated out upstream too.
const mlKem = [
  { type: "ml-kem-768", pubLen: 1184 },
  { type: "ml-kem-1024", pubLen: 1568 },
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

// ML-DSA / ML-KEM private keys encode a CHOICE of three forms (RFC 9881 /
// 9935): `seed [0]`, `expandedKey`, or `both SEQUENCE{seed, expandedKey}`.
// OpenSSL 3.5's default `genpkey` output is the `both` form. BoringSSL only
// natively parses `seed [0]`, so Bun extracts the seed from `both` itself.
describe("PKCS#8 private-key CHOICE forms", () => {
  const mlDsaUsages: KeyUsage[] = ["sign"];
  const mlKemUsages: KeyUsage[] = ["decapsulateBits", "decapsulateKey"];

  describe.each([
    ["ml-dsa-44", "ML-DSA-44", mlDsaUsages],
    ["ml-dsa-65", "ML-DSA-65", mlDsaUsages],
    ["ml-dsa-87", "ML-DSA-87", mlDsaUsages],
    ["ml-kem-768", "ML-KEM-768", mlKemUsages],
    ["ml-kem-1024", "ML-KEM-1024", mlKemUsages],
  ] as const)("%s", (type, algName, usages) => {
    const stem = type.replaceAll("-", "_");
    const seedOnly = `${stem}_private_seed_only.pem`;
    const both = `${stem}_private.pem`;
    const expandedOnly = `${stem}_private_priv_only.pem`;

    test("createPrivateKey accepts the `both` form (PEM and DER)", () => {
      const reference = createPrivateKey(fixture(seedOnly));
      const fromPem = createPrivateKey(fixture(both));
      const fromDer = createPrivateKey({ key: fixtureDer(both), format: "der", type: "pkcs8" });
      expect({
        pemType: fromPem.asymmetricKeyType,
        derType: fromDer.asymmetricKeyType,
        pemEqualsSeedOnly: fromPem.equals(reference),
        derEqualsSeedOnly: fromDer.equals(reference),
        exportedPem: fromPem.export({ format: "pem", type: "pkcs8" }),
      }).toEqual({
        pemType: type,
        derType: type,
        pemEqualsSeedOnly: true,
        derEqualsSeedOnly: true,
        exportedPem: fixture(seedOnly).toString("ascii"),
      });
    });

    test("createPublicKey from the `both` private PEM derives the right public key", () => {
      const pub = createPublicKey(fixture(both));
      const reference = createPublicKey(fixture(`${stem}_public.pem`));
      expect(pub.equals(reference)).toBe(true);
    });

    test("subtle.importKey accepts the `both` form", async () => {
      const key = await subtle.importKey("pkcs8", fixtureDer(both), { name: algName }, true, usages);
      const exported = Buffer.from(await subtle.exportKey("pkcs8", key));
      expect({
        type: key.type,
        name: key.algorithm.name,
        exportedMatchesSeedOnly: exported.equals(fixtureDer(seedOnly)),
      }).toEqual({ type: "private", name: algName, exportedMatchesSeedOnly: true });
    });

    test("subtle.importKey of the `both` form under a different parameter set is rejected as wrong key type", async () => {
      const siblings: Record<string, string> = {
        "ML-DSA-44": "ML-DSA-65",
        "ML-DSA-65": "ML-DSA-44",
        "ML-DSA-87": "ML-DSA-44",
        "ML-KEM-768": "ML-KEM-1024",
        "ML-KEM-1024": "ML-KEM-768",
      };
      await expect(
        subtle.importKey("pkcs8", fixtureDer(both), { name: siblings[algName] }, true, usages),
      ).rejects.toThrow("Invalid key type");
    });

    test("`both` form with a seed that does not match the expanded key is rejected", async () => {
      const seedLen = type.startsWith("ml-kem") ? 64 : 32;
      const seed = fixtureDer(seedOnly).subarray(-seedLen);
      const bothDer = fixtureDer(both);
      expect(bothDer.subarray(30, 30 + seedLen).equals(seed)).toBe(true);
      // For ML-KEM, seed = d||z: ek depends only on d, z is the trailing 32
      // bytes of dk. Flip a byte in each half so the z check is exercised.
      for (const offset of seedLen === 64 ? [30, 62] : [30]) {
        const modified = Buffer.from(bothDer);
        modified[offset] ^= 0xff;
        await expect(subtle.importKey("pkcs8", modified, { name: algName }, true, usages)).rejects.toThrow(
          expect.objectContaining({ name: "DataError" }),
        );
        expect(() => createPrivateKey({ key: modified, format: "der", type: "pkcs8" })).toThrow(
          expect.objectContaining({ code: "ERR_OSSL_EVP_PRIVATE_KEY_WAS_NOT_SEED" }),
        );
      }
    });

    test("expandedKey-only form (no seed) is rejected", async () => {
      expect(() => createPrivateKey(fixture(expandedOnly))).toThrow(
        expect.objectContaining({ code: "ERR_OSSL_EVP_PRIVATE_KEY_WAS_NOT_SEED" }),
      );
      expect(() => createPrivateKey({ key: fixtureDer(expandedOnly), format: "der", type: "pkcs8" })).toThrow(
        expect.objectContaining({ code: "ERR_OSSL_EVP_PRIVATE_KEY_WAS_NOT_SEED" }),
      );
      await expect(
        subtle.importKey("pkcs8", fixtureDer(expandedOnly), { name: algName }, true, usages),
      ).rejects.toThrow(/PKCS#8 key without a seed is not supported/);
    });
  });

  test("ML-DSA: sign/verify works with a key imported from the `both` form", () => {
    const priv = createPrivateKey(fixture("ml_dsa_44_private.pem"));
    const pub = createPublicKey(fixture("ml_dsa_44_public.pem"));
    const data = Buffer.from("hello bun");
    const sig = sign(undefined, data, priv);
    expect(verify(undefined, data, pub, sig)).toBe(true);
  });

  test("PEM with a leading non-key block still recovers the `both` form", () => {
    // PEM_read_bio_PrivateKey skips leading non-private-key blocks; the
    // recovery path must scan past them too.
    const cert = fixture("rsa_cert.crt").toString("ascii");
    const reference = createPrivateKey(fixture("ml_dsa_44_private_seed_only.pem"));
    for (const inner of ["ml_dsa_44_private.pem", "ml_dsa_44_private_both_encrypted.pem"]) {
      const bundle = cert + fixture(inner).toString("ascii");
      const key = createPrivateKey(inner.includes("encrypted") ? { key: bundle, passphrase: "password" } : bundle);
      expect({ inner, type: key.asymmetricKeyType, equalsSeedOnly: key.equals(reference) }).toEqual({
        inner,
        type: "ml-dsa-44",
        equalsSeedOnly: true,
      });
    }
  });

  describe.each([
    ["ml_dsa_44", "ml-dsa-44"],
    ["ml_kem_768", "ml-kem-768"],
  ] as const)("encrypted `both` form (%s)", (stem, type) => {
    const encPem = fixture(`${stem}_private_both_encrypted.pem`);
    const encDer = Buffer.from(
      encPem.toString("ascii").replace(/-----(BEGIN|END) ENCRYPTED PRIVATE KEY-----|\s/g, ""),
      "base64",
    );
    const reference = createPrivateKey(fixture(`${stem}_private_seed_only.pem`));

    test("createPrivateKey accepts an encrypted `both`-form key (PEM and DER)", () => {
      const fromPem = createPrivateKey({ key: encPem, passphrase: "password" });
      const fromDer = createPrivateKey({ key: encDer, format: "der", type: "pkcs8", passphrase: "password" });
      expect({
        pemType: fromPem.asymmetricKeyType,
        derType: fromDer.asymmetricKeyType,
        pemEqualsSeedOnly: fromPem.equals(reference),
        derEqualsSeedOnly: fromDer.equals(reference),
      }).toEqual({ pemType: type, derType: type, pemEqualsSeedOnly: true, derEqualsSeedOnly: true });
    });

    test("missing passphrase on an encrypted `both`-form key still reports ERR_MISSING_PASSPHRASE", () => {
      expect(() => createPrivateKey(encPem)).toThrow(expect.objectContaining({ code: "ERR_MISSING_PASSPHRASE" }));
    });

    test("wrong passphrase on an encrypted `both`-form key still surfaces the decrypt error", () => {
      expect(() => createPrivateKey({ key: encPem, passphrase: "wrong" })).toThrow(
        expect.objectContaining({ code: expect.stringMatching(/^ERR_OSSL_/) }),
      );
      expect(() => createPrivateKey({ key: encDer, format: "der", type: "pkcs8", passphrase: "wrong" })).toThrow(
        expect.objectContaining({ code: expect.stringMatching(/^ERR_OSSL_/) }),
      );
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
