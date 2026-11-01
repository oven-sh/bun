// What `bun fmt` prints for conditionals of arrow functions in TypeScript, judged by tsc's own parser: it has to read
// the text as it reads the source. See `is_misread_by_tsc` and `AfterColon` in src/format/js/utils/conditional.rs.
//
//   node judge.mjs --modules=<dir> --bun=<bun> [--main=<bun>] [--matrix [--jsx] | --values | --sites | --paths |
//     --families | --comments | --file=<json>] [--bare] [--each] [--always] [--count=5000] [--seed=1]
//     [--width=80,40] [--experimental-ternaries] [--trailing-comma=none] [--oxfmt] [--babel-ts]
//     [--reader=<program>] [--show=5]
//
// - `--modules`: a directory with node_modules/prettier and node_modules/typescript, and node_modules/esbuild for the
//   counts about esbuild and Node. The rule was checked with Prettier 3.9.9, TypeScript 6.0.2, esbuild 0.18.6 and
//   Node 26.3.0.
// - `--main`: a build of main. A text that it prints as `--bun` does is not counted as `broken`, `pairs`, `silenced`
//   or `unstable`: there Bun differs from Prettier for another reason. Without it, random sources with
//   `<T>function () {}` in them count as `pairs`.
// - `--matrix`: instead of random sources, every pair of an operand before the `:` and one after it, in ten
//   positions, with every parameter in parentheses.
// - `--jsx`: the matrix is of conditionals with an element in them, in a `.tsx` file. Prettier puts parentheses
//   around their operands if they break.
// - `--bare`: the parameters of the matrix have no parentheses, as `arrowParens: "avoid"` leaves them.
// - `--values`: instead of the matrix, arrow functions without parentheses around their parameter as values in an
//   object, an array or a class after the `:`. With parentheses, tsc reads on in some of them.
// - `--sites`: conditionals after a `( .. )` and a `:` that the rule does not cover: `case (a, b):`, a `yield`,
//   `() => async(q)`, `<U>(a, b)`, a conditional under `// prettier-ignore`. Parentheses that tsc does not need can
//   change how it reads the text after such a `:`.
// - `--paths`: the conditional of the rule at the end of what follows the `:` of another conditional, through arrow
//   functions, conditionals, an assignment, brackets and a block. With `(d) =>` kept in it alone, tsc can read on
//   from a `( .. )` before that other `:`: the rule keeps `(y) =>` after that `:` too.
// - `--families`: the conditional of the rule before the `:` of another conditional, with a conditional of its own
//   at the end of the arrow function that has the return type. With `(d) =>` kept in the first one alone, that one
//   can take the `:` of the other: the rule keeps the names after each `:` of such a family.
// - `--comments`: every pair of the matrix with a comment in one place: before and after each operand, in the
//   parentheses that end the first one, before a `=>`, as `// prettier-ignore` and as a JSDoc type cast.
// - `--file`: instead of generated sources, the sources in a file: a JSON array of texts.
// - `--each`: each source of the form `x = ..;` is a cell of a `test.each` table, which Bun prints on one line:
//   there a conditional with an element in it has no parentheses around its operands. Prettier breaks such a cell,
//   so `pairs` is no error with this flag: `againstMain` is the count to read.
// - `--trailing-comma`: Prettier's option. With `all`, the default, a parameter list that breaks ends in `,`.
// - `--always`: with the default `arrowParens: "always"` instead of "avoid".
// - `--width`: one print width or several. The counts are summed.
// - `--oxfmt`: Bun formats in the flavor of oxfmt. The counts are still about what Prettier prints, and oxfmt puts
//   some comments in other places: use `--main` with `--comments`.
// - `--babel-ts`: the files are `.js`, read with the parser `babel-ts`, which keeps JSDoc type casts. The parser of
//   `bun fmt` reads no return type before the `:` of a conditional in a `.js` file, so it reads some sources as
//   another program and refuses others, on main too: use `--main`, and compare `refused` with a run of main.
// - `--reader`: a program that reads the texts in place of the `typescript` package. It gets the directory of
//   `--modules` as its argument and a JSON array of `{ text, ext }` on standard input, and prints one
//   `{ diags, shape }` for each: the messages of the syntax errors, and the tree without parentheses.
//   typescript7.mjs in this directory reads with the native TypeScript. The rule was also checked with TypeScript's
//   parser in Go at the head of microsoft/TypeScript#64233, which gives up a return type if the reading ends in a
//   syntax error. Such a tree has the white space between the children of an element: not for `--jsx`.
//
// A source that tsc reports a syntax error for is left out, and with `--reader` one that either reader reports one
// for. Of the others it counts, and shows a few of each:
//
// - `broken`: tsc reads what Prettier prints as the source, and what Bun prints as another program or as a syntax
//   error. There must be none.
// - `pairs`: it reads both as the source, and Bun prints something else than Prettier: parentheses that tsc does not
//   need. There must be none. `broken` can only come from such parentheses.
// - `pairsBeforeBrokenList`: the same, where the parameters before the return type are on lines of their own and end
//   in `,`. tsc reports a syntax error for Prettier's text there, and the parser of microsoft/TypeScript#64233 reads
//   it as the source: `(e,)` is no expression. With `trailingComma: "none"`, or on one line, all of them misread it.
// - `silenced`: tsc reports a syntax error for what Prettier prints, and reads what Bun prints as another program
//   with no error. With `--main`, only where main prints what Prettier prints: in a `.js` file, main prints
//   `async<U>(q)` as `async < U > q`, and that is the other program. There must be none.
// - `repaired`: it reads what Bun prints as the source, and what Prettier prints as something else.
// - `kept`: Bun prints something else than Prettier. With `--main`: and than main.
// - `left`: it reads neither as the source. The rule keeps parentheses only in a family of conditionals with the
//   shape of `a ? b => ({ c }) : (d) => (e): T => f` in it, before a return type that is one name. It leaves
//   `a ? () => ({}) : c => c` and `a ? b => ({ c }) : d => (e): Promise<T> => f`, for which tsc reports a syntax
//   error, and which the parser of microsoft/TypeScript#64233 reads as the source. `refusedAgain` and `changedAgain`
//   are what a second run of Bun does with them: it reports the syntax error, or it prints the program that tsc
//   reads. With `--main`, `anew` are the ones that main prints in another way: tsc still reports a syntax error for
//   another part of the text. `anewChangedAgain` are the ones of them that a second run changes: tsc reads another
//   program with no error there, from main's text too. `againNotAsOnMain` are the ones that main prints in the same
//   way and formats again in another way. There must be none.
// - `asOnMain`: with `--main`, the sources that main prints as `--bun` does and that would count as `broken` or
//   `pairs`. They are differences from Prettier that this rule does not make.
// - `againstMain`: with `--main`, the sources that main prints in another way than `--bun`. `broken`: tsc reads
//   main's text as the source, and not Bun's. `silenced`: it reports a syntax error for main's text, and reads Bun's
//   as another program with no error. There must be none of either. `repaired`: it reads Bun's as the source, and
//   not main's. These count in a cell of a table too, where Prettier prints other lines than main. With `--babel-ts`,
//   `silenced` is no error: main prints `async<U>(q)` as `async < U > q`, which is the other program, and a name
//   that Bun keeps elsewhere in that text takes away the syntax error.
// - `unstable`: tsc reads what Bun prints as the source, and formatting that changes it. Where Bun prints what
//   Prettier prints, and Prettier changes that on a second run, it is not counted. There must be none.
// - `refused`: `bun fmt` reports an error for a source, or for what it or Prettier prints for one where tsc reads
//   that as the source. There must be none. A source that it refuses is not in the other counts. With `--main`, a
//   source that main refuses too is in `refusedOnMainToo`: with `--oxfmt`, `(this, id): T => 1` is an error.
// - `refusedAnew`: with `--main`, `bun fmt` reports an error for what it prints, and main reports none for what
//   main prints. There must be none.
// - `leftToEsbuild`: esbuild reads the source, and reports a syntax error for what Bun prints.
// - `node`: for the sources where Bun prints something else than Prettier, how Node's type stripping reads each text:
//   as the `source`, as some `other` program, or as an `error`. Its `broken` is the sources where it reads what
//   Prettier prints as the source, and not what Bun prints. There must be none.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import module, { createRequire } from "node:module";
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
  ...(named["trailing-comma"] ? { trailingComma: named["trailing-comma"] } : {}),
  ...("experimental-ternaries" in named ? { experimentalTernaries: true } : {}),
  ...("babel-ts" in named ? { parser: "babel-ts" } : {}),
};
const widths = String(named.width ?? 80)
  .split(",")
  .map(Number);

