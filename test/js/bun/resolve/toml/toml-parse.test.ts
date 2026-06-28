import { describe, expect, test } from "bun:test";

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

// `\UXXXXXXXX` (8 hex digits) is one of the two Unicode escapes TOML defines
// (§String). The lexer only implemented `\u`, so `\U` fell into the catch-all
// "unknown escape emits the literal next character" branch and `"\U000003B4"`
// silently became the 9-character string `U000003B4` instead of `δ`.
// Reference: toml-test valid/string/unicode-escape, valid/string/multibyte-escape.
describe("TOML \\U unicode escapes", () => {
  test("8-digit \\U escapes decode to the code point", () => {
    expect(Bun.TOML.parse('a = "\\U000003B4"')).toEqual({ a: "δ" });
    expect(Bun.TOML.parse('a = "\\U00000063"')).toEqual({ a: "c" });
    expect(Bun.TOML.parse('a = "\\U000000E9"')).toEqual({ a: "é" });
    // Astral plane (needs a surrogate pair in the JS string).
    expect(Bun.TOML.parse('a = "\\U00010AF1"')).toEqual({ a: "\u{10AF1}" });
    // Inside multiline basic strings too.
    expect(Bun.TOML.parse('a = """\\U000003B4"""')).toEqual({ a: "δ" });
    // `\u` and `\U` spellings of the same code point agree.
    expect(Bun.TOML.parse('a = "\\u03B4"').a).toBe(Bun.TOML.parse('a = "\\U000003B4"').a);
    // NOTE: `\U00000000` is decoded correctly too, but Bun.TOML.parse cannot
    // surface it: its AST-to-JS path prints JSON text and `print_json` does
    // not yet escape U+0000-U+001F, so `JSON.parse` rejects the output. That
    // is a separate, pre-existing bug (`Bun.TOML.parse('a = "\\u0000"')`
    // already throws "Failed to parse JSON"). The module loader path handles
    // it; see toml.test.js.
  });

  test("\\U with fewer than 8 hex digits is rejected", () => {
    // toml-test invalid/string/bad-uni-esc-03 / bad-uni-esc-04
    expect(() => Bun.TOML.parse('a = "\\U0000000"')).toThrow();
    expect(() => Bun.TOML.parse('a = "\\U0000"')).toThrow();
    expect(() => Bun.TOML.parse('a = "\\Ugggggggg"')).toThrow();
    expect(() => Bun.TOML.parse('a = "\\Ux"')).toThrow();
  });

  test("escapes outside the Unicode scalar value range are rejected", () => {
    // toml-test invalid/string/basic-out-of-range-unicode-escape-01 / -02
    expect(() => Bun.TOML.parse('a = "\\UFFFFFFFF"')).toThrow("Unicode scalar value");
    expect(() => Bun.TOML.parse('a = "\\U00D80000"')).toThrow("Unicode scalar value");
    // toml-test invalid/string/bad-uni-esc-06: lone surrogate.
    expect(() => Bun.TOML.parse('a = "\\uD801"')).toThrow("Unicode scalar value");
    expect(() => Bun.TOML.parse('a = "\\udfff"')).toThrow("Unicode scalar value");
  });
});

// TOML §String: the valid escapes are `\b \t \n \f \r \" \\ \uXXXX \UXXXXXXXX`.
// "All other escape sequences [...] are reserved; if they are used, TOML should
// produce an error." The lexer instead emitted the literal character after the
// backslash, so e.g. `"\a"` loaded as `"a"` and `"C:\Users"` as `"C:Users"`.
// Reference: toml-test invalid/string/bad-escape-01, basic-unknown-escape,
// bad-slash-escape, multiline-bad-escape-01.
test("Bun.TOML.parse rejects reserved escape sequences instead of dropping the backslash", () => {
  for (const escape of ["a", "e", "q", "/", "'", "0", "7", "8", "9", "v", "?", "U5"]) {
    expect(() => Bun.TOML.parse(`a = "\\${escape}x"`)).toThrow();
    expect(() => Bun.TOML.parse(`a = """\\${escape}x"""`)).toThrow();
  }
  // The TOML escapes all still work.
  expect(Bun.TOML.parse('a = "|\\b.\\t.\\n.\\f.\\r.\\".\\\\.\\u007F."')).toEqual({
    a: '|\b.\t.\n.\f.\r.".\\.\u007F.',
  });
});

