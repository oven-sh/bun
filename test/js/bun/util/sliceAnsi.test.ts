import { describe, expect, test } from "bun:test";

// Constants matching the upstream slice-ansi test suite
const ESCAPE = "\u001B";
const ANSI_BELL = "\u0007";
const ANSI_STRING_TERMINATOR = `${ESCAPE}\\`;
const C1_OSC = "\u009D";
const C1_STRING_TERMINATOR = "\u009C";

function createHyperlink(text: string, url: string, terminator = ANSI_BELL, closeTerminator = terminator) {
  return `${ESCAPE}]8;;${url}${terminator}${text}${ESCAPE}]8;;${closeTerminator}`;
}

function stripOscHyperlinks(string: string) {
  const hyperlinkPrefixes = [`${ESCAPE}]8;`, `${C1_OSC}8;`];
  let output = "";
  let index = 0;

  while (index < string.length) {
    const hyperlinkPrefix = hyperlinkPrefixes.find(prefix => string.startsWith(prefix, index));
    if (!hyperlinkPrefix) {
      output += string[index];
      index++;
      continue;
    }

    const uriStart = string.indexOf(";", index + hyperlinkPrefix.length);
    if (uriStart === -1) {
      break;
    }

    let sequenceIndex = uriStart + 1;
    while (sequenceIndex < string.length) {
      if (string[sequenceIndex] === ANSI_BELL) {
        index = sequenceIndex + 1;
        break;
      }

      if (string[sequenceIndex] === ESCAPE && string[sequenceIndex + 1] === "\\") {
        index = sequenceIndex + 2;
        break;
      }

      if (string[sequenceIndex] === C1_STRING_TERMINATOR) {
        index = sequenceIndex + 1;
        break;
      }

      sequenceIndex++;
    }

    if (sequenceIndex >= string.length) {
      break;
    }
  }

  return output;
}

function stripForVisibleComparison(string: string) {
  return Bun.stripANSI(stripOscHyperlinks(string));
}

function assertVisibleSliceMatchesNative(input: string, start: number, end: number) {
  const nativeSlice = stripForVisibleComparison(input).slice(start, end);
  const ansiSlice = stripForVisibleComparison(Bun.sliceAnsi(input, start, end));
  expect(ansiSlice).toBe(nativeSlice);
}

function styleScalarAtIndex(string: string, scalarIndex: number, open: string, close: string) {
  let output = "";
  let index = 0;

  for (const scalar of string) {
    output += index === scalarIndex ? open + scalar + close : scalar;
    index++;
  }

  return output;
}

function hyperlinkScalarAtIndex(string: string, scalarIndex: number, url: string) {
  let output = "";
  let index = 0;

  for (const scalar of string) {
    output += index === scalarIndex ? createHyperlink(scalar, url) : scalar;
    index++;
  }

  return output;
}

function assertSlicesMatchPlainReference(plain: string, styled: string, maximumIndex = 6) {
  for (let start = 0; start <= maximumIndex; start++) {
    for (let end = start; end <= maximumIndex; end++) {
      const expected = stripForVisibleComparison(Bun.sliceAnsi(plain, start, end));
      const actual = stripForVisibleComparison(Bun.sliceAnsi(styled, start, end));
      expect(actual).toBe(expected);
    }
  }
}

