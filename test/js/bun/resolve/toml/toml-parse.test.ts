import { expect, test } from "bun:test";

test("Bun.TOML.parse with non-string input throws", () => {
  expect(() => Bun.TOML.parse(SharedArrayBuffer as any)).toThrow();
  expect(() => Bun.TOML.parse(undefined as any)).toThrow();
  expect(() => Bun.TOML.parse(null as any)).toThrow();
});

// https://github.com/oven-sh/bun/issues/30893
// TOML copy of decode_escape_sequences had the same unprotected subtraction as the JS
// lexer: `start + iter.i - widthN` underflows whenever an escape lands near byte 0 of
// the source. The string body must open at the start of the file — a quoted KEY at file
// start (`"\x…" = 1`) gives `start = 1`, so `1 + 2 - 4` underflows. A bare-key assignment
// like `key = "…"` puts `start` at 7, which is big enough that the subtraction stays
// positive on unpatched builds and the test wouldn't catch a regression.
// `\u{…}` is a separate case: `hex_start = iter.i - width - width2 - width3` doesn't
// involve `start` at all, so it underflows for *valid* input like `"\u{41}"` regardless
// of where the string sits.
test("Bun.TOML.parse accepts \\u{XX} at start of a basic string (#30893)", () => {
  expect(Bun.TOML.parse(`key = "\\u{41}"`)).toEqual({ key: "A" });
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

// https://github.com/oven-sh/bun/issues/30893
// Off-by-one in the CRLF look-ahead of the `\r` line-continuation branch: the guard
// checked `iter.i < text.len()` but indexed `text[iter.i + 1]`. A multiline basic
// string ending in `\<CR>` immediately before `"""` triggers `text[len]` — and slice
// bounds checks fire in release too, so this was a hard crash everywhere (not just
// debug). The JS lexer already reads the index it guards on; this brings the TOML
// copy in line.
test("Bun.TOML.parse handles trailing backslash-CR in multiline basic string (#30893)", () => {
  // Bytes: `key = """\<CR>"""` — a backslash line-continuation where the newline
  // is a bare CR and the string ends immediately after it.
  const input = 'key = """\\\r"""';
  expect(Bun.TOML.parse(input)).toEqual({ key: "" });
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

// https://github.com/oven-sh/bun/issues/31251
// `parse_value_inner` used to accept `t_identifier` at value position and emit it as
// an `E.String`. The lexer's identifier class is deliberately broad so bare keys like
// `foo-bar` work, which meant `a = @`, `a = foo`, `a = $` all silently parsed as
// strings instead of being syntax errors. Per the TOML spec, the right-hand side
// of `key = value` must be a quoted string, number, boolean, datetime, array, or
// inline table — anything else is invalid.
test("Bun.TOML.parse rejects bare identifiers at value position (#31251)", () => {
  expect(() => Bun.TOML.parse("a = @")).toThrow();
  expect(() => Bun.TOML.parse("a = foo")).toThrow();
  expect(() => Bun.TOML.parse("a = @foo")).toThrow();
  expect(() => Bun.TOML.parse("a = $")).toThrow();
  expect(() => Bun.TOML.parse("a = _bar")).toThrow();
  // inside an inline table
  expect(() => Bun.TOML.parse("a = { x = foo }")).toThrow();
  // inside an array
  expect(() => Bun.TOML.parse("a = [foo]")).toThrow();
});

// `true`/`false` are kept as booleans — they have their own tokens and never
// reach the identifier arm.
test("Bun.TOML.parse still accepts true/false booleans at value position (#31251)", () => {
  expect(Bun.TOML.parse("a = true\nb = false")).toEqual({ a: true, b: false });
});

// Bare keys with the same alphabet as the old value-position identifier arm must
// still work — the fix is value-only.
test("Bun.TOML.parse still accepts bare keys built from @/$/_/letters/digits/-/: (#31251)", () => {
  expect(Bun.TOML.parse('@foo = "ok"')).toEqual({ "@foo": "ok" });
  expect(Bun.TOML.parse('$bar = "ok"')).toEqual({ $bar: "ok" });
  expect(Bun.TOML.parse('foo-bar = "ok"')).toEqual({ "foo-bar": "ok" });
});

// Per TOML 1.0.0 §Float, `inf`, `+inf`, `-inf`, `nan`, `+nan`, `-nan` are valid
// floats. Before this fix:
//  - `a = inf` / `a = nan` silently parsed as the strings `"inf"` / `"nan"`
//    (they fell into `parse_value_inner`'s `t_identifier` arm).
//  - `a = +inf` / `a = -inf` / `a = ±nan` produced `0` (the `t_plus` / `t_minus`
//    arms read `self.lexer.number` before `expect(t_numeric_literal)`, which
//    fails on an identifier — the 0 was whatever `number` was last set to).
// The lexer now promotes bare `inf` / `nan` to `t_numeric_literal` with
// `f64::INFINITY` / `f64::NAN`, which also feeds the `t_plus` / `t_minus` arms.
// Requires the TOMLObject JSValue pipeline to bypass the `print_json → JSONParse`
// round-trip (strict JSON has no `Infinity` / `NaN`); that's done in the same
// patch.
test("Bun.TOML.parse accepts inf and nan as float values (#31251)", () => {
  expect(Bun.TOML.parse("a = inf").a).toBe(Infinity);
  expect(Bun.TOML.parse("a = +inf").a).toBe(Infinity);
  expect(Bun.TOML.parse("a = -inf").a).toBe(-Infinity);
  expect(Bun.TOML.parse("a = nan").a).toBeNaN();
  expect(Bun.TOML.parse("a = +nan").a).toBeNaN();
  expect(Bun.TOML.parse("a = -nan").a).toBeNaN();
});

// Bare keys spelled exactly `inf` / `nan` must keep working. The lexer now emits
// `t_numeric_literal`, and `parse_key_segment`'s numeric-literal arm uses the raw
// source text (`self.lexer.raw()`) as the key string, preserving the spelling.
test("Bun.TOML.parse still accepts bare keys named inf and nan (#31251)", () => {
  expect(Bun.TOML.parse('inf = "ok"')).toEqual({ inf: "ok" });
  expect(Bun.TOML.parse('nan = "ok"')).toEqual({ nan: "ok" });
});

// Identifiers that merely contain `inf` / `nan` (`infinity`, `nan1`, `inf-foo`)
// still fall through to `t_identifier` and are rejected at value position.
test("Bun.TOML.parse rejects inf-like/nan-like identifiers at value position (#31251)", () => {
  expect(() => Bun.TOML.parse("a = infinity")).toThrow();
  expect(() => Bun.TOML.parse("a = nan1")).toThrow();
  expect(() => Bun.TOML.parse("a = inf-foo")).toThrow();
});
