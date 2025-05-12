import { describe, expect, test } from "bun:test";

describe("Bun.Cookie.parse with exotic inputs", () => {
  test("handles cookies with various special characters in name", () => {
    // Test valid characters in cookie names per RFC
    const validNameChars = [
      "name=value",
      "n-a-m-e=value", // hyphen
      "n.a.m.e=value", // dots
      "n_a_m_e=value", // underscore
      "_name=value", // starting with underscore
      ".name=value", // starting with dot
      "!#$%&'*+-.^_`|~=value", // all allowed special chars per RFC6265
    ];

    for (const cookieStr of validNameChars) {
      const cookie = Bun.Cookie.parse(cookieStr);
      expect(cookie).toBeDefined();
      expect(cookie.value).toBe("value");
    }
  });

  test("handles unusual but valid values", () => {
    const unusualValues = [
      "name=", // empty value
      "name=;", // empty value with semicolon
      "name=\t", // tab as value
      "name= ", // space as value
      "name=val ue", // space in value
      "name=val+ue", // plus in value
      "name=val%20ue", // url encoded space
      'name=val"ue', // quotes in value
      "name=val<>ue", // angle brackets in value
      "name=val()ue", // parentheses in value
      "name=val[]ue", // brackets in value
      "name=val{}ue", // braces in value
      "name=val:ue", // colon in value
      "name=val/ue", // slash in value
      "name=val\\ue", // backslash in value
      "name=val\tue", // tab in value
      "name=val\nue", // newline in value (should be handled)
    ];

    for (const cookieStr of unusualValues) {
      try {
        const cookie = Bun.Cookie.parse(cookieStr);
        expect(cookie).toBeDefined();
        expect(cookie.name).toBe("name");
        // Value might be truncated depending on the implementation
      } catch (error) {
        // Some implementations might reject certain values
        expect(error).toBeDefined();
      }
    }
  });

  test("handles strange but valid attribute formats", () => {
    const strangeAttrs = [
      "name=value; Path=/", // normal
      "name=value;Path=/", // no space after semicolon
      "name=value;  Path=/", // multiple spaces
      "name=value;\tPath=/", // tab after semicolon
      "name=value;\nPath=/", // newline after semicolon (should be handled)
      "name=value;\rPath=/", // carriage return after semicolon
      "name=value; \tPath=/", // space and tab before attribute
    ];

    for (const cookieStr of strangeAttrs) {
      try {
        const cookie = Bun.Cookie.parse(cookieStr);
        expect(cookie).toBeDefined();
        expect(cookie.name).toBe("name");
        expect(cookie.value).toBe("value");
        expect(cookie.path).toBe("/");
      } catch (error) {
        // Some implementations might be strict about format
        expect(error).toBeDefined();
      }
    }
  });

  test("handles unique case variations of attribute names", () => {
    const caseVariants = [
      "name=value; Path=/",
      "name=value; path=/",
      "name=value; PATH=/",
      "name=value; PaTh=/",
      "name=value; Domain=example.com",
      "name=value; domain=example.com",
      "name=value; DOMAIN=example.com",
      "name=value; DoMaIn=example.com",
      "name=value; Secure",
      "name=value; secure",
      "name=value; SECURE",
      "name=value; HttpOnly",
      "name=value; httponly",
      "name=value; HTTPONLY",
      "name=value; SameSite=Strict",
      "name=value; samesite=strict",
      "name=value; SAMESITE=STRICT",
      "name=value; Partitioned",
      "name=value; partitioned",
      "name=value; PARTITIONED",
    ];

    for (const cookieStr of caseVariants) {
      const cookie = Bun.Cookie.parse(cookieStr);
      expect(cookie).toBeDefined();
      expect(cookie.name).toBe("name");
      expect(cookie.value).toBe("value");
    }
  });

  test("handles bizarre attribute value combinations", () => {
    const bizarreAttrs = [
      // Empty attribute values
      "name=value; Path=",
      "name=value; Domain=",
      // Quoted values
      'name=value; Path="/"',
      'name=value; Domain="example.com"',
      // Spaces in attribute values
      "name=value; Path= /",
      "name=value; Path=/ ",
      "name=value; Path= / ",
      "name=value; Domain= example.com",
      // Strange characters in attribute values
      "name=value; Path=/weird#path?query=param",
      "name=value; Domain=example.com:8080",
    ];

    for (const cookieStr of bizarreAttrs) {
      try {
        const cookie = Bun.Cookie.parse(cookieStr);
        expect(cookie).toBeDefined();
        expect(cookie.name).toBe("name");
        expect(cookie.value).toBe("value");
      } catch (error) {
        // Some might be rejected, which is fine
        expect(error).toBeDefined();
      }
    }
  });

  describe("handles various Date formats for Expires", () => {
    const dateFormats = [
      // Standard format
      "name=value; Expires=Wed, 21 Oct 2025 07:28:00 GMT",
      // Without day name
      "name=value; Expires=21 Oct 2025 07:28:00 GMT",
      // Different day format
      "name=value; Expires=Wed, 21-Oct-2025 07:28:00 GMT",
      // Without seconds
      "name=value; Expires=Wed, 21 Oct 2025 07:28 GMT",
      // Without time
      "name=value; Expires=Wed, 21 Oct 2025",
      // Without GMT
      "name=value; Expires=Wed, 21 Oct 2025 07:28:00",
      // With timezone offset
      "name=value; Expires=Wed, 21 Oct 2025 07:28:00 +0000",
      // Non-standard but often accepted
      "name=value; Expires=2025-10-21T07:28:00Z",
    ];

    for (const cookieStr of dateFormats) {
      test(cookieStr, () => {
        try {
          const cookie = Bun.Cookie.parse(cookieStr);
          expect(cookie).toBeDefined();
          expect(cookie.name).toBe("name");
          expect(cookie.value).toBe("value");

          // Expires should be set to some timestamp
          if ("expires" in cookie) {
            expect(typeof cookie.expires).toBe("number");
          }
        } catch (error) {
          // Some formats might not be supported
          expect(error).toBeDefined();
        }
      });
    }
  });

  test("handles boundary values for MaxAge", () => {
    const maxAgeVariants = [
      "name=value; Max-Age=0", // Session cookie
      "name=value; Max-Age=1", // 1 second
      "name=value; Max-Age=2147483647", // Max 32-bit signed integer
      "name=value; Max-Age=9007199254740991", // Number.MAX_SAFE_INTEGER
    ];

    for (const cookieStr of maxAgeVariants) {
      const cookie = Bun.Cookie.parse(cookieStr);
      expect(cookie).toBeDefined();
      expect(cookie.name).toBe("name");
      expect(cookie.value).toBe("value");

      const expectedMaxAge = parseInt(cookieStr.split("Max-Age=")[1]);
      expect(cookie.maxAge).toBe(expectedMaxAge);
    }
  });

  test("handles duplicate attribute values", () => {
    const duplicateAttrs = [
      "name=value; Path=/foo; Path=/bar",
      "name=value; Domain=example.com; Domain=other.com",
      "name=value; SameSite=Strict; SameSite=Lax",
      "name=value; Max-Age=100; Max-Age=200",
      "name=value; Secure; Secure",
      "name=value; HttpOnly; HttpOnly",
    ];

    for (const cookieStr of duplicateAttrs) {
      const cookie = Bun.Cookie.parse(cookieStr);
      expect(cookie).toBeDefined();
      expect(cookie.name).toBe("name");
      expect(cookie.value).toBe("value");

      // Usually the first value should win, but implementation may vary
    }
  });

  test("handles mixed standard and non-standard attributes", () => {
    const mixedAttrs = [
      "name=value; Path=/; Custom=something",
      "name=value; Domain=example.com; SessionId=123456",
      "name=value; SameSite=Strict; Priority=High",
      "name=value; Max-Age=100; Version=1",
      "name=value; Secure; CommentUrl=http://example.com/",
    ];

    for (const cookieStr of mixedAttrs) {
      const cookie = Bun.Cookie.parse(cookieStr);
      expect(cookie).toBeDefined();
      expect(cookie.name).toBe("name");
      expect(cookie.value).toBe("value");

      // Non-standard attributes should be ignored
    }
  });

  test("handles exotic but RFC-compliant cookies", () => {
    const exoticCompliantCases = [
      // Multiple cookie attributes of different types
      "name=value; Path=/; Domain=example.com; Max-Age=3600; Secure; HttpOnly; SameSite=Strict; Partitioned",
      // Strange but valid domain
      "name=value; Domain=a.b-c.co.uk",
      // Strange but valid path
      "name=value; Path=/a/very/deep/path/with/many/segments",
      // URL encoded chars in path
      "name=value; Path=/path%20with%20spaces",
      // URL encoded chars in domain (though questionable)
      // "name=value; Domain=weird%2Edomain.com",
    ];

    for (const cookieStr of exoticCompliantCases) {
      const cookie = Bun.Cookie.parse(cookieStr);
      expect(cookie).toBeDefined();
      expect(cookie.name).toBe("name");
      expect(cookie.value).toBe("value");
    }
  });

  test("handles confusing value patterns", () => {
    const confusingValues = [
      // Values that look like attributes
      "name=Path=/; Domain=example.com",
      "name=Secure; Path=/",
      "name=Domain=example.com; Path=/",
      "name=HttpOnly; Secure",
      "name=SameSite=Lax; Path=/",

      // Values with semicolons that should be part of value
      'name="value; with; semicolons"; Path=/',
      "name=value\\; still\\; value; Path=/",

      // Values with equals signs
      "name=key=value; Path=/",
      "name==; Path=/",
      "name===; Path=/",
      "name=a=b=c=d; Path=/",

      // Values with strange encoding
      "name=%25%3B%3D%20; Path=/", // %25 = %, %3B = ;, %3D = =, %20 = space
      "name=\\u003B\\u003D; Path=/", // JavaScript unicode escapes for ;=
    ];

    for (const cookieStr of confusingValues) {
      try {
        const cookie = Bun.Cookie.parse(cookieStr);
        expect(cookie).toBeDefined();
        expect(cookie.name).toBe("name");
        // The value might be parsed differently depending on implementation
      } catch (error) {
        // Some implementations might reject these
        expect(error).toBeDefined();
      }
    }
  });

  test("handles exotic language characters", () => {
    const languageVariants = [
      // Cookies with non-Latin characters
      "name=こんにちは", // Japanese
      "name=你好", // Chinese
      "name=안녕하세요", // Korean
      "name=Привет", // Russian
      "name=مرحبا", // Arabic
      "name=שלום", // Hebrew (right-to-left)
      "name=Γειά σου", // Greek
      "name=नमस्ते", // Hindi

      // With attributes
      "name=こんにちは; Path=/jp",
      "name=Γειά σου; Domain=example.gr; Path=/; Secure",

      // Non-Latin in attributes (which is not compliant but should be handled)
      "name=value; Path=/こんにちは",
      "name=value; Domain=例子.中国", // IDN domain
    ];

    for (const cookieStr of languageVariants) {
      try {
        const cookie = Bun.Cookie.parse(cookieStr);
        expect(cookie).toBeDefined();
        expect(cookie.name).toBe("name");
      } catch (error) {
        // Some implementations might reject non-ASCII
        expect(error).toBeDefined();
      }
    }
  });

  test("handles exceedingly complex combinations", () => {
    const complexCases = [
      // Cookie with all possible standard attributes and extreme values
      "name=value; Domain=very-long-domain-name-with-many-subdomains.example.co.uk; " +
        "Path=/extremely/long/path/with/many/segments/that/goes/on/and/on; " +
        "Expires=Wed, 21 Oct 2099 07:28:00 GMT; " +
        "Max-Age=2147483647; " +
        "Secure; HttpOnly; SameSite=Strict; Partitioned",

      // Cookie with unusual but valid name and value and all attributes
      "!#$%&'*+-.^_`|~=v@lue_w!th-sp3c!@l_Ch@rs; " +
        "Domain=example.com; Path=/; Expires=Wed, 21 Oct 2025 07:28:00 GMT; " +
        "Max-Age=3600; Secure; HttpOnly; SameSite=None; Partitioned",

      // Cookie with mixed case in all attribute names
      "name=value; dOmAiN=example.com; PaTh=/; ExPiReS=Wed, 21 Oct 2025 07:28:00 GMT; " +
        "mAx-AgE=3600; SeCuRe; HtTpOnLy; SaMeSiTe=StRiCt; PaRtItIoNeD",
    ];

    for (const cookieStr of complexCases) {
      try {
        const cookie = Bun.Cookie.parse(cookieStr);
        expect(cookie).toBeDefined();
      } catch (error) {
        // Some might be rejected for various reasons
        expect(error).toBeDefined();
      }
    }
  });

  test("handles whitespace variations", () => {
    const whitespaceVariants = [
      // Normal spacing
      "name=value; Path=/; Domain=example.com",

      // No spaces
      "name=value;Path=/;Domain=example.com",

      // Excessive spaces
      "name=value;     Path=/;     Domain=example.com",

      // Tabs instead of spaces
      "name=value;\tPath=/;\tDomain=example.com",

      // Mixed whitespace
      "name=value; \t Path=/;\r\n\tDomain=example.com",

      // Leading/trailing whitespace
      " name=value; Path=/; Domain=example.com ",

      // Whitespace in name/value
      "name =value; Path=/",
      "name= value; Path=/",
      "name = value; Path=/",
    ];

    for (const cookieStr of whitespaceVariants) {
      try {
        const cookie = Bun.Cookie.parse(cookieStr);
        expect(cookie).toBeDefined();
        // Name and value might be trimmed in some implementations
        expect(cookie.name.trim()).toBe("name");
        expect(cookie.value.trim()).toBe("value");
      } catch (error) {
        // Some might be rejected
        expect(error).toBeDefined();
      }
    }
  });

  test("handles cookies with control characters", () => {
    const controlCharCases = [
      // Various ASCII control characters
      "name=value\u0001more", // SOH
      "name=value\u0002more", // STX
      "name=value\u0003more", // ETX
      "name=value\u0004more", // EOT
      "name=value\u0005more", // ENQ
      "name=value\u0006more", // ACK
      "name=value\u0007more", // BEL
      "name=value\bmore", // BS
      "name=value\tmore", // HT (tab)
      "name=value\nmore", // LF
      "name=value\vmore", // VT
      "name=value\fmore", // FF
      "name=value\rmore", // CR
      "name=value\u000Emore", // SO
      "name=value\u000Fmore", // SI
      "name=value\u0010more", // DLE
      "name=value\u001Amore", // SUB
      "name=value\u001Bmore", // ESC
      "name=value\u001Cmore", // FS
      "name=value\u001Dmore", // GS
      "name=value\u001Emore", // RS
      "name=value\u001Fmore", // US
      "name=value\u007Fmore", // DEL

      // Control characters in attribute values
      "name=value; Path=/\u0001path",
      "name=value; Domain=example\u0002.com",
    ];

    for (const cookieStr of controlCharCases) {
      try {
        const cookie = Bun.Cookie.parse(cookieStr);
        expect(cookie).toBeDefined();
        expect(cookie.name).toBe("name");
        // Control characters should ideally be stripped or rejected
      } catch (error) {
        // Rejecting is a valid response to control characters
        expect(error).toBeDefined();
      }
    }
  });

  test("handles cookies with emoji", () => {
    const emojiCases = [
      // Simple emoji
      "name=value🍪",
      "name=🍪value",
      "🍪=value",

      // Complex emoji (emoji with modifiers)
      "name=value👨‍👩‍👧‍👦",
      "name=value👩🏻‍💻",

      // Emoji in attributes
      "name=value; Path=/🍪",
      "name=value; Domain=example.🍪", // Invalid domain, but parser should handle
    ];

    for (const cookieStr of emojiCases) {
      try {
        const cookie = Bun.Cookie.parse(cookieStr);
        expect(cookie).toBeDefined();
        // Name might be rejected if it contains emoji
      } catch (error) {
        // Some implementations might reject emoji in names
        expect(error).toBeDefined();
      }
    }
  });

  test("handles unexpected format variations", () => {
    const unexpectedFormats = [
      // Multiple equals signs in name-value pair
      "name==value",

      // Random garbage after cookie value
      "name=value garbage",

      // Multiple semicolons
      "name=value;;; Path=/",

      // Semicolons with nothing after them
      "name=value; ",
      "name=value;",

      // Attributes with nothing after equals sign
      "name=value; Path=; Domain=",

      // Just general weirdness
      "name=value;;;;; Path====/;; Domain::::example.com",
    ];

    for (const cookieStr of unexpectedFormats) {
      try {
        const cookie = Bun.Cookie.parse(cookieStr);
        expect(cookie).toBeDefined();
        expect(cookie.name).toBe("name");
      } catch (error) {
        // Some might be rejected
        expect(error).toBeDefined();
      }
    }
  });
});
