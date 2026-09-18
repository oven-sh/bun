// src/codegen/builtin-parser.ts preprocesses src/js: it rewrites `$name` to
// `__intrinsic__name` in code and copies a regex literal as written. It is a
// tokenizer, not a parser, so it has to tell a regex literal from a division.
// When it took a literal for code, the namespace check in BundlerPlugin.ts,
// `!/^([/$a-zA-Z0-9_\\-]+)$/.test(namespace)`, shipped with `@a` in place of `$a`.
import { describe, expect, test } from "bun:test";
import { sliceSourceCode } from "../../../src/codegen/builtin-parser.ts";

function preprocess(body: string) {
  return sliceSourceCode(`{${body}}`, true);
}

// In every case `$b` is code and `$a` is not.
function expected(body: string) {
  return { result: `{${body.replaceAll("$b", "__intrinsic__b")}}`, rest: "" };
}

describe("builtin preprocessor", () => {
  test.each([
    ["=", "x = /[$a]/ + $b;"],
    ["(", "x = y(/[$a]/, $b);"],
    [",", "x = [$b, /[$a]/];"],
    ["{", "{ /[$a]/ + $b; }"],
    ["[", "x = [/[$a]/, $b];"],
    ["!", "x = !/[$a]/ + $b;"],
    ["&&", "x = $b && /[$a]/;"],
    ["||", "x = $b || /[$a]/;"],
    ["? and :", "x = $b ? /[$a]/ : /[$a]+/;"],
    ["+", "x = $b + /[$a]/;"],
    ["=>", "x = y => /[$a]/ + $b;"],
    ["...", "x = [$b, .../[$a]/];"],
    ["return", "return /[$a]/ + $b;"],
    ["case", "switch (x) { case /[$a]/: $b; }"],
    ["of", "for (x of /[$a]/) $b;"],
    ["await", "x = await /[$a]/ + $b;"],
    ["yield", "x = yield /[$a]/ + $b;"],
    ["a line comment", "x =\n  // it's a comment\n  /[$a]/ + $b;"],
    ["a block comment", "x = /* it's a comment */ /[$a]/ + $b;"],
  ])("copies a regex literal after %s", (_, body) => {
    expect(preprocess(body)).toEqual(expected(body));
  });

  test("copies a regex literal after export default", () => {
    expect(preprocess("export default /[$a]/ + $b;")).toEqual({
      result: "{__intrinsic__exports = /[$a]/ + __intrinsic__b;}",
      rest: "",
    });
  });

  // If the first `/` started a regex literal, `$b` would be inside it.
  test.each([
    ["a name", "x = y / $b / 2;"],
    [")", "x = (y) / $b / 2;"],
    ["]", "x = y[0] / $b / 2;"],
    ["a string", `x = "4" / $b / 2;`],
    ["a template literal", "x = `4` / $b / 2;"],
    ["a regex literal", "x = /4/ / $b / 2;"],
    ["postfix ++", "x = y++ / $b / 2;"],
    ["postfix --", "x = y-- / $b / 2;"],
    ["TypeScript's postfix ! on a name", "x = y! / $b / 2;"],
    ["TypeScript's postfix ! on a call", "x = y()! / $b / 2;"],
    ["a property named like a reserved word", "x = y.in / $b / 2;"],
    ["a private name like a reserved word", "x = this.#in / $b / 2;"],
    ["a name that ends like a reserved word", "x = begin / $b / 2;"],
    ["a block comment that follows a name", "x = y /* it's a comment */ / $b / 2;"],
    ["a block comment that follows a statement", "x = y; /* it's a comment */ $b / 2 / y;"],
  ])("divides after %s", (_, body) => {
    expect(preprocess(body)).toEqual(expected(body));
  });

  test.each([
    ["a division", "x = y /$b/ 2;"],
    ["a block comment", "x = y; /* it's a comment */$b;"],
    [")", "if (x)$b;"],
  ])("rewrites a `$name` that starts right after %s", (_, body) => {
    expect(preprocess(body)).toEqual(expected(body));
  });

  test("an escape in template text is a pair", () => {
    const body = "x = `a \\`</b>\\` ${$b} \\${$a}`; $b;";
    expect(preprocess(body)).toEqual(expected(body));
  });

  test("divides after a macro call and after require()", () => {
    const load = (specifier: string) => `load(${JSON.stringify(specifier)})`;
    const macro = sliceSourceCode("{$isPromisePending(x)}", true).result.slice(1, -1);
    const source = `{ x = /* c */ $isPromisePending(x) / $b / 2; x = /* c */ require("y") / $b / 2; }`;
    expect(sliceSourceCode(source, true, load)).toEqual({
      result: `{ x = /* c */ ${macro} / __intrinsic__b / 2; x = /* c */ load("y") / __intrinsic__b / 2; }`,
      rest: "",
    });
  });

  test("a character class ends at its unescaped `]`", () => {
    const body = String.raw`x = /[$a/\\]/; y = /[$a\]/]|[$a.*+?^{}()|[\]\\]/g; $b;`;
    expect(preprocess(body)).toEqual(expected(body));
  });

  test("a bracket in a regex literal does not move the end of the slice", () => {
    expect(sliceSourceCode("{ x = [$b, /[)]/]; } rest", true)).toEqual({
      result: "{ x = [__intrinsic__b, /[)]/]; }",
      rest: " rest",
    });
    expect(sliceSourceCode("{ { /[}]/ + $b; } } rest", true)).toEqual({
      result: "{ { /[}]/ + __intrinsic__b; } }",
      rest: " rest",
    });
  });

  test("a line comment can end the input", () => {
    expect(sliceSourceCode("{ $b; // it's a comment", true)).toEqual({
      result: "{ __intrinsic__b; // it's a comment",
      rest: "",
    });
  });
});
