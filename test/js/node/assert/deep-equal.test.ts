// Deep-equality matrix for node:assert and node:util.
// Expectations come from the documented semantics of assert.deepStrictEqual/deepEqual,
// cross-checked against Node.js. Cases Bun gets wrong today are marked `test.failing`.
import { describe, expect, test } from "bun:test";
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
  /** The answer of assert.deepStrictEqual(b, a), when it is not `strict`. */
  strictSwapped?: boolean;
  /** Set when Bun disagrees with `strict`; the text says what Bun does instead. */
  strictBug?: string;
  /** Set when Bun disagrees with `loose`; the text says what Bun does instead. */
  looseBug?: string;
}

const sym = Symbol("shared");
function SharedConstructor() {}
const inheritsSharedConstructor = Object.create(Object.prototype, { constructor: { value: SharedConstructor } });
const ownSharedConstructor = () =>
  Object.assign(Object.create({}, { constructor: { value: SharedConstructor } }), { v: 1 });
const inheritedSharedConstructor = () => Object.assign(Object.create(inheritsSharedConstructor), { v: 1 });
const nullPrototypeProxy = () => new Proxy({}, { getPrototypeOf: () => null });
const sharedObject = { a: 1 };
const errorWithEnumerableCode = () => Object.assign(new Error("x"), { code: 1 });
const errorWithHiddenCode = () =>
  Object.defineProperty(Object.assign(new Error("x"), { other: 2 }), "code", { value: 1, enumerable: false });
