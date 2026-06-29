import { describe, expect, test } from "bun:test";
import assert from "node:assert";
import { isDeepStrictEqual } from "node:util";
import { runInNewContext } from "node:vm";

// `assert.deepEqual`, `assert.deepStrictEqual` and
// `assert.partialDeepStrictEqual` implement Node's comparison algorithm
// (lib/internal/util/comparisons.js). It is not the same algorithm as
// `Bun.deepEquals` / `expect().toEqual`: it compares prototypes,
// `RegExp#lastIndex`, `Error#cause` / `AggregateError#errors`, treats objects
// with unobservable state (Promise, WeakMap, WeakSet) as never equal, and the
// legacy `deepEqual` uses `==` coercion.
//
// Every expectation in this file matches the behavior of Node.js v26.3.0.

const AssertionError = assert.AssertionError;

type MakePair = () => [unknown, unknown];

function expectStrictEqual(make: MakePair) {
  const [a, b] = make();
  assert.deepStrictEqual(a, b);
  expect(() => assert.notDeepStrictEqual(a, b)).toThrow(AssertionError);
  expect(isDeepStrictEqual(a, b)).toBe(true);
  // The relation is symmetric.
  const [c, d] = make();
  assert.deepStrictEqual(d, c);
}

function expectNotStrictEqual(make: MakePair) {
  const [a, b] = make();
  expect(() => assert.deepStrictEqual(a, b)).toThrow(AssertionError);
  assert.notDeepStrictEqual(a, b);
  expect(isDeepStrictEqual(a, b)).toBe(false);
  const [c, d] = make();
  expect(() => assert.deepStrictEqual(d, c)).toThrow(AssertionError);
}

function expectLooseEqual(make: MakePair) {
  const [a, b] = make();
  assert.deepEqual(a, b);
  expect(() => assert.notDeepEqual(a, b)).toThrow(AssertionError);
  const [c, d] = make();
  assert.deepEqual(d, c);
}

function expectNotLooseEqual(make: MakePair) {
  const [a, b] = make();
  expect(() => assert.deepEqual(a, b)).toThrow(AssertionError);
  assert.notDeepEqual(a, b);
  const [c, d] = make();
  expect(() => assert.deepEqual(d, c)).toThrow(AssertionError);
}

