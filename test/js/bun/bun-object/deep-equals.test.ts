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

    // Skipped pending https://github.com/oven-sh/bun/issues/17080
    it.skip("main global object is not equal to vm global objects", () => {
      const [ctx] = contexts;
      expect(deepEquals(global, ctx)).toBe(false);

      ctx.mainGlobal = global;
      const areEqual = vm.runInContext("Bun.deepEquals(globalThis, mainGlobal)", ctx);
      expect(areEqual).toBe(false);
    });
  });
});

describe("Bun.deepEquals fast-path coverage", () => {
  describe.each([true, false])("strict=%p", strict => {
    const eq = (a: unknown, b: unknown) => Bun.deepEquals(a, b, strict);

    it("Int32-shape arrays compare by value", () => {
      expect(eq([1, 2, 3, 4, 5], [1, 2, 3, 4, 5])).toBe(true);
      expect(eq([1, 2, 3, 4, 5], [1, 2, 3, 4, 6])).toBe(false);
      expect(eq([1, 2, 3], [1, 2])).toBe(false);
      expect(eq([], [])).toBe(true);
    });

    it("Int32-shape arrays with holes", () => {
      const a = [1, , 3];
      const b = [1, , 3];
      expect(eq(a, b)).toBe(true);
      const c = [1, 2, 3];
      expect(eq(a, c)).toBe(false);
    });

    it("Double-shape arrays compare by value", () => {
      expect(eq([1.5, 2.5, 3.5], [1.5, 2.5, 3.5])).toBe(true);
      expect(eq([1.5, 2.5, 3.5], [1.5, 2.5, 3.6])).toBe(false);
      // +0 vs -0: SameValue distinguishes these
      expect(eq([0.0, 1.5], [-0.0, 1.5])).toBe(false);
    });

    it("Double-shape arrays with holes", () => {
      const a = [1.5, , 3.5];
      const b = [1.5, , 3.5];
      expect(eq(a, b)).toBe(true);
    });

    it("mixed Int32/Contiguous shapes compare correctly", () => {
      const a = [1, 2, 3]; // Int32
      const b = [1, 2, 3];
      b.push("x");
      b.pop(); // b is now Contiguous
      expect(eq(a, b)).toBe(true);
    });

    it("Contiguous-shape hole vs non-undefined is not equal", () => {
      expect(eq(["x", , "z"], ["x", "y", "z"])).toBe(false);
      expect(eq(["x", "y", "z"], ["x", , "z"])).toBe(false);
      expect(eq([1, , 3], [1, {}, 3])).toBe(false);
      expect(eq(["x", , "z"], ["x", undefined, "z"])).toBe(!strict);
    });

    it("survives an element that mutates the outer array during comparison", () => {
      const a: any[] = [
        new Proxy(
          {},
          {
            ownKeys: () => {
              for (let j = 0; j < 1e5; j++) a.push(j);
              return [];
            },
          },
        ),
        {},
      ];
      const b = [{}, {}];
      // The result itself is unspecified once the input is mutated mid-compare;
      // we only require that it does not crash.
      expect(() => eq(a, b)).not.toThrow();
    });

    it("Contiguous arrays with nested objects", () => {
      const a = [{ x: 1 }, { x: 2 }, { x: 3 }];
      const b = [{ x: 1 }, { x: 2 }, { x: 3 }];
      expect(eq(a, b)).toBe(true);
      const c = [{ x: 1 }, { x: 2 }, { x: 4 }];
      expect(eq(a, c)).toBe(false);
    });

    it("arrays with symbol properties are still compared", () => {
      const s = Symbol("k");
      const a: any = [1, 2, 3];
      a[s] = "hello";
      const b: any = [1, 2, 3];
      b[s] = "hello";
      expect(eq(a, b)).toBe(true);
      const c: any = [1, 2, 3];
      c[s] = "world";
      expect(eq(a, c)).toBe(false);
      const d: any = [1, 2, 3];
      expect(eq(a, d)).toBe(false);
    });

    it("same-structure object with out-of-line storage", () => {
      const make = () => {
        const o: Record<string, number> = {};
        for (let i = 0; i < 80; i++) o["k" + i] = i;
        return o;
      };
      const a = make();
      const b = make();
      expect(eq(a, b)).toBe(true);
      b.k79 = 999;
      expect(eq(a, b)).toBe(false);
    });

    it("falls back correctly after property deletion", () => {
      const a: Record<string, number> = { x: 1, y: 2, z: 3 };
      delete a.y;
      const b: Record<string, number> = { x: 1, y: 2, z: 3 };
      delete b.y;
      expect(eq(a, b)).toBe(true);
      const c: Record<string, number> = { x: 1, z: 3 };
      expect(eq(a, c)).toBe(true);
      const d: Record<string, number> = { x: 1, z: 4 };
      expect(eq(a, d)).toBe(false);
    });

    it("different structures, same keys, skips reverse scan", () => {
      const a = { x: 1, y: 2, z: 3, w: 4 };
      const b = { w: 4, z: 3, y: 2, x: 1 };
      expect(eq(a, b)).toBe(true);
      const c = { w: 4, z: 3, y: 2, v: 1 };
      expect(eq(a, c)).toBe(false);
    });

    it("arrays on a dirtied prototype chain fall through to the generic loop", () => {
      const a = [1, , 3];
      const b = [1, , 3];
      try {
        (Array.prototype as any)[1] = 99;
        expect(eq(a, b)).toBe(true);
        // getIndexWithoutAccessors reads own slots only, so the hole does not
        // resolve to the prototype value.
        expect(eq(a, [1, 99, 3])).toBe(false);
      } finally {
        delete (Array.prototype as any)[1];
      }
    });
  });

  it("asymmetric matchers see array holes in loose mode regardless of indexing shape", () => {
    // Int32Shape received vs ContiguousShape expected must behave like DoubleShape.
    expect([1, , 3]).toEqual([1, expect.anything(), 3]);
    expect([1.5, , 3.5]).toEqual([1.5, expect.anything(), 3.5]);
    // Strict mode rejects hole vs any value before the matcher runs.
    expect([, 1]).not.toStrictEqual([expect.anything(), 1]);
  });

  it("strict mode still distinguishes class names when prototypes match", () => {
    class Foo {}
    class Bar {}
    // Foo.prototype and Bar.prototype share a Structure and a [[Prototype]].
    expect(Bun.deepEquals(Foo.prototype, Bar.prototype, true)).toBe(false);

    const a = new Foo();
    const b = new Foo();
    Object.defineProperty(b, "constructor", { value: class Baz {}, enumerable: false });
    expect(Bun.deepEquals(a, b, true)).toBe(false);

    const x = {};
    const y = {};
    Object.defineProperty(y, Symbol.toStringTag, { value: "Tagged", enumerable: false });
    expect(Bun.deepEquals(x, y, true)).toBe(false);

    // Enumerable own `constructor` holding distinct native constructors: the
    // property walk deep-compares values, which is not equivalent to `.name`.
    expect(Bun.deepEquals({ constructor: Array }, { constructor: Object }, true)).toBe(false);
    expect(Bun.deepEquals({ constructor: Map }, { constructor: Set }, true)).toBe(false);
  });

  it("a self-referential asymmetric matcher throws RangeError instead of crashing", () => {
    const arr: any[] = [];
    const m = expect.arrayContaining(arr);
    arr.push(m);
    const x: any[] = [];
    x.push(x);
    expect(() => expect(x).toEqual(m)).toThrow(RangeError);
  });

  it("large Int32 array comparison is fast", () => {
    const n = 100_000;
    const a = Array.from({ length: n }, (_, i) => i);
    const b = Array.from({ length: n }, (_, i) => i);
    const t0 = Bun.nanoseconds();
    const iters = 50;
    for (let i = 0; i < iters; i++) {
      if (!Bun.deepEquals(a, b)) throw new Error("expected equal");
    }
    const elapsed = (Bun.nanoseconds() - t0) / 1e6;
    // With the Int32Shape memcmp path this runs in ~1.8ms release / ~2.5ms debug+ASAN.
    // Without it (pre-#35387 per-element recursion) the same 50 iterations cost
    // ~62ms release / ~3000ms debug+ASAN, so the bound below is the regression guard.
    expect(elapsed).toBeLessThan(40);
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
