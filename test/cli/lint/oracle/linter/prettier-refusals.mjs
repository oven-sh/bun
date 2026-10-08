// Which files Prettier refuses to format because its parser throws, against `refused_by_prettier`, on the files of directories and
// on a list of snippets.
//
//   PRETTIER_DIR=<a directory from which `prettier` resolves> node prettier-refusals.mjs [--show <n>] [--json <file>] <directory> ..
//
// A JavaScript file is parsed by `babel`, a TypeScript file by `typescript`, as Prettier chooses by the name of a file. Files
// with a `@flow` pragma are left out: they go to another parser.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join, resolve } from "node:path";
import { runBunLint } from "./shared.mjs";

const require = createRequire(join(resolve(process.env.PRETTIER_DIR), "package.json"));
const { parsers: babel } = require("prettier/plugins/babel");
const { parsers: typescript } = require("prettier/plugins/typescript");

const args = process.argv.slice(2);
const option = name => (args.includes(name) ? args.splice(args.indexOf(name), 2)[1] : undefined);
const show = Number(option("--show") ?? 10);
const json = option("--json");

const TYPESCRIPT = new Set([".ts", ".mts", ".cts", ".tsx"]);
const JAVASCRIPT = new Set([".js", ".mjs", ".cjs", ".jsx"]);

function* filesOf(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".git") yield* filesOf(path);
    } else if (entry.isFile() && (TYPESCRIPT.has(extname(path)) || JAVASCRIPT.has(extname(path)))) yield path;
  }
}

