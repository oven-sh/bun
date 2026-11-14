import { arrayBufferEquality, equals, iterableEquality, sparseArrayEquality, typeEquality } from "@jest/expect-utils";
import { bunEnv, bunExe, isASAN, isWindows, tempDir } from "harness";
import assert from "node:assert";
import { createSecretKey } from "node:crypto";
import querystring from "node:querystring";
import { isDeepStrictEqual, parseArgs } from "node:util";
import vm, * as vmNamespace from "node:vm";

describe.each([true, false])("Bun.deepEquals(a, b, strict: %p)", strict => {
  const deepEquals = (a: unknown, b: unknown) => Bun.deepEquals(a, b, strict);
  it.each([
    [1, 1],
    [true, true],
    [undefined, undefined],
    [null, null],
    ["foo", "foo"],
    [{}, {}],
    [{ a: 1 }, { a: 1 }],
    [new Map(), new Map()],
    [new Set(), new Set()],
    [Symbol.for("foo"), Symbol.for("foo")],
    [NaN, NaN],
  ])("Bun.deepEquals(%p, %p) === true, regardless of strict modee", (a, b) => {
    expect(Bun.deepEquals(a, b, true)).toBe(true);
    expect(Bun.deepEquals(a, b, false)).toBe(true);
  });

  it.each([
    [0, 1],
    [-0, +0], //
    [{ a: 1 }, { a: 2 }],
    ["foo", "bar"],
  ])("Bun.deepEquals(%p, %p) !== true, regardless of strict modee", (a, b) => {
    expect(Bun.deepEquals(a, b, true)).toBe(false);
    expect(Bun.deepEquals(a, b, false)).toBe(false);
  });

  // https://github.com/nodejs/node/issues/10258
  it("fake dates are not equal", () => {
    function FakeDate() {}
    FakeDate.prototype = Date.prototype;
    const a = new Date("2016");
    const b = new FakeDate();
    expect(deepEquals(a, b)).toBe(false);
    expect(deepEquals(b, a)).toBe(false);
  });

  it("fake maps are not equal", () => {
    function FakeMap() {}
    FakeMap.prototype = Map.prototype;
    const a = new Map();
    const b = new FakeMap();
    expect(deepEquals(a, b)).toBe(false);
    expect(deepEquals(b, a)).toBe(false);
  });

  // we may change this in the future
  it("functions that are not reference-equal are never equal", () => {
    function foo() {}
    function bar() {}
    function baz(a) {}
    expect(deepEquals(foo, foo)).toBe(true);
    expect(deepEquals(foo, bar)).toBe(false);
    expect(deepEquals(foo, baz)).toBe(false);
  });

  it("KeyObjects and CryptoKeys are compared by what they hold", () => {
    const key = (fill: number) => createSecretKey(Buffer.alloc(16, fill));
    const cryptoKey = (fill: number, extractable = true) => key(fill).toCryptoKey("AES-GCM", extractable, ["encrypt"]);
    expect({
      sameKeyObject: deepEquals(key(1), key(1)),
      otherKeyObject: deepEquals(key(1), key(2)),
      nestedKeyObject: deepEquals({ keys: [key(1)] }, { keys: [key(2)] }),
      sameCryptoKey: deepEquals(cryptoKey(1), cryptoKey(1)),
      otherCryptoKey: deepEquals(cryptoKey(1), cryptoKey(2)),
      otherExtractable: deepEquals(cryptoKey(1), cryptoKey(1, false)),
    }).toEqual({
      sameKeyObject: true,
      otherKeyObject: false,
      nestedKeyObject: false,
      sameCryptoKey: true,
      otherCryptoKey: false,
      otherExtractable: false,
    });

    const matcher = strict ? "toStrictEqual" : "toEqual";
    expect(key(1))[matcher](key(1));
    expect(key(1)).not[matcher](key(2));
    expect(cryptoKey(1))[matcher](cryptoKey(1));
    expect(cryptoKey(1)).not[matcher](cryptoKey(2));
  });

  describe("global object", () => {
    let contexts: [vm.Context, vm.Context];

    beforeEach(() => {
      contexts = [vm.createContext(), vm.createContext()];
    });
    afterEach(() => {});

    // Skipped until https://github.com/oven-sh/bun/issues/17080 is resolved.
    it.skip("main global object is not equal to vm global objects", () => {
      const [ctx] = contexts;
      expect(deepEquals(global, ctx)).toBe(false);

      ctx.mainGlobal = global;
      const areEqual = vm.runInContext("Bun.deepEquals(globalThis, mainGlobal)", ctx);
      expect(areEqual).toBe(false);
    });
  });
});

