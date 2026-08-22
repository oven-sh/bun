// Deep-equality matrix for node:assert and node:util.
// Expectations come from the documented semantics of assert.deepStrictEqual/deepEqual,
// cross-checked against Node.js. Cases Bun gets wrong today are marked `test.failing`.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import assert from "node:assert";
import util from "node:util";

type Thunk = () => unknown;

interface Case {
  name: string;
  /** Thunks so that every test gets freshly constructed operands. */
  a: Thunk;
  b: Thunk;
  /** Whether assert.deepStrictEqual(a, b) should succeed. */
  strict: boolean;
  /** Whether assert.deepEqual(a, b) should succeed. */
  loose: boolean;
  /** Set when Bun disagrees with `strict`; the text says what Bun does instead. */
  strictBug?: string;
  /** Set when Bun disagrees with `loose`; the text says what Bun does instead. */
  looseBug?: string;
}

const sym = Symbol("shared");
const sharedArrayBuffer = new ArrayBuffer(4);

function float64WithNaNPayload(bits: bigint) {
  const arr = new Float64Array(1);
  new BigUint64Array(arr.buffer)[0] = bits;
  return arr;
}

class WithPrototypeGetter {
  get a() {
    return 1;
  }
}

function anonymousClassInstance() {
  return new (class {
    a = 1;
  })();
}

function sameNameClassInstance() {
  return new (class Shared {
    a = 1;
  })();
}

function nonEnumerable() {
  const object = {};
  Object.defineProperty(object, "hidden", { value: 1, enumerable: false });
  return object;
}

function withExtraProperty<T extends object>(value: T): T {
  return Object.assign(value, { extra: 1 });
}

function selfReferencingObject() {
  const object: Record<string, unknown> = {};
  object.self = object;
  return object;
}

function selfReferencingArray() {
  const array: unknown[] = [];
  array.push(array);
  return array;
}

function argumentsObject(...values: unknown[]) {
  return (function () {
    // eslint-disable-next-line prefer-rest-params
    return arguments;
  })(...values);
}