// What Prettier's own tests expect it to refuse, and what is next to that.
const snippets = [
  "({ get x(a){} })",
  "({ set x(){} })",
  "({ set x(a, b){} })",
  "({ set x(...a){} })",
  "class A { get x(a){} }",
  "/a/ugv",
  "/a/vu",
  "/a/gg",
  "/a/x",
  "/a/v",
  "/(/",
  'import {} from (("a"))',
  'import defer x from "x"',
  'import defer { x } from "x"',
  'import defer * as x from "x"',
  "for (using foo in {});",
  "using let = h()",
  "using { foo } = f()",
  "for (using { qux } of h());",
  "{ using a = b; }",
  "[a?.b] = []",
  "({ prop: a?.b } = {})",
  "for (a?.b of x);",
  "for (a?.b in x);",
  "a?.b++",
  "++a?.b",
  "a?.b = c",
  "a?.b += c",
  "(a?.b) = c",
  "a?.b`c`",
  "1 = 2",
  "a() = 1",
  "[a()] = []",
  "({ a: 1 } = {})",
  "(a, b) = 1",
  "[(a = 1)] = []",
  "({ a = 1 })",
  "({ a = 1 } = {})",
  "let a; let a;",
  "var a; let a;",
  "function f(a, a) {}",
  "with (a) {}",
  "delete a",
  "010",
  '"\\01"',
  "return 1",
  "if (a) { import b from 'b' }",
  "export { nope }",
  "export { a, a }; var a;",
  "export default 1; export default 2;",
  "new.target",
  "super.a",
  "super()",
  "function f() { super.a }",
  "class A { constructor() { super() } }",
  "class A { #a; #a }",
  "class A { m() { this.#b } }",
  "class A { #a; m() { delete this.#a } }",
  "class A { #a; m() { delete (this.#a) } }",
  "class A { constructor() {} constructor() {} }",
  "class A { get constructor() {} }",
  "class A { async constructor() {} }",
  "class A { static prototype() {} }",
  "class A { #constructor }",
  "class A { a = arguments }",
  "class A { static { arguments } }",
  "function f(...a,) {}",
  "function f(...a, b) {}",
  "(...a,) => {}",
  "(...a, b) => {}",
  "[...a,] = []",
  "[...a, b] = []",
  "let [...a,] = []",
  "let [...a, b] = []",
  "let [...a = 1] = []",
  "([...a = 1]) => {}",
  "let { ...{ a } } = {}",
  "function f(a = 1) { 'use strict' }",
  "function* f(a = yield) {}",
  "async function f(a = await 1) {}",
  "break",
  "continue",
  "a: a: ;",
  "a: { continue a }",
  "switch (a) { default: default: }",
  "throw\n1",
  "a ?? b || c",
  "a || b ?? c",
  "-a ** b",
  "({ __proto__: 1, __proto__: 2 })",
  "if (a) let b = 1",
  "if (a) const b = 1",
  "if (a) class B {}",
  "if (a) function f() {}",
  "while (a) function f() {}",
  "if (a) let\nb",
  "let let = 1",
  "const let = 1",
  "var let",
  "import()",
  'import("a", b, c)',
  'new import("a")',
  'new (import("a"))',
  'new import("a").b',
  "const a",
  "for (let a = 1 of b);",
  "for (var a = 1 in b);",
  "var yield",
  "var await",
  "function* f() { var yield }",
  "async function f() { var await }",
  "var enum",
  "var static",
  "eval = 1",
  "arguments++",
  "@a class B {}",
  "class B { @a m() {} }",
  "<a />",
  "<a></b>",
  'export { "a" }',
  'export { "a" } from "b"',
  "try {}",
  "a => {}\n()",
  "a\n=> 1",
  "async a\n=> 1",
  "({ async *a() {} })",
  "({ get a() {}, get a() {} })",
  "label: function f() {}",
  // From the snippets of Prettier's own `format.test.js` files, each with what is next to it.
  "async (a) => (await a!) ** 6;",
  "a!;",
  "export type Foo = number;",
  "type Foo = number;",
  "export type { Foo };",
  "@d1 export @d2 class A{}",
  "@d1\nexport @d2 class A{}",
  "@d1 export default @d2 class A{}",
  "@d1\nexport default @d2 class A{}",
  "export @d2 default class A {}",
  "@d1 export class A {}",
  "export @d2 class A {}",
  "export default @d2 class A {}",
  "@d1 export default class A {}",
  "({ method() })",
  "({ method({}) })",
  "({ method(parameter,) })",
  "({ method() {} })",
  "class A { method() }",
  "function f()",
  "for (async of []);",
  "for ((async) of []);",
  "for (\\u0061sync of []);",
  "async () => { for await (async of []); }",
  "for (async in []);",
  "for (async.a of []);",
  "for (async of => {}; ; );",
  "for (let async of []);",
  "for (async;;);",
  'import { "\\uD83C" as b } from "./foo"',
  'export { "\\uD83C" } from "./foo"',
  'export { "\\uD83C" as b } from "./foo"',
  'export { b as "\\uD83C" } from "./foo"',
  'export * as "\\uD83C" from "./foo"',
  'export { b as "\\uD83C\\uDF19" } from "./foo"',
  'import { "\\uDF19" as b } from "./foo"',
  'import { "a b" as b } from "./foo"',
  'var b; export { b as "\\uD83C" }',
  'import b from "\\uD83C"',
  "let x1 = <div>{a,b}</div>",
  "let x1 = <div>{(a,b)}</div>",
  "let x1 = <div a={b,c} />",
  "let x1 = <div a={(b,c)} />",
  "let x1 = <div>{...a,b}</div>",
  "let x1 = <div>{a}</div>",
  "let x1 = <div {...a,b} />",
  // The syntax of TypeScript in JavaScript.
  "function f(x: number, y: string): void {}",
  "var a: T = 1;",
  "const right: { a: 1 } = x;",
  "class A { myMethod(p: any) {} }",
  "(value: CacheValue, response: any) => {}",
  "a as T;",
  "a satisfies T;",
  "<T>(x) => x;",
  "<T,>(x) => x;",
  "interface A {}",
  "enum A {}",
  "const enum A {}",
  "declare const a;",
  "declare function f();",
  "declare module 'a' {}",
  "abstract class A {}",
  "class A implements B {}",
  "class A { constructor(private a) {} }",
  "function f(x?: T) {}",
  "function f(x?) {}",
  "f<T>();",
  "new A<T>();",
  "class A<T> {}",
  "function f<T>() {}",
  "class A extends B<T> {}",
  "class A { a: T; }",
  "class A { a?: T; }",
  "class A { a!: T; }",
  "class A { private a; }",
  "class A { readonly a; }",
  "class A { public m() {} }",
  "class A { declare a; }",
  "class A { override m() {} }",
  "class A { abstract m(); }",
  "class A { [k: string]: T; }",
  "namespace A {}",
  "module A {}",
  "import type A from 'a';",
  "import { type A } from 'a';",
  "export type { A } from 'a';",
  "export { type A };",
  "import a = require('a');",
  "export = a;",
  "export as namespace A;",
  "import type { A } from 'a';",
  "let a = <T>b;",
  "function f(this: T) {}",
  "function f(): asserts a {}",
  "let a: typeof b;",
  "for (const a: T of b);",
  "try {} catch (e: unknown) {}",
  "a<b>(c);",
  "type A = 1;",
  "function f(a: T = 1) {}",
  "({ m(a: T) {} });",
  "({ m(): T {} });",
  "({ a }: T) => {};",
  "async (a: T) => {};",
  "(a): T => {};",
  "x = (a?) => {};",
  "accessor a;",
  "class A { accessor a; }",
  // What looks alike and is JavaScript.
  "a ? (b) : c => d;",
  "a ? (b) : (c) => d;",
  "a ? b : c;",
  "x = a ? (b, c) : d => e;",
  "({ a: b });",
  "label: a;",
  "switch (a) { case b: c; }",
  "a < b > c;",
  "a<b>c;",
  "f(a < b, c > d);",
  "type = 1;",
  "type\nA = 1;",
  "declare = 1;",
  "interface = 1",
  "namespace = 1;",
  "module = 1;",
  "abstract = 1;",
  "as = 1; a = as;",
  "satisfies(a);",
  "var type, of, as, declare, module, namespace, abstract, readonly, override, accessor;",
  "class A { declare() {} readonly() {} abstract() {} override() {} accessor() {} }",
  "class A { static declare; readonly; private; public }",
  "a::b;",
  "::a.b;",
  "(a, b)::c;",
  "a ?? b;",
  "a?.b;",
  "a ? .5 : b;",
  "/** @type {T} */ var a = 1;",
  "/** @param {a!} b */ function f(b) {}",
  "var a = /** @type {T} */ (b);",
  "<a>b</a>;",
  "<a b={c} />;",
  "<T,>x</T>;",
  // A meta property that is written with an escape.
  "function f() { new.t\\u0061rget; }",
  "function f() { new.\\u0074arget; }",
  "function f() { new.t\\u{61}rget; }",
  "function f() { new.t\\u0061rge; }",
  "function f() { new.target; }",
  "function f() { new . target; }",
  "function f() { new./* c */target; }",
  "function f() { new.target.a\\u0062c; }",
  "function f() { new.foo; }",
  "a.t\\u0061rget;",
  "import.m\\u0065ta;",
  "import.\\u006deta;",
  "import.meta;",
  "import.meta.\\u0061;",
  "import.foo;",
  "import.d\\u0065fer('a');",
  "import.s\\u006furce('a');",
  "import.defer('a');",
  "import.source('a');",
  "declare global {}",
  "module\nA\n{}",
  "declare\nmodule\n{}",
];

