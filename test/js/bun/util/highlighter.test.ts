import { highlightJavaScript as highlighter } from "bun:internal-for-testing";
import { expect, test } from "bun:test";

test("highlighter", () => {
  expect(highlighter("`can do ${123} ${'123'} ${`123`}`").length).toBeLessThan(150);
  expect(highlighter("`can do ${123} ${'123'} ${`123`}`123").length).toBeLessThan(150);
});

// https://github.com/oven-sh/bun/issues/31434
// A trailing backslash inside an unterminated `${` interpolation used to run
// the scanner past the end of the input (OOB read / crash).
test.each([
  "`${\\", // backtick, $, {, backslash
  "`${\\\\", // backtick, $, {, backslash, backslash
  "`a${b\\", // some content before the trailing backslash
  "`${\\}", // backslash escaping the closing brace, nothing after
])("highlighter does not read past end of input for %p", input => {
  expect(typeof highlighter(input)).toBe("string");
});
