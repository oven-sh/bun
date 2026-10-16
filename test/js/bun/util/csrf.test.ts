import { CSRF, type CSRFAlgorithm } from "bun";
import { describe, expect, test } from "bun:test";
describe("Bun.CSRF", () => {
  const secret = "this-is-my-super-secure-secret-key";

  test("CSRF exists", () => {
    expect(CSRF).toBeDefined();
    expect(typeof CSRF).toBe("object");
    expect(typeof CSRF.generate).toBe("function");
    expect(typeof CSRF.verify).toBe("function");
  });

  test("generates a token with default options", () => {
    const token = CSRF.generate(secret);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);

    // Should be a base64url token (contains only base64url-safe characters)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("generates a token with different formats", () => {
    // Base64 format
    const base64Token = CSRF.generate(secret, { encoding: "base64" });
    expect(typeof base64Token).toBe("string");
    expect(base64Token).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);

    // Hex format
    const hexToken = CSRF.generate(secret, { encoding: "hex" });
    expect(typeof hexToken).toBe("string");
    expect(hexToken).toMatch(/^[0-9a-f]+$/);
  });

  test("verifies a valid token", () => {
    const token = CSRF.generate(secret);
    const isValid = CSRF.verify(token, { secret });
    expect(isValid).toBe(true);
  });

  test("rejects an invalid token", () => {
    const token = CSRF.generate(secret);

    // Tamper with the token
    const tamperedToken = token.substring(0, token.length - 5) + "XXXXX";

    const isValid = CSRF.verify(tamperedToken, { secret });
    expect(isValid).toBe(false);
  });

  test("token verification is sensitive to the secret", () => {
    const token = CSRF.generate(secret);

    // Try to verify with a different secret
    const isValid = CSRF.verify(token, { secret: "wrong-secret" });
    expect(isValid).toBe(false);
  });

  test("tokens expire after the specified time", async () => {
    // Generate a token with a very short expiration (1 millisecond)
    const token = CSRF.generate(secret, {
      expiresIn: 1,
    });

    // Wait a bit to ensure expiration
    await Bun.sleep(10);

    // Should be expired now
    const isValid = CSRF.verify(token, { secret });
    expect(isValid).toBe(false);
  });

  test("verification respects maxAge parameter", async () => {
    // Generate a token with default expiration (24 hours)
    const token = CSRF.generate(secret);

    // But verify with a very short maxAge (1 millisecond)
    await Bun.sleep(10);

    // Should be rejected because our maxAge is very short
    const isValid = CSRF.verify(token, { secret, maxAge: 1 });
    expect(isValid).toBe(false);
  });

  test("token with expiresIn parameter works", async () => {
    // Generate a token with a longer expiration (1 second)
    const token = CSRF.generate(secret, {
      expiresIn: 100,
    });

    // Should be valid immediately
    expect(CSRF.verify(token, { secret })).toBe(true);

    // Should still be valid after a short time
    await Bun.sleep(10);
    expect(CSRF.verify(token, { secret })).toBe(true);

    // Ensure that expiration works properly
    await Bun.sleep(100);
    expect(CSRF.verify(token, { secret })).toBe(false);
  });

  test("token format doesn't affect verification", () => {
    // Test that tokens in different formats can all be verified
    const base64Token = CSRF.generate(secret, { encoding: "base64" });
    const base64urlToken = CSRF.generate(secret, { encoding: "base64url" });
    const hexToken = CSRF.generate(secret, { encoding: "hex" });

    expect(CSRF.verify(base64Token, { secret, encoding: "base64" })).toBe(true);
    expect(CSRF.verify(base64urlToken, { secret, encoding: "base64url" })).toBe(true);
    expect(CSRF.verify(hexToken, { secret, encoding: "hex" })).toBe(true);
  });

  test("test with default algorithm", async () => {
    // default
    const token = CSRF.generate(secret);
    expect(CSRF.verify(token, { secret })).toBe(true);
  });
  const algorithms: Array<CSRFAlgorithm> = ["blake2b256", "blake2b512", "sha256", "sha384", "sha512", "sha512-256"];
  for (const algorithm of algorithms) {
    test(`test with algorithm ${algorithm}`, async () => {
      const token2 = CSRF.generate(secret, { algorithm });
      expect(CSRF.verify(token2, { secret, algorithm })).toBe(true);
    });
  }

  test("default secret", () => {
    const token = CSRF.generate();
    expect(token).toBeDefined();
    expect(token.length).toBeGreaterThan(0);
    expect(CSRF.verify(token, { secret: "wrong-secret" })).toBe(false);
    expect(CSRF.verify(token)).toBe(true);
  });

  test("token bound to a sessionId verifies for the same sessionId", () => {
    const token = CSRF.generate(secret, { sessionId: "user-session-1" });
    expect(CSRF.verify(token, { secret, sessionId: "user-session-1" })).toBe(true);
  });

  test("token bound to a sessionId does not verify for a different sessionId", () => {
    const token = CSRF.generate(secret, { sessionId: "attacker-session" });
    expect(CSRF.verify(token, { secret, sessionId: "victim-session" })).toBe(false);
  });

  test("sessionId binding is fail-closed in both directions", () => {
    // A token bound to a session does not verify without one.
    const boundToken = CSRF.generate(secret, { sessionId: "user-session-1" });
    expect(CSRF.verify(boundToken, { secret })).toBe(false);

    // A token generated without a session does not verify with one.
    const unboundToken = CSRF.generate(secret);
    expect(CSRF.verify(unboundToken, { secret, sessionId: "user-session-1" })).toBe(false);
  });

  test("sessionId composes with encoding and algorithm options", () => {
    const sessionId = "user-session-1";
    const token = CSRF.generate(secret, { sessionId, encoding: "hex", algorithm: "sha512" });
    expect(CSRF.verify(token, { secret, sessionId, encoding: "hex", algorithm: "sha512" })).toBe(true);
    expect(CSRF.verify(token, { secret, sessionId: "other-session", encoding: "hex", algorithm: "sha512" })).toBe(
      false,
    );
  });

  test("error handling", () => {
    // Empty token
    expect(() => CSRF.verify("", { secret })).toThrow();

    // Empty secret for generation
    expect(() => CSRF.generate("")).toThrow();

    // Empty secret for verification
    expect(() => CSRF.verify("some-token", { secret: "" })).toThrow();

    // Empty sessionId for generation
    expect(() => CSRF.generate(secret, { sessionId: "" })).toThrow();

    // Empty sessionId for verification
    const token = CSRF.generate(secret);
    expect(() => CSRF.verify(token, { secret, sessionId: "" })).toThrow();

    // Non-string sessionId
    // @ts-expect-error - testing invalid input
    expect(() => CSRF.generate(secret, { sessionId: 123 })).toThrow();
    // @ts-expect-error - testing invalid input
    expect(() => CSRF.verify(token, { secret, sessionId: 123 })).toThrow();
  });

  describe.each([
    ["expiresIn", (value: unknown) => CSRF.generate(secret, { expiresIn: value as number })],
    ["maxAge", (value: unknown) => CSRF.verify(CSRF.generate(secret), { secret, maxAge: value as number })],
  ])("%s option validation", (field, call) => {
    function thrown(value: unknown) {
      try {
        call(value);
      } catch (error: any) {
        return { constructor: error.constructor, code: error.code, message: error.message };
      }
      throw new Error(`expected ${field}: ${String(value)} to throw`);
    }

    test("undefined is treated as an absent option", () => {
      expect(() => call(undefined)).not.toThrow();

      // The token embeds expiresIn as a big-endian u64 at bytes 24..32, after
      // the timestamp and the nonce. 0 there means the token never expires.
      const embeddedExpiresIn = (options?: { expiresIn?: number }) =>
        Buffer.from(CSRF.generate(secret, options), "base64url").readBigUInt64BE(24);
      expect(embeddedExpiresIn({ expiresIn: 0 })).toBe(0n);
      expect(embeddedExpiresIn({ expiresIn: undefined })).toBe(BigInt(24 * 60 * 60 * 1000));
      expect(embeddedExpiresIn()).toBe(BigInt(24 * 60 * 60 * 1000));
    });

    // A NaN duration comes from a bug in the caller. It must not select the
    // 24h default, which can be laxer than the window the caller computed.
    test("NaN throws RangeError [ERR_OUT_OF_RANGE]", () => {
      expect(thrown(NaN)).toEqual({
        constructor: RangeError,
        code: "ERR_OUT_OF_RANGE",
        message: `The value of "${field}" is out of range. It must be an integer. Received NaN`,
      });
    });

    test("out-of-range values throw RangeError [ERR_OUT_OF_RANGE]", () => {
      const prefix = `The value of "${field}" is out of range. It must be >= 0 and <= 9007199254740991.`;
      expect(thrown(-1)).toEqual({
        constructor: RangeError,
        code: "ERR_OUT_OF_RANGE",
        message: `${prefix} Received -1`,
      });
      expect(thrown(2 ** 53)).toEqual({
        constructor: RangeError,
        code: "ERR_OUT_OF_RANGE",
        message: `${prefix} Received 9007199254740992`,
      });
      expect(thrown(Infinity)).toEqual({
        constructor: RangeError,
        code: "ERR_OUT_OF_RANGE",
        message: `${prefix} Received Infinity`,
      });
    });

    test("non-integer and non-number values throw TypeError [ERR_INVALID_ARG_TYPE]", () => {
      expect(thrown(1.5)).toEqual({
        constructor: TypeError,
        code: "ERR_INVALID_ARG_TYPE",
        message: `The "${field}" property must be of type integer. Received number`,
      });
      expect(thrown("100")).toEqual({
        constructor: TypeError,
        code: "ERR_INVALID_ARG_TYPE",
        message: `The "${field}" property must be of type number. Received string`,
      });
    });
  });

  test("rejects encodings that are not token formats", () => {
    const token = CSRF.generate(secret);
    const message = "Invalid format: must be 'base64', 'base64url', or 'hex'";

    // Buffer encodings that are not token formats, and names that are not encodings at all
    for (const encoding of ["utf8", "latin1", "buffer", "bogus"]) {
      // @ts-expect-error - testing invalid input
      expect(() => CSRF.generate(secret, { encoding })).toThrow(message);
      // @ts-expect-error - testing invalid input
      expect(() => CSRF.verify(token, { secret, encoding })).toThrow(message);
    }

    // An empty string selects the default (base64url) in both directions
    // @ts-expect-error - testing invalid input
    expect(CSRF.verify(CSRF.generate(secret, { encoding: "" }), { secret, encoding: "" })).toBe(true);
  });

  test("handle bad decoding", () => {
    const ambigousSecret = "test-secret";

    const token = CSRF.generate(ambigousSecret, {
      encoding: "hex",
      expiresIn: 60 * 60 * 1000,
    });
    // the default encoding is base64url with is the same decoding for base64
    expect(CSRF.verify(token, { secret: ambigousSecret })).toBe(false);
    expect(CSRF.verify(token, { secret: ambigousSecret, encoding: "hex" })).toBe(true);
  });
});
