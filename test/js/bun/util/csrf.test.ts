import { describe, expect, test } from "bun:test";

describe("Bun.CSRF", () => {
  const secret = "this-is-my-super-secure-secret-key";

  test("CSRF exists", () => {
    expect(Bun.CSRF).toBeDefined();
    expect(typeof Bun.CSRF).toBe("object");
    expect(typeof Bun.CSRF.generate).toBe("function");
    expect(typeof Bun.CSRF.verify).toBe("function");
  });

  test("generates a token with default options", () => {
    const token = Bun.CSRF.generate(secret);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);

    // Should be a base64url token (contains only base64url-safe characters)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("generates a token with different formats", () => {
    // Base64 format
    const base64Token = Bun.CSRF.generate(secret, { encoding: "base64" });
    expect(typeof base64Token).toBe("string");
    expect(base64Token).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);

    // Hex format
    const hexToken = Bun.CSRF.generate(secret, { encoding: "hex" });
    expect(typeof hexToken).toBe("string");
    expect(hexToken).toMatch(/^[0-9a-f]+$/);
  });

  test("verifies a valid token", () => {
    const token = Bun.CSRF.generate(secret);
    const isValid = Bun.CSRF.verify(token, { secret });
    expect(isValid).toBe(true);
  });

  test("rejects an invalid token", () => {
    const token = Bun.CSRF.generate(secret);

    // Tamper with the token
    const tamperedToken = token.substring(0, token.length - 5) + "XXXXX";

    const isValid = Bun.CSRF.verify(tamperedToken, { secret });
    expect(isValid).toBe(false);
  });

  test("token verification is sensitive to the secret", () => {
    const token = Bun.CSRF.generate(secret);

    // Try to verify with a different secret
    const isValid = Bun.CSRF.verify(token, { secret: "wrong-secret" });
    expect(isValid).toBe(false);
  });

  test("tokens expire after the specified time", async () => {
    // Generate a token with a very short expiration (1 millisecond)
    const token = Bun.CSRF.generate(secret, {
      expiresIn: 1,
    });

    // Wait a bit to ensure expiration
    await Bun.sleep(10);

    // Should be expired now
    const isValid = Bun.CSRF.verify(token, { secret });
    expect(isValid).toBe(false);
  });

  test("verification respects maxAge parameter", async () => {
    // Generate a token with default expiration (24 hours)
    const token = Bun.CSRF.generate(secret);

    // But verify with a very short maxAge (1 millisecond)
    await Bun.sleep(10);

    // Should be rejected because our maxAge is very short
    const isValid = Bun.CSRF.verify(token, { secret, maxAge: 1 });
    expect(isValid).toBe(false);
  });

  test("token with expiresIn parameter works", async () => {
    // Generate a token with a longer expiration (1 second)
    const token = Bun.CSRF.generate(secret, {
      expiresIn: 1000,
    });

    // Should be valid immediately
    expect(Bun.CSRF.verify(token, { secret })).toBe(true);

    // Should still be valid after a short time
    await Bun.sleep(10);
    expect(Bun.CSRF.verify(token, { secret })).toBe(true);

    // Ensure that expiration works properly
    await Bun.sleep(1000);
    expect(Bun.CSRF.verify(token, { secret })).toBe(false);
  });

  test("token format doesn't affect verification", () => {
    // Test that tokens in different formats can all be verified
    const base64Token = Bun.CSRF.generate(secret, { encoding: "base64" });
    const base64urlToken = Bun.CSRF.generate(secret, { encoding: "base64url" });
    const hexToken = Bun.CSRF.generate(secret, { encoding: "hex" });

    expect(Bun.CSRF.verify(base64Token, { secret, encoding: "base64" })).toBe(true);
    expect(Bun.CSRF.verify(base64urlToken, { secret, encoding: "base64url" })).toBe(true);
    expect(Bun.CSRF.verify(hexToken, { secret, encoding: "hex" })).toBe(true);
  });

  test("test with different algorithms", () => {
    const token = Bun.CSRF.generate(secret, { algorithm: "sha256" });
    expect(Bun.CSRF.verify(token, { secret, algorithm: "sha256" })).toBe(true);

    const token2 = Bun.CSRF.generate(secret, { algorithm: "sha384" });
    expect(Bun.CSRF.verify(token2, { secret, algorithm: "sha384" })).toBe(true);

    const token3 = Bun.CSRF.generate(secret, { algorithm: "sha512" });
    expect(Bun.CSRF.verify(token3, { secret, algorithm: "sha512" })).toBe(true);
  });

  test("error handling", () => {
    // Empty token
    expect(() => Bun.CSRF.verify("", { secret })).toThrow();

    // Empty secret for generation
    expect(() => Bun.CSRF.generate("")).toThrow();

    // Empty secret for verification
    expect(() => Bun.CSRF.verify("some-token", { secret: "" })).toThrow();
  });
});
