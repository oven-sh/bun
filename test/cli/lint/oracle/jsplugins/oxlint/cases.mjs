// Inputs for the tests of what a JavaScript plugin sees under an oxlint config: by the name of a file, its text. oxlint goes by the
// extension and by whether there is an `import` or an `export`, so most texts are there under several names.
//
// Every file costs a debug build time. So what doesn't have to be at the top level of a file shares one, each part in a function.
const inFunctions = parts => parts.map(it => `(function () { ${it} });`).join("\n");
const named = (name, extensions, code) => extensions.map(it => [`${name}.${it}`, `${code}\n`]);

const topLevel =
  "var a = 1, b; let c = a; const d = c; function e() {} class F {} var a; x = 1; y += 2; z++; arguments; this; Array; Object = 3; undefined; Temporal; require; module; exports; for (g in {}); for (h of []); [i, j = 1] = []; ({ k } = {}); function l() { m = 1; x; Array; }";

const functions = inFunctions([
  "function a(b, { c, d: [e] }, f = b, ...g) { arguments; this; } const h = function i(j) { i; j; }; const k = l => l + arguments; const m = async function* () { yield this; }; ({ n() {}, get o() { return this; }, set o(p) {} });",
  "function a(b = () => c, c) { var c; let d; } function e(f = g) { var g; } function h(i, j = i) { var i; }",
  "class A extends B { constructor() { super(); A; new.target; } m(a) { return a; } static s = A; #p = 1; x = this.#p; static { let q = A; q; } [k] = 1; get [l]() {} static async *[m]() {} } const C = class D extends E { m() { D; } }; const F = class {};",
  "try { a; } catch (e) { e; let z = e; } finally { b; } try { } catch { c; } try { } catch ({ d, f: [g] }) { d; g; }",
  "for (let i = 0; i < 10; i++) { i; } for (var j = 0; j < 10; j++) j; for (const k in o) { k; } for (const [l, m = l] of o) { l; m; } for (n.p in q) ; for (r[s] of t) ;",
  "switch (a) { case b: let c = 1; c; break; default: d; } label: for (;;) { break label; } do { let e; } while (e); while (f) { var g; }",
  "let a; { let a; a; } a; var { b, c: { d = b }, ...e } = f; var [g, , h = 1, ...[i]] = j; [k[l], m[n].o] = p; ({ [q]: r[s] } = t);",
  "typeof a; typeof b.c; delete d.e; void f; g?.h?.[i]?.(j); `k${l}m${n}`; o`p${q}`; r ||= s; t &&= u; v ??= w; x **= y; (z, z);",
  "({ a, b: c, [d]: e, ...f }); (function () { g; })(); (() => h)(); new I(j); k = l = m; var n = n; let o = () => o; eval('p'); async function q() { await r; for await (const s of t) s; } function* u() { yield v; yield* w; }",
  "if (a) { function b() {} } b; var c = function () {}, d = class {}; function e() { return function f() { return function g() { e; f; g; }; }; }",
]);

const modules =
  'import a, { b as c, "d" as e, f } from "x"; import * as ns from "y"; export { a, c as g, e as "h" }; export const i = 1; export function j() {} export class K {} export default class L { m() { L; } } export * from "z"; export * as n from "w"; export { o, p as q } from "v"; import.meta.url; await f; ns.r; var s; export { s }; x = 1;';

const jsx =
  '<a />; <A b={c} {...d}>{e}<F.G /></A>; <></>; <h:i j:k="l" />; <this.x />; const M = () => <N><O /></N>; <p q="r &amp; s" t=\'u\'>v &amp; &#65; &nbsp;{" "}\n  w\n  {/* x */}\n  {...y}\n</p>;';

