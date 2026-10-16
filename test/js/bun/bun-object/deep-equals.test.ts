import { bunEnv, bunExe, isASAN, isWindows } from "harness";
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

  it("compares an instance of an Array subclass as an array", () => {
    class List extends Array {}
    expect(Bun.deepEquals(List.of(1, 2), [1, 2], true)).toBe(true);
    expect(Bun.deepEquals([1, 2], List.of(1, 2), true)).toBe(true);
    expect(Bun.deepEquals(List.of(1, 2), [1, 3], true)).toBe(false);
    expect(List.of(1, 2)).toStrictEqual([1, 2]);
  });

  it("compares Array.prototype as an array", () => {
    expect(Bun.deepEquals(Array.prototype, [], true)).toBe(true);
    expect(Bun.deepEquals([], Array.prototype, true)).toBe(true);
    expect(Bun.deepEquals(Array.prototype, [1], true)).toBe(false);
    expect(Array.prototype).toStrictEqual([]);
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

// Strict mode types a Proxy against a plain value by what the Proxy presents: its
// `constructor`, read like any other property, `length` for an array, and its
// Object.prototype.toString tag. Two Proxies are compared as before.
describe("Bun.deepEquals strict mode with a Proxy", () => {
  const P = <T extends object>(target: T, handler: ProxyHandler<T> = {}) => new Proxy(target, handler);
  class Foo {
    a = 1;
  }
  class Bar {
    a = 1;
  }
  class List extends Array {}
  const nullPrototype = (properties: object) => Object.assign(Object.create(null), properties);
  const withTrailingHole = () => {
    const array = [1, 2, 3];
    array.length = 4;
    return array;
  };
  const key = Symbol("key");
  const answers = (property: PropertyKey, value: unknown): ProxyHandler<object> => ({
    get: (t, k, receiver) => (k === property ? value : Reflect.get(t, k, receiver)),
  });
  // Each read of a function gives a new bound function, `constructor` included.
  const binding: ProxyHandler<object> = {
    get(t, k, receiver) {
      const value = Reflect.get(t, k, receiver);
      return typeof value === "function" ? value.bind(t) : value;
    },
  };

  // Like Vue's reactive(): a nested object comes back as a Proxy, and each target has one Proxy.
  const proxies = new WeakMap<object, object>();
  const reactive = <T extends object>(target: T): T => {
    let proxy = proxies.get(target);
    if (!proxy) {
      proxy = new Proxy(target, {
        get(t, k, receiver) {
          const value = Reflect.get(t, k, receiver);
          return typeof value === "object" && value !== null ? reactive(value) : value;
        },
      });
      proxies.set(target, proxy);
    }
    return proxy as T;
  };
  const cyclic = () => {
    const list: unknown[] = [{ b: 2 }];
    const object = { a: 1, list, self: null as unknown };
    object.self = object;
    list.push(object);
    return object;
  };

  // Every pair goes through Bun.deepEquals and toStrictEqual, in both operand orders.
  const eachPair = (expected: boolean, pairs: [name: string, pair: () => [unknown, unknown]][]) =>
    it.each(pairs)("%s", (_name, pair) => {
      const [a, b] = pair();
      expect([Bun.deepEquals(a, b, true), Bun.deepEquals(b, a, true)]).toEqual([expected, expected]);
      const expectation = (value: unknown) => (expected ? expect(value) : expect(value).not);
      expectation(a).toStrictEqual(b);
      expectation(b).toStrictEqual(a);
    });

  describe("is equal to the plain value it presents", () => {
    eachPair(true, [
      ["an object", () => [P({ a: 1 }), { a: 1 }]],
      ["an empty object", () => [P({}), {}]],
      ["an object with its keys in another order", () => [P({ a: 1, b: 2 }), { b: 2, a: 1 }]],
      [
        "an ownKeys trap that reverses the keys",
        () => [P({ a: 1, b: 2 }, { ownKeys: t => Reflect.ownKeys(t).reverse() }), { a: 1, b: 2 }],
      ],
      ["an array", () => [P([1, 2]), [1, 2]]],
      ["an empty array", () => [P([]), []]],
      ["an array with a trailing hole", () => [P(withTrailingHole()), withTrailingHole()]],
      ["a class instance", () => [P(new Foo()), new Foo()]],
      ["a null-prototype object", () => [P(nullPrototype({ a: 1 })), nullPrototype({ a: 1 })]],
      ["a symbol-keyed property", () => [P({ [key]: 1 }), { [key]: 1 }]],
      ["a Proxy of a Proxy", () => [P(P({ a: 1 })), { a: 1 }]],
      [
        "its own cyclic target",
        () => {
          const target: Record<string, unknown> = { a: 1 };
          target.self = target;
          return [P(target), target];
        },
      ],
      ["a cyclic value, with nested objects behind Proxies", () => [reactive(cyclic()), cyclic()]],
      ["as a property value", () => [{ x: P({ a: 1 }) }, { x: { a: 1 } }]],
      ["as a symbol-keyed property value", () => [{ [key]: P({ a: 1 }) }, { [key]: { a: 1 } }]],
      ["as an array element", () => [[P({ a: 1 })], [{ a: 1 }]]],
      ["as a Set member", () => [new Set([P({ a: 1 })]), new Set([{ a: 1 }])]],
      ["as a Map key", () => [new Map([[P({ k: 1 }), 1]]), new Map([[{ k: 1 }, 1]])]],
      ["as a Map value", () => [new Map([[1, P({ a: 1 })]]), new Map([[1, { a: 1 }]])]],
      // `constructor` is compared with ===. The two strings are separate cells with one text.
      [
        "a key named constructor that holds an equal string",
        () => [P(JSON.parse('{"constructor":"ab","x":1}')), { constructor: ["a", "b"].join(""), x: 1 }],
      ],
    ]);
  });

  // Two arrays are typed by `length` alone, as two arrays with no Proxy are. Jest agrees.
  // Vitest and node also compare `constructor`, so they call these pairs unequal.
  describe("types an array by its length and not by its class", () => {
    eachPair(true, [
      ["an instance of an Array subclass and an array", () => [P(List.of(1, 2)), [1, 2]]],
      ["an array and an instance of an Array subclass", () => [P([1, 2]), List.of(1, 2)]],
      ["an array from another realm and an array", () => [P(vm.runInNewContext("[1, 2]")), [1, 2]]],
      ["a get trap that binds functions", () => [P([1, 2], binding), [1, 2]]],
    ]);
  });

  describe("is not equal to a value of another class", () => {
    eachPair(false, [
      ["a class instance and an object literal", () => [P(new Foo()), { a: 1 }]],
      ["an object literal and a class instance", () => [P({ a: 1 }), new Foo()]],
      ["instances of two classes", () => [P(new Foo()), new Bar()]],
      ["a null-prototype object and an object literal", () => [P(Object.create(null)), {}]],
      ["an object literal and a null-prototype object", () => [P({}), Object.create(null)]],
      ["an object and an array", () => [P({}), []]],
      ["an array and an object with the same keys", () => [P([1, 2, 3]), { 0: 1, 1: 2, 2: 3 }]],
      ["a Map and an object", () => [P(new Map([[1, 2]])), {}]],
      ["a Date and an object", () => [P(new Date(0)), {}]],
      [
        "an object with its own toString tag",
        () => [P({}), Object.defineProperty({}, Symbol.toStringTag, { value: "Tagged" })],
      ],
      ["a target that inherits a toString tag", () => [P(Object.create({ [Symbol.toStringTag]: "Tagged" })), {}]],
      ["a get trap that binds functions and an object literal", () => [P({ a: 1 }, binding), { a: 1 }]],
      [
        "a constructor that is NaN on a shared prototype",
        () => {
          const prototype = { constructor: NaN };
          return [P(Object.create(prototype)), Object.create(prototype)];
        },
      ],
    ]);
  });

  // The own keys of these objects do not show their state, so a Proxy stays unequal to them.
  // Jest, Vitest and node throw for the URL. Jest and Vitest call the WeakMap pair equal.
  describe("is not equal to an object that keeps its state in internal slots", () => {
    eachPair(false, [
      ["a URL", () => [P(new URL("http://a/")), new URL("http://a/")]],
      ["a WeakMap", () => [P(new WeakMap()), new WeakMap()]],
      ["a DataView", () => [P(new DataView(new ArrayBuffer(1))), new DataView(new ArrayBuffer(1))]],
    ]);
  });

  describe("compares own enumerable keys and their values", () => {
    eachPair(false, [
      ["a different value", () => [P({ a: 1 }), { a: 2 }]],
      ["a missing key", () => [P({ a: 1 }), { a: 1, b: 2 }]],
      ["an undefined value and a missing key", () => [P({ a: undefined }), {}]],
      ["a different key", () => [P({ a: 1 }), { b: 1 }]],
      ["a different key, with the shared key in another position", () => [P({ a: 1, b: 2 }), { b: 2, c: 1 }]],
      // Jest and Vitest call this pair equal in one operand order. node calls it unequal.
      [
        "a key that the other side holds as non-enumerable",
        () => [P({ a: 1, b: 2 }), Object.defineProperty({ a: 1, c: 3 }, "b", { value: 2, enumerable: false })],
      ],
      ["a key the target inherits", () => [P(Object.create({ a: 1 })), { a: 1 }]],
      [
        "a key that the other side only inherits, with an equal value",
        () => [P({ a: 1, b: 2 }), Object.assign(Object.create({ a: 1 }), { b: 2, c: 3 })],
      ],
      ["an own key named constructor", () => [P({ constructor: Object }), { a: 1 }]],
      // Jest and Vitest call this pair unequal too. node calls it equal.
      [
        "an own key named constructor that holds an object",
        () => [P({ constructor: { x: 1 } }), { constructor: { x: 1 } }],
      ],
      ["a has trap that answers true for every key", () => [P({ a: 1 }, { has: () => true }), { b: 1 }]],
    ]);
    eachPair(true, [["a target that only inherits a key and an empty object", () => [P(Object.create({ x: 1 })), {}]]]);
  });

  describe("compares the length and the holes of an array", () => {
    eachPair(false, [
      ["a trailing hole", () => [P([1, 2, 3]), withTrailingHole()]],
      ["a hole and an undefined element", () => [P([1, , 3]), [1, undefined, 3]]],
      ["an undefined element and a hole", () => [P([1, undefined, 3]), [1, , 3]]],
      ["five holes and an empty array", () => [P(new Array(5)), []]],
      ["a shorter array", () => [P([1, 2]), [1, 2, 3]]],
      ["a get trap that answers 5 for length", () => [P([1, 2], answers("length", 5)), [1, 2]]],
      ["a get trap that answers a string for length", () => [P([1, 2], answers("length", "2")), [1, 2]]],
    ]);
    // Math.sqrt(4) is a double. `length` is compared with ===, not by the bits of the value.
    eachPair(true, [
      ["a get trap that answers a double for length", () => [P([1, 2], answers("length", Math.sqrt(4))), [1, 2]]],
    ]);
  });

  // Shapes of state libraries other than Vue, modelled by hand. The target of each Proxy does
  // not hold what the Proxy presents.
  describe("presents what the traps of a state library answer", () => {
    // Like an immer draft: the target is a record of the state, and every trap answers for `latest`.
    const draft = (base: object) => {
      const record = { latest: base as Record<PropertyKey, unknown> };
      const latest = (t: object) => (Array.isArray(t) ? t[0] : (t as typeof record)).latest;
      return new Proxy(Array.isArray(base) ? [record] : record, {
        get: (t, k) => latest(t)[k],
        has: (t, k) => k in latest(t),
        ownKeys: t => Reflect.ownKeys(latest(t)),
        getOwnPropertyDescriptor(t, k) {
          const descriptor = Reflect.getOwnPropertyDescriptor(latest(t), k);
          return (
            descriptor && {
              writable: true,
              configurable: !Array.isArray(t) || k !== "length",
              enumerable: descriptor.enumerable,
              value: latest(t)[k],
            }
          );
        },
        getPrototypeOf: t => Object.getPrototypeOf(latest(t)),
      });
    };
    // Like Svelte 5 $state: a write goes to a side table. The target keeps its old keys and its old length.
    const DELETED = Symbol("deleted");
    const state = <T extends object>(target: T): T => {
      const written = new Map<PropertyKey, unknown>();
      return new Proxy(target, {
        get: (t, k, receiver) =>
          written.has(k) ? (written.get(k) === DELETED ? undefined : written.get(k)) : Reflect.get(t, k, receiver),
        set: (t, k, value) => (written.set(k, value), true),
        deleteProperty: (t, k) => (written.set(k, DELETED), true),
        has: (t, k) => (written.has(k) ? written.get(k) !== DELETED : k in t),
        ownKeys(t) {
          const keys = Reflect.ownKeys(t).filter(k => written.get(k) !== DELETED);
          for (const [k, value] of written) if (value !== DELETED && !(k in t)) keys.push(k as string | symbol);
          return keys;
        },
        getOwnPropertyDescriptor(t, k) {
          const descriptor = Reflect.getOwnPropertyDescriptor(t, k);
          if (!written.has(k)) return descriptor;
          if (written.get(k) === DELETED) return undefined;
          const value = written.get(k);
          return descriptor
            ? { ...descriptor, value }
            : { enumerable: true, configurable: true, writable: true, value };
        },
      });
    };
    // Like Solid's createMutable: a new function for each Array.prototype method, `constructor` included.
    const mutable = <T extends unknown[]>(target: T): T =>
      new Proxy(target, {
        get(t, k, receiver) {
          const value = Reflect.get(t, k, receiver);
          return typeof value === "function" && value === (Array.prototype as any)[k]
            ? (...args: unknown[]) => value.apply(receiver, args)
            : value;
        },
      });
    const after = <T>(proxy: T, change: (proxy: T) => void) => (change(proxy), proxy);
    const withAddedKey = () => after(state<Record<string, number>>({ a: 1 }), s => void (s.b = 2));
    const withDeletedKey = () => after(state<Record<string, number>>({ a: 1, b: 2 }), s => void delete s.b);
    const afterPush = () => after(state([1]), s => void s.push(2));

    eachPair(true, [
      ["a draft of an object", () => [draft({ a: 1, b: [1] }), { a: 1, b: [1] }]],
      ["a draft of an array", () => [draft([1, 2, 3]), [1, 2, 3]]],
      ["a state with an added key", () => [withAddedKey(), { a: 1, b: 2 }]],
      ["a state with a deleted key", () => [withDeletedKey(), { a: 1 }]],
      ["a state array after a push", () => [afterPush(), [1, 2]]],
      ["a mutable array", () => [mutable([1, 2]), [1, 2]]],
    ]);
    eachPair(false, [
      ["a draft of an object and another key", () => [draft({ a: 1 }), { b: 1 }]],
      ["a draft of an array and a shorter array", () => [draft([1, 2, 3]), [1, 2]]],
      ["a state with an added key and the keys of its target", () => [withAddedKey(), { a: 1 }]],
      ["a state with a deleted key and the keys of its target", () => [withDeletedKey(), { a: 1, b: 2 }]],
      ["a state array after a push and the elements of its target", () => [afterPush(), [1]]],
      ["a mutable array and another element", () => [mutable([1, 2]), [1, 3]]],
    ]);
  });

  // Two Proxies run no trap for their type, so a trap cannot change a target before the walk.
  // The walk reads keys as it did, and it also reads an enumerable key that a target inherits.
  describe("two Proxies are compared as before", () => {
    // Like a mock library: the get trap stores a new function for each key it is asked for.
    const mock = () =>
      P({ isMock: true } as Record<PropertyKey, unknown>, {
        get(t, k) {
          if (!(k in t)) t[k] = () => {};
          return t[k];
        },
      });
    const throwsOnGet = () =>
      P(
        {},
        {
          get() {
            throw new Error("the get trap ran");
          },
        },
      );

    eachPair(false, [["an inherited key on one side only", () => [P(Object.create({ x: 1 })), P({})]]]);
    eachPair(true, [
      ["an inherited key and an own key", () => [P(Object.create({ x: 1 })), P({ x: 1 })]],
      ["cyclic values, with nested objects behind Proxies", () => [reactive(cyclic()), reactive(cyclic())]],
      ["empty objects with a get trap that throws", () => [throwsOnGet(), throwsOnGet()]],
      ["mocks that store a function for each key they are asked for", () => [mock(), mock()]],
    ]);

    it("an inherited getter runs with the Proxy as its receiver", () => {
      const url = (href: string) => P(new URL(href));
      expect(() => Bun.deepEquals(url("http://a/"), url("http://b/"), true)).toThrow(TypeError);
      expect(() => expect(url("http://a/")).not.toStrictEqual(url("http://b/"))).toThrow(TypeError);
    });
  });

  it("does not equal a callable Proxy to a function or to an object", () => {
    const callable = () => P(function () {});
    const same = callable();
    const target = function () {};
    // Not callable, with the constructor and the toString tag of a function.
    const functionLike = () => Object.create(Function.prototype, { [Symbol.toStringTag]: { value: "Function" } });
    expect({
      itself: Bun.deepEquals(same, same, true),
      itsTarget: Bun.deepEquals(P(target), target, true),
      anObject: Bun.deepEquals(callable(), {}, true),
      aNativeConstructor: Bun.deepEquals(callable(), Object, true),
      aFunctionLikeObject: Bun.deepEquals(callable(), functionLike(), true),
      aFunctionLikeObjectFirst: Bun.deepEquals(functionLike(), callable(), true),
    }).toEqual({
      itself: true,
      itsTarget: false,
      anObject: false,
      aNativeConstructor: false,
      aFunctionLikeObject: false,
      aFunctionLikeObjectFirst: false,
    });
  });

  describe("reads the type through the traps", () => {
    it("a get trap that answers for constructor decides the class", () => {
      const presentsFoo = () => P({ a: 1 }, answers("constructor", Foo));
      expect(Bun.deepEquals(presentsFoo(), new Foo(), true)).toBe(true);
      expect(Bun.deepEquals(presentsFoo(), { a: 1 }, true)).toBe(false);
    });

    it("a getPrototypeOf trap does not decide the class", () => {
      const claimsFooPrototype = () => P({ a: 1 }, { getPrototypeOf: () => Foo.prototype });
      expect(Bun.deepEquals(claimsFooPrototype(), { a: 1 }, true)).toBe(true);
      expect(Bun.deepEquals(claimsFooPrototype(), new Foo(), true)).toBe(false);
    });

    it("a get trap that answers one value for every key does not equal an object literal", () => {
      expect(Bun.deepEquals(P({ a: 1 }, { get: () => 99 }), { a: 99 }, true)).toBe(false);
    });

    it("sees what changed after the Proxy was made", () => {
      const handler: ProxyHandler<{ a: number }> = {};
      const trapAddedLater = P({ a: 1 }, handler);
      handler.get = (t, k, receiver) => (k === "a" ? 2 : Reflect.get(t, k, receiver));
      expect(Bun.deepEquals(trapAddedLater, { a: 2 }, true)).toBe(true);

      const target: Record<string, number> = { a: 1 };
      const targetChangedLater = P(target);
      target.b = 2;
      expect(Bun.deepEquals(targetChangedLater, { a: 1, b: 2 }, true)).toBe(true);

      const prototypeSetLater = P({ a: 1 });
      Object.setPrototypeOf(prototypeSetLater, Foo.prototype);
      expect(Bun.deepEquals(prototypeSetLater, new Foo(), true)).toBe(true);
      expect(Bun.deepEquals(prototypeSetLater, { a: 1 }, true)).toBe(false);
    });
  });

  describe("propagates an error", () => {
    const caught = (run: () => unknown) => {
      try {
        run();
      } catch (error) {
        return error;
      }
      throw new Error("expected a throw");
    };
    const trapError = new RangeError("thrown by the trap");
    const fail = () => {
      throw trapError;
    };

    it.each([
      ["the get trap", () => P({ a: 1 }, { get: fail })],
      ["the get trap of an array Proxy", () => P([1], { get: fail })],
      ["the ownKeys trap", () => P({ a: 1 }, { ownKeys: fail })],
      ["the getOwnPropertyDescriptor trap", () => P({ a: 1 }, { getOwnPropertyDescriptor: fail })],
    ])("thrown by %s", (_name, proxy) => {
      const plain = () => (Array.isArray(proxy()) ? [1] : { a: 1 });
      expect(caught(() => Bun.deepEquals(proxy(), plain(), true))).toBe(trapError);
      expect(caught(() => Bun.deepEquals(plain(), proxy(), true))).toBe(trapError);
      expect(caught(() => expect(proxy()).toStrictEqual(plain()))).toBe(trapError);
      expect(caught(() => expect(proxy()).not.toStrictEqual(plain()))).toBe(trapError);
    });

    it("for a Proxy that is revoked before the call", () => {
      const { proxy, revoke } = Proxy.revocable({ a: 1 }, {});
      revoke();
      expect(() => Bun.deepEquals(proxy, { a: 1 }, true)).toThrow(TypeError);
      expect(() => Bun.deepEquals({ a: 1 }, proxy, true)).toThrow(TypeError);
    });

    it.each(["get", "ownKeys"] as const)("for a Proxy that its own %s trap revokes", trap => {
      const revocable = Proxy.revocable(
        { a: 1 },
        {
          [trap](...args: unknown[]) {
            revocable.revoke();
            return (Reflect[trap] as (...args: unknown[]) => unknown)(...args);
          },
        },
      );
      expect(() => Bun.deepEquals(revocable.proxy, { a: 1 }, true)).toThrow(TypeError);
    });

    it("but not when both operands are the same Proxy", () => {
      const proxy = P({ a: 1 }, { get: fail, ownKeys: fail });
      expect(Bun.deepEquals(proxy, proxy, true)).toBe(true);
    });
  });

  it("leaves the default mode and the fourth-argument mode as they were", () => {
    const deepEquals = Bun.deepEquals as (a: unknown, b: unknown, strict?: boolean, skipPrototype?: boolean) => boolean;
    expect({
      defaultModeEqualObject: deepEquals(P({ a: 1 }), { a: 1 }),
      defaultModeIgnoresClass: deepEquals(P(new Foo()), { a: 1 }),
      fourthArgumentEqualObject: deepEquals(P({ a: 1 }), { a: 1 }, true, true),
      fourthArgumentIgnoresClass: deepEquals(P(new Foo()), P(new Bar()), true, true),
    }).toEqual({
      defaultModeEqualObject: true,
      defaultModeIgnoresClass: true,
      fourthArgumentEqualObject: true,
      fourthArgumentIgnoresClass: true,
    });
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
