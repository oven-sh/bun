import { cssInternals } from "bun:internal-for-testing";
import { expect, test } from "bun:test";

const { minifyTest, testWithOptions } = cssInternals;

test("unicode-range in @font-face is preserved", () => {
  const source = `@font-face {
  font-family: "Roboto Variable";
  unicode-range: U+0000-00FF, U+0131, U+0152-0153;
}`;
  const expected = `@font-face {
  font-family: Roboto Variable;
  unicode-range: U+??, U+131, U+152-153;
}`;
  expect(testWithOptions(source, expected)).toEqualIgnoringWhitespace(expected);
});

test("unicode-range in @font-face is preserved when minified", () => {
  const source = `@font-face { font-family: "Roboto Variable"; unicode-range: U+0000-00FF, U+0131, U+0152-0153; }`;
  const expected = `@font-face{font-family:Roboto Variable;unicode-range:U+??,U+131,U+152-153}`;
  expect(minifyTest(source, expected)).toEqual(expected);
});

test("unicode-range wildcard in @font-face is preserved", () => {
  const source = `@font-face { font-family: "Test"; unicode-range: U+4??; }`;
  const expected = `@font-face{font-family:Test;unicode-range:U+4??}`;
  expect(minifyTest(source, expected)).toEqual(expected);
});

test("unicode-range with hex letters in @font-face is preserved", () => {
  const source = `@font-face { font-family: "Test"; unicode-range: U+A640-A69F; }`;
  const expected = `@font-face{font-family:Test;unicode-range:U+a640-a69f}`;
  expect(minifyTest(source, expected)).toEqual(expected);
});

test("unicode-range single hex value in @font-face is preserved", () => {
  const source = `@font-face { font-family: "Test"; unicode-range: U+00FF; }`;
  const expected = `@font-face{font-family:Test;unicode-range:U+ff}`;
  expect(minifyTest(source, expected)).toEqual(expected);
});
