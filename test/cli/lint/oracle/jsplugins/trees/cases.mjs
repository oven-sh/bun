// Inputs for the test of how the nodes are laid out. Together they have nodes of nearly all types that the two parsers make, and of both
// orders of those that typescript-estree has in two.
export const cases = {
  "module.js": `#!shebang
"use strict"; import a, { b, c as d } from "e" with { type: "json" }; import * as f from "g"; export { a, b as h }; export * as i from "j";
export * from "k"; export default class {} export const l = 1n, m = /n/u, o = null, p = \`q\${a}r\`, s = a\`t\`;
async function* u(a, { b = 1, ...c }, [d, , e = 2, ...f], g = 3) { await a; yield* b; for await (const h of c) continue; return new.target; }
class A extends u { #v = this; static w; static { super.x; } static async *[a]() {} get y() { return #v in a; } set y(z) {} constructor() { super(); } }
label: for (let i = 0; ; i++) { if (a) break label; else {} } for (const j in a); do ; while (a); while (a) debugger;
switch (a) { case 1: default: } try { throw a; } catch ({ message }) {} finally {} try {} catch {}
x = { a, b: c, [d]: 1, e() {}, get f() { return 1; }, set f(g) {}, ...h }; ({ a, b: c, i = 1, ...h } = x); [a, b = 1, ...c] = [, ...d];
x = b ? c : d, e ||= f ?? g, !h, typeof i, ++j, k--, l?.m?.[n]?.(o), new p(...q), import("r"), import.meta, (s, t) => s + t, async u => {}, function () {}, class {};
<a b="c" d={e} {...f} g:h><i.j.k />{}text<></></a>;`,
  "script.js": `with (a) b; var c = function d() {}, e = "\\08"; if (c) function f() {}`,
  "types.ts": `import type A from "a"; import { type B, C } from "b"; import D = require("d"); import E = F.G; export import H = F.G; export as namespace I;
export type { A }; export type * from "j"; export default interface K<in out L extends M = N> extends O<P>, Q.R { (a: S): T; new (b?: U); readonly [c: string]: V; d?: W; e?(): X; get f(): Y; set f(g); }
type Z = any | unknown & never | void | undefined | null | string | number | boolean | bigint | symbol | object | intrinsic | this | 1 | \`a\${B}\` | B[] | [a: B, c?: C, ...d: D[]] | [B?, ...C]
  | (new () => B) | (abstract new () => B) | (<T>(a: T) => T) | { a: B } | (B extends infer U extends C ? U : never) | { readonly [K in B as C]?: D } | B["a"] | keyof B | unique symbol
  | typeof a.b<C> | typeof import("a") | import("b", { with: { c: "d" } }).E<F>;
declare function a(this: B, b: C): asserts b is D; declare function c(d): d is E; function e(f: B): asserts f; function e(f) {}
enum G { H, I = 1, "J" = 2 } declare const enum K2 {} namespace L.M.N { export const o = 1; } declare module "p" { } declare module "q"; declare global { }
abstract class R<S> extends T<U> implements V, W<X> { constructor(private a: B, public readonly b = 1, c?: C, ...d) { super(); } abstract e(): void; abstract f: B; abstract accessor g: C;
  @h() declare readonly i?: D; static override accessor j: E; k?(): void; l<M>(this: B); l() {} get n() { return 1; } [o: string]: P; }
let p = <B>q, r = s as C, t = u satisfies D, v = w!, x = y<Z>, a1: B = b1!.c1, d1 = function (e1 = 1, { f1 = 2 }, [g1 = 3]) {}, h1 = { i1() {}, get j1() { return 1; }, k1: function () {} };
({ l1 = 1 } = m1); [n1 = 2] = o1; for ({ p1 = 3 } of q1); export function r1() {} export class t1 {} export { u1 }; export const v1 = 10n, w1 = /x/g, y1 = \`z\`;
class a2 { b2(@c2 d2, e2?: B) {} } class f2 { "constructor"() {} }`,
  "assignment.ts": `export = a;`,
  "function.ts": `export default function a() {}`,
  "elements.tsx": `const a = <b c:d="e" />, f = <g></g>, h = <i:j />, k = <l<M> n="o">p</l>;`,
  ...Object.fromEntries(
    ["module-breaks.js", "breaks.tsx"].map(file => [
      file,
      `a = <b>c\r\n  d\re\n</b>;\r\nf = <g>\r\n</g>;\r\nh = <i j="k\r\nl">&amp;\r\n&#13;</i>;\r\nm = \`n\r\no\`;`,
    ]),
  ),
};
