import { stringsInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// `bun.strings.indexOfLineRanges` finds the lines of the code frame of a printed error, and the
// line of a CSS error: the byte ranges of a target line and of the lines before it, 1 or 6 in all.
// A change of how it finds them must not change one range, so these tests compare it with a model
// that looks at every byte. What a range is has odd corners (the first line, a `\r` alone), and
// the printer shows them, so the model keeps them too.

const { indexOfLineRanges } = stringsInternals;

const LF = 10;
const CR = 13;

/** The range of every line of `text`, as `indexOfLineRanges` defines a line. */
function allRanges(text: Uint8Array): [start: number, end: number][] {
  const first = text.indexOf(LF);
  if (first < 0) return [[0, text.length]];
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
  // From line 33 for one range and from line 38 for six, the lines before the result are counted and not cut.
  const targets = new Set<number>([
    0,
    1,
    2,
    5,
    6,
    7,
    32,
    33,
    34,
    37,
    38,
    39,
    lines - 2,
    lines - 1,
    lines,
    lines + 7,
    lines * 3,
  ]);
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
    ["short lines", (short + "\n").repeat(400)],
    ["short lines and no line break after the last line", (short + "\n").repeat(400) + short],
    ["empty lines", "\n".repeat(400)],
    ["lines that end in `\\r\\n`", (short + "\r\n").repeat(400)],
    ["the first line ends in `\\r\\n`", short + "\r\n" + (short + "\n").repeat(400)],
    ["lines that end in `\\r\\n` after 100 lines", (short + "\n").repeat(100) + (short + "\r\n").repeat(300)],
    ["a carriage return alone in line 200", (short + "\n").repeat(199) + "a\rb\n" + (short + "\n").repeat(200)],
    ["a carriage return alone in the last lines", (short + "\n").repeat(390) + "a\rb\n" + (short + "\n").repeat(3)],
    ["a carriage return alone every 50 lines", ((short + "\n").repeat(49) + "a\rb\n").repeat(8)],
    ["tabs", "\tconst value =\tcompute(input);\n".repeat(400)],
    ["non-ASCII characters", ("// " + "é".repeat(20) + "\n").repeat(400)],
    ["lines of 127 bytes", ("x".repeat(126) + "\n").repeat(200)],
    ["lines of 128 bytes", ("x".repeat(127) + "\n").repeat(200)],
    ["lines of 1,000 bytes", ("x".repeat(999) + "\n").repeat(100)],
    [
      "a line of 40,000 bytes in line 200",
      (short + "\n").repeat(199) + "x".repeat(40_000) + "\n" + (short + "\n").repeat(200),
    ],
    ["a line of 40,000 bytes every 20 lines", ((short + "\n").repeat(19) + "x".repeat(40_000) + "\n").repeat(10)],
    ["long lines after 20 short ones", (short + "\n").repeat(20) + ("x".repeat(2_000) + "\n").repeat(100)],
    ["short lines after 20 long ones", ("x".repeat(2_000) + "\n").repeat(20) + (short + "\n").repeat(400)],
    ["lines that get shorter", "x".repeat(100) + "\n" + (short + "\n").repeat(60) + "x\n".repeat(2_000)],
    ["a last line of 100,000 bytes", (short + "\n").repeat(400) + "x".repeat(100_000)],
    ["30,000 lines", (short + "\n").repeat(30_000)],
    ["60 line feeds", "\n".repeat(60)],
    ["a carriage return alone in 60 line feeds", "\n".repeat(40) + "\r" + "\n".repeat(19)],
    ["lines of one byte", "a\n".repeat(300)],
    ["long lines at the end", (short + "\n").repeat(400) + ("x".repeat(3_000) + "\n").repeat(8)],
    ["long lines that end in `\\r\\n`", ("x".repeat(1_500) + "\r\n").repeat(120)],
    ["long lines with tabs", ("\tdata".repeat(300) + "\n").repeat(120)],
    ["a carriage return alone every 5 lines", ((short + "\n").repeat(4) + "a\rb\n").repeat(80)],
    ["a carriage return alone in every line", "a\rb\n".repeat(300)],
    ["lines that end in a carriage return alone", "one\n" + "abc\r".repeat(300)],
  ])("%s", (_, text) => {
    expect(mismatches(bytes(text), randomFrom(2))).toEqual([]);
  });

  test("the text ends soon after a carriage return alone", () => {
    const found: string[] = [];
    for (let after = 0; after <= 20; after++) {
      for (const last of ["", "last line"]) {
        const text = (short + "\n").repeat(60) + "a\rb\n" + (short + "\n").repeat(after) + last;
        found.push(...mismatches(bytes(text), randomFrom(after)).map(mismatch => `${after} lines after: ${mismatch}`));
      }
    }
    expect(found).toEqual([]);
  });

  test("the text ends soon after two carriage returns alone", () => {
    const found: string[] = [];
    for (let between = 0; between <= 8; between++) {
      for (let after = 0; after <= 8; after++) {
        const lines = (count: number) => (short + "\n").repeat(count);
        const text = lines(60) + "a\rb\n" + lines(between) + "c\rd\r\n" + lines(after) + (after % 2 ? "last line" : "");
        const at = `${between} lines between, ${after} lines after`;
        found.push(...mismatches(bytes(text), randomFrom(between * 9 + after)).map(mismatch => `${at}: ${mismatch}`));
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

// The ranges reach a reader through the error printer, with 6 ranges, and through a CSS error, with 1.
describe.concurrent("the code frame of an error that is far from the first line", () => {
  const errorLine = 'throw new Error("far");';
  // A module that throws on line `line`. Line `n` before that is `padding(n)`.
  const moduleOf = (line: number, padding: (n: number) => string, lineBreak: string, after = 40) => {
    const lines: string[] = [];
    for (let n = 1; n < line; n++) lines.push(padding(n));
    lines.push(errorLine);
    for (let n = 0; n < after; n++) lines.push("// after");
    return lines.join(lineBreak) + lineBreak;
  };
  // The frame that the module prints: the five lines before the error line, the error line, the
  // caret and the message.
  const frameOf = async (source: string) => {
    using dir = tempDir("far-frame", { "far.ts": source });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "far.ts"],
      env: { ...bunEnv, NO_COLOR: "1" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, frame: stderr.split("\n").slice(0, 8), exitCode };
  };
  const frame = (line: number, padding: (n: number) => string) => ({
    stdout: "",
    frame: [
      ...[5, 4, 3, 2, 1].map(before => `${line - before} | ${padding(line - before)}`),
      `${line} | ${errorLine}`,
      " ".repeat(String(line).length + 13) + "^",
      "error: far",
    ],
    exitCode: 1,
  });

  const comment = (n: number) => `// line ${n}`;
  test.each([
    ["a line feed", "\n"],
    ["a carriage return and a line feed", "\r\n"],
  ])("lines that end in %s", async (_, lineBreak) => {
    for (const line of [7, 40, 60, 300, 5_000]) {
      expect(await frameOf(moduleOf(line, comment, lineBreak))).toEqual(frame(line, comment));
    }
  });

  test.each([
    ["tabs", (n: number) => `\t//\tline\t${n}`],
    ["characters that are not ASCII", (n: number) => `// línea ${n} ☃`],
    ["no characters", (n: number) => (n % 2 ? "" : `// line ${n}`)],
    ["200 bytes", (n: number) => `// line ${n} ${"x".repeat(190)}`],
  ])("lines of %s", async (_, padding) => {
    expect(await frameOf(moduleOf(3_000, padding, "\n"))).toEqual(frame(3_000, padding));
  });

  test("a carriage return alone is the end of a line", async () => {
    // The comment is line 100 and line 101.
    const padding = (n: number) => (n === 100 ? "/* a\rb */" : comment(n > 100 ? n + 1 : n));
    expect(await frameOf(moduleOf(2_999, padding, "\n"))).toEqual(frame(3_000, comment));
  });

  test("a long line before short lines", async () => {
    const padding = (n: number) => (n === 100 ? `// line 100 ${"x".repeat(100_000)}` : comment(n));
    expect(await frameOf(moduleOf(3_000, padding, "\n"))).toEqual(frame(3_000, padding));
  });

  // The line number is then past the end of the file.
  test("a file that got shorter since it was loaded gives its last lines", async () => {
    const kept =
      'import { truncateSync } from "node:fs";\n' +
      Array.from({ length: 999 }, (_, i) => comment(i + 2) + "\n").join("");
    const source =
      kept +
      Array.from({ length: 1_999 }, (_, i) => comment(i + 1_001) + "\n").join("") +
      'function fail() { throw new Error("far"); }\n' +
      `try { fail(); } catch (e) { truncateSync(import.meta.path, ${kept.length + "// line".length}); console.error(e); }\n`;
    expect(await frameOf(source)).toEqual({
      stdout: "",
      frame: [
        "2995 | // line 996",
        "2996 | // line 997",
        "2997 | // line 998",
        "2998 | // line 999",
        "2999 | // line 1000",
        "3000 | // line",
        " ".repeat(35) + "^",
        "error: far",
      ],
      exitCode: 0,
    });
  });

  test("no line break after the error line", async () => {
    const source = moduleOf(3_000, comment, "\n", 0);
    expect(await frameOf(source.slice(0, -1))).toEqual(frame(3_000, comment));
  });
});

describe("position.lineText of a CSS error that is far from the first line", () => {
  test.concurrent.each([
    [
      "lines that end in a line feed",
      "a { color: red; }\n".repeat(399) + '@import "x";\n' + "b {}\n".repeat(50),
      '@import "x";',
    ],
    [
      "lines that end in a carriage return and a line feed",
      "a { color: red; }\r\n".repeat(399) + '@import "x";\r\nb {}\r\n',
      '@import "x";',
    ],
    ["tabs", "\ta {\tcolor: red; }\n".repeat(399) + '\t@import "x";\n', '\t@import "x";'],
    ["characters that are not ASCII", '/* é */ a { content: "☃"; }\n'.repeat(399) + '@import "x";\n', '@import "x";'],
    ["no line break after the line", "a { color: red; }\n".repeat(399) + '@import "x";', '@import "x";'],
    [
      "a line of 50,000 bytes before it",
      "a { color: red; }\n".repeat(200) + `/* ${"x".repeat(50_000)} */\n` + "a {}\n".repeat(198) + '@import "x";\n',
      '@import "x";',
    ],
  ])("%s", async (_, source, lineText) => {
    using dir = tempDir("css-line-text", { "in.css": source });
    const result = await Bun.build({ entrypoints: [join(String(dir), "in.css")], throw: false });
    expect(result.logs.map(({ position }) => ({ line: position?.line, lineText: position?.lineText }))).toEqual([
      { line: 400, lineText },
    ]);
  });
});