// TOML §String: "A newline immediately following the opening delimiter will be
// trimmed." The lexer sliced the content starting right after the `"""`/`'''`,
// so `"""\nX"""` loaded as `"\nX"` instead of `"X"`.
// Reference: toml-test valid/string/multiline, valid/string/raw-multiline.
test("Bun.TOML.parse trims the newline immediately after an opening multiline delimiter", () => {
  expect(Bun.TOML.parse('a = """\nX"""')).toEqual({ a: "X" });
  expect(Bun.TOML.parse('a = """\r\nX"""')).toEqual({ a: "X" });
  expect(Bun.TOML.parse("a = '''\nX'''")).toEqual({ a: "X" });
  expect(Bun.TOML.parse("a = '''\r\nX'''")).toEqual({ a: "X" });
  // Only the first newline is trimmed.
  expect(Bun.TOML.parse('a = """\n\nX"""')).toEqual({ a: "\nX" });
  expect(Bun.TOML.parse("a = '''\n\nX'''")).toEqual({ a: "\nX" });
  // An empty body after the trim is fine.
  expect(Bun.TOML.parse('a = """\n"""')).toEqual({ a: "" });
  expect(Bun.TOML.parse("a = '''\n'''")).toEqual({ a: "" });
  // No newline right after the delimiter: nothing is trimmed.
  expect(Bun.TOML.parse('a = """ \nX"""')).toEqual({ a: " \nX" });
});

// TOML §String: "When the last non-whitespace character on a line is an
// unescaped `\`, it will be trimmed along with all whitespace (including
// newlines) up to the next non-whitespace character or closing delimiter."
// The lexer dropped only the `\` and its newline, so the indentation of the
// continued line leaked into the value (`"""a \\\n   b"""` became `"a    b"`).
// Reference: toml-test valid/string/multiline, valid/string/ends-in-whitespace-escape.
describe("TOML line-ending backslash", () => {
  test("consumes the following whitespace and newlines", () => {
    expect(Bun.TOML.parse('a = """a \\\n   b"""')).toEqual({ a: "a b" });
    expect(Bun.TOML.parse('a = """a\\\n    b"""')).toEqual({ a: "ab" });
    // Blank lines after the continuation are consumed too.
    expect(Bun.TOML.parse('a = """\nThe quick brown \\\n\n\n  fox."""')).toEqual({
      a: "The quick brown fox.",
    });
    // Whitespace *before* the backslash is kept (toml-test keep-ws-before).
    expect(Bun.TOML.parse('a = """a   \t\\\n   b"""')).toEqual({ a: "a   \tb" });
  });

  test("allows trailing whitespace between the backslash and the newline", () => {
    // ABNF `mlb-escaped-nl = escape ws newline *( wschar / newline )`.
    expect(Bun.TOML.parse('a = """a \\   \n   b"""')).toEqual({ a: "a b" });
    expect(Bun.TOML.parse('a = """a \\\t\n   b"""')).toEqual({ a: "a b" });
    // toml-test valid/string/ends-in-whitespace-escape.
    expect(Bun.TOML.parse('a = """\nheeee\ngeeee\\  \n\n\n      """')).toEqual({
      a: "heeee\ngeeee",
    });
  });

  test("an escaped backslash is not a line continuation", () => {
    // toml-test valid/string/multiline escape-bs-1/2/3.
    expect(Bun.TOML.parse('a = """a \\\\\nb"""')).toEqual({ a: "a \\\nb" });
    expect(Bun.TOML.parse('a = """a \\\\\\\nb"""')).toEqual({ a: "a \\b" });
    expect(Bun.TOML.parse('a = """a \\\\\\\\\n  b"""')).toEqual({ a: "a \\\\\n  b" });
  });

  test("a backslash followed by non-whitespace on the same line is an error", () => {
    // toml-test invalid/string/multiline-bad-escape-02/-03, multiline-escape-space-01/-02.
    expect(() => Bun.TOML.parse('a = """t\\ t"""')).toThrow();
    expect(() => Bun.TOML.parse('a = """t\\ """')).toThrow();
    expect(() => Bun.TOML.parse('a = """\nhee \\\n\ngee \\   """')).toThrow();
    // `\<space>` is never valid in a single-line basic string.
    expect(() => Bun.TOML.parse('a = "t\\ t"')).toThrow();
  });
});