const typescriptSnippets = [
  'import.source("a");',
  'import.s\\u006furce("a");',
  'a;\n  import . source("a");',
  "import.source;",
  "import.source.a;",
  "f(import.source);",
  "import.defer;",
  'import.\\u0073ource("a");',
  'import.\\u{73}ource("a");',
  'import.\\u{000073}ource("a");',
  'import.\\u0064efer("a");',
  'import.\\u{64}efer("a");',
  'import.defer("a");',
  'import.d\\u0065fer("a");',
  'import.foo("a");',
  "import.meta;",
  "import.m\\u0065ta;",
  'import("a");',
  "function f() { new.t\\u0061rget; }",
  "function f() { new.target; }",
  "interface I { public get a(): 1 }",
  "interface I { get a(): 1 }",
];

const cases = snippets.map((code, i) => ({ path: `snippet ${i}: ${code}`, code, filename: "snippet.js" }));
for (const code of typescriptSnippets)
  cases.push({ path: `TypeScript snippet: ${code}`, code, filename: "snippet.ts" });
for (const root of args.map(it => resolve(it))) {
  for (const path of filesOf(root)) {
    const code = readFileSync(path, "utf8");
    if (code.includes("�") || code.length > 2_000_000 || /@(?:no)?flow\b/.test(code)) continue;
    cases.push({ path, code, filename: `file${extname(path)}` });
  }
}

