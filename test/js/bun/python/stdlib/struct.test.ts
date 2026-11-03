// Translated from CPython 3.15's Lib/test/test_struct.py: of StructTest the tests named below, and UnpackIteratorTest but for
// test_half_float (which needs _testcapi).
// Not translated: test_calcsize, test_integers, test_nN_code, test_705836, test_1530559, test_bool, test_count_overflow, the
// tests of subclasses of Struct, of its reinitialization, sizes, the collector, subinterpreters, complex and round trips.
// At the end: the same with the buffers of JavaScript.
import { float, kwargs } from "bun:python";
import { describe, expect, test } from "bun:test";
import array from "python:array";
import {
  OverflowError,
  StopIteration,
  TypeError as PyTypeError,
  ValueError,
  bytearray,
  bytes,
  int,
  len,
  memoryview,
  next,
  range,
  repr,
  slice,
  str,
  type,
} from "python:builtins";
import abc from "python:collections.abc";
import operator, { getitem, ne } from "python:operator";
import struct from "python:struct";
import sys from "python:sys";
import { b, raises, t } from "./helpers";

const ISBIGENDIAN = sys.byteorder == "big";

describe("StructTest", () => {
  test("test_isbigendian", () => {
    expect(struct.pack("=i", 1)[0] == 0).toBe(ISBIGENDIAN);
  });

  test("test_consistence", () => {
    expect(() => struct.calcsize("Z")).toThrow(struct.error);

    let sz = struct.calcsize("i");
    expect(sz * 3).toBe(struct.calcsize("iii"));

    const fmt = "cbxxxxxxhhhhiillffd?";
    const fmt3 = "3c3b18x12h6i6l6f3d3?";
    sz = struct.calcsize(fmt);
    const sz3 = struct.calcsize(fmt3);
    expect(sz * 3).toBe(sz3);

    expect(() => struct.pack("iii", 3)).toThrow(struct.error);
    expect(() => struct.pack("i", 3, 3, 3)).toThrow(struct.error);
    raises([PyTypeError, struct.error], () => struct.pack("i", "foo"));
    raises([PyTypeError, struct.error], () => struct.pack("P", "foo"));
    expect(() => struct.unpack("d", b("flap"))).toThrow(struct.error);
    const s = struct.pack("ii", 1, 2);
    expect(() => struct.unpack("iii", s)).toThrow(struct.error);
    expect(() => struct.unpack("i", s)).toThrow(struct.error);
  });

  test("test_transitiveness", () => {
    const c = b("a");
    const byte = 1;
    const h = 255;
    const i = 65535;
    const l = 65536;
    const f = 3.1415;
    const d = 3.1415;
    const flag = true;

    for (const prefix of ["", "@", "<", ">", "=", "!"]) {
      for (let format of ["xcbhilfd?", "xcBHILfd?"]) {
        format = prefix + format;
        const s = struct.pack(format, c, byte, h, i, l, f, d, flag);
        const [cp, bp, hp, ip, lp, fp, dp, tp] = struct.unpack(format, s);
        expect(cp).toEqual(c);
        expect(bp).toBe(byte);
        expect(hp).toBe(h);
        expect(ip).toBe(i);
        expect(lp).toBe(l);
        expect(int(100 * fp)).toBe(int(100 * f));
        expect(int(100 * dp)).toBe(int(100 * d));
        expect(tp).toBe(flag);
      }
    }
  });

  test("test_new_features", () => {
    // Test some of the new features in detail
    // (format, argument, big-endian result, little-endian result, asymmetric)
    const tests: [string, any, any, any, number][] = [
      ["c", b("a"), b("a"), b("a"), 0],
      ["xc", b("a"), b("\0a"), b("\0a"), 0],
      ["cx", b("a"), b("a\0"), b("a\0"), 0],
      ["s", b("a"), b("a"), b("a"), 0],
      ["0s", b("helloworld"), b(""), b(""), 1],
      ["1s", b("helloworld"), b("h"), b("h"), 1],
      ["9s", b("helloworld"), b("helloworl"), b("helloworl"), 1],
      ["10s", b("helloworld"), b("helloworld"), b("helloworld"), 0],
      ["11s", b("helloworld"), b("helloworld\0"), b("helloworld\0"), 1],
      ["20s", b("helloworld"), b("helloworld") + 10 * b("\0"), b("helloworld") + 10 * b("\0"), 1],
      ["0p", b("helloworld"), b(""), b(""), 1],
      ["1p", b("helloworld"), b("\x00"), b("\x00"), 1],
      ["2p", b("helloworld"), b("\x01h"), b("\x01h"), 1],
      ["10p", b("helloworld"), b("\x09helloworl"), b("\x09helloworl"), 1],
      ["11p", b("helloworld"), b("\x0Ahelloworld"), b("\x0Ahelloworld"), 0],
      ["12p", b("helloworld"), b("\x0Ahelloworld\0"), b("\x0Ahelloworld\0"), 1],
      ["20p", b("helloworld"), b("\x0Ahelloworld") + 9 * b("\0"), b("\x0Ahelloworld") + 9 * b("\0"), 1],
      ["b", 7, b("\x07"), b("\x07"), 0],
      ["b", -7, b("\xf9"), b("\xf9"), 0],
      ["B", 7, b("\x07"), b("\x07"), 0],
      ["B", 249, b("\xf9"), b("\xf9"), 0],
      ["h", 700, b("\x02\xbc"), b("\xbc\x02"), 0],
      ["h", -700, b("\xfdD"), b("D\xfd"), 0],
      ["H", 700, b("\x02\xbc"), b("\xbc\x02"), 0],
      ["H", 0x10000 - 700, b("\xfdD"), b("D\xfd"), 0],
      ["i", 70000000, b("\x04,\x1d\x80"), b("\x80\x1d,\x04"), 0],
      ["i", -70000000, b("\xfb\xd3\xe2\x80"), b("\x80\xe2\xd3\xfb"), 0],
      ["I", 70000000, b("\x04,\x1d\x80"), b("\x80\x1d,\x04"), 0],
      ["I", 0x100000000 - 70000000, b("\xfb\xd3\xe2\x80"), b("\x80\xe2\xd3\xfb"), 0],
      ["l", 70000000, b("\x04,\x1d\x80"), b("\x80\x1d,\x04"), 0],
      ["l", -70000000, b("\xfb\xd3\xe2\x80"), b("\x80\xe2\xd3\xfb"), 0],
      ["L", 70000000, b("\x04,\x1d\x80"), b("\x80\x1d,\x04"), 0],
      ["L", 0x100000000 - 70000000, b("\xfb\xd3\xe2\x80"), b("\x80\xe2\xd3\xfb"), 0],
      ["f", float(2), b("@\x00\x00\x00"), b("\x00\x00\x00@"), 0],
      ["d", float(2), b("@\x00\x00\x00\x00\x00\x00\x00"), b("\x00\x00\x00\x00\x00\x00\x00@"), 0],
      ["f", float(-2), b("\xc0\x00\x00\x00"), b("\x00\x00\x00\xc0"), 0],
      ["d", float(-2), b("\xc0\x00\x00\x00\x00\x00\x00\x00"), b("\x00\x00\x00\x00\x00\x00\x00\xc0"), 0],
      ["?", 0, b("\0"), b("\0"), 0],
      ["?", 3, b("\x01"), b("\x01"), 1],
      ["?", true, b("\x01"), b("\x01"), 0],
      ["?", [], b("\0"), b("\0"), 1],
      ["?", t(1), b("\x01"), b("\x01"), 1],
    ];

    for (const [fmt, arg, big, lil, asy] of tests) {
      for (const [xfmt, exp] of [
        [">" + fmt, big],
        ["!" + fmt, big],
        ["<" + fmt, lil],
        ["=" + fmt, ISBIGENDIAN ? big : lil],
      ]) {
        const res = struct.pack(xfmt, arg);
        expect(res).toEqual(exp);
        expect(struct.calcsize(xfmt)).toBe(len(res));
        const rev = struct.unpack(xfmt, res)[0];
        if (ne(rev, arg)) expect(asy).toBe(1);
      }
    }
  });

  test("test_p_code", () => {
    // Test p ("Pascal string") code.
    for (const [code, input, expected, expectedback] of [
      ["0p", b("abc"), b(""), b("")],
      ["p", b("abc"), b("\x00"), b("")],
      ["1p", b("abc"), b("\x00"), b("")],
      ["2p", b("abc"), b("\x01a"), b("a")],
      ["3p", b("abc"), b("\x02ab"), b("ab")],
      ["4p", b("abc"), b("\x03abc"), b("abc")],
      ["5p", b("abc"), b("\x03abc\x00"), b("abc")],
      ["6p", b("abc"), b("\x03abc\x00\x00"), b("abc")],
      ["1000p", b("x") * 1000, b("\xff") + b("x") * 999, b("x") * 255],
    ]) {
      let got = struct.pack(code, input);
      expect(got).toEqual(expected);
      [got] = struct.unpack(code, got);
      expect(got).toEqual(expectedback);
    }
  });

  test("test_unpack_from", () => {
    const test_string = b("abcd01234");
    const fmt = "4s";
    const s = struct.Struct(fmt);
    for (const cls of [bytes, bytearray]) {
      const data = cls(test_string);
      expect(s.unpack_from(data)).toEqual(t(b("abcd")));
      expect(s.unpack_from(data, 2)).toEqual(t(b("cd01")));
      expect(s.unpack_from(data, 4)).toEqual(t(b("0123")));
      for (let i = 0; i < 6; i++) expect(s.unpack_from(data, i)).toEqual(t(getitem(data, slice(i, i + 4))));
      for (let i = 6; i < len(test_string) + 1; i++) expect(() => s.unpack_from(data, i)).toThrow(struct.error);
    }
    for (const cls of [bytes, bytearray]) {
      const data = cls(test_string);
      expect(struct.unpack_from(fmt, data)).toEqual(t(b("abcd")));
      expect(struct.unpack_from(fmt, data, 2)).toEqual(t(b("cd01")));
      expect(struct.unpack_from(fmt, data, 4)).toEqual(t(b("0123")));
      for (let i = 0; i < 6; i++) expect(struct.unpack_from(fmt, data, i)).toEqual(t(getitem(data, slice(i, i + 4))));
      for (let i = 6; i < len(test_string) + 1; i++)
        expect(() => struct.unpack_from(fmt, data, i)).toThrow(struct.error);
    }

    // keyword arguments
    expect(s.unpack_from(kwargs({ buffer: test_string, offset: 2 }))).toEqual(t(b("cd01")));
  });

  function _test_pack_into(pack_into: (...args: any[]) => any) {
    const test_string = b("Reykjavik rocks, eow!");
    const writable_buf = memoryview(array.array("b", b(" ") * 100));

    // Test without offset
    pack_into(writable_buf, 0, test_string);
    let from_buf = getitem(writable_buf.tobytes(), slice(undefined, len(test_string)));
    expect(from_buf).toEqual(test_string);

    // Test with offset.
    pack_into(writable_buf, 10, test_string);
    from_buf = getitem(writable_buf.tobytes(), slice(undefined, len(test_string) + 10));
    expect(from_buf).toEqual(getitem(test_string, slice(undefined, 10)) + test_string);

    // Test with negative offset.
    pack_into(writable_buf, -30, test_string);
    from_buf = getitem(writable_buf.tobytes(), slice(-30, -30 + len(test_string)));
    expect(from_buf).toEqual(test_string);

    // Go beyond boundaries.
    const small_buf = array.array("b", b(" ") * 10);
    raises([ValueError, struct.error], () => pack_into(small_buf, 0, test_string));
    raises([ValueError, struct.error], () => pack_into(writable_buf, 90, test_string));
    raises([ValueError, struct.error], () => pack_into(writable_buf, -10, test_string));
    raises([ValueError, struct.error], () => pack_into(writable_buf, 150, test_string));
    raises([ValueError, struct.error], () => pack_into(writable_buf, -150, test_string));

    // Test invalid buffer.
    expect(() => pack_into(b(" ") * 100, 0, test_string)).toThrow(PyTypeError);
    expect(() => pack_into(" ".repeat(100), 0, test_string)).toThrow(PyTypeError);
    expect(() => pack_into(new Array(100).fill(0), 0, test_string)).toThrow(PyTypeError);
    expect(() => pack_into(undefined, 0, test_string)).toThrow(PyTypeError);
    expect(() => pack_into(getitem(writable_buf, slice(undefined, undefined, 2)), 0, test_string)).toThrow(PyTypeError);
    expect(() => pack_into(getitem(writable_buf, slice(undefined, undefined, -1)), 0, test_string)).toThrow(
      PyTypeError,
    );

    // Test bogus offset (issue bpo-3694)
    expect(() => pack_into(writable_buf, undefined, test_string)).toThrow(PyTypeError);
    expect(() => pack_into(writable_buf, float(0), test_string)).toThrow(PyTypeError);
    expect(() => pack_into(writable_buf, 2n ** 1000n, test_string)).toThrow(OverflowError);
    expect(() => pack_into(writable_buf, -(2n ** 1000n), test_string)).toThrow(OverflowError);
  }

  test("test_pack_into", () => {
    const s = struct.Struct("21s");
    _test_pack_into(s.pack_into);
  });

  test("test_pack_into_fn", () => {
    const pack_into = (...args: any[]) => struct.pack_into("21s", ...args);
    _test_pack_into(pack_into);
  });

  test("test_unpack_with_buffer", () => {
    // SF bug 1563759: struct.unpack doesn't support buffer protocol objects
    const data1 = array.array("B", b("\x12\x34\x56\x78"));
    const data2 = memoryview(b("\x12\x34\x56\x78")); // XXX b'......XXXX......', 6, 4
    for (const data of [data1, data2]) {
      const [value] = struct.unpack(">I", data);
      expect(value).toBe(0x12345678);
    }
  });

  test("test_trailing_counter", () => {
    const store = array.array("b", b(" ") * 100);

    // format lists containing only count spec should result in an error
    expect(() => struct.pack("12345")).toThrow(struct.error);
    expect(() => struct.unpack("12345", b(""))).toThrow(struct.error);
    expect(() => struct.pack_into("12345", store, 0)).toThrow(struct.error);
    expect(() => struct.unpack_from("12345", store, 0)).toThrow(struct.error);

    // Format lists with trailing count spec should result in an error
    expect(() => struct.pack("c12345", "x")).toThrow(struct.error);
    expect(() => struct.unpack("c12345", b("x"))).toThrow(struct.error);
    expect(() => struct.pack_into("c12345", store, 0, "x")).toThrow(struct.error);
    expect(() => struct.unpack_from("c12345", store, 0)).toThrow(struct.error);

    // Mixed format tests
    expect(() => struct.pack("14s42", "spam and eggs")).toThrow(struct.error);
    expect(() => struct.unpack("14s42", b("spam and eggs"))).toThrow(struct.error);
    expect(() => struct.pack_into("14s42", store, 0, "spam and eggs")).toThrow(struct.error);
    expect(() => struct.unpack_from("14s42", store, 0)).toThrow(struct.error);
  });

  test("test_boundary_error_message", () => {
    raises(
      struct.error,
      () => struct.pack_into("b", bytearray(1), 5, 1),
      /pack_into requires a buffer of at least 6 bytes for packing 1 bytes at offset 5 \(actual buffer size is 1\)/,
    );
    raises(
      struct.error,
      () => struct.unpack_from("b", bytearray(1), 5),
      /unpack_from requires a buffer of at least 6 bytes for unpacking 1 bytes at offset 5 \(actual buffer size is 1\)/,
    );
  });

  test("test_boundary_error_message_with_negative_offset", () => {
    const byte_list = bytearray(10);
    raises(struct.error, () => struct.pack_into("<I", byte_list, -2, 123), /no space to pack 4 bytes at offset -2/);
    raises(
      struct.error,
      () => struct.pack_into("<B", byte_list, -11, 123),
      "offset -11 out of range for 10-byte buffer",
    );
    raises(
      struct.error,
      () => struct.unpack_from("<I", byte_list, -2),
      /not enough data to unpack 4 bytes at offset -2/,
    );
    raises(struct.error, () => struct.unpack_from("<B", byte_list, -11), "offset -11 out of range for 10-byte buffer");
  });

  test("test_boundary_error_message_with_large_offset", () => {
    // Test overflows cause by large offset and value size (issue 30245)
    raises(
      struct.error,
      () => struct.pack_into("<I", bytearray(10), sys.maxsize, 1),
      `pack_into requires a buffer of at least ${sys.maxsize + 4n} bytes for packing 4 bytes at offset ${sys.maxsize} (actual buffer size is 10)`,
    );
    raises(
      struct.error,
      () => struct.unpack_from("<I", bytearray(10), sys.maxsize),
      `unpack_from requires a buffer of at least ${sys.maxsize + 4n} bytes for unpacking 4 bytes at offset ${sys.maxsize} (actual buffer size is 10)`,
    );
  });

  test("test_issue29802", () => {
    // When the second argument of struct.unpack() was of wrong type
    // the Struct object was decrefed twice and the reference to
    // deallocated object was left in a cache.
    expect(() => struct.unpack("b", 0)).toThrow(PyTypeError);
    // Shouldn't crash.
    expect(struct.unpack("b", b("a"))).toEqual(t(b("a")[0]));
  });

  test("test_format_attr", () => {
    const s = struct.Struct("=i2H");
    expect(s.format).toBe("=i2H");

    // use a bytes string
    const s2 = struct.Struct(str.encode(s.format));
    expect(s2.format).toBe(s.format);
  });

  test("test_repr", () => {
    const s = struct.Struct("=i2H");
    expect(repr(s)).toBe(`Struct(${repr(s.format)})`);
  });
});

