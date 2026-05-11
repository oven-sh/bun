import { describe, expect, test } from "bun:test";

describe("Structured Clone Fast Path", () => {
  test("structuredClone should work with empty object", () => {
    const object = {};
    const cloned = structuredClone(object);
    expect(cloned).toStrictEqual({});
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
    const rss = process.memoryUsage.rss();
    for (let i = 0; i < 10000; i++) {
      clones.push(structuredClone(largeString));
    }
    Bun.gc(true);
    const rss2 = process.memoryUsage.rss();
    const delta = rss2 - rss;
    expect(delta).toBeLessThan(1024 * 1024 * 8);
    expect(clones.length).toBe(10000 + 100);
  });

  test("structuredClone should use a constant amount of memory for simple object inputs", () => {
    // Create a 512KB string to test fast path
    const largeValue = { property: Buffer.alloc(512 * 1024, "a").toString() };
    for (let i = 0; i < 100; i++) {
      structuredClone(largeValue);
    }
    Bun.gc(true);
    const rss = process.memoryUsage.rss();
    for (let i = 0; i < 10000; i++) {
      structuredClone(largeValue);
    }
    Bun.gc(true);
    const rss2 = process.memoryUsage.rss();
    const delta = rss2 - rss;
    expect(delta).toBeLessThan(1024 * 1024);
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
    port2.onmessage = (e: MessageEvent) => resolve(e.data);
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
    port2.onmessage = (e: MessageEvent) => resolve(e.data);
    port1.postMessage(input);
    const result = await promise;
    expect(result).toEqual(input);
    port1.close();
    port2.close();
  });

  // === Edge case tests ===

  test("structuredClone of frozen array should produce a non-frozen clone", () => {
    const input = Object.freeze([1, 2, 3]);
    const cloned = structuredClone(input);
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
    expect(cloned[1]).toBe(undefined);
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
    expect(cloned[3]).toBe(undefined);
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
    port2.onmessage = (e: MessageEvent) => resolve(e.data);
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
    port2.onmessage = (e: MessageEvent) => resolve(e.data);
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
    class MyArray extends Array {
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
    cloned[1].b.nested = false;
    expect(input[1].b.nested).toBe(true);
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
    expect(cloned[0].x).toBe(42);
  });

  test("fallback: object with non-enumerable property in array", () => {
    const obj = Object.defineProperty({ a: 1 }, "hidden", { value: 2, enumerable: false });
    const input = [obj];
    const cloned = structuredClone(input);
    expect(cloned[0].a).toBe(1);
    // non-enumerable property should not be cloned by structuredClone
    expect(cloned[0].hidden).toBeUndefined();
  });

  test("frozen objects in array produce non-frozen clones", () => {
    const input = [Object.freeze({ a: 1, b: "hello" }), Object.freeze({ a: 2, b: "world" })];
    const cloned = structuredClone(input);
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
    port2.onmessage = (e: MessageEvent) => resolve(e.data);
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
    port2.onmessage = (e: MessageEvent) => resolve(e.data);
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
    p1b.onmessage = (e: MessageEvent) => resolve1(e.data);
    p2b.onmessage = (e: MessageEvent) => resolve2(e.data);

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
    port2.onmessage = (e: MessageEvent) => resolve(e.data);
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
    port2.onmessage = (e: MessageEvent) => resolve(e.data);
    port1.postMessage(input);
    const result = await promise;
    expect(result).toEqual(input);
    port1.close();
    port2.close();
  });
});
