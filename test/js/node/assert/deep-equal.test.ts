// Deep-equality matrix for node:assert and node:util.
// Expectations come from the documented semantics of assert.deepStrictEqual/deepEqual,
// cross-checked against Node.js. Cases Bun gets wrong today are marked `test.failing`.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import assert from "node:assert";
import crypto from "node:crypto";
import util from "node:util";
import vm from "node:vm";

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

class WithValue {
  a = 1;
}

const sharedConstructor = function sharedConstructor() {};
const sharedPrototype = { p: 1 };

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

function withHiddenProperty<T extends object>(object: T, key: PropertyKey, value: unknown): T {
  return Object.defineProperty(object, key, { value, writable: true, configurable: true });
}

function withOwnConstructor(prototype: object | null, constructor: unknown) {
  return Object.create(prototype, { constructor: { value: constructor } });
}

function seventyProperties<T extends Record<string, unknown>>(object: T): T {
  for (let i = 0; i < 70; i++) (object as Record<string, unknown>)["k" + i] = i;
  return object;
}

function dictionaryMode<T extends Record<string, unknown>>(object: T): T {
  for (let i = 0; i < 5; i++) {
    (object as Record<string, unknown>)["t" + i] = 1;
    delete (object as Record<string, unknown>)["t" + i];
  }
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
  return (
    function () {
      // eslint-disable-next-line prefer-rest-params
      return arguments;
    } as (...args: unknown[]) => IArguments
  )(...values);
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
      (boxed as any)[5] = "x";
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
  // Strict mode compares the inherited constructor, not the [[Prototype]]
  // itself: an object with a plain-object prototype chain still equals {}.
  {
    name: "Object.create({ x: 1 }) and {}",
    a: () => Object.create({ x: 1 }),
    b: () => ({}),
    strict: true,
    loose: true,
  },
  {
    name: "{} and Object.create({ x: 1 })",
    a: () => ({}),
    b: () => Object.create({ x: 1 }),
    strict: true,
    loose: true,
  },
  {
    name: "two objects with different non-null prototypes",
    a: () => Object.create({ x: 1 }),
    b: () => Object.create({ z: 2 }),
    strict: true,
    loose: true,
  },
  {
    name: "nested objects whose prototypes differ",
    a: () => ({ a: { ns: Object.create({ inherited: 1 }) } }),
    b: () => ({ a: { ns: {} } }),
    strict: true,
    loose: true,
  },
  {
    name: "a class instance and an object inheriting the same prototype",
    a: () => new WithValue(),
    b: () => Object.assign(Object.create(WithValue.prototype), { a: 1 }),
    strict: true,
    loose: true,
  },
  {
    name: "a Map subclass instance and a Map",
    a: () => new (class extends Map {})(),
    b: () => new Map(),
    strict: false,
    loose: true,
  },
  // An own "constructor" property only short-circuits the prototype
  // comparison when its value is a well-known built-in constructor.
  {
    name: "own constructor: Object on objects with different prototypes",
    a: () => Object.create({ q: 1 }, { constructor: { value: Object } }),
    b: () => Object.create({ w: 2 }, { constructor: { value: Object } }),
    strict: true,
    loose: true,
  },
  {
    name: "own constructor: a user function on objects with different prototypes",
    a: () => Object.create({ q: 1 }, { constructor: { value: sharedConstructor } }),
    b: () => Object.create({ w: 2 }, { constructor: { value: sharedConstructor } }),
    strict: false,
    loose: true,
  },
  {
    name: "own constructor: a user function on objects with the same prototype",
    a: () => Object.create(sharedPrototype, { constructor: { value: sharedConstructor } }),
    b: () => Object.create(sharedPrototype, { constructor: { value: sharedConstructor } }),
    strict: true,
    loose: true,
  },
  {
    name: "own constructor: different non-enumerable user functions on objects with the same prototype",
    a: () => Object.create(sharedPrototype, { constructor: { value: function A() {} } }),
    b: () => Object.create(sharedPrototype, { constructor: { value: function B() {} } }),
    strict: true,
    loose: true,
  },
  {
    name: "a Proxy of {} and {}",
    a: () => new Proxy({}, {}),
    b: () => ({}),
    strict: true,
    loose: true,
  },
  {
    name: "a Proxy of { a: 1 } and { a: 1 }",
    a: () => new Proxy({ a: 1 }, {}),
    b: () => ({ a: 1 }),
    strict: true,
    loose: true,
  },
  {
    name: "{ a: 1 } and a Proxy of { a: 2 }",
    a: () => ({ a: 1 }),
    b: () => new Proxy({ a: 2 }, {}),
    strict: false,
    loose: false,
  },
  {
    name: "a Proxy of a class instance and another instance of that class",
    a: () => new Proxy(new WithValue(), {}),
    b: () => new WithValue(),
    strict: true,
    loose: true,
  },
  {
    name: "a Proxy whose getPrototypeOf trap returns null and a null-prototype object",
    a: () => new Proxy({}, { getPrototypeOf: () => null }),
    b: () => Object.create(null),
    strict: false,
    loose: true,
  },
  {
    name: "a Proxy with an own constructor: Object and an object with another prototype and the same own constructor",
    a: () => new Proxy({ constructor: Object }, {}),
    b: () => Object.create({ z: 1 }, { constructor: { value: Object, enumerable: true } }),
    strict: true,
    loose: true,
    looseBug: "reports not equal",
  },
  {
    name: "own constructor: Uint8Array on objects with different prototypes",
    a: () => withOwnConstructor({ q: 1 }, Uint8Array),
    b: () => withOwnConstructor({ w: 2 }, Uint8Array),
    strict: true,
    loose: true,
  },
  {
    name: "own constructor: Buffer on objects with different prototypes",
    a: () => withOwnConstructor({ q: 1 }, Buffer),
    b: () => withOwnConstructor({ w: 2 }, Buffer),
    strict: true,
    loose: true,
  },
  {
    name: "own constructor: DataView on objects with different prototypes",
    a: () => withOwnConstructor({ q: 1 }, DataView),
    b: () => withOwnConstructor({ w: 2 }, DataView),
    strict: true,
    loose: true,
  },
  {
    name: "own constructor: TypeError on objects with different prototypes",
    a: () => withOwnConstructor({ q: 1 }, TypeError),
    b: () => withOwnConstructor({ w: 2 }, TypeError),
    strict: false,
    loose: true,
  },
  {
    name: "own non-enumerable constructor: Object and Array on the same structure",
    a: () => withHiddenProperty({}, "constructor", Object),
    b: () => withHiddenProperty({}, "constructor", Array),
    strict: false,
    loose: true,
  },
  {
    name: "objects with different prototypes whose inherited constructor is undefined",
    a: () => Object.create(withOwnConstructor(null, undefined)),
    b: () => Object.create(withOwnConstructor(null, undefined)),
    strict: false,
    loose: true,
  },
  {
    name: "Object.setPrototypeOf([], null) and []",
    a: () => Object.setPrototypeOf([], null),
    b: () => [],
    strict: false,
    loose: true,
  },
  {
    name: "{} and Object.create(Object.create(Object.prototype))",
    a: () => ({}),
    b: () => Object.create(Object.create(Object.prototype)),
    strict: true,
    loose: true,
  },
  {
    name: "{} and an object whose prototype has a getter",
    a: () => ({}),
    b: () =>
      Object.create({
        get g() {
          return 1;
        },
      }),
    strict: true,
    loose: true,
  },
  {
    name: "{} and an object inheriting Symbol.toStringTag",
    a: () => ({}),
    b: () => Object.create({ [Symbol.toStringTag]: "X" }),
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },
  {
    name: "Object.create({ x: 1 }) and { x: 1 }",
    a: () => Object.create({ x: 1 }),
    b: () => ({ x: 1 }),
    strict: false,
    loose: false,
  },
  {
    name: "70-property objects, one with an inherited enumerable property",
    a: () => seventyProperties({}),
    b: () => seventyProperties(Object.create({ inherited: 1 })),
    strict: true,
    loose: true,
  },
  {
    name: "a dictionary-mode object and one with an inherited enumerable property",
    a: () => dictionaryMode({ x: 1, y: 2 }),
    b: () => Object.assign(Object.create({ inherited: 1 }), { x: 1, y: 2 }),
    strict: true,
    loose: true,
  },
  {
    name: "{ x: 1 } and an object with a non-enumerable x",
    a: () => ({ x: 1 }),
    b: () => withHiddenProperty({}, "x", 1),
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },
  {
    name: "an object with a non-enumerable x and { x: 1 }",
    a: () => withHiddenProperty({}, "x", 1),
    b: () => ({ x: 1 }),
    strict: false,
    loose: false,
  },
  {
    name: "{ x: 1, y: 2 } and { x: 1 } with a non-enumerable y",
    a: () => ({ x: 1, y: 2 }),
    b: () => withHiddenProperty({ x: 1 }, "y", 2),
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },
  {
    name: "a Date and a Date subclass instance with the same time",
    a: () => new Date(0),
    b: () => new (class extends Date {})(0),
    strict: false,
    loose: true,
  },
  {
    name: "a boxed string and a null-prototype boxed string",
    a: () => new String("a"),
    b: () => Object.setPrototypeOf(new String("a"), null),
    strict: false,
    loose: true,
    looseBug: "throws a TypeError",
  },
  {
    name: "new Number(1) and Object.create(Number.prototype)",
    a: () => new Number(1),
    b: () => Object.create(Number.prototype),
    strict: false,
    loose: false,
  },
  {
    name: "an Error and a plain object inheriting Error.prototype with the same message",
    a: () => new Error("a"),
    b: () => withHiddenProperty(withHiddenProperty(Object.create(Error.prototype), "message", "a"), "stack", ""),
    strict: false,
    loose: false,
  },
  {
    name: "two pending Promises",
    a: () => new Promise(() => {}),
    b: () => new Promise(() => {}),
    strict: false,
    loose: false,
    looseBug: "reports equal",
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
      declare value: unknown;
      constructor(value) {
        this.value = value;
      }
    }
    class Bar {
      declare value: unknown;
      constructor(value) {
        this.value = value;
      }
    }

    test("ignores differing constructors when set", () => {
      expect(util.isDeepStrictEqual(new Foo(42), new Bar(42))).toBe(false);
      expect(util.isDeepStrictEqual(new Foo(42), new Bar(42), true as any)).toBe(true);
    });

    test("still compares values", () => {
      expect(util.isDeepStrictEqual(new Foo(42), new Bar(99), true as any)).toBe(false);
    });

    test.each([
      ["object property", () => ({ inner: new Foo(1) }), () => ({ inner: new Bar(1) })],
      ["array element", () => [new Foo(1)], () => [new Bar(1)]],
      ["Map value", () => new Map([["k", new Foo(1)]]), () => new Map([["k", new Bar(1)]])],
      ["Set element", () => new Set([new Foo(1)]), () => new Set([new Bar(1)])],
      ["Error cause", () => new Error("e", { cause: new Foo(1) }), () => new Error("e", { cause: new Bar(1) })],
    ])("propagates through %s", (_name, makeA, makeB) => {
      expect(util.isDeepStrictEqual(makeA(), makeB())).toBe(false);
      expect(util.isDeepStrictEqual(makeA(), makeB(), true as any)).toBe(true);
    });

    test("still compares Object.prototype.toString tags", () => {
      expect(util.isDeepStrictEqual(argumentsObject(1), { 0: 1 }, true as any)).toBe(false);
      expect(util.isDeepStrictEqual(argumentsObject(1), argumentsObject(1), true as any)).toBe(true);
      expect(util.isDeepStrictEqual(Object.create({ [Symbol.toStringTag]: "X" }), {}, true as any)).toBe(false);
    });

    test("ignores the boxed-primitive subclass distinction", () => {
      class S extends String {}
      expect(util.isDeepStrictEqual(new String("a"), new S("a"))).toBe(false);
      expect(util.isDeepStrictEqual(new String("a"), new S("a"), true as any)).toBe(true);
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

// A hole is not an element. Node.js scans both arrays until the first hole on either side, then
// matches the rest of Object.keys(expected) in order inside the rest of Object.keys(actual)
// (partialArrayEquiv and partialSparseArrayEquiv in lib/internal/util/comparisons.js).
// Every result in these tables is the answer of Node.js v26.3.0 for the same call.
describe("assert.partialDeepStrictEqual with array holes", () => {
  const outcome = (actual: unknown, expected: unknown) => {
    try {
      assert.partialDeepStrictEqual(actual, expected);
      return "passes";
    } catch (error) {
      if (!(error instanceof assert.AssertionError)) throw error;
      return "throws";
    }
  };
  type Row = [label: string, actual: unknown, expected: unknown, resultInNode: "passes" | "throws"];
  const rows = (title: string, table: Row[], run = test) =>
    describe(title, () => {
      run.each(table)("%s", (label, actual, expected, result) => {
        expect(outcome(actual, expected)).toBe(result);
      });
    });
  const sparse = (length: number, elements: Record<number, unknown>) => Object.assign(new Array(length), elements);
  const withGetter = (array: unknown[], index: number, get: () => unknown) =>
    Object.defineProperty(array, index, { get, enumerable: true });
  const hidden = (array: unknown[], key: PropertyKey) => Object.defineProperty(array, key, { enumerable: false });
  const tag = Symbol.toStringTag;
  const tagged = (object: object, value: unknown = "x") => Object.defineProperty(object, tag, { value });
  const sym = Symbol("key");

  rows("a hole in actual does not match undefined", [
    ["[,] has [undefined]", [,], [undefined], "throws"],
    ["[1, , 3] has [1, undefined, 3]", [1, , 3], [1, undefined, 3], "throws"],
    ["[, 1] has [undefined, 1]", [, 1], [undefined, 1], "throws"],
    ["[1, ,] has [1, undefined]", [1, ,], [1, undefined], "throws"],
    ["[, 1, 2] has [undefined]", [, 1, 2], [undefined], "throws"],
    ["[, undefined, 2] has [undefined, undefined]", [, undefined, 2], [undefined, undefined], "throws"],
    ["new Array(3) has [undefined, undefined, undefined]", new Array(3), [undefined, undefined, undefined], "throws"],
    ["[, , ,] has [1]", [, , ,], [1], "throws"],
    ["control: [undefined] has [undefined]", [undefined], [undefined], "passes"],
    ["control: [, undefined, 2] has [undefined]", [, undefined, 2], [undefined], "passes"],
    ["control: [1, , 3] has [1, 3]", [1, , 3], [1, 3], "passes"],
    ["control: [, 1, 2] has [1, 2]", [, 1, 2], [1, 2], "passes"],
  ]);

  rows("a hole in expected matches nothing and is skipped", [
    ["[1, 2, 3] has [, 2]", [1, 2, 3], [, 2], "passes"],
    ["[1, 2, 3] has [1, , 3]", [1, 2, 3], [1, , 3], "passes"],
    ["[1, 2, 3, 4] has [1, , 4]", [1, 2, 3, 4], [1, , 4], "passes"],
    ["[1, 2, 3] has [, , 3]", [1, 2, 3], [, , 3], "passes"],
    ["[1, 2, 3] has [, , 1]", [1, 2, 3], [, , 1], "passes"],
    ["[1, 2, 3] has [, , ,]", [1, 2, 3], [, , ,], "passes"],
    ["[1, 2, 3] has [1, 2, ,]", [1, 2, 3], [1, 2, ,], "passes"],
    ["[{ a: 1, b: 2 }, { c: 3 }] has [, { c: 3 }]", [{ a: 1, b: 2 }, { c: 3 }], [, { c: 3 }], "passes"],
    ["[undefined] has [,]", [undefined], [,], "passes"],
    ["[1, , 3] has [1, , 3]", [1, , 3], [1, , 3], "passes"],
    ["new Array(1000) has new Array(100)", new Array(1000), new Array(100), "passes"],
    ["[1, 2, 3] has [, 4]", [1, 2, 3], [, 4], "throws"],
    ["[3, 2, 1] has [1, , 3]", [3, 2, 1], [1, , 3], "throws"],
    ["[{ a: 1 }, { c: 3 }] has [, { d: 3 }]", [{ a: 1 }, { c: 3 }], [, { d: 3 }], "throws"],
    ["longer expected: [1, 3] has [1, , 3]", [1, 3], [1, , 3], "throws"],
    ["longer expected: new Array(100) has new Array(1000)", new Array(100), new Array(1000), "throws"],
  ]);

  const sparseActual = sparse(1000, { 90: 1, 92: 2, 95: 1, 96: 2 });
  rows("sparse arrays match by their own keys, not by position", [
    ["a subset at the same indexes", sparseActual, sparse(1000, { 90: 1, 95: 1 }), "passes"],
    ["a subset at other indexes", sparseActual, sparse(100, { 3: 2, 7: 1 }), "passes"],
    ["a value that is absent", sparseActual, sparse(1000, { 90: 1, 92: 1, 95: 1 }), "throws"],
    ["values out of order", sparseActual, sparse(1000, { 90: 2, 95: 1, 96: 1 }), "throws"],
    ["more keys than actual has", sparse(1000, { 90: 1, 92: 1 }), sparse(1000, { 90: 1, 92: 1, 95: 1 }), "throws"],
    ["partial objects", sparse(10, { 1: { a: 1, b: 2 } }), sparse(10, { 7: { a: 1 } }), "passes"],
  ]);

  const cyclicActual: unknown[] = [0, 1];
  cyclicActual.push(cyclicActual);
  const cyclicExpected: unknown[] = [, 1];
  cyclicExpected.push(cyclicExpected);
  rows("a hole is found in every nested position", [
    ["object value", { list: [,] }, { list: [undefined] }, "throws"],
    ["object value, hole in expected", { list: [1, 2, 3] }, { list: [, 3] }, "passes"],
    ["array element", [[1, , 3]], [[1, undefined, 3]], "throws"],
    ["array element, hole in expected", [[1, 2, 3]], [[, 2]], "passes"],
    ["Set member", new Set([[,]]), new Set([[undefined]]), "throws"],
    ["Set member, hole in expected", new Set([[1, 2, 3]]), new Set([[, 2]]), "passes"],
    ["Map value", new Map([["k", [,]]]), new Map([["k", [undefined]]]), "throws"],
    ["Map value, hole in expected", new Map([["k", [1, 2, 3]]]), new Map([["k", [, 2]]]), "passes"],
    ["Map key", new Map([[[,], 1]]), new Map([[[undefined], 1]]), "throws"],
    ["Error cause", new Error("e", { cause: [,] }), new Error("e", { cause: [undefined] }), "throws"],
    ["cycle", cyclicActual, cyclicExpected, "passes"],
  ]);

  class Sub extends Array<unknown> {}
  const sparseSub = new Sub(3);
  sparseSub[0] = 1;
  sparseSub[2] = 3;
  rows("every kind of array tells a hole from undefined", [
    ["doubles", [1.5, , 3.5], [1.5, undefined, 3.5], "throws"],
    ["doubles, hole in expected", [1.5, 2.5, 3.5], [, 2.5], "passes"],
    ["strings", ["a", , "c"], ["a", undefined, "c"], "throws"],
    ["strings, hole in expected", ["a", , "c", , "e"], [, "c", "e"], "passes"],
    ["frozen", Object.freeze([1, , 3]), [1, undefined, 3], "throws"],
    ["frozen, hole in expected", [1, 2, 3], Object.freeze([, 2]), "passes"],
    ["sealed", Object.seal([1, , 3]), [1, undefined, 3], "throws"],
    ["sealed, no undefined expected", Object.seal([1, , 3]), [1, 3], "passes"],
    ["subclass", sparseSub, Sub.of(1, undefined, 3), "throws"],
    ["subclass, hole in expected", Sub.of(1, 2, 3), sparseSub, "passes"],
    ["other realm", vm.runInNewContext("[1, , 3]"), [1, undefined, 3], "throws"],
    ["other realm, hole in expected", [1, 2, 3], vm.runInNewContext("[, 2]"), "passes"],
    ["Proxy", new Proxy([,], {}), [undefined], "throws"],
    ["Proxy, hole in expected", [1, 2, 3], new Proxy([, 2], {}), "passes"],
    ["Proxy of a Proxy", new Proxy(new Proxy([1, , 3], {}), {}), [1, undefined], "throws"],
    ["index far from the others", sparse(3, { 0: 1, 100000: 4 }), [1, undefined], "throws"],
    ["index far from the others, hole in expected", sparse(3, { 0: 1, 100000: 4 }), [, 4], "passes"],
    [
      "a getter that returns undefined is an element",
      withGetter([1, 0, 3], 1, () => undefined),
      [1, undefined, 3],
      "passes",
    ],
    ["a hole is not that getter", [1, , 3], withGetter([1, 0, 3], 1, () => undefined), "throws"],
    ["a getter after a hole", withGetter([, 0, 3], 1, () => 2), [2, 3], "passes"],
  ]);

  // Before the first hole the scan is bound by both lengths, which count holes. From the first
  // hole on the keys are Object.keys: named keys follow the indexes and hidden indexes are left out.
  rows("the two phases of Node.js", [
    ["[, 1] has [1, ,]", [, 1], [1, ,], "passes"],
    ["[, undefined] has [undefined, ,]", [, undefined], [undefined, ,], "passes"],
    ["[1, 2] has [2, ,]", [1, 2], [2, ,], "throws"],
    ["[1, 2, 3] has [2, ,]", [1, 2, 3], [2, ,], "passes"],
    ["[1, 2] has [, 2]", [1, 2], [, 2], "passes"],
    ["[1, 2, 3] has [3, ,]", [1, 2, 3], [3, ,], "throws"],
    ["a named key of actual is a candidate", Object.assign([1, , 3], { foo: "x" }), [1, "x"], "passes"],
    [
      "named keys match in their order",
      Object.assign([1, , 3], { a: 1, b: 2 }),
      Object.assign([1, , 3], { b: 2, a: 1 }),
      "throws",
    ],
    ["a hidden index, no hole", hidden([1, 2, 3], 1), [1, 2, 3], "passes"],
    ["a hidden index of actual, hole in expected", hidden([1, 2, 3], 1), [, 2], "throws"],
    ["a hidden index of expected, hole in expected", [1, 2, 3], hidden([, 2, 3], 1), "passes"],
    ["a hidden index in a sparse array", hidden(sparse(6001, { 5000: 1, 6000: 2 }), 6000), [2], "throws"],
  ]);

  // Node.js uses the position of the first hole as an offset into Object.keys. A hidden index
  // before the hole shifts that offset, and the keys after it are not compared: 2 and 99 are not
  // in actual. That is a defect of Node.js. These rows hold it on purpose.
  rows("a hidden index before the first hole", [
    ["[1, ,] has [1 (hidden), 2]", [1, ,], hidden([1, 2], 0), "passes"],
    ["[1, 2, 3, 5] has [1 (hidden), 2, , 99]", [1, 2, 3, 5], hidden([1, 2, , 99], 0), "passes"],
  ]);

  class Tagged extends Array<unknown> {
    get [tag]() {
      return "Tagged";
    }
  }
  rows("Symbol.toStringTag and named keys are compared before the elements", [
    ["tag on actual", Object.assign([1], { [tag]: "x" }), [1], "throws"],
    ["tag on expected", [1], Object.assign([1], { [tag]: "x" }), "throws"],
    ["tag from the class of actual", Tagged.of(1, 2), [1, 2], "throws"],
    ["tag from the class of both", Tagged.of(1, 2, 3), Tagged.of(1, 3), "passes"],
    ["tag on actual, hole in expected", Object.assign([1, 2, 3], { [tag]: "x" }), [, 2], "throws"],
    ["tag on actual, hole in actual", Object.assign([1, , 3], { [tag]: "x" }), [1, 3], "throws"],
    [
      "same tag, hole in expected",
      Object.assign([1, 2, 3], { [tag]: "x" }),
      Object.assign([, 2], { [tag]: "x" }),
      "passes",
    ],
    [
      "symbol key differs, hole in expected",
      Object.assign([1, 2, 3], { [sym]: 1 }),
      Object.assign([1, , 3], { [sym]: 2 }),
      "throws",
    ],
    ["symbol key missing, hole in expected", [1, 2, 3], Object.assign([1, , 3], { [sym]: 2 }), "throws"],
    [
      "symbol key differs, hole in actual",
      Object.assign([1, , 3], { [sym]: 1 }),
      Object.assign([1, 3], { [sym]: 2 }),
      "throws",
    ],
    ["named key missing, its value is an element", [1, 2, 3], Object.assign([1, ,], { foo: 2 }), "throws"],
    [
      "named key hidden on actual",
      hidden(Object.assign([1, 2, 3], { foo: 2 }), "foo"),
      Object.assign([1, ,], { foo: 2 }),
      "throws",
    ],
    ["named key equal", Object.assign([1, 2, 3], { foo: 7 }), Object.assign([1, , 3], { foo: 7 }), "passes"],
    [
      "named key compared partially",
      Object.assign([1, , 3], { k: [1, 2, 3] }),
      Object.assign([1, , 3], { k: [, 2] }),
      "passes",
    ],
    ["Proxy with a named key", [1], new Proxy(Object.assign([1], { k: 1 }), {}), "throws"],
    ["Proxy with a named key and a hole", [1, 1, 1], new Proxy(Object.assign([, 1], { k: 1 }), {}), "throws"],
    ["Proxy with a symbol key and a hole", [1, 2, 3], new Proxy(Object.assign([, 2], { [sym]: 1 }), {}), "throws"],
    [
      "Proxy with an equal named key and a hole",
      Object.assign([1, 2, 3], { k: 1 }),
      new Proxy(Object.assign([, 2], { k: 1 }), {}),
      "passes",
    ],
  ]);

  rows(
    "Symbol.toStringTag is compared in every kind of object but a view",
    Object.entries<() => object>({
      Map: () => new Map([[1, 1]]),
      Set: () => new Set([1]),
      Date: () => new Date(0),
      RegExp: () => /a/g,
      Error: () => new Error("e"),
      URL: () => new URL("http://a/"),
      KeyObject: () => crypto.createSecretKey(Buffer.from("secret")),
      Number: () => new Number(1),
      Object: () => ({ a: 1 }),
      ArrayBuffer: () => new ArrayBuffer(2),
    })
      .flatMap(([kind, make]): Row[] => [
        [`${kind}, tag on actual`, tagged(make()), make(), "throws"],
        [`${kind}, tag on expected`, make(), tagged(make()), "throws"],
        [`${kind}, different tags`, tagged(make(), "x"), tagged(make(), "y"), "throws"],
        [`${kind}, same tag`, tagged(make()), tagged(make()), "passes"],
      ])
      .concat([
        ["Uint8Array, tag on actual", tagged(new Uint8Array([1])), new Uint8Array([1]), "passes"],
        ["Uint8Array, tag on expected", new Uint8Array([1]), tagged(new Uint8Array([1])), "passes"],
        [
          "DataView, tag on actual",
          tagged(new DataView(new ArrayBuffer(1))),
          new DataView(new ArrayBuffer(1)),
          "passes",
        ],
        [
          "DataView, tag on expected",
          new DataView(new ArrayBuffer(1)),
          tagged(new DataView(new ArrayBuffer(1))),
          "passes",
        ],
      ]),
  );

  // Node.js settles the lengths, the tags and the named keys of expected before it looks for a cycle.
  const shortInCycle: unknown[] = [];
  const longInCycle: unknown[] = [shortInCycle, 9];
  shortInCycle.push(longInCycle);
  const expectedShort: unknown[] = [];
  const expectedLong: unknown[] = [];
  expectedShort.push(expectedLong);
  expectedLong.push(expectedLong, 9);
  const taggedInCycle: unknown[] = [tagged([])];
  taggedInCycle.push(taggedInCycle);
  rows("a cycle does not answer for the lengths and the tags", [
    ["a revisit with a shorter actual", shortInCycle, expectedShort, "throws"],
    ["an empty expected against a revisit of actual", taggedInCycle, [[]], "passes"],
  ]);

  rows("a Proxy is compared through its traps", [
    ["elements at other indexes", [9, 8, 2], new Proxy([, 2], {}), "passes"],
    [
      "ownKeys hides an index",
      [1, 9, 3],
      new Proxy([, 2, 3], { ownKeys: target => Reflect.ownKeys(target).filter(key => key !== "1") }),
      "passes",
    ],
    [
      "get changes an element",
      [1, 20, 3],
      new Proxy([, 2, 3], {
        get: (target, key, receiver) => (key === "1" ? 20 : Reflect.get(target, key, receiver)),
      }),
      "passes",
    ],
  ]);

  rows("named keys follow the index keys of every kind of storage", [
    ["frozen actual", Object.freeze(Object.assign([1, , 3], { foo: "x" })), [1, "x"], "passes"],
    ["index far from the others", Object.assign(sparse(3, { 0: 1, 100000: 4 }), { foo: "x" }), [1, 4, "x"], "passes"],
  ]);

  // The tag compare uses the class string: a tag that is not a string, or that is the built-in
  // class name, is not seen. The lengths are read once: Node.js reads them again at every step.
  const growsWhenRead: unknown[] = withGetter([0, 2], 0, () => {
    growsWhenRead.push(3);
    return 1;
  });
  rows(
    "answers of Node.js that are not matched yet",
    [
      ['tag "Array" on actual', tagged([1], "Array"), [1], "throws"],
      ['tag "Array" on expected', [1], tagged([1], "Array"), "throws"],
      ["tag 5 on actual", tagged([1], 5), [1], "throws"],
      ["tags 5 and 6", tagged([1], 5), tagged([1], 6), "throws"],
      ["an index getter that grows actual", growsWhenRead, [1, 3], "passes"],
    ],
    test.failing,
  );

  test("a named key that throws is read before the elements", () => {
    const expected = Object.defineProperty([, 9], "k", {
      get() {
        throw new RangeError("from the getter");
      },
      enumerable: true,
    });
    expect(() => assert.partialDeepStrictEqual(Object.assign([1, 2], { k: 1 }), expected)).toThrow(
      new RangeError("from the getter"),
    );
  });

  test("an element read that throws is not a hole", () => {
    const trap = new Proxy([, 2], {
      getOwnPropertyDescriptor() {
        throw new RangeError("from the trap");
      },
    });
    expect(() => assert.partialDeepStrictEqual([1, 2], trap)).toThrow(new RangeError("from the trap"));
    const getter = withGetter([, 0, 3], 1, () => {
      throw new RangeError("from the getter");
    });
    expect(() => assert.partialDeepStrictEqual(getter, [3])).toThrow(new RangeError("from the getter"));
  });

  // All ordered pairs of the arrays of length 0 to 3 over a hole, undefined and 1. Bit n of
  // `answers` says that Node.js v26.3.0 passes pair n. To record it again, run this loop in
  // Node.js with a bit set for each pair that passes.
  test("every pair of small arrays gets the answer of Node.js", () => {
    const answers = Buffer.from(
      "AQAAAAADAAAAAAcAAAAACwAAAAATAAAAALcAAAAAWwQAAAC3AAAAALcBAAAA/wIAAABbBAAAAH8MAAAAWxQAAAATIAAAALdgQQAAW6QIgAC3YEEAALdhwwIA/+ZNkQBbpAiAAP/sWYAFW7QogCK3YEEAALdhwwIA/+ZNEQC3YcMCALdhwwYA/+PPCwD/5k0RAP/v3zEA//ZtUQBbpAiAAP/sGYAFW7QogCL/7BmABf/tG4AN//49gBdbtCiAIn/8OYBjW7QogKI=",
      "base64",
    );
    const hole = Symbol("hole");
    const specs: (symbol | number | undefined)[][] = [[]];
    for (let i = 0; i < specs.length; i++) {
      if (specs[i].length < 3) for (const value of [hole, undefined, 1]) specs.push([...specs[i], value]);
    }
    const build = (spec: (symbol | number | undefined)[]) => {
      const array = new Array(spec.length);
      spec.forEach((value, index) => {
        if (value !== hole) array[index] = value;
      });
      return array;
    };
    const show = (spec: (symbol | number | undefined)[]) =>
      `[${spec.map(value => (value === hole ? "" : String(value))).join(", ")}${spec.at(-1) === hole ? "," : ""}]`;
    const mismatch = new Error("not equal");
    const wrong: string[] = [];
    let pair = 0;
    for (const actual of specs) {
      for (const expected of specs) {
        let passes = true;
        try {
          assert.partialDeepStrictEqual(build(actual), build(expected), mismatch);
        } catch (error) {
          if (error !== mismatch) throw error;
          passes = false;
        }
        const passesInNode = ((answers[pair >> 3] >> (pair & 7)) & 1) === 1;
        if (passes !== passesInNode) {
          wrong.push(`${show(actual)} has ${show(expected)}: Node.js ${passesInNode ? "passes" : "throws"}`);
        }
        pair++;
      }
    }
    expect({ pairs: pair, wrong }).toEqual({ pairs: 1600, wrong: [] });
  });

  // A getter of an element changes the array that holds it while the keys after the hole are matched.
  const selfChanging = (change: (array: unknown[]) => unknown) => {
    const array: unknown[] = [
      ,
      {
        get v() {
          change(array);
          return 1;
        },
      },
      { v: 2 },
      { v: 3 },
    ];
    return array;
  };
  rows("an array that changes during the comparison", [
    ["actual is truncated", selfChanging(array => (array.length = 2)), [{ v: 1 }, { v: 3 }], "throws"],
    ["actual loses a later element", selfChanging(array => delete array[3]), [{ v: 1 }, { v: 3 }], "throws"],
    ["actual is emptied", selfChanging(array => (array.length = 0)), [{ v: 1 }, { v: 2 }], "throws"],
    ["actual is emptied after the last match", selfChanging(array => (array.length = 0)), [{ v: 1 }], "passes"],
    ["actual is frozen", selfChanging(array => Object.freeze(array)), [{ v: 1 }, { v: 3 }], "passes"],
    [
      "actual gets an index far from the others",
      selfChanging(array => (array[1e9] = 0)),
      [{ v: 1 }, { v: 2 }],
      "passes",
    ],
    [
      "actual is reallocated",
      selfChanging(array => {
        for (let i = 0; i < 1e5; i++) array.push(i);
        array.length = 4;
      }),
      [{ v: 1 }, { v: 2 }],
      "passes",
    ],
    ["actual is pushed to", selfChanging(array => array.push({ v: 9 })), [{ v: 1 }, { v: 9 }], "throws"],
    ["actual gets a named key", selfChanging(array => Object.assign(array, { k: "n" })), [{ v: 1 }, "n"], "throws"],
    ["actual gets an index that expected needs", selfChanging(array => (array[1e9] = 0)), [{ v: 1 }, 0], "throws"],
    ["actual gets its hole filled", selfChanging(array => (array[0] = { v: 5 })), [{ v: 1 }, { v: 5 }], "throws"],
    [
      "actual loses an element that expected has as undefined",
      selfChanging(array => delete array[3]),
      [{ v: 1 }, undefined],
      "passes",
    ],
    ["expected grows", [{ v: 1 }, { v: 2 }, { v: 3 }, 4], selfChanging(array => array.push({ v: 7 })), "passes"],
  ]);

  // The child exits in time only if the comparison reads the keys that exist, once. A mismatch
  // throws the error it is given, so no message is built for these arrays.
  const inChild = async (script: string) => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const assert = require("node:assert");
         const mismatch = new Error("not equal");
         const outcome = (actual, expected) => {
           try {
             assert.partialDeepStrictEqual(actual, expected, mismatch);
             return "passes";
           } catch (error) {
             if (error !== mismatch) throw error;
             return "throws";
           }
         };
         const results = {};
         ${script}
         console.log(JSON.stringify(results));`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { results: stdout && JSON.parse(stdout), stderr, exitCode, signalCode: proc.signalCode };
  };

  // `array.length = 2 ** 32 - 1` puts the elements in a sparse map. The last two rows need an index
  // on Array.prototype: Node.js reads it as an element in the scan, and it is not a key after the hole.
  test.concurrent("the length of a sparse array does not set the cost", async () => {
    expect(
      await inChild(`
        const huge = elements => {
          const array = [];
          array.length = 2 ** 32 - 1;
          return Object.assign(array, elements);
        };
        results["one element, dense expected"] = outcome(huge({ 4000000000: "x" }), ["x"]);
        results["one element, another value expected"] = outcome(huge({ 4000000000: "x" }), ["y"]);
        results["one element each"] = outcome(huge({ 4000000000: "x" }), huge({ 5: "x" }));
        results["the last index"] = outcome(huge({ [2 ** 32 - 2]: "x" }), huge({ [2 ** 32 - 2]: "x" }));
        results["two elements in order"] = outcome(huge({ 7: "x", 4000000000: "y" }), huge({ 1: "x", 2: "y" }));
        results["more keys than actual has"] = outcome(huge({ 4000000000: "x" }), huge({ 1: "x", 2: "x" }));
        results["no element"] = outcome(huge({}), huge({}));
        Array.prototype[3] = "Q";
        results["inherited index before a hole in actual"] = outcome([1, 2, 3, , 5, , 7], [1, 2, 3, "Q", 5, 7]);
        results["inherited index before a hole in expected"] = outcome([1, 2, 3, "Q", 5, 7], [1, 2, 3, , , 7]);
        delete Array.prototype[3];
      `),
    ).toEqual({
      results: {
        "one element, dense expected": "passes",
        "one element, another value expected": "throws",
        "one element each": "passes",
        "the last index": "passes",
        "two elements in order": "passes",
        "more keys than actual has": "throws",
        "no element": "passes",
        "inherited index before a hole in actual": "throws",
        "inherited index before a hole in expected": "passes",
      },
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  // `new Array(500_000)` keeps its elements in a flat vector with holes, which is read slot by slot.
  // Freezing an array moves its elements to a sparse map.
  test.concurrent("the keys of a large array are listed once", async () => {
    expect(
      await inChild(`
        const spread = () => {
          const array = new Array(500_000);
          for (let i = 0; i < 10_000; i++) array[i * 50] = i;
          return array;
        };
        results["10,000 elements in 500,000 slots, the last one expected"] = outcome(spread(), [, 9_999]);
        results["10,000 elements in 500,000 slots, all expected"] = outcome(spread(), spread());
        const frozenByItsElement = [
          ,
          {
            get v() {
              Object.freeze(frozenByItsElement);
              return 1;
            },
          },
        ];
        for (let i = 2; i <= 5_000; i++) frozenByItsElement.push({ v: i });
        results["5,000 elements, frozen by the first one"] = outcome(frozenByItsElement, [{ v: 1 }, { v: 5_000 }]);
      `),
    ).toEqual({
      results: {
        "10,000 elements in 500,000 slots, the last one expected": "passes",
        "10,000 elements in 500,000 slots, all expected": "passes",
        "5,000 elements, frozen by the first one": "passes",
      },
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });
});
