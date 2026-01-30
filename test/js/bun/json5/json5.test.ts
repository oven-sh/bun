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
    expect(() => JSON5.parse(".")).toThrow("Invalid number");
    expect(() => JSON5.parse("+.")).toThrow("Invalid number");
    expect(() => JSON5.parse("-.")).toThrow("Invalid number");
  });

  test("hex with no digits throws", () => {
    expect(() => JSON5.parse("0x")).toThrow("Invalid hex number");
    expect(() => JSON5.parse("0X")).toThrow("Invalid hex number");
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
    expect(() => JSON5.parse("[1,,]")).toThrow("Unexpected token");
  });

  test("leading comma throws", () => {
    expect(() => JSON5.parse("[,1]")).toThrow("Unexpected token");
  });

  test("lone comma throws", () => {
    expect(() => JSON5.parse("[,]")).toThrow("Unexpected token");
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
      expect(e.message).toContain("Unexpected token");
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
    expect(() => JSON5.parse("undefined")).toThrow("Unexpected token");
    expect(() => JSON5.parse("{a: hello}")).toThrow("Unexpected token");
  });

  // -- Unterminated multi-line comment --
  test("unterminated multi-line comment", () => {
    expect(() => JSON5.parse("/* unterminated")).toThrow("Unterminated multi-line comment");
    expect(() => JSON5.parse("/* no end")).toThrow("Unterminated multi-line comment");
    expect(() => JSON5.parse("42 /* trailing")).toThrow("Unterminated multi-line comment");
  });

  // -- Unexpected end of input after sign --
  test("sign with no value", () => {
    expect(() => JSON5.parse("+")).toThrow("Unexpected end of input");
    expect(() => JSON5.parse("-")).toThrow("Unexpected end of input");
    expect(() => JSON5.parse("+ ")).toThrow("Unexpected character");
  });

  // -- Unexpected character after sign --
  test("sign followed by invalid character", () => {
    expect(() => JSON5.parse("+@")).toThrow("Unexpected character");
    expect(() => JSON5.parse("-z")).toThrow("Unexpected character");
    expect(() => JSON5.parse("+true")).toThrow("Unexpected character");
  });

  // -- Unexpected identifier --
  test("incomplete true literal", () => {
    expect(() => JSON5.parse("tru")).toThrow("Unexpected token");
    expect(() => JSON5.parse("tr")).toThrow("Unexpected token");
  });

  test("true followed by identifier char", () => {
    expect(() => JSON5.parse("truex")).toThrow("Unexpected token");
    expect(() => JSON5.parse("truely")).toThrow("Unexpected token");
  });

  test("incomplete false literal", () => {
    expect(() => JSON5.parse("fals")).toThrow("Unexpected token");
    expect(() => JSON5.parse("fal")).toThrow("Unexpected token");
  });

  test("false followed by identifier char", () => {
    expect(() => JSON5.parse("falsex")).toThrow("Unexpected token");
    expect(() => JSON5.parse("falsely")).toThrow("Unexpected token");
  });

  test("incomplete null literal", () => {
    expect(() => JSON5.parse("nul")).toThrow("Unexpected token");
    expect(() => JSON5.parse("no")).toThrow("Unexpected token");
  });

  test("null followed by identifier char", () => {
    expect(() => JSON5.parse("nullify")).toThrow("Unexpected token");
    expect(() => JSON5.parse("nullx")).toThrow("Unexpected token");
  });

  test("NaN followed by identifier char", () => {
    expect(() => JSON5.parse("NaNx")).toThrow("Unexpected token");
    expect(() => JSON5.parse("NaNs")).toThrow("Unexpected token");
  });

  test("Infinity followed by identifier char", () => {
    expect(() => JSON5.parse("Infinityx")).toThrow("Unexpected token");
    expect(() => JSON5.parse("Infinitys")).toThrow("Unexpected token");
  });

  // -- Unexpected identifier (N/I not followed by keyword) --
  test("N not followed by NaN", () => {
    expect(() => JSON5.parse("N")).toThrow("Unexpected token");
    expect(() => JSON5.parse("Na")).toThrow("Unexpected token");
    expect(() => JSON5.parse("Nope")).toThrow("Unexpected token");
  });

  test("I not followed by Infinity", () => {
    expect(() => JSON5.parse("I")).toThrow("Unexpected token");
    expect(() => JSON5.parse("Inf")).toThrow("Unexpected token");
    expect(() => JSON5.parse("Iffy")).toThrow("Unexpected token");
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

  // -- Expected ',' --
  test("missing comma in object", () => {
    expect(() => JSON5.parse("{a: 1 b: 2}")).toThrow("Expected ','");
  });

  // -- Unexpected end of input in object key --
  test("object key at EOF", () => {
    expect(() => JSON5.parse("{")).toThrow("Unexpected end of input");
    expect(() => JSON5.parse("{a: 1,")).toThrow("Unexpected end of input");
  });

  // -- Invalid identifier start character --
  test("invalid identifier start character in key", () => {
    expect(() => JSON5.parse("{: 1}")).toThrow("Invalid identifier start character");
    expect(() => JSON5.parse("{@key: 1}")).toThrow("Unexpected character");
  });

  // -- Expected 'u' after '\\' in identifier --
  test("non-u escape in identifier key", () => {
    expect(() => JSON5.parse("{\\x0041: 1}")).toThrow("Invalid unicode escape");
  });

  // -- Unterminated array --
  test("unterminated array", () => {
    expect(() => JSON5.parse("[1, 2")).toThrow("Unterminated array");
    expect(() => JSON5.parse("[")).toThrow("Unexpected end of input");
    expect(() => JSON5.parse("[1")).toThrow("Unterminated array");
  });

  // -- Expected ',' --
  test("missing comma in array", () => {
    expect(() => JSON5.parse("[1 2]")).toThrow("Expected ','");
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
    expect(() => JSON5.parse(".")).toThrow("Invalid number");
  });

  // -- Invalid exponent in number --
  test("invalid exponent", () => {
    expect(() => JSON5.parse("1e")).toThrow("Invalid number");
    expect(() => JSON5.parse("1e+")).toThrow("Invalid number");
    expect(() => JSON5.parse("1E-")).toThrow("Invalid number");
    expect(() => JSON5.parse("1ex")).toThrow("Invalid number");
  });

  // -- Expected hex digits after '0x' --
  test("hex with no digits", () => {
    expect(() => JSON5.parse("0x")).toThrow("Invalid hex number");
    expect(() => JSON5.parse("0X")).toThrow("Invalid hex number");
    expect(() => JSON5.parse("0xGG")).toThrow("Invalid hex number");
  });

  // -- Hex number too large --
  test("hex number too large", () => {
    expect(() => JSON5.parse("0xFFFFFFFFFFFFFFFFFF")).toThrow("Invalid hex number");
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

  test("stringifies strings with single quotes", () => {
    expect(JSON5.stringify("hello")).toEqual("'hello'");
  });

  test("escapes single quotes in strings", () => {
    expect(JSON5.stringify("it's")).toEqual("'it\\'s'");
  });

  test("does not escape double quotes in strings", () => {
    expect(JSON5.stringify('he said "hi"')).toEqual("'he said \"hi\"'");
  });

  test("escapes control characters in strings", () => {
    expect(JSON5.stringify("line\nnew")).toEqual("'line\\nnew'");
    expect(JSON5.stringify("tab\there")).toEqual("'tab\\there'");
    expect(JSON5.stringify("back\\slash")).toEqual("'back\\\\slash'");
  });

  test("stringifies objects with unquoted keys", () => {
    expect(JSON5.stringify({ a: 1, b: "two" })).toEqual("{a:1,b:'two'}");
  });

  test("quotes keys that are not valid identifiers", () => {
    expect(JSON5.stringify({ "foo bar": 1 })).toEqual("{'foo bar':1}");
    expect(JSON5.stringify({ "0key": 1 })).toEqual("{'0key':1}");
    expect(JSON5.stringify({ "key-name": 1 })).toEqual("{'key-name':1}");
    expect(JSON5.stringify({ "": 1 })).toEqual("{'':1}");
  });

  test("stringifies arrays", () => {
    expect(JSON5.stringify([1, "two", true])).toEqual("[1,'two',true]");
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

  test("escapes U+2028 and U+2029 line separators", () => {
    expect(JSON5.stringify("hello\u2028world")).toEqual("'hello\\u2028world'");
    expect(JSON5.stringify("hello\u2029world")).toEqual("'hello\\u2029world'");
  });

  test("space parameter with Infinity/NaN/large numbers", () => {
    expect(JSON5.stringify({ a: 1 }, null, Infinity)).toEqual(JSON5.stringify({ a: 1 }, null, 10));
    expect(JSON5.stringify({ a: 1 }, null, -Infinity)).toEqual(JSON5.stringify({ a: 1 }));
    expect(JSON5.stringify({ a: 1 }, null, NaN)).toEqual(JSON5.stringify({ a: 1 }));
    expect(JSON5.stringify({ a: 1 }, null, 100)).toEqual(JSON5.stringify({ a: 1 }, null, 10));
    expect(JSON5.stringify({ a: 1 }, null, 2147483648)).toEqual(JSON5.stringify({ a: 1 }, null, 10));
    expect(JSON5.stringify({ a: 1 }, null, 3e9)).toEqual(JSON5.stringify({ a: 1 }, null, 10));
  });

  test("space parameter with boxed Number", () => {
    expect(JSON5.stringify({ a: 1 }, null, new Number(4) as any)).toEqual(JSON5.stringify({ a: 1 }, null, 4));
    expect(JSON5.stringify({ a: 1 }, null, new Number(0) as any)).toEqual(JSON5.stringify({ a: 1 }, null, 0));
    expect(JSON5.stringify({ a: 1 }, null, new Number(-1) as any)).toEqual(JSON5.stringify({ a: 1 }, null, -1));
    expect(JSON5.stringify({ a: 1 }, null, new Number(Infinity) as any)).toEqual(JSON5.stringify({ a: 1 }, null, 10));
    expect(JSON5.stringify({ a: 1 }, null, new Number(NaN) as any)).toEqual(JSON5.stringify({ a: 1 }, null, 0));
  });

  test("space parameter with boxed String", () => {
    expect(JSON5.stringify({ a: 1 }, null, new String("\t") as any)).toEqual(JSON5.stringify({ a: 1 }, null, "\t"));
    expect(JSON5.stringify({ a: 1 }, null, new String("") as any)).toEqual(JSON5.stringify({ a: 1 }, null, ""));
  });

  test("space parameter with all-undefined properties produces empty object", () => {
    expect(JSON5.stringify({ a: undefined, b: undefined }, null, 2)).toEqual("{}");
    expect(JSON5.stringify({ a: () => {}, b: () => {} }, null, 2)).toEqual("{}");
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

  // Verified against json5@2.2.3 reference implementation
  test("matches json5 npm output for all types", () => {
    expect(JSON5.stringify(null)).toEqual("null");
    expect(JSON5.stringify(true)).toEqual("true");
    expect(JSON5.stringify(false)).toEqual("false");
    expect(JSON5.stringify(42)).toEqual("42");
    expect(JSON5.stringify(3.14)).toEqual("3.14");
    expect(JSON5.stringify(-1)).toEqual("-1");
    expect(JSON5.stringify(0)).toEqual("0");
    expect(JSON5.stringify(Infinity)).toEqual("Infinity");
    expect(JSON5.stringify(-Infinity)).toEqual("-Infinity");
    expect(JSON5.stringify(NaN)).toEqual("NaN");
    expect(JSON5.stringify("hello")).toEqual("'hello'");
    expect(JSON5.stringify('he said "hi"')).toEqual("'he said \"hi\"'");
    expect(JSON5.stringify("line\nnew")).toEqual("'line\\nnew'");
    expect(JSON5.stringify("tab\there")).toEqual("'tab\\there'");
    expect(JSON5.stringify("back\\slash")).toEqual("'back\\\\slash'");
    expect(JSON5.stringify({ a: 1, b: "two" })).toEqual("{a:1,b:'two'}");
    expect(JSON5.stringify({ "foo bar": 1 })).toEqual("{'foo bar':1}");
    expect(JSON5.stringify({ "0key": 1 })).toEqual("{'0key':1}");
    expect(JSON5.stringify({ "key-name": 1 })).toEqual("{'key-name':1}");
    expect(JSON5.stringify({ "": 1 })).toEqual("{'':1}");
    expect(JSON5.stringify([1, "two", true])).toEqual("[1,'two',true]");
    expect(JSON5.stringify({ a: [1, { b: 2 }] })).toEqual("{a:[1,{b:2}]}");
    expect(JSON5.stringify({ x: Infinity, y: NaN })).toEqual("{x:Infinity,y:NaN}");
    expect(JSON5.stringify([Infinity, -Infinity, NaN])).toEqual("[Infinity,-Infinity,NaN]");
    expect(JSON5.stringify(undefined)).toBeUndefined();
    expect(JSON5.stringify(() => {})).toBeUndefined();
  });

  test("matches json5 npm pretty-print output", () => {
    expect(JSON5.stringify({ a: 1 }, null, 2)).toEqual("{\n  a: 1,\n}");
    expect(JSON5.stringify({ a: 1 }, null, "\t")).toEqual("{\n\ta: 1,\n}");
    expect(JSON5.stringify({ a: 1, b: 2 }, null, 2)).toEqual("{\n  a: 1,\n  b: 2,\n}");
    expect(JSON5.stringify([1, 2, 3], null, 2)).toEqual("[\n  1,\n  2,\n  3,\n]");
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

  test("no whitespace/comments allowed between sign and value (per spec)", () => {
    expect(() => JSON5.parse("+ /* c */ 1")).toThrow();
    expect(() => JSON5.parse("- /* c */ 1")).toThrow();
    expect(() => JSON5.parse("+ // c\n1")).toThrow();
    expect(() => JSON5.parse("+ /* c */ Infinity")).toThrow();
    expect(() => JSON5.parse("- /* c */ Infinity")).toThrow();
    expect(() => JSON5.parse("+ /* c */ NaN")).toThrow();
    expect(() => JSON5.parse("- /* c */ NaN")).toThrow();
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
  test("no whitespace allowed between sign and value (per spec)", () => {
    expect(() => JSON5.parse("+  1")).toThrow();
    expect(() => JSON5.parse("-  1")).toThrow();
    expect(() => JSON5.parse("+ \t 1")).toThrow();
    expect(() => JSON5.parse("- \n 1")).toThrow();
    expect(() => JSON5.parse("+\u00A01")).toThrow();
    expect(() => JSON5.parse("-\u00A01")).toThrow();
    expect(() => JSON5.parse("+\u20001")).toThrow();
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

  test("signed NaN/Infinity as keys should error", () => {
    expect(() => JSON5.parse("{-Infinity: 1}")).toThrow();
    expect(() => JSON5.parse("{+Infinity: 1}")).toThrow();
    expect(() => JSON5.parse("{-NaN: 1}")).toThrow();
    expect(() => JSON5.parse("{+NaN: 1}")).toThrow();
  });

  test("numeric literals as keys should error", () => {
    expect(() => JSON5.parse("{123: 1}")).toThrow();
    expect(() => JSON5.parse("{0xFF: 1}")).toThrow();
    expect(() => JSON5.parse("{3.14: 1}")).toThrow();
    expect(() => JSON5.parse("{-1: 1}")).toThrow();
    expect(() => JSON5.parse("{+1: 1}")).toThrow();
  });

  test("NaN and Infinity as values still work", () => {
    expect(Number.isNaN(JSON5.parse("{a: NaN}").a)).toBe(true);
    expect(JSON5.parse("{a: Infinity}").a).toBe(Infinity);
    expect(JSON5.parse("{a: -Infinity}").a).toBe(-Infinity);
    expect(Number.isNaN(JSON5.parse("{a: +NaN}").a)).toBe(true);
    expect(Number.isNaN(JSON5.parse("{a: -NaN}").a)).toBe(true);
    expect(JSON5.parse("{a: +Infinity}").a).toBe(Infinity);
  });

  test("keyword-like identifiers as values should error", () => {
    expect(() => JSON5.parse("{a: undefined}")).toThrow("Unexpected token");
    expect(() => JSON5.parse("{a: class}")).toThrow("Unexpected token");
    expect(() => JSON5.parse("{a: var}")).toThrow("Unexpected token");
  });
});

describe("number edge cases", () => {
  test("double sign throws", () => {
    expect(() => JSON5.parse("++1")).toThrow("Unexpected character");
    expect(() => JSON5.parse("--1")).toThrow("Unexpected character");
    expect(() => JSON5.parse("+-1")).toThrow("Unexpected character");
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
    expect(() => JSON5.parse("undefined")).toThrow("Unexpected token");
    expect(() => JSON5.parse("foo")).toThrow("Unexpected token");
    expect(() => JSON5.parse("var")).toThrow("Unexpected token");
    expect(() => JSON5.parse("function")).toThrow("Unexpected token");
    expect(() => JSON5.parse("return")).toThrow("Unexpected token");
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

// Helper for comparing values that may contain NaN
function deepEqual(a: any, b: any): boolean {
  if (typeof a === "number" && typeof b === "number") {
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    return Object.is(a, b);
  }
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v: any, i: number) => deepEqual(v, b[i]));
  }
  if (typeof a === "object") {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(k => deepEqual(a[k], b[k]));
  }
  return false;
}

describe("round-trip: parse → stringify → parse", () => {
  // Parse JSON5 input, stringify the result, parse again — values must match
  function psp(input: string) {
    const first = JSON5.parse(input);
    const stringified = JSON5.stringify(first);
    const second = JSON5.parse(stringified);
    expect(deepEqual(first, second)).toBe(true);
  }

  describe("primitives", () => {
    test("null", () => psp("null"));
    test("true", () => psp("true"));
    test("false", () => psp("false"));
  });

  describe("numbers", () => {
    test("zero", () => psp("0"));
    test("positive integer", () => psp("42"));
    test("negative integer", () => psp("-42"));
    test("float", () => psp("3.14"));
    test("negative float", () => psp("-3.14"));
    test("leading decimal point", () => psp(".5"));
    test("negative leading decimal", () => psp("-.5"));
    test("exponent notation", () => psp("1e10"));
    test("negative exponent", () => psp("1e-5"));
    test("positive exponent", () => psp("1E+3"));
    test("hex integer", () => psp("0xFF"));
    test("negative hex", () => psp("-0xFF"));
    test("Infinity", () => psp("Infinity"));
    test("-Infinity", () => psp("-Infinity"));
    test("+Infinity", () => psp("+Infinity"));
    test("NaN", () => psp("NaN"));
    test("explicit positive", () => psp("+42"));
    test("explicit positive float", () => psp("+3.14"));
  });

  describe("strings", () => {
    test("empty single-quoted", () => psp("''"));
    test("empty double-quoted", () => psp('""'));
    test("simple single-quoted", () => psp("'hello'"));
    test("simple double-quoted", () => psp('"hello"'));
    test("string with spaces", () => psp("'hello world'"));
    test("string with escape sequences", () => psp("'\\n\\t\\r\\b\\f'"));
    test("string with unicode escape", () => psp("'\\u0041'"));
    test("string with backslash", () => psp("'\\\\'"));
    test("string with single quote escape", () => psp("'it\\'s'"));
    test("string with null char escape", () => psp("'\\0'"));
    test("unicode characters", () => psp("'日本語'"));
    test("emoji", () => psp("'😀'"));
  });

  describe("arrays", () => {
    test("empty array", () => psp("[]"));
    test("single element", () => psp("[1]"));
    test("multiple elements", () => psp("[1, 2, 3]"));
    test("mixed types", () => psp("[1, 'two', true, null, Infinity]"));
    test("nested arrays", () => psp("[[1, 2], [3, 4]]"));
    test("array with trailing comma", () => psp("[1, 2, 3,]"));
    test("sparse-looking array with nulls", () => psp("[null, null, null]"));
  });

  describe("objects", () => {
    test("empty object", () => psp("{}"));
    test("single property", () => psp("{a: 1}"));
    test("multiple properties", () => psp("{a: 1, b: 2, c: 3}"));
    test("quoted keys", () => psp("{'a': 1, \"b\": 2}"));
    test("nested objects", () => psp("{a: {b: {c: 1}}}"));
    test("mixed values", () => psp("{a: 1, b: 'two', c: true, d: null, e: [1, 2]}"));
    test("trailing comma", () => psp("{a: 1, b: 2,}"));
    test("NaN as key", () => psp("{NaN: 1}"));
    test("Infinity as key", () => psp("{Infinity: 1}"));
    test("null as key", () => psp("{null: 1}"));
    test("true as key", () => psp("{true: 1}"));
    test("false as key", () => psp("{false: 1}"));
    test("key with $ prefix", () => psp("{$key: 1}"));
    test("key with _ prefix", () => psp("{_key: 1}"));
    test("key with unicode letters", () => psp("{café: 1}"));
  });

  describe("complex structures", () => {
    test("array of objects", () => psp("[{a: 1}, {b: 2}, {c: 3}]"));
    test("object with array values", () => psp("{a: [1, 2], b: [3, 4]}"));
    test("deeply nested", () => psp("{a: {b: [{c: {d: [1, 2, 3]}}]}}"));
    test("config-like structure", () =>
      psp(`{
        name: 'my-app',
        version: '1.0.0',
        debug: true,
        port: 3000,
        tags: ['web', 'api'],
        db: {
          host: 'localhost',
          port: 5432,
        },
      }`));
  });
});

describe("round-trip: stringify → parse → stringify", () => {
  // Stringify a JS value, parse the result, stringify again — strings must match
  function sps(value: any) {
    const first = JSON5.stringify(value);
    const parsed = JSON5.parse(first);
    const second = JSON5.stringify(parsed);
    expect(second).toBe(first);
  }

  // With a space argument for pretty printing
  function spsPretty(value: any, space: number | string = 2) {
    const first = JSON5.stringify(value, null, space);
    const parsed = JSON5.parse(first);
    const second = JSON5.stringify(parsed, null, space);
    expect(second).toBe(first);
  }

  describe("primitives", () => {
    test("null", () => sps(null));
    test("true", () => sps(true));
    test("false", () => sps(false));
  });

  describe("numbers", () => {
    test("zero", () => sps(0));
    test("positive integer", () => sps(42));
    test("negative integer", () => sps(-42));
    test("float", () => sps(3.14));
    test("negative float", () => sps(-3.14));
    test("very small float", () => sps(0.000001));
    test("very large number", () => sps(1e20));
    test("Infinity", () => sps(Infinity));
    test("-Infinity", () => sps(-Infinity));
    test("NaN", () => sps(NaN));
    test("MAX_SAFE_INTEGER", () => sps(Number.MAX_SAFE_INTEGER));
    test("MIN_SAFE_INTEGER", () => sps(Number.MIN_SAFE_INTEGER));
  });

  describe("strings", () => {
    test("empty string", () => sps(""));
    test("simple string", () => sps("hello"));
    test("string with spaces", () => sps("hello world"));
    test("string with newline", () => sps("line1\nline2"));
    test("string with tab", () => sps("col1\tcol2"));
    test("string with backslash", () => sps("path\\to\\file"));
    test("string with single quotes", () => sps("it's"));
    test("string with null char", () => sps("null\0char"));
    test("unicode string", () => sps("日本語"));
    test("emoji string", () => sps("😀🎉"));
    test("string with control chars", () => sps("\x01\x02\x03"));
  });

  describe("arrays", () => {
    test("empty array", () => sps([]));
    test("single element", () => sps([1]));
    test("multiple numbers", () => sps([1, 2, 3]));
    test("mixed types", () => sps([1, "two", true, null]));
    test("nested arrays", () =>
      sps([
        [1, 2],
        [3, 4],
      ]));
    test("array with special numbers", () => sps([Infinity, -Infinity, NaN]));
    test("array with objects", () => sps([{ a: 1 }, { b: 2 }]));
  });

  describe("objects", () => {
    test("empty object", () => sps({}));
    test("single property", () => sps({ a: 1 }));
    test("multiple properties", () => sps({ a: 1, b: 2, c: 3 }));
    test("nested object", () => sps({ a: { b: { c: 1 } } }));
    test("mixed value types", () => sps({ num: 42, str: "hello", bool: true, nil: null }));
    test("object with array value", () => sps({ items: [1, 2, 3] }));
    test("object with special number values", () => sps({ inf: Infinity, ninf: -Infinity, nan: NaN }));
    test("key needing quotes (has space)", () => sps({ "key with spaces": 1 }));
    test("key needing quotes (starts with number)", () => sps({ "0abc": 1 }));
    test("key needing quotes (has hyphen)", () => sps({ "my-key": 1 }));
    test("key with $", () => sps({ $key: 1 }));
    test("key with _", () => sps({ _key: 1 }));
  });

  describe("complex structures", () => {
    test("package.json-like", () =>
      sps({
        name: "my-package",
        version: "1.0.0",
        private: true,
        dependencies: { react: "^18.0.0", next: "^13.0.0" },
        scripts: { build: "next build", dev: "next dev" },
      }));

    test("config with arrays and nesting", () =>
      sps({
        server: { host: "localhost", port: 8080 },
        features: ["auth", "logging"],
        limits: { maxRequests: Infinity, timeout: 30000 },
      }));
  });

  describe("pretty-printed", () => {
    test("simple object with 2-space indent", () => spsPretty({ a: 1, b: 2 }));
    test("nested object with 4-space indent", () => spsPretty({ a: { b: 1 } }, 4));
    test("array with tab indent", () => spsPretty([1, 2, 3], "\t"));
    test("complex structure", () =>
      spsPretty({
        name: "test",
        items: [1, "two", true],
        nested: { a: { b: [null, Infinity] } },
      }));
    test("empty containers pretty-printed", () => spsPretty({ arr: [], obj: {} }));
  });

  describe("undefined/symbol/function values", () => {
    test("undefined in object is omitted", () => {
      const obj = { a: 1, b: undefined, c: 3 };
      const s1 = JSON5.stringify(obj);
      const parsed = JSON5.parse(s1);
      const s2 = JSON5.stringify(parsed);
      expect(s2).toBe(s1);
      expect(parsed).toEqual({ a: 1, c: 3 });
    });

    test("undefined in array becomes null", () => {
      const arr = [1, undefined, 3];
      const s1 = JSON5.stringify(arr);
      const parsed = JSON5.parse(s1);
      const s2 = JSON5.stringify(parsed);
      expect(s2).toBe(s1);
      expect(parsed).toEqual([1, null, 3]);
    });
  });
});
