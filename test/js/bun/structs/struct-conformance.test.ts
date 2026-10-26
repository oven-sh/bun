import { describe, expect, test } from "bun:test";
import vm from "node:vm";

// https://github.com/tc39/proposal-structs: StructDefinitionEvaluation and the struct constructor, element by element.

describe("struct elements", () => {
  test("field initializers run after the instance is sealed, parent first, then the constructor", () => {
    const log: string[] = [];
    struct A {
      a = (log.push("A.a:" + Object.isExtensible(this) + ":" + Object.keys(this).join()), 1);
      constructor() {
        log.push("A.ctor:" + this.a);
      }
    }
    struct B extends A {
      b = (log.push("B.b:" + this.a), 2);
      constructor() {
        super();
        log.push("B.ctor:" + this.b);
      }
    }
    const b = new B();
    expect(log).toEqual(["A.a:false:a,b", "B.b:1", "A.ctor:1", "B.ctor:2"]);
    expect(Object.keys(b)).toEqual(["a", "b"]);
    expect(b.a + b.b).toBe(3);
  });

  test("a field initializer sees the other fields as undefined and its own struct's methods", () => {
    struct S {
      early = this.late;
      late = 5;
      twice = this.double();
      double() {
        return this.late * 2;
      }
    }
    const s = new S();
    expect(s.early).toBeUndefined();
    expect(s.late).toBe(5);
    expect(s.twice).toBe(10);
  });

  test("an initializer cannot add a field, the layout is fixed", () => {
    struct S {
      a = (() => {
        "use strict";
        (this as any).extra = 1;
      })();
    }
    expect(() => new S()).toThrow(TypeError);
  });

  test("computed, numeric, string-literal and symbol field names", () => {
    const key = "k" + 1;
    const sym = Symbol("s");
    let evaluated = 0;
    struct S {
      [key];
      7 = "seven";
      [sym] = 1;
      "quoted name" = 2;
      [(evaluated++, "once")] = 3;
    }
    const s = new S();
    expect(Reflect.ownKeys(s)).toEqual(["7", "k1", "quoted name", "once", sym]);
    expect(s[7]).toBe("seven");
    expect(s[sym]).toBe(1);
    expect(s["quoted name"]).toBe(2);
    new S();
    new S();
    expect(evaluated).toBe(1);
  });

  test("private fields, methods and accessors", () => {
    struct Counter {
      #count = 10;
      #step() {
        return 2;
      }
      get #double() {
        return this.#count * 2;
      }
      set #double(v) {
        this.#count = v / 2;
      }
      inc() {
        this.#count += this.#step();
        return this.#count;
      }
      get doubled() {
        return this.#double;
      }
      set doubled(v) {
        this.#double = v;
      }
      static has(o) {
        return #count in o;
      }
    }
    const c = new Counter();
    expect(c.inc()).toBe(12);
    expect(c.doubled).toBe(24);
    c.doubled = 40;
    expect(c.inc()).toBe(22);
    expect(Object.keys(c)).toEqual([]);
    expect(Object.isSealed(c)).toBe(true);
    expect(Counter.has(c)).toBe(true);
    expect(Counter.has({})).toBe(false);
  });

  test("a private field is undefined until its initializer runs, whatever the order", () => {
    const seen: unknown[] = [];
    struct S {
      a = (seen.push(this.#late), 1);
      #late = "later";
      b = this.#late;
    }
    const s = new S();
    expect(seen).toEqual([undefined]);
    expect(s.b).toBe("later");
  });

  test("private names are per struct", () => {
    struct A {
      #x = 1;
      static read(o) {
        return o.#x;
      }
    }
    struct B extends A {
      #x = 2;
      static readB(o) {
        return o.#x;
      }
    }
    const b = new B();
    expect(A.read(b)).toBe(1);
    expect(B.readB(b)).toBe(2);
    expect(() => B.readB(new A())).toThrow(TypeError);
  });

  test("static fields, methods, accessors and blocks", () => {
    const order: string[] = [];
    struct S {
      static a = (order.push("a"), 1);
      static {
        order.push("block:" + (this === S));
      }
      static b = this.a + 1;
      static #hidden = 7;
      static m() {
        return this === S;
      }
      static get g() {
        return S.#hidden;
      }
      x;
    }
    expect(order).toEqual(["a", "block:true"]);
    expect(S.a).toBe(1);
    expect(S.b).toBe(2);
    expect(S.m()).toBe(true);
    expect(S.g).toBe(7);
  });

  test("a static block can construct the struct being defined", () => {
    let seen: any;
    struct S {
      x = 3;
      static {
        seen = new S();
      }
    }
    expect(seen.x).toBe(3);
    expect(seen instanceof S).toBe(true);
  });

  test("super.method() works in a constructor, a method and a field initializer", () => {
    struct A {
      hello() {
        return "A";
      }
    }
    struct B extends A {
      greeting = super.hello() + "!";
      constructor() {
        super();
        this.fromCtor = super.hello();
      }
      fromCtor;
      hello() {
        return "B" + super.hello();
      }
    }
    const b = new B();
    expect(b.greeting).toBe("A!");
    expect(b.fromCtor).toBe("A");
    expect(b.hello()).toBe("BA");
  });

  test("duplicate fields are fine and keep their first position", () => {
    struct A {
      x;
      x;
    }
    struct B extends A {
      x;
      y;
    }
    expect(Object.keys(new A())).toEqual(["x"]);
    expect(Object.keys(new B())).toEqual(["x", "y"]);
  });
});

