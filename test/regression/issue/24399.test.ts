import { expect, test } from "bun:test";

test("ECDSA P-256 exported JWK has correct 'd' field length", async () => {
  // P-256: 32 bytes = 43 base64url characters
  for (let i = 0; i < 10; i++) {
    const { privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
    const jwk = await crypto.subtle.exportKey("jwk", privateKey);
    expect(jwk.d).toBeDefined();
    expect(jwk.d!.length).toBe(43);
    expect(jwk.x!.length).toBe(43);
    expect(jwk.y!.length).toBe(43);
  }
});

test("ECDSA P-384 exported JWK has correct 'd' field length", async () => {
  // P-384: 48 bytes = 64 base64url characters
  for (let i = 0; i < 10; i++) {
    const { privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-384" }, true, ["sign"]);
    const jwk = await crypto.subtle.exportKey("jwk", privateKey);
    expect(jwk.d).toBeDefined();
    expect(jwk.d!.length).toBe(64);
    expect(jwk.x!.length).toBe(64);
    expect(jwk.y!.length).toBe(64);
  }
});

test("ECDSA P-521 exported JWK has correct 'd' field length", async () => {
  // P-521: 66 bytes = 88 base64url characters
  for (let i = 0; i < 10; i++) {
    const { privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-521" }, true, ["sign"]);
    const jwk = await crypto.subtle.exportKey("jwk", privateKey);
    expect(jwk.d).toBeDefined();
    expect(jwk.d!.length).toBe(88);
    expect(jwk.x!.length).toBe(88);
    expect(jwk.y!.length).toBe(88);
  }
});

test("ECDH P-256 exported JWK has correct 'd' field length", async () => {
  // P-256: 32 bytes = 43 base64url characters
  for (let i = 0; i < 10; i++) {
    const { privateKey } = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const jwk = await crypto.subtle.exportKey("jwk", privateKey);
    expect(jwk.d).toBeDefined();
    expect(jwk.d!.length).toBe(43);
    expect(jwk.x!.length).toBe(43);
    expect(jwk.y!.length).toBe(43);
  }
});

test("exported JWK can be re-imported and used for signing", async () => {
  // Test that the exported JWK can be re-imported successfully
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
