// Generates small programs that combine every form of a piece of syntax with every place it can be in.
//
//   bun generate.ts <inputs.jsonl>
//
// What a parser rejects does not matter: diff.ts leaves it out. Each program is there as TypeScript and as JavaScript.
import { writeFileSync } from "node:fs";

const programs = new Map<string, string>();
const add = (group: string, code: string) => void (programs.has(code) || programs.set(code, group));
const each = (group: string, places: string[], forms: string[], hole = "K") => {
  for (const place of places) for (const form of forms) add(group, place.replaceAll(hole, form));
};

const keys = [
  "a", '"a"', "'a'", '""', "1", "1.5", "0x10", "0b11", "0o7", "1e3", "1n", "0x1n", "1_0", "1_0n", ".5", "5.", "[a]", '["a"]', "[`a`]", "[1]", "[1n]",
  "[-1]", "[a.b]", "[(a)]", '[("a")]', "[a, b]", "[a = 1]", "#a", "constructor", '"constructor"', "get", "set", "static", "async", "await", "yield", "of", "type",
  "declare", "abstract", "readonly", "accessor", "new", "in", "class", "function", "let", "\\u0061", "a\\u{62}", "ö", "$", "_", "[ /*c*/ a /*d*/ ]", "__proto__",
];
each("key", [
  "({ K: 1 })", "({ K() {} })", "({ get K() { return 1 } })", "({ set K(v) {} })", "({ async K() {} })", "({ *K() {} })", "({ async *K() {} })", "({ K<T>() {} })",
  "class C { K = 1 }", "class C { K; }", "class C { K }", "class C { static K = 1 }", "class C { K() {} }", "class C { get K() { return 1 } }", "class C { set K(v) {} }",
  "class C { static K() {} }", "class C { async K() {} }", "class C { *K() {} }", "class C { static async *K() {} }", "class C { accessor K = 1 }", "class C { static accessor K }",
  "declare class C { K: T }", "abstract class C { abstract K: T }", "abstract class C { abstract K(): void }", "abstract class C { abstract accessor K: T }",
  "class C { K?: T }", "class C { K!: T }", "class C { readonly K: T }", "class C { K?() {} }", "class C { private K = 1 }", "class C { @d K = 1 }", "class C { @d() K() {} }",
  "class C { declare K: T }", "class C { override K() {} }", "class C { K(): void; K() {} }", "class C { public static readonly K: T = 1 }", "class C { K<T>(a: T): T {} }",
  "interface I { K: T }", "interface I { K?: T }", "interface I { K(): T }", "interface I { K?(): T }", "interface I { get K(): T }", "interface I { set K(v: T) }",
  "interface I { readonly K: T }", "interface I { K, }", "interface I { K<T>(a: T): T; }", "type T = { K: T }", "type T = { K(): T, K?: T }", "type T = { readonly K?: T; }",
  "enum E { K }", "enum E { K = 1 }", "enum E { K = 1, }", "const { K: x } = y", "const { K: x = 1 } = y", "({ K: x } = y)", "({ K: x = 1 } = y)", "function f({ K: x }) {}",
  "for (const { K: x } of y);", "for ({ K: x } of y);", "({ K: [x] } = y)", "({ K: { x } } = y)", "({ K: x.y } = z)", "try {} catch ({ K: x }) {}", "({ K: (x) } = y)",
  'import x from "m" with { K: "v" }', 'export * from "m" with { K: "v" }', 'type T = import("m", { with: { K: "v" } })', "a.K", "a?.K", "K in a", "<a K={1} />",
], keys);

const links = [".b", "?.b", "[c]", "?.[c]", "()", "?.()", "!", ".#p", "?.#p", "<T>()", "?.<T>()", "`t`"];
const chains: string[] = ["a"];
for (let depth = 0, from = 0; depth < 3; depth++) {
  const until = chains.length;
  for (let i = from; i < until; i++) for (const link of links) (chains.push(chains[i] + link), depth < 2 && chains.push(`(${chains[i] + link})`));
  from = until;
}
each("chain", ["K;", "K = 1;", "delete K;", "[K] = x;", "new K;", "f(K);", "K as T;", "class C { #p; m() { K } }"].slice(0, 2), chains);
each("chain", ["delete K;", "[K] = x;", "new K;", "f(K);", "(K as T).d;", "K ? 1 : 2;", "({ a: K } = x);", "for (K of x);", "K++;", "`${K}`;", "<a b={K}>{K}</a>;"], chains.slice(0, 200));

