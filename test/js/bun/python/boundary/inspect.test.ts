// How each language shows the values of the other: console.log(), Bun.inspect(), util.inspect(), util.format(), console.table(); repr().
import { float, kwargs } from "bun:python";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import util from "node:util";
import {
  Ellipsis,
  NotImplemented,
  RecursionError,
  TypeError as PyTypeError,
  ValueError,
  bytearray,
  bytes,
  complex,
  dict,
  exec,
  frozenset,
  int,
  len,
  list,
  range,
  repr,
  set,
  slice,
  str,
  tuple,
} from "python:builtins";
import collections from "python:collections";
import datetime from "python:datetime";
import decimal from "python:decimal";
import fractions from "python:fractions";
import json from "python:json";
import pathlib from "python:pathlib";
import re from "python:re";
import types from "python:types";

// These builds take seconds to start Python.
if (isDebug || isASAN) setDefaultTimeout(60_000);

const globals = dict([["__name__", "fixture"]]);
exec(
  `
import dataclasses, enum

class Plain:
    pass

class BadRepr:
    def __repr__(self):
        raise ValueError("no repr")

class BadStr:
    def __str__(self):
        raise ValueError("no str")

class NotText:
    def __repr__(self):
        return 5

@dataclasses.dataclass
class Point:
    x: int
    y: int

class Color(enum.Enum):
    RED = 1

def function(a, b=2): pass
`,
  globals,
);
const { Plain, BadRepr, BadStr, NotText, Point, Color } = globals;
const withoutAddresses = (text: string) => text.replace(/0x[0-9a-f]+/g, "0x");

describe("Bun.inspect() and util.inspect() are repr()", () => {
  test.each([
    [tuple([1, "a", undefined]), "(1, 'a', None)"],
    [dict([["a", 1], [2, "b"], [tuple([1]), 3]]), "{'a': 1, 2: 'b', (1,): 3}"], // prettier-ignore
    [set([1]), "{1}"],
    [frozenset([1]), "frozenset({1})"],
    [bytes([1, 65]), "b'\\x01A'"],
    [bytearray([1, 65]), "bytearray(b'\\x01A')"],
    [range(3), "range(0, 3)"],
    [complex(1, 2), "(1+2j)"],
    [slice(1, 2), "slice(1, 2, None)"],
    [float(2), "2.0"],
    [datetime.date(2020, 1, 2), "datetime.date(2020, 1, 2)"],
    [decimal.Decimal("1.50"), "Decimal('1.50')"],
    [fractions.Fraction(1, 3), "Fraction(1, 3)"],
    [collections.deque([1, 2]), "deque([1, 2])"],
    [collections.OrderedDict([["a", 1]]), "OrderedDict({'a': 1})"],
    [collections.Counter("aab"), "Counter({'a': 2, 'b': 1})"],
    [collections.namedtuple("P", "x y")(1, 2), "P(x=1, y=2)"],
    [types.SimpleNamespace(kwargs({ a: 1 })), "namespace(a=1)"],
    [Point(1, 2), "Point(x=1, y=2)"],
    [Color.RED, "<Color.RED: 1>"],
    [Color, "<enum 'Color'>"],
    [re.compile("a+"), "re.compile('a+')"],
    [re.match("a+", "aa"), "<re.Match object; span=(0, 2), match='aa'>"],
    [pathlib.PurePosixPath("/a/b"), "PurePosixPath('/a/b')"],
    [len, "<built-in function len>"],
    [int, "<class 'int'>"],
    [Plain, "<class 'fixture.Plain'>"],
    [json, /^<module 'json' from '.*'>$/],
    [Ellipsis, "Ellipsis"],
    [NotImplemented, "NotImplemented"],
  ])("%p", (value, expected) => {
    for (const shown of [Bun.inspect(value), util.inspect(value), repr(value)])
      if (typeof expected === "string") expect(shown).toBe(expected);
      else expect(shown).toMatch(expected);
  });

  test("whatever the options", () => {
    expect(Bun.inspect(tuple([1, "a"]), { colors: true })).toBe("(1, 'a')");
    expect(util.inspect(tuple([1, "a"]), { colors: true, showHidden: true, depth: 0 })).toBe("(1, 'a')");
  });

  test("an exception is shown with its traceback", () => {
    let caught;
    try {
      exec("raise ValueError('shown')", dict());
    } catch (error) {
      caught = error;
    }
    expect(
      Bun.inspect(caught).replace(/  File ".*inspect\.test\.ts", line \d+/, '  File "inspect.test.ts", line N'),
    ).toBe(
      `Traceback (most recent call last):
  File "inspect.test.ts", line N, in <anonymous>
    exec("raise ValueError('shown')", dict());
  File "<string>", line 1, in <module>
ValueError: shown`,
    );
  });
});

