// Deep-equality matrix for node:assert and node:util.
// Expectations come from the documented semantics of assert.deepStrictEqual/deepEqual,
// cross-checked against Node.js. Cases Bun gets wrong today are expected failures on Bun.
// This file uses node:test/node:assert so the identical file also runs under `node --test`.
// For the same reason it makes its one temporary directory with node:fs: Node.js cannot import `tempDir` from harness.
import assert from "node:assert";
import { createPrivateKey, createPublicKey, createSecretKey, generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import util from "node:util";
import vm from "node:vm";

// Node repeats its first throwing comparison, with cycle detection on, which would disturb tests that count reads.
try {
  util.isDeepStrictEqual(
    {
      get a() {
        throw 1;
      },
    },
    {
      get a() {
        throw 1;
      },
    },
  );
} catch {}

const isBun = typeof process.versions.bun === "string";

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

/** A Proxy of `target` whose get trap answers `value` for `key`. */
function lyingProxy<T extends object>(target: T, key: PropertyKey, value: unknown): T {
  return new Proxy(target, { get: (t, k, receiver) => (k === key ? value : Reflect.get(t, k, receiver)) });
}

/** A Proxy of `target` whose getOwnPropertyDescriptor trap answers `value` for `key`. */
function proxyWithDescriptor<T extends object>(target: T, key: PropertyKey, value: unknown): T {
  return new Proxy(target, {
    getOwnPropertyDescriptor: (t, k) =>
      k === key
        ? { value, writable: true, enumerable: true, configurable: true }
        : Reflect.getOwnPropertyDescriptor(t, k),
  });
}

/** Gives `target` a getter `x` that deletes `y`, then `y: 2`. */
function withGetterThatDeletes<T extends object>(target: T): T {
  Object.defineProperty(target, "x", {
    enumerable: true,
    configurable: true,
    get() {
      delete this.y;
      return 1;
    },
  });
  return Object.assign(target, { y: 2 });
}

/** A Proxy of `target` whose ownKeys trap lists the keys in the opposite order. */
function proxyWithKeysReversed<T extends object>(target: T, handler: ProxyHandler<T> = {}): T {
  return new Proxy(target, { ...handler, ownKeys: t => Reflect.ownKeys(t).reverse() });
}

/** A Proxy that also wraps every object it hands out, with one wrapper for each object. */
function deepProxy<T extends object>(target: T, wrappers = new WeakMap<object, object>()): T {
  let proxy = wrappers.get(target);
  if (!proxy) {
    proxy = new Proxy(target, {
      get(t, key, receiver) {
        const value = Reflect.get(t, key, receiver);
        return typeof value === "object" && value !== null ? deepProxy(value, wrappers) : value;
      },
    });
    wrappers.set(target, proxy);
  }
  return proxy as T;
}

const ref = (value: unknown) => ({ isRef: true, value });

/** A Proxy that answers with the `value` of a property that holds a ref, as a Vue reactive object does. */
function unwrappingProxy<T extends object>(target: T): T {
  return new Proxy(target, {
    get(t, key, receiver) {
      const value: unknown = Reflect.get(t, key, receiver);
      const held = value as { isRef?: unknown; value?: unknown } | null;
      return typeof held === "object" && held !== null && held.isRef === true ? held.value : value;
    },
  });
}

/** `{ self: itself, ...rest }` with `self` added first or last. */
function selfReferencingWith(rest: Record<string, unknown>, selfFirst: boolean) {
  const object: Record<string, unknown> = {};
  if (selfFirst) object.self = object;
  Object.assign(object, rest);
  if (!selfFirst) object.self = object;
  return object;
}

const sparseArray = (named: Record<string, unknown>) => Object.assign([1, , 3], named);

/** Makes `array[index]` an enumerable getter that answers `value`. */
function withAccessorElement<T>(array: T[], index: number, value: T): T[] {
  return Object.defineProperty(array, index, { enumerable: true, configurable: true, get: () => value });
}

/** Gives `array` an enumerable getter `x` that runs `effect` on the array, then answers 1. */
function withGetterX<T>(array: T[], effect: (array: T[]) => void = () => {}): T[] {
  return Object.defineProperty(array, "x", {
    enumerable: true,
    configurable: true,
    get() {
      effect(this);
      return 1;
    },
  });
}

/** A Proxy of [] whose get trap answers `length()` for length and `at(index)` for every index. */
function virtualArray(length: () => number, at: (index: number) => unknown): unknown[] {
  return new Proxy([], {
    get(target, key, receiver) {
      if (key === "length") return length();
      if (typeof key === "string" && /^(0|[1-9]\d*)$/.test(key)) return at(Number(key));
      return Reflect.get(target, key, receiver);
    },
  });
}

class WithPrivate {
  #p: unknown;
  x = 1;
  constructor(p: unknown) {
    this.#p = p;
  }
  get p() {
    return this.#p;
  }
}

class PrivateThenSymbol {
  #p: unknown;
  [sym] = 1;
  x = 1;
  constructor(p: unknown) {
    this.#p = p;
  }
  get p() {
    return this.#p;
  }
}

class SymbolThenPrivate {
  [sym] = 1;
  #p: unknown;
  x = 1;
  constructor(p: unknown) {
    this.#p = p;
  }
  get p() {
    return this.#p;
  }
}

/** `{ a: child, b }` where reading `child.b` deletes `b` from the parent. */
function withChildThatDeletesB(b: unknown) {
  const parent: Record<string, unknown> = { a: null, b };
  parent.a = {
    get b() {
      delete parent.b;
      return 1;
    },
  };
  return parent;
}

function argumentsObject(...values: unknown[]) {
  return (
    function () {
      // eslint-disable-next-line prefer-rest-params
      return arguments;
    } as (...args: unknown[]) => IArguments
  )(...values);
}

/** A Proxy of `target` whose get trap answers a new function for every key that `target` lacks, as a mock of an interface does. */
function mockingProxy<T extends object>(target: T): T {
  return new Proxy(target, {
    get: (t, key, receiver) => (Reflect.has(t, key) ? Reflect.get(t, key, receiver) : () => {}),
  });
}

/** The numbers 1 to `count` after a shift(), which makes JavaScriptCore store the array another way. */
function shiftedArray(count: number): number[] {
  const array: number[] = [];
  for (let i = 0; i <= count; i++) array.push(i);
  array.shift();
  return array;
}

function withHole<T>(array: T[], index: number): T[] {
  delete array[index];
  return array;
}

/** An array that answers its own count for `size`, and 0 after clear(). */
class Ring extends Array<unknown> {
  #count = 0;
  get size() {
    return this.#count;
  }
  add(value: unknown) {
    this[this.#count++] = value;
    return this;
  }
  clear() {
    this.#count = 0;
    return this;
  }
}

class MapOfSizeZero<K, V> extends Map<K, V> {
  get size() {
    return 0;
  }
}

class SetOfSizeZero<T> extends Set<T> {
  get size() {
    return 0;
  }
}

class WithInheritedFirstElement extends Array<unknown> {}
WithInheritedFirstElement.prototype[0] = 1;

/** `[<hole>, ...rest]` whose prototype holds 1 at index 0. */
function withInheritedFirstElement(...rest: unknown[]) {
  const array = new WithInheritedFirstElement(rest.length + 1);
  rest.forEach((element, index) => {
    if (element !== undefined) array[index + 1] = element;
  });
  return array;
}

/** `[<hole>, ...rest]` with a 1 at index 0 that is not enumerable. */
function withHiddenFirstElement(...rest: unknown[]) {
  const array = new Array<unknown>(rest.length + 1);
  rest.forEach((element, index) => {
    if (element !== undefined) array[index + 1] = element;
  });
  return withHiddenProperty(array, 0, 1);
}

function revokedProxyOfFunction() {
  const { proxy, revoke } = Proxy.revocable(function () {}, {});
  revoke();
  return proxy;
}

/** A Proxy of `target` whose every trap throws a RangeError that names the trap. */
function proxyWhoseTrapsThrow<T extends object>(target: T = {} as T): T {
  const handler = new Proxy(
    {},
    {
      get(_, trap) {
        return () => {
          throw new RangeError(`from the ${String(trap)} trap`);
        };
      },
    },
  );
  return new Proxy(target, handler);
}

const sharedPromise = Promise.resolve(1);
const sharedWeakMap = new WeakMap();
const sharedWeakSet = new WeakSet();

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

interface OrderedPair {
  first: string;
  second: string;
  a: Thunk;
  b: Thunk;
  /** Expectations for (first, second), then for (second, first). */
  strict: [boolean, boolean];
  loose: [boolean, boolean];
  strictBug?: [string | undefined, string | undefined];
  looseBug?: [string | undefined, string | undefined];
}

// Node reads the second operand's values with [[Get]]. It reads the first operand's with [[Get]] too while both
// list their keys in the same order, and from its own property descriptor after the first difference (objEquiv in
// lib/internal/util/comparisons.js). So an answer can depend on the argument order: each pair is a case in both.
const orderedPairs: OrderedPair[] = [
  {
    first: "{ a: 1 }",
    second: "a Proxy of { a: 1 } whose get trap answers 2 for a",
    a: () => ({ a: 1 }),
    b: () => lyingProxy({ a: 1 }, "a", 2),
    strict: [false, false],
    loose: [false, false],
  },
  {
    first: "{ a: 2 }",
    second: "a Proxy of { a: 1 } whose get trap answers 2 for a",
    a: () => ({ a: 2 }),
    b: () => lyingProxy({ a: 1 }, "a", 2),
    strict: [true, true],
    loose: [true, true],
  },
  {
    first: "{ a: [1], b: 2 }",
    second: "a Proxy of { a: [1], b: 2 } whose get trap answers 999 for a",
    a: () => ({ a: [1], b: 2 }),
    b: () => lyingProxy({ a: [1], b: 2 }, "a", 999),
    strict: [false, false],
    loose: [false, false],
  },
  {
    first: "a Proxy of { a: 1 } whose get trap answers 2 for a",
    second: "another such Proxy",
    a: () => lyingProxy({ a: 1 }, "a", 2),
    b: () => lyingProxy({ a: 1 }, "a", 2),
    strict: [true, true],
    loose: [true, true],
  },
  {
    first: "a Proxy of { a: 1 } whose get trap answers 2 for a",
    second: "a Proxy of { a: 2 }",
    a: () => lyingProxy({ a: 1 }, "a", 2),
    b: () => new Proxy({ a: 2 }, {}),
    strict: [true, true],
    loose: [true, true],
  },
  {
    first: "{ [sym]: 1 }",
    second: "a Proxy of { [sym]: 1 } whose get trap answers 2 for sym",
    a: () => ({ [sym]: 1 }),
    b: () => lyingProxy({ [sym]: 1 }, sym, 2),
    strict: [false, false],
    loose: [true, true],
    looseBug: ["reports not equal", "reports not equal"],
  },
  {
    first: "{ [sym]: 2 }",
    second: "a Proxy of { [sym]: 1 } whose get trap answers 2 for sym",
    a: () => ({ [sym]: 2 }),
    b: () => lyingProxy({ [sym]: 1 }, sym, 2),
    strict: [true, true],
    loose: [true, true],
  },
  {
    first: "a class instance",
    second: "a Proxy of an equal instance whose get trap answers 2 for a",
    a: () => new WithValue(),
    b: () => lyingProxy(new WithValue(), "a", 2),
    strict: [false, false],
    loose: [false, false],
  },
  {
    first: "{ x: { a: 2 } }",
    second: "{ x: a Proxy of { a: 1 } whose get trap answers 2 for a }",
    a: () => ({ x: { a: 2 } }),
    b: () => ({ x: lyingProxy({ a: 1 }, "a", 2) }),
    strict: [true, true],
    loose: [true, true],
  },
  {
    first: "[{ a: 2 }]",
    second: "[a Proxy of { a: 1 } whose get trap answers 2 for a]",
    a: () => [{ a: 2 }],
    b: () => [lyingProxy({ a: 1 }, "a", 2)],
    strict: [true, true],
    loose: [true, true],
  },
  {
    first: "a Map holding { a: 2 }",
    second: "a Map holding a Proxy of { a: 1 } whose get trap answers 2 for a",
    a: () => new Map([["k", { a: 2 }]]),
    b: () => new Map([["k", lyingProxy({ a: 1 }, "a", 2)]]),
    strict: [true, true],
    loose: [true, true],
  },
  {
    first: "a Set holding { a: 2 }",
    second: "a Set holding a Proxy of { a: 1 } whose get trap answers 2 for a",
    a: () => new Set([{ a: 2 }]),
    b: () => new Set([lyingProxy({ a: 1 }, "a", 2)]),
    strict: [true, true],
    loose: [true, true],
  },
  {
    first: "an Error with info: { a: 2 }",
    second: "an Error with info: a Proxy of { a: 1 } whose get trap answers 2 for a",
    a: () => Object.assign(new Error("m"), { info: { a: 2 } }),
    b: () => Object.assign(new Error("m"), { info: lyingProxy({ a: 1 }, "a", 2) }),
    strict: [true, true],
    loose: [true, true],
  },
  // Different key orders: the first operand's value comes from its descriptor, which a get trap does not change.
  {
    first: "{ b: 2, a: 1 }",
    second: "a Proxy of { a: 1, b: 2 } whose get trap answers 99 for a",
    a: () => ({ b: 2, a: 1 }),
    b: () => lyingProxy({ a: 1, b: 2 }, "a", 99),
    strict: [false, true],
    loose: [false, true],
    looseBug: [undefined, "reports not equal"],
  },
  {
    first: "{ b: 2, a: 99 }",
    second: "a Proxy of { a: 1, b: 2 } whose get trap answers 99 for a",
    a: () => ({ b: 2, a: 99 }),
    b: () => lyingProxy({ a: 1, b: 2 }, "a", 99),
    strict: [true, false],
    loose: [true, false],
    looseBug: [undefined, "reports equal"],
  },
  // An accessor descriptor has no value: node reads the first operand with [[Get]] after all.
  {
    first: "{ b: 2, a: 1 }",
    second: "a Proxy of { get a() { return 1 }, b: 2 } whose get trap answers 99 for a",
    a: () => ({ b: 2, a: 1 }),
    b: () =>
      lyingProxy(
        {
          get a() {
            return 1;
          },
          b: 2,
        },
        "a",
        99,
      ),
    strict: [false, false],
    loose: [false, false],
  },
  {
    first: "{ b: 2, a: 99 }",
    second: "a Proxy of { get a() { return 1 }, b: 2 } whose get trap answers 99 for a",
    a: () => ({ b: 2, a: 99 }),
    b: () =>
      lyingProxy(
        {
          get a() {
            return 1;
          },
          b: 2,
        },
        "a",
        99,
      ),
    strict: [true, true],
    loose: [true, true],
  },
  {
    first: "{ a: 5 }",
    second: "a Proxy of { a: 1 } whose getOwnPropertyDescriptor trap answers 5 for a",
    a: () => ({ a: 5 }),
    b: () => proxyWithDescriptor({ a: 1 }, "a", 5),
    strict: [false, false],
    loose: [false, false],
  },
  {
    first: "{ b: 2, a: 5 }",
    second: "a Proxy of { a: 1, b: 2 } whose getOwnPropertyDescriptor trap answers 5 for a",
    a: () => ({ b: 2, a: 5 }),
    b: () => proxyWithDescriptor({ a: 1, b: 2 }, "a", 5),
    strict: [false, true],
    loose: [false, true],
    looseBug: [undefined, "reports not equal"],
  },
  // Arrays: node reads every element with [[Get]] and takes the other keys of the first operand from its descriptors.
  {
    first: "[1, 2]",
    second: "a Proxy of [1, 2] whose get trap answers 9 for 0",
    a: () => [1, 2],
    b: () => lyingProxy([1, 2], "0", 9),
    strict: [false, false],
    loose: [false, false],
  },
  {
    first: "[9, 2]",
    second: "a Proxy of [1, 2] whose get trap answers 9 for 0",
    a: () => [9, 2],
    b: () => lyingProxy([1, 2], "0", 9),
    strict: [true, true],
    loose: [true, true],
  },
  {
    first: "[1] with x: 1",
    second: "a Proxy of [1] with x: 1 whose get trap answers 2 for x",
    a: () => Object.assign([1], { x: 1 }),
    b: () => lyingProxy(Object.assign([1], { x: 1 }), "x", 2),
    strict: [false, true],
    loose: [false, true],
    looseBug: [undefined, "reports not equal"],
  },
  {
    first: "[1] with x: 2",
    second: "a Proxy of [1] with x: 1 whose get trap answers 2 for x",
    a: () => Object.assign([1], { x: 2 }),
    b: () => lyingProxy(Object.assign([1], { x: 1 }), "x", 2),
    strict: [true, false],
    loose: [true, false],
    looseBug: [undefined, "reports equal"],
  },
  // No Proxy: node lists the keys of both operands before it reads a value. It still reads a key that a getter deleted.
  {
    first: "{ a: 1, b: undefined }",
    second: "{ get a() { delete this.b; return 1 }, b: 2 }",
    a: () => ({ a: 1, b: undefined }),
    b: () => ({
      get a() {
        delete this.b;
        return 1;
      },
      b: 2,
    }),
    strict: [true, true],
    loose: [true, true],
  },
  {
    first: "[1] with x: 1, y: undefined",
    second: "[1] with a getter x that deletes y, and y: 2",
    a: () => Object.assign([1], { x: 1, y: undefined }),
    b: () => withGetterThatDeletes([1]),
    strict: [true, false],
    loose: [true, false],
    looseBug: [undefined, "reports equal"],
  },
  {
    first: "a Uint8Array with x: 1, y: undefined",
    second: "a Uint8Array with a getter x that deletes y, and y: 2",
    a: () => Object.assign(new Uint8Array(1), { x: 1, y: undefined }),
    b: () => withGetterThatDeletes(new Uint8Array(1)),
    strict: [true, false],
    loose: [true, false],
    looseBug: [undefined, "reports equal"],
  },
  // Read through the global, `self` is the global. Its own property descriptor holds the sandbox.
  {
    first: "a self-referencing object",
    second: "the global of a node:vm context over a self-referencing sandbox",
    a: selfReferencingObject,
    b: () => vm.runInContext("this", vm.createContext(selfReferencingObject())),
    strict: [true, true],
    loose: [true, true],
    looseBug: ["reports not equal", undefined],
  },
  {
    first: "{ self: itself, k: 1 }",
    second: "the global of a node:vm context over { k: 1, self: itself }",
    a: () => selfReferencingWith({ k: 1 }, true),
    b: () => vm.runInContext("this", vm.createContext(selfReferencingWith({ k: 1 }, false))),
    strict: [true, false],
    loose: [true, false],
    looseBug: ["reports not equal", "reports equal"],
  },
  // After the first difference in key order, every later key of the first operand is read from its descriptor.
  {
    first: "{ b: 2, a: 1, c: 3 }",
    second: "a Proxy of { a: 1, b: 2, c: 3 } whose get trap answers 99 for c",
    a: () => ({ b: 2, a: 1, c: 3 }),
    b: () => lyingProxy({ a: 1, b: 2, c: 3 }, "c", 99),
    strict: [false, true],
    loose: [false, true],
    looseBug: [undefined, "reports not equal"],
  },
  {
    first: "{ b: 2, a: 1, c: 99 }",
    second: "a Proxy of { a: 1, b: 2, c: 3 } whose get trap answers 99 for c",
    a: () => ({ b: 2, a: 1, c: 99 }),
    b: () => lyingProxy({ a: 1, b: 2, c: 3 }, "c", 99),
    strict: [true, false],
    loose: [true, false],
    looseBug: [undefined, "reports equal"],
  },
  {
    first: "{ a: 99, c: 3, b: 2 }",
    second: "a Proxy of { a: 1, b: 2, c: 3 } whose get trap answers 99 for a",
    a: () => ({ a: 99, c: 3, b: 2 }),
    b: () => lyingProxy({ a: 1, b: 2, c: 3 }, "a", 99),
    strict: [true, true],
    loose: [true, true],
  },
  {
    first: "{ a: 1, c: 3, b: 2 }",
    second: "a Proxy of { a: 1, b: 2, c: 3 } whose get trap answers 99 for a",
    a: () => ({ a: 1, c: 3, b: 2 }),
    b: () => lyingProxy({ a: 1, b: 2, c: 3 }, "a", 99),
    strict: [false, false],
    loose: [false, false],
  },
  // A descriptor that holds undefined is a data descriptor all the same.
  {
    first: "{ b: 2, a: 5 }",
    second: "a Proxy of { a: undefined, b: 2 } whose get trap answers 5 for a",
    a: () => ({ b: 2, a: 5 }),
    b: () => lyingProxy({ a: undefined, b: 2 }, "a", 5),
    strict: [true, false],
    loose: [true, false],
    looseBug: [undefined, "reports equal"],
  },
  {
    first: "{ b: 2, a: undefined }",
    second: "a Proxy of { a: undefined, b: 2 } whose get trap answers 5 for a",
    a: () => ({ b: 2, a: undefined }),
    b: () => lyingProxy({ a: undefined, b: 2 }, "a", 5),
    strict: [false, true],
    loose: [false, true],
    looseBug: [undefined, "reports not equal"],
  },
  // The first operand has to own each key of the second, enumerable.
  {
    first: "{ x: 1 }",
    second: "{ y: 2 } with a non-enumerable x: 1",
    a: () => ({ x: 1 }),
    b: () => Object.defineProperty({ y: 2 }, "x", { value: 1 }),
    strict: [false, false],
    loose: [false, false],
  },
  {
    first: "[1] with x: 1",
    second: "[1] with y: 2 and a non-enumerable x: 1",
    a: () => Object.assign([1], { x: 1 }),
    b: () => Object.defineProperty(Object.assign([1], { y: 2 }), "x", { value: 1 }),
    strict: [false, false],
    loose: [false, false],
    looseBug: ["reports equal", "reports equal"],
  },
  {
    first: "a Uint8Array with x: 1",
    second: "a Uint8Array with y: 2 and a non-enumerable x: 1",
    a: () => Object.assign(new Uint8Array(1), { x: 1 }),
    b: () => Object.defineProperty(Object.assign(new Uint8Array(1), { y: 2 }), "x", { value: 1 }),
    strict: [false, false],
    loose: [false, false],
    looseBug: ["reports equal", "reports equal"],
  },
  // Node lists string keys before symbol keys, whatever order an object or an ownKeys trap has them in.
  {
    first: "{ a: 1, [sym]: 2 }",
    second: "a Proxy of { a: 1, [sym]: 2 } that lists sym before a and whose get trap answers 99 for a",
    a: () => ({ a: 1, [sym]: 2 }),
    b: () => proxyWithKeysReversed({ a: 1, [sym]: 2 }, { get: (t, k, r) => (k === "a" ? 99 : Reflect.get(t, k, r)) }),
    strict: [false, false],
    loose: [false, false],
  },
  {
    first: "{ a: 99, [sym]: 2 }",
    second: "a Proxy of { a: 1, [sym]: 2 } that lists sym before a and whose get trap answers 99 for a",
    a: () => ({ a: 99, [sym]: 2 }),
    b: () => proxyWithKeysReversed({ a: 1, [sym]: 2 }, { get: (t, k, r) => (k === "a" ? 99 : Reflect.get(t, k, r)) }),
    strict: [true, true],
    loose: [true, true],
  },
  {
    first: "{ [sym]: 2, a: 1 }",
    second: "{ a: 1, [sym]: 2 }",
    a: () => ({ [sym]: 2, a: 1 }),
    b: () => ({ a: 1, [sym]: 2 }),
    strict: [true, true],
    loose: [true, true],
  },
  // Both operands need the same number of string keys before any value is read.
  {
    first: "{ get a() { this[sym] = 2; return 1 }, b: 2 }",
    second: "{ a: 1, [sym]: 2 }",
    a: () => ({
      get a() {
        (this as any)[sym] = 2;
        return 1;
      },
      b: 2,
    }),
    b: () => ({ a: 1, [sym]: 2 }),
    strict: [false, false],
    loose: [false, false],
    looseBug: [undefined, "reports equal"],
  },
  {
    first: "{ a: 1, b: 2 }",
    second: "{ get a() { throw }, [sym]: 2 }",
    a: () => ({ a: 1, b: 2 }),
    b: () => ({
      get a(): number {
        throw new RangeError("from the getter");
      },
      [sym]: 2,
    }),
    strict: [false, false],
    loose: [false, false],
    looseBug: ["throws a RangeError", "throws a RangeError"],
  },
  // A pair of arrays that holds a Proxy: length and elements by [[Get]], other keys as above.
  {
    first: "[1, 2]",
    second: "a Proxy of [1, 2] whose get trap answers 3 for length",
    a: () => [1, 2],
    b: () => lyingProxy([1, 2], "length", 3),
    strict: [false, false],
    loose: [false, false],
    looseBug: ["reports equal", "reports equal"],
  },
  {
    first: "[9, 2]",
    second: "a Proxy of [1, 2] whose get trap answers 3 for length and 9 for 0",
    a: () => [9, 2],
    b: () => new Proxy([1, 2], { get: (t, k, r) => (k === "length" ? 3 : k === "0" ? 9 : Reflect.get(t, k, r)) }),
    strict: [false, false],
    loose: [false, false],
    looseBug: ["reports equal", "reports equal"],
  },
  {
    first: "[1, 2]",
    second: "a Proxy of [1, 2] whose get trap answers '2' for length",
    a: () => [1, 2],
    b: () => lyingProxy([1, 2], "length", "2"),
    strict: [false, false],
    loose: [false, false],
    looseBug: ["reports equal", "reports equal"],
  },
  {
    first: "[9] with x: 1",
    second: "a Proxy of [1] with x: 1 that lists x before 0 and whose get trap answers 9 for 0",
    a: () => Object.assign([9], { x: 1 }),
    b: () =>
      proxyWithKeysReversed(Object.assign([1], { x: 1 }), { get: (t, k, r) => (k === "0" ? 9 : Reflect.get(t, k, r)) }),
    strict: [true, true],
    loose: [true, true],
  },
  {
    first: "[1] with x: 1",
    second: "a Proxy of [1] with x: 1 that lists x before 0 and whose get trap answers 9 for 0",
    a: () => Object.assign([1], { x: 1 }),
    b: () =>
      proxyWithKeysReversed(Object.assign([1], { x: 1 }), { get: (t, k, r) => (k === "0" ? 9 : Reflect.get(t, k, r)) }),
    strict: [false, false],
    loose: [false, false],
  },
  {
    first: "[1, , 3]",
    second: "a Proxy of [1, undefined, 3]",
    a: () => [1, , 3],
    b: () => new Proxy([1, undefined, 3], {}),
    strict: [false, false],
    loose: [false, false],
    looseBug: [undefined, "reports equal"],
  },
  {
    first: "[1, , 3]",
    second: "a Proxy of [1, , 3]",
    a: () => [1, , 3],
    b: () => new Proxy([1, , 3], {}),
    strict: [true, true],
    loose: [true, true],
  },
  // From the first hole on, node reads the rest of both arrays again by key, with [[Get]] on both.
  {
    first: "[1, , 3] with x: 1",
    second: "a Proxy of [1, , 3] with x: 1 whose get trap answers 2 for x",
    a: () => sparseArray({ x: 1 }),
    b: () => lyingProxy(sparseArray({ x: 1 }), "x", 2),
    strict: [false, false],
    loose: [false, false],
  },
  {
    first: "[1, , 3] with x: 2",
    second: "a Proxy of [1, , 3] with x: 1 whose get trap answers 2 for x",
    a: () => sparseArray({ x: 2 }),
    b: () => lyingProxy(sparseArray({ x: 1 }), "x", 2),
    strict: [true, false],
    loose: [true, false],
    looseBug: [undefined, "reports equal"],
  },
  {
    first: "[1, , 3] with x: 5",
    second: "a Proxy of [1, , 3] with x: 1 whose getOwnPropertyDescriptor trap answers 5 for x",
    a: () => sparseArray({ x: 5 }),
    b: () => proxyWithDescriptor(sparseArray({ x: 1 }), "x", 5),
    strict: [false, false],
    loose: [false, false],
  },
  {
    first: "[, 1] with x: 1, y: undefined",
    second: "[, 1] with a getter x that deletes y, and y: 2",
    a: () => Object.assign([, 1], { x: 1, y: undefined }),
    b: () => withGetterThatDeletes([, 1]),
    strict: [false, false],
    loose: [false, false],
    looseBug: ["reports equal", "reports equal"],
  },
  // Cycles behind a Proxy.
  {
    first: "a self-referencing object",
    second: "a deep Proxy of one",
    a: selfReferencingObject,
    b: () => deepProxy(selfReferencingObject()),
    strict: [true, true],
    loose: [true, true],
  },
  {
    first: "a deep Proxy of a self-referencing object",
    second: "another one",
    a: () => deepProxy(selfReferencingObject()),
    b: () => deepProxy(selfReferencingObject()),
    strict: [true, true],
    loose: [true, true],
  },
  {
    first: "a self-referencing array",
    second: "a deep Proxy of one",
    a: selfReferencingArray,
    b: () => deepProxy(selfReferencingArray()),
    strict: [true, true],
    loose: [true, true],
  },
  {
    first: "{ self: itself, a: 1 }",
    second: "a deep Proxy of { a: 1, self: itself }",
    a: () => selfReferencingWith({ a: 1 }, true),
    b: () => deepProxy(selfReferencingWith({ a: 1 }, false)),
    strict: [true, false],
    loose: [true, false],
    looseBug: [undefined, "reports equal"],
  },
  // A Proxy that unwraps refs: its own property descriptor holds the ref, a read gives the value.
  {
    first: "a Proxy that unwraps the ref in { count: ref(1), name: 'x' }",
    second: "another one",
    a: () => unwrappingProxy({ count: ref(1), name: "x" }),
    b: () => unwrappingProxy({ count: ref(1), name: "x" }),
    strict: [true, true],
    loose: [true, true],
  },
  {
    first: "{ count: 1, name: 'x' }",
    second: "a Proxy that unwraps the ref in { count: ref(1), name: 'x' }",
    a: () => ({ count: 1, name: "x" }),
    b: () => unwrappingProxy({ count: ref(1), name: "x" }),
    strict: [true, true],
    loose: [true, true],
  },
  {
    first: "{ name: 'x', count: 1 }",
    second: "a Proxy that unwraps the ref in { count: ref(1), name: 'x' }",
    a: () => ({ name: "x", count: 1 }),
    b: () => unwrappingProxy({ count: ref(1), name: "x" }),
    strict: [true, false],
    loose: [true, false],
    looseBug: [undefined, "reports equal"],
  },
  // An element that is an accessor is read with [[Get]], on either operand.
  {
    first: "[1, 2, 3]",
    second: "[1, 2, 3] whose second element is a getter",
    a: () => [1, 2, 3],
    b: () => withAccessorElement([1, 2, 3], 1, 2),
    strict: [true, true],
    loose: [true, true],
    looseBug: ["reports not equal", "reports not equal"],
  },
  {
    first: "[1, 9, 3]",
    second: "[1, 2, 3] whose second element is a getter",
    a: () => [1, 9, 3],
    b: () => withAccessorElement([1, 2, 3], 1, 2),
    strict: [false, false],
    loose: [false, false],
  },
  {
    first: "[1, 2, 3] whose second element is a getter",
    second: "[1, 9, 3] whose second element is a getter",
    a: () => withAccessorElement([1, 2, 3], 1, 2),
    b: () => withAccessorElement([1, 9, 3], 1, 9),
    strict: [false, false],
    loose: [false, false],
    looseBug: ["reports equal", "reports equal"],
  },
  {
    first: "[1, 2, 3] whose second element is a getter, with a getter x",
    second: "another such array",
    a: () => withGetterX(withAccessorElement([1, 2, 3], 1, 2)),
    b: () => withGetterX(withAccessorElement([1, 2, 3], 1, 2)),
    strict: [true, true],
    loose: [true, true],
  },
  // Node reads the length of the first array again for each element: a getter that ran before can change it.
  {
    first: "[1, 2, 3] with a getter x that sets its length to 1",
    second: "[1, 2, 3] with x: 1",
    a: () => withGetterX([1, 2, 3], array => void (array.length = 1)),
    b: () => Object.assign([1, 2, 3], { x: 1 }),
    strict: [true, false],
    loose: [true, false],
    looseBug: [undefined, "reports equal"],
  },
  {
    first: "[1, 2, 3] with a getter x that pushes a fourth element",
    second: "[1, 2, 3] with x: 1",
    a: () => withGetterX([1, 2, 3], array => void array.push(4)),
    b: () => Object.assign([1, 2, 3], { x: 1 }),
    strict: [false, true],
    loose: [false, true],
    looseBug: ["reports equal", undefined],
  },
  {
    first: "[] with a getter x that pushes an element",
    second: "[] with x: 1",
    a: () => withGetterX([] as number[], array => void array.push(1)),
    b: () => Object.assign([], { x: 1 }),
    strict: [false, true],
    loose: [false, true],
    looseBug: ["reports equal", undefined],
  },
  // A function, and a Proxy of one, is equal to nothing but itself.
  {
    first: "a Proxy of a function",
    second: "a Proxy of another function",
    a: () => new Proxy(function () {}, {}),
    b: () => new Proxy(function () {}, {}),
    strict: [false, false],
    loose: [false, false],
    looseBug: ["reports equal", "reports equal"],
  },
  {
    first: "{ h: a Proxy of a function }",
    second: "{ h: a Proxy of another function }",
    a: () => ({ h: new Proxy(function () {}, {}) }),
    b: () => ({ h: new Proxy(function () {}, {}) }),
    strict: [false, false],
    loose: [false, false],
    looseBug: ["reports equal", "reports equal"],
  },
  {
    first: "a Proxy of a function",
    second: "{}",
    a: () => new Proxy(function () {}, {}),
    b: () => ({}),
    strict: [false, false],
    loose: [false, false],
    looseBug: ["reports equal", "reports equal"],
  },
  // More pairs of arrays that hold a Proxy.
  {
    first: "[1]",
    second: "a Proxy of [undefined]",
    a: () => [1],
    b: () => new Proxy([undefined], {}),
    strict: [false, false],
    loose: [false, false],
  },
  {
    first: "[1] with x: 1, y: 2",
    second: "a Proxy of [1] with x: 1",
    a: () => Object.assign([1], { x: 1, y: 2 }),
    b: () => new Proxy(Object.assign([1], { x: 1 }), {}),
    strict: [false, false],
    loose: [false, false],
  },
  {
    first: "[1, 2, 3]",
    second: "a Proxy of [1, 2, 3, 4, 5] whose get trap answers 3 for length",
    a: () => [1, 2, 3],
    b: () => lyingProxy([1, 2, 3, 4, 5], "length", 3),
    strict: [true, true],
    loose: [true, true],
    looseBug: ["reports not equal", "reports not equal"],
  },
  {
    first: "[1, 1, 1]",
    second: "a Proxy of [] whose get trap answers 3 for length and 1 for every index",
    a: () => [1, 1, 1],
    b: () =>
      virtualArray(
        () => 3,
        () => 1,
      ),
    strict: [true, true],
    loose: [true, true],
    looseBug: ["reports not equal", "reports not equal"],
  },
  {
    first: "a Proxy of [] whose get trap answers 3 for length and 1 for every index",
    second: "a Proxy of [] whose get trap answers 3 for length and 2 for every index",
    a: () =>
      virtualArray(
        () => 3,
        () => 1,
      ),
    b: () =>
      virtualArray(
        () => 3,
        () => 2,
      ),
    strict: [false, false],
    loose: [false, false],
    looseBug: ["reports equal", "reports equal"],
  },
  // The length of the first array is read again for each element: a Proxy can answer less each time.
  {
    first: "a Proxy of [] whose length reads 3, 3, then 1, with 1 for every index",
    second: "[1, 9, 9]",
    a: () => {
      let reads = 0;
      return virtualArray(
        () => (reads++ < 2 ? 3 : 1),
        () => 1,
      );
    },
    b: () => [1, 9, 9],
    strict: [true, false],
    loose: [true, false],
    looseBug: ["reports not equal", undefined],
  },
  // With no other key, node takes `val2.size === 0` for two equal arrays (keyCheck).
  {
    first: "[1, 2]",
    second: "a Proxy of [3, 4] whose get trap answers 0 for size",
    a: () => [1, 2],
    b: () => lyingProxy([3, 4], "size", 0),
    strict: [true, false],
    loose: [true, false],
    looseBug: ["reports not equal", undefined],
  },
  // Arrays with holes and other keys.
  {
    first: "[1]",
    second: "[1] with x: 1",
    a: () => [1],
    b: () => Object.assign([1], { x: 1 }),
    strict: [false, false],
    loose: [false, false],
    looseBug: ["reports equal", "reports equal"],
  },
  {
    first: "[1, , , 4] with x: 1",
    second: "[1, , undefined, ,] with x: 1",
    a: () => Object.assign([1, , , 4], { x: 1 }),
    b: () => Object.assign([1, , undefined, ,], { x: 1 }),
    strict: [false, false],
    loose: [false, false],
  },
  {
    first: "[1, , 3] whose third element is a getter",
    second: "[1, , 3]",
    a: () => withAccessorElement([1, , 3], 2, 3),
    b: () => [1, , 3],
    strict: [true, true],
    loose: [true, true],
    looseBug: ["reports not equal", "reports not equal"],
  },
  // A private field is no property: node compares none of them.
  {
    first: "a class instance whose private field holds 1",
    second: "an instance of that class whose private field holds 2",
    a: () => new WithPrivate(1),
    b: () => new WithPrivate(2),
    strict: [true, true],
    loose: [true, true],
  },
  {
    first: "a class instance with a private field that holds 1, then a symbol key",
    second: "an instance of that class whose private field holds 2",
    a: () => new PrivateThenSymbol(1),
    b: () => new PrivateThenSymbol(2),
    strict: [true, true],
    loose: [true, true],
  },
  {
    first: "a class instance with a symbol key, then a private field that holds 1",
    second: "an instance of that class whose private field holds 2",
    a: () => new SymbolThenPrivate(1),
    b: () => new SymbolThenPrivate(2),
    strict: [true, true],
    loose: [true, true],
  },
  // Known differences: Map and Set entries, and the keys of an Error, are still read by other walks.
  {
    first: "a Map holding { b: 2, a: 1 }",
    second: "a Map holding a Proxy of { a: 1, b: 2 } whose get trap answers 99 for a",
    a: () => new Map([["k", { b: 2, a: 1 }]]),
    b: () => new Map([["k", lyingProxy({ a: 1, b: 2 }, "a", 99)]]),
    strict: [false, true],
    loose: [false, true],
    strictBug: [undefined, "reports not equal"],
    looseBug: [undefined, "reports not equal"],
  },
  {
    first: "a Set holding { b: 2, a: 1 }",
    second: "a Set holding a Proxy of { a: 1, b: 2 } whose get trap answers 99 for a",
    a: () => new Set([{ b: 2, a: 1 }]),
    b: () => new Set([lyingProxy({ a: 1, b: 2 }, "a", 99)]),
    strict: [false, true],
    loose: [false, true],
    strictBug: [undefined, "reports not equal"],
    looseBug: [undefined, "reports not equal"],
  },
  {
    first: "an Error with x: 1",
    second: "an Error with y: 1 and a non-enumerable x: 1",
    a: () => Object.assign(new Error("m"), { x: 1 }),
    b: () => Object.defineProperty(Object.assign(new Error("m"), { y: 1 }), "x", { value: 1 }),
    strict: [false, false],
    loose: [false, false],
    strictBug: ["reports equal", undefined],
    looseBug: ["reports equal", undefined],
  },
  {
    first: "an Error with an enumerable stack 'A'",
    second: "an Error with an enumerable stack 'B'",
    a: () => Object.defineProperty(new Error("m"), "stack", { value: "A", enumerable: true }),
    b: () => Object.defineProperty(new Error("m"), "stack", { value: "B", enumerable: true }),
    strict: [false, false],
    loose: [false, false],
    strictBug: ["reports equal", "reports equal"],
    looseBug: ["reports equal", "reports equal"],
  },
  // Known difference: two objects of one shape are compared from values that are all read first.
  {
    first: "{ a: { get b() { delete the b of the parent } }, b: 1 }",
    second: "{ a: { get b() { delete the b of the parent } }, b: {} }",
    a: () => withChildThatDeletesB(1),
    b: () => withChildThatDeletesB({}),
    strict: [true, true],
    loose: [true, true],
    strictBug: ["reports not equal", "reports not equal"],
    looseBug: ["reports not equal", "reports not equal"],
  },
  // Known difference: a Map or a Set compares a pair of entries more than once, so such a getter runs too often.
  {
    first: "a Map holding [<hole>] with a getter x that pushes an element",
    second: "another such Map",
    a: () => new Map([["k", withGetterX(new Array<number>(1), array => void array.push(1))]]),
    b: () => new Map([["k", withGetterX(new Array<number>(1), array => void array.push(1))]]),
    strict: [true, true],
    loose: [true, true],
    strictBug: ["reports not equal", "reports not equal"],
  },
  // An array behind a Proxy with no trap, and with a get trap that answers for its length.
  {
    first: "[1, 2, 3]",
    second: "a Proxy of [1, 2, 3]",
    a: () => [1, 2, 3],
    b: () => new Proxy([1, 2, 3], {}),
    strict: [true, true],
    loose: [true, true],
  },
  {
    first: "a Proxy of [1, 2, 3] whose get trap answers 7 for length",
    second: "another such Proxy",
    a: () => lyingProxy([1, 2, 3], "length", 7),
    b: () => lyingProxy([1, 2, 3], "length", 7),
    strict: [true, true],
    loose: [true, true],
  },
  // A hole at the end of an array has no key: only the lengths tell such an array from a Proxy of a shorter one.
  {
    first: "[1, <hole>]",
    second: "a Proxy of [1]",
    a: () => [1, ,],
    b: () => new Proxy([1], {}),
    strict: [false, false],
    loose: [false, false],
    looseBug: ["reports equal", "reports equal"],
  },
  {
    first: "[<hole>]",
    second: "a Proxy of []",
    a: () => [,],
    b: () => new Proxy([], {}),
    strict: [false, false],
    loose: [false, false],
    looseBug: ["reports equal", "reports equal"],
  },
  {
    first: "a Proxy of [1, <hole>]",
    second: "a Proxy of [1]",
    a: () => new Proxy([1, ,], {}),
    b: () => new Proxy([1], {}),
    strict: [false, false],
    loose: [false, false],
    looseBug: ["reports equal", "reports equal"],
  },
  {
    first: "[1, <hole>]",
    second: "a Proxy of [1, <hole>]",
    a: () => [1, ,],
    b: () => new Proxy([1, ,], {}),
    strict: [true, true],
    loose: [true, true],
  },
  // An element that is a getter is read, whether it is enumerable or not. A hole is no element.
  {
    first: "[1, <hole>]",
    second: "[1, 2] whose second element is a getter",
    a: () => [1, ,],
    b: () => withAccessorElement([1, 2], 1, 2),
    strict: [false, false],
    loose: [false, false],
    looseBug: ["reports equal", "reports equal"],
  },
  {
    first: "[1, 2]",
    second: "[1, 2] whose second element is a getter that is not enumerable",
    a: () => [1, 2],
    b: () => Object.defineProperty([1, 2], 1, { enumerable: false, configurable: true, get: () => 2 }),
    strict: [true, true],
    loose: [true, true],
    looseBug: ["reports not equal", "reports not equal"],
  },
  {
    first: "[1, 3]",
    second: "[1, 2] whose second element is a getter that is not enumerable",
    a: () => [1, 3],
    b: () => Object.defineProperty([1, 2], 1, { enumerable: false, configurable: true, get: () => 2 }),
    strict: [false, false],
    loose: [false, false],
  },
  {
    first: "[1, 2]",
    second: "[1, 2] whose second element is not enumerable",
    a: () => [1, 2],
    b: () => Object.defineProperty([1, 2], 1, { enumerable: false }),
    strict: [true, true],
    loose: [true, true],
  },
  {
    first: "[1, <hole>]",
    second: "[1, 2] whose second element is a getter that is not enumerable",
    a: () => [1, ,],
    b: () => Object.defineProperty([1, 2], 1, { enumerable: false, configurable: true, get: () => 2 }),
    strict: [false, true],
    loose: [false, true],
    looseBug: ["reports equal", undefined],
  },
  {
    first: "[1, <hole>]",
    second: "[1, 2] whose second element is not enumerable",
    a: () => [1, ,],
    b: () => Object.defineProperty([1, 2], 1, { enumerable: false }),
    strict: [false, true],
    loose: [false, true],
    looseBug: [undefined, "reports not equal"],
  },
  // Node compares what the two values answer for Symbol.toStringTag where both answer, and always for arrays. A get
  // trap that answers a new function for every key answers a new one for that key too.
  {
    first: "a Proxy of { a: 1 } whose get trap answers a new function for every other key",
    second: "another such Proxy",
    a: () => mockingProxy({ a: 1 }),
    b: () => mockingProxy({ a: 1 }),
    strict: [false, false],
    loose: [false, false],
    looseBug: ["reports equal", "reports equal"],
  },
  {
    first: "a Proxy of [1] whose get trap answers a new function for every other key",
    second: "another such Proxy",
    a: () => mockingProxy([1]),
    b: () => mockingProxy([1]),
    strict: [false, false],
    loose: [false, false],
    looseBug: ["reports equal", "reports equal"],
  },
  {
    first: "a Proxy of [1] whose get trap answers a new function for every other key",
    second: "[1]",
    a: () => mockingProxy([1]),
    b: () => [1],
    strict: [false, false],
    loose: [false, false],
    looseBug: ["reports equal", "reports equal"],
  },
  {
    first: "a Proxy of { a: 1 } whose get trap answers 'X' for Symbol.toStringTag",
    second: "another such Proxy",
    a: () => lyingProxy({ a: 1 }, Symbol.toStringTag, "X"),
    b: () => lyingProxy({ a: 1 }, Symbol.toStringTag, "X"),
    strict: [true, true],
    loose: [true, true],
  },
  {
    first: "a Proxy of { a: 1 } whose get trap answers 'X' for Symbol.toStringTag",
    second: "one that answers 'Y'",
    a: () => lyingProxy({ a: 1 }, Symbol.toStringTag, "X"),
    b: () => lyingProxy({ a: 1 }, Symbol.toStringTag, "Y"),
    strict: [false, false],
    loose: [false, false],
    looseBug: ["reports equal", "reports equal"],
  },
  {
    first: "a Proxy of { a: 1 } whose get trap answers 1 for Symbol.toStringTag",
    second: "one that answers 2",
    a: () => lyingProxy({ a: 1 }, Symbol.toStringTag, 1),
    b: () => lyingProxy({ a: 1 }, Symbol.toStringTag, 2),
    strict: [false, false],
    loose: [false, false],
    looseBug: ["reports equal", "reports equal"],
  },
  {
    first: "a Proxy of { a: 1 } whose get trap answers 1 for Symbol.toStringTag",
    second: "{ a: 1 }",
    a: () => lyingProxy({ a: 1 }, Symbol.toStringTag, 1),
    b: () => ({ a: 1 }),
    strict: [true, true],
    loose: [true, true],
  },
  // Known difference: for anything but a Proxy, Bun compares the strings that Object.prototype.toString makes of the tags.
  {
    first: "[1] with a hidden Symbol.toStringTag 'Array'",
    second: "[1]",
    a: () => withHiddenProperty([1], Symbol.toStringTag, "Array"),
    b: () => [1],
    strict: [false, false],
    loose: [false, false],
    strictBug: ["reports equal", "reports equal"],
    looseBug: ["reports equal", "reports equal"],
  },
  {
    first: "{ a: 1 } with a hidden Symbol.toStringTag 1",
    second: "{ a: 1 } with a hidden Symbol.toStringTag 2",
    a: () => withHiddenProperty({ a: 1 }, Symbol.toStringTag, 1),
    b: () => withHiddenProperty({ a: 1 }, Symbol.toStringTag, 2),
    strict: [false, false],
    loose: [false, false],
    strictBug: ["reports equal", "reports equal"],
    looseBug: ["reports equal", "reports equal"],
  },
  // From the first hole on, Node takes the index of the hole for a place in the list of keys. Where a key before the
  // hole is not in that list, it steps over as many keys behind the hole: two arrays that differ there are equal.
  {
    first: "[<hidden 1>, 2, <hole>, 4]",
    second: "[<hidden 1>, 2, <hole>, 99]",
    a: () => withHiddenFirstElement(2, undefined, 4),
    b: () => withHiddenFirstElement(2, undefined, 99),
    strict: [true, true],
    loose: [true, true],
    looseBug: ["reports not equal", "reports not equal"],
  },
  {
    first: "[<inherited 1>, 2, <hole>, 4]",
    second: "[<inherited 1>, 2, <hole>, 99]",
    a: () => withInheritedFirstElement(2, undefined, 4),
    b: () => withInheritedFirstElement(2, undefined, 99),
    strict: [true, true],
    loose: [true, true],
    looseBug: ["reports not equal", "reports not equal"],
  },
  {
    first: "[<hidden 1>, 2, <hole>, 4, 5]",
    second: "[<hidden 1>, 2, <hole>, 4, 99]",
    a: () => withHiddenFirstElement(2, undefined, 4, 5),
    b: () => withHiddenFirstElement(2, undefined, 4, 99),
    strict: [false, false],
    loose: [false, false],
  },
  {
    first: "[1, <hole>, 3]",
    second: "a Proxy of [1, <hole>, 4] that lists its keys in the opposite order",
    a: () => [1, , 3],
    b: () => proxyWithKeysReversed([1, , 4]),
    strict: [true, false],
    loose: [true, false],
    looseBug: ["reports not equal", undefined],
  },
  // Arrays that JavaScriptCore stores another way: frozen, sealed, closed to new properties, or after a shift().
  {
    first: "[1, <hole>, 3]",
    second: "a frozen [1, <hole>, 3]",
    a: () => [1, , 3],
    b: () => Object.freeze([1, , 3]),
    strict: [true, true],
    loose: [true, true],
  },
  {
    first: "[1, <hole>, 3]",
    second: "a frozen [1, <hole>, 4]",
    a: () => [1, , 3],
    b: () => Object.freeze([1, , 4]),
    strict: [false, false],
    loose: [false, false],
  },
  {
    first: "[1, <hole>, 3]",
    second: "a sealed [1, <hole>, 3]",
    a: () => [1, , 3],
    b: () => Object.seal([1, , 3]),
    strict: [true, true],
    loose: [true, true],
  },
  {
    first: "[1, <hole>, 3]",
    second: "a [1, <hole>, 3] that takes no new property",
    a: () => [1, , 3],
    b: () => Object.preventExtensions([1, , 3]),
    strict: [true, true],
    loose: [true, true],
  },
  {
    first: "a frozen [1, <hole>, 3] with x: 1",
    second: "a frozen [1, <hole>, 3] with x: 2",
    a: () => Object.freeze(Object.assign([1, , 3], { x: 1 })),
    b: () => Object.freeze(Object.assign([1, , 3], { x: 2 })),
    strict: [false, false],
    loose: [false, false],
    looseBug: ["reports equal", "reports equal"],
  },
  {
    first: "200 numbers after a shift(), with a hole",
    second: "a copy of them",
    a: () => withHole(shiftedArray(200), 100),
    b: () => withHole(shiftedArray(200).slice(), 100),
    strict: [true, true],
    loose: [true, true],
  },
  {
    first: "200 numbers after a shift(), with a hole",
    second: "the same with another last number",
    a: () => withHole(shiftedArray(200), 100),
    b: () => withHole(shiftedArray(200).with(199, -1), 100),
    strict: [false, false],
    loose: [false, false],
  },
  {
    first: "200 numbers after a shift(), with a hole",
    second: "the same with the hole one place on",
    a: () => withHole(shiftedArray(200), 100),
    b: () => withHole(shiftedArray(200), 101),
    strict: [false, false],
    loose: [false, false],
  },
  // With no other key, Node calls two arrays equal where the second answers 0 for `size`.
  {
    first: "an Array subclass instance that answers 0 for size and holds 'x', 'y'",
    second: "another that holds 'p', 'q'",
    a: () => new Ring(2).add("x").add("y").clear(),
    b: () => new Ring(2).add("p").add("q").clear(),
    strict: [true, true],
    loose: [true, true],
    looseBug: ["reports not equal", "reports not equal"],
  },
  {
    first: "an Array subclass instance that answers 1 for size and holds 'x'",
    second: "another that holds 'p'",
    a: () => new Ring(2).add("x"),
    b: () => new Ring(2).add("p"),
    strict: [false, false],
    loose: [false, false],
  },
  {
    first: "[1, 2] with a hidden size 0",
    second: "[3, 4] with a hidden size 0",
    a: () => withHiddenProperty([1, 2], "size", 0),
    b: () => withHiddenProperty([3, 4], "size", 0),
    strict: [true, true],
    loose: [true, true],
    looseBug: ["reports not equal", "reports not equal"],
  },
  {
    first: "[1, 2]",
    second: "[3, 4] with a hidden size 0",
    a: () => [1, 2],
    b: () => withHiddenProperty([3, 4], "size", 0),
    strict: [true, false],
    loose: [true, false],
    looseBug: ["reports not equal", undefined],
  },
  // Known difference: Bun takes the size of a Map or a Set from the collection, Node from its `size`.
  {
    first: "a Map subclass instance that answers 0 for size and holds a: 1",
    second: "another that holds a: 2",
    a: () => new MapOfSizeZero([["a", 1]]),
    b: () => new MapOfSizeZero([["a", 2]]),
    strict: [true, true],
    loose: [true, true],
    strictBug: ["reports not equal", "reports not equal"],
    looseBug: ["reports not equal", "reports not equal"],
  },
  {
    first: "a Set subclass instance that answers 0 for size and holds 1",
    second: "another that holds 2",
    a: () => new SetOfSizeZero([1]),
    b: () => new SetOfSizeZero([2]),
    strict: [true, true],
    loose: [true, true],
    strictBug: ["reports not equal", "reports not equal"],
    looseBug: ["reports not equal", "reports not equal"],
  },
  // Known difference: Bun calls two values that hold themselves equal only where both were first met together. Node
  // calls them equal where both are on the way from the two roots.
  {
    first: "{ v: 1, n: { v: 1, n: <that child> } }",
    second: "{ v: 1, n: { v: 1, n: <the root> } }",
    a: () => {
      const root = { v: 1, n: { v: 1, n: null as unknown } };
      root.n.n = root.n;
      return root;
    },
    b: () => {
      const root = { v: 1, n: { v: 1, n: null as unknown } };
      root.n.n = root;
      return root;
    },
    strict: [true, true],
    loose: [true, true],
    strictBug: ["reports not equal", "reports not equal"],
    looseBug: ["reports not equal", "reports not equal"],
  },
  {
    first: "[1, [1, <that child>]]",
    second: "[1, [1, <the root>]]",
    a: () => {
      const root: unknown[] = [1, [1, null]];
      (root[1] as unknown[])[1] = root[1];
      return root;
    },
    b: () => {
      const root: unknown[] = [1, [1, null]];
      (root[1] as unknown[])[1] = root;
      return root;
    },
    strict: [true, true],
    loose: [true, true],
    strictBug: ["reports not equal", "reports not equal"],
    looseBug: ["reports not equal", "reports not equal"],
  },
  // Node reads nothing of what `typeof` does not call an object.
  {
    first: "a revoked Proxy of a function",
    second: "a function",
    a: () => revokedProxyOfFunction(),
    b: () => function () {},
    strict: [false, false],
    loose: [false, false],
  },
  {
    first: "a function with a constructor getter that throws",
    second: "a function",
    a: () =>
      Object.defineProperty(function () {}, "constructor", {
        get() {
          throw new RangeError("from the constructor getter");
        },
      }),
    b: () => function () {},
    strict: [false, false],
    loose: [false, false],
  },
  {
    first: "a Proxy of {} whose every trap throws",
    second: "a function",
    a: () => proxyWhoseTrapsThrow(),
    b: () => function () {},
    strict: [false, false],
    loose: [false, false],
  },
  // Known difference: Node turns down a WeakMap, a WeakSet and a Promise as its first value only, and a Proxy of one
  // is none to it. Bun turns one down on either side.
  {
    first: "a Proxy of a Promise",
    second: "that Promise",
    a: () => new Proxy(sharedPromise, {}),
    b: () => sharedPromise,
    strict: [true, false],
    loose: [true, false],
    strictBug: ["reports not equal", undefined],
    looseBug: [undefined, "reports equal"],
  },
  {
    first: "a Proxy of a WeakMap",
    second: "that WeakMap",
    a: () => new Proxy(sharedWeakMap, {}),
    b: () => sharedWeakMap,
    strict: [true, false],
    loose: [true, false],
    strictBug: ["reports not equal", undefined],
    looseBug: [undefined, "reports equal"],
  },
  {
    first: "a Proxy of a WeakSet",
    second: "that WeakSet",
    a: () => new Proxy(sharedWeakSet, {}),
    b: () => sharedWeakSet,
    strict: [true, false],
    loose: [true, false],
    strictBug: ["reports not equal", undefined],
    looseBug: [undefined, "reports equal"],
  },
];

for (const { first, second, a, b, strict, loose, strictBug, looseBug } of orderedPairs) {
  cases.push(
    {
      name: `${first} and ${second}`,
      a,
      b,
      strict: strict[0],
      loose: loose[0],
      strictBug: strictBug?.[0],
      looseBug: looseBug?.[0],
    },
    {
      name: `${second} and ${first}`,
      a: b,
      b: a,
      strict: strict[1],
      loose: loose[1],
      strictBug: strictBug?.[1],
      looseBug: looseBug?.[1],
    },
  );
}

function caught(fn: () => void): (Error & { code?: string }) | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error as Error & { code?: string };
  }
}

