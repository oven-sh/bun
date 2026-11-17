// Inputs for the scope tests. A name with an extension is a TypeScript case. `sourceType` defaults to "module".
// `referencesFirst` runs the rule `scopes/references-first` of dump.cjs instead of `scopes/all`. `nodes` also asks about every node.
//
// Every file costs a debug build seconds, for the hundreds of variables of its global scope. So what doesn't have to be at the top
// level of a file shares one, each part in a block of its own.
export const isTypeScript = it => /\.tsx?$/.test(it.name);
export const fileOf = it => {
  const directory = `${it.referencesFirst ? "references-first" : "scopes-first"}${it.nodes ? "/nodes" : ""}`;
  return isTypeScript(it) ? `${directory}/${it.name}` : `${directory}/${it.sourceType ?? "module"}/${it.name}.js`;
};
export const globals = { configured: "readonly", written: "writable", turnedOff: "off" };

const inBothOrders = it => [it, { ...it, referencesFirst: true }];
const inBlocks = parts => parts.map(it => `{ ${it} }`).join("\n");

export const cases = [
  {
    name: "declarations",
    code: "var a = 1, b; let c = a; const d = c, [e, { f, g: [h = b] }, ...i] = d; function j() {} class K {}",
  },
  {
    name: "declarations",
    sourceType: "script",
    code: "var a = 1, b; let c = a; const d = c; function e() {} class F {} var a; function e() {}",
  },
  {
    name: "blocks",
    code: inBlocks([
      "function a(b, { c, d: [e] }, f = b, ...g) { arguments; this; } const h = function i(j) { i; j; }; const k = l => l; const m = async function* () { yield this; }; ({ n() {}, get o() { return this; }, set o(p) {} });",
      "function a(b = () => c, c) { var c; let d; } function e(f = g) { var g; } function h(i, j = i) { function i() {} }",
      "class A extends B { static #a = this; b = c; [d] = e; static { var f; let g = this; A; } #h() { this.#a; } static i() { super.i(); } get [j]() { return k; } } const L = class M extends A { n = M; }; (class {});",
      "{ let a; { const b = a; function c() {} } } if (d) { let e; } else { class F {} } label: { var g; }",
      "switch (a) { case b: let c; break; case c: function d() {} default: const e = d; }",
      "try { let a; } catch (b) { let c = b; } try {} catch ({ d, e: [f = d] }) { var g; } try {} catch { let h; } finally { let i; }",
      "for (let a = 0, b = a; a < b; a++) { let c = () => a; } for (const d in e) { d; } for (const [f, { g }] of h) { f; } for (var i of j); for (k of l); for (m.n in o); for (;;) { break; } while (p) { let q; } do { let r; } while (r);",
      "let a, b, c, d, e; a = 1; b += a; c++; --d; [a, b = c, ...d] = e; ({ a, b: c, d = a, ...e } = a); a ??= b; c ||= d; e &&= a; [[a], { b }] = c; for (a of b); for ([c] in d);",
      "var { a, b = a } = {}; var [c = b, [d = c] = []] = []; function e({ f = 1, g: { h = f } = {} } = {}) {} ({ i = 2 } = {}); [j = 3] = [];",
      "{ using a = b; } async function f() { await using c = d; for (using e of g); for await (await using h of i); }",
      "let a; function b(a) { { let a; a; } a; } function c() { a; var a; } { a; let a; } (function a() { a; }); (function d() { var d; d; });",
      "let a = 0; function b() { a++; return () => { a; return function () { return a = 1; }; }; } const c = () => c;",
      "a: for (;;) { break a; } b.c.d; ({ e: f, g, [h]: i, j() {} }); k?.l?.[m]; import.meta.n; `${o}`; p`q${r}`;",
      "async function a(b) { await b; for await (const c of d) c; } function* e(f) { const g = yield f; yield* g; } const h = async i => await i;",
      "let \\u0061b = 1; ab; const 变量 = '𝒳'; 变量; let 𝒳 = 变量; function ƒ(ñ) { return ñ + 𝒳; }",
    ]),
  },
  {
    name: "blocks",
    sourceType: "script",
    code: inBlocks([
      "function a() { var arguments; arguments; } function b(c, arguments) { arguments(c); } function d() { return () => arguments; } (function () { arguments = 1; });",
      "function a() { 'use strict'; b = 1; function c() { d = 2; } } function e() { f = 3; } class G { h() { i = 4; } }",
      "for (a in b); for ([c, d = e] of f); for ({ g, h: i.j } of k); for (var l in m) { l; }",
      "var a, b; with (a) { b; c; function d() { b; e = 1; } var f = b; } with (g) with (h) a;",
      "a(); b; { function a() {} } if (c) function d() {} var b; e(); function e() { return f; var f; }",
      "this; function a() { this; () => this; } const b = () => { this; }; class C { d = this; static { this; } [this.e]() {} f(g = this) {} } ({ h() { return () => this; } });",
      "function a(b) { eval('b'); var c; } function d() { (0, eval)('e'); } eval('f');",
    ]),
  },
  ...inBothOrders({
    name: "implicit-globals",
    sourceType: "script",
    nodes: true,
    code: "a = 1; a = 2; [b, configured, c] = d; function e() { f = g; written = 1; } for (h in i); ({ j, k: turnedOff } = l); Array = 1; undefined = 2;",
  }),
  ...inBothOrders({
    name: "globals",
    code: "/* global fromComment:writable, configured:writable, written:off, Array:off */\n/* global fromComment */\n/* exported notHere */\nconfigured; written; turnedOff; fromComment = 1; Array; Object; JSON.parse; undeclared; globalThis; undefined;",
  }),
  {
    name: "globals",
    sourceType: "script",
    code: "/* exported a, c */\n/* global b:readonly */\nvar a, b, Object; function c() {} let d; configured; var configured; this;",
  },
  {
    name: "globals",
    sourceType: "commonjs",
    code: "require('a'); module.exports = exports; __dirname; var a; require = 1; this; arguments;",
  },
  {
    name: "imports",
    nodes: true,
    code: "import a, { b, c as d, default as e, 'f g' as h } from 'i'; import * as j from 'k'; import l, * as m from 'n'; export { a, b as o, d as 'p q' }; export * from 'r'; export * as s from 't'; export { u } from 'v'; export default a; export const w = j; export function x() {} export class Y {}",
  },
  {
    name: "jsx",
    code: "import A from 'a'; const b = <A c={d} {...e}><f.g /><h:i /><j>{k}</j><></></A>; function L() { return <L m='n' />; }",
  },

  ...inBothOrders({
    name: "globals.ts",
    code: "/* global fromComment:writable, Promise:writable */\nconfigured; written = 1; turnedOff; fromComment; let a: Array<ReadonlyArray<Partial<B>>>; new Promise<void>(c); const d = [1] as const; <const>['e']; Symbol.iterator; let f: Symbol; undeclared; let g: Undeclared;",
  }),
  {
    name: "blocks.ts",
    code: inBlocks([
      "type A<B, C extends B = B> = { [D in keyof B]: C }; interface E<F> extends A<F> { g: F; h(i: F): E<i>; } type J = typeof k; const k = 1; type L = A<J>; let m: L;",
      "type A<B> = B extends (infer C)[] ? C : B extends Promise<infer D extends string> ? D : never; type E<F> = F extends [infer G, ...infer H] ? [G, H] : [];",
      "type A = <B>(c: B, ...d: B[]) => c is B; type E = new <F>(g: F) => F; type H = { <I>(j: I): I; new (k: H): H; l<M>(n: M): void }; function o(p: unknown): asserts p is string {} let q: (this: Window, r: typeof q) => void;",
      "enum A { B, C = B + 1, 'D' = C, E = F } const enum G { H = A.B } declare enum I { J } A.B; let k: A.C;",
      "abstract class A<B> extends C<B> implements D<B>, E { constructor(private f: B, public readonly g = f, h?: B) { super(); } abstract i(): B; declare j: B; k!: A<B>; static l<M>(n: M): M { return n; } private o?: typeof this.k; [p: string]: unknown; accessor q = 1; override r(): this { return this; } } class S { t(this: S, u: S) {} }",
      "@a @b(c) class D { @e f = g; @h() i(@j k: L, @m() n = o) {} @p static accessor q = r; @s get t() { return u; } constructor(@v private w: X) {} }",
      "const A = 1; type A = string; let b: A = A; interface C {} class C {} function D() {} namespace D { export const e = 1; } let f: typeof D.e; type G = G[]; enum H {} type I = H; const j = H;",
      "let a = b as C; let d = <E>f; let g = h!; let i = j satisfies K; (l as M) = n; (<O>p) = q; r! = s; (t satisfies U) = v; (w as X)++; --(<Y>z);",
      "function a<B extends C, D = B>(e: B): D { let f: B; return e as unknown as D; } const g = <H,>(i: H) => i; class J<K> { l<M extends K>(n: M): K { return n; } } a<O>(p); new J<Q>(); r<S>`t`; type U = a<V>;",
      "type A = { readonly [B in C as `x${B}`]?: D[B] }; type E = F['g'][number]; type H = keyof typeof i; type J = [k: L, m?: N, ...o: P[]]; type Q = `a${R}b`; type S = unique symbol; let t: import('u').V<W>;",
      "function a(b?: C, { d, e }: F = g, [h]: I[] = [], ...j: K[]) {} const l = (m: N = m2, o?: P): Q => m; function r(this: S, t: typeof this) {} class U { constructor(public v: W, x: typeof v) {} }",
      "function a(b: number, c: typeof b) { type D = typeof c; let e: D; } const f = { g: 1 }; type H = typeof f.g; type I = typeof import('j'); class K { l = 1; m: typeof this.l; } let n: typeof n;",
    ]),
  },
  {
    name: "namespaces.ts",
    nodes: true,
    code: "namespace A { export const b = 1; const c = b; export namespace D { export type E = typeof b; } } namespace A { b; } declare module 'f' { export const g: A.D.E; } declare global { var h: number; interface I {} } namespace J.K.L { export let m; } A.b;",
  },
  {
    name: "overloads.ts",
    nodes: true,
    code: "function a(b: string): void; function a(b: number): void; function a(b: unknown) { b; } declare function c(d: E): F; class G { h(i: string): void; h(i: unknown) {} } export default function j(k: L): void; export default function j(k: unknown) {}",
  },
  {
    name: "imports.ts",
    code: "import type A from 'a'; import { type B, C } from 'b'; import type * as D from 'c'; import E = require('e'); import F = D.G; import type H = require('h'); export import I = D.J; export type { A, B }; export { C }; let k: A | B | D.L | E.M | F; C; export = E;",
  },
  {
    name: "declare.ts",
    code: "declare const a: B; declare let c: D, e: F; declare class G extends H { i: J; k(l: M): N; } declare namespace O { function p(q: R): S; } declare function t<U>(v: U): U; declare var w: typeof a; export type A = B; export interface C {} export enum D {} export namespace E {} export declare const f: G; export abstract class H {} export default interface I {} export as namespace J; export * as k from 'l';",
  },
  {
    name: "script.ts",
    code: "var a = 1; function b() {} class C {} type D = C; interface Array<T> { e: T; } var Promise: F; a; b; Array; Promise;",
  },
  {
    name: "jsx.tsx",
    nodes: true,
    code: "import React from 'react'; import A from 'a'; const B: React.FC<C> = () => { const d = React.e; return <A<F> g={h as I}>{j!}<k.l /></A>; }; function M<N,>(o: N) { return <div p={o} />; } React;",
  },
];
