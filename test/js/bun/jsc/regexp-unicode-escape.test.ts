import { describe, expect, test } from "bun:test";

// Coverage for oven-sh/WebKit#577. RegExp.escape classified a supplementary
// code point by its low 16 bits, and Yarr accepted "\" + any non-ASCII
// character as an identity escape in Unicode mode.

describe("RegExp.escape with supplementary code points", () => {
  // Each low 16-bit value below is a character RegExp.escape has to escape
  // when it stands alone. The full code point is not that character.
  const passThrough = [
    ["\u{2002A}", "'*'"],
    ["\u{20009}", "tab"],
    ["\u{2002C}", "','"],
    ["\u{20020}", "space"],
    ["\u{12000}", "U+2000"],
    ["\u{1FEFF}", "U+FEFF"],
  ] as const;

  for (const [s, lowBits] of passThrough) {
    test(`U+${s.codePointAt(0)!.toString(16).toUpperCase()} (low 16 bits: ${lowBits}) passes through unchanged`, () => {
      expect(RegExp.escape(s)).toBe(s);
      for (const flags of ["", "u", "v"]) {
        expect(new RegExp(RegExp.escape(s), flags).test(s)).toBe(true);
      }
    });
  }

  test("escaped CJK Extension B text matches itself under u and v", () => {
    const name = "陳\u{2002A}文";
    const hay = `abc ${name} xyz`;
    expect(hay.search(new RegExp(RegExp.escape(name), "v"))).toBe(4);
    expect(hay.replaceAll(new RegExp(RegExp.escape(name), "gu"), "#")).toBe("abc # xyz");
  });

  test("no supplementary code point is escaped, in any plane", () => {
    // Every BMP code unit that RegExp.escape rewrites: SyntaxCharacter, '/',
    // the other punctuators, ControlEscape, WhiteSpace, LineTerminator, and a
    // sample of the surrogate range. A supplementary code point with these
    // low 16 bits is an ordinary character.
    const escapedLow16 = [
      ..."^$\\.*+?()[]{}|/,-=<>#&!%:;@~'`\"\t\n\v\f\r \u00a0\u1680\u2028\u2029\u202f\u205f\u3000\ufeff",
    ].map(c => c.charCodeAt(0));
    for (let c = 0x2000; c <= 0x200a; c++) escapedLow16.push(c);
    escapedLow16.push(0xd800, 0xd83d, 0xdbff, 0xdc00, 0xde00, 0xdfff);
    for (const low of escapedLow16) {
      expect(RegExp.escape("_" + String.fromCharCode(low))).not.toBe("_" + String.fromCharCode(low));
    }

    const changed: string[] = [];
    for (let plane = 1; plane <= 16; plane++) {
      for (const low of escapedLow16) {
        const cp = (plane << 16) | low;
        const s = String.fromCodePoint(cp);
        if (RegExp.escape(s) !== s) changed.push("U+" + cp.toString(16));
      }
    }
    for (let cp = 0x10000; cp < 0x110000; cp += 331) {
      const s = String.fromCodePoint(cp);
      if (RegExp.escape(s) !== s) changed.push("U+" + cp.toString(16));
    }
    expect(changed).toEqual([]);
  });

  test("BMP inputs are still escaped", () => {
    expect(RegExp.escape("^$\\.*+?()[]{}|/")).toBe("\\^\\$\\\\\\.\\*\\+\\?\\(\\)\\[\\]\\{\\}\\|\\/");
    expect(RegExp.escape(",-=<>#&!%:;@~'`\"")).toBe(
      "\\x2c\\x2d\\x3d\\x3c\\x3e\\x23\\x26\\x21\\x25\\x3a\\x3b\\x40\\x7e\\x27\\x60\\x22",
    );
    expect(RegExp.escape("\t\n\v\f\r")).toBe("\\t\\n\\v\\f\\r");
    expect(RegExp.escape(" \uFEFF\u2000\u3000")).toBe("\\x20\\ufeff\\u2000\\u3000");
    expect(RegExp.escape("\uD800_\uDFFF")).toBe("\\ud800_\\udfff");
    expect(RegExp.escape("test")).toBe("\\x74est");
  });
});

describe("identity escapes in Unicode mode", () => {
  const rejected = ["\u00e9", "\u4e2d", "\u{1F600}", "\ud83d", "\ude00", "\u2028", "\ufeff"];

  for (const ch of rejected) {
    const label = [...ch].map(c => "U+" + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")).join(" ");
    test(`"\\\\" + ${label} is a SyntaxError with the u and v flags`, () => {
      for (const flags of ["u", "v"]) {
        expect(() => new RegExp("\\" + ch, flags)).toThrow(SyntaxError);
        expect(() => new RegExp("[\\" + ch + "]", flags)).toThrow(SyntaxError);
        expect(() => new RegExp("(?:\\" + ch + ")+", flags)).toThrow(SyntaxError);
      }
      expect(() => new RegExp("[\\q{\\" + ch + "}]", "v")).toThrow(SyntaxError);
      expect(() => new RegExp("[[a]--[\\" + ch + "]]", "v")).toThrow(SyntaxError);
    });
  }

  test("SyntaxCharacter and '/' are still identity escapes", () => {
    for (const ch of "^$\\.*+?()[]{}|/") {
      for (const flags of ["u", "v"]) {
        expect(new RegExp("^\\" + ch + "$", flags).test(ch)).toBe(true);
      }
    }
    expect(/^[\-]$/u.test("-")).toBe(true);
    expect(/^[\&]$/v.test("&")).toBe(true);
    expect(() => new RegExp("\\a", "u")).toThrow(SyntaxError);
    expect(() => new RegExp("\\ ", "u")).toThrow(SyntaxError);
  });

  test("non-Unicode patterns keep the Annex B identity escape", () => {
    for (const ch of ["\u00e9", "\u4e2d", "\u{1F600}"]) {
      expect(new RegExp("^\\" + ch + "$").test(ch)).toBe(true);
      expect(new RegExp("^[\\" + ch + "]+$").test(ch)).toBe(true);
    }
  });
});