const cases: Case[] = [
  // Loose mode compares primitives with ==, strict mode with Object.is.
  { name: "0 and -0", a: () => 0, b: () => -0, strict: false, loose: true, looseBug: "reports not equal" },
  { name: "NaN and NaN", a: () => NaN, b: () => NaN, strict: true, loose: true },
  { name: "[0] and [-0]", a: () => [0], b: () => [-0], strict: false, loose: true, looseBug: "reports not equal" },
  { name: "'1' and 1", a: () => "1", b: () => 1, strict: false, loose: true, looseBug: "reports not equal" },
  { name: "['1'] and [1]", a: () => ["1"], b: () => [1], strict: false, loose: true, looseBug: "reports not equal" },
  {
    name: "'+00000000' and false",
    a: () => "+00000000",
    b: () => false,
    strict: false,
    loose: true,
    looseBug: "reports not equal",
  },
  { name: "'' and false", a: () => "", b: () => false, strict: false, loose: true, looseBug: "reports not equal" },
  {
    name: "null and undefined",
    a: () => null,
    b: () => undefined,
    strict: false,
    loose: true,
    looseBug: "reports not equal",
  },
  {
    name: "{ a: -0 } and { a: 0 }",
    a: () => ({ a: -0 }),
    b: () => ({ a: 0 }),
    strict: false,
    loose: true,
    looseBug: "reports not equal",
  },
  { name: "1n and 1", a: () => 1n, b: () => 1, strict: false, loose: true, looseBug: "reports not equal" },
  { name: "new String('a') and 'a'", a: () => new String("a"), b: () => "a", strict: false, loose: false },
  { name: "two boxed equal strings", a: () => new String("a"), b: () => new String("a"), strict: true, loose: true },
  { name: "two boxed equal numbers", a: () => new Number(1), b: () => new Number(1), strict: true, loose: true },
  { name: "boxed -0 and boxed 0", a: () => new Number(-0), b: () => new Number(0), strict: false, loose: false },
  { name: "two boxed booleans", a: () => new Boolean(true), b: () => new Boolean(true), strict: true, loose: true },
  {
    name: "two boxed symbols",
    a: () => Object(Symbol.iterator),
    b: () => Object(Symbol.iterator),
    strict: true,
    loose: true,
  },
  { name: "two boxed bigints", a: () => Object(1n), b: () => Object(1n), strict: true, loose: true },
  {
    name: "two boxed symbols wrapping distinct symbols",
    a: () => Object(Symbol("s")),
    b: () => Object(Symbol("s")),
    strict: false,
    loose: false,
  },
  { name: "two boxed unequal bigints", a: () => Object(1n), b: () => Object(2n), strict: false, loose: false },
  {
    name: "a boxed string with an extra own property",
    a: () => withExtraProperty(new String("test")),
    b: () => new String("test"),
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },
  {
    name: "a boxed string with an out-of-range indexed own property",
    a: () => {
      const boxed = new String("ab");
      boxed[5] = "x";
      return boxed;
    },
    b: () => new String("ab"),
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },

  // Undefined-valued and missing properties. Both modes compare own key counts.
  {
    name: "{} and { a: undefined }",
    a: () => ({}),
    b: () => ({ a: undefined }),
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },
  {
    name: "{ a: undefined } and { b: undefined }",
    a: () => ({ a: undefined }),
    b: () => ({ b: undefined }),
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },
  {
    name: "{ a: { b: undefined } } and { a: {} }",
    a: () => ({ a: { b: undefined } }),
    b: () => ({ a: {} }),
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },
  {
    name: "[1] and [1, undefined]",
    a: () => [1],
    b: () => [1, undefined],
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },
  {
    name: "a hole and an explicit undefined",
    a: () => [, 1],
    b: () => [undefined, 1],
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },

  // Prototypes.
  {
    name: "a null-prototype object and {}",
    a: () => Object.create(null),
    b: () => ({}),
    strict: false,
    loose: true,
  },
  {
    name: "two null-prototype objects with the same keys",
    a: () => Object.assign(Object.create(null), { a: 1 }),
    b: () => Object.assign(Object.create(null), { a: 1 }),
    strict: true,
    loose: true,
  },
  {
    name: "a class instance and an object literal",
    a: () =>
      new (class Foo {
        a = 1;
      })(),
    b: () => ({ a: 1 }),
    strict: false,
    loose: true,
  },
  {
    name: "instances of two differently named classes",
    a: () =>
      new (class A {
        a = 1;
      })(),
    b: () =>
      new (class B {
        a = 1;
      })(),
    strict: false,
    loose: true,
  },
  {
    name: "instances of two distinct anonymous classes",
    a: anonymousClassInstance,
    b: anonymousClassInstance,
    strict: false,
    loose: true,
  },
  {
    name: "instances of two distinct identically named classes",
    a: sameNameClassInstance,
    b: sameNameClassInstance,
    strict: false,
    loose: true,
  },
  {
    name: "an Array subclass instance and an array",
    a: () => new (class extends Array {})(),
    b: () => [],
    strict: false,
    loose: true,
  },
  {
    name: "[] and Object.create(Array.prototype)",
    a: () => [],
    b: () => Object.create(Array.prototype),
    strict: false,
    loose: false,
  },

  // Symbol keys: compared in strict mode, ignored in loose mode.
  {
    name: "{ [sym]: 1 } and {}",
    a: () => ({ [sym]: 1 }),
    b: () => ({}),
    strict: false,
    loose: true,
    looseBug: "reports not equal",
  },
  {
    name: "two objects sharing a symbol key",
    a: () => ({ [sym]: 1 }),
    b: () => ({ [sym]: 1 }),
    strict: true,
    loose: true,
  },
  {
    name: "an enumerable symbol key and a non-enumerable one",
    a: () => ({ [sym]: 1 }),
    b: () => Object.defineProperty({}, sym, { value: 1, enumerable: false }),
    strict: false,
    loose: true,
  },
  {
    name: "typed arrays differing only in a symbol property",
    a: () => Object.assign(new Uint8Array([1]), { [sym]: true }),
    b: () => Object.assign(new Uint8Array([1]), { [sym]: false }),
    strict: false,
    loose: true,
  },
  {
    name: "distinct symbols with the same description",
    a: () => ({ [Symbol("s")]: 1 }),
    b: () => ({ [Symbol("s")]: 1 }),
    strict: false,
    loose: true,
    looseBug: "reports not equal",
  },

  // Only own enumerable properties participate.
  { name: "a non-enumerable own property and {}", a: nonEnumerable, b: () => ({}), strict: true, loose: true },
  {
    name: "a getter and a data property",
    a: () => ({
      get a() {
        return 1;
      },
    }),
    b: () => ({ a: 1 }),
    strict: true,
    loose: true,
  },
  {
    name: "instances whose only property is a prototype getter",
    a: () => new WithPrototypeGetter(),
    b: () => new WithPrototypeGetter(),
    strict: true,
    loose: true,
  },
  {
    name: "a frozen and a non-frozen object",
    a: () => Object.freeze({ a: 1 }),
    b: () => ({ a: 1 }),
    strict: true,
    loose: true,
  },

  // Date.
  { name: "two equal dates", a: () => new Date(0), b: () => new Date(0), strict: true, loose: true },
  { name: "two different dates", a: () => new Date(0), b: () => new Date(1), strict: false, loose: false },
  {
    name: "a date with an extra own property",
    a: () => withExtraProperty(new Date(0)),
    b: () => new Date(0),
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },

  // RegExp.
  { name: "two equal regexps", a: () => /a/g, b: () => /a/g, strict: true, loose: true },
  { name: "regexps with different flags", a: () => /a/g, b: () => /a/i, strict: false, loose: false },
  {
    name: "regexps with different lastIndex",
    a: () => Object.assign(/a/g, { lastIndex: 3 }),
    b: () => /a/g,
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },

  // Error.
  {
    name: "two errors with the same message",
    a: () => new Error("x"),
    b: () => new Error("x"),
    strict: true,
    loose: true,
  },
  {
    name: "errors with different messages",
    a: () => new Error("x"),
    b: () => new Error("y"),
    strict: false,
    loose: false,
  },
  {
    name: "an Error and a TypeError",
    a: () => new Error("x"),
    b: () => new TypeError("x"),
    strict: false,
    loose: false,
  },
  {
    name: "an error with an extra own property",
    a: () => withExtraProperty(new Error("x")),
    b: () => new Error("x"),
    strict: false,
    loose: false,
  },
  {
    name: "errors with different causes",
    a: () => new Error("x", { cause: 1 }),
    b: () => new Error("x", { cause: 2 }),
    strict: false,
    loose: false,
  },

  // Map and Set.
  {
    name: "maps with different insertion order",
    a: () =>
      new Map([
        [1, 1],
        [2, 2],
      ]),
    b: () =>
      new Map([
        [2, 2],
        [1, 1],
      ]),
    strict: true,
    loose: true,
  },
  { name: "maps keyed by NaN", a: () => new Map([[NaN, 1]]), b: () => new Map([[NaN, 1]]), strict: true, loose: true },
  {
    name: "maps keyed by -0 and 0",
    a: () => new Map([[-0, 1]]),
    b: () => new Map([[0, 1]]),
    strict: true,
    loose: true,
  },
  {
    name: "maps keyed by deep-equal objects",
    a: () => new Map([[{ a: 1 }, 1]]),
    b: () => new Map([[{ a: 1 }, 1]]),
    strict: true,
    loose: true,
  },
  {
    name: "maps keyed by different objects",
    a: () => new Map([[{ a: 1 }, 1]]),
    b: () => new Map([[{ a: 2 }, 1]]),
    strict: false,
    loose: false,
  },
  { name: "maps of different size", a: () => new Map([[1, 1]]), b: () => new Map(), strict: false, loose: false },
  {
    name: "a map with an extra own property",
    a: () => withExtraProperty(new Map()),
    b: () => new Map(),
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },
  {
    name: "sets holding deep-equal objects",
    a: () => new Set([{ a: 1 }]),
    b: () => new Set([{ a: 1 }]),
    strict: true,
    loose: true,
  },
  { name: "sets holding -0 and 0", a: () => new Set([-0]), b: () => new Set([0]), strict: true, loose: true },
  { name: "sets holding NaN", a: () => new Set([NaN]), b: () => new Set([NaN]), strict: true, loose: true },

  // "WeakMap and WeakSet instances are not compared structurally. They are only
  // equal if they reference the same object." -- nodejs.org/api/assert.html
  {
    name: "two empty WeakMaps",
    a: () => new WeakMap(),
    b: () => new WeakMap(),
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },
  {
    name: "two empty WeakSets",
    a: () => new WeakSet(),
    b: () => new WeakSet(),
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },
  {
    name: "a WeakMap and a WeakSet",
    a: () => new WeakMap(),
    b: () => new WeakSet(),
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },

  // Typed arrays and buffers.
  {
    name: "a Uint8Array and an Int8Array with the same bytes",
    a: () => new Uint8Array([1]),
    b: () => new Int8Array([1]),
    strict: false,
    loose: false,
  },
  {
    name: "two equal Uint8Arrays",
    a: () => new Uint8Array([1, 2]),
    b: () => new Uint8Array([1, 2]),
    strict: true,
    loose: true,
  },
  {
    name: "Float64Arrays holding NaN",
    a: () => new Float64Array([NaN]),
    b: () => new Float64Array([NaN]),
    strict: true,
    loose: false,
  },
  {
    name: "Float64Arrays holding -0 and 0",
    a: () => new Float64Array([-0]),
    b: () => new Float64Array([0]),
    strict: false,
    loose: true,
  },
  {
    name: "ArrayBuffers of the same length",
    a: () => new ArrayBuffer(2),
    b: () => new ArrayBuffer(2),
    strict: true,
    loose: true,
  },
  {
    name: "ArrayBuffers of different length",
    a: () => new ArrayBuffer(2),
    b: () => new ArrayBuffer(3),
    strict: false,
    loose: false,
  },
  {
    name: "DataViews of the same length",
    a: () => new DataView(new ArrayBuffer(2)),
    b: () => new DataView(new ArrayBuffer(2)),
    strict: true,
    loose: true,
  },
  {
    name: "a DataView with an extra own string-named property",
    a: () => withExtraProperty(new DataView(new ArrayBuffer(2))),
    b: () => new DataView(new ArrayBuffer(2)),
    strict: false,
    loose: false,
  },
  {
    // node's DataView compare uses getOwnNonIndexProperties; an integer-index
    // own property is ignored, like on typed arrays.
    name: "a DataView with an extra integer-index own property",
    a: () => Object.assign(new DataView(new ArrayBuffer(2)), { 0: 1 }),
    b: () => new DataView(new ArrayBuffer(2)),
    strict: true,
    loose: true,
    looseBug: "reports not equal",
  },
  {
    name: "a Buffer and a Uint8Array with the same bytes",
    a: () => Buffer.from([1]),
    b: () => new Uint8Array([1]),
    strict: false,
    loose: true,
  },
  {
    name: "a typed array with an extra own property",
    a: () => withExtraProperty(new Uint8Array([1])),
    b: () => new Uint8Array([1]),
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },
  {
    name: "an empty typed array with an extra own property",
    a: () => withExtraProperty(new Uint8Array(0)),
    b: () => new Uint8Array(0),
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },
  {
    name: "two views over the same ArrayBuffer, one with an extra own property",
    a: () => withExtraProperty(new Uint8Array(sharedArrayBuffer)),
    b: () => new Uint8Array(sharedArrayBuffer),
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },
  {
    // Strict mode compares the bytes; the property walk would see both as NaN and accept them.
    name: "Float64Arrays with distinct NaN payloads and an extra own property",
    a: () => withExtraProperty(float64WithNaNPayload(0x7ff8000000000001n)),
    b: () => withExtraProperty(float64WithNaNPayload(0x7ff8000000000002n)),
    strict: false,
    loose: false,
  },

  // Arrays.
  { name: "[1] and { 0: 1 }", a: () => [1], b: () => ({ 0: 1 }), strict: false, loose: false },
  {
    name: "an array with an extra own property",
    a: () => withExtraProperty([1]),
    b: () => [1],
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },
  { name: "arrays of different length", a: () => [1, 2], b: () => [1], strict: false, loose: false },
  { name: "'a' and ['a']", a: () => "a", b: () => ["a"], strict: false, loose: false },

  // Cycles.
  {
    name: "two self-referencing objects",
    a: selfReferencingObject,
    b: selfReferencingObject,
    strict: true,
    loose: true,
  },
  { name: "two self-referencing arrays", a: selfReferencingArray, b: selfReferencingArray, strict: true, loose: true },
  {
    name: "a cycle and a finitely nested object",
    a: selfReferencingObject,
    b: () => ({ self: { self: {} } }),
    strict: false,
    loose: false,
  },

  // Miscellaneous.
  {
    name: "different Symbol.toStringTag values",
    a: () => ({ [Symbol.toStringTag]: "a" }),
    b: () => ({ [Symbol.toStringTag]: "b" }),
    strict: false,
    loose: false,
  },
  {
    name: "two references to the same function",
    a: () => globalThis.isNaN,
    b: () => globalThis.isNaN,
    strict: true,
    loose: true,
  },
  {
    name: "two distinct functions with the same source",
    a: () => () => {},
    b: () => () => {},
    strict: false,
    loose: false,
  },
  { name: "an arguments object and an array", a: () => argumentsObject(1), b: () => [1], strict: false, loose: false },
  {
    name: "two equal arguments objects",
    a: () => argumentsObject(1),
    b: () => argumentsObject(1),
    strict: true,
    loose: true,
  },
];

