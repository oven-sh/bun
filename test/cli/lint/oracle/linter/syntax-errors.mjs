// What @typescript-eslint/parser throws for code that TypeScript's parser accepts, against `Linter::lint`.
//
//   TYPESCRIPT_ESLINT_DIR=<built checkout> node syntax-errors.mjs [<how many differences to show>]
//
// - Every modifier, every pair of modifiers and a decorator, wherever one can be written.
// - Each of the other checks, in variations.
// - Two errors in one file, one after the other and one in the other: which one is reported.

import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { random, report, requireFromEslint, runBunLint } from "./shared.mjs";

const { Linter } = requireFromEslint("./lib/linter");
const requireTs = createRequire(
  join(resolve(process.env.TYPESCRIPT_ESLINT_DIR), "packages/eslint-plugin/package.json"),
);
const parser = requireTs("@typescript-eslint/parser");

const modifiers = [
  ..."public private protected static readonly abstract declare async export default override accessor in out const".split(
    " ",
  ),
  "@d",
  "@d()",
];
const places = [
  "$ class A {}",
  "$ class {}",
  "$ function f() {}",
  "$ function f();",
  "$ function* f() {}",
  "$ function* f();",
  "$ var a;",
  "$ let a = 1;",
  "$ const a = 1;",
  "$ const a: number = 1;",
  "$ let a!: number;",
  "$ using a = b;",
  "$ await using a = b;",
  "$ interface I {}",
  "$ type T = 1;",
  "$ enum E {}",
  "$ namespace N {}",
  '$ module "m" {}',
  "$ global {}",
  "$ import a = b.c;",
  '$ import a = require("a");',
  '$ import "a";',
  "$ export {};",
  "$ export default 1;",
  "$ export = 1;",
  "namespace N { $ class A {} }",
  "namespace N { $ var a; }",
  "function f() { $ class A {} }",
  "{ $ function f() {} }",
  "class A { $ a; }",
  "class A { $ a = 1; }",
  "class A { $ a!: number; }",
  "class A { $ a!; }",
  "class A { $ a!: number = 1; }",
  "class A { $ 'constructor'; }",
  "class A { $ m() {} }",
  "class A { $ m(); }",
  "class A { $ /* c */ m() {} }",
  "class A { $ *g() {} }",
  "class A { $ get a() { return 1 } }",
  "class A { $ get a(); }",
  "class A { $ set a(v) {} }",
  "class A { $ constructor() {} }",
  "class A { $ constructor(); }",
  "class A { $ [k: string]: any }",
  "class A { $ static {} }",
  "(class { $ a; })",
  "(class { $ a = 1; })",
  "(class { $ m() {} })",
  "(class { $ m(); })",
  "(class { $ get a() { return 1 } })",
  "(class { $ [k: string]: any })",
  "($ class {})",
  "x = $ class {}",
  "interface I { $ a: 1 }",
  "interface I { $ a: 1 = 1 }",
  "interface I { $ m(): void }",
  "interface I { $ [k: string]: any }",
  "interface I { $ get a(): 1 }",
  "interface I { $ set a(v) }",
  "interface I { $ (): void }",
  "interface I { $ new (): void }",
  "type T = { $ a: 1 }",
  "type T = { $ m(): void }",
  "type T = { $ [k: string]: any }",
  "function f($ a) {}",
  "function f($ a);",
  "function f($ this) {}",
  "class A { constructor($ a) {} }",
  "class A { constructor($ a); }",
  "class A { constructor($ ...a) {} }",
  "class A { constructor($ { a }) {} }",
  "class A { constructor($ [a]) {} }",
  "class A { constructor($ a = 1) {} }",
  "class A { m($ a) {} }",
  "class A { m($ a); }",
  "class A { set a($ v) {} }",
  "class A { get a($ v) { return 1 } }",
  "class A { static m($ a) {} }",
  "(class { constructor($ a) {} })",
  "(class { m($ a) {} })",
  "({ m($ a) {} })",
  "(($ a) => 1)",
  "(function ($ a) {})",
  "type F = ($ a) => void",
  "type F = new ($ a) => void",
  "interface I { m($ a): void }",
  "class A<$ T> {}",
  "(class <$ T> {})",
  "interface I<$ T> {}",
  "type T<$ U> = U",
  "function f<$ T>() {}",
  "class A { m<$ T>() {} }",
  "type F = <$ T>() => void",
  "interface I { m<$ T>(): void }",
  "type F = A extends infer $ T ? 1 : 2",
  "({ $ a: 1 })",
  "({ $ a })",
  "({ $ m() {} })",
  "({ $ *g() {} })",
  "({ $ get a() { return 1 } })",
  "({ $ set a(v) {} })",
  "({ $ ...a })",
  "({ $ [a]: 1 })",
  "type F = $ new () => void",
  "type F = $ () => void",
];

