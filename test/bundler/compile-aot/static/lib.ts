export const EMPTY = "";
export const one = "x";
export const wide = "→";
export const wideLong = "héllo → wörld ✓ and some more text so that it is long enough to alias the table's bytes";
export class Base {
  a = 1;
  #p = 2;
  static s = "st";
  get p() { return this.#p; }
  m(x: number) { return x + this.a; }
}
export class Derived extends Base {}
export class WithFields extends Base {
  b = "b";
  ["computed" + 1] = 3;
  static { (this as any).blk = "blk"; }
}
export function* gen(n: number) { for (let i = 0; i < n; i++) yield i * 2; }
export async function asy(x: number) { await null; return x + 1; }
export async function* agen() { yield "a"; yield "b"; }
export const arrow = (x: number) => (y: number) => x + y;
export function tag(s: TemplateStringsArray, ...v: unknown[]) { return s.raw.join("|") + v.join(","); }
export function sameTemplate() { const f = (s: TemplateStringsArray) => s; return f`a${1}b`; }
export function thrower() { throw new Error("boom"); }
export function usesArguments() { return arguments.length + ":" + Array.prototype.join.call(arguments, "-"); }
export function tdz() { try { return (() => later)(); } catch (e) { return (e as Error).name; } let later = 1; }
export const big = 123456789012345678901234567890n;
export const zero = 0n;
export function zeros() { return [0n, -0n, 1n, 0n + 5n]; }
export const re = /a(b+)c/gi;
export const reNamed = /(?<year>\d{4})-(?<m>\d\d)/u;
export function literalArrays() { return [[1, 2, 3], [1.5, 2.5], ["a", "b", ""], [1, "x", null]]; }
export function objWithEmptyKey() { return { "": 1, x: 2, "→": 3 }; }
export function OldStyle(this: any, v: number) { this.v = v; }
OldStyle.prototype.get = function () { return this.v; };
export function both(this: any, v: number) { if (new.target) { this.v = v; return; } return v * 2; }
export const table: any = {};
table.a = 1; table.b = 2; table["c d"] = 3; delete table.b; table.e = 5;
export const config = { x: 1, y: "two", z: [3], nested: { p: 1, q: 2 } };
(config as any).added = true;
export const frozen = Object.freeze({ k: 1, l: 2 });
export const protoObj = { hello() { return "hi " + (this as any).who; } };
export const child = Object.create(protoObj); child.who = "child";
export const many: any = {}; for (let i = 0; i < 100; i++) many["k" + i] = i;
export const inLoop: any[] = []; for (let i = 0; i < 3; i++) inLoop.push({ i, sq: i * i });
export const withAccessor = { get g() { return 7; }, set g(v) {}, plain: 1 };
export const spread = { ...config, extra: 1 };
