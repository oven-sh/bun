import { describe, expect, test } from "bun:test";

describe("Bun.inspect WeakMap/WeakSet", () => {
  test("WeakMap with user-defined size property does not throw", () => {
    const wm = new WeakMap();
    // @ts-expect-error
    wm.size = 1000;
    expect(Bun.inspect(wm)).toBe("WeakMap {}");
  });

  test("WeakSet with user-defined size property does not throw", () => {
    const ws = new WeakSet();
    // @ts-expect-error
    ws.size = 1000;
    expect(Bun.inspect(ws)).toBe("WeakSet {}");
  });

  test("WeakMap with size getter does not invoke it", () => {
    const wm = new WeakMap();
    let called = false;
    Object.defineProperty(wm, "size", {
      get() {
        called = true;
        throw new Error("should not be called");
      },
    });
    expect(Bun.inspect(wm)).toBe("WeakMap {}");
    expect(called).toBe(false);
  });

  test("WeakSet with size getter does not invoke it", () => {
    const ws = new WeakSet();
    let called = false;
    Object.defineProperty(ws, "size", {
      get() {
        called = true;
        throw new Error("should not be called");
      },
    });
    expect(Bun.inspect(ws)).toBe("WeakSet {}");
    expect(called).toBe(false);
  });

  test("toMatchObject diff with WeakMap that has size does not crash", () => {
    const wm = new WeakMap();
    // @ts-expect-error
    wm.size = 2;
    expect(() => expect(wm).toMatchObject([1, 2])).toThrow();
  });

  test("toMatchObject diff with WeakSet that has size does not crash", () => {
    const ws = new WeakSet();
    // @ts-expect-error
    ws.size = 2;
    expect(() => expect(ws).toMatchObject([1, 2])).toThrow();
  });

  test("toEqual diff with WeakMap that has size does not crash", () => {
    const wm = new WeakMap();
    // @ts-expect-error
    wm.size = 2;
    expect(() => expect(wm).toEqual([1, 2])).toThrow();
  });

  test("toEqual diff with WeakSet that has size does not crash", () => {
    const ws = new WeakSet();
    // @ts-expect-error
    ws.size = 2;
    expect(() => expect(ws).toEqual([1, 2])).toThrow();
  });

  test("normal Map still shows entries", () => {
    const m = new Map([["a", 1]]);
    expect(Bun.inspect(m)).toContain("Map(1)");
    expect(Bun.inspect(m)).toContain('"a"');
  });

  test("normal Set still shows entries", () => {
    const s = new Set(["a"]);
    expect(Bun.inspect(s)).toContain("Set(1)");
    expect(Bun.inspect(s)).toContain('"a"');
  });
});
