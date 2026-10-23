// Programs for decorators.test.ts: what a class with `experimentalDecorators` does when it runs. Each is compiled by
// TypeScript and by Bun, then run. `show` logs its arguments.
import { type Case, program } from "./decorator-differential";

/** Fields are defined or assigned, and that decides where their initializers and keys end up. */
function lowering(name: string, main: string, others?: Record<string, string>): Case[] {
  return [true, false].map(useDefineForClassFields => ({
    ...program(`lowering/${name}, useDefineForClassFields: ${useDefineForClassFields}`, main, others),
    compilerOptions: { useDefineForClassFields },
  }));
}

/** What the cases of `lowering` have to log, for each value of `useDefineForClassFields` that TypeScript gets wrong. */
function expecting([define, assign]: Case[], expected: { define?: string[]; assign?: string[] }): Case[] {
  return [
    { ...define, expected: expected.define },
    { ...assign, expected: expected.assign },
  ];
}

const instanceFields: Case[] = [
  ...lowering(
    "initializers run in order",
    `class A { @d a = (log("a"), 1); b = (log("b"), 2); @d c = (log("c"), 3); e = (log("e"), 4); }
show(Object.keys(new A()));`,
  ),
  ...lowering(
    "field without an initializer",
    `class A { @d x?: number; y?: number; @d z: any; }
show(Object.keys(new A()));`,
  ),
  ...lowering(
    "decorator defines an accessor on the prototype",
    `const observed = (target: any, key: string) =>
  void Object.defineProperty(target, key, { set(v) { log("set " + key + " " + v); }, get() { return "got"; }, configurable: true });
class A { @observed x = 1; @observed y?: number; z = 2; }
const a = new A();
show(Object.keys(a), a.x, a.y);`,
  ),
  ...lowering(
    "decorators define accessors for fields of each kind",
    `class IceCreamComponent {
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
      val = "🍦 " + next + " 🍦";
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
show(iceCream.flavor);
iceCream.flavor = "chocolate";
show(iceCream.flavor);

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
    show(this.k);
    show(S.j);
    show(this[i]);
    show(this.e);
    show(S[h]);
    show(S.u);
    show(this[t]);
    show(S[q]);
    show(this.#o);
    show(this.r);
    show(this.y);
    this.y = 100;
    show(this.y);

    show(this.u1);
    show(S.u2);
    show(S[u3]);
    show(S.u4);
    show(this[u5]);
    show(this[u6]);
    show(this.u7);
    show(S[u8]);

    show(this.u9);
    show(this.u10);
    show(this.u11);
    show(this.u12);
    show(this.u13);
    show(this.u14);
    show(this.u15);
    show(this.u16);

    this.u1 = 100;
    show(this.u1);
    S.u2 = 100;
    show(S.u2);
    S[u3] = 100;
    show(S[u3]);
    S.u4 = 100;
    show(S.u4);
    this[u5] = 100;
    show(this[u5]);
    this[u6] = 100;
    show(this[u6]);
    this.u7 = 100;
    show(this.u7);
    S[u8] = 100;
    show(S[u8]);

    show(this.u9);
    show(this.u10);
    show(this.u11);
    show(this.u12);
    show(this.u13);
    show(this.u14);
    show(this.u15);
    show(this.u16);
  }
}

let s = new S();
show(s.u9);
show(s.u10);
show(s.u11);
show(s.u12);
show(s.u13);
show(s.u14);
show(s.u15);
show(s.u16);

s.u9 = 35;
show(s.u9);
s.u10 = 36;
show(s.u10);
s.u11 = 37;
show(s.u11);
s.u12 = 38;
show(s.u12);
s.u13 = 39;
show(s.u13);
s.u14 = 40;
show(s.u14);
s.u15 = 41;
show(s.u15);
s.u16 = 42;
show(s.u16);

function StringAppender(emoji: string) {
  return function (target: Object, key: string | symbol) {
    let val = target[key];

    const getter = () => {
      return val;
    };
    const setter = value => {
      val = value + " " + emoji;
    };

    Object.defineProperty(target, key, {
      get: getter,
      set: setter,
      enumerable: true,
      configurable: true,
    });
  };
}`,
  ),
  ...lowering(
    "setter of the base class",
    `class Base { set x(v: number) { log("set x " + v); } set y(v: number) { log("set y " + v); } }
class A extends Base { @d x = 1; y = 2; }
show(Object.keys(new A()));`,
  ),
  ...lowering(
    "name of a function in an initializer",
    `class A { @d f = () => {}; g = () => {}; @d h = function () {}; @d k = class {}; @d static s = () => {}; static t = () => {}; }
const a = new A();
show(a.f.name, a.g.name, a.h.name, a.k.name, A.s.name, A.t.name);`,
  ),
  ...expecting(
    lowering(
      "constructor parameter named like a variable of an initializer",
      `const v = "outer";
class A { x = v; constructor(v: string) { show(v); } }
show(new A("parameter").x);`,
    ),
    { assign: [`"parameter"`, `"outer"`] },
  ),
  ...expecting(
    lowering(
      "variable of the constructor named like a variable of an initializer",
      `const v = "outer";
class A { x = v; y = () => v; constructor() { const v = "inner"; show(v); } }
const a = new A();
show(a.x, a.y());`,
    ),
    { assign: [`"inner"`, `"outer" "outer"`] },
  ),
  ...lowering(
    "this and arrow functions in an initializer",
    `class A { n = 1; @d x = this.n + 1; @d f = () => this.x; @d o = { m: () => this.n }; }
const a = new A();
show(a.x, a.f(), a.o.m());`,
  ),
  ...lowering(
    "after super()",
    `class Base { constructor() { log("base"); } }
class A extends Base { @d a = (log("a"), 1); b = (log("b"), 2); constructor() { log("before"); super(); log("after"); } }
new A();`,
  ),
  ...lowering(
    "derived class without a constructor",
    `class Base { args: any[]; constructor(...args: any[]) { this.args = args; } }
class A extends Base { @d a = (log("a"), 1); b = 2; }
const a = new (A as any)(1, 2, 3);
show(a.args, Object.keys(a));`,
  ),
  ...lowering(
    "parameter properties and fields",
    `class A { @d a = (log("a"), this.x); b = (log("b"), this.y); constructor(public x: number, @p private y: number, z: number) { log("body"); } }
const a = new A(1, 2, 3);
show(Object.keys(a), a.a, a.b);`,
  ),
  ...lowering(
    "parameter properties in a derived class",
    `class Base { constructor() { log("base"); } }
class A extends Base { @d a = (log("a"), this.x); constructor(public x: number) { log("before"); super(); log("after " + this.x); } }
show(Object.keys(new A(1)));`,
  ),
  ...lowering(
    "directive in the constructor",
    `class A { @d a = 1; constructor(public x: number) { "use strict"; log("body"); } }
show(Object.keys(new A(1)));`,
  ),
  ...lowering(
    "private fields",
    `class A { #a = (log("#a"), 1); @d b = (log("b"), this.#a + 1); #c = (log("#c"), this.b + 1); #e?: number; get all() { return [this.#a, this.b, this.#c, this.#e, #e in this]; } }
show(new A().all);`,
  ),
  ...lowering(
    "names that are not identifiers",
    `class A { @d "a b" = 1; @d 1 = 2; @d "c" = 3; @d 1.5 = 4; @d 0x10 = 5; "x y" = 6; 2 = 7; }
show(Object.entries(new A()).join(";"));`,
  ),
  ...lowering(
    "fields in quotes named like built-in properties",
    `try { class A { @d static "name" = "n"; } show(A.name); } catch (e: any) { log(e.name); }
try { class A { @d static "length" = 5; } show(A.length); } catch (e: any) { log(e.name); }
class B { @d "__proto__" = 1; }
show(Object.keys(new B()), Object.getPrototypeOf(new B()) === B.prototype);`,
  ),
  ...lowering(
    "declare fields",
    `class A { @d declare a: number; declare c: number; @d f?: number; @d static declare s: number; }
show(Object.keys(new A()), "s" in A);`,
  ),
  ...expecting(
    lowering(
      "abstract fields",
      `const seen = (target: any, key: string) => void show(key);
abstract class A { @seen abstract b: number; abstract e: number; }
class B extends A { declare b: number; declare e: number; }
show(Object.keys(new B()));`,
    ),
    { define: [`A.prototype["b"] design:type = Number`, `"b"`, `[]`] },
  ),
  ...lowering(
    "optional, definite and readonly fields",
    `class A { @d a?: number = 1; @d b!: number; @d readonly c = 3; @d private e = 4; @d protected f?: number; @d public override g = 5; }
show(Object.keys(new A()));`,
  ),
];

