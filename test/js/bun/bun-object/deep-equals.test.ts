import { bunEnv, bunExe, isASAN, isWindows } from "harness";
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

// The object fast path settles primitive values while it walks the keys, and
// collects objects and unresolved ropes to compare after the walk. These
// objects hold more of both than the collecting buffer has inline slots.
describe.each([true, false])("objects with many keys (strict: %p)", strict => {
  // `reverse` inserts the keys in the opposite order, which gives the object a
  // different Structure and takes the mixed-structure walk.
  function wide(value: unknown, reverse = false) {
    const keys = Array.from({ length: 50 }, (_, i) => "k" + i);
    if (reverse) keys.reverse();
    const o: Record<string, unknown> = {};
    for (const key of keys) o[key] = key === "k25" ? value : key.endsWith("3") ? { key } : key;
    return o;
  }
  // Non-literal strings, so the two sides never share a JSString cell.
  const fresh = (s: string) => s.split("").join("");
  const rope = (a: string, b: string) => fresh(a) + fresh(b);
  const shared = Symbol("shared");

  const equal: [string, () => unknown, () => unknown][] = [
    ["numbers", () => 1.5, () => 1.5],
    ["NaN", () => NaN, () => 0 / 0],
    ["strings", () => fresh("abc"), () => fresh("abc")],
    ["a rope and a string", () => rope("ab", "c"), () => fresh("abc")],
    ["two ropes", () => rope("ab", "c"), () => rope("a", "bc")],
    ["16-bit strings", () => fresh("abc\u1234"), () => rope("abc", "\u1234")],
    ["bigints", () => 10n ** 30n, () => 10n ** 30n],
    ["the same symbol", () => shared, () => shared],
    ["null", () => null, () => null],
    ["undefined", () => undefined, () => undefined],
    ["booleans", () => true, () => true],
    ["nested objects", () => ({ a: [1, { b: 2 }] }), () => ({ a: [1, { b: 2 }] })],
  ];
  const unequal: [string, () => unknown, () => unknown][] = [
    ["numbers", () => 1, () => 2],
    ["0 and -0", () => 0, () => -0],
    ["strings", () => fresh("abc"), () => fresh("abd")],
    ["a rope and a string", () => rope("ab", "c"), () => fresh("abd")],
    ["two ropes", () => rope("ab", "c"), () => rope("ab", "d")],
    ["bigints", () => 10n ** 30n, () => 10n ** 30n + 1n],
    ["symbols with the same description", () => Symbol("a"), () => Symbol("a")],
    ["null and undefined", () => null, () => undefined],
    ["a number and a numeric string", () => 1, () => "1"],
    ["a number and a Number object", () => 1, () => new Number(1)],
    ["a string and a String object", () => fresh("abc"), () => new String("abc")],
    ["a string and an object", () => fresh("abc"), () => ({})],
    ["nested objects", () => ({ a: [1, { b: 2 }] }), () => ({ a: [1, { b: 3 }] })],
  ];

  describe.each([false, true])("other side inserted in reverse: %p", reverse => {
    it.each(equal)("equal %s", (_, left, right) => {
      expect(Bun.deepEquals(wide(left()), wide(right(), reverse), strict)).toBe(true);
      expect(Bun.deepEquals(wide(right(), reverse), wide(left()), strict)).toBe(true);
    });

    it.each(unequal)("unequal %s", (_, left, right) => {
      expect(Bun.deepEquals(wide(left()), wide(right(), reverse), strict)).toBe(false);
      expect(Bun.deepEquals(wide(right(), reverse), wide(left()), strict)).toBe(false);
    });

    it("a key that only one side has", () => {
      const more = wide(1, reverse);
      more.extra = 1;
      expect(Bun.deepEquals(wide(1), more, strict)).toBe(false);
      expect(Bun.deepEquals(more, wide(1), strict)).toBe(false);
    });
  });

  it("asymmetric matchers against primitive values", () => {
    const matchers = wide(expect.any(Number));
    matchers.k1 = expect.stringContaining("k");
    matchers.k13 = expect.objectContaining({ key: "k13" });
    expect(wide(1)).toEqual(matchers);
    expect(wide("1")).not.toEqual(matchers);
  });

  // What runs before a mismatch is observable through getters. node and jest
  // compare the values in key order, and so does the fast path.
  describe("order of comparisons", () => {
    // k3 comes before k30, k43 comes after it.
    function probed(log: string[], k30: unknown, reverse = false) {
      const probe = (name: string) => ({
        get x() {
          log.push(name);
          return 1;
        },
      });
      const o = wide(0, reverse);
      o.k3 = probe("k3");
      o.k30 = k30;
      o.k43 = probe("k43");
      return o;
    }

    it.each([false, true])(
      "nested objects before unequal primitives are compared, later ones are not (other side in reverse: %p)",
      reverse => {
        const log: string[] = [];
        expect(Bun.deepEquals(probed(log, 1), probed(log, 2, reverse), strict)).toBe(false);
        expect(log).toEqual(["k3", "k3"]);
      },
    );

    it("the key order of the first argument decides", () => {
      const log: string[] = [];
      expect(Bun.deepEquals(probed(log, 1, true), probed(log, 2), strict)).toBe(false);
      expect(log).toEqual(["k43", "k43"]);
    });

    it("an error thrown from an earlier property wins over a later mismatch", () => {
      const make = (k30: number) => {
        const o = wide(0);
        o.k3 = {
          get x() {
            throw new Error("from the getter");
          },
        };
        o.k30 = k30;
        return o;
      };
      expect(() => Bun.deepEquals(make(1), make(2), strict)).toThrow("from the getter");
    });

    it("a key that only one side has is reported before any nested object is compared", () => {
      const log: string[] = [];
      const more = probed(log, 1, true);
      more.extra = 1;
      expect(Bun.deepEquals(probed(log, 1), more, strict)).toBe(false);
      expect(Bun.deepEquals(more, probed(log, 1), strict)).toBe(false);
      expect(log).toEqual([]);
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
        // Every frame keeps its collected pairs on one shared buffer. The nested
        // frames grow (and reallocate) it while the outer frames still read theirs.
        const tree = depth => {
          const o = {};
          for (let i = 0; i < 6; i++) o['n' + i] = depth ? tree(depth - 1) : { leaf: i };
          return o;
        };
        console.log('shared pair buffer growth:', Bun.deepEquals(tree(3), tree(3), true));
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
        "shared pair buffer growth: true",
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