describe("struct constructors", () => {
  test("this is bound before super()", () => {
    struct A {
      a;
      constructor(x) {
        this.a = x;
      }
    }
    struct B extends A {
      b;
      constructor(x) {
        this.b = 1;
        super(x);
      }
    }
    const b = new B(5);
    expect(b.a).toBe(5);
    expect(b.b).toBe(1);
  });

  test("a parent constructor runs only when super() is called", () => {
    let runs = 0;
    struct A {
      a;
      constructor() {
        runs++;
        this.a = 1;
      }
    }
    struct NoConstructor extends A {
      b;
    }
    struct NoSuper extends A {
      c;
      constructor() {
        this.c = 3;
      }
    }
    expect(new NoConstructor().a).toBeUndefined();
    expect(new NoSuper().a).toBeUndefined();
    expect(new NoSuper().c).toBe(3);
    expect(runs).toBe(0);
  });

  test("super() can be called more than once and passes its arguments on", () => {
    const seen: unknown[] = [];
    struct A {
      constructor(...args) {
        seen.push(args);
      }
    }
    struct B extends A {
      constructor() {
        super(1, 2);
        super(3);
      }
    }
    new B();
    expect(seen).toEqual([[1, 2], [3]]);
  });

  test("super() inside an arrow function and a nested class constructor keep their meaning", () => {
    let runs = 0;
    struct A {
      constructor() {
        runs++;
      }
    }
    struct B extends A {
      constructor() {
        const call = () => super();
        call();
        class Plain extends Object {
          constructor() {
            super();
            this.ok = true;
          }
        }
        this.plain = new Plain();
      }
      plain;
    }
    const b = new B();
    expect(runs).toBe(1);
    expect(b.plain.ok).toBe(true);
  });

  test("super() with no struct parent is a TypeError", () => {
    struct A {
      constructor() {
        super();
      }
    }
    expect(() => new A()).toThrow(TypeError);
  });

  test("the constructor runs as a plain call: no new.target, and its return value is dropped", () => {
    let target: unknown = "unset";
    struct S {
      x;
      constructor() {
        target = new.target;
        this.x = 1;
        return { x: 2 };
      }
    }
    const s = new S();
    expect(target).toBeUndefined();
    expect(s.x).toBe(1);
    expect(s instanceof S).toBe(true);
  });

  test("a struct cannot be called, subclassed or constructed for another new.target", () => {
    struct S {
      x;
    }
    class Sub extends S {}
    expect(() => new Sub()).toThrow(TypeError);
    function Other() {}
    expect(() => Reflect.construct(S, [], Other)).toThrow(TypeError);
    struct T extends S {}
    expect(() => Reflect.construct(S, [], T)).toThrow(TypeError);
    expect(() => (S as any)()).toThrow(TypeError);
    expect(new T() instanceof S).toBe(true);
    // A failed attempt does not leave the struct unusable.
    expect(Object.keys(new T())).toEqual(["x"]);
  });

  test("a struct can only extend a struct, not a subclass of one", () => {
    struct S {
      x;
    }
    class Sub extends S {}
    expect(() => {
      struct Bad extends Sub {
        y;
      }
      return Bad;
    }).toThrow(TypeError);
    expect(() => {
      struct Bad extends Object {
        y;
      }
      return Bad;
    }).toThrow(TypeError);
    expect(() => {
      struct Bad extends (undefined as any) {
        y;
      }
      return Bad;
    }).toThrow(TypeError);
  });

  test("the constructor has length 0 and the struct's name", () => {
    struct S {
      constructor(a, b, c) {}
    }
    expect(S.length).toBe(0);
    expect(S.name).toBe("S");
  });

  test("there is no synthetic class in the constructor or prototype chain", () => {
    struct A {
      a;
    }
    struct B extends A {
      b;
    }
    expect(Object.getPrototypeOf(A)).toBe(Function.prototype);
    expect(Object.getPrototypeOf(B)).toBe(A);
    expect(Object.getPrototypeOf(A.prototype)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(B.prototype)).toBe(A.prototype);
  });

  test("extends null: the prototype has no parent", () => {
    struct N extends null {
      n;
      static s() {
        return 1;
      }
    }
    expect(Object.getPrototypeOf(N)).toBe(Function.prototype);
    expect(Object.getPrototypeOf(N.prototype)).toBeNull();
    expect(Object.keys(new N())).toEqual(["n"]);
    expect(N.s()).toBe(1);
  });

  test("an extends expression that evaluates to null also gives a prototype without a parent", () => {
    const nothing = null;
    struct D extends (nothing as any) {
      d = 1;
    }
    expect(Object.getPrototypeOf(D.prototype)).toBeNull();
    expect(new D().d).toBe(1);
  });
});

