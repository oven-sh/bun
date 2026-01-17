/**
 * Tests ported from wrap-ansi npm package
 * https://github.com/chalk/wrap-ansi
 *
 * MIT License
 *
 * Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software
 * and associated documentation files (the "Software"), to deal in the Software without restriction,
 * including without limitation the rights to use, copy, modify, merge, publish, distribute,
 * sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or
 * substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
 * BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 * DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

import { expect, test } from "bun:test";

// ANSI color helpers (equivalent to chalk with level 1)
const red = (s: string) => `\u001B[31m${s}\u001B[39m`;
const green = (s: string) => `\u001B[32m${s}\u001B[39m`;
const blue = (s: string) => `\u001B[34m${s}\u001B[39m`;
const bgGreen = (s: string) => `\u001B[42m${s}\u001B[49m`;
const bgRed = (s: string) => `\u001B[41m${s}\u001B[49m`;
const black = (s: string) => `\u001B[30m${s}\u001B[39m`;

// Helper functions
const stripAnsi = (s: string) => s.replace(/\u001B\[[0-9;]*m|\u001B\]8;;[^\u0007]*\u0007/g, "");
const hasAnsi = (s: string) => /\u001B\[[0-9;]*m/.test(s);

// Fixtures
const fixture =
  "The quick brown " + red("fox jumped over ") + "the lazy " + green("dog and then ran away with the unicorn.");
const fixture2 = "12345678\n901234567890";
const fixture3 = "12345678\n901234567890 12345";
const fixture4 = "12345678\n";
const fixture5 = "12345678\n ";

// When "hard" is false

test("wraps string at 20 characters", () => {
  const result = Bun.wrapAnsi(fixture, 20);

  expect(result).toBe(
    "The quick brown \u001B[31mfox\u001B[39m\n\u001B[31mjumped over \u001B[39mthe lazy\n\u001B[32mdog and then ran\u001B[39m\n\u001B[32maway with the\u001B[39m\n\u001B[32municorn.\u001B[39m",
  );
  expect(
    stripAnsi(result)
      .split("\n")
      .every(line => line.length <= 20),
  ).toBe(true);
});

test("wraps string at 30 characters", () => {
  const result = Bun.wrapAnsi(fixture, 30);

  expect(result).toBe(
    "The quick brown \u001B[31mfox jumped\u001B[39m\n\u001B[31mover \u001B[39mthe lazy \u001B[32mdog and then ran\u001B[39m\n\u001B[32maway with the unicorn.\u001B[39m",
  );
  expect(
    stripAnsi(result)
      .split("\n")
      .every(line => line.length <= 30),
  ).toBe(true);
});

test('does not break strings longer than "cols" characters', () => {
  const result = Bun.wrapAnsi(fixture, 5, { hard: false });

  expect(result).toBe(
    "The\nquick\nbrown\n\u001B[31mfox\u001B[39m\n\u001B[31mjumped\u001B[39m\n\u001B[31mover\u001B[39m\n\u001B[31m\u001B[39mthe\nlazy\n\u001B[32mdog\u001B[39m\n\u001B[32mand\u001B[39m\n\u001B[32mthen\u001B[39m\n\u001B[32mran\u001B[39m\n\u001B[32maway\u001B[39m\n\u001B[32mwith\u001B[39m\n\u001B[32mthe\u001B[39m\n\u001B[32municorn.\u001B[39m",
  );
  expect(
    stripAnsi(result)
      .split("\n")
      .some(line => line.length > 5),
  ).toBe(true);
});

test("handles colored string that wraps on to multiple lines", () => {
  const result = Bun.wrapAnsi(green("hello world") + " hey!", 5, { hard: false });
  const lines = result.split("\n");
  expect(hasAnsi(lines[0])).toBe(true);
  expect(hasAnsi(lines[1])).toBe(true);
  expect(hasAnsi(lines[2])).toBe(false);
});

test('does not prepend newline if first string is greater than "cols"', () => {
  const result = Bun.wrapAnsi(green("hello") + "-world", 5, { hard: false });
  expect(result.split("\n").length).toBe(1);
});

// When "hard" is true

test('breaks strings longer than "cols" characters', () => {
  const result = Bun.wrapAnsi(fixture, 5, { hard: true });

  expect(result).toBe(
    "The\nquick\nbrown\n\u001B[31mfox j\u001B[39m\n\u001B[31mumped\u001B[39m\n\u001B[31mover\u001B[39m\n\u001B[31m\u001B[39mthe\nlazy\n\u001B[32mdog\u001B[39m\n\u001B[32mand\u001B[39m\n\u001B[32mthen\u001B[39m\n\u001B[32mran\u001B[39m\n\u001B[32maway\u001B[39m\n\u001B[32mwith\u001B[39m\n\u001B[32mthe\u001B[39m\n\u001B[32munico\u001B[39m\n\u001B[32mrn.\u001B[39m",
  );
  expect(
    stripAnsi(result)
      .split("\n")
      .every(line => line.length <= 5),
  ).toBe(true);
});

test("removes last row if it contained only ansi escape codes", () => {
  const result = Bun.wrapAnsi(green("helloworld"), 2, { hard: true });
  expect(
    stripAnsi(result)
      .split("\n")
      .every(x => x.length === 2),
  ).toBe(true);
});

test("does not prepend newline if first word is split", () => {
  const result = Bun.wrapAnsi(green("hello") + "world", 5, { hard: true });
  expect(result.split("\n").length).toBe(2);
});

test("takes into account line returns inside input", () => {
  expect(Bun.wrapAnsi(fixture2, 10, { hard: true })).toBe("12345678\n9012345678\n90");
});

test("word wrapping", () => {
  expect(Bun.wrapAnsi(fixture3, 15)).toBe("12345678\n901234567890\n12345");
});

test("no word-wrapping", () => {
  const result = Bun.wrapAnsi(fixture3, 15, { wordWrap: false });
  expect(result).toBe("12345678\n901234567890 12\n345");

  const result2 = Bun.wrapAnsi(fixture3, 5, { wordWrap: false });
  expect(result2).toBe("12345\n678\n90123\n45678\n90 12\n345");

  const result3 = Bun.wrapAnsi(fixture5, 5, { wordWrap: false });
  expect(result3).toBe("12345\n678\n");

  const result4 = Bun.wrapAnsi(fixture, 5, { wordWrap: false });
  expect(result4).toBe(
    "The q\nuick\nbrown\n\u001B[31mfox j\u001B[39m\n\u001B[31mumped\u001B[39m\n\u001B[31mover\u001B[39m\n\u001B[31m\u001B[39mthe l\nazy \u001B[32md\u001B[39m\n\u001B[32mog an\u001B[39m\n\u001B[32md the\u001B[39m\n\u001B[32mn ran\u001B[39m\n\u001B[32maway\u001B[39m\n\u001B[32mwith\u001B[39m\n\u001B[32mthe u\u001B[39m\n\u001B[32mnicor\u001B[39m\n\u001B[32mn.\u001B[39m",
  );
});

test("no word-wrapping and no trimming", () => {
  const result = Bun.wrapAnsi(fixture3, 13, { wordWrap: false, trim: false });
  expect(result).toBe("12345678\n901234567890 \n12345");

  const result2 = Bun.wrapAnsi(fixture4, 5, { wordWrap: false, trim: false });
  expect(result2).toBe("12345\n678\n");

  const result3 = Bun.wrapAnsi(fixture5, 5, { wordWrap: false, trim: false });
  expect(result3).toBe("12345\n678\n ");

  // NOTE: The NPM test expects malformed ANSI codes (e.g., "[31mjumpe[39m" without ESC character)
  // when ANSI escape sequences get character-wrapped across lines. Our implementation
  // correctly preserves complete ANSI escape sequences. The visual output is equivalent.
  const result4 = Bun.wrapAnsi(fixture, 5, { wordWrap: false, trim: false });
  expect(result4).toBe(
    "The q\nuick \nbrown\n \u001B[31mfox \u001B[39m\n\u001B[31mjumpe\u001B[39m\n\u001B[31md ove\u001B[39m\n\u001B[31mr \u001B[39mthe\n lazy\n \u001B[32mdog \u001B[39m\n\u001B[32mand t\u001B[39m\n\u001B[32mhen r\u001B[39m\n\u001B[32man aw\u001B[39m\n\u001B[32may wi\u001B[39m\n\u001B[32mth th\u001B[39m\n\u001B[32me uni\u001B[39m\n\u001B[32mcorn.\u001B[39m",
  );
});

test("supports fullwidth characters", () => {
  expect(Bun.wrapAnsi("안녕하세", 4, { hard: true })).toBe("안녕\n하세");
});

test("supports unicode surrogate pairs", () => {
  expect(Bun.wrapAnsi("a\uD83C\uDE00bc", 2, { hard: true })).toBe("a\n\uD83C\uDE00\nbc");
  expect(Bun.wrapAnsi("a\uD83C\uDE00bc\uD83C\uDE00d\uD83C\uDE00", 2, { hard: true })).toBe(
    "a\n\uD83C\uDE00\nbc\n\uD83C\uDE00\nd\n\uD83C\uDE00",
  );
});

test("#23, properly wraps whitespace with no trimming", () => {
  expect(Bun.wrapAnsi("   ", 2, { trim: false })).toBe("  \n ");
  expect(Bun.wrapAnsi("   ", 2, { trim: false, hard: true })).toBe("  \n ");
});

test("#24, trims leading and trailing whitespace only on actual wrapped lines and only with trimming", () => {
  expect(Bun.wrapAnsi("   foo   bar   ", 3)).toBe("foo\nbar");
  expect(Bun.wrapAnsi("   foo   bar   ", 6)).toBe("foo\nbar");
  expect(Bun.wrapAnsi("   foo   bar   ", 42)).toBe("foo   bar");
  expect(Bun.wrapAnsi("   foo   bar   ", 42, { trim: false })).toBe("   foo   bar   ");
});

test("#24, trims leading and trailing whitespace inside a color block only on actual wrapped lines and only with trimming", () => {
  // NOTE: Bun's implementation closes and reopens ANSI codes around newlines for robustness.
  // The visual output is equivalent: both lines appear in blue.
  // NPM: "\u001B[34mfoo\nbar\u001B[39m"
  // Bun: "\u001B[34mfoo\u001B[39m\n\u001B[34mbar\u001B[39m"
  const result = Bun.wrapAnsi(blue("   foo   bar   "), 6);
  expect(result).toBe("\u001B[34mfoo\u001B[39m\n\u001B[34mbar\u001B[39m");
  expect(Bun.wrapAnsi(blue("   foo   bar   "), 42)).toBe(blue("foo   bar"));
  expect(Bun.wrapAnsi(blue("   foo   bar   "), 42, { trim: false })).toBe(blue("   foo   bar   "));
});

test("#25, properly wraps whitespace between words with no trimming", () => {
  expect(Bun.wrapAnsi("foo bar", 3)).toBe("foo\nbar");
  expect(Bun.wrapAnsi("foo bar", 3, { hard: true })).toBe("foo\nbar");
  expect(Bun.wrapAnsi("foo bar", 3, { trim: false })).toBe("foo\n \nbar");
  expect(Bun.wrapAnsi("foo bar", 3, { trim: false, hard: true })).toBe("foo\n \nbar");
});

test("#26, does not multiplicate leading spaces with no trimming", () => {
  expect(Bun.wrapAnsi(" a ", 10, { trim: false })).toBe(" a ");
  expect(Bun.wrapAnsi("   a ", 10, { trim: false })).toBe("   a ");
});

test("#27, does not remove spaces in line with ansi escapes when no trimming", () => {
  expect(Bun.wrapAnsi(bgGreen(` ${black("OK")} `), 100, { trim: false })).toBe(bgGreen(` ${black("OK")} `));
  expect(Bun.wrapAnsi(bgGreen(`  ${black("OK")} `), 100, { trim: false })).toBe(bgGreen(`  ${black("OK")} `));
  expect(Bun.wrapAnsi(bgGreen(" hello "), 10, { hard: true, trim: false })).toBe(bgGreen(" hello "));
});

test("#35, wraps hyperlinks, preserving clickability in supporting terminals", () => {
  const result1 = Bun.wrapAnsi(
    "Check out \u001B]8;;https://www.example.com\u0007my website\u001B]8;;\u0007, it is \u001B]8;;https://www.example.com\u0007supercalifragilisticexpialidocious\u001B]8;;\u0007.",
    16,
    { hard: true },
  );
  expect(result1).toBe(
    "Check out \u001B]8;;https://www.example.com\u0007my\u001B]8;;\u0007\n\u001B]8;;https://www.example.com\u0007website\u001B]8;;\u0007, it is\n\u001B]8;;https://www.example.com\u0007supercalifragili\u001B]8;;\u0007\n\u001B]8;;https://www.example.com\u0007sticexpialidocio\u001B]8;;\u0007\n\u001B]8;;https://www.example.com\u0007us\u001B]8;;\u0007.",
  );

  const result2 = Bun.wrapAnsi(
    `Check out \u001B]8;;https://www.example.com\u0007my \uD83C\uDE00 ${bgGreen("website")}\u001B]8;;\u0007, it ${bgRed("is \u001B]8;;https://www.example.com\u0007super\uD83C\uDE00califragilisticexpialidocious\u001B]8;;\u0007")}.`,
    16,
    { hard: true },
  );
  expect(result2).toBe(
    "Check out \u001B]8;;https://www.example.com\u0007my 🈀\u001B]8;;\u0007\n\u001B]8;;https://www.example.com\u0007\u001B[42mwebsite\u001B[49m\u001B]8;;\u0007, it \u001B[41mis\u001B[49m\n\u001B[41m\u001B]8;;https://www.example.com\u0007super🈀califragi\u001B]8;;\u0007\u001B[49m\n\u001B[41m\u001B]8;;https://www.example.com\u0007listicexpialidoc\u001B]8;;\u0007\u001B[49m\n\u001B[41m\u001B]8;;https://www.example.com\u0007ious\u001B]8;;\u0007\u001B[49m.",
  );
});

test("covers non-SGR/non-hyperlink ansi escapes", () => {
  expect(Bun.wrapAnsi("Hello, \u001B[1D World!", 8)).toBe("Hello,\u001B[1D\nWorld!");
  expect(Bun.wrapAnsi("Hello, \u001B[1D World!", 8, { trim: false })).toBe("Hello, \u001B[1D \nWorld!");
});

test("#39, normalizes newlines", () => {
  expect(Bun.wrapAnsi("foobar\r\nfoobar\r\nfoobar\nfoobar", 3, { hard: true })).toBe(
    "foo\nbar\nfoo\nbar\nfoo\nbar\nfoo\nbar",
  );
  expect(Bun.wrapAnsi("foo bar\r\nfoo bar\r\nfoo bar\nfoo bar", 3)).toBe("foo\nbar\nfoo\nbar\nfoo\nbar\nfoo\nbar");
});
