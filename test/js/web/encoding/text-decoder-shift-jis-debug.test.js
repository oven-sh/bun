import { describe, expect, it } from "bun:test";

describe("TextDecoder Shift_JIS Debug", () => {
  it("should decode single hiragana あ correctly", () => {
    const decoder = new TextDecoder("shift_jis");
    
    // Test bytes for あ (hiragana a): 0x82, 0xA0
    const bytes = new Uint8Array([0x82, 0xA0]);
    const result = decoder.decode(bytes);
    
    console.log(`Input bytes: [0x${bytes[0].toString(16)}, 0x${bytes[1].toString(16)}]`);
    console.log(`Result: "${result}" (length: ${result.length})`);
    console.log(`Expected: "あ"`);
    console.log(`Character codes: ${Array.from(result).map(c => `U+${c.charCodeAt(0).toString(16).toUpperCase()}`).join(', ')}`);
    
    expect(result).toBe("あ");
  });

  it("should calculate correct pointer for あ", () => {
    // Manual calculation: 0x82, 0xA0
    // lead = 0x82, trail = 0xA0
    // leadOffset = (0x82 < 0xA0) ? 0x81 : 0xC1 = 0x81
    // offset = (0xA0 < 0x7F) ? 0x40 : 0x41 = 0x41
    // pointer = (0x82 - 0x81) * 188 + (0xA0 - 0x41) = 1 * 188 + 95 = 283
    
    const lead = 0x82;
    const trail = 0xA0;
    const leadOffset = lead < 0xA0 ? 0x81 : 0xC1;
    const offset = trail < 0x7F ? 0x40 : 0x41;
    const pointer = (lead - leadOffset) * 188 + (trail - offset);
    
    console.log(`Manual calculation:`);
    console.log(`  lead = 0x${lead.toString(16)}, trail = 0x${trail.toString(16)}`);
    console.log(`  leadOffset = ${leadOffset} (0x${leadOffset.toString(16)})`);
    console.log(`  offset = ${offset} (0x${offset.toString(16)})`);
    console.log(`  pointer = (${lead} - ${leadOffset}) * 188 + (${trail} - ${offset}) = ${pointer}`);
    
    expect(pointer).toBe(283);
  });
});