// https://github.com/oven-sh/bun/issues/17264
import { cssInternals } from "bun:internal-for-testing";
import { expect, test } from "bun:test";

const { testWithOptions } = cssInternals;

test("single-quotes in format are transformed", () => {
  const source = `@font-face {
  src: url("test.woff2") format('woff2-variations');
}`;
  const expected = `@font-face {
  src: url("test.woff2") format("woff2-variations");
}`;
  expect(testWithOptions(source, expected)).toEqualIgnoringWhitespace(expected);
});

test("double-quotes in format are preserved", () => {
  const source = `@font-face {
  src: url("test.woff2") format("woff2-variations");
}`;
  const expected = `@font-face {
  src: url("test.woff2") format("woff2-variations");
}`;
  expect(testWithOptions(source, expected)).toEqualIgnoringWhitespace(expected);
});

test("absence of quotes in format is corrected", () => {
  const source = `@font-face {
  src: url("test.woff2") format(woff2-variations);
}`;
  const expected = `@font-face {
  src: url("test.woff2") format("woff2-variations");
}`;
  expect(testWithOptions(source, expected)).toEqualIgnoringWhitespace(expected);
});

test("single-quotes in font-family are transformed", () => {
  const source = `@font-face {
  font-family: 'Custom Test Font';
}`;
  const expected = `@font-face {
  font-family: "Custom Test Font";
}`;
  expect(testWithOptions(source, expected)).toEqualIgnoringWhitespace(expected);
});

test("double-quotes in font-family are preserved", () => {
  const source = `@font-face {
  font-family: "Custom Test Font";
}`;
  const expected = `@font-face {
  font-family: "Custom Test Font";
}`;
  expect(testWithOptions(source, expected)).toEqualIgnoringWhitespace(expected);
});

test("absence of quotes in font-family is preserved", () => {
  const source = `@font-face {
  font-family: Custom Test Font;
}`;
  const expected = `@font-face {
  font-family: Custom Test Font;
}`;
  expect(testWithOptions(source, expected)).toEqualIgnoringWhitespace(expected);
});
