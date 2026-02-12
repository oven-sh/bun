import { describe, expect, test } from "bun:test";

describe("Bun.sliceAnsi", () => {
  // ======================================================================
  // Basic functionality - plain strings (no ANSI)
  // ======================================================================

  describe("plain strings", () => {
    test("slices ASCII string like String.prototype.slice", () => {
      expect(Bun.sliceAnsi("hello world", 0, 5)).toBe("hello");
      expect(Bun.sliceAnsi("hello world", 6, 11)).toBe("world");
      expect(Bun.sliceAnsi("hello world", 0, 11)).toBe("hello world");
    });

    test("returns empty string for empty input", () => {
      expect(Bun.sliceAnsi("", 0, 5)).toBe("");
      expect(Bun.sliceAnsi("")).toBe("");
    });

    test("returns full string with no arguments beyond first", () => {
      expect(Bun.sliceAnsi("hello")).toBe("hello");
      expect(Bun.sliceAnsi("hello", 0)).toBe("hello");
    });

    test("start=0, end=0 returns empty", () => {
      expect(Bun.sliceAnsi("hello", 0, 0)).toBe("");
    });

    test("start > end returns empty", () => {
      expect(Bun.sliceAnsi("hello", 3, 1)).toBe("");
    });

    test("start beyond string length returns empty", () => {
      expect(Bun.sliceAnsi("hello", 100, 200)).toBe("");
    });

    test("end beyond string length returns remainder", () => {
      expect(Bun.sliceAnsi("hello", 3)).toBe("lo");
      expect(Bun.sliceAnsi("hello", 3, 100)).toBe("lo");
    });

    test("negative start", () => {
      expect(Bun.sliceAnsi("hello", -2)).toBe("lo");
      expect(Bun.sliceAnsi("hello", -5)).toBe("hello");
      expect(Bun.sliceAnsi("hello", -100)).toBe("hello");
    });

    test("negative end", () => {
      expect(Bun.sliceAnsi("hello", 0, -1)).toBe("hell");
      expect(Bun.sliceAnsi("hello", 0, -4)).toBe("h");
      expect(Bun.sliceAnsi("hello", 1, -1)).toBe("ell");
    });

    test("both negative", () => {
      expect(Bun.sliceAnsi("hello", -3, -1)).toBe("ll");
    });

    test("single character slice", () => {
      expect(Bun.sliceAnsi("hello", 0, 1)).toBe("h");
      expect(Bun.sliceAnsi("hello", 4, 5)).toBe("o");
    });
  });

  // ======================================================================
  // ANSI color codes - basic SGR
  // ======================================================================

  describe("ANSI color codes", () => {
    test("slices colored text, preserving ANSI codes at start", () => {
      const input = "\x1b[31mhello\x1b[39m";
      // Visible: "hello" (5 chars), ANSI codes are invisible
      expect(Bun.sliceAnsi(input, 0, 5)).toBe("\x1b[31mhello\x1b[39m");
      expect(Bun.sliceAnsi(input, 0, 3)).toBe("\x1b[31mhel");
      expect(Bun.sliceAnsi(input, 2, 5)).toBe("\x1b[31mllo\x1b[39m");
    });

    test("preserves active styles at slice start", () => {
      const input = "\x1b[31mhello world\x1b[39m";
      // Slicing from position 6 should re-emit the red color code
      expect(Bun.sliceAnsi(input, 6, 11)).toBe("\x1b[31mworld\x1b[39m");
    });

    test("multiple style codes", () => {
      const input = "\x1b[1m\x1b[31mbold red\x1b[39m\x1b[22m";
      // Slicing from middle should include both bold and red
      expect(Bun.sliceAnsi(input, 0, 4)).toBe("\x1b[1m\x1b[31mbold");
      expect(Bun.sliceAnsi(input, 5, 8)).toBe("\x1b[1m\x1b[31mred\x1b[39m\x1b[22m");
    });

    test("ANSI codes in the middle of slice are preserved", () => {
      const input = "he\x1b[31mll\x1b[39mo";
      expect(Bun.sliceAnsi(input, 0, 5)).toBe("he\x1b[31mll\x1b[39mo");
      expect(Bun.sliceAnsi(input, 1, 4)).toBe("e\x1b[31mll\x1b[39m");
    });

    test("style reset (code 0) clears active codes", () => {
      const input = "\x1b[31mred\x1b[0mnormal";
      // The \x1b[0m reset at position boundary clears styles. Since no styles
      // are active after reset, the slice starts clean without any style prefix.
      expect(Bun.sliceAnsi(input, 3, 9)).toBe("normal");
      // Verify the full slice still works
      expect(Bun.sliceAnsi(input, 0, 9)).toBe("\x1b[31mred\x1b[0mnormal");
      // Slicing within the red section preserves style
      expect(Bun.sliceAnsi(input, 0, 3)).toBe("\x1b[31mred\x1b[0m");
    });

    test("handles nested styles", () => {
      const input = "\x1b[1mbold \x1b[31mred\x1b[39m text\x1b[22m";
      // "bold " = 0-4, "red" = 5-7, " text" = 8-12
      expect(Bun.sliceAnsi(input, 5, 8)).toBe("\x1b[1m\x1b[31mred\x1b[39m");
    });
  });

  // ======================================================================
  // Full-width characters (CJK)
  // ======================================================================

  describe("full-width characters", () => {
    test("CJK characters count as width 2", () => {
      const input = "你好世界"; // 4 chars, width 8
      expect(Bun.sliceAnsi(input, 0, 2)).toBe("你");
      expect(Bun.sliceAnsi(input, 0, 4)).toBe("你好");
      expect(Bun.sliceAnsi(input, 2, 6)).toBe("好世");
      expect(Bun.sliceAnsi(input, 0, 8)).toBe("你好世界");
    });

    test("mixed ASCII and CJK", () => {
      const input = "a你b好c"; // widths: 1+2+1+2+1 = 7
      expect(Bun.sliceAnsi(input, 0, 1)).toBe("a");
      expect(Bun.sliceAnsi(input, 1, 3)).toBe("你");
      expect(Bun.sliceAnsi(input, 3, 4)).toBe("b");
      expect(Bun.sliceAnsi(input, 4, 6)).toBe("好");
      expect(Bun.sliceAnsi(input, 6, 7)).toBe("c");
    });

    test("colored CJK text", () => {
      const input = "\x1b[31m你好\x1b[39m世界";
      // "你好" at width 0-3, "世界" at width 4-7
      expect(Bun.sliceAnsi(input, 0, 4)).toBe("\x1b[31m你好\x1b[39m");
      expect(Bun.sliceAnsi(input, 4, 8)).toBe("世界");
      expect(Bun.sliceAnsi(input, 2, 6)).toBe("\x1b[31m好\x1b[39m世");
    });

    test("Japanese text", () => {
      const input = "日本語テスト"; // 6 chars, each width 2 = 12
      expect(Bun.sliceAnsi(input, 0, 4)).toBe("日本");
      expect(Bun.sliceAnsi(input, 4, 8)).toBe("語テ");
    });

    test("Korean text", () => {
      const input = "한국어"; // 3 chars, each width 2 = 6
      expect(Bun.sliceAnsi(input, 0, 2)).toBe("한");
      expect(Bun.sliceAnsi(input, 2, 4)).toBe("국");
      expect(Bun.sliceAnsi(input, 4, 6)).toBe("어");
    });
  });

  // ======================================================================
  // Emoji
  // ======================================================================

  describe("emoji", () => {
    test("basic emoji (width 2)", () => {
      const input = "👋hello";
      // 👋 = width 2, "hello" = width 5
      expect(Bun.sliceAnsi(input, 0, 2)).toBe("👋");
      expect(Bun.sliceAnsi(input, 2, 7)).toBe("hello");
    });

    test("emoji with skin tone modifier (width 2 as single grapheme)", () => {
      const input = "👋🏽hello";
      // 👋🏽 = width 2 (single grapheme), "hello" = width 5
      expect(Bun.sliceAnsi(input, 0, 2)).toBe("👋🏽");
      expect(Bun.sliceAnsi(input, 2, 7)).toBe("hello");
    });

    test("flag emoji (regional indicators, width 2)", () => {
      const input = "🇺🇸hello";
      // 🇺🇸 = width 2, "hello" = width 5
      expect(Bun.sliceAnsi(input, 0, 2)).toBe("🇺🇸");
      expect(Bun.sliceAnsi(input, 2, 7)).toBe("hello");
    });

    test("ZWJ sequence emoji (width 2)", () => {
      const input = "👨‍👩‍👧‍👦hello";
      // family emoji = width 2, "hello" = width 5
      expect(Bun.sliceAnsi(input, 0, 2)).toBe("👨‍👩‍👧‍👦");
      expect(Bun.sliceAnsi(input, 2, 7)).toBe("hello");
    });

    test("multiple emoji", () => {
      const input = "👋🎉🚀";
      // Each emoji width 2 = total 6
      expect(Bun.sliceAnsi(input, 0, 2)).toBe("👋");
      expect(Bun.sliceAnsi(input, 2, 4)).toBe("🎉");
      expect(Bun.sliceAnsi(input, 4, 6)).toBe("🚀");
    });

    test("colored emoji", () => {
      const input = "\x1b[31m👋\x1b[39mhello";
      expect(Bun.sliceAnsi(input, 0, 2)).toBe("\x1b[31m👋\x1b[39m");
      expect(Bun.sliceAnsi(input, 2, 7)).toBe("hello");
    });
  });

  // ======================================================================
  // Zero-width characters
  // ======================================================================

  describe("zero-width characters", () => {
    test("combining diacritical marks", () => {
      // "é" as e + combining acute (U+0301)
      const input = "e\u0301hello";
      // e+combining = width 1, "hello" = width 5
      expect(Bun.sliceAnsi(input, 0, 1)).toBe("e\u0301");
      expect(Bun.sliceAnsi(input, 1, 6)).toBe("hello");
    });

    test("zero-width joiner in text", () => {
      const input = "a\u200Bb"; // zero-width space between a and b
      // a = width 1, ZWS = width 0, b = width 1
      expect(Bun.sliceAnsi(input, 0, 1)).toBe("a");
    });
  });

  // ======================================================================
  // Various ANSI escape types
  // ======================================================================

  describe("various ANSI escape types", () => {
    test("background colors", () => {
      const input = "\x1b[41mhello\x1b[49m";
      expect(Bun.sliceAnsi(input, 0, 3)).toBe("\x1b[41mhel");
      expect(Bun.sliceAnsi(input, 3, 5)).toBe("\x1b[41mlo\x1b[49m");
    });

    test("256-color foreground", () => {
      const input = "\x1b[38;5;196mhello\x1b[39m";
      expect(Bun.sliceAnsi(input, 0, 3)).toBe("\x1b[38;5;196mhel");
      expect(Bun.sliceAnsi(input, 3, 5)).toBe("\x1b[38;5;196mlo\x1b[39m");
    });

    test("RGB color", () => {
      const input = "\x1b[38;2;255;0;0mhello\x1b[39m";
      expect(Bun.sliceAnsi(input, 0, 3)).toBe("\x1b[38;2;255;0;0mhel");
      expect(Bun.sliceAnsi(input, 3, 5)).toBe("\x1b[38;2;255;0;0mlo\x1b[39m");
    });

    test("cursor movement sequences are passed through", () => {
      // CSI sequences that aren't SGR should still be included in output
      const input = "\x1b[2Jhello";
      expect(Bun.sliceAnsi(input, 0, 5)).toBe("\x1b[2Jhello");
    });

    test("OSC hyperlink sequences", () => {
      const input = "\x1b]8;;https://example.com\x07hello\x1b]8;;\x07";
      expect(Bun.sliceAnsi(input, 0, 5)).toBe("\x1b]8;;https://example.com\x07hello\x1b]8;;\x07");
      expect(Bun.sliceAnsi(input, 0, 3)).toBe("\x1b]8;;https://example.com\x07hel");
    });
  });

  // ======================================================================
  // Edge cases
  // ======================================================================

  describe("edge cases", () => {
    test("string is only ANSI codes", () => {
      const input = "\x1b[31m\x1b[39m";
      expect(Bun.sliceAnsi(input, 0, 0)).toBe("");
      expect(Bun.sliceAnsi(input, 0, 5)).toBe("\x1b[31m\x1b[39m");
    });

    test("ANSI codes at beginning and end", () => {
      const input = "\x1b[1m\x1b[31mhello\x1b[39m\x1b[22m";
      expect(Bun.sliceAnsi(input, 0, 5)).toBe("\x1b[1m\x1b[31mhello\x1b[39m\x1b[22m");
    });

    test("multiple consecutive ANSI codes", () => {
      const input = "\x1b[1m\x1b[3m\x1b[31mhello\x1b[39m\x1b[23m\x1b[22m";
      expect(Bun.sliceAnsi(input, 0, 5)).toBe("\x1b[1m\x1b[3m\x1b[31mhello\x1b[39m\x1b[23m\x1b[22m");
      expect(Bun.sliceAnsi(input, 2, 5)).toBe("\x1b[1m\x1b[3m\x1b[31mllo\x1b[39m\x1b[23m\x1b[22m");
    });

    test("coerces non-string input to string", () => {
      expect(Bun.sliceAnsi(123 as any, 0, 2)).toBe("12");
      expect(Bun.sliceAnsi(true as any, 0, 2)).toBe("tr");
    });

    test("undefined and null start/end", () => {
      expect(Bun.sliceAnsi("hello", undefined, undefined)).toBe("hello");
      expect(Bun.sliceAnsi("hello", undefined, 3)).toBe("hel");
    });
  });

  // ======================================================================
  // Stress tests
  // ======================================================================

  describe("stress tests", () => {
    test("long string with scattered ANSI codes", () => {
      let input = "";
      for (let i = 0; i < 100; i++) {
        input += `\x1b[${31 + (i % 7)}m` + String.fromCharCode(65 + (i % 26));
      }
      input += "\x1b[0m";
      // Each visible char is 1 width, total 100
      const result = Bun.sliceAnsi(input, 10, 20);
      const stripped = Bun.stripANSI(result);
      expect(stripped.length).toBe(10);
    });

    test("string with many full-width characters", () => {
      const input = "你".repeat(500);
      // Total width = 1000
      const result = Bun.sliceAnsi(input, 100, 200);
      expect(Bun.stringWidth(result)).toBe(100);
      expect(result.length).toBe(50); // 50 CJK chars = 100 width
    });

    test("mixed content performance", () => {
      const input = "\x1b[31m" + "hello 你好 👋 ".repeat(100) + "\x1b[39m";
      const result = Bun.sliceAnsi(input, 0, 50);
      expect(Bun.stringWidth(result)).toBeLessThanOrEqual(50);
    });
  });

  // ======================================================================
  // Compatibility with Bun.stringWidth
  // ======================================================================

  describe("width consistency with Bun.stringWidth", () => {
    test("sliced width matches expected range", () => {
      const testCases = ["hello world", "\x1b[31mhello\x1b[39m world", "a\x1b[31mb\x1b[32mc\x1b[33md\x1b[0me"];

      for (const input of testCases) {
        const totalWidth = Bun.stringWidth(input);
        for (let start = 0; start < totalWidth; start++) {
          for (let end = start; end <= totalWidth; end++) {
            const sliced = Bun.sliceAnsi(input, start, end);
            const slicedWidth = Bun.stringWidth(sliced);
            expect(slicedWidth).toBeLessThanOrEqual(end - start);
          }
        }
      }
    });

    test("sliced width for wide chars does not exceed requested + 1", () => {
      // Full-width characters (CJK, emoji) can't be split, so a grapheme
      // of width 2 may be included when only 1 column was requested.
      // sliceAnsi includes the whole grapheme if any part falls in range.
      const wideTestCases = ["你好世界", "👋🎉🚀"];

      for (const input of wideTestCases) {
        const totalWidth = Bun.stringWidth(input);
        for (let start = 0; start < totalWidth; start += 2) {
          for (let end = start + 2; end <= totalWidth; end += 2) {
            const sliced = Bun.sliceAnsi(input, start, end);
            const slicedWidth = Bun.stringWidth(sliced);
            expect(slicedWidth).toBeLessThanOrEqual(end - start);
          }
        }
      }
    });

    test("concatenated slices cover the full string", () => {
      const inputs = ["hello world", "你好世界test", "\x1b[31mhello\x1b[39m \x1b[32mworld\x1b[39m"];

      for (const input of inputs) {
        const totalWidth = Bun.stringWidth(input);
        const mid = Math.floor(totalWidth / 2);
        const left = Bun.sliceAnsi(input, 0, mid);
        const right = Bun.sliceAnsi(input, mid, totalWidth);
        const leftStripped = Bun.stripANSI(left);
        const rightStripped = Bun.stripANSI(right);
        expect(leftStripped + rightStripped).toBe(Bun.stripANSI(input));
      }
    });
  });

  // ======================================================================
  // C1 control sequences
  // ======================================================================

  describe("C1 control sequences", () => {
    test("C1 CSI (0x9B)", () => {
      const input = "\x9b31mhello\x9b39m";
      expect(Bun.sliceAnsi(input, 0, 3)).toBe("\x9b31mhel");
    });

    test("C1 OSC (0x9D)", () => {
      const input = "\x9d8;;url\x9chello";
      expect(Bun.sliceAnsi(input, 0, 5)).toBe("\x9d8;;url\x9chello");
    });
  });

  // ======================================================================
  // Surrogate pairs
  // ======================================================================

  describe("surrogate pairs", () => {
    test("emoji that requires surrogate pairs", () => {
      const input = "a😀b";
      // a=1, 😀=2, b=1
      expect(Bun.sliceAnsi(input, 0, 1)).toBe("a");
      expect(Bun.sliceAnsi(input, 1, 3)).toBe("😀");
      expect(Bun.sliceAnsi(input, 3, 4)).toBe("b");
    });

    test("multiple surrogate pair characters", () => {
      const input = "😀😁😂";
      // Each width 2, total 6
      expect(Bun.sliceAnsi(input, 0, 2)).toBe("😀");
      expect(Bun.sliceAnsi(input, 2, 4)).toBe("😁");
      expect(Bun.sliceAnsi(input, 4, 6)).toBe("😂");
    });
  });

  // ======================================================================
  // Real-world scenarios
  // ======================================================================

  describe("real-world scenarios", () => {
    test("terminal progress bar", () => {
      const bar = "\x1b[32m████████\x1b[90m░░░░░░░░\x1b[39m 50%";
      // ████████ = 8, ░░░░░░░░ = 8, " 50%" = 4 = total 20
      const visible = Bun.sliceAnsi(bar, 0, 8);
      expect(Bun.stripANSI(visible)).toBe("████████");
    });

    test("colored log line", () => {
      const line = "\x1b[90m[2024-01-01]\x1b[39m \x1b[31mERROR\x1b[39m: Something broke";
      // [2024-01-01] = 12, " " = 1, ERROR = 5, ": Something broke" = 17
      // Slice just the timestamp
      const ts = Bun.sliceAnsi(line, 0, 12);
      expect(Bun.stripANSI(ts)).toBe("[2024-01-01]");
    });

    test("colored table cell truncation", () => {
      const cell = "\x1b[1m\x1b[36mLong column header\x1b[39m\x1b[22m";
      const truncated = Bun.sliceAnsi(cell, 0, 10);
      expect(Bun.stringWidth(truncated)).toBeLessThanOrEqual(10);
      expect(Bun.stripANSI(truncated)).toBe("Long colum");
    });
  });
});
