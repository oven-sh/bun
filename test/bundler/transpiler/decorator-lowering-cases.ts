// Programs for decorators.test.ts: what a class with `experimentalDecorators` does when it runs. Each is compiled by
// TypeScript and by Bun, then run. `show` logs its arguments.
import { type Case, program } from "./decorator-differential";

/** Fields are defined or assigned, and that decides where their initializers and keys end up. */
function defineAndAssign(name: string, main: string, others?: Record<string, string>): Case[] {
  return [true, false].map(useDefineForClassFields => ({
    ...program(`lowering/${name}, useDefineForClassFields: ${useDefineForClassFields}`, main, others),
    compilerOptions: { useDefineForClassFields },
  }));
}

/** What the cases of `defineAndAssign` have to log, for each value of `useDefineForClassFields` that TypeScript gets wrong. */
function expecting([define, assign]: Case[], expected: { define?: string[]; assign?: string[] }): Case[] {
  return [
    { ...define, expected: expected.define },
    { ...assign, expected: expected.assign },
  ];
}

const instanceFields: Case[] = [
  ...defineAndAssign(
    "initializers run in order",
    `class A { @d a = (log("a"), 1); b = (log("b"), 2); @d c = (log("c"), 3); e = (log("e"), 4); }
show(Object.keys(new A()));`,
  ),
  ...defineAndAssign(
    "field without an initializer",
    `class A { @d x?: number; y?: number; @d z: any; }
show(Object.keys(new A()));`,
  ),
  ...defineAndAssign(
    "decorator defines an accessor on the prototype",
    `const observed = (target: any, key: string) =>
  void Object.defineProperty(target, key, { set(v) { log("set " + key + " " + v); }, get() { return "got"; }, configurable: true });
class A { @observed x = 1; @observed y?: number; z = 2; }
const a = new A();
show(Object.keys(a), a.x, a.y);`,
  ),
  ...defineAndAssign(
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
  ...defineAndAssign(
    "setter of the base class",
    `class Base { set x(v: number) { log("set x " + v); } set y(v: number) { log("set y " + v); } }
class A extends Base { @d x = 1; y = 2; }
show(Object.keys(new A()));`,
  ),
  ...defineAndAssign(
    "name of a function in an initializer",
    `class A { @d f = () => {}; g = () => {}; @d h = function () {}; @d k = class {}; @d static s = () => {}; static t = () => {}; }
const a = new A();
show(a.f.name, a.g.name, a.h.name, a.k.name, A.s.name, A.t.name);`,
  ),
  ...expecting(
    defineAndAssign(
      "constructor parameter named like a variable of an initializer",
      `const v = "outer";
class A { x = v; constructor(v: string) { show(v); } }
show(new A("parameter").x);`,
    ),
    { assign: [`"parameter"`, `"outer"`] },
  ),
  ...expecting(
    defineAndAssign(
      "variable of the constructor named like a variable of an initializer",
      `const v = "outer";
class A { x = v; y = () => v; constructor() { const v = "inner"; show(v); } }
const a = new A();
show(a.x, a.y());`,
    ),
    { assign: [`"inner"`, `"outer" "outer"`] },
  ),
  ...expecting(
    defineAndAssign(
      "names of the constructor that an initializer means something else by",
      `let v = "outer";
function h() { return "outer h"; }
(globalThis as any).g = "global";
declare const g: string;
class A { x = v + " " + h(); y = () => v; z = g; constructor(v: string, g: string) { function h() { return "inner h"; } show(v, g, h()); } }
const a = new A("parameter v", "parameter g");
show(a.x, a.y(), a.z);
class B { x = v; constructor(public h = "property") { { var v = "inner"; } show(v); } }
show(Object.entries(new B()).join(";"));
class C { x = class { y = v; constructor(v: string) { show(v); } }; constructor(v: string) { show(v); } }
show(new (new C("parameter of C").x)("parameter of x").y);`,
    ),
    {
      assign: [
        `"parameter v" "parameter g" "inner h"`,
        `"outer outer h" "outer" "global"`,
        `"inner"`,
        `"h,property;x,outer"`,
        `"parameter of C"`,
        `"parameter of x"`,
        `"outer"`,
      ],
    },
  ),
  ...defineAndAssign(
    "name of a function in a private field",
    `class A { #f = () => {}; #g = function () {}; #c = class {}; y?: number; names() { return [this.#f.name, this.#g.name, this.#c.name]; } }
show(new A().names());
class B { x = (log("x"), 1); #f = () => {}; #n = (log("n"), 2); z = (log("z"), 3); names() { return [this.#f.name, this.#n]; } }
show(new B().names());`,
  ),
  ...defineAndAssign(
    "this and arrow functions in an initializer",
    `class A { n = 1; @d x = this.n + 1; @d f = () => this.x; @d o = { m: () => this.n }; }
const a = new A();
show(a.x, a.f(), a.o.m());`,
  ),
  ...defineAndAssign(
    "after super()",
    `class Base { constructor() { log("base"); } }
class A extends Base { @d a = (log("a"), 1); b = (log("b"), 2); constructor() { log("before"); super(); log("after"); } }
new A();`,
  ),
  ...defineAndAssign(
    "derived class without a constructor",
    `class Base { args: any[]; constructor(...args: any[]) { this.args = args; } }
class A extends Base { @d a = (log("a"), 1); b = 2; }
const a = new (A as any)(1, 2, 3);
show(a.args, Object.keys(a));`,
  ),
  ...defineAndAssign(
    "parameter properties and fields",
    `class A { @d a = (log("a"), this.x); b = (log("b"), this.y); constructor(public x: number, @p private y: number, z: number) { log("body"); } }
const a = new A(1, 2, 3);
show(Object.keys(a), a.a, a.b);`,
  ),
  ...defineAndAssign(
    "parameter properties in a derived class",
    `class Base { constructor() { log("base"); } }
class A extends Base { @d a = (log("a"), this.x); constructor(public x: number) { log("before"); super(); log("after " + this.x); } }
show(Object.keys(new A(1)));`,
  ),
  ...defineAndAssign(
    "directive in the constructor",
    `class A { @d a = 1; constructor(public x: number) { "use strict"; log("body"); } }
show(Object.keys(new A(1)));`,
  ),
  ...defineAndAssign(
    "private fields",
    `class A { #a = (log("#a"), 1); @d b = (log("b"), this.#a + 1); #c = (log("#c"), this.b + 1); #e?: number; get all() { return [this.#a, this.b, this.#c, this.#e, #e in this]; } }
show(new A().all);`,
  ),
  ...defineAndAssign(
    "names that are not identifiers",
    `class A { @d "a b" = 1; @d 1 = 2; @d "c" = 3; @d 1.5 = 4; @d 0x10 = 5; "x y" = 6; 2 = 7; }
show(Object.entries(new A()).join(";"));`,
  ),
  ...defineAndAssign(
    "fields in quotes named like built-in properties",
    `try { class A { @d static "name" = "n"; } show(A.name); } catch (e: any) { log(e.name); }
try { class A { @d static "length" = 5; } show(A.length); } catch (e: any) { log(e.name); }
class B { @d "__proto__" = 1; }
show(Object.keys(new B()), Object.getPrototypeOf(new B()) === B.prototype);`,
  ),
  ...defineAndAssign(
    "declare fields",
    `class A { @d declare a: number; declare c: number; @d f?: number; @d static declare s: number; }
show(Object.keys(new A()), "s" in A);`,
  ),
  ...expecting(
    defineAndAssign(
      "abstract fields",
      `const seen = (target: any, key: string) => void show(key);
abstract class A { @seen abstract b: number; abstract e: number; }
class B extends A { declare b: number; declare e: number; }
show(Object.keys(new B()));`,
    ),
    { define: [`A.prototype["b"] design:type = Number`, `"b"`, `[]`] },
  ),
  ...defineAndAssign(
    "optional, definite and readonly fields",
    `class A { @d a?: number = 1; @d b!: number; @d readonly c = 3; @d private e = 4; @d protected f?: number; @d public override g = 5; }
show(Object.keys(new A()));`,
  ),
];

const staticFields: Case[] = [
  ...defineAndAssign(
    "order of static fields and blocks",
    `class A { @d static a = (log("a"), 1); static b = (log("b"), A.a); static { log("block " + A.a + " " + A.b); } @d static c = (log("c"), A.b); static { log("block " + A.c); } }
show(Object.keys(A));`,
  ),
  ...defineAndAssign(
    "this in a static initializer",
    `class A { static n = 1; @d static m = this.n + 1; @d static f = () => this.m; static g = this.f(); }
show(A.m, A.f(), A.g);`,
  ),
  ...defineAndAssign(
    "super in a static initializer",
    `class Base { static n = 1; static m() { return "base m"; } }
class A extends Base { @d static a = super.n + 1; @d static b = super.m(); static c = super.m(); @d static e = () => super.n; }
show(A.a, A.b, A.c, A.e());`,
  ),
  ...defineAndAssign(
    "private names in a static initializer",
    `class A { static #p = 1; @d static q = A.#p + 1; @d static r = this.#p + 2; static #m() { return 3; } @d static s = A.#m(); }
show(A.q, A.r, A.s);`,
  ),
  ...defineAndAssign(
    "static field without an initializer",
    `class A { @d static x?: number; static y?: number; }
show(Object.keys(A), "x" in A, "y" in A);`,
  ),
  ...defineAndAssign(
    "static setter of the base class",
    `class Base { static set x(v: number) { log("set x " + v); } static set y(v: number) { log("set y " + v); } static set z(v: number) { log("set z " + v); } }
class A extends Base { @d static x = 1; static y = 2; static z?: number; }
show(Object.keys(A));`,
  ),
  ...defineAndAssign(
    "what a decorator sees of a static field",
    `const seen = (target: any, key: string) => show(key, Object.getOwnPropertyDescriptor(target, key)?.value);
class A { @seen static a = 1; @seen static b?: number; @seen c = 2; @seen m() {} }`,
  ),
  ...defineAndAssign(
    "static field that throws",
    `try { class A { @d static a = 1; @d static b = (() => { throw new Error("no"); })(); @d static c = (log("c"), 3); } } catch (e: any) { log(e.message); }`,
  ),
  ...defineAndAssign(
    "static fields named like those of a function",
    `try { class A { @d static name = "n"; } show(A.name, Object.getOwnPropertyDescriptor(A, "name")?.writable); } catch (e: any) { log(e.name); }
try { class A { static length = 2; } show(A.length); } catch (e: any) { log(e.name); }`,
  ),
  ...defineAndAssign(
    "class without a name",
    `export default class { static a = 1; @d static b = this.a + 1; @d c = 3; static { show(this.b); } }`,
  ),
];

const replace = `const replace = (c: any) => { const r = class extends c { static tag = "new"; }; Object.defineProperty(r, "name", { value: c.name + "2" }); return r as any; };\n`;

const classNames: Case[] = [
  ...defineAndAssign(
    "a key reads the name of its class, which has a decorator",
    `const same = (c: any) => c;
try {
  @same class A { ["z" + A.name] = 1; }
  show(Object.keys(new A()));
} catch (error: any) {
  show("throws");
}
const kind = (value: string) => (log(value), value);
@same class B { static [kind(typeof B)] = 1; static s = typeof B; [kind(typeof B)]() {} }
show(Object.keys(B), B.s);`,
  ),
  ...defineAndAssign(
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
  ...defineAndAssign(
    "the decorator returns nothing",
    `@d class Foo { static self = Foo; who() { return Foo; } static same = () => Foo === Foo.self; }
show(Foo.self === Foo, new Foo().who() === Foo, Foo.same());`,
  ),
  ...defineAndAssign(
    "only a decorator on a parameter of the constructor",
    `class Foo { static self = Foo; constructor(@p x: number) {} who() { return Foo; } }
show(Foo.self === Foo, new Foo(1).who() === Foo);`,
  ),
  ...defineAndAssign(
    "only decorators on members",
    `class Foo { static self = Foo; @d who() { return Foo; } @d static a = Foo; }
show(Foo.self === Foo, new Foo().who() === Foo, Foo.a === Foo);`,
  ),
  ...defineAndAssign(
    "the name of the class",
    `@d class Foo { static n = Foo.name; static t = this.name; }
show(Foo.name, Foo.n, Foo.t);`,
  ),
  ...defineAndAssign(
    "several decorators",
    `${replace}const order = (n: number) => (c: any) => void show(n, c.name);
@order(1) @replace @order(2) @replace @order(3) class Foo { who() { return Foo.name; } }
show(Foo.name, new Foo().who());`,
  ),
  ...defineAndAssign(
    "exported",
    `import { Foo, later } from "./foo.js";
show(Foo.tag, new Foo().who(), later());`,
    {
      "foo.ts": `${replace}@replace export class Foo { static tag = "old"; who() { return Foo.tag; } }
export const later = () => Foo.tag;`,
    },
  ),
  ...defineAndAssign(
    "exported as default",
    `import Foo, { later } from "./foo.js";
show(Foo.tag, new Foo().who(), later());`,
    {
      "foo.ts": `${replace}@replace export default class Foo { static tag = "old"; who() { return Foo.tag; } }
export const later = () => Foo.tag;`,
    },
  ),
  ...defineAndAssign(
    "exported as default, without a name",
    `import Foo from "./foo.js";
show(Foo.tag, new Foo().who());`,
    { "foo.ts": `${replace}@replace export default class { static tag = "old"; who() { return "who"; } }` },
  ),
  ...defineAndAssign(
    "exported later",
    `import { Bar, Foo } from "./foo.js";
show(Foo.tag, Bar.tag, new Foo().who());`,
    {
      "foo.ts": `${replace}@replace class Foo { static tag = "old"; who() { return Foo.tag; } }
export { Foo, Foo as Bar };`,
    },
  ),
  ...defineAndAssign(
    "in a namespace",
    `${replace}namespace NS { @replace export class Foo { static tag = "old"; who() { return Foo.tag; } } export const later = () => Foo.tag; }
show(NS.Foo.tag, new NS.Foo().who(), NS.later());`,
  ),
  ...defineAndAssign(
    "in a function",
    `${replace}function make() { @replace class Foo { static tag = "old"; who() { return Foo.tag; } } return Foo; }
const [A, B] = [make(), make()];
show(A === B, new A().who(), new B().who());`,
  ),
  ...defineAndAssign(
    "a class in the body has the same name",
    `${replace}@replace class Foo { static tag = "old"; who() { class Foo { static tag = "inner"; } return Foo.tag; } other(Foo: any) { return Foo.tag; } }
show(new Foo().who(), new Foo().other({ tag: "parameter" }));`,
  ),
  ...defineAndAssign(
    "the heritage clause and decorators name the class",
    `${replace}const named = (f: () => any) => (...a: any[]) => void show(f().tag);
@replace class Foo { static tag = "old"; @named(() => Foo) m() {} n(@named(() => Foo) x: any) {} }`,
  ),
  ...defineAndAssign(
    "typeof, new and optional uses of the name",
    `${replace}@replace class Foo { static tag = "old"; a() { return typeof Foo; } c() { return new Foo().e(); } e() { return Foo?.tag; } }
const foo = new Foo();
show(foo.a(), foo.c());`,
  ),
  ...expecting(
    defineAndAssign(
      "shorthand use of the name",
      `${replace}@replace class Foo { static tag = "old"; b() { return { Foo }.Foo.tag; } }
show(new Foo().b());`,
    ),
    { define: [`"new"`], assign: [`"new"`] },
  ),
  ...defineAndAssign(
    "instanceof the class in its own methods",
    `${replace}@replace class Foo { is(x: any) { return x instanceof Foo; } static make() { return new Foo(); } }
show(new Foo().is(new Foo()), Foo.make() instanceof Foo, Foo.make().constructor.name);`,
  ),
];

const keys = `let n = 0;\nconst k = (name = "k") => (log("key " + name + n), name + n++);\nconst seen = (target: any, key: any) => void show("decorated", typeof target === "function" ? "static" : "instance", key);\n`;

const computedKeys: Case[] = [
  ...defineAndAssign(
    "each key is evaluated once",
    `${keys}class A { @seen [k()]() {} @seen [k()] = 1; @seen static [k()] = 2; @seen static [k()]() {} @seen get [k()]() { return 1; } }
show(Object.getOwnPropertyNames(A.prototype), Object.keys(new A()), Object.keys(new A()), Object.keys(A), n);`,
  ),
  ...defineAndAssign(
    "keys of members without decorators",
    `${keys}class A { [k()]() {} [k()] = 1; static [k()] = 2; [k()]?: number; static [k()]?: number; static [k()]() {} [k()] = 3; }
show(Object.getOwnPropertyNames(A.prototype), Object.keys(new A()), Object.keys(new A()), Object.getOwnPropertyNames(A).sort(), n);`,
  ),
  ...defineAndAssign(
    "keys, initializers and static blocks",
    `${keys}class A { static [k("a")] = log("static a"); [k("b")] = log("instance b"); static { log("block"); } @seen [k("c")]() {} @seen static [k("e")] = log("static e"); @seen [k("f")] = log("instance f"); }
log("defined");
new A();`,
  ),
  ...defineAndAssign(
    "only fields have keys",
    `${keys}class A { @seen [k()] = 1; [k()] = 2; @seen static [k()] = 3; static [k()] = 4; }
show(Object.keys(new A()), Object.keys(A), n);`,
  ),
  ...defineAndAssign(
    "keys and the heritage clause",
    `${keys}class A extends (log("extends"), Object) { @seen [k()] = 1; @seen [k()]() {} }
show(Object.keys(new A()));`,
  ),
  ...defineAndAssign(
    "keys that are literals",
    `${keys}class A { @seen ["a"] = 1; @seen [1] = 2; @seen ["b c"]() {} @seen static ["e"] = 3; @seen [\`f\`] = 4; @seen [1n as any] = 5; ["g"] = 6; static ["h"] = 7; }
show(Object.keys(new A()), Object.keys(A));`,
  ),
  ...defineAndAssign(
    "keys that are symbols",
    `${keys}const s = Symbol("s"), t = Symbol("t");
class A { @seen [s] = 1; @seen [t]() {} @seen static [s] = 2; @seen [Symbol.iterator]() {} [Symbol.toStringTag] = "tag"; }
show(Object.getOwnPropertySymbols(new A()).map(String), Object.getOwnPropertySymbols(A).map(String), Object.getOwnPropertySymbols(A.prototype).map(String));`,
  ),
  ...defineAndAssign(
    "the variable of a key changes later",
    `${keys}let name = "first";
class A { @seen [name] = 1; [name] = 2; @seen [name + "Method"]() {} static [name] = 3; }
name = "second";
show(Object.keys(new A()), Object.keys(A), Object.getOwnPropertyNames(A.prototype));`,
  ),
  ...defineAndAssign(
    "a key is converted to a property key once",
    `${keys}const key = { toString() { log("toString"); return "converted"; } } as any;
class A { @seen [key] = 1; }
show(Object.keys(new A()), Object.keys(new A()));`,
  ),
  ...defineAndAssign(
    "a key is converted to a property key once, method",
    `${keys}const key = { toString() { log("toString"); return "converted"; } } as any;
class A { @seen [key]() {} }
show(Object.getOwnPropertyNames(A.prototype));`,
  ),
  ...defineAndAssign(
    "a decorator on a parameter of a method with a key",
    `${keys}class A { [k()](@p x: any) {} static [k()](@p x: any) {} }
show(n);`,
  ),
  ...defineAndAssign(
    "accessor pair with the same key expression",
    `${keys}const name = "x";
class A { @seen get [name]() { return 1; } set [name](v: number) {} }
show(Object.getOwnPropertyNames(A.prototype));`,
  ),
  ...defineAndAssign(
    "keys that use this",
    `${keys}const outer = { name: "outerThis" };
function f(this: any) { class A { @seen [this.name] = 1; @seen [this.name + "M"]() {} static [this.name] = 2; } return [Object.keys(new A()), Object.keys(A)]; }
show(f.call(outer));
function g(this: any) { class A { [this.name] = 1; } const B = class { [this.name] = 2; static [this.name] = 3; }; return [Object.keys(new A()), Object.keys(new B()), Object.keys(B)]; }
show(g.call(outer));
class Outer { #p = "private"; name = "field"; A = class { [this.name] = 1; [this.#p] = 2; }; }
show(Object.keys(new (new Outer().A)()));`,
  ),
  ...defineAndAssign(
    "keys that use super",
    `class Base { get y() { return "baseY"; } static get y() { return "staticY"; } }
class Outer extends Base { m() { return class { [super.y] = 1; }; } static s() { class A { [super.y] = 1; static [super.y] = 2; } return A; } }
show(Object.keys(new (new Outer().m())()), Object.keys(new (Outer.s())()), Object.keys(Outer.s()));`,
  ),
  ...expecting(
    defineAndAssign(
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
    defineAndAssign(
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
  ...expecting(
    defineAndAssign(
      "keys that use eval",
      `function f(this: any) { return class { [eval("this.k")] = 1; }; }
show(Object.keys(new (f.call({ k: "from this" }))()));
class Base { set x(v: number) { log("set x " + v); } }
class B extends Base { x = 1; [(0, eval)("'indirect'")] = 2; }
show(Object.keys(new B()));`,
    ),
    { assign: [`["from this"]`, "set x 1", `["indirect"]`] },
  ),
  ...defineAndAssign(
    "keys that are enum members",
    `enum E { a, b = "B" }
const enum F { c = 5 }
class Base { set x(v: number) { log("set x " + v); } static set s(v: number) { log("set s " + v); } }
class A extends Base { x = 1; [E.b] = 2; [F.c] = 3; static s = 4; static [E.a] = 5; }
show(Object.keys(new A()), Object.keys(A));`,
  ),
  ...defineAndAssign(
    "keys that are templates, conditions, elements, imports or literals",
    `import { imported } from "./keys.js";
const o: any = { a: ["element"] }, i = 0, yes = true, tag = (strings: any) => strings[0];
class Base { set x(v: number) { log("set x " + v); } }
class A extends Base {
  x = 1; [\`template\${i}\`] = 1; [tag\`tagged\`] = 2; [yes ? "yes" : "no"] = 3; [o.a[i]] = 4; [imported] = 5;
  [1n as any] = 6; [undefined as any] = 7;
}
show(Object.keys(new A()));`,
    { "keys.ts": `export const imported = "imported";` },
  ),
  ...defineAndAssign(
    "keys that are strings added together",
    `class Base { set ab(v: number) { log("set ab " + v); } static set cd(v: number) { log("set cd " + v); } }
class A extends Base { ["a" + "b"] = 1; static ["c" + "d"] = 2; @d ["e" + "f" + "g"] = 3; @d static ["h" + \`i\`] = 4; }
show(Object.keys(new A()), Object.keys(A));`,
  ),
  ...expecting(
    defineAndAssign(
      "keys that are true or null",
      `class Base { set x(v: number) { log("set x " + v); } }
class A extends Base { x = 1; [true as any] = 2; [null as any] = 3; }
show(Object.keys(new A()));`,
    ),
    { assign: ["set x 1", `["true", "null"]`] },
  ),
  ...expecting(
    defineAndAssign(
      "a class or function without a name is a key",
      `const names: string[] = [];
const toString = Function.prototype.toString;
Function.prototype.toString = function () { names.push(this.name); return "key" + names.length; };
class A { @seen [class {} as any] = 1; [function () {} as any] = 2; static [class {} as any] = 3; }
const a = new A();
Function.prototype.toString = toString;
function seen() {}
show(names, Object.keys(a), Object.keys(A));`,
    ),
    {
      define: ["A.prototype[undefined] design:type = Object", `["", "", ""] ["key1", "key2"] ["key3"]`],
      assign: ["A.prototype[undefined] design:type = Object", `["", "", ""] ["key1", "key2"] ["key3"]`],
    },
  ),
  ...defineAndAssign(
    "a static key that uses a function, next to instance fields",
    `class Base { y: any = "base y"; set x(v: any) { log("set x " + v); } }
const key = (name: string, f: () => any) => name;
class A extends Base { x = 1; y: any; static [key("k", () => 1)] = 3; }
show(Object.keys(new A()), new A().y, Object.keys(A));
const f = (B = class extends Base { x = 1; y: any; static [key("k", Object)] = 3; }) => B;
show(Object.keys(new (f())()), new (f())().y, Object.keys(f()));`,
  ),
  ...defineAndAssign(
    "decorators that put an accessor on the prototype, next to a key that uses this",
    `const accessor = (target: any, key: string) => {
  Object.defineProperty(target, key, { set(v) { log("set " + key + " " + v); }, get() { return "got " + key; }, configurable: true });
};
function f(this: any) {
  class A { @accessor x = 1; @accessor y: any; @accessor static z = 2; [this.k] = 3; static [this.k] = 4; }
  return A;
}
const A = f.call({ k: "k" });
const a = new A();
show(Object.keys(a), a.x, a.y, Object.keys(A), A.z);`,
  ),
  ...defineAndAssign(
    "keys that use new, a function, an array or a regular expression",
    `class Base { set x(v: any) { log("set x " + v); } }
class K { k = "made"; }
class A extends Base {
  x = 1;
  [new K().k] = 2;
  [(function () { return "called"; })()] = 3;
  [["a", ...["b"]].join("")] = 4;
  static [/source/.source] = 5;
}
show(Object.keys(new A()), Object.keys(A));`,
  ),
  ...defineAndAssign(
    "keys of fields after the last key of a method",
    `${keys}class A extends (log("extends"), Object) { [k("m")]() {} [k("a")] = 1; static [k("b")] = 2; [k("c")]?: number; static { log("block"); } }
show(Object.keys(new A()), Object.keys(A));
class B extends (log("extends"), Object) { [k("a")] = 1; static [k("b")] = 2; static { log("block"); } }
show(Object.keys(new B()), Object.keys(B));`,
  ),
  ...defineAndAssign(
    "a declare field with a key, after a field with a key",
    `${keys}class A { [k("a")] = 1; @seen declare [k("b")]: any; static s = show(Object.keys(new A())); }`,
  ),
  ...defineAndAssign(
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
  ...defineAndAssign(
    "names of class expressions, other places",
    `${keys}let A: any; A ??= class { [k()] = 1; };
const o = { 1: class { [k()] = 1; }, [k("o")]: class { [k()] = 1; }, [Symbol.iterator]: class { [k()] = 1; }, __proto__: class { [k()] = 1; } } as any;
for (var B = class { [k()] = 1; }; ; ) break;
class C { static #w = class { [k()] = 1; }; static w = C.#w.name; }
namespace N { export const E = class { [k()] = 1; }; }
show(A.name, o[1].name, o.o1.name, o[Symbol.iterator].name, Object.getPrototypeOf(o).name, B.name, C.w, N.E.name);`,
  ),
  ...defineAndAssign(
    "class expressions with a member called name",
    `${keys}const A = class { static name() { return 1; } [k()] = 1; };
const B = class { static get name() { return "own"; } [k()] = 1; };
const f = (C = class { static name() {} [k()] = 1; }) => typeof C.name;
show(typeof A.name, B.name, f());`,
  ),
  ...defineAndAssign(
    "keys that use the private names and the name of their class",
    `let f: any, g: any;
class A { #x = 7; [(f = (o: A) => o.#x, "y")] = 1; }
show(f(new A()));
class B extends Object { static #x = 8; static [(f = () => B.#x, "y")] = 1; }
show(f());
const o = {};
class C { #x = 1; [String(#x in o)] = 1; }
show(Object.keys(new C()));
const D = class E { [(g = () => E, "x")] = 1; };
show(g() === D);
let F = class { [(g = () => F, "x")] = 1; };
const G = F;
F = null!;
show(g() === G);`,
  ),
  ...defineAndAssign(
    "keys and a heritage clause or a key that has no name",
    `${keys}class A extends class {} { [k()] = 1; }
class B extends (function () {} as any) { [k()] = 1; }
class C { [class { static toString() { return "name:" + this.name; } } as any]() {} [k()] = 1; }
show(Object.getPrototypeOf(A).name, Object.getPrototypeOf(B).name, Object.getOwnPropertyNames(C.prototype));`,
  ),
  ...defineAndAssign(
    "a class in a key of a class where there is no statement",
    `let n = 0, inner: any;
function f(C = class { [(inner = class { ["k" + n++] = 1; }, "m")]() {} }) { return inner; }
const [a, b] = [f(), f()];
show(Object.keys(new a()), Object.keys(new b()));
class Outer { field = class { [(inner = class { ["k" + n++] = 1; }, "m")]() {} }; }
const [c, e] = [(new Outer(), inner), (new Outer(), inner)];
show(Object.keys(new c()), Object.keys(new e()));`,
  ),
  ...defineAndAssign(
    "class expressions",
    `${keys}const A = class { [k()] = 1; static [k()] = 2; [k()]() {} [k()]?: number; [k()] = 3; };
show(Object.keys(new A()), Object.keys(new A()), Object.keys(A), n);
const make = () => class { [k()] = 1; static [k()] = 2; };
const [B, C] = [make(), make()];
show(Object.keys(new B()), Object.keys(new C()), Object.keys(B), Object.keys(C));`,
  ),
  ...defineAndAssign(
    "class expressions where there is no statement",
    `${keys}const f = (A = class { [k()] = 1; static [k()] = 2; }) => [Object.keys(new A()), Object.keys(A)];
show(f(), f());
class Outer { inner = class { [k()] = 1; static [k()] = 2; }; }
const [x, y] = [new Outer().inner, new Outer().inner];
show(Object.keys(new x()), Object.keys(new y()), Object.keys(x), Object.keys(y));`,
  ),
  ...defineAndAssign(
    "classes in a loop",
    `${keys}for (let i = 0; i < 2; i++) { class A { @seen [k()] = i; static [k()] = i; } show(Object.keys(new A()), Object.keys(A)); }`,
  ),
  ...expecting(
    defineAndAssign(
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
  ...defineAndAssign(
    "functions in the decorators of the parameters of a method without a body",
    `const f = (..._: any[]) => (...a: any[]) => void show(a[2]);
class B {}
class A { constructor(@f(() => B) b: B); constructor(@f(() => B) b: any) { log("constructor"); } m(@f(function () {}) x: string): void; m(@f(class {}) x: any) {} }
abstract class C { abstract m(@f(() => B, { m() {} }) b: B): void; }
new A(1 as any);`,
  ),
  ...defineAndAssign(
    "private names",
    `class A { static #dec = (target: any, key: string) => void show("decorated", key); static #make() { return A.#dec; } @A.#dec m() {} @A.#make() static n = 1; @A.#dec f = 2; @d plain() {} }
show(Object.keys(new A()), Object.keys(A));`,
  ),
  ...defineAndAssign(
    "private names, with a class decorator",
    `@d class A { static #dec = (target: any, key: string) => void show("decorated", key); @A.#dec m() {} o(@((t: any, k: any, i: number) => A.#dec(t, k + i)) x: any) {} }`,
  ),
  ...defineAndAssign(
    "private names in a function of a decorator",
    `const call = (f: () => any) => (target: any, key: string) => void show(key, f());
class A { static #v = "private"; @call(() => A.#v) m() {} @call(() => #v in A) n() {} }`,
  ),
  ...defineAndAssign(
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
  ...defineAndAssign(
    "await in a decorator",
    `const f = (v: any) => (...a: any[]) => void show(v);
@f(await Promise.resolve("class")) class A { @f(await Promise.resolve("method")) m(@f(await Promise.resolve("parameter")) a: number) {} constructor(@f(await Promise.resolve("constructor")) a: number) {} }
async function g() { class B { m(@f(await Promise.resolve("in async")) a: number) {} } }
await g();`,
  ),
  ...defineAndAssign(
    "yield in a decorator",
    `const f = (v: any) => (...a: any[]) => void show(v);
function* g(): any { class B { @f(yield "method") m(@f(yield "parameter") a: number) {} } }
const it = g();
show(it.next().value, it.next("first").value, it.next("second").done);`,
  ),
  ...defineAndAssign(
    "a parameter is named like what its decorator uses",
    `import { sep } from "./dep.js";
const f = (v: any) => (...a: any[]) => void show(v);
const outer = "outer";
class A { m(@f(sep) sep: string, @f(outer) outer: string) {} constructor(@f(sep) sep: string, @f(outer) outer: string) {} static s(@f(outer) { outer }: any, @f(outer) [sep]: any) {} }`,
    { "dep.ts": `export const sep = "imported";` },
  ),
  ...defineAndAssign(
    "a decorator of a parameter uses another parameter's name",
    `const f = (v: any) => (...a: any[]) => void show(v);
const a = "outer a", b = "outer b";
class A { m(a: string, @f(a) b: string, @f(b) c = a) {} }`,
  ),
  ...defineAndAssign(
    "functions in decorators of parameters",
    `const f = (v: () => any) => (...a: any[]) => void show(v());
const x = "outer";
class A { m(@f(() => x) x: string, @f(function () { const x = "own"; return x; }) y = () => x, z = (() => { const x = "default"; return x; })()) { return [x, y(), z]; } }
show(new A().m("argument"));`,
  ),
  ...defineAndAssign(
    "this in decorators",
    `const f = (v: any) => (...a: any[]) => void show(v);
function g(this: any) { @f(this.n) class A { @f(this.n) m(@f(this.n) a: any) {} @f(this.n) static s = 1; @f(this.n) x = 2; constructor(@f(this.n) a: any) {} } }
g.call({ n: "outer this" });`,
  ),
  ...defineAndAssign(
    "arguments in decorators",
    `const f = (v: any) => (...a: any[]) => void show(v);
function g(x: string) { class A { @f(arguments[0]) m(@f(arguments[0]) a: any) {} } }
g("outer argument");`,
  ),
  ...defineAndAssign(
    "a decorator returns a descriptor",
    `const wrap = (t: any, k: string, desc: PropertyDescriptor) => ({ ...desc, value() { return "wrapped " + desc.value.call(this); } });
const constant = (t: any, k: string) => ({ get() { return "constant"; }, set(v: any) { log("set " + v); }, configurable: true, enumerable: true }) as any;
class A { @wrap m() { return "m"; } @wrap static s() { return "s"; } @constant f = 1; @constant static g = 2; }
const a = new A();
show(a.m(), A.s(), a.f, A.g, Object.keys(a), Object.keys(A));`,
  ),
  ...defineAndAssign(
    "a class in a decorator",
    `const f = (v: any) => (...a: any[]) => void show(new v().x);
class A { @f(class { x = "field of a class in a decorator"; }) m(@f(class { x = "in a parameter decorator"; static y = 1; }) a: any) {} }`,
  ),
];

const constructors: Case[] = [
  ...defineAndAssign(
    "super() is not the first statement",
    `class Base { constructor(public v?: any) { log("base"); } }
class A extends Base { @d a = (log("a"), 1); constructor(public x: number) { const y = x + 1; log("before"); super(y); log("after"); } }
show(Object.entries(new A(1)).join(";"));`,
  ),
  ...defineAndAssign(
    "super() in a try block",
    `class Base { constructor() { log("base"); } }
class A extends Base { @d a = (log("a"), 1); constructor(public x: number) { try { super(); log("in try"); } finally { log("finally"); } log("after"); } }
show(Object.keys(new A(1)));`,
  ),
  ...expecting(
    defineAndAssign(
      "super() is not a statement",
      `class Base { constructor(public v?: any) {} }
class A extends Base { a = 1; @d b = 2; static s = 3; constructor(c: boolean) { if (c) super(1); else super(2); } }
show(Object.entries(new A(true)).join(";"), A.s);
class B extends Base { a = 1; constructor() { const self: any = super(); log("after"); } }
show(Object.keys(new B()));
class C extends Base { v?: any; a = 1; constructor(c: boolean) { if (c) super(1); else super(2); } }
show(new C(true).v);`,
    ),
    {
      assign: [
        `A.prototype["b"] design:type = Object`,
        `A.prototype["b"] @d`,
        `"v,1;a,1;b,2" 3`,
        "after",
        `["v", "a"]`,
        "1",
      ],
    },
  ),
  ...expecting(
    defineAndAssign(
      "super() is not a statement, and the base class has a setter",
      `class Base { constructor(...args: any[]) { log("base " + args); } set x(v: number) { log("set x " + v); } }
class A extends Base { x = 1; constructor(c: boolean, public p = 2) { if (c) super(1); else super(2); log("after " + this.p); } }
show(Object.keys(new A(false)));
class B extends Base { x = 1; constructor() { const call = (...args: any[]) => super(...args); show(call(1, 2) === this); } }
show(Object.keys(new B()));
class C extends Base { x = 1; constructor(public args = "mine", __super = "too") { void super(args, __super); } }
show(Object.entries(new C()).join(";"));
class D extends Base { x = 1; constructor() { class Inner extends Base { x = 2; constructor() { super("inner"); } } new Inner(); void super("outer"); } }
show(Object.keys(new D()));`,
    ),
    {
      define: [
        "base 2",
        "after 2",
        `["p", "x"]`,
        "base 1,2",
        "true",
        `["x"]`,
        "base mine,too",
        `"args,mine;x,1"`,
        "base inner",
        "base outer",
        `["x"]`,
      ],
      assign: [
        "base 2",
        "set x 1",
        "after 2",
        `["p"]`,
        "base 1,2",
        "set x 1",
        "true",
        "[]",
        "base mine,too",
        "set x 1",
        `"args,mine"`,
        "base inner",
        "set x 2",
        "base outer",
        "set x 1",
        "[]",
      ],
    },
  ),
  ...expecting(
    defineAndAssign(
      "a constructor that never calls super()",
      `class Base { set x(v: number) { log("set x " + v); } }
class A extends Base { x = (log("x"), 1); constructor(public p = 2) { return { made: "here" } as any; } }
show(Object.keys(new A()));`,
    ),
    { define: [`["made"]`], assign: [`["made"]`] },
  ),
  ...defineAndAssign(
    "a class without a constructor has no design:paramtypes",
    `class Base { constructor(...args: any[]) {} }
@d class A { x = 1; }
@d class B extends Base { x = 1; }
@d class C { constructor() {} }
show(Object.keys(new A()), Object.keys(new B()), Object.keys(new C()));`,
  ),
  ...defineAndAssign(
    "the constructor returns an object",
    `class Base { constructor() { return { from: "base" } as any; } }
class A extends Base { @d a = 1; b = 2; }
show(Object.keys(new A()));`,
  ),
  ...defineAndAssign(
    "constructor overloads",
    `class A { @d a = 1; constructor(); constructor(x: number); constructor(public x?: number) { log("body"); } }
show(Object.keys(new A(1)));`,
  ),
  ...defineAndAssign(
    "constructor in quotes",
    `class A { @d a = 1; "constructor"(public x: number) { log("body"); } }
show(Object.keys(new A(1)));`,
  ),
  ...defineAndAssign(
    "a method named constructor by a computed key",
    `class A { @d a = 1; ["constructor"]() { return "method"; } }
show(Object.keys(new A()), (new A() as any).constructor());`,
  ),
  ...defineAndAssign(
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
