// Translated from CPython 3.15's Lib/test/test_json: test_decode.py, test_default.py, test_dump.py,
// test_encode_basestring_ascii.py, test_enum.py, test_fail.py, test_float.py, test_indent.py, test_pass1.py, test_pass2.py,
// test_pass3.py, test_recursion.py, test_scanstring.py, test_separators.py, test_unicode.py.
// There every test runs twice, with and without the accelerator module; here once, with the `json` a program gets.
// Left out: test_speedups.py (the accelerator's own interface), test_tool.py (a command line), test_pickleable.py, the
// tests that need gigabytes, and the doctests.
import { float, kwargs } from "bun:python";
import { describe, expect, test } from "bun:test";
import {
  Ellipsis,
  NotImplemented,
  OverflowError,
  RecursionError,
  TypeError as PyTypeError,
  UnicodeDecodeError,
  ValueError,
  bool,
  complex,
  dict,
  float as pyfloat,
  frozendict,
  hasattr,
  int,
  isinstance,
  len,
  list,
  object,
  repr,
  sorted,
  str,
  tuple,
  type,
} from "python:builtins";
import codecs from "python:codecs";
import collections, { OrderedDict } from "python:collections";
import decimal from "python:decimal";
import { Enum, IntEnum } from "python:enum";
import { StringIO } from "python:io";
import json, { JSONDecodeError, dumps, loads } from "python:json";
import math from "python:math";
import { contains, getitem, ne, setitem } from "python:operator";
import sys from "python:sys";
import textwrap from "python:textwrap";
import { b, makeClass, py, raises, t } from "./helpers";

// test.support.infinite_recursion() and adjust_int_max_str_digits(), which are context managers there.
function infinite_recursion<T>(max_depth: number, body: () => T): T {
  const original = sys.getrecursionlimit();
  sys.setrecursionlimit(max_depth);
  try {
    return body();
  } finally {
    sys.setrecursionlimit(original);
  }
}

function adjust_int_max_str_digits<T>(max_digits: number, body: () => T): T {
  const original = sys.get_int_max_str_digits();
  sys.set_int_max_str_digits(max_digits);
  try {
    return body();
  } finally {
    sys.set_int_max_str_digits(original);
  }
}

describe("TestDecode", () => {
  test("test_decimal", () => {
    const rval = loads("1.1", kwargs({ parse_float: decimal.Decimal }));
    expect(rval).toBeInstanceOf(decimal.Decimal);
    expect(rval).toEqual(decimal.Decimal("1.1"));
  });

  // A whole float that is returned to JavaScript is a number, and a whole number is an int when it goes back.
  test.failing("test_float", () => {
    const rval = loads("1", kwargs({ parse_int: pyfloat }));
    expect(rval).toEqual(1.0);
    expect(isinstance(rval, pyfloat)).toBe(true);
  });

  test("test_float, in a list", () => {
    const rval = loads("[1]", kwargs({ parse_int: pyfloat }));
    expect(isinstance(rval[0], pyfloat)).toBe(true);
    expect(rval).toEqual([1.0]);
  });

  test("test_nonascii_digits_rejected", () => {
    // JSON specifies only ascii digits, see gh-125687
    for (const num of ["1\uff10", "0.\uff10", "0e\uff10"]) expect(() => loads(num)).toThrow(JSONDecodeError);
  });

  test("test_bytes", () => {
    expect(loads(b("1"))).toBe(1);
  });

  test("test_parse_constant", () => {
    for (const [constant, expected] of [
      ["Infinity", "INFINITY"],
      ["-Infinity", "-INFINITY"],
      ["NaN", "NAN"],
    ]) {
      expect(loads(constant, kwargs({ parse_constant: str.upper }))).toBe(expected);
      expect(loads(constant, kwargs({ parse_constant: (text: string) => text.toUpperCase() }))).toBe(expected);
    }
  });

  test("test_constant_invalid_case", () => {
    for (const constant of ["nan", "NAN", "naN", "infinity", "INFINITY", "inFiniTy"])
      expect(() => loads(constant)).toThrow(JSONDecodeError);
  });

  test("test_empty_objects", () => {
    expect(loads("{}")).toEqual(dict());
    expect(loads("{}")).toEqual({});
    expect(loads("[]")).toEqual([]);
    expect(loads('""')).toBe("");
  });

  test("test_object_hook", () => {
    const s = '{"a":{"b":{}}}';
    const expected_result = { a: { b: { x: 1 }, x: 1 }, x: 1 };
    const expected_hook_arguments = [{}, { b: { x: 1 } }, { a: { b: { x: 1 }, x: 1 } }];
    const hook_arguments: any[] = [];
    // What the hook returns is an object of JavaScript, and that is what the result is made of.
    const hook = (x: any) => {
      hook_arguments.push(x);
      return { ...x, x: 1 };
    };
    const result = loads(s, kwargs({ object_hook: hook }));
    expect(result).toEqual(expected_result);
    expect(hook_arguments).toEqual(expected_hook_arguments);
    expect(type(hook_arguments[0])).toBe(dict);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });

  test("test_object_pairs_hook", () => {
    const s = '{"xkd":1, "kcw":2, "art":3, "hxm":4, "qrt":5, "pad":6, "hoy":7}';
    const p = [t("xkd", 1), t("kcw", 2), t("art", 3), t("hxm", 4), t("qrt", 5), t("pad", 6), t("hoy", 7)];
    expect(loads(s)).toEqual(dict(p));
    expect(loads(s)).toEqual(JSON.parse(s));
    expect(loads(s, kwargs({ object_pairs_hook: (x: any) => x }))).toEqual(p);
    expect(json.load(StringIO(s), kwargs({ object_pairs_hook: (x: any) => x }))).toEqual(p);
    const od = loads(s, kwargs({ object_pairs_hook: OrderedDict }));
    expect(od).toEqual(OrderedDict(p));
    expect(type(od)).toBe(OrderedDict);
    // the object_pairs_hook takes priority over the object_hook
    expect(loads(s, kwargs({ object_pairs_hook: OrderedDict, object_hook: () => undefined }))).toEqual(OrderedDict(p));
    // check that empty object literals work (see #17368)
    expect(loads("{}", kwargs({ object_pairs_hook: OrderedDict }))).toEqual(OrderedDict());
    expect(loads('{"empty": {}}', kwargs({ object_pairs_hook: OrderedDict }))).toEqual(
      OrderedDict([t("empty", OrderedDict())]),
    );
  });

  test("test_array_hook", () => {
    let s = "[1, 2, 3]";
    const result = loads(s, kwargs({ array_hook: tuple }));
    expect(result).toEqual(t(1, 2, 3));
    expect(type(result)).toBe(tuple);

    // Nested array in inner structure with object_hook
    s = '{"xkd": [[1], [2], [3]]}';
    const p = frozendict(kwargs({ xkd: t(t(1), t(2), t(3)) }));
    const data = loads(s, kwargs({ object_hook: frozendict, array_hook: tuple }));
    expect(data).toEqual(p);
    expect(type(data)).toBe(frozendict);
    expect(type(data.xkd)).toBe(tuple);
    for (const item of data.xkd) expect(type(item)).toBe(tuple);

    expect(loads("[]", kwargs({ array_hook: tuple }))).toEqual(t());
  });

  test("test_load_array_hook", () => {
    // json.load must forward array_hook to loads
    const fp = StringIO("[10, 20, 30]");
    const result = json.load(fp, kwargs({ array_hook: tuple }));
    expect(result).toEqual(t(10, 20, 30));
    expect(type(result)).toBe(tuple);
  });

  test("test_decoder_optimizations", () => {
    // Several optimizations were made that skip over calls to
    // the whitespace regex, so this test is designed to try and
    // exercise the uncommon cases. The array cases are already covered.
    const rval = loads('{   "key"    :    "value"    ,  "k":"v"    }');
    expect(rval).toEqual({ key: "value", k: "v" });
  });

  test("test_keys_reuse", () => {
    const check_keys_reuse = (source: string, load: (source: string) => any) => {
      const rval = load(source);
      const [[a, b], [c, d]] = [sorted(rval[0]), sorted(rval[1])];
      expect(a).toBe(c);
      expect(b).toBe(d);
    };
    const s = '[{"a_key": 1, "b_\xe9": 2}, {"a_key": 3, "b_\xe9": 4}]';
    check_keys_reuse(s, loads);
    const decoder = json.decoder.JSONDecoder();
    check_keys_reuse(s, decoder.decode);
    expect(bool(decoder.memo)).toBe(false);
  });

  test("test_extra_data", () => {
    raises(JSONDecodeError, () => loads("[1, 2, 3]5"), "Extra data");
  });

  test("test_invalid_escape", () => {
    raises(JSONDecodeError, () => loads('["abc\\y"]'), "escape");
  });

  test("test_invalid_input_type", () => {
    const msg = "the JSON object must be str";
    for (const value of [1, 3.14, [], dict(), undefined]) raises(PyTypeError, () => loads(value), msg);
    // What JavaScript has besides.
    for (const value of [{}, null, new Map(), 1n, Symbol("s")]) raises(PyTypeError, () => loads(value), msg);
  });

  test("test_string_with_utf8_bom", () => {
    // see #18958
    const bom_json = str.encode("[1,2,3]", "utf-8-sig").decode("utf-8");
    expect(bom_json).toBe("\ufeff[1,2,3]");
    expect(raises(JSONDecodeError, () => loads(bom_json)).message).toContain("BOM");
    expect(raises(JSONDecodeError, () => json.load(StringIO(bom_json))).message).toContain("BOM");
    // make sure that the BOM is not detected in the middle of a string
    const bom = str.encode("", "utf-8-sig").decode("utf-8");
    const bom_in_str = `"${bom}"`;
    expect(loads(bom_in_str)).toBe("\ufeff");
    expect(json.load(StringIO(bom_in_str))).toBe("\ufeff");
  });

  test("test_negative_index", () => {
    const d = json.JSONDecoder();
    expect(() => d.raw_decode("a".repeat(42), -50000)).toThrow(ValueError);
  });

  test("test_unterminated_string", () => {
    const d = json.JSONDecoder();
    expect(() => d.raw_decode('"\\')).toThrow(JSONDecodeError);
  });

  test("test_limit_int", () => {
    const maxdigits = 5000;
    adjust_int_max_str_digits(maxdigits, () => {
      loads("1".repeat(maxdigits));
      expect(() => loads("1".repeat(maxdigits + 1))).toThrow(ValueError);
    });
  });

  test("test_explicit_cls_skips_json_decoder_default", () => {
    let calls = 0;
    const CustomDecoder = makeClass("CustomDecoder", [], {
      decode() {
        calls++;
      },
    });
    loads("{}", kwargs({ cls: CustomDecoder }));
    expect(calls).toBe(1);
  });
});

