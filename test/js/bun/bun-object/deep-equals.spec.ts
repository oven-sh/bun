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

  // Map/Set equality is defined over the unordered entry multiset. Structurally-equal
  // (non-identical) keys must be matched one-to-one against the other side, on both
  // key and value, regardless of insertion order.
  describe("Map/Set with structurally-equal object keys", () => {
    it("Map: same (key, value) multiset in different insertion order is equal", () => {
      const m1 = new Map<object, string>([
        [{ k: 1 }, "x"],
        [{ k: 1 }, "y"],
      ]);
      const m2 = new Map<object, string>([
        [{ k: 1 }, "y"],
        [{ k: 1 }, "x"],
      ]);
      expect(deepEquals(m1, m2)).toBe(true);
      expect(deepEquals(m2, m1)).toBe(true);
    });

    it("Map: shared-reference key matched by identity must not pin a wrong value", () => {
      const shared = { k: 1 };
      const m1 = new Map<object, number>([
        [shared, 1],
        [{ k: 1 }, 2],
      ]);
      const m2 = new Map<object, number>([
        [shared, 2],
        [{ k: 1 }, 1],
      ]);
      expect(deepEquals(m1, m2)).toBe(true);
      expect(deepEquals(m2, m1)).toBe(true);
    });

    it("Map: three structurally-equal keys with permuted values", () => {
      const m1 = new Map<object, number>([
        [{ k: 1 }, 1],
        [{ k: 1 }, 2],
        [{ k: 1 }, 3],
      ]);
      const m2 = new Map<object, number>([
        [{ k: 1 }, 3],
        [{ k: 1 }, 1],
        [{ k: 1 }, 2],
      ]);
      const m3 = new Map<object, number>([
        [{ k: 1 }, 1],
        [{ k: 1 }, 2],
        [{ k: 1 }, 4],
      ]);
      expect(deepEquals(m1, m2)).toBe(true);
      expect(deepEquals(m2, m1)).toBe(true);
      expect(deepEquals(m1, m3)).toBe(false);
      expect(deepEquals(m3, m1)).toBe(false);
    });

    it("Map: duplicate structurally-equal keys with differing value multisets are not equal", () => {
      const m1 = new Map<object, number>([
        [{ k: 1 }, 1],
        [{ k: 1 }, 1],
        [{ k: 1 }, 2],
      ]);
      const m2 = new Map<object, number>([
        [{ k: 1 }, 1],
        [{ k: 1 }, 2],
        [{ k: 1 }, 2],
      ]);
      expect(deepEquals(m1, m2)).toBe(false);
      expect(deepEquals(m2, m1)).toBe(false);
    });

    it("Map: object keys mixed with primitive keys", () => {
      const m1 = new Map<unknown, string>([
        ["p", "same"],
        [{ k: 1 }, "x"],
        [{ k: 1 }, "y"],
      ]);
      const m2 = new Map<unknown, string>([
        [{ k: 1 }, "y"],
        ["p", "same"],
        [{ k: 1 }, "x"],
      ]);
      const m3 = new Map<unknown, string>([
        ["p", "same"],
        ["q", "extra"],
        [{ k: 1 }, "x"],
      ]);
      expect(deepEquals(m1, m2)).toBe(true);
      expect(deepEquals(m2, m1)).toBe(true);
      expect(deepEquals(m1, m3)).toBe(false);
      expect(deepEquals(m3, m1)).toBe(false);
    });

    it("Map: entries whose value is undefined are not treated as missing keys", () => {
      const m1 = new Map<string, unknown>([
        ["a", undefined],
        ["b", 1],
      ]);
      const m2 = new Map<string, unknown>([
        ["b", 1],
        ["a", undefined],
      ]);
      const m3 = new Map<string, unknown>([
        ["c", undefined],
        ["b", 1],
      ]);
      expect(deepEquals(m1, m2)).toBe(true);
      expect(deepEquals(m1, m3)).toBe(false);
      expect(deepEquals(m3, m1)).toBe(false);
    });

    it("Set: structurally-equal elements in different order are equal", () => {
      const s1 = new Set<object>([{ a: 1 }, { a: 2 }, { a: 3 }]);
      const s2 = new Set<object>([{ a: 3 }, { a: 1 }, { a: 2 }]);
      expect(deepEquals(s1, s2)).toBe(true);
      expect(deepEquals(s2, s1)).toBe(true);
    });

    it("Set: duplicate structurally-equal elements on both sides are equal", () => {
      const s1 = new Set<object>([{ a: 1 }, { a: 1 }, { a: 2 }]);
      const s2 = new Set<object>([{ a: 2 }, { a: 1 }, { a: 1 }]);
      expect(deepEquals(s1, s2)).toBe(true);
      expect(deepEquals(s2, s1)).toBe(true);
    });

    it("Set: multisets with different duplicate counts are not equal", () => {
      const s1 = new Set<object>([{ a: 1 }, { a: 1 }, { a: 2 }]);
      const s2 = new Set<object>([{ a: 1 }, { a: 2 }, { a: 2 }]);
      expect(deepEquals(s1, s2)).toBe(false);
      expect(deepEquals(s2, s1)).toBe(false);
    });
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

    // TODO: re-enable when https://github.com/oven-sh/bun/issues/17080 is resolved
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
