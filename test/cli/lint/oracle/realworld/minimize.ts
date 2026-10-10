// Makes small test cases out of the differences that `run.ts` has found.
//
//   ESLINT_DIR=.. TYPESCRIPT_ESLINT_DIR=.. BUN_LINT=<bun-lint> node minimize.ts --out <dir> --cases <dir> --scratch <dir>
//       [--jobs 12] [rule id...]
//
// For each difference, the statements and class members around it, from the inside out, are linted on their own, by both linters,
// with only the rule in question (`../../conformance/extra-cases.ts`). The smallest on which they still differ is a test case.
// `<cases>/<plugin>/<rule>.json` gets up to 20 of them per rule, as input for `extra-cases.ts`. A file that only `bun lint`
// cannot parse becomes a case of `no-debugger`.
//
// Most differences of rules that need types do not survive: what the code imports is not there.
// Confidential corpora have left no examples, and this refuses to look at one.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve } from "node:path";
import { PARSE_ERROR } from "./plans.ts";
import type { PassResult } from "./run.ts";
import type { Example } from "./worker.ts";

const CASES_PER_RULE = 20;
const EXAMPLES_PER_RULE = 40;
const MAX_LINES = 25;
const MAX_CHARACTERS = 2000;

let out = "";
let casesDir = "";
let scratch = "";
let jobs = 12;
const onlyRules: string[] = [];
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") out = resolve(argv[++i]);
    else if (argv[i] === "--cases") casesDir = resolve(argv[++i]);
    else if (argv[i] === "--scratch") scratch = resolve(argv[++i]);
    else if (argv[i] === "--jobs") jobs = Number(argv[++i]);
    else onlyRules.push(argv[i]);
  }
  if (!out || !casesDir || !scratch) throw new Error("usage: see the head of minimize.ts");
}

const pluginDir = join(resolve(process.env.TYPESCRIPT_ESLINT_DIR!), "packages/eslint-plugin");
const require = createRequire(join(pluginDir, "package.json"));
const typescriptParser = require("@typescript-eslint/parser");
const espree = createRequire(join(resolve(process.env.ESLINT_DIR!), "package.json"))("espree");

interface Node {
  type: string;
  range: [number, number];
  [key: string]: unknown;
}

const trees = new Map<string, { code: string; ast: Node | null }>();

function parse(path: string, asTypescript: boolean): { code: string; ast: Node | null } {
  const key = `${asTypescript} ${path}`;
  if (trees.has(key)) return trees.get(key)!;
  const code = readFileSync(path, "utf8");
  let ast: Node | null = null;
  try {
    ast = asTypescript
      ? typescriptParser.parseForESLint(code, { filePath: path, range: true, loc: true }).ast
      : espree.parse(code, {
          ecmaVersion: "latest",
          sourceType: path.endsWith(".cjs") ? "commonjs" : "module",
          range: true,
          comment: true,
          ecmaFeatures: { jsx: path.endsWith(".jsx") },
        });
  } catch {}
  if (trees.size > 200) trees.clear();
  trees.set(key, { code, ast });
  return { code, ast };
}

function offsetOf(code: string, line: number, column: number): number {
  let offset = 0;
  for (let i = 1; i < line; i++) {
    const next = /\r\n|[\r\n\u2028\u2029]/.exec(code.slice(offset, offset + 100_000));
    if (!next) break;
    offset += next.index + next[0].length;
  }
  return offset + column - 1;
}

/** The nodes around `offset`, from the outside in. */
function chainAt(ast: Node, offset: number): Node[] {
  const chain: Node[] = [];
  let current: Node | undefined = ast;
  while (current) {
    chain.push(current);
    let next: Node | undefined;
    for (const [key, value] of Object.entries(current)) {
      if (key === "parent" || key === "tokens" || key === "comments" || key === "loc" || key === "range") continue;
      for (const child of Array.isArray(value) ? value : [value]) {
        if (!child || typeof child !== "object" || typeof (child as Node).type !== "string") continue;
        const [start, end] = (child as Node).range ?? [0, -1];
        if (start <= offset && offset <= end && (!next || end - start < next.range[1] - next.range[0])) next = child as Node;
      }
    }
    current = next;
  }
  return chain;
}

