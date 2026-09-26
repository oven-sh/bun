import { describe, expect, test } from "bun:test";

// The Yarr JIT reads two UTF-16 code units at once and tests them against a
// surrogate mask. Bun 1.3.13 and 1.3.14 shipped a JSC whose mask was
// 0xdc00dc00 instead of 0xfc00fc00, so U+F800..U+FBFF passed as a lead and
// U+FC00..U+FFFF passed as a trail. Two ordinary BMP code units were fused into
// one bogus code point and the second one was never matched.
// Fixed upstream in WebKit 317399@main (bugs.webkit.org/show_bug.cgi?id=319651).
// The interpreter (BUN_JSC_useRegExpJIT=false) was never affected.

const isLead = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isTrail = (c: number) => c >= 0xdc00 && c <= 0xdfff;
const isSurrogate = (c: number) => isLead(c) || isTrail(c);

describe("RegExp /u and /v surrogate pair detection", () => {
  test("\\p{Cs} matches a lone lead surrogate followed by U+FE0F", () => {
    expect(/\p{Cs}/u.test("\uD87E\uFE0F")).toBe(true);
    expect(/\p{Cs}/v.test("\uD87E\uFE0F")).toBe(true);
  });

  test("a class range matches after a U+F800..U+FBFF code unit", () => {
    expect("\uF900\uFE01".replace(/[\uFE00-\uFE0D]/gu, "Z")).toBe("\uF900Z");
    expect("\uF900\uFE01".replace(/[\uFE00-\uFE0D]/gv, "Z")).toBe("\uF900Z");
    expect(/\uFE01/u.test("\uF900\uFE01")).toBe(true);
  });

  test("only D800..DBFF followed by DC00..DFFF is one code point", () => {
    // Boundaries of the surrogate ranges, of the ranges the wrong mask also
    // accepted (F800..FBFF as lead, FC00..FFFF as trail), and plain controls.
    const prefixes = [
      0x41, 0xd7ff, 0xd800, 0xd87e, 0xdbff, 0xdc00, 0xdfff, 0xe000, 0xf7ff, 0xf800, 0xf900, 0xfbff, 0xfc00, 0xffff,
    ];
    const targets = [
      0x42, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0xe000, 0xfbff, 0xfc00, 0xfdd0, 0xfe01, 0xfe0f, 0xfeff, 0xffff,
    ];

    const oneCodePoint = /^.$/u;
    const twoCodePoints = /^..$/u;
    const surrogate = /\p{Cs}/u;
    const highBmp = /[\uFC00-\uFFFF]/u;

    const failures: string[] = [];
    for (const p of prefixes) {
      for (const t of targets) {
        const s = String.fromCharCode(p, t);
        const pair = isLead(p) && isTrail(t);
        const got = [oneCodePoint.test(s), twoCodePoints.test(s), surrogate.test(s), highBmp.test(s)];
        // A real pair is one astral code point, and neither unit is visible on
        // its own. Anything else is two BMP code points, each matched separately.
        const want = [pair, !pair, !pair && (isSurrogate(p) || isSurrogate(t)), !pair && (p >= 0xfc00 || t >= 0xfc00)];
        if (got.join() !== want.join())
          failures.push(`U+${p.toString(16)} U+${t.toString(16)}: got ${got}, want ${want}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
