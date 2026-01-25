import { describe, expect, test } from "bun:test";
import npmStringWidth from "string-width";

expect.extend({
  toMatchNPMStringWidth(received: string) {
    const width = npmStringWidth(received, { countAnsiEscapeCodes: true });
    const bunWidth = Bun.stringWidth(received, { countAnsiEscapeCodes: true });
    const pass = width === bunWidth;
    const message = () => `expected ${received} to have npm string width ${width} but got ${bunWidth}`;
    return { pass, message };
  },
  toMatchNPMStringWidthExcludeANSI(received: string) {
    const width = npmStringWidth(received, { countAnsiEscapeCodes: false });
    const bunWidth = Bun.stringWidth(received, { countAnsiEscapeCodes: false });
    const pass = width === bunWidth;
    const message = () => `expected ${received} to have npm string width ${width} but got ${bunWidth}`;
    return { pass, message };
  },
});

test("stringWidth", () => {
  expect(undefined).toMatchNPMStringWidth();
  expect("").toMatchNPMStringWidth();
  expect("a").toMatchNPMStringWidth();
  expect("ab").toMatchNPMStringWidth();
  expect("abc").toMatchNPMStringWidth();
  expect("😀").toMatchNPMStringWidth();
  expect("😀😀").toMatchNPMStringWidth();
  expect("😀😀😀").toMatchNPMStringWidth();
  expect("😀😀😀😀").toMatchNPMStringWidth();
  expect("😀😀😀😀😀").toMatchNPMStringWidth();
  expect("😀😀😀😀😀😀").toMatchNPMStringWidth();
  expect("😀😀😀😀😀😀😀").toMatchNPMStringWidth();
  expect("😀😀😀😀😀😀😀😀").toMatchNPMStringWidth();
  expect("😀😀😀😀😀😀😀😀😀").toMatchNPMStringWidth();
  expect("😀😀😀😀😀😀😀😀😀😀").toMatchNPMStringWidth();
});

for (let matcher of ["toMatchNPMStringWidth", "toMatchNPMStringWidthExcludeANSI"]) {
  describe(matcher, () => {
    test("ansi colors", () => {
      expect("\u001b[31m")[matcher]();
      expect("\u001b[31ma")[matcher]();
      expect("\u001b[31mab")[matcher]();
      expect("\u001b[31mabc")[matcher]();
      expect("\u001b[31m😀")[matcher]();
      expect("\u001b[31m😀😀")[matcher]();
      expect("\u001b[31m😀😀😀")[matcher]();
      expect("\u001b[31m😀😀😀😀")[matcher]();
      expect("\u001b[31m😀😀😀😀😀")[matcher]();
      expect("\u001b[31m😀😀😀😀😀😀")[matcher]();
      expect("\u001b[31m😀😀😀😀😀😀😀")[matcher]();
      expect("\u001b[31m😀😀😀😀😀😀😀😀")[matcher]();
      expect("\u001b[31m😀😀😀😀😀😀😀😀😀")[matcher]();
      expect("\u001b[31m😀😀😀😀😀😀😀😀😀😀")[matcher]();

      expect("a\u001b[31m")[matcher]();
      expect("ab\u001b[31m")[matcher]();
      expect("abc\u001b[31m")[matcher]();
      expect("😀\u001b[31m")[matcher]();
      expect("😀😀\u001b[31m")[matcher]();
      expect("😀😀😀\u001b[31m")[matcher]();
      expect("😀😀😀😀\u001b[31m")[matcher]();
      expect("😀😀😀😀😀\u001b[31m")[matcher]();
      expect("😀😀😀😀😀😀\u001b[31m")[matcher]();
      expect("😀😀😀😀😀😀😀\u001b[31m")[matcher]();
      expect("😀😀😀😀😀😀😀😀\u001b[31m")[matcher]();
      expect("😀😀😀😀😀😀😀😀😀\u001b[31m")[matcher]();

      expect("a\u001b[31mb")[matcher]();
      expect("ab\u001b[31mc")[matcher]();
      expect("abc\u001b[31m😀")[matcher]();
      expect("😀\u001b[31m😀😀")[matcher]();
      expect("😀😀\u001b[31m😀😀😀")[matcher]();
      expect("😀😀😀\u001b[31m😀😀😀😀")[matcher]();
      expect("😀😀😀😀\u001b[31m😀😀😀😀😀")[matcher]();
      expect("😀😀😀😀😀\u001b[31m😀😀😀😀😀😀")[matcher]();
      expect("😀😀😀😀😀😀\u001b[31m😀😀😀😀😀😀😀")[matcher]();
      expect("😀😀😀😀😀😀😀\u001b[31m😀😀😀😀😀😀😀😀")[matcher]();
      expect("😀😀😀😀😀😀😀😀\u001b[31m😀😀😀😀😀😀😀😀😀")[matcher]();
    });
  });
}

for (let matcher of ["toMatchNPMStringWidth", "toMatchNPMStringWidthExcludeANSI"]) {
  test("leading non-ansi characters in UTF-16 string seems to fail", () => {
    expect("\x1b[31mhshh🌎")[matcher]();
    expect("a\x1b[31mhshh🌎")[matcher]();
    expect("a\x1b[31mhshh🌎a")[matcher]();
  });
}

