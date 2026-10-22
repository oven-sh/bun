// The rows of the deep-equality matrix that deep-equal.test.ts runs. Each row carries the verdicts of Node.js v26.3.0.
// This file imports only node: modules, so Node.js runs it as it is. deep-equal.test.ts asks a local Node.js of that version.
import assert from "node:assert";
import net from "node:net";
import util from "node:util";

type Thunk = () => unknown;

export interface Case {
  name: string;
  /** Thunks so that every test gets freshly constructed operands. */
  a: Thunk;
  b: Thunk;
  /** Whether assert.deepStrictEqual(a, b) should succeed. */
  strict: boolean;
  /** Whether assert.deepEqual(a, b) should succeed. */
  loose: boolean;
  /** Whether util.isDeepStrictEqual(a, b, true) should be true, when that is not `strict`. */
  skipPrototype?: boolean;
  /** The verdicts for (b, a), when they are not the verdicts for (a, b). */
  swapped?: { strict?: boolean; loose?: boolean; skipPrototype?: boolean };
  /** Set when Bun disagrees with `strict`; the text says what Bun does instead. */
  strictBug?: string;
  /** Set when Bun disagrees with `loose`; the text says what Bun does instead. */
  looseBug?: string;
  /** Set when Bun disagrees with `skipPrototype`; the text says what Bun does instead. */
  skipPrototypeBug?: string;
}

export const sym = Symbol("shared");
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

export function argumentsObject(...values: unknown[]) {
  return (
    function () {
      // eslint-disable-next-line prefer-rest-params
      return arguments;
    } as (...args: unknown[]) => IArguments
  )(...values);
}

class ErrorWithInheritedSymbol extends Error {}
Object.defineProperty(ErrorWithInheritedSymbol.prototype, sym, { value: 1, enumerable: true });
class TaggedA {
  get [Symbol.toStringTag]() {
    return "A";
  }
}
class TaggedB {
  get [Symbol.toStringTag]() {
    return "B";
  }
}
class AlsoTaggedA {
  get [Symbol.toStringTag]() {
    return "A";
  }
}
class ErrorWithInheritedCause extends Error {}
Object.defineProperty(ErrorWithInheritedCause.prototype, "cause", {
  value: undefined,
  writable: true,
  configurable: true,
});
class TaggedPerInstance {
  #tag: string;
  constructor(tag: string) {
    this.#tag = tag;
  }
  get [Symbol.toStringTag]() {
    return this.#tag;
  }
}

const sharedObject = { a: 1 };
const sharedArray = ["x"];
const nanBuffer = new Float64Array([NaN]).buffer;

function twelveObjects(first: number) {
  return Array.from({ length: 12 }, (_, i) => ({ a: (first + i) % 12 }));
}

function nestedMap(depth: number, key: unknown, leaf: unknown, besideObjectKey = false): Map<unknown, unknown> {
  let value = leaf;
  for (let i = 0; i < depth; i++) {
    const map = new Map<unknown, unknown>([[key, value]]);
    if (besideObjectKey) map.set({ k: i }, i);
    value = map;
  }
  return value as Map<unknown, unknown>;
}

function selfHoldingSet() {
  const set = new Set<unknown>();
  return set.add(set);
}

function selfHoldingMap(key: unknown) {
  const map = new Map<unknown, unknown>();
  return map.set(key, map);
}

function setHeldByItsMember() {
  const set = new Set<unknown>();
  return set.add({ set });
}

function closedChannel() {
  const channel = new BroadcastChannel("deep-equal");
  channel.close();
  return channel;
}

// Passes node's isURL and shows the type tag of a URL, as the URL of whatwg-url does.
class URLLike {
  #href: string;
  constructor(href: string) {
    this.#href = href;
  }
  get href() {
    return this.#href;
  }
  get protocol() {
    return "http:";
  }
}
Object.defineProperty(URLLike.prototype, Symbol.toStringTag, { value: "URL", configurable: true });

// Keeps its entries outside the native storage of a Map, as an LRU cache does.
class MapWithOwnStorage extends Map<unknown, unknown> {
  #entries = new Map<unknown, unknown>();
  get size() {
    return this.#entries.size;
  }
  get(key: unknown) {
    return this.#entries.get(key);
  }
  has(key: unknown) {
    return this.#entries.has(key);
  }
  set(key: unknown, value: unknown) {
    this.#entries.set(key, value);
    return this;
  }
  entries() {
    return this.#entries.entries();
  }
  keys() {
    return this.#entries.keys();
  }
  values() {
    return this.#entries.values();
  }
  [Symbol.iterator]() {
    return this.#entries.entries();
  }
}

