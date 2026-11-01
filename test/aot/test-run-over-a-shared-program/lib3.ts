// Classes of the shared image whose members are read from the test files again and again, and then changed. A class is changed by one test only.
export class A1 { m() { return "m"; } } export class A2 { m() { return "m"; } } export class A3 { m() { return "m"; } }
export class A4 { m() { return "m"; } } export class A6 { m() { return "m"; } } export class A7 { m() { return "m"; } }
export class P5 { m() { return "parent"; } } export class A5 extends P5 { other() { return 1; } }
export class A8 { m() { return "m"; } } export class A9 { m() { return "m"; } } export class A10 { m() { return "m"; } }
export class A11 { m() { return "m"; } } export class A12 { get g() { return "g"; } } export class A14 { [Symbol.iterator]() { return [1][Symbol.iterator](); } }
export class A13 { v = 0; set g(v: number) { this.v = v; } get g() { return this.v; } }
export class A15 { m() { return "m"; } } export class A16 { m() { return "m"; } } export class A17 { m() { return "m"; } static s() { return "s"; } }
export class P18 { m() { return "top"; } } export class M18 extends P18 { } export class A18 extends M18 { }
export class F1 { x = 1; y = "s"; z: any = null; w = 1.5; b = true; o: object = {}; }
export function point() { return { x: 1, y: 2 }; }
export function mixed() { return { i: 1, d: 1.5, s: "s", b: true, n: null as any, u: undefined as any, o: {} as any, f: () => 1 }; }
export function typedSum(p: { x: number; y: number }) { return p.x + p.y; }
export function lengthOfY(f: F1) { return f.y.length; }
export function halfOfW(f: F1) { return f.w / 2; }
export const readM = (o: any) => o.m;
export const callM = (o: any) => o.m();
export const readG = (o: any) => o.g;
export const writeG = (o: any, v: any) => { o.g = v; };
export const readAbsent = (o: any) => o.absentName;
export const readToString = (o: any) => o.toString;
export const readKeyed = (o: any, k: any) => o[k];
export const writeX = (o: any, v: any) => { o.x = v; };
export const writeKeyed = (o: any, k: any, v: any) => { o[k] = v; };
export const hasM = (o: any) => "m" in o;
export function patch(C: any, name: PropertyKey, value: any) { C.prototype[name] = value; }
export function extend(Base: any) { return class extends Base { e() { return "e"; } }; }
export function countArguments(...all: unknown[]) { return all.length; }
export function sumArguments(...all: number[]) { let sum = 0; for (const n of all) sum += n; return sum; }
export function handOn(f: (...all: number[]) => number, ...all: number[]) { return f(...all); }
export function throwBehind(...all: unknown[]): never { throw new RangeError("behind " + all.length); }
export class Many { count: number; constructor(...all: unknown[]) { this.count = all.length; } }
export const readA = (o: any) => o.a;
export const hasA = (o: any) => "a" in o;
export const makers = {
  optional: (i: number): any => { const o: { a?: number; n: number } = { n: 1 }; if (i) o.a = i; return o; },
  klass: (): any => class { declare a?: number; n = 1; constructor(i?: number) { if (i) this.a = i; } },
  extras: (v: unknown): any => { const o: any = { x: 1 }; for (const k of ["z", "a", "b"]) o[k] = v; return o; },
  extrasInOtherOrder: (v: unknown): any => { const o: any = { x: 1 }; for (const k of ["b", "a"]) o[k] = v; return o; },
  leftItsSlot: (): any => { const o: any = { a: 1, y: 2 }; o.a = "text"; return o; },
};
export const withFunctions = (i: number): any => ({ n: i, plain: (x: number) => x + 1, capturing: () => i * 2, method() { return this.n; }, async later() { return i; }, *some() { yield i; } });
export const readers = { plain: (o: any) => o.plain, capturing: (o: any) => o.capturing, method: (o: any) => o.method, later: (o: any) => o.later, some: (o: any) => o.some };
export const callers = { plain: (o: any) => o.plain(1), capturing: (o: any) => o.capturing(), method: (o: any) => o.method(), later: (o: any) => o.later(), some: (o: any) => [...o.some()] };
export const writeA = (o: any, v: any) => { o.a = v; };
export const constantText = "a constant text";
export const textNobodyReadsThere = "read first from the other side";
export let changingText = "first";
export function changeText(text: string) { changingText = text; }
export function readChangingText() { return changingText; }
export const emptyText = "";
export const isInstance = (v: any, C: any) => v instanceof C;
export const readS = (C: any) => C.s;
export const readStaticText = (C: any) => C.text;
export const classes = {
  pair: (): any[] => { class C { static s = 3; static text = "static text"; static bump() { return ++C.s; } x = 1; } class D extends C { static own = 1; } return [C, D]; },
  oldStyle: (): any => function F(this: any) { this.x = 1; },
};
export const withAccessor = (): any => class { kept: unknown = 0; get g() { return this.kept; } set g(v: unknown) { this.kept = v; } };
