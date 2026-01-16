import { describe, expect, test } from "bun:test";

describe("base64 URL-safe encoding with simdutf", () => {
  test("encodes simple strings correctly", () => {
    const input = new TextEncoder().encode("Man");
    const output = new Uint8Array(100);
    const len = Bun.unsafe.base64.encodeURLSafe(output, input);
    const result = new TextDecoder().decode(output.subarray(0, len));

    // URL-safe base64 encoding of "Man" should be "TWFu" (no padding)
    expect(result).toBe("TWFu");
  });

  test("encodes without padding", () => {
    const input = new TextEncoder().encode("Woman");
    const output = new Uint8Array(100);
    const len = Bun.unsafe.base64.encodeURLSafe(output, input);
    const result = new TextDecoder().decode(output.subarray(0, len));

    // URL-safe base64 encoding of "Woman" should be "V29tYW4" (no padding)
    expect(result).toBe("V29tYW4");
    expect(result).not.toContain("=");
  });

  test("uses URL-safe alphabet (- and _ instead of + and /)", () => {
    // Input that produces + and / in standard base64
    const input = new Uint8Array([0xff, 0xff, 0xbe, 0xff, 0xef, 0xbf, 0xfb, 0xef, 0xff]);
    const output = new Uint8Array(100);
    const len = Bun.unsafe.base64.encodeURLSafe(output, input);
    const result = new TextDecoder().decode(output.subarray(0, len));

    // Should use - and _ instead of + and /
    expect(result).toContain("_");
    expect(result).toContain("-");
    expect(result).not.toContain("+");
    expect(result).not.toContain("/");

    // Standard base64 would be "//++/++/++//" but URL-safe should be "__--_--_--__"
    expect(result).toBe("__--_--_--__");
  });

  test("handles large strings", () => {
    const quote =
      "Man is distinguished, not only by his reason, but by this " +
      "singular passion from other animals, which is a lust " +
      "of the mind, that by a perseverance of delight in the " +
      "continued and indefatigable generation of knowledge, " +
      "exceeds the short vehemence of any carnal pleasure.";

    const input = new TextEncoder().encode(quote);
    const output = new Uint8Array(1000);
    const len = Bun.unsafe.base64.encodeURLSafe(output, input);
    const result = new TextDecoder().decode(output.subarray(0, len));

    // Should not contain standard base64 characters
    expect(result).not.toContain("+");
    expect(result).not.toContain("/");
    // Should not have padding
    expect(result).not.toContain("=");
    // Should be a reasonable length
    expect(result.length).toBeGreaterThan(quote.length);
  });

  test("handles empty input", () => {
    const input = new Uint8Array(0);
    const output = new Uint8Array(10);
    const len = Bun.unsafe.base64.encodeURLSafe(output, input);

    expect(len).toBe(0);
  });

  test("handles single byte", () => {
    const input = new Uint8Array([0x41]); // 'A'
    const output = new Uint8Array(10);
    const len = Bun.unsafe.base64.encodeURLSafe(output, input);
    const result = new TextDecoder().decode(output.subarray(0, len));

    // Single byte 'A' (0x41) in URL-safe base64
    expect(result).toBe("QQ");
  });

  test("produces same output as Buffer.toString('base64url')", () => {
    const testCases = [
      "Man",
      "Woman",
      "Hello, World!",
      new Uint8Array([0xff, 0xff, 0xbe, 0xff, 0xef, 0xbf, 0xfb, 0xef, 0xff]),
    ];

    for (const testCase of testCases) {
      const input = typeof testCase === "string" ? new TextEncoder().encode(testCase) : testCase;
      const output = new Uint8Array(1000);
      const len = Bun.unsafe.base64.encodeURLSafe(output, input);
      const result = new TextDecoder().decode(output.subarray(0, len));

      const expected = Buffer.from(input).toString("base64url");
      expect(result).toBe(expected);
    }
  });
});
