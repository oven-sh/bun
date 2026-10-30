// What `bun fmt` prints for conditionals of arrow functions in TypeScript, judged by TypeScript's own parser: it has to
// read the text as it reads the source. See `ends_like_arrow_function_head` in
// src/format/js/parentheses/expression.rs.
//
//   node judge.mjs --modules=<dir> --bun=<bun> [--matrix [--jsx] | --values] [--bare] [--always] [--count=5000]
//     [--seed=1] [--width=80] [--experimental-ternaries] [--oxfmt] [--show=5]
//
// - `--modules`: a directory with node_modules/prettier and node_modules/typescript, and node_modules/esbuild for the
//   count about esbuild. The rule was checked with Prettier 3.9.9, TypeScript 6.0.2, and esbuild 0.21.5 and 0.28.2.
// - `--matrix`: instead of random sources, every pair of an operand before the `:` and one after it, in ten
//   positions, with every parameter in parentheses.
// - `--jsx`: the matrix is of conditionals with an element in them, in a `.tsx` file. Prettier puts parentheses
//   around their operands if they break.
// - `--bare`: the parameters of the matrix have no parentheses, as `arrowParens: "avoid"` leaves them.
// - `--values`: instead of the matrix, arrow functions without parentheses around their parameter as values in an
//   object, an array or a class after the `:`. With parentheses, TypeScript reads on in some of them.
// - `--always`: with the default `arrowParens: "always"` instead of "avoid".
// - `--oxfmt`: Bun formats in the flavor of oxfmt. The counts are still about what Prettier prints.
//
// A source that TypeScript reports a syntax error for is left out. Of the others it counts, and shows a few of each:
//
// - `broken`: TypeScript reads what Prettier prints as the source, and what Bun prints as another program or as a
//   syntax error. That is so at two widths for a source that Prettier itself damages from one column below them:
//   with the parentheses of this rule the line breaks earlier, Prettier's own parentheses around a conditional go,
//   and a `( .. )` that this rule does not cover, like `([b].c ? ..)`, then stands before a `:`. `--matrix --always`
//   has two such sources at width 80.
// - `repaired`: it reads what Bun prints as the source, and what Prettier prints as something else.
// - `left`: it reads neither as the source. Parentheses are missing that this rule does not write: a second pair
//   around `(a, b)`, those around an arrow function that `yield` returns.
// - `pairs`: it reads both as the source, and Bun prints something else than Prettier: parentheses that TypeScript
//   does not need.
// - `unstable`: formatting what Bun prints changes it, and Prettier does not change what it printed itself. There must
//   be none.
// - `refused`: `bun fmt` reports an error for a source, or for what it or Prettier prints for one where TypeScript
//   reads that as the source. There must be none. A source that it refuses is not in the other counts.
// - `leftToEsbuild`: esbuild reads the source, and reports a syntax error for what Bun prints.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const named = Object.fromEntries(process.argv.slice(2).map(it => it.replace(/^--/, "").split("=")));
const require = createRequire(join(resolve(named.modules), "noop.js"));
const prettier = require("prettier");
const ts = require("typescript");
const esbuild = (() => {
  try {
    return require("esbuild");
  } catch {
    return null;
  }
})();
const options = {
  arrowParens: "always" in named ? "always" : "avoid",
  printWidth: Number(named.width ?? 80),
  ...("experimental-ternaries" in named ? { experimentalTernaries: true } : {}),
};

const extension = "jsx" in named ? "tsx" : "ts";
const oneLine = text => text.trim().replace(/\s+/g, " ");

/** The tree without parentheses, or the first syntax error. */
function read(text) {
  const file = ts.createSourceFile(`a.${extension}`, text, ts.ScriptTarget.Latest, true);
  if (file.parseDiagnostics.length)
    return `error: ${ts.flattenDiagnosticMessageText(file.parseDiagnostics[0].messageText, " ")}`;
  const unwrapped = node => (ts.isParenthesizedExpression(node) ? unwrapped(node.expression) : node);
  const shape = parenthesized => {
    const node = unwrapped(parenthesized);
    // Prettier prints `a ?? b ?? c` for `a ?? (b ?? c)`, which means the same.
    if (ts.isBinaryExpression(node) && ["||", "&&", "??"].includes(node.operatorToken.getText())) {
      const operands = [];
      const flatten = operand => {
        const inner = unwrapped(operand);
        if (ts.isBinaryExpression(inner) && inner.operatorToken.kind === node.operatorToken.kind) {
          flatten(inner.left);
          flatten(inner.right);
        } else operands.push(shape(inner));
      };
      flatten(node);
      return `(${operands.join(` ${node.operatorToken.getText()} `)})`;
    }
    // The line breaks and the indentation that Prettier puts between the children of an element are no text.
    if (ts.isJsxText(node)) return node.containsOnlyTriviaWhiteSpaces ? "" : oneLine(node.getText());
    const children = [];
    node.forEachChild(child => {
      const text = shape(child);
      if (text !== "") children.push(text);
    });
    return children.length ? `${ts.SyntaxKind[node.kind]}(${children.join(" ")})` : node.getText();
  };
  return file.statements.map(shape).join(" ");
}