class SetWithOwnStorage extends Set<unknown> {
  #members: unknown[] = [];
  get size() {
    return this.#members.length;
  }
  has(value: unknown) {
    return this.#members.includes(value);
  }
  add(value: unknown) {
    if (!this.#members.includes(value)) this.#members.push(value);
    return this;
  }
  values() {
    return this.#members.values() as SetIterator<unknown>;
  }
  [Symbol.iterator]() {
    return this.values();
  }
}

function errorWithEnumerableStack(stack: string) {
  return Object.defineProperty(new Error("m"), "stack", { value: stack, enumerable: true, writable: true });
}

// Bun gives this Error no own `stack`, and an assignment makes an enumerable one. node gives it a non-enumerable one.
function errorWithoutTrace(stack?: string) {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 0;
  try {
    const error = new Error("m");
    if (stack !== undefined) error.stack = stack;
    return error;
  } finally {
    Error.stackTraceLimit = limit;
  }
}

function errorWithRecapturedStack() {
  const error = new Error("m");
  Error.captureStackTrace(error);
  return error;
}

const sharedKeys = Array.from({ length: 12 }, (_, i) => ({ key: i }));
const sharedPromise = Promise.resolve(1);
// `==` takes "01" and "1" for 1, and "01" is not "1".
const one = { a: 1 };
const zeroOne = { a: "01" };
const stringOne = { a: "1" };

function mapOf(keys: object[], value: (key: object, index: number) => unknown = (_key, index) => index) {
  return new Map(keys.map((key, index) => [key, value(key, index)]));
}

function tagged<T extends object>(value: T, tag: unknown): T {
  return Object.assign(value, { [Symbol.toStringTag]: tag });
}

function tagTrap(tag: string): ProxyHandler<object> {
  return { get: (target, key, receiver) => (key === Symbol.toStringTag ? tag : Reflect.get(target, key, receiver)) };
}

export const cases: Case[] = [
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
    skipPrototype: true,
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
    skipPrototype: true,
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
    skipPrototype: true,
  },
  {
    name: "instances of two distinct anonymous classes",
    a: anonymousClassInstance,
    b: anonymousClassInstance,
    strict: false,
    loose: true,
    skipPrototype: true,
  },
  {
    name: "instances of two distinct identically named classes",
    a: sameNameClassInstance,
    b: sameNameClassInstance,
    strict: false,
    loose: true,
    skipPrototype: true,
  },
  {
    name: "an Array subclass instance and an array",
    a: () => new (class extends Array {})(),
    b: () => [],
    strict: false,
    loose: true,
    skipPrototype: true,
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
    skipPrototype: true,
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
    skipPrototype: true,
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
    skipPrototype: true,
    swapped: { strict: true },
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
    skipPrototype: true,
  },
  {
    name: "own non-enumerable constructor: Object and Array on the same structure",
    a: () => withHiddenProperty({}, "constructor", Object),
    b: () => withHiddenProperty({}, "constructor", Array),
    strict: false,
    loose: true,
    skipPrototype: true,
  },
  {
    name: "objects with different prototypes whose inherited constructor is undefined",
    a: () => Object.create(withOwnConstructor(null, undefined)),
    b: () => Object.create(withOwnConstructor(null, undefined)),
    strict: false,
    loose: true,
    skipPrototype: true,
  },
  {
    name: "Object.setPrototypeOf([], null) and []",
    a: () => Object.setPrototypeOf([], null),
    b: () => [],
    strict: false,
    loose: true,
    skipPrototype: true,
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
    skipPrototype: true,
  },
  {
    name: "a boxed string and a null-prototype boxed string",
    a: () => new String("a"),
    b: () => Object.setPrototypeOf(new String("a"), null),
    strict: false,
    loose: true,
    skipPrototype: true,
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
    skipPrototype: true,
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
    name: "[null, undefined, undefined] and [null, undefined, null]",
    a: () => [null, undefined, undefined],
    b: () => [null, undefined, null],
    strict: false,
    loose: true,
  },
  {
    name: "[null, undefined, undefined, 1] and [null, undefined, null, 2]",
    a: () => [null, undefined, undefined, 1],
    b: () => [null, undefined, null, 2],
    strict: false,
    loose: false,
  },
  {
    name: "{ 0: 0, x: 1 } and { 0: 0 } with a non-enumerable x",
    a: () => ({ 0: 0, x: 1 }),
    b: () => withHiddenProperty({ 0: 0 }, "x", 1),
    strict: false,
    loose: false,
  },
  {
    name: "{ 0: 0, x: 1 } and { 0: 0 } inheriting x",
    a: () => ({ 0: 0, x: 1 }),
    b: () => Object.assign(Object.create({ x: 1 }), { 0: 0 }),
    strict: false,
    loose: false,
  },
  { name: "{} and the Map constructor", a: () => ({}), b: () => Map, strict: false, loose: false },
  // Loose mode compares a function with `==`, as it compares a primitive.
  {
    name: "a function and its source text",
    a: () => sharedConstructor,
    b: () => String(sharedConstructor),
    strict: false,
    loose: true,
  },
  { name: "sets holding '1' and 1", a: () => new Set(["1"]), b: () => new Set([1]), strict: false, loose: true },
  {
    name: "sets holding null and undefined",
    a: () => new Set([null]),
    b: () => new Set([undefined]),
    strict: false,
    loose: true,
  },
  {
    name: "sets holding 1, '1', 2 and 1, 2, 3",
    a: () => new Set([1, "1", 2]),
    b: () => new Set([1, 2, 3]),
    strict: false,
    loose: false,
  },
  {
    name: "a set holding { a: 1 } twice and a set holding { a: 1 } and { a: 2 }",
    a: () => new Set([{ a: 1 }, { a: 1 }]),
    b: () => new Set([{ a: 1 }, { a: 2 }]),
    strict: false,
    loose: false,
  },
  {
    name: "a set holding { a: 1 } twice and a set holding { a: '1' } and { a: 2 }",
    a: () => new Set([{ a: 1 }, { a: 1 }]),
    b: () => new Set([{ a: "1" }, { a: 2 }]),
    strict: false,
    loose: false,
  },
  {
    name: "maps with the keys '1' and 1",
    a: () => new Map([["1", "a"]]),
    b: () => new Map([[1, "a"]]),
    strict: false,
    loose: true,
  },
  {
    name: "maps with the values '1' and 1",
    a: () => new Map([["k", "1"]]),
    b: () => new Map([["k", 1]]),
    strict: false,
    loose: true,
  },
  {
    name: "maps holding 1 => 'a', '1' => 'b' and 1 => 'b', '1' => 'a'",
    a: () =>
      new Map<unknown, unknown>([
        [1, "a"],
        ["1", "b"],
      ]),
    b: () =>
      new Map<unknown, unknown>([
        [1, "b"],
        ["1", "a"],
      ]),
    strict: false,
    loose: true,
  },
  {
    name: "errors with the causes 1 and '1'",
    a: () => new Error("m", { cause: 1 }),
    b: () => new Error("m", { cause: "1" }),
    strict: false,
    loose: true,
  },

  // Loose mode skips symbol keys (SKIP_SYMBOLS).
  {
    name: "{ 0: 1 } and { 0: 1 } inheriting a symbol key",
    a: () => ({ 0: 1 }),
    b: () => Object.assign(Object.create({ [sym]: 1 }), { 0: 1 }),
    strict: true,
    loose: true,
  },
  {
    name: "an Error and an Error subclass instance inheriting a symbol key",
    a: () => new Error("m"),
    b: () => new ErrorWithInheritedSymbol("m"),
    strict: false,
    loose: true,
    skipPrototype: true,
  },
  {
    name: "two objects differing only in a symbol-keyed value",
    a: () => ({ [sym]: 1 }),
    b: () => ({ [sym]: 2 }),
    strict: false,
    loose: true,
  },
  {
    name: "{ a: 1 } and { a: 1, [sym]: 1 }",
    a: () => ({ a: 1 }),
    b: () => ({ a: 1, [sym]: 1 }),
    strict: false,
    loose: true,
  },
  {
    name: "arrays differing only in a symbol-keyed value",
    a: () => Object.assign([1], { [sym]: 1 }),
    b: () => Object.assign([1], { [sym]: 2 }),
    strict: false,
    loose: true,
  },
  {
    name: "objects with an index key differing only in a symbol-keyed value",
    a: () => ({ 0: 1, [sym]: 1 }),
    b: () => ({ 0: 1, [sym]: 2 }),
    strict: false,
    loose: true,
  },
  {
    name: "errors differing only in a symbol-keyed value",
    a: () => Object.assign(new Error("m"), { [sym]: 1 }),
    b: () => Object.assign(new Error("m"), { [sym]: 2 }),
    strict: false,
    loose: true,
  },
  {
    name: "Proxies of objects differing only in a symbol-keyed value",
    a: () => new Proxy({ a: 1, [sym]: 1 }, {}),
    b: () => new Proxy({ a: 1, [sym]: 2 }, {}),
    strict: false,
    loose: true,
  },
  {
    name: "a property value with a differing symbol-keyed value",
    a: () => ({ p: { [sym]: 1 } }),
    b: () => ({ p: { [sym]: 2 } }),
    strict: false,
    loose: true,
  },
  {
    name: "an array element with a differing symbol-keyed value",
    a: () => [{ [sym]: 1 }],
    b: () => [{ [sym]: 2 }],
    strict: false,
    loose: true,
  },
  {
    name: "a Map value with a differing symbol-keyed value",
    a: () => new Map([["k", { [sym]: 1 }]]),
    b: () => new Map([["k", { [sym]: 2 }]]),
    strict: false,
    loose: true,
  },
  {
    name: "a Map key with a differing symbol-keyed value",
    a: () => new Map([[{ [sym]: 1 }, 1]]),
    b: () => new Map([[{ [sym]: 2 }, 1]]),
    strict: false,
    loose: true,
  },
  {
    name: "a Set member with a differing symbol-keyed value",
    a: () => new Set([{ [sym]: 1 }]),
    b: () => new Set([{ [sym]: 2 }]),
    strict: false,
    loose: true,
  },
  {
    name: "an Error cause with a differing symbol-keyed value",
    a: () => new Error("m", { cause: { [sym]: 1 } }),
    b: () => new Error("m", { cause: { [sym]: 2 } }),
    strict: false,
    loose: true,
  },