// One or two quote characters directly against the closing `"""`/`'''` belong
// to the content, not the delimiter. The lexer closed at the first run of three
// quotes, leaving the extras behind as a stray token.
// Reference: toml-test valid/string/multiline-quotes, valid/string/raw-multiline.
test("Bun.TOML.parse keeps quotes adjacent to a closing multiline delimiter", () => {
  expect(Bun.TOML.parse('a = """"x""""')).toEqual({ a: '"x"' });
  expect(Bun.TOML.parse('a = """""x"""""')).toEqual({ a: '""x""' });
  expect(Bun.TOML.parse("a = ''''x''''")).toEqual({ a: "'x'" });
  expect(Bun.TOML.parse("a = '''''x'''''")).toEqual({ a: "''x''" });
  // toml-test valid/string/multiline-quotes `escaped`: `"""lol\""""""`.
  expect(Bun.TOML.parse('a = """lol\\""""""')).toEqual({ a: 'lol"""' });
  expect(Bun.TOML.parse('a = """\nClosing with five quotes\n"""""')).toEqual({
    a: 'Closing with five quotes\n""',
  });
  // toml-test valid/string/raw-multiline `this-str-has-apostrophes`.
  expect(Bun.TOML.parse("a = '''' there's one already\n'' two more\n'''''")).toEqual({
    a: "' there's one already\n'' two more\n''",
  });
});

// TOML §Keys: a bare key is `A-Za-z0-9_-`, so a dotted key made of digit-only
// segments written without spaces (`3.14159 = "pi"`) is the two-segment key
// `3` . `14159`. The lexer tokenizes it as one float and the key parser used
// the raw token text, producing the single key `"3.14159"`. The same lexer
// behavior also made `a.1 = 1` a hard parse error: the `.1` becomes a numeric
// literal, not a `.` followed by the segment `1`.
// Reference: toml-test valid/key/numeric-02 (`1.2 = true` -> {"1":{"2":true}}).
test("Bun.TOML.parse splits float-looking bare keys on the dot", () => {
  expect(Bun.TOML.parse('3.14159 = "pi"')).toEqual({ "3": { "14159": "pi" } });
  expect(Bun.TOML.parse("1.2 = true")).toEqual({ "1": { "2": true } });
  expect(Bun.TOML.parse("[3.14]\nx = 1")).toEqual({ "3": { "14": { x: 1 } } });
  // toml-test valid/key/numeric-04: leading zeros are preserved verbatim.
  expect(Bun.TOML.parse("01.23 = true")).toEqual({ "01": { "23": true } });
  // A digit segment *continuing* a dotted key.
  expect(Bun.TOML.parse("a.1 = 1")).toEqual({ a: { "1": 1 } });
  expect(Bun.TOML.parse("a.1.5 = 1")).toEqual({ a: { "1": { "5": 1 } } });
  expect(Bun.TOML.parse('x.3.14159 = "pi"')).toEqual({ x: { "3": { "14159": "pi" } } });
  // Whitespace around the dot already worked; it must agree with the no-space form.
  expect(Bun.TOML.parse('3 . 14159 = "pi"')).toEqual(Bun.TOML.parse('3.14159 = "pi"'));
  expect(Bun.TOML.parse("a . 1 = 1")).toEqual(Bun.TOML.parse("a.1 = 1"));
  // A *quoted* key is never split.
  expect(Bun.TOML.parse('"3.14159" = "pi"')).toEqual({ "3.14159": "pi" });
  // Digit-only bare keys without a dot are unaffected.
  expect(Bun.TOML.parse("1 = true\n10e3 = 1\n2018_10 = 2")).toEqual({
    "1": true,
    "10e3": 1,
    "2018_10": 2,
  });
  // Empty bare segments are invalid (toml-test invalid/key/dot).
  expect(() => Bun.TOML.parse(". = 1")).toThrow();
  expect(() => Bun.TOML.parse(".5 = 1")).toThrow();
  expect(() => Bun.TOML.parse("a..5 = 1")).toThrow();
  expect(() => Bun.TOML.parse("3. = 1")).toThrow();
});