const types = [
  "A", "A.B", "A.B.C", "A<B>", "A.B<C, D>", "A<B,>", "string", "any", "unknown", "never", "void", "undefined", "null", "number", "boolean", "bigint", "symbol", "object", "this",
  "intrinsic", '"s"', "'s'", "1", "-1", "1n", "-1n", "- 1", "true", "false", "`t`", "`a${B}c`", "`${A}${B}`", "A[]", "A[][]", "[]", "[A]", "[A, B]", "[A?]", "[...A]", "[...A[]]",
  "[a: A]", "[a?: A]", "[...a: A[]]", "[a: A, b?: B, ...c: C[]]", "[A,]", "A | B", "| A", "| A | B", "A & B", "& A", "A | B & C", "() => A", "(a) => A", "(a: A) => B", "(a?: A, ...b: B[]) => C",
  "<T>(a: T) => T", "<const T extends A = B>() => T", "new () => A", "abstract new () => A", "new <T>(a: T) => T", "(this: A) => B", "({ a }: A) => B", "([a]: A) => B", "{}", "{ a: A }",
  "{ a: A; b: B }", "{ a: A, b: B, }", "{ (): A }", "{ new (): A }", "{ [k: string]: A }", "{ readonly [k: string]: A }", "{ <T>(a: T): T }", "A extends B ? C : D",
  "A extends infer U ? U : D", "A extends (infer U extends B) ? U : D", "A extends [infer U extends B, ...infer V] ? U : V", "{ [K in A]: B }", "{ [K in A]?: B }", "{ [K in A]-?: B }",
  "{ [K in A]+?: B }", "{ readonly [K in A]: B }", "{ -readonly [K in A]: B }", "{ +readonly [K in A]: B }", "{ [K in A as B]: C }", "{ [K in A] }", "{ [K in A]: B; }", "A[B]", 'A["b"]', "A[B][C]",
  "keyof A", "readonly A[]", "readonly [A]", "unique symbol", "keyof typeof a", "typeof a", "typeof a.b", "typeof a.b.c", "typeof a<B>", "typeof this", "typeof this.a", 'typeof import("m")',
  'import("m")', 'import("m").A', 'import("m").A.B', 'import("m").A<B>', 'import("m", { with: { a: "b" } })', 'import("m", { with: { "a": "b", }, }).A', "asserts a", "a is A", "asserts a is A",
  "this is A", "asserts this", "asserts this is A", "A<B<C>>", "A<B<C<D>>>", "A<() => B>", "A<(B)>", "typeof a[]", "(typeof a)[]", "A | (() => B)", "(new () => A)[]", "A<typeof b>", "A extends B ? C extends D ? 1 : 2 : 3",
];
const parenthesized = types.flatMap(it => [it, `(${it})`, `((${it}))`, `( /*(*/ ${it} /*)*/ )`]);
each("type", [
  "type X = K", "type X<T = K> = T", "type X<T extends K> = T", "let x: K", "let x: K = y", "let x!: K", "function f(a: K) {}", "function f(a?: K) {}", "function f(a: K = b) {}",
  "function f(...a: K) {}", "function f(): K {}", "function f(this: K) {}", "const f = (a: K): K => a", "const f = async <T,>(a: K): K => a", "const f = function (): K {}",
  "class C { a: K }", "class C { a: K = b }", "class C { m(): K {} }", "class C { get a(): K { return 1 } }", "class C { constructor(private a: K) {} }", "class C { [k: string]: K }",
  "class C<T extends K> extends D<K> implements E<K> {}", "interface I<T = K> extends J<K> { a: K; m(a: K): K; (a: K): K; new (a: K): K; [k: string]: K }", "x as K", "<K>x", "x satisfies K",
  "f<K>()", "new F<K>()", "f<K>``", "f<K>", "f<K, K>()", "try {} catch (e: K) {}", "declare function f(a: K): K", "type X = K[]", "type X = K | K", "type X = K & K", "type X = [K, K?, ...K]",
  "type X = [a: K]", "type X = A<K>", "type X = keyof K", "type X = K extends K ? K : K", "type X = { [P in K]: K }", "type X = `${K}`", "type X = K[K]", "type X = () => K", "type X = new () => K",
  "let { a }: K = b", "let [a]: K = b", "for (const a: K of b);", "abstract class C { abstract m(): K }", "function f(a: K): asserts a is K {}", "function f<const T extends K = K>() {}", "declare const x: K",
], parenthesized.slice(0, parenthesized.length));

