import { highlightJavaScript as highlighter } from "bun:internal-for-testing";
import { expect, test } from "bun:test";

test("highlighter", () => {
  expect(highlighter("`can do ${123} ${'123'} ${`123`}`").length).toBeLessThan(150);
  expect(highlighter("`can do ${123} ${'123'} ${`123`}`123").length).toBeLessThan(150);
});
