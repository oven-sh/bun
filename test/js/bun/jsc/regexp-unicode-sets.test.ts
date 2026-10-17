import { describe, expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/30183
//
// In a v-mode character class, `&&` and `--` were only applied when the right
// operand was a plain class. An inverted operand such as `\P{...}` went through
// CharacterClassConstructor::appendInverted in JavaScriptCore's YarrPattern.cpp,
// which ignored the pending set operation and unioned the operand in, so
// `[\P{Number}&&\P{Alphabetic}]` matched letters and digits as well.
//
// Fixed in oven-sh/WebKit#299, picked up by the WebKit bump in #37352. These
// tests pin the behaviour of the WebKit build that Bun links against.
describe("RegExp v flag set operations with inverted operands", () => {
  const matches = (re: RegExp, input: string) => input.match(re) ?? [];

  test("&& with an inverted property on both sides", () => {
    // A and U+03BB (Greek lambda) are Alphabetic; 1 and U+0661 (Arabic-Indic
    // one) are Number; space, !, U+20AC (euro sign) and U+1F600 (emoji) are
    // neither. Yarr keeps separate tables for code points above U+00FF, so the
    // input covers both. Before the fix every character matched.
    expect(matches(/[\P{Number}&&\P{Alphabetic}]/gv, "A1 !\u03BB\u0661\u20AC\u{1F600}")).toEqual([
      " ",
      "!",
      "\u20AC",
      "\u{1F600}",
    ]);
  });

  test("&& chained across three inverted properties", () => {
    // Before the fix every character matched.
    expect(matches(/[\P{Letter}&&\P{Number}&&\P{White_Space}]/gv, "A1 !")).toEqual(["!"]);
  });

  test("-- with an inverted property on the right", () => {
    // Latin and Greek letters minus the non-lowercase ones leaves the lowercase
    // letters: a and U+03B1 (alpha) stay, A and U+0391 (capital alpha) go.
    // Before the fix every character matched.
    expect(matches(/[[A-Za-z\u0391-\u03A9\u03B1-\u03C9]--\P{Lowercase}]/gv, "aA\u03B1\u03911 ")).toEqual([
      "a",
      "\u03B1",
    ]);
  });

  test("&& with a built-in class on the left and an inverted property on the right", () => {
    // \D is a prebuilt class and never went through appendInverted; only the
    // \P{...} operand did. Before the fix every character matched.
    expect(matches(/[\D&&\P{Alphabetic}]/gv, "A1 ")).toEqual([" "]);
  });

  test("&& with an inverted property only on the left", () => {
    // The left operand is appended before any set operation is pending, so
    // this worked before the fix as well.
    expect(matches(/[\P{Number}&&\p{Alphabetic}]/gv, "A1 ")).toEqual(["A"]);
  });

  test("&& with no inverted operands", () => {
    // U+2164 ROMAN NUMERAL FIVE is gc=Nl, which is in both Number and Alphabetic.
    expect(matches(/[\p{Number}&&\p{Alphabetic}]/gv, "A1 \u2164")).toEqual(["\u2164"]);
  });

  test("union of a literal and an inverted property", () => {
    // A union is the pending operation once a second operand follows a literal,
    // so the inverted operand now takes the set operation path too; the literal
    // 7 has to survive even though \P{Number} excludes it.
    expect(matches(/[7\P{Number}]/gv, "71 A")).toEqual(["7", " ", "A"]);
  });
});
