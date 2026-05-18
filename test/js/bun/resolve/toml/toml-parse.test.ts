import { expect, test } from "bun:test";

test("Bun.TOML.parse with non-string input throws", () => {
  expect(() => Bun.TOML.parse(SharedArrayBuffer as any)).toThrow();
  expect(() => Bun.TOML.parse(undefined as any)).toThrow();
  expect(() => Bun.TOML.parse(null as any)).toThrow();
});

// https://github.com/oven-sh/bun/issues/30893
// TOML copy of decode_escape_sequences had the same unprotected subtraction as the JS lexer:
// `start + iter.i - widthN` underflows whenever an escape (or the `\u{` hex_start
// computation) lands at the start of a basic string. `\u{...}` at the very start of
// a string underflows even for VALID input because hex_start is computed eagerly
// before the loop. Must parse cleanly, not panic.
test("Bun.TOML.parse accepts \\u{XX} at start of a basic string (#30893)", () => {
  expect(Bun.TOML.parse(`key = "\\u{41}"`)).toEqual({ key: "A" });
});

test("Bun.TOML.parse rejects \\x escape (basic strings don't allow \\x) without panicking (#30893)", () => {
  // `\x` followed by a multi-byte codepoint would underflow in the error path.
  // Construct the bytes directly: `key = "\x<U+3945C>"`.
  const input =
    "key = " + String.fromCharCode(0x22) + "\\x" + String.fromCodePoint(0x3945c) + String.fromCharCode(0x22);
  expect(() => Bun.TOML.parse(input)).toThrow();
});

test("Bun.TOML.parse rejects \\u followed by multi-byte codepoint without panicking (#30893)", () => {
  const input =
    "key = " + String.fromCharCode(0x22) + "\\u" + String.fromCodePoint(0x3945c) + String.fromCharCode(0x22);
  expect(() => Bun.TOML.parse(input)).toThrow();
});