function caught(fn: () => void): (Error & { code?: string }) | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error as Error & { code?: string };
  }
}

function describeMatrix(
  suite: string,
  mode: "strict" | "loose",
  bugField: "strictBug" | "looseBug",
  equal: (actual: unknown, expected: unknown) => void,
  notEqual: (actual: unknown, expected: unknown) => void,
) {
  describe(suite, () => {
    for (const testCase of cases) {
      const expected = testCase[mode];
      const bug = testCase[bugField];
      const label = `${expected ? "accepts" : "rejects"} ${testCase.name}`;
      const run = bug ? test.failing : test;
      run(bug ? `${label} (Bun ${bug})` : label, () => {
        const error = caught(() => equal(testCase.a(), testCase.b()));
        if (expected) {
          expect(error?.message ?? null).toBeNull();
        } else {
          expect(error?.code).toBe("ERR_ASSERTION");
        }
        expect(caught(() => notEqual(testCase.a(), testCase.b())) === null).toBe(!expected);
      });
    }
  });
}

describeMatrix("assert.deepStrictEqual", "strict", "strictBug", assert.deepStrictEqual, assert.notDeepStrictEqual);
describeMatrix("assert.deepEqual", "loose", "looseBug", assert.deepEqual, assert.notDeepEqual);

describe("util.isDeepStrictEqual", () => {
  for (const testCase of cases) {
    const label = `${testCase.name} is ${testCase.strict ? "" : "not "}deep-strict-equal`;
    const run = testCase.strictBug ? test.failing : test;
    run(testCase.strictBug ? `${label} (Bun ${testCase.strictBug})` : label, () => {
      expect(util.isDeepStrictEqual(testCase.a(), testCase.b())).toBe(testCase.strict);
    });
  }

  test("never throws on exotic input", () => {
    expect(util.isDeepStrictEqual(undefined, undefined)).toBe(true);
    expect(util.isDeepStrictEqual(null, undefined)).toBe(false);
    expect(util.isDeepStrictEqual(Object.create(null), Object.create(null))).toBe(true);
  });

  test("reads an array's own symbol-keyed getter once per side", () => {
    const s = Symbol("k");
    let calls = 0;
    const make = () => {
      const a = [1];
      Object.defineProperty(a, s, { enumerable: true, get: () => (calls++, 42) });
      return a;
    };
    expect(util.isDeepStrictEqual(make(), make())).toBe(true);
    expect(calls).toBe(2);
  });

  // The third argument was added in Node v26.
  describe("skipPrototype", () => {
    class Foo {
      constructor(value) {
        this.value = value;
      }
    }
    class Bar {
      constructor(value) {
        this.value = value;
      }
    }

    test("ignores differing constructors when set", () => {
      expect(util.isDeepStrictEqual(new Foo(42), new Bar(42))).toBe(false);
      expect(util.isDeepStrictEqual(new Foo(42), new Bar(42), true)).toBe(true);
    });

    test("still compares values", () => {
      expect(util.isDeepStrictEqual(new Foo(42), new Bar(99), true)).toBe(false);
    });

    test.each([
      ["object property", () => ({ inner: new Foo(1) }), () => ({ inner: new Bar(1) })],
      ["array element", () => [new Foo(1)], () => [new Bar(1)]],
      ["Map value", () => new Map([["k", new Foo(1)]]), () => new Map([["k", new Bar(1)]])],
      ["Set element", () => new Set([new Foo(1)]), () => new Set([new Bar(1)])],
      ["Error cause", () => new Error("e", { cause: new Foo(1) }), () => new Error("e", { cause: new Bar(1) })],
    ])("propagates through %s", (_name, makeA, makeB) => {
      expect(util.isDeepStrictEqual(makeA(), makeB())).toBe(false);
      expect(util.isDeepStrictEqual(makeA(), makeB(), true)).toBe(true);
    });

    test("ignores the boxed-primitive subclass distinction", () => {
      class S extends String {}
      expect(util.isDeepStrictEqual(new String("a"), new S("a"))).toBe(false);
      expect(util.isDeepStrictEqual(new String("a"), new S("a"), true)).toBe(true);
    });

    test("does not leak into assert.deepStrictEqual", () => {
      expect(() => assert.deepStrictEqual(new Foo(42), new Bar(42))).toThrow();
    });
  });
});

