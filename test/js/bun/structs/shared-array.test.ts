import { describe, expect, test } from "bun:test";

describe("SharedArray", () => {
  test("constructor takes no argument, a length, or two or more elements", () => {
    expect(new SharedArray().length).toBe(0);
    expect(new SharedArray(2).length).toBe(2);
    expect(() => new SharedArray("2" as any)).toThrow(TypeError);
    expect(() => new SharedArray(1.5)).toThrow(TypeError);
    expect(() => new SharedArray(Infinity)).toThrow(TypeError);
    expect(() => new SharedArray(-1)).toThrow(RangeError);
    const filled = new SharedArray(1, "x", 2n);
    expect([filled.length, filled[0], filled[1], filled[2]]).toEqual([3, 1, "x", 2n]);
    expect(new SharedArray(5, 6)[0]).toBe(5);
    expect(() => new SharedArray(1, {} as any)).toThrow(TypeError);
    expect(SharedArray.length).toBe(0);
  });

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
