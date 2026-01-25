// Additional tests for features not covered by the official json5-tests suite.
// Expected values verified against json5@2.2.3 reference implementation.
import { JSON5 } from "bun";
import { describe, expect, test } from "bun:test";

describe("escape sequences", () => {
  test("\\v vertical tab", () => {
    const input: string = '"hello\\vworld"';
    const parsed = JSON5.parse(input);
    const expected: any = "hello\x0Bworld";
    expect(parsed).toEqual(expected);
  });

  test("\\0 null character", () => {
    const input: string = '"hello\\0world"';
    const parsed = JSON5.parse(input);
    const expected: any = "hello\x00world";
    expect(parsed).toEqual(expected);
  });

  test("\\0 followed by non-digit", () => {
    const input: string = '"\\0a"';
    const parsed = JSON5.parse(input);
    const expected: any = "\x00a";
    expect(parsed).toEqual(expected);
  });

  test("\\0 followed by digit throws", () => {
    expect(() => JSON5.parse('"\\01"')).toThrow("Octal escape sequences are not allowed in JSON5");
    expect(() => JSON5.parse('"\\09"')).toThrow("Octal escape sequences are not allowed in JSON5");
  });

  test("\\1 through \\9 throw", () => {
    for (let i = 1; i <= 9; i++) {
      expect(() => JSON5.parse(`"\\${i}"`)).toThrow("Octal escape sequences are not allowed in JSON5");
    }
  });

  test("\\xHH hex escape", () => {
    const input: string = '"\\x41\\x42\\x43"';
    const parsed = JSON5.parse(input);
    const expected: any = "ABC";
    expect(parsed).toEqual(expected);
  });

  test("\\xHH hex escape lowercase", () => {
    const input: string = '"\\x61"';
    const parsed = JSON5.parse(input);
    const expected: any = "a";
    expect(parsed).toEqual(expected);
  });

  test("\\xHH hex escape high byte", () => {
    const input: string = '"\\xff"';
    const parsed = JSON5.parse(input);
    const expected: any = "\xFF";
    expect(parsed).toEqual(expected);
  });

  test("\\xHH hex escape null", () => {
    const input: string = '"\\x00"';
    const parsed = JSON5.parse(input);
    const expected: any = "\x00";
    expect(parsed).toEqual(expected);
  });

  test("\\x with insufficient hex digits throws", () => {
    expect(() => JSON5.parse('"\\xG0"')).toThrow("Invalid hex escape");
    expect(() => JSON5.parse('"\\x0"')).toThrow("Invalid hex escape");
    expect(() => JSON5.parse('"\\x"')).toThrow("Invalid hex escape");
  });

  test("\\uHHHH unicode escape A", () => {
    const input: string = '"\\u0041"';
    const parsed = JSON5.parse(input);
    const expected: any = "A";
    expect(parsed).toEqual(expected);
  });

  test("\\uHHHH unicode escape e-acute", () => {
    const input: string = '"\\u00e9"';
    const parsed = JSON5.parse(input);
    const expected: any = "é";
    expect(parsed).toEqual(expected);
  });

  test("\\uHHHH unicode escape CJK", () => {
    const input: string = '"\\u4e16\\u754c"';
    const parsed = JSON5.parse(input);
    const expected: any = "世界";
    expect(parsed).toEqual(expected);
  });

  test("\\u with insufficient hex digits throws", () => {
    expect(() => JSON5.parse('"\\u041"')).toThrow("Invalid unicode escape: expected 4 hex digits");
    expect(() => JSON5.parse('"\\u41"')).toThrow("Invalid unicode escape: expected 4 hex digits");
    expect(() => JSON5.parse('"\\u"')).toThrow("Invalid unicode escape: expected 4 hex digits");
  });

  test("surrogate pairs", () => {
    const input: string = '"\\uD83C\\uDFBC"';
    const parsed = JSON5.parse(input);
    const expected: any = "🎼";
    expect(parsed).toEqual(expected);
  });

  test("identity escapes", () => {
    const input: string = '"\\A\\C\\/\\D\\C"';
    const parsed = JSON5.parse(input);
    const expected: any = "AC/DC";
    expect(parsed).toEqual(expected);
  });

  test("identity escape single char", () => {
    const input: string = '"\\q"';
    const parsed = JSON5.parse(input);
    const expected: any = "q";
    expect(parsed).toEqual(expected);
  });

  test("standard escape sequences", () => {
    expect(JSON5.parse('"\\b"')).toEqual("\b");
    expect(JSON5.parse('"\\f"')).toEqual("\f");
    expect(JSON5.parse('"\\n"')).toEqual("\n");
    expect(JSON5.parse('"\\r"')).toEqual("\r");
    expect(JSON5.parse('"\\t"')).toEqual("\t");
    expect(JSON5.parse('"\\\\"')).toEqual("\\");
    expect(JSON5.parse('"\\""')).toEqual('"');
  });

  test("single quote escapes", () => {
    const input: string = "'\\''";
    const parsed = JSON5.parse(input);
    const expected: any = "'";
    expect(parsed).toEqual(expected);
  });

  test("line continuation with LF", () => {
    const input: string = '"line1\\\nline2"';
    const parsed = JSON5.parse(input);
    const expected: any = "line1line2";
    expect(parsed).toEqual(expected);
  });

  test("line continuation with CRLF", () => {
    const input: string = '"line1\\\r\nline2"';
    const parsed = JSON5.parse(input);
    const expected: any = "line1line2";
    expect(parsed).toEqual(expected);
  });

  test("line continuation with CR only", () => {
    const input: string = '"line1\\\rline2"';
    const parsed = JSON5.parse(input);
    const expected: any = "line1line2";
    expect(parsed).toEqual(expected);
  });

  test("U+2028 allowed unescaped in strings", () => {
    const input: string = '"hello\u2028world"';
    const parsed = JSON5.parse(input);
    const expected: any = "hello\u2028world";
    expect(parsed).toEqual(expected);
  });

  test("U+2029 allowed unescaped in strings", () => {
    const input: string = '"hello\u2029world"';
    const parsed = JSON5.parse(input);
    const expected: any = "hello\u2029world";
    expect(parsed).toEqual(expected);
  });
});