describe("TestDefault", () => {
  test("test_default", () => {
    expect(dumps(type, kwargs({ default: repr }))).toBe(dumps(repr(type)));
  });

  test("test_bad_default", () => {
    const fallback = (obj: any) => {
      if (obj === NotImplemented) throw new ValueError();
      if (obj === Ellipsis) return NotImplemented;
      if (obj === type) return collections;
      return [Ellipsis];
    };
    const exception = raises(ValueError, () => dumps(type, kwargs({ default: fallback })));
    expect(exception.__notes__).toEqual([
      "when serializing ellipsis object",
      "when serializing list item 0",
      "when serializing module object",
      "when serializing type object",
    ]);
  });

  test("test_ordereddict", () => {
    const od = collections.OrderedDict(kwargs({ a: 1, b: 2, c: 3, d: 4 }));
    od.move_to_end("b");
    expect(dumps(od)).toBe('{"a": 1, "c": 3, "d": 4, "b": 2}');
    expect(dumps(od, kwargs({ sort_keys: true }))).toBe('{"a": 1, "b": 2, "c": 3, "d": 4}');
  });
});

describe("TestDump", () => {
  test("test_dump", () => {
    const sio = StringIO();
    json.dump(dict(), sio);
    expect(sio.getvalue()).toBe("{}");
  });

  test("test_dumps", () => {
    expect(dumps(dict())).toBe("{}");
  });

  test("test_dumps_dict", () => {
    expect(dumps(py({ x: 1, y: 2 }))).toBe('{"x": 1, "y": 2}');
    expect(dumps(frozendict(py({ x: 1, y: 2 })))).toBe('{"x": 1, "y": 2}');
    const lst = [py({ x: 1 }), frozendict(kwargs({ y: 2 }))];
    expect(dumps(lst)).toBe('[{"x": 1}, {"y": 2}]');
    const data = py({ x: dict(kwargs({ a: 1 })), y: frozendict(kwargs({ b: 2 })) });
    expect(dumps(data)).toBe('{"x": {"a": 1}, "y": {"b": 2}}');
  });

  // An object of JavaScript is no dict, and the encoder asks isinstance(o, dict).
  test.failing("test_dumps_dict, with objects of JavaScript", () => {
    expect(dumps({ x: 1, y: 2 })).toBe('{"x": 1, "y": 2}');
  });

  test("test_dump_skipkeys", () => {
    const v = py(
      new Map<any, any>([
        [b("invalid_key"), false],
        ["valid_key", true],
      ]),
    );
    expect(() => json.dumps(v)).toThrow(PyTypeError);

    const s = json.dumps(v, kwargs({ skipkeys: true }));
    const o = json.loads(s);
    expect(contains(o, "valid_key")).toBe(true);
    expect("valid_key" in o).toBe(true);
    expect(contains(o, b("invalid_key"))).toBe(false);
  });

  test("test_dump_skipkeys_indent_empty", () => {
    const v = dict([[b("invalid_key"), false]]);
    expect(json.dumps(v, kwargs({ skipkeys: true, indent: 4 }))).toBe("{}");
  });

  test("test_skipkeys_indent", () => {
    const v = dict([
      [b("invalid_key"), false],
      ["valid_key", true],
    ]);
    expect(json.dumps(v, kwargs({ skipkeys: true, indent: 4 }))).toBe('{\n    "valid_key": true\n}');
  });

  test("test_encode_truefalse", () => {
    expect(
      dumps(
        dict([
          [true, false],
          [false, true],
        ]),
        kwargs({ sort_keys: true }),
      ),
    ).toBe('{"false": true, "true": false}');
    expect(
      dumps(
        dict([
          [2, float(3)],
          [float(4), 5],
          [false, 1],
          [6, true],
        ]),
        kwargs({ sort_keys: true }),
      ),
    ).toBe('{"false": 1, "2": 3.0, "4.0": 5, "6": true}');
  });

  // Issue 16228: Crash on encoding resized list
  test("test_encode_mutated", () => {
    const a = new Array(10).fill(object());
    const crasher = () => {
      a.pop();
    };
    expect(dumps(a, kwargs({ default: crasher }))).toBe("[null, null, null, null, null]");
  });

  // Issue 24094
  test("test_encode_evil_dict", () => {
    const L: any[] = [];
    const D = makeClass("D", [dict], {
      keys() {
        return L;
      },
    });
    const X = makeClass("X", [], {
      __hash__() {
        L.shift();
        return 1337;
      },
      __lt__() {
        return 0;
      },
    });
    for (let i = 0; i < 1122; i++) L.push(X());
    const d = D();
    setitem(d, 1337, "true.dat");
    expect(dumps(d, kwargs({ sort_keys: true }))).toBe('{"1337": "true.dat"}');
  });

  // gh-145244: UAF on borrowed key when default callback mutates dict
  test("test_default_clears_dict_key_uaf", () => {
    const Evil = makeClass("Evil", [], {});
    const AlsoEvil = makeClass("AlsoEvil", [], {});
    const target = dict([["A".repeat(100), Evil()]]);
    const evil_default = (obj: any) => {
      if (obj instanceof Evil) {
        target.clear();
        return AlsoEvil();
      }
      throw new PyTypeError("not serializable");
    };
    expect(() => json.dumps(target, kwargs({ default: evil_default, check_circular: false }))).toThrow(PyTypeError);
  });

  test("test_dumps_str_subclass", () => {
    // Don't call obj.__str__() on str subclasses

    // str subclass which returns a different string on str(obj)
    const StrSubclass = makeClass("StrSubclass", [str], {
      __str__() {
        return "StrSubclass";
      },
    });

    let obj = StrSubclass("ascii");
    expect(dumps(obj)).toBe('"ascii"');
    expect(dumps([obj])).toBe('["ascii"]');
    expect(dumps(py({ key: obj }))).toBe('{"key": "ascii"}');

    obj = StrSubclass("escape\n");
    expect(dumps(obj)).toBe('"escape\\n"');
    expect(dumps([obj])).toBe('["escape\\n"]');
    expect(dumps(py({ key: obj }))).toBe('{"key": "escape\\n"}');

    obj = StrSubclass("nonascii:é");
    expect(dumps(obj, kwargs({ ensure_ascii: false }))).toBe('"nonascii:é"');
    expect(dumps([obj], kwargs({ ensure_ascii: false }))).toBe('["nonascii:é"]');
    expect(dumps(py({ key: obj }), kwargs({ ensure_ascii: false }))).toBe('{"key": "nonascii:é"}');
    expect(dumps(obj)).toBe('"nonascii:\\u00e9"');
    expect(dumps([obj])).toBe('["nonascii:\\u00e9"]');
    expect(dumps(py({ key: obj }))).toBe('{"key": "nonascii:\\u00e9"}');
  });
});

