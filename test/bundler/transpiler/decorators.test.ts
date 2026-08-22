// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import DecoratedClass from "./decorator-export-default-class-fixture";
import DecoratedAnonClass from "./decorator-export-default-class-fixture-anon";

test("decorator order of evaluation", () => {
  let counter = 0;
  const computedProp: unique symbol = Symbol("computedProp");

  @decorator1
  @decorator2
  class BugReport {
    @decorator7
    type: string;

    @decorator3
    x: number = 20;

    @decorator5
    private _y: number = 12;

    @decorator10
    get y() {
      return this._y;
    }
    @decorator11
    set y(newY: number) {
      this._y = newY;
    }

    @decorator9
    [computedProp]: string = "yes";

    constructor(@decorator8 type: string) {
      this.type = type;
    }

    @decorator6
    move(newX: number, @decorator12 newY: number) {
      this.x = newX;
      this._y = newY;
    }

    @decorator4
    jump() {
      this._y += 30;
    }
  }

  function decorator1(target, propertyKey) {
    expect(counter++).toBe(11);
    expect(target === BugReport).toBe(true);
    expect(propertyKey).toBe(undefined);
  }

  function decorator2(target, propertyKey) {
    expect(counter++).toBe(10);
    expect(target === BugReport).toBe(true);
    expect(propertyKey).toBe(undefined);
  }

  function decorator3(target, propertyKey) {
    expect(counter++).toBe(1);
    expect(target === BugReport.prototype).toBe(true);
    expect(propertyKey).toBe("x");
  }

  function decorator4(target, propertyKey) {
    expect(counter++).toBe(8);
    expect(target === BugReport.prototype).toBe(true);
    expect(propertyKey).toBe("jump");
  }

  function decorator5(target, propertyKey) {
    expect(counter++).toBe(2);
    expect(target === BugReport.prototype).toBe(true);
    expect(propertyKey).toBe("_y");
  }

  function decorator6(target, propertyKey) {
    expect(counter++).toBe(7);
    expect(target === BugReport.prototype).toBe(true);
    expect(propertyKey).toBe("move");
  }

  function decorator7(target, propertyKey) {
    expect(counter++).toBe(0);
    expect(target === BugReport.prototype).toBe(true);
    expect(propertyKey).toBe("type");
  }

  function decorator8(target, propertyKey) {
    expect(counter++).toBe(9);
    expect(target === BugReport).toBe(true);
    expect(propertyKey).toBe(undefined);
  }

  function decorator9(target, propertyKey) {
    expect(counter++).toBe(5);
    expect(target === BugReport.prototype).toBe(true);
    expect(propertyKey).toBe(computedProp);
  }

  function decorator10(target, propertyKey) {
    expect(counter++).toBe(3);
    expect(target === BugReport.prototype).toBe(true);
    expect(propertyKey).toBe("y");
  }

  function decorator11(target, propertyKey) {
    expect(counter++).toBe(4);
    expect(target === BugReport.prototype).toBe(true);
    expect(propertyKey).toBe("y");
  }

  function decorator12(target, propertyKey) {
    expect(counter++).toBe(6);
    expect(target === BugReport.prototype).toBe(true);
    expect(propertyKey).toBe("move");
  }
});

test("decorator factories order of evaluation", () => {
  let counter = 0;
  const computedProp: unique symbol = Symbol("computedProp");

  @decorator1()
  @decorator2()
  class BugReport {
    @decorator7()
    type: string;

    @decorator3()
    x: number = 20;

    @decorator5()
    private _y: number = 12;

    @decorator10()
    get y() {
      return this._y;
    }
    @decorator11()
    set y(newY: number) {
      this._y = newY;
    }

    @decorator9()
    [computedProp]: string = "yes";

    constructor(@decorator8() type: string) {
      this.type = type;
    }

    @decorator6()
    move(newX: number, @decorator12() newY: number) {
      this.x = newX;
      this._y = newY;
    }

    @decorator4()
    jump() {
      this._y += 30;
    }
  }

  function decorator1() {
    expect(counter++).toBe(18);
    return function (target, descriptorKey) {
      expect(counter++).toBe(23);
    };
  }

  function decorator2() {
    expect(counter++).toBe(19);
    return function (target, descriptorKey) {
      expect(counter++).toBe(22);
    };
  }

  function decorator3() {
    expect(counter++).toBe(2);
    return function (target, descriptorKey) {
      expect(counter++).toBe(3);
    };
  }

  function decorator4() {
    expect(counter++).toBe(16);
    return function (target, descriptorKey) {
      expect(counter++).toBe(17);
    };
  }

  function decorator5() {
    expect(counter++).toBe(4);
    return function (target, descriptorKey) {
      expect(counter++).toBe(5);
    };
  }

  function decorator6() {
    expect(counter++).toBe(12);
    return function (target, descriptorKey) {
      expect(counter++).toBe(15);
    };
  }

  function decorator7() {
    expect(counter++).toBe(0);
    return function (target, descriptorKey) {
      expect(counter++).toBe(1);
    };
  }

  function decorator8() {
    expect(counter++).toBe(20);
    return function (target, descriptorKey) {
      expect(counter++).toBe(21);
    };
  }

  function decorator9() {
    expect(counter++).toBe(10);
    return function (target, descriptorKey) {
      expect(counter++).toBe(11);
    };
  }

  function decorator10() {
    expect(counter++).toBe(6);
    return function (target, descriptorKey) {
      expect(counter++).toBe(7);
    };
  }

  function decorator11() {
    expect(counter++).toBe(8);
    return function (target, descriptorKey) {
      expect(counter++).toBe(9);
    };
  }

  function decorator12() {
    expect(counter++).toBe(13);
    return function (target, descriptorKey) {
      expect(counter++).toBe(14);
    };
  }
});

