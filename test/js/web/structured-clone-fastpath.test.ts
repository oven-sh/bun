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

  test("structuredClone should fallback for arrays with nested objects", () => {
    const input = [{ a: 1 }, { b: 2 }];
    expect(structuredClone(input)).toEqual(input);
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
});
