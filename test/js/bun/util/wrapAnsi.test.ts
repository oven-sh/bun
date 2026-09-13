import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("Bun.wrapAnsi", () => {
  describe("basic wrapping", () => {
    test("wraps text at word boundaries", () => {
      expect(Bun.wrapAnsi("hello world", 5)).toBe("hello\nworld");
    });

    test("handles empty string", () => {
      expect(Bun.wrapAnsi("", 10)).toBe("");
    });

    test("no wrapping needed", () => {
      expect(Bun.wrapAnsi("hello", 10)).toBe("hello");
    });

    test("wraps multiple words", () => {
      expect(Bun.wrapAnsi("one two three four", 8)).toBe("one two\nthree\nfour");
    });

    test("handles single long word", () => {
      // Without hard mode, word stays on one line
      expect(Bun.wrapAnsi("abcdefghij", 5)).toBe("abcdefghij");
    });

    test("handles columns = 0", () => {
      // Edge case: should return original string
      expect(Bun.wrapAnsi("hello", 0)).toBe("hello");
    });
  });

  describe("hard wrap option", () => {
    test("breaks long words in middle", () => {
      expect(Bun.wrapAnsi("abcdefgh", 3, { hard: true })).toBe("abc\ndef\ngh");
    });

    test("breaks very long word", () => {
      expect(Bun.wrapAnsi("abcdefghij", 4, { hard: true })).toBe("abcd\nefgh\nij");
    });
  });

  describe("wordWrap option", () => {
    test("wordWrap false disables wrapping", () => {
      // Without wordWrap, only explicit newlines should cause breaks
      const result = Bun.wrapAnsi("hello world", 5, { wordWrap: false });
      // The behavior may vary - just check it doesn't crash
      expect(typeof result).toBe("string");
    });

    // wordWrap defaults on and is `options.wordWrap !== false`: only an
    // explicit `false` turns it off, other falsy values keep the default.
    test.each([undefined, null, 0, ""])("wordWrap: %p keeps word wrapping on", value => {
      expect(Bun.wrapAnsi("hello world", 3, { wordWrap: value as boolean })).toBe("hello\nworld");
    });

    test("wordWrap: false breaks words character-by-character", () => {
      expect(Bun.wrapAnsi("hello world", 3, { wordWrap: false })).toBe("hel\nlo\nwor\nld");
    });
  });

  describe("trim option", () => {
    test("trims leading whitespace by default", () => {
      expect(Bun.wrapAnsi("  hello", 10)).toBe("hello");
    });

    test("trim false preserves leading whitespace", () => {
      expect(Bun.wrapAnsi("  hello", 10, { trim: false })).toBe("  hello");
    });

    // trim defaults on and is `options.trim !== false`: only an explicit
    // `false` turns it off, other falsy values keep the default.
    test.each([undefined, null, 0, ""])("trim: %p keeps trimming on", value => {
      expect(Bun.wrapAnsi("hello world", 5, { trim: value as boolean })).toBe("hello\nworld");
    });

    test("trim: false keeps the separator space on its own row", () => {
      expect(Bun.wrapAnsi("hello world", 5, { trim: false })).toBe("hello\n \nworld");
    });

    describe("keeps zero-width non-space characters", () => {
      // Trailing-space trim removes only U+0020 past the last visible word;
      // zero-width content (ZWSP, ZWJ, combining marks, escapes) is kept, as in
      // wrap-ansi's stringVisibleTrimSpacesRight.
      const cases: [label: string, input: string, columns: number, expected: string][] = [
        ["ZWSP word wrapped", "ab \u200B cd", 2, "ab\u200B\ncd"],
        ["ZWSP trailing word fits", "ab \u200B", 5, "ab\u200B"],
        ["ZWSP trailing word wrapped", "ab \u200B", 2, "ab\u200B"],
        ["ZWSP alone", "\u200B", 5, "\u200B"],
        ["ZWSP with surrounding spaces", " \u200B ", 5, "\u200B"],
        ["ZWSP inside SGR", "ab \x1b[31m\u200B\x1b[39m cd", 2, "ab\x1b[31m\u200B\x1b[39m\ncd"],
        ["ZWSP inside SGR alone", "\x1b[31m\u200B\x1b[39m", 5, "\x1b[31m\u200B\x1b[39m"],
        ["ZWJ word", "a \u200D b", 1, "a\u200D\nb"],
        ["combining mark word", "ab \u0301 cd", 2, "ab\u0301\ncd"],
        ["trailing space after zero-width word", "ab \u200B ", 10, "ab\u200B"],
        ["zero-width tail then SGR", "ab \u200B \x1b[31m", 2, "ab\u200B\x1b[31m"],
      ];
      test.each(cases)("%s", (_, input, columns, expected) => {
        expect(Bun.wrapAnsi(input, columns)).toBe(expected);
        expect(Bun.wrapAnsi(input, columns, { hard: true })).toBe(expected);
      });

      test("family emoji hard-wrapped at columns=1 keeps every ZWJ", () => {
        const fam = "\u{1F469}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}";
        expect(Bun.wrapAnsi(fam, 1, { hard: true })).toBe(
          "\n\u{1F469}\n\u200D\n\u{1F469}\n\u200D\n\u{1F467}\n\u200D\n\u{1F466}",
        );
      });
    });

    // Leading-whitespace trim must not depend on which escape sequence precedes
    // it: the CSI scanner ends on any final byte in 0x40-0x7E (ECMA-48 §5.4),
    // not just SGR's 'm'. With the escape stripped the result is identical.
    describe("leading trim after non-SGR escape prefixes", () => {
      const trimCases: [label: string, input: string, columns: number, expected: string][] = [
        ["SGR red", "\x1b[31m\tab cd", 2, "\x1b[31mab\x1b[39m\n\x1b[31mcd"],
        ["clear screen", "\x1b[2J\tab cd", 2, "\x1b[2Jab\ncd"],
        ["erase line", "\x1b[0K\tab cd", 2, "\x1b[0Kab\ncd"],
        ["cursor home", "\x1b[H\tab cd", 2, "\x1b[Hab\ncd"],
        ["cursor up", "\x1b[1A\tab cd", 2, "\x1b[1Aab\ncd"],
        ["cursor position", "\x1b[1;1H\tab cd", 2, "\x1b[1;1Hab\ncd"],
        ["DEC private mode", "\x1b[?25l\tab cd", 2, "\x1b[?25lab\ncd"],
        [
          "OSC 8 hyperlink",
          "\x1b]8;;http://x\x07\tab cd",
          2,
          "\x1b]8;;http://x\x07ab\x1b]8;;\x07\n\x1b]8;;http://x\x07cd",
        ],
        ["CSI then SGR", "\x1b[2J\x1b[31m\tab cd", 2, "\x1b[2J\x1b[31mab\x1b[39m\n\x1b[31mcd"],
      ];

      describe.each(trimCases)("%s", (_, input, columns, expected) => {
        test("trims leading tab", () => {
          expect(Bun.wrapAnsi(input, columns)).toBe(expected);
        });
        test("stripANSI composes with wrapAnsi", () => {
          expect(Bun.stripANSI(Bun.wrapAnsi(input, columns))).toBe(Bun.wrapAnsi(Bun.stripANSI(input), columns));
        });
        test("trim:false preserves leading tab", () => {
          expect(Bun.wrapAnsi(input, columns, { trim: false })).toContain("\t");
        });
      });
    });
  });

  describe("ANSI escape codes", () => {
    test("preserves simple color code", () => {
      const input = "\x1b[31mhello\x1b[0m";
      const result = Bun.wrapAnsi(input, 10);
      expect(result).toContain("\x1b[31m");
      expect(result).toContain("hello");
    });

    test("preserves color across line break", () => {
      const input = "\x1b[31mhello world\x1b[0m";
      const result = Bun.wrapAnsi(input, 5);
      // Should have close code (39) before newline and restore (31) after
      expect(result).toContain("\x1b[39m\n");
      expect(result).toContain("\n\x1b[31m");
    });

    test("handles multiple colors", () => {
      const input = "\x1b[31mred\x1b[0m \x1b[32mgreen\x1b[0m";
      const result = Bun.wrapAnsi(input, 20);
      expect(result).toContain("red");
      expect(result).toContain("green");
    });

    test("handles bold and styles", () => {
      const input = "\x1b[1mbold\x1b[0m";
      const result = Bun.wrapAnsi(input, 10);
      expect(result).toContain("\x1b[1m");
      expect(result).toContain("bold");
    });

    test("ANSI codes don't count toward width", () => {
      const input = "\x1b[31mab\x1b[0m";
      // ANSI codes should not count toward width
      // "ab" is 2 chars, should fit in width 2
      expect(Bun.wrapAnsi(input, 2)).toBe(input);
    });

    // SGR close codes (22-29, 49, 55) and unknown codes have no close mapping
    // in ansi-styles' codes map, so npm wrap-ansi never re-emits them after a
    // line break. Only open codes with a known close code are closed-then-reopened.
    test.each([22, 23, 24, 25, 27, 28, 29, 49, 55, 39, 0, 200])(
      "does not re-open SGR close/unknown code %p after line break",
      code => {
        expect(Bun.wrapAnsi(`\x1b[${code}mabc def`, 3)).toBe(`\x1b[${code}mabc\ndef`);
      },
    );

    test.each([
      [1, 22],
      [4, 24],
      [31, 39],
      [42, 49],
      [53, 55],
      [100, 49],
    ])("re-opens SGR open code %p after line break", (open, close) => {
      expect(Bun.wrapAnsi(`\x1b[${open}mabc def`, 3)).toBe(`\x1b[${open}mabc\x1b[${close}m\n\x1b[${open}mdef`);
    });

    test("close code following an open code is not carried across line break", () => {
      expect(Bun.wrapAnsi("\x1b[42mab\x1b[49mcd ef", 4)).toBe("\x1b[42mab\x1b[49mcd\nef");
    });
  });

  // Every escape form from the ECMA-48 grammar is zero-width and never split:
  // nF (ESC ( 0), Fs (ESC 7), C1 CSI (0x9b) and control strings (DCS ... ST).
  describe("escape grammar", () => {
    const boxes = "x\x1b(0lqqqqqqqqqqk\x1b(B";
    const cases: [
      label: string,
      input: string,
      columns: number,
      options: Bun.WrapAnsiOptions | undefined,
      expected: string,
    ][] = [
      ["DEC line-drawing charset (ESC ( 0) hard", boxes, 6, { hard: true }, "x\x1b(0lqqqq\nqqqqqq\nk\x1b(B"],
      ["DEC line-drawing charset soft", boxes, 6, undefined, boxes],
      ["Fs escape (ESC 7) hard", "aaa \x1b7bbbbbbb cc", 6, { hard: true }, "aaa \x1b7bb\nbbbbb\ncc"],
      [
        "Fs escape (ESC 7) hard trim:false",
        "aaa \x1b7bbbbbbb cc",
        6,
        { hard: true, trim: false },
        "aaa \x1b7bb\nbbbbb \ncc",
      ],
      ["Fs escape (ESC 7) soft", "aaa \x1b7bbbbbbb cc", 6, undefined, "aaa\n\x1b7bbbbbbb\ncc"],
      ["Fs escape (ESC 7) wordWrap:false", "aaa \x1b7bbbbbbb cc", 6, { wordWrap: false }, "aaa \x1b7bb\nbbbbb\ncc"],
      ["C1 CSI (0x9b) hard", "aaaa\x9b31mbb", 3, { hard: true }, "aaa\na\x9b31mbb"],
      ["C1 CSI non-SGR final byte (K)", "\x9b2Kabcdef", 3, { hard: true }, "\x9b2Kabc\ndef"],
      ["C1 CSI SGR carried across a row break", "\x9b31mabc def", 3, undefined, "\x9b31mabc\x1b[39m\n\x1b[31mdef"],
      ["DCS payload with a space", "ab \x1bPfoo bar\x1b\\cd ef", 5, undefined, "ab \x1bPfoo bar\x1b\\cd\nef"],
      ["C1 DCS (0x90) with C1 ST (0x9c)", "ab \x90foo bar\x9ccd ef", 5, undefined, "ab \x90foo bar\x9ccd\nef"],
      // A control-string payload is opaque: C1 CSI / OSC 8 bytes inside it do
      // not open a style or hyperlink that would be carried across rows.
      [
        "C1 CSI bytes inside an SOS payload are not a style",
        "\x1bXnote\x9b31m\x1b\\aaaa bbbb",
        4,
        undefined,
        "\x1bXnote\x9b31m\x1b\\aaaa\nbbbb",
      ],
      [
        "C1 OSC 8 inside an SOS payload is not a hyperlink",
        "\x1bXn\x9d8;;http://evil\x07\x1b\\aaaa bbbb",
        4,
        undefined,
        "\x1bXn\x9d8;;http://evil\x07\x1b\\aaaa\nbbbb",
      ],
      [
        "SGR hard wrap around wide chars (UTF-16 path)",
        "\x1b[31m日本語\x1b[39m",
        4,
        { hard: true },
        "\x1b[31m日本\x1b[39m\n\x1b[31m語\x1b[39m",
      ],
    ];
    test.each(cases)("%s", (_, input, columns, options, expected) => {
      expect(Bun.wrapAnsi(input, columns, options)).toBe(expected);
    });
  });

  describe("OSC 8 hyperlinks", () => {
    const cases: [
      label: string,
      input: string,
      columns: number,
      options: Bun.WrapAnsiOptions | undefined,
      expected: string,
    ][] = [
      // A space inside the URL is OSC payload, not a word boundary; the link is
      // closed at the row end and re-opened on the next row.
      [
        "BEL terminator, space in URL",
        "\x1b]8;;file:///a b.txt\x07link text\x1b]8;;\x07",
        5,
        undefined,
        "\x1b]8;;file:///a b.txt\x07link\x1b]8;;\x07\n\x1b]8;;file:///a b.txt\x07text\x1b]8;;\x07",
      ],
      [
        "ST terminator (ESC backslash)",
        "\x1b]8;;http://example.com\x1b\\text here\x1b]8;;\x1b\\",
        5,
        undefined,
        "\x1b]8;;http://example.com\x1b\\text\x1b]8;;\x07\n\x1b]8;;http://example.com\x07here\x1b]8;;\x1b\\",
      ],
      // The id= params are kept when the link is re-opened on the next row.
      [
        "id= params",
        "\x1b]8;id=foo;http://example.com\x07link text here\x1b]8;;\x07",
        5,
        undefined,
        "\x1b]8;id=foo;http://example.com\x07link\x1b]8;;\x07\n\x1b]8;id=foo;http://example.com\x07text\x1b]8;;\x07\n\x1b]8;id=foo;http://example.com\x07here\x1b]8;;\x07",
      ],
      [
        "hard wrap inside link text",
        "\x1b]8;;http://x\x07abcdef\x1b]8;;\x07",
        3,
        { hard: true },
        "\x1b]8;;http://x\x07abc\x1b]8;;\x07\n\x1b]8;;http://x\x07def\x1b]8;;\x07",
      ],
      [
        "C1 OSC (0x9d) with C1 ST (0x9c)",
        "\x9d8;;http://x\x9cab cd",
        2,
        undefined,
        "\x9d8;;http://x\x9cab\x1b]8;;\x07\n\x1b]8;;http://x\x07cd",
      ],
      // An OSC 8 aborted by CAN/SUB (payload discarded) or by a new escape
      // sequence never opened a link, so nothing is closed/re-opened at rows.
      [
        "OSC 8 aborted by CAN opens no link",
        "\x1b]8;;http://x\x18clickable words here",
        9,
        undefined,
        "\x1b]8;;http://x\x18clickable\nwords\nhere",
      ],
      [
        "OSC 8 aborted by SUB opens no link",
        "\x1b]8;;http://x\x1aclickable words here",
        9,
        undefined,
        "\x1b]8;;http://x\x1aclickable\nwords\nhere",
      ],
      [
        "OSC 8 aborted by a new escape sequence opens no link",
        "\x1b]8;;http://x\x1b7clickable words here",
        9,
        undefined,
        "\x1b]8;;http://x\x1b7clickable\nwords\nhere",
      ],
      [
        "closed link with a spaced URL fits on one row",
        "\x1b]8;;file:///Users/me/My Documents/notes.txt\x07notes\x1b]8;;\x07 open",
        10,
        undefined,
        "\x1b]8;;file:///Users/me/My Documents/notes.txt\x07notes\x1b]8;;\x07 open",
      ],
      [
        "closed link with a spaced URL wraps between words",
        "\x1b]8;;file:///Users/me/My Documents/notes.txt\x07notes\x1b]8;;\x07 open",
        5,
        undefined,
        "\x1b]8;;file:///Users/me/My Documents/notes.txt\x07notes\x1b]8;;\x07\nopen",
      ],
    ];
    test.each(cases)("%s", (_, input, columns, options, expected) => {
      expect(Bun.wrapAnsi(input, columns, options)).toBe(expected);
    });

    // An unterminated OSC swallows the rest of the line as payload (as a
    // terminal does), so it is never split and the output cannot grow beyond
    // the input.
    test.each([false, true])("unterminated OSC 8 is not split (hard: %p)", hard => {
      const input = "\x1b]8;;http://x/" + Buffer.alloc(1000 * 5, " word").toString();
      const output = Bun.wrapAnsi(input, 80, { hard });
      expect({ length: output.length, sameAsInput: output === input }).toEqual({
        length: input.length,
        sameAsInput: true,
      });
      expect(output.length).toBeLessThan(input.length * 2);
    });
  });

  describe("carriage return", () => {
    // A bare \r breaks a line like \n does (each break is emitted as one \n).
    // Claude Code's wrap-text maps wrapped output back onto the original
    // string by relying on every \r becoming a break.
    test.each([undefined, { hard: true }])("bare \\r is a line break (%p)", options => {
      expect(Bun.wrapAnsi("AA\rBB\rCC", 100, options)).toBe("AA\nBB\nCC");
      expect(Bun.wrapAnsi("Downloading  40%\rDownloading 100% done, moving on to next step", 24, options)).toBe(
        "Downloading  40%\nDownloading 100% done,\nmoving on to next step",
      );
    });

    test("trailing bare \\r is a break to an empty final line", () => {
      expect(Bun.wrapAnsi("abc\r", 10)).toBe("abc\n");
    });

    test("\\r\\n normalizes to \\n", () => {
      expect(Bun.wrapAnsi("hello\r\nworld", 10)).toBe("hello\nworld");
      expect(Bun.wrapAnsi("hello\r\nworld", 3, { hard: true })).toBe("hel\nlo\nwor\nld");
    });
  });

  describe("Unicode support", () => {
    test("handles full-width characters", () => {
      // 日本語 characters are 2 columns each
      const input = "日本";
      // "日本" is 4 columns (2 chars * 2 width each)
      const result = Bun.wrapAnsi(input, 4);
      expect(result).toBe("日本");
    });

    test("wraps full-width characters with hard", () => {
      const input = "日本語";
      // Each char is 2 columns, so "日本語" is 6 columns
      // Width 4 means we can fit 2 chars per line (with hard wrap)
      const result = Bun.wrapAnsi(input, 4, { hard: true });
      expect(result).toContain("\n");
      expect(result).toBe("日本\n語");
    });

    test("does not wrap full-width characters without hard", () => {
      const input = "日本語";
      // Without hard, long words are not broken
      const result = Bun.wrapAnsi(input, 4);
      expect(result).toBe("日本語");
    });

    test("handles emoji", () => {
      const input = "hello 👋 world";
      const result = Bun.wrapAnsi(input, 20);
      expect(result).toContain("👋");
    });
  });

  describe("word-initial cluster-fusing codepoints", () => {
    // A word-initial codepoint that joins the preceding grapheme cluster (e.g. the
    // combining enclosing keycap U+20E3 fusing with the separator space) makes the
    // row's width less than the sum of its parts, so it must be recomputed.
    const cases: [input: string, columns: number, hard: boolean, wordWrap: boolean, trim: boolean, expected: string][] =
      [
        ["aa \u20E3bb cc", 7, false, false, false, "aa \u20E3bb \ncc"],
        ["aa \u20E3bb cc", 7, false, false, true, "aa \u20E3bb\ncc"],
        ["aa \u20E3bb cc", 7, false, true, false, "aa \u20E3bb \ncc"],
        ["aa \u20E3bb cc", 7, false, true, true, "aa \u20E3bb\ncc"],
        ["aa \u20E3bb cc", 7, true, false, false, "aa \u20E3bb \ncc"],
        ["aa \u20E3bb cc", 7, true, false, true, "aa \u20E3bb\ncc"],
        ["aa \u20E3bb cc", 7, true, true, false, "aa \u20E3bb \ncc"],
        ["aa \u20E3bb cc", 7, true, true, true, "aa \u20E3bb\ncc"],
        ["aa \u20E3bb cc", 8, false, false, false, "aa \u20E3bb c\nc"],
        ["aa \u20E3bb cc", 8, false, false, true, "aa \u20E3bb c\nc"],
        ["aa \u20E3bb cc", 8, false, true, false, "aa \u20E3bb \ncc"],
        ["aa \u20E3bb cc", 8, false, true, true, "aa \u20E3bb\ncc"],
        ["aa \u20E3bb cc", 8, true, false, false, "aa \u20E3bb c\nc"],
        ["aa \u20E3bb cc", 8, true, false, true, "aa \u20E3bb c\nc"],
        ["aa \u20E3bb cc", 8, true, true, false, "aa \u20E3bb \ncc"],
        ["aa \u20E3bb cc", 8, true, true, true, "aa \u20E3bb\ncc"],
        ["aa \u20E3bb cc", 9, false, false, false, "aa \u20E3bb cc"],
        ["aa \u20E3bb cc", 9, false, false, true, "aa \u20E3bb cc"],
        ["aa \u20E3bb cc", 9, false, true, false, "aa \u20E3bb cc"],
        ["aa \u20E3bb cc", 9, false, true, true, "aa \u20E3bb cc"],
        ["aa \u20E3bb cc", 9, true, false, false, "aa \u20E3bb cc"],
        ["aa \u20E3bb cc", 9, true, false, true, "aa \u20E3bb cc"],
        ["aa \u20E3bb cc", 9, true, true, false, "aa \u20E3bb cc"],
        ["aa \u20E3bb cc", 9, true, true, true, "aa \u20E3bb cc"],
        [
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mcc\u001B[39m",
          7,
          false,
          false,
          false,
          "\u001B[31maa\u001B[39m \u20E3bb \n\u001B[31mcc\u001B[39m",
        ],
        [
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mcc\u001B[39m",
          7,
          false,
          false,
          true,
          "\u001B[31maa\u001B[39m \u20E3bb\n\u001B[31mcc\u001B[39m",
        ],
        [
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mcc\u001B[39m",
          7,
          false,
          true,
          false,
          "\u001B[31maa\u001B[39m \u20E3bb \n\u001B[31mcc\u001B[39m",
        ],
        [
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mcc\u001B[39m",
          7,
          false,
          true,
          true,
          "\u001B[31maa\u001B[39m \u20E3bb\n\u001B[31mcc\u001B[39m",
        ],
        [
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mcc\u001B[39m",
          7,
          true,
          false,
          false,
          "\u001B[31maa\u001B[39m \u20E3bb \n\u001B[31mcc\u001B[39m",
        ],
        [
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mcc\u001B[39m",
          7,
          true,
          false,
          true,
          "\u001B[31maa\u001B[39m \u20E3bb\n\u001B[31mcc\u001B[39m",
        ],
        [
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mcc\u001B[39m",
          7,
          true,
          true,
          false,
          "\u001B[31maa\u001B[39m \u20E3bb \n\u001B[31mcc\u001B[39m",
        ],
        [
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mcc\u001B[39m",
          7,
          true,
          true,
          true,
          "\u001B[31maa\u001B[39m \u20E3bb\n\u001B[31mcc\u001B[39m",
        ],
        [
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mcc\u001B[39m",
          8,
          false,
          false,
          false,
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mc\u001B[39m\n\u001B[31mc\u001B[39m",
        ],
        [
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mcc\u001B[39m",
          8,
          false,
          false,
          true,
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mc\u001B[39m\n\u001B[31mc\u001B[39m",
        ],
        [
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mcc\u001B[39m",
          8,
          false,
          true,
          false,
          "\u001B[31maa\u001B[39m \u20E3bb \n\u001B[31mcc\u001B[39m",
        ],
        [
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mcc\u001B[39m",
          8,
          false,
          true,
          true,
          "\u001B[31maa\u001B[39m \u20E3bb\n\u001B[31mcc\u001B[39m",
        ],
        [
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mcc\u001B[39m",
          8,
          true,
          false,
          false,
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mc\u001B[39m\n\u001B[31mc\u001B[39m",
        ],
        [
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mcc\u001B[39m",
          8,
          true,
          false,
          true,
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mc\u001B[39m\n\u001B[31mc\u001B[39m",
        ],
        [
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mcc\u001B[39m",
          8,
          true,
          true,
          false,
          "\u001B[31maa\u001B[39m \u20E3bb \n\u001B[31mcc\u001B[39m",
        ],
        [
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mcc\u001B[39m",
          8,
          true,
          true,
          true,
          "\u001B[31maa\u001B[39m \u20E3bb\n\u001B[31mcc\u001B[39m",
        ],
        [
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mcc\u001B[39m",
          9,
          false,
          false,
          false,
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mcc\u001B[39m",
        ],
        [
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mcc\u001B[39m",
          9,
          false,
          false,
          true,
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mcc\u001B[39m",
        ],
        [
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mcc\u001B[39m",
          9,
          false,
          true,
          false,
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mcc\u001B[39m",
        ],
        [
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mcc\u001B[39m",
          9,
          false,
          true,
          true,
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mcc\u001B[39m",
        ],
        [
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mcc\u001B[39m",
          9,
          true,
          false,
          false,
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mcc\u001B[39m",
        ],
        [
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mcc\u001B[39m",
          9,
          true,
          false,
          true,
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mcc\u001B[39m",
        ],
        [
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mcc\u001B[39m",
          9,
          true,
          true,
          false,
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mcc\u001B[39m",
        ],
        [
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mcc\u001B[39m",
          9,
          true,
          true,
          true,
          "\u001B[31maa\u001B[39m \u20E3bb \u001B[31mcc\u001B[39m",
        ],
        ["aa\tz \uFE0Fbb cc", 8, false, false, false, "aa\tz \uFE0Fbb c\nc"],
        ["aa\tz \uFE0Fbb cc", 8, false, false, true, "aa\tz \uFE0Fbb c\nc"],
        ["aa\tz \uFE0Fbb cc", 8, false, true, false, "aa\tz \uFE0Fbb \ncc"],
        ["aa\tz \uFE0Fbb cc", 8, false, true, true, "aa\tz \uFE0Fbb\ncc"],
        ["aa\tz \uFE0Fbb cc", 8, true, false, false, "aa\tz \uFE0Fbb c\nc"],
        ["aa\tz \uFE0Fbb cc", 8, true, false, true, "aa\tz \uFE0Fbb c\nc"],
        ["aa\tz \uFE0Fbb cc", 8, true, true, false, "aa\tz \uFE0Fbb \ncc"],
        ["aa\tz \uFE0Fbb cc", 8, true, true, true, "aa\tz \uFE0Fbb\ncc"],
        ["aa \u0301bb cc", 8, false, false, false, "aa \u0301bb cc"],
        ["aa \u0301bb cc", 8, false, false, true, "aa \u0301bb cc"],
        ["aa \u0301bb cc", 8, false, true, false, "aa \u0301bb cc"],
        ["aa \u0301bb cc", 8, false, true, true, "aa \u0301bb cc"],
        ["aa \u0301bb cc", 8, true, false, false, "aa \u0301bb cc"],
        ["aa \u0301bb cc", 8, true, false, true, "aa \u0301bb cc"],
        ["aa \u0301bb cc", 8, true, true, false, "aa \u0301bb cc"],
        ["aa \u0301bb cc", 8, true, true, true, "aa \u0301bb cc"],
        // U+0600 (Prepend) is a width-0 first word; with trim the next word is
        // appended with no separator space and fuses with it across the rows.
        ["\u0600 \u{1F44D}\u{1F3FF}ab cd", 7, false, false, false, "\u0600 \u{1F44D}\u{1F3FF}ab c\nd"],
        ["\u0600 \u{1F44D}\u{1F3FF}ab cd", 7, false, false, true, "\u0600\u{1F44D}\u{1F3FF}ab\ncd"],
        ["\u0600 \u{1F44D}\u{1F3FF}ab cd", 7, false, true, false, "\u0600 \u{1F44D}\u{1F3FF}ab \ncd"],
        ["\u0600 \u{1F44D}\u{1F3FF}ab cd", 7, false, true, true, "\u0600\u{1F44D}\u{1F3FF}ab\ncd"],
        ["\u0600 \u{1F44D}\u{1F3FF}ab cd", 7, true, false, false, "\u0600 \u{1F44D}\u{1F3FF}ab c\nd"],
        ["\u0600 \u{1F44D}\u{1F3FF}ab cd", 7, true, false, true, "\u0600\u{1F44D}\u{1F3FF}ab\ncd"],
        ["\u0600 \u{1F44D}\u{1F3FF}ab cd", 7, true, true, false, "\u0600 \u{1F44D}\u{1F3FF}ab \ncd"],
        ["\u0600 \u{1F44D}\u{1F3FF}ab cd", 7, true, true, true, "\u0600\u{1F44D}\u{1F3FF}ab\ncd"],
        ["\u0600 \u{1F44D}\u{1F3FF}ab cd", 8, false, false, false, "\u0600 \u{1F44D}\u{1F3FF}ab cd"],
        ["\u0600 \u{1F44D}\u{1F3FF}ab cd", 8, false, false, true, "\u0600\u{1F44D}\u{1F3FF}ab c\nd"],
        ["\u0600 \u{1F44D}\u{1F3FF}ab cd", 8, false, true, false, "\u0600 \u{1F44D}\u{1F3FF}ab cd"],
        ["\u0600 \u{1F44D}\u{1F3FF}ab cd", 8, false, true, true, "\u0600\u{1F44D}\u{1F3FF}ab\ncd"],
        ["\u0600 \u{1F44D}\u{1F3FF}ab cd", 8, true, false, false, "\u0600 \u{1F44D}\u{1F3FF}ab cd"],
        ["\u0600 \u{1F44D}\u{1F3FF}ab cd", 8, true, false, true, "\u0600\u{1F44D}\u{1F3FF}ab c\nd"],
        ["\u0600 \u{1F44D}\u{1F3FF}ab cd", 8, true, true, false, "\u0600 \u{1F44D}\u{1F3FF}ab cd"],
        ["\u0600 \u{1F44D}\u{1F3FF}ab cd", 8, true, true, true, "\u0600\u{1F44D}\u{1F3FF}ab\ncd"],
        // Same no-space seam with the Prepend hidden behind a trailing escape:
        // the cluster still fuses across the escape sequence.
        [
          "\u001B[31m\u0600\u001B[39m \u{1F44D}\u{1F3FF}ab cd",
          7,
          false,
          false,
          false,
          "\u001B[31m\u0600\u001B[39m \u{1F44D}\u{1F3FF}ab c\nd",
        ],
        [
          "\u001B[31m\u0600\u001B[39m \u{1F44D}\u{1F3FF}ab cd",
          7,
          false,
          false,
          true,
          "\u001B[31m\u0600\u001B[39m\u{1F44D}\u{1F3FF}ab\ncd",
        ],
        [
          "\u001B[31m\u0600\u001B[39m \u{1F44D}\u{1F3FF}ab cd",
          7,
          false,
          true,
          false,
          "\u001B[31m\u0600\u001B[39m \u{1F44D}\u{1F3FF}ab \ncd",
        ],
        [
          "\u001B[31m\u0600\u001B[39m \u{1F44D}\u{1F3FF}ab cd",
          7,
          false,
          true,
          true,
          "\u001B[31m\u0600\u001B[39m\u{1F44D}\u{1F3FF}ab\ncd",
        ],
        [
          "\u001B[31m\u0600\u001B[39m \u{1F44D}\u{1F3FF}ab cd",
          7,
          true,
          false,
          false,
          "\u001B[31m\u0600\u001B[39m \u{1F44D}\u{1F3FF}ab c\nd",
        ],
        [
          "\u001B[31m\u0600\u001B[39m \u{1F44D}\u{1F3FF}ab cd",
          7,
          true,
          false,
          true,
          "\u001B[31m\u0600\u001B[39m\u{1F44D}\u{1F3FF}ab\ncd",
        ],
        [
          "\u001B[31m\u0600\u001B[39m \u{1F44D}\u{1F3FF}ab cd",
          7,
          true,
          true,
          false,
          "\u001B[31m\u0600\u001B[39m \u{1F44D}\u{1F3FF}ab \ncd",
        ],
        [
          "\u001B[31m\u0600\u001B[39m \u{1F44D}\u{1F3FF}ab cd",
          7,
          true,
          true,
          true,
          "\u001B[31m\u0600\u001B[39m\u{1F44D}\u{1F3FF}ab\ncd",
        ],
        // ANSI-prefixed words: an SGR sequence (ESC is ASCII) at the start of a word
        // must not hide the cluster-fusing codepoint that actually lands on the seam.
        // Escape-wrapped emoji+modifier word after an escape-wrapped width-0 Prepend row.
        [
          "\u001B[31m\u0600\u001B[39m \u001B[31m\u{1F44D}\u{1F3FF}\u001B[39mab cd",
          7,
          false,
          false,
          false,
          "\u001B[31m\u0600\u001B[39m \u001B[31m\u{1F44D}\u{1F3FF}\u001B[39mab c\nd",
        ],
        [
          "\u001B[31m\u0600\u001B[39m \u001B[31m\u{1F44D}\u{1F3FF}\u001B[39mab cd",
          7,
          false,
          false,
          true,
          "\u001B[31m\u0600\u001B[39m\u001B[31m\u{1F44D}\u{1F3FF}\u001B[39mab\ncd",
        ],
        [
          "\u001B[31m\u0600\u001B[39m \u001B[31m\u{1F44D}\u{1F3FF}\u001B[39mab cd",
          7,
          false,
          true,
          false,
          "\u001B[31m\u0600\u001B[39m \u001B[31m\u{1F44D}\u{1F3FF}\u001B[39mab \ncd",
        ],
        [
          "\u001B[31m\u0600\u001B[39m \u001B[31m\u{1F44D}\u{1F3FF}\u001B[39mab cd",
          7,
          false,
          true,
          true,
          "\u001B[31m\u0600\u001B[39m\u001B[31m\u{1F44D}\u{1F3FF}\u001B[39mab\ncd",
        ],
        [
          "\u001B[31m\u0600\u001B[39m \u001B[31m\u{1F44D}\u{1F3FF}\u001B[39mab cd",
          7,
          true,
          false,
          false,
          "\u001B[31m\u0600\u001B[39m \u001B[31m\u{1F44D}\u{1F3FF}\u001B[39mab c\nd",
        ],
        [
          "\u001B[31m\u0600\u001B[39m \u001B[31m\u{1F44D}\u{1F3FF}\u001B[39mab cd",
          7,
          true,
          false,
          true,
          "\u001B[31m\u0600\u001B[39m\u001B[31m\u{1F44D}\u{1F3FF}\u001B[39mab\ncd",
        ],
        [
          "\u001B[31m\u0600\u001B[39m \u001B[31m\u{1F44D}\u{1F3FF}\u001B[39mab cd",
          7,
          true,
          true,
          false,
          "\u001B[31m\u0600\u001B[39m \u001B[31m\u{1F44D}\u{1F3FF}\u001B[39mab \ncd",
        ],
        [
          "\u001B[31m\u0600\u001B[39m \u001B[31m\u{1F44D}\u{1F3FF}\u001B[39mab cd",
          7,
          true,
          true,
          true,
          "\u001B[31m\u0600\u001B[39m\u001B[31m\u{1F44D}\u{1F3FF}\u001B[39mab\ncd",
        ],
        // Escape-prefixed keycap word: SPACE + U+20E3 still fuses across the escape.
        ["aa \u001B[31m\u20E3bb\u001B[39m cc", 7, false, false, false, "aa \u001B[31m\u20E3bb\u001B[39m \ncc"],
        ["aa \u001B[31m\u20E3bb\u001B[39m cc", 7, false, false, true, "aa \u001B[31m\u20E3bb\u001B[39m\ncc"],
        ["aa \u001B[31m\u20E3bb\u001B[39m cc", 7, false, true, false, "aa \u001B[31m\u20E3bb\u001B[39m \ncc"],
        ["aa \u001B[31m\u20E3bb\u001B[39m cc", 7, false, true, true, "aa \u001B[31m\u20E3bb\u001B[39m\ncc"],
        ["aa \u001B[31m\u20E3bb\u001B[39m cc", 7, true, false, false, "aa \u001B[31m\u20E3bb\u001B[39m \ncc"],
        ["aa \u001B[31m\u20E3bb\u001B[39m cc", 7, true, false, true, "aa \u001B[31m\u20E3bb\u001B[39m\ncc"],
        ["aa \u001B[31m\u20E3bb\u001B[39m cc", 7, true, true, false, "aa \u001B[31m\u20E3bb\u001B[39m \ncc"],
        ["aa \u001B[31m\u20E3bb\u001B[39m cc", 7, true, true, true, "aa \u001B[31m\u20E3bb\u001B[39m\ncc"],
        // At 9 columns the fused row fits exactly (real width 9); the stale additive
        // width (10) would wrongly wrap it.
        ["aa \u001B[31m\u20E3bb\u001B[39m cc", 9, false, false, false, "aa \u001B[31m\u20E3bb\u001B[39m cc"],
        ["aa \u001B[31m\u20E3bb\u001B[39m cc", 9, false, false, true, "aa \u001B[31m\u20E3bb\u001B[39m cc"],
        ["aa \u001B[31m\u20E3bb\u001B[39m cc", 9, false, true, false, "aa \u001B[31m\u20E3bb\u001B[39m cc"],
        ["aa \u001B[31m\u20E3bb\u001B[39m cc", 9, false, true, true, "aa \u001B[31m\u20E3bb\u001B[39m cc"],
        ["aa \u001B[31m\u20E3bb\u001B[39m cc", 9, true, false, false, "aa \u001B[31m\u20E3bb\u001B[39m cc"],
        ["aa \u001B[31m\u20E3bb\u001B[39m cc", 9, true, false, true, "aa \u001B[31m\u20E3bb\u001B[39m cc"],
        ["aa \u001B[31m\u20E3bb\u001B[39m cc", 9, true, true, false, "aa \u001B[31m\u20E3bb\u001B[39m cc"],
        ["aa \u001B[31m\u20E3bb\u001B[39m cc", 9, true, true, true, "aa \u001B[31m\u20E3bb\u001B[39m cc"],
      ];

    test.each(cases)(
      "wrapAnsi(%j, %i, { hard: %p, wordWrap: %p, trim: %p })",
      (input, columns, hard, wordWrap, trim, expected) => {
        expect(Bun.wrapAnsi(input, columns, { hard, wordWrap, trim })).toBe(expected);
      },
    );
  });

  describe("existing newlines", () => {
    test("preserves existing newlines", () => {
      const input = "hello\nworld";
      const result = Bun.wrapAnsi(input, 10);
      expect(result).toBe("hello\nworld");
    });

    test("wraps within lines separated by newlines", () => {
      const input = "hello world\nfoo bar";
      const result = Bun.wrapAnsi(input, 5);
      expect(result.split("\n").length).toBeGreaterThan(2);
    });
  });

  describe("edge cases", () => {
    test("handles tabs", () => {
      const input = "a\tb";
      const result = Bun.wrapAnsi(input, 10);
      expect(typeof result).toBe("string");
    });

    test("handles Windows line endings", () => {
      const input = "hello\r\nworld";
      const result = Bun.wrapAnsi(input, 10);
      expect(typeof result).toBe("string");
    });

    test("handles consecutive spaces", () => {
      const input = "hello    world";
      const result = Bun.wrapAnsi(input, 10);
      expect(typeof result).toBe("string");
    });
  });

  describe("ambiguousIsNarrow option", () => {
    test("default treats ambiguous as narrow", () => {
      // By default, ambiguous width chars should be treated as width 1
      const result1 = Bun.wrapAnsi("αβγ", 3);
      // Greek letters are ambiguous width
      expect(typeof result1).toBe("string");
    });

    test("ambiguousIsNarrow false treats as wide", () => {
      const result = Bun.wrapAnsi("αβγ", 3, { ambiguousIsNarrow: false });
      expect(typeof result).toBe("string");
    });
  });

  describe("edge cases for columns", () => {
    test("negative columns returns input unchanged", () => {
      expect(Bun.wrapAnsi("hello world", -5)).toBe("hello world");
      expect(Bun.wrapAnsi("hello world", -Infinity)).toBe("hello world");
    });

    test("Infinity columns returns input unchanged", () => {
      expect(Bun.wrapAnsi("hello world", Infinity)).toBe("hello world");
    });

    test("NaN columns returns input unchanged", () => {
      expect(Bun.wrapAnsi("hello world", NaN)).toBe("hello world");
    });
  });

  describe("width tracking", () => {
    test("width tracking after line wrap with full-width chars", () => {
      // Each full-width character has width 2
      const input = "あいうえお"; // 5 chars, total width 10
      const result = Bun.wrapAnsi(input, 4, { hard: true });
      // Width 4 allows 2 full-width chars per line: "あい"(4), "うえ"(4), "お"(2)
      expect(result).toBe("あい\nうえ\nお");
    });

    test("width tracking with mixed width chars", () => {
      // ASCII(width 1) and full-width(width 2) mixed
      const input = "aあbい"; // widths: 1+2+1+2 = 6
      const result = Bun.wrapAnsi(input, 3, { hard: true });
      // "aあ"(3) on line 1, "bい"(3) on line 2
      expect(result).toBe("aあ\nbい");
    });
  });

  describe("extended SGR codes", () => {
    test("256-color preserved across line wrap", () => {
      const input = "\x1b[38;5;196mRed text here\x1b[0m";
      const result = Bun.wrapAnsi(input, 5);
      // 256-color sequences should not be closed/reopened at line breaks
      expect(result).toBe("\x1b[38;5;196mRed\ntext\nhere\x1b[0m");
    });

    test("TrueColor preserved across line wrap", () => {
      const input = "\x1b[38;2;255;128;0mOrange text\x1b[0m";
      const result = Bun.wrapAnsi(input, 6);
      // TrueColor sequences should not be closed/reopened at line breaks
      expect(result).toBe("\x1b[38;2;255;128;0mOrange\ntext\x1b[0m");
    });

    test("multiple styles (bold + color) preserved", () => {
      const input = "\x1b[1m\x1b[31mBold Red text here\x1b[0m";
      const result = Bun.wrapAnsi(input, 5);
      // Bold stays, color closes with 39 and reopens with 31
      expect(result).toBe(
        "\x1b[1m\x1b[31mBold\x1b[39m\n\x1b[31mRed\x1b[39m\n\x1b[31mtext\x1b[39m\n\x1b[31mhere\x1b[0m",
      );
    });
  });

  describe("long inputs", () => {
    test("wraps a long run of color escape sequences on one line", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          [
            `const count = 100000;`,
            `const input = Buffer.alloc(count * 6, "\\x1b[31m ").toString();`,
            `const expected = Buffer.alloc(count * 5, "\\x1b[31m").toString();`,
            `const result = Bun.wrapAnsi(input, 80);`,
            `console.log(result === expected ? "match" : "mismatch:" + result.length);`,
          ].join("\n"),
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toBe("match\n");
      expect(exitCode).toBe(0);
    });

    // A single word made of many escape sequences (no separator spaces) must
    // stay linear: the word-separator scan advances past each escape once
    // instead of re-searching to the end of the line per escape.
    test("keeps a long space-free run of colored characters on one row", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          [
            `const input = Buffer.alloc(100000 * 6, "\\x1b[31mX").toString();`,
            `const result = Bun.wrapAnsi(input, 80);`,
            `console.log(result === input ? "match" : "mismatch:" + result.length);`,
          ].join("\n"),
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toBe("match\n");
      expect(exitCode).toBe(0);
    });

    test("keeps a long line of words on one row when columns is very large", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          [
            `const count = 400000;`,
            `const input = Buffer.alloc(count * 5, "word ").toString();`,
            `const expected = input.slice(0, -1);`,
            `const result = Bun.wrapAnsi(input, 2 ** 30);`,
            `console.log(result === expected ? "match" : "mismatch:" + result.length);`,
          ].join("\n"),
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toBe("match\n");
      expect(exitCode).toBe(0);
    });
  });
});
