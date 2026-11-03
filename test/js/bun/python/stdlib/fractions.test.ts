// Translated from CPython 3.15's Lib/test/test_fractions.py: of FractionTest, the tests named below.
// Of testMixedMultiplication, testMixedDivision, testMixedIntegerDivision and testMixedPower only the part with numbers: the
// rest is about a dozen classes of numbers that the file defines (Rat, Root, Polar, Rect, Symbolic...).
// Not translated: testFromString, testFromDecimal, testFromNumber, the comparisons with DummyRational and DummyFloat, the
// subclasses of int and bool, pickling, and the tests of format().
//
// The arithmetic is written with the operators of JavaScript. It has no `//`: floordiv().
import { float } from "bun:python";
import { describe, expect, test } from "bun:test";
import {
  AttributeError,
  OverflowError,
  TypeError as PyTypeError,
  ValueError,
  ZeroDivisionError,
  abs,
  bool,
  complex,
  divmod,
  float as pyfloat,
  hash,
  int,
  list,
  map,
  pow,
  repr,
  round,
  setattr,
  str,
  type,
} from "python:builtins";
import { Decimal } from "python:decimal";
import { Fraction as F } from "python:fractions";
import math from "python:math";
import operator, { floordiv } from "python:operator";
import sys from "python:sys";
import typing from "python:typing";
import { makeClass, raises, t } from "./helpers";

const _components = (r: any) => [r.numerator, r.denominator];

const Ratio = makeClass("Ratio", [], {
  __init__(ratio: any) {
    this._ratio = ratio;
  },
  as_integer_ratio() {
    return this._ratio;
  },
});

/** Asserts that both the types and values are the same. */
function assertTypedEquals(expected: any, actual: any) {
  expect(type(actual)).toBe(type(expected));
  expect(actual).toEqual(expected);
}

/** Asserts that both the types and values in the tuples are the same. */
function assertTypedTupleEquals(expected: any, actual: any) {
  expect(actual).toEqual(expected);
  expect(list(map(type, actual))).toEqual(list(map(type, expected)));
}

/** Asserts that body() raises exc_type(message). */
function assertRaisesMessage(exc_type: any, message: string, body: () => unknown) {
  expect(str(raises(exc_type, body))).toBe(message);
}