const patterns = [
  "a", "{}", "[]", "{ a }", "{ a, }", "{ a = 1 }", "{ a: b }", "{ a: b = 1 }", "{ ...a }", "{ a, ...b }", "{ a: { b } }", "{ a: [b] }", "{ [a]: b }", '{ "a": b }', "{ 1: a }", "[a]", "[a,]", "[, a]", "[a, , b]",
  "[,]", "[, ,]", "[a = 1]", "[...a]", "[a, ...b]", "[[a]]", "[{ a }]", "[...[a]]", "[...{ a }]", "[a = [b] = c]", "{ a = { b } = c }", "{ a: { b: { c = 1 } = {} } = {} }",
];
each("pattern", [
  "var K = x", "let K = x", "const K = x", "let K: T = x", "let K = x, K2 = y", "function f(K) {}", "function f(K: T) {}", "function f(K = x) {}", "function f(K: T = x) {}", "function f(...K) {}",
  "function f(...K: T) {}", "function f(a, K) {}", "(K) => 1", "(K = x) => 1", "(...K) => 1", "async (K) => 1", "(K: T) => 1", "for (var K of x);", "for (let K in x);", "for (const K of x);",
  "for await (const K of x);", "for (let K = x;;);", "try {} catch (K) {}", "try {} catch (K: unknown) {}", "class C { m(K) {} }", "class C { constructor(K) {} }", "class C { set a(K) {} }", "({ m(K) {} })",
  "({ set a(K) {} })", "(K = x);", "[K] = x;", "({ p: K } = x);", "for (K of x);", "for (K in x);", "[K = y] = x;", "[...K] = x;", "({ ...K } = x);", "type F = (K: T) => void", "declare function f(K: T): void",
  "class C { m(@d K) {} }", "class C { constructor(@d private readonly K: T = x) {} }", "function f(K?: T) {}", "export const K = x", "export let K: T = x", "using K = x", "await using K = x",
], patterns);

const declarations = [
  "function f() {}", "function* f() {}", "async function f() {}", "async function* f() {}", "function f(): void", "function f<T>(a: T): T {}", "class C {}", "class C extends D {}", "abstract class C {}",
  "@d class C {}", "@d() @e class C {}", "class C<T> extends D<T> implements E, F.G<T> {}", "var a", "let a = 1, b", "const a = 1", "interface I {}", "interface I<T> extends J<T>, K {}", "type T = A",
  "type T<U> = U", "enum E {}", "enum E { A, B = 1 }", "const enum E { A }", "namespace N {}", "namespace N.M.O {}", "module N {}", 'module "m" {}', 'module "m"', "global {}", "import a = b", "import a = b.c.d",
  'import a = require("m")', 'import type a = require("m")', "import type a = b.c", "using a = b", "function f(a: A): void; function f(a) {}",
];
each("declaration", ["K", "K;", "export K", "export default K", "declare K", "export declare K", "export default abstract K", "namespace X { K }", "namespace X { export K }", "declare namespace X { K }",
  "declare module 'x' { K }", "declare global { K }", "{ K }", "function g() { K }", "if (a) { K }", "label: K", "@x export K", "export @x K", "switch (a) { case 1: K }", "class X { static { K } }", "/** doc */ K", "K /* c */ ;",
], declarations);

