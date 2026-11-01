import { CSRF, type CSRFAlgorithm } from "bun";
import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
describe("Bun.CSRF", () => {
  const secret = "this-is-my-super-secure-secret-key";

  // A token is timestamp (8) | nonce (16) | expiresIn (8), big-endian, then an
  // HMAC over those 32 bytes. This signs one that was issued `age` ms ago, so
  // that an expiry check does not have to sleep.
  const tokenIssued = (age: number, expiresIn: number) => {
    const payload = Buffer.alloc(32);
    payload.writeBigUInt64BE(BigInt(Date.now() - age), 0);
    crypto.getRandomValues(payload.subarray(8, 24));
    payload.writeBigUInt64BE(BigInt(expiresIn), 24);
    const signature = createHmac("sha256", secret).update(payload).digest();
    return Buffer.concat([payload, signature]).toString("base64url");
  };

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

  test("token with expiresIn parameter works", () => {
    const MINUTE = 60 * 1000;
    const token = CSRF.generate(secret, { expiresIn: MINUTE });
    expect(CSRF.verify(token, { secret })).toBe(true);
    // generate() embeds the expiresIn it was given.
    expect(Buffer.from(token, "base64url").readBigUInt64BE(24)).toBe(BigInt(MINUTE));

    // verify() accepts a token until it is older than its expiresIn, then rejects it.
    expect(CSRF.verify(tokenIssued(MINUTE / 2, MINUTE), { secret })).toBe(true);
    expect(CSRF.verify(tokenIssued(2 * MINUTE, MINUTE), { secret })).toBe(false);
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
    const invalid = (message: string) =>
      expect.objectContaining({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE", message });

    // Empty token
    expect(() => CSRF.verify("", { secret })).toThrow(invalid("Token must be a non-empty string"));

    // Empty secret for generation
    expect(() => CSRF.generate("")).toThrow(invalid("Secret must be a non-empty string"));

    // Empty secret for verification
    expect(() => CSRF.verify("some-token", { secret: "" })).toThrow(invalid("Secret must be a non-empty string"));

    // Empty sessionId for generation
    expect(() => CSRF.generate(secret, { sessionId: "" })).toThrow(invalid("sessionId must be a non-empty string"));

    // Empty sessionId for verification
    const token = CSRF.generate(secret);
    expect(() => CSRF.verify(token, { secret, sessionId: "" })).toThrow(
      invalid("sessionId must be a non-empty string"),
    );

    // Non-string sessionId
    // @ts-expect-error - testing invalid input
    expect(() => CSRF.generate(secret, { sessionId: 123 })).toThrow(
      invalid("CSRFGenerateOptions.sessionId must be a string"),
    );
    // @ts-expect-error - testing invalid input
    expect(() => CSRF.verify(token, { secret, sessionId: 123 })).toThrow(
      invalid("CSRFVerifyOptions.sessionId must be a string"),
    );

    for (const notAString of [null, 1, true, {}, { toString: () => secret }] as any[]) {
      expect(() => CSRF.generate(notAString)).toThrow(invalid("secret must be a string"));
      expect(() => CSRF.verify(notAString, { secret })).toThrow(invalid("token must be a string"));
      expect(() => CSRF.generate(secret, { algorithm: notAString })).toThrow(
        invalid("CSRFGenerateOptions.algorithm must be a string"),
      );
    }
    // @ts-expect-error - testing invalid input
    expect(() => CSRF.verify()).toThrow(invalid("token must be a string"));
    for (const algorithm of ["md5", "sha1", "bogus", ""] as any[]) {
      expect(() => CSRF.generate(secret, { algorithm })).toThrow(invalid("Algorithm not supported"));
      expect(() => CSRF.verify(token, { secret, algorithm })).toThrow(invalid("Algorithm not supported"));
    }
  });

  test("a secret that is undefined is the default secret", () => {
    for (const token of [CSRF.generate(), CSRF.generate(undefined), CSRF.generate(undefined, { encoding: "hex" })]) {
      const encoding = /^[0-9a-f]+$/.test(token) ? "hex" : "base64url";
      expect(CSRF.verify(token, { encoding })).toBe(true);
      expect(CSRF.verify(token, { encoding, secret: undefined })).toBe(true);
      expect(CSRF.verify(token, { encoding, secret })).toBe(false);
    }
  });

  test("options are read in order, each once, and not from Object.prototype", () => {
    const spy = (members: Record<string, unknown>, log: string[]) => {
      const options = {};
      for (const [member, value] of Object.entries(members)) {
        Object.defineProperty(options, member, {
          get() {
            log.push(member);
            return value;
          },
        });
      }
      return options;
    };
    const generated: string[] = [];
    const token = CSRF.generate(
      secret,
      spy({ algorithm: "SHA512", encoding: "HEX", sessionId: "s", expiresIn: 1000 }, generated),
    );
    expect(generated).toEqual(["expiresIn", "sessionId", "encoding", "algorithm"]);
    expect(token).toMatch(/^[0-9a-f]+$/);

    const verified: string[] = [];
    expect(
      CSRF.verify(token, spy({ algorithm: "sha512", encoding: "hex", maxAge: 1000, sessionId: "s", secret }, verified)),
    ).toBe(true);
    expect(verified).toEqual(["secret", "sessionId", "maxAge", "encoding", "algorithm"]);

    expect(CSRF.generate(secret, Object.create({ encoding: "hex" }))).toMatch(/^[0-9a-f]+$/);
    for (const ignored of [null, undefined, 1, "hex", true] as any[]) {
      expect(CSRF.verify(CSRF.generate(secret, ignored), { secret })).toBe(true);
      expect(CSRF.verify(CSRF.generate(), ignored)).toBe(true);
    }
    (Object.prototype as any).encoding = "hex";
    (Object.prototype as any).secret = "other";
    try {
      expect(CSRF.verify(CSRF.generate(secret, {}), { secret, encoding: "base64url" })).toBe(true);
      expect(CSRF.verify(CSRF.generate(), {})).toBe(true);
    } finally {
      delete (Object.prototype as any).encoding;
      delete (Object.prototype as any).secret;
    }
  });

  test("an array, a function and a class are options like any other object", () => {
    for (const options of [[], () => {}, class {}] as any[]) {
      Object.assign(options, { encoding: "hex", secret });
      const token = CSRF.generate(secret, options);
      expect(token).toMatch(/^[0-9a-f]+$/);
      expect(CSRF.verify(token, options)).toBe(true);
      expect(CSRF.verify(token, Object.assign(options, { secret: "other" }))).toBe(false);
    }

    // What limits a token is not dropped because of what holds it.
    const token = CSRF.generate(secret);
    Bun.sleepSync(5);
    class Policy {
      static secret = secret;
      static maxAge = 1;
    }
    expect(CSRF.verify(token, Policy as any)).toBe(false);
    expect(CSRF.verify(token, { secret, maxAge: 1 })).toBe(false);
    expect(CSRF.verify(token, { secret })).toBe(true);
  });

  test("every option is read and converted before any value is looked at", () => {
    const log: string[] = [];
    const options = {
      get sessionId() {
        log.push("sessionId");
        return "";
      },
      get algorithm() {
        log.push("algorithm");
        return 5;
      },
    };
    expect(() => CSRF.generate("", options as any)).toThrow("CSRFGenerateOptions.algorithm must be a string");
    expect(log).toEqual(["sessionId", "algorithm"]);
    expect(() => CSRF.generate("", { sessionId: "" })).toThrow("Secret must be a non-empty string");
    expect(() => CSRF.generate(secret, { sessionId: "", encoding: "utf8" as any })).toThrow(
      "sessionId must be a non-empty string",
    );
  });

  test("a String object counts by what it converts to", () => {
    class Empty extends String {
      toString() {
        return "";
      }
    }
    expect(() => CSRF.generate(new Empty("abc") as any)).toThrow("Secret must be a non-empty string");
    expect(() => CSRF.verify(new Empty("abc") as any, { secret })).toThrow("Token must be a non-empty string");
    expect(CSRF.verify(CSRF.generate(new String(secret) as any), { secret })).toBe(true);
  });

  test("the largest expiresIn and maxAge are ones that a token can be verified with", () => {
    expect(
      CSRF.verify(CSRF.generate(secret, { expiresIn: Number.MAX_SAFE_INTEGER }), {
        secret,
        maxAge: Number.MAX_SAFE_INTEGER,
      }),
    ).toBe(true);
  });

  test("Bun.CSRF is a plain object of two functions", () => {
    expect(Object.getPrototypeOf(CSRF)).toBe(Object.prototype);
    expect(Bun.CSRF).toBe(CSRF);
    expect(
      Object.entries(Object.getOwnPropertyDescriptors(CSRF)).map(([key, { value, ...attributes }]) => ({
        key,
        name: value.name,
        length: value.length,
        ...attributes,
      })),
    ).toEqual([
      { key: "generate", name: "generate", length: 0, writable: true, enumerable: true, configurable: true },
      { key: "verify", name: "verify", length: 1, writable: true, enumerable: true, configurable: true },
    ]);
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

    const member = `${field === "expiresIn" ? "CSRFGenerateOptions" : "CSRFVerifyOptions"}.${field}`;

    // 0 means that the token never expires, which NaN must not turn into.
    test("NaN is refused", () => {
      expect(thrown(NaN)).toEqual({
        constructor: RangeError,
        code: "ERR_OUT_OF_RANGE",
        message: `The value of "${member}" is out of range. It must be an integer. Received NaN`,
      });
    });

    test("undefined is an absent option", () => {
      expect(() => call(undefined)).not.toThrow();
      // The token embeds expiresIn as a big-endian u64 at bytes 24..32, after
      // the timestamp and the nonce.
      const embeddedExpiresIn = (options?: { expiresIn?: number }) =>
        Buffer.from(CSRF.generate(secret, options), "base64url").readBigUInt64BE(24);
      expect(embeddedExpiresIn({ expiresIn: 0 })).toBe(0n);
      expect(embeddedExpiresIn({ expiresIn: undefined })).toBe(embeddedExpiresIn());
      expect(embeddedExpiresIn()).toBe(BigInt(24 * 60 * 60 * 1000));
      expect(embeddedExpiresIn({ expiresIn: 2 ** 53 - 1 })).toBe(BigInt(2 ** 53 - 1));
    });

    test("out-of-range and non-integer values throw RangeError [ERR_OUT_OF_RANGE]", () => {
      for (const [value, received] of [
        [-1, "-1"],
        [2 ** 53, "9_007_199_254_740_992"],
      ]) {
        expect(thrown(value)).toEqual({
          constructor: RangeError,
          code: "ERR_OUT_OF_RANGE",
          message: `The value of "${member}" is out of range. It must be >= 0 && <= 9007199254740991. Received ${received}`,
        });
      }
      for (const value of [Infinity, 1.5]) {
        expect(thrown(value)).toEqual({
          constructor: RangeError,
          code: "ERR_OUT_OF_RANGE",
          message: `The value of "${member}" is out of range. It must be an integer. Received ${value}`,
        });
      }
    });

    test("non-number values throw TypeError [ERR_INVALID_ARG_TYPE]", () => {
      for (const [value, received] of [
        ["100", "type string ('100')"],
        [null, "null"],
        [true, "type boolean (true)"],
        [{ valueOf: () => 1 }, "an instance of Object"],
        [1n, "type bigint (1n)"],
        [2n ** 64n - 1n, "type bigint (18446744073709551615n)"],
      ]) {
        expect(thrown(value)).toEqual({
          constructor: TypeError,
          code: "ERR_INVALID_ARG_TYPE",
          message: `The "${member}" property must be of type number. Received ${received}`,
        });
      }
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
