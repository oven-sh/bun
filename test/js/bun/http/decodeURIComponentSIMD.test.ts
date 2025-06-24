import { decodeURIComponentSIMD } from "bun:internal-for-testing";
import { describe, expect, it } from "bun:test";

const inputs = [
  "hello world",
  "hello world  ",
  " hello world",
  "!@#$%^&*()",
  "1234567890",
  "abcdefghijklmnopqrstuvwxyz",
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  "こんにちは",
  "你好",
  "안녕하세요",
  "مرحبا",
  "שָׁלוֹם",
  "🌍🌎🌏",
  "👨‍👩‍👧‍👦",
  "🇺🇸🇯🇵🇰🇷",
  "https://example.com/path?param=value",
  "user@example.com",
  "path/to/file.txt",
  "C:\\Windows\\System32",
  "<script>alert('xss')</script>",
  "SELECT * FROM users;",
  "{}[]|\\",
  "     ",
  "",
  "a".repeat(1000),
  "🌟".repeat(100),
  "hello\nworld",
  "hello\tworld",
  "hello\rworld",
  "hello\\world",
  'hello"world',
  "hello'world",
  "hello`world",
  "hello/world",
  "hello?world",
  "hello=world",
  "hello&world",
  "hello+world",
  "hello%20world",
  "hello%2Fworld",
  "hello%3Fworld",
  "hello%3Dworld",
  "hello%26world",
  "hello%2Bworld",
  "hello%25world",
  "hello%23world",
  "hello%40world",
  "hello%21world",
  "hello%24world",
  "hello%2Cworld",
  "hello%3Bworld",
  "hello%3Aworld",
  "hello%5Bworld",
  "hello%5Dworld",
  "hello%7Bworld",
  "hello%7Dworld",
  "hello%7Cworld",
  "hello%5Cworld",
  "hello%22world",
  "hello%27world",
  "hello%60world",
  "hello%3Cworld",
  "hello%3Eworld",
  "hello%2Eworld",
  "hello%2Dworld",
  "hello%5Fworld",
  "hello%7Eworld",
  "hello%2Aworld",
  "hello%2Bworld",
  "hello%2Cworld",
  "hello%2Fworld",
  "hello%3Aworld",
  "hello%3Bworld",
  "hello%3Cworld",
  "hello%3Dworld",
  "hello%3Eworld",
  "hello%3Fworld",
  "hello%40world",
  "hello%5Bworld",
  "hello%5Cworld",
  "hello%5Dworld",
  "hello%5Eworld",
  "hello%5Fworld",
  "hello%60world",
  "hello%7Bworld",
  "hello%7Cworld",
  "hello%7Dworld",
  "hello%7Eworld",
  "hello%7Fworld",
  "hello%80world",
  "hello%FFworld",
  "hello%F0%9F%8C%9F",
  "hello%F0%9F%98%80",
  "hello%F0%9F%98%81",
  "hello%F0%9F%98%82",
  "hello%F0%9F%98%83",
  "hello%F0%9F%98%84",
  "hello%F0%9F%98%85",
  "hello%F0%9F%98%86",
  "hello%F0%9F%98%87",
  "hello%F0%9F%98%88",
  "hello%F0%9F%98%89",
  "hello%F0%9F%98%8A",
  "hello%F0%9F%98%8B",
  "hello%F0%9F%98%8C",
  "hello%F0%9F%98%8D",
  "hello%F0%9F%98%8E",
  "hello%F0%9F%98%8F",
  "hello%F0%9F%98%90",
  "hello%F0%9F%98%91",
  // Test 16-byte boundary cases
  "1234567890123456%20", // % at byte 16
  "123456789012345%20a", // % at byte 15
  "12345678901234%20ab", // % at byte 14
  "1234567890123%20abc", // % at byte 13
  "123456789012%20abcd", // % at byte 12
  "12345678901%20abcde", // % at byte 11
  "1234567890%20abcdef", // % at byte 10
  "123456789%20abcdefg", // % at byte 9
  "12345678%20abcdefgh", // % at byte 8
  "1234567%20abcdefghi", // % at byte 7
  "123456%20abcdefghij", // % at byte 6
  "12345%20abcdefghijk", // % at byte 5
  "1234%20abcdefghijkl", // % at byte 4
  "123%20abcdefghijklm", // % at byte 3
  "12%20abcdefghijklmn", // % at byte 2
  "1%20abcdefghijklmno", // % at byte 1
  "%20abcdefghijklmnop", // % at byte 0
  "1234567890123456%20abcd", // Multiple of 16 before %
  "12345678901234567890%20", // Multiple of 16 + 4 before %
  "123456789012345678901234567890%20", // Multiple of 16 + 14 before %

  // Additional boundary tests with different encoded characters
  "1234567890123456%2B", // + at boundary
  "1234567890123456%3D", // = at boundary
  "1234567890123456%2F", // / at boundary
  "1234567890123456%3F", // ? at boundary
  "1234567890123456%26", // & at boundary

  // Multiple percent encodings near boundaries
  "12345678901234%20%20", // Two spaces at boundary
  "1234567890123%20%20a", // Two spaces near boundary
  "123456789012%20%20ab", // Two spaces near boundary

  // UTF-8 multi-byte sequences at boundaries
  "1234567890123456%F0%9F%98%80", // Emoji at boundary
  "12345678901234%F0%9F%98%80ab", // Emoji near boundary
  "123456789012%F0%9F%98%80abcd", // Emoji near boundary

  // Mixed ASCII and encoded characters
  "1234567890123456%20ABC%20",
  "1234567890123456%20%F0%9F%98%80",
  "12345678901234%20%F0%9F%98%80ab",

  // Multiple boundaries in sequence
  "1234567890123456%201234567890123456%20",
  "1234567890123456%201234567890123456%2B",
  "1234567890123456%201234567890123456%3D",

  // Testing with different encoded characters at boundaries
  "1234567890123456%251234567890123456%24",
  "1234567890123456%261234567890123456%23",
  "1234567890123456%271234567890123456%22",

  // Testing with invalid sequences at boundaries
  "1234567890123456%", // Incomplete percent encoding at boundary
  "1234567890123456%2", // Incomplete percent encoding at boundary
  "1234567890123456%G0", // Invalid hex digit at boundary

  // Testing with multiple encodings in quick succession
  "12345678901234%20%20%20%20",
  "1234567890123%20%20%20%20a",
  "123456789012%20%20%20%20ab",

  // Testing with mixed valid and invalid sequences
  "1234567890123456%20%GG%20",
  "1234567890123456%20%%20",
  "1234567890123456%20%2%20",

  // Testing boundaries with special characters
  "1234567890123456%0A", // newline
  "1234567890123456%0D", // carriage return
  "1234567890123456%09", // tab

  // Testing with URL-specific characters
  "1234567890123456%3A%2F%2F", // ://
  "1234567890123456%3F%3D%26", // ?=&
  "1234567890123456%23%40%21", // #@!

  // Testing with multiple boundaries and mixed content
  "1234567890123456%201234567890123456%F0%9F%98%80",
  "1234567890123456%2B1234567890123456%20%F0%9F%98%80",
  "1234567890123456%3D1234567890123456%20ABC%20",

  // Edge cases with repeated patterns
  "1234567890123456%20%20%20%201234567890123456%20%20%20%20",
  "1234567890123456%25%25%25%251234567890123456%25%25%25%25",
  "1234567890123456%2B%2B%2B%2B1234567890123456%2B%2B%2B%2B",
];

