import { describe, expect, test } from "bun:test";
import vm from "node:vm";

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
    for (const ok of [undefined, null, true, 1.5, "str", 10n, b, Symbol("s"), Symbol.for("registered")]) {
      a.value = ok;
      expect(a.value).toBe(ok);
    }
    for (const bad of [{}, [], () => {}]) {
      expect(() => {
        a.value = bad;
      }).toThrow(TypeError);
    }
  });

  test("shared structs cannot have instance methods, accessors or private names (early errors)", () => {
    for (const body of ["m() {}", "get g() { return 1; }", "set s(v) {}", "*gen() {}", "async am() {}", "#p;", "#m() {}"]) {
      expect(() => new vm.Script(`shared struct S { x; ${body} }`)).toThrow(SyntaxError);
    }
    // Static elements and the constructor are fine.
    expect(
      () => new vm.Script("shared struct S { x; static m() {} static #p = 1; static { } constructor() { } }"),
    ).not.toThrow();
  });

  test("shared structs cannot extend plain structs", () => {
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
    expect(Reflect.canBeShared(Symbol("s"))).toBe(true);
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

  test("overwriting a field with strings and nested structs stays correct", () => {
    shared struct Node {
      value;
    }
    const parent = new Node();
    for (let i = 0; i < 2000; i++) {
      parent.value = `string ${i}`;
      expect(parent.value).toBe(`string ${i}`);
      const child = new Node();
      child.value = i;
      parent.value = child;
      expect(parent.value.value).toBe(i);
    }
    // Strings compare by content, not by which allocation holds them.
    parent.value = "same";
    expect(Atomics.compareExchange(parent, "value", "sa" + "me", "next")).toBe("same");
    expect(parent.value).toBe("next");
    expect(Atomics.compareExchange(parent, "value", "other", "never")).toBe("next");
    expect(parent.value).toBe("next");
  });

  test("Atomics still works on typed arrays", () => {
    const ia = new Int32Array(new SharedArrayBuffer(8));
    Atomics.store(ia, 0, 7);
    expect(Atomics.load(ia, 0)).toBe(7);
  });
});