describe("TestEncodeBasestringAscii", () => {
  // str subclass which returns a different string on str(obj)
  const StrSubclass = makeClass("StrSubclass", [str], {
    __str__() {
      return "StrSubclass";
    },
  });

  const CASES = [
    [
      "/\\\"\ucafe\ubabe\uab98\ufcde\ubcda\uef4a\x08\x0c\n\r\t`1~!@#$%^&*()_+-=[]{}|;:',./<>?",
      '"/\\\\\\"\\ucafe\\ubabe\\uab98\\ufcde\\ubcda\\uef4a\\b\\f\\n\\r\\t`1~!@#$%^&*()_+-=[]{}|;:\',./<>?"',
    ],
    ["\u0123\u4567\u89ab\ucdef\uabcd\uef4a", '"\\u0123\\u4567\\u89ab\\ucdef\\uabcd\\uef4a"'],
    ["controls", '"controls"'],
    ["\x08\x0c\n\r\t", '"\\b\\f\\n\\r\\t"'],
    ["\x00\x1f\x7f", '"\\u0000\\u001f\\u007f"'],
    [
      '{"object with 1 member":["array with 1 element"]}',
      '"{\\"object with 1 member\\":[\\"array with 1 element\\"]}"',
    ],
    [" s p a c e d ", '" s p a c e d "'],
    ["\u{1d120}", '"\\ud834\\udd20"'],
    ["\u03b1\u03a9", '"\\u03b1\\u03a9"'],
    ["`1~!@#$%^&*()_+-={':[,]}|;.</>?", '"`1~!@#$%^&*()_+-={\':[,]}|;.</>?"'],
    // Don't call obj.__str__() on str subclasses
    [StrSubclass("ascii"), '"ascii"'],
  ];

  test("test_encode_basestring_ascii", () => {
    for (const [input_string, expected] of CASES)
      expect(json.encoder.encode_basestring_ascii(input_string)).toBe(expected);
  });

  test("test_ordered_dict", () => {
    // See issue 6105
    const items = [t("one", 1), t("two", 2), t("three", 3), t("four", 4), t("five", 5)];
    expect(dumps(OrderedDict(items))).toBe('{"one": 1, "two": 2, "three": 3, "four": 4, "five": 5}');
  });

  test("test_sorted_dict", () => {
    const items = [t("one", 1), t("two", 2), t("three", 3), t("four", 4), t("five", 5)];
    expect(dumps(dict(items), kwargs({ sort_keys: true }))).toBe(
      '{"five": 5, "four": 4, "one": 1, "three": 3, "two": 2}',
    );
  });
});

