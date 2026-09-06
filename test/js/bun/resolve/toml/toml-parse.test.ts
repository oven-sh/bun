import { expect, test } from "bun:test";

test("Bun.TOML.parse with non-string input throws", () => {
  expect(() => Bun.TOML.parse(SharedArrayBuffer as any)).toThrow();
  expect(() => Bun.TOML.parse(undefined as any)).toThrow();
  expect(() => Bun.TOML.parse(null as any)).toThrow();
});

// https://github.com/oven-sh/bun/issues/30893
// https://github.com/oven-sh/bun/issues/32025
// https://github.com/oven-sh/bun/issues/30825
// `\u{…}` is a JavaScript escape, not TOML.
test("Bun.TOML.parse rejects JS-style \\u{XX} escapes (#30893, #32025, #30825)", () => {
  let err: unknown;
  try {
    Bun.TOML.parse(`key = "\\u{41}"`);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(SyntaxError);
  expect((err as SyntaxError).message).toBe(
    "TOML Parse error: A Unicode escape must be followed by exactly 4 hex digits",
  );
  // Arbitrarily long hex-digit runs, including ones that overflowed the old
  // parser's i64 accumulator, are rejected at the opening brace.
  expect(() => Bun.TOML.parse(`a = "\\u{${Buffer.alloc(64, "f").toString()}}"`)).toThrow(SyntaxError);
  expect(() => Bun.TOML.parse('a = "\\u{41"')).toThrow(SyntaxError);
});

// https://github.com/oven-sh/bun/issues/30893: a `\x`/`\u` escape followed by
// a multi-byte codepoint in a quoted key at offset 0 crashed the old parser.
test("Bun.TOML.parse rejects \\x escape in quoted key at file start without panicking (#30893)", () => {
  const input = '"\\x' + String.fromCodePoint(0x3945c) + '" = 1';
  expect(() => Bun.TOML.parse(input)).toThrow();
});

test("Bun.TOML.parse rejects \\u escape in quoted key at file start without panicking (#30893)", () => {
  const input = '"\\u' + String.fromCodePoint(0x3945c) + '" = 1';
  expect(() => Bun.TOML.parse(input)).toThrow();
});

// https://github.com/oven-sh/bun/issues/30893: `key = """\<CR>"""` crashed the
// old parser (out-of-bounds read in the line-continuation look-ahead). A bare
// CR is not a TOML newline, so a backslash before it is an invalid escape —
// the input must produce a clean SyntaxError, never a crash.
test("Bun.TOML.parse rejects trailing backslash-CR in multiline basic string (#30893)", () => {
  let err: unknown;
  try {
    Bun.TOML.parse('key = """\\\r"""');
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(SyntaxError);
  expect((err as SyntaxError).message).toBe("TOML Parse error: Invalid escape sequence: (0x0D)");
});

// The old parser swapped the `\t` / `\f` escape output codepoints; the spec
// defines `\t` = U+0009 and `\f` = U+000C.
test("Bun.TOML.parse produces correct codepoints for \\t and \\f escapes", () => {
  expect(Bun.TOML.parse('k = "a\\tb"').k).toBe("a\u0009b");
  expect(Bun.TOML.parse('k = "a\\fb"').k).toBe("a\u000cb");
});

// The old parser decoded a literal CRLF to two LFs when the multiline string
// also contained a backslash escape; the spec normalizes CRLF to one LF.
test("Bun.TOML.parse normalizes literal CRLF to LF in multiline basic strings", () => {
  const input = 'k = """a\r\nb\\tc"""';
  expect(Bun.TOML.parse(input).k).toBe("a\nb\tc");
});

// Duplicate detection for non-ASCII keys: keys are stored as UTF-16 EStrings
// internally, and a byte-view comparison of those garbles the check — missing
// real duplicates and falsely rejecting distinct keys.
test("Bun.TOML.parse rejects duplicate non-ASCII keys", () => {
  let err: unknown;
  try {
    Bun.TOML.parse('"é" = 1\n"é" = 2');
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(SyntaxError);
  expect((err as SyntaxError).message).toBe("TOML Parse error: Cannot redefine key 'é'");
});

test("Bun.TOML.parse does not conflate distinct keys whose UTF-16 prefixes collide", () => {
  // U+0100 stored as UTF-16 has the byte prefix [0x00], which must not match
  // a previously-stored U+0000 key.
  expect(Bun.TOML.parse('"\\u0000" = 1\n"\\u0100" = 2')).toEqual({ "\u0000": 1, "Ā": 2 });
});

// https://github.com/oven-sh/bun/issues/31252: the old parser returned a
// partial AST for arrays missing comma separators instead of an error.
test("Bun.TOML.parse rejects array values without comma separators (#31252)", () => {
  expect(() => Bun.TOML.parse("a = [1 2]")).toThrow();
  expect(() => Bun.TOML.parse("a = [1 2 3]")).toThrow();
  expect(() => Bun.TOML.parse("a = [1, 2 3]")).toThrow();
  expect(() => Bun.TOML.parse('a = ["x" "y"]')).toThrow();

  // Valid comma-separated arrays still parse.
  expect(Bun.TOML.parse("a = [1, 2]")).toEqual({ a: [1, 2] });
  expect(Bun.TOML.parse("a = [1, 2, 3]")).toEqual({ a: [1, 2, 3] });
  // Trailing comma is legal TOML.
  expect(Bun.TOML.parse("a = [1, 2,]")).toEqual({ a: [1, 2] });
});
