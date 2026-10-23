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

// A DataView keeps its bytes in an internal slot and has no own properties.
describe("Bun.deepEquals on DataViews", () => {
  // The fourth argument is not in the public types.
  const deepEquals = Bun.deepEquals as (a: unknown, b: unknown, strict?: boolean, skipPrototype?: boolean) => boolean;
  const buffer = (...bytes: number[]) => new Uint8Array(bytes).buffer;
  const view = (...bytes: number[]) => new DataView(buffer(...bytes));
  class SubView extends DataView<ArrayBuffer> {}
  const sharedView = (...bytes: number[]) => {
    const shared = new SharedArrayBuffer(bytes.length);
    new Uint8Array(shared).set(bytes);
    return new DataView(shared);
  };
  // A view that follows the length of its resizable buffer.
  const lengthTrackingView = (...bytes: number[]) => {
    const resizable = new ArrayBuffer(bytes.length, { maxByteLength: 16 });
    new Uint8Array(resizable).set(bytes);
    return new DataView(resizable);
  };
  const detachedView = () => {
    const detached = new ArrayBuffer(4);
    const dataView = new DataView(detached);
    detached.transfer();
    return dataView;
  };
  // A fixed-length view whose end is past the end of its shrunk buffer.
  const outOfBoundsView = (
    View: new (buffer: ArrayBuffer, byteOffset: number, byteLength: number) => DataView = DataView,
  ) => {
    const resizable = new ArrayBuffer(8, { maxByteLength: 16 });
    const dataView = new View(resizable, 0, 8);
    resizable.resize(4);
    return dataView;
  };
  const expectTypeError = (compare: () => boolean) => {
    expect(compare).toThrow(TypeError);
    expect(compare).toThrow(
      new TypeError("Cannot perform get DataView.prototype.byteLength on a detached or out-of-bounds ArrayBuffer"),
    );
  };

  type Pair = [name: string, a: () => DataView, b: () => DataView];

  const differentBytes: Pair[] = [
    ["different bytes", () => view(1, 2), () => view(3, 4)],
    ["a different last byte", () => view(1, 2, 3), () => view(1, 2, 4)],
    ["different lengths", () => view(1, 2), () => new DataView(new ArrayBuffer(9))],
    ["an empty view and a view of one byte", () => view(), () => view(0)],
    ["different windows of equal buffers", () => new DataView(buffer(9, 1, 2, 9), 1, 2), () => view(9, 1)],
    ["different bytes in a SharedArrayBuffer", () => sharedView(1, 2), () => view(3, 4)],
    ["different bytes under a resizable buffer", () => lengthTrackingView(1, 2), () => view(3, 4)],
    [
      "different bytes with an equal own property",
      () => Object.assign(view(1, 2), { x: 1 }),
      () => Object.assign(view(3, 4), { x: 1 }),
    ],
    ["different bytes in two subclass instances", () => new SubView(buffer(1, 2)), () => new SubView(buffer(3, 4))],
  ];

  const equalBytes: Pair[] = [
    ["equal bytes", () => view(1, 2), () => view(1, 2)],
    ["two empty views", () => view(), () => new DataView(new ArrayBuffer(2), 2)],
    ["equal windows of different buffers", () => new DataView(buffer(9, 1, 2, 9), 1, 2), () => view(1, 2)],
    ["equal bytes in a SharedArrayBuffer", () => sharedView(1, 2), () => view(1, 2)],
    ["equal bytes under a resizable buffer", () => lengthTrackingView(1, 2), () => view(1, 2)],
    [
      "equal bytes with an equal own property",
      () => Object.assign(view(1, 2), { x: 1 }),
      () => Object.assign(view(1, 2), { x: 1 }),
    ],
    ["equal bytes in two subclass instances", () => new SubView(buffer(1, 2)), () => new SubView(buffer(1, 2))],
  ];

  describe.each([false, true])("strict: %p", strict => {
    const equals = (a: unknown, b: unknown) => deepEquals(a, b, strict);

    it.each(differentBytes)("rejects %s", (_, a, b) => {
      expect(equals(a(), b())).toBe(false);
      expect(equals(b(), a())).toBe(false);
      expect(equals({ nested: [a()] }, { nested: [b()] })).toBe(false);
      expect(equals(new Map([["key", a()]]), new Map([["key", b()]]))).toBe(false);
      expect(equals(new Map([[a(), "value"]]), new Map([[b(), "value"]]))).toBe(false);
      expect(equals(new Set([a()]), new Set([b()]))).toBe(false);
    });

    it.each(equalBytes)("accepts %s", (_, a, b) => {
      expect(equals(a(), b())).toBe(true);
      expect(equals(b(), a())).toBe(true);
      expect(equals({ nested: [a()] }, { nested: [b()] })).toBe(true);
    });

    it("compares the windows of two views of one buffer", () => {
      const shared = buffer(1, 2, 3);
      expect(equals(new DataView(shared, 1), new DataView(shared, 1))).toBe(true);
      expect(equals(new DataView(shared, 0, 2), new DataView(shared, 1, 2))).toBe(false);
    });

    // Two DataViews with different bytes used to match as keys, so the wrong values were compared.
    it("pairs the DataView keys of a Map and the DataView members of a Set by their bytes", () => {
      const map = (...entries: [DataView, string][]) => new Map(entries);
      expect(equals(map([view(1), "a"], [view(2), "b"]), map([view(1), "a"], [view(2), "b"]))).toBe(true);
      expect(equals(map([view(1), "a"], [view(2), "b"]), map([view(2), "b"], [view(1), "a"]))).toBe(true);
      expect(equals(map([view(1), "a"], [view(2), "b"]), map([view(1), "b"], [view(2), "a"]))).toBe(false);
      expect(equals(new Set([view(1), view(2)]), new Set([view(2), view(1)]))).toBe(true);
      expect(equals(new Set([view(1), view(2)]), new Set([view(1), view(3)]))).toBe(false);
    });

    it("compares own properties when the bytes are equal", () => {
      expect(equals(Object.assign(view(1, 2), { x: 1 }), view(1, 2))).toBe(false);
      expect(equals(view(1, 2), Object.assign(view(1, 2), { x: 1 }))).toBe(false);
      expect(equals(Object.assign(view(1, 2), { x: 1 }), Object.assign(view(1, 2), { x: 2 }))).toBe(false);
      // An undefined property counts only in strict mode.
      expect(equals(Object.assign(view(1, 2), { x: undefined }), view(1, 2))).toBe(!strict);
    });

    it.each([
      ["a Uint8Array", () => new Uint8Array([1, 2])],
      ["an ArrayBuffer", () => buffer(1, 2)],
      ["an object literal", () => ({})],
      ["an object that inherits from DataView.prototype", () => Object.create(DataView.prototype)],
    ])("rejects a DataView against %s", (_, other) => {
      expect(equals(view(1, 2), other())).toBe(false);
      expect(equals(other(), view(1, 2))).toBe(false);
    });

    // Node.js throws this TypeError for such a view. Bun.deepEquals throws the same way for a detached ArrayBuffer.
    it.each([
      ["a detached", detachedView],
      ["an out-of-bounds", () => outOfBoundsView()],
    ])("throws a TypeError for %s view", (_, unreadable) => {
      for (const [a, b] of [
        [unreadable, view],
        [view, unreadable],
        [unreadable, unreadable],
      ]) {
        expectTypeError(() => equals(a(), b()));
        expectTypeError(() => equals({ nested: a() }, { nested: b() }));
      }
      // One view on both sides is equal before any length is read.
      const same = unreadable();
      expect(equals(same, same)).toBe(true);
      // No length is read when the other value is not a DataView.
      expect(equals(unreadable(), new Uint8Array(0))).toBe(false);
    });
  });

  it("only strict mode compares the class", () => {
    expect(deepEquals(new SubView(buffer(1, 2)), view(1, 2))).toBe(true);
    expect(deepEquals(new SubView(buffer(1, 2)), view(1, 2), true)).toBe(false);
    expect(deepEquals(view(1, 2), new SubView(buffer(1, 2)), true)).toBe(false);
    // The fourth argument turns the class comparison off, not the byte comparison.
    expect(deepEquals(new SubView(buffer(1, 2)), view(1, 2), true, true)).toBe(true);
    expect(deepEquals(new SubView(buffer(1, 2)), view(3, 4), true, true)).toBe(false);
    expect(deepEquals(view(1, 2), {}, true, true)).toBe(false);
  });

  // Strict mode rejects a view of another class first, as node does, so it reads no length.
  it("strict mode rejects an unreadable view of another class without a TypeError", () => {
    const unreadable = () => outOfBoundsView(SubView);
    expect(deepEquals(unreadable(), view(), true)).toBe(false);
    expect(deepEquals(view(), unreadable(), true)).toBe(false);
    expectTypeError(() => deepEquals(unreadable(), unreadable(), true));
    expectTypeError(() => deepEquals(unreadable(), view(), true, true));
    expectTypeError(() => deepEquals(unreadable(), view()));
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