describe("struct definitions", () => {
  test("the prototype is sealed, not frozen, and the constructor is left alone", () => {
    struct S {
      v;
      m() {}
    }
    expect(Object.isSealed(S.prototype)).toBe(true);
    expect(Object.isFrozen(S.prototype)).toBe(false);
    expect(Object.getOwnPropertyDescriptor(S.prototype, "m")!.writable).toBe(true);
    expect(Object.isExtensible(S)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(S, "prototype")!.writable).toBe(false);
    // Locked before the first instance exists.
    expect(Object.isExtensible(S.prototype)).toBe(false);
  });

  test("no helper property is left on the prototype or the constructor", () => {
    struct S {
      a = 1;
      #p = 2;
      constructor() {}
      m() {}
    }
    expect(Reflect.ownKeys(S.prototype)).toEqual(["constructor", "m"]);
    expect(Reflect.ownKeys(S).sort()).toEqual(["length", "name", "prototype"]);
  });

  test("only plain methods are non-generic, and they are not constructors", () => {
    struct S {
      get g() {
        return 1;
      }
      *gen() {
        yield 1;
      }
      m(x, y) {}
    }
    expect(Object.getOwnPropertyDescriptor(S.prototype, "g")!.get!.call({})).toBe(1);
    expect([...S.prototype.gen.call({})]).toEqual([1]);
    expect(() => S.prototype.m.call({})).toThrow(TypeError);
    expect(() => S.prototype.m.call(1)).toThrow(TypeError);
    expect(() => S.prototype.m.call(undefined)).toThrow(TypeError);
    expect(() => new (S.prototype.m as any)()).toThrow(TypeError);
    expect(Object.hasOwn(S.prototype.m, "length")).toBe(false);
    expect(Object.hasOwn(S.prototype.m, "prototype")).toBe(false);
    expect(S.prototype.m.name).toBe("m");
    new S().m(1, 2);
  });

  test("methods accept an instance of a subclass struct", () => {
    struct A {
      who() {
        return "A";
      }
    }
    struct B extends A {}
    expect(new B().who()).toBe("A");
    expect(() => A.prototype.who.call(Object.create(B.prototype))).toThrow(TypeError);
  });

  test("two evaluations of one declaration are two different structs", () => {
    const make = () => {
      struct S {
        m() {
          return 1;
        }
      }
      return S;
    };
    const A = make();
    const B = make();
    expect(A).not.toBe(B);
    expect(new A().m()).toBe(1);
    expect(() => A.prototype.m.call(new B())).toThrow(TypeError);
  });

  test("a constructor declared twice is an early error", () => {
    expect(() => new vm.Script("struct S { constructor() {} constructor() {} }")).toThrow(SyntaxError);
  });

  test("a struct field cannot be an auto-accessor", () => {
    expect(() => new vm.Script("struct S { accessor x; }")).toThrow(SyntaxError);
  });
});