describe("detached ArrayBuffer", () => {
  function detached() {
    const buf = new ArrayBuffer(4);
    buf.transfer();
    return buf;
  }

  const table: Array<[string, Thunk, Thunk]> = [
    ["two distinct detached ArrayBuffers", detached, detached],
    ["a detached ArrayBuffer and a zero-length ArrayBuffer", detached, () => new ArrayBuffer(0)],
    ["a zero-length ArrayBuffer and a detached ArrayBuffer", () => new ArrayBuffer(0), detached],
    ["nested detached ArrayBuffers", () => ({ x: detached() }), () => ({ x: detached() })],
  ];

  for (const [label, a, b] of table) {
    test(`throws TypeError on ${label}`, () => {
      expect(() => assert.deepStrictEqual(a(), b())).toThrow(TypeError);
      expect(() => assert.deepEqual(a(), b())).toThrow(TypeError);
      expect(() => assert.notDeepStrictEqual(a(), b())).toThrow(TypeError);
      expect(() => assert.notDeepEqual(a(), b())).toThrow(TypeError);
      expect(() => util.isDeepStrictEqual(a(), b())).toThrow(TypeError);
    });
  }

  test("deepStrictEqual throws Node's DataView TypeError on a detached view", () => {
    const detachedView = () => {
      const ab = new ArrayBuffer(4);
      const dv = new DataView(ab);
      structuredClone(ab, { transfer: [ab] });
      return dv;
    };
    const error = caught(() => assert.deepStrictEqual(detachedView(), new DataView(new ArrayBuffer(0))));
    expect(error).toBeInstanceOf(TypeError);
    expect(error?.message).toBe(
      "Cannot perform get DataView.prototype.byteLength on a detached or out-of-bounds ArrayBuffer",
    );
    expect(() => util.isDeepStrictEqual(detachedView(), new DataView(new ArrayBuffer(0)))).toThrow(TypeError);
    // Bun.deepEquals keeps its own-properties DataView surface: no throw.
    expect(Bun.deepEquals(detachedView(), new DataView(new ArrayBuffer(0)), true)).toBe(true);
  });

  test("assert.partialDeepStrictEqual throws TypeError on a detached ArrayBuffer", () => {
    expect(() => assert.partialDeepStrictEqual(detached(), new ArrayBuffer(0))).toThrow(TypeError);
  });

  test("assert.partialDeepStrictEqual checks own properties on a KeyObject after equals()", () => {
    const crypto = require("node:crypto");
    const key = crypto.createSecretKey(Buffer.from("secret"));
    const key2 = crypto.createSecretKey(Buffer.from("secret"));
    Object.assign(key2, { x: 1 });
    // expected has {x:1} that actual lacks: node throws ERR_ASSERTION.
    expect(() => assert.partialDeepStrictEqual(key, key2)).toThrow(assert.AssertionError);
    // subset direction: extra own prop on actual is fine.
    expect(() =>
      assert.partialDeepStrictEqual(Object.assign(key, { x: 1 }), crypto.createSecretKey(Buffer.from("secret"))),
    ).not.toThrow();
  });

  test("error matches Node's message", () => {
    const error = caught(() => assert.deepStrictEqual(detached(), new ArrayBuffer(0)));
    expect(error).toBeInstanceOf(TypeError);
    expect(error?.message).toBe("Cannot perform Construct on a detached ArrayBuffer");
  });

  test("reference-identical detached ArrayBuffer short-circuits as equal", () => {
    const buf = detached();
    expect(() => assert.deepStrictEqual(buf, buf)).not.toThrow();
    expect(util.isDeepStrictEqual(buf, buf)).toBe(true);
  });

  test("detached ArrayBuffer vs non-zero-length ArrayBuffer is an ordinary mismatch", () => {
    const error = caught(() => assert.deepStrictEqual(detached(), new ArrayBuffer(4)));
    expect(error?.code).toBe("ERR_ASSERTION");
  });

  // Node v26 passes typed-array views directly to Buffer.compare (no re-wrap over
  // .buffer), so a detached view compares as zero-length. Node v22 and earlier threw.
  test("a detached typed-array view is comparable as zero-length", () => {
    function detachedView() {
      const buf = new ArrayBuffer(4);
      const view = new Uint8Array(buf);
      buf.transfer();
      return view;
    }
    expect(() => assert.deepStrictEqual(detachedView(), detachedView())).not.toThrow();
    expect(() => assert.deepStrictEqual(detachedView(), new Uint8Array(0))).not.toThrow();
  });
});