  // node compares the type tags of every pair, in every mode.
  {
    name: "{ [Symbol.toStringTag]: 'a' } and {}",
    a: () => ({ [Symbol.toStringTag]: "a" }),
    b: () => ({}),
    strict: false,
    loose: false,
  },
  {
    name: "{} and { [Symbol.toStringTag]: 'a' }",
    a: () => ({}),
    b: () => ({ [Symbol.toStringTag]: "a" }),
    strict: false,
    loose: false,
  },
  {
    name: "{ [Symbol.toStringTag]: 'Object' } and {}",
    a: () => ({ [Symbol.toStringTag]: "Object" }),
    b: () => ({}),
    strict: false,
    loose: true,
  },
  {
    name: "Symbol.toStringTag values 1 and 2",
    a: () => ({ [Symbol.toStringTag]: 1 }),
    b: () => ({ [Symbol.toStringTag]: 2 }),
    strict: false,
    loose: false,
  },
  {
    name: "an own Symbol.toStringTag and the same inherited one",
    a: () => ({ [Symbol.toStringTag]: "X" }),
    b: () => Object.create({ [Symbol.toStringTag]: "X" }),
    strict: false,
    loose: true,
  },
  {
    name: "[1] with an own Symbol.toStringTag and [1]",
    a: () => tagged([1], "X"),
    b: () => [1],
    strict: false,
    loose: false,
  },
  {
    name: "[1] and [1] with an own Symbol.toStringTag",
    a: () => [1],
    b: () => tagged([1], "X"),
    strict: false,
    loose: false,
  },
  {
    name: "[1] with an own Symbol.toStringTag of 'Array' and [1]",
    a: () => tagged([1], "Array"),
    b: () => [1],
    strict: false,
    loose: false,
  },
  {
    name: "objects with an index key and different Symbol.toStringTag values",
    a: () => ({ 0: 1, [Symbol.toStringTag]: "A" }),
    b: () => ({ 0: 1, [Symbol.toStringTag]: "B" }),
    strict: false,
    loose: false,
  },
  {
    name: "objects with different Symbol.toStringTag getters",
    a: () => ({
      get [Symbol.toStringTag]() {
        return "A";
      },
    }),
    b: () => ({
      get [Symbol.toStringTag]() {
        return "B";
      },
    }),
    strict: false,
    loose: false,
  },
  {
    name: "regexps, one with an own Symbol.toStringTag of 'RegExp'",
    a: () => tagged(/a/, "RegExp"),
    b: () => /a/,
    strict: false,
    loose: false,
  },
  {
    name: "an Error with an own Symbol.toStringTag and an Error",
    a: () => tagged(new Error("m"), "X"),
    b: () => new Error("m"),
    strict: false,
    loose: false,
  },
  {
    name: "two Proxies with different Symbol.toStringTag values",
    a: () => new Proxy({ [Symbol.toStringTag]: "A" }, {}),
    b: () => new Proxy({ [Symbol.toStringTag]: "B" }, {}),
    strict: false,
    loose: false,
  },
  {
    name: "a Proxy of [1] with an own Symbol.toStringTag of 'Array' and a Proxy of [1]",
    a: () => new Proxy(tagged([1], "Array"), {}),
    b: () => new Proxy([1], {}),
    strict: false,
    loose: false,
  },
  // Bun does not compare a non-enumerable tag with an object that has no tag.
  {
    name: "{ 0: 1 } and { 0: 1 } with a non-enumerable Symbol.toStringTag",
    a: () => ({ 0: 1 }),
    b: () => withHiddenProperty({ 0: 1 }, Symbol.toStringTag, "X"),
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },
  {
    name: "an inherited Symbol.toStringTag and a differing symbol-keyed value",
    a: () => Object.assign(Object.create({ [Symbol.toStringTag]: "X" }), { [sym]: 1 }),
    b: () => Object.assign(Object.create({ [Symbol.toStringTag]: "X" }), { [sym]: 2 }),
    strict: false,
    loose: true,
  },
  {
    name: "objects inheriting the same Symbol.toStringTag from two prototypes",
    a: () => Object.create({ [Symbol.toStringTag]: "X" }),
    b: () => Object.create({ [Symbol.toStringTag]: "X" }),
    strict: true,
    loose: true,
  },
  {
    name: "[1] and an array inheriting an enumerable Symbol.toStringTag",
    a: () => [1],
    b: () =>
      Object.setPrototypeOf(
        [1],
        Object.create(Array.prototype, { [Symbol.toStringTag]: { value: "X", enumerable: true } }),
      ),
    strict: false,
    loose: false,
  },
  {
    name: "{ 0: 1 } and an object inheriting an enumerable Symbol.toStringTag with the same index key",
    a: () => ({ 0: 1 }),
    b: () => Object.assign(Object.create({ [Symbol.toStringTag]: "X" }), { 0: 1 }),
    strict: false,
    loose: false,
  },
  {
    name: "instances of two classes with different Symbol.toStringTag getters",
    a: () => new TaggedA(),
    b: () => new TaggedB(),
    strict: false,
    loose: false,
  },
  {
    name: "instances of two classes with the same Symbol.toStringTag getter",
    a: () => new TaggedA(),
    b: () => new AlsoTaggedA(),
    strict: false,
    loose: true,
    skipPrototype: true,
  },
  {
    name: "an instance of a class with a Symbol.toStringTag getter and {}",
    a: () => new TaggedA(),
    b: () => ({}),
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },
  {
    name: "objects with the index key 0 and different non-enumerable Symbol.toStringTag values",
    a: () => withHiddenProperty({ 0: 1 }, Symbol.toStringTag, "A"),
    b: () => withHiddenProperty({ 0: 1 }, Symbol.toStringTag, "B"),
    strict: false,
    loose: false,
  },
  {
    name: "a Headers and a URLSearchParams, both empty",
    a: () => new Headers(),
    b: () => new URLSearchParams(),
    strict: false,
    loose: false,
  },
  // node gives these two pairs no tag, or one tag. Bun gives each class its own non-enumerable tag.
  {
    name: "a BlockList and a SocketAddress",
    a: () => new net.BlockList(),
    b: () => new net.SocketAddress({ address: "127.0.0.1" }),
    strict: false,
    loose: true,
    looseBug: "reports not equal",
  },
  {
    name: "an EventTarget and a BroadcastChannel",
    a: () => new EventTarget(),
    b: closedChannel,
    strict: false,
    loose: true,
    looseBug: "reports not equal",
  },
  {
    name: "a null-prototype Map and a Map",
    a: () => Object.setPrototypeOf(new Map(), null),
    b: () => new Map(),
    strict: false,
    loose: false,
  },
  {
    name: "a Proxy of a Map and a Proxy of a Set",
    a: () => new Proxy(new Map(), {}),
    b: () => new Proxy(new Set(), {}),
    strict: false,
    loose: false,
  },
  {
    name: "a set with an extra own property",
    a: () => withExtraProperty(new Set([1])),
    b: () => new Set([1]),
    strict: false,
    loose: false,
  },
  {
    name: "an arguments object and { 0: 1 }",
    a: () => argumentsObject(1),
    b: () => ({ 0: 1 }),
    strict: false,
    loose: false,
  },