const types = inFunctions([
  "type A = B; let x: A; interface I<T> extends J<T> { a: T; m(x: T): I<T>; } let y = 1 as const; let z = <const>1;",
  "let a: Array<string>; let b: Promise<number>; let c: Record<string, Partial<Q>>; let d: Awaited<X>; let e: Uppercase<'a'>; let f: ReturnType<typeof g>; new Map<K, V>();",
  "enum E { A, B = A, C = x, 'd-e' = 1 } E.A; const enum F { A } declare enum G { A }",
  "function f<T>(a: T, b: T = a): T { return a; } function g(a: number): void; function g(a: any) {} declare function h(a: number): void; function i(this: Window, a?: number, ...b: T[]) {}",
  "class C<T> extends D<T> implements I<T> { constructor(public a: T, private readonly b = a) { super(); } x: T; m<U>(u: U): T { return u as any; } declare y: number; accessor z = 1; override w() {} } abstract class A { abstract m(): void; abstract x: number; constructor(protected y?: T) {} }",
  "type F = (a: number) => typeof a; type G = new (a: X) => Y; type C<T> = T extends infer U ? U : never; type M<T> = { readonly [K in keyof T]?: T[K] }; type Q = typeof x.y; type V = import('x').Y; type W = `a${B}c`;",
  "let a = b as Z; let c = <Z>b; let d = b!; let e = b satisfies Z; (f as any) = 1; (<any>g) = 2; h! = 3; (i as any)++;",
  "function isA(x: any): x is A { return true; } function assertA(x: any): asserts x is A {} let a: { b: A; c(d: C): D; [k: string]: E; new (f: F): G; (h: H): I }; let t: [a: A, b?: B, ...c: C[]];",
  "let f = <T,>(a: T) => a; f<T>(a); new F<T>(a); tag<T>`x`; let u: unique symbol; let v: A.B.C; let w: A['b']; function g<const T extends readonly unknown[], U = T>(a: T) {}",
  "class A { @dec() m(@p a: T) {} @d x: T = y; } @dec class B<T> { constructor(@inj a: T) {} m(): this { return this; } static { type T = 1; } }",
  "let { a, b }: { a: A; b: B } = c; for (const d of e) {} try {} catch (f: unknown) {} declare const g: number; declare class H {} using i = j;",
]);

const typesAtTopLevel =
  'namespace N { export const a = 1; a; function f() { b = 1; } } N.a; namespace O.P { let a; } declare module "x" { const a: number; } declare global { var g: number; } namespace Q { export namespace R { export type S = 1; } } let x: Q.R.S; interface Array<T> { x: T } type Promise = 1; let p: Promise;';

const typesInModules =
  'import type { A } from "x"; import { type B, C } from "y"; import D = require("z"); import E = C.F; let a: A, b: B = C; D; E; export type { A }; export type T = 1; export interface I {} export enum G {} export namespace N {} export as namespace H;';

// typescript-eslint's scope manager doesn't go into the type of a `catch` parameter.
const catchTypes = inFunctions([
  "try {} catch (a: (b: number) => void) { a; }",
  "try {} catch (a: new (b: string) => c) { a; }",
  "try {} catch (a: { m(b: number): void; (c: d): e; new (f: g): h }) {}",
  "try {} catch (a: <B>(c: B) => B) {}",
  "try {} catch (a: { [B in 'c']: B }) {}",
  "try {} catch (a: b extends infer C ? C : d) {}",
  "try {} catch ({ a, b: [c] }: (d: e) => f) { a; c; }",
  "try {} catch (a: typeof b) { let c: (d: e) => f; }",
  "try {} catch (a: B<C>) { a; }",
]);

// Of an import type it visits the type arguments only.
const importTypeOptions = [
  "export type A = import('./m', { with: { a: function (b: unknown) { return b; } } });",
  "export type B = import('./m', { with: { a: class C { d(e) { return e; } } } });",
  "export type D = import('./m', { with: { a: f } }).G<H>;",
  "let i: typeof import('./m', { with: { a: j } });",
  "export type K = import('./m', { with: { a: l as import('./n', { with: { b: o } }).P<Q> } }).R<S>;",
  "function t(u: import('./m', { with: { a: v } }).W<X>) { u; }",
].join("\n");

// A key in brackets declares a variable if it's a string, and not if it's a template.
const enumKeys =
  "enum A { ['b'] = 1, c = b as any } enum D { [\"e\"] = 1, [`f`] = 2, 'g' = 3, h = e + f + g } enum I { ['j k'] = 1, [''] = 2, ['1'] = 3 } declare enum L { ['m'] = 1, n = m } const enum O { ['p'] = 1, q = p } namespace R { export enum S { ['t'] = 1, u = t } }";

// What only resolves because oxlint goes by the name.
const byName =
  "var a; let b: a; type T = 1; T; function f() { let c: d; return 2 as const; } var d; interface Array<U> {} let e: Array<number>; Array; let g = 1 as const; let h: Promise<void>; new Promise(() => {}); T = 2; Symbol; let i: Symbol;";