// Compares as JSON, not with the deep equality that this file tests.
const same = (actual: unknown, expected: unknown) =>
  assert.strictEqual(JSON.stringify(actual), JSON.stringify(expected));

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
      const options = bug ? { expectFailure: isBun } : {};
      test(bug ? `${label} (Bun ${bug})` : label, options, () => {
        const error = caught(() => equal(testCase.a(), testCase.b()));
        if (expected) {
          assert.strictEqual(error?.message ?? null, null);
        } else {
          assert.strictEqual(error?.code, "ERR_ASSERTION");
        }
        assert.strictEqual(caught(() => notEqual(testCase.a(), testCase.b())) === null, !expected);
      });
    }
  });
}

describeMatrix("assert.deepStrictEqual", "strict", "strictBug", assert.deepStrictEqual, assert.notDeepStrictEqual);
describeMatrix("assert.deepEqual", "loose", "looseBug", assert.deepEqual, assert.notDeepEqual);

describe("util.isDeepStrictEqual", () => {
  for (const testCase of cases) {
    const label = `${testCase.name} is ${testCase.strict ? "" : "not "}deep-strict-equal`;
    const options = testCase.strictBug ? { expectFailure: isBun } : {};
    test(testCase.strictBug ? `${label} (Bun ${testCase.strictBug})` : label, options, () => {
      assert.strictEqual(util.isDeepStrictEqual(testCase.a(), testCase.b()), testCase.strict);
    });
  }

  test("never throws on exotic input", () => {
    assert.strictEqual(util.isDeepStrictEqual(undefined, undefined), true);
    assert.strictEqual(util.isDeepStrictEqual(null, undefined), false);
    assert.strictEqual(util.isDeepStrictEqual(Object.create(null), Object.create(null)), true);
  });

  test("reads an array's own symbol-keyed getter once per side", () => {
    const s = Symbol("k");
    let calls = 0;
    const make = () => {
      const a = [1];
      Object.defineProperty(a, s, { enumerable: true, get: () => (calls++, 42) });
      return a;
    };
    assert.strictEqual(util.isDeepStrictEqual(make(), make()), true);
    assert.strictEqual(calls, 2);
  });

  describe("how the operands are read", () => {
    // Logs the get and getOwnPropertyDescriptor traps of `target`.
    function traced(name: string, target: object, log: string[]) {
      return new Proxy(target, {
        get(t, key, receiver) {
          if (typeof key === "string" && key !== "constructor") log.push(`${name}.get:${key}`);
          return Reflect.get(t, key, receiver);
        },
        getOwnPropertyDescriptor(t, key) {
          log.push(`${name}.getOwnPropertyDescriptor:${String(key)}`);
          return Reflect.getOwnPropertyDescriptor(t, key);
        },
      });
    }

    // Both logs are Node's: the keys of the second operand are listed first, then the values are read.
    test("with [[Get]] on both operands while their keys are in the same order", () => {
      const log: string[] = [];
      const equal = util.isDeepStrictEqual(traced("first", { a: 1, b: 2 }, log), traced("second", { a: 1, b: 2 }, log));
      same(
        { equal, log },
        {
          equal: true,
          log: [
            "second.getOwnPropertyDescriptor:a",
            "second.getOwnPropertyDescriptor:b",
            "first.getOwnPropertyDescriptor:a",
            "first.getOwnPropertyDescriptor:b",
            "first.get:a",
            "second.get:a",
            "first.get:b",
            "second.get:b",
          ],
        },
      );
    });

    test("the first operand from its descriptors once the key orders differ", () => {
      const log: string[] = [];
      const equal = util.isDeepStrictEqual(traced("first", { a: 1, b: 2 }, log), traced("second", { b: 2, a: 1 }, log));
      same(
        { equal, log },
        {
          equal: true,
          log: [
            "second.getOwnPropertyDescriptor:b",
            "second.getOwnPropertyDescriptor:a",
            "first.getOwnPropertyDescriptor:a",
            "first.getOwnPropertyDescriptor:b",
            "first.getOwnPropertyDescriptor:b",
            "second.get:b",
            "first.getOwnPropertyDescriptor:a",
            "second.get:a",
          ],
        },
      );
    });

    test("each value once, up to the first difference", () => {
      const log: string[] = [];
      const equal = util.isDeepStrictEqual(
        traced("first", { a: 1, b: 2, c: 3 }, log),
        traced("second", { a: 1, b: 9, c: 3 }, log),
      );
      same(
        { equal, reads: log.filter(entry => entry.includes(".get:")) },
        { equal: false, reads: ["first.get:a", "second.get:a", "first.get:b", "second.get:b"] },
      );
    });

    test("in the key order of the second operand", () => {
      const withThrowingGetter = () => ({
        b: 2,
        get a(): number {
          throw new RangeError("from the getter");
        },
      });
      // `b` differs and comes first in the second operand: `a` is never read.
      assert.strictEqual(util.isDeepStrictEqual({ a: 1, b: 1 }, withThrowingGetter()), false);
      assert.throws(() => util.isDeepStrictEqual(withThrowingGetter(), { a: 1, b: 1 }), {
        name: "RangeError",
        message: "from the getter",
      });
    });

    test("an error from a get trap of either operand is thrown", () => {
      const throwing = () =>
        new Proxy(
          { a: 1 },
          {
            get(t, key, receiver) {
              if (key === "a") throw new RangeError("from the get trap");
              return Reflect.get(t, key, receiver);
            },
          },
        );
      assert.throws(() => util.isDeepStrictEqual({ a: 1 }, throwing()), {
        name: "RangeError",
        message: "from the get trap",
      });
      assert.throws(() => util.isDeepStrictEqual(throwing(), { a: 1 }), {
        name: "RangeError",
        message: "from the get trap",
      });

      // The trap answers 2 for a property that is fixed at 1, which [[Get]] rejects.
      const inconsistent = () => lyingProxy(Object.freeze({ a: 1 }), "a", 2);
      assert.throws(() => util.isDeepStrictEqual({ a: 1 }, inconsistent()), TypeError);
      assert.throws(() => util.isDeepStrictEqual(inconsistent(), { a: 1 }), TypeError);

      // A getter of one operand revokes the other operand before its next value is read.
      const revokedMidway = (): [object, object] => {
        const { proxy, revoke } = Proxy.revocable({ a: 1, b: 2 }, {});
        return [
          {
            get a() {
              revoke();
              return 1;
            },
            b: 2,
          },
          proxy,
        ];
      };
      assert.throws(() => util.isDeepStrictEqual(...revokedMidway()), TypeError);
      assert.throws(() => util.isDeepStrictEqual(...(revokedMidway().reverse() as [object, object])), TypeError);
    });

    test("assert.throws compares a property of its validation object through the get trap", () => {
      const thrower = () => {
        throw Object.assign(new Error("m"), { info: { a: 1 } });
      };
      assert.doesNotThrow(() => assert.throws(thrower, { info: new Proxy({ a: 1 }, {}) }));
      assert.throws(() => assert.throws(thrower, { info: lyingProxy({ a: 1 }, "a", 2) }), assert.AssertionError);
    });

    test("every key after the first difference in key order from the descriptor", () => {
      const log: string[] = [];
      const equal = util.isDeepStrictEqual(
        traced("first", { a: 1, b: 2, c: 3 }, log),
        traced("second", { a: 1, c: 3, b: 2 }, log),
      );
      // The first six entries list the keys of both operands.
      same(
        { equal, reads: log.slice(6) },
        {
          equal: true,
          reads: [
            "first.get:a",
            "second.get:a",
            "first.getOwnPropertyDescriptor:c",
            "second.get:c",
            "first.getOwnPropertyDescriptor:b",
            "second.get:b",
          ],
        },
      );
    });

    test("string keys before symbol keys", () => {
      const s = Symbol("k");
      const log: string[] = [];
      const make = (who: string) => ({
        get [s]() {
          log.push(`${who}.symbol`);
          return 1;
        },
        get a() {
          log.push(`${who}.a`);
          return 1;
        },
      });
      assert.strictEqual(util.isDeepStrictEqual(make("first"), make("second")), true);
      same(log, ["first.a", "second.a", "first.symbol", "second.symbol"]);
    });

    test("string keys before symbol keys of two objects of one shape", () => {
      const s = Symbol("k");
      const log: string[] = [];
      const make = (who: string) => ({
        [s]: traced(`${who}.symbol`, { v: 1 }, log),
        a: traced(`${who}.a`, { v: 1 }, log),
      });
      assert.strictEqual(util.isDeepStrictEqual(make("first"), make("second")), true);
      same(
        log.filter(entry => entry.includes(".get:")),
        ["first.a.get:v", "second.a.get:v", "first.symbol.get:v", "second.symbol.get:v"],
      );

      const throwing = (message: string) => ({
        get x() {
          throw new RangeError(message);
        },
      });
      const makeThrowing = () => ({ [s]: throwing("under the symbol"), a: throwing("under a"), hidden: 1 });
      const withHidden = () => Object.defineProperty(makeThrowing(), "hidden", { enumerable: false });
      assert.throws(() => util.isDeepStrictEqual(makeThrowing(), makeThrowing()), {
        name: "RangeError",
        message: "under a",
      });
      assert.throws(() => util.isDeepStrictEqual(withHidden(), withHidden()), {
        name: "RangeError",
        message: "under a",
      });
    });

    test("no value when the operands differ in their number of string keys", () => {
      let calls = 0;
      const withGetter = () => ({
        get a(): number {
          calls++;
          throw new RangeError("from the getter");
        },
        [sym]: 2,
      });
      assert.strictEqual(util.isDeepStrictEqual({ a: 1, b: 2 }, withGetter()), false);
      assert.strictEqual(util.isDeepStrictEqual(withGetter(), { a: 1, b: 2 }), false);
      assert.doesNotThrow(() => assert.notDeepStrictEqual({ a: 1, b: 2 }, withGetter()));
      assert.strictEqual(calls, 0);
    });

    test("a Proxy that makes a new Proxy for each read of a cycle runs out of stack, as in Node", () => {
      const fresh = <T extends object>(target: T): T =>
        new Proxy(target, {
          get(t, key, receiver) {
            const value = Reflect.get(t, key, receiver);
            return typeof value === "object" && value !== null ? fresh(value) : value;
          },
        });
      const make = () => fresh(selfReferencingWith({ a: 1 }, false));
      assert.throws(() => util.isDeepStrictEqual(make(), make()), RangeError);
      assert.throws(() => assert.deepStrictEqual(make(), make()), RangeError);
      assert.throws(() => assert.notDeepStrictEqual(make(), make()), RangeError);
      assert.strictEqual(util.isDeepStrictEqual(selfReferencingWith({ a: 1 }, false), make()), false);
    });

    test("an accessor of a node:vm sandbox through the global, once", () => {
      let calls = 0;
      const sandbox = {
        b: 2,
        get me() {
          calls++;
          return sandbox;
        },
      };
      const global = vm.runInContext("this", vm.createContext(sandbox));
      // Read through the global, `me` is the global. The getter's own answer is the sandbox.
      same([util.isDeepStrictEqual(global, { me: global, b: 2 }), calls], [true, 1]);
      calls = 0;
      same([util.isDeepStrictEqual({ me: global, b: 2 }, global), calls], [true, 1]);
    });

    for (const [name, make] of [
      ["an array", () => [1] as object],
      ["a Uint8Array", () => new Uint8Array(1) as object],
      ["a DataView", () => new DataView(new ArrayBuffer(1)) as object],
    ] as const) {
      describe(`the other keys of ${name}`, () => {
        const withGetters = (who: string, keys: string[], log: string[]) => {
          const object = make();
          for (const key of keys) {
            Object.defineProperty(object, key, {
              enumerable: true,
              get() {
                log.push(`${who}.${key}`);
                return 1;
              },
            });
          }
          return object;
        };
        const withThrowingGetter = (message: string, before: object = {}, after: object = {}) =>
          Object.assign(
            Object.defineProperty(Object.assign(make(), before), "x", {
              enumerable: true,
              get() {
                throw new RangeError(message);
              },
            }),
            after,
          );

        test("first operand, then second, in the key order of the second", () => {
          const log: string[] = [];
          const equal = util.isDeepStrictEqual(
            withGetters("first", ["x", "y"], log),
            withGetters("second", ["y", "x"], log),
          );
          same({ equal, log }, { equal: true, log: ["first.y", "second.y", "first.x", "second.x"] });
        });

        test("the error of the first operand when a getter of each throws", () => {
          assert.throws(() => util.isDeepStrictEqual(withThrowingGetter("first"), withThrowingGetter("second")), {
            name: "RangeError",
            message: "first",
          });
        });

        test("no later key once one differs", () => {
          // `y` differs and comes first in the second operand: the getter `x` never runs.
          assert.strictEqual(
            util.isDeepStrictEqual(withThrowingGetter("x", {}, { y: 1 }), withThrowingGetter("x", { y: 2 })),
            false,
          );
          assert.throws(
            () => util.isDeepStrictEqual(withThrowingGetter("x", { y: 2 }), withThrowingGetter("x", {}, { y: 1 })),
            { name: "RangeError", message: "x" },
          );
        });
      });
    }

    test("the other keys of an array before its elements", () => {
      const withThrowingKey = () =>
        Object.defineProperty([2], "x", {
          enumerable: true,
          get() {
            throw new RangeError("from the getter");
          },
        });
      // The elements differ, but the getter `x` runs first.
      assert.throws(() => util.isDeepStrictEqual(Object.assign([1], { x: {} }), withThrowingKey()), {
        name: "RangeError",
        message: "from the getter",
      });
      assert.throws(() => util.isDeepStrictEqual(withThrowingKey(), Object.assign([1], { x: {} })), {
        name: "RangeError",
        message: "from the getter",
      });
    });

    test("each element of an array behind a Proxy twice, second operand first", () => {
      const log: string[] = [];
      const logged = (who: string, target: object) =>
        new Proxy(target, {
          get(t, key, receiver) {
            if (typeof key === "string" && key !== "constructor" && key !== "length") log.push(`${who}.${key}`);
            return Reflect.get(t, key, receiver);
          },
        });
      const equal = util.isDeepStrictEqual(
        logged("first", Object.assign([1, 2], { x: 1 })),
        logged("second", Object.assign([1, 2], { x: 1 })),
      );
      // Node reads b[i], then a[i], then both again to compare them. `first.x` comes from a descriptor.
      same(
        { equal, log },
        {
          equal: true,
          log: ["second.x", "second.0", "first.0", "first.0", "second.0", "second.1", "first.1", "first.1", "second.1"],
        },
      );
    });

    test("the other keys of an array again after a hole", () => {
      const log: string[] = [];
      const withGetter = (who: string, array: unknown[]) =>
        Object.defineProperty(array, "x", {
          enumerable: true,
          get() {
            log.push(who);
            return 1;
          },
        });
      assert.strictEqual(util.isDeepStrictEqual(withGetter("first", [1]), withGetter("second", [1])), true);
      same(log, ["first", "second"]);
      log.length = 0;
      assert.strictEqual(util.isDeepStrictEqual(withGetter("first", [, 1]), withGetter("second", [, 1])), true);
      same(log, ["first", "second", "first", "first", "second"]);
    });

    test("the symbol-keyed getter of an array on the first operand, then on the second", () => {
      const s = Symbol("k");
      const log: string[] = [];
      const make = (who: string) =>
        Object.defineProperty([1], s, {
          enumerable: true,
          get() {
            log.push(who);
            return 42;
          },
        });
      assert.strictEqual(util.isDeepStrictEqual(make("first"), make("second")), true);
      same(log, ["first", "second"]);
    });

    test("an element that is a getter twice on each operand", () => {
      let calls = 0;
      const counting = () =>
        Object.defineProperty([1, 2, 3], 1, {
          enumerable: true,
          get() {
            calls++;
            return 2;
          },
        });
      assert.strictEqual(util.isDeepStrictEqual([1, 2, 3], counting()), true);
      assert.strictEqual(calls, 2);
      assert.strictEqual(util.isDeepStrictEqual(counting(), [1, 2, 3]), true);
      assert.strictEqual(calls, 4);
      assert.strictEqual(util.isDeepStrictEqual(counting(), counting()), true);
      assert.strictEqual(calls, 8);
    });

    test("the length of the first array again after each element", () => {
      // A getter of the second array empties the first: no element is left to compare.
      const first = withGetterX([1]);
      const second = withGetterX([1], () => void (first.length = 0));
      assert.strictEqual(util.isDeepStrictEqual(first, second), true);

      // A getter below the first element cuts the first array off behind it.
      const cut: unknown[] = [null, 2, 3];
      cut[0] = {
        get g() {
          cut.length = 1;
          return 0;
        },
      };
      const whole = [
        {
          get g() {
            return 0;
          },
        },
        9,
        9,
      ];
      assert.strictEqual(util.isDeepStrictEqual(cut, whole), true);
    });

    test("every trap of an array behind a Proxy that node calls, and no other", () => {
      const log: string[] = [];
      assert.strictEqual(util.isDeepStrictEqual([1], traced("second", [1], log)), true);
      // With no other key, node reads `length` and `size` of the second array once more (keyCheck).
      same(log, [
        "second.get:length",
        "second.getOwnPropertyDescriptor:length",
        "second.get:length",
        "second.get:size",
        "second.get:0",
        "second.get:0",
      ]);
      log.length = 0;
      assert.strictEqual(util.isDeepStrictEqual(traced("first", [1], log), [1]), true);
      same(log, [
        "first.get:length",
        "first.getOwnPropertyDescriptor:length",
        "first.get:length",
        "first.get:0",
        "first.get:0",
        "first.get:length",
      ]);
      log.length = 0;
      assert.strictEqual(util.isDeepStrictEqual([], traced("second", [], log)), true);
      same(log, ["second.get:length", "second.getOwnPropertyDescriptor:length", "second.get:length"]);
    });

    test("no descriptor of an index of an array behind a Proxy", () => {
      const proxy = () =>
        new Proxy([1], {
          getOwnPropertyDescriptor(target, key) {
            if (key === "0") throw new RangeError("the descriptor of an index");
            return Reflect.getOwnPropertyDescriptor(target, key);
          },
        });
      assert.strictEqual(util.isDeepStrictEqual([1], proxy()), true);
      assert.strictEqual(util.isDeepStrictEqual(proxy(), [1]), true);
    });

    test("`size` of a second array behind a Proxy that has no other key", () => {
      const proxy = () =>
        new Proxy([1], {
          get(target, key, receiver) {
            if (key === "size") throw new RangeError("from the get trap");
            return Reflect.get(target, key, receiver);
          },
        });
      assert.throws(() => util.isDeepStrictEqual([1], proxy()), { name: "RangeError", message: "from the get trap" });
      assert.strictEqual(util.isDeepStrictEqual(proxy(), [1]), true);
    });

    test("the symbol keys of the first operand before those of the second", () => {
      const s = Symbol("k");
      const proxy = (message: string) =>
        new Proxy(
          { [s]: 1 },
          {
            getOwnPropertyDescriptor(target, key) {
              if (key === s) throw new RangeError(message);
              return Reflect.getOwnPropertyDescriptor(target, key);
            },
          },
        );
      assert.throws(() => util.isDeepStrictEqual(proxy("first"), proxy("second")), {
        name: "RangeError",
        message: "first",
      });
    });

    test("nothing of a private field, and nothing of a function", () => {
      const log: string[] = [];
      const first = new WithPrivate(traced("first", { v: 1 }, log));
      const second = new WithPrivate(traced("second", { v: 2 }, log));
      assert.strictEqual(util.isDeepStrictEqual(first, second), true);
      same(log, []);

      const callable = proxyWhoseTrapsThrow(function () {});
      assert.strictEqual(util.isDeepStrictEqual(callable, callable), true);
      assert.strictEqual(util.isDeepStrictEqual({ h: callable }, { h: callable }), true);
      for (const other of [proxyWhoseTrapsThrow(function () {}), function () {}, {}, proxyWhoseTrapsThrow()]) {
        assert.strictEqual(util.isDeepStrictEqual(callable, other), false);
        assert.strictEqual(util.isDeepStrictEqual(other, callable), false);
        assert.strictEqual(util.isDeepStrictEqual(callable, other, true as any), false);
        assert.strictEqual(util.isDeepStrictEqual([callable], [other]), false);
        assert.strictEqual(util.isDeepStrictEqual(new Map([[1, callable]]), new Map([[1, other]])), false);
      }
      const withTagThatThrows = () =>
        class {
          static get [Symbol.toStringTag]() {
            throw new RangeError("from the getter");
          }
        };
      assert.strictEqual(util.isDeepStrictEqual(withTagThatThrows(), withTagThatThrows()), false);
    });

    test("an error from an element that is a getter, of either operand", () => {
      const throwing = () =>
        Object.defineProperty([1, 2], 1, {
          enumerable: true,
          get() {
            throw new RangeError("from the getter");
          },
        });
      for (const compare of [util.isDeepStrictEqual, assert.deepStrictEqual, assert.notDeepStrictEqual]) {
        assert.throws(() => compare(throwing(), [1, 2]), { name: "RangeError", message: "from the getter" });
        assert.throws(() => compare([1, 2], throwing()), { name: "RangeError", message: "from the getter" });
      }
    });

    test("the other keys of the second array before those of the first", () => {
      const log: string[] = [];
      const listing = (who: string) =>
        new Proxy(Object.assign([1], { k: 1 }), {
          ownKeys(target) {
            log.push(`${who}.ownKeys`);
            return Reflect.ownKeys(target);
          },
        });
      assert.strictEqual(util.isDeepStrictEqual(listing("first"), listing("second")), true);
      same(log, ["second.ownKeys", "first.ownKeys"]);
    });

    test("what two arrays behind Proxies answer for Symbol.toStringTag, after their lengths", () => {
      const log: string[] = [];
      const logging = (who: string) =>
        new Proxy([] as unknown[], {
          get(target, key, receiver) {
            log.push(`${who}.${String(key)}`);
            return Reflect.get(target, key, receiver);
          },
        });
      assert.strictEqual(util.isDeepStrictEqual(logging("first"), logging("second"), true as any), true);
      same(log, [
        "first.length",
        "second.length",
        "first.Symbol(Symbol.toStringTag)",
        "second.Symbol(Symbol.toStringTag)",
        "second.length",
      ]);
    });

    test("no key of two Proxies that answer differently for Symbol.toStringTag", () => {
      const log: string[] = [];
      const mocking = (who: string) =>
        new Proxy(
          { a: 1 },
          {
            get(target, key, receiver) {
              if (typeof key === "string" && key !== "constructor") log.push(`${who}.get:${key}`);
              return Reflect.has(target, key) ? Reflect.get(target, key, receiver) : () => {};
            },
            ownKeys(target) {
              log.push(`${who}.ownKeys`);
              return Reflect.ownKeys(target);
            },
          },
        );
      assert.strictEqual(util.isDeepStrictEqual(mocking("first"), mocking("second")), false);
      same(log, []);
    });

    test("the size of the second array once, where the arrays have no other key", () => {
      const log: string[] = [];
      class Sized extends Array<number> {
        declare who: string;
        get size() {
          log.push(`${this.who}.size`);
          return this.length;
        }
      }
      const sized = (who: string, ...elements: number[]) =>
        Object.defineProperty(Sized.from(elements), "who", { value: who });
      assert.strictEqual(util.isDeepStrictEqual(sized("first", 1, 2), sized("second", 1, 2)), true);
      same(log, ["second.size"]);

      log.length = 0;
      assert.strictEqual(util.isDeepStrictEqual(sized("first"), sized("second")), true);
      assert.strictEqual(
        util.isDeepStrictEqual(Object.assign(sized("first", 1), { k: 1 }), Object.assign(sized("second", 1), { k: 1 })),
        true,
      );
      same(log, []);

      class ThrowingSize extends Array<number> {
        get size(): number {
          throw new RangeError("from the getter");
        }
      }
      assert.throws(() => util.isDeepStrictEqual(ThrowingSize.of(1), ThrowingSize.of(1)), {
        name: "RangeError",
        message: "from the getter",
      });
    });

    // Known difference: a Map or a Set compares its entries before its own keys. Node reads the keys first.
    test("the own keys of a Map before its entries", { expectFailure: isBun }, () => {
      const throwing = () =>
        Object.defineProperty(new Map([[1, {}]]), "a", {
          enumerable: true,
          get() {
            throw new RangeError("from the getter");
          },
        });
      const plain = () => Object.assign(new Map([[1, 1]]), { a: 1 });
      assert.throws(() => util.isDeepStrictEqual(plain(), throwing()), {
        name: "RangeError",
        message: "from the getter",
      });
    });

    // Known difference: before the keys, Bun reads `constructor` and Symbol.toStringTag fewer times than Node.
    test("constructor and Symbol.toStringTag as often as Node", { expectFailure: isBun }, () => {
      const log: string[] = [];
      const logging = (who: string) =>
        new Proxy(
          { a: 1 },
          {
            get(target, key, receiver) {
              log.push(`${who}.${String(key)}`);
              return Reflect.get(target, key, receiver);
            },
          },
        );
      assert.strictEqual(util.isDeepStrictEqual(logging("first"), logging("second")), true);
      same(log, [
        "first.constructor",
        "first.constructor",
        "second.constructor",
        "first.Symbol(Symbol.toStringTag)",
        "first.Symbol(Symbol.toStringTag)",
        "first.Symbol(Symbol.toStringTag)",
        "second.Symbol(Symbol.toStringTag)",
        "first.a",
        "second.a",
      ]);
    });

    // Known difference: Node asks a Proxy of a Map or a Set for its prototype. Bun takes such a Proxy for its target.
    test("the getPrototypeOf trap of a Proxy of a Map", { expectFailure: isBun }, () => {
      const log: string[] = [];
      const asking = (who: string) =>
        new Proxy(new Map([[1, 1]]), {
          getPrototypeOf(target) {
            log.push(`${who}.getPrototypeOf`);
            return Reflect.getPrototypeOf(target);
          },
        });
      assert.strictEqual(util.isDeepStrictEqual(asking("first"), asking("second")), true);
      same(log, ["first.getPrototypeOf", "second.getPrototypeOf"]);
    });

    // Known difference: JavaScriptCore lists an index of a sloppy arguments object that is still bound to its
    // parameter first, and lists it where it is not enumerable. The keys decide how Node's loop reads a value.
    test(
      "the keys of a sloppy arguments object in the order that Object.keys has on Node",
      { expectFailure: isBun },
      () => {
        const withHiddenFirst = new Function(
          "a",
          "b",
          "Object.defineProperty(arguments, 0, { enumerable: false }); return arguments;",
        );
        assert.strictEqual(util.isDeepStrictEqual(withHiddenFirst(1, 2), withHiddenFirst(9, 2)), true);
        const withFirstWrittenAgain = new Function(
          "a",
          "b",
          "delete arguments[0]; arguments[0] = 1; return arguments;",
        );
        assert.strictEqual(
          util.isDeepStrictEqual(lyingProxy(withFirstWrittenAgain(0, 2), "0", 99), { 0: 99, 1: 2 }),
          true,
        );
      },
    );

    // Known difference: the global of a node:vm context lists the keys of its sandbox before its own on Bun, and
    // behind them on Node. The keys decide how Node's loop reads a value.
    test(
      "the keys of a node:vm global after a declaration in the order that Object.keys has on Node",
      { expectFailure: isBun },
      () => {
        const context = vm.createContext(lyingProxy({ a: 1 }, "a", 2));
        vm.runInContext("function f() {}", context);
        const global = vm.runInContext("this", context);
        same(Object.keys(global), ["f", "a"]);
        assert.strictEqual(util.isDeepStrictEqual(global, { a: 1, f: global.f }, true as any), true);
      },
    );

    // Known difference: Bun's require.cache is a Proxy whose getOwnPropertyDescriptor trap reports no value.
    test("require.cache against a copy with its keys in the opposite order", { expectFailure: isBun }, () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deep-equal-"));
      try {
        fs.writeFileSync(path.join(directory, "a.cjs"), "module.exports = 1;");
        fs.writeFileSync(path.join(directory, "b.cjs"), "module.exports = 2;");
        const require = createRequire(path.join(directory, "main.cjs"));
        require("./a.cjs");
        require("./b.cjs");
        const cache = require.cache;
        const copy = Object.fromEntries(
          Object.keys(cache)
            .reverse()
            .map(key => [key, cache[key]]),
        );
        assert.strictEqual(util.isDeepStrictEqual(copy, cache, true as any), true);
        assert.strictEqual(util.isDeepStrictEqual(cache, copy, true as any), true);
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });
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
      assert.strictEqual(util.isDeepStrictEqual(new Foo(42), new Bar(42)), false);
      assert.strictEqual(util.isDeepStrictEqual(new Foo(42), new Bar(42), true as any), true);
    });

    test("still compares values", () => {
      assert.strictEqual(util.isDeepStrictEqual(new Foo(42), new Bar(99), true as any), false);
    });

    for (const [name, makeA, makeB] of [
      ["object property", () => ({ inner: new Foo(1) }), () => ({ inner: new Bar(1) })],
      ["array element", () => [new Foo(1)], () => [new Bar(1)]],
      ["Map value", () => new Map([["k", new Foo(1)]]), () => new Map([["k", new Bar(1)]])],
      ["Set element", () => new Set([new Foo(1)]), () => new Set([new Bar(1)])],
      ["Error cause", () => new Error("e", { cause: new Foo(1) }), () => new Error("e", { cause: new Bar(1) })],
      ["a property read through a Proxy", () => new Proxy({ inner: new Foo(1) }, {}), () => ({ inner: new Bar(1) })],
      ["objects with other key orders", () => ({ inner: new Foo(1), z: 1 }), () => ({ z: 1, inner: new Bar(1) })],
      [
        "a named property of an array",
        () => Object.assign([1], { inner: new Foo(1) }),
        () => Object.assign([1], { inner: new Bar(1) }),
      ],
      ["an element of an array behind a Proxy", () => new Proxy([new Foo(1)], {}), () => [new Bar(1)]],
      [
        "an element after a hole",
        () => Object.assign([, new Foo(1)], { x: 1 }),
        () => Object.assign([, new Bar(1)], { x: 1 }),
      ],
    ] as const) {
      test(`propagates through ${name}`, () => {
        assert.strictEqual(util.isDeepStrictEqual(makeA(), makeB()), false);
        assert.strictEqual(util.isDeepStrictEqual(makeA(), makeB(), true as any), true);
      });
    }

    test("still compares Object.prototype.toString tags", () => {
      assert.strictEqual(util.isDeepStrictEqual(argumentsObject(1), { 0: 1 }, true as any), false);
      assert.strictEqual(util.isDeepStrictEqual(argumentsObject(1), argumentsObject(1), true as any), true);
      assert.strictEqual(util.isDeepStrictEqual(Object.create({ [Symbol.toStringTag]: "X" }), {}, true as any), false);
    });

    test("ignores the boxed-primitive subclass distinction", () => {
      class S extends String {}
      assert.strictEqual(util.isDeepStrictEqual(new String("a"), new S("a")), false);
      assert.strictEqual(util.isDeepStrictEqual(new String("a"), new S("a"), true as any), true);
    });

    test("does not leak into assert.deepStrictEqual", () => {
      assert.throws(() => assert.deepStrictEqual(new Foo(42), new Bar(42)));
    });

    test("reads a Proxy through its get trap in both argument orders", () => {
      const lying = () => lyingProxy({ a: 1 }, "a", 2);
      same(
        [
          util.isDeepStrictEqual({ a: 1 }, lying(), true as any),
          util.isDeepStrictEqual(lying(), { a: 1 }, true as any),
          util.isDeepStrictEqual({ a: 2 }, lying(), true as any),
          util.isDeepStrictEqual(lying(), { a: 2 }, true as any),
        ],
        [false, false, true, true],
      );

      const lenient = new (assert as any).Assert({ skipPrototype: true });
      assert.throws(() => lenient.deepStrictEqual({ a: 1 }, lying()), assert.AssertionError);
      assert.throws(() => lenient.deepStrictEqual(lying(), { a: 1 }), assert.AssertionError);
      assert.doesNotThrow(() => lenient.deepStrictEqual({ a: 2 }, lying()));
      assert.doesNotThrow(() => lenient.deepStrictEqual(lying(), { a: 2 }));
    });

    // Node 26.3.0 lists no key of such a global and answers false four times. This is Node 26.12.1.
    test("reads the global of a node:vm context over a Proxy through that Proxy in both argument orders", () => {
      const global = () => vm.runInContext("this", vm.createContext(lyingProxy({ a: 1 }, "a", 2)));
      same(
        [
          util.isDeepStrictEqual({ a: 1 }, global(), true as any),
          util.isDeepStrictEqual(global(), { a: 1 }, true as any),
          util.isDeepStrictEqual({ a: 2 }, global(), true as any),
          util.isDeepStrictEqual(global(), { a: 2 }, true as any),
        ],
        [false, false, true, true],
      );
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
      assert.throws(() => assert.deepStrictEqual(a(), b()), TypeError);
      assert.throws(() => assert.deepEqual(a(), b()), TypeError);
      assert.throws(() => assert.notDeepStrictEqual(a(), b()), TypeError);
      assert.throws(() => assert.notDeepEqual(a(), b()), TypeError);
      assert.throws(() => util.isDeepStrictEqual(a(), b()), TypeError);
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
    assert.ok(error instanceof TypeError);
    assert.strictEqual(
      error?.message,
      "Cannot perform get DataView.prototype.byteLength on a detached or out-of-bounds ArrayBuffer",
    );
    assert.throws(() => util.isDeepStrictEqual(detachedView(), new DataView(new ArrayBuffer(0))), TypeError);
    // Bun.deepEquals keeps its own-properties DataView surface: no throw.
    if (isBun) {
      assert.strictEqual(
        (globalThis as any).Bun.deepEquals(detachedView(), new DataView(new ArrayBuffer(0)), true),
        true,
      );
    }
  });

  test("assert.partialDeepStrictEqual throws TypeError on a detached ArrayBuffer", () => {
    assert.throws(() => assert.partialDeepStrictEqual(detached(), new ArrayBuffer(0)), TypeError);
  });

  test("assert.partialDeepStrictEqual checks own properties on a KeyObject after equals()", () => {
    const key = createSecretKey(Buffer.from("secret"));
    const key2 = createSecretKey(Buffer.from("secret"));
    Object.assign(key2, { x: 1 });
    // expected has {x:1} that actual lacks: node throws ERR_ASSERTION.
    assert.throws(() => assert.partialDeepStrictEqual(key, key2), assert.AssertionError);
    // subset direction: extra own prop on actual is fine.
    assert.doesNotThrow(() =>
      assert.partialDeepStrictEqual(Object.assign(key, { x: 1 }), createSecretKey(Buffer.from("secret"))),
    );
  });

  test("assert.partialDeepStrictEqual compares CryptoKeys by what they hold, then by own properties", () => {
    const partial = (actual: unknown, expected: unknown) => {
      const error = caught(() => assert.partialDeepStrictEqual(actual, expected));
      return error ? error.code : "equal";
    };
    same(
      {
        same: partial(secretCryptoKey(1), secretCryptoKey(1)),
        otherBytes: partial(secretCryptoKey(1), secretCryptoKey(2)),
        nestedOtherBytes: partial({ key: secretCryptoKey(1) }, { key: secretCryptoKey(2) }),
        otherExtractable: partial(secretCryptoKey(1), secretCryptoKey(1, "AES-GCM", false)),
        // Unlike arrays, usages are not compared as a subset.
        fewerUsages: partial(secretCryptoKey(1, "AES-GCM", true, ["encrypt", "decrypt"]), secretCryptoKey(1)),
        extraOwnPropertyOnActual: partial(Object.assign(secretCryptoKey(1), { own: 1 }), secretCryptoKey(1)),
        extraOwnPropertyOnExpected: partial(secretCryptoKey(1), Object.assign(secretCryptoKey(1), { own: 1 })),
      },
      {
        same: "equal",
        otherBytes: "ERR_ASSERTION",
        nestedOtherBytes: "ERR_ASSERTION",
        otherExtractable: "ERR_ASSERTION",
        fewerUsages: "ERR_ASSERTION",
        extraOwnPropertyOnActual: "equal",
        extraOwnPropertyOnExpected: "ERR_ASSERTION",
      },
    );
  });

  test("error matches Node's message", () => {
    const error = caught(() => assert.deepStrictEqual(detached(), new ArrayBuffer(0)));
    assert.ok(error instanceof TypeError);
    assert.strictEqual(error?.message, "Cannot perform Construct on a detached ArrayBuffer");
  });

  test("reference-identical detached ArrayBuffer short-circuits as equal", () => {
    const buf = detached();
    assert.doesNotThrow(() => assert.deepStrictEqual(buf, buf));
    assert.strictEqual(util.isDeepStrictEqual(buf, buf), true);
  });

  test("detached ArrayBuffer vs non-zero-length ArrayBuffer is an ordinary mismatch", () => {
    const error = caught(() => assert.deepStrictEqual(detached(), new ArrayBuffer(4)));
    assert.strictEqual(error?.code, "ERR_ASSERTION");
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
    assert.doesNotThrow(() => assert.deepStrictEqual(detachedView(), detachedView()));
    assert.doesNotThrow(() => assert.deepStrictEqual(detachedView(), new Uint8Array(0)));
  });
});