const statements = [
  ";", "a;", "a", '"use strict";', "'use strict'", '("use strict");', "`use strict`;", '"a"; "b";', '"a", "b";', '"a".b;', "{}", "{ a }", "{ ; }", "debugger;", "debugger", "if (a) b;", "if (a) b; else c;", "if (a) {} else if (b) {} else {}",
  "for (;;);", "for (a;;);", "for (a; b; c) d;", "for (var a;;);", "for (var a = 1, b;;);", "for (a in b);", "for (a of b);", "for (var a in b);", "for (const a of b);", "for await (a of b);", "for (a.b in c);",
  "for ([a] of b);", "for (async of => 1;;);", "for ((async) of a);", "for (let of of a);", "while (a);", "do ; while (a)", "do a; while (b);", "do {} while (a) b", "return;", "return a;", "return (a);", "throw a;",
  "break;", "continue;", "a: b;", "a: b: c;", "a: for (;;) break a;", "a: for (;;) continue a;", "a: { break a; }", "switch (a) {}", "switch (a) { case 1: }", "switch (a) { case 1: b; break; default: c }",
  "switch (a) { default: }", "switch (a) { case 1: case 2: { b } }", "try {} catch {}", "try {} catch (a) {}", "try {} finally {}", "try {} catch (a) {} finally {}", "try { a } catch { b } finally { c }", "with (a) b;", "with (a) {}",
  'import "m";', 'import a from "m";', 'import * as a from "m";', 'import { a } from "m";', 'import { a as b } from "m";', 'import { "a" as b } from "m";', 'import { default as a } from "m";', 'import a, { b } from "m";',
  'import a, * as b from "m";', 'import {} from "m";', 'import { a, } from "m";', 'import type a from "m";', 'import type { a } from "m";', 'import type * as a from "m";', 'import { type a } from "m";', 'import { type a as b } from "m";',
  'import { type as } from "m";', 'import { type as as } from "m";', 'import { type as as as } from "m";', 'import type from "m";', 'import type, { a } from "m";', 'import defer * as a from "m";', 'import a from "m" with {};',
  'import a from "m" with { type: "json" };', 'import a from "m" with { type: "json", };', 'import "m" with { a: "b", "c": "d" };', "export {};", "export { a };", "export { a as b };", 'export { a as "b" };', "export { a as default };",
  "export { a, };", 'export { a } from "m";', 'export { "a" as "b" } from "m";', 'export { default } from "m";', 'export { default as a } from "m";', 'export {} from "m";', 'export * from "m";', 'export * as a from "m";',
  'export * as "a" from "m";', 'export * as default from "m";', "export type { a };", 'export type { a } from "m";', "export { type a };", "export { type a as b };", 'export type * from "m";', 'export type * as a from "m";',
  'export { a } from "m" with { type: "json" };', 'export * from "m" with { type: "json" };', "export default a;", "export default a", "export default (a);", "export default 1 + 1;", "export default function () {}",
  "export default function* () {}", "export default async function () {}", "export default class {}", "export default class extends A {}", "export default (class {});", "export default (function () {});", "export default () => {};",
  "export default async () => {};", "export default { a };", "export default [a];", "export default interface I {}", "export default abstract class {}", "export = a;", "export as namespace A;", "#!/usr/bin/env node\na;", "// c\na; // d\n", "/* only a comment */", "",
  "  \n  ", "﻿a;",
];
each("statement", ["K", "K\nK", "function f() { K }", "() => { K }", "{ K }", "if (x) { K }", "class C { static { K } }", "class C { m() { K } }", "class C { constructor() { K } }", "namespace N { K }", "({ get a() { K } })", "async function* f() { K }", "x: { K }", "'use strict'; K"], statements);

