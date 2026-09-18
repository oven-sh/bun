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

// Set members and Map keys with no identical counterpart on the other side are matched
// structurally, and each one has to claim a counterpart of its own: Set([{a:1},{a:1}]) is
// not Set([{a:1},{a:2}]), and a Map entry matches on key and value together, so two
// structurally equal keys may carry their values in either order. Every entry point below
// shares the native comparison; expect() additionally understands asymmetric matchers.
describe("Set and Map entries without an identical counterpart", () => {
  type Check = (a: unknown, b: unknown, equal: boolean) => void;
  const exactEntryPoints: Record<string, Check> = {
    "Bun.deepEquals": (a, b, equal) => expect(Bun.deepEquals(a, b)).toBe(equal),
    "Bun.deepEquals strict": (a, b, equal) => expect(Bun.deepEquals(a, b, true)).toBe(equal),
    "util.isDeepStrictEqual": (a, b, equal) => expect(util.isDeepStrictEqual(a, b)).toBe(equal),
    "assert.deepEqual": (a, b, equal) =>
      equal ? assert.deepEqual(a, b) : expect(() => assert.deepEqual(a, b)).toThrow(assert.AssertionError),
    "assert.deepStrictEqual": (a, b, equal) =>
      equal ? assert.deepStrictEqual(a, b) : expect(() => assert.deepStrictEqual(a, b)).toThrow(assert.AssertionError),
  };
  const expectEntryPoints: Record<string, Check> = {
    "expect().toEqual": (a, b, equal) => (equal ? expect(a).toEqual(b) : expect(a).not.toEqual(b)),
    "expect().toStrictEqual": (a, b, equal) => (equal ? expect(a).toStrictEqual(b) : expect(a).not.toStrictEqual(b)),
  };

  const set = (...members: unknown[]) => new Set(members);
  const map = (...entries: [unknown, unknown][]) => new Map(entries);
  const shared = { a: 1 };
  // [description, a, b, equal]; every case is checked in both argument orders.
  const cases: [string, unknown, unknown, boolean][] = [
    ["Set: same objects, other order", set({ a: 1 }, { a: 2 }, { a: 3 }), set({ a: 3 }, { a: 1 }, { a: 2 }), true],
    ["Set: duplicates on both sides", set({ a: 1 }, { a: 1 }, { a: 2 }), set({ a: 2 }, { a: 1 }, { a: 1 }), true],
    ["Set: a duplicate in place of a distinct member", set({ a: 1 }, { a: 1 }), set({ a: 1 }, { a: 2 }), false],
    [
      "Set: a duplicate nested structure",
      set({ a: { b: 1 } }, { a: { b: 1 } }),
      set({ a: { b: 1 } }, { a: { b: 2 } }),
      false,
    ],
    ["Set: a member both sides hold cannot stand in twice", set(shared, { a: 1 }), set(shared, { a: 2 }), false],
    ["Set: a primitive only one side holds", set(1, { a: 1 }), set(2, { a: 1 }), false],
    ["Set: one object differs", set({ a: 1 }, { a: 2 }), set({ a: 1 }, { a: 3 }), false],
    [
      "Map: equal keys, values in other order",
      map([{ k: 1 }, "x"], [{ k: 1 }, "y"]),
      map([{ k: 1 }, "y"], [{ k: 1 }, "x"]),
      true,
    ],
    ["Map: equal RegExp keys in the same order", map([/a/, "x"], [/a/, "y"]), map([/a/, "x"], [/a/, "y"]), true],
    [
      "Map: three equal keys, permuted values",
      map([{ k: 1 }, 1], [{ k: 1 }, 2], [{ k: 1 }, 3]),
      map([{ k: 1 }, 3], [{ k: 1 }, 1], [{ k: 1 }, 2]),
      true,
    ],
    ["Map: one value differs", map([{ k: 1 }, "x"], [{ k: 1 }, "y"]), map([{ k: 1 }, "x"], [{ k: 1 }, "z"]), false],
    ["Map: one key differs", map([{ k: 1 }, "x"], [{ k: 1 }, "y"]), map([{ k: 1 }, "x"], [{ k: 2 }, "y"]), false],
    [
      "Map: a duplicate key in place of a distinct one",
      map([{ k: 1 }, 1], [{ k: 1 }, 1]),
      map([{ k: 1 }, 1], [{ k: 2 }, 1]),
      false,
    ],
    [
      "Map: a key both sides hold, value moved to an equal key",
      map([shared, 1], [{ a: 1 }, 2]),
      map([shared, 2], [{ a: 1 }, 1]),
      true,
    ],
    ["Map: a key both sides hold, different values", map([shared, 1]), map([shared, 2]), false],
    [
      "Map: object and primitive keys, other order",
      map(["p", 0], [{ k: 1 }, 1], [{ k: 1 }, 2]),
      map([{ k: 1 }, 2], ["p", 0], [{ k: 1 }, 1]),
      true,
    ],
    ["Map: a primitive key only one side holds", map(["p", 1], [{ k: 1 }, 1]), map(["q", 1], [{ k: 1 }, 1]), false],
    [
      "Map: undefined values are not missing entries",
      map(["a", undefined], ["b", 1]),
      map(["b", 1], ["a", undefined]),
      true,
    ],
    [
      "Map: undefined value under a key only one side holds",
      map(["a", undefined], ["b", 1]),
      map(["c", undefined], ["b", 1]),
      false,
    ],
  ];

  describe.each(Object.entries({ ...exactEntryPoints, ...expectEntryPoints }))("%s", (_, check) => {
    it.each(cases)("%s", (_, a, b, equal) => {
      check(a, b, equal);
      check(b, a, equal);
    });
  });

  // Without matchers in play structural equality is an equivalence relation, so the
  // comparison can insist on a one-to-one pairing. expect() cannot: an asymmetric matcher
  // accepts several members, so when the pairing fails it falls back to requiring a
  // counterpart for every member on either side (what Jest checks), which accepts
  // different duplicate counts. Whether one of the duplicates is the same object on both
  // sides must not change either answer.
  const sharedKey = { k: 1 };
  const duplicateCountCases: [string, unknown, unknown][] = [
    ["Set", set({ a: 1 }, { a: 1 }, { a: 2 }), set({ a: 1 }, { a: 2 }, { a: 2 })],
    ["Set sharing a member", set(shared, { a: 1 }, { a: 2 }), set(shared, { a: 2 }, { a: 2 })],
    ["Map", map([{ k: 1 }, 1], [{ k: 1 }, 1], [{ k: 1 }, 2]), map([{ k: 1 }, 1], [{ k: 1 }, 2], [{ k: 1 }, 2])],
    [
      "Map sharing a key",
      map([sharedKey, 1], [{ k: 1 }, 1], [{ k: 1 }, 2]),
      map([sharedKey, 1], [{ k: 1 }, 2], [{ k: 1 }, 2]),
    ],
  ];

  describe.each(Object.entries(exactEntryPoints))("%s", (_, check) => {
    it.each(duplicateCountCases)("%s: different duplicate counts", (_, a, b) => {
      check(a, b, false);
      check(b, a, false);
    });
  });

  describe.each(Object.entries(expectEntryPoints))("%s", (_, check) => {
    it.each(duplicateCountCases)("%s: different duplicate counts", (_, a, b) => {
      check(a, b, true);
      check(b, a, true);
    });
  });

  describe.each(Object.entries(expectEntryPoints))("%s with asymmetric matchers", (_, check) => {
    it("a member taken by a matcher can still satisfy a later member", () => {
      // {a:1} takes expect.anything() first; the concrete {a:1} is left for {a:2}.
      check(set({ a: 1 }, { a: 2 }), set(expect.anything(), { a: 1 }), true);
      check(set(expect.anything(), { a: 1 }), set({ a: 1 }, { a: 2 }), true);
    });

    it("overlapping matchers", () => {
      const received = set({ type: "a", id: 1 }, { type: "a", id: 2 });
      check(received, set(expect.objectContaining({ type: "a" }), expect.objectContaining({ id: 1 })), true);
      check(received, set(expect.objectContaining({ type: "a" }), expect.objectContaining({ id: 3 })), false);
    });

    it("a Map entry is matched on key and value, so a matcher key can carry a different value", () => {
      const received = map([{ a: 1 }, "x"], [{ a: 2 }, "y"]);
      check(received, map([expect.anything(), "y"], [{ a: 1 }, "x"]), true);
      check(received, map([expect.anything(), "z"], [{ a: 1 }, "x"]), false);
    });

    it("matchers in the values of object-keyed entries", () => {
      const received = map([{ k: 1 }, 5], [{ k: 2 }, "s"]);
      check(received, map([{ k: 2 }, expect.any(String)], [{ k: 1 }, expect.any(Number)]), true);
      check(received, map([{ k: 2 }, expect.any(Number)], [{ k: 1 }, expect.any(Number)]), false);
    });
  });

  // A member's comparison goes onto the cycle stack like an array element's does, so a
  // collection holding a self-referential collection terminates instead of recursing until
  // the stack runs out.
  describe("self-referential members", () => {
    function selfSet() {
      const self = new Set<unknown>();
      self.add(self);
      return self;
    }
    function selfMap() {
      const self = new Map<unknown, unknown>();
      self.set("self", self);
      return self;
    }

    it.each(Object.entries({ ...exactEntryPoints, ...expectEntryPoints }))("%s", (_, check) => {
      check(set(selfSet()), set(selfSet()), true);
      check(set(selfSet(), { a: 1 }), set(selfSet(), { a: 2 }), false);
      // Under an object key the value is compared while pairing off entries, under a
      // string key while the keys are looked up.
      check(map([{ k: 1 }, selfMap()]), map([{ k: 1 }, selfMap()]), true);
      check(map(["k", selfMap()]), map(["k", selfMap()]), true);
      check(map([{ k: 1 }, selfMap()]), map([{ k: 2 }, selfMap()]), false);
    });

    it("a collection that contains itself", () => {
      const a = new Set<unknown>([1, { a: 1 }]);
      a.add(a);
      const b = new Set<unknown>();
      b.add(b);
      b.add(1);
      b.add({ a: 1 });
      expect(Bun.deepEquals(a, b)).toBe(true);
      expect(a).toEqual(b);
    });
  });

  it("an exception thrown while comparing members propagates", () => {
    const throwing = () => ({
      get x(): number {
        throw new Error("boom");
      },
    });
    expect(() => Bun.deepEquals(set(throwing()), set(throwing()))).toThrow("boom");
    expect(() => Bun.deepEquals(map([throwing(), 1]), map([throwing(), 1]))).toThrow("boom");
    expect(() => Bun.deepEquals(map(["k", throwing()]), map(["k", throwing()]))).toThrow("boom");
    expect(() => util.isDeepStrictEqual(set(throwing()), set(throwing()))).toThrow("boom");
    expect(() => expect(set(throwing())).toEqual(set(throwing()))).toThrow("boom");
  });

  // Each member is compared against a counterpart or two, not against everything the other
  // side holds, whether the sides were built in the same order or in opposite orders. The
  // getter counts how often the comparison looks inside a member; the rescan of the whole
  // other side per member that this replaces read it about n*n times.
  describe("number of structural comparisons", () => {
    const n = 128;
    const linearEntryPoints: Record<string, (a: unknown, b: unknown) => boolean> = {
      "Bun.deepEquals": (a, b) => Bun.deepEquals(a, b),
      "util.isDeepStrictEqual": (a, b) => util.isDeepStrictEqual(a, b),
      "expect().toEqual": (a, b) => {
        expect(a).toEqual(b);
        return true;
      },
    };

    function members(onRead: () => void) {
      return Array.from({ length: n }, (_, i) => ({
        get id() {
          onRead();
          return i;
        },
      }));
    }

    describe.each(Object.entries(linearEntryPoints))("%s", (_, isEqual) => {
      it.each([
        ["Set, same order", false],
        ["Set, opposite order", true],
      ])("%s", (_, reversed) => {
        let reads = 0;
        const onRead = () => reads++;
        const a = new Set(members(onRead));
        const other = members(onRead);
        const b = new Set(reversed ? other.reverse() : other);
        expect(isEqual(a, b)).toBe(true);
        expect(reads).toBeLessThanOrEqual(8 * n);
      });

      it.each([
        ["Map with object keys, same order", false],
        ["Map with object keys, opposite order", true],
      ])("%s", (_, reversed) => {
        let reads = 0;
        const onRead = () => reads++;
        const a = new Map(members(onRead).map((key, i) => [key, i] as const));
        const other = members(onRead).map((key, i) => [key, i] as const);
        const b = new Map(reversed ? other.reverse() : other);
        expect(isEqual(a, b)).toBe(true);
        expect(reads).toBeLessThanOrEqual(8 * n);
      });
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