const staticFields: Case[] = [
  ...lowering(
    "order of static fields and blocks",
    `class A { @d static a = (log("a"), 1); static b = (log("b"), A.a); static { log("block " + A.a + " " + A.b); } @d static c = (log("c"), A.b); static { log("block " + A.c); } }
show(Object.keys(A));`,
  ),
  ...lowering(
    "this in a static initializer",
    `class A { static n = 1; @d static m = this.n + 1; @d static f = () => this.m; static g = this.f(); }
show(A.m, A.f(), A.g);`,
  ),
  ...lowering(
    "super in a static initializer",
    `class Base { static n = 1; static m() { return "base m"; } }
class A extends Base { @d static a = super.n + 1; @d static b = super.m(); static c = super.m(); @d static e = () => super.n; }
show(A.a, A.b, A.c, A.e());`,
  ),
  ...lowering(
    "private names in a static initializer",
    `class A { static #p = 1; @d static q = A.#p + 1; @d static r = this.#p + 2; static #m() { return 3; } @d static s = A.#m(); }
show(A.q, A.r, A.s);`,
  ),
  ...lowering(
    "static field without an initializer",
    `class A { @d static x?: number; static y?: number; }
show(Object.keys(A), "x" in A, "y" in A);`,
  ),
  ...lowering(
    "static setter of the base class",
    `class Base { static set x(v: number) { log("set x " + v); } static set y(v: number) { log("set y " + v); } static set z(v: number) { log("set z " + v); } }
class A extends Base { @d static x = 1; static y = 2; static z?: number; }
show(Object.keys(A));`,
  ),
  ...lowering(
    "what a decorator sees of a static field",
    `const seen = (target: any, key: string) => show(key, Object.getOwnPropertyDescriptor(target, key)?.value);
class A { @seen static a = 1; @seen static b?: number; @seen c = 2; @seen m() {} }`,
  ),
  ...lowering(
    "static field that throws",
    `try { class A { @d static a = 1; @d static b = (() => { throw new Error("no"); })(); @d static c = (log("c"), 3); } } catch (e: any) { log(e.message); }`,
  ),
  ...lowering(
    "static fields named like those of a function",
    `try { class A { @d static name = "n"; } show(A.name, Object.getOwnPropertyDescriptor(A, "name")?.writable); } catch (e: any) { log(e.name); }
try { class A { static length = 2; } show(A.length); } catch (e: any) { log(e.name); }`,
  ),
  ...lowering(
    "class without a name",
    `export default class { static a = 1; @d static b = this.a + 1; @d c = 3; static { show(this.b); } }`,
  ),
];

