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

  // Own properties added onto a boxed-primitive wrapper object participate in
  // the comparison, consistently across String, Number, and Boolean.
  describe("boxed primitive wrappers", () => {
    it.each([
      ["String", () => new String("ab")],
      ["Number", () => new Number(42)],
      ["Boolean", () => new Boolean(true)],
    ])("extra own properties on a boxed %s are compared", (_name, make) => {
      const tagged = () => Object.assign(make(), { e: 1 });
      expect(deepEquals(tagged(), make())).toBe(false);
      expect(deepEquals(make(), tagged())).toBe(false);
      expect(deepEquals(tagged(), tagged())).toBe(true);
      expect(deepEquals(tagged(), Object.assign(make(), { e: 2 }))).toBe(false);
    });

    it("compares symbol-keyed own properties on a boxed String", () => {
      const a: any = new String("ab");
      a[Symbol.for("deep-equals.tag")] = 1;
      expect(deepEquals(a, new String("ab"))).toBe(false);
      expect(deepEquals(new String("ab"), a)).toBe(false);
    });

    it("boxed Strings without extra own properties still compare by value", () => {
      expect(deepEquals(new String("ab"), new String("ab"))).toBe(true);
      expect(deepEquals(new String("ab"), new String("ac"))).toBe(false);
    });

    it("compares the boxed string value, not toString()", () => {
      const lie = { value: () => "XX" };
      expect(deepEquals(Object.defineProperty(new String("ab"), "toString", lie), new String("ab"))).toBe(true);
      expect(
        deepEquals(Object.defineProperty(new String("XX"), "toString", { value: () => "ab" }), new String("ab")),
      ).toBe(false);
    });

    it("an extra own property whose value is undefined", () => {
      const a = Object.assign(new String("ab"), { e: undefined });
      // undefined matches a missing property only in non-strict mode, the same
      // as plain objects and Number/Boolean wrappers.
      expect(deepEquals(a, new String("ab"))).toBe(!strict);
      expect(deepEquals(new String("ab"), a)).toBe(!strict);
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
