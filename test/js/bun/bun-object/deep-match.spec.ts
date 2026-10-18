type TestCase = [a: unknown, b: unknown];

// @ts-ignore
if (typeof Bun === "undefined")
  [
    // @ts-ignore
    (globalThis.Bun = {
      deepMatch(a, b) {
        try {
          expect(b).toMatchObject(a as object);
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

    // Maps
    // FIXME: I assume this is incorrect but I need confirmation on expected behavior.
    // [
    //   new Map<number, number>([ [1, 2], [2, 3], [3, 4] ]),
    //   new Map<number, number>([ [1, 2], [2, 3] ]),
    // ],
    // [
    //   new Map<number, number>([ [1, 2], [2, 3], [3, 4] ]),
    //   new Map<number, number>([ [1, 2], [2, 3], [3, 4], [4, 5] ]),
    // ],
    // [
    //   new Map<number, number>([ [1, 2], [2, 3], [3, 4], [4, 5] ]),
    //   new Map<number, number>([ [1, 2], [2, 3], [3, 4] ]),
    // ],

    // Sets
    // FIXME: I assume this is incorrect but I need confirmation on expected behavior.
    // [
    //   new Set([1, 2, 3]),
    //   new Set([4, 5, 6]),
    // ],
    // [
    //   new Set([1, 2, 3]),
    //   new Set([1, 2]),
    // ],
    // [
    //   new Set([1, 2]),
    //   new Set([1, 2, 3]),
    // ],
    // [
    //   new Set(["a", "b", "c"]),
    //   new Set(["a", "b", "d"]),
    // ],
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
    it("when a and b are structurally equal but share no pointers, returns true", () => {
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

  // https://github.com/oven-sh/bun/issues/45126
  describe("When the same object appears at more than one place", () => {
    const o = { x: 1 };

    it("checks a reused subset object at every place", () => {
      expect(Bun.deepMatch({ a: o, b: o }, { a: { x: 1 }, b: { x: 1 } })).toBe(true);
      expect(Bun.deepMatch({ a: o, b: o }, { a: { x: 1 }, b: { x: 2 } })).toBe(false);
      expect(Bun.deepMatch({ a: o, b: o }, { a: { x: 2 }, b: { x: 1 } })).toBe(false);
      expect(Bun.deepMatch({ a: { q: o }, b: { q: o } }, { a: { q: { x: 1 } }, b: { q: { x: 2 } } })).toBe(false);
      expect(Bun.deepMatch([o, o], [{ x: 1 }, { x: 2 }])).toBe(false);
    });

    it("checks a reused target object at every place", () => {
      expect(Bun.deepMatch({ a: { x: 1 }, b: { x: 1 } }, { a: o, b: o })).toBe(true);
      expect(Bun.deepMatch({ a: { x: 1 }, b: { x: 2 } }, { a: o, b: o })).toBe(false);
      expect(Bun.deepMatch({ a: { q: { x: 1 } }, b: { q: { x: 2 } } }, { a: { q: o }, b: { q: o } })).toBe(false);
      expect(Bun.deepMatch([{ x: 1 }, { x: 2 }], [o, o])).toBe(false);
    });

    it("a real cycle still matches", () => {
      const node = { id: 1 } as any;
      node.self = node;
      const pattern = { id: 1 } as any;
      pattern.self = pattern;
      expect(Bun.deepMatch(pattern, node)).toBe(true);
      expect(Bun.deepMatch({ self: { self: { id: 1 } } }, node)).toBe(true);
      expect(Bun.deepMatch({ self: { self: { id: 2 } } }, node)).toBe(false);
      expect(Bun.deepMatch({ a: pattern, b: pattern }, { a: node, b: node })).toBe(true);
      expect(Bun.deepMatch({ a: pattern, b: pattern }, { a: node, b: { id: 2 } })).toBe(false);
    });

    it("a cyclic subset does not match a finite object", () => {
      const pattern = { id: 1 } as any;
      pattern.self = pattern;
      expect(Bun.deepMatch(pattern, { id: 1, self: { id: 1, self: { id: 1 } } })).toBe(false);
    });

    it("rings of different lengths do not loop forever", () => {
      function ring(length: number) {
        const nodes = Array.from({ length }, (_, i) => ({ id: i % 2, next: undefined as any }));
        for (let i = 0; i < length; i++) nodes[i].next = nodes[(i + 1) % length];
        return nodes[0];
      }
      expect(Bun.deepMatch(ring(4), ring(4))).toBe(true);
      // the subset ring closes on a node that was paired with a different object
      expect(Bun.deepMatch(ring(2), ring(4))).toBe(false);
      expect(Bun.deepMatch(ring(1000), ring(999))).toBe(false);
      // the object ring unrolls into the subset ring
      expect(Bun.deepMatch(ring(4), ring(2))).toBe(true);
    });

    it("a cycle through the pair being compared is a match", () => {
      // base.constructor.prototype is base again, and the same for sub
      const base = { kind: "base" } as any;
      base.constructor = { prototype: base };
      const sub = Object.create(base);
      sub.constructor = { prototype: sub };
      expect(Bun.deepMatch(base, sub)).toBe(true);
      // the pattern cycle reaches sub while base is paired with the outer object
      expect(Bun.deepMatch(base, { kind: "base", constructor: sub.constructor })).toBe(false);
    });

    it("a cyclic subset matches a copy whose cycle starts one level down", () => {
      const node = { id: 1 } as any;
      node.self = node;
      const pattern = { id: 1 } as any;
      pattern.self = pattern;
      expect(Bun.deepMatch(pattern, { ...node })).toBe(true);
      expect(Bun.deepMatch(pattern, { ...node, id: 2 })).toBe(false);
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

  it("does not work on functions", () => {
    function foo() {}
    function bar() {}
    function baz(a) {
      return a;
    }
    expect(Bun.deepMatch(foo, foo)).toBe(true);
    expect(Bun.deepMatch(foo, bar)).toBe(true);
    // FIXME
    // expect(Bun.deepMatch(foo, baz)).toBe(false);
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