describe("the global of a node:vm context compares by its properties", () => {
  const notContextified = (properties: object) =>
    Object.assign(vm.createContext(vm.constants.DONT_CONTEXTIFY), properties);
  const contextified = (properties: object) => vm.runInContext("this", vm.createContext({ ...properties }));
  const declared = (code: string) => {
    const context = vm.createContext(vm.constants.DONT_CONTEXTIFY);
    vm.runInContext(code, context);
    return context;
  };
  const same = notContextified({ a: 1 });

  // loose matches Node, Jest and vitest. nodeStrict matches Node. strict also requires equal class names.
  it.each([
    ["itself", same, same, true, true, true],
    ["an object with the same properties", notContextified({ a: 1 }), { a: 1 }, true, false, false],
    ["an object with no properties", notContextified({ a: 1 }), {}, false, false, false],
    ["an object with another value", notContextified({ a: 1 }), { a: 2 }, false, false, false],
    ["an object with one more property", notContextified({ a: 1 }), { a: 1, b: 2 }, false, false, false],
    ["nothing added, an empty object", notContextified({}), {}, true, false, false],
    ["nested values", notContextified({ o: { x: [1, 2] } }), { o: { x: [1, 2] } }, true, false, false],
    ["a top-level var", declared("var a = 1"), { a: 1 }, true, false, false],
    ["a top-level let", declared("let a = 1"), {}, true, false, false],
    ["inside another object", { global: notContextified({ a: 1 }) }, { global: { a: 1 } }, true, false, false],
    [
      "another global with the same properties",
      notContextified({ a: 1 }),
      notContextified({ a: 1 }),
      true,
      true,
      false,
    ],
    ["another global with another value", notContextified({ a: 1 }), notContextified({ a: 2 }), false, false, false],
    ["contextified, an object with the same properties", contextified({ a: 1 }), { a: 1 }, true, false, true],
    ["contextified, an object with another value", contextified({ a: 1 }), { a: 2 }, false, false, false],
    ["contextified, another one", contextified({ a: 1 }), contextified({ a: 1 }), true, true, true],
    ["contextified and not contextified", contextified({ a: 1 }), notContextified({ a: 1 }), true, true, false],
    ["an array", notContextified({ 0: 1 }), [1], false, false, false],
  ])("%s", (_, left, right, loose, strict, nodeStrict) => {
    for (const [a, b] of [
      [left, right],
      [right, left],
    ]) {
      expect({
        loose: Bun.deepEquals(a, b),
        strict: Bun.deepEquals(a, b, true),
        nodeStrict: isDeepStrictEqual(a, b),
      }).toEqual({ loose, strict, nodeStrict });
      (loose ? expect(a) : expect(a).not).toEqual(b);
      (strict ? expect(a) : expect(a).not).toStrictEqual(b);
      if (loose) assert.deepEqual(a, b);
      else assert.notDeepEqual(a, b);
      if (nodeStrict) assert.deepStrictEqual(a, b);
      else assert.notDeepStrictEqual(a, b);
    }
  });

  it("the main global is only equal to itself", () => {
    for (const other of [{}, { ...globalThis }, notContextified({}), contextified({})]) {
      expect({
        loose: [Bun.deepEquals(globalThis, other), Bun.deepEquals(other, globalThis)],
        strict: [Bun.deepEquals(globalThis, other, true), Bun.deepEquals(other, globalThis, true)],
        nodeStrict: [isDeepStrictEqual(globalThis, other), isDeepStrictEqual(other, globalThis)],
      }).toEqual({ loose: [false, false], strict: [false, false], nodeStrict: [false, false] });
    }
    expect(Bun.deepEquals(globalThis, globalThis, true)).toBe(true);
  });
});

// The cases documented at https://bun.sh/docs/api/utils#bun-deepequals as the
// differences between the default and strict modes.
describe("Bun.deepEquals strict mode", () => {
  it("ignores an extra undefined property only when not strict", () => {
    const a = { entries: [1, 2] };
    const b = { entries: [1, 2], extra: undefined };
    expect(Bun.deepEquals(a, b)).toBe(true);
    expect(Bun.deepEquals(a, b, true)).toBe(false);
  });

  it("distinguishes a missing property from an undefined one", () => {
    expect(Bun.deepEquals({}, { a: undefined })).toBe(true);
    expect(Bun.deepEquals({}, { a: undefined }, true)).toBe(false);
  });

  it("distinguishes a missing array element from an undefined one", () => {
    expect(Bun.deepEquals(["asdf"], ["asdf", undefined])).toBe(true);
    expect(Bun.deepEquals(["asdf"], ["asdf", undefined], true)).toBe(false);
  });

  it("distinguishes a hole from an undefined element", () => {
    expect(Bun.deepEquals([, 1], [undefined, 1])).toBe(true);
    expect(Bun.deepEquals([, 1], [undefined, 1], true)).toBe(false);
  });

  it("distinguishes a class instance from an object literal", () => {
    class Foo {
      a = 1;
    }
    expect(Bun.deepEquals(new Foo(), { a: 1 })).toBe(true);
    expect(Bun.deepEquals(new Foo(), { a: 1 }, true)).toBe(false);
  });

  it("distinguishes an instance of a subclass from an instance of its base class", () => {
    class Tags extends Set {}
    expect(Bun.deepEquals(new Tags(["a"]), new Set(["a"]), true)).toBe(false);
    expect(Bun.deepEquals(new Set(["a"]), new Tags(["a"]), true)).toBe(false);
    expect(Bun.deepEquals(new Tags(["a"]), new Tags(["a"]), true)).toBe(true);
    // A Buffer is an instance of a subclass of Uint8Array.
    expect(Bun.deepEquals(Buffer.from("a"), new Uint8Array([97]))).toBe(true);
    expect(Bun.deepEquals(Buffer.from("a"), new Uint8Array([97]), true)).toBe(false);
  });

  it("distinguishes two classes with the same name", () => {
    const declare = () =>
      class Point {
        x = 1;
      };
    const [PointA, PointB] = [declare(), declare()];
    expect(Bun.deepEquals(new PointA(), new PointB())).toBe(true);
    expect(Bun.deepEquals(new PointA(), new PointB(), true)).toBe(false);
    expect(Bun.deepEquals(new PointA(), new PointA(), true)).toBe(true);
  });

  it("ignores class names when the fourth argument is true", () => {
    class Foo {
      a = 1;
    }
    class Bar {
      a = 1;
    }
    class S extends String {}
    class Tags extends Set {}
    // The fourth argument is not in the public types.
    const deepEquals = Bun.deepEquals as (a: unknown, b: unknown, strict?: boolean, skipPrototype?: boolean) => boolean;
    expect(deepEquals(new Foo(), new Bar(), true)).toBe(false);
    expect(deepEquals(new Foo(), new Bar(), true, true)).toBe(true);
    expect(deepEquals(new Foo(), { a: 2 }, true, true)).toBe(false);
    expect(deepEquals(new String("a"), new S("a"), true)).toBe(false);
    expect(deepEquals(new String("a"), new S("a"), true, true)).toBe(true);
    expect(deepEquals(new Tags(["a"]), new Set(["a"]), true, true)).toBe(true);
    expect(deepEquals(Object.create(null), {}, true, true)).toBe(true);
  });

  it("is symmetric", () => {
    const a = { entries: [1, 2] };
    const b = { entries: [1, 2], extra: undefined };
    expect(Bun.deepEquals(b, a)).toBe(true);
    expect(Bun.deepEquals(b, a, true)).toBe(false);
  });

  it("recurses into nested values", () => {
    expect(Bun.deepEquals({ a: { b: 1 } }, { a: { b: 1, c: undefined } })).toBe(true);
    expect(Bun.deepEquals({ a: { b: 1 } }, { a: { b: 1, c: undefined } }, true)).toBe(false);
  });

  // Matches Node's util.isDeepStrictEqual, which rejects a null prototype
  // against Object.prototype.
  it("distinguishes a null-prototype object from an object literal", () => {
    expect(Bun.deepEquals(Object.create(null), {})).toBe(true);
    expect(Bun.deepEquals(Object.create(null), {}, true)).toBe(false);
    expect(Bun.deepEquals(Object.create(null), Object.create(null), true)).toBe(true);
  });
});