const values = [
  "tag`a\\unicode b${x}\\xg\\1`; `ok\\n${y}\\u0041`; z = `a\r\nb\rc\n${y}\r\n`; w = `a${`b${c}`}d`; v = ``;",
  'class A { static { "use strict"; "other"; f(); "late"; } "constructor"() {} static constructor() {} }',
  "var \\u0061bc = 1; a\\u{62}c; ({ \\u0061: 1 }); x.\\u0061;",
  "\"a\\n\\x41\\u0041\\u{41}\\0\\\nb\"; 'c\\'d'; /a\\/b[/]/gi; /(?<n>x)\\k<n>/u; 1n; 0x1Fn; 1_000; .5; 0b11; 0o17; 1e3; null; true;",
  "(a); ((b)) = 1; [(c)] = d; ({ e: (f) } = g); h?.i.j; (h?.i).j; new (h?.i)();",
  'x = { __proto__: null, "a": 1, 2: 3, [b]: 4, c, d() {}, get e() { return 1; }, async *f() {}, ...g };',
  "if (a) ; else ; do ; while (b); try {} catch {} finally {} switch (c) { default: } for (;;) ; debugger;",
  "a = b ? c : d, e ?? f, g || h && i, j ** k, -n, +o, !p, ~q, r++, --s, t in u, v instanceof w;",
  'function f() { "use strict"; return; } (function () { "a"; }); () => { "b"; };',
  'a = "é\u{1F600}"; /* \u{1F600} */ b;',
].join("\n");

export const cases = Object.fromEntries([
  ...named("top-level", ["js", "cjs", "mjs", "ts", "cts", "mts"], topLevel),
  ...named(
    "strict",
    ["js", "cjs", "ts", "cts"],
    '"use strict"; x = 1; var y; function f() { arguments; this; z = 2; }',
  ),
  ...named(
    "strict-function",
    ["js", "ts"],
    'function f() { "use strict"; x = 1; function g() { y = 2; } } function h() { z = 3; } "not a directive";',
  ),
  ...named("functions", ["js", "mjs", "ts"], functions),
  ...named("sloppy", ["js", "cjs"], "with (a) { b; var c; } var arguments; arguments; if (d) function e() {}"),
  ...named("modules", ["js", "mjs", "ts", "mts"], modules),
  ...named("default-export", ["js", "ts"], 'import a from "x" with { type: "json" }; export default a;'),
  ...named("dynamic-import", ["js", "ts"], 'import("x"); a;'),
  ...named("jsx", ["jsx", "tsx"], jsx),
  ...named("jsx-import", ["jsx", "tsx"], 'import React from "react"; <A />;'),
  ...named(
    "jsx-pragma",
    ["jsx", "tsx"],
    "var React; function f() { return <div>{x}</div>; } function g() { var React; return <A />; }",
  ),
  ...named(
    "decorators",
    ["js", "mjs", "ts"],
    "@a class A { @b m() {} @c x = 1; @d accessor y; @e static z; @f.g() get w() {} } (@h class {});",
  ),
  ...named("types", ["ts"], types),
  ...named("types-top-level", ["ts", "cts"], typesAtTopLevel),
  ...named("types-modules", ["ts", "mts"], typesInModules),
  ...named("export-assignment", ["ts", "cts"], "const a = 1; export = a;"),
  ...named("catch-types", ["ts"], catchTypes),
  ...named("import-type-options", ["ts"], importTypeOptions),
  ...named("enum-keys", ["ts"], enumKeys),
  ...named("by-name", ["ts", "cts", "mts"], byName),
  ...named("values", ["js", "ts"], values),
  ...named(
    "comments",
    ["js", "cjs", "ts"],
    "// first\n\n/* global foo, Array:off */ /* exported a */ /* eslint-env browser */ var a; foo; Array; window;",
  ),
  ...named("hashbang", ["js", "ts"], "#!/usr/bin/env node\n\na;"),
  ...named("mark", ["js", "ts"], "﻿\na;"),
  ...named("html-comments", ["js", "ts"], "a; <!-- b\n--> c\nd;"),
  ["empty.js", ""],
  ["empty.cjs", ""],
  ["empty.ts", ""],
  ["blank.js", "\n\n"],
  ["only-a-comment.js", "// a\n"],
  ["only-a-comment.ts", "// a\n"],
]);
