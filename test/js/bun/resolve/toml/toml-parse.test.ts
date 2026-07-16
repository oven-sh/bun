import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

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

const overflowingDigits = Buffer.alloc(64, "f").toString();

// https://github.com/oven-sh/bun/issues/30825
// The TOML lexer carries a copy of the JS lexer's variable-length `\u{...}` loop and
// inherited both of its bugs: `value * 16` trapped in debug builds once the escape had
// enough hex digits to overflow `i64`, and falling off the end of the literal before the
// closing `}` accepted the half-parsed value (`"\u{41"` decoded to `"A"`).
test("Bun.TOML.parse rejects out-of-range \\u{...} escapes without overflowing (#30825)", () => {
  expect(() => Bun.TOML.parse('a = "\\u{3333333316aaaaaaa}"')).toThrow("Unicode escape sequence is out of range");
  expect(() => Bun.TOML.parse(`a = "\\u{${overflowingDigits}}"`)).toThrow("Unicode escape sequence is out of range");
  expect(() => Bun.TOML.parse(`a = "\\u{0000${overflowingDigits}}"`)).toThrow(
    "Unicode escape sequence is out of range",
  );
  expect(() => Bun.TOML.parse('a = "\\u{110000}"')).toThrow("Unicode escape sequence is out of range");
});

test("Bun.TOML.parse rejects \\u{...} escapes with no closing brace (#30825)", () => {
  expect(() => Bun.TOML.parse('a = "\\u{41"')).toThrow("Syntax Error");
  expect(() => Bun.TOML.parse('a = "\\u{"')).toThrow("Syntax Error");
  expect(() => Bun.TOML.parse('a = "\\u{110000"')).toThrow("Syntax Error");
  expect(() => Bun.TOML.parse(`a = "\\u{${overflowingDigits}"`)).toThrow("Syntax Error");
});

test("Bun.TOML.parse still accepts in-range \\u{...} escapes (#30825)", () => {
  expect(Bun.TOML.parse('a = "\\u{41}"')).toEqual({ a: "A" });
  // Long enough to overflow if the leading zeros were counted as significant digits.
  expect(Bun.TOML.parse(`a = "\\u{${Buffer.alloc(64, "0").toString()}41}"`)).toEqual({ a: "A" });
  expect(Bun.TOML.parse('a = "\\u{10FFFF}"')).toEqual({ a: "\u{10FFFF}" });
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

// Deeply nested inline tables must throw RangeError, not the primitive `undefined`.
// When the printer's stack check fires before the parser's, the printer returns
// Error::StackOverflow without logging a message; the empty log used to convert
// to JSValue::UNDEFINED and get thrown verbatim.
test("Bun.TOML.parse throws RangeError (not undefined) on deeply nested inline tables", async () => {
  // Dense ladder: the depth band where the parser succeeds but the printer's stack
  // check fires varies with frame size (debug vs release vs ASAN), so probe a
  // geometric range rather than a single depth.
  const fixture = `
    const results = [];
    const depths = [];
    for (let d = 500; d <= 200000; d = Math.ceil(d * 1.25)) depths.push(d);
    for (const d of depths) {
      const src = "a = " + Buffer.alloc(d * 6).fill("{ b = ").toString() + "1" + Buffer.alloc(d * 2).fill(" }").toString();
      try {
        Bun.TOML.parse(src);
        results.push({ d, ok: true });
      } catch (e) {
        results.push({
          d,
          ok: false,
          isRangeError: e instanceof RangeError,
          type: e === undefined ? "undefined" : e?.constructor?.name ?? typeof e,
        });
      }
    }
    console.log(JSON.stringify(results));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const results: Array<{ d: number; ok: boolean; isRangeError?: boolean; type?: string }> = JSON.parse(stdout.trim());

  const thrown = results.filter(r => !r.ok);
  expect(thrown.length).toBeGreaterThan(0);
  for (const r of thrown) {
    expect({ d: r.d, type: r.type, isRangeError: r.isRangeError }).toEqual({
      d: r.d,
      type: "RangeError",
      isRangeError: true,
    });
  }
  expect(exitCode).toBe(0);
});