let state = Number(named.seed ?? 1) >>> 0;
function random() {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = list => list[Math.floor(random() * list.length)];
let count = 0;
const name = () => pick(["a", "b", "c", "d", "e"]) + (count++ % 7);
const leaf = () => pick([name, name, name, () => "1", () => '"s"', () => "null", () => "this", () => "true"])();
const inParentheses = e => `(${e})`;
/** A single name as a parameter, with parentheses or without. */
const parameter = x => (random() < 0.5 ? `(${x})` : x);

function arrow(e) {
  const x = name();
  return pick([
    () => `${parameter(x)} => ${e()}`,
    () => `${parameter(x)} => ${e()}`,
    () => `${parameter(x)} => ${e()}`,
    () => `${parameter(x)} => ({ k: ${e()} })`,
    () => `${parameter(x)} => ({})`,
    () => `${parameter(x)} => {}`,
    () => `async ${parameter(x)} => ${e()}`,
    () => `(${x}, ${name()}) => ${e()}`,
    () => `() => ${e()}`,
    () => `() => ({ k: ${e()} })`,
    () => `() => ({})`,
    () => `(${x}): T => ${e()}`,
    () => `(${x}: T) => ${e()}`,
    () => `(${x}: T) => ({ k: ${e()} })`,
    () => `({ ${x} }) => ${e()}`,
    () => `${parameter(x)} => (${e()}, ${e()})`,
    () => `${parameter(x)} => (${name()} = ${e()})`,
  ])();
}

function expression(depth) {
  if (depth <= 0) return leaf();
  const e = () => expression(depth - 1);
  const chance = random();
  if (chance < 0.35) return arrow(e);
  if (chance < 0.5) return `${pick([name, () => inParentheses(e())])()} ? ${e()} : ${e()}`;
  return pick([
    leaf,
    () => `[${e()}]`,
    () => `[${e()}, ${e()}]`,
    () => `[...${inParentheses(e())}, ${e()}]`,
    () => `({ k: ${e()} })`,
    () => `({ k: ${e()}, m: ${e()} })`,
    () => `({ [${e()}]: ${e()} })`,
    () => `({ ...${inParentheses(e())} })`,
    () => `({ k() { return ${e()}; } })`,
    () => `${inParentheses(e())}.p`,
    () => `${inParentheses(e())}[${e()}]`,
    () => `${name()}[${e()}]`,
    () => `${name()}.p[${e()}]`,
    () => `${inParentheses(e())}(${e()})`,
    () => `f(${e()})`,
    () => `f(${e()}, ${e()})`,
    () => `new F(${e()})`,
    () => `keyof(${e()})`,
    () => `o.m(${e()})`,
    () => `f<T>(${e()})`,
    () => `async(${e()})`,
    () => `<T>${inParentheses(e())}`,
    () => `${inParentheses(e())} | ${inParentheses(e())}`,
    () => `${inParentheses(e())} || ${inParentheses(e())}`,
    () => `${inParentheses(e())} ?? ${inParentheses(e())}`,
    () => `${inParentheses(e())} + ${inParentheses(e())}`,
    () => `${inParentheses(e())} < ${inParentheses(e())}`,
    () => `${name()} < ${e()}`,
    () => `${name()} << ${e()}`,
    () => `(${e()}, ${e()})`,
    () => `(${name()} = ${e()})`,
    () => `${name()} = ${e()}`,
    () => `!${inParentheses(e())}`,
    () => `typeof ${inParentheses(e())}`,
    () => "`${" + e() + "}`",
    () => "t`${" + e() + "}`",
    () => `${inParentheses(e())} as T`,
    () => `${inParentheses(e())}!`,
    () => `function () { return ${e()}; }`,
    () => `class { m = ${e()}; }`,
  ])();
}

const conditional = depth =>
  `${pick([name, name, () => inParentheses(expression(depth - 1))])()} ? ${expression(depth)} : ${expression(depth)}`;
const positions = [
  c => c,
  c => c,
  c => c,
  c => `p ? ${c} : z`,
  c => `p ? (${c}) : z`,
  c => `p ? (r) => (${c}) : z`,
  c => `p ? w ? v : ${c} : z`,
  c => `f(${c}, ${arrow(leaf)})`,
  c => `[${c}, ${arrow(leaf)}]`,
  c => `f(${c}, ${name()}, [${arrow(() => arrow(leaf))}])`,
  c => `f(${name()} => ${c}, ${arrow(leaf)})`,
  c => `(${c}, ${arrow(leaf)})`,
];
const statements = [
  e => `const v0 = ${e};`,
  e => `x0 = ${e};`,
  e => `const f0 = async () => { x0 = ${e}; };`,
  e => `function* g() { yield ${e}; }`,
  e => `switch (v) { case ${e}: break; }`,
  e => `export default ${e};`,
  e => `f(${e});`,
  e => `class C { p = ${e}; }`,
];

function matrix() {
  const before = [
    ..."(q) => ({})|(q) => ({ c: q })|(q) => ({ c: f() })|(q) => (q, r)|(q) => (q = r)|(q) => ([q] = r)|(q) => ({ q } = r)".split(
      "|",
    ),
    ..."(a, b)|(b = 1)|([a] = b)|({ a } = b)|async(q)|async<U>(q)|<U>(q, r)|(q) => async(q)|(q, r) => ({})|({ q }) => ({})".split(
      "|",
    ),
    ..."(q = 1) => ({})|async (q) => ({})|(q) => (r) => ({})|(q) => (r += q)|(q) => ({ q }).r|(q) => (q.r, 2)".split(
      "|",
    ),
    ..."(q) => (b ? c : d)|(q) => ([b] ? c : d)|(q) => [q]|(q) => q|(q) => { return {}; }|({} as T)|(a as T)|([a] ?? b)".split(
      "|",
    ),
    ..."(q) => (r = (s) => ({}))|(q) => (r, (s) => ({}))|b ? c : (q) => ({})|(b ? c : (q) => ({}))|([b].c ? d : () => ({}))".split(
      "|",
    ),
    ..."() => ({})|() => ({ c: f() })|() => ({ c: a.b })|() => ({ c: [b] })|() => ({ ...a })|() => ({ c: (d) => e })".split(
      "|",
    ),
    ..."(a: T) => ({ c: q })|(a?) => ({})|(...a) => ({})|async () => ({})|() => (a, b)|() => (a = b)|() => ([a], b)".split(
      "|",
    ),
    ..."() => ([b] ? c : d)|() => (a ? b : c)|() => []|() => (q) => ({})|(): T => ({})|<U>(a) => ({})|() => async(q)".split(
      "|",
    ),
    ..."async<U>(1)|async<U>(q.r)|<U>(1, r)|<U>(q.r, s)|() => ({ c: (d) => e, f: [(g) => h] })|(a = 1, b)".split("|"),
    ..."(a as T, b)|(a satisfies T)|(q) => (a as T, b)|(q) => (a = 1, b)|(q) => (a! = b)|(q) => ((a as T) = b)".split(
      "|",
    ),
    ..."(q) => (<U>a, b)|(q) => (a<U>, b)|(q) => ((a = 1) as T, b)|(q) => (a.b as T, c)".split("|"),
    ..."<U>((d) => e)|<U>(q = r)|async<U>((d) => e)|async<U>(q = r)|async<U>(async (d) => e)|async(q = r)".split("|"),
    ..."async((q, r))|async(q = r, s)|async(q as T)|async(q.r = s)".split("|"),
    ..."(() => ({}))|((q) => ({ c: q }))|() => (({}))".split("|"),
    ..."b ? c : () => ({})|b ? c : d ? e : () => ({})|b ? (q) => ({}) : () => ({ c: q })".split("|"),
  ];
  const after = [
    ..."(x) => x|(x) => (y) => 1|(x) => (id): T => 1|(x) => (y) => (id): T => 1|() => (y) => (id): T => 1".split("|"),
    ..."(x, z) => (y) => 1|(x) => (b: X) => (y) => (id): T => 1|(x) => async (y): T => 1|(x) => <U>(y): T => 1".split(
      "|",
    ),
    ..."(x) => (y: X): T => 1|(x) => { return (id): T => 1; }|(x) => [(id): T => 1]|async (x) => x|(x, y) => x".split(
      "|",
    ),
    ..."(x): T => (y) => 1|((x) => y)()|((x) => (id): T => y)()|((x) => y, z)|(x) => (b ? c : (id): T => y)".split("|"),
    ..."(x) => (y = (id): T => 1)|x|f((x) => y)|items.map((x) => x.id)|[(x) => y]|{ a: (x) => y }|a[(x) => y]".split(
      "|",
    ),
    ..."a < ((x) => y)|a << [(x) => y]|keyof((x) => y)|t ? (x) => y : w|(t ? (x) => y : w)(1)".split("|"),
    ...["z || ((x) => y)", "a < b", "a << b", "(x) => a < b", "z | a < b", "(t ? u : w) ? (x) => y : w"],
    ...["null", '"s".concat((x) => y)', "1 + ((x) => y)", '"s"[(x) => y]', "1 | ((x) => y)", "{ m() {} }", "class {}"],
    "() => { if (a) { return 1; } }",
    "`${(x) => y}`",
    // With parentheses around the parameter, TypeScript reads on: the bare parameter is the one that it reads right.
    "{ m: async (x) => { if (x) { return 1; } } }",
    "{ m: (x) => (y) => { if (y) { return 1; } } }",
    "{ m: async (x) => function () {} }",
    "{ m: (x) => class {} }",
    "() => ({ m: async (x) => { if (x) { return 1; } } })",
    "((x) => (a, b)) | function () {}",
    "{ m: (x) => x.d, n() { return 1; } }",
    "{ fetch: async (x) => load(x), reset() { return 1; } }",
    "(s: S) => ({ on: async (x) => { if (!x) { return; } await s.save(x); } })",
  ];
  const around = [
    (b, a) => `cond ? ${b} : ${a}`,
    (b, a) => `p ? (cond ? ${b} : ${a}) : z`,
    (b, a) => `p ? (r) => (cond ? ${b} : ${a}) : z`,
    (b, a) => `p ? (w ? v : cond ? ${b} : ${a}) : z`,
    (b, a) => `f(cond ? ${b} : ${a}, (s) => (t) => s)`,
    (b, a) => `[cond ? ${b} : ${a}, d, [(s) => s]]`,
    (b, a) => `f((r) => cond ? ${b} : ${a}, (s) => s)`,
  ];
  const sources = [];
  for (const make of around) {
    for (const b of before) {
      for (const a of after) sources.push(`const v0 = ${make(b, a)};\n`, `x0 = ${make(b, a)};\n`);
    }
  }
  for (const b of before) {
    for (const a of after) {
      sources.push(
        `switch (v) { case cond ? ${b} : ${a}: break; }\n`,
        `x0 = { k: cond ? ${b} : ${a}, [(s) => s]: 1 };\n`,
        `x0 = import(cond ? ${b} : ${a}, { with: (s) => s });\n`,
      );
    }
  }
  return sources;
}

function jsxMatrix() {
  const sources = [
    ..."x = a ? (b ? (q) => ({ x }) : (deps) => y) : <i />;|x = a ? (b ? () => ({}) : (deps) => y) : <i />;".split("|"),
    ..."x = a ? <i /> : b ? (q) => ({ x }) : (deps) => (id): T => y;|x = a ? <i /> : b ? () => ({}) : (deps) => y;".split(
      "|",
    ),
    ..."x = a ? (b ? (q) => ({ x }) : <i />) : (deps) => (id): T => y;|x = a ? () => ({}) : (deps) => <i />;".split(
      "|",
    ),
    ..."x = a ? (b ? <i /> : (q) => ({ x })) : (deps) => (id): T => y;|x = a ? ((q) => ({ x })) : <i />;".split("|"),
    ..."x = a ? (b ? <i /> : () => ({})) : (deps) => y;|x = a ? (q, r) : b ? <i /> : (deps) => (id): T => y;".split(
      "|",
    ),
    "x = a ? (b ? (q) => ({ x }) : (deps) => y) : c ? <i /> : (z) => z;",
    "x = a ? <i /> : (b ? (q) => ({ x }) : (deps) => y) ? (u) => u : (w) => w;",
    "x = a ? (v) => (b ? (q) => ({ x }) : (deps) => y) : <i />;",
    "x = a ? (v) => (b ? () => ({}) : (deps) => <i />) : z;",
    "x = a ? (b ? c : (q) => ({ x })) : (deps) => (id): T => <i />;",
    "x = <i>{a ? (b ? (q) => ({ x }) : (deps) => y) : z}</i>;",
    "x = <i>{a ? () => ({}) : (deps) => y}</i>;",
    "x = <i a={c ? (q) => ({ x }) : (deps) => (id): T => y} />;",
    "x = a ? (b ? (q) => ({ x }) : (deps) => y) : <i>{c ? () => ({}) : (z) => z}</i>;",
    "x = a ? <T,>(q: T) => ({}) : (deps) => y;",
    "x = a ? <T,>(q) => ({}) : (deps) => (id): U => y;",
    "x = a ? (p) => <T,>(q) => ({}) : (deps) => (id): U => y;",
    "x = a ? (q) => ({}) : (deps) => <T,>(r) => (id): U => y;",
  ].map(source => `${source}\n`);
  const before = [
    ..."a|{ a: 1 }|[a]|(a = 1)|(a, b)|this|a.b|f(a)|(q) => ({ x })|() => ({})|(q) => q|null|b ? c : d".split("|"),
    ..."b ? c : { d }|{ d } ? b : c|<b />|async (q) => q|() => ({ x: (q) => q })".split("|"),
  ];
  const after = [
    ..."(c) => (d): T => e|(c) => e|(c) => (d) => e|(c) => <i />|(c) => (d): T => <i />".split("|"),
    ..."b ? (c) => (d): T => e : z|[(c) => e]|null|items.map((c) => c.id)".split("|"),
    ..."<b>{items.map((c) => c.id)}</b>|<b on={(c) => e} />|<>{(c) => e}</>|<b>(d){(c) => (d): T => e}</b>".split("|"),
    "<b on={(c) => e}>(d){(f) => g}</b>",
  ];
  for (const test of ["<i />", "t"]) {
    for (const b of before) {
      for (const a of after) {
        const conditional = `${test} ? ${b} : ${a}`;
        sources.push(
          `x = ${conditional};\n`,
          `x = p ? (${conditional}) : <u />;\n`,
          `x = p ? <u /> : ${conditional};\n`,
        );
      }
    }
  }
  return sources;
}

function valuesMatrix() {
  const before =
    "() => ({})|(a, b)|q => ({ c: q })|(a: T) => ({ c: a })|async(q)|() => (a ? b : c)|(b = 1)|q => q".split("|");
  const values = [
    ..."async c => function () { return 1; }|async c => function* () {}|async c => class {}".split("|"),
    ..."async c => { return 1; }|async c => ({})|async c => c|async c => async function () {}".split("|"),
    ..."async c => () => { return 1; }|async c => d => { return 1; }|async c => new (class {})()".split("|"),
    ..."async c => function () {}.call(c)|c => function () { return 1; }|c => class {}".split("|"),
    ..."c => d => function () { return 1; }|async c => async d => function () { return 1; }".split("|"),
    ..."async c => [function () {}]|async c => ({ m() {} })|async c => `${function () {}}`".split("|"),
    "async c => typeof function () {}",
  ];
  const after = [
    v => `{ m: ${v} }`,
    v => `{ k: 1, m: ${v} }`,
    v => `{ m() { return ${v}; } }`,
    v => `[${v}]`,
    v => `{ k: [${v}] }`,
    v => `{ k: { m: ${v} } }`,
    v => `class { m = ${v}; }`,
    v => `(y) => ({ m: ${v} })`,
    v => `{ ...o, m: ${v} }`,
    v => `{ [k]: ${v} }`,
    v => `{ m: ${v}, n: 1 }`,
  ];
  const statements = [c => `x = ${c};`, c => `const x = ${c};`, c => `function g() { return ${c}; }`, c => `f(${c});`];
  const sources = [];
  for (const statement of statements) {
    for (const b of before) {
      for (const a of after) for (const v of values) sources.push(`${statement(`q ? ${b} : ${a(v)}`)}\n`);
    }
  }
  return sources;
}

function random_sources() {
  const sources = [];
  while (sources.length < Number(named.count ?? 5000)) {
    const source = `${pick(statements)(pick(positions)(conditional(1 + Math.floor(random() * 3))))}\n`;
    if (source.includes("=>")) sources.push(source);
  }
  return sources;
}

/** What Bun prints for each text that isn't null: null for a text that it reports an error for and leaves as it is. */
function format(texts) {
  const directory = fs.mkdtempSync(join(tmpdir(), "arrow-parens-"));
  const config = "oxfmt" in named ? ".oxfmtrc.json" : ".prettierrc";
  fs.writeFileSync(join(directory, config), JSON.stringify(options));
  const path = index => join(directory, `${index}.${extension}`);
  texts.forEach((text, index) => text != null && fs.writeFileSync(path(index), text));
  const run = spawnSync(resolve(named.bun), ["fmt", "--log-level=error", "."], {
    cwd: directory,
    encoding: "utf8",
    maxBuffer: 2 ** 30,
  });
  if (run.error) throw run.error;
  // Under each error: `    at 12.ts:1:31`
  const failed = new Set(Array.from(run.stderr.matchAll(/^\s+at (\d+)\.tsx?\b/gm), match => Number(match[1])));
  if (run.status !== 0 && failed.size === 0)
    throw new Error(`bun fmt ended with ${run.signal ?? run.status}:\n${run.stderr.slice(0, 2000)}`);
  const printed = texts.map((text, index) => {
    if (text == null) return false;
    return failed.has(index) ? null : fs.readFileSync(path(index), "utf8");
  });
  fs.rmSync(directory, { recursive: true, force: true });
  return printed;
}

// `(x) =>` as `x =>`.
const bared = source => source.replace(/\((\w+)\) =>/g, "$1 =>");
const generated =
  "values" in named ? valuesMatrix() : "jsx" in named ? jsxMatrix() : "matrix" in named ? matrix() : random_sources();
const made = "bare" in named ? generated.map(bared) : generated;
const sources = made.filter(source => !read(source).startsWith("error: "));
const byPrettier = text => prettier.format(text, { ...options, filepath: `a.${extension}` }).catch(() => null);
const ours = format(sources);
const theirs = await Promise.all(sources.map(byPrettier));
const again = format(ours);
// Bun reads what Prettier prints, where TypeScript reads that as the source.
const theirsAgain = format(
  theirs.map((text, index) => (text != null && read(text) === read(sources[index]) ? text : null)),
);

const refusals = new Map();
function refusedByEsbuild(text) {
  if (!refusals.has(text)) {
    try {
      esbuild.transformSync(text, { loader: extension });
      refusals.set(text, false);
    } catch {
      refusals.set(text, true);
    }
  }
  return refusals.get(text);
}

const counts = { sources: sources.length, broken: 0, repaired: 0, left: 0, pairs: 0, unstable: 0, leftToEsbuild: 0 };
const shown = { broken: [], left: [], pairs: [], unstable: [], leftToEsbuild: [] };
const refused = new Set();
const changed = [];
sources.forEach((source, index) => {
  if (ours[index] == null) {
    refused.add(source);
    return;
  }
  const tree = read(source);
  const isRight = read(ours[index]) === tree;
  const isRightByPrettier = theirs[index] != null && read(theirs[index]) === tree;
  const both = `${oneLine(source)}\n    ${oneLine(ours[index])}`;
  if (!isRight && isRightByPrettier) {
    counts.broken++;
    shown.broken.push(`${both}\n    ${read(ours[index]).slice(0, 80)}`);
  } else if (!isRight) {
    counts.left++;
    shown.left.push(both);
  } else if (!isRightByPrettier) counts.repaired++;
  else if (ours[index] !== theirs[index]) {
    counts.pairs++;
    shown.pairs.push(`${oneLine(theirs[index])}\n    ${oneLine(ours[index])}`);
  }
  if (again[index] == null) {
    if (isRight) refused.add(ours[index]);
  } else if (again[index] !== ours[index]) changed.push(index);
  if (theirsAgain[index] === null) refused.add(theirs[index]);
  if (esbuild && refusedByEsbuild(ours[index]) && !refusedByEsbuild(source)) {
    counts.leftToEsbuild++;
    shown.leftToEsbuild.push(both);
  }
});
// Prettier changes some of its own texts on a second run, and so does Bun then: `<T>(((a: T) => ({})))`.
await Promise.all(
  changed.map(async index => {
    if (theirs[index] != null && (await byPrettier(theirs[index])) !== theirs[index]) return;
    counts.unstable++;
    shown.unstable.push(`${oneLine(ours[index])}\n    ${oneLine(again[index])}`);
  }),
);
shown.refused = Array.from(refused, oneLine);
for (const [kind, texts] of Object.entries(shown))
  for (const text of texts.slice(0, Number(named.show ?? 5))) console.log(`${kind}: ${text}`);
console.log(JSON.stringify({ ...counts, refused: refused.size }));
process.exitCode = counts.broken || counts.unstable || refused.size ? 1 : 0;
