// Translated from CPython 3.15's Lib/test/test_base64.py: LegacyBase64TestCase, and of BaseXYTestCase the tests named below.
// Not translated: padding, wrapping and ignored characters, the alternative alphabets when decoding, casefold and map01,
// base32hex, Ascii85, base85 and Z85, the tests that draw data with hypothesis, the lazy import, the command line.
// check_other_types() has the buffers of JavaScript besides.
import { kwargs } from "bun:python";
import { describe, expect, test } from "bun:test";
import { array } from "python:array";
import base64 from "python:base64";
import binascii from "python:binascii";
import { TypeError as PyTypeError, ValueError, bytearray, issubclass, len, memoryview } from "python:builtins";
import { BytesIO, StringIO } from "python:io";
import { b, t } from "./helpers";

const eq = (actual: any, expected: any) => expect(actual).toEqual(expected);

const ALL = "abcdefghijklmnopqrstuvwxyz" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ" + "0123456789!@#0^&*();:<>,. []{}";

describe("LegacyBase64TestCase", () => {
  // Legacy API is not as permissive as the modern API
  function check_type_errors(f: (data: any) => any) {
    expect(() => f("")).toThrow(PyTypeError);
    expect(() => f([])).toThrow(PyTypeError);
    const multidimensional = memoryview(b("1234")).cast("B", t(2, 2));
    expect(() => f(multidimensional)).toThrow(PyTypeError);
    const int_data = memoryview(b("1234")).cast("I");
    expect(() => f(int_data)).toThrow(PyTypeError);
  }

  test("test_encodebytes", () => {
    eq(base64.encodebytes(b("www.python.org")), b("d3d3LnB5dGhvbi5vcmc=\n"));
    eq(base64.encodebytes(b("a")), b("YQ==\n"));
    eq(base64.encodebytes(b("ab")), b("YWI=\n"));
    eq(base64.encodebytes(b("abc")), b("YWJj\n"));
    eq(base64.encodebytes(b("")), b(""));
    eq(
      base64.encodebytes(b(ALL)),
      b(
        "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXpBQkNE" +
          "RUZHSElKS0xNTk9QUVJTVFVWV1hZWjAxMjM0\nNT" +
          "Y3ODkhQCMwXiYqKCk7Ojw+LC4gW117fQ==\n",
      ),
    );
    eq(base64.encodebytes(b("Aladdin:open sesame")), b("QWxhZGRpbjpvcGVuIHNlc2FtZQ==\n"));
    // Non-bytes
    eq(base64.encodebytes(bytearray(b("abc"))), b("YWJj\n"));
    eq(base64.encodebytes(memoryview(b("abc"))), b("YWJj\n"));
    eq(base64.encodebytes(array("B", b("abc"))), b("YWJj\n"));
    eq(base64.encodebytes(new TextEncoder().encode("abc")), b("YWJj\n"));
    check_type_errors(base64.encodebytes);
  });

  test("test_decodebytes", () => {
    eq(base64.decodebytes(b("d3d3LnB5dGhvbi5vcmc=\n")), b("www.python.org"));
    eq(base64.decodebytes(b("YQ==\n")), b("a"));
    eq(base64.decodebytes(b("YWI=\n")), b("ab"));
    eq(base64.decodebytes(b("YWJj\n")), b("abc"));
    eq(
      base64.decodebytes(
        b(
          "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXpBQkNE" +
            "RUZHSElKS0xNTk9QUVJTVFVWV1hZWjAxMjM0\nNT" +
            "Y3ODkhQCMwXiYqKCk7Ojw+LC4gW117fQ==\n",
        ),
      ),
      b(ALL),
    );
    eq(base64.decodebytes(b("")), b(""));
    eq(base64.decodebytes(b("QWxhZGRpbjpvcGVuIHNlc2FtZQ==\n")), b("Aladdin:open sesame"));
    // Non-bytes
    eq(base64.decodebytes(bytearray(b("YWJj\n"))), b("abc"));
    eq(base64.decodebytes(memoryview(b("YWJj\n"))), b("abc"));
    eq(base64.decodebytes(array("B", b("YWJj\n"))), b("abc"));
    eq(base64.decodebytes(Buffer.from("YWJj\n")), b("abc"));
    check_type_errors(base64.decodebytes);
  });

  test("test_encode", () => {
    const infp = BytesIO(b(ALL));
    const outfp = BytesIO();
    base64.encode(infp, outfp);
    eq(
      outfp.getvalue(),
      b(
        "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXpBQkNE" +
          "RUZHSElKS0xNTk9QUVJTVFVWV1hZWjAxMjM0\nNT" +
          "Y3ODkhQCMwXiYqKCk7Ojw+LC4gW117fQ==\n",
      ),
    );
    // Non-binary files
    expect(() => base64.encode(StringIO("abc"), BytesIO())).toThrow(PyTypeError);
    expect(() => base64.encode(BytesIO(b("abc")), StringIO())).toThrow(PyTypeError);
    expect(() => base64.encode(StringIO("abc"), StringIO())).toThrow(PyTypeError);
  });

  test("test_decode", () => {
    const infp = BytesIO(b("d3d3LnB5dGhvbi5vcmc="));
    const outfp = BytesIO();
    base64.decode(infp, outfp);
    eq(outfp.getvalue(), b("www.python.org"));
    // Non-binary files
    expect(() => base64.encode(StringIO("YWJj\n"), BytesIO())).toThrow(PyTypeError);
    expect(() => base64.encode(BytesIO(b("YWJj\n")), StringIO())).toThrow(PyTypeError);
    expect(() => base64.encode(StringIO("YWJj\n"), StringIO())).toThrow(PyTypeError);
  });
});

