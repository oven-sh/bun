import { expect, test } from "bun:test";

test("Bun.TOML.parse with non-string input throws", () => {
  expect(() => Bun.TOML.parse(SharedArrayBuffer as any)).toThrow();
  expect(() => Bun.TOML.parse(undefined as any)).toThrow();
  expect(() => Bun.TOML.parse(null as any)).toThrow();
});

// https://github.com/oven-sh/bun/issues/30893 (crash) and
// https://github.com/oven-sh/bun/issues/32025 (acceptance): `\u{…}` is a JS
// escape, not TOML — TOML only defines \uXXXX and \UXXXXXXXX. The old parser
// both accepted it and could crash on it; it must now be a clean SyntaxError.
test("Bun.TOML.parse rejects JS-style \\u{XX} escapes (#30893, #32025)", () => {
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
});

test("Bun.TOML.parse rejects \\x escape in quoted key at file start without panicking (#30893)", () => {
  // Quoted key at offset 0 puts `start = 1`; `\x` + 4-byte codepoint underflows at L1033.
  // Bytes: `"\x<U+3945C>" = 1`
  const input = '"\\x' + String.fromCodePoint(0x3945c) + '" = 1';
  expect(() => Bun.TOML.parse(input)).toThrow();
});

test("Bun.TOML.parse rejects \\u escape in quoted key at file start without panicking (#30893)", () => {
  // Quoted key at offset 0; `\u` + 4-byte codepoint underflows at L1125 (fixed-length \u branch).
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

// Pre-existing bug inherited from toml/lexer.zig: the `\t` / `\f` single-char escape
// arms had their output codepoints swapped (`\t` produced 0x0C form feed instead of
// 0x09 tab; `\f` produced 0x09 instead of 0x0C). The TOML spec (and ASCII) define
// `\t` = U+0009 and `\f` = U+000C, and the JS lexer already gets this right.
test("Bun.TOML.parse produces correct codepoints for \\t and \\f escapes", () => {
  expect(Bun.TOML.parse('k = "a\\tb"').k).toBe("a\u0009b");
  expect(Bun.TOML.parse('k = "a\\fb"').k).toBe("a\u000cb");
});

// The outer `\r` arm in decode_escape_sequences had the same iter.i-semantics bug
// as the `\r` escape arm below it: it indexed `text[iter.i]` for the CRLF lookahead,
// but after `next()` returns for `\r`, `iter.i` IS the `\r` byte, so the check never
// fired. Every literal CRLF in a slow-path multiline TOML basic string (any `"""..."""`
// containing CRLF plus at least one backslash escape to force the slow path) decoded
// to two LFs instead of one.
test("Bun.TOML.parse normalizes literal CRLF to LF in multiline basic strings", () => {
  // `"""a<CRLF>b\tc"""` — the `\t` escape forces the slow decode path.
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

// https://github.com/oven-sh/bun/issues/31252
// `Lexer::expect` in the TOML lexer logs a mismatch via `add_range_error` and
// then falls through to `next()` for error recovery, so the parser returned
// `Ok` with a partial AST for inputs like `[1 2]` and `[1 2 3]`. The JS entry
// point only inspected the `Result`, so the logged diagnostic was discarded
// and bogus values like `{"a":[1]}` / `{"a":[1,3]}` leaked out. The entry
// point now also checks `log.has_errors()` on the Ok path.
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