// What strict Bun.deepEquals() and toStrictEqual() answer, beside what toStrictEqual() of Jest answers. Jest's own equals() runs
// here with the testers that its matcher passes. Every pair is compared both ways round.
describe("strict Bun.deepEquals() and toStrictEqual() beside the toStrictEqual() of Jest", () => {
  type Pair = () => [unknown, unknown];
  type Row = [name: string, make: Pair];
  type Answer = boolean | "throws";

  const jestStrictEquals = (a: unknown, b: unknown) =>
    equals(a, b, [iterableEquality, typeEquality, sparseArrayEquality, arrayBufferEquality], true);
  const answer = (compare: () => boolean): Answer => {
    try {
      return compare();
    } catch {
      return "throws";
    }
  };
  const passes = (assert: () => void) => answer(() => (assert(), true)) === true;
  /** The rows that do not answer as expected, with what they answer. */
  const unexpected = (rows: Row[], expected: { bun: Answer; jest: Answer } | "the same") =>
    rows.flatMap(([name, make]) =>
      [false, true].flatMap(swapped => {
        const pair = () => (swapped ? make().reverse() : make()) as [unknown, unknown];
        const answers = {
          bun: answer(() => Bun.deepEquals(...pair(), true)),
          matcher: passes(() => expect(pair()[0]).toStrictEqual(pair()[1])),
          jest: answer(() => jestStrictEquals(...pair())),
        };
        const { bun, jest } = expected === "the same" ? { bun: answers.jest, jest: answers.jest } : expected;
        const isExpected = answers.bun === bun && answers.matcher === bun && answers.jest === jest;
        return isExpected ? [] : [{ name, swapped, ...answers }];
      }),
    );

  const realm = vm.createContext({});
  const inRealm = (code: string) => vm.runInContext(code, realm);
  const bare = (properties: object) => Object.assign(Object.create(null), properties);
  const withPrototype = <T extends object>(value: T, prototype: object | null): T =>
    Object.setPrototypeOf(value, prototype);
  const withOwnConstructor = <T extends object>(value: T, constructor: unknown): T =>
    Object.defineProperty(value, "constructor", { value: constructor, enumerable: false });
  const args = (...values: unknown[]) =>
    (function () {
      return arguments;
    })(...(values as []));
  const groups = () => "a".match(/(?<x>a)/)!.groups;
  /** Gives the value a Proxy of the prototype for its prototype. */
  const over = <T extends object>(value: T, prototype: object, handler: ProxyHandler<object> = {}): T =>
    Object.setPrototypeOf(value, new Proxy(prototype, handler));
  const overRevoked = <T extends object>(value: T, prototype: object): T => {
    const { proxy, revoke } = Proxy.revocable(prototype, {});
    Object.setPrototypeOf(value, proxy);
    revoke();
    return value;
  };
  const mixed = () => [new Date(5), new Map([[1, 2]]), /a/, new Uint8Array(1), new Error("x"), { a: 1 }, [1]];

  const temporal = (globalThis as any).Temporal;
  const builtins: [name: string, Base: any, make: (Class: any) => unknown][] = [
    ["Map", Map, Class => new Class([["a", 1]])],
    ["Set", Set, Class => new Class([1])],
    ["Date", Date, Class => new Class(5)],
    ["RegExp", RegExp, Class => new Class("a")],
    ["Error", Error, Class => new Class("x")],
    ["TypeError", TypeError, Class => new Class("x")],
    ["AggregateError", AggregateError, Class => new Class([], "x")],
    ["Uint8Array", Uint8Array, Class => new Class([1])],
    ["Float64Array", Float64Array, Class => new Class([1])],
    ["BigInt64Array", BigInt64Array, Class => new Class(1)],
    ["ArrayBuffer", ArrayBuffer, Class => new Class(1)],
    ["SharedArrayBuffer", SharedArrayBuffer, Class => new Class(1)],
    ["DataView", DataView, Class => new Class(new ArrayBuffer(1))],
    ["String", String, Class => new Class("a")],
    ["Number", Number, Class => new Class(1)],
    ["Boolean", Boolean, Class => new Class(true)],
    ["Promise", Promise, Class => Class.resolve(1)],
    ["WeakMap", WeakMap, Class => new Class()],
    ["WeakSet", WeakSet, Class => new Class()],
    ["URL", URL, Class => new Class("http://a/")],
    ["URLSearchParams", URLSearchParams, Class => new Class("a=1")],
    ["Headers", Headers, Class => new Class({ a: "1" })],
    ["Blob", Blob, Class => new Class(["a"])],
    ["Response", Response, Class => new Class("a")],
    ["FormData", FormData, Class => new Class()],
    ["EventTarget", EventTarget, Class => new Class()],
    ["Event", Event, Class => new Class("a")],
    ["AbortController", AbortController, Class => new Class()],
    ["TextEncoder", TextEncoder, Class => new Class()],
    ...(temporal
      ? ([
          ["Temporal.Instant", temporal.Instant, Class => new Class(5n)],
          ["Temporal.PlainDate", temporal.PlainDate, Class => new Class(2020, 1, 1)],
          ["Temporal.Duration", temporal.Duration, Class => new Class(1)],
        ] as typeof builtins)
      : []),
  ];
  const rowsOfBuiltins = builtins.flatMap(([name, Base, make]): Row[] => {
    class Subclass extends Base {}
    class OtherSubclass extends Base {}
    const Nameless = (() => class extends Base {})();
    const SameName = { [Base.name]: class extends Base {} }[Base.name];
    return [
      [`${name}: two of it`, () => [make(Base), make(Base)]],
      [`${name}: a subclass and the class`, () => [make(Subclass), make(Base)]],
      [`${name}: two of one subclass`, () => [make(Subclass), make(Subclass)]],
      [`${name}: two subclasses`, () => [make(Subclass), make(OtherSubclass)]],
      [`${name}: a subclass with no name and the class`, () => [make(Nameless), make(Base)]],
      [`${name}: a subclass with the name of the class and the class`, () => [make(SameName), make(Base)]],
    ];
  });

  class MyMap extends Map {}
  class MyDate extends Date {}
  class MyArray extends Array {}
  class MyError extends Error {}
  class MyBuffer extends Buffer {}
  class A {
    a = 1;
  }
  class B extends A {}
  class Base {
    a = 1;
  }
  class Subclass extends Base {}
  delete (Subclass.prototype as any).constructor;
  class ClockDate extends Date {
    constructor(time: number) {
      super(time);
      withOwnConstructor(this, Date);
    }
  }
  const declare = () =>
    class A {
      a = 1;
    };
  const [A1, A2, A3, A4] = [declare(), declare(), declare(), declare()];
  const mixin = (Super: any) => class extends Super {};
  const shared = { constructor: "x" };
  const functionA = function () {};
  const functionB = function () {};
  class Getter {}
  Object.defineProperty(Getter.prototype, "constructor", { get: () => Getter });
  class ThrowingGetter {}
  Object.defineProperty(ThrowingGetter.prototype, "constructor", {
    get() {
      throw new Error("the getter ran");
    },
  });

  const sameAsJest: Row[] = [
    ...rowsOfBuiltins,
    // Classes of the program.
    ["an instance and an object literal", () => [new A(), { a: 1 }]],
    ["a class and its subclass", () => [new B(), new A()]],
    ["two classes with one name", () => [new A1(), new A2()]],
    ["two classes with one name that share a hidden class", () => [new A3(), new A4()]],
    ["two of a class that shares a hidden class", () => [new A4(), new A4()]],
    ["a class with no name and an object literal", () => [new (class {})(), {}]],
    ["two mixins over Map", () => [new (mixin(Map))(), new (mixin(Map))()]],
    ["the prototypes of two classes with one name", () => [A1.prototype, A2.prototype]],
    ["a subclass whose prototype has no constructor, and its base", () => [new Subclass(), new Base()]],
    [
      "an object made from the prototype of a class, and an instance",
      () => [Object.assign(Object.create(A.prototype), { a: 1 }), new A()],
    ],
    ["an object made from an object literal, and an object literal", () => [Object.create({}), {}]],
    ["a Buffer and a Uint8Array", () => [Buffer.from([1]), new Uint8Array([1])]],
    ["two Buffers", () => [Buffer.from([1]), Buffer.from([1])]],
    ["a Buffer from a subclass of Buffer, and a Buffer", () => [MyBuffer.from([1]), Buffer.from([1])]],
    ["a TypeError and an Error", () => [new TypeError("x"), new Error("x")]],
    ["a File and a Blob", () => [new File(["a"], "f"), new Blob(["a"])]],
    ["two DOMExceptions", () => [new DOMException("a", "AbortError"), new DOMException("a", "AbortError")]],
    [
      "an Error whose stack was read, and one whose stack was not",
      () => [(e => (e.stack, e))(new Error("x")), new Error("x")],
    ],
    [
      "two Errors with a code",
      () => [Object.assign(new Error("x"), { code: "E" }), Object.assign(new Error("x"), { code: "E" })],
    ],
    // A pair inside other values.
    ["in a property", () => [{ m: new MyMap() }, { m: new Map() }]],
    ["in a property under a symbol", () => [{ [Symbol.for("s")]: new MyMap() }, { [Symbol.for("s")]: new Map() }]],
    ["in an array", () => [[new MyMap()], [new Map()]]],
    [
      "in a property of an array under a symbol",
      () => [
        Object.assign([1], { [Symbol.for("s")]: new MyMap() }),
        Object.assign([1], { [Symbol.for("s")]: new Map() }),
      ],
    ],
    ["a Map value", () => [new Map([["k", new MyDate(5)]]), new Map([["k", new Date(5)]])]],
    ["a Map key", () => [new Map([[new MyDate(5), 1]]), new Map([[new Date(5), 1]])]],
    ["a Set member", () => [new Set([new MyDate(5)]), new Set([new Date(5)])]],
    // No prototype.
    ["an empty object with no prototype and an object literal", () => [Object.create(null), {}]],
    ["two empty objects with no prototype", () => [Object.create(null), Object.create(null)]],
    ["an object with no prototype and an object literal", () => [bare({ a: 1 }), { a: 1 }]],
    ["two objects with no prototype", () => [bare({ a: 1 }), bare({ a: 1 })]],
    ["the groups of a match and an object literal", () => [groups(), { x: "a" }]],
    ["the groups of two matches", () => [groups(), groups()]],
    ["the groups of a match in a property, and an object literal", () => [{ g: groups() }, { g: { x: "a" } }]],
    ["what Object.groupBy() returns, and an object literal", () => [Object.groupBy([1], () => "a"), { a: [1] }]],
    ["what querystring.parse() returns, and an object literal", () => [querystring.parse("a=1"), { a: "1" }]],
    [
      "the values of parseArgs(), and an object literal",
      () => [parseArgs({ args: ["--x"], options: { x: { type: "boolean" } } }).values, { x: true }],
    ],
    ["a Map with no prototype and a Map", () => [withPrototype(new Map(), null), new Map()]],
    ["a Date with no prototype and a Date", () => [withPrototype(new Date(5), null), new Date(5)]],
    ["a Map with the prototype of a subclass, and a Map", () => [withPrototype(new Map(), MyMap.prototype), new Map()]],
    ["a Map with the prototype of Set, and a Map", () => [withPrototype(new Map(), Set.prototype), new Map()]],
    // An own constructor.
    ["a Date that owns the constructor Date, and a Date", () => [new ClockDate(5), new Date(5)]],
    ["two Dates that own the constructor Date", () => [new ClockDate(5), new ClockDate(5)]],
    [
      "a subclass of Map that owns the constructor Map, and a Map",
      () => [withOwnConstructor(new MyMap(), Map), new Map()],
    ],
    [
      "a subclass of Error that owns the constructor Error, and an Error",
      () => [withOwnConstructor(new MyError("x"), Error), new Error("x")],
    ],
    [
      "two object literals that own one class as their constructor",
      () => [withOwnConstructor({ a: 1 }, Map), withOwnConstructor({ a: 1 }, Map)],
    ],
    [
      "two object literals that own two classes as their constructor",
      () => [withOwnConstructor({ a: 1 }, Map), withOwnConstructor({ a: 1 }, Set)],
    ],
    ["a constructor key: one function", () => [{ constructor: functionA }, { constructor: functionA }]],
    ["a constructor key: two functions", () => [{ constructor: functionA }, { constructor: functionB }]],
    ["a constructor key: one string", () => [JSON.parse('{"constructor":"x"}'), JSON.parse('{"constructor":"x"}')]],
    [
      "a constructor key: one string, made twice",
      () => [{ constructor: ["x", "y"].join("") }, { constructor: ["x", "y"].join("") }],
    ],
    ["a constructor key: one number", () => [{ constructor: 1 }, { constructor: 1 }]],
    ["a constructor key: null", () => [{ constructor: null }, { constructor: null }]],
    ["a constructor key: a number against none", () => [{ constructor: 1 }, {}]],
    ["a constructor key: undefined against none", () => [{ constructor: undefined }, {}]],
    ["a constructor key: with and without a prototype", () => [bare({ constructor: 1 }), { constructor: 1 }]],
    [
      "a constructor key on the prototype",
      () => [Object.create({ constructor: "x" }), Object.create({ constructor: "x" })],
    ],
    [
      "two object literals that own a class and a number as their constructor",
      () => [withOwnConstructor({ a: 1 }, Map), withOwnConstructor({ a: 1 }, 1)],
    ],
    ["an own constructor that is not enumerable, against none", () => [withOwnConstructor({ a: 1 }, 1), { a: 1 }]],
    [
      "the same on two objects with no prototype",
      () => [withOwnConstructor(Object.create(null), 1), Object.create(null)],
    ],
    [
      "an own constructor against an inherited value that is no function",
      () => [withOwnConstructor(Object.create(shared), {}), Object.create(shared)],
    ],
    [
      "own constructors that are no functions, on two prototypes",
      () => [withOwnConstructor(Object.create(null), 1), withOwnConstructor({}, 2)],
    ],
    ["an object literal that owns the constructor Date, and a Date", () => [withOwnConstructor({}, Date), new Date(5)]],
    ["a getter named constructor that answers with the class", () => [new Getter(), new Getter()]],
    // Arrays.
    ["an array of a subclass of Array, and an array", () => [MyArray.from([1]), [1]]],
    ["two arrays of a subclass of Array", () => [MyArray.from([1]), MyArray.from([1])]],
    ["an array literal and a computed array", () => [[1, 2], Array.from({ length: 2 }, (_, i) => i + 1)]],
    ["arguments and an array", () => [args(1), [1]]],
    ["arguments and an object literal", () => [args(1), { 0: 1 }]],
    ["arguments twice", () => [args(1), args(1)]],
    ["an array and an object with the same keys", () => [[1], { 0: 1 }]],
    ["an array and Array.prototype", () => [[], Array.prototype]],
    // Two kinds of built-in.
    ["a Map and a Set", () => [new Map(), new Set()]],
    ["a Date and a Map", () => [new Date(5), new Map()]],
    ["a Date and an object literal", () => [new Date(5), {}]],
    ["an Error and a Map", () => [new Error("x"), new Map()]],
    ["a Uint8Array and a Uint16Array", () => [new Uint8Array(1), new Uint16Array(1)]],
    ["a Number object and a Boolean object", () => [new Number(1), new Boolean(true)]],
    ["an object literal and Object.prototype", () => [{}, Object.prototype]],
    ["an object made from Date.prototype, and Date.prototype", () => [Object.create(Date.prototype), Date.prototype]],
    ["two Sets of values of many kinds", () => [new Set(mixed()), new Set(mixed())]],
    [
      "two Maps with keys of many kinds",
      () => [new Map(mixed().map(key => [key, 1])), new Map(mixed().map(key => [key, 1]))],
    ],
    // Another realm.
    ...[
      "new Map([[1, 2]])",
      "new Set([1])",
      "new Date(5)",
      "new Error('x')",
      "/a/",
      "new Uint8Array([1])",
      "new ArrayBuffer(1)",
      "[1]",
      "({ a: { b: [1] } })",
      "({ d: new Date(5) })",
      "Object.create(null)",
    ].map((code): Row => [`of another realm: ${code}`, () => [inRealm(code), vm.runInThisContext(code)]]),
    ["of another realm: an array in a property", () => [{ a: inRealm("[1]") }, { a: [1] }]],
    ["of another realm: an object with no prototype and an object literal", () => [inRealm("Object.create(null)"), {}]],
    ["of another realm: a Uint8Array and a Buffer", () => [inRealm("new Uint8Array([1])"), Buffer.from([1])]],
    ["of another realm: a subclass of Map and a Map", () => [inRealm("new (class MyMap extends Map {})()"), new Map()]],
    ["of another realm: a Map and a subclass of Map", () => [inRealm("new Map()"), new MyMap()]],
    ["of another realm: a class with the name of a class here", () => [inRealm("new (class A { a = 1 })()"), new A()]],
    [
      "of another realm: a function with the name of a function here",
      () => [
        inRealm("new (function F() { this.a = 1 })()"),
        new (
          function F(this: any) {
            this.a = 1;
          } as any
        )(),
      ],
    ],
    [
      "of another realm: a built-in function with no name as the constructor",
      () => [
        Object.create({ constructor: inRealm("Function.prototype") }),
        Object.create({ constructor: Function.prototype }),
      ],
    ],
    ["a copy by structuredClone() of a Map, and a Map", () => [structuredClone(new Map([[1, 2]])), new Map([[1, 2]])]],
    [
      "a copy by structuredClone() of an object literal, and an object literal",
      () => [structuredClone({ a: 1 }), { a: 1 }],
    ],
    // Functions, and objects with a class name of their own.
    ["two functions", () => [functionA, functionB]],
    ["two classes", () => [A, B]],
    ["two functions of one text", () => [function a() {}, function a() {}]],
    ["a Proxy of a subclass and an instance of its base", () => [new Proxy(new B(), {}), new A()]],
    ["Math and an object literal", () => [Math, {}]],
    ["JSON and an object literal", () => [JSON, {}]],
    [
      "an object with a toStringTag and an object literal",
      () => [Object.defineProperty({}, Symbol.toStringTag, { value: "T" }), {}],
    ],
    ["a module namespace and a copy of it", () => [vmNamespace, { ...vmNamespace }]],
    ["two generators", () => [(function* () {})(), (function* () {})()]],
    ["two BigInt objects", () => [Object(1n), Object(1n)]],
    ["two Symbol objects", () => [Object(Symbol.iterator), Object(Symbol.iterator)]],
    ["a frozen object literal and an object literal", () => [Object.freeze({ a: 1 }), { a: 1 }]],
    [
      "what JSON.parse() returns, and an object literal",
      () => [JSON.parse('{"a":1,"b":[1,{"c":2}]}'), { a: 1, b: [1, { c: 2 }] }],
    ],
    [
      "an object that lost most of its keys, and an object literal",
      () => {
        const lost: Record<string, number> = {};
        for (let i = 0; i < 100; i++) lost["k" + i] = i;
        for (let i = 1; i < 100; i++) delete lost["k" + i];
        return [lost, { k0: 0 }];
      },
    ],
  ];

  test("the two answer as Jest answers", () => {
    expect(unexpected(sameAsJest, "the same")).toEqual([]);
  });

  // Where the class step gives another answer than Jest.
  test.each([
    {
      why: "an own constructor key that is no function is data: Jest compares its two values with ===",
      bun: true,
      jest: false,
      rows: [
        [
          "an object",
          () => [JSON.parse('{"constructor":{"name":"x"},"a":1}'), JSON.parse('{"constructor":{"name":"x"},"a":1}')],
        ],
        ["an array", () => [JSON.parse('{"constructor":[1]}'), JSON.parse('{"constructor":[1]}')]],
        ["in a property", () => [{ k: { constructor: {} } }, { k: { constructor: {} } }]],
        ["NaN", () => [{ constructor: NaN }, { constructor: NaN }]],
        ["not enumerable", () => [withOwnConstructor({ a: 1 }, 1), withOwnConstructor({ a: 1 }, 2)]],
      ],
    },
    {
      why: "a getter named constructor is not called",
      bun: true,
      jest: "throws",
      rows: [
        ["two of the class", () => [new ThrowingGetter(), new ThrowingGetter()]],
        ["against an object literal", () => [new ThrowingGetter(), {}]],
      ],
    },
    {
      why: "a Proxy in the prototype chain is not asked, and the name of the built-in type is the class name: equal",
      bun: true,
      jest: false,
      rows: [
        ["over the prototypes of two classes", () => [over({ a: 1 }, A.prototype), over({ a: 1 }, B.prototype)]],
        ["against an object literal", () => [over({ a: 1 }, A.prototype), { a: 1 }]],
        ["a Map over the prototype of a subclass, and a Map", () => [over(new Map(), MyMap.prototype), new Map()]],
      ],
    },
    {
      why: "a Proxy in the prototype chain is not asked, and the name of the built-in type is the class name: unequal",
      bun: false,
      jest: true,
      rows: [
        ["against an instance of the class", () => [over({ a: 1 }, A.prototype), new A()]],
        [
          "a Map over the prototype of a subclass, and an instance of the subclass",
          () => [over(new Map(), MyMap.prototype), new MyMap()],
        ],
      ],
    },
    {
      why: "a Proxy in the prototype chain is not asked, so a revoked one or a trap that throws does not throw",
      bun: true,
      jest: "throws",
      rows: [
        ["a revoked Proxy", () => [overRevoked({ a: 1 }, A.prototype), { a: 1 }]],
        [
          "a get trap that throws",
          () => [
            over({ a: 1 }, A.prototype, {
              get() {
                throw new Error("the trap ran");
              },
            }),
            { a: 1 },
          ],
        ],
      ],
    },
    {
      why: "the cause and the own properties of an Error, and the own properties of a typed array, are compared",
      bun: false,
      jest: true,
      rows: [
        [
          "the cause of an Error",
          () => [new Error("x", { cause: new MyDate(5) }), new Error("x", { cause: new Date(5) })],
        ],
        [
          "a property of an Error",
          () => [Object.assign(new Error("x"), { p: new MyMap() }), Object.assign(new Error("x"), { p: new Map() })],
        ],
        [
          "a property of a typed array",
          () => [
            Object.assign(new Uint8Array(1), { p: new MyMap() }),
            Object.assign(new Uint8Array(1), { p: new Map() }),
          ],
        ],
      ],
    },
    {
      why: "two built-in functions of one realm are two classes: a mock function is one here, and is none in Jest",
      bun: false,
      jest: true,
      rows: [
        [
          "two mock functions",
          () => [
            new (
              jest.fn(function (this: any) {
                this.a = 1;
              }) as any
            )(),
            new (
              jest.fn(function (this: any) {
                this.a = 1;
              }) as any
            )(),
          ],
        ],
        [
          "two mocks of two classes with one name",
          () => [new (jest.fn(class Point {}) as any)(), new (jest.fn(class Point {}) as any)()],
        ],
      ],
    },
  ] as { why: string; bun: Answer; jest: Answer; rows: Row[] }[])("apart from Jest: $why", ({ bun, jest, rows }) => {
    expect(unexpected(rows, { bun, jest })).toEqual([]);
  });

  // Where the two differ from Jest as they do without the class step. Whoever changes one of these answers changes it here too.
  test.each([
    {
      why: "a Proxy does not equal its target (#9103)",
      bun: false,
      jest: true,
      rows: [
        ["of an object literal", () => [new Proxy({ a: 1 }, {}), { a: 1 }]],
        ["of an instance", () => [new Proxy(new A(), {}), new A()]],
        ["of an array", () => [new Proxy([1], {}), [1]]],
      ],
    },
    {
      why: "two Proxies have no class",
      bun: true,
      jest: false,
      rows: [
        ["of an instance and of an instance of a subclass", () => [new Proxy(new B(), {}), new Proxy(new A(), {})]],
        ["of a Map and of an instance of a subclass", () => [new Proxy(new MyMap(), {}), new Proxy(new Map(), {})]],
      ],
    },
  ] as { why: string; bun: Answer; jest: Answer; rows: Row[] }[])(
    "apart from Jest, as without the class step: $why",
    ({ bun, jest, rows }) => {
      expect(unexpected(rows, { bun, jest })).toEqual([]);
    },
  );
});