describe("shared struct elements", () => {
  test("field initializers and a constructor", () => {
    shared struct P {
      x = 1;
      y = "two";
      z;
      constructor(z) {
        this.z = z;
      }
    }
    const p = new P(5);
    expect([p.x, p.y, p.z]).toEqual([1, "two", 5]);
    expect(Object.getPrototypeOf(p)).toBeNull();
    expect(Object.keys(p)).toEqual(["x", "y", "z"]);
  });

  test("extends, computed names and a parent constructor reached only through super()", () => {
    const key = "dyn" + "amic";
    let parentRuns = 0;
    shared struct P {
      a = 1;
      constructor() {
        parentRuns++;
      }
    }
    shared struct Q extends P {
      [key] = 2;
    }
    shared struct R extends P {
      constructor() {
        super();
      }
    }
    const q = new Q();
    expect(Object.keys(q)).toEqual(["a", "dynamic"]);
    expect(parentRuns).toBe(0);
    new R();
    expect(parentRuns).toBe(1);
    expect(Object.getPrototypeOf(q)).toBeNull();
    expect(Reflect.canBeShared(q)).toBe(true);
  });

  test("this is the shared struct in an initializer and before super()", () => {
    let seen: unknown;
    shared struct P {
      a;
      constructor() {
        this.a = 1;
      }
    }
    shared struct Q extends P {
      b = (seen = Reflect.canBeShared(this), 2);
      constructor() {
        this.b = 3;
        super();
      }
    }
    const q = new Q();
    expect(seen).toBe(true);
    expect(q.a).toBe(1);
    // The initializer set 2, then the constructor of Q assigned 3 before it called super().
    expect(q.b).toBe(3);
  });

  test("an initializer that cannot be shared throws", () => {
    shared struct Bad {
      v = {};
    }
    expect(() => new Bad()).toThrow(TypeError);
  });

  test("static members, static private names and a static block are allowed", () => {
    shared struct S {
      x;
      static #hidden = 4;
      static get hidden() {
        return S.#hidden;
      }
      static made;
      static {
        S.made = new S();
      }
    }
    expect(S.hidden).toBe(4);
    expect(Object.getPrototypeOf(S.made)).toBeNull();
    expect(Object.isSealed(S)).toBe(true);
  });

  test("a shared struct cannot be called, subclassed or constructed for another new.target", () => {
    shared struct S {
      x;
    }
    class Sub extends S {}
    expect(() => new Sub()).toThrow(TypeError);
    expect(() => Reflect.construct(S, [], function () {})).toThrow(TypeError);
    expect(() => (S as any)()).toThrow(TypeError);
  });

  test("a field initializer that mentions a private name is an early error", () => {
    expect(() => new vm.Script("shared struct S { a = S.#p; static #p = 1; }")).toThrow(SyntaxError);
    expect(() => new vm.Script("shared struct S { static #p = 1; static m() { return S.#p; } a = 1; }")).not.toThrow();
  });
});