const replace = `const replace = (c: any) => { const r = class extends c { static tag = "new"; }; Object.defineProperty(r, "name", { value: c.name + "2" }); return r as any; };\n`;

const classNames: Case[] = [
  ...lowering(
    "the body sees the class that the decorator returns",
    `${replace}@replace class Foo {
  static tag = "old";
  static early = Foo.tag;
  static arrow = () => Foo.tag;
  static { show("block", Foo.tag); }
  field = Foo.tag;
  who() { return Foo.tag; }
  static who() { return Foo.tag; }
  get got() { return Foo.tag; }
}
show(Foo.tag, Foo.early, Foo.arrow(), new Foo().field, new Foo().who(), Foo.who(), new Foo().got);`,
  ),
  ...lowering(
    "the decorator returns nothing",
    `@d class Foo { static self = Foo; who() { return Foo; } static same = () => Foo === Foo.self; }
show(Foo.self === Foo, new Foo().who() === Foo, Foo.same());`,
  ),
  ...lowering(
    "only a decorator on a parameter of the constructor",
    `class Foo { static self = Foo; constructor(@p x: number) {} who() { return Foo; } }
show(Foo.self === Foo, new Foo(1).who() === Foo);`,
  ),
  ...lowering(
    "only decorators on members",
    `class Foo { static self = Foo; @d who() { return Foo; } @d static a = Foo; }
show(Foo.self === Foo, new Foo().who() === Foo, Foo.a === Foo);`,
  ),
  ...lowering(
    "the name of the class",
    `@d class Foo { static n = Foo.name; static t = this.name; }
show(Foo.name, Foo.n, Foo.t);`,
  ),
  ...lowering(
    "several decorators",
    `${replace}const order = (n: number) => (c: any) => void show(n, c.name);
@order(1) @replace @order(2) @replace @order(3) class Foo { who() { return Foo.name; } }
show(Foo.name, new Foo().who());`,
  ),
  ...lowering(
    "exported",
    `import { Foo, later } from "./foo.js";
show(Foo.tag, new Foo().who(), later());`,
    {
      "foo.ts": `${replace}@replace export class Foo { static tag = "old"; who() { return Foo.tag; } }
export const later = () => Foo.tag;`,
    },
  ),
  ...lowering(
    "exported as default",
    `import Foo, { later } from "./foo.js";
show(Foo.tag, new Foo().who(), later());`,
    {
      "foo.ts": `${replace}@replace export default class Foo { static tag = "old"; who() { return Foo.tag; } }
export const later = () => Foo.tag;`,
    },
  ),
  ...lowering(
    "exported as default, without a name",
    `import Foo from "./foo.js";
show(Foo.tag, new Foo().who());`,
    { "foo.ts": `${replace}@replace export default class { static tag = "old"; who() { return "who"; } }` },
  ),
  ...lowering(
    "exported later",
    `import { Bar, Foo } from "./foo.js";
show(Foo.tag, Bar.tag, new Foo().who());`,
    {
      "foo.ts": `${replace}@replace class Foo { static tag = "old"; who() { return Foo.tag; } }
export { Foo, Foo as Bar };`,
    },
  ),
  ...lowering(
    "in a namespace",
    `${replace}namespace NS { @replace export class Foo { static tag = "old"; who() { return Foo.tag; } } export const later = () => Foo.tag; }
show(NS.Foo.tag, new NS.Foo().who(), NS.later());`,
  ),
  ...lowering(
    "in a function",
    `${replace}function make() { @replace class Foo { static tag = "old"; who() { return Foo.tag; } } return Foo; }
const [A, B] = [make(), make()];
show(A === B, new A().who(), new B().who());`,
  ),
  ...lowering(
    "a class in the body has the same name",
    `${replace}@replace class Foo { static tag = "old"; who() { class Foo { static tag = "inner"; } return Foo.tag; } other(Foo: any) { return Foo.tag; } }
show(new Foo().who(), new Foo().other({ tag: "parameter" }));`,
  ),
  ...lowering(
    "the heritage clause and decorators name the class",
    `${replace}const named = (f: () => any) => (...a: any[]) => void show(f().tag);
@replace class Foo { static tag = "old"; @named(() => Foo) m() {} n(@named(() => Foo) x: any) {} }`,
  ),
  ...lowering(
    "typeof, new and optional uses of the name",
    `${replace}@replace class Foo { static tag = "old"; a() { return typeof Foo; } c() { return new Foo().e(); } e() { return Foo?.tag; } }
const foo = new Foo();
show(foo.a(), foo.c());`,
  ),
  ...expecting(
    lowering(
      "shorthand use of the name",
      `${replace}@replace class Foo { static tag = "old"; b() { return { Foo }.Foo.tag; } }
show(new Foo().b());`,
    ),
    { define: [`"new"`], assign: [`"new"`] },
  ),
  ...lowering(
    "instanceof the class in its own methods",
    `${replace}@replace class Foo { is(x: any) { return x instanceof Foo; } static make() { return new Foo(); } }
show(new Foo().is(new Foo()), Foo.make() instanceof Foo, Foo.make().constructor.name);`,
  ),
];

