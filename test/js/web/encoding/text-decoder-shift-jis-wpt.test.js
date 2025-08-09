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
      "x-sjis",
    ];

    it.each(shiftJISLabels)("should support label: %s", label => {
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
      [[0x5a], 90, "Z", "LATIN CAPITAL LETTER Z"],
      [[0x61], 97, "a", "LATIN SMALL LETTER A"],
      [[0x7a], 122, "z", "LATIN SMALL LETTER Z"],
      [[0x30], 48, "0", "DIGIT ZERO"],
      [[0x39], 57, "9", "DIGIT NINE"],

      // JIS X 0201 katakana range (0xA1-0xDF)
      [[0xa1], 0xff61, "｡", "HALFWIDTH IDEOGRAPHIC FULL STOP"],
      [[0xa2], 0xff62, "｢", "HALFWIDTH LEFT CORNER BRACKET"],
      [[0xa3], 0xff63, "｣", "HALFWIDTH RIGHT CORNER BRACKET"],
      [[0xb1], 0xff71, "ｱ", "HALFWIDTH KATAKANA LETTER A"],
      [[0xb2], 0xff72, "ｲ", "HALFWIDTH KATAKANA LETTER I"],
      [[0xb3], 0xff73, "ｳ", "HALFWIDTH KATAKANA LETTER U"],
      [[0xdf], 0xff9f, "ﾟ", "HALFWIDTH KATAKANA SEMI-VOICED SOUND MARK"],

      // Double-byte hiragana characters
      [[0x82, 0xa0], 0x3042, "あ", "HIRAGANA LETTER A"],
      [[0x82, 0xa2], 0x3044, "い", "HIRAGANA LETTER I"],
      [[0x82, 0xa4], 0x3046, "う", "HIRAGANA LETTER U"],
      [[0x82, 0xa6], 0x3048, "え", "HIRAGANA LETTER E"],
      [[0x82, 0xa8], 0x304a, "お", "HIRAGANA LETTER O"],

      // Double-byte katakana characters (corrected from actual JIS table)
      [[0x83, 0x41], 0x30a2, "ア", "KATAKANA LETTER A"],
      [[0x83, 0x42], 0x30a3, "ィ", "KATAKANA LETTER SMALL I"],
      [[0x83, 0x43], 0x30a4, "イ", "KATAKANA LETTER I"],
      [[0x83, 0x44], 0x30a5, "ゥ", "KATAKANA LETTER SMALL U"],

      // Common kanji characters (corrected from actual JIS table)
      [[0x93, 0xfa], 0x65e5, "日", "CJK IDEOGRAPH (sun/day)"],
      [[0x96, 0x7b], 0x672c, "本", "CJK IDEOGRAPH (book/origin)"],
      [[0x90, 0xa2], 0x4e16, "世", "CJK IDEOGRAPH (world)"],
      [[0x8a, 0x79], 0x697d, "楽", "CJK IDEOGRAPH (pleasure/music)"],

      // Punctuation and symbols (corrected from actual JIS table)
      [[0x81, 0x40], 0x3000, "　", "IDEOGRAPHIC SPACE"],
      [[0x81, 0x41], 0x3001, "、", "IDEOGRAPHIC COMMA"],
      [[0x81, 0x42], 0x3002, "。", "IDEOGRAPHIC FULL STOP"],
      [[0x81, 0x8f], 0xffe5, "￥", "FULLWIDTH YEN SIGN"],
      [[0x81, 0x90], 0xff04, "＄", "FULLWIDTH DOLLAR SIGN"],
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
        0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20,
        // "あいう "
        0x82, 0xa0, 0x82, 0xa2, 0x82, 0xa4, 0x20,
        // "日本"
        0x93, 0xfa, 0x96, 0x7b,
        // "語" (if supported)
        0x8c, 0xea,
      ]);

      const result = decoder.decode(bytes);
      expect(result).toContain("Hello ");
      expect(result).toContain("あいう ");
      expect(result).toContain("日本");
    });

    it("should handle text with halfwidth katakana", () => {
      const decoder = new TextDecoder("shift_jis");

      // "ｱｲｳｴｵ" (halfwidth katakana vowels)
      const bytes = new Uint8Array([0xb1, 0xb2, 0xb3, 0xb4, 0xb5]);
      const result = decoder.decode(bytes);

      expect(result).toBe("ｱｲｳｴｵ");
    });
  });

  describe("Error handling from WPT", () => {
    it("should handle invalid lead bytes", () => {
      const decoder = new TextDecoder("shift_jis", { fatal: false });

      // Invalid bytes that should produce replacement characters
      const invalidBytes = [
        [0xfd], // Invalid single byte
        [0xfe], // Invalid single byte
        [0xff], // Invalid single byte
      ];

      invalidBytes.forEach(bytes => {
        const result = decoder.decode(new Uint8Array(bytes));
        expect(result).toBe("�");
      });
    });

    it("should handle invalid trail bytes", () => {
      const decoder = new TextDecoder("shift_jis", { fatal: false });

      // Valid lead byte with invalid trail byte
      const bytes = new Uint8Array([0x82, 0x3f]); // 0x3F is invalid trail
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
        decoder.decode(new Uint8Array([0xfd]));
      }).toThrow();

      expect(() => {
        decoder.decode(new Uint8Array([0x82, 0x3f]));
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
      const chunk2 = new Uint8Array([0xa0]); // Trail byte for あ
      const result2 = decoder.decode(chunk2);
      expect(result2).toBe("あ");
    });

    it("should handle multiple streaming chunks", () => {
      const decoder = new TextDecoder("shift_jis");

      let result = "";

      // Stream "あいう" one byte at a time
      const bytes = [0x82, 0xa0, 0x82, 0xa2, 0x82, 0xa4];

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
        [[0x7f], "\x7F"], // Last ASCII
        [[0x81, 0x40], "　"], // First double-byte
        [[0x9f, 0xfc], null], // Last of first lead range (may not be mapped)
        [[0xa0], "�"], // Just before katakana (invalid)
        [[0xa1], "｡"], // First katakana
        [[0xdf], "ﾟ"], // Last katakana
        [[0xe0, 0x40], null], // First of second lead range (may not be mapped)
        [[0xfc, 0xfc], null], // Last possible double-byte (may not be mapped)
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
