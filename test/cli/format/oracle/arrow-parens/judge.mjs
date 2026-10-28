// What `bun fmt` prints with `arrowParens: "avoid"` for conditionals of arrow functions, judged by TypeScript's own
// parser: it has to read the text as it reads the source. See `ReturnTypeReading` in
// src/format/js/utils/conditional.rs.
//
//   node judge.mjs --modules=<dir> --bun=<bun> [--matrix [--jsx]] [--count=5000] [--seed=1] [--width=80]
//     [--experimental-ternaries] [--oxfmt] [--show=5]
//
// - `--modules`: a directory with node_modules/prettier and node_modules/typescript, and node_modules/esbuild for the
//   two counts about esbuild. The rule was checked with Prettier 3.9.9, TypeScript 6.0.2 and esbuild 0.21.5.
// - `--matrix`: instead of random sources, every pair of an operand before the `:` and one after it, in eight
//   positions, with every parameter in parentheses.
// - `--jsx`: the matrix is of conditionals with an element in them, in a `.tsx` file. Prettier puts parentheses
//   around their operands if they break.
// - `--oxfmt`: Bun formats in the flavor of oxfmt. `repaired` and `kept` are still about what Prettier prints.
//
// A source that TypeScript reports a syntax error for is left out. Of the others it counts, and shows a few of each:
//
// - `wrong`: TypeScript reads what Bun prints as another program, or reports a syntax error. There must be none.
// - `wrongWithAlways`: the same, and also with `arrowParens: "always"`. So the cause isn't a parameter's parentheses:
//   the printer removes other parentheses that the source needs, as Prettier does.
// - `repaired`: it reads what Prettier prints that way, and what Bun prints as the source.
// - `unstable`: formatting what Bun prints changes it. There must be none.
// - `unstableAnyway`: the same, and also with `arrowParens: "always"`, or Prettier changes what it printed itself:
//   `<T>(((a: T) => ({})))`.
// - `bySource`: Bun prints one text for the source and another for what Prettier prints, and they differ in more than
//   lines and commas. So what it prints depends on the parentheses of the source. There must be none.
// - `kept`: it reads what Prettier prints as the source, and Bun prints something else: parentheses that only
//   other readers of TypeScript need, or that no reader needs.
// - `keptForEsbuild`: of those, the ones where esbuild reports a syntax error for what Prettier prints.
// - `refusedByEsbuild`: esbuild reads what Prettier prints, and reports a syntax error for what Bun prints. esbuild
//   0.21.5 refuses `a ? (b = 1) : [class {}]`, and so `[(c) => c, class {}]` there, where `c =>` stops it earlier.
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
  arrowParens: "avoid",
  printWidth: Number(named.width ?? 80),
  ...("experimental-ternaries" in named ? { experimentalTernaries: true } : {}),
};

