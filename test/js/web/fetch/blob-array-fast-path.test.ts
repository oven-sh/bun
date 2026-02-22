import { expect, test } from "bun:test";

test("basic string array", async () => {
  const blob = new Blob(["hello", " ", "world"]);
  expect(await blob.text()).toBe("hello world");
});

test("large array (10000 elements)", async () => {
  const parts = Array.from({ length: 10000 }, (_, i) => `${i},`);
  const blob = new Blob(parts);
  const text = await blob.text();
  expect(text).toBe(parts.join(""));
});

test("array with holes is handled", async () => {
  const arr = ["a", , "b", , "c"] as unknown as string[];
  const blob = new Blob(arr);
  // holes become undefined which are skipped
  expect(await blob.text()).toBe("abc");
});

test("undefined and null elements are skipped", async () => {
  const blob = new Blob(["start", undefined as any, null as any, "end"]);
  expect(await blob.text()).toBe("startend");
});

test("Proxy array is rejected", async () => {
  const arr = new Proxy(["a", "b", "c"], {
    get(target, prop) {
      return Reflect.get(target, prop);
    },
  });
  expect(() => new Blob(arr as any)).toThrow("new Blob() expects an Array");
});

test("prototype getter causes slow path fallback", async () => {
  const arr = ["x", "y", "z"];
  Object.defineProperty(Array.prototype, "1000", {
    get() {
      return "intercepted";
    },
    configurable: true,
  });
  try {
    const blob = new Blob(arr);
    expect(await blob.text()).toBe("xyz");
  } finally {
    delete (Array.prototype as any)["1000"];
  }
});

test("nested arrays in blob parts", async () => {
  // Nested arrays are not valid BlobParts per spec; elements before
  // the nested array are processed inline
  const blob = new Blob(["before", ["a", "b"] as any, "after"]);
  expect(await blob.text()).toBe("before");
});

test("mixed types: string + TypedArray + Blob", async () => {
  const innerBlob = new Blob(["inner"]);
  const arr = ["start-", new Uint8Array([65, 66, 67]), innerBlob, "-end"];
  const blob = new Blob(arr as any);
  expect(await blob.text()).toBe("start-ABCinner-end");
});

test("toString side effects with custom objects", async () => {
  const order: number[] = [];
  const items = [1, 2, 3].map(n => ({
    toString() {
      order.push(n);
      return `item${n}`;
    },
  }));
  const blob = new Blob(items as any);
  // Objects with toString are processed via stack (LIFO order)
  expect(await blob.text()).toBe("item3item2item1");
  expect(order).toEqual([3, 2, 1]);
});

test("empty array", async () => {
  const blob = new Blob([]);
  expect(blob.size).toBe(0);
  expect(await blob.text()).toBe("");
});

test("DerivedArray (class extending Array)", async () => {
  class MyArray extends Array {
    constructor(...items: any[]) {
      super(...items);
    }
  }
  const arr = new MyArray("hello", " ", "derived");
  const blob = new Blob(arr);
  expect(await blob.text()).toBe("hello derived");
});

test("COW (Copy-on-Write) array from literal", async () => {
  // Array literals may start as COW in JSC
  const blob = new Blob(["cow", "test"]);
  expect(await blob.text()).toBe("cowtest");
});

test("frozen array works correctly", async () => {
  const arr = Object.freeze(["frozen", "-", "array"]);
  const blob = new Blob(arr as any);
  expect(await blob.text()).toBe("frozen-array");
});

test("sparse array (ArrayStorage) uses slow path correctly", async () => {
  const arr: string[] = [];
  arr[0] = "first";
  arr[100] = "last";
  const blob = new Blob(arr);
  const text = await blob.text();
  expect(text).toBe("firstlast");
});

test("single-element array optimization", async () => {
  const blob = new Blob(["only"]);
  expect(await blob.text()).toBe("only");
});
