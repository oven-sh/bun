// Translated from CPython 3.15's Lib/test/test_bisect.py.
// There every class runs twice, with and without the accelerator module; here once, with the `bisect` a program gets.
import { kwargs } from "bun:python";
import { describe, expect, test } from "bun:test";
import {
  IndexError,
  NotImplemented,
  TypeError as PyTypeError,
  ValueError,
  ZeroDivisionError,
  abs,
  list,
  map,
  range,
  sorted,
  str,
} from "python:builtins";
import bisect from "python:bisect";
import { UserList } from "python:collections";
import { choice, randrange, shuffle } from "python:random";
import sys from "python:sys";
import { makeClass, py, t } from "./helpers";

/** A trivial range()-like object that has an insert() method. */
const Range = makeClass("Range", [], {
  __init__(start: number | bigint, stop: number | bigint) {
    this.start = start;
    this.stop = stop;
    this.last_insert = undefined;
  },

  // An int is a number or, beyond 2**53, a BigInt, and JavaScript does not subtract one from the other.
  __len__() {
    return BigInt(this.stop) - BigInt(this.start);
  },

  __getitem__(index: number | bigint) {
    let idx = BigInt(index);
    const n = BigInt(this.stop) - BigInt(this.start);
    if (idx < 0) idx += n;
    if (idx >= n) throw new IndexError(idx);
    return BigInt(this.start) + idx;
  },

  insert(idx: number | bigint, item: any) {
    this.last_insert = t(idx, item);
  },
});