test("parameter decorators", () => {
  let counter = 0;
  class HappyDecorator {
    width: number;
    height: number;
    x: number;
    y: number;

    move(@d4 x: number, @d5 @d6 y: number) {
      this.x = x;
      this.y = y;
    }

    constructor(one: number, two: string, three: boolean, @d1 @d2 width: number, @d3 height: number) {
      this.width = width;
      this.height = height;
    }

    dance(@d7 @d8 intensity: number) {
      this.width *= intensity;
      this.height *= intensity;
    }
  }

  function d1(target, propertyKey, parameterIndex) {
    expect(counter++).toBe(7);
    expect(target === HappyDecorator).toBe(true);
    expect(propertyKey).toBe(undefined);
    expect(parameterIndex).toBe(3);
  }

  function d2(target, propertyKey, parameterIndex) {
    expect(counter++).toBe(6);
    expect(target === HappyDecorator).toBe(true);
    expect(propertyKey).toBe(undefined);
    expect(parameterIndex).toBe(3);
  }

  function d3(target, propertyKey, parameterIndex) {
    expect(counter++).toBe(5);
    expect(target === HappyDecorator).toBe(true);
    expect(propertyKey).toBe(undefined);
    expect(parameterIndex).toBe(4);
  }

  function d4(target, propertyKey, parameterIndex) {
    expect(counter++).toBe(2);
    expect(target === HappyDecorator.prototype).toBe(true);
    expect(propertyKey).toBe("move");
    expect(parameterIndex).toBe(0);
  }

  function d5(target, propertyKey, parameterIndex) {
    expect(counter++).toBe(1);
    expect(target === HappyDecorator.prototype).toBe(true);
    expect(propertyKey).toBe("move");
    expect(parameterIndex).toBe(1);
  }

  function d6(target, propertyKey, parameterIndex) {
    expect(counter++).toBe(0);
    expect(target === HappyDecorator.prototype).toBe(true);
    expect(propertyKey).toBe("move");
    expect(parameterIndex).toBe(1);
  }

  function d7(target, propertyKey, parameterIndex) {
    expect(counter++).toBe(4);
    expect(target === HappyDecorator.prototype).toBe(true);
    expect(propertyKey).toBe("dance");
    expect(parameterIndex).toBe(0);
  }

  function d8(target, propertyKey, parameterIndex) {
    expect(counter++).toBe(3);
    expect(target === HappyDecorator.prototype).toBe(true);
    expect(propertyKey).toBe("dance");
    expect(parameterIndex).toBe(0);
  }

  class Maybe {
    constructor(
      @m1 private x: number,
      @m2 public y: boolean,
      @m3 protected z: string,
    ) {}
  }

  function m1(target, propertyKey, index) {
    expect(target === Maybe).toBe(true);
    expect(propertyKey).toBe(undefined);
    expect(index).toBe(0);
  }

  function m2(target, propertyKey, index) {
    expect(target === Maybe).toBe(true);
    expect(propertyKey).toBe(undefined);
    expect(index).toBe(1);
  }

  function m3(target, propertyKey, index) {
    expect(target === Maybe).toBe(true);
    expect(propertyKey).toBe(undefined);
    expect(index).toBe(2);
  }
});

