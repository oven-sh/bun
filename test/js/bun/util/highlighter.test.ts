import { test, expect } from "bun:test";
import { quickAndDirtyJavaScriptSyntaxHighlighter as highlighter } from "bun:internal-for-testing";

test("highlighter", () => {
  expect(highlighter("`can do ${123} ${'123'} ${`123`}`").length).toBeLessThan(150);
  expect(highlighter("`can do ${123} ${'123'} ${`123`}`123").length).toBeLessThan(150);
});