// Additional test cases for production quality URI component decoder
const additionalInputs = [
  // 1. Invalid UTF-8 Sequences

  // Incomplete UTF-8 sequences
  "%E2%82", // Incomplete euro symbol
  "%F0%90", // Incomplete 4-byte sequence
  "%C2", // Incomplete 2-byte sequence

  // Overlong encodings
  "%C0%AF", // Overlong '/' (should be %2F)
  "%E0%80%AF", // Overlong '/' (3-byte)
  "%F0%80%80%AF", // Overlong '/' (4-byte)

  // Invalid UTF-8 continuation bytes
  "%C2%C0", // Invalid continuation
  "%E2%82%C0", // Invalid continuation in 3-byte sequence
  "%F0%90%80%C0", // Invalid continuation in 4-byte sequence

  // UTF-16 surrogate halves encoded in UTF-8
  "%ED%A0%80", // Lead surrogate U+D800
  "%ED%BE%80", // Trail surrogate U+DFFF
  "%ED%A0%80%ED%B0%80", // Surrogate pair encoded in UTF-8

  // 2. Memory and Buffer Edge Cases

  // SIMD boundary alignment
  "a".repeat(15) + "%20", // 15 chars + encoded char
  "a".repeat(16) + "%20", // 16 chars + encoded char
  "a".repeat(31) + "%20", // 31 chars + encoded char
  "a".repeat(32) + "%20", // 32 chars + encoded char

  // Large strings
  "a".repeat(1024) + "%20" + "b".repeat(1024),
  "%20".repeat(1000), // Many encoded characters
  ("a".repeat(15) + "%20").repeat(100), // Repeating pattern at SIMD boundary

  // StringBuilder reallocation
  "%F0%9F%98%80".repeat(1000), // Many emoji forcing StringBuilder growth

  // 3. Malformed Percent Encodings

  // Missing digits
  "%",
  "%%",
  "%2",
  "hello%",
  "hello%2",

  // Invalid hex digits
  "%0G",
  "%G0",
  "%GG",
  "%00%0G",

  // Mixed case hex digits
  "%2f",
  "%2F",
  "%2a",
  "%2A",

  // Multiple % characters
  "%%%",
  "%%%%",
  "%2%3",
  "%25%25",

  // 4. Special Cases

  // Mixed valid and invalid sequences
  "valid%20invalid%GGvalid%20",
  "%20%FF%20",

  // Boundary conditions with valid/invalid sequences
  "a".repeat(15) + "%GG",
  "a".repeat(16) + "%GG",
  "a".repeat(31) + "%GG",

  // Edge cases around StringBuilder capacity
  ("valid%20" + "a".repeat(60)).repeat(100),

  // UTF-8 edge cases
  "%F4%8F%BF%BF", // U+10FFFF (highest valid codepoint)
  "%F4%90%80%80", // Above U+10FFFF (invalid)

  // Complex mixed scenarios
  "hello%20%E2%82%AC%F0%9F%98%80world", // ASCII + space + euro + emoji
  "%E2%82%AC".repeat(100) + "%F0%9F%98%80".repeat(100), // Alternating 3-byte and 4-byte sequences
];

