import { test, expect } from "bun:test";

test("shift_jis", () => {
  const bytes = [147, 250, 150, 123, 140, 234];

  const decoder = new TextDecoder("shift_jis");
  const data = decoder.decode(Uint8Array.from(bytes));
  expect(data).toEqual("日本語");
});
