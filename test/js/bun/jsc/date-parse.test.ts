import { describe, expect, test } from "bun:test";

// V8's date parser treats every ECMAScript WhiteSpace code point as a token
// separator. Bun's port of that parser scans UTF-8 bytes, so non-ASCII
// whitespace (NBSP from HTML &nbsp;, the en/em spaces copy-paste carries, BOM,
// ideographic space) used to fall through as "word" bytes and produce NaN
// where Node returns the instant.

const hex = (cp: number) => "U+" + cp.toString(16).toUpperCase().padStart(4, "0");

// ECMAScript WhiteSpace (https://tc39.es/ecma262/#sec-white-space): TAB, VT,
// FF, SP, NBSP, BOM, and every Unicode Zs character. These are exactly the
// code points V8's IsWhiteSpace() (src/strings/char-predicates.h) recognizes
// in the date parser's IsWhiteSpaceChar().
const whiteSpace: ReadonlyArray<[string, number]> = (
  [
    [0x0009, "TAB"],
    [0x000b, "VT"],
    [0x000c, "FF"],
    [0x0020, "SPACE"],
    [0x00a0, "NO-BREAK SPACE"],
    [0x1680, "OGHAM SPACE MARK"],
    [0x2000, "EN QUAD"],
    [0x2001, "EM QUAD"],
    [0x2002, "EN SPACE"],
    [0x2003, "EM SPACE"],
    [0x2004, "THREE-PER-EM SPACE"],
    [0x2005, "FOUR-PER-EM SPACE"],
    [0x2006, "SIX-PER-EM SPACE"],
    [0x2007, "FIGURE SPACE"],
    [0x2008, "PUNCTUATION SPACE"],
    [0x2009, "THIN SPACE"],
    [0x200a, "HAIR SPACE"],
    [0x202f, "NARROW NO-BREAK SPACE"],
    [0x205f, "MEDIUM MATHEMATICAL SPACE"],
    [0x3000, "IDEOGRAPHIC SPACE"],
    [0xfeff, "BYTE ORDER MARK"],
  ] as const
).map(([cp, name]) => [`${hex(cp)} ${name}`, cp]);

// Code points V8's date parser does NOT accept as whitespace. Verified against
// Node v26.3.0: each of these makes Date.parse return NaN.
const notWhiteSpace: ReadonlyArray<[string, number]> = (
  [
    [0x0085, "NEXT LINE"],
    [0x00ad, "SOFT HYPHEN"],
    [0x180e, "MONGOLIAN VOWEL SEPARATOR"],
    [0x200b, "ZERO WIDTH SPACE"],
    [0x200c, "ZERO WIDTH NON-JOINER"],
    [0x200d, "ZERO WIDTH JOINER"],
    [0x2028, "LINE SEPARATOR"],
    [0x2029, "PARAGRAPH SEPARATOR"],
    [0x2060, "WORD JOINER"],
  ] as const
).map(([cp, name]) => [`${hex(cp)} ${name}`, cp]);

const base = "Jul 23 2026 10:00:00 GMT+0000";
const baseTime = Date.UTC(2026, 6, 23, 10, 0, 0);

test("sanity: base string parses", () => {
  expect(Date.parse(base)).toBe(baseTime);
});

describe.each(whiteSpace)("Date.parse accepts %s as whitespace", (_label, cp) => {
  const ch = String.fromCodePoint(cp);

  test("trailing", () => {
    expect(Date.parse(base + ch)).toBe(baseTime);
  });
  test("leading", () => {
    expect(Date.parse(ch + base)).toBe(baseTime);
  });
  test("between date and time", () => {
    expect(Date.parse("Jul 23 2026" + ch + "10:00:00 GMT+0000")).toBe(baseTime);
  });
  test("between GMT and offset", () => {
    expect(Date.parse("Jul 23 2026 10:00:00 GMT" + ch + "+0000")).toBe(baseTime);
  });
  test("new Date(str)", () => {
    expect(new Date(ch + base + ch).getTime()).toBe(baseTime);
  });
});

describe.each(notWhiteSpace)("Date.parse rejects %s", (_label, cp) => {
  const ch = String.fromCodePoint(cp);

  test("trailing", () => {
    expect(Date.parse(base + ch)).toBeNaN();
  });
  test("leading", () => {
    expect(Date.parse(ch + base)).toBeNaN();
  });
  test("between date and time", () => {
    expect(Date.parse("Jul 23 2026" + ch + "10:00:00 GMT+0000")).toBeNaN();
  });
});

describe("Date.parse with NBSP (real-world shapes)", () => {
  const NBSP = "\u00a0";

  test("every separator is NBSP", () => {
    expect(Date.parse(`Jul${NBSP}23${NBSP}2026${NBSP}10:00:00${NBSP}GMT+0000`)).toBe(baseTime);
  });

  test("toLocaleString-style with NBSP before AM", () => {
    const s = `7/23/2026, 10:00:00${NBSP}AM`;
    expect(Date.parse(s)).not.toBeNaN();
    expect(Date.parse(s)).toBe(Date.parse(`7/23/2026, 10:00:00 AM`));
  });

  test("ISO date with trailing NBSP", () => {
    expect(Date.parse(`2026-07-23${NBSP}`)).toBe(Date.parse(`2026-07-23 `));
  });

  test("ISO date with trailing ideographic space", () => {
    expect(Date.parse(`2026-07-23\u3000`)).toBe(Date.parse(`2026-07-23 `));
  });

  test("Latin-1 string (NBSP is the only non-ASCII byte)", () => {
    expect(Date.parse(`Jul 23 2026${NBSP}10:00:00 GMT+0000`)).toBe(baseTime);
  });
});

describe("Date.parse ASCII whitespace and line terminators", () => {
  // CR and LF are LineTerminator, not WhiteSpace, but V8's legacy parser
  // accepts them via SkipWhiteSpace().
  for (const [cp, name] of [
    [0x000a, "LF"],
    [0x000d, "CR"],
  ] as const) {
    const ch = String.fromCodePoint(cp);
    test(`accepts ${name} as separator`, () => {
      expect(Date.parse("Jul 23 2026" + ch + "10:00:00 GMT+0000")).toBe(baseTime);
      expect(Date.parse(ch + base)).toBe(baseTime);
      expect(Date.parse(base + ch)).toBe(baseTime);
    });
  }
});

test("Date.parse caching: same string with Unicode whitespace returns same value", () => {
  const s = `\u2009Jul 23 2026 10:00:00 GMT+0000\u00a0`;
  const first = Date.parse(s);
  expect(first).toBe(baseTime);
  expect(Date.parse(s)).toBe(first);
});