function refusal({ code, filename }) {
  try {
    (TYPESCRIPT.has(extname(filename)) ? typescript.typescript : babel.babel).parse(code, { filepath: filename });
    return null;
  } catch (error) {
    return String(error.message).split("\n")[0];
  }
}

const TOLERATED = new Set([
  "function f(x: number, y: string): void {}",
  "var a: T = 1;",
  "(value: CacheValue, response: any) => {}",
]);
const differences = [];
const tolerant = [];
const places = { typescript: { both: 0, place: 0, words: 0 }, javascript: { both: 0, place: 0, words: 0 } };
let refused = 0;
for (let start = 0; start < cases.length; start += 1000) {
  const batch = cases.slice(start, start + 1000);
  const actual = runBunLint(
    "prettier",
    batch.map(({ code, filename }) => ({ code, filename })),
  );
  batch.forEach((it, i) => {
    const expected = refusal(it);
    if (expected !== null) refused++;
    const [isRefused, parser, , isRefusedWithTypes, why] = actual[i];
    if ((why !== null) !== isRefused) tolerant.push(`refused without a reason, or the other way round: ${it.path}`);
    if (expected !== null && why !== null) {
      // The place is for a reader, not for a verdict: it is counted, and no difference.
      const kind = TYPESCRIPT.has(extname(it.filename)) ? places.typescript : places.javascript;
      kind.both++;
      if (expected.endsWith(` (${why[1]}:${why[2]})`)) kind.place++;
      if (expected === `${why[0]} (${why[1]}:${why[2]})`) kind.words++;
    }
    if ((expected !== null) !== isRefused) differences.push({ path: it.path, prettier: expected, parser });
    // Where types in JavaScript are tolerated, less is refused, and never an annotation.
    if (isRefusedWithTypes && !isRefused) tolerant.push(`refused only where types are tolerated: ${it.path}`);
    if (isRefusedWithTypes && TOLERATED.has(it.code))
      tolerant.push(`an annotation is refused where types are tolerated: ${it.path}`);
  });
}
const harmful = differences.filter(it => it.prettier === null);
const lenient = differences.filter(it => it.prettier !== null);
for (const it of harmful.slice(0, show)) {
  console.log(`refused here${it.parser ? " by the parser" : ""}, formatted by Prettier: ${it.path}`);
}
for (const it of lenient.slice(0, show)) console.log(`refused by Prettier only: ${it.path}\n    ${it.prettier}`);
if (json) writeFileSync(json, JSON.stringify(differences, null, 1));
console.log(
  `Prettier refuses ${refused} of ${cases.length}; refused only here: ${harmful.length}, ${harmful.filter(it => it.parser).length} of them by the parser; refused only by Prettier: ${lenient.length}`,
);
console.log(`prettier refusals: ${cases.length - differences.length} of ${cases.length} agree`);
for (const it of tolerant) console.log(it);
console.log(`types tolerated: ${tolerant.length} wrong`);
for (const [kind, { both, place, words }] of Object.entries(places)) {
  console.log(`${kind}: of ${both} that both refuse, the same place for ${place}, the same words too for ${words}`);
}
if (differences.length > 0 || tolerant.length > 0) process.exitCode = 1;