const others = `
switch (a) { default: default: }
switch (a) { case 1: default: break; case 2: default: }
switch (a) { default: switch (b) { default: } }
throw
a
try {} catch (e = 1) {}
try {} catch ({ e } = (1)) {}
let a!: number = 1
let a!
let { a }!: T
let [a]!: T = b
const a!: number
var a!: number
for (let a!: number;;) {}
for (const a!: number of b) {}
using a
using { a } = b
await using a
for (using a;;) {}
for (using a in b) {}
for (await using a in b) {}
for (using a of b) {}
for (using { a } = b;;) {}
declare let a = 1
declare var a: number = 1
declare const a = 1
declare const a: number = 1
declare let a, b = 1
var
let
for (var;;) {}
({ a?: 1 })
({ a!: 1 })
({ a? })
({ a! })
({ a?() {} })
({ "a"?: 1, b!: 2 })
({ a?: 1 } = b)
abstract class A { abstract a = 1 }
abstract class A { abstract a = (1) }
abstract class A { abstract a!: number }
abstract class A { abstract a /* c */ !: number }
abstract class A { abstract m() {} }
abstract class A { abstract "m"() {} }
abstract class A { abstract [m]() {} }
abstract class A { abstract
  m() {} }
abstract class A { abstract get a() { return 1 } }
abstract class A { abstract set a(v) {} }
abstract class A { abstract accessor a = 1 }
class A { "constructor" }
class A { 'constructor' = 1 }
class A { "constr\\u0075ctor" }
class A { ["constructor"] }
class A { constructor }
class A { static "constructor" }
class A { accessor "constructor" }
class A { "constructor"() {} }
a?.b\`c\`
a?.[b]\`c\`
a?.()\`c\`
a?.b.c\`d\`
(a?.b)\`c\`
a?.b!\`c\`
a?.\`c\`
a?.b<T>\`c\`
class A { #a; m() { #a + 1 } }
class A { #a; m() { 1 in #a } }
class A { #a; m() { #a in #a } }
class A { #a; m() { #a = 1 } }
class A { #a; m() { #a, 1 } }
class A { #a; m() { 1 + #a } }
class A { #a; m() { #a + #a } }
class A { #a; m() { f(#a) } }
class A { #a; m() { #a in b } }
type T = { [K in A]: B; a: 1 }
type T = { [K in A]: B; m(): void; a: 1 }
interface I { a: 1 = 1 }
type T = { a = (1) }
enum E { [a] }
enum E { ["a"] }
enum E { [\`a\`] }
enum E { [1] }
enum E { 1 }
enum E { 1n }
enum E { 1.5 = 1 }
enum E { "1" }
enum E { a, [b] = 1, 2 }
import a from "a" with { b: 1 }
import a from "a" with { b: \`c\` }
import a from "a" with { b: "c", "d": e }
export * from "a" with { b: 1 }
export { a } from "a" with { b: c }
import a from "a" assert { b: 1 }
type T = import("a", { with: { b: 1 } })
import a = require(b)
import a = require(\`b\`)
import a = require("b")
export import a = require(b)
import type a = b.c
import type a = require("b")
export import type a = b
a()++
++a()
a?.b++
(a?.b)++
--a?.[b]
(a)++
(a as T)++
(<T>a)++
a!++
(a satisfies T)++
a<T>++
this++
1++
[a]++
({ a })++
(a, b)++
-a()
import type a, { b } from "c"
import type a, * as b from "c"
import type a from "c"
import type { b } from "c"
import defer a from "c"
import defer { a } from "c"
import defer * as a from "c"
import defer a, * as b from "c"
import a from b
import a, { c } from b
import b
export * from a
export * as b from a
export { a } from b
export { "a" }
export { "a" as b }
export { "a" as "b" }
export { a as "b" }
export { "a" } from "b"
export { "a" } from b
export { a, "b" }
export type { "a" }
import()
import(a)
import(a, b)
import(a, b, c)
import(a, b, (c), d)
import(a,)
import(...a)
import.defer()
import.defer(a, b, c)
import.defer
import.defer.a
f(import.defer)
import . defer
import.meta
import.foo
import.source("a")
import . /* c */ foo
new.foo
new.target
class {}
export class {}
default class {}
export default class {}
export default abstract class {}
(class {})
class A extends {}
class A implements {}
class A extends B extends C {}
class A extends B, C {}
class A extends B, C, D {}
class A implements B implements C {}
class A implements B extends C {}
class A extends B implements C extends D {}
class A extends B extends {}
class A implements B implements {}
class A extends /* c */ {}
class A extends B implements C, f() {}
class A implements f() {}
class A implements a.b {}
class A implements a?.b {}
class A implements a.b.c<T> {}
class A implements a[b] {}
class A implements (a) {}
class A implements this {}
class A implements a.#b {}
class A extends f() {}
(class extends B extends C {})
(class implements f() {})
class A extends B, C implements f() {}
class A implements f() extends B {}
interface I implements A {}
interface I implements {}
interface I extends {}
interface I extends A extends B {}
interface I extends A implements B {}
interface I implements A extends B {}
interface I extends f() {}
interface I extends a.b, f() {}
interface I extends a?.b {}
interface I extends a[b] {}
interface I extends A, {}
interface I extends A extends f() {}
({ m() })
({ get a() })
({ set a(v) })
({ m(), n() })
({ a: 1, m(); })
({ m() } = a)
[{ m() }] = a
({ a: { m() } } = b)
({ a: [{ m() }] })
for ({ m() } of a) {}
(({ m() }) = a)
f({ m() })
for (var a, b in c) {}
for (var a, b of c) {}
for (let a = 1 in b) {}
for (var a = 1 in b) {}
for (let a = 1 of b) {}
for (let a: T in b) {}
for (let a: T of b) {}
for (let a: T = 1 of b) {}
for (var of b) {}
for (a() of b) {}
for (a() in b) {}
for (a?.b of c) {}
for ((a) of b) {}
for ((a as T) of b) {}
for ({ a } of b) {}
for ([a] of b) {}
for (({ a }) of b) {}
for (([a]) in b) {}
for (1 of b) {}
for (this of b) {}
for (a.b in c) {}
function f<>() {}
function f< >() {}
function f</* c */>() {}
function f <> () {}
declare function f<>(): void
(function <>() {})
(function f<>() {})
class A<> {}
(class <> {})
(class A<> {})
class A { m<>() {} }
class A { m<>(); }
class A { get a<>() { return 1 } }
class A { constructor<>() {} }
class A { "m"<>() {} }
class A { [m]<>() {} }
({ m<>() {} })
interface I<> {}
interface I < > {}
interface I { <>(): void }
interface I { new <>(): void }
interface I { m<>(): void }
type T<> = 1
type T = <>() => void
type T = new <>() => void
type T = () => () => void
type T = A<B>
f<>()
new A<>()
new A<>
let a: A<>
a<>
a<>.b
class A extends B<> {}
class A implements B<> {}
interface I extends B<> {}
let a: typeof b<>
let a: import("m")<>
f<>\`a\`
let a: A.B<>
let a: A<B<>>
declare function f() {}
declare async function f();
declare function* f();
declare async function* f() {}
function* f();
async function* f();
export function* f();
export declare function f() {}
namespace N { declare function f() {} }
declare namespace N { function f() {} }
let a: function(string): void
let a: ?string
let a: string?
let a: !string
let a: *
`
  .split("\n")
  .reduce((all, line) => {
    // A line that is indented, or that follows a line that cannot end a case, continues the case.
    if (line.startsWith("  ") || all.at(-1) === "throw") all[all.length - 1] += `\n${line}`;
    else if (line !== "") all.push(line);
    return all;
  }, []);

