import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, rss } from "harness";
import { runInNewContext } from "node:vm";

describe("Structured Clone Fast Path", () => {
  test("structuredClone should work with empty object", () => {
    const object = {};
    const cloned = structuredClone(object);
    expect(cloned).toStrictEqual({});
  });

  test("structuredClone({}) result is spreadable after adding a property", () => {
    // The fast-path deserializer sized the clone with inline capacity 0 for an
    // empty source, so spreading it tripped JSC's hasInlineStorage() debug
    // assert once a property was added.
    const x: Record<string, number> = structuredClone({});
    x.a = 1;
    expect({ ...x }).toEqual({ a: 1 });

    const [y]: Record<string, number>[] = structuredClone([{}]);
    y.b = 2;
    expect({ ...y }).toEqual({ b: 2 });
  });

  test("structuredClone should work with empty string", () => {
    const string = "";
    const cloned = structuredClone(string);
    expect(cloned).toStrictEqual("");
  });

  const deOptimizations = [
    {
      get accessor() {
        return 1;
      },
    },
    Object.create(Object.prototype, {
      data: {
        value: 1,
        writable: false,
        configurable: false,
      },
    }),
    Object.create(Object.prototype, {
      data: {
        value: 1,
        writable: true,
        configurable: false,
      },
    }),
    Object.create(Object.prototype, {
      data: {
        get: () => 1,
        configurable: true,
      },
    }),
    Object.create(Object.prototype, {
      data: {
        set: () => {},
        enumerable: true,
        configurable: true,
      },
    }),
  ];

  for (const deOptimization of deOptimizations) {
    test("structuredCloneDeOptimization", () => {
      structuredClone(deOptimization);
    });
  }

  test("structuredClone should use a constant amount of memory for string inputs", () => {
    const clones: Array<string> = [];
    // Create a 512KB string to test fast path
    const largeString = Buffer.alloc(512 * 1024, "a").toString();
    for (let i = 0; i < 100; i++) {
      clones.push(structuredClone(largeString));
    }
    Bun.gc(true);
    const rss1 = rss();
    for (let i = 0; i < 10000; i++) {
      clones.push(structuredClone(largeString));
    }
    Bun.gc(true);
    const rss2 = rss();
    const delta = rss2 - rss1;
    // ASAN's free quarantine (default 256 MB) plus redzones and glibc page
    // retention inflate RSS even when nothing is leaking.
    expect(delta).toBeLessThan(isASAN ? 1024 * 1024 * 400 : 1024 * 1024 * 8);
    expect(clones.length).toBe(10000 + 100);
  });

  test("structuredClone should use a constant amount of memory for simple object inputs", () => {
    // Create a 512KB string to test fast path
    const largeValue = { property: Buffer.alloc(512 * 1024, "a").toString() };
    for (let i = 0; i < 100; i++) {
      structuredClone(largeValue);
    }
    Bun.gc(true);
    const rss1 = rss();
    for (let i = 0; i < 10000; i++) {
      structuredClone(largeValue);
    }
    Bun.gc(true);
    const rss2 = rss();
    const delta = rss2 - rss1;
    // ASAN's free quarantine (default 256 MB) plus redzones and glibc page
    // retention inflate RSS even when nothing is leaking.
    expect(delta).toBeLessThan(isASAN ? 1024 * 1024 * 400 : 1024 * 1024);
  });

  // === Array fast path tests ===

  test("structuredClone should work with empty array", () => {
    expect(structuredClone([])).toEqual([]);
  });

  test("structuredClone should work with array of numbers", () => {
    const input = [1, 2, 3, 4, 5];
    expect(structuredClone(input)).toEqual(input);
  });

  test("structuredClone should work with array of strings", () => {
    const input = ["hello", "world", ""];
    expect(structuredClone(input)).toEqual(input);
  });

  test("structuredClone should work with array of mixed primitives", () => {
    const input = [1, "hello", true, false, null, undefined, 3.14];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
  });

  test("structuredClone should work with array of special numbers", () => {
    const cloned = structuredClone([-0, NaN, Infinity, -Infinity]);
    expect(Object.is(cloned[0], -0)).toBe(true);
    expect(cloned[1]).toBeNaN();
    expect(cloned[2]).toBe(Infinity);
    expect(cloned[3]).toBe(-Infinity);
  });

  test("structuredClone should work with large array of numbers", () => {
    const input = Array.from({ length: 10000 }, (_, i) => i);
    expect(structuredClone(input)).toEqual(input);
  });

  test("structuredClone should work with array of simple objects", () => {
    const input = [
      { a: 1, b: "hello" },
      { a: 2, b: "world" },
    ];
    expect(structuredClone(input)).toEqual(input);
  });

  test("structuredClone should work with large array of same-shape objects", () => {
    const input = Array.from({ length: 100 }, (_, i) => ({ id: i, name: `item-${i}`, active: i % 2 === 0 }));
    expect(structuredClone(input)).toEqual(input);
  });

  test("structuredClone should work with array of mixed elements and objects", () => {
    const input = [1, "hello", { a: 1 }, true, { b: "world" }];
    expect(structuredClone(input)).toEqual(input);
  });

  test("structuredClone should work with array of objects with different shapes", () => {
    const input = [{ a: 1 }, { b: "hello", c: true }, { x: 42 }];
    expect(structuredClone(input)).toEqual(input);
  });

  test("structuredClone should fallback for array with nested objects inside objects", () => {
    // nested object inside object → normal path (still correct)
    const input = [{ a: { b: 1 } }];
    expect(structuredClone(input)).toEqual(input);
  });

  test("structuredClone creates independent copies of objects in array", () => {
    const input = [{ a: 1 }, { a: 2 }];
    const cloned = structuredClone(input);
    cloned[0].a = 999;
    expect(input[0].a).toBe(1);
  });

  test("postMessage with array of objects via MessageChannel", async () => {
    const { port1, port2 } = new MessageChannel();
    const input = [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ];
    const { promise, resolve } = Promise.withResolvers();
    port2.onmessage = e => resolve(e.data);
    port1.postMessage(input);
    const result = await promise;
    expect(result).toEqual(input);
    port1.close();
    port2.close();
  });

  test("structuredClone should fallback for arrays with holes", () => {
    const input = [1, , 3]; // sparse
    const cloned = structuredClone(input);
    // structured clone spec: holes become undefined
    expect(cloned[0]).toBe(1);
    expect(cloned[1]).toBe(undefined);
    expect(cloned[2]).toBe(3);
  });

  test("structuredClone should work with array of doubles", () => {
    const input = [1.5, 2.7, 3.14, 0.1 + 0.2];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
  });

  test("structuredClone creates independent copy of array", () => {
    const input = [1, 2, 3];
    const cloned = structuredClone(input);
    cloned[0] = 999;
    expect(input[0]).toBe(1);
  });

  test("structuredClone should preserve named properties on arrays", () => {
    const input: any = [1, 2, 3];
    input.foo = "bar";
    const cloned = structuredClone(input);
    expect(cloned.foo).toBe("bar");
    expect(Array.from(cloned)).toEqual([1, 2, 3]);
  });

  test("postMessage should work with array fast path", async () => {
    const { port1, port2 } = new MessageChannel();
    const input = [1, 2, 3, "hello", true];
    const { promise, resolve } = Promise.withResolvers();
    port2.onmessage = e => resolve(e.data);
    port1.postMessage(input);
    const result = await promise;
    expect(result).toEqual(input);
    port1.close();
    port2.close();
  });

  // === Edge case tests ===

  test("structuredClone of frozen array should produce a non-frozen clone", () => {
    const input = Object.freeze([1, 2, 3]);
    const cloned = structuredClone(input) as number[];
    expect(cloned).toEqual([1, 2, 3]);
    expect(Object.isFrozen(cloned)).toBe(false);
    cloned[0] = 999;
    expect(cloned[0]).toBe(999);
  });

  test("structuredClone of sealed array should produce a non-sealed clone", () => {
    const input = Object.seal([1, 2, 3]);
    const cloned = structuredClone(input);
    expect(cloned).toEqual([1, 2, 3]);
    expect(Object.isSealed(cloned)).toBe(false);
    cloned.push(4);
    expect(cloned).toEqual([1, 2, 3, 4]);
  });

  test("structuredClone of array with deleted element (hole via delete)", () => {
    const input = [1, 2, 3];
    delete (input as any)[1];
    const cloned = structuredClone(input);
    expect(cloned[0]).toBe(1);
    expect(cloned[1]).toBe<number | undefined>(undefined);
    expect(cloned[2]).toBe(3);
    expect(1 in cloned).toBe(false); // holes remain holes after structuredClone
  });

  test("structuredClone of array with length > actual elements", () => {
    const input = [1, 2, 3];
    input.length = 6;
    const cloned = structuredClone(input);
    expect(cloned.length).toBe(6);
    expect(cloned[0]).toBe(1);
    expect(cloned[1]).toBe(2);
    expect(cloned[2]).toBe(3);
    expect(cloned[3]).toBe<number | undefined>(undefined);
  });

  test("structuredClone of single element arrays", () => {
    expect(structuredClone([42])).toEqual([42]);
    expect(structuredClone([3.14])).toEqual([3.14]);
    expect(structuredClone(["hello"])).toEqual(["hello"]);
    expect(structuredClone([true])).toEqual([true]);
    expect(structuredClone([null])).toEqual([null]);
  });

  test("structuredClone of array with named properties on Int32 array", () => {
    const input: any = [1, 2, 3]; // Int32 indexing
    input.name = "test";
    input.count = 42;
    const cloned = structuredClone(input);
    expect(cloned.name).toBe("test");
    expect(cloned.count).toBe(42);
    expect(Array.from(cloned)).toEqual([1, 2, 3]);
  });

  test("structuredClone of array with named properties on Double array", () => {
    const input: any = [1.1, 2.2, 3.3]; // Double indexing
    input.label = "doubles";
    const cloned = structuredClone(input);
    expect(cloned.label).toBe("doubles");
    expect(Array.from(cloned)).toEqual([1.1, 2.2, 3.3]);
  });

  test("structuredClone of array that transitions Int32 to Double", () => {
    const input = [1, 2, 3]; // starts as Int32
    input.push(4.5); // transitions to Double
    const cloned = structuredClone(input);
    expect(cloned).toEqual([1, 2, 3, 4.5]);
  });

  test("structuredClone of array with modified prototype", () => {
    const input = [1, 2, 3];
    Object.setPrototypeOf(input, {
      customMethod() {
        return 42;
      },
    });
    const cloned = structuredClone(input);
    // Clone should have standard Array prototype, not the custom one
    expect(Array.from(cloned)).toEqual([1, 2, 3]);
    expect(cloned).toBeInstanceOf(Array);
    expect((cloned as any).customMethod).toBeUndefined();
  });

  test("structuredClone of array with prototype indexed properties and holes", () => {
    const proto = Object.create(Array.prototype);
    proto[1] = "from proto";
    const input = new Array(3);
    Object.setPrototypeOf(input, proto);
    input[0] = "a";
    input[2] = "c";
    // structuredClone only copies own properties; prototype values are not included
    const cloned = structuredClone(input);
    expect(cloned[0]).toBe("a");
    expect(1 in cloned).toBe(false); // hole, not "from proto"
    expect(cloned[2]).toBe("c");
    expect(cloned).toBeInstanceOf(Array);
  });

  test("postMessage with Int32 array via MessageChannel", async () => {
    const { port1, port2 } = new MessageChannel();
    const input = [10, 20, 30, 40, 50];
    const { promise, resolve } = Promise.withResolvers();
    port2.onmessage = e => resolve(e.data);
    port1.postMessage(input);
    const result = await promise;
    expect(result).toEqual(input);
    port1.close();
    port2.close();
  });

  test("postMessage with Double array via MessageChannel", async () => {
    const { port1, port2 } = new MessageChannel();
    const input = [1.1, 2.2, 3.3];
    const { promise, resolve } = Promise.withResolvers();
    port2.onmessage = e => resolve(e.data);
    port1.postMessage(input);
    const result = await promise;
    expect(result).toEqual(input);
    port1.close();
    port2.close();
  });

  test("structuredClone of array multiple times produces independent copies", () => {
    const input = [1, 2, 3];
    const clones = Array.from({ length: 10 }, () => structuredClone(input));
    clones[0][0] = 999;
    clones[5][1] = 888;
    // All other clones and the original should be unaffected
    expect(input).toEqual([1, 2, 3]);
    for (let i = 1; i < 10; i++) {
      if (i === 5) {
        expect(clones[i]).toEqual([1, 888, 3]);
      } else {
        expect(clones[i]).toEqual([1, 2, 3]);
      }
    }
  });

  test("structuredClone of Array subclass loses subclass identity", () => {
    class MyArray extends Array<number> {
      customProp = "hello";
      sum() {
        return this.reduce((a: number, b: number) => a + b, 0);
      }
    }
    const input = new MyArray(1, 2, 3);
    input.customProp = "world";
    const cloned = structuredClone(input);
    // structuredClone spec: result is a plain Array, not a subclass
    expect(Array.from(cloned)).toEqual([1, 2, 3]);
    expect(cloned).toBeInstanceOf(Array);
    expect((cloned as any).sum).toBeUndefined();
  });

  test("structuredClone of array with only undefined values", () => {
    const input = [undefined, undefined, undefined];
    const cloned = structuredClone(input);
    expect(cloned).toEqual([undefined, undefined, undefined]);
    expect(cloned.length).toBe(3);
    // Ensure they are actual values, not holes
    expect(0 in cloned).toBe(true);
    expect(1 in cloned).toBe(true);
    expect(2 in cloned).toBe(true);
  });

  test("structuredClone of array with only null values", () => {
    const input = [null, null, null];
    const cloned = structuredClone(input);
    expect(cloned).toEqual([null, null, null]);
  });

  test("structuredClone of dense double array preserves -0 and NaN", () => {
    const input = [-0, NaN, -0, NaN];
    const cloned = structuredClone(input);
    expect(Object.is(cloned[0], -0)).toBe(true);
    expect(cloned[1]).toBeNaN();
    expect(Object.is(cloned[2], -0)).toBe(true);
    expect(cloned[3]).toBeNaN();
  });

  test("structuredClone on object with simple properties can exceed JSFinalObject::maxInlineCapacity", () => {
    let largeValue = {};
    for (let i = 0; i < 100; i++) {
      largeValue["property" + i] = i;
    }

    for (let i = 0; i < 100; i++) {
      expect(structuredClone(largeValue)).toStrictEqual(largeValue);
    }
    Bun.gc(true);
    for (let i = 0; i < 100; i++) {
      expect(structuredClone(largeValue)).toStrictEqual(largeValue);
    }
  });

  // === DenseArray fast path edge case tests ===

  test("array of empty objects", () => {
    const input = [{}, {}, {}];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
    expect(cloned[0]).not.toBe(input[0]);
  });

  test("array with single object element", () => {
    const input = [{ key: "value" }];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
    cloned[0].key = "modified";
    expect(input[0].key).toBe("value");
  });

  test("objects with special number property values", () => {
    const input = [{ a: NaN, b: Infinity, c: -Infinity, d: -0 }];
    const cloned = structuredClone(input);
    expect(cloned[0].a).toBeNaN();
    expect(cloned[0].b).toBe(Infinity);
    expect(cloned[0].c).toBe(-Infinity);
    expect(Object.is(cloned[0].d, -0)).toBe(true);
  });

  test("objects with null and undefined property values", () => {
    const input = [
      { a: null, b: undefined },
      { a: null, b: undefined },
    ];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
    expect(cloned[0].a).toBeNull();
    expect(cloned[0].b).toBeUndefined();
    expect("b" in cloned[0]).toBe(true);
  });

  test("objects with empty string keys and values", () => {
    const input = [{ "": "" }, { "": "nonempty" }];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
  });

  test("objects with many properties exceeding maxInlineCapacity", () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < 100; i++) obj[`p${i}`] = i;
    const input = [obj, { ...obj }];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
    expect(Object.keys(cloned[0]).length).toBe(100);
  });

  test("alternating object shapes (cache invalidation)", () => {
    // shape A, shape B, shape A, shape B — cache should not corrupt results
    const input = [{ x: 1, y: 2 }, { name: "hello" }, { x: 3, y: 4 }, { name: "world" }];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
  });

  test("objects followed by primitives followed by objects", () => {
    const input = [{ a: 1 }, 42, null, { b: "two" }, "str", { c: true }];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
  });

  test("fallback: array with object containing array property value", () => {
    const input = [{ foo: [1, 2, 3] }];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
    cloned[0].foo[0] = 999;
    expect(input[0].foo[0]).toBe(1);
  });

  test("fallback: array with object containing nested object property value", () => {
    const input = [{ a: 1 }, { b: { nested: true } }];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
    cloned[1].b!.nested = false;
    expect(input[1].b!.nested).toBe(true);
  });

  test("fallback: array with Date object", () => {
    const now = new Date();
    const input = [{ a: 1 }, now];
    const cloned = structuredClone(input);
    expect(cloned[0]).toEqual({ a: 1 });
    expect(cloned[1]).toEqual(now);
    expect(cloned[1]).toBeInstanceOf(Date);
  });

  test("fallback: array with RegExp object", () => {
    const input = [{ a: 1 }, /test/gi];
    const cloned = structuredClone(input);
    expect(cloned[0]).toEqual({ a: 1 });
    expect(cloned[1]).toEqual(/test/gi);
  });

  test("fallback: array with Map", () => {
    const input = [new Map([["key", "value"]])];
    const cloned = structuredClone(input);
    expect(cloned[0].get("key")).toBe("value");
  });

  test("fallback: array with Set", () => {
    const input = [new Set([1, 2, 3])];
    const cloned = structuredClone(input);
    expect(cloned[0]).toEqual(new Set([1, 2, 3]));
  });

  test("fallback: object with getter in array", () => {
    const obj = Object.defineProperty({}, "x", { get: () => 42, enumerable: true, configurable: true });
    const input = [obj];
    const cloned = structuredClone(input);
    expect((cloned[0] as any).x).toBe(42);
  });

  test("fallback: object with non-enumerable property in array", () => {
    const obj = Object.defineProperty({ a: 1 }, "hidden", { value: 2, enumerable: false });
    const input = [obj];
    const cloned = structuredClone(input);
    expect(cloned[0].a).toBe(1);
    // non-enumerable property should not be cloned by structuredClone
    expect((cloned[0] as any).hidden).toBeUndefined();
  });

  test("frozen objects in array produce non-frozen clones", () => {
    const input = [Object.freeze({ a: 1, b: "hello" }), Object.freeze({ a: 2, b: "world" })];
    const cloned = structuredClone(input) as { a: number; b: string }[];
    expect(cloned).toEqual([
      { a: 1, b: "hello" },
      { a: 2, b: "world" },
    ]);
    expect(Object.isFrozen(cloned[0])).toBe(false);
    cloned[0].a = 999;
    expect(cloned[0].a).toBe(999);
  });

  test("sealed objects in array produce non-sealed clones", () => {
    const input = [Object.seal({ x: 10 })];
    const cloned = structuredClone(input);
    expect(cloned).toEqual([{ x: 10 }]);
    expect(Object.isSealed(cloned[0])).toBe(false);
  });

  test("object with numeric string keys in array", () => {
    const input = [{ "0": "a", "1": "b", "2": "c" }];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
  });

  test("repeated structuredClone of same array of objects", () => {
    const input = [
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" },
    ];
    const clones = Array.from({ length: 10 }, () => structuredClone(input));
    // Mutate one clone
    clones[0][0].id = 999;
    clones[3][1].name = "Charlie";
    // Original and other clones unaffected
    expect(input[0].id).toBe(1);
    expect(input[1].name).toBe("Bob");
    expect(clones[1][0].id).toBe(1);
    expect(clones[5][1].name).toBe("Bob");
  });

  test("postMessage with mixed array of objects and primitives", async () => {
    const { port1, port2 } = new MessageChannel();
    const input = [42, { x: "hello" }, true, { y: 3.14 }, null];
    const { promise, resolve } = Promise.withResolvers();
    port2.onmessage = e => resolve(e.data);
    port1.postMessage(input);
    const result = await promise;
    expect(result).toEqual(input);
    port1.close();
    port2.close();
  });

  test("postMessage with array of empty objects", async () => {
    const { port1, port2 } = new MessageChannel();
    const input = [{}, {}, {}];
    const { promise, resolve } = Promise.withResolvers();
    port2.onmessage = e => resolve(e.data);
    port1.postMessage(input);
    const result = await promise;
    expect(result).toEqual(input);
    port1.close();
    port2.close();
  });

  test("fallback: array with ArrayBuffer", () => {
    const buf = new ArrayBuffer(8);
    new Uint8Array(buf).set([1, 2, 3, 4, 5, 6, 7, 8]);
    const input = [{ a: 1 }, buf];
    const cloned = structuredClone(input);
    expect(cloned[0]).toEqual({ a: 1 });
    expect(new Uint8Array(cloned[1] as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  });

  test("fallback: object created with Object.create(null) in array", () => {
    const obj = Object.create(null);
    obj.a = 1;
    obj.b = "hello";
    const input = [obj];
    const cloned = structuredClone(input);
    expect(cloned[0].a).toBe(1);
    expect(cloned[0].b).toBe("hello");
  });

  test("fallback: class instance in array", () => {
    class Foo {
      constructor(public x: number) {}
    }
    const input = [new Foo(42)];
    const cloned = structuredClone(input);
    expect(cloned[0].x).toBe(42);
    expect(cloned[0]).not.toBeInstanceOf(Foo);
  });

  test("object with boolean property values in array", () => {
    const input = [
      { enabled: true, visible: false },
      { enabled: false, visible: true },
    ];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
    expect(cloned[0].enabled).toBe(true);
    expect(cloned[1].visible).toBe(true);
  });

  test("object with only string values in array", () => {
    const input = [
      { first: "Alice", last: "Smith" },
      { first: "Bob", last: "Jones" },
    ];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
  });

  test("large array of objects with same shape (structure cache stress)", () => {
    const input = Array.from({ length: 1000 }, (_, i) => ({ id: i, value: `v${i}` }));
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
    cloned[500].id = -1;
    expect(input[500].id).toBe(500);
  });

  // === Additional DenseArray edge case tests ===

  test("shared object reference in source array preserves identity", () => {
    const shared = { x: 1, y: "hello" };
    const input = [shared, shared, shared];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
    // structuredClone preserves shared references per the HTML spec
    expect(cloned[0]).toBe(cloned[1]);
    expect(cloned[1]).toBe(cloned[2]);
    expect(cloned[0]).not.toBe(shared);
    // Mutating one should affect all shared references
    cloned[0].x = 999;
    expect(cloned[1].x).toBe(999);
    expect(cloned[2].x).toBe(999);
  });

  test("objects with long string property values", () => {
    const longStr = Buffer.alloc(10000, "x").toString();
    const input = [
      { data: longStr, id: 1 },
      { data: longStr, id: 2 },
    ];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
    expect(cloned[0].data.length).toBe(10000);
    expect(cloned[1].data.length).toBe(10000);
  });

  test("objects with unicode property names and values", () => {
    const input = [
      { "\u{1F600}": "smile", name: "\u{1F4A9}" },
      { "\u{1F600}": "grin", name: "\u{2764}" },
    ];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
  });

  test("first element is primitive, objects appear later in array", () => {
    // Ensures structure cache initializes correctly when first element is not an object
    const input = [1, 2, "hello", { a: 1, b: 2 }, { a: 3, b: 4 }, { a: 5, b: 6 }];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
  });

  test("structure cache miss: first shape has many props, second has few", () => {
    const big = { a: 1, b: 2, c: 3, d: 4, e: 5 };
    const small = { x: 1 };
    const input = [big, small, big, small];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
  });

  test("structure cache miss: same property count but different names", () => {
    const input = [
      { a: 1, b: 2 },
      { x: 1, y: 2 },
      { a: 3, b: 4 },
      { x: 3, y: 4 },
    ];
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
  });

  test("fallback: object with Symbol property in array", () => {
    const sym = Symbol("test");
    const obj: any = { a: 1 };
    obj[sym] = "symbol-value";
    const input = [obj];
    // structuredClone should handle this correctly (Symbols are not cloned)
    const cloned = structuredClone(input);
    expect(cloned[0].a).toBe(1);
    expect(cloned[0][sym]).toBeUndefined();
  });

  test("fallback: object with BigInt property value in array", () => {
    const input = [{ value: 42n }];
    const cloned = structuredClone(input);
    expect(cloned[0].value).toBe(42n);
  });

  test("array of objects survives GC", () => {
    const input = Array.from({ length: 100 }, (_, i) => ({ id: i, name: `item-${i}`, flag: i % 2 === 0 }));
    const clones: any[] = [];
    for (let i = 0; i < 50; i++) {
      clones.push(structuredClone(input));
      if (i % 10 === 0) Bun.gc(true);
    }
    Bun.gc(true);
    // Verify all clones are still valid after GC
    for (const clone of clones) {
      expect(clone.length).toBe(100);
      expect(clone[0]).toEqual({ id: 0, name: "item-0", flag: true });
      expect(clone[99]).toEqual({ id: 99, name: "item-99", flag: false });
    }
  });

  test("structuredClone of array of objects does not crash under repeated GC", () => {
    const input = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      name: `item-${i}`,
      active: i % 2 === 0,
    }));
    for (let i = 0; i < 200; i++) {
      const cloned = structuredClone(input);
      expect(cloned.length).toBe(50);
      if (i % 20 === 0) Bun.gc(true);
    }
  });

  test("SerializedScriptValue can be deserialized multiple times (postMessage to two ports)", async () => {
    // Verify the serialized value is not consumed after first deserialization
    const { port1: p1a, port2: p1b } = new MessageChannel();
    const { port1: p2a, port2: p2b } = new MessageChannel();
    const input = [
      { id: 1, val: "one" },
      { id: 2, val: "two" },
    ];

    const { promise: promise1, resolve: resolve1 } = Promise.withResolvers();
    const { promise: promise2, resolve: resolve2 } = Promise.withResolvers();
    p1b.onmessage = e => resolve1(e.data);
    p2b.onmessage = e => resolve2(e.data);

    // structuredClone for each postMessage creates separate serialized values,
    // but let's verify concurrent postMessage works
    p1a.postMessage(input);
    p2a.postMessage(input);

    const [result1, result2] = await Promise.all([promise1, promise2]);
    expect(result1).toEqual(input);
    expect(result2).toEqual(input);

    p1a.close();
    p1b.close();
    p2a.close();
    p2b.close();
  });

  test("array of objects with all-integer property values", () => {
    const input = Array.from({ length: 20 }, (_, i) => ({ a: i, b: i * 2, c: i * 3 }));
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
  });

  test("array of objects with all-string property values", () => {
    const input = Array.from({ length: 20 }, (_, i) => ({
      first: `first-${i}`,
      last: `last-${i}`,
    }));
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
  });

  test("array of objects with all-boolean property values", () => {
    const input = Array.from({ length: 20 }, (_, i) => ({
      a: i % 2 === 0,
      b: i % 3 === 0,
    }));
    const cloned = structuredClone(input);
    expect(cloned).toEqual(input);
  });

  test("fallback: array containing both simple objects and TypedArray", () => {
    const input = [{ a: 1 }, new Uint8Array([1, 2, 3])];
    const cloned = structuredClone(input);
    expect(cloned[0]).toEqual({ a: 1 });
    expect(new Uint8Array(cloned[1] as any)).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("fallback: array containing object with function-like structure", () => {
    // Proxy objects that look object-like but aren't FinalObjectType
    const input = [
      { a: 1 },
      new (class MyObj {
        x = 42;
      })(),
    ];
    const cloned = structuredClone(input);
    expect(cloned[0]).toEqual({ a: 1 });
    expect(cloned[1]).toEqual({ x: 42 });
  });

  test("object property ordering is preserved after clone", () => {
    const input = [
      { z: 1, a: 2, m: 3 },
      { z: 4, a: 5, m: 6 },
    ];
    const cloned = structuredClone(input);
    expect(Object.keys(cloned[0])).toEqual(["z", "a", "m"]);
    expect(Object.keys(cloned[1])).toEqual(["z", "a", "m"]);
    expect(cloned).toEqual(input);
  });

  test("postMessage with large array of same-shape objects via MessageChannel", async () => {
    const { port1, port2 } = new MessageChannel();
    const input = Array.from({ length: 500 }, (_, i) => ({ id: i, name: `item-${i}` }));
    const { promise, resolve } = Promise.withResolvers();
    port2.onmessage = e => resolve(e.data);
    port1.postMessage(input);
    const result = await promise;
    expect(result).toEqual(input);
    port1.close();
    port2.close();
  });

  test("postMessage with alternating shapes via MessageChannel", async () => {
    const { port1, port2 } = new MessageChannel();
    const input = [{ a: 1 }, { x: "hello", y: true }, { a: 2 }, { x: "world", y: false }];
    const { promise, resolve } = Promise.withResolvers();
    port2.onmessage = e => resolve(e.data);
    port1.postMessage(input);
    const result = await promise;
    expect(result).toEqual(input);
    port1.close();
    port2.close();
  });
});

