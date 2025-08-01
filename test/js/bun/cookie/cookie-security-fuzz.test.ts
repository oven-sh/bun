import { describe, expect, test } from "bun:test";

describe("Bun.Cookie.parse security fuzz tests", () => {
  // Security-focused fuzz tests
  describe("resists cookie format injection attacks", () => {
    // Attempt to inject additional cookies via name or value
    const injectionCases = [
      "name=value\nSet-Cookie: inject=bad",
      "name=value\r\nSet-Cookie: inject=bad",
      "name=value\n\rSet-Cookie: inject=bad",
      "name=value\r\n\r\nSet-Cookie: inject=bad",
      "name=value\u0000Set-Cookie: inject=bad",
      "name=value\u2028Set-Cookie: inject=bad", // Line separator
      "name=value\u2029Set-Cookie: inject=bad", // Paragraph separator
      "name\r\nSet-Cookie: inject=bad;=value",
      "name\nSet-Cookie: inject=bad;=value",
    ];

    for (const injectionCase of injectionCases) {
      test(injectionCase, () => {
        expect(() => Bun.Cookie.parse(injectionCase)).toThrow();
      });
    }

    // Additional cookies are simply ignored
    test("additional cookies are simply ignored", () => {
      const cookie = Bun.Cookie.parse("name=value; Set-Cookie: inject=bad; other=value");
      expect(cookie.name).toBe("name");
      expect(cookie.value).toBe("value");
    });
  });

  describe("handles header splitting attacks", () => {
    const headerSplittingCases = [
      "name=value\r\nBadHeader: injection",
      "name=value\nBadHeader: injection",
      "name=value\r\n\r\nBadHeader: injection",
      "name=value\n\nBadHeader: injection",
      "name=value\rBadHeader: injection",
    ];

    for (const headerSplittingCase of headerSplittingCases) {
      test(headerSplittingCase, () => {
        expect(() => Bun.Cookie.parse(headerSplittingCase)).toThrow();
      });
    }
  });

  describe("handles non-ASCII characters in cookie values", () => {
    const nonAsciiCases = [
      "name=值", // Chinese
      "name=Значение", // Russian
      "name=قيمة", // Arabic
      "name=γιά σου", // Greek
      "name=😊🍪", // Emoji
      "name=\u2603", // Snowman
      "name=\u{1F4A9}", // Pile of poo emoji (surrogate pair)
    ];

    for (const nonAsciiCase of nonAsciiCases) {
      test(nonAsciiCase, () => {
        expect(() => Bun.Cookie.parse(nonAsciiCase)).toThrow();
      });
    }
  });

  test("resists RegExp denial of service attacks", () => {
    // Potential ReDoS patterns
    const redosPatterns = [
      `name=value; Path=${"a".repeat(1000)}${"b?".repeat(1000)}`,
      `name=${"a".repeat(1000)}${"b+".repeat(1000)}`,
      `name=value; Domain=${"a".repeat(500)}${".*".repeat(500)}`,
    ];

    for (const redosPattern of redosPatterns) {
      try {
        // Should parse in reasonable time or throw
        const startTime = performance.now();
        const cookie = Bun.Cookie.parse(redosPattern);
        const parseTime = performance.now() - startTime;

        // Shouldn't take an unreasonable amount of time (adjust threshold as needed)
        expect(parseTime).toBeLessThan(1000); // 1 second max
      } catch (error) {
        // Throwing is acceptable if it can't handle the input
        expect(error).toBeDefined();
      }
    }
  });

  test("handles attribute value injection attempts", () => {
    const attrInjectionCases = [
      "name=value; Path=/; Domain=evil.com",
      "name=value; Path=/; Domain=evil.com; Secure=false",
      "name=value; Secure=false", // Trying to override boolean attribute
      "name=value; HttpOnly=0", // Trying to override boolean attribute
      "name=value; SameSite=Strict; SameSite=None", // Duplicate attributes
      "name=value; Path=/; Path=/admin", // Duplicate attributes
    ];

    for (const attrInjectionCase of attrInjectionCases) {
      const cookie = Bun.Cookie.parse(attrInjectionCase);
      expect(cookie.name).toBe("name");
      expect(cookie.value).toBe("value");

      // Boolean attributes should be boolean
      if ("secure" in cookie) {
        expect(typeof cookie.secure).toBe("boolean");
      }
      if ("httpOnly" in cookie) {
        expect(typeof cookie.httpOnly).toBe("boolean");
      }

      // SameSite should be one of the expected values
      if ("sameSite" in cookie) {
        expect(["strict", "lax", "none"]).toContain(cookie.sameSite);
      }
    }
  });

  test("handles attribute-like patterns in values", () => {
    const attrLikeValueCases = [
      "name=value; not an attribute",
      "name=value with; semicolons",
      "name=value; with Path=/like tokens",
      "name=value; Domain",
      "name=value; =strangeness",
      "name=Path=/; value",
    ];

    for (const attrLikeCase of attrLikeValueCases) {
      try {
        const cookie = Bun.Cookie.parse(attrLikeCase);
        expect(cookie.name).toBe("name");
        // Value might be truncated at semicolon depending on implementation
      } catch (error) {
        // Some implementations might reject these
        expect(error).toBeDefined();
      }
    }
  });

  describe("handles various tricky and edge case patterns", () => {
    const trickyCases = [
      // Escaped quotes in values
      'name=value\\"with\\"quotes',
      // Mixed upper/lowercase
      "nAmE=VaLuE; pAtH=/; dOmAiN=example.com",
      // Just barely valid
      "n=v",
      // Multiple equals in value (only first = should be used)
      "name=value=more=equals",
      // Control characters
      "name=value\u0001\u0002\u0003",
      // Backslashes
      "name=value\\\\; Path=\\/",
      // Very unusual cookie name (but valid)
      "!#$%&'*+-.^_`|~=value",
    ];

    for (const trickyCase of trickyCases) {
      test(trickyCase, () => {
        Bun.Cookie.parse(trickyCase);
      });
    }

    const throwCases = [
      // Unicode in attribute names (should be rejected or handled safely)
      "name=value; 🍪=bad",
    ];

    for (const throwCase of throwCases) {
      test(throwCase, () => {
        expect(() => Bun.Cookie.parse(throwCase)).toThrow();
      });
    }
  });

  test("handles malicious MaxAge and Expires combinations", () => {
    const maliciousCases = [
      // Conflicting directives
      "name=value; Max-Age=0; Expires=Wed, 21 Oct 2025 07:28:00 GMT",
      "name=value; Max-Age=3600; Expires=Wed, 21 Oct 2015 07:28:00 GMT", // Past date
      // Extremely large values
      "name=value; Max-Age=9999999999999",
      "name=value; Expires=Wed, 21 Oct 9999 07:28:00 GMT",
      // Negative values
      "name=value; Max-Age=-1",
      // Overflow attempts
      "name=value; Max-Age=" + Number.MAX_SAFE_INTEGER,
      "name=value; Max-Age=" + (Number.MAX_SAFE_INTEGER + 1),
    ];

    for (const maliciousCase of maliciousCases) {
      try {
        const cookie = Bun.Cookie.parse(maliciousCase);
        expect(cookie).toBeDefined();
        if (cookie.maxAge !== undefined) {
          // Max-Age should be a reasonable number, not NaN or Infinity
          expect(Number.isFinite(cookie.maxAge)).toBe(true);
        }
        if (cookie.expires !== undefined) {
          // Expires should be a reasonable timestamp, not NaN
          expect(Number.isFinite(cookie.expires)).toBe(true);
        }
      } catch (error) {
        // Some cases might be rejected, which is fine
        expect(error).toBeDefined();
      }
    }
  });

  test("handles SQL injection attempts in cookie values", () => {
    const sqlInjectionCases = [
      "name=value' OR '1'='1",
      "name=value'; DROP TABLE users; --",
      "name=value' UNION SELECT * FROM passwords; --",
      'name=value"); DROP TABLE users; --',
      "name=value' OR '1'='1'; Path=/admin",
    ];

    for (const sqlInjectionCase of sqlInjectionCases) {
      const cookie = Bun.Cookie.parse(sqlInjectionCase);
      expect(cookie).toBeDefined();
      expect(cookie.name).toBe("name");
      // The value should include the SQL injection as-is, since it's just text to the cookie parser
      const expectedValue = sqlInjectionCase.substring(5).split(";")[0];
      expect(cookie.value).toBe(expectedValue);
    }
  });

  test("handles potential prototype pollution attacks", () => {
    const prototypePollutionCases = [
      "name=value; __proto__=polluted",
      "name=value; constructor=polluted",
      "name=value; prototype=polluted",
      "__proto__=value; name=test",
      "constructor=value; name=test",
      "prototype=value; name=test",
    ];

    for (const pollutionCase of prototypePollutionCases) {
      const cookie = Bun.Cookie.parse(pollutionCase);
      expect(cookie).toBeDefined();

      // These standard methods and properties should still be intact and not polluted
      expect(typeof Object.prototype.toString).toBe("function");
      expect({}.constructor).toBe(Object);
      expect(JSON.parse(JSON.stringify(cookie.toJSON()))).toStrictEqual(JSON.parse(JSON.stringify(cookie)));
    }
  });

  test("handles null byte injection attempts", () => {
    const nullByteAttacks = [
      "name=value\u0000malicious",
      "name\u0000malicious=value",
      "name=value; Path=/\u0000malicious",
      "name=value; Domain=example.com\u0000malicious",
      "name=value; SameSite=Strict\u0000None",
    ];

    for (const nullByteAttack of nullByteAttacks) {
      try {
        const cookie = Bun.Cookie.parse(nullByteAttack);
        expect(cookie).toBeDefined();

        // Ensure null bytes aren't present in the parsed values
        if (cookie.name) {
          expect(cookie.name).not.toInclude("\u0000");
        }
        if (cookie.value) {
          expect(cookie.value).not.toInclude("\u0000");
        }
        if (cookie.path) {
          expect(cookie.path).not.toInclude("\u0000");
        }
        if (cookie.domain) {
          expect(cookie.domain).not.toInclude("\u0000");
        }
      } catch (error) {
        // It's fine to reject strings with null bytes
        expect(error).toBeDefined();
      }
    }
  });

  describe("handles invalid Partitioned attribute uses", () => {
    const partitionedCases = [
      "name=value; Partitioned",
      "name=value; Partitioned=true",
      "name=value; Partitioned=false", // Trying to set it to false
      "name=value; Partitioned=1",
      "name=value; Partitioned=0",
      "name=value; Partitioned; Partitioned=false", // Duplicate with conflict
    ];

    for (const partitionedCase of partitionedCases) {
      test(partitionedCase, () => {
        const cookie = Bun.Cookie.parse(partitionedCase);
        expect(cookie).toBeDefined();
        expect(cookie.name).toBe("name");
        expect(cookie.value).toBe("value");

        // Partitioned is always true if present.
        expect(cookie.partitioned).toBe(true);
      });
    }
  });

  describe("handles unicode homograph attacks", () => {
    // These are characters that look similar to ASCII but are different
    const homographCases = [
      "nаme=value", // Cyrillic 'а' (U+0430) instead of Latin 'a'
      "name=vаlue", // Cyrillic 'а' (U+0430) in value
      "name=value; Pаth=/", // Cyrillic 'а' (U+0430) in attribute name
      "name=value; Domаin=example.com", // Cyrillic 'а' (U+0430) in attribute name
    ];

    for (const homographCase of homographCases) {
      test(homographCase, () => {
        expect(() => new Bun.Cookie(homographCase)).toThrowError();
      });
    }
  });
});