describe("TestEnum", () => {
  const SMALL = 1;
  const BIG = 2 ** 32;
  const HUGE = 1n << 64n;
  const REALLY_HUGE = 1n << 96n;
  const BigNum = IntEnum("BigNum", py({ small: SMALL, big: BIG, huge: HUGE, really_huge: REALLY_HUGE }));

  const E = 2.718281;
  const PI = 3.141593;
  const TAU = 2 * PI;
  const FloatNum = Enum("FloatNum", py({ e: E, pi: PI, tau: TAU }), kwargs({ type: pyfloat }));

  const INF = Infinity;
  const NEG_INF = -Infinity;
  const NAN = NaN;
  const WeirdNum = Enum("WeirdNum", py({ inf: INF, neg_inf: NEG_INF, nan: NAN }), kwargs({ type: pyfloat }));

  const StringEnum = Enum("StringEnum", py({ COLOR: "color" }), kwargs({ type: str }));

  test("test_floats", () => {
    for (const member of FloatNum) {
      expect(dumps(member)).toBe(repr(member.value));
      expect(pyfloat(dumps(member))).toEqual(member);
      expect(loads(dumps(member))).toEqual(member);
    }
  });

  test("test_weird_floats", () => {
    const expected = ["Infinity", "-Infinity", "NaN"];
    for (const [i, member] of [...WeirdNum].entries()) {
      expect(dumps(member)).toBe(expected[i]);
      if (!math.isnan(member)) {
        expect(pyfloat(dumps(member))).toEqual(member);
        expect(loads(dumps(member))).toEqual(member);
      } else {
        expect(pyfloat(dumps(member))).toBeNaN();
        expect(loads(dumps(member))).toBeNaN();
      }
    }
  });

  test("test_ints", () => {
    for (const member of BigNum) {
      expect(dumps(member)).toBe(str(member.value));
      expect(int(dumps(member))).toEqual(member);
      expect(loads(dumps(member))).toEqual(member);
    }
  });

  test("test_list", () => {
    expect(dumps(list(BigNum))).toBe(str([SMALL, BIG, HUGE, REALLY_HUGE]));
    expect(loads(dumps(list(BigNum)))).toEqual(list(BigNum));
    expect(dumps(list(FloatNum))).toBe(str([E, PI, TAU]));
    expect(loads(dumps(list(FloatNum)))).toEqual(list(FloatNum));
    expect(dumps(list(WeirdNum))).toBe("[Infinity, -Infinity, NaN]");
    expect(loads(dumps(list(WeirdNum))).slice(0, 2)).toEqual(list(WeirdNum).slice(0, 2));
    // A NaN that Python made is an object while it is in a container: Python tells one NaN from another.
    expect(Number(loads(dumps(list(WeirdNum)))[2])).toBeNaN();
    expect(math.isnan(loads(dumps(list(WeirdNum)))[2])).toBe(true);
  });

  test("test_dict_keys", () => {
    const [s, big, h, r] = BigNum;
    const [e, p, tau] = FloatNum;
    const [i, j, n] = WeirdNum;
    const d = dict([
      [s, "tiny"],
      [big, "large"],
      [h, "larger"],
      [r, "largest"],
      [e, "Euler's number"],
      [p, "pi"],
      [tau, "tau"],
      [i, "Infinity"],
      [j, "-Infinity"],
      [n, "NaN"],
    ]);
    const nd = loads(dumps(d));
    // nd["1"] in JavaScript asks for the key 1, an int: a property whose name is a number is an index.
    expect(getitem(nd, str(SMALL))).toBe("tiny");
    expect(getitem(nd, str(BIG))).toBe("large");
    expect(nd[str(HUGE)]).toBe("larger");
    expect(nd[str(REALLY_HUGE)]).toBe("largest");
    expect(nd[repr(E)]).toBe("Euler's number");
    expect(nd[repr(PI)]).toBe("pi");
    expect(nd[repr(TAU)]).toBe("tau");
    expect(nd["Infinity"]).toBe("Infinity");
    expect(nd["-Infinity"]).toBe("-Infinity");
    expect(nd["NaN"]).toBe("NaN");
  });

  test("test_dict_values", () => {
    const d = dict(
      kwargs({
        tiny: BigNum.small,
        large: BigNum.big,
        larger: BigNum.huge,
        largest: BigNum.really_huge,
        e: FloatNum.e,
        pi: FloatNum.pi,
        tau: FloatNum.tau,
        i: WeirdNum.inf,
        j: WeirdNum.neg_inf,
        n: WeirdNum.nan,
      }),
    );
    const nd = loads(dumps(d));
    expect(nd.tiny).toBe(SMALL);
    expect(nd.large).toBe(BIG);
    expect(nd.larger).toBe(HUGE);
    expect(nd.largest).toBe(REALLY_HUGE);
    expect(nd.e).toBe(E);
    expect(nd.pi).toBe(PI);
    expect(nd.tau).toBe(TAU);
    expect(nd.i).toBe(INF);
    expect(nd.j).toBe(NEG_INF);
    expect(nd.n).toBeNaN();
  });

  test("test_str_enum", () => {
    const obj = StringEnum.COLOR;
    expect(dumps(obj)).toBe('"color"');
    expect(dumps([obj])).toBe('["color"]');
    expect(dumps(py({ key: obj }))).toBe('{"key": "color"}');
  });
});

