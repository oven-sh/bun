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
