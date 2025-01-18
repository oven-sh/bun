import { test, expect } from "bun:test";

test("15314", () => {
  expect(
    new RegExp(
      "[A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u02b8\u0300-\u0590\u0900-\u1fff\u200e\u2c00-\ud801\ud804-\ud839\ud83c-\udbff\uf900-\ufb1c\ufe00-\ufe6f\ufefd-\uffff]",
    ).exec("\uFFFF"),
  ).toEqual([String.fromCodePoint(0xffff)]);
});
