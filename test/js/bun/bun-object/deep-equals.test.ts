import { bunEnv, bunExe, isASAN, isWindows } from "harness";
import assert from "node:assert";
import util from "node:util";
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

// A Set member or Map key that the other side does not hold by identity needs a deep-equal entry there.
// As in Jest's iterableEquality, a Map entry matches on its key and its value together.
describe("Set and Map entries without an identical counterpart", () => {
  type Check = (a: unknown, b: unknown, equal: boolean) => void;
  // The fourth argument of Bun.deepEquals is not in the public types.
  const deepEquals = Bun.deepEquals as (a: unknown, b: unknown, strict?: boolean, skipPrototype?: boolean) => boolean;
  const jestRule: Record<string, Check> = {
    "Bun.deepEquals": (a, b, equal) => expect(deepEquals(a, b)).toBe(equal),
    "Bun.deepEquals strict": (a, b, equal) => expect(deepEquals(a, b, true)).toBe(equal),
    "Bun.deepEquals strict, skipPrototype": (a, b, equal) => expect(deepEquals(a, b, true, true)).toBe(equal),
    "expect().toEqual": (a, b, equal) => (equal ? expect(a).toEqual(b) : expect(a).not.toEqual(b)),
    "expect().toStrictEqual": (a, b, equal) => (equal ? expect(a).toStrictEqual(b) : expect(a).not.toStrictEqual(b)),
  };
  // assert.deepEqual has Bun.deepEquals semantics. It is here only for the answers that node gives too.
  const legacy: Record<string, Check> = {
    "assert.deepEqual": (a, b, equal) =>
      equal ? assert.deepEqual(a, b) : expect(() => assert.deepEqual(a, b)).toThrow(assert.AssertionError),
  };
  const nodeStrict: Record<string, Check> = {
    "assert.deepStrictEqual": (a, b, equal) =>
      equal ? assert.deepStrictEqual(a, b) : expect(() => assert.deepStrictEqual(a, b)).toThrow(assert.AssertionError),
    "util.isDeepStrictEqual": (a, b, equal) => expect(util.isDeepStrictEqual(a, b)).toBe(equal),
    "util.isDeepStrictEqual, skipPrototype": (a, b, equal) => expect(util.isDeepStrictEqual(a, b, true)).toBe(equal),
  };
  const everyEntryPoint = { ...jestRule, ...legacy, ...nodeStrict };

  const set = (...members: unknown[]) => new Set(members);
  const map = (...entries: [unknown, unknown][]) => new Map(entries);
  const shared = { a: 1 };

  // [name, a, b, equal]: the same answer from every entry point, in both argument orders.
  const cases: [string, unknown, unknown, boolean][] = [
    ["Set: same members, other order", set({ a: 1 }, { a: 2 }, { a: 3 }), set({ a: 3 }, { a: 1 }, { a: 2 }), true],
    ["Set: equal duplicate counts", set({ a: 1 }, { a: 1 }, { a: 2 }), set({ a: 2 }, { a: 1 }, { a: 1 }), true],
    ["Set: one member differs", set({ a: 1 }, { a: 2 }), set({ a: 1 }, { a: 3 }), false],
    ["Set: a primitive only one side holds", set(1, { a: 1 }), set(2, { a: 1 }), false],
    ["Set: an object on one side, primitives only on the other", set({ a: 1 }, 1), set(1, 2), false],
    ["Set: a member both sides hold, after an equal one", set({ a: 2 }, shared), set({ a: 2 }, shared), true],
    ["Map: one value differs", map([{ k: 1 }, "x"], [{ k: 1 }, "y"]), map([{ k: 1 }, "x"], [{ k: 1 }, "z"]), false],
    ["Map: one key differs", map([{ k: 1 }, "x"], [{ k: 1 }, "y"]), map([{ k: 1 }, "x"], [{ k: 2 }, "y"]), false],
    ["Map: a key both sides hold, different values", map([shared, 1]), map([shared, 2]), false],
    ["Map: a primitive key only one side holds", map(["p", 1], [{ k: 1 }, 1]), map(["q", 1], [{ k: 1 }, 1]), false],
    ["Map: undefined values", map(["a", undefined], ["b", 1]), map(["b", 1], ["a", undefined]), true],
    [
      "Map: an undefined value under a key only one side holds",
      map(["a", undefined], ["b", 1]),
      map(["c", undefined], ["b", 1]),
      false,
    ],
    [
      "Map: an undefined value under a key both sides hold, after an equal key",
      map([{ a: 1 }, 1], [shared, undefined]),
      map([{ a: 1 }, 1], [shared, undefined]),
      true,
    ],
    ["Map: undefined against a value under the same key", map(["a", undefined]), map(["a", 1]), false],
  ];

  // A Map entry matches on its key and its value together.
  const keyAndValueCases: [string, unknown, unknown, boolean][] = [
    [
      "Map: equal keys, values in the other order",
      map([{ k: 1 }, "x"], [{ k: 1 }, "y"]),
      map([{ k: 1 }, "y"], [{ k: 1 }, "x"]),
      true,
    ],
    // https://github.com/oven-sh/bun/issues/34830
    ["Map: equal RegExp keys in the same order", map([/a/, "x"], [/a/, "y"]), map([/a/, "x"], [/a/, "y"]), true],
    [
      "Map: three equal keys, values rotated",
      map([{ k: 1 }, 1], [{ k: 1 }, 2], [{ k: 1 }, 3]),
      map([{ k: 1 }, 3], [{ k: 1 }, 1], [{ k: 1 }, 2]),
      true,
    ],
    [
      "Map: a key both sides hold, its value under an equal key",
      map([shared, 1], [{ a: 1 }, 2]),
      map([shared, 2], [{ a: 1 }, 1]),
      true,
    ],
    [
      "Map: a key both sides hold after an equal key, its value under that key",
      map([{ a: 1 }, 2], [shared, 1]),
      map([{ a: 1 }, 1], [shared, 2]),
      true,
    ],
    [
      "Map: object and primitive keys, other order",
      map(["p", 0], [{ k: 1 }, 1], [{ k: 1 }, 2]),
      map([{ k: 1 }, 2], ["p", 0], [{ k: 1 }, 1]),
      true,
    ],
  ];

  describe.each(Object.entries(everyEntryPoint))("%s", (_, check) => {
    it.each(cases)("%s", (_, a, b, equal) => {
      check(a, b, equal);
      check(b, a, equal);
    });
  });

  describe.each(Object.entries(everyEntryPoint))("%s", (_, check) => {
    it.each(keyAndValueCases)("%s", (_, a, b, equal) => {
      check(a, b, equal);
      check(b, a, equal);
    });
  });

  // [name, a, b, answer for (a, b), answer for (b, a)]: every left entry needs some equal right entry, and two entries can share one.
  const unequalCounts: [string, unknown, unknown, boolean, boolean][] = [
    ["Set: a duplicate in place of a distinct member", set({ a: 1 }, { a: 1 }), set({ a: 1 }, { a: 2 }), true, false],
    [
      "Set: different duplicate counts",
      set({ a: 1 }, { a: 1 }, { a: 2 }),
      set({ a: 1 }, { a: 2 }, { a: 2 }),
      true,
      true,
    ],
    ["Set: a member both sides hold, equal to a second one", set(shared, { a: 1 }), set(shared, { a: 2 }), true, false],
    [
      "Map: a duplicate entry in place of a distinct one",
      map([{ k: 1 }, 1], [{ k: 1 }, 1]),
      map([{ k: 1 }, 1], [{ k: 2 }, 1]),
      true,
      false,
    ],
    [
      "Map: different duplicate counts",
      map([{ k: 1 }, 1], [{ k: 1 }, 1], [{ k: 1 }, 2]),
      map([{ k: 1 }, 1], [{ k: 1 }, 2], [{ k: 1 }, 2]),
      true,
      true,
    ],
    [
      "Map: a key both sides hold with different values, after an equal entry",
      map([{ a: 1 }, 1], [shared, 1]),
      map([{ a: 1 }, 1], [shared, 2]),
      true,
      false,
    ],
  ];

  describe.each(Object.entries(jestRule))("%s", (_, check) => {
    it.each(unequalCounts)("%s", (_, a, b, forward, backward) => {
      check(a, b, forward);
      check(b, a, backward);
    });
  });

  // node's strict entry points pair every such entry with a right entry of its own (setObjectEquiv / mapObjectEquiv in lib/internal/util/comparisons.js).
  describe.each(Object.entries(nodeStrict))("%s", (_, check) => {
    it.each(unequalCounts)("%s", (_, a, b) => {
      check(a, b, false);
      check(b, a, false);
    });
  });

  // node probes the first and then the last open entry, so the same order and the reversed order cost about one comparison per entry.
  it.each(Object.entries(nodeStrict))("%s: reads each entry a bounded number of times", (_, check) => {
    const over: string[] = [];
    let reads = 0;
    const entry = (id: number) => ({
      get id() {
        reads++;
        return id;
      },
    });
    const kinds = {
      Set: (ids: number[]) => new Set(ids.map(entry)),
      Map: (ids: number[]) => new Map(ids.map(id => [entry(id), id])),
    };
    for (const [kind, make] of Object.entries(kinds)) {
      for (const n of [64, 128]) {
        const ids = Array.from({ length: n }, (_, i) => i);
        for (const [order, rightIds] of [
          ["same order", ids],
          ["reversed", ids.toReversed()],
        ] as const) {
          const a = make(ids);
          const b = make(rightIds);
          reads = 0;
          check(a, b, true);
          if (reads > 8 * n) over.push(`${kind}, ${order}, n=${n}: ${reads} reads`);
        }
      }
    }
    expect(over).toEqual([]);
  });

  // The pairing works on a copy of the right entries, as in node.
  describe("a getter that changes one side during the comparison", () => {
    function emptiedMidway() {
      const right = new Set<unknown>();
      const emptiesRight = {
        get id() {
          right.clear();
          Bun.gc(true);
          return 0;
        },
      };
      const left = set(emptiesRight, { id: 1 }, { id: 2 });
      for (const id of [0, 1, 2]) right.add({ id });
      return [left, right];
    }
    function grownMidway() {
      const right = new Set<unknown>();
      let grown = false;
      const growsRight = {
        get id() {
          if (!grown) right.add({ id: 3 });
          grown = true;
          return 0;
        },
      };
      const left = set(growsRight, { id: 1 }, { id: 2 });
      for (const id of [0, 1, 2]) right.add({ id });
      return [left, right];
    }
    // The getter runs in the left walk, before the right entries are copied. Then fewer entries are left to pair with.
    function keyRemovedInLeftWalk() {
      const right = new Map<unknown, unknown>();
      const removesKey = {
        get v() {
          right.delete(key);
          return 1;
        },
      };
      const key = { k: 2 };
      const left = map([{ k: 1 }, 1], ["held", removesKey], [key, 2]);
      right.set({ k: 1 }, 1).set("held", { v: 1 }).set(key, 2);
      return [left, right];
    }
    // Here the right Map gains a key, so the two sides no longer have the same size.
    function keyAddedInLeftWalk() {
      const right = new Map<unknown, unknown>();
      const addsKey = {
        get v() {
          right.set("added", 1);
          return 1;
        },
      };
      const left = map([{ k: 1 }, 1], ["held", addsKey], [{ k: 2 }, 2]);
      right.set({ k: 1 }, 1).set("held", { v: 1 }).set({ k: 2 }, 2);
      return [left, right];
    }
    // Here a key that is not an object gives way to one that is. The sizes stay equal, but the right Map has more entries to pair than the left Map.
    function keySwappedInLeftWalk() {
      const right = new Map<unknown, unknown>();
      let swapped = false;
      const swapsKey = {
        get v() {
          if (!swapped) right.delete("p");
          if (!swapped) right.set({ k: 9 }, 9);
          swapped = true;
          return 1;
        },
      };
      const left = map([{ k: 1 }, 1], ["p", 0], ["held", swapsKey], [{ k: 2 }, 2]);
      right.set({ k: 1 }, 1).set("p", 0).set("held", { v: 1 }).set({ k: 2 }, 2);
      return [left, right];
    }
    // The left Set loses a member during the pairing, so a right member stays without a partner.
    function leftMemberRemovedMidway() {
      const left = new Set<unknown>();
      const later = { id: 1 };
      const removesLater = {
        get id() {
          left.delete(later);
          return 0;
        },
      };
      left.add(removesLater).add(later);
      return [left, set({ id: 0 }, { id: 1 })];
    }

    it.each(Object.entries(nodeStrict))("%s", (_, check) => {
      check(...emptiedMidway(), true);
      check(...grownMidway(), true);
      check(...keyRemovedInLeftWalk(), false);
      check(...keyAddedInLeftWalk(), false);
      check(...keySwappedInLeftWalk(), false);
      check(...leftMemberRemovedMidway(), false);
    });
  });

  // To node, a function equals only itself.
  it.each(Object.entries(nodeStrict))("%s: callable entries pair only by identity", (_, check) => {
    const callable = () => new Proxy(function () {}, {});
    const shared = callable();
    check(set(callable(), { a: 1 }, { a: 2 }), set(callable(), { a: 2 }, { a: 1 }), false);
    check(set(shared, { a: 1 }, { a: 2 }), set(shared, { a: 2 }, { a: 1 }), true);
    check(map([callable(), 1], [{ a: 1 }, 2]), map([callable(), 1], [{ a: 1 }, 2]), false);
  });

  // {} equals both other members, which do not equal each other. Pairing members one-to-one would make the answer depend on the order.
  it.each(["Bun.deepEquals", "expect().toEqual"])(
    "%s: the insertion order of either side does not change the answer",
    name => {
      const undefinedGetter = () => ({
        get a() {
          return undefined;
        },
      });
      const inherited = () => Object.create({ a: 1 });
      jestRule[name](set({}, undefinedGetter()), set(inherited(), {}), true);
      jestRule[name](set({}, undefinedGetter()), set({}, inherited()), true);
      jestRule[name](set(undefinedGetter(), {}), set(inherited(), {}), true);
      jestRule[name](set(undefinedGetter(), {}), set({}, inherited()), true);
    },
  );

  describe("cycles that run through Set members, Map keys or Map values only", () => {
    function selfSet() {
      const self = new Set<unknown>();
      self.add(self);
      return self;
    }
    function setCycle(tag: number) {
      const outer = new Set<unknown>();
      const inner = new Set<unknown>([tag]);
      outer.add(inner);
      inner.add(outer);
      return set(outer);
    }
    function mapValueCycle(tag: number) {
      const outer = new Map<unknown, unknown>();
      const inner = new Map<unknown, unknown>([["tag", tag]]);
      outer.set("inner", inner);
      inner.set("outer", outer);
      return map(["start", outer]);
    }
    function mapKeyCycle(tag: number) {
      const outer = new Map<unknown, unknown>();
      const inner = new Map<unknown, unknown>([["tag", tag]]);
      outer.set(inner, 1);
      inner.set(outer, 1);
      return map([outer, 1]);
    }
    // Every Map in the cycle is the value of a key that is only deep-equal to its counterpart.
    function valueUnderEqualKeyCycle(tag: number) {
      const outer = new Map<unknown, unknown>();
      const inner = new Map<unknown, unknown>([["tag", tag]]);
      outer.set({ k: 1 }, inner);
      inner.set({ k: 2 }, outer);
      return map([{ k: 0 }, outer]);
    }

    it.each(Object.entries(everyEntryPoint))("%s", (_, check) => {
      check(selfSet(), selfSet(), true);
      check(set(selfSet(), { a: 1 }), set(selfSet(), { a: 2 }), false);
      for (const cycle of [setCycle, mapValueCycle, mapKeyCycle, valueUnderEqualKeyCycle]) {
        check(cycle(1), cycle(1), true);
        check(cycle(1), cycle(2), false);
      }
    });
  });

  it.each(Object.entries(everyEntryPoint))("%s: an exception thrown while comparing entries propagates", (_, check) => {
    const throwing = () => ({
      get x(): number {
        throw new Error("boom");
      },
    });
    expect(() => check(set(throwing()), set(throwing()), true)).toThrow("boom");
    expect(() => check(map([throwing(), 1]), map([throwing(), 1]), true)).toThrow("boom");
    expect(() => check(map(["k", throwing()]), map(["k", throwing()]), true)).toThrow("boom");
    expect(() => check(map([{ k: 1 }, throwing()]), map([{ k: 1 }, throwing()]), true)).toThrow("boom");
  });

  // A key that holds undefined was read as an absent key, so every such entry walked the other Map.
  it.each(Object.entries(everyEntryPoint))("%s: an undefined value is settled by the key lookup", (_, check) => {
    let reads = 0;
    const keys = Array.from({ length: 64 }, (_, id) => ({
      get id() {
        reads++;
        return id;
      },
    }));
    const entries = keys.map(key => [key, undefined] as [unknown, unknown]);
    check(map(...entries), map(...entries.toReversed()), true);
    expect(reads).toBe(0);
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
