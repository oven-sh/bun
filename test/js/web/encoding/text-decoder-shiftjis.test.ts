import { test, expect } from "bun:test";

test("shift_jis", () => {
  const bytes = [147, 250, 150, 123, 140, 234];
  const decoder = new TextDecoder("shift_jis");
  const data = decoder.decode(Uint8Array.from(bytes));
  expect(data).toEqual("日本語");
  expect(decoder.encoding).toBe("Shift_JIS");
  expect(new TextDecoder().decode(Uint8Array.from(bytes))).not.toBe("日本語");

  bytes.push(255);
  expect(() => new TextDecoder("shift_jis", { fatal: true }).decode(Uint8Array.from(bytes))).toThrow();
});

test("unknown encoding throws", () => {
  expect(() => new TextDecoder("pooop")).toThrow();
});