describe("numbers - additional", () => {
  test("+NaN", () => {
    const input: string = "+NaN";
    const parsed = JSON5.parse(input);
    expect(Number.isNaN(parsed)).toBe(true);
  });

  test("-NaN", () => {
    const input: string = "-NaN";
    const parsed = JSON5.parse(input);
    expect(Number.isNaN(parsed)).toBe(true);
  });

  test("+Infinity", () => {
    const input: string = "+Infinity";
    const parsed = JSON5.parse(input);
    const expected: any = Infinity;
    expect(parsed).toEqual(expected);
  });

  test("hex uppercase letters", () => {
    const input: string = "0xDEADBEEF";
    const parsed = JSON5.parse(input);
    const expected: any = 0xdeadbeef;
    expect(parsed).toEqual(expected);
  });

  test("hex mixed case", () => {
    const input: string = "0xDeAdBeEf";
    const parsed = JSON5.parse(input);
    const expected: any = 0xdeadbeef;
    expect(parsed).toEqual(expected);
  });

  test("trailing decimal with exponent", () => {
    const input: string = "5.e2";
    const parsed = JSON5.parse(input);
    const expected: any = 500;
    expect(parsed).toEqual(expected);
  });

  test("leading decimal with exponent", () => {
    const input: string = ".5e2";
    const parsed = JSON5.parse(input);
    const expected: any = 50;
    expect(parsed).toEqual(expected);
  });

  test("negative zero", () => {
    expect(Object.is(JSON5.parse("-0"), -0)).toBe(true);
    expect(Object.is(JSON5.parse("-0.0"), -0)).toBe(true);
  });

  test("leading zeros throw", () => {
    expect(() => JSON5.parse("00")).toThrow("Leading zeros are not allowed in JSON5");
    expect(() => JSON5.parse("01")).toThrow("Leading zeros are not allowed in JSON5");
    expect(() => JSON5.parse("007")).toThrow("Leading zeros are not allowed in JSON5");
    expect(() => JSON5.parse("-00")).toThrow("Leading zeros are not allowed in JSON5");
    expect(() => JSON5.parse("+01")).toThrow("Leading zeros are not allowed in JSON5");
  });

  test("lone decimal point throws", () => {
    expect(() => JSON5.parse(".")).toThrow("Invalid number: lone decimal point");
    expect(() => JSON5.parse("+.")).toThrow("Invalid number: lone decimal point");
    expect(() => JSON5.parse("-.")).toThrow("Invalid number: lone decimal point");
  });

  test("hex with no digits throws", () => {
    expect(() => JSON5.parse("0x")).toThrow("Expected hex digits after '0x'");
    expect(() => JSON5.parse("0X")).toThrow("Expected hex digits after '0x'");
  });

  test("large hex number", () => {
    const input: string = "0xFFFFFFFF";
    const parsed = JSON5.parse(input);
    const expected: any = 4294967295;
    expect(parsed).toEqual(expected);
  });

  test("hex number exceeding i64 but fitting u64", () => {
    // 0x8000000000000000 = 2^63, overflows i64 but fits u64
    expect(JSON5.parse("0x8000000000000000")).toEqual(9223372036854775808);
    // 0xFFFFFFFFFFFFFFFF = u64 max
    expect(JSON5.parse("0xFFFFFFFFFFFFFFFF")).toEqual(18446744073709551615);
  });
});

describe("objects - additional", () => {
  test("all reserved word keys", () => {
    const input: string = "{null: 1, true: 2, false: 3, if: 4, for: 5, class: 6, return: 7}";
    const parsed = JSON5.parse(input);
    const expected: any = { null: 1, true: 2, false: 3, if: 4, for: 5, class: 6, return: 7 };
    expect(parsed).toEqual(expected);
  });

  test("nested objects with unquoted keys", () => {
    const input: string = "{a: {b: {c: 'deep'}}}";
    const parsed = JSON5.parse(input);
    const expected: any = { a: { b: { c: "deep" } } };
    expect(parsed).toEqual(expected);
  });

  test("mixed quoted and unquoted keys", () => {
    const input: string = `{unquoted: 1, "double": 2, 'single': 3}`;
    const parsed = JSON5.parse(input);
    const expected: any = { unquoted: 1, double: 2, single: 3 };
    expect(parsed).toEqual(expected);
  });

  test("key starting with $", () => {
    const input: string = "{$key: 'value'}";
    const parsed = JSON5.parse(input);
    const expected: any = { $key: "value" };
    expect(parsed).toEqual(expected);
  });

  test("key starting with _", () => {
    const input: string = "{_private: true}";
    const parsed = JSON5.parse(input);
    const expected: any = { _private: true };
    expect(parsed).toEqual(expected);
  });

  test("key with digits after first char", () => {
    const input: string = "{a1b2c3: 'mixed'}";
    const parsed = JSON5.parse(input);
    const expected: any = { a1b2c3: "mixed" };
    expect(parsed).toEqual(expected);
  });

  test("empty object", () => {
    expect(JSON5.parse("{}")).toEqual({});
  });

  test("empty object with whitespace", () => {
    expect(JSON5.parse("{ }")).toEqual({});
  });

  test("empty object with comment", () => {
    const input: string = "{ /* empty */ }";
    const parsed = JSON5.parse(input);
    const expected: any = {};
    expect(parsed).toEqual(expected);
  });

  test("keys cannot start with a digit (throws)", () => {
    expect(() => JSON5.parse("{1key: true}")).toThrow("Invalid identifier start character");
  });
});