describe("one inside the other", () => {
  test("Python's in the containers of JavaScript", () => {
    expect(Bun.inspect({ a: tuple([1, 2]), b: [dict([["k", 1]])], c: new Map([[tuple([1]), set([2])]]) })).toBe(
      "{\n  a: (1, 2),\n  b: [\n    {'k': 1}\n  ],\n  c: Map(1) {\n    (1,): {2},\n  },\n}",
    );
    expect(util.inspect({ a: tuple([1, 2]), b: [dict([["k", 1]])] })).toBe("{ a: (1, 2), b: [ {'k': 1} ] }");
    expect(Bun.inspect([float(2), 1.5])).toBe("[\n  2.0, 1.5\n]");
    expect(util.inspect({ a: { b: tuple([1]) } }, { depth: 0 })).toBe("{ a: [Object] }");
  });

  test("JavaScript's in the containers of Python", () => {
    class Named {}
    const shown = withoutAddresses(
      repr(
        tuple([{ a: 1 }, [1, "x"], new Map(), new Date(0), /x/g, () => 1, Symbol("s"), null, 1n, new Named(), Named]),
      ),
    );
    expect(shown).toBe(
      "(<JavaScript Object at 0x>, [1, 'x'], <JavaScript Map at 0x>, <JavaScript Date at 0x>, <JavaScript RegExp at 0x>, " +
        "<JavaScript function  at 0x>, Symbol(s), None, 1, <JavaScript Named at 0x>, <JavaScript function Named at 0x>)",
    );
    expect(str({ toString: () => "its own" })).toBe("its own");
  });
});

describe("util.format()", () => {
  test("%s is str(), %o and %O are repr(), %j is JSON", () => {
    const date = datetime.date(2020, 1, 2);
    expect(util.format("%s|%s|%s", tuple([1]), date, dict([["a", 1]]))).toBe("(1,)|2020-01-02|{'a': 1}");
    expect(util.format("%o|%O", tuple([1]), dict([["a", 1]]))).toBe("(1,)|{'a': 1}");
    expect(util.format("%j|%j", tuple([1]), dict([["a", 1]]))).toBe('[1]|{"a":1}');
    expect(util.format(tuple([1]), date)).toBe("(1,) datetime.date(2020, 1, 2)");
  });

  test("%d, %i and %f take numbers of Python's", () => {
    expect(
      util.format("%d|%d|%i|%f", decimal.Decimal("1.5"), fractions.Fraction(1, 2), [float(2)][0], [float(2)][0]),
    ).toBe("1.5|0.5|2|2");
  });
});

