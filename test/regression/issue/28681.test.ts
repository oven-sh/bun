import { test, expect } from "bun:test";

test("TOML parser handles \\t and \\f escapes correctly", () => {
  const toml = String.raw`str = "Name\tJos\u00E9\nLoc\tSF."`;
  const { str } = Bun.TOML.parse(toml) as { str: string };
  expect(str).toBe("Name\tJosé\nLoc\tSF.");
});

test("TOML parser \\f escape produces formfeed", () => {
  const toml = String.raw`str = "a\fb"`;
  const { str } = Bun.TOML.parse(toml) as { str: string };
  expect(str).toBe("a\fb");
  expect(str.charCodeAt(1)).toBe(0x0c);
});

test("TOML parser \\t escape produces tab", () => {
  const toml = String.raw`str = "a\tb"`;
  const { str } = Bun.TOML.parse(toml) as { str: string };
  expect(str).toBe("a\tb");
  expect(str.charCodeAt(1)).toBe(0x09);
});
