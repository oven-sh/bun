import { describe, expect, it } from "bun:test";

describe("TextDecoder Shift_JIS", () => {
  it("should support various Shift_JIS labels", () => {
    const labels = ["shift_jis", "shift-jis", "sjis", "ms_kanji", "ms932", "windows-31j", "x-sjis", "csshiftjis"];
    
    for (const label of labels) {
      const decoder = new TextDecoder(label);
      expect(decoder.encoding).toBe("shift_jis");
    }
  });

  it("should decode ASCII characters correctly", () => {
    const decoder = new TextDecoder("shift_jis");
    const bytes = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
    const result = decoder.decode(bytes);
    expect(result).toBe("Hello");
  });

  it("should decode JIS X 0201 katakana characters", () => {
    const decoder = new TextDecoder("shift_jis");
    
    // Half-width katakana characters (0xA1-0xDF range)
    const bytes = new Uint8Array([0xB1, 0xB2, 0xB3]); // ｱｲｳ (katakana a, i, u)
    const result = decoder.decode(bytes);
    expect(result).toBe("ｱｲｳ");
  });

  it("should decode double-byte hiragana characters", () => {
    const decoder = new TextDecoder("shift_jis");
    
    // あいう (hiragana a, i, u)
    const bytes = new Uint8Array([0x82, 0xA0, 0x82, 0xA2, 0x82, 0xA4]);
    const result = decoder.decode(bytes);
    expect(result).toBe("あいう");
  });

  it("should decode double-byte kanji characters", () => {
    const decoder = new TextDecoder("shift_jis");
    
    // 日本 (Japan)
    const bytes = new Uint8Array([0x93, 0xFA, 0x96, 0x7B]);
    const result = decoder.decode(bytes);
    expect(result).toBe("日本");
  });

  it("should handle mixed ASCII, katakana, and kanji", () => {
    const decoder = new TextDecoder("shift_jis");
    
    // "Hello ｱｲｳ 日本"
    const bytes = new Uint8Array([
      0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, // "Hello "
      0xB1, 0xB2, 0xB3, 0x20,             // "ｱｲｳ "
      0x93, 0xFA, 0x96, 0x7B               // "日本"
    ]);
    const result = decoder.decode(bytes);
    expect(result).toBe("Hello ｱｲｳ 日本");
  });

  it("should handle invalid byte sequences with replacement character", () => {
    const decoder = new TextDecoder("shift_jis", { fatal: false });
    
    // Invalid sequences
    const bytes = new Uint8Array([0x81, 0x30, 0x82, 0xFF]);
    const result = decoder.decode(bytes);
    expect(result).toBe("\uFFFD0\uFFFD");
  });

  it("should throw on invalid sequences when fatal=true", () => {
    const decoder = new TextDecoder("shift_jis", { fatal: true });
    
    const bytes = new Uint8Array([0x81, 0x30]); // Invalid sequence
    expect(() => decoder.decode(bytes)).toThrow();
  });

  it("should handle streaming with incomplete sequences", () => {
    const decoder = new TextDecoder("shift_jis");
    
    // First chunk with incomplete double-byte sequence
    const chunk1 = new Uint8Array([0x82]); // Lead byte only
    const result1 = decoder.decode(chunk1, { stream: true });
    expect(result1).toBe(""); // Should buffer the lead byte
    
    // Second chunk completes the sequence
    const chunk2 = new Uint8Array([0xA0]); // あ
    const result2 = decoder.decode(chunk2);
    expect(result2).toBe("あ");
  });

  it("should handle streaming with flush on incomplete sequence", () => {
    const decoder = new TextDecoder("shift_jis", { fatal: false });
    
    // Incomplete sequence
    const chunk = new Uint8Array([0x82]); // Lead byte only
    decoder.decode(chunk, { stream: true });
    
    // Flush should emit replacement character
    const result = decoder.decode();
    expect(result).toBe("\uFFFD");
  });

  it("should handle streaming with fatal=true on incomplete sequence", () => {
    const decoder = new TextDecoder("shift_jis", { fatal: true });
    
    const chunk = new Uint8Array([0x82]); // Lead byte only
    decoder.decode(chunk, { stream: true });
    
    // Flush should throw error
    expect(() => decoder.decode()).toThrow();
  });

  it("should decode empty buffer correctly", () => {
    const decoder = new TextDecoder("shift_jis");
    const result = decoder.decode(new Uint8Array([]));
    expect(result).toBe("");
  });

  it("should handle null byte (0x00)", () => {
    const decoder = new TextDecoder("shift_jis");
    const bytes = new Uint8Array([0x00]);
    const result = decoder.decode(bytes);
    expect(result).toBe("\x00");
  });

  it("should handle byte 0x80", () => {
    const decoder = new TextDecoder("shift_jis");
    const bytes = new Uint8Array([0x80]);
    const result = decoder.decode(bytes);
    expect(result).toBe("\x80");
  });

  it("should handle private use area characters", () => {
    const decoder = new TextDecoder("shift_jis");
    
    // This should map to private use area based on the pointer range 8836-10715
    // Using lead byte 0xF0 and trail byte 0x40 as an example
    const bytes = new Uint8Array([0xF0, 0x40]);
    const result = decoder.decode(bytes);
    // Should not throw and should produce some valid character
    expect(result.length).toBeGreaterThan(0);
  });

  it("should be case insensitive for encoding labels", () => {
    const decoder1 = new TextDecoder("SHIFT_JIS");
    const decoder2 = new TextDecoder("shift_jis");
    const decoder3 = new TextDecoder("Shift_JIS");
    
    expect(decoder1.encoding).toBe("shift_jis");
    expect(decoder2.encoding).toBe("shift_jis");
    expect(decoder3.encoding).toBe("shift_jis");
  });

  it("should handle long text correctly", () => {
    const decoder = new TextDecoder("shift_jis");
    
    // Create a longer sequence mixing different character types
    const longBytes = [];
    
    // Add some ASCII
    for (let i = 0x41; i <= 0x5A; i++) { // A-Z
      longBytes.push(i);
    }
    
    // Add some katakana
    for (let i = 0xA1; i <= 0xDF; i++) {
      longBytes.push(i);
    }
    
    // Add some hiragana (double-byte)
    // あいうえお
    longBytes.push(0x82, 0xA0, 0x82, 0xA2, 0x82, 0xA4, 0x82, 0xA6, 0x82, 0xA8);
    
    const bytes = new Uint8Array(longBytes);
    const result = decoder.decode(bytes);
    
    // Should not throw and should produce reasonable length output
    expect(result.length).toBeGreaterThan(30);
    expect(result).toContain("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    expect(result).toContain("あいうえお");
  });

  it("should handle boundaries correctly", () => {
    const decoder = new TextDecoder("shift_jis");
    
    // Test boundary values
    const testCases = [
      [0x7F], // Last ASCII
      [0x81], // First lead byte (should produce error when flushed)
      [0x9F], // Last of first lead byte range
      [0xA0], // Just before katakana
      [0xA1], // First katakana
      [0xDF], // Last katakana  
      [0xE0], // First of second lead byte range
      [0xFC], // Last lead byte
      [0xFD], // First invalid
      [0xFF], // Last byte
    ];
    
    for (const testCase of testCases) {
      // Should not throw in non-fatal mode
      const result = decoder.decode(new Uint8Array(testCase));
      expect(typeof result).toBe("string");
    }
  });
});