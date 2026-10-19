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

// These five kinds keep their state in native memory and have no own properties.
describe("FormData, Blob, File, Bun.Cookie and Bun.CookieMap compare by their contents", () => {
  type Entry = [name: string, value: string | Blob, filename?: string];
  const fill = <T extends FormData>(formData: T, entries: Entry[]) => {
    for (const [name, value, filename] of entries) {
      if (filename === undefined) formData.append(name, value as string);
      else formData.append(name, value as Blob, filename);
    }
    return formData;
  };
  const form = (...entries: Entry[]) => fill(new FormData(), entries);
  class SubFormData extends FormData {}
  class SubBlob extends Blob {}
  // `name` is not standard on a Blob, but bun has a setter for it.
  const named = (text: string, name: string) => Object.assign(new Blob([text]), { name });
  const s3File = () =>
    Bun.s3.file("a.txt", {
      bucket: "bucket",
      accessKeyId: "id",
      secretAccessKey: "secret",
      endpoint: "http://127.0.0.1:1",
    });
  const withGetter = <T extends object>(object: T, value: number) =>
    Object.defineProperty(object, "x", { get: () => value, enumerable: true });

  // [name, a, b, equal in the default mode, equal in strict mode]
  const cases: [string, () => unknown, () => unknown, boolean, boolean][] = [
    ["FormData, another value", () => form(["a", "1"]), () => form(["a", "2"]), false, false],
    ["FormData, no entries against one", () => form(), () => form(["a", "1"]), false, false],
    ["FormData, the same entries", () => form(["a", "1"], ["b", "2"]), () => form(["a", "1"], ["b", "2"]), true, true],
    ["Blob, another size", () => new Blob(["abc"]), () => new Blob(["xyz-and-longer"]), false, false],
    ["Blob, other bytes", () => new Blob(["abc"]), () => new Blob(["abd"]), false, false],
    [
      "Blob, another type",
      () => new Blob(["a"], { type: "text/plain" }),
      () => new Blob(["a"], { type: "text/html" }),
      false,
      false,
    ],
    // bun derives a type for the blob of a body, so a type on one side only does not count.
    ["Blob, a type on one side only", () => new Blob(["a"], { type: "text/plain" }), () => new Blob(["a"]), true, true],
    ["Blob, the same bytes", () => new Blob(["abc"]), () => new Blob(["a", "bc"]), true, true],
    ["File, another name", () => new File(["a"], "a.txt"), () => new File(["a"], "b.txt"), false, false],
    ["File against a Blob, other bytes", () => new File(["a"], "a.txt"), () => new Blob(["b"]), false, false],
    // In bun a File and a Blob are one class, and a name counts only when both sides have one.
    ["File against a Blob, the same bytes", () => new File(["a"], "a.txt"), () => new Blob(["a"]), true, true],
    ["Blob, the same name", () => named("a", "x.txt"), () => named("a", "x.txt"), true, true],
    ["Blob, another name", () => named("a", "x.txt"), () => named("a", "y.txt"), false, false],
    [
      "Blob with a name against a File of another name",
      () => named("a", "x.txt"),
      () => new File(["a"], "y.txt"),
      false,
      false,
    ],
    ["Blob with a name against a Blob with none", () => named("a", "x.txt"), () => new Blob(["a"]), true, true],
    [
      "File, another lastModified",
      () => new File(["a"], "a.txt", { lastModified: 1 }),
      () => new File(["a"], "a.txt", { lastModified: 2 }),
      true,
      true,
    ],
    ["Bun.Cookie, another value", () => new Bun.Cookie("a", "1"), () => new Bun.Cookie("a", "2"), false, false],
    ["Bun.Cookie, the same fields", () => new Bun.Cookie("a", "1"), () => new Bun.Cookie("a", "1"), true, true],
    ["Bun.CookieMap, another value", () => new Bun.CookieMap("a=1"), () => new Bun.CookieMap("a=2"), false, false],
    [
      "Bun.CookieMap, another order",
      () => new Bun.CookieMap("a=1; b=2"),
      () => new Bun.CookieMap("b=2; a=1"),
      true,
      true,
    ],

    // A blob on disk or in S3 is not read, so these pairs keep the answer they had.
    ["Bun.file against a Blob", () => Bun.file("/does-not-exist/a.txt"), () => new Blob(["x"]), true, true],
    [
      "Bun.file of another path",
      () => Bun.file("/does-not-exist/a.txt"),
      () => Bun.file("/does-not-exist/b.txt"),
      true,
      true,
    ],
    [
      "FormData, an S3 file entry against bytes under the same file name",
      () => form(["f", s3File(), "a.txt"]),
      () => form(["f", new Blob(["x"]), "a.txt"]),
      true,
      true,
    ],

    // A FormData entry for a file on disk compares its file name. Nothing reads the file.
    [
      "FormData, one Bun.file under another file name",
      () => form(["f", Bun.file("/does-not-exist/a.txt"), "x.txt"]),
      () => form(["f", Bun.file("/does-not-exist/a.txt"), "y.txt"]),
      false,
      false,
    ],
    [
      "FormData, a Bun.file entry of another path",
      () => form(["f", Bun.file("/does-not-exist/a.txt")]),
      () => form(["f", Bun.file("/does-not-exist/b.txt")]),
      false,
      false,
    ],
    [
      "FormData, a Bun.file entry of the same path",
      () => form(["f", Bun.file("/does-not-exist/a.txt")]),
      () => form(["f", Bun.file("/does-not-exist/a.txt")]),
      true,
      true,
    ],

    // Inside other values.
    ["an array", () => [form(["a", "1"])], () => [form(["a", "2"])], false, false],
    ["a Map value", () => new Map([["k", new Blob(["a"])]]), () => new Map([["k", new Blob(["b"])]]), false, false],
    [
      "a Set member",
      () => new Set([new Bun.Cookie("a", "1")]),
      () => new Set([new Bun.Cookie("a", "2")]),
      false,
      false,
    ],
    [
      "an Error cause",
      () => new Error("e", { cause: new Bun.CookieMap("a=1") }),
      () => new Error("e", { cause: new Bun.CookieMap("a=2") }),
      false,
      false,
    ],

    // Own properties and the class still count when the contents are equal.
    [
      "equal FormData, another own property value",
      () => Object.assign(form(["a", "1"]), { x: 1 }),
      () => Object.assign(form(["a", "1"]), { x: 2 }),
      false,
      false,
    ],
    [
      "equal FormData, an own property on one side",
      () => Object.assign(form(["a", "1"]), { x: 1 }),
      () => form(["a", "1"]),
      false,
      false,
    ],
    [
      "equal FormData, the same own property",
      () => Object.assign(form(["a", "1"]), { x: 1 }),
      () => Object.assign(form(["a", "1"]), { x: 1 }),
      true,
      true,
    ],
    [
      "equal FormData, another own getter value",
      () => withGetter(form(["a", "1"]), 1),
      () => withGetter(form(["a", "1"]), 2),
      false,
      false,
    ],
    [
      "equal Blob, another own property value",
      () => Object.assign(new Blob(["a"]), { x: 1 }),
      () => Object.assign(new Blob(["a"]), { x: 2 }),
      false,
      false,
    ],
    [
      "FormData, another own property value and another entry",
      () => Object.assign(form(["a", "1"]), { x: 1 }),
      () => Object.assign(form(["a", "2"]), { x: 1 }),
      false,
      false,
    ],
    [
      "a FormData subclass against FormData",
      () => fill(new SubFormData(), [["a", "1"]]),
      () => form(["a", "1"]),
      true,
      false,
    ],
    [
      "a FormData subclass, the same entries",
      () => fill(new SubFormData(), [["a", "1"]]),
      () => fill(new SubFormData(), [["a", "1"]]),
      true,
      true,
    ],
    [
      "a FormData subclass, another value",
      () => fill(new SubFormData(), [["a", "1"]]),
      () => fill(new SubFormData(), [["a", "2"]]),
      false,
      false,
    ],
    ["a Blob subclass against Blob", () => new SubBlob(["a"]), () => new Blob(["a"]), true, false],
    ["a Blob subclass, other bytes", () => new SubBlob(["a"]), () => new SubBlob(["b"]), false, false],
  ];

  it.each(cases)("%s", (_, a, b, loose, strict) => {
    expect({
      loose: [Bun.deepEquals(a(), b()), Bun.deepEquals(b(), a())],
      strict: [Bun.deepEquals(a(), b(), true), Bun.deepEquals(b(), a(), true)],
    }).toEqual({ loose: [loose, loose], strict: [strict, strict] });
  });

  // Two different classes are never compared by contents. Only the strict answer is checked:
  // the default mode calls such a pair equal.
  it.each([
    ["FormData and Blob", () => form(["a", "1"]), () => new Blob(["a"])],
    ["Bun.Cookie and Bun.CookieMap", () => new Bun.Cookie("a", "1"), () => new Bun.CookieMap("a=1")],
    ["Blob and Response", () => new Blob(["a"]), () => new Response("a")],
  ])("%s are not strictly equal", (_, a, b) => {
    expect([Bun.deepEquals(a(), b(), true), Bun.deepEquals(b(), a(), true)]).toEqual([false, false]);
  });

  // bun does not write one type the same way everywhere, and the string `blob.type` gives is what counts.
  it("a type that both sides set compares as blob.type reads", async () => {
    const fromHeader = await new Response("x", { headers: { "content-type": "application/javascript" } }).blob();
    const pairs = [
      [new Blob(["x"], { type: "TEXT/PLAIN" }), new Blob(["x"], { type: "text/plain" })],
      [new Blob(["x"], { type: "IMAGE/PNG" }), new Blob(["x"], { type: "image/png" })],
      [fromHeader, new Blob(["x"], { type: "application/javascript" })],
    ];
    expect(pairs.map(([a, b]) => Bun.deepEquals(a, b))).toEqual(pairs.map(([a, b]) => a.type === b.type));
  });

  it("an empty FormData field equals its parsed form", async () => {
    const built = form(["a", ""], ["b", "1"]);
    const multipart = await new Response(built).formData();
    const urlencoded = await new Response("a=&b=1", {
      headers: { "content-type": "application/x-www-form-urlencoded" },
    }).formData();
    expect([Bun.deepEquals(multipart, built, true), Bun.deepEquals(urlencoded, built, true)]).toEqual([true, true]);
  });

  it("compares contents when the fourth argument skips the prototype check", () => {
    const deepEquals = Bun.deepEquals as (a: unknown, b: unknown, strict?: boolean, skipPrototype?: boolean) => boolean;
    expect(deepEquals(form(["a", "1"]), form(["a", "2"]), true, true)).toBe(false);
    expect(deepEquals(form(["a", "1"]), form(["a", "1"]), true, true)).toBe(true);
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