const expressions = [
  "a", "this", "super.a", "super()", "null", "true", "false", "1", "1.", ".1", "1e1", "0x1", "0b1", "0o1", "1_0", "1n", "0x1n", '"a"', "'a'", '"\\n\\u{61}\\x61"', "'\\\n'", "/a/", "/a/gimsuy", "/[/]/", "/\\//", "/a/v", "/(?<a>b)/d",
  "``", "`a`", "`${a}`", "`a${b}c`", "`a${b}c${d}e`", "`${`${a}`}`", "`\\``", "`$`", "`$${a}`", "`\\${a}`", "`\n`", "a``", "a`b${c}d`", "a.b`c`", "a`\\u`", "a`\\unicode and \\u{55}`", "a`\\xg`", "a`\\7`", "a<T>`b`", "[]", "[a]", "[a,]", "[,]", "[, a]",
  "[a, , b]", "[...a]", "[...a, b]", "{}", "{ a }", "{ a, }", "{ a: 1 }", "{ ...a }", "{ a, ...b, c }", "{ a() {} }", "{ get a() { return 1 }, set a(v) {} }", "{ async a() {}, *b() {}, async *c() {} }", "{ [a]: 1, [b]() {} }",
  "function () {}", "function a() {}", "function* () {}", "async function () {}", "async function* a() {}", "function <T>(a: T): T {}", "() => 1", "() => {}", "() => ({})", "a => a", "(a) => a", "(a, b) => a", "async a => a", "async (a) => a",
  "async () => {}", "<T,>(a: T) => a", "<T extends A>(a: T): T => a", "async <T,>() => {}", "(a): a is A => true", "(a = 1, { b }, [c], ...d) => 1", "() => () => 1", "() => a ? b : c", "class {}", "class A {}", "class extends A {}", "class A extends B {}",
  "class { a = 1 }", "@d class {}", "class<T> {}", "a.b", "a.b.c", "a[b]", "a[b][c]", "a.#b", "a()", "a(b)", "a(b, c)", "a(b,)", "a(...b)", "a()()", "a.b()", "a<T>()", "new a", "new a()", "new a(b)", "new a.b", "new a.b()", "new (a())", "new (a.b())()",
  "new a<T>", "new a<T>()", "new new a", "new new a()()", "new.target", "import.meta", "import.meta.a", 'import("m")', 'import("m", a)', 'import("m", { with: { a: "b" } })', 'import("m",)', 'import.defer("m")', "+a", "-a", "!a", "~a", "typeof a", "void a",
  "delete a.b", "++a", "--a", "a++", "a--", "- -a", "+ +a", "!!a", "typeof typeof a", "-a ** b", "(-a) ** b", "a + b", "a - b", "a * b", "a / b", "a % b", "a ** b", "a ** b ** c", "a << b", "a >> b", "a >>> b", "a & b", "a | b", "a ^ b", "a < b", "a <= b",
  "a > b", "a >= b", "a == b", "a != b", "a === b", "a !== b", "a in b", "a instanceof b", "#a in b", "a && b", "a || b", "a ?? b", "a && b || c", "(a ?? b) || c", "a + b + c", "a + (b + c)", "a, b", "a, b, c", "(a, b), c", "a, (b, c)", "((a, b)), c",
  "a = b", "a = b = c", "a += b", "a -= b", "a *= b", "a /= b", "a %= b", "a **= b", "a <<= b", "a >>= b", "a >>>= b", "a &= b", "a |= b", "a ^= b", "a &&= b", "a ||= b", "a ??= b", "a.b = c", "a[b] = c", "(a) = b", "(a.b) = c", "[a] = b", "[a, b] = c",
  "[a = 1] = b", "[...a] = b", "[a.b] = c", "[a[b]] = c", "[(a)] = b", "[(a.b)] = c", "[[a]] = b", "[{ a }] = b", "({ a } = b)", "({ a = 1 } = b)", "({ a: b } = c)", "({ a: b = 1 } = c)", "({ ...a } = b)", "({ a: b.c } = d)", "({ a: (b) } = c)", "({ a: [b] } = c)",
  "({ a: { b } } = c)", "[a, [b, { c = 1, ...d }], ...e] = f", "a ? b : c", "a ? b : c ? d : e", "a ? b ? c : d : e", "(a ? b : c) ? d : e", "await a", "await await a", "yield", "yield a", "yield* a", "a as T", "a as const", "a as T as U", "<T>a", "<const>a", "<T><U>a",
  "a satisfies T", "a!", "a!!", "a!.b", "a![b]", "a!()", "(a as T).b", "(<T>a).b", "(a!) = b", "(a as T) = b", "[a as T] = b", "[a!] = b", "a<T>", "a<T>.b", "a.b<T>", "(a<T>)", "a as any as T", "a satisfies T as U", "(a)", "((a))", "( /* c */ a /* d */ )", "(a, b)",
  "(function () {})()", "(function () {}())", "(() => {})()", "(async () => {})()", "(class {}).a", "({}).a", "({} = a)", "a?.b", "a?.[b]", "a?.()", "a?.b.c", "(a?.b).c", "a?.b!", "a?.b!.c", "(a?.b)!", "(a?.b!).c", "a?.b?.c", "a?.b()", "a?.b?.()", "a?.()?.b", "new (a?.b)()",
  "a?.b`c`", "delete a?.b", "a?.b = c", "<a />", "<a></a>", "<></>", "<a b />", '<a b="c" />', "<a b='c' />", "<a b={c} />", "<a b=<c /> />", "<a {...b} />", "<a b {...c} d />", "<a-b />", "<a:b />", "<a.b />", "<a.b.c />", "<this.a />", "<this />", "<A />", '<a b-c="d" />',
  '<a b:c="d" />', '<a b="&amp;&#65;&#x41;&nope;" />', '<a b="\\" />', "<a>b</a>", "<a> b </a>", "<a>\n  b\n</a>", "<a>\n</a>", "<a>{b}</a>", "<a>{}</a>", "<a>{/* c */}</a>", "<a>{...b}</a>", "<a>b{c}d</a>", "<a><b /></a>", "<a>\n  <b />\n  <c />\n</a>", "<a>&amp;&nbsp;&#65;</a>",
  "<a>{b}{c}</a>", "<a>{ b }</a>", "<a>`b`</a>", "<a>'b\"</a>", "<a>b // c</a>", "<a>{`b`}</a>", '<a>{"b"}</a>', "<a<T> />", "<a<T>></a>", "<a.b<T> c />", "<><a /></>", "<>a</>", "<>\n</>", "<a b={<c />} />", "<a b={() => <c />} />", "<a\n  b\n/>", "< a / >", "<a>< / a>",
];
each("expression", ["K;", "(K);", "x = K;", "x = (K);", "f(K);", "f((K));", "[K];", "({ p: K });", "K.p;", "(K).p;", "K();", "(K)();", "K ? 1 : 2;", "x ? K : K;", "!K;", "K + 1;", "1 + K;", "`${K}`;", "() => K;", "() => (K);", "return K;", "throw K;",
  "if (K);", "for (K;;);", "for (;K;);", "for (x of K);", "for (x in K);", "while (K);", "switch (K) { case K: }", "export default K;", "export = K;", "let x = K;", "let x = (K), y = K;", "function f(a = K) {}", "class C extends K {}", "class C extends (K) {}",
  "class C { p = K }", "class C { [K] = 1 }", "class C { @K p }", "class C { @(K) p }", "@K class C {}", "({ [K]: 1 });", "enum E { A = K }", "<a b={K}>{K}</a>;", "<a {...K} />;", "K as T;", "<T>K;", "K!;", "K satisfies T;", "async function f() { await K }",
  "function* f() { yield K }", "function* f() { yield* K }", "x, K;", "K, x;", "new K;", "new (K);", "new K();", "x = y = K;", "x ??= K;", "typeof K;", "void K;", "...K", "[...K];", "f(...K);", "({ ...K });", "K`t`;", "x[K];", "x?.[K];", "x?.(K);", "import(K);", "with (K);", "do ; while (K)",
], expressions);

const lines: string[] = [];
let index = 0;
for (const [code, group] of programs) {
  const isModule = /^\s*(import|export)\b/m.test(code);
  for (const filename of /</.test(code) && group !== "type" ? ["file.tsx", "file.ts", "file.js"] : ["file.ts", "file.js"]) {
    lines.push(JSON.stringify({ id: `${group}#${index}${filename.slice(4)}`, filename, code, sourceType: isModule ? "module" : "script", parser: "espree" }));
  }
  index++;
}
writeFileSync(process.argv[2], lines.join("\n") + "\n");
console.log(`${lines.length} inputs in ${process.argv[2]}`);