const errorWithEnumerableStack = (stack: string) =>
  Object.defineProperty(new Error("x"), "stack", { value: stack, enumerable: true });
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
  // node's strict mode reads `constructor` from the left operand only, so these answers depend on the argument order.
  {
    name: "a Proxy whose getPrototypeOf trap returns null and a null-prototype object",
    a: nullPrototypeProxy,
    b: () => Object.create(null),
    strict: false,
    strictSwapped: true,
    loose: true,
  },
  {
    name: "maps holding such a Proxy and such an object under the same key",
    a: () => new Map([["k", nullPrototypeProxy()]]),
    b: () => new Map([["k", Object.create(null)]]),
    strict: false,
    strictSwapped: true,
    loose: true,
  },
  {
    name: "an object with an own non-enumerable constructor and an object that inherits the same constructor",
    a: ownSharedConstructor,
    b: inheritedSharedConstructor,
    strict: false,
    strictSwapped: true,
    loose: true,
  },
  {
    name: "maps holding such objects under the same key",
    a: () => new Map([["k", ownSharedConstructor()]]),
    b: () => new Map([["k", inheritedSharedConstructor()]]),
    strict: false,
    strictSwapped: true,
    loose: true,
  },
  {
    name: "sets holding such objects",
    a: () => new Set([ownSharedConstructor()]),
    b: () => new Set([inheritedSharedConstructor()]),
    strict: false,
    strictSwapped: true,
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
  // node compares the own enumerable keys of both errors. A key that one error holds but does not enumerate is not a match.
  {
    name: "an error with an own enumerable key and an error that holds the key non-enumerable beside another key",
    a: errorWithEnumerableCode,
    b: errorWithHiddenCode,
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },
  {
    name: "arrays holding such errors",
    a: () => [errorWithEnumerableCode()],
    b: () => [errorWithHiddenCode()],
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },
  {
    name: "maps holding such errors under the same key",
    a: () => new Map([["k", errorWithEnumerableCode()]]),
    b: () => new Map([["k", errorWithHiddenCode()]]),
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },
  {
    name: "sets holding such errors",
    a: () => new Set([errorWithEnumerableCode()]),
    b: () => new Set([errorWithHiddenCode()]),
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },
  {
    name: "an error with an own enumerable message and an error with another own enumerable key",
    a: () => Object.assign(new Error(), { message: "x" }),
    b: () => Object.assign(new Error("x"), { code: 1 }),
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },
  {
    name: "an error with an own enumerable name and an error with another own enumerable key",
    a: () => Object.assign(new Error("x"), { name: "Error" }),
    b: () => Object.assign(new Error("x"), { errno: 1 }),
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },
  {
    name: "errors with equal own enumerable stacks",
    a: () => errorWithEnumerableStack("at a"),
    b: () => errorWithEnumerableStack("at a"),
    strict: true,
    loose: true,
  },
  {
    name: "errors with unequal own enumerable stacks",
    a: () => errorWithEnumerableStack("at a"),
    b: () => errorWithEnumerableStack("at b"),
    strict: false,
    loose: false,
    looseBug: "reports equal",
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
  // https://github.com/oven-sh/bun/issues/28760
  {
    name: "a set holding two deep-equal objects and a set holding two different ones",
    a: () => new Set([{ a: 1 }, { a: 1 }]),
    b: () => new Set([{ a: 1 }, { a: 2 }]),
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },
  {
    name: "a map keyed by two deep-equal objects and a map keyed by two different ones",
    a: () =>
      new Map([
        [{ a: 1 }, 1],
        [{ a: 1 }, 1],
      ]),
    b: () =>
      new Map([
        [{ a: 1 }, 1],
        [{ a: 2 }, 1],
      ]),
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },
  // One member has no identical counterpart, and its deep-equal match is the member that both sides hold.
  {
    name: "a set holding an object and a different one, and a set holding that object and a copy of it",
    a: () => new Set([sharedObject, { a: 2 }]),
    b: () => new Set([sharedObject, { a: 1 }]),
    strict: false,
    loose: false,
  },
  {
    name: "a map keyed by an object and a different one, and a map keyed by that object and a copy of it",
    a: () =>
      new Map([
        [sharedObject, 1],
        [{ a: 2 }, 1],
      ]),
    b: () =>
      new Map([
        [sharedObject, 1],
        [{ a: 1 }, 1],
      ]),
    strict: false,
    loose: false,
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
        if (mode !== "strict") return;
        const swapped = testCase.strictSwapped ?? expected;
        expect(caught(() => equal(testCase.b(), testCase.a())) === null).toBe(swapped);
        expect(caught(() => notEqual(testCase.b(), testCase.a())) === null).toBe(!swapped);
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
      expect(util.isDeepStrictEqual(testCase.b(), testCase.a())).toBe(testCase.strictSwapped ?? testCase.strict);
    });
  }

  test("never throws on exotic input", () => {
    expect(util.isDeepStrictEqual(undefined, undefined)).toBe(true);
    expect(util.isDeepStrictEqual(null, undefined)).toBe(false);
    expect(util.isDeepStrictEqual(Object.create(null), Object.create(null))).toBe(true);
  });

  // A Set or a Map is compared once, and not once per argument order: the second comparison doubled the work at each level of nesting.
  describe("compares a nested Map once", () => {
    let reads = 0;
    const leaf = () => ({
      get value() {
        reads++;
        return 1;
      },
    });
    const nested = (wrap: (value: unknown) => unknown) => {
      let value: unknown = leaf();
      for (let depth = 0; depth < 10; depth++) value = wrap(value);
      return value;
    };
    const stringKeyed = (value: unknown) => new Map([["k", value]]);
    const skipPrototype = new assert.Assert({ skipPrototype: true });

    test.each([
      ["util.isDeepStrictEqual", (a: unknown, b: unknown) => util.isDeepStrictEqual(a, b), 2],
      [
        "util.isDeepStrictEqual, skipPrototype",
        (a: unknown, b: unknown) => util.isDeepStrictEqual(a, b, true as any),
        2,
      ],
      ["assert.deepStrictEqual", (a: unknown, b: unknown) => assert.deepStrictEqual(a, b), 2],
      ["assert.strict.deepEqual", (a: unknown, b: unknown) => assert.strict.deepEqual(a, b), 2],
      ["Assert({ skipPrototype }).deepStrictEqual", (a: unknown, b: unknown) => skipPrototype.deepStrictEqual(a, b), 2],
      [
        "assert.throws with a validation object",
        (a: unknown, b: unknown) =>
          assert.throws(
            () => {
              throw Object.assign(new Error("x"), { data: a });
            },
            { data: b },
          ),
        2,
      ],
      // The third read is for the message of the AssertionError.
      [
        "assert.notDeepStrictEqual",
        (a: unknown, b: unknown) => expect(() => assert.notDeepStrictEqual(a, b)).toThrow(assert.AssertionError),
        3,
      ],
    ])("%s reads a value under 10 string-keyed Maps once per side", (_, compare, expectedReads) => {
      const a = nested(stringKeyed);
      const b = nested(stringKeyed);
      reads = 0;
      compare(a, b);
      expect(reads).toBe(expectedReads);
    });

    const symbolKey = Symbol("key");
    const sharedKey = { id: 1 };
    class Tagged extends Map {
      tag = 1;
    }
    test.each([
      ["one object member of a Set", (value: unknown) => new Set([value])],
      ["one object key that only one side holds", (value: unknown) => new Map([[{ id: 1 }, value]])],
      ["a number key", (value: unknown) => new Map([[1, value]])],
      ["a symbol key", (value: unknown) => new Map([[symbolKey, value]])],
      ["a null key", (value: unknown) => new Map([[null, value]])],
      ["an object key that both sides hold", (value: unknown) => new Map([[sharedKey, value]])],
      ["a subclass with a field", (value: unknown) => new Tagged([["k", value]])],
      ["an own string property", (value: unknown) => Object.assign(stringKeyed(value), { x: 1 })],
      ["an own symbol property", (value: unknown) => Object.assign(stringKeyed(value), { [symbolKey]: 1 })],
      ["an own index property", (value: unknown) => Object.assign(stringKeyed(value), { 0: 1 })],
      [
        "an own non-enumerable property",
        (value: unknown) => Object.defineProperty(stringKeyed(value), "hidden", { value: 1 }),
      ],
      [
        "an undefined value beside it",
        (value: unknown) =>
          new Map([
            ["k", value],
            ["u", undefined],
          ]),
      ],
    ])("10 nested collections with %s", (_, wrap) => {
      const a = nested(wrap);
      const b = nested(wrap);
      reads = 0;
      expect(util.isDeepStrictEqual(a, b)).toBe(true);
      expect(reads).toBe(2);
    });

    test("entries are read in the order of the right Map, left value first", () => {
      const log: string[] = [];
      const logged = (name: string) => ({
        get value() {
          log.push(name);
          return 1;
        },
      });
      const left = new Map([
        ["k1", logged("left k1")],
        ["k2", logged("left k2")],
      ]);
      const right = new Map([
        ["k2", logged("right k2")],
        ["k1", logged("right k1")],
      ]);
      expect(util.isDeepStrictEqual(left, right)).toBe(true);
      expect(log).toEqual(["left k2", "right k2", "left k1", "right k1"]);
    });

    test("a boxed String with an own property is converted once per side", () => {
      let calls = 0;
      const toString = function () {
        calls++;
        return "a";
      };
      const boxed = () => Object.assign(new String("a"), { toString });
      expect(util.isDeepStrictEqual(boxed(), boxed())).toBe(true);
      expect(calls).toBe(2);
    });

    test.each([
      ["at the top level", (map: unknown) => map],
      ["as a property", (map: unknown) => ({ map })],
      ["as an array element", (map: unknown) => [map]],
    ])("a Map that holds itself under a string key equals its copy, %s", (_, wrap) => {
      const selfHolding = () => {
        const map = new Map<string, unknown>();
        map.set("self", map);
        return wrap(map);
      };
      expect(util.isDeepStrictEqual(selfHolding(), selfHolding())).toBe(true);
      assert.deepStrictEqual(selfHolding(), selfHolding());
    });

    test("two Maps that hold each other equal their copies", () => {
      const pair = () => {
        const first = new Map<string, unknown>();
        const second = new Map<string, unknown>([["first", first]]);
        first.set("second", second);
        return first;
      };
      expect(util.isDeepStrictEqual(pair(), pair())).toBe(true);
    });

    test("a Set that holds itself equals its copy", () => {
      const selfHolding = () => {
        const set = new Set<unknown>();
        set.add(set);
        return set;
      };
      expect(util.isDeepStrictEqual(selfHolding(), selfHolding())).toBe(true);
    });
  });

  // left = Map { k1: leaf, k2: 1 } against an equal right Map. The first read of a leaf getter changes one of the Maps.
  // Each row holds node v26.3.0's answer and then bun's.
  describe("a getter that changes a Map during the comparison", () => {
    type Mutation = (
      left: Map<unknown, unknown> & { x?: number },
      right: Map<unknown, unknown> & { x?: number },
    ) => void;
    const scenarios: [string, Mutation, boolean, boolean][] = [
      ["the right Map gains a primitive key", (left, right) => right.set("k3", 3), false, false],
      // node made its list of the right keys that are objects before this walk.
      ["the right Map gains an object key", (left, right) => right.set({}, 3), true, false],
      ["the left Map gains a primitive key", (left, right) => left.set("k3", 3), true, true],
      ["the left Map loses the key that is not visited yet", (left, right) => left.delete("k2"), false, false],
      ["the right Map loses the key that is not visited yet", (left, right) => right.delete("k2"), true, true],
      ["the left Map is cleared", (left, right) => left.clear(), false, false],
      ["the right Map is cleared", (left, right) => right.clear(), true, true],
      ["both Maps are cleared", (left, right) => (left.clear(), right.clear()), true, true],
      [
        "the right Map swaps the key under comparison",
        (left, right) => (right.delete("k1"), right.set("k9", 9)),
        false,
        false,
      ],
      [
        "the right Map swaps the key that is not visited yet",
        (left, right) => (right.delete("k2"), right.set("k9", 1)),
        false,
        false,
      ],
      [
        "the left Map swaps the key under comparison",
        (left, right) => (left.delete("k1"), left.set("k9", 9)),
        true,
        true,
      ],
      [
        "the left Map swaps the key that is not visited yet",
        (left, right) => (left.delete("k2"), left.set("k9", 1)),
        false,
        false,
      ],
      ["the value that is not visited yet changes on the right", (left, right) => right.set("k2", 2), false, false],
      ["the value that is not visited yet changes on the left", (left, right) => left.set("k2", 2), false, false],
      ["the value under comparison is overwritten on the right", (left, right) => right.set("k1", 7), true, true],
      ["the value under comparison is overwritten on the left", (left, right) => left.set("k1", 7), true, true],
      // node compares the own properties before the entries.
      ["the left Map gains an own property", (left, right) => void (left.x = 1), true, false],
      ["the right Map gains an own property", (left, right) => void (right.x = 1), true, false],
    ];
    // left = Map { k0: 1, k1: leaf, k2: 1 }: k0 is compared before the getter runs.
    const scenariosAfterFirstKey: [string, Mutation, boolean, boolean][] = [
      [
        "the right Map swaps the key that is compared already",
        (left, right) => (right.delete("k0"), right.set("k9", 1)),
        false,
        false,
      ],
      [
        "the left Map swaps the key that is compared already",
        (left, right) => (left.delete("k0"), left.set("k9", 1)),
        true,
        true,
      ],
      [
        "the value that is compared already is overwritten on the right",
        (left, right) => right.set("k0", 2),
        true,
        true,
      ],
      ["the value that is compared already is overwritten on the left", (left, right) => left.set("k0", 2), true, true],
      ["the right Map loses the key that is compared already", (left, right) => right.delete("k0"), true, true],
      ["the left Map loses the key that is compared already", (left, right) => left.delete("k0"), true, true],
    ];
    function compareWith(mutate: Mutation, entriesBefore: [string, number][]) {
      let mutated = false;
      const leaf = () => ({
        get value() {
          if (!mutated) {
            mutated = true;
            mutate(left, right);
          }
          return 1;
        },
      });
      const make = () => new Map<unknown, unknown>([...entriesBefore, ["k1", leaf()], ["k2", 1]]);
      const left = make();
      const right = make();
      return util.isDeepStrictEqual(left, right);
    }
    test.each(scenarios)("%s", (_, mutate, _node, bun) => {
      expect(compareWith(mutate, [])).toBe(bun);
    });
    test.each(scenariosAfterFirstKey)("%s", (_, mutate, _node, bun) => {
      expect(compareWith(mutate, [["k0", 1]])).toBe(bun);
    });
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
      expect(util.isDeepStrictEqual(new S("a"), new String("a"))).toBe(false);
      expect(util.isDeepStrictEqual(new String("a"), new S("a"), true as any)).toBe(true);
      expect(util.isDeepStrictEqual(new S("a"), new String("a"), true as any)).toBe(true);
    });

    test.each([
      ["Set", () => new Set([{ a: 1 }, { a: 1 }]), () => new Set([{ a: 1 }, { a: 2 }])],
      [
        "Map",
        () =>
          new Map([
            [{ a: 1 }, 1],
            [{ a: 1 }, 1],
          ]),
        () =>
          new Map([
            [{ a: 1 }, 1],
            [{ a: 2 }, 1],
          ]),
      ],
    ])(
      "a %s with two deep-equal entries is not equal to one with two different entries, in both argument orders",
      (_, a, b) => {
        expect(util.isDeepStrictEqual(a(), b(), true as any)).toBe(false);
        expect(util.isDeepStrictEqual(b(), a(), true as any)).toBe(false);
      },
    );

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
