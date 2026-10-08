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
];

const cases = snippets.map((code, i) => ({ path: `snippet ${i}: ${code}`, code, filename: "snippet.js" }));
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

const differences = [];
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
    const [isRefused, parser] = actual[i];
    if ((expected !== null) !== isRefused) differences.push({ path: it.path, prettier: expected, parser });
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
if (differences.length > 0) process.exitCode = 1;