describe("arrays - additional", () => {
  test("empty array", () => {
    expect(JSON5.parse("[]")).toEqual([]);
  });

  test("empty array with whitespace", () => {
    expect(JSON5.parse("[ ]")).toEqual([]);
  });

  test("empty array with comment", () => {
    expect(JSON5.parse("[ /* empty */ ]")).toEqual([]);
  });

  test("nested arrays", () => {
    const input: string = "[[1, 2], [3, 4], [[5]]]";
    const parsed = JSON5.parse(input);
    const expected: any = [[1, 2], [3, 4], [[5]]];
    expect(parsed).toEqual(expected);
  });

  test("mixed types in array", () => {
    const input: string = "[1, 'two', true, null, {a: 3}, [4]]";
    const parsed = JSON5.parse(input);
    const expected: any = [1, "two", true, null, { a: 3 }, [4]];
    expect(parsed).toEqual(expected);
  });

  test("array with comments between elements", () => {
    const input: string = "[1, /* comment */ 2, // another\n3]";
    const parsed = JSON5.parse(input);
    const expected: any = [1, 2, 3];
    expect(parsed).toEqual(expected);
  });

  test("double trailing comma throws", () => {
    expect(() => JSON5.parse("[1,,]")).toThrow("Unexpected character");
  });

  test("leading comma throws", () => {
    expect(() => JSON5.parse("[,1]")).toThrow("Unexpected character");
  });

  test("lone comma throws", () => {
    expect(() => JSON5.parse("[,]")).toThrow("Unexpected character");
  });
});

describe("whitespace - additional", () => {
  test("vertical tab as whitespace", () => {
    const input: string = "\x0B42\x0B";
    const parsed = JSON5.parse(input);
    const expected: any = 42;
    expect(parsed).toEqual(expected);
  });

  test("form feed as whitespace", () => {
    const input: string = "\x0C42\x0C";
    const parsed = JSON5.parse(input);
    const expected: any = 42;
    expect(parsed).toEqual(expected);
  });

  test("non-breaking space as whitespace", () => {
    const input: string = "\u00A042\u00A0";
    const parsed = JSON5.parse(input);
    const expected: any = 42;
    expect(parsed).toEqual(expected);
  });

  test("BOM as whitespace", () => {
    const input: string = "\uFEFF42";
    const parsed = JSON5.parse(input);
    const expected: any = 42;
    expect(parsed).toEqual(expected);
  });

  test("line separator as whitespace", () => {
    const input: string = "\u202842\u2028";
    const parsed = JSON5.parse(input);
    const expected: any = 42;
    expect(parsed).toEqual(expected);
  });

  test("paragraph separator as whitespace", () => {
    const input: string = "\u202942\u2029";
    const parsed = JSON5.parse(input);
    const expected: any = 42;
    expect(parsed).toEqual(expected);
  });
});

describe("comments - additional", () => {
  test("comment at end of file with no newline", () => {
    const input: string = "42 // comment";
    const parsed = JSON5.parse(input);
    const expected: any = 42;
    expect(parsed).toEqual(expected);
  });

  test("multiple comments", () => {
    const input: string = "/* a */ /* b */ 42 /* c */";
    const parsed = JSON5.parse(input);
    const expected: any = 42;
    expect(parsed).toEqual(expected);
  });

  test("nested block comment syntax is just content", () => {
    const input: string = "/* /* not nested */ 42";
    const parsed = JSON5.parse(input);
    const expected: any = 42;
    expect(parsed).toEqual(expected);
  });

  test("comment only (no value) throws", () => {
    expect(() => JSON5.parse("// comment")).toThrow("Unexpected end of input");
    expect(() => JSON5.parse("/* comment */")).toThrow("Unexpected end of input");
  });
});