const extension = "jsx" in named ? "tsx" : "ts";

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
    const children = [];
    node.forEachChild(child => void children.push(shape(child)));
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
    ..."z || ((x) => y)|a < ((x) => y)|a << [(x) => y]|keyof((x) => y)|t ? (x) => y : w|(t ? (x) => y : w)(1)".split(
      "|",
    ),
    ..."a < b|a << b|(x) => a < b|z | a < b|(t ? u : w) ? (x) => y : w".split("|"),
    "`${(x) => y}`",
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
  for (const b of before) for (const a of after) sources.push(`switch (v) { case cond ? ${b} : ${a}: break; }\n`);
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
    ..."b ? c : { d }|{ d } ? b : c|<b />|async (q) => q".split("|"),
  ];
  const after = [
    ..."(c) => (d): T => e|(c) => e|(c) => (d) => e|(c) => <i />|(c) => (d): T => <i />".split("|"),
    ..."b ? (c) => (d): T => e : z|[(c) => e]|null".split("|"),
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

function random_sources() {
  const sources = [];
  while (sources.length < Number(named.count ?? 5000)) {
    const source = `${pick(statements)(pick(positions)(conditional(1 + Math.floor(random() * 3))))}\n`;
    if (source.includes("=>")) sources.push(source);
  }
  return sources;
}

/** What Bun prints for each text that isn't null. */
function format(texts, arrowParens = "avoid") {
  const directory = fs.mkdtempSync(join(tmpdir(), "arrow-parens-"));
  const config = "oxfmt" in named ? ".oxfmtrc.json" : ".prettierrc";
  fs.writeFileSync(join(directory, config), JSON.stringify({ ...options, arrowParens }));
  const path = index => join(directory, `${index}.${extension}`);
  texts.forEach((text, index) => text != null && fs.writeFileSync(path(index), text));
  spawnSync(resolve(named.bun), ["fmt", "--log-level=error", "."], { cwd: directory, stdio: "ignore" });
  const printed = texts.map((text, index) => text != null && fs.readFileSync(path(index), "utf8"));
  fs.rmSync(directory, { recursive: true, force: true });
  return printed;
}

const made = "jsx" in named ? jsxMatrix() : "matrix" in named ? matrix() : random_sources();
const sources = made.filter(source => !read(source).startsWith("error: "));
const ours = format(sources);
const oursWithAlways = format(sources, "always");
const theirs = await Promise.all(
  sources.map(source => prettier.format(source, { ...options, filepath: `a.${extension}` }).catch(() => null)),
);
const again = format(ours);
const againWithAlways = format(oursWithAlways, "always");
const theirsAgain = format(
  theirs.map((text, index) => (text != null && read(text) === read(sources[index]) ? text : null)),
);
function refusedByEsbuild(text) {
  try {
    esbuild.transformSync(text, { loader: extension });
    return false;
  } catch {
    return true;
  }
}

const counts = {
  sources: sources.length,
  wrong: 0,
  wrongWithAlways: 0,
  repaired: 0,
  unstable: 0,
  unstableAnyway: 0,
  bySource: 0,
  kept: 0,
  keptForEsbuild: 0,
  refusedByEsbuild: 0,
};
const shown = {
  wrong: [],
  wrongWithAlways: [],
  unstable: [],
  unstableAnyway: [],
  bySource: [],
  kept: [],
  refusedByEsbuild: [],
};
// Where a second format changes what Bun prints: whether Prettier changes what it printed itself.
const changedByPrettier = new Set();
await Promise.all(
  sources.map(async (_, index) => {
    if (again[index] === ours[index] || theirs[index] == null) return;
    const twice = await prettier.format(theirs[index], { ...options, filepath: `a.${extension}` }).catch(() => null);
    if (twice !== theirs[index]) changedByPrettier.add(index);
  }),
);
const oneLine = text => text.trim().replace(/\s+/g, " ");
const withoutLayout = text => text.replace(/[\s,]/g, "");
sources.forEach((source, index) => {
  const tree = read(source);
  const isWrong = read(ours[index]) !== tree;
  if (isWrong) {
    const kind = read(oursWithAlways[index]) !== tree ? "wrongWithAlways" : "wrong";
    counts[kind]++;
    shown[kind].push(`${oneLine(source)}\n    ${oneLine(ours[index])}\n    ${read(ours[index]).slice(0, 80)}`);
  }
  if (!isWrong && theirs[index] != null && read(theirs[index]) !== tree) counts.repaired++;
  if (again[index] !== ours[index]) {
    const isAnyway = againWithAlways[index] !== oursWithAlways[index] || changedByPrettier.has(index);
    const kind = isAnyway ? "unstableAnyway" : "unstable";
    counts[kind]++;
    shown[kind].push(`${oneLine(ours[index])}\n    ${oneLine(again[index])}`);
  } else if (theirsAgain[index] && withoutLayout(theirsAgain[index]) !== withoutLayout(ours[index])) {
    counts.bySource++;
    shown.bySource.push(`${oneLine(source)}\n    ${oneLine(ours[index])}\n    ${oneLine(theirsAgain[index])}`);
  }
  if (esbuild && theirs[index] != null && ours[index] !== theirs[index]) {
    if (!refusedByEsbuild(theirs[index]) && refusedByEsbuild(ours[index])) {
      counts.refusedByEsbuild++;
      shown.refusedByEsbuild.push(`${oneLine(theirs[index])}\n    ${oneLine(ours[index])}`);
    }
  }
  if (theirsAgain[index] && theirsAgain[index] !== theirs[index]) {
    counts.kept++;
    shown.kept.push(`${oneLine(theirs[index])}\n    ${oneLine(theirsAgain[index])}`);
    if (esbuild && refusedByEsbuild(theirs[index])) counts.keptForEsbuild++;
  }
});
for (const [kind, texts] of Object.entries(shown))
  for (const text of texts.slice(0, Number(named.show ?? 5))) console.log(`${kind}: ${text}`);
console.log(JSON.stringify(counts));
process.exitCode = counts.wrong || counts.unstable || counts.bySource ? 1 : 0;
