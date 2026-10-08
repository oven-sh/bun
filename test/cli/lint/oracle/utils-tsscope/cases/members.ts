class A {
  private a = 1; private b = 1; private c = 1; private d = 1; private e = 1; private f = 1; private g = 1; private h = 1;
  private static s = 1; private static t = 1; static constructor() {} static 'quoted' = 1;
  #p = 1; #q = 1; #r = 1; accessor #acc = 1; static #sp = 1;
  private get acc() { return 1; } private set acc(v) {}
  private ['computed'] = 1; private [`template`] = 1; private [0x10] = 1; private [key] = 1; private 1 = 1;
  private over(): void; private over(a?: any) {}
  constructor(private pp: string, private readonly qq = 1, rr: number) {}
  m(other: A, cls: typeof A, ...rest: A[]) {
    this.a; this.b = 1; this.c += 1; x = this.d += 1; this.e++; x = this.f++; [this.g] = x; ({ y: this.h } = x);
    A.s; this.t; other.a; cls.s; rest.a; this.acc = 1;
    this.#p; this.#q = 1; #r in other; this['computed']; this[`template`]; this[16]; this[1];
    const self = this; self.a; let again = this; again = other; again.b;
    const { pp, qq: renamed, ...others } = this; ({ a: x } = this);
    function inner(this: A) { this.a; } function none() { this.a; } const arrow = () => this.a;
    for (this.a in x); for (this.b of x); [...this.c] = x; ({ ...this.d } = x); [this.e = 1] = x;
    typeof this.a; let ty: typeof this.a; (this.a as any) = 1; this.a! = 1; this?.a;
    class B { #p = 1; private a = 1; m(o: A) { this.#p; this.a; o.a; A.s; this.#q; } }
  }
  static sm({ s } = this) { this.s; this.a; }
  static { this.s; A.t; }
  prop = function () { return this.a; };
  static sprop = function () { return this.s; };
  arrowProp = () => this.a;
  static arrowStatic = () => this.s;
  accessor fn = function () { return this.a; };
  [this.a]() {}
}
const obj = { m() { this.a; } };
const C = class Named { private static x = 1; m() { Named.x; } };
abstract class D { private abstract a: number; abstract accessor b: number; private abstract m(): void; m2() { this.a; this.m(); } }