// TOML §Integer: "Arbitrary 64-bit signed integers should be accepted and
// handled losslessly. If an integer cannot be represented losslessly, an error
// must be thrown." Bun's TOML values are JavaScript numbers (IEEE-754 doubles),
// so integers past 2^53 silently lost their low digits:
// `9223372036854775807` loaded as `9223372036854776000`.
// Reference: toml-test valid/integer/long.
describe("TOML 64-bit integers", () => {
  test("integers that a JS number cannot represent exactly are an error", () => {
    expect(() => Bun.TOML.parse("a = 9223372036854775807")).toThrow("cannot be represented exactly");
    // 2^53 + 1: the first integer an f64 cannot hold.
    expect(() => Bun.TOML.parse("a = 9007199254740993")).toThrow("cannot be represented exactly");
    expect(() => Bun.TOML.parse("a = -9007199254740993")).toThrow("cannot be represented exactly");
    // Hexadecimal / octal / binary spellings are covered by the same check.
    expect(() => Bun.TOML.parse("a = 0x7FFFFFFFFFFFFFFF")).toThrow("cannot be represented exactly");
    expect(() => Bun.TOML.parse("a = 0o777777777777777777777")).toThrow();
    // Out of the 64-bit range entirely.
    expect(() => Bun.TOML.parse("a = 99999999999999999999999999")).toThrow("64-bit range");
    expect(() => Bun.TOML.parse("a = 0xFFFFFFFFFFFFFFFF")).toThrow();
    expect(() => Bun.TOML.parse("a = 0xFFFFFFFFFFFFFFFFF")).toThrow();
  });

  test("every exactly-representable integer still parses", () => {
    expect(Bun.TOML.parse("a = 9007199254740992").a).toBe(2 ** 53);
    expect(Bun.TOML.parse("a = -9007199254740992").a).toBe(-(2 ** 53));
    // 10^17 > 2^53 but is still exact (it only needs 40 significant bits).
    expect(Bun.TOML.parse("a = 100000000000000000").a).toBe(1e17);
    // i64::MIN is a power of two, so it round-trips exactly.
    expect(Bun.TOML.parse("a = -9223372036854775808").a).toBe(-(2 ** 63));
    expect(Bun.TOML.parse("a = 1_000_000_000_000_000").a).toBe(1e15);
    expect(Bun.TOML.parse("a = 0xDEADBEEF").a).toBe(0xdeadbeef);
    expect(Bun.TOML.parse("a = 0").a).toBe(0);
  });

  test("floats are unaffected: they round like any other IEEE-754 double", () => {
    expect(Bun.TOML.parse("a = 9223372036854775807.0").a).toBe(9223372036854775807.0);
    expect(Bun.TOML.parse("a = 9007199254740993e0").a).toBe(9007199254740992);
    expect(Bun.TOML.parse("a = 3.141592653589793").a).toBe(Math.PI);
  });
});

