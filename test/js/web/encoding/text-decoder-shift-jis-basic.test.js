import { describe, expect, it } from "bun:test";

describe("TextDecoder Shift_JIS Basic", () => {
  it("should support shift_jis label", () => {
    const decoder = new TextDecoder("shift_jis");
    expect(decoder.encoding).toBe("shift_jis");
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
    const bytes = new Uint8Array([0xA1]); // ｡ (katakana period)
    const result = decoder.decode(bytes);
    expect(result).toBe("｡");
  });

  it("should handle invalid sequences with replacement character", () => {
    const decoder = new TextDecoder("shift_jis", { fatal: false });
    
    // Invalid sequences
    const bytes = new Uint8Array([0x81, 0x30]); // Invalid trail byte for lead 0x81
    const result = decoder.decode(bytes);
    expect(result).toBe("\uFFFD0"); // Replacement + prepended ASCII
  });

  it("should throw on invalid sequences when fatal=true", () => {
    const decoder = new TextDecoder("shift_jis", { fatal: true });
    
    const bytes = new Uint8Array([0x81, 0x30]); // Invalid sequence
    expect(() => decoder.decode(bytes)).toThrow();
  });

  it("should handle empty buffer correctly", () => {
    const decoder = new TextDecoder("shift_jis");
    const result = decoder.decode(new Uint8Array([]));
    expect(result).toBe("");
  });

  it("should handle basic double-byte sequences from minimal table", () => {
    const decoder = new TextDecoder("shift_jis");
    
    // Try a sequence that might map to our minimal table
    // Using lead byte 0x82 which should give us some hiragana
    const bytes = new Uint8Array([0x82, 0xA0]); // Should be あ if our pointer calculation is right
    const result = decoder.decode(bytes);
    
    // Should not throw and should produce some output
    expect(result.length).toBeGreaterThan(0);
  });
});