describe("TestFail", () => {
  // 2007-10-05
  const JSONDOCS = [
    // https://json.org/JSON_checker/test/fail1.json
    '"A JSON payload should be an object or array, not a string."',
    // https://json.org/JSON_checker/test/fail2.json
    '["Unclosed array"',
    // https://json.org/JSON_checker/test/fail3.json
    '{unquoted_key: "keys must be quoted"}',
    // https://json.org/JSON_checker/test/fail4.json
    '["extra comma",]',
    // https://json.org/JSON_checker/test/fail5.json
    '["double extra comma",,]',
    // https://json.org/JSON_checker/test/fail6.json
    '[   , "<-- missing value"]',
    // https://json.org/JSON_checker/test/fail7.json
    '["Comma after the close"],',
    // https://json.org/JSON_checker/test/fail8.json
    '["Extra close"]]',
    // https://json.org/JSON_checker/test/fail9.json
    '{"Extra comma": true,}',
    // https://json.org/JSON_checker/test/fail10.json
    '{"Extra value after close": true} "misplaced quoted value"',
    // https://json.org/JSON_checker/test/fail11.json
    '{"Illegal expression": 1 + 2}',
    // https://json.org/JSON_checker/test/fail12.json
    '{"Illegal invocation": alert()}',
    // https://json.org/JSON_checker/test/fail13.json
    '{"Numbers cannot have leading zeroes": 013}',
    // https://json.org/JSON_checker/test/fail14.json
    '{"Numbers cannot be hex": 0x14}',
    // https://json.org/JSON_checker/test/fail15.json
    '["Illegal backslash escape: \\x15"]',
    // https://json.org/JSON_checker/test/fail16.json
    "[\\naked]",
    // https://json.org/JSON_checker/test/fail17.json
    '["Illegal backslash escape: \\017"]',
    // https://json.org/JSON_checker/test/fail18.json
    '[[[[[[[[[[[[[[[[[[[["Too deep"]]]]]]]]]]]]]]]]]]]]',
    // https://json.org/JSON_checker/test/fail19.json
    '{"Missing colon" null}',
    // https://json.org/JSON_checker/test/fail20.json
    '{"Double colon":: null}',
    // https://json.org/JSON_checker/test/fail21.json
    '{"Comma instead of colon", null}',
    // https://json.org/JSON_checker/test/fail22.json
    '["Colon instead of comma": false]',
    // https://json.org/JSON_checker/test/fail23.json
    '["Bad value", truth]',
    // https://json.org/JSON_checker/test/fail24.json
    "['single quote']",
    // https://json.org/JSON_checker/test/fail25.json
    '["\ttab\tcharacter\tin\tstring\t"]',
    // https://json.org/JSON_checker/test/fail26.json
    '["tab\\   character\\   in\\  string\\  "]',
    // https://json.org/JSON_checker/test/fail27.json
    '["line\nbreak"]',
    // https://json.org/JSON_checker/test/fail28.json
    '["line\\\nbreak"]',
    // https://json.org/JSON_checker/test/fail29.json
    "[0e]",
    // https://json.org/JSON_checker/test/fail30.json
    "[0e+]",
    // https://json.org/JSON_checker/test/fail31.json
    "[0e+-1]",
    // https://json.org/JSON_checker/test/fail32.json
    '{"Comma instead if closing brace": true,',
    // https://json.org/JSON_checker/test/fail33.json
    '["mismatch"}',
    // https://code.google.com/archive/p/simplejson/issues/3
    '["A\u001FZ control characters in string"]',
  ];

  const SKIPS = new Map([
    [1, "why not have a string payload?"],
    [18, "spec doesn't specify any nesting limitations"],
  ]);

  test("test_failures", () => {
    for (const [i, doc] of JSONDOCS.entries()) {
      if (SKIPS.has(i + 1)) loads(doc);
      else expect(() => loads(doc)).toThrow(JSONDecodeError);
    }
  });

  test("test_non_string_keys_dict", () => {
    const data = dict([
      ["a", 1],
      [t(1, 2), 2],
    ]);
    raises(PyTypeError, () => dumps(data), "keys must be str, int, float, bool or None, not tuple");
  });

  test("test_not_serializable", () => {
    let exception = raises(PyTypeError, () => dumps(sys), "Object of type module is not JSON serializable");
    expect(hasattr(exception, "__notes__")).toBe(false);
    expect(exception.__notes__).toBeUndefined();

    exception = raises(PyTypeError, () => dumps([1, [2, 3, sys]]));
    expect(exception.__notes__).toEqual(["when serializing list item 2", "when serializing list item 1"]);

    exception = raises(PyTypeError, () => dumps(t(1, t(2, 3, sys))));
    expect(exception.__notes__).toEqual(["when serializing tuple item 2", "when serializing tuple item 1"]);

    exception = raises(PyTypeError, () => dumps(py({ a: { b: sys } })));
    expect(exception.__notes__).toEqual(["when serializing dict item 'b'", "when serializing dict item 'a'"]);
  });

  function checkErrors(test_cases: [string, string, number][]) {
    for (const [data, msg, idx] of test_cases) {
      const err = raises(JSONDecodeError, () => loads(data));
      expect(err.msg).toBe(msg);
      expect(err.pos).toBe(idx);
      expect(err.lineno).toBe(1);
      expect(err.colno).toBe(idx + 1);
      expect(str(err)).toBe(`${msg}: line 1 column ${idx + 1} (char ${idx})`);
      expect(err.message).toBe(str(err));
    }
  }

  test("test_truncated_input", () => {
    checkErrors([
      ["", "Expecting value", 0],
      ["[", "Expecting value", 1],
      ["[42", "Expecting ',' delimiter", 3],
      ["[42,", "Expecting value", 4],
      ['["', "Unterminated string starting at", 1],
      ['["spam', "Unterminated string starting at", 1],
      ['["spam"', "Expecting ',' delimiter", 7],
      ['["spam",', "Expecting value", 8],
      ["{", "Expecting property name enclosed in double quotes", 1],
      ['{"', "Unterminated string starting at", 1],
      ['{"spam', "Unterminated string starting at", 1],
      ['{"spam"', "Expecting ':' delimiter", 7],
      ['{"spam":', "Expecting value", 8],
      ['{"spam":42', "Expecting ',' delimiter", 10],
      ['{"spam":42,', "Expecting property name enclosed in double quotes", 11],
      ['"', "Unterminated string starting at", 0],
      ['"spam', "Unterminated string starting at", 0],
      // A complete \uXXXX escape at end of input leaves it unterminated.
      ['"\\u0041', "Unterminated string starting at", 0],
      ['"\\ud834', "Unterminated string starting at", 0],
      ['"\\ud834\\udd1e', "Unterminated string starting at", 0],
      ['{"a": "\\u0041', "Unterminated string starting at", 6],
    ]);
  });

  test("test_unexpected_data", () => {
    checkErrors([
      ["[,", "Expecting value", 1],
      ['{"spam":[}', "Expecting value", 9],
      ["[42:", "Expecting ',' delimiter", 3],
      ['[42 "spam"', "Expecting ',' delimiter", 4],
      ["[42,]", "Illegal trailing comma before end of array", 3],
      ['{"spam":[42}', "Expecting ',' delimiter", 11],
      ['["]', "Unterminated string starting at", 1],
      ['["spam":', "Expecting ',' delimiter", 7],
      ['["spam",]', "Illegal trailing comma before end of array", 7],
      ["{:", "Expecting property name enclosed in double quotes", 1],
      ["{,", "Expecting property name enclosed in double quotes", 1],
      ["{42", "Expecting property name enclosed in double quotes", 1],
      ["[{]", "Expecting property name enclosed in double quotes", 2],
      ['{"spam",', "Expecting ':' delimiter", 7],
      ['{"spam"}', "Expecting ':' delimiter", 7],
      ['[{"spam"]', "Expecting ':' delimiter", 8],
      ['{"spam":}', "Expecting value", 8],
      ['[{"spam":]', "Expecting value", 9],
      ['{"spam":42 "ham"', "Expecting ',' delimiter", 11],
      ['[{"spam":42]', "Expecting ',' delimiter", 11],
      ['{"spam":42,}', "Illegal trailing comma before end of object", 10],
      ['{"spam":42 , }', "Illegal trailing comma before end of object", 11],
      ["[123  , ]", "Illegal trailing comma before end of array", 6],
    ]);
  });

  test("test_extra_data", () => {
    checkErrors([
      ["[]]", "Extra data", 2],
      ["{}}", "Extra data", 2],
      ["[],[]", "Extra data", 2],
      ["{},{}", "Extra data", 2],
      ['42,"spam"', "Extra data", 2],
      ['"spam",42', "Extra data", 6],
    ]);
  });

  test("test_linecol", () => {
    const test_cases: [string, number, number, number][] = [
      ["!", 1, 1, 0],
      [" !", 1, 2, 1],
      ["\n!", 2, 1, 1],
      ["\n  \n\n     !", 4, 6, 10],
    ];
    for (const [data, line, col, idx] of test_cases) {
      const err = raises(JSONDecodeError, () => loads(data));
      expect(err.msg).toBe("Expecting value");
      expect(err.pos).toBe(idx);
      expect(err.lineno).toBe(line);
      expect(err.colno).toBe(col);
      expect(str(err)).toBe(`Expecting value: line ${line} column ${col} (char ${idx})`);
    }
  });
});

describe("TestFloat", () => {
  test("test_floats", () => {
    for (const num of [1617161771.7650001, math.pi, math.pi ** 100, math.pi ** -100, 3.1]) {
      expect(pyfloat(dumps(num))).toBe(num);
      expect(loads(dumps(num))).toBe(num);
    }
  });

  test("test_ints", () => {
    for (const num of [1, 2 ** 32, 1n << 64n]) {
      expect(dumps(num)).toBe(str(num));
      expect(dumps(num)).toBe(String(num));
      expect(int(dumps(num))).toBe(num);
    }
  });

  test("test_out_of_range", () => {
    expect(loads("[23456789012E666]")).toEqual([Infinity]);
    expect(loads("[-23456789012E666]")).toEqual([-Infinity]);
  });

  test("test_allow_nan", () => {
    for (const val of [Infinity, -Infinity, NaN]) {
      const out = dumps([val]);
      if (val === val) {
        // inf
        expect(loads(out)).toEqual([val]);
      } else {
        // nan
        const res = loads(out);
        expect(len(res)).toBe(1);
        expect(ne(res[0], res[0])).toBe(true);
      }
      const msg = `Out of range float values are not JSON compliant: ${str(val)}`;
      raises(ValueError, () => dumps([val], kwargs({ allow_nan: false })), msg);
    }
  });
});