describe("decodeURIComponentSIMD", () => {
  for (const input of inputs) {
    it(`should decode ${input}`, () => {
      const encoded = encodeURIComponent(input);
      const decoded = decodeURIComponentSIMD(encoded);
      expect(decoded).toBe(decodeURIComponent(encoded));
    });
  }
});

describe("decodeURIComponentSIMD - Additional Tests", () => {
  // Test error handling
  for (const input of additionalInputs) {
    it(`should handle ${input} without crashing`, () => {
      try {
        const decoded = decodeURIComponentSIMD(input);
        // Some inputs are invalid, but shouldn't crash
        if (decoded !== undefined) {
          // For valid inputs, compare with native implementation
          try {
            const expected = decodeURIComponent(input);
            expect(decoded).toBe(expected);
          } catch (e) {
            // Native implementation threw, our implementation should too
            expect(() => decodeURIComponentSIMD(input)).toThrow();
          }
        }
      } catch (e) {
        // If it throws, make sure native implementation also throws
        expect(() => decodeURIComponent(input)).toThrow();
      }
    });
  }
});

describe("decodeURIComponentSIMD edge cases", () => {
  it("should handle cursor advancement correctly with invalid hex", () => {
    // This test would fail because of the cursor advancement bug
    // When it sees %GG, it only advances by 1 instead of 3, causing
    // the GG to be treated as literal characters
    expect(decodeURIComponentSIMD("%GG%20test")).toBe(String.fromCodePoint(0xfffd) + " " + "test");
  });

  it("should handle multiple invalid sequences consecutively", () => {
    // Similar cursor advancement issue
    expect(decodeURIComponentSIMD("%ZZ%XX%YY")).toBe(String.fromCodePoint(0xfffd).repeat(3));
  });

  it("should handle incomplete sequences at SIMD boundaries", () => {
    // Create a string that puts a % character right at the SIMD boundary
    // then follow it with invalid hex digits
    const prefix = "a".repeat(15); // 15 bytes to align the % at boundary
    expect(decodeURIComponentSIMD(prefix + "%GG")).toBe(prefix + String.fromCodePoint(0xfffd));
  });

  it("should handle mixed valid/invalid sequences at SIMD boundaries", () => {
    // This combines SIMD boundary alignment with the cursor advancement bug
    const prefix = "a".repeat(15);
    expect(decodeURIComponentSIMD(prefix + "%GG%20%HH%20")).toBe(
      prefix + String.fromCodePoint(0xfffd) + " " + String.fromCodePoint(0xfffd) + " ",
    );
  });

  it("should handle large sequences of invalid encodings", () => {
    // This would really expose the cursor advancement issue
    const input = "%GG".repeat(1000);
    // it should be full of unicode replacement characters
    expect(decodeURIComponentSIMD(input).length).toBe(String.fromCodePoint(0xfffd).repeat(1000).length);
  });

  it("should handle invalid sequences followed by valid UTF-8", () => {
    // This combines the cursor advancement bug with UTF-8 decoding
    expect(decodeURIComponentSIMD("%GG%F0%9F%98%80")).toBe(
      // replacement + replacement + smiley
      String.fromCodePoint(0xfffd) + "😀",
    );
  });
});