// structuredClone() copies a tree of plain objects, arrays, strings and other primitives object by
// object. One value of another kind, anywhere in the tree, sends the whole value through serialization.
describe("structuredClone of a tree of plain objects and arrays", () => {
  // The prototypes a clone has, by identity: the Object.prototype of another realm is none of them.
  const prototypes = new Map<unknown, string>([
    [Object.prototype, "Object"],
    [Array.prototype, "Array"],
    [Date.prototype, "Date"],
    [Map.prototype, "Map"],
  ]);

  // Everything script can tell about a value: prototypes, extensibility, own keys in order with their
  // attributes, and which objects are the same object.
  function shape(value: unknown, seen = new Map<object, number>()): unknown {
    if (typeof value === "bigint") return `${value}n`;
    if (typeof value === "number") return Object.is(value, -0) ? "-0" : Number.isNaN(value) ? "NaN" : value;
    if (typeof value === "undefined") return "undefined";
    if (typeof value !== "object" || value === null) return value;
    if (seen.has(value)) return `same as #${seen.get(value)}`;
    seen.set(value, seen.size);
    const proto = Object.getPrototypeOf(value);
    return {
      id: seen.get(value),
      proto: prototypes.get(proto) ?? `another: ${proto?.constructor?.name}`,
      extensible: Object.isExtensible(value),
      time: value instanceof Date ? value.getTime() : undefined,
      entries: value instanceof Map ? [...value].map(([k, v]) => [shape(k, seen), shape(v, seen)]) : undefined,
      keys: Reflect.ownKeys(value).map(key => {
        const { value: held, get, set, ...attributes } = Object.getOwnPropertyDescriptor(value, key)!;
        return [String(key), attributes, get || set ? "accessor" : shape(held, seen)];
      }),
    };
  }

  // No object of the clone is an object of the input.
  function objectsOf(value: unknown, out = new Set<object>()) {
    if (typeof value !== "object" || value === null || out.has(value)) return out;
    out.add(value);
    for (const key of Reflect.ownKeys(value)) objectsOf((value as any)[key], out);
    return out;
  }

  // The serializer, which a transfer list always goes through.
  const serialized = (value: unknown) => structuredClone(value, { transfer: [new ArrayBuffer(1)] });

  const shared = { s: 1 };
  const cyclic: any = { name: "cycle", list: [] };
  cyclic.self = cyclic;
  cyclic.list.push(cyclic, cyclic.list);
  const withNamed: any = [1, 2];
  withNamed.extra = "x";
  class Point {
    x = 1;
    y = { z: 2 };
  }
  const dictionary: any = {};
  for (let i = 0; i < 200; i++) dictionary[`k${i}`] = { i };
  const deleted: any = { a: 1, b: { c: 2 }, d: 3 };
  delete deleted.a;
  const outOfLine: any = {};
  for (let i = 0; i < 40; i++) outOfLine[`p${i}`] = i % 3 ? { i } : [i, `${i}`];
  const chainOf = (length: number) => {
    const chain: any = {};
    for (let i = 0, cursor = chain; i < length; i++) cursor = cursor.next = { i };
    return chain;
  };

  const trees: Record<string, unknown> = {
    "primitives of every kind": { a: 1, b: "two", c: null, d: undefined, e: true, f: 1.5, g: -0, h: NaN },
    "an empty object": {},
    "an empty array": [],
    "empty objects and arrays inside": { o: {}, a: [], list: [{}, []] },
    "objects in objects": { a: { b: { c: { d: [1, 2, { e: "f" }] } } } },
    "arrays of every shape": {
      ints: [1, 2],
      doubles: [1.5, -0, Infinity],
      mixed: [1, "a", null, undefined, { a: 1 }, [2]],
    },
    "an object held four times": { a: shared, b: shared, list: [shared, shared] },
    "an object that holds itself": cyclic,
    "more objects than are searched one by one": Array.from({ length: 300 }, (_, i) => ({
      i,
      tags: ["a"],
      nested: { shared },
    })),
    "properties out of line": outOfLine,
    "a chain 200 objects long": chainOf(200),
    "a NaN among doubles": [1.5, NaN],
    // A hole stays a hole, in an array of any shape.
    "holes": { ints: [1, , 3], doubles: [1.5, , 2.5], objects: [{ a: 1 }, , "x"], nothing: new Array(3), tail: [1, 2, ,] }, // prettier-ignore
    // A concatenation is not one string until it is read, and is read to be cloned.
    "concatenations that were not read": (() => {
      const now = String(Date.now());
      return { a: "a" + now, list: ["b" + now, `c${now}`, { d: now + now }] };
    })(),
    // A frozen object is copied as well, with the structure it had before it was frozen.
    "frozen objects": { frozen: Object.freeze({ a: { b: 1 }, list: [1, 2] }), large: Object.freeze({ ...outOfLine }) },
    // Each of these has something that is not plain. An object that had a property deleted counts: its structure is not shared.
    "a deleted property": deleted,
    "an array with a named property": { list: withNamed },
    "an Array subclass": [new (class List extends Array {})(1, 2)],
    "a class instance": { point: new Point() },
    "a null prototype": { bare: Object.assign(Object.create(null), { a: { b: 1 } }) },
    "a frozen array, a sealed and a non-extensible object": {
      list: Object.freeze([1, { a: 1 }]),
      sealed: Object.seal({ a: { b: 1 } }),
      closed: Object.preventExtensions({ a: { b: 1 } }),
    },
    // Writable and configurable, so that being non-enumerable is all that sets it apart.
    "a non-enumerable property": [
      Object.defineProperty({ a: 1 }, "hidden", {
        value: { x: 1 },
        writable: true,
        enumerable: false,
        configurable: true,
      }),
    ],
    // A slice shares the string it was taken from, read or not: the clone gets a string of its own.
    "slices of a string": (() => {
      const source = Buffer.alloc(4096, "abc").toString();
      const read = source.slice(100, 300);
      read.charCodeAt(0);
      return {
        unread: source.slice(10, 200),
        read,
        list: [source.slice(7, 90)],
        whole: source,
        joined: source.slice(3, 50) + "!",
      };
    })(),
    "a read-only property": [
      Object.defineProperty({ a: 1 }, "fixed", {
        value: { x: 1 },
        writable: false,
        enumerable: true,
        configurable: true,
      }),
    ],
    "a getter": { o: { get b() { return { c: 2 }; } } }, // prettier-ignore
    "a symbol key": { a: { b: 1, [Symbol("s")]: { c: 2 } } },
    "index keys on an object": { o: { 0: "a", 1: { b: 1 }, x: 2 } },
    "an own property named __proto__": JSON.parse('{"o": {"__proto__": {"a": 1}, "b": {"c": 2}}}'),
    "an object in dictionary mode": { dictionary },
    "a Date": { when: new Date(5), inner: { a: 1 } },
    "a Map": { map: new Map([["k", { v: 1 }]]), inner: { a: 1 } },
    "a BigInt": { big: 10n, inner: { a: 1 } },
    "objects of another realm": runInNewContext("({ a: 1, list: [1, 2, { b: 2 }], empty: {} })"),
  };

  test.each(Object.keys(trees))("%s clones as serialization clones it", name => {
    const input = trees[name];
    const clone = structuredClone(input);
    expect(shape(clone)).toEqual(shape(serialized(input)));
    const inputObjects = objectsOf(input);
    expect([...objectsOf(clone)].filter(object => inputObjects.has(object))).toEqual([]);
  });

  test("an object held several times is cloned once", () => {
    const clone: any = structuredClone(trees["an object held four times"]);
    expect([clone.a === clone.b, clone.list[0] === clone.a, clone.list[1] === clone.a, clone.a === shared]).toEqual([
      true,
      true,
      true,
      false,
    ]);
    const self: any = structuredClone(cyclic);
    expect([self.self === self, self.list[0] === self, self.list[1] === self.list, self === cyclic]).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  // Each is cloned on its own: the first and the last are copied, the two in between are serialized.
  test("the clone is plain whatever the input was", () => {
    const frozen: any = structuredClone({ frozen: Object.freeze({ a: [1, 2] }) }).frozen;
    const point = structuredClone({ point: new Point() }).point;
    const symbols = structuredClone({ symbols: { a: 1, [Symbol("s")]: 2 } }).symbols;
    const hole = structuredClone({ hole: [1, , 3] }).hole;
    const isFrozen = Object.isFrozen(frozen);
    frozen.a.push(3);
    frozen.b = 1;
    expect({
      frozen: [isFrozen, frozen],
      point: [Object.getPrototypeOf(point) === Object.prototype, point],
      symbols: Reflect.ownKeys(symbols),
      hole: [1 in hole, hole.length],
    }).toEqual({
      frozen: [false, { a: [1, 2, 3], b: 1 }],
      point: [true, { x: 1, y: { z: 2 } }],
      symbols: ["a"],
      hole: [false, 3],
    });
  });

  test("a hole is not filled from Array.prototype", () => {
    const holes = { ints: [1, , 3], doubles: [1.5, , 2.5], objects: [{ a: 1 }, , "x"], nothing: new Array(3) }; // prettier-ignore
    (Array.prototype as any)[1] = "inherited";
    try {
      const clone = structuredClone(holes);
      expect({
        own: Object.values(clone).map(list => Object.keys(list)),
        asSerialized: Bun.deepEquals(shape(clone), shape(serialized(holes)), true),
      }).toEqual({ own: [["0", "2"], ["0", "2"], ["0", "2"], []], asSerialized: true });
    } finally {
      delete (Array.prototype as any)[1];
    }
  });

  test("what cannot be cloned still throws, wherever it is in the tree", () => {
    for (const input of [{ a: { f() {} } }, [{ a: 1 }, [Symbol("x")]], { a: [1, 2, { p: new Proxy({}, {}) }] }]) {
      expect(() => structuredClone(input)).toThrow(
        expect.objectContaining({ name: "DataCloneError", message: "The object can not be cloned." }),
      );
    }
  });

  test("the options are read before the value", () => {
    const order: string[] = [];
    const clone = structuredClone(
      { inner: { get a() { order.push("value"); return 1; } } }, // prettier-ignore
      { get transfer() { order.push("transfer"); return []; } }, // prettier-ignore
    );
    expect({ order, clone }).toEqual({ order: ["transfer", "value"], clone: { inner: { a: 1 } } });
  });

  test("a chain deeper than the copy goes is serialized, and one too deep for that throws", () => {
    // [objects in the clone, `i` of the last one]
    const cloned = (length: number) => {
      let count = 0;
      let last = -1;
      for (let cursor = structuredClone(chainOf(length)).next; cursor; cursor = cursor.next) {
        count++;
        last = cursor.i;
      }
      return [count, last];
    };
    // 512 is where the copy stops and serialization takes over.
    const lengths = [510, 511, 512, 513, 2000];
    expect(lengths.map(cloned)).toEqual(lengths.map(length => [length, length - 1]));
    // 40000 is where serialization stops. Arrays, which a debug build serializes several times faster than objects.
    const tooDeep: unknown[] = [];
    for (let i = 0, cursor = tooDeep; i < 40_001; i++) {
      const next: unknown[] = [];
      cursor.push(next);
      cursor = next;
    }
    expect(() => structuredClone(tooDeep)).toThrow(
      expect.objectContaining({ name: "RangeError", message: "Maximum call stack size exceeded." }),
    );
  });

  test("a clone can be changed without changing its input", () => {
    const input = { list: [1, 2, 3], doubles: [0.5], o: { a: { b: "c" } }, items: [{ id: 1 }] };
    const clone = structuredClone(input);
    clone.list.push(4);
    clone.doubles[0] = 1.5;
    clone.o.a.b = "changed";
    (clone.o as any).added = true;
    clone.items[0].id = 2;
    expect(input).toEqual({ list: [1, 2, 3], doubles: [0.5], o: { a: { b: "c" } }, items: [{ id: 1 }] });
    expect(clone).toEqual({
      list: [1, 2, 3, 4],
      doubles: [1.5],
      o: { a: { b: "changed" }, added: true },
      items: [{ id: 2 }],
    } as any);
  });

  // Serialization allocates its buffer and the value that owns it; the copy allocates only the clones, which
  // are not the allocator's. An ASAN build does not allocate through mimalloc.
  test.skipIf(isASAN).concurrent("a plain tree is cloned without what serialization allocates", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { heapStats } = require("bun:jsc");
         const plain = { title: { absolute: "Blog", template: null }, list: [1, 2, { a: "b" }], other: {} };
         const perClone = value => {
           structuredClone(value);
           const before = heapStats().mimalloc.malloc_requested;
           for (let i = 0; i < 1000; i++) structuredClone(value);
           return (heapStats().mimalloc.malloc_requested - before) / 1000;
         };
         const copied = perClone(plain);
         const serialized = perClone({ ...plain, when: new Date(0) });
         console.log(JSON.stringify({ serializationAllocates: serialized > 1000, copyAllocatesLess: copied < serialized / 4 }));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: JSON.stringify({ serializationAllocates: true, copyAllocatesLess: true }),
      stderr: "",
      exitCode: 0,
    });
  });

  // A slice keeps the string it was taken from alive, and so does a concatenation that holds one until it is read.
  // Serialization copies a string, so a clone never did.
  test.concurrent.each([
    ["a slice that was not read", "source.slice(10, 4000)", 3990],
    ["a slice that was read", "(part => (part.charCodeAt(0), part))(source.slice(100, 4000))", 3900],
    ["a slice in an array", "[source.slice(5, 4000)]", 3995],
    ["a concatenation that holds a slice", 'source.slice(20, 4000) + "!"', 3981],
  ])("a clone of %s does not keep the string it was taken from alive", async (_, expression, length) => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { heapStats } = require("bun:jsc");
         function cloned() {
           const source = Buffer.alloc(32 << 20, "x").toString("latin1");
           return structuredClone({ value: ${expression} });
         }
         const clone = cloned();
         await new Promise(resolve => setImmediate(resolve));
         Bun.gc(true);
         console.log(JSON.stringify({
           length: [clone.value].flat()[0].length,
           keepsTheSource: heapStats().extraMemorySize > 16 << 20,
         }));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: JSON.stringify({ length, keepsTheSource: false }),
      stderr: "",
      exitCode: 0,
    });
  });
});
