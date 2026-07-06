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

  describe("arrays with non-index own properties", () => {
    it("distinguishes differing string-keyed properties", () => {
      const a = Object.assign([1, 2], { x: 3 });
      const b = Object.assign([1, 2], { x: 4 });
      expect(deepEquals(a, b)).toBe(false);
      expect(deepEquals(b, a)).toBe(false);
    });

    it("distinguishes an extra string-keyed property on one side", () => {
      const a = Object.assign([1, 2], { x: 3 });
      const b = [1, 2];
      expect(deepEquals(a, b)).toBe(false);
      expect(deepEquals(b, a)).toBe(false);
    });

    it("matches when the extra properties are equal", () => {
      const a = Object.assign([1, 2], { x: 3 });
      const b = Object.assign([1, 2], { x: 3 });
      expect(deepEquals(a, b)).toBe(true);
      expect(deepEquals(b, a)).toBe(true);
    });

    it("matches plain arrays without extra properties", () => {
      expect(deepEquals([1, 2, 3], [1, 2, 3])).toBe(true);
    });

    it("ignores non-enumerable extra properties", () => {
      const a = [1, 2];
      Object.defineProperty(a, "count", { value: 2, enumerable: false, writable: true });
      expect(deepEquals(a, [1, 2])).toBe(true);
      expect(deepEquals([1, 2], a)).toBe(true);
    });

    it("a non-enumerable own property does not satisfy an enumerable one of the same name", () => {
      const a = [1, 2];
      Object.defineProperty(a, "x", { value: 999, enumerable: false });
      const b = Object.assign([1, 2], { x: 5 });
      expect(deepEquals(a, b)).toBe(false);
      expect(deepEquals(b, a)).toBe(false);

      // even with the same value: jest only sees enumerable own keys
      const c = [1, 2];
      Object.defineProperty(c, "x", { value: 5, enumerable: false });
      expect(deepEquals(c, b)).toBe(false);
      expect(deepEquals(b, c)).toBe(false);
    });

    it("does not treat inherited Array.prototype members as own properties", () => {
      const a = Object.assign([1, 2], { map: 5 });
      expect(deepEquals(a, [1, 2])).toBe(false);
      expect(deepEquals([1, 2], a)).toBe(false);

      const b = Object.assign([1, 2], { constructor: Array });
      expect(deepEquals(b, [1, 2])).toBe(false);
      expect(deepEquals([1, 2], b)).toBe(false);
    });

    it("distinguishes an extra property regardless of insertion order", () => {
      const a = Object.assign([1, 2], { x: 3 });
      const b = Object.assign([1, 2], { y: 99, x: 3 });
      expect(deepEquals(a, b)).toBe(false);
      expect(deepEquals(b, a)).toBe(false);
    });

    if (strict) {
      it("distinguishes an undefined-valued extra property in strict mode", () => {
        const a = Object.assign([1, 2], { x: undefined });
        const b = [1, 2];
        expect(deepEquals(a, b)).toBe(false);
        expect(deepEquals(b, a)).toBe(false);
      });
    } else {
      it("treats an undefined-valued extra property as absent in loose mode", () => {
        const a = Object.assign([1, 2], { x: undefined });
        const b = [1, 2];
        expect(deepEquals(a, b)).toBe(true);
        expect(deepEquals(b, a)).toBe(true);
      });
    }
  });

  // Bun.deepEquals backs node's assert, so the default mode compares float
  // elements with == and the strict mode compares the raw bytes. expect()'s
  // toEqual uses Object.is instead; that is covered in expect.test.js.
  describe("float typed arrays", () => {
    it.each([Float16Array, Float32Array, Float64Array])("%p: -0 and +0", ctor => {
      expect(deepEquals(new ctor([-0]), new ctor([0]))).toBe(!strict);
      expect(deepEquals(new ctor([0]), new ctor([-0]))).toBe(!strict);
    });

    it.each([Float16Array, Float32Array, Float64Array])("%p: NaN", ctor => {
      expect(deepEquals(new ctor([NaN]), new ctor([NaN]))).toBe(strict);
      expect(deepEquals(new ctor([NaN]), new ctor([1]))).toBe(false);
    });

    it.each([Float16Array, Float32Array, Float64Array])("%p: ordinary values still compare", ctor => {
      expect(deepEquals(new ctor([1.5, 2.5, 3.5]), new ctor([1.5, 2.5, 3.5]))).toBe(true);
      expect(deepEquals(new ctor([1.5, 2.5, 3.5]), new ctor([1.5, 2.5, 4.5]))).toBe(false);
    });
  });

  describe("boxed String objects", () => {
    it("distinguishes differing own properties", () => {
      const a = Object.assign(new String("ab"), { e: 1 });
      const b = Object.assign(new String("ab"), { e: 2 });
      expect(deepEquals(a, b)).toBe(false);
      expect(deepEquals(b, a)).toBe(false);
    });

    it("distinguishes an extra own property on one side", () => {
      const a = Object.assign(new String("ab"), { e: 1 });
      const b = new String("ab");
      expect(deepEquals(a, b)).toBe(false);
      expect(deepEquals(b, a)).toBe(false);
    });

    it("matches when the extra properties are equal", () => {
      const a = Object.assign(new String("ab"), { e: 1 });
      const b = Object.assign(new String("ab"), { e: 1 });
      expect(deepEquals(a, b)).toBe(true);
      expect(deepEquals(b, a)).toBe(true);
    });

    it("matches plain String wrappers", () => {
      expect(deepEquals(new String("ab"), new String("ab"))).toBe(true);
      expect(deepEquals(new String("ab"), new String("cd"))).toBe(false);
    });

    it("distinguishes an extra property regardless of insertion order", () => {
      const a = Object.assign(new String("ab"), { x: undefined });
      const b = Object.assign(new String("ab"), { y: 99, x: undefined });
      expect(deepEquals(a, b)).toBe(false);
      expect(deepEquals(b, a)).toBe(false);
    });

    it("compares the boxed value, not a user-defined toString", () => {
      const a = Object.defineProperty(new String("ab"), "toString", {
        value: () => "XX",
        enumerable: false,
      });
      const b = new String("ab");
      expect(deepEquals(a, b)).toBe(true);
      expect(deepEquals(b, a)).toBe(true);
    });
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
  it("distinguishes a null-prototype object from an object literal", () => {
    expect(Bun.deepEquals(Object.create(null), {}, true)).toBe(false);

    const a = Object.assign(Object.create(null), { a: 1 });
    const b = { a: 1 };
    expect(Bun.deepEquals(a, b, true)).toBe(false);
    expect(Bun.deepEquals(b, a, true)).toBe(false);
  });

  it("treats a null-prototype object as equal to an object literal when not strict", () => {
    const a = Object.assign(Object.create(null), { a: 1 });
    const b = { a: 1 };
    expect(Bun.deepEquals(a, b, false)).toBe(true);
    expect(Bun.deepEquals(b, a, false)).toBe(true);
  });

  it("compares two null-prototype objects in strict mode", () => {
    const a = Object.assign(Object.create(null), { a: 1 });
    const b = Object.assign(Object.create(null), { a: 1 });
    expect(Bun.deepEquals(a, b, true)).toBe(true);
    expect(Bun.deepEquals(b, a, true)).toBe(true);
  });
});