describe("FractionTest", () => {
  test("testInit", () => {
    expect(_components(F())).toEqual([0, 1]);
    expect(_components(F(7))).toEqual([7, 1]);
    expect(_components(F(F(7, 3)))).toEqual([7, 3]);

    expect(_components(F(-1, 1))).toEqual([-1, 1]);
    expect(_components(F(1, -1))).toEqual([-1, 1]);
    expect(_components(F(-2, -2))).toEqual([1, 1]);
    expect(_components(F(5, 10))).toEqual([1, 2]);
    expect(_components(F(7, 15))).toEqual([7, 15]);
    expect(_components(F(10n ** 23n))).toEqual([10n ** 23n, 1]);

    expect(_components(F(F(3, 7), 11))).toEqual([3, 77]);
    expect(_components(F(2, F(-10, 9)))).toEqual([-9, 5]);
    expect(_components(F(F(22, 7), F(355, 113)))).toEqual([2486, 2485]);

    assertRaisesMessage(ZeroDivisionError, "Fraction(12, 0)", () => F(12, 0));
    expect(() => F(complex(1.5, 3))).toThrow(PyTypeError);

    expect(() => F("3/2", 3)).toThrow(PyTypeError);
    expect(() => F(3, complex(0, 0))).toThrow(PyTypeError);
    expect(() => F(3, complex(0, 1))).toThrow(PyTypeError);
    expect(() => F(1, 2, 3)).toThrow(PyTypeError);
  });

  test("testInitFromFloat", () => {
    expect(_components(F(2.5))).toEqual([5, 2]);
    expect(_components(F(-0.0))).toEqual([0, 1]);
    expect(_components(F(0.1))).toEqual([3602879701896397, 36028797018963968n]);
    // bug 16469: error types should be consistent with float -> int
    expect(() => F(NaN)).toThrow(ValueError);
    expect(() => F(Infinity)).toThrow(OverflowError);
    expect(() => F(-Infinity)).toThrow(OverflowError);
  });

  test("testInitFromDecimal", () => {
    expect(_components(F(Decimal("1.1")))).toEqual([11, 10]);
    expect(_components(F(Decimal("3.5e-2")))).toEqual([7, 200]);
    expect(_components(F(Decimal(".000e20")))).toEqual([0, 1]);
    // bug 16469: error types should be consistent with decimal -> int
    expect(() => F(Decimal("nan"))).toThrow(ValueError);
    expect(() => F(Decimal("snan"))).toThrow(ValueError);
    expect(() => F(Decimal("inf"))).toThrow(OverflowError);
    expect(() => F(Decimal("-inf"))).toThrow(OverflowError);
  });

  test("testInitFromIntegerRatio (its first line)", () => {
    expect(_components(F(Ratio(t(7, 3))))).toEqual([7, 3]);
  });

  test("testImmutable", () => {
    const r = F(7, 3);
    r.__init__(2, 15);
    expect(_components(r)).toEqual([7, 3]);

    expect(() => setattr(r, "numerator", 12)).toThrow(AttributeError);
    expect(() => setattr(r, "denominator", 6)).toThrow(AttributeError);
    expect(() => {
      r.numerator = 12;
    }).toThrow(AttributeError);
    expect(_components(r)).toEqual([7, 3]);

    // But if you _really_ need to:
    r._numerator = 4;
    r._denominator = 2;
    expect(_components(r)).toEqual([4, 2]);
    // Which breaks some important operations:
    expect(F(4, 2)).not.toEqual(r);
  });

  test("testFromFloat", () => {
    expect(() => F.from_float(complex(3, 4))).toThrow(PyTypeError);
    expect(_components(F.from_float(10))).toEqual([10, 1]);
    const bigint = 1234567890123456789n;
    expect(_components(F.from_float(bigint))).toEqual([bigint, 1]);
    expect(_components(F.from_float(-0.0))).toEqual([0, 1]);
    expect(_components(F.from_float(float(10)))).toEqual([10, 1]);
    expect(_components(F.from_float(-2.5))).toEqual([-5, 2]);
    expect(_components(F.from_float(1e23))).toEqual([99999999999999991611392n, 1]);
    expect(pyfloat(F.from_float(1e23))).toBe(pyfloat(10n ** 23n));
    expect(_components(F.from_float(3.2))).toEqual([3602879701896397, 1125899906842624]);
    expect(pyfloat(F.from_float(3.2))).toBe(3.2);

    const inf = Infinity;
    const nan = inf - inf;
    // bug 16469: error types should be consistent with float -> int
    assertRaisesMessage(OverflowError, "cannot convert Infinity to integer ratio", () => F.from_float(inf));
    assertRaisesMessage(OverflowError, "cannot convert Infinity to integer ratio", () => F.from_float(-inf));
    assertRaisesMessage(ValueError, "cannot convert NaN to integer ratio", () => F.from_float(nan));
  });

  test("test_is_integer", () => {
    expect(F(1, 1).is_integer()).toBe(true);
    expect(F(-1, 1).is_integer()).toBe(true);
    expect(F(1, -1).is_integer()).toBe(true);
    expect(F(2, 2).is_integer()).toBe(true);
    expect(F(-2, 2).is_integer()).toBe(true);
    expect(F(2, -2).is_integer()).toBe(true);

    expect(F(1, 2).is_integer()).toBe(false);
    expect(F(-1, 2).is_integer()).toBe(false);
    expect(F(1, -2).is_integer()).toBe(false);
    expect(F(-1, -2).is_integer()).toBe(false);
  });

  test("test_as_integer_ratio", () => {
    expect(F(4, 6).as_integer_ratio()).toEqual(t(2, 3));
    expect(F(-4, 6).as_integer_ratio()).toEqual(t(-2, 3));
    expect(F(4, -6).as_integer_ratio()).toEqual(t(-2, 3));
    expect(F(0, 6).as_integer_ratio()).toEqual(t(0, 1));
  });

  test("testLimitDenominator", () => {
    const rpi = F("3.1415926535897932");
    expect(rpi.limit_denominator(10000)).toEqual(F(355, 113));
    expect(-rpi.limit_denominator(10000)).toEqual(F(-355, 113));
    expect(rpi.limit_denominator(113)).toEqual(F(355, 113));
    expect(rpi.limit_denominator(112)).toEqual(F(333, 106));
    expect(F(201, 200).limit_denominator(100)).toEqual(F(1));
    expect(F(201, 200).limit_denominator(101)).toEqual(F(102, 101));
    expect(F(0).limit_denominator(10000)).toEqual(F(0));
    for (const i of [0, -1])
      assertRaisesMessage(ValueError, "max_denominator should be at least 1", () => F(1).limit_denominator(i));
  });

  test("testConversions", () => {
    assertTypedEquals(-1, math.trunc(F(-11, 10)));
    assertTypedEquals(1, math.trunc(F(11, 10)));
    assertTypedEquals(-2, math.floor(F(-11, 10)));
    assertTypedEquals(-1, math.ceil(F(-11, 10)));
    assertTypedEquals(-1, math.ceil(F(-10, 10)));
    assertTypedEquals(-1, int(F(-11, 10)));
    assertTypedEquals(0, round(F(-1, 10)));
    assertTypedEquals(0, round(F(-5, 10)));
    assertTypedEquals(-2, round(F(-15, 10)));
    assertTypedEquals(-1, round(F(-7, 10)));

    expect(bool(F(0, 1))).toBe(false);
    expect(bool(F(3, 2))).toBe(true);
    // To JavaScript every object is true.
    expect(!!F(0, 1)).toBe(true);
    assertTypedEquals(0.1, pyfloat(F(1, 10)));
    expect(Number(F(1, 10))).toBe(0.1);

    // Check that __float__ isn't implemented by converting the
    // numerator and denominator to float before dividing.
    expect(() => pyfloat(int("2".repeat(400) + "7"))).toThrow(OverflowError);
    expect(pyfloat(F(int("2".repeat(400) + "7"), int("3".repeat(400) + "1")))).toBeCloseTo(2.0 / 3, 7);

    assertTypedEquals(complex(0.1, 0), complex(F(1, 10)));
  });

  test("testSupportsInt", () => {
    // See bpo-44547.
    const f = F(3, 2);
    expect(f).toBeInstanceOf(typing.SupportsInt);
    expect(int(f)).toBe(1);
    expect(type(int(f))).toBe(int);
  });

  test("testRound", () => {
    assertTypedEquals(F(-200), round(F(-150), -2));
    assertTypedEquals(F(-200), round(F(-250), -2));
    assertTypedEquals(F(30), round(F(26), -1));
    assertTypedEquals(F(-2, 10), round(F(-15, 100), 1));
    assertTypedEquals(F(-2, 10), round(F(-25, 100), 1));
  });

  test("testArithmetic", () => {
    expect(F(1, 10) + F(2, 5)).toEqual(F(1, 2));
    expect(F(1, 10) - F(2, 5)).toEqual(F(-3, 10));
    expect(F(1, 10) * F(2, 5)).toEqual(F(1, 25));
    expect(F(2, 3) * F(5, 4)).toEqual(F(5, 6));
    expect(F(1, 10) / F(2, 5)).toEqual(F(1, 4));
    expect(F(3, 4) / F(-2, 5)).toEqual(F(-15, 8));
    expect(() => operator.truediv(F(1), F(0))).toThrow(ZeroDivisionError);
    expect(() => F(1) / F(0)).toThrow(ZeroDivisionError);
    assertTypedEquals(2, floordiv(F(9, 10), F(2, 5)));
    assertTypedEquals(10n ** 23n, floordiv(F(10n ** 23n, 1), F(1)));
    expect(F(7, 3) % F(3, 2)).toEqual(F(5, 6));
    expect(F(-7, 3) % F(3, 2)).toEqual(F(2, 3));
    expect(divmod(F(7, 3), F(3, 2))).toEqual(t(F(1), F(5, 6)));
    expect(divmod(F(-7, 3), F(3, 2))).toEqual(t(F(-2), F(2, 3)));
    expect(F(2, 3) ** F(3)).toEqual(F(8, 27));
    expect(F(2, 3) ** F(-3)).toEqual(F(27, 8));
    expect(F(4) ** F(1, 2)).toBe(2.0);
    expect(operator.pos(F(1, 1))).toEqual(F(1, 1));
    const z = pow(F(-1), F(1, 2));
    expect(z.real).toBeCloseTo(0, 7);
    expect(z.imag).toBe(1);
    // Regression test for #27539.
    let p = F(-1, 2) ** 0;
    expect(p).toEqual(F(1, 1));
    expect(p.numerator).toBe(1);
    expect(p.denominator).toBe(1);
    p = F(-1, 2) ** -1;
    expect(p).toEqual(F(-2, 1));
    expect(p.numerator).toBe(-2);
    expect(p.denominator).toBe(1);
    p = F(-1, 2) ** -2;
    expect(p).toEqual(F(4, 1));
    expect(p.numerator).toBe(4);
    expect(p.denominator).toBe(1);
  });

  test("the unary plus of JavaScript makes a number", () => {
    expect(+F(1, 2)).toBe(0.5);
  });

  test("testLargeArithmetic", () => {
    assertTypedEquals(
      F(
        10101010100808080808080808101010101010000000000000000n,
        1010101010101010101010101011111111101010101010101010101010101n,
      ),
      F(10n ** 35n + 1n, 10n ** 27n + 1n) % F(10n ** 27n + 1n, 10n ** 35n - 1n),
    );
    assertTypedEquals(F(7, 1901475900342344102245054808064n), F(-(2n ** 100n), 3) % F(5, 2n ** 100n));
    assertTypedTupleEquals(
      t(
        9999999999999999n,
        F(
          10101010100808080808080808101010101010000000000000000n,
          1010101010101010101010101011111111101010101010101010101010101n,
        ),
      ),
      divmod(F(10n ** 35n + 1n, 10n ** 27n + 1n), F(10n ** 27n + 1n, 10n ** 35n - 1n)),
    );
    assertTypedEquals(floordiv(-(2n ** 200n), 15), floordiv(F(-(2n ** 100n), 3), F(5, 2n ** 100n)));
    assertTypedEquals(1, floordiv(F(5, 2n ** 100n), F(3, 2n ** 100n)));
    assertTypedEquals(t(1, F(2, 2n ** 100n)), divmod(F(5, 2n ** 100n), F(3, 2n ** 100n)));
    assertTypedTupleEquals(
      t(floordiv(-(2n ** 200n), 15), F(7, 1901475900342344102245054808064n)),
      divmod(F(-(2n ** 100n), 3), F(5, 2n ** 100n)),
    );
  });

  test("testMixedArithmetic", () => {
    assertTypedEquals(F(11, 10), F(1, 10) + 1);
    assertTypedEquals(1.1, F(1, 10) + float(1));
    assertTypedEquals(complex(1.1, 0), F(1, 10) + complex(1.0, 0));
    assertTypedEquals(F(11, 10), 1 + F(1, 10));
    assertTypedEquals(1.1, float(1) + F(1, 10));
    assertTypedEquals(complex(1.1, 0), complex(1.0, 0) + F(1, 10));

    assertTypedEquals(F(-9, 10), F(1, 10) - 1);
    assertTypedEquals(-0.9, F(1, 10) - float(1));
    assertTypedEquals(complex(-0.9, 0), F(1, 10) - complex(1.0, 0));
    assertTypedEquals(F(9, 10), 1 - F(1, 10));
    assertTypedEquals(0.9, float(1) - F(1, 10));
    assertTypedEquals(complex(0.9, 0), complex(1.0, 0) - F(1, 10));

    // An int may be a BigInt.
    assertTypedEquals(F(11, 10), F(1, 10) + 1n);
    assertTypedEquals(F(11, 10), 1n + F(1, 10));
  });

  test("testMixedMultiplication (numbers)", () => {
    assertTypedEquals(F(1, 10), F(1, 10) * 1);
    assertTypedEquals(0.1, F(1, 10) * float(1));
    assertTypedEquals(complex(0.1, 0), F(1, 10) * complex(1.0, 0));
    assertTypedEquals(F(1, 10), 1 * F(1, 10));
    assertTypedEquals(0.1, float(1) * F(1, 10));
    assertTypedEquals(complex(0.1, 0), complex(1.0, 0) * F(1, 10));
  });

  test("testMixedDivision (numbers)", () => {
    assertTypedEquals(F(1, 10), F(1, 10) / 1);
    assertTypedEquals(0.1, F(1, 10) / float(1));
    assertTypedEquals(complex(0.1, 0), F(1, 10) / complex(1.0, 0));
    assertTypedEquals(F(10, 1), 1 / F(1, 10));
    expect(float(1) / F(1, 10)).toBe(10.0);
    assertTypedEquals(complex(10.0, 0), complex(1.0, 0) / F(1, 10));
  });

  test("testMixedIntegerDivision (numbers)", () => {
    assertTypedEquals(0, floordiv(F(1, 10), 1));
    expect(floordiv(F(1, 10), float(1))).toBe(0.0);
    assertTypedEquals(10, floordiv(1, F(1, 10)));
    assertTypedEquals(10n ** 23n, floordiv(10n ** 22n, F(1, 10)));
    expect(floordiv(float(1), F(1, 10))).toBe(floordiv(float(1), 0.1));

    assertTypedEquals(F(1, 10), F(1, 10) % 1);
    assertTypedEquals(0.1, F(1, 10) % float(1));
    assertTypedEquals(F(0, 1), 1 % F(1, 10));
    assertTypedEquals(operator.mod(float(1), 0.1), float(1) % F(1, 10));
    assertTypedEquals(0.1, F(1, 10) % Infinity);
    assertTypedEquals(-Infinity, F(1, 10) % -Infinity);
    assertTypedEquals(Infinity, F(-1, 10) % Infinity);
    assertTypedEquals(-0.1, F(-1, 10) % -Infinity);

    assertTypedTupleEquals(t(0, F(1, 10)), divmod(F(1, 10), 1));
    assertTypedTupleEquals(divmod(0.1, float(1)), divmod(F(1, 10), float(1)));
    assertTypedTupleEquals(t(10, F(0)), divmod(1, F(1, 10)));
    assertTypedTupleEquals(divmod(float(1), 0.1), divmod(float(1), F(1, 10)));
    assertTypedTupleEquals(divmod(0.1, Infinity), divmod(F(1, 10), Infinity));
    assertTypedTupleEquals(divmod(0.1, -Infinity), divmod(F(1, 10), -Infinity));
    assertTypedTupleEquals(divmod(-0.1, Infinity), divmod(F(-1, 10), Infinity));
    assertTypedTupleEquals(divmod(-0.1, -Infinity), divmod(F(-1, 10), -Infinity));
  });

  test("testMixedPower (numbers)", () => {
    // ** has more interesting conversion rules.
    assertTypedEquals(F(100, 1), F(1, 10) ** -2);
    assertTypedEquals(F(100, 1), F(10, 1) ** 2);
    assertTypedEquals(0.1, F(1, 10) ** float(1));
    assertTypedEquals(complex(0.1, 0), F(1, 10) ** complex(1.0, 0));
    assertTypedEquals(4, 2 ** F(2, 1));
    const z = pow(-1, F(1, 2));
    expect(z.real).toBeCloseTo(0, 7);
    expect(z.imag).toBe(1);
    assertTypedEquals(F(1, 4), 2 ** F(-2, 1));
    expect(4 ** F(1, 2)).toBe(2.0);
    assertTypedEquals(0.25, float(2) ** F(-2, 1));
    assertTypedEquals(complex(1.0, 0), complex(1.0, 0) ** F(1, 10));
    expect(() => operator.pow(F(0, 1), -2)).toThrow(ZeroDivisionError);
  });

  // A whole float that an operator or a function gives JavaScript is a number, and a whole number is an int to Python.
  test.failing("the whole floats of these tests are floats", () => {
    assertTypedEquals(float(2), F(4) ** F(1, 2));
  });
  test.failing("the whole floats of these tests are floats (2)", () => {
    assertTypedEquals(float(10), float(1) / F(1, 10));
  });
  test.failing("the whole floats of these tests are floats (3)", () => {
    assertTypedEquals(float(0), floordiv(F(1, 10), float(1)));
  });

  test("testMixingWithDecimal", () => {
    // Decimal refuses mixed arithmetic (but not mixed comparisons)
    expect(() => operator.add(F(3, 11), Decimal("3.1415926"))).toThrow(PyTypeError);
    expect(() => operator.add(Decimal("3.1415926"), F(3, 11))).toThrow(PyTypeError);
  });

  test("testComparisons", () => {
    expect(F(1, 2) < F(2, 3)).toBe(true);
    expect(F(1, 2) < F(1, 2)).toBe(false);
    expect(F(1, 2) <= F(2, 3)).toBe(true);
    expect(F(1, 2) <= F(1, 2)).toBe(true);
    expect(F(2, 3) <= F(1, 2)).toBe(false);
    expect(F(1, 2) == F(1, 2)).toBe(true);
    expect(F(1, 2) == F(1, 3)).toBe(false);
    expect(F(1, 2) != F(1, 2)).toBe(false);
    expect(F(1, 2) != F(1, 3)).toBe(true);
    // `===` is `is`.
    expect(F(1, 2) === F(1, 2)).toBe(false);
  });

  test("testMixedLess", () => {
    expect(2 < F(5, 2)).toBe(true);
    expect(2 < F(4, 2)).toBe(false);
    expect(F(5, 2) < 3).toBe(true);
    expect(F(4, 2) < 2).toBe(false);

    expect(F(1, 2) < 0.6).toBe(true);
    expect(F(1, 2) < 0.4).toBe(false);
    expect(0.4 < F(1, 2)).toBe(true);
    expect(0.5 < F(1, 2)).toBe(false);

    expect(Infinity < F(1, 2)).toBe(false);
    expect(-Infinity < F(0, 10)).toBe(true);
    expect(NaN < F(-3, 7)).toBe(false);
    expect(F(1, 2) < Infinity).toBe(true);
    expect(F(17, 12) < -Infinity).toBe(false);
    expect(F(144, -89) < NaN).toBe(false);
  });

  test("testMixedLessEqual", () => {
    expect(0.5 <= F(1, 2)).toBe(true);
    expect(0.6 <= F(1, 2)).toBe(false);
    expect(F(1, 2) <= 0.5).toBe(true);
    expect(F(1, 2) <= 0.4).toBe(false);
    expect(2 <= F(4, 2)).toBe(true);
    expect(2 <= F(3, 2)).toBe(false);
    expect(F(4, 2) <= 2).toBe(true);
    expect(F(5, 2) <= 2).toBe(false);

    expect(Infinity <= F(1, 2)).toBe(false);
    expect(-Infinity <= F(0, 10)).toBe(true);
    expect(NaN <= F(-3, 7)).toBe(false);
    expect(F(1, 2) <= Infinity).toBe(true);
    expect(F(17, 12) <= -Infinity).toBe(false);
    expect(F(144, -89) <= NaN).toBe(false);
  });

  test("testBigFloatComparisons", () => {
    // Because 10**23 can't be represented exactly as a float:
    expect(F(10n ** 23n) == pyfloat(10n ** 23n)).toBe(false);
    // The first test demonstrates why these are important.
    expect(1e23 < pyfloat(F(math.trunc(1e23) + 1n))).toBe(false);
    expect(1e23 < F(math.trunc(1e23) + 1n)).toBe(true);
    expect(1e23 <= F(math.trunc(1e23) - 1n)).toBe(false);
    expect(1e23 > F(math.trunc(1e23) - 1n)).toBe(true);
    expect(1e23 >= F(math.trunc(1e23) + 1n)).toBe(false);
  });

  test("testBigComplexComparisons", () => {
    expect(F(10n ** 23n) == complex(10n ** 23n)).toBe(false);
    expect(() => operator.gt(F(10n ** 23n), complex(10n ** 23n))).toThrow(PyTypeError);
    expect(() => operator.le(F(10n ** 23n), complex(10n ** 23n))).toThrow(PyTypeError);

    const x = F(3, 8);
    const z = complex(0.375, 0.0);
    const w = complex(0.375, 0.2);
    expect(x == z).toBe(true);
    expect(x != z).toBe(false);
    expect(x == w).toBe(false);
    expect(x != w).toBe(true);
    for (const op of [operator.lt, operator.le, operator.gt, operator.ge]) {
      expect(() => op(x, z)).toThrow(PyTypeError);
      expect(() => op(z, x)).toThrow(PyTypeError);
      expect(() => op(x, w)).toThrow(PyTypeError);
      expect(() => op(w, x)).toThrow(PyTypeError);
    }
  });

  test("testMixedEqual", () => {
    expect(0.5 == F(1, 2)).toBe(true);
    expect(0.6 == F(1, 2)).toBe(false);
    expect(F(1, 2) == 0.5).toBe(true);
    expect(F(1, 2) == 0.4).toBe(false);
    expect(2 == F(4, 2)).toBe(true);
    expect(2 == F(3, 2)).toBe(false);
    expect(F(4, 2) == 2).toBe(true);
    expect(F(5, 2) == 2).toBe(false);
    expect(F(5, 2) == NaN).toBe(false);
    expect(NaN == F(3, 7)).toBe(false);
    expect(F(5, 2) == Infinity).toBe(false);
    expect(-Infinity == F(2, 5)).toBe(false);
  });

  test("testStringification", () => {
    expect(repr(F(7, 3))).toBe("Fraction(7, 3)");
    expect(repr(F("3.1415926535"))).toBe("Fraction(6283185307, 2000000000)");
    expect(repr(F(1, -(10n ** 20n)))).toBe("Fraction(-1, 100000000000000000000)");
    expect(str(F(7, 3))).toBe("7/3");
    expect(str(F(7, 1))).toBe("7");
    expect(String(F(7, 3))).toBe("7/3");
    expect(`${F(7, 3)}`).toBe("7/3");
    expect(Bun.inspect(F(7, 3))).toBe("Fraction(7, 3)");
  });

  test("testHash", () => {
    const hmod = sys.hash_info.modulus;
    const hinf = sys.hash_info.inf;
    expect(hash(F(5, 2))).toBe(hash(2.5));
    expect(hash(F(10n ** 50n))).toBe(hash(10n ** 50n));
    expect(hash(F(10n ** 23n))).not.toBe(hash(pyfloat(10n ** 23n)));
    expect(hash(F(1, hmod))).toBe(hinf);
    // Check that __hash__ produces the same value as hash(), for
    // consistency with int and Decimal.  (See issue #10356.)
    expect(F(-1).__hash__()).toBe(hash(F(-1)));
  });

  test("testApproximatePi", () => {
    // Algorithm borrowed from
    // http://docs.python.org/lib/decimal-recipes.html
    const three = F(3);
    let [lasts, t, s, n, na, d, da]: any[] = [0, three, 3, 1, 0, 0, 24];
    while (abs(s - lasts) > F(1, 10 ** 9)) {
      lasts = s;
      [n, na] = [n + na, na + 8];
      [d, da] = [d + da, da + 32];
      t = (t * n) / d;
      s += t;
    }
    expect(type(s)).toBe(F);
    expect(pyfloat(s)).toBeCloseTo(math.pi, 7);
  });

  test("testApproximateCos1", () => {
    // Algorithm borrowed from
    // http://docs.python.org/lib/decimal-recipes.html
    const x = F(1);
    let [i, lasts, s, fact, num, sign]: any[] = [0, 0, F(1), 1, 1, 1];
    while (abs(s - lasts) > F(1, 10 ** 9)) {
      lasts = s;
      i += 2;
      fact *= i * (i - 1);
      num *= x * x;
      sign *= -1;
      s += (num / fact) * sign;
    }
    expect(type(s)).toBe(F);
    expect(pyfloat(s)).toBeCloseTo(math.cos(1), 7);
  });

  test("test_slots", () => {
    // Issue 4998
    const r = F(13, 7);
    expect(() => setattr(r, "a", 10)).toThrow(AttributeError);
    expect(() => {
      r.a = 10;
    }).toThrow(AttributeError);
  });
});