describe("cycles", () => {
  const array: unknown[] = [];
  array.push(tuple([array]));
  const mapping = dict();
  const object = { mapping };
  mapping.object = object;

  test("through a list and a tuple", () => {
    expect(repr(array)).toBe("[([...],)]");
    expect(Bun.inspect(array)).toBe("[\n  ([(...)],)\n]");
    expect(util.inspect(array)).toBe("[ ([(...)],) ]");
  });

  test("through an object and a dict", () => {
    expect(withoutAddresses(Bun.inspect(object))).toBe("{\n  mapping: {'object': <JavaScript Object at 0x>},\n}");
    expect(withoutAddresses(repr(mapping))).toBe("{'object': <JavaScript Object at 0x>}");
  });

  test("of one", () => {
    const itself = dict();
    itself.itself = itself;
    expect(Bun.inspect(itself)).toBe("{'itself': {...}}");
  });

  test("are refused by JSON in both languages", () => {
    expect(() => JSON.stringify(array)).toThrow("JSON.stringify cannot serialize cyclic structures.");
    expect(() => JSON.stringify(object)).toThrow("JSON.stringify cannot serialize cyclic structures.");
    expect(() => json.dumps(array)).toThrow(ValueError);
  });

  test("to compare two is a RecursionError, as in Python", () => {
    const other: unknown[] = [];
    other.push(tuple([other]));
    expect(Bun.deepEquals(array, array)).toBe(true);
    expect(() => Bun.deepEquals(array, other)).toThrow(RecursionError);
  });
});

test("what is nested too deep is an exception, whichever language notices", () => {
  let deep: unknown = [];
  for (let i = 0; i < 100_000; i++) deep = i % 2 ? [deep] : tuple([deep]);
  expect(() => Bun.inspect(deep)).toThrow(RecursionError);
  expect(() => repr(deep)).toThrow(RecursionError);
});

test("a large container is shown whole if it is Python's", () => {
  expect(Bun.inspect(tuple(range(20_000)))).toHaveLength(repr(tuple(range(20_000))).length);
  expect(Bun.inspect(list(range(20_000))).length).toBeLessThan(1000);
});

describe("a __repr__ or __str__ that fails", () => {
  test("is what showing the object throws", () => {
    expect(() => Bun.inspect(BadRepr())).toThrow(ValueError);
    expect(() => util.inspect(BadRepr())).toThrow("no repr");
    expect(() => Bun.inspect([{ nested: BadRepr() }])).toThrow("no repr");
    expect(() => `${BadRepr()}`).toThrow("no repr");
    expect(() => String(BadStr())).toThrow("no str");
    expect(() => Bun.inspect(NotText())).toThrow(PyTypeError);
  });
});

test("console.log(), console.table() and console.dir()", async () => {
  using dir = tempDir("python-inspect", {
    "main.ts": `
      import { dict, tuple } from "python:builtins";
      import { SimpleNamespace } from "python:types";
      import { kwargs } from "bun:python";
      console.log(tuple([1, "a"]), dict([["k", [1]]]), tuple([2]));
      console.log("%s and %o", tuple([1]), dict([["a", 1]]));
      console.table([dict([["a", 1], ["b", 2]]), dict([["a", 3]])]);
      console.table([tuple([1, 2]), tuple([3, 4])]);
      console.table([SimpleNamespace(kwargs({ x: 1, y: 2 }))]);
      console.dir(dict([["a", dict([["b", dict([["c", 1]])]])]]), { depth: 0 });
      console.error(tuple([3]));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("(3,)\n");
  expect(stdout).toBe(`(1, 'a') {'k': [1]} (2,)
(1,) and {'a': 1}
┌───┬───┬───┐
│   │ a │ b │
├───┼───┼───┤
│ 0 │ 1 │ 2 │
│ 1 │ 3 │   │
└───┴───┴───┘
┌───┬───┬───┐
│   │ 0 │ 1 │
├───┼───┼───┤
│ 0 │ 1 │ 2 │
│ 1 │ 3 │ 4 │
└───┴───┴───┘
┌───┬───┬───┐
│   │ x │ y │
├───┼───┼───┤
│ 0 │ 1 │ 2 │
└───┴───┴───┘
{'a': {'b': {'c': 1}}}
`);
  expect(exitCode).toBe(0);
});
