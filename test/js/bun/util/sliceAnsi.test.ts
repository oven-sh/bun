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
      // Decomposed L-jamo (U+1100, width 2) + V-jamo (U+1161, width 1) form one
      // grapheme cluster with accumulated width 3 — matches Bun.stringWidth.
      expect(Bun.stringWidth("\u1100\u1161")).toBe(3);
      // [0, 3): the full cluster (normalizes to 가)
      expect(stripForVisibleComparison(Bun.sliceAnsi(input, 0, 3)).normalize("NFC")).toBe("가");
      // B is at column 3
      expect(stripForVisibleComparison(Bun.sliceAnsi(input, 3, 4))).toBe("B");
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
      expect(Bun.sliceAnsi("\u001B[20mTEST\u001B[49m", 0, 4)).toBe("\u001B[20mTEST\u001B[0m");
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

    test("does not swallow visible text after malformed CSI bytes", () => {
      const input = "\u001B[31\u0100A";
      expect(Bun.sliceAnsi(input, 0, 1)).toBe("\u0100");
      expect(Bun.sliceAnsi(input, 1, 2)).toBe("A");
    });

    test("does not swallow visible text after malformed CSI prefix", () => {
      const input = "\u001B[\u0100A";
      expect(Bun.sliceAnsi(input, 0, 1)).toBe("\u0100");
      expect(Bun.sliceAnsi(input, 1, 2)).toBe("A");
    });

    test("does not swallow visible text after malformed C1 CSI prefix", () => {
      const input = "\u009B\u0100A";
      expect(Bun.sliceAnsi(input, 0, 1)).toBe("\u0100");
      expect(Bun.sliceAnsi(input, 1, 2)).toBe("A");
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