describe("TestIndent", () => {
  test("test_indent", () => {
    const h = py([
      ["blorpie"],
      ["whoops"],
      [],
      "d-shtaeou",
      "d-nthiouh",
      "i-vhbjkhnth",
      { nifty: 87 },
      { field: "yes", morefield: false },
    ]);

    const expected = textwrap.dedent(`\
        [
        \t[
        \t\t"blorpie"
        \t],
        \t[
        \t\t"whoops"
        \t],
        \t[],
        \t"d-shtaeou",
        \t"d-nthiouh",
        \t"i-vhbjkhnth",
        \t{
        \t\t"nifty": 87
        \t},
        \t{
        \t\t"field": "yes",
        \t\t"morefield": false
        \t}
        ]`);

    const d1 = dumps(h);
    const d2 = dumps(h, kwargs({ indent: 2, sort_keys: true, separators: t(",", ": ") }));
    const d3 = dumps(h, kwargs({ indent: "\t", sort_keys: true, separators: t(",", ": ") }));
    const d4 = dumps(h, kwargs({ indent: 2, sort_keys: true }));
    const d5 = dumps(h, kwargs({ indent: "\t", sort_keys: true }));

    const h1 = loads(d1);
    const h2 = loads(d2);
    const h3 = loads(d3);

    expect(h1).toEqual(h);
    expect(h2).toEqual(h);
    expect(h3).toEqual(h);
    expect(d2).toBe(str.expandtabs(expected, 2));
    expect(d3).toBe(expected);
    expect(d4).toBe(d2);
    expect(d5).toBe(d3);
  });

  test("test_indent0", () => {
    const h = dict([[3, 1]]);
    const check = (indent: number | undefined, expected: string) => {
      const d1 = dumps(h, kwargs({ indent }));
      expect(d1).toBe(expected);

      const sio = StringIO();
      json.dump(h, sio, kwargs({ indent }));
      expect(sio.getvalue()).toBe(expected);
    };

    // indent=0 should emit newlines
    check(0, '{\n"3": 1\n}');
    // indent=None is more compact
    check(undefined, '{"3": 1}');
  });
});

describe("TestPass", () => {
  // from https://json.org/JSON_checker/test/pass1.json
  const PASS1 = String.raw`
[
    "JSON Test Pattern pass1",
    {"object with 1 member":["array with 1 element"]},
    {},
    [],
    -42,
    true,
    false,
    null,
    {
        "integer": 1234567890,
        "real": -9876.543210,
        "e": 0.123456789e-12,
        "E": 1.234567890E+34,
        "":  23456789012E66,
        "zero": 0,
        "one": 1,
        "space": " ",
        "quote": "\"",
        "backslash": "\\",
        "controls": "\b\f\n\r\t",
        "slash": "/ & \/",
        "alpha": "abcdefghijklmnopqrstuvwyz",
        "ALPHA": "ABCDEFGHIJKLMNOPQRSTUVWYZ",
        "digit": "0123456789",
        "0123456789": "digit",
        "special": "${"`"}1~!@#$%^&*()_+-={':[,]}|;.</>?",
        "hex": "\u0123\u4567\u89AB\uCDEF\uabcd\uef4A",
        "true": true,
        "false": false,
        "null": null,
        "array":[  ],
        "object":{  },
        "address": "50 St. James Street",
        "url": "http://www.JSON.org/",
        "comment": "// /* <!-- --",
        "# -- --> */": " ",
        " s p a c e d " :[1,2 , 3

,

4 , 5        ,          6           ,7        ],"compact":[1,2,3,4,5,6,7],
        "jsontext": "{\"object with 1 member\":[\"array with 1 element\"]}",
        "quotes": "&#34; \u0022 %22 0x22 034 &#x22;",
        "\/\\\"\uCAFE\uBABE\uAB98\uFCDE\ubcda\uef4A\b\f\n\r\t${"`"}1~!@#$%^&*()_+-=[]{}|;:',./<>?"
: "A key can be any string"
    },
    0.5 ,98.6
,
99.44
,

1066,
1e1,
0.1e1,
1e-1,
1e00,2e+00,2e-00
,"rosebud"]
`;

  // from https://json.org/JSON_checker/test/pass2.json
  const PASS2 = `
[[[[[[[[[[[[[[[[[[["Not too deep"]]]]]]]]]]]]]]]]]]]
`;

  // from https://json.org/JSON_checker/test/pass3.json
  const PASS3 = `
{
    "JSON Test Pattern pass3": {
        "The outermost value": "must be an object or array.",
        "In this test": "It is an object."
    }
}
`;

  test.each([
    ["TestPass1", PASS1],
    ["TestPass2", PASS2],
    ["TestPass3", PASS3],
  ])("%s.test_parse", (_, JSON_) => {
    // test in/out equivalence and parsing
    const res = loads(JSON_);
    const out = dumps(res);
    expect(res).toEqual(loads(out));
  });

  test("what Python parses is what JavaScript parses, but for None", () => {
    for (const text of [PASS2, PASS3]) expect(loads(text)).toEqual(JSON.parse(text));
    expect(JSON.parse(JSON.stringify(loads(PASS3)))).toEqual(JSON.parse(PASS3));
  });
});

describe("TestRecursion", () => {
  const JSONTestObject = makeClass("JSONTestObject", [], {});

  test("test_listrecursion", () => {
    let x: any[] = [];
    x.push(x);
    expect(raises(ValueError, () => dumps(x)).__notes__).toEqual(["when serializing list item 0"]);
    x = [];
    let y = [x];
    x.push(y);
    expect(raises(ValueError, () => dumps(x)).__notes__).toEqual([
      "when serializing list item 0",
      "when serializing list item 0",
    ]);
    y = [];
    x = [y, y];
    // ensure that the marker is cleared
    dumps(x);
  });

  test("test_dictrecursion", () => {
    let x = dict();
    x.test = x;
    expect(raises(ValueError, () => dumps(x)).__notes__).toEqual(["when serializing dict item 'test'"]);
    x = dict();
    const y = py({ a: x, b: x });
    // ensure that the marker is cleared
    dumps(x);
    dumps(y);
  });

  test("test_defaultrecursion", () => {
    const RecursiveJSONEncoder = makeClass("RecursiveJSONEncoder", [json.JSONEncoder], {
      recurse: false,
      default(o: any) {
        if (o === JSONTestObject) {
          if (this.recurse) return [JSONTestObject];
          return "JSONTestObject";
        }
        return json.JSONEncoder.default(o);
      },
    });

    const enc = RecursiveJSONEncoder();
    expect(enc.encode(JSONTestObject)).toBe('"JSONTestObject"');
    enc.recurse = true;
    expect(raises(ValueError, () => enc.encode(JSONTestObject)).__notes__).toEqual([
      "when serializing list item 0",
      "when serializing type object",
    ]);
  });

  test("test_highly_nested_objects_decoding", () => {
    const very_deep = 500_000;
    const times = (text: string) => Buffer.alloc(text.length * very_deep, text).toString();
    // test that loading highly-nested objects doesn't segfault when C
    // accelerations are used. See #12017
    expect(() => infinite_recursion(20_000, () => loads(times('{"a":') + "1" + times("}")))).toThrow(RecursionError);
    expect(() => infinite_recursion(20_000, () => loads(times('{"a":') + "[1]" + times("}")))).toThrow(
      RecursionError,
    );
    expect(() => infinite_recursion(20_000, () => loads(times("[") + "1" + times("]")))).toThrow(RecursionError);
  });

  test("test_highly_nested_objects_encoding", () => {
    // See issue gh-56260
    const max_depth = 2_000;
    let l: any = [];
    let d: any = dict();
    for (let x = 0; x < max_depth * 10; x++) {
      l = [l];
      d = dict([["k", d]]);
    }
    // There, too, a RecursionError is allowed and not asked for.
    for (const deep of [l, d]) {
      try {
        infinite_recursion(max_depth, () => dumps(deep));
      } catch (error) {
        expect(error).toBeInstanceOf(RecursionError);
      }
    }
  });

  test("test_endless_recursion", () => {
    // See issue gh-56260
    const EndlessJSONEncoder = makeClass("EndlessJSONEncoder", [json.JSONEncoder], {
      // If check_circular is False, this will keep adding another list.
      default(o: any) {
        return [o];
      },
    });
    expect(() =>
      infinite_recursion(1000, () => EndlessJSONEncoder(kwargs({ check_circular: false })).encode(complex(0, 5))),
    ).toThrow(RecursionError);
  });
});