const codes = [...others];
for (const place of places) {
  codes.push(place.replace("$ ", ""));
  for (const first of modifiers) {
    codes.push(place.replace("$", first));
    for (const second of modifiers) codes.push(place.replace("$", `${first} ${second}`));
  }
}

const brief = messages =>
  messages.filter(it => it.fatal).map(({ message, line, column }) => ({ message, line, column }));
const linter = new Linter({ configType: "flat" });
const ofEslint = code => brief(linter.verify(code, { files: ["**"], languageOptions: { parser } }, "file.ts"));
const toCase = code => ({
  code,
  filename: "file.ts",
  config: { rules: {}, languageOptions: { parser: "typescript" } },
  options: {},
});
const ofBunLint = all => runBunLint("verify", all.map(toCase)).map(it => brief(it.messages));
const limit = Number(process.argv[2] ?? 10);

const expected = codes.map(ofEslint);
console.log(`${expected.filter(it => it.length > 0).length} of ${codes.length} are refused`);
report("one error", codes, expected, ofBunLint(codes), limit);

// What TypeScript's parser accepts and the converter refuses.
const converted = codes.filter(
  (code, i) => expected[i].length > 0 && !code.includes("import") && !code.includes("export"),
);
const rng = random(5);
const nests = [
  "$1\n$2",
  "$1;\n$2",
  "function f() { $1 }\n$2",
  "function f(a = () => { $1 }) { $2 }",
  "if (a) { $1 } else { $2 }",
  "if (() => { $1 }) { $2 }",
  "for (;;) { $1 }\n{ $2 }",
  "class A { m() { $1 } n() { $2 } }",
  "class A<> { m() { $1 } }",
  "function f<>() { $1 }",
  "a(() => { $1 }, () => { $2 })",
  "(() => { $1 }) ? (() => { $2 }) : 1",
  "namespace N { $1\n$2 }",
  "try { $1 } catch { $2 }",
  "switch (a) { case (() => { $1 }): { $2 } }",
];
const pairs = [];
for (let i = 0; i < 6000; i++) {
  pairs.push(rng.pick(nests).replace("$1", rng.pick(converted)).replace("$2", rng.pick(converted)));
}
const ofPairs = pairs.map(ofEslint);
const oursOfPairs = ofBunLint(pairs);
const sameVerdict = ofPairs.filter((it, i) => it.length > 0 === oursOfPairs[i].length > 0).length;
console.log(`two errors: the verdict is the same for ${sameVerdict} of ${pairs.length}`);
report("two errors", pairs, ofPairs, oursOfPairs, limit);