describe("TestBisect", () => {
  const precomputedCases: [any, number[], number, number][] = [
    [bisect.bisect_right, [], 1, 0],
    [bisect.bisect_right, [1], 0, 0],
    [bisect.bisect_right, [1], 1, 1],
    [bisect.bisect_right, [1], 2, 1],
    [bisect.bisect_right, [1, 1], 0, 0],
    [bisect.bisect_right, [1, 1], 1, 2],
    [bisect.bisect_right, [1, 1], 2, 2],
    [bisect.bisect_right, [1, 1, 1], 0, 0],
    [bisect.bisect_right, [1, 1, 1], 1, 3],
    [bisect.bisect_right, [1, 1, 1], 2, 3],
    [bisect.bisect_right, [1, 1, 1, 1], 0, 0],
    [bisect.bisect_right, [1, 1, 1, 1], 1, 4],
    [bisect.bisect_right, [1, 1, 1, 1], 2, 4],
    [bisect.bisect_right, [1, 2], 0, 0],
    [bisect.bisect_right, [1, 2], 1, 1],
    [bisect.bisect_right, [1, 2], 1.5, 1],
    [bisect.bisect_right, [1, 2], 2, 2],
    [bisect.bisect_right, [1, 2], 3, 2],
    [bisect.bisect_right, [1, 1, 2, 2], 0, 0],
    [bisect.bisect_right, [1, 1, 2, 2], 1, 2],
    [bisect.bisect_right, [1, 1, 2, 2], 1.5, 2],
    [bisect.bisect_right, [1, 1, 2, 2], 2, 4],
    [bisect.bisect_right, [1, 1, 2, 2], 3, 4],
    [bisect.bisect_right, [1, 2, 3], 0, 0],
    [bisect.bisect_right, [1, 2, 3], 1, 1],
    [bisect.bisect_right, [1, 2, 3], 1.5, 1],
    [bisect.bisect_right, [1, 2, 3], 2, 2],
    [bisect.bisect_right, [1, 2, 3], 2.5, 2],
    [bisect.bisect_right, [1, 2, 3], 3, 3],
    [bisect.bisect_right, [1, 2, 3], 4, 3],
    [bisect.bisect_right, [1, 2, 2, 3, 3, 3, 4, 4, 4, 4], 0, 0],
    [bisect.bisect_right, [1, 2, 2, 3, 3, 3, 4, 4, 4, 4], 1, 1],
    [bisect.bisect_right, [1, 2, 2, 3, 3, 3, 4, 4, 4, 4], 1.5, 1],
    [bisect.bisect_right, [1, 2, 2, 3, 3, 3, 4, 4, 4, 4], 2, 3],
    [bisect.bisect_right, [1, 2, 2, 3, 3, 3, 4, 4, 4, 4], 2.5, 3],
    [bisect.bisect_right, [1, 2, 2, 3, 3, 3, 4, 4, 4, 4], 3, 6],
    [bisect.bisect_right, [1, 2, 2, 3, 3, 3, 4, 4, 4, 4], 3.5, 6],
    [bisect.bisect_right, [1, 2, 2, 3, 3, 3, 4, 4, 4, 4], 4, 10],
    [bisect.bisect_right, [1, 2, 2, 3, 3, 3, 4, 4, 4, 4], 5, 10],

    [bisect.bisect_left, [], 1, 0],
    [bisect.bisect_left, [1], 0, 0],
    [bisect.bisect_left, [1], 1, 0],
    [bisect.bisect_left, [1], 2, 1],
    [bisect.bisect_left, [1, 1], 0, 0],
    [bisect.bisect_left, [1, 1], 1, 0],
    [bisect.bisect_left, [1, 1], 2, 2],
    [bisect.bisect_left, [1, 1, 1], 0, 0],
    [bisect.bisect_left, [1, 1, 1], 1, 0],
    [bisect.bisect_left, [1, 1, 1], 2, 3],
    [bisect.bisect_left, [1, 1, 1, 1], 0, 0],
    [bisect.bisect_left, [1, 1, 1, 1], 1, 0],
    [bisect.bisect_left, [1, 1, 1, 1], 2, 4],
    [bisect.bisect_left, [1, 2], 0, 0],
    [bisect.bisect_left, [1, 2], 1, 0],
    [bisect.bisect_left, [1, 2], 1.5, 1],
    [bisect.bisect_left, [1, 2], 2, 1],
    [bisect.bisect_left, [1, 2], 3, 2],
    [bisect.bisect_left, [1, 1, 2, 2], 0, 0],
    [bisect.bisect_left, [1, 1, 2, 2], 1, 0],
    [bisect.bisect_left, [1, 1, 2, 2], 1.5, 2],
    [bisect.bisect_left, [1, 1, 2, 2], 2, 2],
    [bisect.bisect_left, [1, 1, 2, 2], 3, 4],
    [bisect.bisect_left, [1, 2, 3], 0, 0],
    [bisect.bisect_left, [1, 2, 3], 1, 0],
    [bisect.bisect_left, [1, 2, 3], 1.5, 1],
    [bisect.bisect_left, [1, 2, 3], 2, 1],
    [bisect.bisect_left, [1, 2, 3], 2.5, 2],
    [bisect.bisect_left, [1, 2, 3], 3, 2],
    [bisect.bisect_left, [1, 2, 3], 4, 3],
    [bisect.bisect_left, [1, 2, 2, 3, 3, 3, 4, 4, 4, 4], 0, 0],
    [bisect.bisect_left, [1, 2, 2, 3, 3, 3, 4, 4, 4, 4], 1, 0],
    [bisect.bisect_left, [1, 2, 2, 3, 3, 3, 4, 4, 4, 4], 1.5, 1],
    [bisect.bisect_left, [1, 2, 2, 3, 3, 3, 4, 4, 4, 4], 2, 1],
    [bisect.bisect_left, [1, 2, 2, 3, 3, 3, 4, 4, 4, 4], 2.5, 3],
    [bisect.bisect_left, [1, 2, 2, 3, 3, 3, 4, 4, 4, 4], 3, 3],
    [bisect.bisect_left, [1, 2, 2, 3, 3, 3, 4, 4, 4, 4], 3.5, 6],
    [bisect.bisect_left, [1, 2, 2, 3, 3, 3, 4, 4, 4, 4], 4, 6],
    [bisect.bisect_left, [1, 2, 2, 3, 3, 3, 4, 4, 4, 4], 5, 10],
  ];

  test("test_precomputed", () => {
    for (const [func, data, elem, expected] of precomputedCases) {
      expect(func(data, elem)).toBe(expected);
      expect(func(UserList(data), elem)).toBe(expected);
    }
  });

  test("test_negative_lo", () => {
    // Issue 3301
    expect(() => bisect.bisect_left([1, 2, 3], 5, -1, 3)).toThrow(ValueError);
    expect(() => bisect.bisect_right([1, 2, 3], 5, -1, 3)).toThrow(ValueError);
    expect(() => bisect.insort_left([1, 2, 3], 5, -1, 3)).toThrow(ValueError);
    expect(() => bisect.insort_right([1, 2, 3], 5, -1, 3)).toThrow(ValueError);
  });

  test("test_large_range", () => {
    // Issue 13496
    const n: bigint = sys.maxsize;
    const data = range(n - 1n);
    expect(bisect.bisect_left(data, n - 3n)).toBe(n - 3n);
    expect(bisect.bisect_right(data, n - 3n)).toBe(n - 2n);
    expect(bisect.bisect_left(data, n - 3n, n - 10n, n)).toBe(n - 3n);
    expect(bisect.bisect_right(data, n - 3n, n - 10n, n)).toBe(n - 2n);
  });

  test("test_large_pyrange", () => {
    // Same as above, but without C-imposed limits on range() parameters
    const n: bigint = sys.maxsize;
    const data = Range(0, n - 1n);
    expect(bisect.bisect_left(data, n - 3n)).toBe(n - 3n);
    expect(bisect.bisect_right(data, n - 3n)).toBe(n - 2n);
    expect(bisect.bisect_left(data, n - 3n, n - 10n, n)).toBe(n - 3n);
    expect(bisect.bisect_right(data, n - 3n, n - 10n, n)).toBe(n - 2n);
    let x = n - 100n;
    bisect.insort_left(data, x, x - 50n, x + 50n);
    expect(data.last_insert).toEqual(t(x, x));
    x = n - 200n;
    bisect.insort_right(data, x, x - 50n, x + 50n);
    expect(data.last_insert).toEqual(t(x + 1n, x));
  });

  test("test_random", () => {
    const n = 25;
    for (let i = 0; i < n; i++) {
      const data = Array.from({ length: i }, () => randrange(0, n, 2));
      list.sort(data);
      const elem = randrange(-1, n + 1);
      let ip = bisect.bisect_left(data, elem);
      if (ip < data.length) expect(elem <= data[ip]).toBe(true);
      if (ip > 0) expect(data[ip - 1] < elem).toBe(true);
      ip = bisect.bisect_right(data, elem);
      if (ip < data.length) expect(elem < data[ip]).toBe(true);
      if (ip > 0) expect(data[ip - 1] <= elem).toBe(true);
    }
  });

  test("test_optionalSlicing", () => {
    for (const [func, data, elem, expected] of precomputedCases) {
      for (let lo = 0; lo < 4; lo++) {
        lo = Math.min(data.length, lo);
        for (let hi = 3; hi < 8; hi++) {
          hi = Math.min(data.length, hi);
          const ip = func(data, elem, lo, hi);
          expect(lo <= ip && ip <= hi).toBe(true);
          if (func === bisect.bisect_left && ip < hi) expect(elem <= data[ip]).toBe(true);
          if (func === bisect.bisect_left && ip > lo) expect(data[ip - 1] < elem).toBe(true);
          if (func === bisect.bisect_right && ip < hi) expect(elem < data[ip]).toBe(true);
          if (func === bisect.bisect_right && ip > lo) expect(data[ip - 1] <= elem).toBe(true);
          expect(ip).toBe(Math.max(lo, Math.min(hi, expected)));
          // There the loop variable is bound anew by `for`; here it is the counter.
          if (hi === data.length) break;
        }
        if (lo === data.length) break;
      }
    }
  });

  test("test_backcompatibility", () => {
    expect(bisect.bisect).toBe(bisect.bisect_right);
  });

  test("test_keyword_args", () => {
    const data = [10, 20, 30, 40, 50];
    expect(bisect.bisect_left(kwargs({ a: data, x: 25, lo: 1, hi: 3 }))).toBe(2);
    expect(bisect.bisect_right(kwargs({ a: data, x: 25, lo: 1, hi: 3 }))).toBe(2);
    expect(bisect.bisect(kwargs({ a: data, x: 25, lo: 1, hi: 3 }))).toBe(2);
    bisect.insort_left(kwargs({ a: data, x: 25, lo: 1, hi: 3 }));
    bisect.insort_right(kwargs({ a: data, x: 25, lo: 1, hi: 3 }));
    bisect.insort(kwargs({ a: data, x: 25, lo: 1, hi: 3 }));
    expect(data).toEqual([10, 20, 25, 25, 25, 30, 40, 50]);
  });

  test("test_lookups_with_key_function", () => {
    // Invariant: Index with a keyfunc on an array
    // should match the index on an array where
    // key function has already been applied.
    for (const [keyfunc, unsorted] of [
      [abs, [2, -4, 6, 8, -10]],
      [Math.abs, [2, -4, 6, 8, -10]],
      [str.casefold, "aBcDeEfgHhiIiij"],
    ]) {
      const arr = sorted(unsorted, kwargs({ key: keyfunc }));
      const precomputed_arr = list(map(keyfunc, arr));
      for (const x of precomputed_arr) {
        expect(bisect.bisect_left(arr, x, kwargs({ key: keyfunc }))).toBe(bisect.bisect_left(precomputed_arr, x));
        expect(bisect.bisect_right(arr, x, kwargs({ key: keyfunc }))).toBe(bisect.bisect_right(precomputed_arr, x));
      }
    }
  });

  test("test_insort", () => {
    // Invariant:  As random elements are inserted in
    // a target list, the targetlist remains sorted.
    const keyfunc = abs;
    const data = [...range(-10, 11), ...range(-20, 20, 2)];
    shuffle(data);
    let target: number[] = [];
    for (const x of data) {
      bisect.insort_left(target, x, kwargs({ key: keyfunc }));
      expect(sorted(target, kwargs({ key: keyfunc }))).toEqual(target);
    }
    target = [];
    for (const x of data) {
      bisect.insort_right(target, x, kwargs({ key: keyfunc }));
      expect(sorted(target, kwargs({ key: keyfunc }))).toEqual(target);
    }
  });

  test("test_insort_keynotNone", () => {
    const x: any[] = [];
    const y = py({ a: 2, b: 1 });
    for (const f of [bisect.insort_left, bisect.insort_right])
      expect(() => f(x, y, kwargs({ key: "b" }))).toThrow(PyTypeError);
  });

  test("test_lt_returns_non_bool", () => {
    const A = makeClass("A", [], {
      __init__(val: number) {
        this.val = val;
      },
      __lt__(other: any) {
        return this.val < other.val ? "nonempty" : "";
      },
    });

    const data = Array.from({ length: 100 }, (_, i) => A(i));
    const i1 = bisect.bisect_left(data, A(33));
    const i2 = bisect.bisect_right(data, A(33));
    expect(i1).toBe(33);
    expect(i2).toBe(34);
  });

  test("test_lt_returns_notimplemented", () => {
    const A = makeClass("A", [], {
      __init__(val: number) {
        this.val = val;
      },
      __lt__() {
        return NotImplemented;
      },
      __gt__(other: any) {
        return this.val > other.val;
      },
    });

    const data = Array.from({ length: 100 }, (_, i) => A(i));
    const i1 = bisect.bisect_left(data, A(40));
    const i2 = bisect.bisect_right(data, A(40));
    expect(i1).toBe(40);
    expect(i2).toBe(41);
  });
});

