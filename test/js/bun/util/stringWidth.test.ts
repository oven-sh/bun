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

    test("bidi embeddings and overrides (U+202A-U+202E)", () => {
      expect(Bun.stringWidth("\u202A")).toBe(0); // Left-to-right embedding
      expect(Bun.stringWidth("\u202B")).toBe(0); // Right-to-left embedding
      expect(Bun.stringWidth("\u202C")).toBe(0); // Pop directional formatting
      expect(Bun.stringWidth("\u202D")).toBe(0); // Left-to-right override
      expect(Bun.stringWidth("\u202E")).toBe(0); // Right-to-left override
      expect(Bun.stringWidth("\u202Eabc\u202C")).toBe(3);
    });

    test("bidi isolates and the rest of U+2065-U+206F", () => {
      expect(Bun.stringWidth("\u2066")).toBe(0); // Left-to-right isolate
      expect(Bun.stringWidth("\u2067")).toBe(0); // Right-to-left isolate
      expect(Bun.stringWidth("\u2068")).toBe(0); // First strong isolate
      expect(Bun.stringWidth("\u2069")).toBe(0); // Pop directional isolate
      expect(Bun.stringWidth("\u2066abc\u2069")).toBe(3);
      for (let cp = 0x2065; cp <= 0x206f; cp++) {
        expect(Bun.stringWidth(String.fromCodePoint(cp))).toBe(0);
      }
    });

    test("Arabic letter mark (U+061C)", () => {
      expect(Bun.stringWidth("\u061C")).toBe(0);
      expect(Bun.stringWidth("\u061Cab")).toBe(2);
    });

    test("Mongolian variation selectors and vowel separator (U+180B-U+180F)", () => {
      for (let cp = 0x180b; cp <= 0x180f; cp++) {
        expect(Bun.stringWidth(String.fromCodePoint(cp))).toBe(0);
      }
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

    test("musical and shorthand format controls", () => {
      // The last default-ignorable Cf characters: glibc wcwidth() and
      // string-width both return 0 for these.
      expect(Bun.stringWidth("\u{1D173}")).toBe(0); // musical symbol begin beam
      expect(Bun.stringWidth("\u{1D17A}")).toBe(0); // musical symbol end phrase
      expect(Bun.stringWidth("\u{1D173}hi\u{1D174}")).toBe(2);
      expect(Bun.stringWidth("\u{1BCA0}")).toBe(0); // shorthand format letter overlap
      expect(Bun.stringWidth("\u{1BCA3}")).toBe(0); // shorthand format up step
      expect(Bun.stringWidth("a\u{1BCA0}b")).toBe(2);
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

  // Bun.stringWidth must agree with Bun.stripANSI / Bun.sliceAnsi on what an
  // escape sequence is. These cover the 8-bit C1 introducers (ECMA-48 §5.3)
  // and the ST-terminated control strings (DCS/SOS/PM/APC) that stripANSI and
  // sliceAnsi already recognize.
  describe("C1 escapes and ST-terminated control strings", () => {
    test("C1 CSI (0x9B) is equivalent to ESC [", () => {
      expect(Bun.stringWidth("\x9B31mhi\x9B39m")).toBe(2);
      expect(Bun.stringWidth("a\x9B5Ab")).toBe(2);
      expect(Bun.stringWidth("\x9B38;2;255;0;0mX\x9B39m")).toBe(1);
      // UTF-16 path
      expect(Bun.stringWidth("\x9B31m日本\x9B39m")).toBe(4);
      expect(Bun.stringWidth("😀\x9B1mok\x9B22m😀")).toBe(6);
    });

    test("C1 OSC (0x9D) is equivalent to ESC ]", () => {
      expect(Bun.stringWidth("\x9D8;;https://bun.com\x07link\x9D8;;\x07")).toBe(4);
      expect(Bun.stringWidth("\x9D8;;url\x9Ctext\x9D8;;\x9C")).toBe(4);
      expect(Bun.stringWidth("\x9D0;title\x1b\\text")).toBe(4);
      // UTF-16 path
      expect(Bun.stringWidth("\x9D8;;https://bun.com\x07文档\x9D8;;\x07")).toBe(4);
    });

    test("DCS/SOS/PM/APC payloads are zero-width", () => {
      // 7-bit (ESC P/X/^/_) with ESC\ terminator
      expect(Bun.stringWidth("a\x1bP+q544e\x1b\\b")).toBe(2);
      expect(Bun.stringWidth("a\x1bXpayload\x1b\\b")).toBe(2);
      expect(Bun.stringWidth("a\x1b^pm\x1b\\b")).toBe(2);
      expect(Bun.stringWidth("a\x1b_apc data\x1b\\b")).toBe(2);
      // 8-bit (0x90/0x98/0x9E/0x9F) with C1 ST terminator
      expect(Bun.stringWidth("a\x90+q544e\x9Cb")).toBe(2);
      expect(Bun.stringWidth("a\x98payload\x9Cb")).toBe(2);
      expect(Bun.stringWidth("a\x9Epm\x9Cb")).toBe(2);
      expect(Bun.stringWidth("a\x9Fapc\x9Cb")).toBe(2);
      // UTF-16 path
      expect(Bun.stringWidth("中\x1bP+q\x1b\\文")).toBe(4);
      expect(Bun.stringWidth("中\x90+q\x9C文")).toBe(4);
    });

    test("BEL does not terminate DCS/SOS/PM/APC", () => {
      // BEL terminates OSC only; inside a DCS payload it is just a byte.
      expect(Bun.stringWidth("a\x1bPdata\x07still dcs\x1b\\b")).toBe(2);
      expect(Bun.stringWidth("a\x90data\x07still\x9Cb")).toBe(2);
    });

    test("unterminated C1/ST sequences consume to end of string", () => {
      // Same consume-to-EOF semantics as unterminated ESC[ / ESC].
      expect(Bun.stringWidth("abc\x9B31;38;2;1;2;3")).toBe(3);
      expect(Bun.stringWidth("abc\x9D0;title")).toBe(3);
      expect(Bun.stringWidth("abc\x90payload")).toBe(3);
      expect(Bun.stringWidth("abc\x1bPpayload")).toBe(3);
      expect(Bun.stringWidth("中文\x9B31")).toBe(4);
    });

    test("non-introducer C1 bytes stay zero-width controls", () => {
      // 0x91-0x97, 0x99, 0x9A, 0x9C alone do not open a sequence.
      for (const cp of [0x91, 0x92, 0x97, 0x99, 0x9a, 0x9c]) {
        expect(Bun.stringWidth("a" + String.fromCharCode(cp) + "b")).toBe(2);
      }
    });

    test("C1 CSI still stripped with countAnsiEscapeCodes: false, counted with true", () => {
      const s = "\x9B31mhi\x9B39m";
      expect(Bun.stringWidth(s, { countAnsiEscapeCodes: false })).toBe(2);
      // With counting enabled: 0x9B is a zero-width C1 control, '3','1','m'
      // etc. count individually: 3+2+3 = 8.
      expect(Bun.stringWidth(s, { countAnsiEscapeCodes: true })).toBe(8);
    });

    test("stringWidth agrees with stripANSI on C1/DCS input", () => {
      const cases = [
        "\x9B31mhi\x9B39m",
        "\x9D8;;url\x9Clink\x9D8;;\x9C",
        "\x1bP+q544e\x1b\\text",
        "\x90dcs\x9Ctext",
        "\x98sos\x9Ctext",
        "\x9Epm\x9Ctext",
        "\x9Fapc\x9Ctext",
        "pre\x9B1mmid\x9B22m\x1bPdcs\x1b\\post",
        // UTF-16
        "日\x9B31m本\x9B39m語",
        "中\x90+q\x9C文",
      ];
      for (const s of cases) {
        expect({ input: s, width: Bun.stringWidth(s) }).toEqual({
          input: s,
          width: Bun.stringWidth(Bun.stripANSI(s)),
        });
      }
    });

    // ESC / CAN / SUB / C1 ST abort an in-progress sequence (VT500): all four
    // APIs must land on the same visible text.
    test("stringWidth, stripANSI, sliceAnsi and wrapAnsi agree on aborted sequences", () => {
      const cases = [
        "ab\x1b[3\x9cxy", // C1 ST inside a CSI
        "text\x1b[3\x1b[0mmore", // ESC inside a CSI re-introduces
        "\x1b]0;title\x1b[31mtext\x1b[0m", // ESC inside an OSC payload
        "ab\x1b[31\x18mcd", // CAN inside a CSI
        "\x1b]8;;http://x/\x1b[1mabort\x1b[0m", // ESC inside an OSC-8 hyperlink
        "a\x1bP q\x18b", // CAN inside a DCS
        "\x1b]8;\x1b[m;u\x07X", // ESC inside the OSC-8 params
        "\x1b(\x1b[1mZ", // ESC as the final byte of an nF sequence
        "\x1b[\x00abc", // non-parameter byte inside a CSI is payload
      ];
      for (const s of cases) {
        const width = Bun.stringWidth(s);
        expect({
          s,
          strip: Bun.stringWidth(Bun.stripANSI(s)),
          sliceNeg: Bun.stringWidth(Bun.sliceAnsi(s, -width)),
          wrap: Bun.stringWidth(Bun.wrapAnsi(s, 99).replaceAll("\n", "")),
        }).toEqual({ s, strip: width, sliceNeg: width, wrap: width });
        // A slice bounded at column k is never wider than k, and grows
        // monotonically with k up to the full width.
        let prev = 0;
        for (let k = 0; k <= width + 1; k++) {
          const w = Bun.stringWidth(Bun.sliceAnsi(s, 0, k));
          expect({ s, k, w, bounded: w <= k, monotonic: w >= prev }).toEqual({
            s,
            k,
            w,
            bounded: true,
            monotonic: true,
          });
          prev = w;
        }
        expect(Bun.stringWidth(Bun.sliceAnsi(s, 0, width + 1))).toBe(width);
      }
    });

    test("sliceAnsi negative index agrees with stringWidth offset on C1 input", () => {
      const m = "\x9B32mabcdef";
      expect(Bun.sliceAnsi(m, -3)).toBe(Bun.sliceAnsi(m, Bun.stringWidth(m) - 3));
      const n = "\x9B31mhi\x9B39m world";
      expect(Bun.sliceAnsi(n, -4)).toBe(Bun.sliceAnsi(n, Bun.stringWidth(n) - 4));
    });

    // Bun.inspect.table sizes cells with the UTF-8 width helper, where a C1
    // codepoint is the two-byte 0xC2 0x9x form and 0x9B/0x9C/0x9D also occur as
    // UTF-8 continuation bytes. It must agree with Bun.stringWidth's UTF-16
    // path on the same string.
    test("UTF-8 width path (inspect.table cells) agrees with stringWidth", () => {
      const cells = [
        "\x9B31mred\x9B39m", // C1 CSI as 0xC2 0x9B
        "\x9D8;;https://x/业\x9Cli“k", // C1 OSC + C1 ST; 业/“ contain 0x9C/0x9B... continuation bytes
        "\x1b]8;;https://x/业\x07业\x1b]8;;\x07", // 0x9C continuation byte inside an ESC ] payload
        "\x1b(éx", // nF intermediate followed by a two-byte codepoint
        "ț\x1b[31mț", // ț = C8 9B: continuation byte 0x9B is not a CSI introducer
      ];
      for (const s of cells) {
        // Column widths (the top border) must match a table whose cell holds
        // the same text with the escape sequences stripped.
        const border = (v: string) => Bun.inspect.table([{ s: v }], { colors: false }).split("\n")[0];
        expect({ s, border: border(s) }).toEqual({ s, border: border(Bun.stripANSI(s)) });
      }
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

    test("Thai spacing vowels (SARA AA and SARA AM)", () => {
      // U+0E32 (SARA AA) and U+0E33 (SARA AM) are spacing vowels, not combining marks
      expect(Bun.stringWidth("\u0E32")).toBe(1); // SARA AA alone
      expect(Bun.stringWidth("\u0E33")).toBe(1); // SARA AM alone
      expect(Bun.stringWidth("ก\u0E32")).toBe(2); // ก + SARA AA
      expect(Bun.stringWidth("ก\u0E33")).toBe(2); // กำ (KO KAI + SARA AM)
      expect(Bun.stringWidth("คำ")).toBe(2); // Common Thai word
      expect(Bun.stringWidth("ทำ")).toBe(2); // Common Thai word
      // True combining marks should still be zero-width
      expect(Bun.stringWidth("\u0E31")).toBe(0); // MAI HAN-AKAT (combining)
      expect(Bun.stringWidth("ก\u0E31")).toBe(1); // กั
    });

    test("Lao spacing vowels", () => {
      // U+0EB2 and U+0EB3 are spacing vowels in Lao, similar to Thai
      expect(Bun.stringWidth("\u0EB2")).toBe(1); // LAO VOWEL SIGN AA
      expect(Bun.stringWidth("\u0EB3")).toBe(1); // LAO VOWEL SIGN AM
      expect(Bun.stringWidth("ກ\u0EB2")).toBe(2); // KO + AA
      // True combining marks should still be zero-width
      expect(Bun.stringWidth("\u0EB1")).toBe(0); // MAI KAN (combining)
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

    test("ESC followed by a byte that cannot end a sequence", () => {
      // ECMA-48 escape sequences end on a final byte in [0x30, 0x7E]. A C0
      // control or a non-ASCII codepoint after ESC is not part of a sequence,
      // so only the ESC itself is dropped and the codepoint still counts.
      expect(Bun.stringWidth("a\x1b\x01b")).toBe(2); // \x01 is a zero-width control
      expect(Bun.stringWidth("a\x1b\u4e2db")).toBe(4); // 1 + 2 + 1
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
      // Pattern: ESC [ digit ESC [ digit... — each ESC aborts the incomplete
      // CSI before it and re-introduces a sequence (VT500), so nothing is
      // ever visible.
      const input = "\x1b[1\x1b[2\x1b[3".repeat(1000);
      expect(Bun.stringWidth(input)).toBe(0);
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
      // ESC ESC b: the second ESC restarts the sequence and 'b' is its final
      // byte, so "ESC b" is a complete two-byte escape.
      expect(Bun.stringWidth("a\x1b\x1bb")).toBe(1);
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
      // The inner ESC aborts the OSC (VT500); ESC x, ESC y and ESC z are then
      // two-byte escapes and BEL is a zero-width control.
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
      // At each boundary the incomplete CSI (\x1b[) is aborted by the next
      // pattern's ESC (VT500), which re-introduces the CSI \x1b[31m — so
      // nothing is ever visible.
      const input = "\x1b[31m\x1b\x1b]0;title\x07\x1b[".repeat(1000);
      expect(Bun.stringWidth(input)).toBe(0);
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
      // C1 controls 0x80-0x9F, excluding the ANSI escape introducers
      // (0x90 DCS, 0x98 SOS, 0x9B CSI, 0x9D OSC, 0x9E PM, 0x9F APC) which
      // would swallow the following bytes as payload.
      const introducers = new Set([0x90, 0x98, 0x9b, 0x9d, 0x9e, 0x9f]);
      let input = "";
      let visible = 0;
      for (let i = 0x80; i <= 0x9f; i++) {
        if (introducers.has(i)) continue;
        input += "a" + String.fromCharCode(i);
        visible++;
      }
      input = input.repeat(300);
      expect(Bun.stringWidth(input)).toBe(visible * 300);
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

  // ANSI escape sequences should NOT affect grapheme cluster state. Previously,
  // the CSI final byte (e.g. 'm') was tracked as the "previous codepoint" for
  // graphemeBreak, so a zero-width joiner/extender immediately after an SGR
  // code would wrongly attach to the 'm' instead of the last visible char.
  // Found by sliceAnsi fuzz testing.
  describe("ANSI sequences preserve grapheme state", () => {
    test("VS16 after SGR code has width 0 (not 1)", () => {
      // VS16 (U+FE0F) is a zero-width variation selector. It should contribute
      // width 0 regardless of whether an ANSI code precedes it.
      expect(Bun.stringWidth("\uFE0F?")).toBe(1); // baseline: no ANSI
      expect(Bun.stringWidth("\x1b[1m\uFE0F?")).toBe(1); // SGR before: same
      expect(Bun.stringWidth("\x1b[31m\uFE0F\x1b[39m?")).toBe(1); // SGR both sides
    });

    test("combining mark after SGR attaches to previous visible char, not 'm'", () => {
      // 'e' + SGR + U+0301 (combining acute) should form one cluster "é" (width 1).
      // Previously the CSI 'm' byte was the graphemeBreak prev → combining mark
      // attached to 'm' → 'e' finalized alone (width 1) + new cluster (width 0)
      // → total 1. This happens to be correct by accident, but let's lock it in.
      expect(Bun.stringWidth("e\u0301")).toBe(1); // baseline
      expect(Bun.stringWidth("e\x1b[1m\u0301")).toBe(1); // SGR between base and mark
    });

    test("ZWJ after SGR doesn't break emoji cluster", () => {
      // 👩 + SGR + ZWJ + SGR + 💻 should still be one width-2 cluster.
      expect(Bun.stringWidth("\u{1F469}\u200D\u{1F4BB}")).toBe(2); // baseline
      expect(Bun.stringWidth("\u{1F469}\x1b[1m\u200D\x1b[22m\u{1F4BB}")).toBe(2);
    });

    test("ANSI + VS16 + ZWJ (orphaned joiners at start) has width 0", () => {
      // Orphaned VS16 + ZWJ at string start, with ANSI before/between.
      // Both are zero-width; no visible chars → width 0.
      expect(Bun.stringWidth("\uFE0F\u200D")).toBe(0); // baseline
      expect(Bun.stringWidth("\x1b[1m\uFE0F\u200D")).toBe(0);
      expect(Bun.stringWidth("\x1b[1m\uFE0F\x1b[31m\u200D")).toBe(0);
    });

    test("consistency: stringWidth(s) == stringWidth(stripANSI(s))", () => {
      // The fundamental invariant: ANSI codes should be transparent to width.
      // Both go through the same recognizer (ANSI::consumeANSI), so it holds
      // for every ESC-introduced escape form, not just SGR.
      const cases = [
        "\x1b[1m\uFE0F?",
        "\x1b[31me\x1b[39m\u0301",
        "\x1b[1m\u{1F469}\x1b[22m\u200D\u{1F4BB}",
        "\x1b[38;2;255;0;0m\u5B89\u5B81\x1b[39m",
        "\x1b[4m\u{1F1FA}\x1b[24m\u{1F1F8}", // regional indicator pair split by SGR
        "\x1b7hi\x1b8", // DECSC / DECRC
        "ab\x1bcd", // RIS
        "ab\x1b(Bcd", // charset designation
        "ab\x1b#8d", // DECALN
        "a\x1b=b\x1b>c", // keypad mode
        "a\x1bPqfoo\x1b\\b", // DCS ... ST
        "a\x1b\u4e2db", // ESC + non-ASCII: only the ESC is dropped
        "\x1b\x1b[31mred\x1b[0m", // ESC restarts the sequence
        "\u{1D173}x\u{1BCA0}y", // format controls around visible text
      ];
      for (const s of cases) {
        expect(Bun.stringWidth(s)).toBe(Bun.stringWidth(Bun.stripANSI(s)));
      }
    });

    test("consistency holds for pseudo-random escape-heavy UTF-16 input", () => {
      let seed = 0x5eed1234;
      const next = () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed;
      };
      // ESC, the C1 introducers (DCS/SOS/CSI/ST/OSC/PM/APC), every kind of
      // byte that can follow them — introducers, intermediates, final bytes,
      // terminators — plus combining marks and wide characters.
      const alphabet = [
        "\x1b",
        "\x90",
        "\x98",
        "\x9b",
        "\x9c",
        "\x9d",
        "\x9e",
        "\x9f",
        "[",
        "]",
        "(",
        "#",
        "7",
        "c",
        "m",
        ";",
        "1",
        "B",
        "P",
        "\\",
        "\x07",
        "a",
        "Z",
        " ",
        "\u0301",
        "\u4e2d",
        "\u{1F600}",
        "\u200d",
      ];
      const mismatches: string[] = [];
      for (let iter = 0; iter < 400; iter++) {
        let s = "";
        const len = next() % 60;
        for (let k = 0; k < len; k++) s += alphabet[next() % alphabet.length];
        const direct = Bun.stringWidth(s);
        const stripped = Bun.stringWidth(Bun.stripANSI(s));
        if (direct !== stripped) {
          const dump = [...s].map(c => "\\u{" + c.codePointAt(0)!.toString(16) + "}").join("");
          mismatches.push(`${dump}: stringWidth ${direct}, stringWidth(stripANSI) ${stripped}`);
        }
      }
      expect(mismatches).toEqual([]);
    });

    test("consistency: stringWidth(s) == sliceAnsi's width accounting", () => {
      // Bun.sliceAnsi resolves negative indices against its own column count,
      // so sliceAnsi(s, -stringWidth(s)) must return the whole string.
      const cases = [
        "\x1b[31mred\x1b[39m",
        "a\x1b7b\x1b8c", // DECSC / DECRC
        "ab\x1bcd", // RIS
        "ab\x1b(Bcd", // charset designation
        "ab\x1b#8d", // DECALN
        "a\x1b=b\x1b>c", // keypad mode
        "a\x1b\x1bbc", // ESC restarts, 'b' ends the sequence
        "a\x1b\u4e2db", // ESC + non-ASCII
        "a\x1b]8;;u\x07link\x1b]8;;\x07b",
      ];
      for (const s of cases) {
        const w = Bun.stringWidth(s);
        expect(Bun.stringWidth(Bun.sliceAnsi(s, -w))).toBe(w);
      }
    });
  });
});

// ============================================================================
// Coverage for the SIMD fast paths (Latin-1 / UTF-16 ASCII bulk counting) and
// the string encodings JSC can hand to the native implementation.
// ============================================================================

describe("stringWidth SIMD fast paths", () => {
  const repeat = (fill: string, count: number) => Buffer.alloc(count, fill).toString();

  describe("ASCII fast path", () => {
    // Cross the SIMD chunk boundaries (16/32/64-byte vectors plus scalar tail).
    const lengths = [0, 1, 2, 7, 15, 16, 17, 31, 32, 33, 63, 64, 65, 100, 127, 128, 129, 255, 256, 257, 1000, 4096];
    test("plain ASCII of every chunk-boundary length", () => {
      for (const n of lengths) {
        const text = repeat("x", n);
        expect(Bun.stringWidth(text)).toBe(n);
        expect(Bun.stringWidth(text, { countAnsiEscapeCodes: true })).toBe(n);
      }
    });

    test("control characters are zero-width at any position", () => {
      for (const n of [15, 16, 17, 64, 65]) {
        const body = repeat("x", n);
        expect(Bun.stringWidth("\t" + body)).toBe(n);
        expect(Bun.stringWidth(body + "\x07")).toBe(n);
        expect(Bun.stringWidth(body + "\x7f" + body)).toBe(2 * n);
      }
      expect(Bun.stringWidth("a\tb\nc\rd")).toBe(4);
    });

    test("Latin-1 (8-bit, non-ASCII) strings", () => {
      expect(Bun.stringWidth("café")).toBe(4);
      expect(Bun.stringWidth("naïve façade")).toBe(12);
      expect(Bun.stringWidth("§¶±")).toBe(3);
      // soft hyphen is zero-width
      expect(Bun.stringWidth("co\u00ADoperate")).toBe(9);
      expect(Bun.stringWidth("é".repeat(100))).toBe(100);
    });

    test("ASCII stored in a 16-bit string", () => {
      // Slicing off the emoji keeps the UTF-16 backing store, so the pure-ASCII
      // remainder exercises the UTF-16 bulk-count path.
      const ascii16 = ("😀" + "hello world").slice(2);
      expect(ascii16).toBe("hello world");
      expect(Bun.stringWidth(ascii16)).toBe(11);
      expect(Bun.stringWidth(ascii16, { countAnsiEscapeCodes: true })).toBe(11);

      const long16 = ("😀" + repeat("y", 257)).slice(2);
      expect(Bun.stringWidth(long16)).toBe(257);
    });
  });

  describe("ANSI sequences mid-string", () => {
    test("SGR in the middle of Latin-1 text", () => {
      expect(Bun.stringWidth("hello \x1b[31mred\x1b[39m world")).toBe(15);
      expect(Bun.stringWidth("hello \x1b[31mred\x1b[39m world", { countAnsiEscapeCodes: true })).toBe(23);
      expect(Bun.stringWidth("\x1b[38;2;255;100;0mX\x1b[39m")).toBe(1);
      expect(Bun.stringWidth(repeat("a", 30) + "\x1b[31m" + repeat("b", 30) + "\x1b[39m")).toBe(60);
    });

    test("SGR in the middle of UTF-16 text", () => {
      expect(Bun.stringWidth("安\x1b[31m康\x1b[39m!")).toBe(5);
      expect(Bun.stringWidth("安\x1b[31m康", { countAnsiEscapeCodes: true })).toBe(8);
      expect(Bun.stringWidth("😀\x1b[1mok\x1b[22m😀")).toBe(6);
    });

    test("OSC-8 hyperlinks mid-string", () => {
      // BEL-terminated
      expect(Bun.stringWidth("see \x1b]8;;https://bun.com\x07Bun\x1b]8;;\x07 docs")).toBe(12);
      // ST (ESC \)-terminated
      expect(Bun.stringWidth("see \x1b]8;;https://bun.com\x1b\\Bun\x1b]8;;\x1b\\ docs")).toBe(12);
      // UTF-16 string with a hyperlink around CJK text
      expect(Bun.stringWidth("\x1b]8;;https://bun.com\x07文档\x1b]8;;\x07")).toBe(4);
    });
  });

  describe("emoji and ZWJ sequences", () => {
    test("emoji widths", () => {
      expect(Bun.stringWidth("😀")).toBe(2);
      expect(Bun.stringWidth("👩‍👩‍👧‍👦")).toBe(2); // family ZWJ sequence
      expect(Bun.stringWidth("🏳️‍🌈")).toBe(2); // flag + VS16 + ZWJ
      expect(Bun.stringWidth("🇺🇸")).toBe(2); // regional indicator pair
      expect(Bun.stringWidth("👍🏽")).toBe(2); // skin tone modifier
      expect(Bun.stringWidth("1️⃣")).toBe(2); // keycap
    });

    test("emoji embedded in long ASCII runs", () => {
      expect(Bun.stringWidth(repeat("a", 40) + "😀" + repeat("b", 40))).toBe(82);
      expect(Bun.stringWidth("👩‍👩‍👧‍👦".repeat(10))).toBe(20);
      expect(Bun.stringWidth("ok 👍🏽 done, 🇺🇸 flag")).toBe(19);
    });
  });

  describe("East Asian wide characters", () => {
    test("wide and fullwidth", () => {
      expect(Bun.stringWidth("中文")).toBe(4);
      expect(Bun.stringWidth("こんにちは")).toBe(10);
      expect(Bun.stringWidth("안녕하세요")).toBe(10);
      expect(Bun.stringWidth("Ａ")).toBe(2); // fullwidth latin
      expect(Bun.stringWidth("ｱｲｳ")).toBe(3); // halfwidth katakana
      expect(Bun.stringWidth("ノード.js")).toBe(9);
      expect(Bun.stringWidth("中" + repeat("a", 64) + "文")).toBe(68);
    });

    test("ambiguous-width characters", () => {
      expect(Bun.stringWidth("★☆")).toBe(2);
      expect(Bun.stringWidth("★☆", { ambiguousIsNarrow: false })).toBe(4);
      expect(Bun.stringWidth("±", { ambiguousIsNarrow: true })).toBe(1);
    });
  });
});

test("options lookup ignores Object.prototype pollution", () => {
  try {
    (Object.prototype as any).countAnsiEscapeCodes = true;
    (Object.prototype as any).ambiguousIsNarrow = false;
    expect(Bun.stringWidth("\x1b[31mhello\x1b[39m", {})).toBe(5);
    expect(Bun.stringWidth("★", {})).toBe(1);
    // An explicit own property still wins.
    expect(Bun.stringWidth("\x1b[31mhello\x1b[39m", { countAnsiEscapeCodes: true })).toBe(13);
    // Inherited properties from a non-Object.prototype prototype are honored,
    // same as the previous implementation.
    expect(Bun.stringWidth("\x1b[31mhello\x1b[39m", { __proto__: { countAnsiEscapeCodes: true } } as any)).toBe(13);
  } finally {
    delete (Object.prototype as any).countAnsiEscapeCodes;
    delete (Object.prototype as any).ambiguousIsNarrow;
  }
});

// The Latin-1 ANSI-excluding width walks 16-64 byte SIMD chunks counting
// printable bytes until the next escape introducer, then hands it to the
// shared recognizer (ANSI::consumeANSI). These tests pin its behavior at and
// around the chunk boundaries and against a scalar reference implementation
// of the ECMA-48 escape grammar:
//   CSI   (ESC [ | 0x9B) <params> <final byte in [0x40, 0x7E]>           -> zero width
//   OSC   (ESC ] | 0x9D) <payload> (BEL | 0x9C | ESC \)                  -> zero width
//   DCS/SOS/PM/APC  (ESC (P|X|^|_) | 0x90/0x98/0x9E/0x9F) <payload> ST    -> zero width
//   nF        ESC <0x20-0x2F> <one byte>                                -> zero width
//   Fe/Fs/Fp  ESC <final byte in [0x30, 0x7E]>                          -> zero width
//   ESC followed by anything else  -> only the ESC itself is dropped
//   ESC / CAN / SUB / C1 ST inside a sequence abort it (VT500)          -> zero width
//   C0 controls, DEL, other C1 controls, soft hyphen (0xAD)             -> zero width
describe("ANSI escapes across SIMD chunk boundaries", () => {
  const ESC = "\x1b";
  const rep = (fill: string, count: number) => Buffer.alloc(fill.length * count, fill, "latin1").toString("latin1");

  const isEscapeIntroducer = (c: number) =>
    c === 0x1b || c === 0x9b || c === 0x9d || c === 0x90 || c === 0x98 || c === 0x9e || c === 0x9f;

  // Index just past the escape-sequence run starting at `i`, or `i` when there
  // is no sequence there. Mirrors ANSI::consumeANSI() in ANSIHelpers.h, entered
  // at an introducer the way the Bun.stringWidth driver enters it.
  function consumeAnsi(str: string, i: number): number {
    const len = str.length;
    let state = "start";
    for (let k = i; k < len; k++) {
      const c = str.charCodeAt(k);
      switch (state) {
        case "start":
          if (c === 0x1b) state = "gotEsc";
          else if (c === 0x9b) state = "inCsi";
          else if (c === 0x9d) state = "inOsc";
          else if (c === 0x90 || c === 0x98 || c === 0x9e || c === 0x9f) state = "needSt";
          else return k;
          break;
        case "inOscGotEsc":
        case "needStGotEsc":
          // ESC \ is ST; any other byte follows an ESC that aborted the
          // payload and re-introduced a sequence, so process it in gotEsc.
          if (c === 0x5c /* \ */) {
            state = "start";
            break;
          }
          state = "gotEsc";
        // falls through
        case "gotEsc":
          if (c === 0x1b)
            break; // ESC restarts the sequence
          else if (c === 0x18 || c === 0x1a || c === 0x9c)
            state = "start"; // CAN/SUB/C1 ST abort to ground, byte consumed
          else if (c === 0x5b /* [ */) state = "inCsi";
          else if (c === 0x5d /* ] */) state = "inOsc";
          else if (c === 0x50 /* P */ || c === 0x58 /* X */ || c === 0x5e /* ^ */ || c === 0x5f /* _ */)
            state = "needSt";
          else if (c >= 0x20 && c <= 0x2f) state = "ignoreNextChar";
          else if (c >= 0x30 && c <= 0x7e) state = "start";
          else return k;
          break;
        case "ignoreNextChar":
          state = c === 0x1b ? "gotEsc" : "start"; // ESC aborts the nF sequence
          break;
        case "inCsi": {
          // Final byte in [0x40, 0x7E], or an aborting ESC / CAN / SUB / C1 ST.
          let t = k;
          while (t < len) {
            const u = str.charCodeAt(t);
            if ((u >= 0x40 && u <= 0x7e) || u === 0x1b || u === 0x18 || u === 0x1a || u === 0x9c) break;
            t++;
          }
          if (t >= len) return len;
          k = t;
          state = str.charCodeAt(t) === 0x1b ? "gotEsc" : "start";
          break;
        }
        case "inOsc":
        case "needSt": {
          // Payload ends at BEL (OSC only), C1 ST, ESC, or an aborting CAN/SUB.
          const osc = state === "inOsc";
          let t = k;
          while (t < len) {
            const u = str.charCodeAt(t);
            if ((osc && u === 0x07) || u === 0x9c || u === 0x1b || u === 0x18 || u === 0x1a) break;
            t++;
          }
          if (t >= len) return len;
          k = t;
          state = str.charCodeAt(t) === 0x1b ? (osc ? "inOscGotEsc" : "needStGotEsc") : "start";
          break;
        }
      }
    }
    return len;
  }

  function referenceWidthExcludeAnsiLatin1(str: string): number {
    let width = 0;
    let i = 0;
    while (i < str.length) {
      const c = str.charCodeAt(i);
      if (isEscapeIntroducer(c)) {
        i = consumeAnsi(str, i);
        continue;
      }
      width += c >= 0x20 && !(c >= 0x7f && c <= 0x9f) && c !== 0xad ? 1 : 0;
      i++;
    }
    return width;
  }

  const expectMatchesReference = (str: string) => {
    expect(Bun.stringWidth(str)).toBe(referenceWidthExcludeAnsiLatin1(str));
  };

  test("plain ASCII around chunk-size lengths", () => {
    for (const n of [15, 16, 17, 31, 32, 33, 63, 64, 65, 127, 128, 129, 255, 256, 257]) {
      expect(Bun.stringWidth(rep("a", n))).toBe(n);
    }
  });

  test("SGR sequences at every offset across a chunk boundary", () => {
    // Slide a short SGR pair across positions 0..192 so the ESC, the '[', the
    // parameters and the final byte each land on 16/32/64-byte boundaries.
    for (let pad = 0; pad <= 192; pad++) {
      const str = rep("a", pad) + `${ESC}[31m` + "bcd" + `${ESC}[0m` + rep("e", 8);
      expect(Bun.stringWidth(str)).toBe(pad + 3 + 8);
    }
  });

  test("C1 CSI and ST-terminated sequences at every offset across a chunk boundary", () => {
    for (let pad = 0; pad <= 192; pad++) {
      expect(Bun.stringWidth(rep("a", pad) + "\x9B31m" + "bcd" + "\x9B0m" + rep("e", 8))).toBe(pad + 3 + 8);
      expect(Bun.stringWidth(rep("a", pad) + "\x9D0;t\x07" + rep("e", 8))).toBe(pad + 8);
      expect(Bun.stringWidth(rep("a", pad) + `${ESC}P+q${ESC}\\` + rep("e", 8))).toBe(pad + 8);
      expect(Bun.stringWidth(rep("a", pad) + "\x90+q\x9C" + rep("e", 8))).toBe(pad + 8);
      expectMatchesReference(rep("a", pad) + "\x9B31mbcd\x9B0m" + rep("e", 8));
    }
  });

  test("long ST-terminated payload spanning many chunks", () => {
    const payload = rep("x", 300);
    for (const [open, close] of [
      [`${ESC}P`, `${ESC}\\`],
      ["\x90", "\x9C"],
      ["\x9F", `${ESC}\\`],
    ] as const) {
      const seq = open + payload + close;
      expect(Bun.stringWidth(rep("a", 70) + seq + rep("b", 70))).toBe(140);
    }
  });

  test("OSC hyperlink payload spanning many chunks", () => {
    const url = "https://example.com/" + rep("x", 300);
    for (const terminator of ["\x07", `${ESC}\\`, "\x9c"]) {
      const link = `${ESC}]8;;${url}${terminator}click here${ESC}]8;;${terminator}`;
      expect(Bun.stringWidth(link)).toBe("click here".length);
      // And with text before/after whose width must still be counted.
      expect(Bun.stringWidth(rep("a", 70) + link + rep("b", 70))).toBe(70 + "click here".length + 70);
    }
  });

  test("ESC ST terminator straddling a chunk boundary", () => {
    // Position the two-byte "ESC \" OSC terminator so it straddles 64-byte
    // boundaries (ESC at 63, '\' at 64, etc.).
    for (let pad = 50; pad <= 80; pad++) {
      const str = rep("a", 10) + `${ESC}]8;;${rep("u", pad)}${ESC}\\done`;
      expect(Bun.stringWidth(str)).toBe(10 + 4);
      expectMatchesReference(str);
    }
  });

  test("dense SGR runs (bash prompt shape)", () => {
    const unit = `${ESC}[31mword${ESC}[0m ${ESC}[32mword${ESC}[0m ${ESC}[33mword${ESC}[0m`;
    for (const n of [1, 3, 10, 100, 500]) {
      const str = rep(unit, n);
      // "word word word" = 14 visible columns per unit (incl. two spaces).
      expect(Bun.stringWidth(str)).toBe(14 * n);
    }
  });

  test("truecolor SGR parameters crossing chunk boundaries", () => {
    const unit = `${ESC}[38;2;255;128;64mhello${ESC}[39m`;
    for (const n of [1, 2, 5, 50, 200]) {
      expect(Bun.stringWidth(rep(unit, n))).toBe(5 * n);
    }
  });

  test("unterminated sequences at the end of long strings", () => {
    expect(Bun.stringWidth(rep("a", 100) + `${ESC}[31;38;2;1;2;3`)).toBe(100);
    expect(Bun.stringWidth(rep("a", 100) + `${ESC}]0;title with no terminator`)).toBe(100);
    expect(Bun.stringWidth(rep("a", 100) + ESC)).toBe(100);
    expect(Bun.stringWidth(rep("a", 63) + ESC)).toBe(63);
    expect(Bun.stringWidth(rep("a", 64) + ESC)).toBe(64);
    expect(Bun.stringWidth(rep("a", 100) + `${ESC}[`)).toBe(100);
    expect(Bun.stringWidth(rep("a", 63) + `${ESC}[`)).toBe(63);
    expect(Bun.stringWidth(rep("a", 100) + `${ESC}]`)).toBe(100);
  });

  test("ESC followed by a final byte is a two-byte escape", () => {
    // Anything in [0x30, 0x7E] terminates the sequence, so both bytes go away.
    expect(Bun.stringWidth(`${ESC}A`)).toBe(0);
    expect(Bun.stringWidth(rep("a", 63) + `${ESC}A` + rep("b", 10))).toBe(63 + 10);
    expect(Bun.stringWidth(rep(`${ESC}a`, 100))).toBe(0);
    // ESC ESC [1m : the first ESC is dropped, the second starts a CSI.
    expect(Bun.stringWidth(`${ESC}${ESC}[1mx${ESC}[0m`)).toBe(1);
    // Everything else: only the ESC is dropped.
    expect(Bun.stringWidth(rep("a", 63) + `${ESC}\x1fb`)).toBe(63 + 1);
    expectMatchesReference(rep("a", 63) + `${ESC}A` + rep("b", 10));
  });

  test("two-byte and nF escape forms", () => {
    // DECSC/DECRC, RIS, charset designation, DECALN, keypad mode: the forms
    // terminfo emits for sc/rc/rmacs/smkx, which show up verbatim in captured
    // less/ncurses output.
    expect(Bun.stringWidth(`${ESC}7hi${ESC}8`)).toBe(2); // DECSC / DECRC
    expect(Bun.stringWidth(`ab${ESC}cd`)).toBe(3); // RIS
    expect(Bun.stringWidth(`ab${ESC}(Bcd`)).toBe(4); // charset designation
    expect(Bun.stringWidth(`ab${ESC}#8d`)).toBe(3); // DECALN
    expect(Bun.stringWidth(`a${ESC}=b${ESC}>c`)).toBe(3); // keypad application/numeric
    // ESC P / X / ^ / _ introduce the ST-terminated control strings.
    expect(Bun.stringWidth(`a${ESC}Pqfoo${ESC}\\b`)).toBe(2); // DCS ... ST
    expect(Bun.stringWidth(`a${ESC}_payload\x9cb`)).toBe(2); // APC ... C1 ST
    expect(Bun.stringWidth(`a${ESC}Xpayload${ESC}\\b`)).toBe(2); // SOS ... ST
    // C1 CSI: 'b' is the final byte, so the whole `\x9b b` pair is a sequence.
    expect(Bun.stringWidth("a\x9bb")).toBe(1);
    // Standalone C1 ST (no string open) is an ordinary zero-width control.
    expect(Bun.stringWidth("a\x9cb")).toBe(2);
    for (const s of [`${ESC}7hi${ESC}8`, `ab${ESC}(Bcd`, `a${ESC}_payload\x9cb`, "a\x9bb"]) {
      expectMatchesReference(s);
    }
  });

  test("two-byte and nF escapes at every offset across a chunk boundary", () => {
    for (let pad = 0; pad <= 70; pad++) {
      for (const esc of [`${ESC}7`, `${ESC}c`, `${ESC}(B`, `${ESC}#8`]) {
        const str = rep("a", pad) + esc + rep("b", 8);
        expect(Bun.stringWidth(str)).toBe(pad + 8);
      }
    }
  });

  // ESC aborts an in-progress sequence and re-introduces a new one, and
  // CAN/SUB/C1 ST abort to ground (VT500). Terminal-truth for the four below
  // is "textmore", "text", "abmcd" and "abmcd".
  test("ESC, CAN and C1 ST abort an in-progress sequence (VT500)", () => {
    expect(Bun.stringWidth(`${ESC}[31;${ESC}[32m`)).toBe(0); // ESC aborts an in-progress sequence (VT500)
    expect(Bun.stringWidth(`text${ESC}[3${ESC}[0mmore`)).toBe(8); // ESC inside CSI parameters
    expect(Bun.stringWidth(`${ESC}]0;title${ESC}[31mtext${ESC}[0m`)).toBe(4); // ESC inside an OSC payload
    expect(Bun.stringWidth(`ab${ESC}[31\x18mcd`)).toBe(5); // CAN inside CSI parameters, itself consumed
    expect(Bun.stringWidth(`ab${ESC}[31\x9cmcd`)).toBe(5); // C1 ST inside CSI parameters, itself consumed
    expect(Bun.stringWidth("ab\x9b31\x9cmcd")).toBe(5); // C1 ST inside a C1 CSI
    for (const s of [
      `${ESC}[31;${ESC}[32m`,
      `text${ESC}[3${ESC}[0mmore`,
      `${ESC}]0;title${ESC}[31mtext${ESC}[0m`,
      `ab${ESC}[31\x18mcd`,
      `ab${ESC}[31\x9cmcd`,
      rep("a", 60) + `${ESC}[31;${ESC}[32m` + rep("b", 60),
    ]) {
      expectMatchesReference(s);
    }
  });

  test("abort semantics at every offset across a chunk boundary", () => {
    // The aborting ESC / CAN / SUB / C1 ST and the sequence it aborts each land
    // on 16/32/64-byte boundaries, including a CSI carried across chunks.
    for (let pad = 0; pad <= 130; pad++) {
      const cases = [
        [rep("a", pad) + `${ESC}[3${ESC}[0m` + rep("e", 8), pad + 8],
        [rep("a", pad) + `${ESC}]0;t${ESC}[31mxy${ESC}[0m` + rep("e", 8), pad + 2 + 8],
        [rep("a", pad) + `${ESC}[31\x18` + rep("e", 8), pad + 8],
        [rep("a", pad) + `${ESC}[31\x1a` + rep("e", 8), pad + 8],
        [rep("a", pad) + `${ESC}[31\x9c` + rep("e", 8), pad + 8],
        [rep("a", pad) + `${ESC}]0;title\x18` + rep("e", 8), pad + 8],
        [rep("a", pad) + `${ESC}P+q\x18` + rep("e", 8), pad + 8],
        [rep("a", pad) + `${ESC}(${ESC}[31m` + rep("e", 8), pad + 8],
      ] as const;
      for (const [str, width] of cases) {
        expect(Bun.stringWidth(str)).toBe(width);
        expectMatchesReference(str);
      }
    }
  });

  // Bun.stringWidth, Bun.stripANSI and Bun.sliceAnsi share one notion of
  // where an aborted sequence ends, so their widths and slices agree.
  test("stringWidth, stripANSI and sliceAnsi agree on aborted sequences", () => {
    const cases = [`text${ESC}[3${ESC}[0mmore`, `${ESC}]0;title${ESC}[31mtext${ESC}[0m`, `ab${ESC}[31\x18mcd`];
    for (const s of cases) {
      const w = Bun.stringWidth(s);
      expect({
        s,
        viaStrip: Bun.stringWidth(Bun.stripANSI(s)),
        viaSlice: Bun.stringWidth(Bun.sliceAnsi(s, -w)),
      }).toEqual({ s, viaStrip: w, viaSlice: w });
    }
  });

  test("Latin-1 high bytes, C1 controls and soft hyphen mixed with escapes", () => {
    // é (0xE9) is width 1, soft hyphen (0xAD) and C1 control (0x85) are width 0.
    const latin1 = "caf\xe9\xad\x85!";
    expect(Bun.stringWidth(latin1)).toBe(5);
    const str = rep(latin1, 40) + `${ESC}[31m` + rep(latin1, 40) + `${ESC}[0m`;
    expect(Bun.stringWidth(str)).toBe(5 * 80);
    expectMatchesReference(str);
  });

  test("matches the scalar reference on pseudo-random escape-heavy inputs", () => {
    // Deterministic LCG so failures are reproducible.
    let seed = 0x12345678;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    const alphabet = "\x1b[]m;19aZ \x07\x9c\\\xad\x01\x18\x1a\x7f\x80\x9f\xa0\xe9\xff@~?K\x9b\x9d\x90\x98PX^_(#c7";
    const mismatches: string[] = [];
    for (let iter = 0; iter < 500; iter++) {
      const len = next() % 300;
      let chars = "";
      for (let k = 0; k < len; k++) chars += alphabet[next() % alphabet.length];
      const width = Bun.stringWidth(chars);
      const expected = referenceWidthExcludeAnsiLatin1(chars);
      if (width !== expected) {
        // Record the exact input bytes so failures are reproducible.
        const dump = [...chars].map(c => "\\x" + c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
        mismatches.push(`${dump}: got ${width}, expected ${expected}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  test("countAnsiEscapeCodes: true still counts escape bytes", () => {
    const unit = `${ESC}[31mword${ESC}[0m`;
    // "word" (4) plus the non-control bytes of the two escape sequences
    // ("[31m" and "[0m" = 7); the ESC bytes themselves are control characters
    // and contribute 0 even when counted.
    expect(Bun.stringWidth(unit, { countAnsiEscapeCodes: true })).toBe(11);
    expect(Bun.stringWidth(rep(unit, 100), { countAnsiEscapeCodes: true })).toBe(1100);
  });
});

// The UTF-16 path has a SIMD bulk kernel (highway_visible_utf16_width) that
// counts runs of codepoints which are always their own grapheme cluster with
// a fixed width, bailing to the scalar grapheme loop for everything else.
// These tests pin the kernel's allowlisted ranges against the scalar
// classifier and the clustering behavior at the bail points.
describe("UTF-16 bulk width fast path", () => {
  // Must mirror the ranges in ClassifyBulkUTF16Unit (highway_strings.cpp).
  const narrowRanges: Array<[number, number]> = [
    [0x20, 0x7e],
    [0xa0, 0x2ff],
    [0x370, 0x482],
    [0x48a, 0x52f],
  ];
  const narrowExcluded = new Set([0xa9, 0xad, 0xae]);
  const wideRanges: Array<[number, number]> = [
    [0x3041, 0x3096],
    [0x309b, 0x30ff],
    [0x3400, 0x4dbf],
    [0x4e00, 0x9fff],
    [0xac00, 0xd7a3],
    [0xff01, 0xff60],
  ];

  test("every codepoint in the allowlisted ranges has the expected fixed width", () => {
    const mismatches: string[] = [];
    const checkRange = (lo: number, hi: number, perChar: number, excluded?: Set<number>) => {
      // Walk the range in chunks so every codepoint passes through the SIMD
      // path, and the chunk sum catches any unexpected cluster joining.
      const chunkSize = 256;
      for (let start = lo; start <= hi; start += chunkSize) {
        const end = Math.min(start + chunkSize - 1, hi);
        let chars = "";
        let expected = 0;
        for (let cp = start; cp <= end; cp++) {
          if (excluded?.has(cp)) continue;
          chars += String.fromCharCode(cp);
          expected += perChar;
        }
        const got = Bun.stringWidth(chars);
        if (got !== expected) {
          mismatches.push(`U+${start.toString(16)}..U+${end.toString(16)}: got ${got}, expected ${expected}`);
        }
      }
    };
    for (const [lo, hi] of narrowRanges) checkRange(lo, hi, 1, narrowExcluded);
    for (const [lo, hi] of wideRanges) checkRange(lo, hi, 2);
    expect(mismatches).toEqual([]);
  });

  test("excluded and boundary codepoints keep their scalar behavior", () => {
    expect(Bun.stringWidth("\xa9")).toBe(1); // © is excluded from the bulk path (Extended_Pictographic)
    expect(Bun.stringWidth("\xae")).toBe(1); // ®
    expect(Bun.stringWidth("\xad")).toBe(0); // soft hyphen
    expect(Bun.stringWidth("a\xa9b\xaec\xadd")).toBe(6);
    expect(Bun.stringWidth("\u0483")).toBe(0); // combining Cyrillic titlo (Mn, just past 0x482, excluded from bulk)
    expect(Bun.stringWidth("я\u0483")).toBe(1); // joins the previous letter as one cluster
    expect(Bun.stringWidth("\u3099")).toBe(0); // combining voicing mark alone (zero-width Mn, joins nothing)
    expect(Bun.stringWidth("\u3040")).toBe(1); // unassigned, just below the hiragana letters range
    expect(Bun.stringWidth("\u309a")).toBe(0); // combining semi-voiced mark (zero-width Mn, excluded from bulk)
  });

  test("clusters still join across the bulk/scalar boundary", () => {
    // Combining voicing mark right after a bulk kana run: joins the last kana.
    expect(Bun.stringWidth("か\u3099")).toBe(2);
    expect(Bun.stringWidth("こんにちはか\u3099")).toBe(12);
    // Jamo T after a Hangul LV syllable: one cluster.
    expect(Bun.stringWidth("가\u11a8")).toBe(2);
    expect(Bun.stringWidth("각")).toBe(2);
    // Combining acute after a CJK ideograph at the end of a long bulk run.
    expect(Bun.stringWidth("中".repeat(40) + "\u0301")).toBe(80);
    // Combining mark after an ASCII run inside a longer mixed string.
    expect(Bun.stringWidth("abc中で🎉x\u0301y")).toBe(11);
    // ZWJ emoji sequence immediately after a CJK run.
    expect(Bun.stringWidth("日本👩‍👩‍👧‍👦")).toBe(6);
  });

  test("matches expected widths for common non-ASCII scripts", () => {
    expect(Bun.stringWidth("αβγδε")).toBe(5);
    expect(Bun.stringWidth("привет")).toBe(6);
    expect(Bun.stringWidth("ĀāĂăĄą")).toBe(6);
    expect(Bun.stringWidth("ɐɑɒɓɔɕ")).toBe(6);
    expect(Bun.stringWidth("\u309b\u309c\u309d\u30fb\u30fc")).toBe(10);
    expect(Bun.stringWidth("ＡＢＣ！")).toBe(8);
    expect(Bun.stringWidth("㐀㐁㐂")).toBe(6);
    expect(Bun.stringWidth("こんにちは世界".repeat(64))).toBe(14 * 64);
    expect(Bun.stringWidth("한국어 텍스트")).toBe(13);
  });

  test("ambiguousIsNarrow: false skips the bulk path but stays correct", () => {
    expect(Bun.stringWidth("αβγδε", { ambiguousIsNarrow: false })).toBe(10);
    expect(Bun.stringWidth("привет", { ambiguousIsNarrow: false })).toBe(12);
    expect(Bun.stringWidth("abcαβγ中中", { ambiguousIsNarrow: false })).toBe(3 + 6 + 4);
    expect(Bun.stringWidth("abcαβγ中中")).toBe(3 + 3 + 4);
    // CJK is unambiguous: same width either way.
    expect(Bun.stringWidth("こんにちは世界", { ambiguousIsNarrow: false })).toBe(14);
  });

  test("escape sequences interleaved with bulk runs", () => {
    expect(Bun.stringWidth("\x1b[31m中文\x1b[0m")).toBe(4);
    expect(Bun.stringWidth("中文\x1b[31m中文\x1b[0m中文")).toBe(12);
    expect(Bun.stringWidth("\x1b]8;;https://example.com\x07日本語リンク\x1b]8;;\x07")).toBe(12);
    expect(Bun.stringWidth("αβ\x1b[38;2;255;0;0mγδ\x1b[0m中", { countAnsiEscapeCodes: false })).toBe(6);
    expect(Bun.stringWidth("\x1b[31m中文\x1b[0m", { countAnsiEscapeCodes: true })).toBe(4 + 7);
  });

  test("long mixed-script strings match the sum of their parts", () => {
    const part = "hello 世界 Ωμέγα Привет ｗｉｄｅ 가나다 ";
    const partWidth = Bun.stringWidth(part);
    expect(partWidth).toBe(40); // 6 + 5 + 6 + 7 + 9 + 7
    expect(Bun.stringWidth(part.repeat(50))).toBe(partWidth * 50);
  });
});

describe("width tables: combining marks, jamo, U16/17 emoji, VS after zero-width, ambiguous latin1", () => {
  const widths = (cps: number[], options?: { ambiguousIsNarrow: boolean }) =>
    cps.map(cp => Bun.stringWidth(String.fromCodePoint(cp), options));

  test("nonspacing and enclosing marks (Mn/Me) are zero-width in every script", () => {
    // glibc wcwidth() returns 0 for every General_Category Mn/Me codepoint.
    const marks = [
      // Arabic harakat and Koranic marks
      0x0610, 0x061a, 0x064b, 0x0651, 0x0655, 0x065f, 0x0670, 0x06d6, 0x06dc, 0x06e4, 0x06ed,
      // Hebrew accents and niqqud
      0x0591, 0x05b0, 0x05bc, 0x05bd, 0x05bf, 0x05c1, 0x05c7,
      // Syriac, Thaana, Samaritan
      0x0730, 0x074a, 0x07a6, 0x07b0, 0x0816, 0x082d,
      // Tibetan, Sinhala
      0x0f71, 0x0f7e, 0x0f80, 0x0f84, 0x0dca, 0x0dd2, 0x0dd4, 0x0dd6,
      // Myanmar, Khmer
      0x102d, 0x1030, 0x1039, 0x103a, 0x17b4, 0x17b5, 0x17c6, 0x17d3,
      // Me (enclosing): Cyrillic hundred-thousands sign, combining Cyrillic ten millions
      0x0488, 0x0489, 0xa670, 0xa671, 0xa672,
      // Supplementary planes: Brahmi vowel signs, musical combining marks, Mende Kikakui
      0x11038, 0x11046, 0x1d167, 0x1d169, 0x1e8d0, 0x1e8d6,
    ];
    expect(widths(marks)).toEqual(marks.map(() => 0));
    expect(widths(marks, { ambiguousIsNarrow: false })).toEqual(marks.map(() => 0));
  });

  test("pointed Arabic / Hebrew / Thaana words count only the base letters", () => {
    // string-width@7 agrees on all four (5, 4, 3, 1).
    expect(Bun.stringWidth("\u0645\u064E\u0631\u0652\u062D\u064E\u0628\u064B\u0627")).toBe(5); // marhaban
    expect(Bun.stringWidth("\u05E9\u05B8\u05C1\u05DC\u05D5\u05B9\u05DD")).toBe(4); // shalom
    expect(Bun.stringWidth("\u078B\u07A8\u0788\u07AC\u0780\u07A8")).toBe(3); // dhivehi
    expect(Bun.stringWidth("\u0065\u0591")).toBe(1); // e + Hebrew accent etnahta
  });

  test("conjoining Hangul jamo (NFD): an L+V(+T) cluster is 2 columns", () => {
    // U+1160-U+11FF (jungseong V, jongseong T) are zero-width; the leading
    // consonant U+1100-U+115F is wide and carries the whole syllable.
    expect(Bun.stringWidth(String.fromCodePoint(0x1112, 0x1161))).toBe(2); // string-width@7: 2
    expect(Bun.stringWidth(String.fromCodePoint(0x1100, 0x1161, 0x11a8))).toBe(2); // L+V+T
    expect(Bun.stringWidth("\uAC01".normalize("NFD"))).toBe(2);
    expect(Bun.stringWidth("\uD55C\uAD6D\uC5B4.txt".normalize("NFD"))).toBe(10); // string-width@7: 10
    expect(Bun.stringWidth("\uD55C\uAD6D\uC5B4.txt")).toBe(10); // NFC unchanged
    // V and T alone contribute nothing; a lone choseong L is still wide.
    const zero = [0x1160, 0x1161, 0x11a8, 0x11ff, 0xd7b0, 0xd7c6, 0xd7cb, 0xd7fb];
    expect(widths(zero)).toEqual(zero.map(() => 0));
    const wide = [0x1100, 0x1112, 0x115f];
    expect(widths(wide)).toEqual(wide.map(() => 2));
    // A trailing jamo T joins a precomposed LV syllable without adding width.
    expect(Bun.stringWidth("\uAC00\u11A8")).toBe(2);
  });

  test("emoji and symbols made wide in Unicode 16/17 are 2 columns", () => {
    // EastAsianWidth.txt (17.0) W entries missing from the Unicode 15.1 data;
    // string-width@7 (get-east-asian-width) reports 2 for all of them.
    const wide = [
      0x1fa89,
      0x1fa8a,
      0x1fa8e,
      0x1fa8f,
      0x1fabe,
      0x1fac6,
      0x1fac8,
      0x1facd,
      0x1fadc,
      0x1fadf,
      0x1fae9,
      0x1faea,
      0x1faef,
      0x1f6d8, // emoji added in Unicode 16.0/17.0
      0x187f8,
      0x187ff,
      0x18d80,
      0x18df2, // Tangut supplement / Khitan small script
      0x2630,
      0x268a,
      0x4dc0,
      0x4dff,
      0x1d300,
      0x1d360, // Yijing / Tai Xuan Jing / counting rods
    ];
    expect(widths(wide)).toEqual(wide.map(() => 2));
    expect(Bun.stringWidth("\u{1FA89}\u{1FADF} ok")).toBe(7);
  });

  test("a variation selector after a zero-width or non-emoji base adds nothing", () => {
    // VS16 only widens a base with the Emoji property; VS15/VS16 never give
    // width to a zero-width base.
    expect(Bun.stringWidth("\u200B\uFE0F")).toBe(0); // ZWSP + VS16 (string-width@7 says 2)
    expect(Bun.stringWidth("\u200B\uFE0E")).toBe(0); // ZWSP + VS15
    expect(Bun.stringWidth("\u200D\uFE0F")).toBe(0); // ZWJ + VS16
    expect(Bun.stringWidth("\u0301\uFE0F")).toBe(0); // lone combining acute + VS16
    expect(Bun.stringWidth("\u00E9\uFE0F")).toBe(1); // \u00E9 + VS16: narrow non-emoji base
    expect(Bun.stringWidth("\u00E9\uFE0E")).toBe(1); // \u00E9 + VS15
    expect(Bun.stringWidth("\u0065\u0301\uFE0F")).toBe(1); // e + combining acute + VS16
    expect(Bun.stringWidth("\u0061\uFE0F")).toBe(1); // a + VS16
    expect(Bun.stringWidth("\u03A9\uFE0F")).toBe(1); // \u03A9 (ambiguous) + VS16, narrow by default
    expect(Bun.stringWidth("\u03A9\uFE0F", { ambiguousIsNarrow: false })).toBe(2);
    // Bases with the Emoji property still upgrade to emoji presentation.
    expect(Bun.stringWidth("\u2600\uFE0F")).toBe(2); // sun
    expect(Bun.stringWidth("\u00A9\uFE0F")).toBe(2); // copyright
    expect(Bun.stringWidth("\u00AE\uFE0F")).toBe(2); // registered
    expect(Bun.stringWidth("\u2122\uFE0F")).toBe(2); // trademark
    // Wide bases stay wide regardless of the selector.
    expect(Bun.stringWidth("\u4E2D\uFE0F")).toBe(2);
    expect(Bun.stringWidth("\u4E2D\uFE0E")).toBe(2);
  });

  test("ambiguousIsNarrow: false applies on the Latin-1 (8-bit) path", () => {
    // \u00E9 (LATIN SMALL LETTER E WITH ACUTE) is East Asian Ambiguous.
    // string-width@7: 4 default / 5 wide.
    const cafe = "\u0063\u0061\u0066\u00E9";
    expect(Bun.stringWidth(cafe)).toBe(4);
    expect(Bun.stringWidth(cafe, { ambiguousIsNarrow: false })).toBe(5);
    // Same answer whether the string is stored as Latin-1 or forced onto the
    // UTF-16 path by an unrelated zero-width character.
    expect(Bun.stringWidth(cafe + "\uFEFF", { ambiguousIsNarrow: false })).toBe(5);
    const signs = "\u00B1\u00D7\u00F7\u00A7\u00B0"; // plus-minus, times, divide, section, degree
    expect(Bun.stringWidth(signs)).toBe(5);
    expect(Bun.stringWidth(signs, { ambiguousIsNarrow: false })).toBe(10); // string-width@7: 10
    // The visible Latin-1 range (U+00A0-U+00FF minus the emoji \u00A9 \u00AE and the
    // zero-width soft hyphen): 93 codepoints, 42 of them East Asian Ambiguous.
    let latin1 = "";
    for (let cp = 0xa0; cp <= 0xff; cp++) {
      if (cp !== 0xa9 && cp !== 0xad && cp !== 0xae) latin1 += String.fromCharCode(cp);
    }
    expect(Bun.stringWidth(latin1)).toBe(93); // string-width@7: 93
    expect(Bun.stringWidth(latin1, { ambiguousIsNarrow: false })).toBe(135); // string-width@7: 135
    expect(Bun.stringWidth(latin1 + "\uFEFF", { ambiguousIsNarrow: false })).toBe(135);
    // Soft hyphen is East Asian Ambiguous but stays zero-width in both modes.
    expect(Bun.stringWidth("\u0061\u00AD\u0062", { ambiguousIsNarrow: false })).toBe(2);
    // Escape sequences stay invisible on the ambiguous-wide Latin-1 path.
    const wrapped = "\u001B" + "[31m" + "\u00B1\u00A7" + "\u001B" + "[0m";
    expect(Bun.stringWidth(wrapped, { ambiguousIsNarrow: false })).toBe(4);
    expect(Bun.stringWidth(wrapped, { ambiguousIsNarrow: false, countAnsiEscapeCodes: true })).toBe(11);
  });
});
