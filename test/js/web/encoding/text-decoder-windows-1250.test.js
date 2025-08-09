import { describe, expect, it } from "bun:test";

describe("TextDecoder windows-1250", () => {
  it("should support windows-1250 encoding", () => {
    const decoder = new TextDecoder("windows-1250");
    expect(decoder.encoding).toBe("windows-1250");
  });

  it("should support various windows-1250 aliases", () => {
    const aliases = ["windows-1250", "cp1250", "x-cp1250"];
    
    for (const alias of aliases) {
      const decoder = new TextDecoder(alias);
      expect(decoder.encoding).toBe("windows-1250");
    }
  });

  it("should decode ASCII text correctly", () => {
    const decoder = new TextDecoder("windows-1250");
    const input = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
    const result = decoder.decode(input);
    expect(result).toBe("Hello");
  });

  it("should decode windows-1250 specific characters", () => {
    const decoder = new TextDecoder("windows-1250");
    
    // Test some characteristic windows-1250 characters
    const testCases = [
      // Byte 0xA1 (161) -> U+02C7 (ˇ) - CARON
      { input: [0xA1], expected: "\u02C7" },
      // Byte 0xA3 (163) -> U+0141 (Ł) - LATIN CAPITAL LETTER L WITH STROKE
      { input: [0xA3], expected: "\u0141" },
      // Byte 0xA5 (165) -> U+0104 (Ą) - LATIN CAPITAL LETTER A WITH OGONEK
      { input: [0xA5], expected: "\u0104" },
      // Byte 0xB9 (185) -> U+0105 (ą) - LATIN SMALL LETTER A WITH OGONEK
      { input: [0xB9], expected: "\u0105" },
      // Byte 0xB3 (179) -> U+0142 (ł) - LATIN SMALL LETTER L WITH STROKE
      { input: [0xB3], expected: "\u0142" },
      // Byte 0xC0 (192) -> U+0154 (Ŕ) - LATIN CAPITAL LETTER R WITH ACUTE
      { input: [0xC0], expected: "\u0154" },
      // Byte 0xE0 (224) -> U+0155 (ŕ) - LATIN SMALL LETTER R WITH ACUTE
      { input: [0xE0], expected: "\u0155" },
    ];

    for (const { input, expected } of testCases) {
      const result = decoder.decode(new Uint8Array(input));
      expect(result).toBe(expected);
    }
  });

  it("should decode mixed ASCII and windows-1250 text", () => {
    const decoder = new TextDecoder("windows-1250");
    // "Hello Łąkę" in windows-1250 encoding
    const input = new Uint8Array([
      0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, // "Hello "
      0xA3, 0xB9, 0x6b, 0xEA // "Łąkę"
    ]);
    const result = decoder.decode(input);
    expect(result).toBe("Hello Łąkę");
  });

  it("should handle empty input", () => {
    const decoder = new TextDecoder("windows-1250");
    expect(decoder.decode(new Uint8Array())).toBe("");
    expect(decoder.decode()).toBe("");
  });

  it("should handle all bytes from 128-255", () => {
    const decoder = new TextDecoder("windows-1250");
    
    // Test a few key mappings to ensure our lookup table is correct
    const specificMappings = {
      0x80: 0x20AC, // Euro sign
      0x8A: 0x0160, // Latin capital letter S with caron
      0x8C: 0x015A, // Latin capital letter S with acute
      0x8D: 0x0164, // Latin capital letter T with caron
      0x8E: 0x017D, // Latin capital letter Z with caron
      0x8F: 0x0179, // Latin capital letter Z with acute
      0x9A: 0x0161, // Latin small letter s with caron
      0x9C: 0x015B, // Latin small letter s with acute
      0x9D: 0x0165, // Latin small letter t with caron
      0x9E: 0x017E, // Latin small letter z with caron
      0x9F: 0x017A, // Latin small letter z with acute
      0xFF: 0x02D9, // Dot above
    };

    for (const [byte, expectedCodePoint] of Object.entries(specificMappings)) {
      const result = decoder.decode(new Uint8Array([parseInt(byte)]));
      const expectedChar = String.fromCharCode(expectedCodePoint);
      expect(result).toBe(expectedChar);
    }
  });

  it("should handle streaming with { stream: true }", () => {
    const decoder = new TextDecoder("windows-1250");
    
    // Test streaming decode
    const part1 = new Uint8Array([0x48, 0x65, 0x6c]); // "Hel"
    const part2 = new Uint8Array([0x6c, 0x6f, 0x20]); // "lo "
    const part3 = new Uint8Array([0xA3, 0xB9]); // "Łą"
    
    let result = decoder.decode(part1, { stream: true });
    result += decoder.decode(part2, { stream: true });
    result += decoder.decode(part3);
    
    expect(result).toBe("Hello Łą");
  });

  it("should work with fatal: true option", () => {
    const decoder = new TextDecoder("windows-1250", { fatal: true });
    
    // windows-1250 should handle all byte values, so no errors expected
    const input = new Uint8Array([0x80, 0x90, 0xA0, 0xB0, 0xC0, 0xD0, 0xE0, 0xF0]);
    expect(() => decoder.decode(input)).not.toThrow();
  });

  it("should handle long strings efficiently", () => {
    const decoder = new TextDecoder("windows-1250");
    
    // Create a long string with mixed ASCII and windows-1250 characters
    const longInput = new Uint8Array(1000);
    for (let i = 0; i < 1000; i++) {
      // Alternate between ASCII and windows-1250 specific chars
      longInput[i] = i % 2 === 0 ? 0x41 : 0xA3; // 'A' or 'Ł'
    }
    
    const result = decoder.decode(longInput);
    expect(result.length).toBe(1000);
    expect(result[0]).toBe('A');
    expect(result[1]).toBe('Ł');
    expect(result[998]).toBe('A');
    expect(result[999]).toBe('Ł');
  });

  it("should handle TypedArray variants", () => {
    const decoder = new TextDecoder("windows-1250");
    const testBytes = [0x48, 0x65, 0x6c, 0x6c, 0x6f, 0xA3]; // "HelloŁ"
    
    const typedArrays = [
      new Uint8Array(testBytes),
      new Int8Array(testBytes),
      new Uint8ClampedArray(testBytes),
    ];
    
    for (const array of typedArrays) {
      const result = decoder.decode(array);
      expect(result).toBe("HelloŁ");
    }
  });

  it("should match Node.js behavior for windows-1250 characters", () => {
    const decoder = new TextDecoder("windows-1250");
    
    // Common Polish characters that are characteristic of windows-1250
    const polishText = new Uint8Array([
      0x5A, 0x69, 0xEA, 0x62, 0x61, 0x20, // "Zięba " (finch) - 0x69 = i, 0xEA = ę
      0xF3, 0xB3, 0x74, 0x79 // "ółty" (yellow) - 0xF3 = ó, 0xB3 = ł
    ]);
    
    const result = decoder.decode(polishText);
    expect(result).toBe("Zięba ółty");
  });
});