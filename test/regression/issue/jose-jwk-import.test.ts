import { beforeAll, expect, test } from "bun:test";
import { importJWK } from "jose";

let fullPrivateJWK: JsonWebKey;
let publicJWK: JsonWebKey;
let minimalPrivateJWK: JsonWebKey;

beforeAll(async () => {
  const keyPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  fullPrivateJWK = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  publicJWK = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  minimalPrivateJWK = {
    kty: fullPrivateJWK.kty,
    n: fullPrivateJWK.n,
    e: fullPrivateJWK.e,
    d: fullPrivateJWK.d,
  } as JsonWebKey;
});

test("RSA JWK import should work with valid private key", async () => {
  const importedKey = await crypto.subtle.importKey(
    "jwk",
    fullPrivateJWK,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );

  expect(importedKey.type).toBe("private");
  expect(importedKey.algorithm.name).toBe("RSASSA-PKCS1-v1_5");
  expect(importedKey.algorithm.hash.name).toBe("SHA-256");
  expect(importedKey.usages).toEqual(["sign"]);
  expect(importedKey.extractable).toBe(false);
});

test("RSA JWK import should work with public key", async () => {
  const importedKey = await crypto.subtle.importKey(
    "jwk",
    publicJWK,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["verify"],
  );

  expect(importedKey.type).toBe("public");
  expect(importedKey.algorithm.name).toBe("RSASSA-PKCS1-v1_5");
  expect(importedKey.usages).toEqual(["verify"]);
});

test("RSA JWK import should reject minimal private key (no CRT params)", async () => {
  // Note: WebCrypto spec requires CRT parameters for RSA private keys
  // This test verifies that minimal private keys without CRT parameters are properly rejected
  await expect(
    crypto.subtle.importKey(
      "jwk",
      minimalPrivateJWK,
      {
        name: "RSASSA-PKCS1-v1_5",
        hash: "SHA-256",
      },
      false,
      ["sign"],
    ),
  ).rejects.toThrow();
});

test("RSA JWK import should reject partial CRT params", async () => {
  const partial = { ...fullPrivateJWK };
  // @ts-expect-error deleting for test
  delete (partial as any).dq;
  await expect(
    crypto.subtle.importKey("jwk", partial, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]),
  ).rejects.toThrow();
});

test("Jose library should work with RSA JWK import after fix", async () => {
  // This should not throw a DataError after the fix
  const importedKey = await importJWK(fullPrivateJWK, "RS256");
  expect(importedKey).toBeDefined();
});