/** Tests for iterative unpacking (struct.Struct.iter_unpack). */
describe("UnpackIteratorTest", () => {
  test("test_construct", () => {
    const _check_iterator = (it: any) => {
      expect(it).toBeInstanceOf(abc.Iterator);
      expect(it).toBeInstanceOf(abc.Iterable);
    };
    let s = struct.Struct(">ibcp");
    let it = s.iter_unpack(b(""));
    _check_iterator(it);
    it = s.iter_unpack(b("1234567"));
    _check_iterator(it);
    // Wrong bytes length
    expect(() => s.iter_unpack(b("123456"))).toThrow(struct.error);
    expect(() => s.iter_unpack(b("12345678"))).toThrow(struct.error);
    // Zero-length struct
    s = struct.Struct(">");
    expect(() => s.iter_unpack(b(""))).toThrow(struct.error);
    expect(() => s.iter_unpack(b("12"))).toThrow(struct.error);
  });

  test("test_uninstantiable", () => {
    const iter_unpack_type = type(struct.Struct(">ibcp").iter_unpack(b("")));
    expect(() => iter_unpack_type()).toThrow(PyTypeError);
    expect(() => new iter_unpack_type()).toThrow(PyTypeError);
  });

  test("test_iterate", () => {
    const s = struct.Struct(">IB");
    const data = bytes(range(1, 16));
    const it = s.iter_unpack(data);
    expect(next(it)).toEqual(t(0x01020304, 5));
    expect(next(it)).toEqual(t(0x06070809, 10));
    expect(next(it)).toEqual(t(0x0b0c0d0e, 15));
    expect(() => next(it)).toThrow(StopIteration);
    expect(() => next(it)).toThrow(StopIteration);
  });

  test("test_arbitrary_buffer", () => {
    const s = struct.Struct(">IB");
    const data = bytes(range(1, 11));
    const it = s.iter_unpack(memoryview(data));
    expect(next(it)).toEqual(t(0x01020304, 5));
    expect(next(it)).toEqual(t(0x06070809, 10));
    expect(() => next(it)).toThrow(StopIteration);
    expect(() => next(it)).toThrow(StopIteration);
  });

  test("test_length_hint", () => {
    const lh = operator.length_hint;
    const s = struct.Struct(">IB");
    const data = bytes(range(1, 16));
    const it = s.iter_unpack(data);
    expect(lh(it)).toBe(3);
    next(it);
    expect(lh(it)).toBe(2);
    next(it);
    expect(lh(it)).toBe(1);
    next(it);
    expect(lh(it)).toBe(0);
    expect(() => next(it)).toThrow(StopIteration);
    expect(lh(it)).toBe(0);
  });

  test("test_module_func", () => {
    // Sanity check for the global struct.iter_unpack()
    const it = struct.iter_unpack(">IB", bytes(range(1, 11)));
    expect(next(it)).toEqual(t(0x01020304, 5));
    expect(next(it)).toEqual(t(0x06070809, 10));
    expect(() => next(it)).toThrow(StopIteration);
    expect(() => next(it)).toThrow(StopIteration);
  });
});