const keys = `let n = 0;\nconst k = (name = "k") => (log("key " + name + n), name + n++);\nconst seen = (target: any, key: any) => void show("decorated", typeof target === "function" ? "static" : "instance", key);\n`;

const computedKeys: Case[] = [
  ...lowering(
    "each key is evaluated once",
    `${keys}class A { @seen [k()]() {} @seen [k()] = 1; @seen static [k()] = 2; @seen static [k()]() {} @seen get [k()]() { return 1; } }
show(Object.getOwnPropertyNames(A.prototype), Object.keys(new A()), Object.keys(new A()), Object.keys(A), n);`,
  ),
  ...lowering(
    "keys of members without decorators",
    `${keys}class A { [k()]() {} [k()] = 1; static [k()] = 2; [k()]?: number; static [k()]?: number; static [k()]() {} [k()] = 3; }
show(Object.getOwnPropertyNames(A.prototype), Object.keys(new A()), Object.keys(new A()), Object.getOwnPropertyNames(A).sort(), n);`,
  ),
  ...lowering(
    "keys, initializers and static blocks",
    `${keys}class A { static [k("a")] = log("static a"); [k("b")] = log("instance b"); static { log("block"); } @seen [k("c")]() {} @seen static [k("e")] = log("static e"); @seen [k("f")] = log("instance f"); }
log("defined");
new A();`,
  ),
  ...lowering(
    "only fields have keys",
    `${keys}class A { @seen [k()] = 1; [k()] = 2; @seen static [k()] = 3; static [k()] = 4; }
show(Object.keys(new A()), Object.keys(A), n);`,
  ),
  ...lowering(
    "keys and the heritage clause",
    `${keys}class A extends (log("extends"), Object) { @seen [k()] = 1; @seen [k()]() {} }
show(Object.keys(new A()));`,
  ),
  ...lowering(
    "keys that are literals",
    `${keys}class A { @seen ["a"] = 1; @seen [1] = 2; @seen ["b c"]() {} @seen static ["e"] = 3; @seen [\`f\`] = 4; @seen [1n as any] = 5; ["g"] = 6; static ["h"] = 7; }
show(Object.keys(new A()), Object.keys(A));`,
  ),
  ...lowering(
    "keys that are symbols",
    `${keys}const s = Symbol("s"), t = Symbol("t");
class A { @seen [s] = 1; @seen [t]() {} @seen static [s] = 2; @seen [Symbol.iterator]() {} [Symbol.toStringTag] = "tag"; }
show(Object.getOwnPropertySymbols(new A()).map(String), Object.getOwnPropertySymbols(A).map(String), Object.getOwnPropertySymbols(A.prototype).map(String));`,
  ),
  ...lowering(
    "the variable of a key changes later",
    `${keys}let name = "first";
class A { @seen [name] = 1; [name] = 2; @seen [name + "Method"]() {} static [name] = 3; }
name = "second";
show(Object.keys(new A()), Object.keys(A), Object.getOwnPropertyNames(A.prototype));`,
  ),
  ...lowering(
    "a key is converted to a property key once",
    `${keys}const key = { toString() { log("toString"); return "converted"; } } as any;
class A { @seen [key] = 1; }
show(Object.keys(new A()), Object.keys(new A()));`,
  ),
  ...lowering(
    "a key is converted to a property key once, method",
    `${keys}const key = { toString() { log("toString"); return "converted"; } } as any;
class A { @seen [key]() {} }
show(Object.getOwnPropertyNames(A.prototype));`,
  ),
  ...lowering(
    "a decorator on a parameter of a method with a key",
    `${keys}class A { [k()](@p x: any) {} static [k()](@p x: any) {} }
show(n);`,
  ),
  ...lowering(
    "accessor pair with the same key expression",
    `${keys}const name = "x";
class A { @seen get [name]() { return 1; } set [name](v: number) {} }
show(Object.getOwnPropertyNames(A.prototype));`,
  ),
  ...lowering(
    "keys that use this",
    `${keys}const outer = { name: "outerThis" };
function f(this: any) { class A { @seen [this.name] = 1; @seen [this.name + "M"]() {} static [this.name] = 2; } return [Object.keys(new A()), Object.keys(A)]; }
show(f.call(outer));
function g(this: any) { class A { [this.name] = 1; } const B = class { [this.name] = 2; static [this.name] = 3; }; return [Object.keys(new A()), Object.keys(new B()), Object.keys(B)]; }
show(g.call(outer));
class Outer { #p = "private"; name = "field"; A = class { [this.name] = 1; [this.#p] = 2; }; }
show(Object.keys(new (new Outer().A)()));`,
  ),
  ...lowering(
    "keys that use super",
    `class Base { get y() { return "baseY"; } static get y() { return "staticY"; } }
class Outer extends Base { m() { return class { [super.y] = 1; }; } static s() { class A { [super.y] = 1; static [super.y] = 2; } return A; } }
show(Object.keys(new (new Outer().m())()), Object.keys(new (Outer.s())()), Object.keys(Outer.s()));`,
  ),
  ...expecting(
    lowering(
      "keys that use await",
      `${keys}class A { @seen [await Promise.resolve("awaited")] = 1; [await Promise.resolve("too")] = 2; }
show(Object.keys(new A()));
const B = class { [await Promise.resolve("expression")] = 1; };
show(Object.keys(new B()), B.name);`,
    ),
    {
      assign: [
        `A.prototype["awaited"] design:type = Object`,
        `"decorated" "instance" "awaited"`,
        `["awaited", "too"]`,
        `["expression"] "B"`,
      ],
    },
  ),
  ...expecting(
    lowering(
      "keys that use yield, arguments and new.target",
      `function* g() { class A { [yield "y"] = 1; } return Object.keys(new A()); }
const it = g();
show(it.next().value, it.next("sent").value);
function h(x: string) { return [class { [arguments[0]] = 1; }, class A { static [arguments[0]] = 2; }]; }
show(h("arg").map(C => [Object.keys(new C()), Object.keys(C)]));
function F(this: any) { this.C = class { [String(new.target === F)] = 1; }; }
show(Object.keys(new (new (F as any)().C)()));`,
    ),
    { assign: [`"y" ["sent"]`, `[[["arg"], []], [[], ["arg"]]]`, `["true"]`] },
  ),
  ...lowering(
    "keys of fields after the last key of a method",
    `${keys}class A extends (log("extends"), Object) { [k("m")]() {} [k("a")] = 1; static [k("b")] = 2; [k("c")]?: number; static { log("block"); } }
show(Object.keys(new A()), Object.keys(A));
class B extends (log("extends"), Object) { [k("a")] = 1; static [k("b")] = 2; static { log("block"); } }
show(Object.keys(new B()), Object.keys(B));`,
  ),
  ...lowering(
    "a declare field with a key, after a field with a key",
    `${keys}class A { [k("a")] = 1; @seen declare [k("b")]: any; static s = show(Object.keys(new A())); }`,
  ),
  ...lowering(
    "names of class expressions",
    `${keys}const A = class { [k()] = 1; };
let B; B = class { [k()] = 1; };
const f = (C = class { [k()] = 1; }) => C.name;
function g({ D = class { [k()] = 1; } } = {}, [E = class { [k()] = 1; }] = []) { return [D.name, E.name]; }
const o = { F: class { [k()] = 1; } };
let G: any; ({ G = class { [k()] = 1; } } = {} as any);
class H { I = class { [k()] = 1; }; static J = class { [k()] = 1; }; }
const K = class { static own = this.name; [k()] = 1; };
show(A.name, B.name, f(), g(), o.F.name, G.name, new H().I.name, H.J.name, K.own, (class { [k()] = 1; }).name);`,
  ),
  ...lowering(
    "class expressions",
    `${keys}const A = class { [k()] = 1; static [k()] = 2; [k()]() {} [k()]?: number; [k()] = 3; };
show(Object.keys(new A()), Object.keys(new A()), Object.keys(A), n);
const make = () => class { [k()] = 1; static [k()] = 2; };
const [B, C] = [make(), make()];
show(Object.keys(new B()), Object.keys(new C()), Object.keys(B), Object.keys(C));`,
  ),
  ...lowering(
    "class expressions where there is no statement",
    `${keys}const f = (A = class { [k()] = 1; static [k()] = 2; }) => [Object.keys(new A()), Object.keys(A)];
show(f(), f());
class Outer { inner = class { [k()] = 1; static [k()] = 2; }; }
const [x, y] = [new Outer().inner, new Outer().inner];
show(Object.keys(new x()), Object.keys(new y()), Object.keys(x), Object.keys(y));`,
  ),
  ...lowering(
    "classes in a loop",
    `${keys}for (let i = 0; i < 2; i++) { class A { @seen [k()] = i; static [k()] = i; } show(Object.keys(new A()), Object.keys(A)); }`,
  ),
  ...expecting(
    lowering(
      "classes in a loop, used after it",
      `${keys}const all: any[] = [];
for (let i = 0; i < 2; i++) all.push(class { [k()] = i; });
for (let i = 0; i < 2; i++) { class A { [k()] = i; } all.push(A); }
show(all.map(A => Object.keys(new A())));`,
    ),
    { assign: ["key k0", "key k1", "key k2", "key k3", `[["k0"], ["k1"], ["k2"], ["k3"]]`] },
  ),
];