// ==============================================================================

describe("TestInsort", () => {
  test("test_vsBuiltinSort", () => {
    const n = 500;
    for (const insorted of [list(), UserList()]) {
      for (let i = 0; i < n; i++) {
        const digit = choice("0123456789");
        const f = "02468".includes(digit) ? bisect.insort_left : bisect.insort_right;
        f(insorted, digit);
      }
      // A list equals a UserList because UserList.__eq__ says so, whichever side it is on.
      expect(sorted(insorted)).toEqual(insorted);
    }
  });

  test("test_backcompatibility", () => {
    expect(bisect.insort).toBe(bisect.insort_right);
  });

  test("test_listDerived", () => {
    const List = makeClass("List", [list], {
      data: [],
      insert(index: number, item: any) {
        list.insert(this.data, index, item);
      },
    });

    const lst = List();
    bisect.insort_left(lst, 10);
    bisect.insort_right(lst, 5);
    expect([5, 10]).toEqual(lst.data);
  });
});

// ==============================================================================

/** Dummy sequence class defining __len__ but not __getitem__. */
const LenOnly = makeClass("LenOnly", [], {
  __len__() {
    return 10;
  },
});

/** Dummy sequence class defining __getitem__ but not __len__. */
const GetOnly = makeClass("GetOnly", [], {
  __getitem__() {
    return 10;
  },
});

