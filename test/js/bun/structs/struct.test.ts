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

  test("a constructor that returns an object still yields the sealed instance", () => {
    let evaluated = 0;
    struct S {
      x;
      constructor() {
        this.x = 1;
        return (evaluated++, { x: 2 });
      }
    }
    const s = new S();
    expect(evaluated).toBe(1);
    expect(s instanceof S).toBe(true);
    expect(Object.isExtensible(s)).toBe(false);
    expect(Object.keys(s)).toEqual(["x"]);
    expect(s.x).toBe(1);
    // A nested function keeps its own return value.
    struct T {
      f;
      constructor() {
        this.f = function () {
          return { y: 1 };
        };
      }
    }
    expect(new T().f()).toEqual({ y: 1 });
  });

  test("super() inside a branch is called exactly once", () => {
    let parentRuns = 0;
    struct A {
      a;
      constructor() {
        parentRuns++;
        this.a = 1;
      }
    }
    struct B extends A {
      b;
      constructor(flag) {
        if (flag) {
          super();
        } else {
          super();
        }
        this.b = 2;
      }
    }
    const b = new B(true);
    expect(parentRuns).toBe(1);
    expect(b.a + b.b).toBe(3);
    new B(false);
    expect(parentRuns).toBe(2);
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

  test("methods reject an object that only inherits from the prototype", () => {
    struct S {
      v;
      get() {
        return this.v;
      }
    }
    const s = new S();
    expect(s.get()).toBeUndefined();
    const fake = Object.create(S.prototype);
    fake.v = 1;
    expect(() => S.prototype.get.call(fake)).toThrow(TypeError);
    expect(() => (fake as any).get()).toThrow(TypeError);
    struct T extends S {
      w;
    }
    expect(new T().get()).toBeUndefined();
    expect(() => S.prototype.get.call(Object.create(T.prototype))).toThrow(TypeError);
  });

  test("the prototype is sealed as soon as the struct is defined", () => {
    struct S {
      v;
      m() {}
    }
    expect(Object.isExtensible(S.prototype)).toBe(false);
    expect(() => {
      "use strict";
      (S.prototype as any).extra = 1;
    }).toThrow(TypeError);
    new S();
    expect(() => Object.setPrototypeOf(new S(), {})).toThrow(TypeError);
  });

  test("field initializers are accepted", () => {
    struct S {
      x = 1;
    }
    expect(new S().x).toBe(1);
  });

  test("struct stays usable as an identifier", () => {
    const struct = 1;
    const shared = 2;
    expect(struct + shared).toBe(3);
  });
});
