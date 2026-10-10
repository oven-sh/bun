// @ts-nocheck
import { describe, test, expect } from "vitest";

class Point {
  x = 1;
  y = 2;
  #secret = 3;
  get sum() {
    return this.x + this.y;
  }
  method() {}
  static origin = 0;
}
class Empty {}
class Child extends Point {
  z = 3;
}
class Tagged {
  get [Symbol.toStringTag]() {
    return "MyTag";
  }
  a = 1;
}
class WithToJSON {
  a = 1;
  toJSON() {
    return { json: true };
  }
}
function OldStyle(this: any) {
  this.a = 1;
}
const sym = Symbol("desc");

const circular: any = { name: "c" };
circular.self = circular;
circular.list = [circular, { back: circular }];
const circularArray: any[] = [1];
circularArray.push(circularArray);
const circularMap = new Map<any, any>();
circularMap.set("self", circularMap);
const shared = { s: 1 };

function args(..._a: any[]) {
  return arguments;
}

const cases: Record<string, () => unknown> = {
  // primitives
  "undefined": () => undefined,
  "null": () => null,
  "true": () => true,
  "false": () => false,
  "zero": () => 0,
  "negative zero": () => -0,
  "integer": () => 42,
  "float": () => 1.5,
  "small float": () => 1e-7,
  "large": () => 1e21,
  "NaN": () => NaN,
  "Infinity": () => Infinity,
  "-Infinity": () => -Infinity,
  "max safe": () => Number.MAX_SAFE_INTEGER,
  "bigint": () => 123n,
  "negative bigint": () => -5n,
  "huge bigint": () => 2n ** 80n,
  "symbol": () => Symbol("s"),
  "symbol without description": () => Symbol(),
  "symbol with empty description": () => Symbol(""),
  "registered symbol": () => Symbol.for("reg"),
  "well-known symbol": () => Symbol.iterator,
  // strings
  "empty string": () => "",
  "string": () => "hello",
  "string with double quotes": () => 'say "hi"',
  "string with single quotes": () => "it's",
  "string with backtick": () => "a`b",
  "string with backslash": () => "a\\b",
  "string with two backslashes": () => "a\\\\b",
  "string with dollar brace": () => "a${b}c",
  "string with dollar": () => "cost $5",
  "string with backslash backtick": () => "\\`",
  "string with backslash dollar brace": () => "\\${x}",
  "multi-line string": () => "line one\nline two\nline three",
  "string that starts with a newline": () => "\nstarts",
  "string that ends with a newline": () => "ends\n",
  "string of a newline": () => "\n",
  "string of two newlines": () => "\n\n",
  "string with crlf": () => "a\r\nb",
  "string with cr": () => "a\rb",
  "string with tab": () => "a\tb",
  "string with spaces around": () => "  padded  ",
  "string with trailing spaces on lines": () => "a  \nb  \n",
  "string with unicode": () => "é ü 日本語 😀",
  "string with control chars": () => "\x00\x01\x07\x1b[31mred\x1b[0m\x7f",
  "string with line separator": () => "a b c",
  "string with nbsp": () => "a b",
  "string with bom": () => "﻿bom",
  "string that looks like a snapshot": () => "exports[`x 1`] = `y`;",
  "long string": () => "x".repeat(300),
  "String object": () => new String("boxed"),
  "Number object": () => new Number(5),
  "Boolean object": () => new Boolean(false),
  "BigInt object": () => Object(5n),
  // arrays
  "empty array": () => [],
  "array": () => [1, "two", null, undefined, true],
  "nested arrays": () => [[1, [2, [3, [4]]]], []],
  "sparse array": () => [1, , 3],
  "sparse array with trailing hole": () => [1, , ,],
  "array of holes": () => new Array(3),
  "array with extra property": () => Object.assign([1, 2], { extra: "x" }),
  "array with symbol property": () => Object.assign([1], { [sym]: 1 }),
  "array with undefined members": () => [undefined, undefined],
  "array subclass": () => new (class Stack extends Array {})(),
  "array subclass with items": () => class Stack extends Array {}.from([1, 2]),
  "frozen array": () => Object.freeze([1]),
  "arguments": () => args(1, "b"),
  "empty arguments": () => args(),
  "long array": () => Array.from({ length: 120 }, (_, i) => i),
  // objects
  "empty object": () => ({}),
  "object": () => ({ a: 1, b: "two", c: null, d: undefined, e: true }),
  "keys are sorted": () => ({ z: 1, a: 2, m: 3, B: 4, _u: 5, 10: 6, 9: 7, "1a": 8 }),
  "nested objects": () => ({ a: { b: { c: { d: { e: 1 } } } }, f: {} }),
  "object with undefined members": () => ({ u: undefined }),
  "object with odd keys": () => ({
    "with space": 1,
    "with-dash": 2,
    'quo"te': 3,
    "back`tick": 4,
    "": 5,
    "new\nline": 6,
    "back\\slash": 7,
    "${x}": 8,
  }),
  "object with symbol keys": () => ({ [sym]: 1, [Symbol.for("reg")]: 2, [Symbol()]: 3, a: 0 }),
  "object with non-enumerable": () => Object.defineProperty({ a: 1 }, "hidden", { value: 2, enumerable: false }),
  "object with non-enumerable symbol": () => Object.defineProperty({ a: 1 }, sym, { value: 2, enumerable: false }),
  "object with getter": () => ({
    get g() {
      return 5;
    },
    a: 1,
  }),
  "object with setter only": () => ({ set s(_v: number) {} }),
  "object with getter and setter": () => ({
    get gs() {
      return "v";
    },
    set gs(_v) {},
  }),
  "object with a method": () => ({ m() {}, arrow: () => {}, async am() {}, *gen() {} }),
  "null prototype": () => Object.create(null),
  "null prototype with members": () => Object.assign(Object.create(null), { a: 1, b: { c: 2 } }),
  "object with a prototype object": () => Object.create({ inherited: 1 }),
  "object with a prototype object and own": () => Object.assign(Object.create({ inherited: 1 }), { own: 2 }),
  "object with constructor property": () => ({ constructor: "not a function" }),
  "object with constructor named": () => ({ constructor: { name: "Fake" } }),
  "object with toJSON": () => ({
    a: 1,
    toJSON() {
      return { replaced: true };
    },
  }),
  "object with toJSON that returns a string": () => ({ toJSON: () => "as string" }),
  "object with toJSON not a function": () => ({ toJSON: 5 }),
  "object with toString": () => ({
    toString() {
      return "custom";
    },
  }),
  "object with Symbol.toStringTag": () => ({ [Symbol.toStringTag]: "Tagged", a: 1 }),
  "object with __proto__ key": () => JSON.parse('{"__proto__": {"a": 1}}'),
  "object with numeric keys": () => ({ 2: "b", 1: "a", 10: "c", "-1": "d", "1.5": "e" }),
  "frozen object": () => Object.freeze({ a: 1 }),
  "shared reference is not circular": () => ({ a: shared, b: shared, c: [shared, shared] }),
  "circular object": () => circular,
  "circular array": () => circularArray,
  "circular map": () => circularMap,
  "deep": () => {
    let o: any = { leaf: true };
    for (let i = 0; i < 30; i++) o = { o };
    return o;
  },
  // classes
  "class instance": () => new Point(),
  "empty class instance": () => new Empty(),
  "subclass instance": () => new Child(),
  "tagged class instance": () => new Tagged(),
  "class instance with toJSON": () => new WithToJSON(),
  "old style constructor": () => new (OldStyle as any)(),
  "anonymous class instance": () => new (class {})(),
  "anonymous class instance with members": () =>
    new (class {
      a = 1;
    })(),
  "class": () => Point,
  "anonymous class": () => class {},
  "class in object": () => ({ Point, Empty }),
  // functions
  "function": () => function foo() {},
  "anonymous function": () => function () {},
  "arrow": () => () => {},
  "named arrow in object": () => ({ f: () => {} }),
  "async function": () => async function af() {},
  "generator function": () => function* gf() {},
  "async generator function": () => async function* agf() {},
  "bound function": () => function b() {}.bind(null),
  "native function": () => Math.max,
  "function with properties": () => Object.assign(function fp() {}, { a: 1 }),
  "functions in array": () => [function a() {}, () => {}, class C {}],
  // collections
  "empty Map": () => new Map(),
  "Map": () =>
    new Map<any, any>([
      ["a", 1],
      ["b", { c: 2 }],
      [{ k: 1 }, [1]],
      [1, "n"],
      [null, undefined],
    ]),
  "Map is not sorted": () =>
    new Map([
      ["z", 1],
      ["a", 2],
    ]),
  "nested Map": () => new Map([["m", new Map([["n", new Set([1])]])]]),
  "Map subclass": () => new (class MyMap extends Map {})([["a", 1]]),
  "empty Set": () => new Set(),
  "Set": () => new Set<any>([1, "two", { three: 3 }, [4], null, undefined]),
  "Set subclass": () => new (class MySet extends Set {})([1]),
  "WeakMap": () => new WeakMap(),
  "WeakSet": () => new WeakSet(),
  "WeakRef": () => new WeakRef({}),
  "Map iterator": () => new Map([["a", 1]]).entries(),
  "Set iterator": () => new Set([1]).values(),
  "Array iterator": () => [1][Symbol.iterator](),
  "generator object": () =>
    (function* g() {
      yield 1;
    })(),
  // dates and regexps
  "Date": () => new Date("2020-01-02T03:04:05.678Z"),
  "epoch": () => new Date(0),
  "invalid Date": () => new Date(NaN),
  "Date in object": () => ({ when: new Date(86400000) }),
  "Date subclass": () => new (class MyDate extends Date {})(0),
  "RegExp": () => /ab+c/gi,
  "RegExp with slash": () => /a\/b/,
  "RegExp with backslashes": () => /\d+\.\w*\\/u,
  "RegExp with backtick": () => /`/,
  "RegExp with special chars": () => /^[a-z]+(foo|bar)?\s*$/m,
  "empty RegExp": () => new RegExp(""),
  "RegExp in object": () => ({ re: /x\d/y }),
  // binary
  "ArrayBuffer": () => new Uint8Array([1, 2, 3]).buffer,
  "empty ArrayBuffer": () => new ArrayBuffer(0),
  "SharedArrayBuffer": () => new SharedArrayBuffer(2),
  "DataView": () => new DataView(new ArrayBuffer(2)),
  "Uint8Array": () => new Uint8Array([1, 2, 255]),
  "empty Uint8Array": () => new Uint8Array(0),
  "Int8Array": () => new Int8Array([-1, 0, 1]),
  "Uint8ClampedArray": () => new Uint8ClampedArray([300, -5]),
  "Int16Array": () => new Int16Array([-300, 300]),
  "Uint16Array": () => new Uint16Array([65535]),
  "Int32Array": () => new Int32Array([-70000]),
  "Uint32Array": () => new Uint32Array([4294967295]),
  "Float32Array": () => new Float32Array([1.5, -0, NaN]),
  "Float64Array": () => new Float64Array([0.1, Infinity]),
  "BigInt64Array": () => new BigInt64Array([-1n, 5n]),
  "BigUint64Array": () => new BigUint64Array([5n]),
  "Float16Array": () => new (globalThis as any).Float16Array([1.5]),
  "Buffer": () => Buffer.from("hi"),
  "typed array in object": () => ({ bytes: new Uint8Array([9]) }),
  // errors
  "Error": () => new Error("boom"),
  "Error without message": () => new Error(),
  "TypeError": () => new TypeError("bad type"),
  "RangeError in object": () => ({ e: new RangeError("out") }),
  "Error with cause": () => new Error("outer", { cause: new Error("inner") }),
  "Error with extra properties": () => Object.assign(new Error("extra"), { code: "E_X", details: { a: 1 } }),
  "Error with multi-line message": () => new Error("line 1\nline 2"),
  "Error subclass": () => new (class MyError extends Error {})("mine"),
  "Error subclass with name": () => {
    class NamedError extends Error {
      name = "Renamed";
    }
    return new NamedError("n");
  },
  "AggregateError": () => new AggregateError([new Error("a"), new TypeError("b")], "many"),
  "error-like object": () => ({ name: "Error", message: "not really", stack: "s" }),
  "DOMException": () => new DOMException("dom", "AbortError"),
  "errors in array": () => [new Error("one"), new SyntaxError("two")],
  // promises and others
  "resolved promise": () => Promise.resolve(1),
  "pending promise": () => new Promise(() => {}),
  "Proxy of an object": () => new Proxy({ a: 1 }, {}),
  "Proxy of an array": () => new Proxy([1, 2], {}),
  "Proxy of a function": () => new Proxy(function pf() {}, {}),
  "Proxy of a class instance": () => new Proxy(new Point(), {}),
  "Proxy with traps": () =>
    new Proxy(
      {},
      {
        ownKeys: () => ["v"],
        getOwnPropertyDescriptor: () => ({ value: 1, enumerable: true, configurable: true }),
        get: (_t, k) => (k === "v" ? 1 : undefined),
      },
    ),
  "URL": () => new URL("https://example.com/a?b=c#d"),
  "URLSearchParams": () => new URLSearchParams("a=1&b=2"),
  "Headers": () => new Headers({ a: "1" }),
  "AbortController": () => new AbortController(),
  "TextEncoder": () => new TextEncoder(),
  "Intl.NumberFormat": () => new Intl.NumberFormat("en"),
  "globalThis.Math": () => Math,
  "JSON": () => JSON,
  "module namespace like": () => ({ __esModule: true, default: 1 }),
  // asymmetric matchers as values
  "expect.any": () => ({ a: expect.any(Number), b: expect.any(String), c: expect.any(Point) }),
  "expect.anything": () => [expect.anything()],
  "expect.stringContaining": () => expect.stringContaining("abc"),
  "expect.stringMatching": () => expect.stringMatching(/x\d/),
  "expect.objectContaining": () => expect.objectContaining({ a: 1 }),
  "expect.arrayContaining": () => expect.arrayContaining([1, "a"]),
  "expect.closeTo": () => expect.closeTo(1.23, 1),
  "expect.not.stringContaining": () => expect.not.stringContaining("z"),
  "expect.not.objectContaining": () => expect.not.objectContaining({ z: 1 }),
  "expect.not.arrayContaining": () => expect.not.arrayContaining([1]),
  "custom asymmetric matcher": () => [
    (expect as any).toBeBetween(1, 5),
    (expect as any).not.toBeBetween("a", { b: 1 }),
    (expect as any).toBeBetween(),
  ],
  "asymmetric matchers inside each other": () =>
    expect.objectContaining({
      list: expect.arrayContaining([expect.any(String), expect.objectContaining({ a: expect.stringMatching(/x+/) })]),
    }),
  "empty containing": () => [expect.objectContaining({}), expect.arrayContaining([])],
  // react-like
  "react element": () => ({
    $$typeof: Symbol.for("react.element"),
    type: "div",
    props: { className: "a", children: ["text", { $$typeof: Symbol.for("react.element"), type: "span", props: {} }] },
  }),
  "react transitional element": () => ({
    $$typeof: Symbol.for("react.transitional.element"),
    type: "p",
    props: { id: "x", children: "t" },
  }),
  "react test json": () => ({
    $$typeof: Symbol.for("react.test.json"),
    type: "a",
    props: { href: "#" },
    children: ["link"],
  }),
  "react element with function type": () => ({
    $$typeof: Symbol.for("react.element"),
    type: function Comp() {},
    props: { n: 1, f: () => {}, o: { a: 1 }, s: "str", b: true, u: undefined },
  }),
  // mixed
  "mixed": () => ({
    list: [1, { a: [new Map([["k", new Set([new Date(0)])]])] }],
    re: /r/,
    fn() {},
    big: 10n,
    [sym]: sym,
    nested: { empty: {}, none: [], nul: null },
    text: "multi\nline",
  }),
};

expect.extend({
  toBeBetween(received: number, low: number, high: number) {
    return { pass: received >= low && received <= high, message: () => "" };
  },
});

describe("values", () => {
  for (const [name, make] of Object.entries(cases)) {
    test(name, () => {
      expect(make()).toMatchSnapshot();
    });
  }
});

describe("property matchers", () => {
  test("any", () => {
    expect({ id: 5, at: new Date(), name: "n" }).toMatchSnapshot({ id: expect.any(Number), at: expect.any(Date) });
  });
  test("nested", () => {
    expect({ user: { id: 5, name: "n" }, list: [1, 2] }).toMatchSnapshot({ user: { id: expect.any(Number) } });
  });
  test("literal properties", () => {
    expect({ a: 1, b: 2 }).toMatchSnapshot({ a: 1 });
  });
  test("array of matchers", () => {
    expect({ list: [{ id: 1 }, { id: 2 }] }).toMatchSnapshot({
      list: [{ id: expect.any(Number) }, { id: expect.any(Number) }],
    });
  });
  test("class instance", () => {
    expect(new Point()).toMatchSnapshot({ x: expect.any(Number) });
  });
  test("string matchers", () => {
    expect({ s: "abcdef", t: "xyz" }).toMatchSnapshot({
      s: expect.stringContaining("abc"),
      t: expect.stringMatching(/^x/),
    });
  });
  test("empty properties", () => {
    expect({ a: 1 }).toMatchSnapshot({});
  });
});