for (let matcher of ["toMatchNPMStringWidth", "toMatchNPMStringWidthExcludeANSI"]) {
  test("upstream", () => {
    expect("abcde")[matcher]();
    expect("古池や")[matcher]();
    expect("あいうabc")[matcher]();
    expect("あいう★")[matcher]();
    expect("±")[matcher]();
    expect("ノード.js")[matcher]();
    expect("你好")[matcher]();
    expect("안녕하세요")[matcher]();
    expect("A\uD83C\uDE00BC")[matcher]();
    expect("\u001B[31m\u001B[39m")[matcher]();
    // expect("\u001B]8;;https://github.com\u0007Click\u001B]8;;\u0007")[matcher]();
    expect("\u{231A}")[matcher]();
    expect("\u{2194}\u{FE0F}")[matcher]();
    expect("\u{1F469}")[matcher]();
    expect("\u{1F469}\u{1F3FF}")[matcher]();
    expect("\u{845B}\u{E0100}")[matcher]();
    expect("ปฏัก")[matcher]();
    expect("_\u0E34")[matcher]();
    expect("\u001B[31m\u001B[39m")[matcher]();
  });
}

test("ambiguousIsNarrow=false", () => {
  for (let countAnsiEscapeCodes of [false, true]) {
    for (let string of ["⛣", "あいう★", "“"]) {
      const actual = Bun.stringWidth(string, { countAnsiEscapeCodes, ambiguousIsNarrow: false });
      expect(actual).toBe(npmStringWidth(string, { countAnsiEscapeCodes, ambiguousIsNarrow: false }));
    }
  }
});

for (let matcher of ["toMatchNPMStringWidth", "toMatchNPMStringWidthExcludeANSI"]) {
  test("ignores control characters", () => {
    expect(String.fromCodePoint(0))[matcher]();
    expect(String.fromCodePoint(31))[matcher]();
    expect(String.fromCodePoint(127))[matcher]();
    expect(String.fromCodePoint(134))[matcher]();
    expect(String.fromCodePoint(159))[matcher]();
    expect("\u001B")[matcher]();
  });
}

for (let matcher of ["toMatchNPMStringWidth", "toMatchNPMStringWidthExcludeANSI"]) {
  test("handles combining characters", () => {
    expect("x\u0300")[matcher]();
  });
}

for (let matcher of ["toMatchNPMStringWidth", "toMatchNPMStringWidthExcludeANSI"]) {
  test("handles ZWJ characters", () => {
    expect("👶")[matcher]();
    expect("👶🏽")[matcher]();
    expect("aa👶🏽aa")[matcher]();
    expect("👩‍👩‍👦‍👦")[matcher]();
    expect("👨‍❤️‍💋‍👨")[matcher]();
  });
}

// ============================================================================
// Extended tests for stringWidth edge cases
// These test exact expected values rather than comparing to npm string-width
// ============================================================================

