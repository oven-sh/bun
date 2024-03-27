import { test, expect } from "bun:test";

// @ts-expect-error
const highlighter: (code: string) => string = globalThis[Symbol.for("Bun.lazy")]("unstable_syntaxHighlight");

test("highlighter", () => {
  expect(highlighter("`can do ${123} ${'123'} ${`123`}`").length).toBeLessThan(150);
  expect(highlighter("`can do ${123} ${'123'} ${`123`}`123").length).toBeLessThan(150);
});
