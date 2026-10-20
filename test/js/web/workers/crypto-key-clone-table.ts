import type { webcrypto } from "node:crypto";

// Every algorithm that CryptoAlgorithmRegistryOpenSSL.cpp registers is in this file: in a row of
// cryptoKeyCloneTable, as the algorithm or as the hash of the key, or in algorithmsInNoKey.
// test/internal/source-lints/webcrypto-key-clone-table.test.ts fails when one is missing. It imports this file on a
// checkout that has no node_modules and no build of bun, so this file holds data only.

// The parameters and the usages of a key. structured-clone.test.ts makes the keys of every row and clones them.
export const cryptoKeyCloneTable: [
  algorithm: { name: string; length?: number; namedCurve?: string; hash?: string },
  usages: webcrypto.KeyUsage[],
][] = [
  [{ name: "AES-CBC", length: 128 }, ["encrypt", "decrypt"]],
  [{ name: "AES-CFB-8", length: 128 }, ["encrypt", "decrypt"]],
  [{ name: "AES-CTR", length: 192 }, ["encrypt", "decrypt"]],
  [{ name: "AES-GCM", length: 256 }, ["encrypt", "decrypt"]],
  [{ name: "AES-KW", length: 256 }, ["wrapKey", "unwrapKey"]],
  [{ name: "ChaCha20-Poly1305" }, ["encrypt", "decrypt"]],
  [{ name: "ECDH", namedCurve: "P-256" }, ["deriveKey", "deriveBits"]],
  [{ name: "ECDSA", namedCurve: "P-384" }, ["sign", "verify"]],
  [{ name: "HKDF" }, ["deriveBits"]],
  // One row for each digest. The record of an HMAC key or an RSA key has the hash of the key in it.
  [{ name: "HMAC", hash: "SHA-1" }, ["sign", "verify"]],
  [{ name: "HMAC", hash: "SHA-224" }, ["sign", "verify"]],
  [{ name: "HMAC", hash: "SHA-256" }, ["sign", "verify"]],
  [{ name: "HMAC", hash: "SHA-384" }, ["sign", "verify"]],
  [{ name: "HMAC", hash: "SHA-512" }, ["sign", "verify"]],
  [{ name: "HMAC", hash: "SHA3-256" }, ["sign", "verify"]],
  [{ name: "HMAC", hash: "SHA3-384" }, ["sign", "verify"]],
  [{ name: "HMAC", hash: "SHA3-512" }, ["sign", "verify"]],
  [{ name: "PBKDF2" }, ["deriveBits"]],
  [{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, ["sign", "verify"]],
  [{ name: "RSA-OAEP", hash: "SHA-384" }, ["encrypt", "decrypt", "wrapKey", "unwrapKey"]],
  [{ name: "RSA-PSS", hash: "SHA-512" }, ["sign", "verify"]],
  [{ name: "Ed25519" }, ["sign", "verify"]],
  // One row for each set of usages that a private X25519 key can have.
  [{ name: "X25519" }, ["deriveBits"]],
  [{ name: "X25519" }, ["deriveKey"]],
  [{ name: "X25519" }, ["deriveKey", "deriveBits"]],
  [{ name: "ML-DSA-44" }, ["sign", "verify"]],
  [{ name: "ML-DSA-65" }, ["sign", "verify"]],
  [{ name: "ML-DSA-87" }, ["sign", "verify"]],
  [{ name: "ML-KEM-768" }, ["encapsulateBits", "decapsulateBits"]],
  [{ name: "ML-KEM-1024" }, ["encapsulateKey", "decapsulateKey"]],
];

// The registered algorithms that no key has, as its algorithm or as its hash. structured-clone.test.ts checks that
// crypto.subtle makes no key with one.
export const algorithmsInNoKey = [
  // Deprecated: SubtleCrypto.cpp refuses it for every operation.
  "RSAES-PKCS1-v1_5",
];