test("decorators random", () => {
  @Frozen
  class IceCream {}

  function Frozen(constructor: Function) {
    Object.freeze(constructor);
    Object.freeze(constructor.prototype);
  }

  expect(Object.isFrozen(IceCream)).toBe(true);

  class IceCreamComponent {
    @Emoji()
    flavor = "vanilla";
  }

  // Property Decorator
  function Emoji() {
    return function (target: Object, key: string | symbol) {
      let val = target[key];

      const getter = () => {
        return val;
      };
      const setter = next => {
        val = `🍦 ${next} 🍦`;
      };

      Object.defineProperty(target, key, {
        get: getter,
        set: setter,
        enumerable: true,
        configurable: true,
      });
    };
  }

  const iceCream = new IceCreamComponent();
  expect(iceCream.flavor === "🍦 vanilla 🍦").toBe(true);
  iceCream.flavor = "chocolate";
  expect(iceCream.flavor === "🍦 chocolate 🍦").toBe(true);

  const i: unique symbol = Symbol.for("i");
  const h: unique symbol = Symbol.for("h");
  const t: unique symbol = Symbol.for("t");
  const q: unique symbol = Symbol.for("q");
  const p: unique symbol = Symbol.for("p");
  const u3: unique symbol = Symbol.for("u3");
  const u5: unique symbol = Symbol.for("u5");
  const u6: unique symbol = Symbol.for("u6");
  const u8: unique symbol = Symbol.for("u8");

  class S {
    @StringAppender("😛") k = 35;
    @StringAppender("🤠") static j = 4;
    @StringAppender("😵‍💫") private static [h] = 30;
    @StringAppender("🤯") private static u = 60;
    @StringAppender("🤪") private [t] = 32;
    @StringAppender("🤑") [i] = 8;
    @StringAppender("🎃") private e = 10;
    @StringAppender("👻") static [q] = 202;
    @StringAppender("😇") r = S[h];
    _y: number;
    @StringAppender("🤡") get y() {
      return this._y;
    }
    set y(next) {
      this._y = next;
    }
    #o = 100;

    @StringAppender("😍") u1: number;
    @StringAppender("🥳") static u2: number;
    @StringAppender("🤓") private static [u3]: number;
    @StringAppender("🥺") private static u4: number;
    @StringAppender("🤯") private [u5]: number;
    @StringAppender("🤩") [u6]: number;
    @StringAppender("☹️") private u7: number;
    @StringAppender("🙃") static [u8]: number;

    @StringAppender("🤔") u9 = this.u1;
    @StringAppender("🤨") u10 = this.u2;
    @StringAppender("🙂") u11 = S[u3];
    @StringAppender("🙁") u12 = S.u4;
    @StringAppender("😐") u13 = this[u5];
    @StringAppender("😑") u14 = this[u6];
    @StringAppender("😶") u15 = this.u7;
    @StringAppender("😏") u16 = S[u8];

    constructor() {
      this.k = 3;
      expect(this.k).toBe("3 😛");
      expect(S.j).toBe(4);
      expect(this[i]).toBe("8 🤑");
      expect(this.e).toBe("10 🎃");
      expect(S[h]).toBe(30);
      expect(S.u).toBe(60);
      expect(this[t]).toBe("32 🤪");
      expect(S[q]).toBe(202);
      expect(this.#o).toBe(100);
      expect(this.r).toBe("30 😇");
      expect(this.y).toBe(undefined);
      this.y = 100;
      expect(this.y).toBe(100);

      expect(this.u1).toBe(undefined);
      expect(S.u2).toBe(undefined);
      expect(S[u3]).toBe(undefined);
      expect(S.u4).toBe(undefined);
      expect(this[u5]).toBe(undefined);
      expect(this[u6]).toBe(undefined);
      expect(this.u7).toBe(undefined);
      expect(S[u8]).toBe(undefined);

      expect(this.u9).toBe("undefined 🤔");
      expect(this.u10).toBe("undefined 🤨");
      expect(this.u11).toBe("undefined 🙂");
      expect(this.u12).toBe("undefined 🙁");
      expect(this.u13).toBe("undefined 😐");
      expect(this.u14).toBe("undefined 😑");
      expect(this.u15).toBe("undefined 😶");
      expect(this.u16).toBe("undefined 😏");

      this.u1 = 100;
      expect(this.u1).toBe("100 😍");
      S.u2 = 100;
      expect(S.u2).toBe("100 🥳");
      S[u3] = 100;
      expect(S[u3]).toBe("100 🤓");
      S.u4 = 100;
      expect(S.u4).toBe("100 🥺");
      this[u5] = 100;
      expect(this[u5]).toBe("100 🤯");
      this[u6] = 100;
      expect(this[u6]).toBe("100 🤩");
      this.u7 = 100;
      expect(this.u7).toBe("100 ☹️");
      S[u8] = 100;
      expect(S[u8]).toBe("100 🙃");

      expect(this.u9).toBe("undefined 🤔");
      expect(this.u10).toBe("undefined 🤨");
      expect(this.u11).toBe("undefined 🙂");
      expect(this.u12).toBe("undefined 🙁");
      expect(this.u13).toBe("undefined 😐");
      expect(this.u14).toBe("undefined 😑");
      expect(this.u15).toBe("undefined 😶");
      expect(this.u16).toBe("undefined 😏");
    }
  }

  let s = new S();
  expect(s.u9).toBe("undefined 🤔");
  expect(s.u10).toBe("undefined 🤨");
  expect(s.u11).toBe("undefined 🙂");
  expect(s.u12).toBe("undefined 🙁");
  expect(s.u13).toBe("undefined 😐");
  expect(s.u14).toBe("undefined 😑");
  expect(s.u15).toBe("undefined 😶");
  expect(s.u16).toBe("undefined 😏");

  s.u9 = 35;
  expect(s.u9).toBe("35 🤔");
  s.u10 = 36;
  expect(s.u10).toBe("36 🤨");
  s.u11 = 37;
  expect(s.u11).toBe("37 🙂");
  s.u12 = 38;
  expect(s.u12).toBe("38 🙁");
  s.u13 = 39;
  expect(s.u13).toBe("39 😐");
  s.u14 = 40;
  expect(s.u14).toBe("40 😑");
  s.u15 = 41;
  expect(s.u15).toBe("41 😶");
  s.u16 = 42;
  expect(s.u16).toBe("42 😏");

  function StringAppender(emoji: string) {
    return function (target: Object, key: string | symbol) {
      let val = target[key];

      const getter = () => {
        return val;
      };
      const setter = value => {
        val = `${value} ${emoji}`;
      };

      Object.defineProperty(target, key, {
        get: getter,
        set: setter,
        enumerable: true,
        configurable: true,
      });
    };
  }
});

test("class field order", () => {
  class N {
    l = 455;
  }
  class M {
    u = 4;
    @d1 w = 9;
    constructor() {
      // this.w = 9 should be moved here
      expect(this.u).toBe(4);
      expect(this.w).toBe(9);
      this.u = 3;
      this.w = 6;
      expect(this.u).toBe(3);
      expect(this.w).toBe(6);
    }
  }

  function d1(target, propertyKey) {
    expect(target === M.prototype).toBe(true);
    expect(propertyKey).toBe("w");
  }

  let m = new M();
  expect(m.u).toBe(3);
  expect(m.w).toBe(6);
});

test("changing static method", () => {
  class A {
    static bar() {
      return 1;
    }
  }

  @changeMethodReturn("bar", 5)
  class A_2 {
    static bar() {
      return 7;
    }
  }

  function changeMethodReturn(method, value) {
    return function (target) {
      target[method] = function () {
        return value;
      };
      return target;
    };
  }

  @changeMethodReturn("bar", 2)
  class B extends A {}

  @changeMethodReturn("bar", 9)
  class C extends B {}

  expect(A_2.bar()).toBe(5);
  expect(A.bar()).toBe(1);
  expect(B.bar()).toBe(2);
  expect(C.bar()).toBe(9);
});

test("class extending from another class", () => {
  class A {
    a: number;
    constructor() {
      this.a = 3;
    }
  }

  class B extends A {
    a: number = 9;
  }

  expect(new A().a).toBe(3);
  expect(new B().a).toBe(9);

  class C {
    a: number = 80;
  }

  class D extends C {
    a: number = 32;
    constructor() {
      super();
    }
  }

  expect(new C().a).toBe(80);
  expect(new D().a).toBe(32);

  class E {
    a: number = 40;
    constructor() {
      expect(this.a).toBe(40);
    }
  }

  class F extends E {
    @d1 a: number = 50;
    constructor() {
      super();
      expect(this.a).toBe(50);
      this.a = 60;
      expect(this.a).toBe(60);
    }
  }

  function d1(target) {
    target.a = 100;
  }
});

test("decorated fields moving to constructor", () => {
  class A {
    @d1 a = 3;
    @d2 b = 4;
    @d3 c = 5;
  }

  function d1(target, propertyKey) {
    expect(target === A.prototype).toBe(true);
    expect(propertyKey).toBe("a");
  }

  function d2(target, propertyKey) {
    expect(target === A.prototype).toBe(true);
    expect(propertyKey).toBe("b");
  }

  function d3(target, propertyKey) {
    expect(target === A.prototype).toBe(true);
    expect(propertyKey).toBe("c");
  }

  let a = new A();
  expect(a.a).toBe(3);
  expect(a.b).toBe(4);
  expect(a.c).toBe(5);
});

test("only class decorator", () => {
  let a = 0;
  @d1
  class A {}

  let aa = new A();

  function d1(target) {
    a = 1;
    expect(target).toBe(A);
  }

  expect(a).toBe(1);
});

test("decorators with different property key types", () => {
  function d1(x) {
    return function (target, propertyKey) {
      expect(propertyKey).toBeDefined();

      // If Reflect.decorate is defined, propertyKey will be stringified
      expect(String(propertyKey)).toBe(String(x));
    };
  }
  function foo(x, y, z) {
    class A {
      @d1(arguments[0])
      [arguments[0]]() {}
      @d1(y)
      [y] = 10;
      @d1(z)
      [arguments[2]] = 20;
      @d1("string")
      "string" = 30;
      @d1("string method")
      "string method"() {}
      @d1(12000)
      12e3 = "number key";
      @d1(12e3 + 1)
      [12e3 + 1]() {}
    }

    return A;
  }

  let A = foo("a", "b", "c");
});

test("only property decorators", () => {
  let a = 0;
  class A {
    @d1 a() {}
  }

  let b = 0;
  class B {
    @d2 b = 3;
  }

  let c = 0;
  class C {
    @d3 get c() {
      return 3;
    }
  }

  function d1(target, propertyKey) {
    a = 1;
    expect(target === A.prototype).toBe(true);
    expect(propertyKey).toBe("a");
  }
  expect(a).toBe(1);

  function d2(target, propertyKey) {
    b = 1;
    expect(target === B.prototype).toBe(true);
    expect(propertyKey).toBe("b");
  }
  expect(b).toBe(1);

  function d3(target, propertyKey) {
    c = 1;
    expect(target === C.prototype).toBe(true);
    expect(propertyKey).toBe("c");
  }
  expect(c).toBe(1);
});

test("only argument decorators", () => {
  let a = 0;
  class A {
    a(@d1 a: string) {}
  }

  function d1(target, propertyKey, parameterIndex) {
    a = 1;
    expect(target === A.prototype).toBe(true);
    expect(propertyKey).toBe("a");
    expect(parameterIndex).toBe(0);
  }

  expect(a).toBe(1);
});

test("no decorators", () => {
  let a = 0;
  class A {
    b: number;
    constructor() {
      a = 1;
      this.b = 300000;
    }
  }

  let aa = new A();
  expect(a).toBe(1);
  expect(aa.b).toBe(300000);
});

describe("constructor statements", () => {
  test("with parameter properties", () => {
    class A {
      constructor(readonly d: string = "default") {
        expect(d).toBe(d);
        expect(this.d).toBe(d);
      }
    }

    const a = new A("c");
    expect(a.d).toBe("c");

    class B extends A {}

    const b = new B();
    expect(b.d).toBe("default");

    class C extends A {
      constructor(public f: number) {
        super();
        expect(this.d).toBe("default");
        expect(f).toBe(f);
        expect(this.f).toBe(f);
      }
    }

    const c = new C(5);
    expect(c.d).toBe("default");
    expect(c.f).toBe(5);
  });

  test("class expressions (no decorators)", () => {
    const A = class a {
      constructor(readonly b: string = "default") {
        expect(b).toBe(b);
        expect(this.b).toBe(b);
      }
    };

    const a = new A("hello class expression");
    expect(a.b).toBe("hello class expression");

    const B = class b extends A {};
    const b = new B();
    expect(b.b).toBe("default");

    const C = class c extends A {
      constructor(public f: number) {
        super();
        expect(this.b).toBe("default");
        expect(this.f).toBe(f);
        expect(f).toBe(f);
      }
    };

    const c = new C(5);
    expect(c.b).toBe("default");
    expect(c.f).toBe(5);
  });

  test("with parameter properties and statements", () => {
    class B {
      value: number;
      v2: number;
      constructor(value: number) {
        this.value = value;
        this.v2 = 0;
      }
    }

    class A extends B {
      constructor(
        value: number,
        public v: string = "test",
      ) {
        const newValue = value * 10;
        super(newValue);
      }
    }

    const a = new A(10);
    expect(a.value).toBe(100);
    expect(a.v).toBe("test");
    expect(a.v2).toBe(0);
  });

  test("with parameter properties, statements, and decorators", () => {
    class B {
      value: number;
      v2: number;
      constructor(value: number) {
        this.value = value;
        this.v2 = 0;
      }
    }

    function d1() {}

    class A extends B {
      b: number;
      constructor(
        value: number,
        @d1 b: number,
        public v: string = "test",
      ) {
        const newValue = value * 10;
        super(newValue);
        expect(this.v).toBe("test");
        this.b = b;
        expect(this.b).toBe(b);
      }
    }

    const a = new A(10, 1);
    expect(a.b).toBe(1);
    expect(a.value).toBe(100);
    expect(a.v).toBe("test");
    expect(a.v2).toBe(0);
  });

  test("with more parameter properties, statements, and decorators", () => {
    let decoratorCounter = 0;
    function d1() {
      expect(decoratorCounter).toBe(1);
      decoratorCounter += 1;
    }
    function d2() {
      expect(decoratorCounter).toBe(0);
      decoratorCounter += 1;
    }
    function d3() {
      expect(decoratorCounter).toBe(2);
      decoratorCounter += 1;
    }
    function d4() {
      expect(decoratorCounter).toBe(3);
      decoratorCounter += 1;
    }

    class A {
      l: number;
      constructor(
        protected u: string,
        @d1 l: number = 3,
        @d2 public k: number = 4,
      ) {
        this.l = l;
      }
    }

    class B extends A {
      @d3 e: string = "hello test";

      constructor(private i: number) {
        super("protected");
        expect(this.i).toBe(i);
        expect(this.u).toBe("protected");
      }

      @d4 f() {}
    }

    let b = new B(9);
    expect(b.k).toBe(4);
    expect(b.l).toBe(3);
    expect(b.e).toBe("hello test");
  });

  test("expression with parameter properties and statements", () => {
    const B = class b {
      value: number;
      v2: number;
      constructor(value: number) {
        this.value = value;
        this.v2 = 0;
      }
    };

    const A = class a extends B {
      constructor(
        value: number,
        public v: string = "test",
      ) {
        const newValue = value * 10;
        super(newValue);
      }
    };

    const a = new A(10);
    expect(a.value).toBe(100);
    expect(a.v).toBe("test");
    expect(a.v2).toBe(0);
  });
});

test("export default class Named works", () => {
  expect(new DecoratedClass()["methoddecorated"]).toBe(true);
});

test("export default class works (anonymous name)", () => {
  expect(new DecoratedAnonClass()["methoddecorated"]).toBe(true);
});

test("field with supra-BMP string-literal key and initializer is assigned under the correct key", () => {
  function dec(_t: any, _k: any) {}
  class Foo {
    @dec "\u{20BB7}\u{91BB6}": number = 42;
    @dec static "\u{20BB7}\u{91BB6}": number = 7;
  }
  const f = new Foo();
  expect({
    instance: f["\u{20BB7}\u{91BB6}"],
    instanceKeys: Object.getOwnPropertyNames(f),
    staticVal: Foo["\u{20BB7}\u{91BB6}"],
  }).toEqual({
    instance: 42,
    instanceKeys: ["\u{20BB7}\u{91BB6}"],
    staticVal: 7,
  });
});

test("decorator and declare", () => {
  let counter = 0;
  function d1() {
    counter++;
  }
  class A {
    @d1
    declare a: number;

    m() {
      counter++;
    }
  }

  new A();
  expect(counter).toBe(1);
});

test("lowering many decorated instance fields into a large constructor body stays linear", async () => {
  // Hold N fixed; compare M=100 vs M=50000. If the splice-after-super() were O(M*N)
  // instead of O(M+N), tLarge/tSmall would be ~5x (debug) / ~90x (release) here, not ~2x.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const N = 500000;
        function gen(M) {
          let src = "function d(t,k){}\\nclass Base {}\\nclass Foo extends Base {\\n";
          for (let i = 0; i < M; i++) src += "@d f" + i + " = " + i + ";\\n";
          src += "constructor() {\\nsuper();\\n";
          src += Buffer.alloc(N * 2, "{}").toString();
          src += "\\n}\\n}\\n";
          return src;
        }
        const t = new Bun.Transpiler({
          loader: "ts",
          tsconfig: { compilerOptions: { experimentalDecorators: true } },
        });
        function time(M) {
          const src = gen(M);
          const t0 = performance.now();
          const out = t.transformSync(src);
          const ms = performance.now() - t0;
          if (!out.includes("this.f0 = 0") || !out.includes("this.f" + (M - 1) + " = " + (M - 1)))
            throw new Error("instance-field initializers missing from lowered constructor at M=" + M);
          return ms;
        }
        const tSmall = time(100);
        const tLarge = time(50000);
        console.log(JSON.stringify({ tSmall, tLarge, ratio: tLarge / tSmall }));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 60_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toMatchObject({
    stdout: expect.stringMatching(/^\{"tSmall":[\d.]+,"tLarge":[\d.]+,"ratio":[\d.]+\}\n$/),
    exitCode: 0,
  });
  const { tSmall, tLarge } = JSON.parse(stdout);
  expect(tLarge).toBeLessThan(tSmall * 3);
}, 90_000);

// With experimentalDecorators the standard-decorator lowering (which also lowers
// `accessor` members) is not used, so `accessor` is desugared in place instead:
//   accessor x = 1  ->  #x = 1; get x() { return this.#x } set x(v) { this.#x = v }
// tsc accepts the keyword in this mode too, and decorates such a member like a
// getter/setter pair.
describe("accessor keyword with experimentalDecorators", () => {
  function transpile(code: string, compilerOptions: Record<string, unknown> = {}) {
    const transpiler = new Bun.Transpiler({
      loader: "ts",
      tsconfig: { compilerOptions: { experimentalDecorators: true, ...compilerOptions } },
    });
    return transpiler
      .transformSync(code)
      .replace(/^import \{[\s\S]*?\} from "bun:wrap";\n/m, "")
      .replace(/__legacy(\w+?)TS_\w+/g, "__legacy$1TS")
      .trim();
  }

  async function run(name: string, files: Record<string, string>, compilerOptions: Record<string, unknown> = {}) {
    using dir = tempDir(name, {
      "tsconfig.json": JSON.stringify({ compilerOptions: { experimentalDecorators: true, ...compilerOptions } }),
      ...files,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test("is lowered to a private field plus a getter/setter pair", () => {
    expect(transpile(`class A { accessor x = 1 }`)).toMatchInlineSnapshot(`
      "class A {
        #x = 1;
        get x() {
          return this.#x;
        }
        set x(v) {
          this.#x = v;
        }
      }"
    `);
  });

  test("static, private, literal and computed keys", () => {
    expect(
      transpile(`
        const k = () => "dyn";
        class A {
          static accessor s = 1;
          accessor #p = 2;
          accessor [k()] = 3;
          accessor ["lit"] = 4;
          accessor 42 = 5;
          accessor noInit: string;
          getP() { return this.#p; }
        }
      `),
    ).toMatchInlineSnapshot(`
      "var __bun_temp_ref_1$;
      const k = () => "dyn";

      class A {
        static #s = 1;
        static get s() {
          return this.#s;
        }
        static set s(v) {
          this.#s = v;
        }
        #_p = 2;
        get #p() {
          return this.#_p;
        }
        set #p(v) {
          this.#_p = v;
        }
        #_accessor_storage = 3;
        get [__bun_temp_ref_1$ = k()]() {
          return this.#_accessor_storage;
        }
        set [__bun_temp_ref_1$](v) {
          this.#_accessor_storage = v;
        }
        #_accessor_storage2 = 4;
        get ["lit"]() {
          return this.#_accessor_storage2;
        }
        set ["lit"](v) {
          this.#_accessor_storage2 = v;
        }
        #_accessor_storage3 = 5;
        get 42() {
          return this.#_accessor_storage3;
        }
        set 42(v) {
          this.#_accessor_storage3 = v;
        }
        #noInit;
        get noInit() {
          return this.#noInit;
        }
        set noInit(v) {
          this.#noInit = v;
        }
        getP() {
          return this.#p;
        }
      }"
    `);
  });

  test("backing fields avoid the private names of the class and of enclosing classes", () => {
    expect(
      transpile(`
        class Outer {
          #x = "outer";
          accessor x = 1;
          static accessor x = 2;
          inner() {
            return class Inner {
              accessor x = 3;
              outerX(o: Outer) { return o.#x; }
            };
          }
        }
      `),
    ).toMatchInlineSnapshot(`
      "class Outer {
        #x = "outer";
        #x2 = 1;
        get x() {
          return this.#x2;
        }
        set x(v) {
          this.#x2 = v;
        }
        static #x3 = 2;
        static get x() {
          return this.#x3;
        }
        static set x(v) {
          this.#x3 = v;
        }
        inner() {
          return class Inner {
            #x2 = 3;
            get x() {
              return this.#x2;
            }
            set x(v) {
              this.#x2 = v;
            }
            outerX(o) {
              return o.#x;
            }
          };
        }
      }"
    `);
  });

  test("a decorated accessor is decorated like a getter/setter pair", () => {
    expect(
      transpile(`
        declare const dec: any;
        declare const key: () => string;
        class A {
          @dec accessor x = 1;
          @dec static accessor s = 2;
          @dec accessor [key()] = 3;
        }
      `),
    ).toMatchInlineSnapshot(`
      "var __bun_temp_ref_1$;

      class A {
        #x = 1;
        get x() {
          return this.#x;
        }
        set x(v) {
          this.#x = v;
        }
        static #s = 2;
        static get s() {
          return this.#s;
        }
        static set s(v) {
          this.#s = v;
        }
        #_accessor_storage = 3;
        get [__bun_temp_ref_1$ = key()]() {
          return this.#_accessor_storage;
        }
        set [__bun_temp_ref_1$](v) {
          this.#_accessor_storage = v;
        }
      }
      __legacyDecorateClassTS([
        dec
      ], A.prototype, "x", null);
      __legacyDecorateClassTS([
        dec
      ], A.prototype, __bun_temp_ref_1$, null);
      __legacyDecorateClassTS([
        dec
      ], A, "s", null);"
    `);
  });

  test("TypeScript modifiers are stripped and decorated siblings are lowered as usual", () => {
    // tsc accepts a class that mixes legacy decorators with accessor members, so
    // the accessors must not make the rest of the class an error. A decorated
    // abstract accessor is decorated like an abstract field (no body member).
    expect(
      transpile(`
        declare const dec: any;
        abstract class Entity {
          @dec id = 0;
          accessor name = "";
          private accessor b = 2;
          protected readonly accessor c = 3;
          public static accessor d = 4;
          protected static override accessor e = 5;
          abstract accessor f: number;
          @dec abstract accessor g: number;
          @dec save() {}
        }
      `),
    ).toMatchInlineSnapshot(`
      "class Entity {
        constructor() {
          this.id = 0;
        }
        #name = "";
        get name() {
          return this.#name;
        }
        set name(v) {
          this.#name = v;
        }
        #b = 2;
        get b() {
          return this.#b;
        }
        set b(v) {
          this.#b = v;
        }
        #c = 3;
        get c() {
          return this.#c;
        }
        set c(v) {
          this.#c = v;
        }
        static #d = 4;
        static get d() {
          return this.#d;
        }
        static set d(v) {
          this.#d = v;
        }
        static #e = 5;
        static get e() {
          return this.#e;
        }
        static set e(v) {
          this.#e = v;
        }
        save() {}
      }
      __legacyDecorateClassTS([
        dec
      ], Entity.prototype, "id", undefined);
      __legacyDecorateClassTS([
        dec
      ], Entity.prototype, "g", undefined);
      __legacyDecorateClassTS([
        dec
      ], Entity.prototype, "save", null);"
    `);
  });

  test("emitDecoratorMetadata describes the accessor's declared type, unlike a getter's signature", () => {
    expect(
      transpile(
        `
          declare const dec: any;
          class A {
            @dec accessor x: number = 1;
            @dec get y(): string { return ""; }
          }
        `,
        { emitDecoratorMetadata: true },
      ),
    ).toMatchInlineSnapshot(`
      "class A {
        #x = 1;
        get x() {
          return this.#x;
        }
        set x(v) {
          this.#x = v;
        }
        get y() {
          return "";
        }
      }
      __legacyDecorateClassTS([
        dec,
        __legacyMetadataTS("design:type", Number)
      ], A.prototype, "x", null);
      __legacyDecorateClassTS([
        dec,
        __legacyMetadataTS("design:type", String),
        __legacyMetadataTS("design:paramtypes", [])
      ], A.prototype, "y", null);"
    `);
  });

  test("useDefineForClassFields: false moves the backing field's initializer into the constructor", () => {
    expect(
      transpile(
        `
          class A {
            a = 1;
            accessor x = this.a + 1;
            b = 2;
          }
        `,
        { useDefineForClassFields: false },
      ),
    ).toMatchInlineSnapshot(`
      "class A {
        constructor() {
          this.a = 1;
          this.#x = this.a + 1;
          this.b = 2;
        }
        #x;
        get x() {
          return this.#x;
        }
        set x(v) {
          this.#x = v;
        }
      }"
    `);
  });

  test("accessor is still an ordinary member name", () => {
    expect(
      transpile(`
        declare const computed: string;
        class A {
          accessor = 1;
          static accessor: string = "s";
          accessor
          afterNewline = 2;
          accessor
          [computed] = 3;
          accessor?: number;
          accessor(): void {}
        }
        const o = { accessor: 1 };
      `),
    ).toMatchInlineSnapshot(`
      "class A {
        accessor = 1;
        static accessor = "s";
        accessor;
        afterNewline = 2;
        accessor;
        [computed] = 3;
        accessor;
        accessor() {}
      }
      const o = { accessor: 1 };"
    `);
  });

  test.concurrent("accessors behave like the native keyword at runtime", async () => {
    const { stdout, stderr, exitCode } = await run("legacy-accessor-runtime", {
      "index.ts": `
        import Anon from "./anon";
        const keyCalls: string[] = [];
        const key = () => { keyCalls.push("key"); return "dyn"; };
        class Base {
          accessor name = "base";
          static accessor count = 1;
          accessor #secret = "s";
          accessor [key()] = "d";
          get secret() { return this.#secret; }
          set secret(v: string) { this.#secret = v; }
        }
        class Derived extends Base {
          accessor name = "derived";
          superName() { return super.name; }
        }
        const Expr = class { accessor e = 1 };
        const d: any = new Derived();
        d.name = "changed";
        d.dyn = "d2";
        d.secret = "s2";
        Base.count++;
        console.log(JSON.stringify({
          name: d.name,
          superName: d.superName(),
          baseName: new Base().name,
          count: Base.count,
          dyn: d.dyn,
          keyCalls,
          secret: d.secret,
          protoKeys: Object.getOwnPropertyNames(Base.prototype),
          ownKeys: Object.keys(d),
          descriptor: typeof Object.getOwnPropertyDescriptor(Base.prototype, "name").set,
          expr: new Expr().e,
          anonName: Anon.name,
          anonValue: new Anon().z,
        }));
      `,
      "anon.ts": `export default class { accessor z = "z" }`,
    });
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      name: "changed",
      superName: "base",
      baseName: "base",
      count: 2,
      dyn: "d2",
      keyCalls: ["key"],
      secret: "s2",
      protoKeys: ["constructor", "name", "dyn", "secret"],
      ownKeys: [],
      descriptor: "function",
      expr: 1,
      anonName: "default",
      anonValue: "z",
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("legacy decorators on accessors receive the property descriptor", async () => {
    const { stdout, stderr, exitCode } = await run(
      "legacy-accessor-decorated",
      {
        "index.ts": `
          const seen: unknown[] = [];
          // Stand-in for reflect-metadata: __legacyMetadataTS calls Reflect.metadata when it exists.
          (Reflect as any).metadata = (k: string, v: any) => (_target: object, key: string) => {
            seen.push({ metadata: k, type: v.name, key });
          };
          function record(target: object, key: string, desc?: PropertyDescriptor) {
            seen.push({
              key,
              onPrototype: target === A.prototype,
              onClass: target === A,
              get: typeof desc?.get,
              set: typeof desc?.set,
              args: arguments.length,
            });
          }
          function double(_target: object, _key: string, desc: PropertyDescriptor): PropertyDescriptor {
            const { get } = desc;
            return { ...desc, get() { return get!.call(this) * 2; } };
          }
          let keyEvaluations = 0;
          const key = () => "k" + keyEvaluations++;
          class A {
            @record accessor x = 1;
            @double accessor n: number = 21;
            @record accessor [key()] = 3;
            @record static accessor s = 2;
          }
          const a: any = new A();
          const nBefore = a.n;
          a.n = 5;
          console.log(JSON.stringify({ seen, keyEvaluations, k0: a.k0, nBefore, nAfter: a.n, x: a.x, s: A.s }));
        `,
      },
      { emitDecoratorMetadata: true },
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      seen: [
        { metadata: "design:type", type: "Object", key: "x" },
        { key: "x", onPrototype: true, onClass: false, get: "function", set: "function", args: 3 },
        { metadata: "design:type", type: "Number", key: "n" },
        { metadata: "design:type", type: "Object", key: "k0" },
        { key: "k0", onPrototype: true, onClass: false, get: "function", set: "function", args: 3 },
        { metadata: "design:type", type: "Object", key: "s" },
        { key: "s", onPrototype: false, onClass: true, get: "function", set: "function", args: 3 },
      ],
      keyEvaluations: 1,
      k0: 3,
      nBefore: 42,
      nAfter: 10,
      x: 1,
      s: 2,
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent(
    "useDefineForClassFields: false initializes accessors in source order with the other fields",
    async () => {
      const { stdout, stderr, exitCode } = await run(
        "legacy-accessor-use-define",
        {
          "index.ts": `
          const order: string[] = [];
          class A {
            a = (order.push("a"), 1);
            accessor x = (order.push("x"), this.a + 1);
            b = (order.push("b"), 2);
            static accessor s = (order.push("s"), 3);
            constructor() { order.push("ctor"); }
          }
          const a = new A();
          console.log(JSON.stringify({ order, x: a.x, s: A.s, ownKeys: Object.keys(a) }));
        `,
        },
        { useDefineForClassFields: false },
      );
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ order: ["s", "a", "x", "b", "ctor"], x: 2, s: 3, ownKeys: ["a", "b"] });
      expect(exitCode).toBe(0);
    },
  );

  test.concurrent("bundling keeps the generated bindings of different files apart", async () => {
    using dir = tempDir("legacy-accessor-bundle", {
      "tsconfig.json": JSON.stringify({ compilerOptions: { experimentalDecorators: true } }),
      // b.ts is bundled first and its export keeps the name _computedKey, so both
      // the temporary generated for B's computed key and the function declared
      // below need fresh names. If those two ended up sharing a name, defining B
      // would overwrite the function.
      "index.ts": `
        import { B, _computedKey as exported } from "./b";
        function _computedKey() { return "function"; }
        const key = () => "ka";
        class A {
          #x = "private";
          accessor x = 1;
          accessor [key()] = 2;
          privateX() { return this.#x; }
        }
        const a: any = new A();
        const b: any = new B();
        console.log(JSON.stringify({
          ax: a.x, aka: a.ka, privateX: a.privateX(), bx: b.x, bkb: b.kb, fn: _computedKey(), exported,
        }));
      `,
      "b.ts": `
        export const _computedKey = "exported";
        const key = () => "kb";
        export class B {
          accessor x = 3;
          accessor [key()] = 4;
        }
      `,
    });
    const build = await Bun.build({
      entrypoints: [join(String(dir), "index.ts")],
      outdir: join(String(dir), "out"),
      target: "bun",
    });
    expect(build.logs).toEqual([]);
    expect(build.success).toBe(true);

    await using proc = Bun.spawn({
      cmd: [bunExe(), join("out", "index.js")],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      ax: 1,
      aka: 2,
      privateX: "private",
      bx: 3,
      bkb: 4,
      fn: "function",
      exported: "exported",
    });
    expect(exitCode).toBe(0);
  });
});
