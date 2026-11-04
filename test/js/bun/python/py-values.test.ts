// What JavaScript sees of the values of Python.
import { float, kwargs } from "bun:python";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { isASAN, isDebug } from "harness";
import {
  Exception,
  ImportError,
  ModuleNotFoundError,
  NameError,
  TypeError as PyTypeError,
  abs,
  dict,
  exec,
  int,
  isinstance,
  iter,
  len,
  list,
  range,
  repr,
  round,
  str,
  tuple,
} from "python:builtins";
import _queue from "python:_queue";
import datetime from "python:datetime";
import fractions from "python:fractions";
import json from "python:json";
import math from "python:math";
import operator from "python:operator";

// These builds take seconds to start Python.
if (isDebug || isASAN) setDefaultTimeout(60_000);

/** The globals of a piece of Python. */
function python(code: string) {
  const globals = dict();
  exec(code, globals);
  return globals;
}

describe("a call passes a function more than it takes", () => {
  test("written in Python", () => {
    const { double } = python("def double(x): return x * 2");
    expect([1, 2].map(double)).toEqual([2, 4]);
  });

  test("written in C++", () => {
    expect(["a", "bc"].map(len)).toEqual([1, 2]);
    expect([-1, 2].map(abs)).toEqual([1, 2]);
    expect([4, 9].map(math.sqrt)).toEqual([2, 3]);
    expect(["a", "b"].map(str.upper)).toEqual(["A", "B"]);
    const seen: unknown[] = [];
    [1, 2].forEach(list.prototype.append.bind(seen));
    const items = dict([["a", 1]]);
    expect(["a", "b"].map(dict.get.bind(undefined, items))).toEqual([1, 1]); // get(key, default): the index
    expect(len("abc", "more", "and more")).toBe(3);
  });

  test("but not less, and Python does not", () => {
    expect(() => len()).toThrow(PyTypeError);
    expect(() => python("len('a', 'b')")).toThrow("len() takes exactly one argument (2 given)");
    expect(() => len("a", kwargs({ more: 1 }))).toThrow(PyTypeError);
  });
});

describe("==", () => {
  test("asks the class even about the object itself", () => {
    const [nan, one] = json.loads("[NaN, 1.0]");
    expect(typeof nan).toBe("object");
    expect(nan == nan).toBe(false);
    expect(nan != nan).toBe(true);
    expect(nan === nan).toBe(true);
    expect(one == one).toBe(true);
    const { Never, Silent } = python(`
class Never:
    def __eq__(self, other): return False
class Silent:
    def __eq__(self, other): return NotImplemented
`);
    const [never, silent] = [Never(), Silent()];
    expect(never == never).toBe(false);
    expect(silent == silent).toBe(true);
    expect(silent == Silent()).toBe(false);
    expect(repr(float(2))).toBe("2.0");
  });
});

test("a class has its own name, whatever its instances call `name`", () => {
  expect(Exception.name).toBe("Exception");
  expect(ImportError.name).toBe("ImportError");
  expect(ModuleNotFoundError.name).toBe("ModuleNotFoundError");
  expect(NameError.name).toBe("NameError");
  expect(new ImportError("x").constructor.name).toBe("ImportError");
  expect(python("class C:\n    name = 'own'").C.name).toBe("own");
});

test("a TypeError is a TypeError in both languages", () => {
  const py = python(`
class Mine(TypeError): pass
class Other(Exception): pass
def become(error, cls): error.__class__ = cls
def caught(call):
    try:
        call()
    except TypeError as error:
        return error
`);
  expect(() => len(5)).toThrow(TypeError);
  expect(() => len(5)).toThrow(PyTypeError);
  class Derived extends PyTypeError {}
  for (const error of [new PyTypeError("x"), new py.Mine("x"), new Derived("x")]) {
    expect(error).toBeInstanceOf(TypeError);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(RangeError);
    expect(TypeError.prototype.isPrototypeOf(error)).toBe(true);
    expect([error.message, error.name, error.constructor.name]).toEqual([
      "x",
      error.constructor.name,
      str(error.__class__.__name__),
    ]);
  }
  for (const error of [new Exception("x"), new ImportError("x"), new py.Other("x")]) {
    expect(error).not.toBeInstanceOf(TypeError);
    expect(error).toBeInstanceOf(Error);
  }

  // It goes by the class, in optimized code as well.
  const isTypeError = (value: unknown) => value instanceof TypeError;
  const changing = new py.Other("x");
  const values = [new PyTypeError("x"), new Exception("x"), new TypeError("x"), {}, changing];
  const count = () => {
    let count = 0;
    for (let i = 0; i < (isDebug ? 5_000 : 200_000); i++) count += +isTypeError(values[i % 5]);
    return count / (isDebug ? 1_000 : 40_000);
  };
  expect(count()).toBe(2);
  py.become(changing, py.Mine);
  expect(count()).toBe(3);

  // The other way round.
  const thrown = new TypeError("of JavaScript");
  const error = py.caught(() => {
    throw thrown;
  });
  expect(error.value).toBe(thrown);
  expect(String(repr(error))).toBe("JSTypeError('TypeError: of JavaScript')");
  expect(() =>
    py.caught(() => {
      throw new RangeError("not one");
    }),
  ).toThrow(RangeError);
});

