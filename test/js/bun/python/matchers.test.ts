// What bun:test makes of the objects of Python.
import { float } from "bun:python";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { isASAN, isDebug } from "harness";
import { ValueError, bytearray, bytes, dict, exec, frozenset, int, object, set, str, tuple } from "python:builtins";
import { OrderedDict, UserList, deque } from "python:collections";
import { date } from "python:datetime";
import { Decimal } from "python:decimal";
import { Fraction } from "python:fractions";
import functools from "python:functools";

// These builds take seconds to start Python.
if (isDebug || isASAN) setDefaultTimeout(60_000);

const globals = dict();
exec(
  `
class Point:
    def __init__(self, x, y): self.x, self.y = x, y

class Money:
    def __init__(self, cents): self.cents = cents
    def __eq__(self, other): return isinstance(other, Money) and self.cents == other.cents
    def __repr__(self): return f"Money({self.cents})"
`,
  globals,
);
const { Point, Money } = globals;

/** The message of the failure of an assertion that has to fail. */
function failure(assertion: () => void): string {
  try {
    assertion();
  } catch (error: any) {
    return Bun.stripANSI(error.message);
  }
  throw new Error("the assertion held");
}

describe("toEqual", () => {
  test("of two objects of Python is ==", () => {
    expect(set([1, 2])).toEqual(set([2, 1]));
    expect(set([1, 2])).not.toEqual(set([1, 3]));
    expect(set([1])).toEqual(frozenset([1]));
    expect(date(2020, 1, 2)).toEqual(date(2020, 1, 2));
    expect(date(2020, 1, 2)).not.toEqual(date(2020, 1, 3));
    expect(Decimal("1.50")).toEqual(Decimal("1.5"));
    expect(Fraction(2, 4)).toEqual(Fraction(1, 2));
    expect(dict([[tuple([1]), 1]])).not.toEqual(dict([[tuple([2]), 1]]));
    expect(dict([[tuple([1]), 1]])).toEqual(dict([[tuple([1]), 1]]));
    expect(OrderedDict([["a", 1]])).toEqual(dict([["a", 1]]));
    expect(deque([1, 2])).toEqual(deque([1, 2]));
    expect(deque([1, 2])).not.toEqual(deque([2, 1]));
    expect(tuple([1, tuple([2])])).toEqual(tuple([1, tuple([2])]));
    expect(bytes([1, 2])).toEqual(bytearray([1, 2]));
    expect(Money(5)).toEqual(Money(5));
    expect(Money(5)).not.toEqual(Money(6));
  });

  test("without __eq__ two objects are equal if they are one", () => {
    const one = object();
    expect(one).toEqual(one);
    expect(one).not.toEqual(object());
    expect(Point(1, 2)).not.toEqual(Point(1, 2));
  });

  test("against a number or a string is == too", () => {
    expect(Fraction(4, 2)).toEqual(2);
    expect(2).toEqual(Fraction(4, 2));
    expect(Decimal(3)).toEqual(3n);
    expect(Fraction(1, 2)).toEqual(0.5);
    expect(Fraction(1, 2)).not.toEqual(1);
    expect(Fraction(1, 2)).not.toEqual("1/2");
    expect([float(1), float(2)]).toEqual([1, 2]);
    expect([1, 2]).toEqual([float(1), float(2)]);
    expect(date(2020, 1, 2)).not.toEqual(undefined);
  });

  test("inside the containers of JavaScript", () => {
    expect([set([1]), { when: date(2020, 1, 2) }]).toEqual([set([1]), { when: date(2020, 1, 2) }]);
    expect([set([1])]).not.toEqual([set([2])]);
    expect({ when: date(2020, 1, 2) }).not.toEqual({ when: date(2020, 1, 3) });
    expect(new Map([["a", Decimal("1.0")]])).toEqual(new Map([["a", Decimal(1)]]));
  });

  test("against what JavaScript has for it", () => {
    expect(tuple([1, tuple([2, 3])])).toEqual([1, [2, 3]]);
    expect([1, [2, 3]]).toEqual(tuple([1, tuple([2, 3])]));
    expect(tuple([1, 2])).not.toEqual([1, 3]);
    expect(tuple([1, 2])).not.toEqual([1]);
    expect(dict([["a", 1]])).toEqual({ a: 1 });
    expect({ a: [1, { b: 2 }] }).toEqual(dict([["a", [1, dict([["b", 2]])]]]));
    expect(dict([["a", 1]])).not.toEqual({ a: 2 });
    expect(dict([["a", 1]])).not.toEqual({});
    expect(dict([[tuple([1]), 1]])).not.toEqual({});
    expect(Point(1, 2)).toEqual({ x: 1, y: 2 });
    expect(Point(1, 2)).not.toEqual({ x: 1, y: 3 });
    expect(bytes([1, 2])).toEqual(new Uint8Array([1, 2]));
    expect(Buffer.from([1, 2])).toEqual(bytearray([1, 2]));
    expect(bytes([1, 2])).not.toEqual(new Uint8Array([1, 3]));
    expect(UserList([1, 2])).toEqual([1, 2]);
    expect([1, 2]).toEqual(UserList([1, 2]));
    expect([1, 2]).not.toEqual(UserList([1, 3]));
  });

  test("and nothing else", () => {
    expect(set([1])).not.toEqual(new Set([1]));
    expect(set()).not.toEqual({});
    expect(set()).not.toEqual([]);
    expect(date(2020, 1, 2)).not.toEqual({});
    expect({}).not.toEqual(date(2020, 1, 2));
    expect(deque([1])).not.toEqual([1]);
    expect(Decimal(1)).not.toEqual({});
  });

  test("asymmetric matchers", () => {
    expect({ when: date(2020, 1, 2), n: 1 }).toEqual({ when: expect.any(date), n: expect.any(Number) });
    expect([Fraction(1, 2)]).toEqual([expect.anything()]);
    expect([Fraction(1, 2)]).toEqual(expect.arrayContaining([Fraction(2, 4)]));
  });
});

