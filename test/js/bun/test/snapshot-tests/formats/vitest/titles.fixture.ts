// @ts-nocheck
import { describe, expect, it, test } from "vitest";

// The key of a snapshot has the title of its test, so these are found only if the titles of the rows are Vitest's.
// Each snapshot is a number of its own: none is found under the title of another.
let count = 0;
const snapshot = () => () => expect(++count).toMatchSnapshot();
const each = (title, ...rows) => test.each(rows)(title, snapshot());
const repeat = (text, times) => Array(times + 1).join(text);
const numbers = length => Array.from({ length }, (_, i) => i);
class Point {
  x = 1;
  y = 2;
}
const element = (type, props = {}) => ({ $$typeof: Symbol.for("react.transitional.element"), type, props });
const cycle = {};
cycle.self = cycle;

describe("%o and %O", () => {
  each(
    "primitive %o",
    [undefined],
    [null],
    [true],
    [0],
    [-0],
    [1.5],
    [NaN],
    [-Infinity],
    [1e21],
    [10n],
    [Symbol("s")],
    [Symbol()],
  );
  each("string %o", ["str"], [""], [`it's "q"`], ["a\\b"], ["tab\there"], ["日本語"], ["%s"], ["$a"]);
  each(
    "in a value %o",
    [["a", "b'c"]],
    [{ s: `it's "q"` }],
    [[{ a: 1 }, "s"]],
    [new Set(["a"])],
    [new Map([["k", "v"]])],
  );
  each("function %o", [() => {}], [function named() {}], [class Klass {}], [async function later() {}], [Math.max]);
  each("function in a value %o", [{ f() {} }], [[function named() {}]]);
  each(
    "object %o",
    [{}],
    [{ a: 1 }],
    [{ a: 1, b: "two", c: [3] }],
    [{ a: undefined, b: null }],
    [Object.create(null)],
    [new Point()],
  );
  each(
    "keys %o",
    [{ "a-b": 1 }],
    [{ 1: "a", b2: "c", _: 3, $: 4 }],
    [{ "": 1 }],
    [{ ä: 1 }],
    [{ "a b": 1 }],
    [{ [Symbol("k")]: 1, a: 2 }],
  );
  each("own order %o", [{ z: 1, y: 2, a: 3 }], [{ b: 1, 2: "x", a: 2, 1: "y" }]);
  each("array %o", [[]], [[[]]], [[[1, 2, 3]]], [[[1, [2, [3]]]]], [[[1, , 3]]], [[[,]]], [[[undefined, null]]]);
  each(
    "typed %o",
    [new Uint8Array([1, 2])],
    [new Float64Array([-0, 1.5])],
    [new BigInt64Array([1n])],
    [new Uint8Array([1, 200]).buffer],
    [Buffer.from("ab")],
  );
  each(
    "collection %o",
    [new Map()],
    [new Map([["k", 1]])],
    [new Map([[{ a: 1 }, [2]]])],
    [new Set()],
    [new Set([1])],
    [new WeakMap()],
    [new WeakSet()],
  );
  each(
    "other %o",
    [new Date(0)],
    [new Date(NaN)],
    [/a.b*/g],
    [/[$()]/],
    [new Error("boom")],
    [new TypeError("t", { cause: 1 })],
    [Promise.resolve(1)],
  );
  each("boxed %o", [new String("b")], [new Number(1)], [new Boolean(false)], [Object(10n)]);
  each("cycle %o", [cycle], [[cycle]], [{ a: { b: cycle } }]);
  each(
    "getter %o",
    [
      {
        get g() {
          return 7;
        },
      },
    ],
    [{ toJSON: () => ({ json: true }) }],
    [
      {
        a: 1,
        toJSON() {
          throw new Error("no");
        },
      },
    ],
  );
  each(
    "tag %o",
    [{ [Symbol.toStringTag]: "Tag", a: 1 }],
    [{ constructor: "x" }],
    [{ constructor: function Fake() {} }],
  );
  each(
    "matcher %o",
    [expect.anything()],
    [expect.any(Number)],
    [expect.arrayContaining([1, "a"])],
    [expect.objectContaining({ z: 1, a: "s" })],
  );
  each(
    "matcher %o",
    [expect.stringContaining("it's")],
    [expect.stringMatching(/r.e/)],
    [expect.closeTo(1.23, 1)],
    [expect.not.arrayContaining([1])],
  );
  each(
    "markup %o",
    [element("div")],
    [element("a", { href: "x", n: 1 })],
    [element("p", { children: "hi" })],
    [element("b", { children: [element("i"), "t"] })],
  );
  each("%O is the same %O", [{ a: "x" }, ["y"]]);
});

