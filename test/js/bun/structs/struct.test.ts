import { describe, expect, test } from "bun:test";

// https://github.com/tc39/proposal-structs: unshared structs.

describe("struct", () => {
  test("fields start undefined and instances are sealed", () => {
    struct Point {
      x;
      y;
    }
    const p = new Point();
    expect(p.x).toBeUndefined();
    expect(p.y).toBeUndefined();
    expect(Object.keys(p)).toEqual(["x", "y"]);
    expect(Object.isExtensible(p)).toBe(false);
    expect(() => {
      "use strict";
      (p as any).z = 1;
    }).toThrow(TypeError);
    expect(Reflect.deleteProperty(p, "x")).toBe(false);
    p.x = 1;
    expect(p.x).toBe(1);
  });

  test("constructor can use this immediately, super() is optional", () => {
    struct Point {
      x;
      y;
      constructor(x, y) {
        this.x = x;
        this.y = y;
      }
      sum() {
        return this.x + this.y;
      }
    }
    expect(new Point(1, 2).sum()).toBe(3);
  });

  test("structs extend structs and inherit fields", () => {
    struct A {
      a;
      constructor() {
        this.a = 1;
      }
    }
    struct B extends A {
      b;
      constructor() {
        super();
        this.b = 2;
      }
    }
    const b = new B();
    expect(Object.keys(b)).toEqual(["a", "b"]);
    expect(b.a + b.b).toBe(3);
    expect(b instanceof A).toBe(true);
  });

  test("a struct can only extend a struct", () => {
    class NotAStruct {}
    expect(() => {
      struct Bad extends NotAStruct {
        x;
      }
      return Bad;
    }).toThrow(TypeError);
  });

  test("methods are not generic", () => {
    struct S {
      v;
      get() {
        return this.v;
      }
    }
    const s = new S();
    s.v = 5;
    expect(s.get()).toBe(5);
    expect(() => S.prototype.get.call({ v: 1 })).toThrow(TypeError);
  });

  test("prototype and constructor are locked down", () => {
    struct S {
      v;
      m() {}
    }
    new S();
    expect(Object.isExtensible(S.prototype)).toBe(false);
    expect(() => {
      "use strict";
      (S.prototype as any).extra = 1;
    }).toThrow(TypeError);
    expect(() => Object.setPrototypeOf(new S(), {})).toThrow(TypeError);
  });

  test("fields cannot have initializers", () => {
    expect(() => new Function("struct S { x = 1; }")).toThrow(SyntaxError);
  });

  test("struct stays usable as an identifier", () => {
    const struct = 1;
    const shared = 2;
    expect(struct + shared).toBe(3);
  });
});