describe("error messages", () => {
  test("throws SyntaxError instances", () => {
    try {
      JSON5.parse("invalid");
      expect.unreachable();
    } catch (e: any) {
      expect(e).toBeInstanceOf(SyntaxError);
      expect(e.message).toContain("Unexpected identifier");
    }
  });

  // -- Unexpected end of input --
  test("empty string", () => {
    expect(() => JSON5.parse("")).toThrow("Unexpected end of input");
  });

  test("whitespace only", () => {
    expect(() => JSON5.parse("   ")).toThrow("Unexpected end of input");
  });

  // -- Unexpected token after JSON5 value --
  test("multiple top-level values", () => {
    expect(() => JSON5.parse("1 2")).toThrow("Unexpected token after JSON5 value");
    expect(() => JSON5.parse("true false")).toThrow("Unexpected token after JSON5 value");
    expect(() => JSON5.parse("null null")).toThrow("Unexpected token after JSON5 value");
  });

  // -- Unexpected character --
  test("unexpected character at top level", () => {
    expect(() => JSON5.parse("@")).toThrow("Unexpected character");
    expect(() => JSON5.parse("undefined")).toThrow("Unexpected identifier");
    expect(() => JSON5.parse("{a: hello}")).toThrow("Unexpected identifier");
  });

  // -- Unterminated multi-line comment --
  test("unterminated multi-line comment", () => {
    expect(() => JSON5.parse("/* unterminated")).toThrow("Unterminated multi-line comment");
    expect(() => JSON5.parse("/* no end")).toThrow("Unterminated multi-line comment");
    expect(() => JSON5.parse("42 /* trailing")).toThrow("Unterminated multi-line comment");
  });

  // -- Unexpected end of input after sign --
  test("sign with no value", () => {
    expect(() => JSON5.parse("+")).toThrow("Unexpected end of input after sign");
    expect(() => JSON5.parse("-")).toThrow("Unexpected end of input after sign");
    expect(() => JSON5.parse("+ ")).toThrow("Unexpected end of input after sign");
  });

  // -- Unexpected character after sign --
  test("sign followed by invalid character", () => {
    expect(() => JSON5.parse("+@")).toThrow("Unexpected character");
    expect(() => JSON5.parse("-z")).toThrow("Unexpected character after sign");
    expect(() => JSON5.parse("+true")).toThrow("Unexpected character after sign");
  });

  // -- Unexpected identifier --
  test("incomplete true literal", () => {
    expect(() => JSON5.parse("tru")).toThrow("Unexpected identifier");
    expect(() => JSON5.parse("tr")).toThrow("Unexpected identifier");
  });

  test("true followed by identifier char", () => {
    expect(() => JSON5.parse("truex")).toThrow("Unexpected identifier");
    expect(() => JSON5.parse("truely")).toThrow("Unexpected identifier");
  });

  test("incomplete false literal", () => {
    expect(() => JSON5.parse("fals")).toThrow("Unexpected identifier");
    expect(() => JSON5.parse("fal")).toThrow("Unexpected identifier");
  });

  test("false followed by identifier char", () => {
    expect(() => JSON5.parse("falsex")).toThrow("Unexpected identifier");
    expect(() => JSON5.parse("falsely")).toThrow("Unexpected identifier");
  });

  test("incomplete null literal", () => {
    expect(() => JSON5.parse("nul")).toThrow("Unexpected identifier");
    expect(() => JSON5.parse("no")).toThrow("Unexpected identifier");
  });

  test("null followed by identifier char", () => {
    expect(() => JSON5.parse("nullify")).toThrow("Unexpected identifier");
    expect(() => JSON5.parse("nullx")).toThrow("Unexpected identifier");
  });

  test("NaN followed by identifier char", () => {
    expect(() => JSON5.parse("NaNx")).toThrow("Unexpected identifier");
    expect(() => JSON5.parse("NaNs")).toThrow("Unexpected identifier");
  });

  test("Infinity followed by identifier char", () => {
    expect(() => JSON5.parse("Infinityx")).toThrow("Unexpected identifier");
    expect(() => JSON5.parse("Infinitys")).toThrow("Unexpected identifier");
  });

  // -- Unexpected identifier (N/I not followed by keyword) --
  test("N not followed by NaN", () => {
    expect(() => JSON5.parse("N")).toThrow("Unexpected identifier");
    expect(() => JSON5.parse("Na")).toThrow("Unexpected identifier");
    expect(() => JSON5.parse("Nope")).toThrow("Unexpected identifier");
  });

  test("I not followed by Infinity", () => {
    expect(() => JSON5.parse("I")).toThrow("Unexpected identifier");
    expect(() => JSON5.parse("Inf")).toThrow("Unexpected identifier");
    expect(() => JSON5.parse("Iffy")).toThrow("Unexpected identifier");
  });

  // -- Expected ':' after object key --
  test("missing colon after object key", () => {
    expect(() => JSON5.parse("{a 1}")).toThrow("Expected ':' after object key");
    expect(() => JSON5.parse("{a}")).toThrow("Expected ':' after object key");
  });

  // -- Unterminated object --
  test("unterminated object", () => {
    expect(() => JSON5.parse("{a: 1")).toThrow("Unterminated object");
    expect(() => JSON5.parse('{"a": 1')).toThrow("Unterminated object");
  });

  // -- Expected ',' or '}' in object --
  test("missing comma in object", () => {
    expect(() => JSON5.parse("{a: 1 b: 2}")).toThrow("Expected ',' or '}' in object");
  });

  // -- Unexpected end of input in object key --
  test("object key at EOF", () => {
    expect(() => JSON5.parse("{")).toThrow("Unexpected end of input in object key");
    expect(() => JSON5.parse("{a: 1,")).toThrow("Unexpected end of input in object key");
  });

  // -- Invalid identifier start character --
  test("invalid identifier start character in key", () => {
    expect(() => JSON5.parse("{: 1}")).toThrow("Invalid identifier start character");
    expect(() => JSON5.parse("{@key: 1}")).toThrow("Unexpected character");
  });

  // -- Expected 'u' after '\\' in identifier --
  test("non-u escape in identifier key", () => {
    expect(() => JSON5.parse("{\\x0041: 1}")).toThrow("Expected 'u' after '\\' in identifier");
  });

  // -- Unterminated array --
  test("unterminated array", () => {
    expect(() => JSON5.parse("[1, 2")).toThrow("Unterminated array");
    expect(() => JSON5.parse("[")).toThrow("Unexpected end of input");
    expect(() => JSON5.parse("[1")).toThrow("Unterminated array");
  });

  // -- Expected ',' or ']' in array --
  test("missing comma in array", () => {
    expect(() => JSON5.parse("[1 2]")).toThrow("Expected ',' or ']' in array");
  });

  // -- Unterminated string --
  test("unterminated string", () => {
    expect(() => JSON5.parse('"hello')).toThrow("Unterminated string");
    expect(() => JSON5.parse("'hello")).toThrow("Unterminated string");
    expect(() => JSON5.parse("\"hello'")).toThrow("Unterminated string");
    expect(() => JSON5.parse("'hello\"")).toThrow("Unterminated string");
  });

  test("newline in string", () => {
    expect(() => JSON5.parse('"line\nbreak"')).toThrow("Unterminated string");
    expect(() => JSON5.parse('"line\rbreak"')).toThrow("Unterminated string");
  });

  // -- Unexpected end of input in escape sequence --
  test("escape sequence at end of input", () => {
    expect(() => JSON5.parse('"\\')).toThrow("Unexpected end of input in escape sequence");
    expect(() => JSON5.parse("'\\")).toThrow("Unexpected end of input in escape sequence");
  });

  // -- Octal escape sequences are not allowed in JSON5 --
  test("octal escape sequences", () => {
    expect(() => JSON5.parse('"\\01"')).toThrow("Octal escape sequences are not allowed in JSON5");
    expect(() => JSON5.parse('"\\1"')).toThrow("Octal escape sequences are not allowed in JSON5");
    expect(() => JSON5.parse('"\\9"')).toThrow("Octal escape sequences are not allowed in JSON5");
  });

  // -- Invalid hex escape --
  test("invalid hex escape", () => {
    expect(() => JSON5.parse('"\\xGG"')).toThrow("Invalid hex escape");
    expect(() => JSON5.parse('"\\x0"')).toThrow("Invalid hex escape");
    expect(() => JSON5.parse('"\\x"')).toThrow("Invalid hex escape");
  });

  // -- Invalid unicode escape: expected 4 hex digits --
  test("invalid unicode escape", () => {
    expect(() => JSON5.parse('"\\u"')).toThrow("Invalid unicode escape: expected 4 hex digits");
    expect(() => JSON5.parse('"\\u041"')).toThrow("Invalid unicode escape: expected 4 hex digits");
    expect(() => JSON5.parse('"\\uXXXX"')).toThrow("Invalid unicode escape: expected 4 hex digits");
  });

  // -- Leading zeros are not allowed in JSON5 --
  test("leading zeros", () => {
    expect(() => JSON5.parse("00")).toThrow("Leading zeros are not allowed in JSON5");
    expect(() => JSON5.parse("01")).toThrow("Leading zeros are not allowed in JSON5");
  });

  // -- Invalid number: lone decimal point --
  test("lone decimal point", () => {
    expect(() => JSON5.parse(".")).toThrow("Invalid number: lone decimal point");
  });

  // -- Invalid exponent in number --
  test("invalid exponent", () => {
    expect(() => JSON5.parse("1e")).toThrow("Invalid exponent in number");
    expect(() => JSON5.parse("1e+")).toThrow("Invalid exponent in number");
    expect(() => JSON5.parse("1E-")).toThrow("Invalid exponent in number");
    expect(() => JSON5.parse("1ex")).toThrow("Invalid exponent in number");
  });

  // -- Expected hex digits after '0x' --
  test("hex with no digits", () => {
    expect(() => JSON5.parse("0x")).toThrow("Expected hex digits after '0x'");
    expect(() => JSON5.parse("0X")).toThrow("Expected hex digits after '0x'");
    expect(() => JSON5.parse("0xGG")).toThrow("Expected hex digits after '0x'");
  });

  // -- Hex number too large --
  test("hex number too large", () => {
    expect(() => JSON5.parse("0xFFFFFFFFFFFFFFFFFF")).toThrow("Hex number too large");
  });
});