describe("BaseXYTestCase", () => {
  // Modern API completely ignores exported dimension and format data and
  // treats any buffer as a stream of bytes
  function check_encode_type_errors(f: (data: any) => any) {
    expect(() => f("")).toThrow(PyTypeError);
    expect(() => f([])).toThrow(PyTypeError);
  }

  function check_decode_type_errors(f: (data: any) => any) {
    expect(() => f([])).toThrow(PyTypeError);
  }

  function check_other_types(f: (data: any) => any, bytes_data: any, expected: any) {
    const mutable = bytearray(bytes_data);
    eq(f(mutable), expected);
    // The bytearray wasn't mutated
    eq(mutable, bytes_data);
    eq(f(memoryview(bytes_data)), expected);
    eq(f(array("B", bytes_data)), expected);
    // XXX why is b64encode hardcoded here?
    check_nonbyte_element_format(base64.b64encode, bytes_data);
    check_multidimensional(base64.b64encode, bytes_data);
    // What JavaScript has.
    const bytes = new Uint8Array(bytes_data);
    eq(f(bytes), expected);
    eq(f(Buffer.from(bytes)), expected);
    eq(f(bytes.buffer), expected);
    eq(f(new DataView(bytes.buffer)), expected);
    eq(bytes, new Uint8Array(bytes_data));
  }

  function check_multidimensional(f: (data: any) => any, data: any) {
    const padding = len(data) % 2 ? b("\x00") : b("");
    const bytes_data = data + padding; // Make sure cast works
    const shape = t(len(bytes_data) >> 1, 2);
    const multidimensional = memoryview(bytes_data).cast("B", shape);
    eq(f(multidimensional), f(bytes_data));
  }

  function check_nonbyte_element_format(f: (data: any) => any, data: any) {
    const padding = b("\x00") * ((4 - (len(data) % 4)) % 4);
    const bytes_data = data + padding; // Make sure cast works
    const int_data = memoryview(bytes_data).cast("I");
    eq(f(int_data), f(bytes_data));
  }

  const ENCODED =
    "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXpBQkNE" +
    "RUZHSElKS0xNTk9QUVJTVFVWV1hZWjAxMjM0NT" +
    "Y3ODkhQCMwXiYqKCk7Ojw+LC4gW117fQ==";

  test("test_b64encode", () => {
    // Test default alphabet
    eq(base64.b64encode(b("www.python.org")), b("d3d3LnB5dGhvbi5vcmc="));
    eq(base64.b64encode(b("\x00")), b("AA=="));
    eq(base64.b64encode(b("a")), b("YQ=="));
    eq(base64.b64encode(b("ab")), b("YWI="));
    eq(base64.b64encode(b("abc")), b("YWJj"));
    eq(base64.b64encode(b("")), b(""));
    eq(base64.b64encode(b(ALL)), b(ENCODED));

    // Test with arbitrary alternative characters
    eq(base64.b64encode(b("\xd3V\xbeo\xf7\x1d"), kwargs({ altchars: b("*$") })), b("01a*b$cd"));
    eq(base64.b64encode(b("\xd3V\xbeo\xf7\x1d"), kwargs({ altchars: bytearray(b("*$")) })), b("01a*b$cd"));
    eq(base64.b64encode(b("\xd3V\xbeo\xf7\x1d"), kwargs({ altchars: memoryview(b("*$")) })), b("01a*b$cd"));
    eq(base64.b64encode(b("\xd3V\xbeo\xf7\x1d"), kwargs({ altchars: array("B", b("*$")) })), b("01a*b$cd"));
    eq(base64.b64encode(b("\xd3V\xbeo\xf7\x1d"), kwargs({ altchars: Buffer.from("*$") })), b("01a*b$cd"));
    // Non-bytes
    check_other_types(base64.b64encode, b("abcd"), b("YWJjZA=="));
    check_encode_type_errors(base64.b64encode);
    expect(() => base64.b64encode(b(""), kwargs({ altchars: "*$" }))).toThrow(PyTypeError);
    // Test standard alphabet
    eq(base64.standard_b64encode(b("www.python.org")), b("d3d3LnB5dGhvbi5vcmc="));
    eq(base64.standard_b64encode(b("a")), b("YQ=="));
    eq(base64.standard_b64encode(b("ab")), b("YWI="));
    eq(base64.standard_b64encode(b("abc")), b("YWJj"));
    eq(base64.standard_b64encode(b("")), b(""));
    eq(base64.standard_b64encode(b(ALL)), b(ENCODED));
    // Non-bytes
    check_other_types(base64.standard_b64encode, b("abcd"), b("YWJjZA=="));
    check_encode_type_errors(base64.standard_b64encode);
    // Test with 'URL safe' alternative characters
    eq(base64.urlsafe_b64encode(b("\xd3V\xbeo\xf7\x1d")), b("01a-b_cd"));
    // Non-bytes
    check_other_types(base64.urlsafe_b64encode, b("\xd3V\xbeo\xf7\x1d"), b("01a-b_cd"));
    check_encode_type_errors(base64.urlsafe_b64encode);
  });

  test("test_b64decode", () => {
    const tests: [any, any][] = [
      [b("d3d3LnB5dGhvbi5vcmc="), b("www.python.org")],
      [b("AA=="), b("\x00")],
      [b("YQ=="), b("a")],
      [b("YWI="), b("ab")],
      [b("YWJj"), b("abc")],
      [
        b(
          "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXpBQkNE" +
            "RUZHSElKS0xNTk9QUVJTVFVWV1hZWjAxMjM0\nNT" +
            "Y3ODkhQCMwXiYqKCk7Ojw+LC4gW117fQ==",
        ),
        b(ALL),
      ],
      [b(""), b("")],
    ];
    for (const [data, res] of tests) {
      eq(base64.b64decode(data), res);
      eq(base64.b64decode(data.decode("ascii")), res);
    }
    // Non-bytes
    check_other_types(base64.b64decode, b("YWJj"), b("abc"));
    check_decode_type_errors(base64.b64decode);

    // Test standard alphabet
    for (const [data, res] of tests) {
      eq(base64.standard_b64decode(data), res);
      eq(base64.standard_b64decode(data.decode("ascii")), res);
    }
    // Non-bytes
    check_other_types(base64.standard_b64decode, b("YWJj"), b("abc"));
    check_decode_type_errors(base64.standard_b64decode);

    // Test with 'URL safe' alternative characters
    const tests_urlsafe: [any, any][] = [
      [b("01a-b_cd"), b("\xd3V\xbeo\xf7\x1d")],
      [b(""), b("")],
    ];
    for (const [data, res] of tests_urlsafe) {
      eq(base64.urlsafe_b64decode(data), res);
      eq(base64.urlsafe_b64decode(data.decode("ascii")), res);
    }
    // Non-bytes
    check_other_types(base64.urlsafe_b64decode, b("01a-b_cd"), b("\xd3V\xbeo\xf7\x1d"));
    check_decode_type_errors(base64.urlsafe_b64decode);
  });

  test("test_b32encode", () => {
    eq(base64.b32encode(b("")), b(""));
    eq(base64.b32encode(b("\x00")), b("AA======"));
    eq(base64.b32encode(b("a")), b("ME======"));
    eq(base64.b32encode(b("ab")), b("MFRA===="));
    eq(base64.b32encode(b("abc")), b("MFRGG==="));
    eq(base64.b32encode(b("abcd")), b("MFRGGZA="));
    eq(base64.b32encode(b("abcde")), b("MFRGGZDF"));
    // Non-bytes
    check_other_types(base64.b32encode, b("abcd"), b("MFRGGZA="));
    check_encode_type_errors(base64.b32encode);
  });

  test("test_b32decode", () => {
    const tests: [any, any][] = [
      [b(""), b("")],
      [b("AA======"), b("\x00")],
      [b("ME======"), b("a")],
      [b("MFRA===="), b("ab")],
      [b("MFRGG==="), b("abc")],
      [b("MFRGGZA="), b("abcd")],
      [b("MFRGGZDF"), b("abcde")],
    ];
    for (const [data, res] of tests) {
      eq(base64.b32decode(data), res);
      eq(base64.b32decode(data.decode("ascii")), res);
    }
    // Non-bytes
    check_other_types(base64.b32decode, b("MFRGG==="), b("abc"));
    check_decode_type_errors(base64.b32decode);
  });

  test("test_b16encode", () => {
    eq(base64.b16encode(b("\x01\x02\xab\xcd\xef")), b("0102ABCDEF"));
    eq(base64.b16encode(b("\x00")), b("00"));
    // Non-bytes
    check_other_types(base64.b16encode, b("\x01\x02\xab\xcd\xef"), b("0102ABCDEF"));
    check_encode_type_errors(base64.b16encode);
  });

  test("test_b16decode", () => {
    eq(base64.b16decode(b("0102ABCDEF")), b("\x01\x02\xab\xcd\xef"));
    eq(base64.b16decode("0102ABCDEF"), b("\x01\x02\xab\xcd\xef"));
    eq(base64.b16decode(b("00")), b("\x00"));
    eq(base64.b16decode("00"), b("\x00"));
    // Lower case is not allowed without a flag
    expect(() => base64.b16decode(b("0102abcdef"))).toThrow(binascii.Error);
    expect(() => base64.b16decode("0102abcdef")).toThrow(binascii.Error);
    // Case fold
    eq(base64.b16decode(b("0102abcdef"), true), b("\x01\x02\xab\xcd\xef"));
    eq(base64.b16decode("0102abcdef", true), b("\x01\x02\xab\xcd\xef"));
    // Non-bytes
    check_other_types(base64.b16decode, b("0102ABCDEF"), b("\x01\x02\xab\xcd\xef"));
    check_decode_type_errors(base64.b16decode);
    eq(base64.b16decode(bytearray(b("0102abcdef")), true), b("\x01\x02\xab\xcd\xef"));
    eq(base64.b16decode(memoryview(b("0102abcdef")), true), b("\x01\x02\xab\xcd\xef"));
    eq(base64.b16decode(array("B", b("0102abcdef")), true), b("\x01\x02\xab\xcd\xef"));
    // Non-alphabet characters
    expect(() => base64.b16decode("0102AG")).toThrow(binascii.Error);
    // Incorrect "padding"
    expect(() => base64.b16decode("010")).toThrow(binascii.Error);
  });

  test("test_decode_nonascii_str", () => {
    const decode_funcs = [
      base64.b64decode,
      base64.standard_b64decode,
      base64.urlsafe_b64decode,
      base64.b32decode,
      base64.b16decode,
      base64.b85decode,
      base64.a85decode,
      base64.z85decode,
    ];
    for (const f of decode_funcs) expect(() => f("with non-ascii \xcb")).toThrow(ValueError);
  });

  test("test_ErrorHeritage", () => {
    expect(issubclass(binascii.Error, ValueError)).toBe(true);
  });

  test("test_RFC4648_test_cases", () => {
    // test cases from RFC 4648 section 10
    const { b64encode, b32hexencode, b32encode, b16encode } = base64;

    eq(b64encode(b("")), b(""));
    eq(b64encode(b("f")), b("Zg=="));
    eq(b64encode(b("fo")), b("Zm8="));
    eq(b64encode(b("foo")), b("Zm9v"));
    eq(b64encode(b("foob")), b("Zm9vYg=="));
    eq(b64encode(b("fooba")), b("Zm9vYmE="));
    eq(b64encode(b("foobar")), b("Zm9vYmFy"));

    eq(b32encode(b("")), b(""));
    eq(b32encode(b("f")), b("MY======"));
    eq(b32encode(b("fo")), b("MZXQ===="));
    eq(b32encode(b("foo")), b("MZXW6==="));
    eq(b32encode(b("foob")), b("MZXW6YQ="));
    eq(b32encode(b("fooba")), b("MZXW6YTB"));
    eq(b32encode(b("foobar")), b("MZXW6YTBOI======"));

    eq(b32hexencode(b("")), b(""));
    eq(b32hexencode(b("f")), b("CO======"));
    eq(b32hexencode(b("fo")), b("CPNG===="));
    eq(b32hexencode(b("foo")), b("CPNMU==="));
    eq(b32hexencode(b("foob")), b("CPNMUOG="));
    eq(b32hexencode(b("fooba")), b("CPNMUOJ1"));
    eq(b32hexencode(b("foobar")), b("CPNMUOJ1E8======"));

    eq(b16encode(b("")), b(""));
    eq(b16encode(b("f")), b("66"));
    eq(b16encode(b("fo")), b("666F"));
    eq(b16encode(b("foo")), b("666F6F"));
    eq(b16encode(b("foob")), b("666F6F62"));
    eq(b16encode(b("fooba")), b("666F6F6261"));
    eq(b16encode(b("foobar")), b("666F6F626172"));
  });

  test("Python and JavaScript agree", () => {
    const data = Buffer.from(ALL);
    expect(base64.b64encode(data).decode()).toBe(data.toString("base64"));
    expect(base64.urlsafe_b64encode(data).decode().replace(/=+$/, "")).toBe(data.toString("base64url"));
    expect(base64.b16encode(data).decode().toLowerCase()).toBe(data.toString("hex"));
    expect(base64.b64decode(data.toString("base64"))).toEqual(data);
  });
});
