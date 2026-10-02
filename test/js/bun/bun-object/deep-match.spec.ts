type TestCase = [a: unknown, b: unknown];

// @ts-ignore
if (typeof Bun === "undefined")
  [
    // @ts-ignore
    (globalThis.Bun = {
      deepMatch(a, b) {
        try {
          expect(b).toMatchObject(a);
          return true;
        } catch (e) {
          if (e instanceof TypeError) throw e;
          return false;
        }
      },
    }),
  ];
describe("Bun.deepMatch", () => {
  it.each<TestCase>([
    // force line break
    {},
    { a: 1 },
    [[1, 2, 3]],
  ] as TestCase[])("returns `true` for referentially equal objects (%p)", obj => {
    expect(Bun.deepMatch(obj, obj)).toBe(true);
    // expect(Bun.deepMatch(obj, obj)).toBe(true);
  });

  // prettier-ignore
  it.each([
    // POJOs
    [{}, {}],
    [{ a: 1 }, { a: 1 }],
    [{ a: Symbol.for("foo") }, { a: Symbol.for("foo") }],
    [
      { a: { b: "foo" }, c: true },
      { a: { b: "foo" }, c: true },
    ],
    [
      { a: [{ b: [] }, "foo", 0, null] },
      { a: [{ b: [] }, "foo", 0, null] }
    ],
    [{ }, { a: undefined }], // NOTE: `b` may be a superset of `a`, but not vice-versa
    [{ a: { b: "foo" } }, { a: { b: "foo", c: undefined } }],
    [{ a: { b: "foo" } }, { a: { b: "foo", c: 1 } }],

    // Arrays
    [[], []],
    [
      [1, 2, 3],
      [1, 2, 3],
    ],
    [
      [{}, "foo", 1],
      [{}, "foo", 1],
    ],

    // Maps
    [new Map(), new Map()],
    [
      new Map<number, number>([ [1, 2], [2, 3], [3, 4] ]),
      new Map<number, number>([ [1, 2], [2, 3], [3, 4] ]),
    ],
    [
      new Map([ ["foo", 1] ]),
      new Map([ ["foo", 1] ]),
    ],

    // Sets
    [new Set(), new Set()],
    [
      new Set([1, 2, 3]),
      new Set([1, 2, 3]),
    ],
    [
      new Set(["a", "b", "c"]),
      new Set(["a", "b", "c"]),
    ],
    // values inside a Map are still matched as a subset
    [new Map([["a", { b: 1 }]]), new Map([["a", { b: 1, c: 2 }]])],

    // Dates, Errors, RegExps and boxed primitives
    [new Date(1), new Date(1)],
    [{ d: new Date(1) }, { d: new Date(1) }],
    [{ d: [new Date(1)] }, { d: [new Date(1)] }],
    [new Error("a"), new Error("a")],
    [{ e: new Error("a") }, { e: new Error("a", { cause: 1 }) }],
    [{ e: new Error("a", { cause: { x: 1 } }) }, { e: new Error("a", { cause: { x: 1, y: 2 } }) }],
    [{ e: new Error("a") }, { e: Object.assign(new Error("a"), { code: 1 }) }],
    [{ r: /a/g }, { r: /a/g }],
    [{ n: new Number(1) }, { n: new Number(1) }],
    // a plain object in the subset matches the properties of any object
    [{ message: "a" }, new Error("a")],
    [{ e: { message: "a" } }, { e: new Error("a") }],
    [{ d: {} }, { d: new Date() }],
    [{ m: {} }, { m: new Map() }],
  ])("Bun.deepMatch(%p, %p) === true", (a, b) => {
    expect(Bun.deepMatch(a, b)).toBe(true);
  });

  // prettier-ignore
  it.each<TestCase>([
    // POJOs
    [{ a: undefined }, { }], // NOTE: `a` may not be a superset of `b`
    [{ a: 1 }, { a: 2 }],
    [{ a: 1 }, { b: 1 }],
    [{ a: null }, { a: undefined }],
    [{ a: { b: "foo" } }, { a: { b: "bar"} }],
    [{ a: { b: "foo", c: 1 } }, { a: { b: "foo" } }],
    [{ a: Symbol.for("a") }, { a: Symbol.for("b") }],
    [{ a: Symbol("a") }, { a: Symbol("a") }], // new symbols are never equal

    // Arrays
    [[1, 2, 3], [1, 2]],
    [[1, 2, 3], [1, 2, 4]],
    [[null], [undefined]],
    [[], [undefined]],
    [["a", "b", "c"], ["a", "b", "d"]],

    // Maps and Sets are compared by their entries, like `expect().toMatchObject()` in jest
    [
      new Map<number, number>([ [1, 2], [2, 3], [3, 4] ]),
      new Map<number, number>([ [1, 2], [2, 3] ]),
    ],
    [
      new Map<number, number>([ [1, 2], [2, 3], [3, 4] ]),
      new Map<number, number>([ [1, 2], [2, 3], [3, 4], [4, 5] ]),
    ],
    [
      new Map<number, number>([ [1, 2], [2, 3], [3, 4], [4, 5] ]),
      new Map<number, number>([ [1, 2], [2, 3], [3, 4] ]),
    ],
    [{ m: new Map([["a", 1]]) }, { m: new Map([["a", 2]]) }],
    [{ m: new Map() }, { m: {} }],

    // Sets
    [
      new Set([1, 2, 3]),
      new Set([4, 5, 6]),
    ],
    [
      new Set([1, 2, 3]),
      new Set([1, 2]),
    ],
    [
      new Set([1, 2]),
      new Set([1, 2, 3]),
    ],
    [
      new Set(["a", "b", "c"]),
      new Set(["a", "b", "d"]),
    ],
    [{ s: new Set() }, { s: {} }],

    // Dates are compared by their time value, Errors by name, message and cause
    [new Date(1), new Date(2)],
    [{ d: new Date(1) }, { d: new Date(2) }],
    [{ d: new Date() }, { d: {} }],
    [{ d: new Date(1) }, { d: [new Date(1)] }],
    [new Error("a"), new Error("b")],
    [{ e: new Error("a") }, { e: new Error("b") }],
    [{ e: new Error("a") }, { e: new TypeError("a") }],
    [{ e: new Error("a", { cause: 1 }) }, { e: new Error("a", { cause: 2 }) }],
    [{ e: new Error("a", { cause: 1 }) }, { e: new Error("a") }],
    [{ e: new Error("a") }, { e: { message: "b" } }],
    [{ e: new Error("a") }, { e: {} }],

    // Functions match by identity only
    [{ f: () => 1 }, { f: () => 1 }],
    [{ f: () => 1 }, { f: {} }],

    // Boxed primitives and RegExps are compared by their value
    [{ r: /a/ }, { r: /b/ }],
    [{ r: /a/g }, { r: /a/i }],
    [{ n: new Number(1) }, { n: new Number(2) }],
    [{ s: new String("a") }, { s: new String("b") }],
  ])("Bun.deepMatch(%p, %p) === false", (a, b) => {
    expect(Bun.deepMatch(a, b)).toBe(false);
  });

  it("When comparing same-shape objects with different constructors, returns true", () => {
    class Foo {}
    class Bar {}

    expect(Bun.deepMatch(new Foo(), new Bar())).toBe(true);
  });

  describe("When provided objects with circular references", () => {
    let foo: Record<string, unknown>;

    const makeCircular = () => {
      let foo = { bar: undefined as any };
      let bar = { foo: undefined as any };
      foo.bar = bar;
      bar.foo = foo;
      return foo;
    };

    beforeEach(() => {
      foo = makeCircular();
    });

    // a, b are ref equal
    it("when a and b are _exactly_ the same object, returns true", () => {
      expect(Bun.deepMatch(foo, foo)).toBe(true);
    });

    // a, b are not ref equal but their properties are
    it("When a and b are different objects whose properties point to the same object, returns true", () => {
      const foo2 = { ...foo }; // pointer to bar is copied.
      expect(Bun.deepMatch(foo, foo2)).toBe(true);
    });

    // a, b are structurally equal but share no pointers
    it.skip("when a and b are structurally equal but share no pointers, returns true", () => {
      const bar = makeCircular();
      expect(Bun.deepMatch(foo, bar)).toBe(true);
    });

    // a, b are neither ref or structurally equal
    it("when a and b are different, returns false", () => {
      const bar = { bar: undefined } as any;
      bar.bar = bar;
      expect(Bun.deepMatch(foo, bar)).toBe(false);
    });
  });

  describe("array inputs", () => {
    it.each([
      // line break
      [[1, 2, 3], [1, 2, 3], true],
    ] as [any[], any[], boolean][])("Bun.deepMatch(%p, %p) === %p", (a, b, expected) => {
      expect(Bun.deepMatch(a, b)).toBe(expected);
    });
  });

  it("compares functions by identity", () => {
    function foo() {}
    function bar() {}
    function baz(a) {
      return a;
    }
    expect(Bun.deepMatch(foo, foo)).toBe(true);
    expect(Bun.deepMatch(foo, bar)).toBe(false);
    expect(Bun.deepMatch(foo, baz)).toBe(false);
    expect(Bun.deepMatch({ f: foo }, { f: foo })).toBe(true);
    expect(Bun.deepMatch({ f: foo }, { f: bar })).toBe(false);
  });

  it("matches a subset value that appears under several keys", () => {
    const shared = { x: 1 };
    expect(Bun.deepMatch({ a: shared, b: shared }, { a: shared, b: { x: 1 } })).toBe(true);
    expect(Bun.deepMatch({ a: shared, b: shared }, { a: shared, b: { x: 2 } })).toBe(false);
  });

  describe("Invalid arguments", () => {
    it.each<TestCase>([
      [null, null],
      [undefined, undefined],
      [1, 1],
      [true, true],
      [true, false],
      ["a", "a"],
      [Symbol.for("a"), Symbol.for("a")],
      [Symbol("a"), Symbol("a")],
    ])("throws a TypeError for primitives", (a, b) => {
      expect(() => Bun.deepMatch(a, b)).toThrow(TypeError);
    });
  });
});
