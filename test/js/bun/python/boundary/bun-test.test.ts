// bun:test with objects of Python's: the matchers that ../matchers.test.ts does not have, mocks, spies, each(), snapshots.
import { float, kwargs } from "bun:python";
import { describe, expect, jest, mock, setDefaultTimeout, spyOn, test } from "bun:test";
import { isASAN, isDebug } from "harness";
import {
  KeyError,
  ValueError,
  bytes,
  dict,
  exec,
  frozenset,
  getattr,
  int,
  len,
  set,
  sorted,
  str,
  tuple,
} from "python:builtins";
import collections from "python:collections";
import datetime from "python:datetime";
import json from "python:json";

// These builds take seconds to start Python, and longer to import asyncio.
if (isDebug || isASAN) setDefaultTimeout(120_000);

const globals = dict([["__name__", "fixture"]]);
exec(
  `
import dataclasses

@dataclasses.dataclass
class Point:
    x: int
    y: int

class Plain:
    def __init__(self, a):
        self.a = a
    def hello(self, n=1):
        return "hello" * n

def call(function, *args, **keywords):
    return function(*args, **keywords)

def raiser(message):
    raise ValueError(message)

async def fails():
    raise ValueError("rejected")

async def succeeds():
    return (1, 2)
`,
  globals,
);
const { Point, Plain, call, raiser, fails, succeeds } = globals;

describe("matchers", () => {
  test("toContain, toContainEqual", () => {
    expect(tuple([1, 2])).toContain(2);
    expect(set([1, 2])).toContain(2);
    expect(tuple([1, 2])).not.toContain(3);
    expect(tuple([tuple([1]), tuple([2])])).toContainEqual(tuple([2]));
    expect([tuple([1]), tuple([2])]).toContainEqual(tuple([2]));
  });

  test("toHaveLength, toBeEmpty", () => {
    expect(tuple([1, 2])).toHaveLength(2);
    expect(dict([["a", 1]])).toHaveLength(1);
    expect(set([1])).toHaveLength(1);
    expect(bytes([1, 2, 3])).toHaveLength(3);
    for (const empty of [tuple([]), dict(), set()]) expect(empty).toBeEmpty();
    for (const full of [tuple([1]), dict([["a", 1]]), dict([[tuple([1]), 1]]), set([1])]) expect(full).not.toBeEmpty();
  });

  test("toHaveProperty", () => {
    expect(Plain(1)).toHaveProperty("a", 1);
    expect(Point(1, 2)).toHaveProperty("y");
    expect(dict([["a", dict([["b", 2]])]])).toHaveProperty("a.b", 2);
    expect(Plain(1)).not.toHaveProperty("nothing");
  });

  test("toMatchObject", () => {
    expect(Point(1, 2)).toMatchObject({ x: 1 });
    expect(dict([["a", 1], ["b", 2]])).toMatchObject({ a: 1 }); // prettier-ignore
    expect({ point: Point(1, 2), other: 1 }).toMatchObject({ point: Point(1, 2) });
    expect({ a: 1, b: 2 }).toMatchObject(dict([["a", 1]]));
    expect(Point(1, 2)).not.toMatchObject({ x: 2 });
  });

  test("toContainKey, toContainKeys, toContainValue", () => {
    const mapping = dict([["a", 1], ["b", 2]]); // prettier-ignore
    expect(mapping).toContainKey("a");
    expect(mapping).toContainKeys(["a", "b"]);
    expect(mapping).toContainValue(1);
  });

  test("asymmetric matchers", () => {
    expect({ point: Point(1, 2), number: 5, text: "x" }).toEqual({
      point: expect.any(Point),
      number: expect.any(int),
      text: expect.any(str),
    });
    expect(Point(1, 2)).toEqual(expect.anything());
    expect(Point(1, 2)).toEqual(expect.objectContaining({ x: 1 }));
  });

  test("what kind of value it is", () => {
    for (const callable of [len, call, Point]) expect(callable).toBeFunction();
    expect(tuple([1])).toBeObject();
    expect(tuple([1])).not.toBeArray();
    expect(tuple([1])).toBeTypeOf("object");
    expect(datetime.date(2020, 1, 1)).not.toBeDate();
    expect(new ValueError("x")).toBeInstanceOf(Error);
    // Every object is true to JavaScript.
    expect(tuple([])).toBeTruthy();
  });

  test("toSatisfy, toBeOneOf", () => {
    expect(Point(1, 2)).toSatisfy((point: any) => point.x === 1);
    expect(tuple([1])).toBeOneOf([tuple([2]), tuple([1])]);
    expect(2).toBeOneOf(tuple([1, 2]));
  });

  test("toThrow", () => {
    expect(() => raiser("boom")).toThrow(/bo+m/);
    expect(() => raiser("boom")).toThrow(new ValueError("boom"));
    expect(() => raiser("boom")).toThrow(expect.objectContaining({ message: "boom" }));
    expect(() => raiser("boom")).not.toThrow(KeyError);
  });

  test("resolves, rejects", async () => {
    await expect(succeeds()).resolves.toEqual(tuple([1, 2]));
    await expect(fails()).rejects.toThrow(ValueError);
    await expect(fails()).rejects.toThrow("rejected");
  });

  // A dict is iterated over as a Map is, by pairs.
  test.failing("toContain asks a dict for a key", () => {
    expect(dict([["a", 1]])).toContain("a");
  });
  test.failing("arrayContaining takes a tuple", () => {
    expect(tuple([1, 2, 3])).toEqual(expect.arrayContaining([2]));
  });
  // A float that is a whole number is an object where it is in a list.
  test.failing("a float in a list is a number", () => {
    expect([float(2)]).toContain(2);
    expect([float(2)][0]).toBeNumber();
    expect([float(2)][0]).toBeCloseTo(2);
  });
});