const decoratorExpressions: Case[] = [
  ...lowering(
    "private names",
    `class A { static #dec = (target: any, key: string) => void show("decorated", key); static #make() { return A.#dec; } @A.#dec m() {} @A.#make() static n = 1; @A.#dec f = 2; @d plain() {} }
show(Object.keys(new A()), Object.keys(A));`,
  ),
  ...lowering(
    "private names, with a class decorator",
    `@d class A { static #dec = (target: any, key: string) => void show("decorated", key); @A.#dec m() {} o(@((t: any, k: any, i: number) => A.#dec(t, k + i)) x: any) {} }`,
  ),
  ...lowering(
    "private names in a function of a decorator",
    `const call = (f: () => any) => (target: any, key: string) => void show(key, f());
class A { static #v = "private"; @call(() => A.#v) m() {} @call(() => #v in A) n() {} }`,
  ),
  ...lowering(
    "order of evaluation",
    `const f = (name: string) => (log("evaluate " + name), (...a: any[]) => void log("apply " + name));
@f("class 1") @f("class 2") class A {
  @f("static field") static sf = log("init static field");
  @f("field") fi = 1;
  @f("method 1") @f("method 2") m(@f("parameter 0") a: any, @f("parameter 1a") @f("parameter 1b") b: any) {}
  @f("static method") static sm(@f("static parameter") a: any) {}
  @f("getter") get g() { return 1; }
  set g(@f("setter parameter") v: number) {}
  constructor(@f("constructor parameter") a: any) {}
  static { log("static block"); }
}`,
  ),
  ...lowering(
    "await in a decorator",
    `const f = (v: any) => (...a: any[]) => void show(v);
@f(await Promise.resolve("class")) class A { @f(await Promise.resolve("method")) m(@f(await Promise.resolve("parameter")) a: number) {} constructor(@f(await Promise.resolve("constructor")) a: number) {} }
async function g() { class B { m(@f(await Promise.resolve("in async")) a: number) {} } }
await g();`,
  ),
  ...lowering(
    "yield in a decorator",
    `const f = (v: any) => (...a: any[]) => void show(v);
function* g(): any { class B { @f(yield "method") m(@f(yield "parameter") a: number) {} } }
const it = g();
show(it.next().value, it.next("first").value, it.next("second").done);`,
  ),
  ...lowering(
    "a parameter is named like what its decorator uses",
    `import { sep } from "./dep.js";
const f = (v: any) => (...a: any[]) => void show(v);
const outer = "outer";
class A { m(@f(sep) sep: string, @f(outer) outer: string) {} constructor(@f(sep) sep: string, @f(outer) outer: string) {} static s(@f(outer) { outer }: any, @f(outer) [sep]: any) {} }`,
    { "dep.ts": `export const sep = "imported";` },
  ),
  ...lowering(
    "a decorator of a parameter uses another parameter's name",
    `const f = (v: any) => (...a: any[]) => void show(v);
const a = "outer a", b = "outer b";
class A { m(a: string, @f(a) b: string, @f(b) c = a) {} }`,
  ),
  ...lowering(
    "functions in decorators of parameters",
    `const f = (v: () => any) => (...a: any[]) => void show(v());
const x = "outer";
class A { m(@f(() => x) x: string, @f(function () { const x = "own"; return x; }) y = () => x, z = (() => { const x = "default"; return x; })()) { return [x, y(), z]; } }
show(new A().m("argument"));`,
  ),
  ...lowering(
    "this in decorators",
    `const f = (v: any) => (...a: any[]) => void show(v);
function g(this: any) { @f(this.n) class A { @f(this.n) m(@f(this.n) a: any) {} @f(this.n) static s = 1; @f(this.n) x = 2; constructor(@f(this.n) a: any) {} } }
g.call({ n: "outer this" });`,
  ),
  ...lowering(
    "arguments in decorators",
    `const f = (v: any) => (...a: any[]) => void show(v);
function g(x: string) { class A { @f(arguments[0]) m(@f(arguments[0]) a: any) {} } }
g("outer argument");`,
  ),
  ...lowering(
    "a decorator returns a descriptor",
    `const wrap = (t: any, k: string, desc: PropertyDescriptor) => ({ ...desc, value() { return "wrapped " + desc.value.call(this); } });
const constant = (t: any, k: string) => ({ get() { return "constant"; }, set(v: any) { log("set " + v); }, configurable: true, enumerable: true }) as any;
class A { @wrap m() { return "m"; } @wrap static s() { return "s"; } @constant f = 1; @constant static g = 2; }
const a = new A();
show(a.m(), A.s(), a.f, A.g, Object.keys(a), Object.keys(A));`,
  ),
  ...lowering(
    "a class in a decorator",
    `const f = (v: any) => (...a: any[]) => void show(new v().x);
class A { @f(class { x = "field of a class in a decorator"; }) m(@f(class { x = "in a parameter decorator"; static y = 1; }) a: any) {} }`,
  ),
];