describe("stringify", () => {
  test("stringifies null", () => {
    expect(JSON5.stringify(null)).toEqual("null");
  });

  test("stringifies booleans", () => {
    expect(JSON5.stringify(true)).toEqual("true");
    expect(JSON5.stringify(false)).toEqual("false");
  });

  test("stringifies numbers", () => {
    expect(JSON5.stringify(42)).toEqual("42");
    expect(JSON5.stringify(3.14)).toEqual("3.14");
    expect(JSON5.stringify(-1)).toEqual("-1");
    expect(JSON5.stringify(0)).toEqual("0");
  });

  test("stringifies Infinity", () => {
    expect(JSON5.stringify(Infinity)).toEqual("Infinity");
    expect(JSON5.stringify(-Infinity)).toEqual("-Infinity");
  });

  test("stringifies NaN", () => {
    expect(JSON5.stringify(NaN)).toEqual("NaN");
  });

  test("stringifies strings with double quotes", () => {
    expect(JSON5.stringify("hello")).toEqual('"hello"');
  });

  test("escapes double quotes in strings", () => {
    expect(JSON5.stringify('he said "hi"')).toEqual('"he said \\"hi\\""');
  });

  test("escapes control characters in strings", () => {
    expect(JSON5.stringify("line\nnew")).toEqual('"line\\nnew"');
    expect(JSON5.stringify("tab\there")).toEqual('"tab\\there"');
    expect(JSON5.stringify("back\\slash")).toEqual('"back\\\\slash"');
  });

  test("stringifies objects with unquoted keys", () => {
    expect(JSON5.stringify({ a: 1, b: "two" })).toEqual('{a:1,b:"two"}');
  });

  test("quotes keys that are not valid identifiers", () => {
    expect(JSON5.stringify({ "foo bar": 1 })).toEqual('{"foo bar":1}');
    expect(JSON5.stringify({ "0key": 1 })).toEqual('{"0key":1}');
    expect(JSON5.stringify({ "key-name": 1 })).toEqual('{"key-name":1}');
    expect(JSON5.stringify({ "": 1 })).toEqual('{"":1}');
  });

  test("stringifies arrays", () => {
    expect(JSON5.stringify([1, "two", true])).toEqual('[1,"two",true]');
  });

  test("stringifies nested structures", () => {
    expect(JSON5.stringify({ a: [1, { b: 2 }] })).toEqual("{a:[1,{b:2}]}");
  });

  test("stringifies Infinity and NaN in objects and arrays", () => {
    expect(JSON5.stringify({ x: Infinity, y: NaN })).toEqual("{x:Infinity,y:NaN}");
    expect(JSON5.stringify([Infinity, -Infinity, NaN])).toEqual("[Infinity,-Infinity,NaN]");
  });

  test("replacer function throws", () => {
    expect(() => JSON5.stringify({ a: 1 }, (key: string, value: any) => value)).toThrow(
      "JSON5.stringify does not support the replacer argument",
    );
  });

  test("replacer array throws", () => {
    expect(() => JSON5.stringify({ a: 1, b: 2 }, ["a"])).toThrow(
      "JSON5.stringify does not support the replacer argument",
    );
  });

  test("space parameter with number", () => {
    expect(JSON5.stringify({ a: 1 }, null, 2)).toEqual("{\n  a: 1,\n}");
  });

  test("space parameter with string", () => {
    expect(JSON5.stringify({ a: 1 }, null, "\t")).toEqual("{\n\ta: 1,\n}");
  });

  test("space parameter with multiple properties", () => {
    expect(JSON5.stringify({ a: 1, b: 2 }, null, 2)).toEqual("{\n  a: 1,\n  b: 2,\n}");
  });

  test("space parameter with array", () => {
    expect(JSON5.stringify([1, 2, 3], null, 2)).toEqual("[\n  1,\n  2,\n  3,\n]");
  });

  test("undefined returns undefined", () => {
    expect(JSON5.stringify(undefined)).toBeUndefined();
  });

  test("functions return undefined", () => {
    expect(JSON5.stringify(() => {})).toBeUndefined();
  });

  test("circular reference throws", () => {
    const obj: any = {};
    obj.self = obj;
    expect(() => JSON5.stringify(obj)).toThrow();
  });
});

