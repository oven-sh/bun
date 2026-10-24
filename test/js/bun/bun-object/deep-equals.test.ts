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

  describe("URLSearchParams", () => {
    it.each([
      ["", ""],
      ["a=1&b=2", "a=1&b=2"],
      ["tag=a&tag=b", "tag=a&tag=b"],
      ["a=1&b=2&a=3", "a=1&b=2&a=3"],
      ["a=1&a", "a=1&a="],
      // The order does not count if no name holds two different values.
      ["a=1&b=2", "b=2&a=1"],
      ["x=0&a=1&b=2", "x=0&b=2&a=1"],
      ["a=1&b=2&a=1", "b=2&a=1&a=1"],
    ])("%p equals %p", (a, b) => {
      expect(deepEquals(new URLSearchParams(a), new URLSearchParams(b))).toBe(true);
      expect(deepEquals(new URLSearchParams(b), new URLSearchParams(a))).toBe(true);
    });

    it.each([
      ["a=1", "a=2"],
      ["a=1", "b=1"],
      ["a=1&a=2", "a=1&a=3"],
      ["a=1&a=2", "a=2&a=1"],
      ["a=1&a=2", "a=1"],
      ["a=1&a=1", "a=1"],
      // The two have the same size, and get() returns the same value for each name.
      ["a=1&a=1&b=2", "a=1&b=2&b=2"],
      ["a=1&a=1", "a=1&b=1"],
      ["a=1&b=2&c=3", "a=9&c=3&b=2"],
      ["a=1&b=2&c=3", "a=1&c=3&b=9"],
      // The entries are in another order, and a name holds two different values.
      ["a=1&b=2&a=3", "b=2&a=1&a=3"],
      ["a=1&b=2&a=3", "a=1&a=3&b=2"],
      ["a=1&b=2&a=3", "b=2&a=3&a=1"],
    ])("%p does not equal %p", (a, b) => {
      expect(deepEquals(new URLSearchParams(a), new URLSearchParams(b))).toBe(false);
      expect(deepEquals(new URLSearchParams(b), new URLSearchParams(a))).toBe(false);
    });

    it("compares the same entries from different sources", () => {
      const appended = new URLSearchParams();
      appended.append("a", "1");
      appended.append("a", "2");
      expect(deepEquals(appended, new URLSearchParams("a=1&a=2"))).toBe(true);
      expect(
        deepEquals(
          appended,
          new URLSearchParams([
            ["a", "1"],
            ["a", "2"],
          ]),
        ),
      ).toBe(true);
      expect(deepEquals(appended, new URLSearchParams(appended))).toBe(true);
      expect(deepEquals(appended, new URLSearchParams({ a: "1" }))).toBe(false);

      const emptyValue = new URLSearchParams();
      emptyValue.append("a", "");
      expect(deepEquals(emptyValue, new URLSearchParams("a="))).toBe(true);
    });

    it("compares the current entries of the searchParams of a URL", () => {
      const url = new URL("https://example.com/?a=1");
      const searchParams = url.searchParams;
      expect(deepEquals(searchParams, new URLSearchParams("a=1&a=2"))).toBe(false);
      url.search = "?a=1&a=2";
      expect(deepEquals(searchParams, new URLSearchParams("a=1&a=2"))).toBe(true);
      searchParams.append("a", "3");
      expect(deepEquals(searchParams, new URLSearchParams("a=1&a=2"))).toBe(false);
      expect(deepEquals(searchParams, new URL("https://example.com/?a=1&a=2&a=3").searchParams)).toBe(true);
    });

    it("does not change the order of the entries", () => {
      const a = new URLSearchParams("b=2&a=1&c=3");
      const b = new URLSearchParams("a=1&c=3&b=2");
      expect(deepEquals(a, b)).toBe(true);
      expect([a.toString(), b.toString()]).toEqual(["b=2&a=1&c=3", "a=1&c=3&b=2"]);
    });

    it("compares the own properties when the entries are equal", () => {
      const withExtra = () => Object.assign(new URLSearchParams("a=1&a=2"), { extra: 1 });
      expect(deepEquals(withExtra(), withExtra())).toBe(true);
      expect(deepEquals(withExtra(), new URLSearchParams("a=1&a=2"))).toBe(false);
      expect(deepEquals(new URLSearchParams("a=1&a=2"), withExtra())).toBe(false);
    });
  });

  describe("Headers", () => {
    const headers = (...setCookies: string[]) => {
      const result = new Headers({ "content-type": "text/plain", "x-a": "1" });
      for (const cookie of setCookies) result.append("set-cookie", cookie);
      return result;
    };

    it("compares every set-cookie value", () => {
      expect(deepEquals(headers(), headers())).toBe(true);
      expect(deepEquals(headers("k=1"), headers("k=1"))).toBe(true);
      expect(deepEquals(headers("k=1", "j=2"), headers("k=1", "j=2"))).toBe(true);
      expect(deepEquals(headers("k=1", "j=2", "i=3"), headers("k=1", "j=2", "i=3"))).toBe(true);
      expect(deepEquals(headers("k=1", "j=2"), new Headers(headers("k=1", "j=2")))).toBe(true);
      expect(
        deepEquals(
          headers("k=1", "j=2"),
          new Headers([
            ["Set-Cookie", "k=1"],
            ["X-A", "1"],
            ["set-cookie", "j=2"],
            ["Content-Type", "text/plain"],
          ]),
        ),
      ).toBe(true);
      expect(deepEquals({ headers: headers("k=1", "j=2") }, { headers: headers("k=1", "j=2") })).toBe(true);

      const unequal: [Headers, Headers][] = [
        [headers("k=1", "j=2"), headers("k=1", "j=3")],
        [headers("k=1", "j=2"), headers("k=1")],
        [headers("k=1", "j=2"), headers("k=1, j=2")],
        [headers("k=1", "j=2"), headers()],
        // getSetCookie() and iteration show the order of the set-cookie values.
        [headers("k=1", "j=2"), headers("j=2", "k=1")],
        [headers("k=1", "k=1", "j=2"), headers("k=1", "j=2", "j=2")],
      ];
      for (const [a, b] of unequal) {
        expect(deepEquals(a, b)).toBe(false);
        expect(deepEquals(b, a)).toBe(false);
      }
    });

    it("compares the other headers in any order", () => {
      const reordered = new Headers({ "X-A": "1", "Content-Type": "text/plain" });
      reordered.append("set-cookie", "k=1");
      expect(deepEquals(headers("k=1"), reordered)).toBe(true);
      expect(deepEquals(reordered, headers("k=1"))).toBe(true);

      const differentContentType = headers("k=1", "j=2");
      differentContentType.set("content-type", "text/html");
      const differentCustomHeader = headers("k=1", "j=2");
      differentCustomHeader.set("x-a", "2");
      const oneMoreHeader = headers("k=1", "j=2");
      oneMoreHeader.set("x-b", "2");
      // The two have the same number of entries.
      const oneCookieAndOneMoreHeader = headers("k=1");
      oneCookieAndOneMoreHeader.set("x-b", "2");
      const otherCustomName = new Headers({ "content-type": "text/plain", "x-b": "1" });
      const otherCommonName = new Headers({ "accept": "text/plain", "x-a": "1" });

      for (const other of [differentContentType, differentCustomHeader, oneMoreHeader, oneCookieAndOneMoreHeader]) {
        expect(deepEquals(headers("k=1", "j=2"), other)).toBe(false);
        expect(deepEquals(other, headers("k=1", "j=2"))).toBe(false);
      }
      for (const other of [otherCustomName, otherCommonName]) {
        expect(deepEquals(headers(), other)).toBe(false);
        expect(deepEquals(other, headers())).toBe(false);
      }

      // The names are in another order, and one value is different.
      const reorderedWithOtherValue: [Headers, Headers][] = [
        [new Headers({ "x-a": "1", "x-b": "2" }), new Headers({ "x-b": "2", "x-a": "9" })],
        [new Headers({ "accept": "a", "content-type": "b" }), new Headers({ "content-type": "b", "accept": "c" })],
      ];
      for (const [a, b] of reorderedWithOtherValue) {
        expect(deepEquals(a, b)).toBe(false);
        expect(deepEquals(b, a)).toBe(false);
      }
      expect(
        deepEquals(
          new Headers({ "accept": "a", "content-type": "b" }),
          new Headers({ "content-type": "b", "accept": "a" }),
        ),
      ).toBe(true);
    });

    it("does not take a header without a value for a missing header", () => {
      // The location header of this response has no value: get("location") returns null.
      const noValue = Response.redirect("").headers;
      const otherName = new Headers({ "content-type": "text/plain" });
      expect(noValue.count).toBe(otherName.count);
      expect(deepEquals(noValue, otherName)).toBe(false);
      expect(deepEquals(otherName, noValue)).toBe(false);
      expect(deepEquals(noValue, Response.redirect("").headers)).toBe(true);
    });

    it("compares the own properties when the entries are equal", () => {
      const withExtra = () => Object.assign(headers("k=1", "j=2"), { extra: 1 });
      expect(deepEquals(withExtra(), withExtra())).toBe(true);
      expect(deepEquals(withExtra(), headers("k=1", "j=2"))).toBe(false);
      expect(deepEquals(headers("k=1", "j=2"), withExtra())).toBe(false);
    });
  });

  // Replay a failure with BUN_DEEP_EQUALS_SEED=<seed>.
  describe("Headers and URLSearchParams against their entries (seeded differential)", () => {
    const iterations = 300;
    const random = () => {
      const seed = Number(process.env.BUN_DEEP_EQUALS_SEED ?? 0x64657175) >>> 0;
      let state = seed;
      const next = () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const int = (n: number) => Math.floor(next() * n);
      const pick = <T>(list: readonly T[]): T => list[int(list.length)];
      // The other side is unrelated, a copy, or a copy in another order with or without one changed name or value.
      const other = (
        entries: string[][],
        fresh: () => string[][],
        names: readonly string[],
        values: readonly string[],
      ) => {
        const kind = int(8);
        if (kind === 0) return fresh();
        const copy = entries.map(entry => [...entry]);
        if (kind === 2 || kind === 3 || kind === 4) {
          for (let i = copy.length - 1; i > 0; i--) {
            const j = int(i + 1);
            [copy[i], copy[j]] = [copy[j], copy[i]];
          }
        }
        if ((kind === 5 || kind === 6 || kind === 7) && copy.length > 1) {
          const i = 1 + int(copy.length - 1);
          [copy[i - 1], copy[i]] = [copy[i], copy[i - 1]];
        }
        if ((kind === 3 || kind === 6) && copy.length) pick(copy)[1] = pick(values);
        if ((kind === 4 || kind === 7) && copy.length) pick(copy)[0] = pick(names);
        return copy;
      };
      return { seed, int, pick, other };
    };

    it("URLSearchParams: the same answer as their entries and getAll()", () => {
      const { seed, int, pick, other } = random();
      const names = ["a", "b", "c", "A", ""];
      const values = ["1", "2", ""];
      const fresh = () => Array.from({ length: int(6) }, () => [pick(names), pick(values)]);
      const inOrder = (params: URLSearchParams) => JSON.stringify([...params]);
      const byName = (params: URLSearchParams) =>
        JSON.stringify([...new Set(params.keys())].sort().map(name => [name, params.getAll(name)]));
      const oneValuePerName = (params: URLSearchParams) =>
        [...new Set(params.keys())].every(name => new Set(params.getAll(name)).size === 1);

      const disagreements: object[] = [];
      let equal = 0;
      for (let i = 0; i < iterations; i++) {
        const entries = fresh();
        const a = new URLSearchParams(entries);
        const b = new URLSearchParams(other(entries, fresh, names, values));
        // The same entries in the same order, or in another order if no name holds two different values.
        const expected = inOrder(a) === inOrder(b) || (byName(a) === byName(b) && oneValuePerName(a));
        equal += Number(expected);
        const actual = [deepEquals(a, b), deepEquals(b, a)];
        if (actual[0] !== expected || actual[1] !== expected)
          disagreements.push({ a: a.toString(), b: b.toString(), expected, actual });
      }
      expect({ seed, disagreements }).toEqual({ seed, disagreements: [] });
      // Both answers must be frequent. If one is rare, the loop proves little.
      expect(equal).toBeWithin(iterations * 0.2, iterations * 0.8);
    });

    it("Headers: the same answer as the sorted entries and getSetCookie()", () => {
      const { seed, int, pick, other } = random();
      const names = ["accept", "Accept", "content-type", "x-a", "X-A", "x-b", "x-c", "set-cookie", "Set-Cookie"];
      const values = ["1", "2", "3"];
      const fresh = () => Array.from({ length: int(7) }, () => [pick(names), pick(values)]);
      const build = (entries: string[][]) => {
        const headers = new Headers();
        for (const [name, value] of entries) headers.append(name, value);
        return headers;
      };
      const view = (headers: Headers) =>
        JSON.stringify([[...headers].filter(([name]) => name !== "set-cookie").sort(), headers.getSetCookie()]);

      const disagreements: object[] = [];
      let equal = 0;
      for (let i = 0; i < iterations; i++) {
        const entries = fresh();
        const a = build(entries);
        // The second side starts from the joined values of the first side, so another order moves whole names.
        const b = build(other([...a], fresh, names, values));
        const expected = view(a) === view(b);
        equal += Number(expected);
        const actual = [deepEquals(a, b), deepEquals(b, a)];
        if (actual[0] !== expected || actual[1] !== expected)
          disagreements.push({ a: [...a], b: [...b], expected, actual });
      }
      expect({ seed, disagreements }).toEqual({ seed, disagreements: [] });
      expect(equal).toBeWithin(iterations * 0.2, iterations * 0.8);
    });
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

  it("tells Headers and URLSearchParams from another class when the fourth argument is true", () => {
    // The fourth argument is not in the public types.
    const deepEquals = Bun.deepEquals as (a: unknown, b: unknown, strict?: boolean, skipPrototype?: boolean) => boolean;
    expect(deepEquals(new Headers(), new FormData(), true, true)).toBe(false);
    expect(deepEquals(new FormData(), new Headers(), true, true)).toBe(false);
    expect(deepEquals(new URLSearchParams(), new Bun.CookieMap(), true, true)).toBe(false);
    expect(deepEquals(new Bun.CookieMap(), new URLSearchParams(), true, true)).toBe(false);
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

  it("distinguishes a Headers or a URLSearchParams from a wrapper of another class", () => {
    const pairs: [object, object][] = [
      [new Headers({ a: "1" }), new FormData()],
      [new URLSearchParams("a=1"), new Bun.CookieMap("a=1")],
    ];
    for (const [a, b] of pairs) {
      expect([Bun.deepEquals(a, b, true), Bun.deepEquals(b, a, true)]).toEqual([false, false]);
    }
  });

  // Matches Node's util.isDeepStrictEqual, which rejects a null prototype
  // against Object.prototype.
  it.failing("distinguishes a null-prototype object from an object literal", () => {
    expect(Bun.deepEquals(Object.create(null), {}, true)).toBe(false);
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