describe("mock functions", () => {
  test("record what Python passes", () => {
    const recorder = mock();
    call(recorder, tuple([1]), Point(1, 2));
    call(recorder, 3, kwargs({ key: 1 }));
    expect(recorder).toHaveBeenCalledTimes(2);
    expect(recorder).toHaveBeenCalledWith(tuple([1]), Point(1, 2));
    expect(recorder).toHaveBeenLastCalledWith(3, { key: 1 });
    expect(recorder.mock.calls[0][1]).toEqual(Point(1, 2));
  });

  // Python takes what can be constructed and is no plain function for a class, and to call a class is `new`.
  test.failing("are called by Python, not constructed", () => {
    const double = mock((value: number) => value * 2);
    expect(call(double, 2)).toBe(4);
    expect(call(jest.fn(() => 5))).toBe(5);
    expect(double.mock.instances).toEqual([undefined]);
  });
  test.failing("as a key function", () => {
    const key = mock((value: number) => -value);
    expect(sorted([1, 3, 2], kwargs({ key }))).toEqual([3, 2, 1]);
  });
});

describe("spyOn()", () => {
  test("a method of an instance", () => {
    const plain = Plain(1);
    const spy = spyOn(plain, "hello");
    expect(plain.hello(2)).toBe("hellohello");
    expect(spy).toHaveBeenCalledWith(2);
    spy.mockReturnValue("mocked");
    expect(plain.hello()).toBe("mocked");
    expect(getattr(plain, "hello")()).toBe("mocked");
    spy.mockRestore();
    expect(plain.hello()).toBe("hello");
  });

  // The spy is put where Python does not look.
  test.failing("a function of a module", () => {
    using spy = spyOn(json, "dumps");
    expect(json.dumps([1])).toBe("[1]");
    expect(spy).toHaveBeenCalledTimes(1);
  });
  test.failing("a method of a class", () => {
    using spy = spyOn(Plain.prototype, "hello");
    expect(Plain(1).hello()).toBe("hello");
    expect(spy).toHaveBeenCalledTimes(1);
  });
  test.failing("an item of a dict", () => {
    const mapping = dict([["f", () => 1]]);
    const spy = spyOn(mapping, "f");
    expect(mapping.f()).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("each()", () => {
  test.each([
    [tuple([1, 2]), 2],
    [dict([["a", 1]]), 1],
    [set([1, 2, 3]), 3],
  ])("%p has %i items", (value, length) => {
    expect(len(value)).toBe(length);
  });
  describe.each([Point(1, 2)])("%o", point => {
    test("is passed on", () => expect(point.x).toBe(1));
  });
});

describe("snapshots", () => {
  test("show repr()", () => {
    expect(tuple([1, dict([["a", 2]])])).toMatchInlineSnapshot(`(1, {'a': 2})`);
    expect(Point(1, 2)).toMatchInlineSnapshot(`Point(x=1, y=2)`);
    expect({
      tuple: tuple([1, "a"]),
      dict: dict([["key", [1, float(2)]]]),
      dataclass: Point(1, 2),
      frozenset: frozenset([1]),
      date: datetime.date(2020, 1, 2),
      ordered: collections.OrderedDict([["a", 1]]),
      class: Point,
      function: call,
    }).toMatchInlineSnapshot(`
      {
        "class": [class Point],
        "dataclass": Point(x=1, y=2),
        "date": datetime.date(2020, 1, 2),
        "dict": {'key': [1, 2.0]},
        "frozenset": frozenset({1}),
        "function": [Function: call],
        "ordered": OrderedDict({'a': 1}),
        "tuple": (1, 'a'),
      }
    `);
  });

  test.failing("a function written in C++ is shown as a function", () => {
    expect(len).toMatchInlineSnapshot(`[Function: len]`);
  });
});
