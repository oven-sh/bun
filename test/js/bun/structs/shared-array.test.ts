import { describe, expect, test } from "bun:test";

describe("SharedArray", () => {
  test("has a fixed length and holds shareable values", () => {
    const a = new SharedArray(3);
    expect(a.length).toBe(3);
    expect(a[0]).toBeUndefined();
    a[0] = 1;
    a[1] = "two";
    a[2] = null;
    expect([a[0], a[1], a[2]]).toEqual([1, "two", null]);
    expect(Object.getPrototypeOf(a)).toBeNull();
    expect(Object.isExtensible(a)).toBe(false);
  });

  test("length is read-only and out-of-range writes fail", () => {
    const a = new SharedArray(1);
    expect(() => {
      "use strict";
      (a as any).length = 5;
    }).toThrow(TypeError);
    expect(() => {
      "use strict";
      (a as any)[1] = 1;
    }).toThrow(TypeError);
    expect(a.length).toBe(1);
  });

  test("rejects values that cannot be shared", () => {
    const a = new SharedArray(1);
    expect(() => {
      a[0] = {} as any;
    }).toThrow(TypeError);
    expect(() => {
      a[0] = (() => {}) as any;
    }).toThrow(TypeError);
  });

  test("holds shared structs and other shared arrays by identity", () => {
    shared struct Box {
      v;
    }
    const box = new Box();
    const inner = new SharedArray(1);
    const a = new SharedArray(2);
    a[0] = box;
    a[1] = inner;
    expect(a[0]).toBe(box);
    expect(a[1]).toBe(inner);
  });

  test("Atomics on array indices", () => {
    const a = new SharedArray(1);
    Atomics.store(a, 0, 5);
    expect(Atomics.load(a, 0)).toBe(5);
    expect(Atomics.exchange(a, 0, 6)).toBe(5);
    expect(Atomics.compareExchange(a, 0, 6, 7)).toBe(6);
    expect(Atomics.load(a, 0)).toBe(7);
  });

  test("is visible to a worker without copying", async () => {
    const a = new SharedArray(1);
    a[0] = 1;
    const src = `self.onmessage = ({ data }) => { data[0] = data[0] + 41; postMessage("done"); };`;
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    const worker = new Worker(url);
    const done = new Promise<void>(resolve => (worker.onmessage = () => resolve()));
    worker.postMessage(a);
    await done;
    worker.terminate();
    expect(a[0]).toBe(42);
  });
});
