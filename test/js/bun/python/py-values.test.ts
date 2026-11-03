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
  len,
  list,
  repr,
  str,
} from "python:builtins";
import json from "python:json";
import math from "python:math";

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