describe("TestScanstring", () => {
  const scanstring = json.decoder.scanstring;

  test("test_scanstring", () => {
    expect(scanstring('"z\u{1d120}x"', 1, true)).toEqual(t("z\u{1d120}x", 5));
    expect(scanstring('"\\u007b"', 1, true)).toEqual(t("{", 8));
    expect(scanstring('"A JSON payload should be an object or array, not a string."', 1, true)).toEqual(
      t("A JSON payload should be an object or array, not a string.", 60),
    );
    expect(scanstring('["Unclosed array"', 2, true)).toEqual(t("Unclosed array", 17));
    expect(scanstring('["extra comma",]', 2, true)).toEqual(t("extra comma", 14));
    expect(scanstring('["double extra comma",,]', 2, true)).toEqual(t("double extra comma", 21));
    expect(scanstring('["Comma after the close"],', 2, true)).toEqual(t("Comma after the close", 24));
    expect(scanstring('["Extra close"]]', 2, true)).toEqual(t("Extra close", 14));
    expect(scanstring('{"Extra comma": true,}', 2, true)).toEqual(t("Extra comma", 14));
    expect(scanstring('{"Extra value after close": true} "misplaced quoted value"', 2, true)).toEqual(
      t("Extra value after close", 26),
    );
    expect(scanstring('{"Illegal expression": 1 + 2}', 2, true)).toEqual(t("Illegal expression", 21));
    expect(scanstring('{"Illegal invocation": alert()}', 2, true)).toEqual(t("Illegal invocation", 21));
    expect(scanstring('{"Numbers cannot have leading zeroes": 013}', 2, true)).toEqual(
      t("Numbers cannot have leading zeroes", 37),
    );
    expect(scanstring('{"Numbers cannot be hex": 0x14}', 2, true)).toEqual(t("Numbers cannot be hex", 24));
    expect(scanstring('[[[[[[[[[[[[[[[[[[[["Too deep"]]]]]]]]]]]]]]]]]]]]', 21, true)).toEqual(t("Too deep", 30));
    expect(scanstring('{"Missing colon" null}', 2, true)).toEqual(t("Missing colon", 16));
    expect(scanstring('{"Double colon":: null}', 2, true)).toEqual(t("Double colon", 15));
    expect(scanstring('{"Comma instead of colon", null}', 2, true)).toEqual(t("Comma instead of colon", 25));
    expect(scanstring('["Colon instead of comma": false]', 2, true)).toEqual(t("Colon instead of comma", 25));
    expect(scanstring('["Bad value", truth]', 2, true)).toEqual(t("Bad value", 12));
    // A tuple equals an array with the same items, unless the comparison is strict.
    expect(scanstring('["Bad value", truth]', 2, true)).toEqual(["Bad value", 12]);
    expect(scanstring('["Bad value", truth]', 2, true)).not.toStrictEqual(["Bad value", 12]);
  });

  test("test_surrogates", () => {
    const assertScan = (given: string, expected: string) => {
      expect(scanstring(given, 1, true)).toEqual(t(expected, len(given)));
    };
    assertScan('"z\\ud834\\u0079x"', "z\ud834yx");
    assertScan('"z\\ud834\\udd20x"', "z\u{1d120}x");
    assertScan('"z\\ud834\\ud834\\udd20x"', "z\ud834\u{1d120}x");
    assertScan('"z\\ud834x"', "z\ud834x");
    assertScan('"z\\ud834\udd20x12345"', "z\ud834\udd20x12345");
    assertScan('"z\\udd20x"', "z\udd20x");
    assertScan('"z\ud834\udd20x"', "z\ud834\udd20x");
    assertScan('"z\ud834\\udd20x"', "z\ud834\udd20x");
    assertScan('"z\ud834x"', "z\ud834x");
  });

  test("test_bad_escapes", () => {
    const bad_escapes = [
      '"\\"',
      '"\\x"',
      '"\\u"',
      '"\\u0"',
      '"\\u01"',
      '"\\u012"',
      '"\\uz012"',
      '"\\u0z12"',
      '"\\u01z2"',
      '"\\u012z"',
      '"\\u0x12"',
      '"\\u0X12"',
      '"\\u{0}"'.replace("{0}", "\uff10".repeat(4)),
      '"\\u 123"',
      '"\\u-123"',
      '"\\u+123"',
      '"\\u1_23"',
      '"\\ud834\\"',
      '"\\ud834\\u"',
      '"\\ud834\\ud"',
      '"\\ud834\\udd"',
      '"\\ud834\\udd2"',
      '"\\ud834\\uzdd2"',
      '"\\ud834\\udzd2"',
      '"\\ud834\\uddz2"',
      '"\\ud834\\udd2z"',
      '"\\ud834\\u0x20"',
      '"\\ud834\\u0X20"',
      '"\\ud834\\u{0}"'.replace("{0}", "\uff10".repeat(4)),
      '"\\ud834\\u 123"',
      '"\\ud834\\u-123"',
      '"\\ud834\\u+123"',
      '"\\ud834\\u1_23"',
      // Truncated or non-hex \\uXXXX escape at end of input.
      '"\\u004',
      '"\\uXYZW',
    ];
    for (const s of bad_escapes) expect(() => scanstring(s, 1, true)).toThrow(JSONDecodeError);
  });

  test("test_overflow", () => {
    expect(() => scanstring("xxx", sys.maxsize + 1n)).toThrow(OverflowError);
  });
});

describe("TestSeparators", () => {
  test("test_separators", () => {
    const h = py([
      ["blorpie"],
      ["whoops"],
      [],
      "d-shtaeou",
      "d-nthiouh",
      "i-vhbjkhnth",
      { nifty: 87 },
      { field: "yes", morefield: false },
    ]);

    const expected = textwrap.dedent(`\
        [
          [
            "blorpie"
          ] ,
          [
            "whoops"
          ] ,
          [] ,
          "d-shtaeou" ,
          "d-nthiouh" ,
          "i-vhbjkhnth" ,
          {
            "nifty" : 87
          } ,
          {
            "field" : "yes" ,
            "morefield" : false
          }
        ]`);

    const d1 = dumps(h);
    const d2 = dumps(h, kwargs({ indent: 2, sort_keys: true, separators: t(" ,", " : ") }));

    const h1 = loads(d1);
    const h2 = loads(d2);

    expect(h1).toEqual(h);
    expect(h2).toEqual(h);
    expect(d2).toBe(expected);
    // The two are unpacked, so an array does as well.
    expect(dumps(h, kwargs({ indent: 2, sort_keys: true, separators: [" ,", " : "] }))).toBe(expected);
  });

  test("test_illegal_separators", () => {
    const h = dict([
      [1, 2],
      [3, 4],
    ]);
    expect(() => dumps(h, kwargs({ separators: t(b(", "), ": ") }))).toThrow(PyTypeError);
    expect(() => dumps(h, kwargs({ separators: t(", ", b(": ")) }))).toThrow(PyTypeError);
    expect(() => dumps(h, kwargs({ separators: t(b(", "), b(": ")) }))).toThrow(PyTypeError);
  });
});