const extension = "jsx" in named ? "tsx" : "babel-ts" in named ? "js" : "ts";
const oneLine = text => text.trim().replace(/\s+/g, " ");

/** The tree without parentheses, or the first syntax error, as the `typescript` package reads `text`. */
function readWithTypeScript(text) {
  const file = ts.createSourceFile(extension === "tsx" ? "a.tsx" : "a.ts", text, ts.ScriptTarget.Latest, true);
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
    // Prettier removes the `;` after `case a: { k: b };`.
    if (ts.isEmptyStatement(node)) return "";
    const children = [];
    node.forEachChild(child => {
      const text = shape(child);
      if (text !== "") children.push(text);
    });
    return children.length ? `${ts.SyntaxKind[node.kind]}(${children.join(" ")})` : node.getText();
  };
  return file.statements.map(shape).join(" ");
}

const readings = new Map();
/** Reads the texts that have no reading yet, with `--reader` if there is one. */
function readAll(texts) {
  const fresh = Array.from(new Set(texts)).filter(text => typeof text === "string" && !readings.has(text));
  if (!named.reader) {
    for (const text of fresh) readings.set(text, readWithTypeScript(text));
    return;
  }
  // One run for every 20,000 texts keeps its input and output below what a string can hold.
  for (let start = 0; start < fresh.length; start += 20000) {
    const texts = fresh.slice(start, start + 20000);
    // A script runs with this Node.
    const reader = resolve(named.reader);
    const command = reader.endsWith(".mjs") ? [process.execPath, reader] : [reader];
    const run = spawnSync(command[0], [...command.slice(1), resolve(named.modules)], {
      input: JSON.stringify(texts.map(text => ({ text, ext: extension === "tsx" ? "tsx" : "ts" }))),
      encoding: "utf8",
      maxBuffer: 2 ** 30,
    });
    if (run.error || run.status !== 0)
      throw run.error ?? new Error(`the reader ended with ${run.status}: ${run.stderr}`);
    JSON.parse(run.stdout).forEach(({ diags, shape }, index) => {
      // As above, an empty statement is nothing.
      const tree = shape.replace(/ (?:Kind)?EmptyStatement ;/g, "");
      readings.set(texts[index], diags.length ? `error: ${diags[0]}` : tree);
    });
  }
}
/** The tree without parentheses, or the first syntax error. */
function read(text) {
  if (!readings.has(text)) readAll([text]);
  return readings.get(text);
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
    // What tsc reads as parameters, and what it does not: a pattern after `...` in an object, a default in a target.
    ..."(q) => ({ ...[...a] })|(q) => ({ ...{ a } })|(q) => ({ a: [b, , ...c], ...d })|(q) => ({ a: b = 1 })".split(
      "|",
    ),
    ..."({ a = 1 } = r)|([a = 1] = r)|(q) => ({ a = 1 } = r)|(q) => ([a = 1, { b: c = 2 }] = r)".split("|"),
    // A body that loses its parentheses when it breaks, and conditionals with a `( .. ) :` of their own.
    ..."(q) => (b ? c : (x, y))|b ? (x, y) : (inner) => ({ q })|b ? (inner) => ({ q }) : (x, y)".split("|"),
    ..."b ? (q) => ({ q }) : (s) => f(s)|(this, r)".split("|"),
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
    // Return types that are no single name: tsc reports a syntax error for what Prettier prints.
    ..."(x) => (id): Promise<T> => 1|(x) => (id): void => 1|(x) => (id): T[] => 1|(x) => (id): A.B => 1".split("|"),
    ...["(x) => (id): T | U => 1", "(x) => (id): id is T => true", "(x) => (id): string => 1"],
    // Other heads before and with the return type.
    ..."(a, b) => (d) => (id): T => 1|(x) => async (g) => (e): T => 1|(x) => (e = 1): T => 1".split("|"),
    ..."(x) => (id, key: U): T => 1|(x) => (id, ...rest): T => 1|(x) => (id, key?): T => 1".split("|"),
    ..."(x) => ({ id }): T => 1|(x) => (id, key): T => 1".split("|"),
    `${Array.from({ length: 20 }, (_, index) => `(n${index}) => `).join("")}(id): T => 1`,
    // A return type right after the `:`, and conditionals that end an arrow function after it: tsc can read on.
    ..."(id): T => 1|(x) => t ? () => ({}) : (y) => (id): T => 1|(x) => t ? (q) => ({ q }) : (y) => (id): T => 1".split(
      "|",
    ),
    ..."(x) => t ? u : (y) => (id): T => 1|(a: U) => t ? () => ({}) : (y) => (id): T => 1".split("|"),
    ..."(x) => () => t ? () => ({}) : (y) => (id): T => 1|() => (y) => t ? (q) => ({ q }) : (z) => (id): T => 1".split(
      "|",
    ),
    // Names that start a type, and return types that are reserved words: tsc reports a syntax error for them.
    ..."(keyof) => (id): T => 1|(readonly) => (id): T => 1|(unique) => (id): T => 1|(infer) => (id): T => 1".split("|"),
    ..."(x) => (keyof) => (id): T => 1|(a, b) => (keyof) => (id): T => 1|(asserts) => (id): T => 1".split("|"),
    ..."(x) => (id): enum => 1|(x) => (id): class => 1|(x) => (id): await => 1|(x) => (id): yield => 1".split("|"),
    // A conditional of its own at the end of the arrow function with the return type: it can take a `:` that follows.
    ..."(x) => (id): T => t ? (m, n) : (d) => 1|(x) => (id): T => t ? (q) => ({ q }) : (d) => 1".split("|"),
    ..."(x) => (id): T => (w) => t ? (m, n) : (d) => 1|(x) => (id): T => t ? u : (d) => 1".split("|"),
    // Parameters before the return type that are expressions too, and ones that are not.
    ..."(x) => <U>(id): T => 1|(x) => ({ id = 1 }): T => 1|(x) => ([id, key]): T => 1|(x) => (this, id): T => 1".split(
      "|",
    ),
    // Names long enough for the parameters to be on lines of their own, where they end in `,`.
    `(x) => (${Array.from({ length: 4 }, (_, index) => `aLongNameOfAParameter${index}`).join(", ")}): T => 1`,
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

function sitesMatrix() {
  const sites = [
    a => `x = c6 ? () => ({}) : ${a};`,
    a => `x = c6 ? (a, b) : ${a};`,
    a => `x = c6 ? (a = b) : ${a};`,
    a => `x = c6 ? async(q) : ${a};`,
    a => `x = c6 ? <U>(a, b) : ${a};`,
    a => `function* g() {\n  x = c6 ? yield (a, b) : ${a};\n}`,
    a => `function* g() {\n  x = c6 ? yield () => ({}) : ${a};\n}`,
    a => `x = c6 ? () => async(q) : ${a};`,
    a => `x = c6 ? (q) => async(q) : ${a};`,
    a => `x = c6 ? (p: T) => <U>(a, b) : ${a};`,
    a => `x = c6\n  ? // prettier-ignore\n    t ? u : () => ({})\n  : ${a};`,
    a => `switch (v) {\n  case (a, b):\n    ${a};\n}`,
    a => `switch (v) {\n  case () => ({}):\n    ${a};\n}`,
    a => `switch (v) {\n  case async(q):\n    ${a};\n}`,
  ];
  const tests = ["t", "({ k: d0 })", "[t]", "t.u", "t!"];
  const before = [
    ..."(c1) => ({ k: null })|(c1) => ({ k })|(c1) => (c2, c3)|() => ({})|(c1: T) => ({})|async (c1) => ({})".split(
      "|",
    ),
    ..."(c1) => (c2 = c3)|(c1) => (c2) => ({})".split("|"),
  ];
  const after = [
    ..."b2 < null|(y) => y|[v]|{ m() {} }|(y) => (id): T => y|(y) => (z) => (id, w): T => y|new A()".split("|"),
    ...["await2", "v << w", "v | w", "(y) => (id): Promise<T> => y"],
  ];

  const around = [
    c => `(${c}) ?? z`,
    c => `[${c}]`,
    c => `{ k: ${c} }`,
    c => `f(${c})`,
    c => `(y) => ${c}`,
    c => `(a1: T) => ${c}`,
    c => c,
    c => `z || (${c})`,
    c => `{ [${c}]: 1 }`,
    c => "`${" + c + "}`",
    c => `new X(${c})`,
    c => `(${c}) as T`,
    c => `f<T>(${c})`,
    c => `(${c})(1)`,
    c => `(${c}).k`,
    c => `{ m: (a1: T) => ${c} }`,
    c => `[(a1) => ${c}]`,
  ];
  const sources = [];
  for (const site of sites) {
    for (const test of tests) {
      for (const b of before) {
        for (const a of after) for (const make of around) sources.push(`${site(make(`${test} ? ${b} : ${a}`))}\n`);
      }
    }
  }
  return sources;
}

/** The conditional of the rule at the end of what follows the `:` of another conditional, where tsc can read on. */
function pathsMatrix() {
  const outerBefore = [
    ..."(a, b)|(q) => ({ q })|() => ({})|async(q)|z|(b = 1)|<U>(a, b)|(q) => [q]|(p: T) => ({})".split("|"),
  ];
  const paths = [
    ...[c => `(y) => ${c}`, c => `(y) => (z) => ${c}`, c => `(y) => t2 ? u : ${c}`, c => `t2 ? u : (y) => ${c}`],
    ...[c => `(y) => t2 ? (k) => ({ k }) : ${c}`, c => `(y) => (a1: T) => ${c}`, c => `(a1: T) => (y) => ${c}`],
    ...[c => `(y) => async (z) => ${c}`, c => `async (y) => ${c}`, c => `(y) => (z = ${c})`, c => `(y) => (${c})`],
    ...[c => `(y) => [${c}]`, c => `(y, z) => ${c}`, c => `(y) => (z, w) => ${c}`, c => `() => (y) => ${c}`],
    ...[c => `(y) => () => ${c}`, c => `(y) => ({ z }) => ${c}`, c => `(y) => (z): U => ${c}`, c => `(y) => z = ${c}`],
    ...[c => `(y) => t2 ? () => ({}) : (z) => ${c}`, c => `(y) => t2 ? (x2, y2) : t3 ? u : ${c}`],
    ...[c => `(y) => { return ${c}; }`, c => `(y) => f(${c})`],
    // A return type ends what tsc can read as a type: the names after it stay as they are.
    ...[c => `(y): U => (z) => ${c}`, c => `(a1: T): U => (z) => ${c}`, c => `<V>(y): U => (z) => ${c}`],
    ...[c => `<V>(y) => (z) => ${c}`, c => `({ y }) => (z) => ${c}`, c => `(y = 1) => (z) => ${c}`],
  ];
  const before = "() => ({})|(q) => ({ q })|(c: T) => ({})|(m, n)|async (q) => ({ q })".split("|");
  const after = "(d) => (e): T => f|(d) => (g) => (e): T => f|(d) => (e, h): T => { return 1; }".split("|");
  const statements = [
    ...[c => `x = ${c};`, c => `x = p ? (${c}) : z;`, c => `f(${c}, (s) => s);`, c => `const v = p ? w : ${c};`],
  ];
  const sources = [];
  for (const outer of outerBefore) {
    for (const path of paths) {
      for (const b of before) {
        for (const a of after) {
          for (const statement of statements)
            sources.push(`${statement(`c6 ? ${outer} : ${path(`t ? ${b} : ${a}`)}`)}\n`);
        }
      }
    }
  }
  return sources;
}

/** The conditional of the rule before the `:` of another conditional, or with a conditional at the end of its own. */
function familiesMatrix() {
  const sources = [];
  // The rule's conditional where a `:` follows it, and a body after the return type that can take that `:`.
  const contexts = [
    ...[c => `x = p ? (${c}) : w;`, c => `x = p ? (y) => (${c}) : w;`, c => `x = p ? (t2 ? u2 : ${c}) : w;`],
    ...[c => `x = p ? (y) => (z2) => (${c}) : w;`, c => `x = p ? () => (${c}) : w;`],
    ...[
      c => `x = p ? (a1: T) => (${c}) : w;`,
      c => `x = p ? w : q2 ? (${c}) : w3;`,
      c => `f(p ? (${c}) : w, (s) => s);`,
    ],
    ...[c => `x = p ? (${c}) : (w) => w;`, c => `x = p ? (${c}) : (w): T => w;`],
    ...[c => `const v = p ? (y) => (t2 ? u2 : ${c}) : w;`, c => `x = p0 ? (p ? (${c}) : w) : w4;`],
    ...[c => `x = ${c};`, c => `switch (v) { case ${c}: break; }`, c => `x = q ? p ? ${c} : z : w;`],
    ...[
      c => `x = p ? [${c}] : z;`,
      c => `x = p ? f(${c}) : z;`,
      c => `x = p ? z : ${c};`,
      c => `x = { k: ${c}, l: 1 };`,
    ],
    ...[c => `x = p ? (w = ${c}) : z;`, c => `x = p ? (r) => ${c} : z;`],
  ];
  const before = ["(q) => ({ q })", "() => ({})", "(m, n1)", "(q) => (q = r)"];
  const heads = ["(d) => (e): T", "(d) => (g) => (e): T", "(d) => (e, h): string"];
  const bodies = [
    ..."f|u ? (v, w2) : (z) => m|u ? (v, w2) : (z) => (n) => m|u ? (k) => ({ k }) : (z) => m".split("|"),
    ..."u ? () => ({}) : (z) => m|u ? v : (z) => m|u ? (v, w2) : (z, n) => m|u ? (v, w2) : (z, n) => (o) => m".split(
      "|",
    ),
    ..."u ? (v, w2) : async (z) => m|(y2) => u ? (v, w2) : (z) => m|u ? v : t3 ? (v, w2) : (z) => m".split("|"),
    ..."u ? (v, w2) : (z) => (e2): U => m|u ? (k) => ({ k }) : (z) => (e2): U => m|[u ? (v, w2) : (z) => m]".split("|"),
    ..."u ? (v, w2) : m|u ? (v = 1) : (z) => m|{ return u ? (v, w2) : (z) => m; }".split("|"),
    ..."(z3 = u ? (v, w2) : (z) => m)|u ? (v, w2) : (z) => t4 ? (v3, w4) : (z5) => m".split("|"),
    ..."u ? (k) => ({ k }) : (z) => (e2): U => t4 ? (v3, w4) : (z5) => m|u ? (v, w2) : (z: D) => m".split("|"),
    ..."u ? (v, w2) : f(z)|u ? (k) => ({ k }) : (z) => (e2): Promise<T> => m|g(u ? (v, w2) : (z) => m)".split("|"),
    ..."u ? (k) => k : (z) => m|u ? [v] : (z) => m|u ? (k) => ({ c: g() }) : (z) => m".split("|"),
  ];
  for (const context of contexts) {
    for (const b of before) {
      for (const head of heads) {
        for (const body of bodies) sources.push(`${context(`cond ? ${b} : ${head} => ${body}`)}\n`);
      }
    }
  }
  // A conditional before the `:` of another one that can take that `:`, next to the rule's conditional.
  const others =
    "t ? (m, n) : (d) => f|t ? (k) => ({ k }) : (d) => f|(r) => t ? (m, n) : (d) => f|t ? (m, n) : f".split("|");
  const rules = "c ? (q) => ({ q }) : (d2) => (e): T => g|(y) => c ? (q) => ({ q }) : (d2) => (e): T => g".split("|");
  for (const other of others) {
    for (const rule of rules) {
      sources.push(`x = o ? ${other} : ${rule};\n`, `x = o ? ${rule} : ${other};\n`);
      sources.push(`x = o ? (y) => o2 ? ${other} : ${rule} : z;\n`, `x = o ? o2 ? ${rule} : z : ${other};\n`);
    }
  }
  return sources;
}

/** The operands of the matrix that the rule is about, and some that it leaves, with a comment in one place. */
function commentsMatrix() {
  const before = [
    ..."(q) => ({})|(q) => ({ c: q })|(q) => ({ q })|(q) => (q, r)|(q) => (q = r)|(q) => ({ q } = r)|() => ({})".split(
      "|",
    ),
    ..."(q) => (r) => ({ q, r })|async (q) => ({ q })|(a: T) => ({ a })|(q) => ({ c: f() })|(q) => [q]|(a, b)".split(
      "|",
    ),
  ];
  const after = [
    ..."(x) => (id): T => 1|(x) => (y) => (id): T => 1|(x) => (id, z): T => { return 1; }|(x) => x|(x) => (y) => 1".split(
      "|",
    ),
    ..."(x, z) => (id): T => 1|() => (y) => (id): T => 1|(x) => async (id): T => 1|{ m() {} }|a < b".split("|"),
  ];
  const places = [
    (b, a) => `cond ? /* c */ ${b} : ${a}`,
    (b, a) => `cond ? ${b} /* c */ : ${a}`,
    (b, a) => `cond ? ${b.replace(/\)$/, " /* c */)")} : ${a}`,
    (b, a) => `cond ? ${b.replace(" => ", " => /* c */ ")} : ${a}`,
    (b, a) => `cond ? ${b.replace(" => ", " /* c */ => ")} : ${a}`,
    (b, a) => `cond ? ${b} : /* c */ ${a}`,
    (b, a) => `cond ? ${b} : ${a.replace(" => ", " /* c */ => ")}`,
    (b, a) => `cond ? ${b} : ${a.replace(" => ", " => /* c */ ")}`,
    (b, a) => `cond ? ${b} : ${a.replace(/\): T/, " /* c */): T")}`,
    (b, a) => `cond ? ${b} : ${a.replace(/: T => /, ": T => /* c */ ")}`,
    (b, a) => `cond /* c */ ? ${b} : ${a}`,
    (b, a) => `cond\n  ? // prettier-ignore\n    ${b}\n  : ${a}`,
    (b, a) => `cond\n  ? ${b}\n  : // prettier-ignore\n    ${a}`,
    (b, a) => `cond ? ${b.replace(" => ", " => // prettier-ignore\n ")} : ${a}`,
    (b, a) => `cond ? ${b} : ${a.replace(" => ", " => // prettier-ignore\n ")}`,
    (b, a) => `cond ? /** @type {F} */ (${b}) : ${a}`,
    (b, a) => `cond ? ${b.replace(" => ", " => /** @type {F} */ (")}) : ${a}`,
    (b, a) => `cond ? ${b} : /** @type {F} */ (${a})`,
    (b, a) => `cond ? ${b} : ${a.replace(" => ", " => /** @type {F} */ (")})`,
    (b, a) => `cond ? ${b} // c\n : ${a}`,
    (b, a) => `cond ? // c\n ${b} : ${a}`,
  ];
  const sources = [];
  for (const place of places) {
    for (const b of before) {
      for (const a of after) sources.push(`x0 = ${place(b, a)};\n`, `x0 = p ? (${place(b, a)}) : z;\n`);
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
function format(texts, printWidth, bun = named.bun) {
  const directory = fs.mkdtempSync(join(tmpdir(), "arrow-parens-"));
  const config = "oxfmt" in named ? ".oxfmtrc.json" : ".prettierrc";
  // A parser for every file would read the configuration file with it too.
  const { parser, ...others } = options;
  const overrides = parser ? { overrides: [{ files: `*.${extension}`, options: { parser } }] } : {};
  fs.writeFileSync(join(directory, config), JSON.stringify({ ...others, printWidth, ...overrides }));
  const path = index => join(directory, `${index}.${extension}`);
  texts.forEach((text, index) => text != null && fs.writeFileSync(path(index), text));
  const run = spawnSync(resolve(bun), ["fmt", "--log-level=error", "."], {
    cwd: directory,
    encoding: "utf8",
    maxBuffer: 2 ** 30,
  });
  if (run.error) throw run.error;
  // Under each error: `    at 12.ts:1:31`
  const failed = new Set(Array.from(run.stderr.matchAll(/^\s+at (\d+)\.(?:tsx?|js)\b/gm), match => Number(match[1])));
  if (run.status !== 0 && failed.size === 0)
    throw new Error(`bun fmt ended with ${run.signal ?? run.status}:\n${run.stderr.slice(0, 2000)}`);
  const printed = texts.map((text, index) => {
    if (text == null) return false;
    return failed.has(index) ? null : fs.readFileSync(path(index), "utf8");
  });
  fs.rmSync(directory, { recursive: true, force: true });
  return printed;
}

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

/** The program that Node runs for `text`: what its type stripping leaves, as esbuild reads that. Null for an error. */
function byNode(text) {
  try {
    return esbuild.transformSync(module.stripTypeScriptTypes(text), { loader: "js", minify: true }).code;
  } catch {
    return null;
  }
}
const countsNode = esbuild != null && extension === "ts" && typeof module.stripTypeScriptTypes === "function";

// `(x) =>` as `x =>`.
const bared = source => source.replace(/\((\w+)\) =>/g, "$1 =>");
const generators = { values: valuesMatrix, sites: sitesMatrix, paths: pathsMatrix, families: familiesMatrix };
Object.assign(generators, { comments: commentsMatrix, jsx: jsxMatrix, matrix });
const generator = Object.keys(generators).find(kind => kind in named);
const generated =
  "file" in named ? JSON.parse(fs.readFileSync(named.file, "utf8")) : (generators[generator] ?? random_sources)();
// `x = ..;` as a cell of a table.
const inCell = source => {
  const value = /^(?:const \w+|\w+) = (.*);\n$/.exec(source)?.[1];
  return value == null || value.includes("`") ? source : `test.each\`\n  a\n  \${${value}}\n\`("x", () => {});\n`;
};
const made = generated
  .map(source => ("bare" in named ? bared(source) : source))
  .map("each" in named ? inCell : it => it);
readAll(made);
// Prettier reads the source with the `typescript` package, so a source is one that both readers read.
const isRead = source =>
  !read(source).startsWith("error: ") && !(named.reader && readWithTypeScript(source).startsWith("error: "));
const sources = made.filter(isRead);
const sourceSet = new Set(sources);

async function judge(printWidth) {
  const byPrettier = text =>
    prettier.format(text, { ...options, printWidth, filepath: `a.${extension}` }).catch(() => null);
  const ours = format(sources, printWidth);
  const byMain = named.main ? format(sources, printWidth, named.main) : [];
  // Where main prints the same text, a difference from Prettier is not from this rule.
  const isAsOnMain = index => byMain[index] != null && byMain[index] === ours[index];
  const theirs = await Promise.all(sources.map(byPrettier));
  readAll([...ours, ...theirs, ...byMain]);
  const again = format(ours, printWidth);
  const againByMain = named.main ? format(byMain, printWidth, named.main) : [];
  // Bun reads what Prettier prints, where tsc reads that as the source.
  const theirsAgain = format(
    theirs.map((text, index) => (text != null && read(text) === read(sources[index]) ? text : null)),
    printWidth,
  );

  const counts = { sources: sources.length, broken: 0, pairs: 0, silenced: 0, repaired: 0, kept: 0 };
  Object.assign(counts, { pairsBeforeBrokenList: 0, asOnMain: { broken: 0, pairs: 0 } });
  Object.assign(counts, { left: { all: 0, anew: 0, refusedAgain: 0, changedAgain: 0, againNotAsOnMain: 0 } });
  counts.left.anewChangedAgain = 0;
  if (named.main) Object.assign(counts, { againstMain: { broken: 0, silenced: 0, repaired: 0 }, refusedOnMainToo: 0 });
  Object.assign(counts, { unstable: 0, refusedAnew: 0, leftToEsbuild: 0 });
  const node = { broken: 0, ours: { source: 0, other: 0, error: 0 }, theirs: { source: 0, other: 0, error: 0 } };
  const shown = { broken: [], pairs: [], silenced: [], leftAnew: [], againNotAsOnMain: [], left: [], unstable: [] };
  Object.assign(shown, { pairsBeforeBrokenList: [], brokenAsOnMain: [], anewChangedAgain: [] });
  Object.assign(shown, { brokenAgainstMain: [], silencedAgainstMain: [] });
  Object.assign(shown, { refusedAnew: [], leftToEsbuild: [], brokenForNode: [] });
  const refused = new Set();
  const changed = [];
  sources.forEach((source, index) => {
    if (ours[index] == null) {
      // The flavor of oxfmt reports the errors of oxc for some sources that tsc reads, on main too.
      if (named.main && byMain[index] == null) counts.refusedOnMainToo++;
      else refused.add(source);
      return;
    }
    const tree = read(source);
    const isRight = read(ours[index]) === tree;
    const isRightByPrettier = theirs[index] != null && read(theirs[index]) === tree;
    const both = `${oneLine(source)}\n    ${oneLine(ours[index])}`;
    if (typeof byMain[index] === "string" && byMain[index] !== ours[index]) {
      const byTscOnMain = read(byMain[index]);
      const isSilent = !isRight && !read(ours[index]).startsWith("error: ");
      if (isRight) counts.againstMain.repaired += byTscOnMain === tree ? 0 : 1;
      else if (byTscOnMain === tree) {
        counts.againstMain.broken++;
        shown.brokenAgainstMain.push(`${both}\n    ${oneLine(byMain[index])}`);
      } else if (isSilent && byTscOnMain.startsWith("error: ")) {
        counts.againstMain.silenced++;
        shown.silencedAgainstMain.push(`${both}\n    ${oneLine(byMain[index])}`);
      }
    }
    if (!isRight && isRightByPrettier) {
      if (!isAsOnMain(index)) {
        counts.broken++;
        shown.broken.push(`${both}\n    ${read(ours[index]).slice(0, 80)}`);
      } else {
        counts.asOnMain.broken++;
        shown.brokenAsOnMain.push(both);
      }
    } else if (!isRight) {
      counts.left.all++;
      shown.left.push(both);
      if (again[index] == null) counts.left.refusedAgain++;
      else if (again[index] !== ours[index]) counts.left.changedAgain++;
      if (isAsOnMain(index)) {
        if (again[index] !== againByMain[index]) {
          counts.left.againNotAsOnMain++;
          shown.againNotAsOnMain.push(`${both}\n    ${oneLine(again[index] ?? "an error")}`);
        }
      } else if (named.main) {
        counts.left.anew++;
        shown.leftAnew.push(both);
        if (again[index] != null && again[index] !== ours[index]) {
          counts.left.anewChangedAgain++;
          shown.anewChangedAgain.push(`${both}\n    ${oneLine(byMain[index] ?? "an error")}`);
        }
      }
      // Where main prints another text than Prettier, the parentheses are not the only difference.
      const isOnlyTheRule = !isAsOnMain(index) && (!named.main || byMain[index] === theirs[index]);
      const isSilent = !read(ours[index]).startsWith("error: ");
      if (isSilent && theirs[index] != null && read(theirs[index]).startsWith("error: ") && isOnlyTheRule) {
        counts.silenced++;
        shown.silenced.push(both);
      }
    } else if (!isRightByPrettier) counts.repaired++;
    else if (ours[index] !== theirs[index]) {
      const kind = isAsOnMain(index) ? null : /,\n\s*\): /.test(theirs[index]) ? "pairsBeforeBrokenList" : "pairs";
      if (kind == null) counts.asOnMain.pairs++;
      else {
        counts[kind]++;
        shown[kind].push(`${oneLine(theirs[index])}\n    ${oneLine(ours[index])}`);
      }
    }
    if (theirs[index] != null && ours[index] !== theirs[index] && !isAsOnMain(index)) counts.kept++;
    if (again[index] == null) {
      if (isRight) refused.add(ours[index]);
      if (named.main && againByMain[index] !== null) {
        counts.refusedAnew++;
        shown.refusedAnew.push(both);
      }
    } else if (isRight && again[index] !== ours[index] && !isAsOnMain(index)) changed.push(index);
    if (theirsAgain[index] === null) refused.add(theirs[index]);
    if (esbuild && refusedByEsbuild(ours[index]) && !refusedByEsbuild(source)) {
      counts.leftToEsbuild++;
      shown.leftToEsbuild.push(both);
    }
    if (countsNode && theirs[index] != null && ours[index] !== theirs[index] && !isAsOnMain(index)) {
      const program = byNode(source);
      if (program == null) return;
      const kind = text => {
        const read = byNode(text);
        return read == null ? "error" : read === program ? "source" : "other";
      };
      const [byUs, byThem] = [kind(ours[index]), kind(theirs[index])];
      node.ours[byUs]++;
      node.theirs[byThem]++;
      if (byThem === "source" && byUs !== "source") {
        node.broken++;
        shown.brokenForNode.push(both);
      }
    }
  });
  // Prettier changes some of its own texts on a second run, and so does Bun then: `<T>(((a: T) => ({})))`.
  await Promise.all(
    changed.map(async index => {
      if (ours[index] === theirs[index] && (await byPrettier(theirs[index])) !== theirs[index]) return;
      counts.unstable++;
      shown.unstable.push(`${oneLine(ours[index])}\n    ${oneLine(again[index])}`);
    }),
  );
  shown.refused = Array.from(refused, oneLine);
  for (const [kind, texts] of Object.entries(shown))
    for (const text of texts.slice(0, Number(named.show ?? 5))) console.log(`${kind}: ${text}`);
  const result = { width: printWidth, ...counts, refused: refused.size, ...(countsNode ? { node } : {}) };
  console.log(JSON.stringify(result));
  // The next width has other texts.
  for (const text of [...ours, ...theirs, ...again, ...byMain]) if (!sourceSet.has(text)) readings.delete(text);
  return result;
}

for (const printWidth of widths) {
  const counts = await judge(printWidth);
  const { broken, pairs, silenced, left, unstable, refused, refusedAnew, node, againstMain } = counts;
  // The parser of `bun fmt` reports the syntax errors of tsc, which another reader may not report. In a `.js` file it
  // reads no return type before the `:` of a conditional, on main too.
  const isRefused = refusedAnew > 0 || (refused > 0 && !named.reader && !("babel-ts" in named));
  // Bun prints a cell of a table on one line, and Prettier does not: there, `pairs` has that difference in it too.
  const isPair = pairs > 0 && !("each" in named);
  // In a `.js` file, main reads `async<U>(q)` as `async < U > q`: tsc reads another program from its text already.
  const isSilenced = againstMain?.silenced > 0 && !("babel-ts" in named);
  const isWorseThanMain = againstMain?.broken > 0 || isSilenced;
  if (broken || isPair || silenced || left.againNotAsOnMain || unstable || isRefused || node?.broken || isWorseThanMain)
    process.exitCode = 1;
}