describe("what is longer than 40", () => {
  each(
    "string %o",
    [repeat("x", 38)],
    [repeat("x", 39)],
    [repeat("x", 100)],
    [repeat("😀", 19)],
    [repeat("😀", 20)],
    ["x" + repeat("😀", 20)],
  );
  each(
    "array %o",
    [numbers(12)],
    [numbers(13)],
    [numbers(14)],
    [numbers(120)],
    [[repeat("x", 34)]],
    [[repeat("x", 35)]],
    [[1, repeat("x", 60), 2]],
  );
  each(
    "object %o",
    [{ long: repeat("x", 90) }],
    [{ a: 1, long: repeat("x", 90) }],
    [{ key: repeat("v", 29) }],
    [{ key: repeat("v", 30) }],
  );
  each("many keys %o", [Object.fromEntries(numbers(30).map(i => ["k" + i, i]))], [{ [repeat("k", 50)]: 1 }]);
  each(
    "depth %o",
    [{ a: { b: { c: { d: { e: { f: 1 } } } } } }],
    [{ a: { b: { c: repeat("x", 30) } }, d: [1, 2, 3] }],
    [{ a: { b: 1 }, c: { d: 2 }, e: { f: 3 }, g: { h: 4 } }],
  );
  each(
    "deep %o",
    [[[[[[[[[[[[[1]]]]]]]]]]]]],
    [{ a: { a: { a: { a: { a: { a: { a: { a: { a: { a: { a: 1 } } } } } } } } } } }],
  );
  each(
    "collection %o",
    [new Set(numbers(100))],
    [new Map(numbers(100).map(i => [i, i]))],
    [new Set([repeat("x", 60), 1])],
    [new Map([["k", repeat("x", 60)]])],
  );
  each(
    "not listed %o",
    [Object.assign(new Point(), { long: repeat("x", 60) })],
    [{ [Symbol.toStringTag]: "Tag", long: repeat("x", 60) }],
    [new Uint8Array(50)],
  );
  each(
    "whole %o",
    [new Error(repeat("m", 60))],
    [new RegExp(repeat("r", 50))],
    [Symbol(repeat("d", 50))],
    [2n ** 200n],
    [Object.defineProperty(() => {}, "name", { value: repeat("n", 50) })],
  );
  each(
    "matcher %o",
    [expect.arrayContaining(numbers(40))],
    [expect.objectContaining({ long: repeat("x", 60) })],
    [expect.stringContaining(repeat("x", 60))],
  );
  each(
    "markup %o",
    [element("div", { className: repeat("c", 60) })],
    [element("a", { children: element("b", { children: element("i", { children: repeat("x", 30) }) }) })],
  );
});

describe("the other placeholders", () => {
  each("%%s %s", ["str"], [""], [1], [-0], [10n], [null], [undefined], [true], [Symbol("s")], [repeat("x", 60)]);
  each(
    "%%s of an object %s",
    [{ a: "x" }],
    [[1, [2, 3]]],
    [new Date(0).toISOString()],
    [/x/g],
    [new Error("boom")],
    [{ toString: () => "own" }],
    [{ toString: () => 42 }],
    [Object.create(null)],
    [new Point()],
  );
  each(
    "%%s of a matcher %s",
    [expect.any(Number)],
    [expect.anything()],
    [expect.not.objectContaining({})],
    [expect.closeTo(1)],
  );
  each(
    "%%d %d",
    [1],
    [-0],
    [1.5],
    ["12"],
    ["12px"],
    [""],
    [null],
    [undefined],
    [true],
    [10n],
    [Symbol("s")],
    [{}],
    [[5]],
    [{ valueOf: () => 7 }],
    [{ valueOf: () => 7n }],
    [new Date(5)],
  );
  each(
    "%%i %i",
    [1.9],
    [-1.9],
    [-0],
    ["12px"],
    ["0x1f"],
    [" 7"],
    ["1e3"],
    [""],
    [null],
    [10n],
    [Symbol("s")],
    [1e21],
    [{}],
    [[5, 6]],
  );
  each(
    "%%f %f",
    [1.5],
    [-0],
    ["1.5px"],
    [".5"],
    ["-.5e1x"],
    ["Infinity"],
    ["-Infinityx"],
    ["1e400"],
    [""],
    [null],
    [10n],
    [Symbol("s")],
    [[2.5, 1]],
  );
  each(
    "%%j %j",
    [{ a: "x" }],
    ["s"],
    [undefined],
    [() => {}],
    [Symbol("s")],
    [NaN],
    [cycle],
    [new Date(0)],
    [[undefined]],
    [new Map([[1, 2]])],
    [expect.any(Number)],
    [expect.closeTo(1.5, 3)],
  );
  each("%%c <%c>", ["color: red"], [{ a: 1 }]);
  each("percent 100%% of %s", ["a", "b"], [{ a: 1 }, "b"], [Symbol("s"), 1], [10n, 1], [-0, 1]);
  each("percent at the end 100%%", [], [1]);
  each("unknown %p %x %5d %", [1]);
  each("index %# and %$ of %s", ["a"], ["b"], ["c"]);
  each("escaped %%# %%$ %%%# %#", ["a"], ["b"]);
  each("none left %s %d %i %f %o %O %j <%c>", [1]);
  each("more than are taken %s", [1, 2, 3]);
  each("signs %f %s %f", [-0, 1, 2], [1, -0, 2], [1, 2, -0], [-0, -0, -0]);
});