function raiseZeroDivisionError() {
  throw new ZeroDivisionError();
}
/** Dummy element that always raises an error during comparison */
const CmpErr = makeClass("CmpErr", [], {
  __lt__: raiseZeroDivisionError,
  __gt__: raiseZeroDivisionError,
  __le__: raiseZeroDivisionError,
  __ge__: raiseZeroDivisionError,
  __eq__: raiseZeroDivisionError,
  __ne__: raiseZeroDivisionError,
});

describe("TestErrorHandling", () => {
  const functions = [bisect.bisect_left, bisect.bisect_right, bisect.insort_left, bisect.insort_right];

  test("test_non_sequence", () => {
    for (const f of functions) expect(() => f(10, 10)).toThrow(PyTypeError);
  });

  test("test_len_only", () => {
    for (const f of functions) expect(() => f(LenOnly(), 10)).toThrow(PyTypeError);
  });

  test("test_get_only", () => {
    for (const f of functions) expect(() => f(GetOnly(), 10)).toThrow(PyTypeError);
  });

  test("test_cmp_err", () => {
    const seq = [CmpErr(), CmpErr(), CmpErr()];
    for (const f of functions) expect(() => f(seq, 10)).toThrow(ZeroDivisionError);
  });

  test("test_arg_parsing", () => {
    for (const f of functions) expect(() => f(10)).toThrow(PyTypeError);
  });
});

// ==============================================================================

describe("TestDocExample", () => {
  test("test_grades", () => {
    const grade = (score: number) => "FDCBA"[bisect.bisect([60, 70, 80, 90], score)];

    const result = [33, 99, 77, 70, 89, 90, 100].map(grade);
    expect(result).toEqual(["F", "A", "C", "C", "B", "A", "A"]);
  });

  test("test_colors", () => {
    const data = [t("red", 5), t("blue", 1), t("yellow", 8), t("black", 0)];
    list.sort(data, kwargs({ key: (r: any) => r[1] }));
    const keys = data.map(r => r[1]);
    const bisect_left = bisect.bisect_left;
    expect(data[bisect_left(keys, 0)]).toEqual(t("black", 0));
    expect(data[bisect_left(keys, 1)]).toEqual(t("blue", 1));
    expect(data[bisect_left(keys, 5)]).toEqual(t("red", 5));
    expect(data[bisect_left(keys, 8)]).toEqual(t("yellow", 8));
  });
});