describe("assert.deepStrictEqual", () => {
  const unequal: [string, MakePair][] = [
    [
      "RegExp with a different lastIndex",
      () => {
        const re = /a/g;
        re.lastIndex = 3;
        return [re, /a/g];
      },
    ],
    ["null prototype object vs plain object", () => [{ __proto__: null }, {}]],
    ["Buffer vs Uint8Array with the same contents", () => [Buffer.from([1, 2]), new Uint8Array([1, 2])]],
    ["promises resolved with different values", () => [Promise.resolve(1), Promise.resolve(2)]],
    ["promises resolved with the same value", () => [Promise.resolve(1), Promise.resolve(1)]],
    ["extra own enumerable property on a Date", () => [Object.assign(new Date(0), { x: 1 }), new Date(0)]],
    ["extra own enumerable property on a RegExp", () => [Object.assign(/a/, { x: 1 }), /a/]],
    [
      "extra own enumerable property on a typed array",
      () => [Object.assign(new Uint8Array(2), { x: 1 }), new Uint8Array(2)],
    ],
    [
      "AggregateError with different errors",
      () => [new AggregateError([new TypeError("a")], "m"), new AggregateError([new TypeError("b")], "m")],
    ],
    ["Error with a different cause", () => [new Error("m", { cause: 1 }), new Error("m", { cause: 2 })]],
    ["Error with and without an own cause", () => [new Error("m", { cause: undefined }), new Error("m")]],
    ["WeakMap instances", () => [new WeakMap(), new WeakMap()]],
    ["WeakSet instances", () => [new WeakSet(), new WeakSet()]],
    ["cross-realm array", () => [runInNewContext("[1, 2]"), [1, 2]]],
    [
      "class instance vs plain object",
      () => [
        new (class Foo {
          a = 1;
        })(),
        { a: 1 },
      ],
    ],
    ["objects with different symbol keys", () => [{ [Symbol("x")]: 1 }, { [Symbol("x")]: 1 }]],
    ["object with a symbol key vs an empty object", () => [{ [Symbol("x")]: 1 }, {}]],
    ["enumerable undefined property vs missing property", () => [{ a: undefined }, {}]],
    [
      "sparse array vs array with undefined",
      () => [
        [, 1],
        [undefined, 1],
      ],
    ],
    ["-0 vs +0 in an array", () => [[-0], [+0]]],
  ];
  for (const [name, make] of unequal) {
    test(`unequal: ${name}`, () => expectNotStrictEqual(make));
  }

  const equal: [string, MakePair][] = [
    ["invalid dates", () => [new Date(NaN), new Date(NaN)]],
    ["transparent proxy vs its target's shape", () => [new Proxy({ a: 1 }, {}), { a: 1 }]],
    ["transparent proxy of an array vs an equal array", () => [new Proxy([1, 2], {}), [1, 2]]],
    [
      "RegExp with the same lastIndex",
      () => {
        const a = /a/g;
        a.lastIndex = 3;
        const b = /a/g;
        b.lastIndex = 3;
        return [a, b];
      },
    ],
    ["errors with deep-equal causes", () => [new Error("m", { cause: { a: 1 } }), new Error("m", { cause: { a: 1 } })]],
    [
      "AggregateError with equal errors",
      () => [new AggregateError([new TypeError("a")], "m"), new AggregateError([new TypeError("a")], "m")],
    ],
    [
      "null prototype objects with the same properties",
      () => [
        { __proto__: null, a: 1 },
        { __proto__: null, a: 1 },
      ],
    ],
    [
      "instances of the same class",
      (() => {
        class Foo {
          a = 1;
        }
        return () => [new Foo(), new Foo()] as [unknown, unknown];
      })(),
    ],
    [
      "objects sharing the same symbol key",
      (() => {
        const sym = Symbol("x");
        return () => [{ [sym]: 1 }, { [sym]: 1 }] as [unknown, unknown];
      })(),
    ],
    [
      "maps with object keys in different order",
      () => [
        new Map([
          [{ a: 1 }, 1],
          [{ b: 2 }, 2],
        ]),
        new Map([
          [{ b: 2 }, 2],
          [{ a: 1 }, 1],
        ]),
      ],
    ],
    ["sets with objects in different order", () => [new Set([{ a: 1 }, { b: 2 }]), new Set([{ b: 2 }, { a: 1 }])]],
  ];
  for (const [name, make] of equal) {
    test(`equal: ${name}`, () => expectStrictEqual(make));
  }
});

// https://github.com/oven-sh/bun/issues/29030
test("deepStrictEqual compares prototypes", () => {
  expect(() => assert.deepStrictEqual({}, Object.create(null))).toThrow(AssertionError);
  expect(() => assert.deepStrictEqual(Object.create(null), {})).toThrow(AssertionError);
});

// https://github.com/oven-sh/bun/issues/28760
test("sets holding duplicate structurally-equal objects are not equal to sets without them", () => {
  const a = () => new Set([{ a: 1 }, { a: 1 }]);
  const b = () => new Set([{ a: 1 }, { a: 2 }]);
  expect(() => assert.deepEqual(a(), b())).toThrow(AssertionError);
  expect(() => assert.deepStrictEqual(a(), b())).toThrow(AssertionError);
});

// https://github.com/oven-sh/bun/issues/23877
test("deepEqual uses == for primitives", () => {
  assert.deepEqual("+00000000", false);
  expect(() => assert.notDeepEqual("+00000000", false)).toThrow(AssertionError);
});

