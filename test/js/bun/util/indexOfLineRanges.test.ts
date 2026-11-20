import { stringsInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";

// `bun.strings.indexOfLineRanges` finds the lines of the code frame of a printed error, and the
// line of a CSS error: the byte ranges of a target line and of the lines before it, 1 or 6 in all.
// These tests compare it with a model that looks at every byte, so that a change of how it finds
// the ranges changes none of them without a failure here. The model is what the function does
// today. It is not a rule of what a line is: a `\r` alone, for one, gives ranges that no reader
// would ask for. A change that means to give other ranges changes the model with it.

const { indexOfLineRanges } = stringsInternals;

// `"".repeat()` is slow in a debug build.
const repeat = (text: string, count: number) => Buffer.alloc(Buffer.byteLength(text) * count, text).toString();

const LF = 10;
const CR = 13;

/** The range of every line of `text`, as `indexOfLineRanges` cuts lines today. */
function allRanges(text: Uint8Array): [start: number, end: number][] {
  const first = text.indexOf(LF);
  if (first < 0) return [[0, text.length]];
  // Only a `\n` ends the first line: the `\r` of a `\r\n` is in its range, and in the range of no later line.
  const ranges: [number, number][] = [[0, first]];
  let prevEnd = first;
  let at = first + 1;
  for (;;) {
    let lineBreak = at;
    while (lineBreak < text.length && text[lineBreak] !== LF && text[lineBreak] !== CR) lineBreak++;
    if (lineBreak >= text.length) {
      // The text after the last line break is the last line.
      ranges.push([prevEnd, text.length]);
      return ranges;
    }
    if (text[lineBreak] === LF) {
      ranges.push([prevEnd, lineBreak + 1]);
      prevEnd = lineBreak;
      at = lineBreak + 1;
    } else if (text[lineBreak + 1] === LF) {
      ranges.push([prevEnd, lineBreak]);
      prevEnd = lineBreak + 1;
      at = lineBreak + 2;
    } else {
      // A `\r` alone takes the byte after it, and the next range starts where this one did.
      at = Math.min(lineBreak + 2, text.length);
      ranges.push([prevEnd, at]);
    }
  }
}

/** What `indexOfLineRanges(text, targetLine, count)` returns, from `all = allRanges(text)`. */
function expected(text: Uint8Array, all: [number, number][], targetLine: number, count: number): number[] {
  if (text.length === 0) return [];
  // A text of one line is also every later line only if it has a tab, a control byte or a non-ASCII byte.
  if (all.length === 1 && targetLine > 0 && !text.some(byte => byte < 0x20 || byte > 0x7f)) return [];
  return all
    .slice(0, targetLine + 1)
    .slice(-count)
    .flat();
}

/** Line numbers that are worth a look for a text of `lines` lines. */
function targetLines(lines: number, random: () => number): number[] {
  const targets = new Set<number>([0, 1, 2, 5, 6, 7, lines - 2, lines - 1, lines, lines + 7, lines * 3]);
  targets.add(0xffff_ffff);
  for (let i = 0; i < 10; i++) targets.add(Math.floor(random() * (lines + 2)));
  return [...targets].filter(target => target >= 0);
}

function mismatches(text: Uint8Array, random: () => number): string[] {
  const all = allRanges(text);
  const found: string[] = [];
  for (const targetLine of targetLines(all.length, random)) {
    for (const count of [1, 6] as const) {
      const actual = indexOfLineRanges(text, targetLine, count);
      const wanted = expected(text, all, targetLine, count);
      if (actual.length !== wanted.length || actual.some((offset, i) => offset !== wanted[i])) {
        found.push(`line ${targetLine}, ${count} ranges: [${actual}] and not [${wanted}]`);
      }
    }
  }
  return found;
}

/** A generator with a seed, so that a failure names a text that can be made again. */
function randomFrom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const bytes = (text: string) => new TextEncoder().encode(text);
const short = "  const value = compute(input, 42);";

describe("indexOfLineRanges", () => {
  test.each([
    ["no text", ""],
    ["one line", "one line"],
    ["one line with a tab", "one\tline"],
    ["one line with a non-ASCII character", "one liné"],
    ["one line that ends in a line feed", "one line\n"],
    ["one line that ends in a carriage return", "one line\r"],
    ["only line feeds", "\n\n\n\n\n\n\n\n\n"],
    ["only carriage returns", "\r\r\r\r\r\r\r\r\r"],
    ["a carriage return before the first line feed", "a\rb\nc\nd\n"],
    ["a tab and a carriage return before the first line feed", "\ta\rb\nc\nd\n"],
    ["two carriage returns before the first line feed", "a\r\r\nb\nc\n"],
    ["bytes that are not UTF-8 in the first line", "\xc3\n\xe2\x80\n\xff\nb\n"],
    ["a carriage return alone takes the byte after it", "a\nb\rc\rd\r\re\n\rf\r\ng\n"],
    ["a carriage return alone before a character of three bytes", "a\nb\r\u20acc\nd\n"],
    ["two carriage returns before a line feed", "a\nb\r\r\nc\n\r\r\nd\n"],
    ["a carriage return and a line feed are the first bytes", "\r\na\r\nb\r\n"],
    ["a carriage return is the last byte", "a\nb\nc\r"],
    ["U+2028 and U+2029 end no line", "a\nb\u2028c\u2029d\ne\n"],
    ["a tab, a control byte and a DEL start lines", "a\n\tb\n\x01c\n\x7fd\n\u00e9e\n"],
    ["bytes that are not UTF-8", "a\n\xff\xfe\n\xc3\n\xe2\x80\nb\n"],
    ["no line break after the last line", "a\nb\nc"],
  ])("%s", (_, text) => {
    // Latin-1, so that `\xff` is the byte 0xFF.
    const latin1 = Uint8Array.from(text, char => char.charCodeAt(0) & 0xff);
    expect(mismatches(latin1, randomFrom(1))).toEqual([]);
    expect(mismatches(bytes(text), randomFrom(1))).toEqual([]);
  });

  // Longer texts, with targets far from the first line and past the last one.
  test.each([
    ["short lines", repeat(short + "\n", 400)],
    ["short lines and no line break after the last line", repeat(short + "\n", 400) + short],
    ["empty lines", repeat("\n", 400)],
    ["lines that end in `\\r\\n`", repeat(short + "\r\n", 400)],
    ["the first line ends in `\\r\\n`", short + "\r\n" + repeat(short + "\n", 400)],
    ["lines that end in `\\r\\n` after 100 lines", repeat(short + "\n", 100) + repeat(short + "\r\n", 300)],
    ["a carriage return alone in line 200", repeat(short + "\n", 199) + "a\rb\n" + repeat(short + "\n", 200)],
    ["a carriage return alone in the last lines", repeat(short + "\n", 390) + "a\rb\n" + repeat(short + "\n", 3)],
    ["a carriage return alone every 50 lines", repeat(repeat(short + "\n", 49) + "a\rb\n", 8)],
    ["tabs", repeat("\tconst value =\tcompute(input);\n", 400)],
    ["non-ASCII characters", repeat("// " + repeat("é", 20) + "\n", 400)],
    ["lines of 127 bytes", repeat(repeat("x", 126) + "\n", 200)],
    ["lines of 128 bytes", repeat(repeat("x", 127) + "\n", 200)],
    ["lines of 1,000 bytes", repeat(repeat("x", 999) + "\n", 100)],
    [
      "a line of 40,000 bytes in line 200",
      repeat(short + "\n", 199) + repeat("x", 40_000) + "\n" + repeat(short + "\n", 200),
    ],
    ["a line of 40,000 bytes every 20 lines", repeat(repeat(short + "\n", 19) + repeat("x", 40_000) + "\n", 10)],
    ["long lines after 20 short ones", repeat(short + "\n", 20) + repeat(repeat("x", 2_000) + "\n", 100)],
    ["short lines after 20 long ones", repeat(repeat("x", 2_000) + "\n", 20) + repeat(short + "\n", 400)],
    ["lines that get shorter", repeat("x", 100) + "\n" + repeat(short + "\n", 60) + repeat("x\n", 2_000)],
    ["a last line of 100,000 bytes", repeat(short + "\n", 400) + repeat("x", 100_000)],
    ["30,000 lines", repeat(short + "\n", 30_000)],
    ["lines of one byte", repeat("a\n", 300)],
    ["long lines that end in `\\r\\n`", repeat(repeat("x", 1_500) + "\r\n", 120)],
    ["long lines with tabs", repeat(repeat("\tdata", 300) + "\n", 120)],
    ["a carriage return alone in every line", repeat("a\rb\n", 300)],
    ["lines that end in a carriage return alone", "one\n" + repeat("abc\r", 300)],
    ["a first line of 100,000 bytes with a tab", "\t" + repeat("x", 100_000) + "\n" + repeat(short + "\n", 20)],
    ["one line of 100,000 bytes with a non-ASCII character", "\u00e9" + repeat("x", 100_000)],
  ])("%s", (_, text) => {
    expect(mismatches(bytes(text), randomFrom(2))).toEqual([]);
  });

  test("the text ends soon after a carriage return alone", () => {
    const found: string[] = [];
    for (let after = 0; after <= 20; after++) {
      for (const last of ["", "last line"]) {
        const text = repeat(short + "\n", 60) + "a\rb\n" + repeat(short + "\n", after) + last;
        found.push(...mismatches(bytes(text), randomFrom(after)).map(mismatch => `${after} lines after: ${mismatch}`));
      }
    }
    expect(found).toEqual([]);
  });

  test("texts of lines of many lengths, with a few that are long or end in another way", () => {
    const random = randomFrom(3);
    const pick = <T>(values: T[]) => values[Math.floor(random() * values.length)];
    const found: string[] = [];
    for (let seed = 0; seed < 120 && found.length === 0; seed++) {
      // Out of 1,024 lines: how many end in `\r\n`, have a `\r` alone, are long, and how many
      // bytes out of 1,024 are a tab, a control byte or not ASCII.
      const crlf = pick([0, 0, 0, 1, 8, 1_024]);
      const lone = pick([0, 0, 0, 1, 8, 200]);
      const long = pick([0, 0, 1, 8, 200, 1_024]);
      const lines = pick(long > 8 ? [3, 9, 40, 47, 70, 120] : [3, 9, 40, 47, 70, 120, 300, 900, 2_500]);
      const odd = pick([0, 8, 300]);
      const lengthMax = pick([0, 3, 12, 40, 90]);
      const text: number[] = [];
      for (let line = 0; line < lines; line++) {
        const length =
          random() * 1_024 < long ? 130 + Math.floor(random() * 3_000) : Math.floor(random() * (lengthMax + 1));
        for (let i = 0; i < length; i++) {
          text.push(random() * 1_024 < odd ? pick([9, 0, 0xc3, 0xa9, 0xe9, 0xe2, 0x80, 0xa8]) : 97 + (i % 26));
        }
        if (random() * 1_024 < lone) {
          text.push(CR);
          if (random() < 0.5) text.push(120);
        }
        if (line + 1 === lines && random() < 0.5) break;
        if (random() * 1_024 < crlf) text.push(CR);
        text.push(LF);
      }
      found.push(...mismatches(Uint8Array.from(text), random).map(mismatch => `text ${seed}: ${mismatch}`));
    }
    expect(found).toEqual([]);
  });
});
