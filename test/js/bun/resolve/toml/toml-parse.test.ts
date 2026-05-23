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

// https://github.com/oven-sh/bun/issues/31250
// The lexer's identifier-start set included `@` and `$`, so both were accepted as
// the start of a bare key AND as a bare (unquoted) value — `a = @` returned
// `{ a: "@" }`. Per TOML 1.0.0, bare keys are `[A-Za-z0-9_-]+`, and unquoted
// values are restricted to `true`/`false`, numbers, dates, and `inf`/`nan`. The
// parser also accepted any `t_identifier` as a string value, so even `a = foo`
// parsed as `{ a: "foo" }` on an unpatched build.
test("Bun.TOML.parse rejects bare @ as a value (#31250)", () => {
  expect(() => Bun.TOML.parse("a = @")).toThrow();
  expect(() => Bun.TOML.parse("a = @foo")).toThrow();
});

test("Bun.TOML.parse rejects bare $ as a value (#31250)", () => {
  expect(() => Bun.TOML.parse("a = $bar")).toThrow();
});

test("Bun.TOML.parse rejects @ as the start of a bare key (#31250)", () => {
  expect(() => Bun.TOML.parse("@a = 1")).toThrow();
});

test("Bun.TOML.parse rejects $ as the start of a bare key (#31250)", () => {
  expect(() => Bun.TOML.parse("$a = 1")).toThrow();
});

test("Bun.TOML.parse rejects an unquoted identifier as a value (#31250)", () => {
  // Bare identifiers other than `true`/`false`/`inf`/`nan` are not valid values
  // per the TOML spec; they must be quoted.
  expect(() => Bun.TOML.parse("a = foo")).toThrow();
  expect(() => Bun.TOML.parse("a = hello")).toThrow();
});

test("Bun.TOML.parse still accepts true/false as bare values (#31250)", () => {
  // Guard against the identifier-rejection going too far and eating the
  // `true`/`false` keywords, which share the lexer's identifier tokenizer.
  expect(Bun.TOML.parse("a = true\nb = false")).toEqual({ a: true, b: false });
});

test("Bun.TOML.parse still accepts inf/nan as bare values (#31250)", () => {
  // TOML 1.0.0 float values: `inf`, `+inf`, `-inf`, `nan`, `+nan`, `-nan`.
  // These share the identifier tokenizer but the lexer emits them as numeric
  // literals, so the parser's `t_identifier` rejection doesn't swallow them.
  const out = Bun.TOML.parse("a = inf\nb = -inf\nc = +inf\nd = nan\ne = -nan\nf = +nan");
  expect(out.a).toBe(Infinity);
  expect(out.b).toBe(-Infinity);
  expect(out.c).toBe(Infinity);
  expect(out.d).toBeNaN();
  expect(out.e).toBeNaN();
  expect(out.f).toBeNaN();
});

test("Bun.TOML.parse still accepts quoted @-keys (#31250)", () => {
  // Fixture-style keys like `"@mybigcompany"` must still work — only bare
  // (unquoted) `@` is being rejected.
  expect(Bun.TOML.parse(`"@mybigcompany" = { url = "foo" }`)).toEqual({
    "@mybigcompany": { url: "foo" },
  });
});
