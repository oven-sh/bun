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

  // Two Headers or two URLSearchParams are compared by their entries, as Bun.deepEquals compares them.
  describe("Headers and URLSearchParams patterns", () => {
    type Row = [name: string, pattern: object, value: object];
    type Entries = [name: string, value: string][];
    const headers = (init: Record<string, string> = {}) => new Headers(init);
    const params = (query: string) => new URLSearchParams(query);
    const cookies = (...values: string[]) => {
      const result = new Headers({ "content-type": "text/plain" });
      for (const value of values) result.append("set-cookie", value);
      return result;
    };
    const withExtra = (value: object, extra = 1) => Object.assign(value, { extra });
    const formData = (value: string) => {
      const result = new FormData();
      result.append("a", value);
      return result;
    };

    it.each<Row>([
      ["Headers in a property", { headers: cookies("a=1", "b=2") }, { headers: cookies("a=1", "b=2"), status: 200 }],
      ["URLSearchParams in a property", { query: params("tag=a&tag=b") }, { query: params("tag=a&tag=b"), path: "/" }],
      ["Headers in an array", [headers({ a: "1", b: "2" })], [headers({ B: "2", A: "1" })]],
      ["the same own property", withExtra(headers({ a: "1" })), withExtra(headers({ a: "1" }))],
    ])("matches: %s", (_, pattern, value) => {
      expect(Bun.deepMatch(pattern, value)).toBe(true);
    });

    it.each<Row>([
      ["Headers with another value", headers({ a: "1" }), headers({ a: "2" })],
      ["URLSearchParams with another value", params("a=1"), params("a=2")],
      ["Headers in a property", { headers: headers({ a: "1" }) }, { headers: headers({ a: "2" }), status: 200 }],
      ["URLSearchParams in a property", { query: params("a=1") }, { query: params("a=2"), path: "/" }],
      ["Headers in an array", [headers({ a: "1" })], [headers({ a: "2" })]],
      // The names that the pattern inherits reject the next three pairs, not the entries.
      ["a Headers pattern and URLSearchParams", headers({ a: "1" }), params("a=1")],
      ["a URLSearchParams pattern and Headers", params("a=1"), headers({ a: "1" })],
      ["a Headers pattern and FormData", headers({ a: "1" }), formData("1")],
      ["an own property on the pattern only", withExtra(headers({ a: "1" })), headers({ a: "1" })],
      ["the same own property and other entries", withExtra(headers({ a: "1" })), withExtra(headers({ a: "2" }))],
    ])("does not match: %s", (_, pattern, value) => {
      expect(Bun.deepMatch(pattern, value)).toBe(false);
    });

    if (typeof Bun.version === "string") {
      // In Jest the own properties of two iterables must be equal.
      it.each<Row>([
        ["an own property on the value only", headers({ a: "1" }), withExtra(headers({ a: "1" }))],
        ["Headers that hold a name without a value", Response.redirect("").headers, Response.redirect("").headers],
      ])("matches: %s", (_, pattern, value) => {
        expect(Bun.deepMatch(pattern, value)).toBe(true);
      });

      it.each<Row>([
        ["a name without a value and another name", Response.redirect("").headers, headers({ "content-type": "a" })],
        ["a URLSearchParams pattern and Bun.CookieMap", params("a=1"), new Bun.CookieMap("a=1")],
      ])("does not match: %s", (_, pattern, value) => {
        expect(Bun.deepMatch(pattern, value)).toBe(false);
      });

      // Each list of at most `length` entries, in the order of append().
      const lists = (names: string[], values: string[], length: number) => {
        const entries = names.flatMap(name => values.map((value): Entries[number] => [name, value]));
        let longest: Entries[] = [[]];
        const all = [...longest];
        for (let i = 0; i < length; i++) {
          longest = longest.flatMap(list => entries.map(entry => [...list, entry]));
          all.push(...longest);
        }
        return all;
      };
      const appended = (entries: Entries) => {
        const result = new Headers();
        for (const [name, value] of entries) result.append(name, value);
        return result;
      };

      it.each<[name: string, all: Entries[], build: (entries: Entries) => object]>([
        ["URLSearchParams", lists(["a", "b"], ["1", "2"], 3), entries => new URLSearchParams(entries)],
        ["Headers", lists(["accept", "x-a", "set-cookie"], ["1", "2"], 2), appended],
      ])("gives the answer of Bun.deepEquals for each pair of %s", (_, all, build) => {
        const patterns = all.map(build);
        const values = all.map(build);
        const disagreements: [pattern: Entries, value: Entries][] = [];
        let matches = 0;
        for (let i = 0; i < patterns.length; i++) {
          for (let j = 0; j < values.length; j++) {
            const matched = Bun.deepMatch(patterns[i], values[j]);
            if (matched) matches++;
            if (matched !== Bun.deepEquals(patterns[i], values[j])) disagreements.push([all[i], all[j]]);
          }
        }
        expect(disagreements).toEqual([]);
        // Each list matches its copy, and most pairs do not match.
        expect(matches).toBeGreaterThanOrEqual(all.length);
        expect(matches).toBeLessThan((all.length * all.length) / 4);
      });

      // Neither function compares the entries of these two classes yet. When one of them starts, the other must follow.
      it.each<Row>([
        ["FormData", formData("1"), formData("2")],
        ["Bun.CookieMap", new Bun.CookieMap("a=1"), new Bun.CookieMap("a=2")],
      ])("gives the answer of Bun.deepEquals for two %s with other entries", (_, pattern, value) => {
        expect(Bun.deepMatch(pattern, value)).toBe(Bun.deepEquals(pattern, value));
      });
    }
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
