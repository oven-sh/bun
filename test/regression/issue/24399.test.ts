import { expect, test } from "bun:test";

const CURVE_CONFIGS = [
  { curve: "P-256", expectedLength: 43 }, // 32 bytes = 43 base64url characters
  { curve: "P-384", expectedLength: 64 }, // 48 bytes = 64 base64url characters
  { curve: "P-521", expectedLength: 88 }, // 66 bytes = 88 base64url characters
] as const;

test("ECDSA exported JWK fields have correct length", async () => {
  for (const { curve, expectedLength } of CURVE_CONFIGS) {
    // Generate 10 keys to ensure we catch padding issues (which occur ~50% of the time for P-521)
    for (let i = 0; i < 10; i++) {
      const { privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: curve }, true, ["sign"]);
      const jwk = await crypto.subtle.exportKey("jwk", privateKey);

      expect(jwk.d).toBeDefined();
      expect(jwk.d!.length).toBe(expectedLength);
      expect(jwk.x!.length).toBe(expectedLength);
      expect(jwk.y!.length).toBe(expectedLength);
    }
  }
});

test("ECDH exported JWK fields have correct length", async () => {
  for (const { curve, expectedLength } of CURVE_CONFIGS) {
    // Generate 10 keys to ensure we catch padding issues
    for (let i = 0; i < 10; i++) {
      const { privateKey } = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: curve }, true, ["deriveBits"]);
      const jwk = await crypto.subtle.exportKey("jwk", privateKey);

      expect(jwk.d).toBeDefined();
      expect(jwk.d!.length).toBe(expectedLength);
      expect(jwk.x!.length).toBe(expectedLength);
      expect(jwk.y!.length).toBe(expectedLength);
    }
  }
});

test("exported JWK can be re-imported and used for signing", async () => {
  const { privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-521" }, true, ["sign"]);

  const jwk = await crypto.subtle.exportKey("jwk", privateKey);
  expect(jwk.d!.length).toBe(88);

  // Re-import the key
  const importedKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-521" }, true, ["sign"]);

  // Verify we can use it for signing
  const data = new TextEncoder().encode("test data");
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-384" }, importedKey, data);

  expect(signature.byteLength).toBeGreaterThan(0);
});