  // node pairs the members of two Sets, and the entries of two Maps, off one to one (setEquiv, mapEquiv).
  {
    name: "sets holding deep-equal objects in different counts",
    a: () => new Set([{ a: 1 }, { a: 1 }, { a: 2 }]),
    b: () => new Set([{ a: 1 }, { a: 2 }, { a: 2 }]),
    strict: false,
    loose: false,
  },
  {
    name: "maps keyed by deep-equal objects in different counts",
    a: () =>
      new Map([
        [{ a: 1 }, 1],
        [{ a: 1 }, 1],
        [{ a: 2 }, 1],
      ]),
    b: () =>
      new Map([
        [{ a: 1 }, 1],
        [{ a: 2 }, 1],
        [{ a: 2 }, 1],
      ]),
    strict: false,
    loose: false,
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
  },
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
  {
    name: "sets holding three deep-equal objects in another order",
    a: () => new Set([{ a: 1 }, { a: 2 }, { a: 3 }]),
    b: () => new Set([{ a: 3 }, { a: 1 }, { a: 2 }]),
    strict: true,
    loose: true,
  },
  {
    name: "sets holding four deep-equal objects in another order",
    a: () => new Set([{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }]),
    b: () => new Set([{ a: 3 }, { a: 1 }, { a: 4 }, { a: 2 }]),
    strict: true,
    loose: true,
  },
  {
    name: "sets holding twelve deep-equal objects, rotated",
    a: () => new Set(twelveObjects(0)),
    b: () => new Set(twelveObjects(5)),
    strict: true,
    loose: true,
  },
  {
    name: "sets holding twelve objects, one different",
    a: () => new Set(twelveObjects(0)),
    b: () => new Set([...twelveObjects(5).slice(0, 11), { a: 99 }]),
    strict: false,
    loose: false,
  },
  // node's compareSmallSets, for a Set of fewer than three members: past the end of the expected Set it compares
  // a member with undefined. So the first two verdicts below depend on the order of the members.
  {
    name: "sets holding the same array and a deep-equal array",
    a: () => new Set([sharedArray, ["x"]]),
    b: () => new Set([["x"], sharedArray]),
    strict: true,
    loose: true,
  },
  {
    name: "sets holding the same object and a copy of it",
    a: () => new Set([sharedObject, { a: 1 }]),
    b: () => new Set([sharedObject, { a: 1 }]),
    strict: false,
    loose: false,
  },
  {
    name: "sets holding a copy of an object and that object",
    a: () => new Set([{ a: 1 }, sharedObject]),
    b: () => new Set([{ a: 1 }, sharedObject]),
    strict: true,
    loose: true,
  },
  {
    name: "sets holding the same object, a copy of it and 7",
    a: () => new Set([sharedObject, { a: 1 }, 7]),
    b: () => new Set([sharedObject, { a: 1 }, 7]),
    strict: true,
    loose: true,
  },
  // https://github.com/oven-sh/bun/issues/34830
  {
    name: "maps keyed by deep-equal regexps with different values",
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
  },
  {
    name: "maps keyed by deep-equal objects with the values in the other order",
    a: () =>
      new Map([
        [{ a: 1 }, "x"],
        [{ a: 1 }, "y"],
      ]),
    b: () =>
      new Map([
        [{ a: 1 }, "y"],
        [{ a: 1 }, "x"],
      ]),
    strict: true,
    loose: true,
  },
  {
    name: "maps keyed by deep-equal objects with the values in different counts",
    a: () =>
      new Map([
        [{ a: 1 }, "x"],
        [{ a: 1 }, "x"],
        [{ a: 1 }, "y"],
      ]),
    b: () =>
      new Map([
        [{ a: 1 }, "x"],
        [{ a: 1 }, "y"],
        [{ a: 1 }, "y"],
      ]),
    strict: false,
    loose: false,
  },
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
  {
    name: "sets whose unshared members are copies of two different shared members",
    a: () => new Set([{ a: 1 }, sharedObject, sharedArray]),
    b: () => new Set([["x"], sharedObject, sharedArray]),
    strict: false,
    loose: false,
  },
  {
    name: "maps keyed by a shared object and copies of it in different counts",
    a: () =>
      new Map([
        [sharedObject, "z"],
        [{ a: 1 }, "z"],
        [{ a: 1 }, "y"],
      ]),
    b: () =>
      new Map([
        [sharedObject, "z"],
        [{ a: 1 }, "y"],
        [{ a: 1 }, "y"],
      ]),
    strict: false,
    loose: false,
  },
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
  },
  {
    name: "maps holding unequal values under the same number key",
    a: () => new Map([[1, "a"]]),
    b: () => new Map([[1, "b"]]),
    strict: false,
    loose: false,
  },
  {
    name: "maps holding four object keys in another order",
    a: () =>
      new Map([
        [{ a: 1 }, 1],
        [{ a: 2 }, 2],
        [{ a: 3 }, 3],
        [{ a: 4 }, 4],
      ]),
    b: () =>
      new Map([
        [{ a: 3 }, 3],
        [{ a: 1 }, 1],
        [{ a: 4 }, 4],
        [{ a: 2 }, 2],
      ]),
    strict: true,
    loose: true,
  },
  {
    name: "maps holding twelve object keys, rotated",
    a: () => new Map(twelveObjects(0).map(key => [key, key.a])),
    b: () => new Map(twelveObjects(5).map(key => [key, key.a])),
    strict: true,
    loose: true,
  },
  {
    name: "maps holding two object keys with the values swapped",
    a: () =>
      new Map([
        [{ a: 1 }, 1],
        [{ a: 2 }, 2],
      ]),
    b: () =>
      new Map([
        [{ a: 1 }, 2],
        [{ a: 2 }, 1],
      ]),
    strict: false,
    loose: false,
  },
  {
    name: "maps holding an object key and a string key in the other order",
    a: () =>
      new Map<unknown, unknown>([
        [{ a: 1 }, 1],
        ["k", 2],
      ]),
    b: () =>
      new Map<unknown, unknown>([
        ["k", 2],
        [{ a: 1 }, 1],
      ]),
    strict: true,
    loose: true,
  },
  {
    name: "maps holding undefined under the same key",
    a: () => new Map([["a", undefined]]),
    b: () => new Map([["a", undefined]]),
    strict: true,
    loose: true,
  },
  // The own properties of a Set or a Map compare after its members.
  {
    name: "a set with an extra own property, after its members pair off",
    a: () => withExtraProperty(new Set([{ a: 1 }, { a: 2 }, { a: 3 }])),
    b: () => new Set([{ a: 3 }, { a: 1 }, { a: 2 }]),
    strict: false,
    loose: false,
  },
  {
    name: "sets whose members pair off, with equal extra own properties",
    a: () => withExtraProperty(new Set([{ a: 1 }, { a: 2 }, { a: 3 }])),
    b: () => withExtraProperty(new Set([{ a: 3 }, { a: 1 }, { a: 2 }])),
    strict: true,
    loose: true,
  },
  {
    name: "sets whose members pair off, with unequal own index properties",
    a: () => Object.assign(new Set([{ a: 1 }, { a: 2 }, { a: 3 }]), { 0: 1 }),
    b: () => Object.assign(new Set([{ a: 3 }, { a: 1 }, { a: 2 }]), { 0: 2 }),
    strict: false,
    loose: false,
  },
  {
    name: "a map with an extra own property, after its entries pair off",
    a: () =>
      withExtraProperty(
        new Map([
          [{ a: 1 }, 1],
          [{ a: 2 }, 2],
          [{ a: 3 }, 3],
        ]),
      ),
    b: () =>
      new Map([
        [{ a: 3 }, 3],
        [{ a: 1 }, 1],
        [{ a: 2 }, 2],
      ]),
    strict: false,
    loose: false,
  },
  {
    name: "maps whose entries pair off, with equal own index properties",
    a: () =>
      Object.assign(
        new Map([
          [{ a: 1 }, 1],
          [{ a: 2 }, 2],
          [{ a: 3 }, 3],
        ]),
        { 0: 1 },
      ),
    b: () =>
      Object.assign(
        new Map([
          [{ a: 3 }, 3],
          [{ a: 1 }, 1],
          [{ a: 2 }, 2],
        ]),
        { 0: 1 },
      ),
    strict: true,
    loose: true,
  },
  {
    name: "sets holding a set of objects in another order",
    a: () => new Set<unknown>([new Set([{ a: 1 }, { a: 2 }, { a: 3 }]), 1]),
    b: () => new Set<unknown>([1, new Set([{ a: 3 }, { a: 1 }, { a: 2 }])]),
    strict: true,
    loose: true,
  },
  {
    name: "maps holding maps under object keys in another order",
    a: () =>
      new Map<unknown, unknown>([
        [
          { k: 1 },
          new Map([
            [{ a: 1 }, 1],
            [{ a: 2 }, 2],
          ]),
        ],
        [{ k: 2 }, new Map([[{ a: 3 }, 3]])],
        [{ k: 3 }, 3],
      ]),
    b: () =>
      new Map<unknown, unknown>([
        [{ k: 3 }, 3],
        [{ k: 2 }, new Map([[{ a: 3 }, 3]])],
        [
          { k: 1 },
          new Map([
            [{ a: 2 }, 2],
            [{ a: 1 }, 1],
          ]),
        ],
      ]),
    strict: true,
    loose: true,
  },

  // Loose mode pairs a primitive member or key with the first one that it equals under `==`.
  {
    name: "sets holding 1, 2, 3, 4 and '3', '1', '4', '2'",
    a: () => new Set([1, 2, 3, 4]),
    b: () => new Set(["3", "1", "4", "2"]),
    strict: false,
    loose: true,
  },
  {
    name: "sets holding 0, null and 0, '0'",
    a: () => new Set([0, null]),
    b: () => new Set([0, "0"]),
    strict: false,
    loose: true,
    swapped: { loose: false },
  },
  {
    name: "sets holding 0, '0' and 0, null",
    a: () => new Set([0, "0"]),
    b: () => new Set([0, null]),
    strict: false,
    loose: false,
    swapped: { loose: true },
  },
  {
    name: "sets holding 1, '1' and 1, 1n",
    a: () => new Set([1, "1"]),
    b: () => new Set([1, 1n]),
    strict: false,
    loose: false,
  },
  {
    name: "sets holding 5, { a: 1 } and { a: 1 }, 5",
    a: () => new Set([5, { a: 1 }]),
    b: () => new Set([{ a: 1 }, 5]),
    strict: true,
    loose: true,
  },
  {
    name: "sets holding { a: 1 }, 5 and 5, { a: 1 }",
    a: () => new Set([{ a: 1 }, 5]),
    b: () => new Set([5, { a: 1 }]),
    strict: true,
    loose: true,
  },
  {
    name: "sets holding 0, 1 and 0, 1n",
    a: () => new Set([0, 1]),
    b: () => new Set([0, 1n]),
    strict: false,
    loose: true,
  },
  {
    name: "sets holding null, undefined, 1 and undefined, null, '1'",
    a: () => new Set([null, undefined, 1]),
    b: () => new Set([undefined, null, "1"]),
    strict: false,
    loose: true,
  },
  {
    name: "sets holding 1, 0, '0' and false, '1', ''",
    a: () => new Set([1, 0, "0"]),
    b: () => new Set([false, "1", ""]),
    strict: false,
    loose: false,
    swapped: { loose: true },
  },
  {
    name: "sets holding false, '1', '' and 1, 0, '0'",
    a: () => new Set([false, "1", ""]),
    b: () => new Set([1, 0, "0"]),
    strict: false,
    loose: true,
    swapped: { loose: false },
  },
  {
    name: "sets holding 0, '0', false and '0', 1, ''",
    a: () => new Set([0, "0", false]),
    b: () => new Set(["0", 1, ""]),
    strict: false,
    loose: false,
  },
  {
    name: "sets holding '1', undefined and '1', 1",
    a: () => new Set(["1", undefined]),
    b: () => new Set(["1", 1]),
    strict: false,
    loose: true,
    swapped: { loose: false },
  },
  {
    name: "maps holding null => '', undefined => 'a' and undefined => 0, null => 'a'",
    a: () =>
      new Map<unknown, unknown>([
        [null, ""],
        [undefined, "a"],
      ]),
    b: () =>
      new Map<unknown, unknown>([
        [undefined, 0],
        [null, "a"],
      ]),
    strict: false,
    loose: false,
  },
  {
    name: "maps holding 1 => 1n, 1n => true and 1n => 'a', true => true",
    a: () =>
      new Map<unknown, unknown>([
        [1, 1n],
        [1n, true],
      ]),
    b: () =>
      new Map<unknown, unknown>([
        [1n, "a"],
        [true, true],
      ]),
    strict: false,
    loose: false,
  },
  {
    name: "maps with the keys 1, 0, '0' and false, '1', ''",
    a: () =>
      new Map<unknown, unknown>([
        [1, "x"],
        [0, "x"],
        ["0", "x"],
      ]),
    b: () =>
      new Map<unknown, unknown>([
        [false, "x"],
        ["1", "x"],
        ["", "x"],
      ]),
    strict: false,
    loose: false,
    swapped: { loose: true },
  },
  // node compares the values under one number key three times at each level. Bun compares them once.
  {
    name: "maps nested twelve deep under a number key, with a different leaf",
    a: () => nestedMap(12, 1, "a"),
    b: () => nestedMap(12, 1, "b"),
    strict: false,
    loose: false,
  },
  {
    name: "maps nested twelve deep under a number key, beside an object key",
    a: () => nestedMap(12, 1, "a", true),
    b: () => nestedMap(12, 1, "a", true),
    strict: true,
    loose: true,
  },
  {
    name: "sets that hold themselves",
    a: () => selfHoldingSet(),
    b: () => selfHoldingSet(),
    strict: true,
    loose: true,
  },
  {
    name: "maps that hold themselves as a value",
    a: () => selfHoldingMap("k"),
    b: () => selfHoldingMap("k"),
    strict: true,
    loose: true,
  },
  {
    name: "maps that hold themselves under an object key",
    a: () => selfHoldingMap({ k: 1 }),
    b: () => selfHoldingMap({ k: 1 }),
    strict: true,
    loose: true,
  },
  {
    name: "maps holding a map that holds itself, beside different values",
    a: () =>
      new Map<unknown, unknown>([
        [1, "x"],
        [0, selfHoldingMap("k")],
      ]),
    b: () =>
      new Map<unknown, unknown>([
        [1, "y"],
        [0, selfHoldingMap("k")],
      ]),
    strict: false,
    loose: false,
  },
  {
    name: "sets holding an object that holds the set",
    a: () => setHeldByItsMember(),
    b: () => setHeldByItsMember(),
    strict: true,
    loose: true,
  },

  // node accepts every element against a null one in loose mode, until the expected array has a hole (nodejs/node#61587).
  { name: "[5] and [null]", a: () => [5], b: () => [null], strict: false, loose: true, swapped: { loose: false } },
  { name: "[null] and [5]", a: () => [null], b: () => [5], strict: false, loose: false, swapped: { loose: true } },
  { name: "[undefined] and [null]", a: () => [undefined], b: () => [null], strict: false, loose: true },
  {
    name: "[{ a: 1 }, 2] and [null, 2]",
    a: () => [{ a: 1 }, 2],
    b: () => [null, 2],
    strict: false,
    loose: true,
    swapped: { loose: false },
  },
  {
    name: "a hole and a null element",
    a: () => [,],
    b: () => [null],
    strict: false,
    loose: true,
    swapped: { loose: false },
  },
  { name: "[, 5] and [, null]", a: () => [, 5], b: () => [, null], strict: false, loose: false },
  {
    name: "[5, , 7] and [null, , 7]",
    a: () => [5, , 7],
    b: () => [null, , 7],
    strict: false,
    loose: true,
    swapped: { loose: false },
  },
  { name: "{ a: 5 } and { a: null }", a: () => ({ a: 5 }), b: () => ({ a: null }), strict: false, loose: false },
  // node compares `lastIndex` with ===.
  {
    name: "regexps with lastIndex -0 and 0",
    a: () => Object.assign(/a/g, { lastIndex: -0 }),
    b: () => Object.assign(/a/g, { lastIndex: 0 }),
    strict: true,
    loose: true,
  },
  {
    name: "regexps with lastIndex NaN",
    a: () => Object.assign(/a/g, { lastIndex: NaN }),
    b: () => Object.assign(/a/g, { lastIndex: NaN }),
    strict: false,
    loose: false,
  },
  // Loose mode compares the elements of a float array with ==, and NaN is not NaN.
  {
    name: "two Float64Array views of one buffer that holds NaN",
    a: () => new Float64Array(nanBuffer),
    b: () => new Float64Array(nanBuffer),
    strict: true,
    loose: false,
  },
  // node's isError branch: message, name, cause and errors compare unless the expected Error lists the key, then
  // both Errors need `cause` as an own property, or neither.
  {
    name: "an Error subclass with an inherited undefined cause and an Error",
    a: () => new ErrorWithInheritedCause("x"),
    b: () => new Error("x"),
    strict: false,
    loose: true,
    skipPrototype: true,
  },
  {
    name: "an Error with an undefined cause and an Error without a cause",
    a: () => new Error("x", { cause: undefined }),
    b: () => new Error("x"),
    strict: false,
    loose: false,
  },
  {
    name: "an Error and an Error subclass instance",
    a: () => new Error("m"),
    b: () => new (class Sub extends Error {})("m"),
    strict: false,
    loose: true,
    skipPrototype: true,
  },
  {
    name: "AggregateErrors with different errors",
    a: () => new AggregateError([1], "m"),
    b: () => new AggregateError([2], "m"),
    strict: false,
    loose: false,
  },
  {
    name: "AggregateErrors with equal errors",
    a: () => new AggregateError([{ a: 1 }], "m"),
    b: () => new AggregateError([{ a: 1 }], "m"),
    strict: true,
    loose: true,
  },
  {
    name: "errors, one with an enumerable message",
    a: () => new Error("m"),
    b: () => Object.defineProperty(new Error("m"), "message", { enumerable: true }),
    strict: false,
    loose: false,
  },
  {
    name: "errors with the same enumerable message and different inherited names",
    a: () => Object.defineProperty(new Error("m"), "message", { enumerable: true }),
    b: () => Object.defineProperty(new TypeError("m"), "message", { enumerable: true }),
    strict: false,
    loose: false,
  },
  {
    name: "errors whose names differ through an own non-enumerable name",
    a: () => new Error("m"),
    b: () => withHiddenProperty(new Error("m"), "name", "Other"),
    strict: false,
    loose: false,
  },
  {
    name: "an Error and an object that inherits from Error.prototype",
    a: () => new Error("m"),
    b: () => Object.create(Error.prototype),
    strict: false,
    loose: false,
  },
  // A function is not an object: two functions are equal only when they are the same one.
  { name: "the Map and Set constructors", a: () => Map, b: () => Set, strict: false, loose: false },
  { name: "two functions with the same source", a: () => () => {}, b: () => () => {}, strict: false, loose: false },
  // node reads a value, and the tag, of a Proxy through its get trap.
  {
    name: "{ a: 2 } and a Proxy of { a: 1 } whose get trap answers 2",
    a: () => ({ a: 2 }),
    b: () =>
      new Proxy({ a: 1 }, { get: (target, key, receiver) => (key === "a" ? 2 : Reflect.get(target, key, receiver)) }),
    strict: true,
    loose: true,
  },
  {
    name: "{} and a Proxy of {} whose get trap answers a Symbol.toStringTag",
    a: () => ({}),
    b: () => new Proxy({}, tagTrap("X")),
    strict: false,
    loose: false,
  },
  {
    name: "objects with different non-enumerable Symbol.toStringTag values",
    a: () => withHiddenProperty({ x: 1 }, Symbol.toStringTag, "A"),
    b: () => withHiddenProperty({ x: 1 }, Symbol.toStringTag, "B"),
    strict: false,
    loose: false,
  },
  {
    name: "instances of one class whose Symbol.toStringTag getter answers per instance",
    a: () => new TaggedPerInstance("A"),
    b: () => new TaggedPerInstance("B"),
    strict: false,
    loose: false,
  },
  // node compares the string that a boxed string wraps, not what toString() answers.
  {
    name: "boxed strings, one with an own toString method",
    a: () => new String("a"),
    b: () => withHiddenProperty(new String("b"), "toString", () => "a"),
    strict: false,
    loose: false,
  },
  {
    name: "a String subclass instance and a boxed string",
    a: () => new (class Sub extends String {})("a"),
    b: () => new String("a"),
    strict: false,
    loose: true,
    skipPrototype: true,
  },
  {
    name: "URLs with different hrefs",
    a: () => new URL("http://a/"),
    b: () => new URL("http://b/"),
    strict: false,
    loose: false,
  },
  { name: "equal URLs", a: () => new URL("http://a/"), b: () => new URL("http://a/"), strict: true, loose: true },
  { name: "a URL and {}", a: () => new URL("http://a/"), b: () => ({}), strict: false, loose: false },
  { name: "{} and a URL", a: () => ({}), b: () => new URL("http://a/"), strict: false, loose: false },
  {
    name: "a Proxy of {} and a URL",
    a: () => new Proxy({}, {}),
    b: () => new URL("http://a/"),
    strict: false,
    loose: false,
  },

  // node's sparseArrayEquiv: from the first hole of the expected array, the two arrays need as many elements as each
  // other, and only the elements of the expected array compare.
  { name: "[ , , ] and [null, , ]", a: () => [, ,], b: () => [null, ,], strict: false, loose: false },
  { name: "[ , , 1] and [null, , 1]", a: () => [, , 1], b: () => [null, , 1], strict: false, loose: false },
  { name: "[ , 2, , ] and [null, 2, , ]", a: () => [, 2, ,], b: () => [null, 2, ,], strict: false, loose: false },
  {
    name: "[[], , null] and [[], null, , ]",
    a: () => [[], , null],
    b: () => [[], null, ,],
    strict: false,
    loose: true,
    swapped: { loose: false },
  },
  {
    name: "[ , 1] and [null, , ]",
    a: () => [, 1],
    b: () => [null, ,],
    strict: false,
    loose: true,
    swapped: { loose: false },
  },
  {
    name: "[ , 2, 3] and [null, , 3]",
    a: () => [, 2, 3],
    b: () => [null, , 3],
    strict: false,
    loose: true,
    swapped: { loose: false },
  },
  { name: "[1, , , 3] and [1, , , 3]", a: () => [1, , , 3], b: () => [1, , , 3], strict: true, loose: true },
  {
    name: "[1, , , 3] and [1, , , 3, , , ]",
    a: () => [1, , , 3],
    b: () => [1, , , 3, , ,],
    strict: false,
    loose: false,
  },
  {
    name: "[1, undefined, , 3] and [1, , , 3]",
    a: () => [1, undefined, , 3],
    b: () => [1, , , 3],
    strict: false,
    loose: false,
  },
  { name: "[ , , true] and [ , true, ]", a: () => [, , true], b: () => [, true, ,], strict: false, loose: false },
  {
    name: "[true, , true] and [ , true, true]",
    a: () => [true, , true],
    b: () => [, true, true],
    strict: false,
    loose: false,
  },
  {
    name: "[1, , null] and [1, , undefined]",
    a: () => [1, , null],
    b: () => [1, , undefined],
    strict: false,
    loose: true,
  },
  { name: "[1, , 5] and [1, , null]", a: () => [1, , 5], b: () => [1, , null], strict: false, loose: false },
  { name: "a Proxy of [1, 2] and [1, 2]", a: () => new Proxy([1, 2], {}), b: () => [1, 2], strict: true, loose: true },
  {
    name: "a Proxy of [1, 2] and [1, 2, 3]",
    a: () => new Proxy([1, 2], {}),
    b: () => [1, 2, 3],
    strict: false,
    loose: false,
  },
  // Bun compares a Proxy of an array key by key, so the null element gets no special rule.
  {
    name: "a Proxy of [5] and [null]",
    a: () => new Proxy([5], {}),
    b: () => [null],
    strict: false,
    loose: true,
    swapped: { loose: false },
    looseBug: "reports not equal",
  },

  // Bun settles a key that both Maps hold by lookup. node pairs every object key off by comparison, in the order of
  // the expected Map.
  {
    name: "maps sharing four object keys in another order",
    a: () => mapOf(sharedKeys.slice(0, 4)),
    b: () => new Map([2, 0, 3, 1].map(index => [sharedKeys[index], index])),
    strict: true,
    loose: true,
  },
  {
    name: "maps sharing twelve object keys, rotated",
    a: () => mapOf(sharedKeys, key => ({ value: key })),
    b: () => mapOf([...sharedKeys.slice(5), ...sharedKeys.slice(0, 5)], key => ({ value: key })),
    strict: true,
    loose: true,
  },
  {
    name: "maps sharing twelve object keys, rotated, with one unequal value",
    a: () => mapOf(sharedKeys, key => ({ value: key })),
    b: () =>
      mapOf([...sharedKeys.slice(5), ...sharedKeys.slice(0, 5)], key => ({ value: key === sharedKeys[7] || key })),
    strict: false,
    loose: false,
  },
  {
    name: "maps sharing two deep-equal keys with the values swapped",
    a: () =>
      new Map<unknown, unknown>([
        [sharedKeys[0], 1],
        [sharedObject, 2],
        [one, 1],
      ]),
    b: () =>
      new Map<unknown, unknown>([
        [sharedKeys[0], 1],
        [sharedObject, 1],
        [one, 2],
      ]),
    strict: true,
    loose: true,
  },
  {
    name: "maps sharing a key with unequal values, where a deep-equal key holds the value",
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
  },
  {
    name: "maps sharing a key with unequal values beside an equal entry",
    a: () =>
      new Map<unknown, unknown>([
        [sharedObject, 1],
        [{ b: 1 }, 2],
      ]),
    b: () =>
      new Map<unknown, unknown>([
        [sharedObject, 2],
        [{ b: 1 }, 2],
      ]),
    strict: false,
    loose: false,
  },
  // Two orders of one question. node pairs the first entry with the first key that fits, and `==` is not transitive.
  {
    name: "maps [{ a: 1 }, K] and [K, { a: '1' }] with the shared key K = { a: '01' }",
    a: () =>
      new Map<unknown, unknown>([
        [{ a: 1 }, 0],
        [zeroOne, 0],
      ]),
    b: () =>
      new Map<unknown, unknown>([
        [zeroOne, 0],
        [{ a: "1" }, 0],
      ]),
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },
  {
    name: "maps [K, { a: '01' }] and [{ a: '1' }, K] with the shared key K = { a: 1 }",
    a: () =>
      new Map<unknown, unknown>([
        [one, 0],
        [{ a: "01" }, 0],
      ]),
    b: () =>
      new Map<unknown, unknown>([
        [{ a: "1" }, 0],
        [one, 0],
      ]),
    strict: false,
    loose: true,
    looseBug: "reports not equal",
  },
  // node compares an object key with the same key again, and a Promise is not equal to a Promise.
  {
    name: "maps sharing a Promise key and an object key",
    a: () =>
      new Map<unknown, unknown>([
        [sharedPromise, 1],
        [sharedObject, 2],
      ]),
    b: () =>
      new Map<unknown, unknown>([
        [sharedPromise, 1],
        [sharedObject, 2],
      ]),
    strict: false,
    loose: true,
    strictBug: "reports equal",
    skipPrototypeBug: "reports equal",
  },
  // Equal in a new node process. After a comparison of a cycle, node reports this pair as not equal (nodejs/node#62422).
  {
    name: "objects holding maps with two shared object keys",
    a: () => ({
      map: new Map<unknown, unknown>([
        [sharedObject, 1],
        [stringOne, 2],
      ]),
    }),
    b: () => ({
      map: new Map<unknown, unknown>([
        [sharedObject, 1],
        [stringOne, 2],
      ]),
    }),
    strict: true,
    loose: true,
  },
  // The other verdict of node's compareSmallSets: past the end of the expected Set it compares undefined.
  {
    name: "sets holding a shared object with undefined and with a deep-equal object",
    a: () => new Set([sharedObject, undefined]),
    b: () => new Set([sharedObject, { a: 1 }]),
    strict: true,
    loose: true,
    swapped: { loose: false, strict: false },
  },

  // The value of an Error's `stack` never compares in Bun, and the loose mode does not count the key.
  {
    name: "errors with different own enumerable stacks",
    a: () => errorWithEnumerableStack("one"),
    b: () => errorWithEnumerableStack("two"),
    strict: false,
    loose: false,
    strictBug: "reports equal",
    looseBug: "reports equal",
    skipPrototypeBug: "reports equal",
  },
  {
    name: "errors with the same own enumerable stack",
    a: () => errorWithEnumerableStack("one"),
    b: () => errorWithEnumerableStack("one"),
    strict: true,
    loose: true,
  },
  {
    name: "an error with an own enumerable stack and an error",
    a: () => errorWithEnumerableStack("one"),
    b: () => new Error("m"),
    strict: false,
    loose: false,
    looseBug: "reports equal",
  },
  {
    name: "errors with recaptured stacks",
    a: errorWithRecapturedStack,
    b: errorWithRecapturedStack,
    strict: true,
    loose: true,
  },
  {
    name: "errors without a trace, with different assigned stacks",
    a: () => errorWithoutTrace("one"),
    b: () => errorWithoutTrace("two"),
    strict: true,
    loose: true,
  },
  {
    name: "an error without a trace with an assigned stack, and one without a stack",
    a: () => errorWithoutTrace("one"),
    b: () => errorWithoutTrace(),
    strict: true,
    loose: true,
    strictBug: "reports not equal",
    skipPrototypeBug: "reports not equal",
  },
  {
    name: "an error without a trace with an assigned stack, and an error",
    a: () => errorWithoutTrace("one"),
    b: () => new Error("m"),
    strict: true,
    loose: true,
    strictBug: "reports not equal",
    skipPrototypeBug: "reports not equal",
  },

  // node's isURL: an object with the type tag of a URL, an href and a protocol compares by its href.
  {
    name: "a URL and an object that looks like a URL, with the same href",
    a: () => new URL("http://a/"),
    b: () => new URLLike("http://a/"),
    strict: false,
    loose: true,
    skipPrototype: true,
  },
  {
    name: "a URL and an object that looks like a URL, with another href",
    a: () => new URL("http://a/"),
    b: () => new URLLike("http://b/"),
    strict: false,
    loose: false,
  },
  {
    name: "a URL and a null-prototype object that looks like a URL",
    a: () => new URL("http://a/"),
    b: () =>
      Object.defineProperties(Object.create(null), {
        [Symbol.toStringTag]: { value: "URL" },
        href: { value: "http://a/" },
        protocol: { value: "http:" },
      }),
    strict: false,
    loose: true,
    skipPrototype: true,
  },
  // node asks only the actual value whether it looks like a URL.
  {
    name: "a URL and an object with the type tag of a URL",
    a: () => new URL("http://a/"),
    b: () => ({ [Symbol.toStringTag]: "URL" }),
    strict: false,
    loose: false,
    swapped: { loose: true },
    looseBug: "reports not equal in both orders",
  },
  // Bun applies the rule only when one of the two is a URL.
  {
    name: "objects that look like URLs, with different hrefs",
    a: () => new URLLike("http://a/"),
    b: () => new URLLike("http://b/"),
    strict: false,
    loose: false,
    strictBug: "reports equal",
    looseBug: "reports equal",
    skipPrototypeBug: "reports equal",
  },
  {
    name: "objects that look like URLs, with the same href",
    a: () => new URLLike("http://a/"),
    b: () => new URLLike("http://a/"),
    strict: true,
    loose: true,
  },
  {
    name: "URLs with an unequal own property",
    a: () => Object.assign(new URL("http://a/"), { extra: 1 }),
    b: () => Object.assign(new URL("http://a/"), { extra: 2 }),
    strict: false,
    loose: false,
  },
  {
    name: "URLs with an equal own property",
    a: () => Object.assign(new URL("http://a/"), { extra: 1 }),
    b: () => Object.assign(new URL("http://a/"), { extra: 1 }),
    strict: true,
    loose: true,
  },

  // node compares two type tags with ===. The strict modes of Bun compare the Object.prototype.toString results,
  // which leave out a tag that is no string.
  {
    name: "dates with the non-enumerable Symbol.toStringTag values 1 and 2",
    a: () => withHiddenProperty(new Date(0), Symbol.toStringTag, 1),
    b: () => withHiddenProperty(new Date(0), Symbol.toStringTag, 2),
    strict: false,
    loose: false,
    strictBug: "reports equal",
    skipPrototypeBug: "reports equal",
  },
  {
    name: "objects with the non-enumerable Symbol.toStringTag values 1 and 2",
    a: () => withHiddenProperty({}, Symbol.toStringTag, 1),
    b: () => withHiddenProperty({}, Symbol.toStringTag, 2),
    strict: false,
    loose: false,
    strictBug: "reports equal",
    skipPrototypeBug: "reports equal",
  },

  // node compares `source` and `flags`. A slash in a pattern string is escaped in the source.
  {
    name: "new RegExp('^/api/') and /^\\/api\\//",
    a: () => new RegExp("^/api/"),
    b: () => /^\/api\//,
    strict: true,
    loose: true,
  },
  {
    name: "a RegExp made from a string with a slash, and its new RegExp(source, flags) copy",
    a: () => new RegExp("a/b", "g"),
    b: () => {
      const original = new RegExp("a/b", "g");
      return new RegExp(original.source, original.flags);
    },
    strict: true,
    loose: true,
  },
  {
    name: "new RegExp('a/b', 'g') and /a\\/b/",
    a: () => new RegExp("a/b", "g"),
    b: () => /a\/b/,
    strict: false,
    loose: false,
  },
  // Bun reads the pattern and the flags of the RegExp itself, not the `source` and `flags` properties.
  {
    name: "/a/ with the own source 'b', and /a/",
    a: () => withHiddenProperty(/a/, "source", "b"),
    b: () => /a/,
    strict: false,
    loose: false,
    strictBug: "reports equal",
    looseBug: "reports equal",
    skipPrototypeBug: "reports equal",
  },

  // Bun reads the native entries of a Map or a Set. node calls size, has, get and the iterators, which a subclass can
  // override.
  {
    name: "instances of a Map subclass with its own storage, with different entries",
    a: () => new MapWithOwnStorage().set("a", 1),
    b: () => new MapWithOwnStorage().set("b", 2),
    strict: false,
    loose: false,
    strictBug: "reports equal",
    looseBug: "reports equal",
    skipPrototypeBug: "reports equal",
  },
  {
    name: "instances of a Map subclass with its own storage, with the same entries",
    a: () => new MapWithOwnStorage().set("a", 1),
    b: () => new MapWithOwnStorage().set("a", 1),
    strict: true,
    loose: true,
  },
  {
    name: "instances of a Map subclass with its own storage, one of them empty",
    a: () => new MapWithOwnStorage().set("a", 1),
    b: () => new MapWithOwnStorage(),
    strict: false,
    loose: false,
    strictBug: "reports equal",
    looseBug: "reports equal",
    skipPrototypeBug: "reports equal",
  },
  {
    name: "instances of a Set subclass with its own storage, with different members",
    a: () => new SetWithOwnStorage().add(1),
    b: () => new SetWithOwnStorage().add(2),
    strict: false,
    loose: false,
    strictBug: "reports equal",
    looseBug: "reports equal",
    skipPrototypeBug: "reports equal",
  },
  {
    name: "instances of a Set subclass with its own storage, with the same members",
    a: () => new SetWithOwnStorage().add(1),
    b: () => new SetWithOwnStorage().add(1),
    strict: true,
    loose: true,
  },
];

