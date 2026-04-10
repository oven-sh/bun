import { describe, expect, test } from "bun:test";

describe("JSArrayIterator butterfly fast path", () => {
  test("basic string array", async () => {
    const blob = new Blob(["hello", " ", "world"]);
    expect(await blob.text()).toBe("hello world");
  });

  test("large array (10000 elements)", async () => {
    const parts = Array.from({ length: 10000 }, (_, i) => `${i},`);
    const blob = new Blob(parts);
    expect(await blob.text()).toBe(parts.join(""));
  });

  test("mixed types: string + TypedArray + Blob", async () => {
    const innerBlob = new Blob(["inner"]);
    const arr = ["start-", new Uint8Array([65, 66, 67]), innerBlob, "-end"];
    const blob = new Blob(arr as any);
    expect(await blob.text()).toBe("start-ABCinner-end");
  });

  test("empty array", async () => {
    const blob = new Blob([]);
    expect(blob.size).toBe(0);
    expect(await blob.text()).toBe("");
  });

  test("DerivedArray (class extending Array)", async () => {
    class MyArray extends Array {}
    const arr = MyArray.from(["hello", " ", "derived"]);
    const blob = new Blob(arr);
    expect(await blob.text()).toBe("hello derived");
  });

  test("frozen array", async () => {
    const arr = Object.freeze(["frozen", "-", "array"]);
    const blob = new Blob(arr as any);
    expect(await blob.text()).toBe("frozen-array");
  });

  test("sparse array (ArrayStorage shape) falls back to slow path", async () => {
    const arr: string[] = [];
    arr[0] = "first";
    arr[100] = "last";
    const blob = new Blob(arr);
    expect(await blob.text()).toBe("firstlast");
  });

  test("hole + Array.prototype indexed getter consults prototype (slow path)", async () => {
    let calls = 0;
    Object.defineProperty(Array.prototype, 1, {
      get() {
        calls++;
        return "intercepted";
      },
      configurable: true,
    });
    try {
      const arr: string[] = ["x", , "z"] as any;
      const blob = new Blob(arr);
      expect(await blob.text()).toBe("xinterceptedz");
      expect(calls).toBe(1);
    } finally {
      delete (Array.prototype as any)[1];
    }
  });

  test("Int32 indexing type array", async () => {
    const arr = [1, 2, 3];
    const blob = new Blob(arr as any);
    expect(await blob.text()).toBe("123");
  });

  test("non-ASCII strings", async () => {
    const blob = new Blob(["日本語", "テスト"]);
    expect(await blob.text()).toBe("日本語テスト");
  });

  test("revalidation: array mutated mid-iteration via toContainEqual side effect", () => {
    const arr: any[] = ["a", "b"];
    arr.push({
      get x() {
        for (let i = 0; i < 10000; i++) arr.push("pad");
        return 1;
      },
    });
    arr.push("c");
    expect(arr).toContainEqual({ x: 1 });
  });
});