describe("the buffers of JavaScript", () => {
  const data = [0x12, 0x34, 0x56, 0x78];

  test("unpack() reads them", () => {
    for (const buffer of [
      new Uint8Array(data),
      Buffer.from(data),
      new Uint8Array(data).buffer,
      new DataView(new Uint8Array(data).buffer),
      new Uint8Array([0, ...data, 0]).subarray(1, 5),
    ])
      expect(struct.unpack(">I", buffer)).toEqual([0x12345678]);
    expect(struct.unpack_from(">H", new Uint8Array(data), 2)).toEqual([0x5678]);
    expect([...struct.iter_unpack(">H", new Uint8Array(data))]).toEqual([[0x1234], [0x5678]]);
    // The items of the array do not matter, its bytes do.
    expect(struct.unpack("<I", new Uint16Array([0x5678, 0x1234]))).toEqual([0x12345678]);
  });

  test("pack_into() writes to them", () => {
    const bytes = new Uint8Array(8);
    struct.pack_into(">If", bytes, 0, 0x12345678, 1.5);
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0)).toBe(0x12345678);
    expect(view.getFloat32(4)).toBe(1.5);
    expect(() => struct.pack_into(">I", bytes, 6, 1)).toThrow(struct.error);
  });

  test("what pack() gives is bytes, which an array can be made of", () => {
    const packed = struct.pack(">I", 0x12345678);
    expect(type(packed)).toBe(bytes);
    expect(packed).toEqual(new Uint8Array(data));
    expect(packed).toEqual(Buffer.from(data));
    expect(packed).not.toStrictEqual(new Uint8Array(data));
    expect(packed).not.toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(new Uint8Array(packed)).toEqual(new Uint8Array(data));
    expect(Buffer.from(packed).toString("hex")).toBe("12345678");
    expect([...packed]).toEqual(data);
    expect(packed.length).toBe(4);
    expect(packed[3]).toBe(0x78);
  });

  test("64 bits are a BigInt where a number does not hold them", () => {
    expect(struct.unpack(">Q", new Uint8Array(8).fill(0xff))).toEqual([2n ** 64n - 1n]);
    expect(struct.unpack(">Q", new Uint8Array([0, 0, 0, 0, 0, 0, 0, 5]))).toEqual([5]);
    expect(struct.pack(">Q", 5n)).toEqual(struct.pack(">Q", 5));
    expect(new DataView(new Uint8Array(struct.pack(">q", -(2n ** 63n))).buffer).getBigInt64(0)).toBe(-(2n ** 63n));
  });
});