test("-0 is the int 0, and the -0.0 of Python is -0", () => {
  expect([String(repr(-0)), isinstance(-0, int), math.copysign(1, -0)]).toEqual(["0", true, 1]);
  for (let i = 0; i < 2; i++) expect([...range(-i)]).toEqual([]);
  expect([...range(3)].at(operator.index(-0))).toBe(0);
  // toBe() tells 0 from -0.
  expect(round(-0)).toBe(0);
  expect(abs(-0)).toBe(0);
  expect(int(-0)).toBe(0);
  expect(operator.mul(-0, 1.5)).toBe(0);
  expect(operator.mul(-0, -1.5)).toBe(-0);

  const zero = float(-0);
  expect([String(repr(zero)), math.copysign(1, zero), typeof zero]).toEqual(["-0.0", -1, "object"]);
  expect(+zero).toBe(-0);
  expect(math.copysign(0, -1)).toBe(-0);
  expect(operator.neg(float(0))).toBe(-0);
  expect(json.loads("-0.0")).toBe(-0);
  expect(String(repr(json.loads("[-0.0, -0]")))).toBe("[-0.0, 0]");
});

test("yield* gives what the iterator returned", () => {
  const { generator, Plain } = python(`
def generator():
    yield 1
    return 42

class Plain:
    def __iter__(self):
        return self
    def __next__(self):
        raise StopIteration(7)
`);
  function* outer(make: () => any): Generator<unknown> {
    yield ["returned", yield* make()];
  }
  expect([...outer(generator)]).toEqual([1, ["returned", 42]]);
  expect([...outer(Plain)]).toEqual([["returned", 7]]);
  expect(Plain().next()).toEqual({ value: 7, done: true });
});

test("a native function that has to wait takes keywords from JavaScript", () => {
  const queue = _queue.SimpleQueue();
  expect(() => queue.get(kwargs({ timeout: 0.001 }))).toThrow(_queue.Empty);
  expect(() => queue.get(kwargs({ block: false }))).toThrow(_queue.Empty);
  queue.put(1);
  expect(queue.get(kwargs({ timeout: 10 }))).toBe(1);
});

test("JSON.stringify() gives isoformat() of a date, a time and a datetime", () => {
  const { date, time, datetime: moment, timedelta, timezone } = datetime;
  const zone = timezone(timedelta(kwargs({ hours: 2 })));
  expect(
    JSON.stringify({
      date: date(2020, 1, 2),
      time: time(3, 4, 5),
      moment: moment(2020, 1, 2, 3, 4, 5, 678),
      aware: [moment(2020, 1, 2, 3, 4, 5, kwargs({ tzinfo: zone }))],
    }),
  ).toBe(
    '{"date":"2020-01-02","time":"03:04:05","moment":"2020-01-02T03:04:05.000678","aware":["2020-01-02T03:04:05+02:00"]}',
  );
  expect(date(2020, 1, 2).toJSON()).toBe("2020-01-02");
  expect(JSON.stringify(dict([["when", date(2020, 1, 2)]]))).toBe('{"when":"2020-01-02"}');
  expect(new Date(JSON.parse(JSON.stringify(moment(2020, 1, 2, kwargs({ tzinfo: timezone.utc }))))).getTime()).toBe(
    Date.UTC(2020, 0, 2),
  );
  // A class derived from one has the last word, on isoformat() and on toJSON().
  const { Short, Own } = python(`
import datetime
class Short(datetime.date):
    def isoformat(self): return "short"
class Own(datetime.date):
    def toJSON(self, key): return [self.year]
`);
  expect(JSON.stringify([Short(2020, 1, 2), Own(2020, 1, 2)])).toBe('["short",[2020]]');
  // Nothing else of the module has one.
  expect(timedelta(1).toJSON).toBeUndefined();
  expect(JSON.stringify(timedelta(1))).toBe("{}");
});

describe.each([
  ["a Proxy around", (value: any) => new Proxy(value, {})],
  ["Object.create() of", (value: any) => Object.create(value)],
])("%s an object of Python's", (_, wrap) => {
  const half = wrap(fractions.Fraction(1, 2));
  const items = wrap(dict([["a", 1]]));

  test("has its attributes, items and methods", () => {
    expect([half.numerator, half.denominator, items.a, items.get("a"), half.limit_denominator(1) == 0]).toEqual([
      1,
      2,
      1,
      1,
      true,
    ]);
  });

  test("is shown as it is", () => {
    expect([String(half), `${half}`, half.toString(), Bun.inspect(items)]).toEqual(["1/2", "1/2", "1/2", "{'a': 1}"]);
    expect(Number(half)).toBe(0.5);
    expect(half == fractions.Fraction(1, 2)).toBe(true);
  });

  test("is iterated over as it is", () => {
    expect([...items]).toEqual([["a", 1]]);
    expect([...wrap(tuple([1, 2]))]).toEqual([1, 2]);
    expect(wrap(iter([7])).next()).toEqual({ value: 7, done: false });
  });
});
