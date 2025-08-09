import { describe, expect, it } from "bun:test";

describe("TextDecoder Shift_JIS - Web Platform Tests", () => {
  describe("Label variants", () => {
    // Test all Shift JIS encoding labels from WPT
    const shiftJISLabels = [
      "shift_jis",
      "shift-jis", 
      "sjis",
      "csshiftjis",
      "ms932",
      "ms_kanji",
      "windows-31j",
      "x-sjis"
    ];

    it.each(shiftJISLabels)("should support label: %s", (label) => {
      const decoder = new TextDecoder(label);
      expect(decoder.encoding).toBe("shift_jis");
    });
  });

  describe("Character mappings from WPT", () => {
    // Test cases extracted from WPT sjis_chars test data
    // Format: [bytes_array, unicode_codepoint, expected_character, description]
    const testCases = [
      // ASCII range
      [[0x41], 65, "A", "LATIN CAPITAL LETTER A"],
      [[0x5A], 90, "Z", "LATIN CAPITAL LETTER Z"], 
      [[0x61], 97, "a", "LATIN SMALL LETTER A"],
      [[0x7A], 122, "z", "LATIN SMALL LETTER Z"],
      [[0x30], 48, "0", "DIGIT ZERO"],
      [[0x39], 57, "9", "DIGIT NINE"],
      
      // JIS X 0201 katakana range (0xA1-0xDF)
      [[0xA1], 0xFF61, "｡", "HALFWIDTH IDEOGRAPHIC FULL STOP"],
      [[0xA2], 0xFF62, "｢", "HALFWIDTH LEFT CORNER BRACKET"],
      [[0xA3], 0xFF63, "｣", "HALFWIDTH RIGHT CORNER BRACKET"],
      [[0xB1], 0xFF71, "ｱ", "HALFWIDTH KATAKANA LETTER A"],
      [[0xB2], 0xFF72, "ｲ", "HALFWIDTH KATAKANA LETTER I"],
      [[0xB3], 0xFF73, "ｳ", "HALFWIDTH KATAKANA LETTER U"],
      [[0xDF], 0xFF9F, "ﾟ", "HALFWIDTH KATAKANA SEMI-VOICED SOUND MARK"],

      // Double-byte hiragana characters
      [[0x82, 0xA0], 0x3042, "あ", "HIRAGANA LETTER A"],
      [[0x82, 0xA2], 0x3044, "い", "HIRAGANA LETTER I"],
      [[0x82, 0xA4], 0x3046, "う", "HIRAGANA LETTER U"],
      [[0x82, 0xA6], 0x3048, "え", "HIRAGANA LETTER E"],
      [[0x82, 0xA8], 0x304A, "お", "HIRAGANA LETTER O"],

      // Double-byte katakana characters (corrected from actual JIS table)
      [[0x83, 0x41], 0x30A2, "ア", "KATAKANA LETTER A"],
      [[0x83, 0x42], 0x30A3, "ィ", "KATAKANA LETTER SMALL I"],
      [[0x83, 0x43], 0x30A4, "イ", "KATAKANA LETTER I"],
      [[0x83, 0x44], 0x30A5, "ゥ", "KATAKANA LETTER SMALL U"],

      // Common kanji characters (corrected from actual JIS table)
      [[0x93, 0xFA], 0x65E5, "日", "CJK IDEOGRAPH (sun/day)"],
      [[0x96, 0x7B], 0x672C, "本", "CJK IDEOGRAPH (book/origin)"],
      [[0x90, 0xA2], 0x4E16, "世", "CJK IDEOGRAPH (world)"],
      [[0x8A, 0x79], 0x697D, "楽", "CJK IDEOGRAPH (pleasure/music)"],

      // Punctuation and symbols (corrected from actual JIS table)
      [[0x81, 0x40], 0x3000, "　", "IDEOGRAPHIC SPACE"],
      [[0x81, 0x41], 0x3001, "、", "IDEOGRAPHIC COMMA"],
      [[0x81, 0x42], 0x3002, "。", "IDEOGRAPHIC FULL STOP"],
      [[0x81, 0x8F], 0xFFE5, "￥", "FULLWIDTH YEN SIGN"],
      [[0x81, 0x90], 0xFF04, "＄", "FULLWIDTH DOLLAR SIGN"],
    ];

    it.each(testCases)("should decode bytes %p to %s (U+%s) - %s", (bytes, codepoint, expectedChar, description) => {
      const decoder = new TextDecoder("shift_jis");
      const uint8Array = new Uint8Array(bytes);
      const result = decoder.decode(uint8Array);
      
      expect(result).toBe(expectedChar);
      expect(result.codePointAt(0)).toBe(codepoint);
    });
  });

  describe("Multi-character sequences", () => {
    it("should decode mixed text correctly", () => {
      const decoder = new TextDecoder("shift_jis");
      
      // "Hello あいう 日本語"
      const bytes = new Uint8Array([
        // "Hello "
        0x48, 0x65, 0x6C, 0x6C, 0x6F, 0x20,
        // "あいう "  
        0x82, 0xA0, 0x82, 0xA2, 0x82, 0xA4, 0x20,
        // "日本"
        0x93, 0xFA, 0x96, 0x7B,
        // "語" (if supported)
        0x8C, 0xEA
      ]);
      
      const result = decoder.decode(bytes);
      expect(result).toContain("Hello ");
      expect(result).toContain("あいう ");  
      expect(result).toContain("日本");
    });

    it("should handle text with halfwidth katakana", () => {
      const decoder = new TextDecoder("shift_jis");
      
      // "ｱｲｳｴｵ" (halfwidth katakana vowels)
      const bytes = new Uint8Array([0xB1, 0xB2, 0xB3, 0xB4, 0xB5]);
      const result = decoder.decode(bytes);
      
      expect(result).toBe("ｱｲｳｴｵ");
    });
  });

  describe("Error handling from WPT", () => {
    it("should handle invalid lead bytes", () => {
      const decoder = new TextDecoder("shift_jis", { fatal: false });
      
      // Invalid bytes that should produce replacement characters
      const invalidBytes = [
        [0xFD], // Invalid single byte
        [0xFE], // Invalid single byte  
        [0xFF], // Invalid single byte
      ];

      invalidBytes.forEach(bytes => {
        const result = decoder.decode(new Uint8Array(bytes));
        expect(result).toBe("�");
      });
    });

    it("should handle invalid trail bytes", () => {
      const decoder = new TextDecoder("shift_jis", { fatal: false });
      
      // Valid lead byte with invalid trail byte
      const bytes = new Uint8Array([0x82, 0x3F]); // 0x3F is invalid trail
      const result = decoder.decode(bytes);
      
      // Should produce replacement character + prepended ASCII
      expect(result).toBe("�?");
    });

    it("should handle incomplete sequences at end of stream", () => {
      const decoder = new TextDecoder("shift_jis", { fatal: false });
      
      // Lead byte without trail byte
      const bytes = new Uint8Array([0x82]);
      const result = decoder.decode(bytes); // flush=true by default
      
      expect(result).toBe("�");
    });

    it("should throw in fatal mode for invalid sequences", () => {
      const decoder = new TextDecoder("shift_jis", { fatal: true });
      
      expect(() => {
        decoder.decode(new Uint8Array([0xFD]));
      }).toThrow();

      expect(() => {
        decoder.decode(new Uint8Array([0x82, 0x3F]));
      }).toThrow();
    });
  });

  describe("Streaming behavior", () => {
    it("should handle streaming decode correctly", () => {
      const decoder = new TextDecoder("shift_jis");
      
      // First chunk: incomplete double-byte sequence
      const chunk1 = new Uint8Array([0x82]); // Lead byte only
      const result1 = decoder.decode(chunk1, { stream: true });
      expect(result1).toBe(""); // Should buffer
      
      // Second chunk: complete the sequence  
      const chunk2 = new Uint8Array([0xA0]); // Trail byte for あ
      const result2 = decoder.decode(chunk2);
      expect(result2).toBe("あ");
    });

    it("should handle multiple streaming chunks", () => {
      const decoder = new TextDecoder("shift_jis");
      
      let result = "";
      
      // Stream "あいう" one byte at a time
      const bytes = [0x82, 0xA0, 0x82, 0xA2, 0x82, 0xA4];
      
      for (let i = 0; i < bytes.length; i++) {
        const chunk = new Uint8Array([bytes[i]]);
        const isLast = i === bytes.length - 1;
        result += decoder.decode(chunk, { stream: !isLast });
      }
      
      expect(result).toBe("あいう");
    });
  });

  describe("WPT edge cases", () => {
    it("should handle byte 0x80 correctly", () => {
      const decoder = new TextDecoder("shift_jis");
      const result = decoder.decode(new Uint8Array([0x80]));
      expect(result).toBe("\x80");
    });

    it("should handle null bytes", () => {
      const decoder = new TextDecoder("shift_jis");
      const result = decoder.decode(new Uint8Array([0x00]));
      expect(result).toBe("\x00");
    });

    it("should handle boundary bytes correctly", () => {
      const decoder = new TextDecoder("shift_jis");
      
      // Test boundary values from WPT
      const boundaryTests = [
        [[0x7F], "\x7F"], // Last ASCII
        [[0x81, 0x40], "　"], // First double-byte  
        [[0x9F, 0xFC], null], // Last of first lead range (may not be mapped)
        [[0xA0], "�"],        // Just before katakana (invalid)
        [[0xA1], "｡"],        // First katakana
        [[0xDF], "ﾟ"],        // Last katakana
        [[0xE0, 0x40], null], // First of second lead range (may not be mapped)
        [[0xFC, 0xFC], null], // Last possible double-byte (may not be mapped)
      ];

      boundaryTests.forEach(([bytes, expected]) => {
        if (expected !== null) {
          const result = decoder.decode(new Uint8Array(bytes));
          expect(result).toBe(expected);
        }
        // For null expected values, just ensure no crash occurs
        else {
          expect(() => {
            decoder.decode(new Uint8Array(bytes));
          }).not.toThrow();
        }
      });
    });
  });
});