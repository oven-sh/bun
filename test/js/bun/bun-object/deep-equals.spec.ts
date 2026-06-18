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

// https://github.com/oven-sh/bun/issues/32485
// Frozen objects (and Errors) are not fast-property-enumerable, so they take
// deepEquals' slow path. A non-strict comparison there used to flag an extra
// `undefined` key as a difference when that key was not last in enumeration
// order, because the slow path matched the other object's extra keys by
// positional index rather than by name.
describe("undefined properties on slow-path objects (#32485)", () => {
  it("non-strict deepEquals ignores interleaved undefined keys on frozen objects", () => {
    expect(Bun.deepEquals(Object.freeze({ a: 1, b: undefined, c: 3 }), Object.freeze({ a: 1, c: 3 }))).toBe(true);
    expect(Bun.deepEquals(Object.freeze({ a: 1, c: 3 }), Object.freeze({ a: 1, b: undefined, c: 3 }))).toBe(true);
    expect(Bun.deepEquals(Object.freeze({ a: 1, b: undefined }), Object.freeze({ a: 1 }))).toBe(true);
    expect(Bun.deepEquals(Object.freeze({ a: 1 }), Object.freeze({ a: 1, b: undefined }))).toBe(true);

    // Nested object, outer frozen (the originally reported shape).
    expect(
      Bun.deepEquals(
        Object.freeze({ a: 1, b: undefined, nested: { d: 1, e: undefined } }),
        Object.freeze({ a: 1, nested: { d: 1 } }),
      ),
    ).toBe(true);
    // Inner object also frozen: the slow path recurses into itself.
    expect(
      Bun.deepEquals(
        Object.freeze({ a: 1, b: undefined, nested: Object.freeze({ d: 1, e: undefined }) }),
        Object.freeze({ a: 1, nested: Object.freeze({ d: 1 }) }),
      ),
    ).toBe(true);
  });

  it("non-strict deepEquals still reports genuinely different frozen objects", () => {
    expect(Bun.deepEquals(Object.freeze({ a: 1, b: 2, c: 3 }), Object.freeze({ a: 1, c: 3 }))).toBe(false);
    expect(Bun.deepEquals(Object.freeze({ a: 1, c: 3 }), Object.freeze({ a: 1, b: 2, c: 3 }))).toBe(false);
    expect(Bun.deepEquals(Object.freeze({ a: 1, b: null, c: 3 }), Object.freeze({ a: 1, c: 3 }))).toBe(false);
    expect(Bun.deepEquals(Object.freeze({ a: 1, b: undefined, c: 3 }), Object.freeze({ a: 1, c: 4 }))).toBe(false);
  });

  it("strict deepEquals does not ignore undefined keys on frozen objects", () => {
    expect(Bun.deepEquals(Object.freeze({ a: 1, c: 3 }), Object.freeze({ a: 1, c: 3 }), true)).toBe(true);
    expect(
      Bun.deepEquals(Object.freeze({ a: 1, b: undefined, c: 3 }), Object.freeze({ a: 1, b: undefined, c: 3 }), true),
    ).toBe(true);
    expect(Bun.deepEquals(Object.freeze({ a: 1, b: undefined, c: 3 }), Object.freeze({ a: 1, c: 3 }), true)).toBe(
      false,
    );
    expect(Bun.deepEquals(Object.freeze({ a: 1, c: 3 }), Object.freeze({ a: 1, b: undefined, c: 3 }), true)).toBe(
      false,
    );
  });

  it("non-strict deepEquals ignores interleaved undefined keys on Error objects", () => {
    const withExtra = () => {
      const e = new Error("boom") as Error & { extra?: unknown; code?: string };
      e.extra = undefined;
      e.code = "E";
      return e;
    };
    const withoutExtra = () => {
      const e = new Error("boom") as Error & { code?: string };
      e.code = "E";
      return e;
    };
    expect(Bun.deepEquals(withoutExtra(), withExtra())).toBe(true);
    expect(Bun.deepEquals(withExtra(), withoutExtra())).toBe(true);

    const withDefinedExtra = new Error("boom") as Error & { extra?: unknown; code?: string };
    withDefinedExtra.extra = 1;
    withDefinedExtra.code = "E";
    expect(Bun.deepEquals(withoutExtra(), withDefinedExtra)).toBe(false);
  });

  // The matcher surface from the issue. expect.arrayContaining compares with the
  // (smaller) expected object as the left operand, which is what triggered it.
  it("expect().toEqual and expect.arrayContaining ignore interleaved undefined keys", () => {
    expect([Object.freeze({ a: 1, b: undefined, c: 3 })]).toEqual(
      expect.arrayContaining([Object.freeze({ a: 1, c: 3 })]),
    );
    expect([Object.freeze({ a: 1, b: undefined, nested: { d: 1, e: undefined } })]).toEqual(
      expect.arrayContaining([Object.freeze({ a: 1, nested: { d: 1 } })]),
    );
    expect(Object.freeze({ a: 1, c: 3 })).toEqual(Object.freeze({ a: 1, b: undefined, c: 3 }));
  });
});