// TOML §Offset Date-Time / §Local Date-Time / §Local Date / §Local Time. The
// lexer had no date-time branch at all: `1979-05-27T07:32:00Z` tokenized as the
// integer 1979 followed by a stray `-`, so every document containing a date was
// rejected with "Expected key but found -". There is no date-time node in the
// TOML AST, so the value surfaces as the verbatim RFC 3339 string.
// Reference: toml-test valid/datetime/*.
describe("TOML date-times", () => {
  test("all four RFC 3339 shapes parse as their source text", () => {
    expect(
      Bun.TOML.parse(
        ["offset = 1979-05-27T07:32:00Z", "local = 1987-07-05T17:45:00", "date = 1979-05-27", "time = 07:32:00"].join(
          "\n",
        ),
      ),
    ).toEqual({
      offset: "1979-05-27T07:32:00Z",
      local: "1987-07-05T17:45:00",
      date: "1979-05-27",
      time: "07:32:00",
    });
  });

  test("delimiter case, fractional seconds, and numeric offsets", () => {
    // toml-test valid/datetime/datetime, milliseconds, timezone, local-time.
    expect(
      Bun.TOML.parse(
        [
          "space = 1987-07-05 17:45:00Z",
          "lower = 1987-07-05t17:45:00z",
          "milli = 1977-12-21T10:32:00.555",
          "wita = 1987-07-05T17:45:56.6+08:00",
          "pdt = 1987-07-05T17:45:56-05:00",
          "ms = 10:32:00.555",
          "edge = 0001-01-01 00:00:00Z",
        ].join("\n"),
      ),
    ).toEqual({
      space: "1987-07-05 17:45:00Z",
      lower: "1987-07-05t17:45:00z",
      milli: "1977-12-21T10:32:00.555",
      wita: "1987-07-05T17:45:56.6+08:00",
      pdt: "1987-07-05T17:45:56-05:00",
      ms: "10:32:00.555",
      edge: "0001-01-01 00:00:00Z",
    });
  });

  test("date-times work inside arrays and inline tables", () => {
    expect(Bun.TOML.parse("a = [1979-05-27, 07:32:00, 1]")).toEqual({
      a: ["1979-05-27", "07:32:00", 1],
    });
    expect(Bun.TOML.parse("a = { d = 1979-05-27 }")).toEqual({ a: { d: "1979-05-27" } });
  });

  test("a date-time shaped bare key is a key, not a value", () => {
    // toml-test valid/key/like-date: `-` is a valid bare-key character.
    expect(Bun.TOML.parse("2024-05-27 = 1")).toEqual({ "2024-05-27": 1 });
    expect(Bun.TOML.parse("a.2001-02-08 = 7")).toEqual({ a: { "2001-02-08": 7 } });
    expect(Bun.TOML.parse("2001-02-11.a.2001-02-12 = 9")).toEqual({
      "2001-02-11": { a: { "2001-02-12": 9 } },
    });
    expect(Bun.TOML.parse("[2002-01-02.2024-01-03]\nk = 11")).toEqual({
      "2002-01-02": { "2024-01-03": { k: 11 } },
    });
  });

  test("a date quoted as a string stays a string", () => {
    // toml-test valid/datetime/invalid-date-in-string.
    expect(Bun.TOML.parse("s = '2020-01-01x'")).toEqual({ s: "2020-01-01x" });
    expect(Bun.TOML.parse('s = "1979-05-27"')).toEqual({ s: "1979-05-27" });
  });

  test("malformed date-times are still rejected", () => {
    // toml-test invalid/datetime/*: missing leading zeros, missing seconds,
    // missing `T`, trailing garbage, out-of-range components, y10k.
    for (const bad of [
      "a = 1987-7-05T17:45:00Z",
      "a = 1987-07-5T17:45:00.12Z",
      "a = 1987-07-05T17:45Z",
      "a = 1987-07-0517:45:00Z",
      "a = 1997-09-0909:09:09",
      "a = 2020-01-01x",
      "a = 2023-10-01T1:32:00Z",
      "a = 1997-09-09T09:09:09.",
      "a = 1997-09-09T09:09:09.09+09:9",
      "a = 1997-09-09T09:09:09.09+0909",
      "a = 1997-09-09T09:09:09.09+09",
      "a = 2006-13-01T00:00:00Z",
      "a = 2006-01-32T00:00:00Z",
      "a = 2006-01-00T00:00:00Z",
      "a = 2006-01-01T24:00:00Z",
      "a = 2006-01-01T00:60:00Z",
      "a = 2006-01-01T00:00:61Z",
      "a = 1985-06-18 17:04:07+25:00",
      "a = 10000-01-01",
      "a = 02026-05-07",
    ]) {
      expect(() => Bun.TOML.parse(bad)).toThrow();
    }
  });
});