describe("$", () => {
  const row = {
    a: 1,
    b: "two",
    c: { d: [10, { e: "deep" }] },
    $: "dollar",
    $x: "dx",
    ä: "umlaut",
    0: "zero",
    long: repeat("l", 60),
    nul: null,
    s: "str",
    f() {},
    o: { p: "q" },
  };
  for (const title of [
    "$a",
    "$b",
    "$c",
    "$c.d",
    "$c.d.0",
    "$c.d.1.e",
    "$c.d[0]",
    "$c.x",
    "$c.x.y",
    "$a.b",
    "ends with $a.",
    "$a..b",
    "$.a",
    "$",
    "$$",
    "$$x",
    "$a$b",
    "$a $b",
    "$a,$b",
    "($a)",
    "$a-$b",
    "'$b'",
    "$ä",
    "$0",
    "$1",
    "$01",
    "$long",
    "$nul",
    "$nul.x",
    "$missing",
    "$s.length",
    "$s.0",
    "$f",
    "$f.name",
    "$o",
    "$toString",
    "$constructor.name",
    "$a%s",
    "%s$a",
    "$a%%",
    "%#$a",
    "%$a",
    "costs $5",
    "costs $5.00",
  ]) {
    each("object: " + title, row);
  }
  for (const title of ["$0", "$1", "$2", "$3", "$4", "$00", "$1a", "$a", "$2.d", "$3.0", "$0.d", "$length"])
    each("array: " + title, [1, "two", { d: 3 }, [4]]);
  for (const title of ["$0", "$a", "$1"]) each("object in an array: " + title, [{ a: 1, 1: "own" }, "second"]);
  for (const title of ["$0", "$a", "$length"]) each("no object: " + title, 5, "row", null, undefined);
});

describe("rows", () => {
  test.each([1, "a", [2, 3], { a: 4 }, null, undefined, [[5]], []])("each %o %o", snapshot());
  test.for([1, "a", [2, 3], { a: 4 }, null, undefined, [[5]], []])("for %o %o", snapshot());
  it.each([[{ a: "x" }]])("it.each %o", snapshot());
  describe.each([
    [{ a: "x" }, ["y"]],
    [new Map([["k", 1]]), 2],
  ])("describe.each %o %o", () => {
    test("inner", snapshot());
    test.each([["z"]])("inner %o", snapshot());
  });
  describe.for([[{ a: "x" }, ["y"]], ["s"]])("describe.for %o %o", () => {
    test("inner", snapshot());
  });
});

describe("tables", () => {
  test.each`
    a             | b
    ${1}          | ${"x"}
    ${{ c: "d" }} | ${["e"]}
  `("$a and $b, %o", snapshot());
  test.each`
    \n\ta\t | b\n\t
    ${1}    | ${2}
  `("tabs stay in a heading: $a and $b", snapshot());
  test.each`
    a    | b
    ${1} | ${2}
  `("one line has a third heading: $a and $b", snapshot());
  test.each`
    a    | b
    ${1} | ${2}
    ${3}
  `("a row that is not complete: $a and $b", snapshot());
  test.each`
    a b  | c
    ${1} | ${2}
  `("spaces are taken out of a heading: $ab and $c", snapshot());
  test.for`
    a    | b
    ${1} | ${{ c: "d" }}
  `("for: $a and $b", snapshot());
  describe.each`
    a
    ${"x"}
  `("describe.each: $a %o", () => {
    test("inner", snapshot());
  });
  test.each(["a|b"], 1, 2)("any array with arguments after it: $a and $b", snapshot());
});

describe("names", () => {
  test.each([["v"]])(function named() {}, snapshot());
  test.each([["v"]])(class Klass {}, snapshot());
  test.each([["v"]])(() => {}, snapshot());
  test.each([["v"]])(5, snapshot());
  test.each([["v"]])(
    Object.defineProperty(() => {}, "name", { value: "named %o" }),
    snapshot(),
  );
  describe.each([["v"]])(
    function block() {},
    () => {
      test("inner", snapshot());
    },
  );
});