// The third argument is new in Node v26.
const isDeepStrictEqual = util.isDeepStrictEqual as (a: unknown, b: unknown, skipPrototype?: boolean) => boolean;

export type Question = "loose" | "strict" | "skipPrototype";
export const questions: Question[] = ["loose", "strict", "skipPrototype"];

/** What a row says about one question, for (a, b) or for (b, a). */
export function expected(testCase: Case, question: Question, swapped = false): boolean {
  const verdict = question === "skipPrototype" ? (testCase.skipPrototype ?? testCase.strict) : testCase[question];
  if (!swapped) return verdict;
  const override = testCase.swapped?.[question];
  if (override !== undefined) return override;
  return question === "skipPrototype" && testCase.skipPrototype === undefined
    ? (testCase.swapped?.strict ?? verdict)
    : verdict;
}

function ask(question: Question, actual: unknown, expectedValue: unknown): string {
  try {
    if (question === "loose") {
      assert.deepEqual(actual, expectedValue);
      return "1";
    }
    return isDeepStrictEqual(actual, expectedValue, question === "skipPrototype") ? "1" : "0";
  } catch (error) {
    return (error as { code?: string })?.code === "ERR_ASSERTION" ? "0" : "!";
  }
}

/** Six characters, two for each of `questions` ((a, b), then (b, a)): "1" equal, "0" not equal, "!" another error. */
export function verdictsOfRow(testCase: Case): string {
  return questions
    .map(question => ask(question, testCase.a(), testCase.b()) + ask(question, testCase.b(), testCase.a()))
    .join("");
}

