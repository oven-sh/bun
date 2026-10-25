import { describe, expect, test } from "bun:test";

// https://github.com/tc39/proposal-structs: shared structs.

describe("shared struct", () => {
  test("has a null prototype and sealed fields", () => {
    shared struct Box {
      value;
    }
    const b = new Box();
    expect(Object.getPrototypeOf(b)).toBeNull();
    expect(b.value).toBeUndefined();
    expect(Object.isExtensible(b)).toBe(false);
    b.value = 1;
    expect(b.value).toBe(1);
  });

  test("fields hold primitives and shared structs only", () => {
    shared struct Box {
      value;
    }
    const a = new Box();
    const b = new Box();
    for (const ok of [undefined, null, true, 1.5, "str", 10n, b]) {
      a.value = ok;
      expect(a.value).toBe(ok);
    }
    for (const bad of [{}, [], () => {}, Symbol("s")]) {
      expect(() => {
        a.value = bad;
      }).toThrow(TypeError);
    }
  });

  test("shared structs cannot have instance methods or extend plain structs", () => {
    expect(() => {
      shared struct WithMethod {
        x;
        m() {}
      }
      new WithMethod();
    }).toThrow(TypeError);
    struct Plain {
      x;
    }
    expect(() => {
      shared struct Bad extends Plain {
        y;
      }
      return Bad;
    }).toThrow(TypeError);
  });

  test("Reflect.canBeShared", () => {
    shared struct Box {
      value;
    }
    expect(Reflect.canBeShared(1)).toBe(true);
    expect(Reflect.canBeShared("s")).toBe(true);
    expect(Reflect.canBeShared(null)).toBe(true);
    expect(Reflect.canBeShared(new Box())).toBe(true);
    expect(Reflect.canBeShared({})).toBe(false);
    expect(Reflect.canBeShared(() => {})).toBe(false);
    expect(Reflect.canBeShared(Symbol("s"))).toBe(false);
  });

  test("Atomics on struct fields", () => {
    shared struct Counter {
      n;
    }
    const c = new Counter();
    Atomics.store(c, "n", 1);
    expect(Atomics.load(c, "n")).toBe(1);
    expect(Atomics.exchange(c, "n", 2)).toBe(1);
    expect(Atomics.compareExchange(c, "n", 9, 3)).toBe(2);
    expect(Atomics.load(c, "n")).toBe(2);
    expect(Atomics.compareExchange(c, "n", 2, 3)).toBe(2);
    expect(Atomics.load(c, "n")).toBe(3);
  });

  test("Atomics.load and exchange keep the identity of a nested shared struct", () => {
    shared struct Node {
      child;
    }
    const parent = new Node();
    const child = new Node();
    const other = new Node();
    parent.child = child;
    expect(Atomics.load(parent, "child")).toBe(child);
    expect(Atomics.load(parent, "child")).toBe(Atomics.load(parent, "child"));
    expect(Atomics.load(parent, "child")).toBe(parent.child);
    expect(Atomics.exchange(parent, "child", other)).toBe(child);
    expect(parent.child).toBe(other);
    expect(Atomics.exchange(parent, "child", child)).toBe(other);
    expect(Atomics.compareExchange(parent, "child", child, other)).toBe(child);
    expect(Atomics.load(parent, "child")).toBe(other);
    expect(parent.child).toBe(other);
    Atomics.store(parent, "child", child);
    expect(parent.child).toBe(child);
  });

  test("Atomics.compareExchange accepts an expected value that cannot be shared", () => {
    shared struct Counter {
      n;
    }
    const c = new Counter();
    c.n = 1;
    const plain = {};
    expect(Atomics.compareExchange(c, "n", plain, 2)).toBe(1);
    expect(c.n).toBe(1);
    expect(Atomics.compareExchange(c, "n", () => {}, 2)).toBe(1);
    expect(Atomics.compareExchange(c, "n", Symbol("s"), 2)).toBe(1);
    expect(c.n).toBe(1);
    // The replacement still has to be shareable.
    expect(() => Atomics.compareExchange(c, "n", 1, plain)).toThrow(TypeError);
    expect(c.n).toBe(1);
  });

  test("Atomics still works on typed arrays", () => {
    const ia = new Int32Array(new SharedArrayBuffer(8));
    Atomics.store(ia, 0, 7);
    expect(Atomics.load(ia, 0)).toBe(7);
  });
});