// A package whose "exports" name one file for import and another for require is loaded twice, as is a package that is
// installed twice. Jest under --experimental-vm-modules, Vitest and node:assert also see two classes there.
it("takes the copies of a class in a package that is loaded twice for two classes", async () => {
  const money = (format: "import" | "require") =>
    format === "import"
      ? `export class Money { constructor(amount) { this.amount = amount; } }`
      : `exports.Money = class Money { constructor(amount) { this.amount = amount; } };`;
  using dir = tempDir("deep-equals-package-loaded-twice", {
    node_modules: {
      "two-files": {
        "package.json": JSON.stringify({
          name: "two-files",
          exports: { import: "./index.mjs", require: "./index.cjs" },
        }),
        "index.mjs": money("import"),
        "index.cjs": money("require"),
      },
      // "main" and "module" name two files as well, and one of them is loaded.
      "one-file": {
        "package.json": JSON.stringify({ name: "one-file", main: "./index.cjs", module: "./index.mjs" }),
        "index.mjs": money("import"),
        "index.cjs": money("require"),
      },
      ledger: {
        "package.json": JSON.stringify({ name: "ledger", main: "./index.cjs" }),
        "index.cjs": `exports.totals = () => [new (require("two-files").Money)(3), new (require("one-file").Money)(3)];`,
      },
    },
    "main.mjs": `
      import { Money as TwoFiles } from "two-files";
      import { Money as OneFile } from "one-file";
      import { totals } from "ledger";
      const [twoFiles, oneFile] = totals();
      const answers = (a, b) => [a.constructor === b.constructor, Bun.deepEquals(a, b), Bun.deepEquals(a, b, true)];
      console.log(JSON.stringify({ twoFiles: answers(twoFiles, new TwoFiles(3)), oneFile: answers(oneFile, new OneFile(3)) }));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: JSON.stringify({ twoFiles: [false, true, false], oneFile: [true, true, true] }) + "\n",
    stderr: "",
    exitCode: 0,
  });
});

// The object fast path used to recurse into nested values while walking the
// structure's PropertyTable; a getter on a nested object that added or removed
// properties on the parent rehashed that table and freed the vector being
// iterated (heap-use-after-free). The child runs with Malloc=1 so JSC's
// bmalloc routes through the system allocator and ASAN sees the freed table.
describe.skipIf(!isASAN)("object mutated from a getter during comparison", () => {
  it("does not read freed property tables", async () => {
    const fixture = `
      const assert = require('node:assert');
      const util = require('node:util');
      const { expect } = require('bun:test');

      function make(mutate) {
        const p1 = {}, p2 = {};
        for (let i = 0; i < 8; i++) { p1['k' + i] = i; p2['k' + i] = i; }
        let fired = 0;
        p1.a = { get x() { if (!fired++) mutate(p1, p2); return 1; } };
        p2.a = { get x() { return 1; } };
        p1.z = 1; p2.z = 1;
        return [p1, p2];
      }
      // Enough added properties to cross several PropertyTable capacity
      // doublings; each rehash frees the previous index vector.
      const addMany = p1 => { for (let i = 0; i < 256; i++) p1['n' + i] = i; };

      {
        const [p1, p2] = make(addMany);
        console.log('same-structure strict:', Bun.deepEquals(p1, p2, true));
      }
      {
        const [p1, p2] = make(addMany);
        console.log('same-structure loose:', Bun.deepEquals(p1, p2, false));
      }
      {
        const [p1, p2] = make((_p1, p2) => addMany(p2));
        console.log('mutate right side:', Bun.deepEquals(p1, p2, true));
      }
      {
        const [p1, p2] = make(p1 => { for (let i = 0; i < 8; i++) delete p1['k' + i]; });
        console.log('delete strict:', Bun.deepEquals(p1, p2, true));
      }
      {
        // Different insertion order: same properties, different structures.
        const p1 = {}, p2 = {};
        for (let i = 0; i < 8; i++) p1['k' + i] = i;
        for (let i = 7; i >= 0; i--) p2['k' + i] = i;
        let fired = 0;
        p1.a = { get x() { if (!fired++) addMany(p1); return 1; } };
        p2.a = { get x() { return 1; } };
        p1.z = 1; p2.z = 1;
        console.log('mixed-structure strict:', Bun.deepEquals(p1, p2, true));
      }
      {
        // Allocation churn + GC in the getter, with object-valued siblings
        // compared afterwards: catches a snapshot that is invisible to GC.
        const p1 = {}, p2 = {};
        let fired = 0;
        p1.a = { get x() {
          if (!fired++) {
            addMany(p1);
            const junk = [];
            for (let i = 0; i < 200; i++) { const o = {}; for (let j = 0; j < 20; j++) o['q' + j] = j; junk.push(o); }
            Bun.gc(true);
          }
          return 1;
        } };
        p2.a = { get x() { return 1; } };
        for (let i = 0; i < 30; i++) { p1['s' + i] = { v: i }; p2['s' + i] = { v: i }; }
        console.log('gc churn strict:', Bun.deepEquals(p1, p2, true));
      }
      {
        const [p1, p2] = make(addMany);
        assert.deepStrictEqual(p1, p2);
        console.log('assert.deepStrictEqual: true');
      }
      {
        const [p1, p2] = make(addMany);
        console.log('util.isDeepStrictEqual:', util.isDeepStrictEqual(p1, p2));
      }
      {
        const [p1, p2] = make(addMany);
        expect(p1).toEqual(p2);
        console.log('expect.toEqual: true');
      }
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: {
        ...bunEnv,
        ...(isWindows ? {} : { Malloc: "1" }),
        // symbolize=0: symbolizing a failure report outlasts the test timeout.
        // detect_leaks=0: Malloc=1 exposes JSC's never-freed startup allocations to LSAN.
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "symbolize=0", "detect_leaks=0"].filter(Boolean).join(":"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe(
      [
        "same-structure strict: true",
        "same-structure loose: true",
        "mutate right side: true",
        "delete strict: true",
        "mixed-structure strict: true",
        "gc churn strict: true",
        "assert.deepStrictEqual: true",
        "util.isDeepStrictEqual: true",
        "expect.toEqual: true",
        "",
      ].join("\n"),
    );
    expect(stderr).not.toContain("ERROR: AddressSanitizer");
    expect(exitCode).toBe(0);
  });
});
