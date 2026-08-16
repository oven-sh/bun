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

  // A DOMException has no own properties: name, message and code are getters on
  // the prototype backed by native state, and cause is a non-enumerable own
  // property. It compares like an Error: name, message, cause, then any own
  // enumerable properties.
  describe("DOMException", () => {
    class SubException extends DOMException {}

    it.each([
      [
        "the same name and message",
        () => new DOMException("boom", "AbortError"),
        () => new DOMException("boom", "AbortError"),
      ],
      ["no arguments", () => new DOMException(), () => new DOMException()],
      ["an omitted and an empty message", () => new DOMException(), () => new DOMException("", "Error")],
      [
        "a name given as a string and as an option",
        () => new DOMException("boom", "AbortError"),
        () => new DOMException("boom", { name: "AbortError" }),
      ],
      [
        "equal object causes",
        () => new DOMException("boom", { name: "AbortError", cause: { code: 1 } }),
        () => new DOMException("boom", { name: "AbortError", cause: { code: 1 } }),
      ],
      [
        "the same extra own property",
        () => Object.assign(new DOMException("boom", "AbortError"), { extra: 1 }),
        () => Object.assign(new DOMException("boom", "AbortError"), { extra: 1 }),
      ],
      [
        "a structured clone",
        () => new DOMException("boom", "DataCloneError"),
        () => structuredClone(new DOMException("boom", "DataCloneError")),
      ],
      [
        "subclass instances with the same state",
        () => new SubException("boom", "AbortError"),
        () => new SubException("boom", "AbortError"),
      ],
    ])("DOMExceptions with %s are equal", (_label, makeA, makeB) => {
      expect(deepEquals(makeA(), makeB())).toBe(true);
      expect(deepEquals(makeB(), makeA())).toBe(true);
    });

    it.each([
      [
        "different names",
        () => new DOMException("boom", "AbortError"),
        () => new DOMException("boom", "NotFoundError"),
      ],
      [
        "different messages",
        () => new DOMException("boom", "AbortError"),
        () => new DOMException("other", "AbortError"),
      ],
      ["a default and an explicit name", () => new DOMException("boom"), () => new DOMException("boom", "AbortError")],
      [
        "different causes",
        () => new DOMException("boom", { name: "AbortError", cause: 1 }),
        () => new DOMException("boom", { name: "AbortError", cause: 2 }),
      ],
      [
        "different object causes",
        () => new DOMException("boom", { name: "AbortError", cause: { code: 1 } }),
        () => new DOMException("boom", { name: "AbortError", cause: { code: 2 } }),
      ],
      [
        "a cause on one side only",
        () => new DOMException("boom", { name: "AbortError", cause: 1 }),
        () => new DOMException("boom", "AbortError"),
      ],
      [
        "different extra own properties",
        () => Object.assign(new DOMException("boom", "AbortError"), { extra: 1 }),
        () => Object.assign(new DOMException("boom", "AbortError"), { extra: 2 }),
      ],
      [
        "an extra own property on one side only",
        () => Object.assign(new DOMException("boom", "AbortError"), { extra: 1 }),
        () => new DOMException("boom", "AbortError"),
      ],
      [
        "subclass instances with different messages",
        () => new SubException("boom", "AbortError"),
        () => new SubException("other", "AbortError"),
      ],
    ])("DOMExceptions with %s are not equal", (_label, makeA, makeB) => {
      expect(deepEquals(makeA(), makeB())).toBe(false);
      expect(deepEquals(makeB(), makeA())).toBe(false);
    });

    // new DOMException("boom") has the default name "Error", so the plain object
    // and the Error below match it on name and message; only the kind of object
    // differs.
    it.each([
      ["an empty object", () => ({})],
      ["a plain object with name and message properties", () => ({ name: "Error", message: "boom" })],
      ["an Error", () => new Error("boom")],
    ])("a DOMException is never equal to %s", (_label, makeOther) => {
      expect(deepEquals(new DOMException("boom"), makeOther())).toBe(false);
      expect(deepEquals(makeOther(), new DOMException("boom"))).toBe(false);
    });

    it("an undefined cause and a missing cause differ only in strict mode, as for Error", () => {
      const domExceptions = [
        new DOMException("boom", { name: "AbortError", cause: undefined }),
        new DOMException("boom", "AbortError"),
      ] as const;
      const errors = [new Error("boom", { cause: undefined }), new Error("boom")] as const;
      expect(deepEquals(...domExceptions)).toBe(!strict);
      expect(deepEquals(...errors)).toBe(!strict);
    });

    it("a subclass instance and a base instance with the same state are equal only when not strict", () => {
      expect(deepEquals(new SubException("boom", "AbortError"), new DOMException("boom", "AbortError"))).toBe(!strict);
      expect(deepEquals(new SubException("boom", "AbortError"), new DOMException("other", "AbortError"))).toBe(false);
    });

    it("compares DOMExceptions nested in other values", () => {
      const make = (name: string) => ({
        reasons: [new DOMException("boom", name)],
        byKey: new Map([["k", new DOMException("boom", name)]]),
      });
      expect(deepEquals(make("AbortError"), make("AbortError"))).toBe(true);
      expect(deepEquals(make("AbortError"), make("TimeoutError"))).toBe(false);
    });

    it("compares a DOMException used as a cause", () => {
      const make = (name: string) => new Error("outer", { cause: new DOMException("inner", name) });
      expect(deepEquals(make("AbortError"), make("AbortError"))).toBe(true);
      expect(deepEquals(make("AbortError"), make("TimeoutError"))).toBe(false);
    });

    it("a getter on the cause that throws propagates", () => {
      const throwing = () =>
        new DOMException("boom", {
          name: "AbortError",
          cause: {
            get value() {
              throw new RangeError("from cause");
            },
          },
        });
      expect(() => deepEquals(throwing(), throwing())).toThrow(RangeError);
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
