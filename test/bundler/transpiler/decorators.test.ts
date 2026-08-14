// @ts-nocheck
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
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

// `accessor` fields are valid in every TypeScript decorator mode. Classes that
// are not lowered by the standard decorator transform (experimentalDecorators /
// emitDecoratorMetadata) get each accessor expanded into a private storage
// field plus a getter/setter pair, which is what tsc emits too.
describe("auto-accessors with experimentalDecorators", () => {
  const legacy = { experimentalDecorators: true };

  async function runLegacy(
    code: string,
    compilerOptions: Record<string, unknown> = legacy,
    extraFiles: Record<string, string> = {},
  ) {
    using dir = tempDir("legacy-accessor", {
      ...extraFiles,
      "tsconfig.json": JSON.stringify({ compilerOptions }),
      "index.ts": code,
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

  async function runLegacyJSON(
    code: string,
    compilerOptions?: Record<string, unknown>,
    extraFiles?: Record<string, string>,
  ) {
    const { stdout, stderr, exitCode } = await runLegacy(code, compilerOptions, extraFiles);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return JSON.parse(stdout);
  }

  function transpileLegacy(code: string, compilerOptions: Record<string, unknown> = legacy) {
    return new Bun.Transpiler({ loader: "ts", tsconfig: { compilerOptions } }).transformSync(code);
  }

  test.concurrent.each([
    ["experimentalDecorators", { experimentalDecorators: true }],
    ["emitDecoratorMetadata", { emitDecoratorMetadata: true }],
    ["both", { experimentalDecorators: true, emitDecoratorMetadata: true }],
  ])("instance and static accessors parse and run (%s)", async (_, compilerOptions) => {
    const { stdout, stderr, exitCode } = await runLegacy(
      `
        class A { accessor x = 1; static accessor y = 2 }
        console.log(JSON.stringify([new A().x, A.y]));
      `,
      compilerOptions,
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("[1,2]\n");
    expect(exitCode).toBe(0);
  });

  test.concurrent("accessors behave like a getter/setter pair over private storage", async () => {
    expect(
      await runLegacyJSON(`
        class A {
          first = 1;
          accessor second = this.first + 1;
          third = this.second + 1;
          accessor empty;
          static accessor count = 10;
          accessor #hidden = "h";
          static accessor #staticHidden = "s";
          readHidden() { return this.#hidden; }
          writeHidden(v: string) { this.#hidden = v; }
          static readStaticHidden() { return A.#staticHidden; }
          static writeStaticHidden(v: string) { A.#staticHidden = v; }
        }
        const a = new A();
        const b = new A();
        a.second = 20;
        a.empty = "filled";
        A.count++;
        a.writeHidden("changed");
        A.writeStaticHidden("also changed");
        const proto = Object.getOwnPropertyDescriptor(A.prototype, "second");
        const stat = Object.getOwnPropertyDescriptor(A, "count");
        console.log(JSON.stringify({
          values: [a.first, a.second, a.third, a.empty, b.second, b.empty, A.count],
          hidden: [a.readHidden(), b.readHidden(), A.readStaticHidden()],
          ownKeys: Object.keys(a),
          protoNames: Object.getOwnPropertyNames(A.prototype),
          protoDescriptor: [typeof proto.get, typeof proto.set, proto.enumerable, proto.configurable],
          staticDescriptor: [typeof stat.get, typeof stat.set],
        }));
      `),
    ).toEqual({
      values: [1, 20, 3, "filled", 2, null, 11],
      hidden: ["changed", "h", "also changed"],
      ownKeys: ["first", "third"],
      protoNames: ["constructor", "second", "empty", "readHidden", "writeHidden"],
      protoDescriptor: ["function", "function", false, true],
      staticDescriptor: ["function", "function"],
    });
  });

  test.concurrent("static accessors work through `this` inside static members", async () => {
    expect(
      await runLegacyJSON(`
        class A {
          static accessor n = 1;
          static doubled = this.n * 2;
          static bump() { return ++this.n; }
          static { this.n += 10; }
        }
        console.log(JSON.stringify([A.doubled, A.bump(), A.n]));
      `),
    ).toEqual([2, 12, 12]);
  });

  test.concurrent("computed keys are evaluated once and shared by the getter and setter", async () => {
    expect(
      await runLegacyJSON(`
        let calls = 0;
        function key() { calls++; return "k" + calls; }
        const sym = Symbol("sym");
        class A {
          accessor [key()] = "instance";
          static accessor [key()] = "static";
          accessor [sym] = "symbol";
          accessor ["quoted-name"] = "quoted";
          accessor 42 = "number";
        }
        const a = new A();
        a.k1 = "set through setter";
        a[sym] += "!";
        console.log(JSON.stringify({
          calls,
          values: [a.k1, A.k2, a[sym], a["quoted-name"], a[42]],
          protoNames: Object.getOwnPropertyNames(A.prototype),
          protoSymbols: Object.getOwnPropertySymbols(A.prototype).length,
          staticNames: Object.getOwnPropertyNames(A).includes("k2"),
        }));
      `),
    ).toEqual({
      calls: 2,
      values: ["set through setter", "static", "symbol!", "quoted", "number"],
      protoNames: ["42", "constructor", "k1", "quoted-name"],
      protoSymbols: 1,
      staticNames: true,
    });
  });

  test.concurrent("computed keys in classes nested in functions, parameters, static blocks and enums", async () => {
    expect(
      await runLegacyJSON(`
        let calls = 0;
        function key(name: string) { calls++; return name; }
        function inFunction() { return class { accessor [key("fn")] = 1 }; }
        function inParameter(C = class { accessor [key("param")] = 2 }) { return C; }
        class Holder { static Nested: any; static { this.Nested = class { accessor [key("block")] = 3 }; } }
        enum E { Member = (globalThis.FromEnum = class { accessor [key("enum")] = 4 }, 0) }
        const values = [
          new (inFunction())().fn,
          new (inParameter())().param,
          new Holder.Nested().block,
          new globalThis.FromEnum().enum,
          E.Member,
        ];
        console.log(JSON.stringify({ calls, values }));
      `),
    ).toEqual({ calls: 4, values: [1, 2, 3, 4, 0] });
  });

  test.concurrent("storage names do not collide with members the class declares", async () => {
    expect(
      await runLegacyJSON(`
        class A {
          #x_accessor_storage = "mine";
          accessor x = "accessor";
          accessor #p = "private accessor";
          #p_accessor_storage = "mine too";
          read() { return [this.#x_accessor_storage, this.x, this.#p_accessor_storage, this.#p]; }
        }
        const a = new A();
        a.x = "updated";
        console.log(JSON.stringify(a.read()));
      `),
    ).toEqual(["mine", "updated", "mine too", "private accessor"]);
  });

  test.concurrent("members named `accessor` are still ordinary members", async () => {
    expect(
      await runLegacyJSON(`
        class A {
          accessor = 1;
          static accessor() { return "method"; }
        }
        class B {
          accessor
          field = 2;
        }
        const b = new B();
        console.log(JSON.stringify([new A().accessor, A.accessor(), b.accessor, b.field, Object.keys(b)]));
      `),
    ).toEqual([1, "method", null, 2, ["accessor", "field"]]);
  });

  test.concurrent("class expressions", async () => {
    expect(
      await runLegacyJSON(`
        const A = class {
          accessor x = 1;
          static accessor y = 2;
          inner() { return class { accessor x = "inner"; accessor #y = "inner private"; y() { return this.#y; } }; }
        };
        function make() { return class { accessor z = 3 }; }
        const obj = { klass: class { accessor w = 4 } };
        const a = new A();
        a.x += 10;
        const inner = new (a.inner())();
        console.log(JSON.stringify([a.x, A.y, new (make())().z, new obj.klass().w, inner.x, inner.y(), A.name]));
      `),
    ).toEqual([11, 2, 3, 4, "inner", "inner private", "A"]);
  });

  test.concurrent("export default class with accessors", async () => {
    expect(
      await runLegacyJSON(
        `
          import Anonymous from "./anonymous.ts";
          import Named from "./named.ts";
          console.log(JSON.stringify([new Anonymous().x, Named.y]));
        `,
        legacy,
        {
          "anonymous.ts": `export default class { accessor x = 1 }`,
          "named.ts": `export default class Named { static accessor y = 2 }`,
        },
      ),
    ).toEqual([1, 2]);
  });

  test.concurrent("legacy decorators receive the accessor's descriptor", async () => {
    expect(
      await runLegacyJSON(`
        const log: unknown[] = [];
        function dec(target: any, key: string, desc: PropertyDescriptor) {
          log.push([target === A.prototype ? "prototype" : target === A ? "class" : "?", key, typeof desc.get, typeof desc.set]);
          const get = desc.get!;
          desc.get = function () { return get.call(this) * 10; };
        }
        function plain(target: any, key: string) { log.push(["plain", key]); }
        class A {
          @plain before = 0;
          @dec accessor x = 1;
          @dec static accessor y = 2;
          @plain after = 0;
        }
        const a = new A();
        a.x = 5;
        console.log(JSON.stringify({ log, x: a.x, y: A.y, ownKeys: Object.keys(a) }));
      `),
    ).toEqual({
      log: [
        ["plain", "before"],
        ["prototype", "x", "function", "function"],
        ["plain", "after"],
        ["class", "y", "function", "function"],
      ],
      x: 50,
      y: 20,
      ownKeys: ["before", "after"],
    });
  });

  test.concurrent("emitDecoratorMetadata reports the declared type as design:type", async () => {
    expect(
      await runLegacyJSON(
        `
          const metadata: [string, string, unknown][] = [];
          (Reflect as any).metadata = (name: string, value: unknown) => (_target: unknown, key: string) => {
            metadata.push([key, name, value]);
          };
          function dec() {}
          class Point {}
          class A {
            @dec accessor n: number = 1;
            @dec static accessor s: string;
            @dec accessor untyped;
            @dec accessor point: Point;
          }
          const names = new Map<unknown, string>([[Number, "Number"], [String, "String"], [Object, "Object"], [Point, "Point"]]);
          console.log(JSON.stringify(
            metadata.filter(([, name]) => name === "design:type").map(([key, , value]) => [key, names.get(value) ?? "?"]),
          ));
        `,
        { experimentalDecorators: true, emitDecoratorMetadata: true },
      ),
    ).toEqual([
      ["n", "Number"],
      ["untyped", "Object"],
      ["point", "Point"],
      ["s", "String"],
    ]);
  });

  test.concurrent("useDefineForClassFields: false initializes the storage in the constructor", async () => {
    expect(
      await runLegacyJSON(
        `
          const order: string[] = [];
          class A {
            a = (order.push("a"), 1);
            accessor b = (order.push("b"), this.a + 1);
            c = (order.push("c"), this.b + 1);
            constructor() { order.push("ctor"); }
          }
          const a = new A();
          a.b = 10;
          console.log(JSON.stringify({ order, values: [a.a, a.b, a.c], ownKeys: Object.keys(a) }));
        `,
        { experimentalDecorators: true, useDefineForClassFields: false },
      ),
    ).toEqual({ order: ["a", "b", "c", "ctor"], values: [1, 10, 3], ownKeys: ["a", "c"] });
    expect(
      transpileLegacy(`class A { accessor b = 1; }`, { experimentalDecorators: true, useDefineForClassFields: false }),
    ).toMatchInlineSnapshot(`
      "class A {
        constructor() {
          this.#b_accessor_storage = 1;
        }
        #b_accessor_storage;
        get b() {
          return this.#b_accessor_storage;
        }
        set b(v) {
          this.#b_accessor_storage = v;
        }
      }
      "
    `);
  });

  test.concurrent("bundled and minified output keeps working", async () => {
    using dir = tempDir("legacy-accessor-build", {
      "tsconfig.json": JSON.stringify({ compilerOptions: legacy }),
      "index.ts": `
        function dec(_target: any, _key: string, desc: PropertyDescriptor) {
          const get = desc.get!;
          desc.get = function () { return get.call(this) + "!"; };
        }
        class A {
          #x_accessor_storage = "user";
          accessor x = "a";
          @dec accessor y = "b";
          static accessor z = "c";
          accessor #w = "d";
          accessor [Symbol.for("k")] = "e";
          user() { return this.#x_accessor_storage; }
          w() { return this.#w; }
        }
        const a = new A();
        a.x += "x";
        a.y += "y";
        A.z += "z";
        console.log(JSON.stringify([a.x, a.y, A.z, a.w(), a[Symbol.for("k")], a.user(), Object.keys(a)]));
      `,
    });
    for (const minify of [false, true]) {
      const result = await Bun.build({
        entrypoints: [`${dir}/index.ts`],
        outdir: `${dir}/out-${minify}`,
        minify,
      });
      expect(result.logs).toBeEmpty();
      expect(result.success).toBe(true);
      await using proc = Bun.spawn({
        cmd: [bunExe(), result.outputs[0].path],
        env: bunEnv,
        cwd: String(dir),
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual(["ax", "b!y!", "cz", "d", "e", "user", []]);
      expect(exitCode).toBe(0);
    }
  });

  test("transpiled output", () => {
    expect(
      transpileLegacy(`
        function dec(target, key, desc) {}
        class A {
          accessor x = 1;
          static accessor y;
          accessor #z = 3;
          @dec accessor w: number = 4;
          accessor [computed()] = 5;
        }
      `),
    ).toMatchInlineSnapshot(`
      "import { __legacyDecorateClassTS as __legacyDecorateClassTS_3r173x8m } from "bun:wrap";
      var __bun_temp_ref_1$;
      function dec(target, key, desc) {}

      class A {
        #x_accessor_storage = 1;
        get x() {
          return this.#x_accessor_storage;
        }
        set x(v) {
          this.#x_accessor_storage = v;
        }
        static #y_accessor_storage;
        static get y() {
          return this.#y_accessor_storage;
        }
        static set y(v) {
          this.#y_accessor_storage = v;
        }
        #z_accessor_storage = 3;
        get #z() {
          return this.#z_accessor_storage;
        }
        set #z(v) {
          this.#z_accessor_storage = v;
        }
        #w_accessor_storage = 4;
        get w() {
          return this.#w_accessor_storage;
        }
        set w(v) {
          this.#w_accessor_storage = v;
        }
        #_accessor_storage = 5;
        get [__bun_temp_ref_1$ = computed()]() {
          return this.#_accessor_storage;
        }
        set [__bun_temp_ref_1$](v) {
          this.#_accessor_storage = v;
        }
      }
      __legacyDecorateClassTS_3r173x8m([
        dec
      ], A.prototype, "w", null);
      "
    `);
  });

  test("scanImports accepts accessor fields in JavaScript", () => {
    expect(
      new Bun.Transpiler({ loader: "js" }).scanImports(`import { a } from "./a"; class A { accessor x = 1 }`),
    ).toEqual([{ kind: "import-statement", path: "./a" }]);
  });
});