/** The same six characters, from the fields of the row. */
export function verdictsInRow(testCase: Case): string {
  return questions
    .map(question => (expected(testCase, question) ? "1" : "0") + (expected(testCase, question, true) ? "1" : "0"))
    .join("");
}

function holdsItself(value: unknown, path: unknown[] = []): boolean {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;
  if (path.includes(value)) return true;
  path.push(value);
  try {
    const held: unknown[] = [];
    if (value instanceof Map) held.push(...value.keys(), ...value.values());
    else if (value instanceof Set) held.push(...value);
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (descriptor && "value" in descriptor) held.push(descriptor.value);
    }
    return held.some(item => holdsItself(item, path));
  } catch {
    return false;
  } finally {
    path.pop();
  }
}

/**
 * `verdictsOfRow` for every row. The first comparison of a cycle switches Node.js to a second comparator for the rest
 * of the process, and that one answers some other pairs differently (nodejs/node#62422). The rows carry the verdicts
 * of a new process, so the rows without a cycle are asked first.
 */
export function verdictsOfRows(): string[] {
  const cyclic = cases.map(testCase => holdsItself(testCase.a()) || holdsItself(testCase.b()));
  const verdicts: string[] = [];
  for (const pass of [false, true]) {
    cases.forEach((testCase, index) => {
      if (cyclic[index] === pass) verdicts[index] = verdictsOfRow(testCase);
    });
  }
  return verdicts;
}