const constructors: Case[] = [
  ...lowering(
    "super() is not the first statement",
    `class Base { constructor(public v?: any) { log("base"); } }
class A extends Base { @d a = (log("a"), 1); constructor(public x: number) { const y = x + 1; log("before"); super(y); log("after"); } }
show(Object.entries(new A(1)).join(";"));`,
  ),
  ...lowering(
    "super() in a try block",
    `class Base { constructor() { log("base"); } }
class A extends Base { @d a = (log("a"), 1); constructor(public x: number) { try { super(); log("in try"); } finally { log("finally"); } log("after"); } }
show(Object.keys(new A(1)));`,
  ),
  ...expecting(
    lowering(
      "super() is not a statement",
      `class Base { constructor(public v?: any) {} }
class A extends Base { a = 1; @d b = 2; static s = 3; constructor(c: boolean) { if (c) super(1); else super(2); } }
show(Object.entries(new A(true)).join(";"), A.s);
class B extends Base { a = 1; constructor() { const self: any = super(); log("after"); } }
show(Object.keys(new B()));`,
    ),
    {
      assign: [
        `A.prototype["b"] design:type = Object`,
        `A.prototype["b"] @d`,
        `"v,1;a,1;b,2" 3`,
        "after",
        `["v", "a"]`,
      ],
    },
  ),
  ...lowering(
    "the constructor returns an object",
    `class Base { constructor() { return { from: "base" } as any; } }
class A extends Base { @d a = 1; b = 2; }
show(Object.keys(new A()));`,
  ),
  ...lowering(
    "constructor overloads",
    `class A { @d a = 1; constructor(); constructor(x: number); constructor(public x?: number) { log("body"); } }
show(Object.keys(new A(1)));`,
  ),
  ...lowering(
    "constructor in quotes",
    `class A { @d a = 1; "constructor"(public x: number) { log("body"); } }
show(Object.keys(new A(1)));`,
  ),
  ...lowering(
    "a method named constructor by a computed key",
    `class A { @d a = 1; ["constructor"]() { return "method"; } }
show(Object.keys(new A()), (new A() as any).constructor());`,
  ),
  ...lowering(
    "default values of parameters use fields",
    `class A { @d a = 1; constructor(public x = 2, y = () => this.a) { show(y()); } }
show(Object.keys(new A()));`,
  ),
];

/** Without `useDefineForClassFields`, `target` decides. */
const targets: Case[] = ["es6", "es2015", "es2017", "es2021", "es2022", "es2023", "esnext", "ES2020", "ESNext"].map(
  target => ({
    ...program(
      `lowering/target ${target}`,
      `class Base { set x(v: number) { log("set x " + v); } static set s(v: number) { log("set s " + v); } }
class A extends Base { x = 1; @d y?: number; static s = 2; z?: number; }
show(Object.keys(new A()), Object.keys(A));`,
    ),
    compilerOptions: { target },
  }),
);

export const cases: Case[] = [
  ...instanceFields,
  ...staticFields,
  ...classNames,
  ...computedKeys,
  ...decoratorExpressions,
  ...constructors,
  ...targets,
];