describe("stringWidth extended", () => {
  describe("zero-width characters", () => {
    test("soft hyphen (U+00AD)", () => {
      expect(Bun.stringWidth("\u00AD")).toBe(0);
      expect(Bun.stringWidth("a\u00ADb")).toBe(2);
      expect(Bun.stringWidth("\u00AD\u00AD\u00AD")).toBe(0);
    });

    test("word joiner and invisible operators (U+2060-U+2064)", () => {
      expect(Bun.stringWidth("\u2060")).toBe(0); // Word joiner
      expect(Bun.stringWidth("\u2061")).toBe(0); // Function application
      expect(Bun.stringWidth("\u2062")).toBe(0); // Invisible times
      expect(Bun.stringWidth("\u2063")).toBe(0); // Invisible separator
      expect(Bun.stringWidth("\u2064")).toBe(0); // Invisible plus
      expect(Bun.stringWidth("a\u2060b")).toBe(2);
    });

    test("zero-width space/joiner/non-joiner (U+200B-U+200D)", () => {
      expect(Bun.stringWidth("\u200B")).toBe(0); // Zero-width space
      expect(Bun.stringWidth("\u200C")).toBe(0); // Zero-width non-joiner
      expect(Bun.stringWidth("\u200D")).toBe(0); // Zero-width joiner
      expect(Bun.stringWidth("a\u200Bb\u200Cc\u200Dd")).toBe(4);
    });

    test("LRM and RLM (U+200E-U+200F)", () => {
      expect(Bun.stringWidth("\u200E")).toBe(0); // Left-to-right mark
      expect(Bun.stringWidth("\u200F")).toBe(0); // Right-to-left mark
      expect(Bun.stringWidth("a\u200Eb\u200Fc")).toBe(3);
    });

    test("BOM / ZWNBSP (U+FEFF)", () => {
      expect(Bun.stringWidth("\uFEFF")).toBe(0);
      expect(Bun.stringWidth("\uFEFFhello")).toBe(5);
    });

    test("Arabic formatting characters", () => {
      expect(Bun.stringWidth("\u0600")).toBe(0); // Arabic number sign
      expect(Bun.stringWidth("\u0601")).toBe(0); // Arabic sign sanah
      expect(Bun.stringWidth("\u0602")).toBe(0); // Arabic footnote marker
      expect(Bun.stringWidth("\u0603")).toBe(0); // Arabic sign safha
      expect(Bun.stringWidth("\u0604")).toBe(0); // Arabic sign samvat
      expect(Bun.stringWidth("\u0605")).toBe(0); // Arabic number mark above
      expect(Bun.stringWidth("\u06DD")).toBe(0); // Arabic end of ayah
      expect(Bun.stringWidth("\u070F")).toBe(0); // Syriac abbreviation mark
      expect(Bun.stringWidth("\u08E2")).toBe(0); // Arabic disputed end of ayah
      expect(Bun.stringWidth("\u0600hello")).toBe(5);
    });

    test("variation selectors (U+FE00-U+FE0F)", () => {
      expect(Bun.stringWidth("\uFE00")).toBe(0);
      expect(Bun.stringWidth("\uFE0E")).toBe(0); // VS15 (text)
      expect(Bun.stringWidth("\uFE0F")).toBe(0); // VS16 (emoji)
    });

    test("tag characters (U+E0000-U+E007F)", () => {
      expect(Bun.stringWidth("\u{E0001}")).toBe(0); // Language tag
      expect(Bun.stringWidth("\u{E0020}")).toBe(0); // Tag space
      expect(Bun.stringWidth("\u{E007F}")).toBe(0); // Cancel tag
    });

    test("lone surrogates", () => {
      expect(Bun.stringWidth("\uD800")).toBe(0); // High surrogate
      expect(Bun.stringWidth("\uDBFF")).toBe(0); // High surrogate
      expect(Bun.stringWidth("\uDC00")).toBe(0); // Low surrogate
      expect(Bun.stringWidth("\uDFFF")).toBe(0); // Low surrogate
    });

    test("combining diacritical marks", () => {
      expect(Bun.stringWidth("\u0300")).toBe(0); // Combining grave
      expect(Bun.stringWidth("\u0301")).toBe(0); // Combining acute
      expect(Bun.stringWidth("e\u0301")).toBe(1); // é as e + combining acute
      expect(Bun.stringWidth("\u036F")).toBe(0); // Combining latin small letter x
    });

    test("combining diacritical marks extended", () => {
      expect(Bun.stringWidth("\u1AB0")).toBe(0);
      expect(Bun.stringWidth("\u1AFF")).toBe(0);
    });

    test("combining diacritical marks supplement", () => {
      expect(Bun.stringWidth("\u1DC0")).toBe(0);
      expect(Bun.stringWidth("\u1DFF")).toBe(0);
    });

    test("combining diacritical marks for symbols", () => {
      expect(Bun.stringWidth("\u20D0")).toBe(0);
      expect(Bun.stringWidth("\u20FF")).toBe(0);
    });

    test("combining half marks", () => {
      expect(Bun.stringWidth("\uFE20")).toBe(0);
      expect(Bun.stringWidth("\uFE2F")).toBe(0);
    });

    test("control characters", () => {
      expect(Bun.stringWidth("\x00")).toBe(0);
      expect(Bun.stringWidth("\x1F")).toBe(0);
      expect(Bun.stringWidth("\x7F")).toBe(0); // DEL
      expect(Bun.stringWidth("\x80")).toBe(0); // C1 control start
      expect(Bun.stringWidth("\x9F")).toBe(0); // C1 control end
    });
  });

  describe("CSI sequences (all final bytes)", () => {
    // CSI final bytes are 0x40-0x7E (@ through ~)
    test("cursor movement", () => {
      expect(Bun.stringWidth("a\x1b[5Ab")).toBe(2); // Cursor up
      expect(Bun.stringWidth("a\x1b[5Bb")).toBe(2); // Cursor down
      expect(Bun.stringWidth("a\x1b[5Cb")).toBe(2); // Cursor forward
      expect(Bun.stringWidth("a\x1b[5Db")).toBe(2); // Cursor back
      expect(Bun.stringWidth("a\x1b[5Eb")).toBe(2); // Cursor next line
      expect(Bun.stringWidth("a\x1b[5Fb")).toBe(2); // Cursor previous line
      expect(Bun.stringWidth("a\x1b[5Gb")).toBe(2); // Cursor horizontal absolute
    });

    test("cursor position", () => {
      expect(Bun.stringWidth("a\x1b[10;20Hb")).toBe(2); // Cursor position
      expect(Bun.stringWidth("a\x1b[10;20fb")).toBe(2); // Horizontal vertical position
    });

    test("erase functions", () => {
      expect(Bun.stringWidth("a\x1b[Jb")).toBe(2); // Erase in display
      expect(Bun.stringWidth("a\x1b[0Jb")).toBe(2); // Erase below
      expect(Bun.stringWidth("a\x1b[1Jb")).toBe(2); // Erase above
      expect(Bun.stringWidth("a\x1b[2Jb")).toBe(2); // Erase all
      expect(Bun.stringWidth("a\x1b[Kb")).toBe(2); // Erase in line
      expect(Bun.stringWidth("a\x1b[0Kb")).toBe(2); // Erase to right
      expect(Bun.stringWidth("a\x1b[1Kb")).toBe(2); // Erase to left
      expect(Bun.stringWidth("a\x1b[2Kb")).toBe(2); // Erase entire line
    });

    test("scroll functions", () => {
      expect(Bun.stringWidth("a\x1b[5Sb")).toBe(2); // Scroll up
      expect(Bun.stringWidth("a\x1b[5Tb")).toBe(2); // Scroll down
    });

    test("SGR (colors)", () => {
      expect(Bun.stringWidth("a\x1b[mb")).toBe(2); // Reset
      expect(Bun.stringWidth("a\x1b[0mb")).toBe(2); // Reset
      expect(Bun.stringWidth("a\x1b[1mb")).toBe(2); // Bold
      expect(Bun.stringWidth("a\x1b[31mb")).toBe(2); // Red foreground
      expect(Bun.stringWidth("a\x1b[41mb")).toBe(2); // Red background
      expect(Bun.stringWidth("a\x1b[38;5;196mb")).toBe(2); // 256-color
      expect(Bun.stringWidth("a\x1b[38;2;255;0;0mb")).toBe(2); // True color
    });

    test("other CSI sequences", () => {
      expect(Bun.stringWidth("a\x1b[?25hb")).toBe(2); // Show cursor
      expect(Bun.stringWidth("a\x1b[?25lb")).toBe(2); // Hide cursor
      expect(Bun.stringWidth("a\x1b[sb")).toBe(2); // Save cursor position
      expect(Bun.stringWidth("a\x1b[ub")).toBe(2); // Restore cursor position
      expect(Bun.stringWidth("a\x1b[6nb")).toBe(2); // Device status report
    });

    test("CSI with various final bytes", () => {
      // Test representative final bytes from 0x40-0x7E
      expect(Bun.stringWidth("a\x1b[@b")).toBe(2); // @
      expect(Bun.stringWidth("a\x1b[Lb")).toBe(2); // L - Insert lines
      expect(Bun.stringWidth("a\x1b[Mb")).toBe(2); // M - Delete lines
      expect(Bun.stringWidth("a\x1b[Pb")).toBe(2); // P - Delete chars
      expect(Bun.stringWidth("a\x1b[Xb")).toBe(2); // X - Erase chars
      expect(Bun.stringWidth("a\x1b[Zb")).toBe(2); // Z - Cursor back tab
      expect(Bun.stringWidth("a\x1b[`b")).toBe(2); // ` - Character position absolute
      expect(Bun.stringWidth("a\x1b[ab")).toBe(2); // a - Character position relative
      expect(Bun.stringWidth("a\x1b[db")).toBe(2); // d - Line position absolute
      expect(Bun.stringWidth("a\x1b[eb")).toBe(2); // e - Line position relative
      expect(Bun.stringWidth("a\x1b[rb")).toBe(2); // r - Set scrolling region
    });

    test("multiple CSI sequences", () => {
      expect(Bun.stringWidth("\x1b[31m\x1b[1mhello\x1b[0m")).toBe(5);
      expect(Bun.stringWidth("a\x1b[5A\x1b[3Cb\x1b[2Jc")).toBe(3);
    });

    test("malformed CSI (no final byte)", () => {
      // If CSI doesn't have a final byte, behavior depends on implementation
      // Just ensure it doesn't crash
      expect(() => Bun.stringWidth("a\x1b[")).not.toThrow();
      expect(() => Bun.stringWidth("a\x1b[5")).not.toThrow();
    });
  });

  describe("OSC sequences", () => {
    test("OSC 8 hyperlinks with BEL terminator", () => {
      expect(Bun.stringWidth("\x1b]8;;https://example.com\x07link\x1b]8;;\x07")).toBe(4);
      expect(Bun.stringWidth("before\x1b]8;;url\x07click\x1b]8;;\x07after")).toBe(16);
    });

    test("OSC 8 hyperlinks with ST terminator", () => {
      // ST terminator is ESC \ - the backslash must NOT be counted as visible
      expect(Bun.stringWidth("\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\")).toBe(4);
      // Multiple OSC sequences with ST
      expect(Bun.stringWidth("a\x1b]0;title\x1b\\b\x1b]0;title2\x1b\\c")).toBe(3);
    });

    test("OSC with various content", () => {
      expect(Bun.stringWidth("\x1b]0;window title\x07text")).toBe(4); // Set window title
      expect(Bun.stringWidth("\x1b]2;window title\x07text")).toBe(4); // Set window title
    });

    test("unterminated OSC in UTF-16 string", () => {
      // Force UTF-16 by including non-Latin1 char, then unterminated OSC
      // The OSC content should NOT contribute to width
      expect(Bun.stringWidth("中\x1b]8;;" + "x".repeat(100))).toBe(2); // Just 中
      expect(Bun.stringWidth("hello中\x1b]8;;url" + "y".repeat(50))).toBe(7); // hello + 中
      expect(Bun.stringWidth("🎉\x1b]0;title")).toBe(2); // Just 🎉
    });

    test("mixed OSC and CSI", () => {
      expect(Bun.stringWidth("\x1b[31m\x1b]8;;url\x07red link\x1b]8;;\x07\x1b[0m")).toBe(8);
    });
  });

  describe("emoji handling", () => {
    test("basic emoji", () => {
      expect(Bun.stringWidth("😀")).toBe(2);
      expect(Bun.stringWidth("🎉")).toBe(2);
      expect(Bun.stringWidth("❤️")).toBe(2);
    });

    test("flag emoji (regional indicators)", () => {
      expect(Bun.stringWidth("🇺🇸")).toBe(2); // US flag
      expect(Bun.stringWidth("🇬🇧")).toBe(2); // UK flag
      expect(Bun.stringWidth("🇯🇵")).toBe(2); // Japan flag
      expect(Bun.stringWidth("🇦")).toBe(1); // Single regional indicator
    });

    test("skin tone modifiers", () => {
      expect(Bun.stringWidth("👋")).toBe(2); // Wave without skin tone
      expect(Bun.stringWidth("👋🏻")).toBe(2); // Light skin tone
      expect(Bun.stringWidth("👋🏼")).toBe(2); // Medium-light skin tone
      expect(Bun.stringWidth("👋🏽")).toBe(2); // Medium skin tone
      expect(Bun.stringWidth("👋🏾")).toBe(2); // Medium-dark skin tone
      expect(Bun.stringWidth("👋🏿")).toBe(2); // Dark skin tone
    });

    test("ZWJ sequences", () => {
      expect(Bun.stringWidth("👨‍👩‍👧‍👦")).toBe(2); // Family
      expect(Bun.stringWidth("👩‍💻")).toBe(2); // Woman technologist
      expect(Bun.stringWidth("🏳️‍🌈")).toBe(2); // Rainbow flag
      expect(Bun.stringWidth("👨‍❤️‍👨")).toBe(2); // Couple with heart
    });

    test("keycap sequences", () => {
      expect(Bun.stringWidth("1️⃣")).toBe(2); // Keycap 1
      expect(Bun.stringWidth("2️⃣")).toBe(2); // Keycap 2
      expect(Bun.stringWidth("#️⃣")).toBe(2); // Keycap #
      expect(Bun.stringWidth("*️⃣")).toBe(2); // Keycap *
    });

    test("variation selectors with emoji", () => {
      // VS16 (emoji presentation)
      expect(Bun.stringWidth("☀️")).toBe(2); // Sun with VS16
      expect(Bun.stringWidth("❤️")).toBe(2); // Heart with VS16

      // VS15 (text presentation) - these become narrow
      expect(Bun.stringWidth("☀\uFE0E")).toBe(1); // Sun with VS15
      expect(Bun.stringWidth("❤\uFE0E")).toBe(1); // Heart with VS15
    });

    test("variation selectors with non-emoji", () => {
      // Digits with VS16 (no keycap) stay width 1
      expect(Bun.stringWidth("0\uFE0F")).toBe(1);
      expect(Bun.stringWidth("9\uFE0F")).toBe(1);
      expect(Bun.stringWidth("#\uFE0F")).toBe(1);
      expect(Bun.stringWidth("*\uFE0F")).toBe(1);

      // Letters with VS16 stay width 1
      expect(Bun.stringWidth("a\uFE0F")).toBe(1);
      expect(Bun.stringWidth("A\uFE0F")).toBe(1);
    });

    test("symbols with variation selectors", () => {
      // Symbols that become emoji with VS16
      expect(Bun.stringWidth("©\uFE0F")).toBe(2); // Copyright
      expect(Bun.stringWidth("®\uFE0F")).toBe(2); // Registered
      expect(Bun.stringWidth("™\uFE0F")).toBe(2); // Trademark
      expect(Bun.stringWidth("↩\uFE0F")).toBe(2); // Arrow
      expect(Bun.stringWidth("ℹ\uFE0F")).toBe(2); // Info

      // Same symbols with VS15 (text) - narrow
      expect(Bun.stringWidth("©\uFE0E")).toBe(1);
      expect(Bun.stringWidth("®\uFE0E")).toBe(1);
    });

    test("emoji in context", () => {
      expect(Bun.stringWidth("Hello 👋 World")).toBe(14);
      expect(Bun.stringWidth("🏠🏡🏢")).toBe(6);
    });
  });

  describe("East Asian Width", () => {
    test("CJK characters (wide)", () => {
      expect(Bun.stringWidth("中")).toBe(2);
      expect(Bun.stringWidth("文")).toBe(2);
      expect(Bun.stringWidth("中文")).toBe(4);
      expect(Bun.stringWidth("日本語")).toBe(6);
      expect(Bun.stringWidth("한글")).toBe(4);
    });

    test("fullwidth characters", () => {
      expect(Bun.stringWidth("Ａ")).toBe(2); // Fullwidth A
      expect(Bun.stringWidth("１")).toBe(2); // Fullwidth 1
      expect(Bun.stringWidth("！")).toBe(2); // Fullwidth !
    });

    test("halfwidth katakana", () => {
      expect(Bun.stringWidth("ｱ")).toBe(1); // Halfwidth A
      expect(Bun.stringWidth("ｶ")).toBe(1); // Halfwidth KA
      expect(Bun.stringWidth("ﾊﾞ")).toBe(2); // Halfwidth HA + voiced mark
    });

    test("mixed width", () => {
      expect(Bun.stringWidth("hello世界")).toBe(9); // 5 + 4
      expect(Bun.stringWidth("abc中文def")).toBe(10); // 3 + 4 + 3
    });
  });

  describe("Indic scripts", () => {
    test("Devanagari with combining marks", () => {
      expect(Bun.stringWidth("क")).toBe(1); // Ka
      expect(Bun.stringWidth("क्")).toBe(1); // Ka + virama (combining)
      expect(Bun.stringWidth("कि")).toBe(1); // Ka + vowel sign i (combining)
    });

    test("Thai with combining marks", () => {
      expect(Bun.stringWidth("ก")).toBe(1); // Ko kai
      expect(Bun.stringWidth("ก็")).toBe(1); // With maitaikhu
      expect(Bun.stringWidth("ปฏัก")).toBe(3); // ป + ฏ + ั (combining) + ก = 3 visible
    });
  });

  describe("non-ASCII in escape sequences and Indic script handling", () => {
    test("OSC with non-ASCII (emoji) in URL should be invisible", () => {
      // Non-ASCII characters inside OSC sequence should NOT be counted
      // The emoji is part of the invisible hyperlink URL
      const result = Bun.stringWidth("a\x1b]8;;https://🎉\x07b");
      expect(result).toBe(2); // just "ab"
    });

    test("OSC with CJK in URL should be invisible", () => {
      // CJK character inside OSC sequence should NOT be counted
      const result = Bun.stringWidth("a\x1b]8;;https://中.com\x07b");
      expect(result).toBe(2); // just "ab"
    });

    test("Indic Avagraha (U+093D) should have width 1", () => {
      // U+093D (ऽ) is Devanagari Avagraha - a visible letter (category Lo)
      // The Indic heuristic incorrectly marks it as zero-width
      expect(Bun.stringWidth("\u093D")).toBe(1);
      expect(Bun.stringWidth("a\u093Db")).toBe(3);
    });

    test("Malayalam Sign Para (U+0D4F) should have width 1", () => {
      // U+0D4F (൏) is Malayalam Sign Para - a visible symbol (category So)
      // The Indic heuristic incorrectly marks it as zero-width
      expect(Bun.stringWidth("\u0D4F")).toBe(1);
    });

    test("Bengali Avagraha (U+09BD) should have width 1", () => {
      // U+09BD (ঽ) is Bengali Avagraha - a visible letter (category Lo)
      expect(Bun.stringWidth("\u09BD")).toBe(1);
    });

    test("Tamil Visarga (U+0B83) should have width 1", () => {
      // U+0B83 (ஃ) is Tamil Sign Visarga - a visible letter (category Lo)
      expect(Bun.stringWidth("\u0B83")).toBe(1);
    });
  });

  describe("edge cases", () => {
    test("empty string", () => {
      expect(Bun.stringWidth("")).toBe(0);
    });

    test("only zero-width characters", () => {
      expect(Bun.stringWidth("\u200B\u200C\u200D")).toBe(0);
      expect(Bun.stringWidth("\uFEFF\u2060")).toBe(0);
    });

    test("only ANSI sequences", () => {
      expect(Bun.stringWidth("\x1b[31m\x1b[0m")).toBe(0);
      expect(Bun.stringWidth("\x1b[5A\x1b[3B")).toBe(0);
    });

    test("very long strings", () => {
      const long = "a".repeat(10000);
      expect(Bun.stringWidth(long)).toBe(10000);

      const longEmoji = "😀".repeat(1000);
      expect(Bun.stringWidth(longEmoji)).toBe(2000);
    });

    test("mixed content", () => {
      expect(Bun.stringWidth("Hello\x1b[31m世界\x1b[0m👋")).toBe(11); // 5 + 4 + 2
    });

    test("bare ESC followed by non-sequence", () => {
      expect(Bun.stringWidth("a\x1bXb")).toBe(3); // ESC + X is not a valid sequence
    });
  });

  describe("fuzzer-like stress tests", () => {
    test("many ESC characters without valid sequences", () => {
      // Many bare ESC characters - should not hang
      const input = "\x1b".repeat(10000);
      // Each ESC is a control character with width 0
      expect(Bun.stringWidth(input)).toBe(0);
    });

    test("CSI without final byte (unterminated)", () => {
      // CSI sequence that never gets a final byte
      const input = "a\x1b[" + "9".repeat(10000) + "b";
      // Should consume the whole CSI as escape sequence, leaving just 'a'
      // The 'b' at the end is outside the CSI if we hit end of params
      expect(Bun.stringWidth(input)).toBeGreaterThanOrEqual(1);
    });

    test("OSC without terminator (unterminated)", () => {
      // OSC sequence that never terminates
      const input = "a\x1b]8;;" + "x".repeat(10000);
      // Should consume the OSC, leaving just 'a'
      expect(Bun.stringWidth(input)).toBe(1);
    });

    test("many incomplete CSI sequences", () => {
      // Pattern: ESC [ digit ESC [ digit...
      // '[' (0x5B) is a valid CSI final byte per ECMA-48 (range 0x40-0x7E)
      // So ESC [ 1 ESC [ is a complete CSI ending with '[', leaving some digits visible
      // The pattern alternates between 1 and 2 visible chars, averaging 1.5 per pattern
      const input = "\x1b[1\x1b[2\x1b[3".repeat(1000);
      expect(Bun.stringWidth(input)).toBe(1500);
    });

    test("alternating ESC and bracket", () => {
      // ESC [ ESC [ pattern - could confuse state machine
      const input = "\x1b[\x1b[".repeat(5000);
      expect(Bun.stringWidth(input)).toBe(0);
    });

    test("ESC ESC starts new sequence correctly", () => {
      // ESC ESC ] should parse as: first ESC ignored, second ESC + ] = OSC start
      expect(Bun.stringWidth("\x1b\x1b]8;;url\x07link\x1b]8;;\x07")).toBe(4); // "link"
      expect(Bun.stringWidth("\x1b\x1b[31mred\x1b[0m")).toBe(3); // "red"
      expect(Bun.stringWidth("\x1b\x1b\x1b[31mred")).toBe(3); // ESC ESC ESC [ = CSI
      expect(Bun.stringWidth("a\x1b\x1bb")).toBe(2); // ESC ESC followed by regular char
    });

    test("deeply nested combining marks", () => {
      // Base character with many combining marks (zalgo-like)
      const input = "a" + "\u0300\u0301\u0302\u0303\u0304".repeat(2000);
      expect(Bun.stringWidth(input)).toBe(1); // All combining marks are zero-width
    });

    test("many ZWJ characters in sequence", () => {
      // Many ZWJ without proper emoji structure
      const input = "👨" + "\u200D".repeat(10000);
      expect(Bun.stringWidth(input)).toBe(2); // Just the base emoji
    });

    test("many variation selectors", () => {
      // Character followed by many variation selectors
      const input = "A" + "\uFE0F".repeat(10000);
      expect(Bun.stringWidth(input)).toBe(1);
    });

    test("alternating surrogates (invalid pairs)", () => {
      // High-high-high pattern (invalid UTF-16)
      const input = "\uD800\uD800\uD800".repeat(3000);
      expect(Bun.stringWidth(input)).toBe(0); // Lone surrogates are zero-width
    });

    test("low surrogate without high (invalid)", () => {
      const input = "\uDC00".repeat(10000);
      expect(Bun.stringWidth(input)).toBe(0);
    });

    test("many regional indicators (odd count)", () => {
      // Odd number of regional indicators
      const input = "🇦🇧🇨🇩🇪🇫🇬🇭🇮🇯🇰".repeat(500);
      // Should handle gracefully
      expect(Bun.stringWidth(input)).toBeGreaterThan(0);
    });

    test("maximum codepoint values", () => {
      // Characters near U+10FFFF
      const input = "\u{10FFFF}\u{10FFFE}\u{10FFFD}".repeat(1000);
      expect(Bun.stringWidth(input)).toBeGreaterThanOrEqual(0);
    });

    test("rapid encoding switches", () => {
      // Mix of ASCII, Latin-1, BMP, and astral
      const pattern = "a\x80\u0100\u1000\u{10000}";
      const input = pattern.repeat(2000);
      expect(Bun.stringWidth(input)).toBeGreaterThan(0);
    });

    test("all CSI final bytes", () => {
      // Test every possible CSI final byte (0x40-0x7E)
      let input = "";
      for (let i = 0x40; i <= 0x7e; i++) {
        input += `a\x1b[1${String.fromCharCode(i)}`;
      }
      input = input.repeat(100);
      // 63 different final bytes * 'a' = 63 * 100
      expect(Bun.stringWidth(input)).toBe(6300);
    });

    test("OSC with embedded ESC characters", () => {
      // OSC containing ESC that isn't ST
      const input = "a\x1b]8;;\x1bx\x1by\x1bz\x07b";
      expect(Bun.stringWidth(input)).toBe(2); // 'a' and 'b'
    });

    test("interleaved ANSI and emoji", () => {
      const input = "\x1b[31m👨‍👩‍👧\x1b[0m\x1b[32m🇺🇸\x1b[0m".repeat(1000);
      expect(Bun.stringWidth(input)).toBe(4000); // 2 + 2 per iteration
    });

    test("string of only zero-width characters", () => {
      // Many different zero-width characters
      const zeroWidth = "\u200B\u200C\u200D\u200E\u200F\uFEFF\u2060\u2061\u2062\u2063\u2064";
      const input = zeroWidth.repeat(1000);
      expect(Bun.stringWidth(input)).toBe(0);
    });

    test("pathological grapheme cluster", () => {
      // Emoji with skin tone, ZWJ, another emoji, VS16
      const complex = "👩🏻‍🔬";
      const input = complex.repeat(2000);
      expect(Bun.stringWidth(input)).toBe(4000);
    });

    test("mixed valid and invalid escape sequences", () => {
      // Pattern: valid CSI + ESC ESC + OSC + incomplete CSI
      // - \x1b[31m: valid CSI, consumed
      // - \x1b\x1b]: second ESC correctly starts new sequence, ] starts OSC
      // - 0;title\x07: consumed by OSC, BEL terminates it
      // - \x1b[: incomplete CSI that continues into next pattern
      // At pattern boundaries, incomplete CSI (\x1b[) + next pattern's \x1b[31m:
      // The [ in \x1b[31m is a valid CSI final byte (0x5B), so "31m" becomes visible (3 chars)
      // 999 boundaries * 3 chars = 2997
      const input = "\x1b[31m\x1b\x1b]0;title\x07\x1b[".repeat(1000);
      expect(Bun.stringWidth(input)).toBe(2997);
    });

    test("random-like byte patterns", () => {
      // Generate pseudo-random pattern that might trigger edge cases
      let input = "";
      for (let i = 0; i < 10000; i++) {
        const code = (i * 7 + 13) % 128; // Pseudo-random ASCII
        input += String.fromCharCode(code);
      }
      expect(() => Bun.stringWidth(input)).not.toThrow();
    });

    test("BOM at various positions", () => {
      // BOM scattered throughout string
      const input = "hello\uFEFFworld\uFEFFtest\uFEFF".repeat(1000);
      expect(Bun.stringWidth(input)).toBe(14000); // "helloworldtest" = 14 * 1000
    });

    test("soft hyphen stress test", () => {
      // Many soft hyphens
      const input = "a\u00ADb\u00ADc\u00AD".repeat(3000);
      expect(Bun.stringWidth(input)).toBe(9000); // 3 visible chars per iteration
    });

    test("Arabic formatting characters", () => {
      // Arabic text with formatting characters
      const input = "\u0600\u0601\u0602\u0603\u0604\u0605text".repeat(1000);
      expect(Bun.stringWidth(input)).toBe(4000); // Only "text" is visible
    });

    test("tag characters (U+E0000 range)", () => {
      // Many tag characters
      const input = "\u{E0001}\u{E0020}\u{E0041}\u{E007F}".repeat(2500);
      expect(Bun.stringWidth(input)).toBe(0);
    });

    test("variation selector supplement (U+E0100 range)", () => {
      // Many variation selectors from supplement
      const input = "字\u{E0100}".repeat(5000);
      expect(Bun.stringWidth(input)).toBe(10000); // Each 字 is width 2
    });

    test("extremely long single grapheme", () => {
      // One base + tons of combining marks = 1 grapheme
      let input = "o";
      for (let i = 0; i < 1000; i++) {
        input += String.fromCharCode(0x0300 + (i % 112)); // Various combining marks
      }
      expect(Bun.stringWidth(input)).toBe(1);
    });

    test("null bytes interspersed", () => {
      const input = "a\x00b\x00c\x00".repeat(3000);
      expect(Bun.stringWidth(input)).toBe(9000); // NUL is zero-width
    });

    test("DEL characters (0x7F)", () => {
      const input = "a\x7Fb\x7Fc".repeat(3000);
      expect(Bun.stringWidth(input)).toBe(9000);
    });

    test("C1 control characters", () => {
      // C1 controls: 0x80-0x9F
      let input = "";
      for (let i = 0x80; i <= 0x9f; i++) {
        input += "a" + String.fromCharCode(i);
      }
      input = input.repeat(300);
      expect(Bun.stringWidth(input)).toBe(9600); // 32 'a' chars per pattern * 300
    });

    test("worst case: every character needs special handling", () => {
      // Mix that exercises every code path
      const input = "a\x1b[31m中\u0300\uFE0F👨‍👩‍👧🇺🇸\x1b]8;;url\x07link\x1b]8;;\x07\u200B\x1b[0m".repeat(500);
      expect(Bun.stringWidth(input)).toBeGreaterThan(0);
    });
  });

  describe("Devanagari conjuncts (GB9c)", () => {
    test("Ka + Virama + Ssa forms single grapheme cluster", () => {
      // क्ष = Ka (U+0915) + Virama (U+094D) + Ssa (U+0937)
      expect(Bun.stringWidth("क्ष")).toBe(2); // 1+0+1 = 2 within single cluster
    });

    test("Ka + Virama + ZWJ + Ssa forms single grapheme cluster", () => {
      // Ka + Virama + ZWJ + Ssa
      expect(Bun.stringWidth("क्\u200Dष")).toBe(2);
    });

    test("Multiple conjuncts separated by space", () => {
      expect(Bun.stringWidth("क्ष क्ष")).toBe(5); // 2 + 1(space) + 2
    });

    test("Three consonants joined", () => {
      // Ka + Virama + Ka + Virama + Ka
      expect(Bun.stringWidth("क्क्क")).toBe(3); // 1+0+1+0+1
    });
  });
});
