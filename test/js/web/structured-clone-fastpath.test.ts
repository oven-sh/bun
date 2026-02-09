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