describe("TestUnicode", () => {
  const u = "\u03b1\u03a9"; // GREEK SMALL LETTER ALPHA, GREEK CAPITAL LETTER OMEGA

  test("test_encoding3", () => {
    expect(dumps(u)).toBe('"\\u03b1\\u03a9"');
  });

  test("test_encoding4", () => {
    expect(dumps([u])).toBe('["\\u03b1\\u03a9"]');
  });

  test("test_encoding5", () => {
    expect(dumps(u, kwargs({ ensure_ascii: false }))).toBe(`"${u}"`);
  });

  test("test_encoding6", () => {
    expect(dumps([u], kwargs({ ensure_ascii: false }))).toBe(`["${u}"]`);
  });

  test("test_encoding7", () => {
    expect(dumps(u + "\n", kwargs({ ensure_ascii: false }))).toBe(`"${u}\\n"`);
  });

  test("test_ascii_non_printable_encode", () => {
    const u = "\b\t\n\f\r\x00\x1f\x7f";
    expect(dumps(u)).toBe('"\\b\\t\\n\\f\\r\\u0000\\u001f\\u007f"');
    expect(dumps(u, kwargs({ ensure_ascii: false }))).toBe('"\\b\\t\\n\\f\\r\\u0000\\u001f\x7f"');
  });

  test("test_ascii_non_printable_decode", () => {
    expect(loads('"\\b\\t\\n\\f\\r"')).toBe("\b\t\n\f\r");
    const s = Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)).join("");
    for (const c of s) {
      const error = raises(JSONDecodeError, () => loads(`"a${c}b"`));
      expect(error.pos).toBe(2);
      expect(error.lineno).toBe(1);
      expect(error.colno).toBe(3);
    }
    expect(loads(`"${s}"`, kwargs({ strict: false }))).toBe(s);
    expect(loads('"\x7f"')).toBe("\x7f");
  });

  test("test_escaped_decode", () => {
    expect(loads('"\\b\\t\\n\\f\\r"')).toBe("\b\t\n\f\r");
    expect(loads('"\\"\\\\\\/"')).toBe('"\\/');
    for (let i = 0; i < 0x100; i++) {
      const c = String.fromCharCode(i);
      if ('"\\/bfnrt'.includes(c)) continue;
      expect(() => loads(`"\\${c}"`)).toThrow(JSONDecodeError);
      expect(() => loads(`"\\${c}"`, kwargs({ strict: false }))).toThrow(JSONDecodeError);
    }
  });

  test("test_big_unicode_encode", () => {
    const u = "\u{1d120}";
    expect(dumps(u)).toBe('"\\ud834\\udd20"');
    expect(dumps(u, kwargs({ ensure_ascii: false }))).toBe('"\u{1d120}"');
  });

  test("test_big_unicode_decode", () => {
    const u = "z\u{1d120}x";
    expect(loads(`"${u}"`)).toBe(u);
    expect(loads('"z\\ud834\\udd20x"')).toBe(u);
  });

  test("test_unicode_decode", () => {
    // Every 16th of the 55,295 there: a debug build takes a second for a few thousand calls.
    for (let i = 0; i < 0xd7ff; i += 16) {
      const u = String.fromCharCode(i);
      const s = `"\\u${i.toString(16).padStart(4, "0")}"`;
      expect(loads(s)).toBe(u);
    }
  });

  test("test_single_surrogate_encode", () => {
    expect(dumps("\uD83D")).toBe('"\\ud83d"');
    expect(dumps("\uD83D", kwargs({ ensure_ascii: false }))).toBe('"\ud83d"');
    expect(dumps("\uDC0D")).toBe('"\\udc0d"');
    expect(dumps("\uDC0D", kwargs({ ensure_ascii: false }))).toBe('"\udc0d"');
  });

  test("test_single_surrogate_decode", () => {
    expect(loads('"\uD83D"')).toBe("\ud83d");
    expect(loads('"\\uD83D"')).toBe("\ud83d");
    expect(loads('"\udc0d"')).toBe("\udc0d");
    expect(loads('"\\udc0d"')).toBe("\udc0d");
  });

  test("test_unicode_preservation", () => {
    expect(type(loads('""'))).toBe(str);
    expect(type(loads('"a"'))).toBe(str);
    expect(type(loads('["a"]')[0])).toBe(str);
    expect(typeof loads('"a"')).toBe("string");
  });

  test("test_bytes_encode", () => {
    expect(() => dumps(b("hi"))).toThrow(PyTypeError);
    expect(() => dumps([b("hi")])).toThrow(PyTypeError);
  });

  test("test_bytes_decode", () => {
    for (const [encoding, bom] of [
      ["utf-8", codecs.BOM_UTF8],
      ["utf-16be", codecs.BOM_UTF16_BE],
      ["utf-16le", codecs.BOM_UTF16_LE],
      ["utf-32be", codecs.BOM_UTF32_BE],
      ["utf-32le", codecs.BOM_UTF32_LE],
    ]) {
      const data = ["a\xb5\u20ac\u{1d120}"];
      const encoded = str.encode(dumps(data), encoding);
      expect(loads(bom + encoded)).toEqual(data);
      expect(loads(encoded)).toEqual(data);
    }
    expect(() => loads(b('["\x80"]'))).toThrow(UnicodeDecodeError);
    // RFC-7159 and ECMA-404 extend JSON to allow documents that
    // consist of only a string, which can present a special case
    // not covered by the encoding detection patterns specified in
    // RFC-4627 for utf-16-le (XX 00 XX 00).
    expect(loads(str.encode('"\u2600"', "utf-16-le"))).toBe("\u2600");
    // Encoding detection for small (<4) bytes objects
    // is implemented as a special case. RFC-7159 and ECMA-404
    // allow single codepoint JSON documents which are only two
    // bytes in utf-16 encodings w/o BOM.
    expect(loads(b("5\x00"))).toBe(5);
    expect(loads(b("\x007"))).toBe(7);
    expect(loads(b("57"))).toBe(57);
  });

  // A Uint8Array has bytes to give (bytes(array) copies them), but is neither bytes nor a bytearray.
  test.failing("test_bytes_decode, with a Uint8Array", () => {
    expect(loads(new TextEncoder().encode("57"))).toBe(57);
  });

  test("test_object_pairs_hook_with_unicode", () => {
    const s = '{"xkd":1, "kcw":2, "art":3, "hxm":4, "qrt":5, "pad":6, "hoy":7}';
    const p = [t("xkd", 1), t("kcw", 2), t("art", 3), t("hxm", 4), t("qrt", 5), t("pad", 6), t("hoy", 7)];
    expect(loads(s)).toEqual(dict(p));
    expect(loads(s, kwargs({ object_pairs_hook: (x: any) => x }))).toEqual(p);
    const od = loads(s, kwargs({ object_pairs_hook: OrderedDict }));
    expect(od).toEqual(OrderedDict(p));
    expect(type(od)).toBe(OrderedDict);
    // the object_pairs_hook takes priority over the object_hook
    expect(loads(s, kwargs({ object_pairs_hook: OrderedDict, object_hook: () => undefined }))).toEqual(OrderedDict(p));
  });
});
