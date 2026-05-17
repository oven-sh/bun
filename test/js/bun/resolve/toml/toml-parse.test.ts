import { expect, test } from "bun:test";

test("Bun.TOML.parse with non-string input throws", () => {
  expect(() => Bun.TOML.parse(SharedArrayBuffer as any)).toThrow();
  expect(() => Bun.TOML.parse(undefined as any)).toThrow();
  expect(() => Bun.TOML.parse(null as any)).toThrow();
});

// https://github.com/oven-sh/bun/issues/28681
test("Bun.TOML.parse handles \\t and \\f escapes correctly", () => {
  const toml = String.raw`str = "Name\tJos\u00E9\nLoc\tSF."`;
  const { str } = Bun.TOML.parse(toml) as { str: string };
  expect(str).toBe("Name\tJosé\nLoc\tSF.");
});

test("Bun.TOML.parse \\f escape produces formfeed (0x0C)", () => {
  const { str } = Bun.TOML.parse(String.raw`str = "a\fb"`) as { str: string };
  expect(str).toBe("a\fb");
  expect(str.charCodeAt(1)).toBe(0x0c);
});

test("Bun.TOML.parse \\t escape produces tab (0x09)", () => {
  const { str } = Bun.TOML.parse(String.raw`str = "a\tb"`) as { str: string };
  expect(str).toBe("a\tb");
  expect(str.charCodeAt(1)).toBe(0x09);
});