describe("comments in all structural positions", () => {
  test("comment between object key and colon", () => {
    expect(JSON5.parse("{a /* c */ : 1}")).toEqual({ a: 1 });
    expect(JSON5.parse("{a // c\n: 1}")).toEqual({ a: 1 });
  });

  test("comment between colon and value", () => {
    expect(JSON5.parse("{a: /* c */ 1}")).toEqual({ a: 1 });
    expect(JSON5.parse("{a: // c\n1}")).toEqual({ a: 1 });
  });

  test("comment between comma and next key", () => {
    expect(JSON5.parse("{a: 1, /* c */ b: 2}")).toEqual({ a: 1, b: 2 });
    expect(JSON5.parse("{a: 1, // c\nb: 2}")).toEqual({ a: 1, b: 2 });
  });

  test("comment after opening brace", () => {
    expect(JSON5.parse("{ /* c */ a: 1}")).toEqual({ a: 1 });
    expect(JSON5.parse("{ // c\na: 1}")).toEqual({ a: 1 });
  });

  test("comment before closing brace", () => {
    expect(JSON5.parse("{a: 1 /* c */ }")).toEqual({ a: 1 });
    expect(JSON5.parse("{a: 1 // c\n}")).toEqual({ a: 1 });
  });

  test("comment after trailing comma in object", () => {
    expect(JSON5.parse("{a: 1, /* c */ }")).toEqual({ a: 1 });
    expect(JSON5.parse("{a: 1, // c\n}")).toEqual({ a: 1 });
  });

  test("comment between array elements", () => {
    expect(JSON5.parse("[1, /* c */ 2]")).toEqual([1, 2]);
    expect(JSON5.parse("[1, // c\n2]")).toEqual([1, 2]);
  });

  test("comment after opening bracket", () => {
    expect(JSON5.parse("[ /* c */ 1]")).toEqual([1]);
    expect(JSON5.parse("[ // c\n1]")).toEqual([1]);
  });

  test("comment before closing bracket", () => {
    expect(JSON5.parse("[1 /* c */ ]")).toEqual([1]);
    expect(JSON5.parse("[1 // c\n]")).toEqual([1]);
  });

  test("comment after trailing comma in array", () => {
    expect(JSON5.parse("[1, /* c */ ]")).toEqual([1]);
    expect(JSON5.parse("[1, // c\n]")).toEqual([1]);
  });

  test("comment between sign and number", () => {
    expect(JSON5.parse("+ /* c */ 1")).toEqual(1);
    expect(JSON5.parse("- /* c */ 1")).toEqual(-1);
    expect(JSON5.parse("+ // c\n1")).toEqual(1);
  });

  test("comment between sign and Infinity", () => {
    expect(JSON5.parse("+ /* c */ Infinity")).toEqual(Infinity);
    expect(JSON5.parse("- /* c */ Infinity")).toEqual(-Infinity);
  });

  test("comment between sign and NaN", () => {
    expect(Number.isNaN(JSON5.parse("+ /* c */ NaN"))).toBe(true);
    expect(Number.isNaN(JSON5.parse("- /* c */ NaN"))).toBe(true);
  });

  test("block comment with asterisks inside", () => {
    expect(JSON5.parse("/*** comment ***/ 42")).toEqual(42);
  });

  test("block comment with slashes inside", () => {
    expect(JSON5.parse("/* // not line comment */ 42")).toEqual(42);
  });

  test("single-line comment terminated by U+2028", () => {
    expect(JSON5.parse("// comment\u202842")).toEqual(42);
  });

  test("single-line comment terminated by U+2029", () => {
    expect(JSON5.parse("// comment\u202942")).toEqual(42);
  });
});

describe("whitespace in all structural positions", () => {
  test("whitespace between sign and value", () => {
    expect(JSON5.parse("+  1")).toEqual(1);
    expect(JSON5.parse("-  1")).toEqual(-1);
    expect(JSON5.parse("+ \t 1")).toEqual(1);
    expect(JSON5.parse("- \n 1")).toEqual(-1);
  });

  test("unicode whitespace between sign and value", () => {
    expect(JSON5.parse("+\u00A01")).toEqual(1);
    expect(JSON5.parse("-\u00A01")).toEqual(-1);
    expect(JSON5.parse("+\u20001")).toEqual(1);
  });

  test("all unicode whitespace types as separators", () => {
    // U+1680 OGHAM SPACE MARK
    expect(JSON5.parse("\u168042")).toEqual(42);
    // U+2000 EN QUAD
    expect(JSON5.parse("\u200042")).toEqual(42);
    // U+2001 EM QUAD
    expect(JSON5.parse("\u200142")).toEqual(42);
    // U+2002 EN SPACE
    expect(JSON5.parse("\u200242")).toEqual(42);
    // U+2003 EM SPACE
    expect(JSON5.parse("\u200342")).toEqual(42);
    // U+2004 THREE-PER-EM SPACE
    expect(JSON5.parse("\u200442")).toEqual(42);
    // U+2005 FOUR-PER-EM SPACE
    expect(JSON5.parse("\u200542")).toEqual(42);
    // U+2006 SIX-PER-EM SPACE
    expect(JSON5.parse("\u200642")).toEqual(42);
    // U+2007 FIGURE SPACE
    expect(JSON5.parse("\u200742")).toEqual(42);
    // U+2008 PUNCTUATION SPACE
    expect(JSON5.parse("\u200842")).toEqual(42);
    // U+2009 THIN SPACE
    expect(JSON5.parse("\u200942")).toEqual(42);
    // U+200A HAIR SPACE
    expect(JSON5.parse("\u200A42")).toEqual(42);
    // U+202F NARROW NO-BREAK SPACE
    expect(JSON5.parse("\u202F42")).toEqual(42);
    // U+205F MEDIUM MATHEMATICAL SPACE
    expect(JSON5.parse("\u205F42")).toEqual(42);
    // U+3000 IDEOGRAPHIC SPACE
    expect(JSON5.parse("\u300042")).toEqual(42);
  });

  test("mixed whitespace and comments", () => {
    expect(JSON5.parse(" \t\n /* comment */ \r\n // line comment\n 42 \t ")).toEqual(42);
  });
});

describe("unicode identifier keys", () => {
  test("unicode letter keys", () => {
    expect(JSON5.parse("{café: 1}")).toEqual({ café: 1 });
    expect(JSON5.parse("{naïve: 2}")).toEqual({ naïve: 2 });
    expect(JSON5.parse("{über: 3}")).toEqual({ über: 3 });
  });

  test("CJK identifier keys", () => {
    expect(JSON5.parse("{日本語: 1}")).toEqual({ 日本語: 1 });
    expect(JSON5.parse("{中文: 2}")).toEqual({ 中文: 2 });
  });

  test("unicode escape in identifier key", () => {
    expect(JSON5.parse("{\\u0061: 1}")).toEqual({ a: 1 });
    expect(JSON5.parse("{\\u0041bc: 1}")).toEqual({ Abc: 1 });
  });

  test("unicode escape for non-ASCII start char", () => {
    // \u00E9 is é
    expect(JSON5.parse("{\\u00E9: 1}")).toEqual({ é: 1 });
  });

  test("mixed unicode escape and literal", () => {
    expect(JSON5.parse("{\\u0061bc: 1}")).toEqual({ abc: 1 });
  });
});

