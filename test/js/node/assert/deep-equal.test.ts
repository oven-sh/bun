// Deep-equality matrix for node:assert and node:util.
// Expectations come from the documented semantics of assert.deepStrictEqual/deepEqual,
// cross-checked against Node.js. Cases Bun gets wrong today are marked `test.failing`.
import { describe, expect, test } from "bun:test";
import assert from "node:assert";
import { createPrivateKey, createPublicKey, createSecretKey, generateKeyPairSync } from "node:crypto";
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

const ecKeys = [generateKeyPairSync("ec", { namedCurve: "P-256" }), generateKeyPairSync("ec", { namedCurve: "P-256" })];
const rsaPublicKey = generateKeyPairSync("rsa", { modulusLength: 1024 }).publicKey;
const secretCryptoKey = (
  fill: number,
  algorithm: any = "AES-GCM",
  extractable = true,
  usages: KeyUsage[] = ["encrypt"],
) => createSecretKey(Buffer.alloc(16, fill)).toCryptoKey(algorithm, extractable, usages);

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
  {
    name: "secret KeyObjects with the same bytes",
    a: () => createSecretKey(Buffer.alloc(16, 1)),
    b: () => createSecretKey(Buffer.alloc(16, 1)),
    strict: true,
    loose: true,
  },
  {
    name: "secret KeyObjects with different bytes",
    a: () => createSecretKey(Buffer.alloc(16, 1)),
    b: () => createSecretKey(Buffer.alloc(16, 2)),
    strict: false,
    loose: false,
  },
  {
    name: "objects holding different secret KeyObjects",
    a: () => ({ key: createSecretKey(Buffer.alloc(16, 1)) }),
    b: () => ({ key: createSecretKey(Buffer.alloc(16, 2)) }),
    strict: false,
    loose: false,
  },
  {
    name: "the public KeyObjects of two key pairs",
    a: () => ecKeys[0].publicKey,
    b: () => ecKeys[1].publicKey,
    strict: false,
    loose: false,
  },
  {
    name: "the private KeyObjects of two key pairs",
    a: () => ecKeys[0].privateKey,
    b: () => ecKeys[1].privateKey,
    strict: false,
    loose: false,
  },
  {
    name: "the public and private KeyObjects of one key pair",
    a: () => ecKeys[0].publicKey,
    b: () => ecKeys[0].privateKey,
    strict: false,
    loose: false,
  },
  {
    name: "two public KeyObjects made from one private key",
    a: () => createPublicKey(ecKeys[0].privateKey),
    b: () => createPublicKey(ecKeys[0].privateKey),
    strict: true,
    loose: true,
  },
  {
    name: "public KeyObjects imported twice from the same bytes",
    a: () => createPublicKey(ecKeys[0].publicKey.export({ type: "spki", format: "pem" })),
    b: () => createPublicKey(ecKeys[0].publicKey.export({ type: "spki", format: "pem" })),
    strict: true,
    loose: true,
  },
  {
    name: "private KeyObjects imported twice from the same bytes",
    a: () => createPrivateKey(ecKeys[0].privateKey.export({ type: "pkcs8", format: "pem" })),
    b: () => createPrivateKey(ecKeys[0].privateKey.export({ type: "pkcs8", format: "pem" })),
    strict: true,
    loose: true,
  },
  {
    name: "a KeyObject and an empty object",
    a: () => createSecretKey(Buffer.alloc(16, 1)),
    b: () => ({}),
    strict: false,
    loose: false,
  },
  {
    name: "CryptoKeys with the same bytes",
    a: () => secretCryptoKey(1),
    b: () => secretCryptoKey(1),
    strict: true,
    loose: true,
  },
  {
    name: "CryptoKeys with different bytes",
    a: () => secretCryptoKey(1),
    b: () => secretCryptoKey(2),
    strict: false,
    loose: false,
  },
  {
    name: "CryptoKeys that differ in extractable",
    a: () => secretCryptoKey(1),
    b: () => secretCryptoKey(1, "AES-GCM", false),
    strict: false,
    loose: false,
  },
  {
    name: "CryptoKeys that differ in usages",
    a: () => secretCryptoKey(1),
    b: () => secretCryptoKey(1, "AES-GCM", true, ["encrypt", "decrypt"]),
    strict: false,
    loose: false,
  },
  {
    name: "CryptoKeys that differ in algorithm",
    a: () => secretCryptoKey(1),
    b: () => secretCryptoKey(1, "AES-CBC"),
    strict: false,
    loose: false,
  },
  {
    name: "HMAC CryptoKeys that differ in hash",
    a: () => secretCryptoKey(1, { name: "HMAC", hash: "SHA-256" }, true, ["sign"]),
    b: () => secretCryptoKey(1, { name: "HMAC", hash: "SHA-512" }, true, ["sign"]),
    strict: false,
    loose: false,
  },
  {
    name: "RSA CryptoKeys that differ in hash",
    a: () => rsaPublicKey.toCryptoKey({ name: "RSA-PSS", hash: "SHA-256" }, true, ["verify"]),
    b: () => rsaPublicKey.toCryptoKey({ name: "RSA-PSS", hash: "SHA-512" }, true, ["verify"]),
    strict: false,
    loose: false,
  },
  {
    name: "CryptoKeys with the same bytes and different own properties",
    a: () => Object.assign(secretCryptoKey(1), { own: 1 }),
    b: () => Object.assign(secretCryptoKey(1), { own: 2 }),
    strict: false,
    loose: false,
  },
  {
    name: "a CryptoKey and an empty object",
    a: () => secretCryptoKey(1),
    b: () => ({}),
    strict: false,
    loose: false,
  },
  {
    name: "a KeyObject and a CryptoKey with the same bytes",
    a: () => createSecretKey(Buffer.alloc(16, 1)),
    b: () => secretCryptoKey(1),
    strict: false,
    loose: false,
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

  test("assert.partialDeepStrictEqual compares CryptoKeys by what they hold, then by own properties", () => {
    const partial = (actual: unknown, expected: unknown) => {
      const error = caught(() => assert.partialDeepStrictEqual(actual, expected));
      return error ? error.code : "equal";
    };
    expect({
      same: partial(secretCryptoKey(1), secretCryptoKey(1)),
      otherBytes: partial(secretCryptoKey(1), secretCryptoKey(2)),
      nestedOtherBytes: partial({ key: secretCryptoKey(1) }, { key: secretCryptoKey(2) }),
      otherExtractable: partial(secretCryptoKey(1), secretCryptoKey(1, "AES-GCM", false)),
      // Unlike arrays, usages are not compared as a subset.
      fewerUsages: partial(secretCryptoKey(1, "AES-GCM", true, ["encrypt", "decrypt"]), secretCryptoKey(1)),
      extraOwnPropertyOnActual: partial(Object.assign(secretCryptoKey(1), { own: 1 }), secretCryptoKey(1)),
      extraOwnPropertyOnExpected: partial(secretCryptoKey(1), Object.assign(secretCryptoKey(1), { own: 1 })),
    }).toEqual({
      same: "equal",
      otherBytes: "ERR_ASSERTION",
      nestedOtherBytes: "ERR_ASSERTION",
      otherExtractable: "ERR_ASSERTION",
      fewerUsages: "ERR_ASSERTION",
      extraOwnPropertyOnActual: "equal",
      extraOwnPropertyOnExpected: "ERR_ASSERTION",
    });
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

// Node compares the `message`, `name`, `cause` and `errors` of two errors in that order. It leaves a key that the
// expected error owns as an enumerable property to the walk over the own enumerable keys:
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/util/comparisons.js#L392-L405
// Every expectation in this block is the result of Node v26.3.0.
describe("the message, name, cause and errors of an Error", () => {
  const keys = ["message", "name", "cause", "errors"];
  const depths = [1, 3, 8];
  const held = (key: string, value: unknown) => (key === "errors" ? [value] : value);

  function withGetter<T extends object>(target: T, key: string, get: () => unknown, enumerable: boolean) {
    return Object.defineProperty(target, key, { get, enumerable, configurable: true });
  }

  function withValue(key: string, value: unknown, enumerable: boolean) {
    return Object.defineProperty(new Error("x"), key, { value, enumerable, configurable: true });
  }

  /** `depth + 1` nested errors. Each one holds the next one in `key`, behind a getter that counts its reads. */
  function getterChain(key: string, enumerable: boolean, depth: number) {
    let reads = 0;
    let value: unknown = "leaf";
    for (let level = 0; level <= depth; level++) {
      const next = held(key, value);
      value = withGetter(new Error("x"), key, () => (reads++, next), enumerable);
    }
    return { error: value, reads: () => reads };
  }

  /** The same chain with data properties. The innermost error holds an object with a getter that counts its reads. */
  function dataChain(key: string, depth: number) {
    let reads = 0;
    let value: unknown = withGetter({}, "leaf", () => (reads++, 1), true);
    for (let level = 0; level <= depth; level++) {
      value = withValue(key, held(key, value), true);
    }
    return { error: value, reads: () => reads };
  }

  describe("assert.partialDeepStrictEqual", () => {
    const rejected = new Error("rejected");
    /** A failed comparison throws an Error that is passed as the message as it is, so nothing else reads the operands. */
    function partiallyEqual(actual: unknown, expected: unknown) {
      try {
        assert.partialDeepStrictEqual(actual, expected, rejected);
        return true;
      } catch (error) {
        if (error !== rejected) throw error;
        return false;
      }
    }

    /** true, false, or the message of the error that a getter or a Proxy trap threw. */
    function outcome(actual: unknown, expected: unknown) {
      try {
        return partiallyEqual(actual, expected);
      } catch (error) {
        return (error as Error).message;
      }
    }

    const throws = (side: string) => () => {
      throw new Error(`${side} threw`);
    };

    /** An error that finds `key` only through a Proxy in its prototype chain. */
    function behindProxy(key: string, get: () => unknown) {
      const error = new Error("x");
      if (key === "message") delete (error as { message?: string }).message;
      const handler: ProxyHandler<object> = {
        get: (target, name, receiver) => (name === key ? get() : Reflect.get(target, name, receiver)),
      };
      return Object.setPrototypeOf(error, new Proxy(Error.prototype, handler));
    }

    /** An error that inherits a `cause` getter. The getter reads the error that it is called on. */
    class InheritedCause extends Error {
      constructor(value: unknown) {
        super("x");
        Object.defineProperty(this, "value", { value });
      }
      get cause() {
        return (this as unknown as { value: unknown }).value;
      }
    }

    test.each(keys)("reads an enumerable %s getter once per side at each level", key => {
      const reads = depths.map(depth => {
        const actual = getterChain(key, true, depth);
        const expected = getterChain(key, true, depth);
        assert.partialDeepStrictEqual(actual.error, expected.error);
        return [actual.reads(), expected.reads()];
      });
      expect(reads).toEqual([
        [2, 2],
        [4, 4],
        [9, 9],
      ]);
    });

    test.each(keys)("compares an enumerable %s data property once at each level", key => {
      const reads = depths.map(depth => {
        const actual = dataChain(key, depth);
        const expected = dataChain(key, depth);
        assert.partialDeepStrictEqual(actual.error, expected.error);
        return [actual.reads(), expected.reads()];
      });
      expect(reads).toEqual([
        [1, 1],
        [1, 1],
        [1, 1],
      ]);
    });

    test.each<[string, (error: unknown) => unknown]>([
      ["an object", error => ({ error })],
      ["an array", error => [error]],
      ["a Map", error => new Map([["key", error]])],
      ["a Set", error => new Set([error])],
    ])("reads an enumerable cause getter once per side at each level inside %s", (_name, wrap) => {
      const actual = getterChain("cause", true, 3);
      const expected = getterChain("cause", true, 3);
      assert.partialDeepStrictEqual(wrap(actual.error), wrap(expected.error));
      expect([actual.reads(), expected.reads()]).toEqual([4, 4]);
    });

    test.each(keys)("reads a hidden %s of the actual error once at each level", key => {
      const reads = depths.map(depth => {
        const actual = getterChain(key, false, depth);
        assert.partialDeepStrictEqual(actual.error, getterChain(key, false, depth).error);
        return actual.reads();
      });
      // The expected side is not counted: Node reads a hidden key of the expected error two or three times, Bun once.
      expect(reads).toEqual([2, 4, 9]);
    });

    test("reads hidden getters in the order message, name, cause, errors, the expected error first", () => {
      const log: string[] = [];
      const hiddenGetters = (side: string) => {
        const error = new Error("x");
        for (const key of keys) withGetter(error, key, () => (log.push(`${side}.${key}`), held(key, 1)), false);
        return error;
      };
      assert.partialDeepStrictEqual(hiddenGetters("actual"), hiddenGetters("expected"));
      // Only the first read of each getter is compared, because Node reads the expected side again.
      expect([...new Set(log)]).toEqual([
        "expected.message",
        "actual.message",
        "expected.name",
        "actual.name",
        "expected.cause",
        "actual.cause",
        "expected.errors",
        "actual.errors",
      ]);
    });

    test.each(keys)("reads no %s that is enumerable on the expected error and hidden on the actual error", key => {
      const actual = getterChain(key, false, 0);
      const expected = getterChain(key, true, 0);
      expect(partiallyEqual(actual.error, expected.error)).toBe(false);
      expect([actual.reads(), expected.reads()]).toEqual([0, 0]);
    });

    test("compares a key by how the expected error holds it", () => {
      // partiallyEqual(actual, expected)
      expect({
        enumerableAgainstHidden: partiallyEqual(withValue("errors", [1], false), withValue("errors", [1], true)),
        hiddenAgainstEnumerable: partiallyEqual(withValue("errors", [1], true), withValue("errors", [1], false)),
        enumerableEmptyMessage: partiallyEqual(withValue("message", "x", true), withValue("message", "", true)),
        hiddenEmptyMessage: partiallyEqual(new Error("x"), new Error("")),
        enumerableErrorsSubsequence: partiallyEqual(withValue("errors", [1, 2], true), withValue("errors", [2], true)),
        enumerableErrorsNotContained: partiallyEqual(withValue("errors", [1, 2], true), withValue("errors", [3], true)),
        inheritedNameAgainstOtherName: partiallyEqual(new TypeError("x"), new Error("x")),
        causeContainedInCause: partiallyEqual(new Error("x", { cause: [1, 2] }), new Error("x", { cause: [2] })),
        undefinedCauseAgainstCause: partiallyEqual(new Error("x", { cause: 1 }), new Error("x", { cause: undefined })),
        undefinedCauseAgainstNoCause: partiallyEqual(new Error("x"), new Error("x", { cause: undefined })),
        inheritedCauseAgainstSameCause: partiallyEqual(new Error("x", { cause: 1 }), new InheritedCause(1)),
        inheritedCauseAgainstOtherCause: partiallyEqual(new Error("x", { cause: 2 }), new InheritedCause(1)),
        inheritedCauseAgainstNoCause: partiallyEqual(new Error("x"), new InheritedCause(1)),
        inheritedCauseAgainstOtherInheritedCause: partiallyEqual(new InheritedCause(2), new InheritedCause(1)),
        causeAgainstInheritedCause: partiallyEqual(new InheritedCause(1), new Error("x", { cause: 1 })),
      }).toEqual({
        enumerableAgainstHidden: false,
        hiddenAgainstEnumerable: true,
        enumerableEmptyMessage: false,
        hiddenEmptyMessage: true,
        enumerableErrorsSubsequence: true,
        enumerableErrorsNotContained: false,
        inheritedNameAgainstOtherName: false,
        causeContainedInCause: true,
        undefinedCauseAgainstCause: true,
        undefinedCauseAgainstNoCause: false,
        inheritedCauseAgainstSameCause: true,
        inheritedCauseAgainstOtherCause: false,
        inheritedCauseAgainstNoCause: false,
        inheritedCauseAgainstOtherInheritedCause: false,
        causeAgainstInheritedCause: false,
      });
    });

    /** Node's rule for the four keys, then its walk over the own enumerable keys. For values that hold no Error. */
    function nodeRule(actual: Record<string, unknown>, expected: Record<string, unknown>) {
      const ownEnumerable = (error: object, key: string) => Object.prototype.propertyIsEnumerable.call(error, key);
      for (const key of keys) {
        if (ownEnumerable(expected, key)) continue;
        const value = expected[key];
        if (value === undefined || (key === "message" && value === "")) continue;
        if (!partiallyEqual(actual[key], value)) return false;
      }
      if (Object.hasOwn(expected, "cause") && !Object.hasOwn(actual, "cause")) return false;
      const equalInWalk = (key: string) => ownEnumerable(actual, key) && partiallyEqual(actual[key], expected[key]);
      return Object.keys(expected).every(equalInWalk);
    }

    test.each(keys)("gives the result of Node's rule wherever the two errors hold %s", key => {
      const places = ["enumerable", "hidden", "inherited", "inherited and enumerable"];
      const values = [undefined, null, "", "x", "y", 0, 1, [1], [1, 2]];
      const states = [undefined, ...places.flatMap(place => values.map(value => ({ place, value })))];
      const holding = (state: (typeof states)[number]) => {
        const error = (key === "message" ? new Error() : new Error("m")) as unknown as Record<string, unknown>;
        if (!state) return error;
        const property = { value: state.value, enumerable: state.place.endsWith("enumerable"), configurable: true };
        if (!state.place.startsWith("inherited")) return Object.defineProperty(error, key, property);
        return Object.setPrototypeOf(error, Object.create(Error.prototype, { [key]: property }));
      };
      const actuals = states.map(holding);
      const expecteds = states.map(holding);
      const differences: unknown[] = [];
      actuals.forEach((actual, i) => {
        expecteds.forEach((expected, j) => {
          const result = partiallyEqual(actual, expected);
          if (result === nodeRule(actual, expected)) return;
          differences.push({ actual: states[i], expected: states[j], result });
        });
      });
      expect(differences).toEqual([]);
    });

    test.each(keys)("passes on the error of a %s getter or a Proxy trap that throws", key => {
      const value = held(key, 1);
      const getter = (side: string, enumerable: boolean) => withGetter(new Error("x"), key, throws(side), enumerable);
      expect({
        hiddenExpected: outcome(withValue(key, value, false), getter("expected", false)),
        hiddenActual: outcome(getter("actual", false), withValue(key, value, false)),
        hiddenBoth: outcome(getter("actual", false), getter("expected", false)),
        enumerableExpected: outcome(withValue(key, value, true), getter("expected", true)),
        enumerableActual: outcome(getter("actual", true), withValue(key, value, true)),
        enumerableBoth: outcome(getter("actual", true), getter("expected", true)),
        trapOfExpected: outcome(withValue(key, value, false), behindProxy(key, throws("expected"))),
        trapOfActual: outcome(behindProxy(key, throws("actual")), withValue(key, value, false)),
      }).toEqual({
        hiddenExpected: "expected threw",
        hiddenActual: "actual threw",
        // A hidden key is read from the expected error first, an enumerable key from the actual error first.
        hiddenBoth: "expected threw",
        enumerableExpected: "expected threw",
        enumerableActual: "actual threw",
        enumerableBoth: "actual threw",
        trapOfExpected: "expected threw",
        trapOfActual: "actual threw",
      });
    });

    test.each(keys)("compares a %s that a Proxy in the prototype chain of the expected error returns", key => {
      const actual = () => withValue(key, held(key, 1), false);
      const same = behindProxy(key, () => held(key, 1));
      const other = behindProxy(key, () => held(key, 2));
      expect([outcome(actual(), same), outcome(actual(), other)]).toEqual([true, false]);
    });

    test("stops at a cause that differs before it reads errors", () => {
      const log: string[] = [];
      const make = (side: string, cause: number) =>
        withGetter(new Error("x", { cause }), "errors", () => log.push(side), false);
      expect(partiallyEqual(make("actual", 1), make("expected", 2))).toBe(false);
      expect(log).toEqual([]);
    });

    test("does not read a key of the actual error that the expected error holds as undefined or as an empty message", () => {
      const throwing = (key: string) => withGetter(new Error("x"), key, throws("actual"), false);
      expect({
        undefinedCause: outcome(throwing("cause"), new Error("x", { cause: undefined })),
        undefinedErrors: outcome(throwing("errors"), withValue("errors", undefined, false)),
        emptyMessage: outcome(throwing("message"), new Error("")),
        noCause: outcome(throwing("cause"), new Error("x")),
      }).toEqual({ undefinedCause: true, undefinedErrors: true, emptyMessage: true, noCause: true });
    });

    describe("when a getter of the expected error changes another key", () => {
      test("tests whether a key is enumerable when its turn comes", () => {
        const log: string[] = [];
        const actual = withGetter(new Error("x"), "errors", () => (log.push("actual"), [1]), true);
        const expected = withGetter(new Error("x"), "errors", () => (log.push("expected"), [1]), false);
        const showErrors = () => (Object.defineProperty(expected, "errors", { enumerable: true }), "x");
        withGetter(expected, "message", showErrors, false);
        expect(partiallyEqual(actual, expected)).toBe(true);
        // `errors` is enumerable when its turn comes, so only the walk over the enumerable keys reads it.
        expect(log).toEqual(["actual", "expected"]);
      });

      test("compares errors after cause", () => {
        const actual = Object.defineProperty(new Error("x", { cause: 1 }), "errors", { value: [1], enumerable: true });
        const expected = withValue("errors", [2], true);
        const hideErrors = () => void Object.defineProperty(expected, "errors", { enumerable: false });
        withGetter(expected, "cause", hideErrors, false);
        // The `cause` getter hides `errors`. The walk over the enumerable keys does not compare it after that.
        expect(partiallyEqual(actual, expected)).toBe(false);
      });

      test("looks for an own cause after it has read errors", () => {
        const expected = new Error("x", { cause: undefined });
        withGetter(expected, "errors", () => void delete expected.cause, false);
        expect(partiallyEqual(new Error("x"), expected)).toBe(true);
      });
    });
  });

  // Bun reads the getter 6, 30 and 1022 times per side. The Error arm of Bun__deepEquals compares `cause`, and its walk
  // over the enumerable keys compares an enumerable `cause` again.
  test.failing.each<[string, (actual: unknown, expected: unknown) => void]>([
    ["assert.deepStrictEqual", assert.deepStrictEqual],
    ["assert.deepEqual", assert.deepEqual],
    ["util.isDeepStrictEqual", (actual, expected) => assert.ok(util.isDeepStrictEqual(actual, expected))],
  ])("%s reads an enumerable cause getter once per side at each level", (_name, equal) => {
    const reads = depths.map(depth => {
      const actual = getterChain("cause", true, depth);
      const expected = getterChain("cause", true, depth);
      equal(actual.error, expected.error);
      return [actual.reads(), expected.reads()];
    });
    expect(reads).toEqual([
      [2, 2],
      [4, 4],
      [9, 9],
    ]);
  });
});

describe("assert.partialDeepStrictEqual on Maps", () => {
  test("compares the value under a key that both Maps hold once at each level", () => {
    const key = {};
    const reads = [1, 4, 9].map(depth => {
      let count = 0;
      const nested = (leaf: number) => {
        let value: unknown = Object.defineProperty({}, "leaf", { get: () => (count++, leaf), enumerable: true });
        for (let level = 0; level < depth; level++) value = new Map([[key, value]]);
        return value;
      };
      expect(() => assert.partialDeepStrictEqual(nested(1), nested(2), new Error("rejected"))).toThrow("rejected");
      return count;
    });
    expect(reads).toEqual([2, 2, 2]);
  });

  test("matches another entry when the value under a key that both Maps hold differs", () => {
    const key = { id: 1 };
    const actual = new Map<object, number>([
      [key, 1],
      [{ id: 1 }, 2],
    ]);
    assert.partialDeepStrictEqual(actual, new Map([[key, 2]]));
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