test("toStrictEqual wants the same type", () => {
  expect(tuple([1, 2])).toStrictEqual(tuple([1, 2]));
  expect(tuple([1, 2])).not.toStrictEqual([1, 2]);
  expect(dict([["a", 1]])).toStrictEqual(dict([["a", 1]]));
  expect(dict([["a", 1]])).not.toStrictEqual({ a: 1 });
  expect(OrderedDict([["a", 1]])).not.toStrictEqual(dict([["a", 1]]));
  expect(set([1])).not.toStrictEqual(frozenset([1]));
  expect(bytes([1])).not.toStrictEqual(new Uint8Array([1]));
  expect(Decimal("1.50")).toStrictEqual(Decimal("1.5"));
});

test("a failure shows repr()", () => {
  let message = failure(() => expect(set([1])).toEqual(set([2])));
  expect(message).toContain("{1}");
  expect(message).toContain("{2}");
  message = failure(() => expect(date(2020, 1, 2)).toEqual(date(2020, 1, 3)));
  expect(message).toContain("datetime.date(2020, 1, 2)");
  expect(message).toContain("datetime.date(2020, 1, 3)");
  message = failure(() => expect([Money(5)]).toEqual([Money(6)]));
  expect(message).toContain("Money(5)");
  expect(message).toContain("Money(6)");
  message = failure(() => expect(Decimal("1.5")).toBe(Decimal("1.5")));
  expect(message).toContain("Decimal('1.5')");
});

test("toBeInstanceOf is isinstance()", () => {
  expect(date(2020, 1, 2)).toBeInstanceOf(date);
  expect(10).toBeInstanceOf(int);
  expect(2n ** 70n).toBeInstanceOf(int);
  expect(true).toBeInstanceOf(int);
  expect("s").toBeInstanceOf(str);
  expect("s").not.toBeInstanceOf(int);
  expect(1.5).not.toBeInstanceOf(int);
});

test("toThrow", () => {
  const raise = () => {
    throw new ValueError("no good");
  };
  expect(raise).toThrow(ValueError);
  expect(raise).toThrow("no good");
  expect(raise).toThrow(/no/);
  expect(raise).toThrow(Error);
  // whatever can be called
  expect(functools.partial(int, "x")).toThrow(ValueError);
});