describe("AssertionError", () => {
  test("deepStrictEqual reports actual, expected and operator", () => {
    const error = caught(() => assert.deepStrictEqual({ a: 1 }, { a: 2 })) as any;
    assert.notStrictEqual(error, null);
    assert.strictEqual(error.name, "AssertionError");
    assert.strictEqual(error.code, "ERR_ASSERTION");
    assert.strictEqual(error.operator, "deepStrictEqual");
    same(error.actual, { a: 1 });
    same(error.expected, { a: 2 });
    assert.strictEqual(error.generatedMessage, true);
  });

  test("notDeepStrictEqual reports its own operator", () => {
    const error = caught(() => assert.notDeepStrictEqual({ a: 1 }, { a: 1 })) as any;
    assert.strictEqual(error.operator, "notDeepStrictEqual");
    assert.strictEqual(error.code, "ERR_ASSERTION");
  });

  test("a string message is used instead of generating one", () => {
    const error = caught(() => assert.deepStrictEqual(1, 2, "nope")) as any;
    assert.strictEqual(error.message.startsWith("nope"), true);
    assert.strictEqual(error.generatedMessage, false);
  });

  test("an Error message is thrown as-is", () => {
    const custom = new RangeError("custom");
    const error = caught(() => assert.deepStrictEqual(1, 2, custom));
    assert.strictEqual(error, custom);
  });

  // Known difference: Node shows a Proxy as `Proxy(...)`. Bun shows its target, so the two sides can read the same.
  test("the message shows a Proxy as one", { expectFailure: isBun }, () => {
    const error = caught(() => assert.deepStrictEqual({ a: 1 }, lyingProxy({ a: 1 }, "a", 2)));
    assert.match(error?.message ?? "", /^- Proxy\(\{$/m);
  });
});

// Only in Bun: when Node.js runs this file it does not start itself again.
if (isBun) {
  const { bunEnv, bunExe, nodeExeAtLeast } = await import("harness");
  // The answers in this file are those of the Node.js that Bun reports to be.
  const node = nodeExeAtLeast("26.12.1");
  const inNode = node ? test : test.skip;

  async function outputOf(cmd: string[]) {
    await using proc = Bun.spawn({ cmd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  describe("Node.js compatibility", () => {
    inNode("all tests pass in Node.js", async () => {
      const { stdout, stderr, exitCode } = await outputOf([node!, fileURLToPath(import.meta.url)]);
      same({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });

    // Seeded pairs, each compared in both orders: the answer, and every getter and trap that ran, in order. A failure
    // names its pair: run the fixture again with BUN_DEEP_EQUAL_SEED=<seed> BUN_DEEP_EQUAL_PAIRS=<pairs>.
    inNode("the answers and the reads of seeded pairs are those of Node.js", async () => {
      const fixture = path.join(import.meta.dirname, "deep-equal-differential-fixture.cjs");
      const seed = process.env.BUN_DEEP_EQUAL_SEED ?? "1";
      const pairs = process.env.BUN_DEEP_EQUAL_PAIRS ?? "500";
      const [fromNode, fromBun] = await Promise.all([
        outputOf([node!, fixture, seed, pairs]),
        outputOf([bunExe(), fixture, seed, pairs]),
      ]);
      same({ exitCode: fromNode.exitCode, stderr: fromNode.stderr }, { exitCode: 0, stderr: "" });
      same({ exitCode: fromBun.exitCode, stderr: fromBun.stderr }, { exitCode: 0, stderr: "" });
      const expected = fromNode.stdout.split("\n");
      const actual = fromBun.stdout.split("\n");
      assert.strictEqual(expected.length, Number(pairs) * 2 + 1);
      const differing = expected.findIndex((line, index) => line !== actual[index]);
      same(differing === -1 ? null : { seed, node: expected[differing], bun: actual[differing] }, null);
    });
  });
}