describe("reserved words as keys", () => {
  test("ES5 future reserved words as unquoted keys", () => {
    expect(JSON5.parse("{class: 1}")).toEqual({ class: 1 });
    expect(JSON5.parse("{enum: 2}")).toEqual({ enum: 2 });
    expect(JSON5.parse("{extends: 3}")).toEqual({ extends: 3 });
    expect(JSON5.parse("{super: 4}")).toEqual({ super: 4 });
    expect(JSON5.parse("{const: 5}")).toEqual({ const: 5 });
    expect(JSON5.parse("{export: 6}")).toEqual({ export: 6 });
    expect(JSON5.parse("{import: 7}")).toEqual({ import: 7 });
  });

  test("strict mode reserved words as unquoted keys", () => {
    expect(JSON5.parse("{implements: 1}")).toEqual({ implements: 1 });
    expect(JSON5.parse("{interface: 2}")).toEqual({ interface: 2 });
    expect(JSON5.parse("{let: 3}")).toEqual({ let: 3 });
    expect(JSON5.parse("{package: 4}")).toEqual({ package: 4 });
    expect(JSON5.parse("{private: 5}")).toEqual({ private: 5 });
    expect(JSON5.parse("{protected: 6}")).toEqual({ protected: 6 });
    expect(JSON5.parse("{public: 7}")).toEqual({ public: 7 });
    expect(JSON5.parse("{static: 8}")).toEqual({ static: 8 });
    expect(JSON5.parse("{yield: 9}")).toEqual({ yield: 9 });
  });

  test("NaN and Infinity as keys", () => {
    expect(JSON5.parse("{NaN: 1}")).toEqual({ NaN: 1 });
    expect(JSON5.parse("{Infinity: 2}")).toEqual({ Infinity: 2 });
  });

  test("keyword-like identifiers as values should error", () => {
    expect(() => JSON5.parse("{a: undefined}")).toThrow("Unexpected identifier");
    expect(() => JSON5.parse("{a: class}")).toThrow("Unexpected identifier");
    expect(() => JSON5.parse("{a: var}")).toThrow("Unexpected identifier");
  });
});

describe("number edge cases", () => {
  test("double sign throws", () => {
    expect(() => JSON5.parse("++1")).toThrow("Unexpected character");
    expect(() => JSON5.parse("--1")).toThrow("Unexpected character after sign");
    expect(() => JSON5.parse("+-1")).toThrow("Unexpected character after sign");
  });

  test("negative hex zero", () => {
    expect(Object.is(JSON5.parse("-0x0"), -0)).toBe(true);
  });

  test("positive hex", () => {
    expect(JSON5.parse("+0xFF")).toEqual(255);
  });

  test("hex zero", () => {
    expect(JSON5.parse("0x0")).toEqual(0);
    expect(JSON5.parse("0x00")).toEqual(0);
  });

  test("exponent with explicit positive sign", () => {
    expect(JSON5.parse("1e+2")).toEqual(100);
    expect(JSON5.parse("1E+2")).toEqual(100);
  });

  test("exponent with negative sign", () => {
    expect(JSON5.parse("1e-2")).toEqual(0.01);
    expect(JSON5.parse("1E-2")).toEqual(0.01);
  });

  test("zero with exponent", () => {
    expect(JSON5.parse("0e0")).toEqual(0);
    expect(JSON5.parse("0e1")).toEqual(0);
  });

  test("very large number", () => {
    expect(JSON5.parse("1e308")).toEqual(1e308);
  });

  test("number overflows to Infinity", () => {
    expect(JSON5.parse("1e309")).toEqual(Infinity);
  });

  test("very small number", () => {
    expect(JSON5.parse("5e-324")).toEqual(5e-324);
  });

  test("positive zero variations", () => {
    expect(Object.is(JSON5.parse("0"), 0)).toBe(true);
    expect(Object.is(JSON5.parse("0.0"), 0)).toBe(true);
    expect(Object.is(JSON5.parse("+0"), 0)).toBe(true);
  });

  test("fractional only number", () => {
    expect(JSON5.parse(".123")).toEqual(0.123);
    expect(JSON5.parse("+.5")).toEqual(0.5);
    expect(JSON5.parse("-.5")).toEqual(-0.5);
  });

  test("trailing decimal", () => {
    expect(JSON5.parse("5.")).toEqual(5);
    expect(JSON5.parse("+5.")).toEqual(5);
    expect(JSON5.parse("-5.")).toEqual(-5);
  });
});

describe("surrogate pair edge cases", () => {
  test("valid surrogate pair", () => {
    // U+1F600 = D83D DE00 (😀)
    // U+1F601 = D83D DE01 (😁)
    expect(JSON5.parse('"\\uD83D\\uDE00\\uD83D\\uDE01"')).toEqual("😀😁");
  });

  test("surrogate pair for musical symbol", () => {
    // U+1D11E MUSICAL SYMBOL G CLEF = D834 DD1E
    expect(JSON5.parse('"\\uD834\\uDD1E"')).toEqual("𝄞");
  });
});

describe("string edge cases", () => {
  test("empty string", () => {
    expect(JSON5.parse('""')).toEqual("");
    expect(JSON5.parse("''")).toEqual("");
  });

  test("string with only whitespace", () => {
    expect(JSON5.parse('" "')).toEqual(" ");
    expect(JSON5.parse('"\\t"')).toEqual("\t");
  });

  test("single-quoted string with double quotes", () => {
    expect(JSON5.parse("'hello \"world\"'")).toEqual('hello "world"');
  });

  test("double-quoted string with single quotes", () => {
    expect(JSON5.parse("\"hello 'world'\"")).toEqual("hello 'world'");
  });

  test("string with all escape types", () => {
    const input = '"\\b\\f\\n\\r\\t\\v\\0\\\\\\/\\\'\\""';
    const expected = "\b\f\n\r\t\v\0\\/'\"";
    expect(JSON5.parse(input)).toEqual(expected);
  });

  test("line continuation with U+2028", () => {
    const input = '"line1\\\u2028line2"';
    expect(JSON5.parse(input)).toEqual("line1line2");
  });

  test("line continuation with U+2029", () => {
    const input = '"line1\\\u2029line2"';
    expect(JSON5.parse(input)).toEqual("line1line2");
  });

  test("multiple line continuations", () => {
    expect(JSON5.parse('"a\\\nb\\\nc"')).toEqual("abc");
  });
});