// assert.partialDeepStrictEqual pairs off Set members and Map entries the way node's
// setEquiv/mapEquiv do (lib/internal/util/comparisons.js; for Sets, the path node takes once
// actual has three or more members): whatever a hash lookup can settle is settled by one
// lookup, and only the expected objects left over are matched structurally, each claiming an
// actual entry of its own, while actual is walked once. Every expectation below was
// cross-checked against node v26, except the two Map cases that say otherwise: node pairs off
// object keys that both Maps hold structurally like any other, which makes the outcome depend on
// insertion order; Bun settles them by identity, as node itself does for Set members and as Bun
// always has.
describe("assert.partialDeepStrictEqual on Sets and Maps", () => {
  const set = (...members: unknown[]) => new Set(members);
  const map = (...entries: [unknown, unknown][]) => new Map(entries);
  const twin = { a: 1, b: 2 };
  const fn = () => {};
  // Keys both Maps hold: token1/token2 are structurally interchangeable, shared is contained in {k:1,m:1}.
  const token1 = {};
  const token2 = {};
  const shared = { k: 1 };
  // [description, actual, expected, whether expected is partially contained in actual]
  const cases: [string, unknown, unknown, boolean][] = [
    ["Set: a member both sides hold is paired with itself", set(twin, { a: 1, c: 3 }, 1), set({ a: 1 }, twin), true],
    ["Set: a member both sides hold, other order", set({ a: 1, c: 3 }, twin, 1), set(twin, { a: 1 }), true],
    ["Set: members match with subset semantics", set({ a: 1, b: 2 }, { c: 3, d: 4 }, 0), set({ c: 3 }, { a: 1 }), true],
    ["Set: each expected object claims a member of its own", set({ a: 1 }, 5, 6), set({ a: 1 }, { a: 1 }), false],
    ["Set: duplicates pair off one to one", set({ a: 1 }, { a: 1 }, 5), set({ a: 1 }, { a: 1 }), true],
    [
      "Set: an expected object without a counterpart",
      set({ a: 1 }, { b: 2 }, { c: 3 }),
      set({ c: 3 }, { z: 0 }),
      false,
    ],
    ["Set: a primitive actual does not hold", set({}, 1, 3), set(2), false],
    ["Set: an object when actual holds only primitives", set(1, 2, 3), set({}), false],
    ["Set: a function both sides hold", set(fn, 1, 2), set(fn), true],
    ["Set: a function only expected holds", set(() => {}, 1, 2), set(() => {}), false],
    ["Set: nested collections", set(set(1, 2, 3), [4, 5], 0), set([5], set(2)), true],
    [
      "Set: own properties are still compared",
      Object.assign(set(1, 2), { x: 1 }),
      Object.assign(set(1), { x: 2 }),
      false,
    ],
    ["Map: a primitive key actual does not hold", map(["a", 1], ["c", 1]), map(["b", 1]), false],
    ["Map: a primitive key with a different value", map(["a", 1], ["b", 2]), map(["a", 2]), false],
    [
      "Map: a primitive key, value matched with subset semantics",
      map(["a", { x: 1, y: 2 }]),
      map(["a", { x: 1 }]),
      true,
    ],
    ["Map: a key holding undefined", map(["a", undefined], ["b", 1]), map(["a", undefined]), true],
    ["Map: a missing key is not a key holding undefined", map(["b", 1]), map(["a", undefined]), false],
    [
      "Map: an object key matches on key and value together",
      map([twin, { x: 1, y: 2 }]),
      map([{ a: 1 }, { x: 1 }]),
      true,
    ],
    ["Map: an object key whose value differs", map([twin, { x: 1 }]), map([{ a: 1 }, { x: 2 }]), false],
    [
      "Map: each expected entry claims an entry of its own",
      map([{ a: 1 }, 1], ["k", 0]),
      map([{ a: 1 }, 1], [{ a: 1 }, 1]),
      false,
    ],
    [
      "Map: duplicate keys pair off one to one",
      map([{ a: 1 }, 1], [{ a: 1 }, 1], ["k", 0]),
      map([{ a: 1 }, 1], [{ a: 1 }, 1]),
      true,
    ],
    [
      "Map: equal keys carrying each other's values",
      map([{ k: 1 }, "x"], [{ k: 1 }, "y"]),
      map([{ k: 1 }, "y"], [{ k: 1 }, "x"]),
      true,
    ],
    [
      "Map: a key both sides hold, its value under a structurally equal key",
      map([twin, 1], [{ a: 1, b: 2 }, 2]),
      map([twin, 2]),
      true,
    ],
    ["Map: a key both sides hold with a different value", map([twin, 1], [{ a: 1 }, 2]), map([twin, 2]), false],
    [
      // Node rejects this: walking actual in order, token1's entry claims token2's structurally
      // identical expected entry, and {a:1} then does not contain {a:1,b:1}.
      "Map: entries both sides hold, in another order (node: rejected)",
      map([token1, { a: 1, b: 1 }], [token2, { a: 1 }]),
      map([token2, { a: 1 }], [token1, { a: 1, b: 1 }]),
      true,
    ],
    [
      // Node accepts this by handing shared's expected entry to the {k:1,m:1} key (whose value
      // contains {x:1}) and then matching {k:1} against shared's actual entry. Here shared's
      // entries are settled with each other first, so {k:1} -> {y:2} has to fit {k:1,m:1} -> {x:1}.
      "Map: a key both sides hold is settled with itself even when another pairing would work (node: accepted)",
      map([{ k: 1, m: 1 }, { x: 1 }], [shared, { x: 1, y: 2 }]),
      map([shared, { x: 1 }], [{ k: 1 }, { y: 2 }]),
      false,
    ],
    [
      "Map: a key both sides hold cannot also stand in for another entry",
      map([shared, 3], [{ q: 1 }, 3]),
      map([shared, 3], [{ k: 1 }, 3]),
      false,
    ],
    [
      "Map: object and primitive keys in another order",
      map(["p", 0], [{ k: 1 }, 1], [{ k: 2 }, 2]),
      map([{ k: 2 }, 2], ["p", 0], [{ k: 1 }, 1]),
      true,
    ],
    ["Map: an object key when actual holds only primitive keys", map(["a", 1], ["b", 1]), map([{}, 1]), false],
    ["Map: a function key both sides hold", map([fn, 1], ["k", 2]), map([fn, 1]), true],
    ["Map: a function key both sides hold with a different value", map([fn, 1]), map([fn, 2]), false],
    ["Map: a function key only expected holds", map([() => {}, 1], ["k", 1]), map([() => {}, 1]), false],
    [
      "Map: a function key only expected holds, next to entries that would pair",
      map([{ a: 1 }, 1], ["k", 1]),
      map([{ a: 1 }, 1], [fn, 1]),
      false,
    ],
    [
      "Map: nested collections as keys and values",
      map([map(["a", 1], ["b", 2]), [1, 2, 3]]),
      map([map(["a", 1]), [2]]),
      true,
    ],
    [
      "Map: own properties are still compared",
      Object.assign(map([1, 1]), { x: 1 }),
      Object.assign(map([1, 1]), { x: 2 }),
      false,
    ],
  ];

  test.each(cases)("%s", (_, actual, expected, contained) => {
    if (contained) {
      assert.partialDeepStrictEqual(actual, expected);
    } else {
      expect(() => assert.partialDeepStrictEqual(actual, expected)).toThrow(assert.AssertionError);
    }
  });

  // The pairing is greedy, and which pairing it finds depends on whether a member that can
  // match nothing (a primitive or a function neither side shares) sits between the objects:
  // node probes such a Set member, which sends the next member back to the front of the
  // window, and skips such a Map key, which leaves the next entry probing the back. Bun follows
  // node in both, so the same four objects pair off differently as Set members and as Map keys.
  // After `fitsC` claims C off the back of [A, B, C], `fitsAB` is offered A (Set) or B (Map);
  // whether the last member can take what is left decides the outcome.
  describe("a member that matches nothing, between members that do", () => {
    const A = { a: 1 };
    const B = { b: 2 };
    const C = { c: 3 };
    const fitsC = { c: 3, w: 1 };
    const fitsAB = { a: 1, b: 2 };
    const fitsB = { b: 2, y: 1 };
    const fitsA = { a: 1, y: 1 };
    const strays: [string, unknown][] = [
      ["a primitive", 7],
      ["a function", () => {}],
    ];

    test.each(strays)("%s in a Set", (_, stray) => {
      assert.partialDeepStrictEqual(set(fitsC, stray, fitsAB, fitsB), set(A, B, C));
      expect(() => assert.partialDeepStrictEqual(set(fitsC, stray, fitsAB, fitsA), set(A, B, C))).toThrow(
        assert.AssertionError,
      );
    });

    test.each(strays)("%s as a Map key", (_, stray) => {
      const expected = map([A, 1], [B, 1], [C, 1]);
      assert.partialDeepStrictEqual(map([fitsC, 1], [stray, 1], [fitsAB, 1], [fitsA, 1]), expected);
      expect(() =>
        assert.partialDeepStrictEqual(map([fitsC, 1], [stray, 1], [fitsAB, 1], [fitsB, 1]), expected),
      ).toThrow(assert.AssertionError);
    });
  });

  // Expected in a stride order, so neither the front nor the back guess fits and most members
  // are found by scanning the open window and swap-removed from the middle of it.
  test("a permuted expected side is paired off completely", () => {
    const n = 24;
    const actual = Array.from({ length: n }, (_, i) => ({ id: i, extra: true }));
    const expected = Array.from({ length: n }, (_, i) => ({ id: (i * 7 + 3) % n }));
    assert.partialDeepStrictEqual(new Set(actual), new Set(expected));
    assert.partialDeepStrictEqual(new Set(actual), new Set(expected.slice(0, n / 2)));
    expect(() => assert.partialDeepStrictEqual(new Set(actual), new Set([...expected.slice(1), { id: n }]))).toThrow(
      assert.AssertionError,
    );

    const actualMap = new Map(actual.map(key => [key, key.id]));
    assert.partialDeepStrictEqual(actualMap, new Map(expected.map(key => [key, key.id])));
    expect(() =>
      assert.partialDeepStrictEqual(actualMap, new Map(expected.map(key => [key, key.id === 5 ? -1 : key.id]))),
    ).toThrow(assert.AssertionError);
  });

  test("self-referential members terminate", () => {
    const selfSet = () => {
      const self = new Set<unknown>();
      self.add(self);
      return self;
    };
    const selfMap = () => {
      const self = new Map<unknown, unknown>();
      self.set("self", self);
      return self;
    };
    assert.partialDeepStrictEqual(set(selfSet(), 1), set(selfSet()));
    assert.partialDeepStrictEqual(map([{ k: 1 }, selfMap()], ["s", 1]), map([{ k: 1 }, selfMap()]));
    assert.partialDeepStrictEqual(map(["s", selfMap()]), map(["s", selfMap()]));
  });

  test("an exception thrown while comparing propagates", () => {
    const throwing = () => ({
      get x(): number {
        throw new Error("boom");
      },
    });
    expect(() => assert.partialDeepStrictEqual(set(throwing()), set(throwing()))).toThrow("boom");
    expect(() => assert.partialDeepStrictEqual(map(["k", throwing()]), map(["k", throwing()]))).toThrow("boom");
    expect(() => assert.partialDeepStrictEqual(map([throwing(), 1]), map([throwing(), 1]))).toThrow("boom");
    expect(() => assert.partialDeepStrictEqual(map([{ k: 1 }, throwing()]), map([{ k: 1 }, throwing()]))).toThrow(
      "boom",
    );
  });

  // The expected objects still waiting for a counterpart are held as plain copies while user code
  // runs. Here a getter on the first actual member probed deletes every entry from the expected
  // collection (entry by entry: clear() leaves the old table, and the objects in it, reachable
  // from iterators), collects garbage and allocates look-alikes into the freed cells; the rest of
  // the pairing then reads every pending object, so they have to have been kept alive by the
  // comparison itself. There are enough of them that the copies live on the heap, out of reach of
  // the conservative stack scan. (Bun has always compared the entries as they were when the
  // comparison started; node re-reads Map values while pairing and so rejects the Map case.)
  describe("keeps the pending expected entries alive across a GC", () => {
    const n = 64;
    function firstActual(expected: Set<unknown> | Map<unknown, unknown>) {
      let probed = false;
      return {
        get id() {
          if (!probed) {
            probed = true;
            for (const entry of expected.keys()) expected.delete(entry);
            Bun.gc(true);
            const lookAlikes: object[] = [];
            for (let i = 0; i < 4 * n; i++) lookAlikes.push({ id: -1 });
          }
          return 0;
        },
      };
    }
    const others = () => Array.from({ length: n - 1 }, (_, i) => ({ id: i + 1 }));
    const fresh = () => Array.from({ length: n }, (_, i) => ({ id: i }));

    test("Set", () => {
      const expected = new Set(fresh());
      const actual = new Set([firstActual(expected), ...others()]);
      assert.partialDeepStrictEqual(actual, expected);
      expect(expected.size).toBe(0);
    });

    test("Map", () => {
      const expected = new Map(fresh().map(key => [key, { v: key.id }]));
      const actual = new Map<object, object>([
        [firstActual(expected), { v: 0, extra: true }],
        ...others().map(key => [key, { v: key.id, extra: true }] as [object, object]),
      ]);
      assert.partialDeepStrictEqual(actual, expected);
      expect(expected.size).toBe(0);
    });
  });

  // Each actual member is compared against one or two expected members: the front guess keeps
  // hitting while the sides were built in the same order, the back guess while they were built
  // in opposite orders, so the getters are read 2n times (2n + 2 reversed). Rescanning every
  // unclaimed actual member per expected member, which this replaced, read them about n*n
  // times in the reversed case.
  describe("number of structural comparisons", () => {
    const n = 128;
    function members(onRead: () => void) {
      return Array.from({ length: n }, (_, i) => ({
        get id() {
          onRead();
          return i;
        },
      }));
    }
    const orders: [string, boolean][] = [
      ["same order", false],
      ["opposite order", true],
    ];

    test.each(orders)("Set members, %s", (_, reversed) => {
      let reads = 0;
      const onRead = () => reads++;
      const actual = new Set(members(onRead));
      const other = members(onRead);
      const expected = new Set(reversed ? other.reverse() : other);
      assert.partialDeepStrictEqual(actual, expected);
      expect(reads).toBeLessThanOrEqual(4 * n);
    });

    test.each(orders)("Map entries with object keys, %s", (_, reversed) => {
      let reads = 0;
      const onRead = () => reads++;
      const actual = new Map(members(onRead).map((key, i) => [key, i] as const));
      const other = members(onRead).map((key, i) => [key, i] as const);
      const expected = new Map(reversed ? other.reverse() : other);
      assert.partialDeepStrictEqual(actual, expected);
      expect(reads).toBeLessThanOrEqual(4 * n);
    });

    // Members and keys both sides hold are settled by lookup, so their contents are never read,
    // in whatever order the sides were built.
    test.each(["Set", "Map"])("%s contents both sides hold, shuffled", kind => {
      let reads = 0;
      const keys = members(() => reads++);
      // A fixed stride permutation, so neither the same-order nor the reversed-order guess fits.
      const shuffled = keys.map((_, i) => keys[(i * 37) % n]);
      const position = new Map(keys.map((key, i) => [key, i]));
      const actual = kind === "Set" ? new Set(keys) : new Map(keys.map(key => [key, position.get(key)]));
      const expected = kind === "Set" ? new Set(shuffled) : new Map(shuffled.map(key => [key, position.get(key)]));
      assert.partialDeepStrictEqual(actual, expected);
      expect(reads).toBe(0);
    });
  });

  // Primitive members and primitive keys are settled by hash lookups, which nothing can
  // observe, so the size is the discriminator: at these sizes the rescan per member that this
  // replaced needs well over a minute for either collection in a debug build, the lookups well
  // under a second (the child spends its few seconds starting up and building the
  // collections), and the spawn timeout sits in between.
  test("primitive members and keys are settled by lookups, not rescans", async () => {
    const fixture = `
      const assert = require("node:assert");
      const ints = Array.from({ length: 100_000 }, (_, i) => i);
      assert.partialDeepStrictEqual(new Set(ints), new Set(ints));
      const entries = Array.from({ length: 12_000 }, (_, i) => ["key" + i, i]);
      assert.partialDeepStrictEqual(new Map(entries), new Map(entries));
      console.log("done");
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: "done",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  }, 90_000);
});

describe("AssertionError", () => {
  test("deepStrictEqual reports actual, expected and operator", () => {
    const error = caught(() => assert.deepStrictEqual({ a: 1 }, { a: 2 })) as any;
    expect(error).not.toBeNull();
    expect(error.name).toBe("AssertionError");
    expect(error.code).toBe("ERR_ASSERTION");
    expect(error.operator).toBe("deepStrictEqual");
    expect(error.actual).toEqual({ a: 1 });
    expect(error.expected).toEqual({ a: 2 });
    expect(error.generatedMessage).toBe(true);
  });

  test("notDeepStrictEqual reports its own operator", () => {
    const error = caught(() => assert.notDeepStrictEqual({ a: 1 }, { a: 1 })) as any;
    expect(error.operator).toBe("notDeepStrictEqual");
    expect(error.code).toBe("ERR_ASSERTION");
  });

  test("a string message is used instead of generating one", () => {
    const error = caught(() => assert.deepStrictEqual(1, 2, "nope")) as any;
    expect(error.message.startsWith("nope")).toBe(true);
    expect(error.generatedMessage).toBe(false);
  });

  test("an Error message is thrown as-is", () => {
    const custom = new RangeError("custom");
    const error = caught(() => assert.deepStrictEqual(1, 2, custom));
    expect(error).toBe(custom);
  });
});
