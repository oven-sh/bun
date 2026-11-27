import { bunEnv, bunExe, isASAN, isWindows } from "harness";
import assert from "node:assert";
import { createSecretKey } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import vm from "node:vm";

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

  it("ignores class names when the fourth argument is true", () => {
    class Foo {
      a = 1;
    }
    class Bar {
      a = 1;
    }
    class S extends String {}
    // The fourth argument is not in the public types.
    const deepEquals = Bun.deepEquals as (a: unknown, b: unknown, strict?: boolean, skipPrototype?: boolean) => boolean;
    expect(deepEquals(new Foo(), new Bar(), true)).toBe(false);
    expect(deepEquals(new Foo(), new Bar(), true, true)).toBe(true);
    expect(deepEquals(new Foo(), { a: 2 }, true, true)).toBe(false);
    expect(deepEquals(new String("a"), new S("a"), true)).toBe(false);
    expect(deepEquals(new String("a"), new S("a"), true, true)).toBe(true);
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
  it.failing("distinguishes a null-prototype object from an object literal", () => {
    expect(Bun.deepEquals(Object.create(null), {}, true)).toBe(false);
  });
});

describe("a key that only one side enumerates", () => {
  type Row = [name: string, left: () => object, right: () => object, loose: boolean, strict: boolean];

  const define = <T extends object>(object: T, key: PropertyKey, value: unknown, enumerable: boolean) =>
    Object.defineProperty(object, key, { value, enumerable, writable: true, configurable: true });
  const hidden = <T extends object>(object: T, key: PropertyKey, value: unknown) => define(object, key, value, false);
  const shown = <T extends object>(object: T, key: PropertyKey, value: unknown) => define(object, key, value, true);
  const withGetter = <T extends object>(object: T) =>
    Object.defineProperty(object, "getter", { get: () => 1, enumerable: true });
  const numbered = (from: number, to: number) => {
    const object: Record<string, number> = {};
    for (let i = from; i !== to; i += Math.sign(to - from)) object["k" + i] = i;
    return object;
  };
  const symbol = Symbol("symbol");
  const otherSymbol = Symbol("otherSymbol");
  const url = new URL("http://localhost/");

  function check(left: () => object, right: () => object, loose: boolean, strict: boolean) {
    for (const [a, b] of [
      [left(), right()],
      [right(), left()],
    ]) {
      expect({
        loose: Bun.deepEquals(a, b),
        nested: Bun.deepEquals({ list: [a] }, { list: [b] }),
        strict: Bun.deepEquals(a, b, true),
        skipPrototype: (Bun.deepEquals as (...args: unknown[]) => boolean)(a, b, true, true),
        nodeStrict: isDeepStrictEqual(a, b),
      }).toEqual({ loose, nested: loose, strict, skipPrototype: strict, nodeStrict: strict });
      (loose ? expect(a) : expect(a).not).toEqual(b);
      (strict ? expect(a) : expect(a).not).toStrictEqual(b);
      (loose ? assert.deepEqual : assert.notDeepEqual)(a, b);
      (strict ? assert.deepStrictEqual : assert.notDeepStrictEqual)(a, b);
    }
  }

  it.each<Row>([
    ["against another key", () => JSON.parse('{"a":1,"__proto__":{}}'), () => ({ a: 1, b: 2 }), false, false],
    ["before another key", () => JSON.parse('{"__proto__":{},"a":1}'), () => ({ b: 2, a: 1 }), false, false],
    ["against nothing", () => JSON.parse('{"a":1,"__proto__":{}}'), () => ({ a: 1 }), false, false],
    ["against a prototype", () => JSON.parse('{"__proto__":{"x":1}}'), () => ({ __proto__: { x: 1 } }), false, false],
    ["that holds the prototype", () => ({ ["__proto__"]: Object.prototype }), () => ({ b: 2 }), false, false],
    ["that is null", () => JSON.parse('{"__proto__":null}'), () => Object.create(null), false, false],
    ["that is undefined", () => ({ ["__proto__"]: undefined }), () => ({}), true, false],
    ["against a hidden one", () => JSON.parse('{"__proto__":1}'), () => hidden({}, "__proto__", 1), false, false],
    [
      "on both sides",
      () => JSON.parse('{"a":1,"__proto__":{"x":1}}'),
      () => JSON.parse('{"__proto__":{"x":1},"a":1}'),
      true,
      true,
    ],
    [
      "on both sides, with other values",
      () => JSON.parse('{"__proto__":{"x":1}}'),
      () => JSON.parse('{"__proto__":{"x":2}}'),
      false,
      false,
    ],
  ])("an own __proto__ %s", (_, left, right, loose, strict) => check(left, right, loose, strict));

  class WithGetter {
    get x() {
      return 1;
    }
  }

  // All but the first keep the pair off the fast path that walks the two Structures.
  describe.each<[string, (object: object) => object]>([
    ["plain objects", object => object],
    ["objects with a getter", withGetter],
    ["objects with an index", object => Object.assign(object, { 0: 0 })],
    ["objects with an own __proto__", object => shown(object, "__proto__", 1)],
    ["proxies", object => new Proxy(object, {})],
  ])("%s", (_, wrap) => {
    it.each<Row>([
      ["constructor against another key", () => ({ constructor: Object }), () => ({ b: 2 }), false, false],
      ["constructor against nothing", () => ({ constructor: Object }), () => ({}), false, false],
      ["toString against another key", () => ({ toString: {}.toString }), () => ({ b: 2 }), false, false],
      ["a key against a getter of a class", () => ({ x: 1 }), () => new WithGetter(), false, false],
      [
        "a key against a getter of the same class and another key",
        () => shown(new WithGetter(), "x", 1),
        () => Object.assign(new WithGetter(), { b: 2 }),
        false,
        false,
      ],
      ["a key against a hidden one", () => ({ x: 1 }), () => hidden({}, "x", 1), false, false],
      ["a key against a hidden one and another key", () => ({ x: 1 }), () => hidden({ b: 2 }, "x", 1), false, false],
      [
        "a key against a hidden one with another value, next to undefined",
        () => ({ a: 1, x: 1 }),
        () => hidden({ a: 1, u: undefined }, "x", 2),
        false,
        false,
      ],
      ["a symbol against a hidden one", () => ({ [symbol]: 1 }), () => hidden({}, symbol, 1), false, false],
      ["a URL against a hidden one", () => ({ url }), () => hidden({}, "url", url), false, false],
      ["a URL against a hidden matcher", () => ({ url }), () => hidden({}, "url", expect.anything()), false, false],
      [
        "a key against a hidden object with asymmetricMatch()",
        () => ({ x: 1 }),
        () => hidden({}, "x", { asymmetricMatch: () => true }),
        false,
        false,
      ],
      ["stack against nothing", () => ({ stack: 1 }), () => ({}), false, false],
      ["stack against another value", () => ({ stack: 1 }), () => ({ stack: 2 }), false, false],
      ["undefined against another key", () => ({ a: 1, u: undefined }), () => ({ a: 1, b: 2 }), false, false],
      ["undefined against a value", () => ({ u: undefined, a: 1 }), () => ({ a: 1, u: 1 }), false, false],
      ["undefined first", () => ({ u: undefined, a: 1 }), () => ({ a: 1 }), true, false],
      ["undefined in the middle", () => ({ a: 1, u: undefined, b: 2 }), () => ({ a: 1, b: 2 }), true, false],
      ["undefined under two names", () => ({ u: undefined, a: 1 }), () => ({ a: 1, v: undefined }), true, false],
      ["undefined against a hidden key", () => ({ x: undefined }), () => hidden({}, "x", 1), true, false],
      ["undefined against an inherited key", () => ({ toString: undefined }), () => ({}), true, false],
      ["undefined on both sides", () => ({ u: undefined, a: 1 }), () => ({ a: 1, u: undefined }), true, true],
      [
        "undefined on both sides and another key",
        () => ({ u: undefined, a: 1 }),
        () => ({ a: 1, u: undefined, b: 2 }),
        false,
        false,
      ],
      ["the same keys in another order", () => ({ a: 1, b: 2, c: 3 }), () => ({ a: 1, c: 3, b: 2 }), true, true],
    ])("%s", (_, left, right, loose, strict) =>
      check(
        () => wrap(left()),
        () => wrap(right()),
        loose,
        strict,
      ),
    );
  });

  // Up to 32 names are scanned, more go into a hash table.
  describe.each([31, 32, 33])("proxies with %d keys in another order", count => {
    it.each<[string, object, object, boolean, boolean]>([
      ["and nothing else", {}, {}, true, true],
      ["and undefined against nothing", { u: undefined }, {}, true, false],
      ["and undefined against another key", { u: undefined }, { b: 2 }, false, false],
      ["and constructor against another key", { constructor: Object }, { b: 2 }, false, false],
    ])("%s", (_, left, right, loose, strict) =>
      check(
        () => new Proxy({ ...numbered(0, count), ...left }, {}),
        () => new Proxy({ ...numbered(count - 1, -1), ...right }, {}),
        loose,
        strict,
      ),
    );
  });

  it.each<Row>([
    ["against nothing", () => shown([1], symbol, 1), () => [1], false, false],
    ["that is undefined", () => shown([1], symbol, undefined), () => [1], true, false],
    [
      "that is undefined, against another one",
      () => shown([1], symbol, undefined),
      () => shown([1], otherSymbol, 1),
      false,
      false,
    ],
    [
      "against a hidden one and another one",
      () => shown([1], symbol, 1),
      () => hidden(shown([1], otherSymbol, 1), symbol, 1),
      false,
      false,
    ],
    [
      "against an inherited one and another one",
      () => shown([1], Symbol.iterator, [][Symbol.iterator]),
      () => shown([1], otherSymbol, 1),
      false,
      false,
    ],
    [
      "on both sides, in another order",
      () => Object.assign([1], { [symbol]: 1, [otherSymbol]: 2 }),
      () => Object.assign([1], { [otherSymbol]: 2, [symbol]: 1 }),
      true,
      true,
    ],
  ])("a symbol of an array %s", (_, left, right, loose, strict) => check(left, right, loose, strict));

  const error = (properties: object = {}, options?: ErrorOptions) => Object.assign(new Error("m", options), properties);
  class AssignsMessage extends Error {
    constructor(message: string) {
      super();
      this.message = message;
    }
  }
  class NotFound extends Error {
    get status() {
      return 404;
    }
  }

  it.each<Row>([
    ["__proto__ against another key", () => shown(error(), "__proto__", {}), () => error({ b: 2 }), false, false],
    ["__proto__ against nothing", () => shown(error(), "__proto__", {}), () => error(), false, false],
    [
      "__proto__ that holds the prototype, against another key",
      () => shown(error(), "__proto__", Error.prototype),
      () => error({ b: 2 }),
      false,
      false,
    ],
    [
      "__proto__ on both sides",
      () => shown(error(), "__proto__", {}),
      () => shown(error(), "__proto__", {}),
      true,
      true,
    ],
    ["a key against nothing", () => error({ b: 2 }), () => error(), false, false],
    ["undefined against another key", () => error({ u: undefined }), () => error({ b: 2 }), false, false],
    ["undefined first", () => error({ u: undefined, code: 1 }), () => error({ code: 1 }), true, false],
    ["name against another key", () => error({ name: "Error" }), () => error({ b: 2 }), false, false],
    ["cause against another key", () => error({ cause: 1 }), () => error({ b: 2 }, { cause: 1 }), false, false],
    ["stack against another key", () => shown(error(), "stack", ""), () => error({ b: 2 }), false, false],
    ["the same keys in another order", () => error({ a: 1, b: 2 }), () => error({ b: 2, a: 1 }), true, true],
    // Unless strict, what counts is what the two Errors hold.
    ["name against the inherited one", () => error({ name: "Error" }), () => error(), true, false],
    ["message against a hidden one", () => new AssignsMessage("m"), () => error(), true, false],
    ["cause against a hidden one", () => error({ cause: 1 }), () => error({}, { cause: 1 }), true, false],
    ["stack against a hidden one", () => shown(error(), "stack", ""), () => error(), true, false],
    ["a key against a hidden one", () => error({ x: 1 }), () => hidden(error(), "x", 1), true, false],
    ["a key against another hidden one", () => error({ x: 1 }), () => hidden(error(), "x", 2), false, false],
    ["undefined against a hidden key", () => error({ x: undefined }), () => hidden(error(), "x", 1), true, false],
    ["a key against a getter of a class", () => error({ status: 404 }), () => new NotFound("m"), true, false],
    ["a key against another getter of a class", () => error({ status: 500 }), () => new NotFound("m"), false, false],
  ])("Errors: %s", (_, left, right, loose, strict) => check(left, right, loose, strict));

  it.each([true, false])("does not compare the stacks that two Errors enumerate, strict: %p", strict => {
    expect(Bun.deepEquals(shown(error(), "stack", "a"), shown(error(), "stack", "b"), strict)).toBe(true);
  });

  it("keeps what an Error hides on its side of the comparison", () => {
    const reads: string[] = [];
    const logging = (side: string) =>
      Object.defineProperty({}, "a", { enumerable: true, get: () => (reads.push(side), 1) });
    expect(Bun.deepEquals(hidden(error(), "x", logging("left")), error({ x: logging("right") }))).toBe(true);
    expect(Bun.deepEquals(error({ x: logging("left") }), hidden(error(), "x", logging("right")))).toBe(true);
    expect(reads).toEqual(["left", "right", "left", "right"]);
  });

  it("a key that a nearer prototype hides counts like the one it hides", () => {
    const shadowed = () => withGetter(Object.create(hidden(Object.create({ s: 1 }), "s", 1)));
    check(shadowed, shadowed, true, true);
    check(shadowed, () => withGetter({ b: 2 }), false, false);
  });

  it("a Proxy has the keys it lists and the values it returns", () => {
    const withoutHasTrap = () =>
      new Proxy(
        {},
        {
          ownKeys: () => ["a"],
          getOwnPropertyDescriptor: () => ({ value: 1, enumerable: true, configurable: true }),
          get: (target, key) => (key === "a" ? 1 : target[key]),
        },
      );
    check(withoutHasTrap, () => new Proxy({ a: 1 }, {}), true, true);

    const withoutOwnKeysTrap = () =>
      new Proxy({}, { has: () => true, get: (target, key) => (key === "a" ? 1 : target[key]) });
    check(withoutOwnKeysTrap, () => new Proxy({ a: 1 }, {}), false, false);

    const doubles = () => new Proxy({ a: 1 }, { get: (target, key) => (key === "a" ? 2 : target[key]) });
    check(doubles, () => new Proxy({ a: 2 }, {}), true, true);
  });

  it.each<[string, () => object]>([
    ["objects", () => ({})],
    ["Errors", () => error()],
  ])("reads each key of two %s once", (_, create) => {
    const reads: string[] = [];
    const logging = (side: string, values: Record<string, unknown>) => {
      const object = create();
      for (const [key, value] of Object.entries(values)) {
        Object.defineProperty(object, key, { enumerable: true, get: () => (reads.push(side + key), value) });
      }
      return object;
    };
    expect(
      Bun.deepEquals(
        logging("left.", { a: 1, u: undefined, b: 2, c: 3 }),
        logging("right.", { a: 1, c: 3, v: undefined, b: 2 }),
      ),
    ).toBe(true);
    expect(reads).toEqual(["left.a", "right.a", "left.u", "left.b", "right.b", "left.c", "right.c", "right.v"]);
  });

  it("passes on what a getter throws", () => {
    const throwing = (object: object, enumerable: boolean) =>
      Object.defineProperty(object, "x", {
        enumerable,
        get() {
          throw new RangeError("from the getter");
        },
      });
    for (const [a, b] of [
      [throwing({}, true), {}],
      [throwing({}, true), { x: 1 }],
      [throwing(error(), true), error()],
      [throwing(error(), false), error({ x: 1 })],
    ]) {
      expect(() => Bun.deepEquals(a, b)).toThrow(new RangeError("from the getter"));
      expect(() => Bun.deepEquals(b, a)).toThrow(new RangeError("from the getter"));
    }
    expect(Bun.deepEquals({ x: 1 }, throwing({}, false))).toBe(false);
    expect(Bun.deepEquals(throwing({}, false), { x: 1 })).toBe(false);
    expect(Bun.deepEquals(throwing({}, true), throwing({ b: 2 }, true), true)).toBe(false);
    expect(isDeepStrictEqual(throwing({}, true), throwing({ b: 2 }, true))).toBe(false);
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
