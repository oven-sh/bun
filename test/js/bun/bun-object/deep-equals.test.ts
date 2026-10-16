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

// The native comparison visits a pair of one internal type once. So each of these pairs must get its answer in both argument orders from that one visit.
describe("pairs of one internal type that are unequal in both argument orders", () => {
  const deepEquals = Bun.deepEquals as (a: unknown, b: unknown, strict?: boolean, skipPrototype?: boolean) => boolean;
  const passes = (assertion: () => void) => {
    try {
      assertion();
      return true;
    } catch {
      return false;
    }
  };
  const entryPoints: [string, (a: unknown, b: unknown) => boolean][] = [
    ["Bun.deepEquals", (a, b) => deepEquals(a, b)],
    ["Bun.deepEquals strict", (a, b) => deepEquals(a, b, true)],
    ["Bun.deepEquals strict, skipPrototype", (a, b) => deepEquals(a, b, true, true)],
    // The negated matcher passes for an unequal pair, so it prints no diff of the two values.
    ["expect().toEqual", (a, b) => !passes(() => expect(a).not.toEqual(b))],
    ["expect().toStrictEqual", (a, b) => !passes(() => expect(a).not.toStrictEqual(b))],
    ["util.isDeepStrictEqual", (a, b) => util.isDeepStrictEqual(a, b)],
    ["util.isDeepStrictEqual, skipPrototype", (a, b) => util.isDeepStrictEqual(a, b, true as any)],
  ];
  const pairs: [string, () => unknown, () => unknown][] = [
    [
      "URLSearchParams with a repeated name",
      () => new URLSearchParams("a=1&a=1"),
      () => new URLSearchParams("a=1&a=2"),
    ],
    [
      "Headers with a repeated name",
      () =>
        new Headers([
          ["set-cookie", "a"],
          ["set-cookie", "a"],
        ]),
      () =>
        new Headers([
          ["set-cookie", "a"],
          ["x", "1"],
        ]),
    ],
    ["Reflect and a boxed Symbol", () => Reflect, () => Object(Symbol.iterator)],
    ["Math and a boxed BigInt", () => Math, () => Object(1n)],
    ["boxed BigInts with different values", () => Object(1n), () => Object(2n)],
    [
      "the main global and a vm global that holds its enumerable properties",
      () => globalThis,
      () => vm.runInContext("this", vm.createContext({ ...globalThis })),
    ],
  ];
  describe.each(entryPoints)("%s", (_, equal) => {
    it.each(pairs)("%s", (_, a, b) => {
      expect([equal(a(), b()), equal(b(), a())]).toEqual([false, false]);
    });
  });
});

// Each row reads a leaf getter under 10 nested collections. A second comparison of a level doubles the count.
describe("reads a value under nested Sets and Maps once per side", () => {
  const deepEquals = Bun.deepEquals as (a: unknown, b: unknown, strict?: boolean, skipPrototype?: boolean) => boolean;
  let reads = 0;
  const nested = (wrap: (value: unknown) => unknown) => {
    let value: unknown = {
      get value() {
        reads++;
        return 1;
      },
    };
    for (let depth = 0; depth < 10; depth++) value = wrap(value);
    return value;
  };
  const sharedKey = { id: 1 };
  class Tagged extends Map {
    tag = 1;
  }
  const wraps: [string, (value: unknown) => unknown][] = [
    ["a string key", value => new Map([["k", value]])],
    ["one object member of a Set", value => new Set([value])],
    ["one object key that only one side holds", value => new Map([[{ id: 1 }, value]])],
    ["an object key that both sides hold", value => new Map([[sharedKey, value]])],
    ["a subclass with a field", value => new Tagged([["k", value]])],
    ["an own string property", value => Object.assign(new Map([["k", value]]), { x: 1 })],
    ["a Set member beside a number", value => new Set([value, 1])],
  ];
  it.each([
    ["Bun.deepEquals", (a: unknown, b: unknown) => deepEquals(a, b)],
    ["Bun.deepEquals strict", (a: unknown, b: unknown) => deepEquals(a, b, true)],
    ["Bun.deepEquals strict, skipPrototype", (a: unknown, b: unknown) => deepEquals(a, b, true, true)],
    ["expect().toEqual", (a: unknown, b: unknown) => expect(a).toEqual(b)],
    ["expect().toStrictEqual", (a: unknown, b: unknown) => expect(a).toStrictEqual(b)],
    ["assert.deepEqual", (a: unknown, b: unknown) => assert.deepEqual(a, b)],
  ])("%s", (_, compare) => {
    const wrong: string[] = [];
    for (const [name, wrap] of wraps) {
      const a = nested(wrap);
      const b = nested(wrap);
      reads = 0;
      compare(a, b);
      if (reads !== 2) wrong.push(`${name}: ${reads} reads`);
    }
    expect(wrong).toEqual([]);
  });
});

// A pair of one internal type is compared once, and not once per argument order. The boxed String comparison calls a
// user `toString` before the own properties are compared, so the calls count the comparisons.
describe("a boxed String with an own property is converted once per side", () => {
  const deepEquals = Bun.deepEquals as (a: unknown, b: unknown, strict?: boolean, skipPrototype?: boolean) => boolean;
  it.each([
    ["Bun.deepEquals strict", (a: unknown, b: unknown) => deepEquals(a, b, true)],
    ["Bun.deepEquals strict, skipPrototype", (a: unknown, b: unknown) => deepEquals(a, b, true, true)],
    ["expect().toStrictEqual", (a: unknown, b: unknown) => expect(a).toStrictEqual(b)],
    // node reads the string of both operands and does not call `toString`.
    ["util.isDeepStrictEqual", (a: unknown, b: unknown) => util.isDeepStrictEqual(a, b)],
    ["util.isDeepStrictEqual, skipPrototype", (a: unknown, b: unknown) => util.isDeepStrictEqual(a, b, true as any)],
  ])("%s", (_, compare) => {
    let calls = 0;
    const toString = function () {
      calls++;
      return "a";
    };
    const boxed = () => Object.assign(new String("a"), { toString });
    compare(boxed(), boxed());
    expect(calls).toBe(2);
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
