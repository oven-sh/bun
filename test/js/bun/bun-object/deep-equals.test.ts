import { bunEnv, bunExe, isASAN, isWindows } from "harness";
import fs from "node:fs";
import vm, * as vmNamespace from "node:vm";

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

  // https://github.com/oven-sh/bun/issues/42539
  // Two objects are compared by their own enumerable properties. Those are the whole state of a
  // plain object, an array and a module namespace. Any other object (a Promise, a WeakMap, a
  // Response) must first have the same Object.prototype.toString tag as the other operand.
  describe("objects that are not plain objects or arrays", () => {
    class Tagged {
      get [Symbol.toStringTag]() {
        return "Tagged";
      }
    }
    function argumentsOf(..._values: unknown[]) {
      return arguments;
    }

    it.each([
      ["a Promise and {}", () => Promise.resolve(), () => ({})],
      ["a WeakSet and {}", () => new WeakSet(), () => ({})],
      ["a WeakMap and {}", () => new WeakMap(), () => ({})],
      ["a WeakRef and {}", () => new WeakRef({}), () => ({})],
      ["a DataView and {}", () => new DataView(new ArrayBuffer(8)), () => ({})],
      ["Math and {}", () => Math, () => ({})],
      ["a Response and {}", () => new Response(), () => ({})],
      ["a Blob and {}", () => new Blob([]), () => ({})],
      ["a URL and {}", () => new URL("http://a"), () => ({})],
      ["an AbortController and {}", () => new AbortController(), () => ({})],
      ["a generator and {}", () => (function* () {})(), () => ({})],
      ["a native constructor and {}", () => Map, () => ({})],
      ["a mock function and {}", () => jest.fn(), () => ({})],
      ["an arguments object and {}", () => argumentsOf(), () => ({})],
      ["an arguments object and an object with the same keys", () => argumentsOf(1, 2), () => ({ 0: 1, 1: 2 })],
      ["a Promise and a null-prototype object", () => Promise.resolve(), () => Object.create(null)],
      ["a Promise and a class instance", () => Promise.resolve(), () => new Tagged()],
      ["a Promise and a WeakSet", () => Promise.resolve(), () => new WeakSet()],
      ["a Request and a Response", () => new Request("http://a"), () => new Response()],
      ["a Proxy of a Promise and {}", () => new Proxy(Promise.resolve(), {}), () => ({})],
      ["a Proxy of a Promise and a Proxy of {}", () => new Proxy(Promise.resolve(), {}), () => new Proxy({}, {})],
      ["a module namespace and a Promise", () => vmNamespace, () => Promise.resolve()],
      ["{ a: Promise } and { a: {} }", () => ({ a: Promise.resolve() }), () => ({ a: {} })],
      ["[WeakMap] and [{}]", () => [new WeakMap()], () => [{}]],
      ["Map { 1 => Promise } and Map { 1 => {} }", () => new Map([[1, Promise.resolve()]]), () => new Map([[1, {}]])],
      ["Set { Promise } and Set { {} }", () => new Set([Promise.resolve()]), () => new Set([{}])],
    ] as [string, () => unknown, () => unknown][])("%s are not equal", (_, a, b) => {
      expect(deepEquals(a(), b())).toBe(false);
      expect(deepEquals(b(), a())).toBe(false);
    });

    it("two of them with the same tag are compared by their properties", () => {
      expect(deepEquals(Promise.resolve(), Promise.resolve())).toBe(true);
      expect(deepEquals(new WeakMap(), new WeakMap())).toBe(true);
      expect(deepEquals(Object.assign(new WeakMap(), { a: 1 }), new WeakMap())).toBe(false);
      expect(deepEquals(new URL("http://a"), new URL("http://a"))).toBe(true);
      expect(deepEquals(new URL("http://a"), new URL("http://b"))).toBe(false);
      expect(deepEquals(new Headers({ a: "1" }), new Headers({ a: "1" }))).toBe(true);
      expect(deepEquals(new Headers({ a: "1" }), new Headers({ a: "2" }))).toBe(false);
      expect(deepEquals(argumentsOf(1, 2), argumentsOf(1, 2))).toBe(true);
      expect(deepEquals(argumentsOf(1, 2), argumentsOf(1, 3))).toBe(false);
      expect(Bun.deepEquals(new Proxy(Promise.resolve(), {}), Promise.resolve())).toBe(true);
      class MyPromise extends Promise<void> {}
      expect(deepEquals(MyPromise.resolve(), Promise.resolve())).toBe(!strict);
      expect(Bun.deepEquals(process.env, { ...process.env })).toBe(true);
    });

    it("two objects of one class are compared without a read of Symbol.toStringTag", () => {
      let tagReads = 0;
      class CountingPromise extends Promise<void> {
        get [Symbol.toStringTag]() {
          tagReads++;
          return "Promise";
        }
      }
      expect(deepEquals(CountingPromise.resolve(), CountingPromise.resolve())).toBe(true);
      expect(tagReads).toBe(0);
      expect(deepEquals(CountingPromise.resolve(), Promise.resolve())).toBe(!strict);
      expect(tagReads).toBe(1);
    });

    it("an exception from a Symbol.toStringTag getter propagates", () => {
      class Throws {
        get [Symbol.toStringTag]() {
          throw new Error("from the tag getter");
        }
      }
      expect(() => deepEquals(new Throws(), Promise.resolve())).toThrow("from the tag getter");
      expect(() => deepEquals(Promise.resolve(), new Throws())).toThrow("from the tag getter");
    });
  });

  describe("plain objects, arrays and module namespaces", () => {
    let tagReads = 0;
    class Tagged {
      constructor(public a = 1) {}
      get [Symbol.toStringTag]() {
        tagReads++;
        return "Tagged";
      }
    }

    // bun labels plain data itself: `req.params` in Bun.serve is [object RequestParams] and
    // fs.Stats is [object Stats]. Tests compare those to object literals.
    it("are compared by their properties whatever their tags are", () => {
      tagReads = 0;
      expect(Bun.deepEquals(new Tagged(), { a: 1 })).toBe(true);
      expect(Bun.deepEquals({ a: 1 }, new Tagged())).toBe(true);
      expect(deepEquals(new Tagged(), new Tagged())).toBe(true);
      expect(deepEquals(new Tagged(1), new Tagged(2))).toBe(false);
      expect(Bun.deepEquals(Object.create({ [Symbol.toStringTag]: "Inherited" }), {})).toBe(true);
      expect(Bun.deepEquals(Object.defineProperty({ x: 1 }, Symbol.toStringTag, { value: "Own" }), { x: 1 })).toBe(
        true,
      );
      expect(Bun.deepEquals(Object.defineProperty([1], Symbol.toStringTag, { value: "Own" }), [1])).toBe(true);
      expect(Bun.deepEquals(Object.assign(Object.create(null), { a: 1 }), { a: 1 })).toBe(true);
      expect(tagReads).toBe(0);

      const formData = new FormData();
      formData.append("a", "b");
      expect(Object.prototype.toString.call(formData.toJSON())).toBe("[object FormData]");
      expect(Bun.deepEquals(formData.toJSON(), { a: "b" })).toBe(true);
      expect(Object.prototype.toString.call(new URLSearchParams("a=b").toJSON())).toBe("[object URLSearchParams]");
      expect(Bun.deepEquals(new URLSearchParams("a=b").toJSON(), { a: "b" })).toBe(true);
    });

    it("req.params in a Bun.serve route equals an object literal with the same entries", async () => {
      let params: unknown;
      using server = Bun.serve({
        port: 0,
        routes: {
          "/orgs/:orgId/repos/:repoId": req => {
            params = req.params;
            return new Response("ok");
          },
        },
      });
      const res = await fetch(new URL("/orgs/oven-sh/repos/bun", server.url).href);
      expect(await res.text()).toBe("ok");
      expect(Object.prototype.toString.call(params)).toBe("[object RequestParams]");
      expect(Bun.deepEquals(params, { orgId: "oven-sh", repoId: "bun" })).toBe(true);
      expect(params).toEqual({ orgId: "oven-sh", repoId: "bun" });
      expect(deepEquals(params, { orgId: "oven-sh", repoId: "other" })).toBe(false);
    });

    it("fs.Stats, fs.StatFs and fs.Dirent equal a copy of their own properties", () => {
      const stats = fs.statSync(import.meta.dir);
      expect(Object.prototype.toString.call(stats)).toBe("[object Stats]");
      expect(Bun.deepEquals(stats, { ...stats })).toBe(true);
      expect(stats).toEqual({ ...stats });
      expect(deepEquals(stats, { ...stats, size: -1 })).toBe(false);

      const bigintStats = fs.statSync(import.meta.dir, { bigint: true });
      expect(Bun.deepEquals(bigintStats, { ...bigintStats })).toBe(true);

      const statFs = fs.statfsSync(import.meta.dir);
      expect(Bun.deepEquals(statFs, { ...statFs })).toBe(true);

      const [dirent] = fs.readdirSync(import.meta.dir, { withFileTypes: true });
      expect(Object.prototype.toString.call(dirent)).toBe("[object Dirent]");
      expect(Bun.deepEquals(dirent, { ...dirent })).toBe(true);
      expect(dirent).toEqual({ ...dirent });
    });

    // Under Jest's CommonJS transform `import * as ns` is a plain object, so this comparison is common.
    it("a module namespace is compared to a plain object by its exports", () => {
      expect(Object.prototype.toString.call(vmNamespace)).toBe("[object Module]");
      expect(Bun.deepEquals(vmNamespace, { ...vmNamespace })).toBe(true);
      expect(Bun.deepEquals({ ...vmNamespace }, vmNamespace)).toBe(true);
      expect(deepEquals(vmNamespace, vmNamespace)).toBe(true);
      expect(deepEquals(vmNamespace, {})).toBe(false);
    });

    // A Proxy has no state of its own. It is the kind of object that its target is.
    it("a Proxy of one of them is not asked for Symbol.toStringTag", () => {
      const asked: PropertyKey[] = [];
      const handler: ProxyHandler<object> = {
        get(target, key, receiver) {
          asked.push(key);
          if (typeof key === "symbol") throw new Error("unknown key " + String(key));
          return Reflect.get(target, key, receiver);
        },
      };
      expect(Bun.deepEquals(new Proxy({ a: 1 }, handler), { a: 1 })).toBe(true);
      expect(Bun.deepEquals({ a: 1 }, new Proxy({ a: 1 }, handler))).toBe(true);
      expect(Bun.deepEquals(new Proxy({ a: 1 }, handler), new Proxy({ a: 1 }, handler))).toBe(true);
      expect(Bun.deepEquals(new Proxy(new Proxy({ a: 1 }, handler), handler), { a: 1 })).toBe(true);
      expect(deepEquals(new Proxy({ a: 1 }, handler), { a: 2 })).toBe(false);
      expect(Bun.deepEquals(new Proxy([1], {}), [1])).toBe(true);
      expect(asked).not.toContain(Symbol.toStringTag);

      // The other operand is a Promise, so both tags are read.
      expect(() => deepEquals(new Proxy({}, handler), Promise.resolve())).toThrow(
        "unknown key Symbol(Symbol.toStringTag)",
      );
      expect(asked).toContain(Symbol.toStringTag);
    });

    it("a revoked Proxy still throws", () => {
      const { proxy, revoke } = Proxy.revocable({}, {});
      revoke();
      expect(() => deepEquals(proxy, {})).toThrow(TypeError);
      expect(() => deepEquals({}, proxy)).toThrow(TypeError);
      expect(() => deepEquals(proxy, Promise.resolve())).toThrow(TypeError);
    });
  });

  // Jest never reads the tag of a typed array: it compares two of them with iterableEquality.
  it("typed arrays, Maps and Sets are compared without a read of Symbol.toStringTag", () => {
    let tagReads = 0;
    class CountingBytes extends Uint8Array {
      get [Symbol.toStringTag]() {
        tagReads++;
        return "Uint8Array";
      }
    }
    class CountingMap<K, V> extends Map<K, V> {
      get [Symbol.toStringTag]() {
        tagReads++;
        return "Map";
      }
    }
    class CountingSet<T> extends Set<T> {
      get [Symbol.toStringTag]() {
        tagReads++;
        return "Set";
      }
    }
    expect(deepEquals(new CountingBytes([1, 2]), new CountingBytes([1, 2]))).toBe(true);
    expect(deepEquals(new CountingBytes([1, 2]), new CountingBytes([1, 3]))).toBe(false);
    expect(deepEquals(new CountingMap([[1, 2]]), new CountingMap([[1, 2]]))).toBe(true);
    expect(deepEquals(new CountingSet([1, 2]), new CountingSet([1, 2]))).toBe(true);
    expect(deepEquals({ bytes: new CountingBytes([1]) }, { bytes: new CountingBytes([1]) })).toBe(true);
    expect(tagReads).toBe(0);
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