describe("assert.deepEqual", () => {
  const equal: [string, MakePair][] = [
    ["objects whose values are == but not ===", () => [{ a: 1 }, { a: "1" }]],
    ["arrays whose elements are == but not ===", () => [[0], [false]]],
    ["null vs undefined", () => [null, undefined]],
    ["maps with == keys", () => [new Map([[1, "a"]]), new Map([["1", "a"]])]],
    ["sets with == values", () => [new Set([1]), new Set(["1"])]],
    ["invalid dates", () => [new Date(NaN), new Date(NaN)]],
  ];
  for (const [name, make] of equal) {
    test(`equal: ${name}`, () => expectLooseEqual(make));
  }

  const unequal: [string, MakePair][] = [
    ["enumerable undefined property vs missing property", () => [{ a: undefined }, {}]],
    [
      "sparse array vs array with undefined",
      () => [
        [, 1],
        [undefined, 1],
      ],
    ],
    ["dates with different times", () => [new Date(0), new Date(1)]],
    ["objects with different Symbol.toStringTag", () => [{ [Symbol.toStringTag]: "a" }, { [Symbol.toStringTag]: "b" }]],
  ];
  for (const [name, make] of unequal) {
    test(`unequal: ${name}`, () => expectNotLooseEqual(make));
  }

  test("loose equality still distinguishes sparse holes from absent indices", () => {
    // eslint-disable-next-line no-sparse-arrays
    assert.deepEqual([, 1], [, 1]);
    // eslint-disable-next-line no-sparse-arrays
    expect(() => assert.deepEqual([, 1], [1])).toThrow(AssertionError);
  });
});

describe("assert.partialDeepStrictEqual", () => {
  test("expected subset matches", () => {
    assert.partialDeepStrictEqual({ a: { b: { c: 1 } }, z: 9 }, { a: { b: {} } });
    assert.partialDeepStrictEqual([1, 2, 3], [2]);
    assert.partialDeepStrictEqual(new Set([{ a: 1 }, { b: 2 }]), new Set([{ b: 2 }]));
    assert.partialDeepStrictEqual(
      new Map([
        ["a", 1],
        ["b", 2],
      ]),
      new Map([["b", 2]]),
    );
  });

  test("circular structures with different values are not equal", () => {
    const a: any = { x: 1 };
    a.self = a;
    const b: any = { x: 2 };
    b.self = b;
    expect(() => assert.partialDeepStrictEqual(a, b)).toThrow(AssertionError);
  });

  test("circular structures with equal values are equal", () => {
    const a: any = { x: 1 };
    a.self = a;
    const b: any = { x: 1 };
    b.self = b;
    assert.partialDeepStrictEqual(a, b);
  });

  test("URLs with different hrefs are not equal", () => {
    expect(() => assert.partialDeepStrictEqual(new URL("http://a.com/"), new URL("http://b.com/"))).toThrow(
      AssertionError,
    );
    assert.partialDeepStrictEqual(new URL("http://a.com/"), new URL("http://a.com/"));
  });

  test("array elements of the expected subset must appear in order", () => {
    assert.partialDeepStrictEqual([1, 2, 3], [1, 3]);
    expect(() => assert.partialDeepStrictEqual([1, 2, 3], [3, 1])).toThrow(AssertionError);
  });

  test("prototypes are not compared", () => {
    assert.partialDeepStrictEqual({ __proto__: null, a: 1 }, { a: 1 });
    class Foo {
      a = 1;
    }
    assert.partialDeepStrictEqual(new Foo(), { a: 1 });
  });

  test("boxed primitives are compared by value", () => {
    expect(() => assert.partialDeepStrictEqual(Object("a"), Object("b"))).toThrow(AssertionError);
    assert.partialDeepStrictEqual(Object("a"), Object("a"));
  });
});

describe("regexp properties", () => {
  test("lastIndex participates in strict and loose comparison", () => {
    const a = /a/g;
    a.lastIndex = 3;
    expect(() => assert.deepEqual(a, /a/g)).toThrow(AssertionError);
    expect(isDeepStrictEqual(a, /a/g)).toBe(false);
  });
});