const MEMBERS = /^(?:MethodDefinition|PropertyDefinition|AccessorProperty|StaticBlock|TSAbstract\w+|TSIndexSignature)$/;
const STATEMENTS = /(?:Statement|Declaration)$/;

/** Pieces of the code around the place that can stand alone, the smallest first. */
function candidates(code: string, ast: Node, offset: number): string[] {
  const found: string[] = [];
  const chain = chainAt(ast, offset);
  const comments = (ast.comments ?? []) as Node[];
  for (let i = chain.length - 1; i > 0; i--) {
    const node = chain[i];
    const isMember = MEMBERS.test(node.type) && chain[i - 1].type === "ClassBody";
    if (!isMember && !STATEMENTS.test(node.type)) continue;
    const piece = (from: number) => {
      // From the start of the line, so that what depends on the indentation stays as it is, if only white space is in between.
      const lineStart = Math.max(code.lastIndexOf("\n", from - 1) + 1, 0);
      const text = code.slice(/^[ \t]*$/.test(code.slice(lineStart, from)) ? lineStart : from, node.range[1]);
      if (text.length > MAX_CHARACTERS || text.split("\n").length > MAX_LINES) return false;
      found.push(isMember ? `class A {\n${text}\n}` : text);
      return true;
    };
    if (!piece(node.range[0])) break;
    // Once more with the comments in front of it: JSDoc, directives.
    let start = node.range[0];
    for (let j = comments.length - 1; j >= 0; j--) {
      if (comments[j].range[1] <= start && /^\s*$/.test(code.slice(comments[j].range[1], start))) start = comments[j].range[0];
    }
    if (start < node.range[0]) piece(start);
  }
  if (code.length <= MAX_CHARACTERS && code.split("\n").length <= MAX_LINES) found.push(code);
  return found;
}

// ---------------------------------------------------------------------------
// Collect
// ---------------------------------------------------------------------------

interface Candidate {
  example: number;
  case: Record<string, unknown>;
}

const byRule = new Map<string, { examples: number; candidates: Candidate[] }>();
const configs = new Map<string, Record<string, unknown[]>>();

function rulesOf(plan: string): Record<string, unknown[]> {
  if (!configs.has(plan)) {
    const text = readFileSync(join(out, "configs", `${plan}.mjs`), "utf8");
    const json = text.slice(text.indexOf("export default ") + 15, text.lastIndexOf(";"));
    const objects = JSON.parse(json.replace(/: (plugin|parser)\b/g, ': "$1"'));
    configs.set(plan, Object.assign({}, ...objects.map((it: { rules?: object }) => it.rules ?? {})));
  }
  return configs.get(plan)!;
}

function add(pass: PassResult, example: Example) {
  if (pass.confidential || pass.root === null) throw new Error("an example of a confidential corpus");
  const isParseError = example.rule === PARSE_ERROR;
  if (example.rule.startsWith("(") && !(isParseError && example.kind === "onlyOurs")) return;
  const rule = isParseError ? "no-debugger" : example.rule;
  if (onlyRules.length > 0 && !onlyRules.includes(rule)) return;
  const id = rule.startsWith("@typescript-eslint/") ? rule.slice(1) : `eslint/${rule}`;
  if (!byRule.has(id)) byRule.set(id, { examples: 0, candidates: [] });
  const entry = byRule.get(id)!;
  if (entry.examples >= EXAMPLES_PER_RULE) return;

  const extension = extname(example.file);
  const asTypescript = extension.includes("ts") || pass.plan.endsWith("-js-as-ts");
  const { code, ast } = parse(join(pass.root, example.file), asTypescript);
  if (!ast) return;
  const at = example.eslint ?? example.ours!;
  const number = entry.examples++;
  const pieces = candidates(code, ast, offsetOf(code, at.line ?? 1, at.column ?? 1));
  if (isParseError) {
    // What the parser stumbles over can be a comment, which is in no statement.
    const lines = code.split("\n");
    for (const around of [0, 1, 3, 6]) {
      pieces.push(lines.slice(Math.max(0, (at.line ?? 1) - 1 - around), (at.line ?? 1) + around).join("\n"));
    }
  }
  for (const text of pieces) {
    const made: Record<string, unknown> = {
      name: `${isParseError ? "parser: " : ""}${pass.corpus}/${example.file}:${at.line}`,
      code: text,
      filename: pass.plan.startsWith("typed") ? undefined : `file${extension}`,
    };
    const options = isParseError ? [] : (rulesOf(pass.plan)[example.rule] ?? []).slice(1);
    if (options.length > 0) made.options = options;
    if (asTypescript && !extension.includes("ts")) made.languageOptions = { parser: "typescript" };
    if (pass.plan.startsWith("typed") && extension === ".tsx") {
      made.languageOptions = { parserOptions: { ecmaFeatures: { jsx: true } } };
    }
    entry.candidates.push({ example: number, case: made });
  }
}