describe("deeply nested structures", () => {
  test("deeply nested arrays", () => {
    const depth = 100;
    const input = "[".repeat(depth) + "1" + "]".repeat(depth);
    let expected: any = 1;
    for (let i = 0; i < depth; i++) expected = [expected];
    expect(JSON5.parse(input)).toEqual(expected);
  });

  test("deeply nested objects", () => {
    const depth = 100;
    let input = "";
    for (let i = 0; i < depth; i++) input += `{a${i}: `;
    input += "1";
    for (let i = 0; i < depth; i++) input += "}";
    const result = JSON5.parse(input);
    // Navigate to innermost value
    let current: any = result;
    for (let i = 0; i < depth; i++) current = current[`a${i}`];
    expect(current).toEqual(1);
  });

  test("mixed nesting", () => {
    expect(JSON5.parse("{a: [{b: [{c: 1}]}]}")).toEqual({ a: [{ b: [{ c: 1 }] }] });
  });
});

describe("empty inputs", () => {
  test("empty string throws", () => {
    expect(() => JSON5.parse("")).toThrow("Unexpected end of input");
  });

  test("only whitespace throws", () => {
    expect(() => JSON5.parse("   ")).toThrow("Unexpected end of input");
    expect(() => JSON5.parse("\t\n\r")).toThrow("Unexpected end of input");
  });

  test("only comments throws", () => {
    expect(() => JSON5.parse("// comment")).toThrow("Unexpected end of input");
    expect(() => JSON5.parse("/* comment */")).toThrow("Unexpected end of input");
    expect(() => JSON5.parse("/* a */ // b")).toThrow("Unexpected end of input");
  });

  test("only unicode whitespace throws", () => {
    expect(() => JSON5.parse("\u00A0")).toThrow("Unexpected end of input");
    expect(() => JSON5.parse("\uFEFF")).toThrow("Unexpected end of input");
    expect(() => JSON5.parse("\u2000\u2001\u2002")).toThrow("Unexpected end of input");
  });
});

describe("garbage input", () => {
  test("single punctuation characters", () => {
    expect(() => JSON5.parse("@")).toThrow("Unexpected character");
    expect(() => JSON5.parse("#")).toThrow("Unexpected character");
    expect(() => JSON5.parse("!")).toThrow("Unexpected character");
    expect(() => JSON5.parse("~")).toThrow("Unexpected character");
    expect(() => JSON5.parse("`")).toThrow("Unexpected character");
    expect(() => JSON5.parse("^")).toThrow("Unexpected character");
    expect(() => JSON5.parse("&")).toThrow("Unexpected character");
    expect(() => JSON5.parse("|")).toThrow("Unexpected character");
    expect(() => JSON5.parse("=")).toThrow("Unexpected character");
    expect(() => JSON5.parse("<")).toThrow("Unexpected character");
    expect(() => JSON5.parse(">")).toThrow("Unexpected character");
    expect(() => JSON5.parse("?")).toThrow("Unexpected character");
    expect(() => JSON5.parse(";")).toThrow("Unexpected character");
  });

  test("bare slash is not a comment", () => {
    expect(() => JSON5.parse("/")).toThrow("Unexpected character");
    expect(() => JSON5.parse("/ /")).toThrow("Unexpected character");
  });

  test("random words throw", () => {
    expect(() => JSON5.parse("undefined")).toThrow("Unexpected identifier");
    expect(() => JSON5.parse("foo")).toThrow("Unexpected identifier");
    expect(() => JSON5.parse("var")).toThrow("Unexpected identifier");
    expect(() => JSON5.parse("function")).toThrow("Unexpected identifier");
    expect(() => JSON5.parse("return")).toThrow("Unexpected identifier");
  });

  test("javascript expressions throw", () => {
    expect(() => JSON5.parse("1 + 2")).toThrow();
    expect(() => JSON5.parse("a = 1")).toThrow();
    expect(() => JSON5.parse("(1)")).toThrow();
    expect(() => JSON5.parse("{}{}")).toThrow();
    expect(() => JSON5.parse("[][]")).toThrow();
  });

  test("incomplete structures", () => {
    expect(() => JSON5.parse("{")).toThrow();
    expect(() => JSON5.parse("[")).toThrow();
    expect(() => JSON5.parse("{a:")).toThrow();
    expect(() => JSON5.parse("{a: 1,")).toThrow();
    expect(() => JSON5.parse("[1,")).toThrow();
    expect(() => JSON5.parse("'unterminated")).toThrow();
    expect(() => JSON5.parse('"unterminated')).toThrow();
  });

  test("binary data throws", () => {
    expect(() => JSON5.parse("\x01\x02\x03")).toThrow();
    expect(() => JSON5.parse("\x00")).toThrow();
    expect(() => JSON5.parse("\x7F")).toThrow();
  });
});

describe("input types", () => {
  test("accepts Buffer input", () => {
    const input: any = Buffer.from('{"a": 1}');
    const parsed = JSON5.parse(input);
    const expected: any = { a: 1 };
    expect(parsed).toEqual(expected);
  });

  test("accepts ArrayBuffer input", () => {
    const input: any = new TextEncoder().encode('{"a": 1}').buffer;
    const parsed = JSON5.parse(input);
    const expected: any = { a: 1 };
    expect(parsed).toEqual(expected);
  });

  test("accepts Uint8Array input", () => {
    const input: any = new TextEncoder().encode("[1, 2, 3]");
    const parsed = JSON5.parse(input);
    const expected: any = [1, 2, 3];
    expect(parsed).toEqual(expected);
  });

  test("throws on no arguments", () => {
    expect(() => (JSON5.parse as any)()).toThrow();
  });

  test("throws on undefined argument", () => {
    expect(() => JSON5.parse(undefined as any)).toThrow();
  });

  test("throws on null argument", () => {
    expect(() => JSON5.parse(null as any)).toThrow();
  });
});
