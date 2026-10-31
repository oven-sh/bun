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
const sharedSetMember = ["x"];
const errorWithEnumerableCode = () => Object.assign(new Error("x"), { code: 1 });
const errorWithHiddenCode = () =>
  Object.defineProperty(Object.assign(new Error("x"), { other: 2 }), "code", { value: 1, enumerable: false });
function outOfRangeError() {
  try {
    Buffer.alloc(-1);
  } catch (error) {
    return error as RangeError;
  }
}
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
  // Each error enumerates a key that the other one does not enumerate.
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
    name: "errors that each enumerate one key and hold the key of the other one non-enumerable with another value",
    a: () => Object.defineProperty(Object.assign(new Error("x"), { a: 1 }), "b", { value: 2, enumerable: false }),
    b: () => Object.defineProperty(Object.assign(new Error("x"), { b: 3 }), "a", { value: 1, enumerable: false }),
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },
  {
    name: "an error that bun creates with a code and an error with its class and message",
    a: outOfRangeError,
    b: () => new RangeError(outOfRangeError()!.message),
    strict: false,
    loose: false,
  },
  {
    name: "sets holding such errors, one each",
    a: () => new Set([outOfRangeError()]),
    b: () => new Set([new RangeError(outOfRangeError()!.message)]),
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
  // node pairs each entry that the other side does not hold with an entry of its own.
  {
    name: "sets holding deep-equal objects in another order",
    a: () => new Set([{ a: 1 }, { a: 2 }, { a: 3 }]),
    b: () => new Set([{ a: 3 }, { a: 1 }, { a: 2 }]),
    strict: true,
    loose: true,
  },
  {
    name: "sets holding deep-equal objects in different counts",
    a: () => new Set([{ a: 1 }, { a: 1 }, { a: 2 }]),
    b: () => new Set([{ a: 1 }, { a: 2 }, { a: 2 }]),
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },
  // https://github.com/nodejs/node/issues/53423
  {
    name: "sets holding the same array and a deep-equal array",
    a: () => new Set([sharedSetMember, ["y"]]),
    b: () => new Set([sharedSetMember, ["y"]]),
    strict: true,
    loose: true,
  },
  // https://github.com/oven-sh/bun/issues/34830
  {
    name: "maps keyed by deep-equal objects with different values",
    a: () =>
      new Map([
        [/a/, "x"],
        [/a/, "y"],
      ]),
    b: () =>
      new Map([
        [/a/, "x"],
        [/a/, "y"],
      ]),
    strict: true,
    loose: true,
    looseBug: "reports not equal",
  },
  {
    name: "maps keyed by deep-equal objects with the values in the other order",
    a: () =>
      new Map([
        [{ k: 1 }, "x"],
        [{ k: 1 }, "y"],
      ]),
    b: () =>
      new Map([
        [{ k: 1 }, "y"],
        [{ k: 1 }, "x"],
      ]),
    strict: true,
    loose: true,
    looseBug: "reports not equal",
  },
  {
    name: "maps keyed by deep-equal objects with the values in different counts",
    a: () =>
      new Map([
        [{ k: 1 }, "x"],
        [{ k: 1 }, "x"],
        [{ k: 1 }, "y"],
      ]),
    b: () =>
      new Map([
        [{ k: 1 }, "x"],
        [{ k: 1 }, "y"],
        [{ k: 1 }, "y"],
      ]),
    strict: false,
    loose: false,
  },
  // bun 1.4.0 to 1.4.3 report the next pair as not equal.
  {
    name: "maps holding a shared key and a deep-equal key in the other order",
    a: () =>
      new Map([
        [sharedObject, "x"],
        [{ a: 1 }, "y"],
      ]),
    b: () =>
      new Map([
        [{ a: 1 }, "y"],
        [sharedObject, "x"],
      ]),
    strict: true,
    loose: true,
  },
  // Each member that only one side holds is deep-equal to a member that both sides hold.
  {
    name: "sets whose unshared members are copies of two different shared members",
    a: () => new Set([{ a: 1 }, sharedObject, sharedSetMember]),
    b: () => new Set([["x"], sharedObject, sharedSetMember]),
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },
  {
    name: "maps keyed by a shared object and copies of it in different counts",
    a: () =>
      new Map([
        [sharedObject, "z"],
        [{ a: 1 }, "v"],
        [{ a: 1 }, "v"],
        [{ a: 2 }, "w"],
      ]),
    b: () =>
      new Map([
        [sharedObject, "z"],
        [{ a: 1 }, "v"],
        [{ a: 2 }, "w"],
        [{ a: 2 }, "w"],
      ]),
    strict: false,
    loose: false,
  },
  // node pairs a key that both maps hold like any other key.
  {
    name: "maps holding swapped values under a shared key and a deep-equal key",
    a: () =>
      new Map([
        [sharedObject, 1],
        [{ a: 1 }, 2],
      ]),
    b: () =>
      new Map([
        [sharedObject, 2],
        [{ a: 1 }, 1],
      ]),
    strict: true,
    loose: true,
    looseBug: "reports not equal",
  },
  {
    name: "maps holding unequal values under the same number key",
    a: () =>
      new Map([
        [1, { a: 1 }],
        [{ k: 1 }, 1],
      ]),
    b: () =>
      new Map([
        [1, { a: 2 }],
        [{ k: 1 }, 1],
      ]),
    strict: false,
    loose: false,
  },
  {
    name: "a set with an extra own property, after its members pair off",
    a: () => withExtraProperty(new Set([{ a: 1 }, { a: 2 }])),
    b: () => new Set([{ a: 2 }, { a: 1 }]),
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },
  {
    name: "sets whose members pair off, with equal extra own properties",
    a: () => withExtraProperty(new Set([{ a: 1 }, { a: 2 }])),
    b: () => withExtraProperty(new Set([{ a: 2 }, { a: 1 }])),
    strict: true,
    loose: true,
  },
  {
    name: "sets whose members pair off, with unequal own index properties",
    a: () => Object.assign(new Set([{ a: 1 }, { a: 2 }]), { 0: 1 }),
    b: () => Object.assign(new Set([{ a: 2 }, { a: 1 }]), { 0: 2 }),
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },
  {
    name: "a map with an extra own property, after its entries pair off",
    a: () =>
      new Map([
        [{ a: 1 }, 1],
        [{ a: 2 }, 2],
      ]),
    b: () =>
      withExtraProperty(
        new Map([
          [{ a: 2 }, 2],
          [{ a: 1 }, 1],
        ]),
      ),
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },
  {
    name: "maps whose entries pair off, with equal own index properties",
    a: () =>
      Object.assign(
        new Map([
          [{ a: 1 }, 1],
          [{ a: 2 }, 2],
        ]),
        { 0: 1 },
      ),
    b: () =>
      Object.assign(
        new Map([
          [{ a: 2 }, 2],
          [{ a: 1 }, 1],
        ]),
        { 0: 1 },
      ),
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

    const symbolKey = Symbol("key");
    const sharedKey = { id: 1 };
    class Tagged extends Map {
      tag = 1;
    }
    const wraps: [string, (value: unknown) => unknown][] = [
      ["a string key", stringKeyed],
      ["one object member of a Set", value => new Set([value])],
      ["one object key that only one side holds", value => new Map([[{ id: 1 }, value]])],
      ["a number key", value => new Map([[1, value]])],
      ["a symbol key", value => new Map([[symbolKey, value]])],
      ["a null key", value => new Map([[null, value]])],
      ["an object key that both sides hold", value => new Map([[sharedKey, value]])],
      ["a subclass with a field", value => new Tagged([["k", value]])],
      ["an own string property", value => Object.assign(stringKeyed(value), { x: 1 })],
      ["an own symbol property", value => Object.assign(stringKeyed(value), { [symbolKey]: 1 })],
      ["an own index property", value => Object.assign(stringKeyed(value), { 0: 1 })],
      ["an own non-enumerable property", value => Object.defineProperty(stringKeyed(value), "hidden", { value: 1 })],
      [
        "an undefined value beside it",
        value =>
          new Map([
            ["k", value],
            ["u", undefined],
          ]),
      ],
      ["a Set member beside another object", value => new Set([value, { other: 1 }])],
      [
        "a string key beside two object keys that only one side holds",
        value =>
          new Map<unknown, unknown>([
            ["data", value],
            [{ id: 1 }, 1],
            [{ id: 2 }, 2],
          ]),
      ],
    ];

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
    ])("%s reads a value under 10 nested collections once per side", (_, compare, expectedReads) => {
      const wrong: string[] = [];
      for (const [name, wrap] of wraps) {
        const a = nested(wrap);
        const b = nested(wrap);
        reads = 0;
        compare(a, b);
        if (reads !== expectedReads) wrong.push(`${name}: ${reads} reads`);
      }
      expect(wrong).toEqual([]);
    });

    test("reads an enumerable property of an Error once per side", () => {
      const make = () => Object.assign(new Error("m"), { data: leaf() });
      reads = 0;
      expect(util.isDeepStrictEqual(make(), make())).toBe(true);
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
  });

  // A cycle that runs only through the entries of a Map or a Set. bun 1.4.0 to 1.4.3 throw a RangeError on each row.
  describe("a Map or a Set that holds itself equals its copy", () => {
    const selfHoldingMap = () => {
      const map = new Map<unknown, unknown>();
      return map.set("self", map);
    };
    test.each<[string, Thunk]>([
      // The first three are the "Circular references" inputs of node's test/parallel/test-assert-deep.js.
      [
        "a Set that holds itself",
        () => {
          const set = new Set<unknown>();
          return set.add(set);
        },
      ],
      [
        "a Map that holds itself under a number key",
        () => {
          const map = new Map<unknown, unknown>();
          return map.set(2, map);
        },
      ],
      [
        "a Map keyed by itself",
        () => {
          const map = new Map<unknown, unknown>();
          return map.set(map, 2);
        },
      ],
      [
        "a Set that holds itself and an object",
        () => {
          const set = new Set<unknown>();
          return set.add(set).add({ x: 1 });
        },
      ],
      [
        "a Map keyed by itself and by an object",
        () => {
          const map = new Map<unknown, unknown>();
          return map.set(map, 2).set({}, 1);
        },
      ],
      [
        "a Map that holds itself beside two object keys",
        () => {
          const map = new Map<unknown, unknown>();
          return map.set("self", map).set({ id: 1 }, 1).set({ id: 2 }, 2);
        },
      ],
      [
        "two Maps that hold each other",
        () => {
          const first = new Map<string, unknown>();
          const second = new Map<string, unknown>([["first", first]]);
          return first.set("second", second);
        },
      ],
      [
        "two Sets that hold each other",
        () => {
          const first = new Set<unknown>();
          return first.add(new Set([first]));
        },
      ],
      [
        "a Map and a Set that hold each other",
        () => {
          const map = new Map<string, unknown>();
          return map.set("set", new Set([map]));
        },
      ],
      ["a Map that holds itself, as a property", () => ({ map: selfHoldingMap() })],
      ["a Map that holds itself, as an array element", () => [selfHoldingMap()]],
    ])("%s", (_, make) => {
      expect(util.isDeepStrictEqual(make(), make())).toBe(true);
      expect(util.isDeepStrictEqual(make(), make(), true as any)).toBe(true);
      assert.deepStrictEqual(make(), make());
      expect(() => assert.notDeepStrictEqual(make(), make())).toThrow(assert.AssertionError);
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
      // No left entry is left to pair with the new key.
      ["the right Map gains an object key", (left, right) => right.set({}, 3), true, true],
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

  // node pairs every Set member and Map entry that the other side does not hold with an entry of its own (setObjectEquiv and mapObjectEquiv in lib/internal/util/comparisons.js).
  describe("pairs Set members and Map entries one-to-one", () => {
    const skipPrototype = new assert.Assert({ skipPrototype: true });
    const passes = (assertion: () => void) => {
      const error = caught(assertion);
      if (error !== null && error.code !== "ERR_ASSERTION") throw error;
      return error === null;
    };
    const entryPoints: [string, (a: unknown, b: unknown) => boolean][] = [
      ["util.isDeepStrictEqual", (a, b) => util.isDeepStrictEqual(a, b)],
      ["util.isDeepStrictEqual, skipPrototype", (a, b) => util.isDeepStrictEqual(a, b, true as any)],
      ["assert.deepStrictEqual", (a, b) => passes(() => assert.deepStrictEqual(a, b))],
      ["Assert({ skipPrototype }).deepStrictEqual", (a, b) => passes(() => skipPrototype.deepStrictEqual(a, b))],
    ];
    const shared = { a: 1 };
    const set = (...members: unknown[]) => new Set(members);
    const map = (...entries: [unknown, unknown][]) => new Map(entries);

    const pairs: [string, Thunk, Thunk, boolean][] = [
      [
        "Set members in another order",
        () => set({ a: 1 }, { a: 2 }, { a: 3 }),
        () => set({ a: 3 }, { a: 1 }, { a: 2 }),
        true,
      ],
      [
        "Set members in different counts",
        () => set({ a: 1 }, { a: 1 }, { a: 2 }),
        () => set({ a: 1 }, { a: 2 }, { a: 2 }),
        false,
      ],
      [
        "a Set member that both sides hold, beside a copy of it",
        () => set(shared, { a: 1 }, { b: 1 }),
        () => set(shared, { a: 1 }, { b: 1 }),
        true,
      ],
      [
        "a Set member that both sides hold, beside a copy of it on one side only",
        () => set(shared, { a: 2 }, 1),
        () => set(shared, { a: 1 }, 1),
        false,
      ],
      [
        "a Set with a number that the other side does not hold",
        () => set(1, { a: 1 }, { b: 1 }),
        () => set({ a: 1 }, { b: 1 }, { c: 1 }),
        false,
      ],
      [
        "a Set of numbers and a Set of boxed numbers",
        () => set(1, 2, 3),
        () => set(new Number(1), new Number(2), new Number(3)),
        false,
      ],
      [
        "Map keys with the values in the other order",
        () => map([{ k: 1 }, "x"], [{ k: 1 }, "y"], [{ k: 2 }, "z"]),
        () => map([{ k: 2 }, "z"], [{ k: 1 }, "y"], [{ k: 1 }, "x"]),
        true,
      ],
      [
        "Map keys with the values in different counts",
        () => map([{ k: 1 }, "x"], [{ k: 1 }, "x"], [{ k: 1 }, "y"]),
        () => map([{ k: 1 }, "x"], [{ k: 1 }, "y"], [{ k: 1 }, "y"]),
        false,
      ],
      [
        "a Map key that both sides hold with different values",
        () => map([shared, 1], ["a", 1], ["b", 2]),
        () => map([shared, 2], ["a", 1], ["b", 2]),
        false,
      ],
      [
        "a Map key that both sides hold, with its value under a deep-equal key on the other side",
        () => map([shared, 1], [{ a: 1 }, 2], ["p", 0]),
        () => map([shared, 2], [{ a: 1 }, 1], ["p", 0]),
        true,
      ],
      [
        "the same, with the deep-equal key first",
        () => map([{ a: 1 }, 2], [shared, 1]),
        () => map([{ a: 1 }, 1], [shared, 2]),
        true,
      ],
      [
        "a Map key that both sides hold, with a partner for its right value only",
        () => map([shared, 1], [{ a: 1 }, 2], ["p", 0]),
        () => map([shared, 2], [{ a: 1 }, 3], ["p", 0]),
        false,
      ],
      [
        "a Map key that both sides hold with different values, after an equal entry",
        () => map([{ a: 1 }, 1], [shared, 1]),
        () => map([{ a: 1 }, 1], [shared, 2]),
        false,
      ],
      [
        "a Map key that both sides hold, beside a copy of it on one side only",
        () => map([shared, 1], [{ a: 2 }, 1]),
        () => map([shared, 1], [{ a: 1 }, 1]),
        false,
      ],
      [
        "a Map with a string key that the other side does not hold",
        () => map(["p", 1], [{ k: 1 }, 1]),
        () => map(["q", 1], [{ k: 1 }, 1]),
        false,
      ],
      [
        "a Map with a number key and a Map of object keys",
        () => map([1, 1], [{ a: 1 }, 1], [{ b: 1 }, 1]),
        () => map([{ a: 1 }, 1], [{ b: 1 }, 1], [{ c: 1 }, 1]),
        false,
      ],
      [
        "an undefined value under an object key",
        () => map([{ a: 1 }, undefined], [{ a: 2 }, 1]),
        () => map([{ a: 2 }, 1], [{ a: 1 }, undefined]),
        true,
      ],
      [
        "an undefined value under an object key that only one side holds",
        () => map([{ a: 1 }, undefined], [{ a: 2 }, 1]),
        () => map([{ a: 2 }, 1], [{ a: 3 }, undefined]),
        false,
      ],
    ];
    describe.each(entryPoints)("%s", (_, equal) => {
      test.each(pairs)("%s", (_, a, b, expected) => {
        expect([equal(a(), b()), equal(b(), a())]).toEqual([expected, expected]);
      });
    });

    // node v26.3.0 gives another answer on each of these rows.
    describe("where node v26.3.0 differs", () => {
      // Its shortcut for Sets of fewer than three members (compareSmallSets) compares the member that both sides hold with the copy.
      test("a two-member Set pairs a member that both sides hold with itself", () => {
        expect(util.isDeepStrictEqual(set(shared, { a: 1 }), set(shared, { a: 1 }))).toBe(true);
      });

      // The same shortcut reads past the end of the other Set and compares undefined with undefined.
      test("a two-member Set does not pair undefined with an object", () => {
        expect(util.isDeepStrictEqual(set(shared, undefined), set(shared, { a: 1 }))).toBe(false);
        expect(util.isDeepStrictEqual(set(shared, { a: 1 }), set(shared, undefined))).toBe(false);
      });

      // node throws a TypeError in one argument order (nodejs/node#64433, fixed in v26.10.0).
      test.each([
        ["a Set", () => set(null, { a: 1 }, { b: 1 }), () => set({ a: 1 }, { b: 1 }, { c: 1 })],
        ["a Set", () => set(undefined, shared, { b: 1 }), () => set(shared, { b: 1 }, { c: 1 })],
        [
          "a Map",
          () => map([null, 1], [{ a: 1 }, 1], [{ b: 1 }, 1]),
          () => map([{ a: 1 }, 1], [{ b: 1 }, 1], [{ c: 1 }, 1]),
        ],
      ])("%s with a null or undefined entry and one of objects only are not equal", (_, a, b) => {
        expect([util.isDeepStrictEqual(a(), b()), util.isDeepStrictEqual(b(), a())]).toEqual([false, false]);
      });

      // node compares a key that both Maps hold structurally, and to it a Promise or a WeakMap equals nothing.
      test("a Map key that both sides hold equals itself", () => {
        const promise = Promise.resolve();
        const weakMap = new WeakMap();
        const make = () => map([promise, 1], [weakMap, 2]);
        expect(util.isDeepStrictEqual(make(), make())).toBe(true);
      });
    });

    // To node a callable value is not an object, so it equals only itself.
    test("a callable entry equals only itself", () => {
      const callable = () => new Proxy(function () {}, {});
      const sharedCallable = callable();
      expect(util.isDeepStrictEqual(set(callable(), { a: 1 }, { a: 2 }), set(callable(), { a: 2 }, { a: 1 }))).toBe(
        false,
      );
      expect(
        util.isDeepStrictEqual(set(sharedCallable, { a: 1 }, { a: 2 }), set(sharedCallable, { a: 2 }, { a: 1 })),
      ).toBe(true);
      expect(util.isDeepStrictEqual(map([callable(), 1], [{ a: 1 }, 2]), map([callable(), 1], [{ a: 1 }, 2]))).toBe(
        false,
      );
    });

    // node probes the first open entry, then the last one, then the rest from the back. Entries in the same order or in the reverse order cost one comparison each, and the counts below are node's.
    describe.each([
      ["Set members", (ids: number[], entry: (id: number) => object) => new Set(ids.map(entry))],
      ["Map keys", (ids: number[], entry: (id: number) => object) => new Map(ids.map(id => [entry(id), id]))],
      [
        "Map values under deep-equal keys",
        (ids: number[], entry: (id: number) => object) => new Map(ids.map(id => [{ k: 1 }, entry(id)])),
      ],
    ])("%s", (_, make) => {
      test.each([
        ["in the same order", (ids: number[]) => ids, (n: number) => 2 * n],
        ["in the reverse order", (ids: number[]) => ids.toReversed(), (n: number) => 2 * n + 2],
        ["rotated by one", (ids: number[]) => [...ids.slice(1), ids[0]], (n: number) => (n * n) / 2 + 2 * n],
      ])("%s", (_, permute, expectedReads) => {
        for (const n of [4, 64]) {
          let reads = 0;
          const entry = (id: number) => ({
            get id() {
              reads++;
              return id;
            },
          });
          const ids = Array.from({ length: n }, (_, i) => i);
          const a = make(ids, entry);
          const b = make(permute(ids), entry);
          reads = 0;
          expect(util.isDeepStrictEqual(a, b)).toBe(true);
          expect(reads).toBe(expectedReads(n));
        }
      });
    });

    // An entry that can have no partner ends the comparison before any other entry is compared.
    describe("reads no entry after one that can have no partner", () => {
      let reads = 0;
      const counted = (id: number) => ({
        get id() {
          reads++;
          return id;
        },
      });

      test("a number that only the right Set holds", () => {
        const left = set(counted(1), counted(2), counted(3));
        const right = set(0, counted(1), counted(2));
        reads = 0;
        expect(util.isDeepStrictEqual(left, right)).toBe(false);
        expect(reads).toBe(0);
      });

      test("a string key that only the right Map holds", () => {
        const left = map([counted(1), 1], [counted(2), 2], [counted(3), 3]);
        const right = map(["p", 0], [counted(1), 1], [counted(2), 2]);
        reads = 0;
        expect(util.isDeepStrictEqual(left, right)).toBe(false);
        expect(reads).toBe(0);
      });

      // The left entry under the deep-equal key holds another value, so the first right entry has no partner.
      test("a Map key that both sides hold with different values, beside a deep-equal key", () => {
        const later = { k: 1 };
        const left = map([shared, 1], [{ a: 1 }, 3], [later, counted(1)]);
        const right = map([shared, 2], [{ a: 1 }, 3], [later, counted(1)]);
        reads = 0;
        expect(util.isDeepStrictEqual(left, right)).toBe(false);
        expect(reads).toBe(0);
      });

      // Another left entry holds the right value, but under a key that is not equal.
      test("a Map key that both sides hold with different numbers, beside an entry with the other number", () => {
        const later = { k: 1 };
        const left = map([shared, 1], [{ b: 1 }, 2], [later, counted(1)]);
        const right = map([shared, 2], [{ b: 1 }, 2], [later, counted(1)]);
        reads = 0;
        expect(util.isDeepStrictEqual(left, right)).toBe(false);
        expect(reads).toBe(0);
      });

      // Another left entry has an equal key, but its value is not equal to the right value.
      test("a Map key that both sides hold with different objects, beside a deep-equal key", () => {
        const later = { k: 1 };
        const left = map([shared, { x: 1 }], [{ a: 1 }, { x: 3 }], [later, counted(1)]);
        const right = map([shared, { x: 2 }], [{ a: 1 }, { x: 3 }], [later, counted(1)]);
        reads = 0;
        expect(util.isDeepStrictEqual(left, right)).toBe(false);
        expect(reads).toBe(0);
      });

      // The other entries hold identical values on both sides, as in a Map and its changed copy. They are no partners, so their keys are not compared.
      test("a Map and a copy with one other value", () => {
        const keys = [{ k: 0 }, counted(1), counted(2)];
        const values = [{ x: 0 }, { x: 1 }, { x: 2 }];
        const left = map([keys[0], values[0]], [keys[1], values[1]], [keys[2], values[2]]);
        const right = new Map(left).set(keys[0], { x: 9 });
        reads = 0;
        expect(util.isDeepStrictEqual(left, right)).toBe(false);
        expect(util.isDeepStrictEqual(right, left)).toBe(false);
        expect(reads).toBe(0);
      });

      // No other left entry holds the right value, so no key is compared.
      test("a Map key that both sides hold with different numbers", () => {
        const left = map([shared, 1], [counted(1), 3], [counted(2), 4]);
        const right = map([shared, 2], [counted(1), 3], [counted(2), 4]);
        reads = 0;
        expect(util.isDeepStrictEqual(left, right)).toBe(false);
        expect(reads).toBe(0);
      });

      // Only the two values under the first key are compared: no other left key equals that key.
      test("a Map key that both sides hold with different values", () => {
        const keys = [{ k: 0 }, { k: 1 }, { k: 2 }];
        const left = map([keys[0], counted(1)], [keys[1], counted(2)], [keys[2], counted(3)]);
        const right = map([keys[0], counted(9)], [keys[1], counted(2)], [keys[2], counted(3)]);
        reads = 0;
        expect(util.isDeepStrictEqual(left, right)).toBe(false);
        expect(reads).toBe(2);
      });
    });

    test.each([
      ["plain", (collection: Set<unknown> | Map<unknown, unknown>) => collection],
      ["with an own property", withExtraProperty],
    ])("reads a value nested in %s Sets and Maps once per side", (_, decorate) => {
      let reads = 0;
      const make = () => {
        let value: unknown = {
          get leaf() {
            reads++;
            return 1;
          },
        };
        for (let depth = 0; depth < 4; depth++) value = decorate(new Map([[decorate(new Set([value])), "as key"]]));
        for (let depth = 0; depth < 4; depth++) value = decorate(new Map([["as value", decorate(new Set([value]))]]));
        return value;
      };
      expect(util.isDeepStrictEqual(make(), make())).toBe(true);
      expect(reads).toBe(2);
    });

    // The answer is "a one-to-one pairing of the entries exists". Sets and Maps from a fixed seed check that against a search over every pairing.
    test.each(["Set", "Map"] as const)("random %ss get the answer of a search over every pairing", kind => {
      let state = kind === "Set" ? 0x5e7 : 0x3a9;
      const random = () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const held = [{ a: 1 }, { a: 2 }, [1], new Set([{ a: 1 }])];
      const pool: Thunk[] = [
        () => 1,
        () => "a",
        () => null,
        () => undefined,
        () => ({ a: 1 }),
        () => ({ a: 2 }),
        () => ({ a: 1, b: undefined }),
        () => ({}),
        () => [1],
        () => [],
        () => new Date(0),
        () => new Number(1),
        () => new Set([{ a: 1 }]),
        () => new Set([{ a: 1 }, { a: 2 }]),
        () => new Set([{ a: 2 }, { a: 1 }]),
        () => new Map([[{ a: 1 }, 1]]),
      ];
      const pick = () =>
        random() < 0.3 ? held[Math.floor(random() * held.length)] : pool[Math.floor(random() * pool.length)]();
      const entries = (size: number) => {
        const made = new Map<unknown, unknown>();
        for (let tries = 0; made.size < size && tries < 40; tries++)
          made.set(pick(), kind === "Map" ? pick() : undefined);
        return [...made];
      };
      const shuffled = <T>(list: T[]) => {
        for (let i = list.length - 1; i > 0; i--) {
          const j = Math.floor(random() * (i + 1));
          [list[i], list[j]] = [list[j], list[i]];
        }
        return list;
      };
      const build = (list: [unknown, unknown][]) =>
        kind === "Map" ? new Map(list) : new Set(list.map(([key]) => key));
      const same = (a: unknown, b: unknown) => Object.is(a, b) || util.isDeepStrictEqual(a, b);
      // Whether every left entry can take a right entry of its own (augmenting paths).
      const pairingExists = (left: [unknown, unknown][], right: [unknown, unknown][]) => {
        if (left.length !== right.length) return false;
        const equal = left.map(([key, value]) =>
          right.map(([rightKey, rightValue]) => same(key, rightKey) && same(value, rightValue)),
        );
        const takenBy = new Array<number>(right.length).fill(-1);
        const take = (i: number, seen: boolean[]): boolean => {
          for (let j = 0; j < right.length; j++) {
            if (seen[j] || !equal[i][j]) continue;
            seen[j] = true;
            if (takenBy[j] < 0 || take(takenBy[j], seen)) {
              takenBy[j] = i;
              return true;
            }
          }
          return false;
        };
        return left.every((_, i) => take(i, new Array<boolean>(right.length).fill(false)));
      };

      const wrong: string[] = [];
      for (let round = 0; round < 120; round++) {
        const left = entries(1 + Math.floor(random() * 5));
        // Half of the rounds compare against a copy in another order, so that equal pairs are common.
        const right = random() < 0.5 ? entries(left.length) : shuffled(left.map(entry => structuredClone(entry)));
        for (const [a, b] of [
          [left, right],
          [right, left],
        ]) {
          const expected = pairingExists(a, b);
          if (util.isDeepStrictEqual(build(a), build(b)) !== expected)
            wrong.push(`round ${round}: expected ${expected}`);
        }
      }
      expect(wrong).toEqual([]);
    });

    // The first left entry has a getter. It runs in the first comparison of the pairing and changes one of the two collections.
    // Each row holds node v26.3.0's answer and then bun's. Where node throws a TypeError, it reads past the end of its list of right entries. There bun answers whether the right collection holds every left entry that has no partner yet.
    describe("a getter that changes a collection during the pairing", () => {
      type Collection = Set<unknown> & Map<unknown, unknown>;
      type Mutation = (left: Collection, right: Collection) => void;
      const last = (collection: Collection) => [...collection.keys()].at(-1);
      const setScenarios: [string, Mutation, boolean | "TypeError", boolean][] = [
        // The right members are reachable only through the copy that the pairing made.
        ["the right Set is cleared", (left, right) => (right.clear(), Bun.gc(true)), true, true],
        ["the right Set gains an object", (left, right) => right.add({ id: 9 }), true, true],
        ["the right Set gains a number", (left, right) => right.add(9), true, true],
        ["the right Set loses its last member", (left, right) => right.delete(last(right)), true, true],
        ["the right Set gains a member of the left Set", (left, right) => right.add(last(left)), true, true],
        ["the left Set is cleared", (left, right) => left.clear(), true, true],
        ["the left Set loses its last member", (left, right) => left.delete(last(left)), true, true],
        ["the left Set gains an object", (left, right) => left.add({ id: 9 }), "TypeError", false],
        ["the left Set gains a number", (left, right) => left.add(9), "TypeError", false],
        ["the left Set gains a copy of a right member", (left, right) => left.add({ id: 1 }), "TypeError", false],
        ["the left Set gains a member of the right Set", (left, right) => left.add(last(right)), "TypeError", true],
      ];
      const mapScenarios: [string, Mutation, boolean | "TypeError", boolean][] = [
        // node reads a right value when it compares the entry, so a cleared Map answers undefined.
        ["the right Map is cleared", (left, right) => (right.clear(), Bun.gc(true)), false, false],
        ["the right Map gains an object key", (left, right) => right.set({ id: 9 }, 9), true, true],
        ["the right Map gains a string key", (left, right) => right.set("p", 9), true, true],
        ["the right Map loses its last key", (left, right) => right.delete(last(right)), false, false],
        ["the right Map changes the value of its last key", (left, right) => right.set(last(right), 99), false, false],
        ["the right Map gains a key of the left Map", (left, right) => right.set(last(left), 1), true, true],
        ["the left Map is cleared", (left, right) => left.clear(), true, true],
        ["the left Map loses its last key", (left, right) => left.delete(last(left)), true, true],
        ["the left Map changes the value of its last key", (left, right) => left.set(last(left), 99), false, false],
        ["the left Map gains an object key", (left, right) => left.set({ id: 9 }, 9), "TypeError", false],
        ["the left Map gains a string key", (left, right) => left.set("p", 9), "TypeError", false],
        ["the left Map gains a key of the right Map", (left, right) => left.set(last(right), 1), "TypeError", true],
      ];
      function compareWith(kind: "Set" | "Map", mutate: Mutation) {
        let mutated = false;
        const left = (kind === "Set" ? new Set() : new Map()) as Collection;
        const right = (kind === "Set" ? new Set() : new Map()) as Collection;
        const add = (collection: Collection, member: object, id: number) =>
          kind === "Set" ? collection.add(member) : collection.set(member, id);
        add(
          left,
          {
            get id() {
              if (!mutated) {
                mutated = true;
                mutate(left, right);
              }
              return 0;
            },
          },
          0,
        );
        for (const id of [1, 2]) add(left, { id }, id);
        for (const id of [0, 1, 2]) add(right, { id }, id);
        return util.isDeepStrictEqual(left, right);
      }
      test.each(setScenarios)("%s", (_, mutate, _node, bun) => {
        expect(compareWith("Set", mutate)).toBe(bun);
      });
      test.each(mapScenarios)("%s", (_, mutate, _node, bun) => {
        expect(compareWith("Map", mutate)).toBe(bun);
      });

      // node compares a one-entry Map and a Set of fewer than three members with shortcuts, and they read the size that the getter changed.
      test.each<[string, () => boolean, boolean, boolean]>([
        [
          "a one-entry Map whose right side gains an object key while the values are compared",
          () => {
            let mutated = false;
            const leaf = () => ({
              get value() {
                if (!mutated) {
                  mutated = true;
                  right.set({}, 3);
                }
                return 1;
              },
            });
            const left = map(["k1", leaf()]);
            const right = map(["k1", leaf()]);
            return util.isDeepStrictEqual(left, right);
          },
          false,
          true,
        ],
        [
          "a one-member Set whose right side gains an object",
          () => {
            let mutated = false;
            const right = set({ id: 0 });
            const left = set({
              get id() {
                if (!mutated) {
                  mutated = true;
                  right.add({ id: 9 });
                }
                return 0;
              },
            });
            return util.isDeepStrictEqual(left, right);
          },
          false,
          true,
        ],
      ])("%s", (_, compare, _node, bun) => {
        expect(compare()).toBe(bun);
      });

      // node reads the right value with `get()` when it compares the entry, so the value of a removed key is undefined.
      test("a right key that the getter removes has the value undefined", () => {
        let removed = false;
        const right = map([{ id: 0 }, 0], [{ id: 1 }, 1], [{ id: 2 }, undefined]) as Collection;
        const left = map(
          [
            {
              get id() {
                if (!removed) {
                  removed = true;
                  right.delete(last(right));
                }
                return 0;
              },
            },
            0,
          ],
          [{ id: 1 }, 1],
          [{ id: 2 }, undefined],
        );
        expect(util.isDeepStrictEqual(left, right)).toBe(true);
      });

      // After the clear only the copy that the pairing made holds the right members, and 40 members do not fit in its inline storage.
      test("the members of a cleared right Set stay alive", () => {
        const right = new Set<unknown>();
        let cleared = false;
        const left = new Set<unknown>([
          {
            get id() {
              if (!cleared) {
                cleared = true;
                right.clear();
                Bun.gc(true);
              }
              return 0;
            },
          },
        ]);
        for (let id = 1; id < 40; id++) left.add({ id });
        for (let id = 0; id < 40; id++) right.add({ id });
        expect(util.isDeepStrictEqual(left, right)).toBe(true);
      });
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