// ======================================================================
// Tests ported from https://github.com/chalk/slice-ansi/blob/main/test.js
// ======================================================================

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

    test("negative start keeps trailing zero-width and ANSI content", () => {
      expect(Bun.sliceAnsi("ab\t", -1)).toBe("b\t");
      expect(Bun.sliceAnsi("ab\u200b", -1)).toBe("b\u200b");
      expect(Bun.sliceAnsi("ab\x1b[31m", -1)).toBe("b\x1b[31m\x1b[39m");
      expect(Bun.sliceAnsi("abc\x1b[1m\x1b[31m", -1)).toBe("c\x1b[1m\x1b[31m\x1b[39m\x1b[22m");
      expect(Bun.sliceAnsi("ab\x1b[0m", -1)).toBe("b\x1b[0m");
      expect(Bun.sliceAnsi("ab\t", -1, 1000)).toBe("b\t");

      // sliceAnsi(s, -k) must match sliceAnsi(s, totalW - k) byte-for-byte
      // whenever the positive form goes through the emit walk (start > 0).
      const cases = [
        "ab\t",
        "ab\u200b",
        "ab\u200b\u200b",
        "ab\x1b[31m",
        "abc\x1b[1m\x1b[31m",
        "\x1b[31mab\x1b[39m\t",
        "ab\x1b[0m",
        "ab\t\u200b\x1b[31m",
      ];
      for (const s of cases) {
        const totalW = Bun.stringWidth(s);
        for (let k = 1; k < totalW; k++) {
          const pos = Bun.sliceAnsi(s, totalW - k);
          expect({ s, k, out: Bun.sliceAnsi(s, -k) }).toEqual({ s, k, out: pos });
          expect({ s, k, out: Bun.sliceAnsi(s, -k, 1000) }).toEqual({ s, k, out: pos });
        }
        // -k clamped to 0: visible content must still include the trailing bytes.
        expect(Bun.stripANSI(Bun.sliceAnsi(s, -1000))).toBe(Bun.stripANSI(s));
      }
    });

    test("negative end strictly before total width still cuts", () => {
      expect(Bun.sliceAnsi("ab\t", 0, -1)).toBe("a");
      expect(Bun.sliceAnsi("ab\x1b[31m", 0, -1)).toBe("a");
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
      expect(Bun.sliceAnsi(input, 0, 5)).toBe("\x1b[31mhello\x1b[39m");
      expect(Bun.sliceAnsi(input, 0, 3)).toBe("\x1b[31mhel\x1b[39m");
      expect(Bun.sliceAnsi(input, 2, 5)).toBe("\x1b[31mllo\x1b[39m");
    });

    test("preserves active styles at slice start", () => {
      const input = "\x1b[31mhello world\x1b[39m";
      expect(Bun.sliceAnsi(input, 6, 11)).toBe("\x1b[31mworld\x1b[39m");
    });

    test("multiple style codes", () => {
      const input = "\x1b[1m\x1b[31mbold red\x1b[39m\x1b[22m";
      expect(Bun.sliceAnsi(input, 0, 4)).toBe("\x1b[1m\x1b[31mbold\x1b[39m\x1b[22m");
      expect(Bun.sliceAnsi(input, 5, 8)).toBe("\x1b[1m\x1b[31mred\x1b[39m\x1b[22m");
    });

    test("ANSI codes in the middle of slice are preserved", () => {
      const input = "he\x1b[31mll\x1b[39mo";
      expect(Bun.sliceAnsi(input, 0, 5)).toBe("he\x1b[31mll\x1b[39mo");
      expect(Bun.sliceAnsi(input, 1, 4)).toBe("e\x1b[31mll\x1b[39m");
    });

    test("style reset (code 0) clears active codes", () => {
      const input = "\x1b[31mred\x1b[0mnormal";
      expect(Bun.sliceAnsi(input, 3, 9)).toBe("normal");
      expect(Bun.sliceAnsi(input, 0, 9)).toBe("\x1b[31mred\x1b[0mnormal");
      expect(Bun.sliceAnsi(input, 0, 3)).toBe("\x1b[31mred\x1b[0m");
    });

    test("handles nested styles", () => {
      const input = "\x1b[1mbold \x1b[31mred\x1b[39m text\x1b[22m";
      expect(Bun.sliceAnsi(input, 5, 8)).toBe("\x1b[1m\x1b[31mred\x1b[39m\x1b[22m");
    });
  });

  // ======================================================================
  // Full-width characters (CJK)
  // ======================================================================

  describe("full-width characters", () => {
    test("CJK characters count as width 2", () => {
      const input = "你好世界";
      expect(Bun.sliceAnsi(input, 0, 2)).toBe("你");
      expect(Bun.sliceAnsi(input, 0, 4)).toBe("你好");
      expect(Bun.sliceAnsi(input, 2, 6)).toBe("好世");
      expect(Bun.sliceAnsi(input, 0, 8)).toBe("你好世界");
    });

    test("mixed ASCII and CJK", () => {
      const input = "a你b好c";
      expect(Bun.sliceAnsi(input, 0, 1)).toBe("a");
      expect(Bun.sliceAnsi(input, 1, 3)).toBe("你");
      expect(Bun.sliceAnsi(input, 3, 4)).toBe("b");
      expect(Bun.sliceAnsi(input, 4, 6)).toBe("好");
      expect(Bun.sliceAnsi(input, 6, 7)).toBe("c");
    });

    test("colored CJK text", () => {
      const input = "\x1b[31m你好\x1b[39m世界";
      expect(Bun.sliceAnsi(input, 0, 4)).toBe("\x1b[31m你好\x1b[39m");
      expect(Bun.sliceAnsi(input, 4, 8)).toBe("世界");
      expect(Bun.sliceAnsi(input, 2, 6)).toBe("\x1b[31m好\x1b[39m世");
    });

    test("Japanese text", () => {
      const input = "日本語テスト";
      expect(Bun.sliceAnsi(input, 0, 4)).toBe("日本");
      expect(Bun.sliceAnsi(input, 4, 8)).toBe("語テ");
    });

    test("Korean text", () => {
      const input = "한국어";
      expect(Bun.sliceAnsi(input, 0, 2)).toBe("한");
      expect(Bun.sliceAnsi(input, 2, 4)).toBe("국");
      expect(Bun.sliceAnsi(input, 4, 6)).toBe("어");
    });

    test("supports fullwidth characters (upstream)", () => {
      expect(Bun.sliceAnsi("안녕하세", 0, 4)).toBe("안녕");
    });

    test("does not lose fullwidth characters", () => {
      expect(Bun.sliceAnsi("古古test", 0)).toBe("古古test");
    });
  });

  // ======================================================================
  // Emoji
  // ======================================================================

  describe("emoji", () => {
    test("basic emoji (width 2)", () => {
      const input = "👋hello";
      expect(Bun.sliceAnsi(input, 0, 2)).toBe("👋");
      expect(Bun.sliceAnsi(input, 2, 7)).toBe("hello");
    });

    test("emoji with skin tone modifier (width 2 as single grapheme)", () => {
      const input = "👋🏽hello";
      expect(Bun.sliceAnsi(input, 0, 2)).toBe("👋🏽");
      expect(Bun.sliceAnsi(input, 2, 7)).toBe("hello");
    });

    test("flag emoji (regional indicators, width 2)", () => {
      const input = "🇺🇸hello";
      expect(Bun.sliceAnsi(input, 0, 2)).toBe("🇺🇸");
      expect(Bun.sliceAnsi(input, 2, 7)).toBe("hello");
    });

    test("ZWJ sequence emoji (width 2)", () => {
      const input = "👨‍👩‍👧‍👦hello";
      expect(Bun.sliceAnsi(input, 0, 2)).toBe("👨‍👩‍👧‍👦");
      expect(Bun.sliceAnsi(input, 2, 7)).toBe("hello");
    });

    test("multiple emoji", () => {
      const input = "👋🎉🚀";
      expect(Bun.sliceAnsi(input, 0, 2)).toBe("👋");
      expect(Bun.sliceAnsi(input, 2, 4)).toBe("🎉");
      expect(Bun.sliceAnsi(input, 4, 6)).toBe("🚀");
    });

    test("colored emoji", () => {
      const input = "\x1b[31m👋\x1b[39mhello";
      expect(Bun.sliceAnsi(input, 0, 2)).toBe("\x1b[31m👋\x1b[39m");
      expect(Bun.sliceAnsi(input, 2, 7)).toBe("hello");
    });

    test("supports unicode surrogate pairs", () => {
      expect(Bun.sliceAnsi("a\uD83C\uDE00BC", 0, 2)).toBe("a\uD83C\uDE00");
    });

    test("does not split regional-indicator flag graphemes", () => {
      const input = "A🇮🇱B";
      expect(Bun.sliceAnsi(input, 1, 2)).toBe("🇮🇱");
      expect(Bun.sliceAnsi(input, 2, 3)).toBe("");
    });

    test("does not split styled regional-indicator flag graphemes", () => {
      const input = "\u001B[31m🇮🇱\u001B[39m";
      expect(Bun.sliceAnsi(input, 0, 1)).toBe(input);
      expect(Bun.sliceAnsi(input, 1, 2)).toBe("");
    });

    test("counts emoji-style graphemes as fullwidth", () => {
      expect(Bun.sliceAnsi("A☺️B", 1, 3)).toBe("☺️");
      expect(Bun.sliceAnsi("A1️⃣B", 1, 3)).toBe("1️⃣");
      // Single (unpaired) regional indicator is width 1 — matches Bun.stringWidth
      expect(Bun.stringWidth("\u{1F1E6}")).toBe(1);
      expect(Bun.sliceAnsi("A\u{1F1E6}B", 1, 2)).toBe("\u{1F1E6}");
    });

    test("does not treat text-presentation pictographs as fullwidth", () => {
      expect(Bun.sliceAnsi("A☺B", 2, 3)).toBe("B");
      expect(Bun.sliceAnsi("A☂B", 2, 3)).toBe("B");
    });

    test("weird null issue", () => {
      const s = '\u001B[1mautotune.flipCoin("easy as") ? 🎂 : 🍰 \u001B[33m★\u001B[39m\u001B[22m';
      const result = Bun.sliceAnsi(s, 38);
      expect(result.includes("null")).toBe(false);
    });
  });

  // ======================================================================
  // Grapheme cluster integrity
  // ======================================================================

  describe("grapheme clusters", () => {
    test("does not split grapheme clusters with combining marks", () => {
      const input = "Ae\u0301B";
      expect(Bun.sliceAnsi(input, 1, 2)).toBe("e\u0301");
      expect(Bun.sliceAnsi(input, 2, 3)).toBe("B");
    });

    test("does not split ZWJ emoji grapheme clusters", () => {
      const input = "A👨‍👩‍👧‍👦B";
      expect(Bun.sliceAnsi(input, 1, 3)).toBe("👨‍👩‍👧‍👦");
      expect(Bun.sliceAnsi(input, 3, 4)).toBe("B");
    });

    test("treats CRLF as a single zero-width grapheme cluster", () => {
      // CRLF is one grapheme cluster (GB3), but both CR and LF are control
      // chars with display width 0 — matches Bun.stringWidth.
      const input = "A\r\nB";
      expect(Bun.stringWidth(input)).toBe(2);
      // [0, 1) = "A" only (CRLF is at col 1 with width 0, doesn't advance)
      expect(Bun.sliceAnsi(input, 0, 1)).toBe("A");
      // [1, 2) = CRLF (width 0) + B (width 1) = everything after A
      expect(Bun.sliceAnsi(input, 1, 2)).toBe("\r\nB");
      // Full range: whole string
      expect(Bun.sliceAnsi(input, 0, 2)).toBe(input);
    });

    test("does not split styled grapheme clusters with combining marks", () => {
      const input = "\u001B[31me\u0301\u001B[39m";
      expect(Bun.sliceAnsi(input, 0, 1)).toBe(input);
      expect(Bun.sliceAnsi(input, 1, 2)).toBe("");
    });

    test("does not split grapheme clusters when styles appear inside combining sequence", () => {
      const input = "\u001B[31me\u001B[39m\u0301B";
      expect(stripForVisibleComparison(Bun.sliceAnsi(input, 0, 1))).toBe("e\u0301");
      expect(stripForVisibleComparison(Bun.sliceAnsi(input, 1, 2))).toBe("B");
    });

    test("does not split Hangul Jamo grapheme clusters when styles appear inside sequence", () => {
      const input = "\u001B[31m\u1100\u001B[39m\u1161B";
      // Decomposed L-jamo (U+1100, wide) + V-jamo (U+1161, zero-width) form one
      // grapheme cluster of width 2 — matches Bun.stringWidth.
      expect(Bun.stringWidth("\u1100\u1161")).toBe(2);
      // [0, 2): the full cluster (normalizes to 가)
      expect(stripForVisibleComparison(Bun.sliceAnsi(input, 0, 2)).normalize("NFC")).toBe("가");
      // B is at column 2
      expect(stripForVisibleComparison(Bun.sliceAnsi(input, 2, 3))).toBe("B");
    });

    test("keeps style opens inside grapheme continuation past end boundary", () => {
      const input = `e\u001B[31m\u0301\u001B[39mB`;
      expect(Bun.sliceAnsi(input, 0, 1)).toBe(`e\u001B[31m\u0301\u001B[39m`);
    });

    test("keeps hyperlink opens inside grapheme continuation past end boundary", () => {
      const open = `${ESCAPE}]8;;https://example.com${ANSI_BELL}`;
      const close = `${ESCAPE}]8;;${ANSI_BELL}`;
      const input = `e${open}\u0301${close}B`;
      expect(Bun.sliceAnsi(input, 0, 1)).toBe(`e${open}\u0301${close}`);
    });

    test("does not split grapheme clusters when styles appear inside ZWJ sequence", () => {
      const input = "\u001B[31m👨\u001B[39m\u200D👩\u200D👧\u200D👦B";
      expect(stripForVisibleComparison(Bun.sliceAnsi(input, 0, 2))).toBe("👨\u200D👩\u200D👧\u200D👦");
      expect(stripForVisibleComparison(Bun.sliceAnsi(input, 2, 3))).toBe("B");
    });

    test("does not split grapheme clusters when styles appear between ZWJ and following pictograph", () => {
      const input = `👨\u200D\u001B[31m👩\u200D👧\u200D👦\u001B[39mB`;
      expect(stripForVisibleComparison(Bun.sliceAnsi(input, 0, 2))).toBe("👨\u200D👩\u200D👧\u200D👦");
      expect(stripForVisibleComparison(Bun.sliceAnsi(input, 2, 3))).toBe("B");
    });

    test("keeps grapheme-safe boundaries with SGR inserted at internal scalar boundaries", () => {
      const graphemes = ["e\u0301", "👨\u200D👩\u200D👧\u200D👦", "👍🏽", "1️⃣", "☺️", "🇮🇱", "가", "👨\u200D👩"];

      for (const grapheme of graphemes) {
        const plain = `A${grapheme}B`;
        const scalarCount = [...grapheme].length;

        for (let scalarIndex = 0; scalarIndex < scalarCount; scalarIndex++) {
          const styled = `A${styleScalarAtIndex(grapheme, scalarIndex, "\u001B[31m", "\u001B[39m")}B`;
          assertSlicesMatchPlainReference(plain, styled);
        }
      }
    });

    test("keeps grapheme-safe boundaries with hyperlink tokens inserted at internal scalar boundaries", () => {
      const graphemes = ["e\u0301", "👨\u200D👩\u200D👧\u200D👦", "1️⃣", "🇮🇱", "가"];

      for (const grapheme of graphemes) {
        const plain = `A${grapheme}B`;
        const scalarCount = [...grapheme].length;

        for (let scalarIndex = 0; scalarIndex < scalarCount; scalarIndex++) {
          const styled = `A${hyperlinkScalarAtIndex(grapheme, scalarIndex, "https://example.com")}B`;
          assertSlicesMatchPlainReference(plain, styled);
        }
      }
    });
  });

  // ======================================================================
  // SGR style handling
  // ======================================================================

  describe("SGR style handling", () => {
    test("doesn't add unnecessary escape codes", () => {
      expect(Bun.sliceAnsi("\u001B[31municorn\u001B[39m", 0, 3)).toBe("\u001B[31muni\u001B[39m");
    });

    test("can slice a normal character before a colored character", () => {
      expect(Bun.sliceAnsi("a\u001B[31mb\u001B[39m", 0, 1)).toBe("a");
    });

    test("can slice a normal character after a colored character", () => {
      expect(Bun.sliceAnsi("\u001B[31ma\u001B[39mb", 1, 2)).toBe("b");
    });

    test("can slice a string styled with both background and foreground", () => {
      expect(Bun.sliceAnsi("\u001B[42m\u001B[30mtest\u001B[39m\u001B[49m", 0, 1)).toBe(
        "\u001B[42m\u001B[30mt\u001B[39m\u001B[49m",
      );
    });

    test("can slice a string styled with modifier", () => {
      expect(Bun.sliceAnsi("\u001B[4mtest\u001B[24m", 0, 1)).toBe("\u001B[4mt\u001B[24m");
    });

    test("can slice a string with unknown ANSI color", () => {
      expect(Bun.sliceAnsi("\u001B[199mTEST\u001B[49m", 0, 4)).toBe("\u001B[199mTEST\u001B[0m");
      expect(Bun.sliceAnsi("\u001B[1001mTEST\u001B[49m", 0, 3)).toBe("\u001B[1001mTES\u001B[0m");
      expect(Bun.sliceAnsi("\u001B[1001mTEST\u001B[49m", 0, 2)).toBe("\u001B[1001mTE\u001B[0m");
    });

    test("supports true color escape sequences", () => {
      expect(
        Bun.sliceAnsi(
          "\u001B[1m\u001B[48;2;255;255;255m\u001B[38;2;255;0;0municorn\u001B[39m\u001B[49m\u001B[22m",
          0,
          3,
        ),
      ).toBe("\u001B[1m\u001B[48;2;255;255;255m\u001B[38;2;255;0;0muni\u001B[39m\u001B[49m\u001B[22m");
    });

    test("supports colon-delimited truecolor SGR syntax", () => {
      expect(Bun.sliceAnsi("\u001B[38:2:255:0:0mred\u001B[39m", 0, 1)).toBe("\u001B[38:2:255:0:0mr\u001B[39m");
    });

    test("doesn't add extra escapes", () => {
      // chalk.black.bgYellow(' RUNS ') = \x1b[43m\x1b[30m RUNS \x1b[39m\x1b[49m (level 1)
      // chalk.green('test') = \x1b[32mtest\x1b[39m
      const bgYellowBlack = "\u001B[43m\u001B[30m RUNS \u001B[39m\u001B[49m";
      const green = "\u001B[32mtest\u001B[39m";
      const output = `${bgYellowBlack}  ${green}`;
      expect(Bun.sliceAnsi(output, 0, 7)).toBe(`${bgYellowBlack} `);
      expect(Bun.sliceAnsi(output, 0, 8)).toBe(`${bgYellowBlack}  `);
      expect(JSON.stringify(Bun.sliceAnsi("\u001B[31m" + output, 0, 4))).toBe(
        JSON.stringify("\u001B[43m\u001B[30m RUN\u001B[39m\u001B[49m"),
      );
    });

    test("closes all styles from multi-parameter SGR code at slice end", () => {
      const input = "\u001B[1;31mX";
      expect(Bun.sliceAnsi(input, 0, 1)).toBe("\u001B[1m\u001B[31mX\u001B[39m\u001B[22m");
    });

    test("preserves multi-parameter close codes after slice boundary", () => {
      const input = "\u001B[31;42mX\u001B[39m\u001B[49m";
      expect(Bun.sliceAnsi(input, 0, 1)).toBe("\u001B[31m\u001B[42mX\u001B[39m\u001B[49m");
    });

    test("retains only background style after foreground closes from multi-parameter SGR", () => {
      const input = "\u001B[31;42mX\u001B[39mY\u001B[49m";
      expect(Bun.sliceAnsi(input, 1, 2)).toBe("\u001B[42mY\u001B[49m");
    });

    test("overrides previous foreground styles cleanly", () => {
      const input = "\u001B[31mA\u001B[32mB";
      expect(Bun.sliceAnsi(input, 0, 2)).toBe("\u001B[31mA\u001B[32mB\u001B[39m");
      expect(Bun.sliceAnsi(input, 1, 2)).toBe("\u001B[32mB\u001B[39m");
    });

    test("handles reset mixed with start in one SGR sequence", () => {
      const input = "\u001B[32mA\u001B[0;31mB\u001B[39m";
      expect(Bun.sliceAnsi(input, 1, 2)).toBe("\u001B[31mB\u001B[39m");
    });

    test("does not include start codes from mixed SGR sequences after end boundary", () => {
      const input = "\u001B[32mA\u001B[0;31mB\u001B[39m";
      expect(Bun.sliceAnsi(input, 0, 1)).toBe("\u001B[32mA\u001B[39m");
    });

    test("does not include styles that start after end", () => {
      const input = `a\u001B[31mb\u001B[39m`;
      expect(Bun.sliceAnsi(input, 0, 1)).toBe("a");
    });

    test("bold and dim are independent attributes that both close with 22", () => {
      // Both intensity flags must survive re-synthesis at the slice start.
      const input = "\x1b[1m\x1b[2mLoading dependencies...\x1b[22m";
      const once = Bun.sliceAnsi(input, 0, 10);
      expect(once).toBe("\x1b[1m\x1b[2mLoading de\x1b[22m");
      expect(Bun.sliceAnsi(once, 0, 5)).toBe("\x1b[1m\x1b[2mLoadi\x1b[22m");
      expect(Bun.sliceAnsi(input, 8, 15)).toBe("\x1b[1m\x1b[2mdepende\x1b[22m");
      expect(Bun.sliceAnsi("\x1b[1;2mLoading dependencies...\x1b[22m", 0, 10)).toBe("\x1b[1m\x1b[2mLoading de\x1b[22m");
      // dim then bold: both kept, in order.
      expect(Bun.sliceAnsi("\x1b[2m\x1b[1mtext\x1b[22m", 1, 3)).toBe("\x1b[2m\x1b[1mex\x1b[22m");
      // A 22 inside the slice clears both flags.
      expect(Bun.sliceAnsi("\x1b[1m\x1b[2mAB\x1b[22mCD", 1, 4)).toBe("\x1b[1m\x1b[2mB\x1b[22mCD");
    });

    test("supports SGR 58 underline color and its reset 59", () => {
      expect(Bun.sliceAnsi("\x1b[4m\x1b[58;5;196mERROR: file not found\x1b[59m\x1b[24m", 7, 21)).toBe(
        "\x1b[4m\x1b[58;5;196mfile not found\x1b[59m\x1b[24m",
      );
      expect(Bun.sliceAnsi("\x1b[4m\x1b[58;2;255;128;0mwarning text here\x1b[59m\x1b[24m", 0, 7)).toBe(
        "\x1b[4m\x1b[58;2;255;128;0mwarning\x1b[59m\x1b[24m",
      );
      // Colon sub-parameter forms are kept opaque and close with 59.
      expect(Bun.sliceAnsi("\x1b[58:5:196mERROR text\x1b[59m", 0, 5)).toBe("\x1b[58:5:196mERROR\x1b[59m");
      expect(Bun.sliceAnsi("\x1b[4m\x1b[58:2::255:128:0mwarning text\x1b[59m\x1b[24m", 0, 7)).toBe(
        "\x1b[4m\x1b[58:2::255:128:0mwarning\x1b[59m\x1b[24m",
      );
      // 59 alone is a close, not an opener.
      expect(Bun.sliceAnsi("\x1b[59mtext", 1, 3)).toBe("ex");
    });

    test("underline color is independent of foreground color and survives re-slicing", () => {
      const input = "\x1b[58;5;196munder\x1b[59mplain";
      expect(Bun.sliceAnsi(input, 5, 10)).toBe("plain");
      const once = Bun.sliceAnsi(input, 0, 5);
      expect(once).toBe("\x1b[58;5;196munder\x1b[59m");
      expect(Bun.sliceAnsi(once, 0, 2)).toBe("\x1b[58;5;196mun\x1b[59m");
      expect(Bun.sliceAnsi("\x1b[31m\x1b[58;2;1;2;3mAB\x1b[59m\x1b[39m", 1, 2)).toBe(
        "\x1b[31m\x1b[58;2;1;2;3mB\x1b[59m\x1b[39m",
      );
    });

    test("closes double underline, fraktur, framed/encircled and super/subscript", () => {
      // 4 single and 21 double underline are independent flags; both close with 24.
      expect(Bun.sliceAnsi("\x1b[21mdouble\x1b[24m normal", 7, 13)).toBe("normal");
      expect(Bun.sliceAnsi("\x1b[21mdouble\x1b[24m normal", 0, 6)).toBe("\x1b[21mdouble\x1b[24m");
      expect(Bun.sliceAnsi("\x1b[4m\x1b[21mtext\x1b[24m", 1, 3)).toBe("\x1b[4m\x1b[21mex\x1b[24m");
      expect(Bun.sliceAnsi("\x1b[21m\x1b[4mtext\x1b[24m", 1, 3)).toBe("\x1b[21m\x1b[4mex\x1b[24m");
      expect(Bun.sliceAnsi("\x1b[4m\x1b[21mAB\x1b[24mCD", 1, 4)).toBe("\x1b[4m\x1b[21mB\x1b[24mCD");
      // 20 fraktur closes with 23, independently of italic.
      expect(Bun.sliceAnsi("\x1b[20mfraktur\x1b[23m text", 8, 12)).toBe("text");
      expect(Bun.sliceAnsi("\x1b[3m\x1b[20mtext\x1b[23m", 0, 2)).toBe("\x1b[3m\x1b[20mte\x1b[23m");
      // 51 framed and 52 encircled are independent flags; both close with 54.
      expect(Bun.sliceAnsi("\x1b[51mframed\x1b[54m rest", 0, 3)).toBe("\x1b[51mfra\x1b[54m");
      expect(Bun.sliceAnsi("\x1b[52mcircled\x1b[54m", 1, 4)).toBe("\x1b[52mirc\x1b[54m");
      expect(Bun.sliceAnsi("\x1b[51m\x1b[52mtext\x1b[54m", 1, 3)).toBe("\x1b[51m\x1b[52mex\x1b[54m");
      // 73 superscript / 74 subscript close with 75.
      expect(Bun.sliceAnsi("x\x1b[73m2\x1b[75m + y", 0, 2)).toBe("x\x1b[73m2\x1b[75m");
      expect(Bun.sliceAnsi("\x1b[74msub\x1b[75m text", 4, 8)).toBe("text");
    });

    test("empty SGR parameters default to 0 (reset)", () => {
      expect(Bun.sliceAnsi("\x1b[31;mabc", 1, 3)).toBe("bc");
      expect(Bun.sliceAnsi("\x1b[31;mabc", 0, 3)).toBe("abc");
      expect(Bun.sliceAnsi("\x9b31;mabc", 1, 3)).toBe("bc");
      expect(Bun.sliceAnsi("\x1b[;31mabc", 1, 3)).toBe("\x1b[31mbc\x1b[39m");
      expect(Bun.sliceAnsi("\x1b[1;;31mabc", 1, 3)).toBe("\x1b[31mbc\x1b[39m");
      expect(Bun.sliceAnsi("\x1b[31mred\x1b[mplain", 3, 8)).toBe("plain");
    });
  });

  // ======================================================================
  // Control sequences (non-SGR)
  // ======================================================================

  describe("control sequences", () => {
    test("treats non-canonical ESC CSI m sequences as non-visible control codes", () => {
      const input = "\u001B[?25mA";
      expect(Bun.sliceAnsi(input, 0, 1)).toBe("A");
    });

    test("treats non-canonical C1 CSI m sequences as non-visible control codes", () => {
      const input = "\u009B?25mA";
      expect(Bun.sliceAnsi(input, 0, 1)).toBe("A");
    });

    test("treats non-SGR CSI control sequences as non-visible control codes", () => {
      const input = "\u001B[2KA";
      expect(Bun.sliceAnsi(input, 0, 1)).toBe("A");
    });

    test("treats truncated CSI tails as non-visible control codes", () => {
      expect(Bun.sliceAnsi("\u001B[31", 0, 1)).toBe("");
      expect(Bun.sliceAnsi("\u009B31", 0, 1)).toBe("");
    });

    test("non-ASCII inside a CSI is payload; 'A' is the final byte (matches stringWidth/stripANSI)", () => {
      // A codepoint outside 0x20-0x7E cannot end a CSI, so the recognizer
      // scans past it to the first final byte — here the "A" (0x41).
      for (const input of ["\u001B[31\u0100A", "\u001B[\u0100A", "\u009B\u0100A"]) {
        expect({ input, slice: Bun.sliceAnsi(input, 0, 5), width: Bun.stringWidth(input) }).toEqual({
          input,
          slice: "",
          width: 0,
        });
        expect(Bun.stripANSI(input)).toBe("");
      }
      // Visible text after the completed CSI stays visible.
      expect(Bun.sliceAnsi("\u001B[\u0100Axy", 0, 5)).toBe("xy");
    });

    test("treats generic OSC control sequences as non-visible control codes", () => {
      const input = "\u001B]0;title\u0007A";
      expect(Bun.sliceAnsi(input, 0, 1)).toBe("A");
    });

    test("treats DCS control strings as non-visible control codes", () => {
      const input = "\u001BP1;2;3+x\u001B\\A";
      expect(Bun.sliceAnsi(input, 0, 1)).toBe("A");
    });

    test("treats C1 DCS control strings as non-visible control codes", () => {
      const input = "\u0090payload\u009CA";
      expect(Bun.sliceAnsi(input, 0, 1)).toBe("A");
    });

    test("treats SOS control strings as non-visible control codes", () => {
      const input = "\u001BXpayload\u001B\\A";
      expect(Bun.sliceAnsi(input, 0, 1)).toBe("A");
    });

    test("treats PM control strings as non-visible control codes", () => {
      const input = "\u001B^payload\u001B\\A";
      expect(Bun.sliceAnsi(input, 0, 1)).toBe("A");
    });

    test("treats C1 APC control strings as non-visible control codes", () => {
      const input = "\u009Fpayload\u009CA";
      expect(Bun.sliceAnsi(input, 0, 1)).toBe("A");
    });

    test("treats standalone ST control sequences as non-visible control codes", () => {
      expect(Bun.sliceAnsi("\u001B\\A", 0, 1)).toBe("A");
      expect(Bun.sliceAnsi("\u009CA", 0, 1)).toBe("A");
    });

    test("treats two-byte and nF escape sequences as non-visible control codes", () => {
      expect(Bun.sliceAnsi("\u001B7A", 0, 1)).toBe("A"); // DECSC
      expect(Bun.sliceAnsi("\u001BcA", 0, 1)).toBe("A"); // RIS
      expect(Bun.sliceAnsi("\u001B=A", 0, 1)).toBe("A"); // keypad application mode
      expect(Bun.sliceAnsi("\u001B(BA", 0, 1)).toBe("A"); // charset designation
      expect(Bun.sliceAnsi("\u001B#8A", 0, 1)).toBe("A"); // DECALN
      // ESC restarts the sequence: ESC ESC c is one escape, not a visible 'c'.
      expect(Bun.sliceAnsi("\u001B\u001BcA", 0, 1)).toBe("A");
    });

    test("preserves style state across private CSI m control codes", () => {
      const input = "\u001B[31mA\u001B[?25mB\u001B[39m";
      expect(Bun.sliceAnsi(input, 0, 2)).toBe(input);
      expect(Bun.sliceAnsi(input, 1, 2)).toBe("\u001B[31mB\u001B[39m");
    });

    test("preserves visible indexing with control strings before styled text", () => {
      const input = "\u001B]0;title\u0007\u001B[31mAB\u001B[39m";
      expect(Bun.sliceAnsi(input, 0, 1)).toBe("\u001B[31mA\u001B[39m");
      expect(Bun.sliceAnsi(input, 1, 2)).toBe("\u001B[31mB\u001B[39m");
    });

    test("preserves visible indexing with control strings between characters", () => {
      const input = "A\u001BP1;2;3+x\u001B\\B";
      expect(Bun.sliceAnsi(input, 0, 2)).toBe(input);
      expect(Bun.sliceAnsi(input, 1, 2)).toBe("B");
    });

    test("keeps C1 SGR CSI behavior", () => {
      const input = "\u009B31mred\u009B39m";
      expect(Bun.stripANSI(Bun.sliceAnsi(input, 0, 3))).toBe("red");
      expect(Bun.sliceAnsi(input, 1, 2)).toBe("\u009B31me\u001B[39m");
    });
  });

  // ======================================================================
  // OSC 8 Hyperlinks
  // ======================================================================

  describe("OSC 8 hyperlinks", () => {
    test("slice links", () => {
      const link = createHyperlink("Google", "https://google.com");
      expect(Bun.sliceAnsi(link, 0, 6)).toBe(link);
    });

    test("supports OSC 8 hyperlinks with ST terminator", () => {
      const link = createHyperlink("Google", "https://google.com", ANSI_STRING_TERMINATOR);
      expect(Bun.sliceAnsi(link, 0, 6)).toBe(link);
    });

    test("supports OSC 8 hyperlinks with mixed close terminator", () => {
      const link = createHyperlink("Google", "https://google.com", ANSI_STRING_TERMINATOR, ANSI_BELL);
      expect(Bun.sliceAnsi(link, 0, 6)).toBe(link);
    });

    test("supports OSC 8 hyperlinks with parameters", () => {
      const link = `${ESCAPE}]8;id=abc;https://google.com${ANSI_BELL}Google${ESCAPE}]8;;${ANSI_BELL}`;
      expect(Bun.sliceAnsi(link, 0, 6)).toBe(link);
      expect(Bun.sliceAnsi(link, 1, 4)).toBe(
        `${ESCAPE}]8;id=abc;https://google.com${ANSI_BELL}oog${ESCAPE}]8;;${ANSI_BELL}`,
      );
    });

    test("supports OSC 8 hyperlinks with parameters and ST terminator", () => {
      const link = `${ESCAPE}]8;id=abc;https://google.com${ANSI_STRING_TERMINATOR}Google${ESCAPE}]8;;${ANSI_STRING_TERMINATOR}`;
      expect(Bun.sliceAnsi(link, 0, 6)).toBe(link);
      expect(Bun.sliceAnsi(link, 2)).toBe(
        `${ESCAPE}]8;id=abc;https://google.com${ANSI_STRING_TERMINATOR}ogle${ESCAPE}]8;;${ANSI_STRING_TERMINATOR}`,
      );
    });

    test("supports ESC OSC 8 hyperlinks with C1 ST terminator", () => {
      const link = `${ESCAPE}]8;;https://google.com${C1_STRING_TERMINATOR}Google${ESCAPE}]8;;${C1_STRING_TERMINATOR}`;
      expect(Bun.sliceAnsi(link, 0, 6)).toBe(link);
      expect(Bun.sliceAnsi(link, 1, 4)).toBe(
        `${ESCAPE}]8;;https://google.com${C1_STRING_TERMINATOR}oog${ESCAPE}]8;;${C1_STRING_TERMINATOR}`,
      );
    });

    test("supports C1 OSC 8 hyperlinks with BEL terminator", () => {
      const link = `${C1_OSC}8;;https://google.com${ANSI_BELL}Google${C1_OSC}8;;${ANSI_BELL}`;
      expect(Bun.sliceAnsi(link, 0, 6)).toBe(link);
      expect(Bun.sliceAnsi(link, 1, 4)).toBe(`${C1_OSC}8;;https://google.com${ANSI_BELL}oog${C1_OSC}8;;${ANSI_BELL}`);
    });

    test("supports C1 OSC 8 hyperlinks with C1 ST terminator", () => {
      const link = `${C1_OSC}8;;https://google.com${C1_STRING_TERMINATOR}Google${C1_OSC}8;;${C1_STRING_TERMINATOR}`;
      expect(Bun.sliceAnsi(link, 0, 6)).toBe(link);
      expect(Bun.sliceAnsi(link, 2)).toBe(
        `${C1_OSC}8;;https://google.com${C1_STRING_TERMINATOR}ogle${C1_OSC}8;;${C1_STRING_TERMINATOR}`,
      );
    });

    test("supports C1 OSC 8 hyperlinks with parameters and ESC ST terminator", () => {
      const link = `${C1_OSC}8;id=abc;https://google.com${ANSI_STRING_TERMINATOR}Google${C1_OSC}8;;${ANSI_STRING_TERMINATOR}`;
      expect(Bun.sliceAnsi(link, 0, 6)).toBe(link);
      expect(Bun.sliceAnsi(link, 1, 4)).toBe(
        `${C1_OSC}8;id=abc;https://google.com${ANSI_STRING_TERMINATOR}oog${C1_OSC}8;;${ANSI_STRING_TERMINATOR}`,
      );
    });

    test("can slice each visible character from hyperlink", () => {
      const url = "https://google.com";
      const text = "Google";
      const link = createHyperlink(text, url);

      for (let index = 0; index < text.length; index++) {
        expect(Bun.sliceAnsi(link, index, index + 1)).toBe(createHyperlink(text.slice(index, index + 1), url));
      }
    });

    test("can slice partial hyperlink text", () => {
      const url = "https://google.com";
      const link = createHyperlink("Google", url);
      expect(Bun.sliceAnsi(link, 1, 4)).toBe(createHyperlink("oog", url));
    });

    test("can create an empty slice inside hyperlink text", () => {
      const link = createHyperlink("Google", "https://google.com");
      expect(Bun.sliceAnsi(link, 2, 2)).toBe("");
    });

    test("keeps outer styles when slicing after hyperlink text", () => {
      const input = `\u001B[31m${createHyperlink("AB", "https://example.com")}C\u001B[39m`;
      expect(Bun.sliceAnsi(input, 2, 3)).toBe("\u001B[31mC\u001B[39m");
    });

    test("supports hyperlinks that close with non-empty parameters", () => {
      const link = `${ESCAPE}]8;id=abc;https://google.com${ANSI_BELL}Google${ESCAPE}]8;id=abc;${ANSI_BELL}`;
      expect(Bun.sliceAnsi(link, 0, 6)).toBe(link);
      expect(Bun.sliceAnsi(link, 0, 4)).toBe(
        `${ESCAPE}]8;id=abc;https://google.com${ANSI_BELL}Goog${ESCAPE}]8;;${ANSI_BELL}`,
      );
    });

    test("supports hyperlink slices with unicode surrogate pairs", () => {
      const url = "https://example.com";
      const link = createHyperlink("a🙂b", url);
      expect(Bun.sliceAnsi(link, 1, 3)).toBe(createHyperlink("🙂", url));
    });

    test("preserves grapheme clusters when slicing hyperlink text", () => {
      const url = "https://example.com";
      const link = createHyperlink("A👨‍👩‍👧‍👦B", url);
      expect(Bun.sliceAnsi(link, 1, 3)).toBe(createHyperlink("👨‍👩‍👧‍👦", url));
      expect(Bun.sliceAnsi(link, 2, 3)).toBe("");
    });

    test("can slice across plain text and hyperlink boundaries", () => {
      const url = "https://google.com";
      const input = `A${createHyperlink("Google", url)}B`;
      expect(Bun.sliceAnsi(input, 0, 2)).toBe(`A${createHyperlink("G", url)}`);
      expect(Bun.sliceAnsi(input, 6, 8)).toBe(`${createHyperlink("e", url)}B`);
    });

    test("can slice a hyperlink that remains open to the end", () => {
      const link = `${ESCAPE}]8;;https://google.com${ANSI_BELL}Google`;
      expect(Bun.sliceAnsi(link, 0, 6)).toBe(createHyperlink("Google", "https://google.com"));
    });

    test("can slice hyperlinks with nested style transitions", () => {
      const url = "https://example.com";
      const input = createHyperlink(`\u001B[31mR\u001B[39m\u001B[32mG\u001B[39m\u001B[34mB\u001B[39m`, url);
      assertVisibleSliceMatchesNative(input, 0, 3);
      assertVisibleSliceMatchesNative(input, 1, 3);
      assertVisibleSliceMatchesNative(input, 1, 2);
    });

    test("can slice styled hyperlink text without dropping styles", () => {
      const url = "https://example.com";
      const input = `\u001B[42m\u001B[30m${createHyperlink("\u001B[31mtest\u001B[39m", url)}\u001B[39m\u001B[49m`;
      assertVisibleSliceMatchesNative(input, 0, 4);
      assertVisibleSliceMatchesNative(input, 1, 3);
    });

    test("can slice multiple hyperlinks in one string", () => {
      const input = `${createHyperlink("one", "https://one.test")}-${createHyperlink("two", "https://two.test")}`;
      assertVisibleSliceMatchesNative(input, 0, 7);
      assertVisibleSliceMatchesNative(input, 1, 6);
      assertVisibleSliceMatchesNative(input, 3, 7);
    });

    test("can slice back-to-back hyperlinks", () => {
      const input = `${createHyperlink("A", "https://a.test")}${createHyperlink("B", "https://b.test")}${createHyperlink("C", "https://c.test")}`;
      assertVisibleSliceMatchesNative(input, 0, 3);
      assertVisibleSliceMatchesNative(input, 1, 3);
      assertVisibleSliceMatchesNative(input, 0, 2);
    });

    test("can slice through link boundaries with mixed terminators", () => {
      const input = `${createHyperlink("first", "https://one.test", ANSI_STRING_TERMINATOR)} ${createHyperlink("second", "https://two.test", ANSI_BELL, ANSI_STRING_TERMINATOR)}`;
      assertVisibleSliceMatchesNative(input, 0, 8);
      assertVisibleSliceMatchesNative(input, 2, 10);
      assertVisibleSliceMatchesNative(input, 5, 11);
    });

    test("supports fullwidth slices inside hyperlinks", () => {
      const link = createHyperlink("古古ab", "https://example.com");
      expect(stripForVisibleComparison(Bun.sliceAnsi(link, 0, 2))).toBe("古");
      expect(stripForVisibleComparison(Bun.sliceAnsi(link, 2, 4))).toBe("古");
      expect(stripForVisibleComparison(Bun.sliceAnsi(link, 4, 6))).toBe("ab");
    });

    test("returns empty for out-of-range start with active hyperlink before it", () => {
      const link = createHyperlink("Google", "https://google.com");
      expect(Bun.sliceAnsi(link, 100)).toBe("");
    });

    test("handles malformed OSC hyperlink input without throwing", () => {
      const malformedOpen = `${ESCAPE}]8;;https://example.comGoogle`;
      const malformedClose = `${ESCAPE}]8;;https://example.com${ANSI_BELL}Google${ESCAPE}]8;;`;

      expect(() => Bun.sliceAnsi(malformedOpen, 0, 3)).not.toThrow();
      expect(() => Bun.sliceAnsi(malformedClose, 0, 6)).not.toThrow();

      expect(Bun.sliceAnsi(malformedOpen, 0, 3).includes("null")).toBe(false);
      expect(Bun.sliceAnsi(malformedOpen, 0, 3).includes("undefined")).toBe(false);
      expect(Bun.sliceAnsi(malformedClose, 0, 6).includes("null")).toBe(false);
      expect(Bun.sliceAnsi(malformedClose, 0, 6).includes("undefined")).toBe(false);
    });

    test("treats malformed OSC tail as non-visible", () => {
      const input = `${ESCAPE}]8;;https://example.com${ANSI_BELL}link${ESCAPE}]8;;broken plain`;
      expect(stripForVisibleComparison(Bun.sliceAnsi(input, 0))).toBe("link");
    });

    test("can slice hyperlink with omitted end", () => {
      const link = createHyperlink("Google", "https://google.com");
      expect(Bun.sliceAnsi(link, 0)).toBe(link);
    });

    test("can slice from the middle of a hyperlink with omitted end", () => {
      const url = "https://google.com";
      const link = createHyperlink("Google", url);
      expect(Bun.sliceAnsi(link, 2)).toBe(createHyperlink("ogle", url));
    });

    test("does not include hyperlink escapes when slicing only outside linked text", () => {
      const input = `prefix ${createHyperlink("Google", "https://google.com")} suffix`;
      expect(Bun.sliceAnsi(input, 0, 3)).toBe("pre");
      expect(Bun.sliceAnsi(input, 14, 19)).toBe("suffi");
    });
  });

  // ======================================================================
  // Edge cases
  // ======================================================================

  describe("edge cases", () => {
    test("string is only ANSI codes", () => {
      const input = "\x1b[31m\x1b[39m";
      expect(Bun.sliceAnsi(input, 0, 0)).toBe("");
      // No visible characters, so nothing to include
      expect(Bun.sliceAnsi(input, 0, 5)).toBe("");
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

    test("can create empty slices", () => {
      expect(Bun.sliceAnsi("test", 0, 0)).toBe("");
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
      const result = Bun.sliceAnsi(input, 10, 20);
      const stripped = Bun.stripANSI(result);
      expect(stripped.length).toBe(10);
    });

    test("string with many full-width characters", () => {
      const input = "你".repeat(500);
      const result = Bun.sliceAnsi(input, 100, 200);
      expect(Bun.stringWidth(result)).toBe(100);
      expect(result.length).toBe(50);
    });

    test("mixed content performance", () => {
      const input = "\x1b[31m" + "hello 你好 👋 ".repeat(100) + "\x1b[39m";
      const result = Bun.sliceAnsi(input, 0, 50);
      expect(Bun.stringWidth(result)).toBeLessThanOrEqual(50);
    });

    test("main upstream test - various colored fixture slices", () => {
      // Build fixture: chalk.red('the ') + chalk.green('quick ') + chalk.blue('brown ') + chalk.cyan('fox ') + chalk.yellow('jumped ')
      const fixture =
        "\u001B[31mthe \u001B[39m\u001B[32mquick \u001B[39m\u001B[34mbrown \u001B[39m\u001B[36mfox \u001B[39m\u001B[33mjumped \u001B[39m";
      const stripped = Bun.stripANSI(fixture);

      // The slice should behave exactly as a regular JS slice behaves
      for (let index = 0; index < 20; index++) {
        for (let index2 = 19; index2 > index; index2--) {
          const nativeSlice = stripped.slice(index, index2);
          const ansiSlice = Bun.sliceAnsi(fixture, index, index2);
          expect(Bun.stripANSI(ansiSlice)).toBe(nativeSlice);
        }
      }
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
  // Surrogate pairs
  // ======================================================================

  describe("surrogate pairs", () => {
    test("emoji that requires surrogate pairs", () => {
      const input = "a😀b";
      expect(Bun.sliceAnsi(input, 0, 1)).toBe("a");
      expect(Bun.sliceAnsi(input, 1, 3)).toBe("😀");
      expect(Bun.sliceAnsi(input, 3, 4)).toBe("b");
    });

    test("multiple surrogate pair characters", () => {
      const input = "😀😁😂";
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
      const visible = Bun.sliceAnsi(bar, 0, 8);
      expect(Bun.stripANSI(visible)).toBe("████████");
    });

    test("colored log line", () => {
      const line = "\x1b[90m[2024-01-01]\x1b[39m \x1b[31mERROR\x1b[39m: Something broke";
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

  // ======================================================================
  // Ellipsis option (cli-truncate replacement)
  // ======================================================================

  describe("ellipsis option", () => {
    const E = "\u2026"; // …

    test("end truncation", () => {
      // No cut → no ellipsis
      expect(Bun.sliceAnsi("unicorn", 0, 7, { ellipsis: E })).toBe("unicorn");
      expect(Bun.sliceAnsi("unicorn", 0, 20, { ellipsis: E })).toBe("unicorn");
      // Cut at end → ellipsis inside budget
      expect(Bun.sliceAnsi("unicorn", 0, 4, { ellipsis: E })).toBe("uni" + E);
      expect(Bun.sliceAnsi("unicorn", 0, 6, { ellipsis: E })).toBe("unico" + E);
      // Degenerate: budget == ellipsis width
      expect(Bun.sliceAnsi("unicorn", 0, 1, { ellipsis: E })).toBe(E);
    });

    test("start truncation via negative index", () => {
      // No cut → no ellipsis (whole string fits in -7 cols)
      expect(Bun.sliceAnsi("unicorn", -7, undefined, { ellipsis: E })).toBe("unicorn");
      // Cut at start → prefix ellipsis
      expect(Bun.sliceAnsi("unicorn", -5, undefined, { ellipsis: E })).toBe(E + "corn");
      expect(Bun.sliceAnsi("unicorn", -4, undefined, { ellipsis: E })).toBe(E + "orn");
    });

    test("SGR style inheritance", () => {
      const red = "\u001B[31m";
      const reset = "\u001B[39m";
      const text = `${red}unicorns${reset}`;

      // End ellipsis inherits red
      const endOut = Bun.sliceAnsi(text, 0, 5, { ellipsis: E });
      expect(endOut).toBe(`${red}unic${E}${reset}`);
      expect(Bun.stringWidth(endOut)).toBe(5);

      // Start ellipsis inherits red
      const startOut = Bun.sliceAnsi(text, -5, undefined, { ellipsis: E });
      expect(startOut).toBe(`${red}${E}orns${reset}`);
      expect(Bun.stringWidth(startOut)).toBe(5);
    });

    test("middle slice shows ellipsis at both cut edges", () => {
      // [2, 8) from "0123456789" (width 10) — both edges cut
      const out = Bun.sliceAnsi("0123456789", 2, 8, { ellipsis: E });
      // budget=6, ellipsisWidth=1 each side → 4 chars visible
      expect(out).toBe(`${E}3456${E}`);
      expect(Bun.stringWidth(out)).toBe(6);
    });

    test("ellipsis not hyperlinked but inherits SGR", () => {
      const text = "\u001B[31m\u001B]8;;https://example.com\u0007link text\u001B]8;;\u0007\u001B[39m";
      const out = Bun.sliceAnsi(text, 0, 5, { ellipsis: E });
      // Visible budget 5: 4 cols text + 1 col ellipsis
      expect(Bun.stringWidth(out)).toBe(5);
      expect(Bun.stripANSI(stripOscHyperlinks(out))).toBe("link" + E);
      // Ellipsis should appear AFTER hyperlink close (not linked) but BEFORE SGR close (red)
      expect(out.indexOf(E)).toBeGreaterThan(out.indexOf("\u0007link"));
      expect(out.indexOf(E)).toBeGreaterThan(out.lastIndexOf("\u001B]8;;"));
      expect(out.indexOf(E)).toBeLessThan(out.lastIndexOf("\u001B[39m"));
    });

    test("custom ellipsis string", () => {
      expect(Bun.sliceAnsi("unicorns", 0, 5, { ellipsis: "." })).toBe("unic.");
      expect(Bun.sliceAnsi("unicorns", 0, 5, { ellipsis: "..." })).toBe("un...");
    });

    test("wide characters with ellipsis", () => {
      // 安宁哈世界 = 5 CJK chars, each width 2 = 10 cols
      expect(Bun.sliceAnsi("\u5B89\u5B81\u54C8\u4E16\u754C", 0, 3, { ellipsis: E })).toBe("\u5B89" + E);
      expect(Bun.sliceAnsi("\u5B89\u5B81\u54C8\u4E16\u754C", 0, 5, { ellipsis: E })).toBe("\u5B89\u5B81" + E);
    });

    test("empty ellipsis behaves like plain slice", () => {
      expect(Bun.sliceAnsi("unicorn", 0, 4, { ellipsis: "" })).toBe("unic");
    });

    test("no ellipsis when not cut", () => {
      // short string, large range: no cut, no ellipsis
      expect(Bun.sliceAnsi("hi", 0, 100, { ellipsis: E })).toBe("hi");
      expect(Bun.sliceAnsi("hi", -100, undefined, { ellipsis: E })).toBe("hi");
    });

    test("string shorthand for ellipsis", () => {
      // 4th arg as bare string is equivalent to { ellipsis: string }
      expect(Bun.sliceAnsi("unicorn", 0, 4, E)).toBe("uni" + E);
      expect(Bun.sliceAnsi("unicorn", -4, undefined, E)).toBe(E + "orn");
      expect(Bun.sliceAnsi("unicorn", 0, 4, ".")).toBe("uni.");
    });

    test("trailing zero-width clusters do not trigger the end ellipsis", () => {
      // A zero-width cluster (LF/CR/ZWSP/tab) landing exactly at the end
      // boundary must not count as a cut: nothing visible was discarded.
      // Each non-ASCII case is paired with its ASCII fast-path equivalent
      // (same column shape) which was already correct.
      expect(Bun.sliceAnsi("abcX", 0, 4, { ellipsis: E })).toBe("abcX");
      expect(Bun.sliceAnsi("abcX\n", 0, 4, { ellipsis: E })).toBe("abcX");
      expect(Bun.sliceAnsi("abcX\r\n", 0, 4, { ellipsis: E })).toBe("abcX");
      expect(Bun.sliceAnsi("abcX\u200b", 0, 4, { ellipsis: E })).toBe("abcX");
      expect(Bun.sliceAnsi("abcX\t", 0, 4, { ellipsis: E })).toBe("abcX");
      expect(Bun.sliceAnsi("abcX\n\n\n", 0, 4, { ellipsis: E })).toBe("abcX");
      expect(Bun.sliceAnsi("ЖЗИК\n", 0, 4, { ellipsis: E })).toBe("ЖЗИК");
      expect(Bun.sliceAnsi("ЖЗИ\n", 0, 3, { ellipsis: ">>" })).toBe("ЖЗИ");
      expect(Bun.sliceAnsi("ab漢\n", 0, 4, { ellipsis: E })).toBe("ab漢");
      expect(Bun.sliceAnsi("hi\n", 0, 2, { ellipsis: ">>" })).toBe("hi");
      expect(Bun.sliceAnsi("ЖЗ\n", 0, 2, { ellipsis: ">>" })).toBe("ЖЗ");
      expect(Bun.sliceAnsi("h\n", 0, 1, { ellipsis: E })).toBe("h");
      expect(Bun.sliceAnsi("a\u200b", 0, 1, { ellipsis: ">>" })).toBe("a");
      // Negative start with no end cut is unbounded: trailing zero-width kept.
      expect(Bun.sliceAnsi("a\n", -1, undefined, { ellipsis: ">>" })).toBe("a\n");
      // Leading ANSI forces the streaming walk even for ASCII visible chars.
      expect(Bun.sliceAnsi("\x1b[0mabcX\n", 0, 4, { ellipsis: E })).toBe("abcX");
      // Visible content after the zero-width tail IS a cut.
      expect(Bun.sliceAnsi("abcX\nY", 0, 4, { ellipsis: E })).toBe("abc" + E);
      expect(Bun.sliceAnsi("abcX\n\nY", 0, 4, { ellipsis: E })).toBe("abc" + E);
      expect(Bun.sliceAnsi("ЖЗИК\nЛ", 0, 4, { ellipsis: E })).toBe("ЖЗИ" + E);
      expect(Bun.sliceAnsi("\x1b[0mabcX\nY", 0, 4, { ellipsis: E })).toBe("abc" + E);
      // A zero-width codepoint at end that leads a visible cluster (GB9b
      // Prepend, keycap via Extend, SpacingMark) is a cut once the cluster
      // width resolves at EOF.
      expect(Bun.sliceAnsi("abcX\u0600Y", 0, 4, { ellipsis: E })).toBe("abc" + E);
      expect(Bun.sliceAnsi("abcX\u0600YZ", 0, 4, { ellipsis: E })).toBe("abc" + E);
      expect(Bun.sliceAnsi("ЖЗИК\u0600\u0661", 0, 4, { ellipsis: E })).toBe("ЖЗИ" + E);
      expect(Bun.sliceAnsi("ЖЗИК\u200b\u20E3", 0, 4, { ellipsis: E })).toBe("ЖЗИ" + E);
      expect(Bun.sliceAnsi("ЖЗИК\n\u20E3", 0, 4, { ellipsis: E })).toBe("ЖЗИ" + E);
      expect(Bun.sliceAnsi("ЖЗИК\u200b\u0903", 0, 4, { ellipsis: E })).toBe("ЖЗИ" + E);
      expect(Bun.sliceAnsi("abcX\u0600", 0, 4, { ellipsis: E })).toBe("abcX");
      // start > 0 (start ellipsis budgeted) with a zero-width tail: spec
      // zone kept, no end ellipsis.
      expect(Bun.sliceAnsi("ЖЗИКЛ\n", 1, 5, { ellipsis: E })).toBe(E + "ИКЛ");
      expect(Bun.sliceAnsi("abcde\n", 1, 5, { ellipsis: E })).toBe(E + "cde");
      expect(Bun.sliceAnsi("\x1b[0mabcde\n", 1, 5, { ellipsis: E })).toBe(E + "cde");
      expect(Bun.sliceAnsi("ЖЗИКЛ\nМ", 1, 5, { ellipsis: E })).toBe(E + "ИК" + E);
      // Trailing close SGR after spec-zone content keeps input order when
      // the zone is kept.
      expect(Bun.sliceAnsi("\x1b[31mЖЗИК\x1b[0m", 0, 4, { ellipsis: E })).toBe("\x1b[31mЖЗИК\x1b[0m");
      expect(Bun.sliceAnsi("\x1b[31mЖЗИК\n\x1b[0m", 0, 4, { ellipsis: E })).toBe("\x1b[31mЖЗИК\x1b[0m");
      expect(Bun.sliceAnsi("\x1b[31mЖЗИК\x1b[39m\n", 0, 4, { ellipsis: E })).toBe("\x1b[31mЖЗИК\x1b[39m");
    });

    test("wide char overflowing end at EOF is a cut (lazy path)", () => {
      // U+6F22 is width 2. When it is the last cluster and its width extends
      // past the requested end, the lazy-cutEnd path must emit the ellipsis
      // just like the ASCII fast path and the negative-index path do.
      expect(Bun.sliceAnsi("ab漢", 0, 3, { ellipsis: E })).toBe("ab" + E);
      expect(Bun.sliceAnsi("abc漢", 0, 4, { ellipsis: E })).toBe("abc" + E);
      expect(Bun.sliceAnsi("漢漢", 0, 3, { ellipsis: E })).toBe("漢" + E);
      expect(Bun.sliceAnsi("ab漢漢", 0, 5, { ellipsis: E })).toBe("ab漢" + E);
      // Multi-column ellipsis budget.
      expect(Bun.sliceAnsi("abcd漢", 0, 5, { ellipsis: ">>" })).toBe("abc>>");
      // The ellipsis inherits the active SGR (matches the end=-1 path). A
      // close that follows the cut cluster is dropped and re-synthesized.
      const red = "\x1b[31m",
        reset = "\x1b[39m";
      expect(Bun.sliceAnsi(red + "ab漢", 0, 3, { ellipsis: E })).toBe(red + "ab" + E + reset);
      expect(Bun.sliceAnsi(red + "ab漢" + reset, 0, 3, { ellipsis: E })).toBe(red + "ab" + E + reset);
      expect(Bun.sliceAnsi(red + "ab漢" + reset + "x", 0, 3, { ellipsis: E })).toBe(red + "ab" + E + reset);
      expect(Bun.sliceAnsi(red + "ab漢\x1b[0m", 0, 3, { ellipsis: E })).toBe(red + "ab" + E + reset);
      // A close that lands BEFORE the cut cluster is passed through in
      // order and the ellipsis follows it (matches the known-cutEnd path).
      expect(Bun.sliceAnsi(red + "ab漢" + reset + "xy", 0, 4, { ellipsis: E })).toBe(red + "ab漢" + reset + E);
      // start > 0: start ellipsis budgeted first, same EOF overflow detection.
      expect(Bun.sliceAnsi("xyab漢", 2, 5, { ellipsis: E })).toBe(E + "b" + E);
      expect(Bun.sliceAnsi("xyab漢", 2, 6, { ellipsis: E })).toBe(E + "b漢");
      // 8-bit (LChar) instantiation: U+00A7 is width 2 under ambiguousIsNarrow:false.
      expect(Bun.sliceAnsi("ab\u00A7", 0, 3, { ellipsis: ".", ambiguousIsNarrow: false })).toBe("ab.");
      expect(Bun.sliceAnsi("ab\u00A7", 0, 4, { ellipsis: ".", ambiguousIsNarrow: false })).toBe("ab\u00A7");
      // Exact fit (total width == end) is not a cut.
      expect(Bun.sliceAnsi("ab漢", 0, 4, { ellipsis: E })).toBe("ab漢");
      expect(Bun.sliceAnsi("a漢", 0, 3, { ellipsis: E })).toBe("a漢");
      expect(Bun.sliceAnsi("a漢b", 0, 4, { ellipsis: E })).toBe("a漢b");
      expect(Bun.sliceAnsi("abcd漢", 0, 6, { ellipsis: ">>" })).toBe("abcd漢");
      // Equivalence with the paths that already got this right.
      expect(Bun.sliceAnsi("ab漢", 0, 3, { ellipsis: E })).toBe(Bun.sliceAnsi("ab漢", 0, -1, { ellipsis: E }));
      expect(Bun.sliceAnsi("ab漢", 0, 3, { ellipsis: E })).toBe(Bun.sliceAnsi("ab漢x", 0, 3, { ellipsis: E }));
      expect(Bun.sliceAnsi("xyab漢", 2, 5, { ellipsis: E })).toBe(Bun.sliceAnsi("xyab漢", 2, -1, { ellipsis: E }));
      expect(Bun.sliceAnsi(red + "ab漢" + reset, 0, 3, { ellipsis: E })).toBe(
        Bun.sliceAnsi(red + "ab漢" + reset, 0, -1, { ellipsis: E }),
      );
      expect(Bun.sliceAnsi(red + "ab漢" + reset + "x", 0, 3, { ellipsis: E })).toBe(
        Bun.sliceAnsi(red + "ab漢" + reset + "x", 0, -2, { ellipsis: E }),
      );
      expect(Bun.stringWidth(Bun.sliceAnsi("ab漢", 0, 3, { ellipsis: E }))).toBe(3);
    });

    test("degenerate ranges return the bare ellipsis (matches ASCII fast path)", () => {
      // When a side is cut but the ellipsis leaves no room, the ASCII fast
      // path returns just the ellipsis; the streaming walk must agree.
      const e = { ellipsis: ">>" };
      // Start cut, start budget pushes `start` past all content.
      expect(Bun.sliceAnsi("ЖЗИ", 1, 4)).toBe("ЗИ");
      expect(Bun.sliceAnsi("ЖЗИ", 1, 4, e)).toBe(">>");
      expect(Bun.sliceAnsi("ЖЗИ", 2, 5, e)).toBe(">>");
      expect(Bun.sliceAnsi("abc", 1, 4, e)).toBe(">>");
      expect(Bun.sliceAnsi("ЖЗИ", -2, undefined, e)).toBe(">>");
      // Original range empty (start >= totalW): still empty, no ellipsis.
      expect(Bun.sliceAnsi("ЖЗИ", 3, 6, e)).toBe("");
      expect(Bun.sliceAnsi("Ж", 1, 2, e)).toBe("");
      // End cut only.
      expect(Bun.sliceAnsi("abc", 0, 1, e)).toBe(">>");
      expect(Bun.sliceAnsi("ЖЗИ", 0, 1, e)).toBe(">>");
      expect(Bun.sliceAnsi("abc", 0, 2, e)).toBe(">>");
      expect(Bun.sliceAnsi("ЖЗИ", 0, 2, e)).toBe(">>");
      expect(Bun.sliceAnsi("\x1b[0mabc", 0, 1, e)).toBe(">>");
      expect(Bun.sliceAnsi("Ж\u0600Y", 0, 1, e)).toBe(">>");
      // Start cut only (string ends exactly at the range end).
      expect(Bun.sliceAnsi("abc", 1, 3, e)).toBe(">>");
      expect(Bun.sliceAnsi("ЖЗИ", 1, 3, e)).toBe(">>");
      expect(Bun.sliceAnsi("ЖЗ", 1, 2, e)).toBe(">>");
      expect(Bun.sliceAnsi("ab", 1, 2, e)).toBe(">>");
      // Both sides cut.
      expect(Bun.sliceAnsi("abc", 1, 2, e)).toBe(">>");
      expect(Bun.sliceAnsi("ЖЗИ", 1, 2, e)).toBe(">>");
      // Start-cut with a trailing newline still returns the ellipsis
      // (the start cut is what makes it degenerate, not the end).
      expect(Bun.sliceAnsi("ЖЗ\n", 1, 2, e)).toBe(">>");
      // Start budget consumed the whole range and only zero-width clusters
      // (tab/LF/ZWSP) lie at the original start: still the bare ellipsis,
      // same as the visible-content case above. Plain slice is non-empty.
      expect(Bun.sliceAnsi("a\t", 1, 3)).toBe("\t");
      expect(Bun.sliceAnsi("a\t", 1, 3, { ellipsis: E })).toBe(E);
      expect(Bun.sliceAnsi("a\x1b[31m\t", 1, 3, { ellipsis: E })).toBe(E);
      expect(Bun.sliceAnsi("Ж\t", 1, 3, { ellipsis: E })).toBe(E);
      expect(Bun.sliceAnsi("a\n", 1, 3, { ellipsis: E })).toBe(E);
      expect(Bun.sliceAnsi("a\u200b", 1, 3, { ellipsis: E })).toBe(E);
      expect(Bun.sliceAnsi("ab\t", 2, 4, { ellipsis: E })).toBe(E);
      expect(Bun.sliceAnsi("ЖЗ\t", 2, 4, { ellipsis: E })).toBe(E);
      expect(Bun.sliceAnsi("a\t\t", 1, 3, { ellipsis: E })).toBe(E);
      // Same, but ellipsisWidth >= range so no start budget was applied and
      // `include` flipped true on the zero-width cluster: still the ellipsis.
      expect(Bun.sliceAnsi("Ж\t", 1, 2, e)).toBe(">>");
      expect(Bun.sliceAnsi("a\t", 1, 2, e)).toBe(">>");
      expect(Bun.sliceAnsi("a\u200b", 1, 2, e)).toBe(">>");
      expect(Bun.sliceAnsi("a\x1b[31m\t", 1, 3, e)).toBe(">>");
      expect(Bun.sliceAnsi("a\t\t", 1, 2, e)).toBe(">>");
      // Same zero-width range but the plain slice is empty (nothing at the
      // original start): stays empty, no ellipsis.
      expect(Bun.sliceAnsi("Ж", 1, 3, { ellipsis: E })).toBe("");
      expect(Bun.sliceAnsi("Ж\x1b[31m", 1, 3, { ellipsis: E })).toBe("");
      expect(Bun.sliceAnsi("Ж\x1b[31m", 1, 2, e)).toBe("");
      // No cut on either side: content returned, no ellipsis.
      expect(Bun.sliceAnsi("Ж", 0, 1, e)).toBe("Ж");
      expect(Bun.sliceAnsi("Ж\n", 0, 1, e)).toBe("Ж");
      expect(Bun.sliceAnsi("Ж\r\n", 0, 1, e)).toBe("Ж");
      expect(Bun.sliceAnsi("a", 0, 1, e)).toBe("a");
      expect(Bun.sliceAnsi("a\n", 0, 1, e)).toBe("a");
      expect(Bun.sliceAnsi("ЖЗ", 0, 2, e)).toBe("ЖЗ");
      expect(Bun.sliceAnsi("ЖЗ\n", 0, 2, e)).toBe("ЖЗ");
    });

    test("trailing ANSI stays after speculative-zone content when string fits exactly", () => {
      const red = "\x1b[31m";
      const green = "\x1b[32m";
      const reset = "\x1b[39m";
      // End budget lands exactly at EOF: speculative zone ("d") is kept. The
      // trailing close code must come AFTER that content, not before it.
      expect(Bun.sliceAnsi(`${red}abcd${reset}`, 0, 4, { ellipsis: E })).toBe(`${red}abcd${reset}`);
      expect(Bun.sliceAnsi(`${red}abcd${reset}`, 0, 4, { ellipsis: "..." })).toBe(`${red}abcd${reset}`);
      // SGR change between speculative-zone chars must stay interleaved.
      expect(Bun.sliceAnsi(`${red}abcde${green}fg${reset}`, 0, 7, { ellipsis: "..." })).toBe(
        `${red}abcde${green}fg${reset}`,
      );
      // Same for OSC 8 hyperlink close.
      const hl = createHyperlink("abcd", "http://x");
      expect(Bun.sliceAnsi(hl, 0, 4, { ellipsis: E })).toBe(hl);
      // UTF-16 input path (force a non-ASCII char before the styled run).
      expect(Bun.sliceAnsi(`安${red}bcd${reset}`, 0, 5, { ellipsis: E })).toBe(`安${red}bcd${reset}`);
    });

    test("SGR between speculative-zone chars is discarded with the zone when cut", () => {
      const red = "\x1b[31m";
      const green = "\x1b[32m";
      const bold = "\x1b[1m";
      const reset = "\x1b[39m";
      const resetAll = "\x1b[0m";
      // 'efg' fall in the speculative zone and are replaced by the ellipsis;
      // the \e[32m between them applies only to discarded chars and must not
      // leak into the output. The negative-index path already behaves this
      // way; the lazy (positive-index) path should match.
      const text = `${red}abcde${green}fghijk${reset}`;
      expect(Bun.stringWidth(text)).toBe(11);
      const viaLazy = Bun.sliceAnsi(text, 0, 7, { ellipsis: "..." });
      const viaKnown = Bun.sliceAnsi(text, -11, -4, { ellipsis: "..." });
      expect(viaLazy).toBe(`${red}abcd...${reset}`);
      expect(viaLazy).toBe(viaKnown);
      // SGR 0 (full reset) between zone chars: the snapshot restore must bring
      // back every active slot so emitCloseCodes closes them individually.
      const multi = `${red}${bold}abcde${resetAll}fghij`;
      expect(Bun.sliceAnsi(multi, 0, 7, { ellipsis: "..." })).toBe(`${red}${bold}abcd...\x1b[22m${reset}`);
      expect(Bun.sliceAnsi(multi, 0, 7, { ellipsis: "..." })).toBe(Bun.sliceAnsi(multi, -10, -3, { ellipsis: "..." }));
    });

    test("hyperlink state is restored when speculative zone is discarded", () => {
      // OSC 8 open lands between two speculative-zone chars and every linked
      // character is discarded: no OSC 8 bytes should appear in the output.
      const inner = "abcde" + createHyperlink("fghij", "http://x");
      expect(Bun.sliceAnsi(inner, 0, 7, { ellipsis: "..." })).toBe("abcd...");
      expect(Bun.sliceAnsi(inner, 0, 7, { ellipsis: "..." })).toBe(Bun.sliceAnsi(inner, -10, -3, { ellipsis: "..." }));
      // Link open before the zone and close between zone chars: restoring the
      // snapshot keeps the link active so a close is still synthesized before
      // the ellipsis.
      const outer = createHyperlink("abcde", "http://x") + "fghij";
      expect(Bun.sliceAnsi(outer, 0, 7, { ellipsis: "..." })).toBe(createHyperlink("abcd", "http://x") + "...");
      expect(Bun.sliceAnsi(outer, 0, 7, { ellipsis: "..." })).toBe(Bun.sliceAnsi(outer, -10, -3, { ellipsis: "..." }));
    });
  });

  // ======================================================================
  // ambiguousIsNarrow option (matches stringWidth / wrapAnsi)
  // ======================================================================

  describe("ambiguousIsNarrow option", () => {
    // Greek alpha (U+03B1) is East Asian Width "Ambiguous": width 1 in
    // Western terminals, width 2 in CJK-encoded terminals.
    test("Greek alpha: narrow (default) treats as width 1", () => {
      const s = "\u03B1\u03B2\u03B3\u03B4\u03B5"; // αβγδε
      // Default: narrow → 5 cols total
      expect(Bun.sliceAnsi(s, 0, 3)).toBe("\u03B1\u03B2\u03B3");
      expect(Bun.sliceAnsi(s, 0, 3, { ambiguousIsNarrow: true })).toBe("\u03B1\u03B2\u03B3");
    });

    test("Greek alpha: wide treats as width 2", () => {
      const s = "\u03B1\u03B2\u03B3\u03B4\u03B5"; // αβγδε
      // Wide → 10 cols total. [0,2) fits exactly 1 char (width 2).
      expect(Bun.sliceAnsi(s, 0, 2, { ambiguousIsNarrow: false })).toBe("\u03B1");
      // [0,4) fits exactly 2 chars (width 2 each)
      expect(Bun.sliceAnsi(s, 0, 4, { ambiguousIsNarrow: false })).toBe("\u03B1\u03B2");
      // [0,3): β starts at col 2 < 3 → atomically emitted (clusters whose
      // START is in range go in whole, even if they extend past end).
      expect(Bun.sliceAnsi(s, 0, 3, { ambiguousIsNarrow: false })).toBe("\u03B1\u03B2");
    });

    test("matches Bun.stringWidth semantics", () => {
      const s = "\u03B1\u03B2\u03B3";
      const narrowW = Bun.stringWidth(s, { ambiguousIsNarrow: true });
      const wideW = Bun.stringWidth(s, { ambiguousIsNarrow: false });
      expect(narrowW).toBe(3);
      expect(wideW).toBe(6);
      // Slicing at full width should return the whole string with either option.
      expect(Bun.sliceAnsi(s, 0, narrowW, { ambiguousIsNarrow: true })).toBe(s);
      expect(Bun.sliceAnsi(s, 0, wideW, { ambiguousIsNarrow: false })).toBe(s);
    });

    test("ambiguousIsNarrow with ANSI codes", () => {
      const s = "\x1b[31m\u03B1\u03B2\u03B3\x1b[39m";
      expect(Bun.stripANSI(Bun.sliceAnsi(s, 0, 2, { ambiguousIsNarrow: true }))).toBe("\u03B1\u03B2");
      expect(Bun.stripANSI(Bun.sliceAnsi(s, 0, 2, { ambiguousIsNarrow: false }))).toBe("\u03B1");
    });

    test("ambiguousIsNarrow as positional boolean (4th arg, no object alloc)", () => {
      const s = "\u03B1\u03B2\u03B3"; // αβγ
      // Boolean 4th arg: no {} allocation needed.
      expect(Bun.sliceAnsi(s, 0, 2, true)).toBe("\u03B1\u03B2"); // narrow (default)
      expect(Bun.sliceAnsi(s, 0, 2, false)).toBe("\u03B1"); // wide
      // Equivalence with object form:
      expect(Bun.sliceAnsi(s, 0, 4, false)).toBe(Bun.sliceAnsi(s, 0, 4, { ambiguousIsNarrow: false }));
    });

    test("ambiguousIsNarrow as 5th arg (with string ellipsis in 4th)", () => {
      const s = "\u03B1\u03B2\u03B3\u03B4\u03B5"; // αβγδε
      // Ellipsis string + ambiguousIsNarrow boolean — no object needed:
      // Wide: 10 cols total. [0,4) = 2 chars = width 4. Cut → 3 cols content + ellipsis.
      // But 1 char is width 2, so "α" + ellipsis = width 3. End up with "α…" (width 3).
      expect(Bun.sliceAnsi(s, 0, 4, "\u2026", false)).toBe("\u03B1\u2026");
      // Narrow: 5 cols. [0,4) = 4 chars. Cut (5>4) → 3 chars + ellipsis.
      expect(Bun.sliceAnsi(s, 0, 4, "\u2026", true)).toBe("\u03B1\u03B2\u03B3\u2026");
      // 5th arg with undefined 4th also works:
      expect(Bun.sliceAnsi(s, 0, 2, undefined, false)).toBe("\u03B1");
      // Equivalence with object form:
      expect(Bun.sliceAnsi(s, 0, 4, "\u2026", false)).toBe(
        Bun.sliceAnsi(s, 0, 4, { ellipsis: "\u2026", ambiguousIsNarrow: false }),
      );
    });
  });

  // ======================================================================
  // Multi-codepoint grapheme cluster edge cases (skin tone, ZWJ, flags)
  // ======================================================================

  describe("multi-codepoint grapheme boundary handling", () => {
    test("skin-tone modifier stays attached to base across slice boundaries", () => {
      // 🤝🏻 = handshake (U+1F91D, w2) + light skin tone (U+1F3FB, joins, w0)
      // Cluster width 2; total string width 4.
      expect(Bun.sliceAnsi("\u{1F91D}\u{1F3FB}aa", 0, 4)).toBe("\u{1F91D}\u{1F3FB}aa");
      expect(Bun.sliceAnsi("\u{1F91D}\u{1F3FB}aa", 0, 2)).toBe("\u{1F91D}\u{1F3FB}");
      expect(Bun.sliceAnsi("\u{1F91D}\u{1F3FB}aa", 0, 3)).toBe("\u{1F91D}\u{1F3FB}a");
      // Slicing mid-cluster (start=2) should drop the whole cluster, not
      // emit an orphaned skin-tone modifier.
      expect(Bun.sliceAnsi("\u{1F91D}\u{1F3FB}aa", 2, 4)).toBe("aa");
    });

    test("ZWJ sequence stays intact across slice boundaries", () => {
      // 👩 + ZWJ + 💻 → woman technologist, cluster width 2
      expect(Bun.sliceAnsi("\u{1F469}\u200D\u{1F4BB}xy", 0, 4)).toBe("\u{1F469}\u200D\u{1F4BB}xy");
      expect(Bun.sliceAnsi("\u{1F469}\u200D\u{1F4BB}xy", 2, 4)).toBe("xy");
    });

    test("regional indicator pair stays intact", () => {
      // 🇺 + 🇸 → US flag, cluster width 2
      expect(Bun.sliceAnsi("\u{1F1FA}\u{1F1F8}xy", 0, 4)).toBe("\u{1F1FA}\u{1F1F8}xy");
    });

    test("trailing joiner at end boundary is included with its base", () => {
      // 👍🏿 at cols 8-10, slice to 10 should include the skin-tone
      // modifier (belongs to the base at col 8).
      expect(Bun.sliceAnsi("aaaaaaaa\u{1F44D}\u{1F3FF}", 0, 10)).toBe("aaaaaaaa\u{1F44D}\u{1F3FF}");
    });
  });

  // ======================================================================
  // Zero-copy fast path verification
  // ======================================================================

  describe("fast paths", () => {
    test("no-op slice returns the same string instance (zero-copy)", () => {
      const s = "hello world with no ansi codes";
      // With start=0 and no end, and no ellipsis, we should get the input back unchanged
      expect(Bun.sliceAnsi(s, 0)).toBe(s);
      expect(Bun.sliceAnsi(s)).toBe(s);
    });

    test("ASCII fast path gives correct slice results", () => {
      const s = "0123456789";
      expect(Bun.sliceAnsi(s, 2, 5)).toBe("234");
      expect(Bun.sliceAnsi(s, -3)).toBe("789");
      expect(Bun.sliceAnsi(s, -3, -1)).toBe("78");
      // With ellipsis
      expect(Bun.sliceAnsi(s, 0, 5, "\u2026")).toBe("0123\u2026");
      expect(Bun.sliceAnsi(s, -5, undefined, "\u2026")).toBe("\u20266789");
    });

    test("ASCII fast path matches slow path for equivalent inputs", () => {
      // Add a harmless ANSI reset to force slow path; visible result should match
      const plain = "abcdefghij";
      const withAnsi = "\u001B[0m" + plain;
      for (let start = 0; start <= 10; start++) {
        for (let end = start; end <= 10; end++) {
          const fast = Bun.sliceAnsi(plain, start, end);
          const slow = Bun.stripANSI(Bun.sliceAnsi(withAnsi, start, end));
          expect(fast).toBe(slow);
        }
      }
    });

    test("UTF-16 ASCII fast path (string forced to 16-bit)", () => {
      // Force a string into UTF-16 representation by including then removing a wide char.
      // JSC doesn't re-compact to Latin-1, so this exercises the uint16_t SIMD lane path.
      const wide = "hello world" + "\u00ff".slice(0, 0); // stays Latin-1 actually
      // Better: concat with a surrogate, then slice it off — result stays UTF-16
      const utf16 = ("hello world" + "\u{1F600}").slice(0, 11);
      expect(Bun.sliceAnsi(utf16, 0, 5)).toBe("hello");
      expect(Bun.sliceAnsi(utf16, 6, 11)).toBe("world");
      expect(Bun.sliceAnsi(utf16)).toBe(utf16);
      expect(Bun.sliceAnsi(utf16, 0, 5, "\u2026")).toBe("hell\u2026");
    });
  });
});