for (const plan of readdirSync(join(out, "results")).sort()) {
  for (const file of readdirSync(join(out, "results", plan)).sort()) {
    const pass: PassResult = JSON.parse(readFileSync(join(out, "results", plan, file), "utf8"));
    if (pass.confidential) continue;
    for (const example of pass.examples) add(pass, example);
  }
}

// ---------------------------------------------------------------------------
// Judge
// ---------------------------------------------------------------------------

const extraCases = join(import.meta.dirname, "../../conformance/extra-cases.ts");

function judge(id: string, cases: unknown[]): Promise<number[]> {
  const directory = join(scratch, id);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "cases.json"), JSON.stringify(cases));
  const args = ["--disable-warning=ExperimentalWarning", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", extraCases];
  args.push("--out", join(directory, "out"), "--judge", resolve(process.env.BUN_LINT!), "--quiet");
  args.push("--verdicts", join(directory, "verdicts.json"), id, join(directory, "cases.json"));
  return new Promise(done => {
    spawn(process.execPath, args, { stdio: "ignore" }).on("exit", () => {
      const file = join(directory, "verdicts.json");
      done(existsSync(file) ? (JSON.parse(readFileSync(file, "utf8"))[id] ?? []) : []);
    });
  });
}

const KEYWORDS = new Set(
  (
    "abstract any as asserts async await boolean break case catch class const constructor continue declare default delete do else " +
    "enum export extends false finally for from function get if implements import in infer instanceof interface is keyof let " +
    "namespace module never new null number object of private protected public readonly return satisfies set static string super " +
    "switch symbol this throw true try type typeof undefined unique unknown var void while with yield"
  ).split(" "),
);

/** The code without what is particular to it: names, numbers, the text of strings, white space. */
function shapeOf(code: string): string {
  return code
    .replace(/(["'`])(?:\\.|(?!\1).)*\1/gs, "$1$1")
    .replace(/[\p{ID_Start}$_][\p{ID_Continue}$]*/gu, word => (KEYWORDS.has(word) ? word : "x"))
    .replace(/\d[\w.]*/g, "0")
    .replace(/\s+/g, " ")
    .trim();
}

const queue = [...byRule];
let kept = 0;
const lines: string[] = [];
await Promise.all(
  Array.from({ length: jobs }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [id, { examples, candidates }] = next;
      const differing = new Set(await judge(id, candidates.map(it => it.case)));
      // The candidates of an example are in order of size.
      const smallest = new Map<number, Record<string, unknown>>();
      candidates.forEach((it, index) => {
        if (differing.has(index) && !smallest.has(it.example)) smallest.set(it.example, it.case);
      });
      // Two of a shape are enough: `let fs;` and `let net;` say the same.
      const seen = new Map<string, number>();
      const cases = [...smallest.values()]
        .filter(it => {
          const key = JSON.stringify([shapeOf(String(it.code)), it.options, it.filename]);
          seen.set(key, (seen.get(key) ?? 0) + 1);
          return seen.get(key)! <= 2;
        })
        .sort((a, b) => String(a.code).length - String(b.code).length)
        .slice(0, CASES_PER_RULE);
      lines.push(`${id}: ${examples} differences looked at, ${smallest.size} reproduce in a piece, ${cases.length} kept`);
      const file = join(casesDir, `${id}.json`);
      rmSync(file, { force: true });
      if (cases.length === 0) continue;
      kept += cases.length;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(cases, null, 1) + "\n");
    }
  }),
);
console.log(lines.sort().join("\n"));
console.log(`${byRule.size} rules, ${kept} cases`);
