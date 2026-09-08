import { describe, expect, test } from "bun:test";

// Tests for the RegExp `v` flag (UnicodeSets mode) parser in JavaScriptCore's Yarr.

describe("raw U+0000 in a v-mode class set", () => {
  // U+0000 is a SourceCharacter that is neither a ClassSetSyntaxCharacter nor half of a
  // ClassSetReservedDoublePunctuator, so it is a valid ClassSetCharacter. It already parsed
  // with the `u` flag, outside a class with `v`, and as `\0` / `\x00`.
  const NUL = "\0";

  test.each([
    ["[" + NUL + "]", [NUL], ["a", "0"]],
    ["[a" + NUL + "]", [NUL, "a"], ["b"]],
    ["[" + NUL + "a]", [NUL, "a"], ["b"]],
    ["[" + NUL + NUL + "]", [NUL], ["a"]],
    ["[" + NUL + "-a]", [NUL, "\x01", "A", "a"], ["b"]],
    ["[\\x00-" + NUL + "]", [NUL], ["\x01"]],
    ["[^" + NUL + "]", ["a", "\x01"], [NUL]],
    ["[[" + NUL + "]]", [NUL], ["a"]],
    ["[[a-z]" + NUL + "]", [NUL, "q"], ["Q"]],
    ["[\\q{" + NUL + "}]", [NUL], ["a"]],
    ["[\\q{a" + NUL + "b|c}]", ["a" + NUL + "b", "c"], ["ab", NUL]],
    ["[" + NUL + "&&" + NUL + "]", [NUL], ["a"]],
    ["[\\x00&&" + NUL + "]", [NUL], ["a"]],
    ["[a&&" + NUL + "]", [], [NUL, "a"]],
    ["[\\w--" + NUL + "]", ["a"], [NUL]],
    ["[[" + NUL + "a]--" + NUL + "]", ["a"], [NUL]],
  ] as [string, string[], string[]][])("%j", (source, matching, nonMatching) => {
    const regExp = new RegExp("^" + source + "$", "v");
    for (const string of matching) expect(regExp.test(string)).toBe(true);
    for (const string of nonMatching) expect(regExp.test(string)).toBe(false);
  });

  test("the RegExp.escape composition accepts an input with a NUL", () => {
    // RegExp.escape leaves U+0000 as is, so this is the documented way to build a class
    // from arbitrary input.
    const regExp = new RegExp("[" + RegExp.escape("a" + NUL + "b") + "]", "v");
    expect(regExp.test(NUL)).toBe(true);
    expect(regExp.test("b")).toBe(true);
    expect(regExp.test("c")).toBe(false);
  });

  test("syntax characters and reserved punctuators next to a NUL are still rejected", () => {
    for (const source of [
      "[" + NUL + "(]",
      "[" + NUL + "|]",
      "[" + NUL + "&&&a]",
      "[" + NUL + "!!]",
      "[" + NUL + "-]",
      "[\\q{" + NUL + "(}]",
      "[\\" + NUL + "]",
    ]) {
      expect(() => new RegExp(source, "v")).toThrow(SyntaxError);
    }
  });
});
