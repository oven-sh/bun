import { expect, test } from "bun:test";

test("15326", () => {
  const s = "\uFFFF";
  expect(s.charCodeAt(0)).toBe(0xffff);
  expect(s.charCodeAt(1)).toBe(NaN);
});
