// Compares the token and comment methods of `bun_lint::ast::File` with those of ESLint's `SourceCode`: for each source
// text, every method is called with nodes, tokens and comments of it, and with pairs of them.
//
//   bun api.ts --bin <bun-lint> --eslint <checkout> --typescript-eslint <checkout> --scratch <dir>
//              [--fixtures <conformance/fixtures>].. [--files <dir>].. [--strings-of <file.js>].. [--listed edge-cases.txt] [--jobs N] [--examples N]
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Case, casesFromArguments, loadParsers, option, parse } from "./corpus";

const args = process.argv.slice(2);
const scratch = option(args, "--scratch") ?? ".";
const shard = option(args, "--shard");
const jobs = Number(option(args, "--jobs") ?? 16);

type Target = { type: string; range: [number, number] };
type Query = [method: string, a0: number, a1: number, b0: number, b1: number, includeComments: number];
type Difference = { kind: string; id: string; context: string };
type Result = { cases: number; queries: number; wrong: number; differences: Difference[] };

function nodesOf(ast: any): Target[] {
  const nodes: Target[] = [];
  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    if (typeof node.type !== "string" || !node.range) return;
    nodes.push(node);
    for (const key in node) if (key !== "parent" && key !== "tokens" && key !== "comments") visit(node[key]);
  };
  visit(ast);
  return nodes;
}

/** Deterministic, so that a difference can be looked at again. */
function random(seed: number) {
  return (below: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return Math.floor((seed / 2 ** 32) * below);
  };
}

const ranges = (tokens: (Target | null)[]) => tokens.flatMap(t => (t ? t.range : []));

/** The queries about a text, and what ESLint answers. */
function ask(sourceCode: any, ast: any, seed: number): { queries: Query[]; expected: number[][]; about: string[] } {
  const next = random(seed);
  // The range of a `Program` is not that of its tokens. Here the whole file is `file.tokens()`.
  const all: Target[] = [...nodesOf(ast).filter(it => it.type !== "Program"), ...ast.tokens, ...ast.comments];
  const sample = (count: number) => (all.length <= count ? all : Array.from({ length: count }, () => all[next(all.length)]));
  const queries: Query[] = [];
  const expected: number[][] = [];
  const about: string[] = [];
  const add = (method: string, a: Target, b: Target | [number, number], includeComments: boolean, ask: () => number[]) => {
    const answer = ask();
    const [b0, b1] = Array.isArray(b) ? b : b.range;
    queries.push([method, a.range[0], a.range[1], b0, b1, Number(includeComments)]);
    expected.push(answer);
    about.push(`${method}(${a.type}${Array.isArray(b) ? "" : ", " + b.type}${includeComments ? ", includeComments" : ""})`);
  };
  for (const x of sample(40)) {
    for (const includeComments of [false, true]) {
      const o = { includeComments };
      add("in", x, [0, 0], includeComments, () => ranges(sourceCode.getTokens(x, o)));
      add("before", x, [0, 0], includeComments, () => ranges(sourceCode.getTokensBefore(x, { ...o, count: 4 }).reverse()));
      add("after", x, [0, 0], includeComments, () => ranges(sourceCode.getTokensAfter(x, { ...o, count: 4 })));
      add("first", x, [0, 0], includeComments, () => ranges([sourceCode.getFirstToken(x, o)]));
      add("last", x, [0, 0], includeComments, () => ranges([sourceCode.getLastToken(x, o)]));
      add("secondLast", x, [0, 0], includeComments, () => ranges([sourceCode.getLastToken(x, { ...o, skip: 1 })]));
      add("tokenBefore", x, [0, 0], includeComments, () => ranges([sourceCode.getTokenBefore(x, o)]));
      add("tokenAfter", x, [0, 0], includeComments, () => ranges([sourceCode.getTokenAfter(x, o)]));
      add("secondBefore", x, [0, 0], includeComments, () => ranges([sourceCode.getTokenBefore(x, { ...o, skip: 1 })]));
      add("at", x, [0, 0], includeComments, () => ranges([sourceCode.getTokenByRangeStart(x.range[0], o)]));
    }
    const padding: [number, number] = [next(3), next(3)];
    add("padded", x, padding, false, () => ranges(sourceCode.getTokens(x, ...padding)));
    add("commentsBefore", x, [0, 0], false, () => ranges(sourceCode.getCommentsBefore(x)));
    add("commentsAfter", x, [0, 0], false, () => ranges(sourceCode.getCommentsAfter(x)));
    add("commentsIn", x, [0, 0], false, () => ranges(sourceCode.getCommentsInside(x)));
  }
  const first = sample(40);
  for (const x of first) {
    const y = all[next(all.length)];
    // For a node without tokens, the `JSXEmptyExpression` of `{}`, `isSpaceBetween` runs past it, and throws or answers at random.
    if (x.type !== "JSXEmptyExpression" && y.type !== "JSXEmptyExpression") add("space", x, y, false, () => [Number(sourceCode.isSpaceBetween(x, y))]);
    const [a, b] = x.range[1] <= y.range[0] ? [x, y] : [y, x];
    if (a.range[1] > b.range[0]) continue;
    for (const includeComments of [false, true]) {
      const o = { includeComments };
      add("between", a, b, includeComments, () => ranges(sourceCode.getTokensBetween(a, b, o)));
      add("betweenBackwards", a, b, includeComments, () => ranges(sourceCode.getLastTokensBetween(a, b, o).reverse()));
    }
    add("paddedBetween", a, b, false, () => ranges(sourceCode.getTokensBetween(a, b, 1)));
    add("commentsExist", a, b, false, () => [Number(sourceCode.commentsExistBetween(a, b))]);
  }
  // Not a method of ESLint.
  for (let i = 0; i < 20; i++) {
    const offset = next(sourceCode.text.length + 1);
    const point: Target = { type: "offset", range: [offset, offset] };
    const around = (list: Target[]) => list.filter(it => it.range[0] <= offset && offset < it.range[1]);
    add("around", point, [0, 0], false, () => ranges(around(ast.tokens)));
    add("around", point, [0, 0], true, () => ranges(around([...ast.tokens, ...ast.comments])));
  }
  // Neighbours, which is what rules ask about.
  const inOrder = [...ast.tokens, ...ast.comments].sort((a, b) => a.range[0] - b.range[0]);
  for (let i = 0; i + 1 < inOrder.length && i < 60; i++) {
    add("space", inOrder[i], inOrder[i + 1], false, () => [Number(sourceCode.isSpaceBetween(inOrder[i], inOrder[i + 1]))]);
    add("space", inOrder[i + 1], inOrder[i], false, () => [Number(sourceCode.isSpaceBetween(inOrder[i + 1], inOrder[i]))]);
  }
  return { queries, expected, about };
}

function run(cases: Case[], name: string): Result {
  const parsers = loadParsers(args);
  const { SourceCode } = require(join(option(args, "--eslint") ?? process.env.ESLINT_DIR!, "lib/languages/js/source-code"));
  const result: Result = { cases: 0, queries: 0, wrong: 0, differences: [] };
  const asked: { it: Case; expected: number[][]; queries: Query[]; about: string[] }[] = [];
  cases.forEach((it, seed) => {
    let ast;
    try {
      ast = parse(parsers, it);
    } catch {
      return;
    }
    asked.push({ it, ...ask(new SourceCode({ text: it.code, ast }), ast, seed) });
  });
  const input = join(scratch, `queries-${name}.jsonl`);
  writeFileSync(input, asked.map(({ it, queries }) => JSON.stringify({ path: it.path, code: it.code, ecmaVersion: it.ecmaVersion, sourceType: it.sourceType, queries }) + "\n").join(""));
  const ran = spawnSync(option(args, "--bin")!, ["tokens", "query", input], { maxBuffer: 1 << 30, encoding: "utf8" });
  const lines = ran.stdout.split("\n").filter(Boolean);
  if (lines.length !== asked.length) throw new Error(`bun-lint stopped (${ran.signal ?? ran.status}) at ${asked[lines.length]?.it.id}\n${ran.stderr.slice(-2000)}`);
  asked.forEach(({ it, expected, queries, about }, i) => {
    const actual: number[][] = JSON.parse(lines[i]);
    result.cases++;
    result.queries += queries.length;
    expected.forEach((answer, q) => {
      if (answer.join() === actual[q].join()) return;
      result.wrong++;
      result.differences.push({
        kind: about[q],
        id: it.id,
        context: `${JSON.stringify(queries[q])} expected [${answer}] got [${actual[q]}] in ${JSON.stringify(it.code.slice(0, 200))}`,
      });
    });
  });
  return result;
}

// Positions are compared as they are: bytes here, UTF-16 code units there.
const all = casesFromArguments(args).filter(it => /^[\0-\x7F]*$/.test(it.code) && it.code.length < 20_000);
if (shard !== undefined) {
  writeFileSync(join(scratch, `api-${shard}.json`), JSON.stringify(run(all.filter((_, i) => i % jobs === Number(shard)), shard)));
  process.exit(0);
}

mkdirSync(scratch, { recursive: true });
const children = Array.from({ length: jobs }, (_, i) =>
  Bun.spawn([process.execPath, import.meta.path, ...args, "--shard", String(i)], { stdout: "inherit", stderr: "inherit" }),
);
if ((await Promise.all(children.map(child => child.exited))).some(code => code !== 0)) process.exit(1);
const total: Result = { cases: 0, queries: 0, wrong: 0, differences: [] };
for (let i = 0; i < jobs; i++) {
  const part: Result = JSON.parse(readFileSync(join(scratch, `api-${i}.json`), "utf8"));
  for (const key of ["cases", "queries", "wrong"] as const) total[key] += part[key];
  total.differences.push(...part.differences);
}
const examples = Number(option(args, "--examples") ?? 3);
for (const [kind, list] of [...Map.groupBy(total.differences, it => it.kind)].sort((a, b) => a[1].length - b[1].length)) {
  console.log(`${list.length} × ${kind}`);
  for (const it of list.slice(0, examples)) console.log(`    ${it.id}\n      ${it.context}`);
}
console.log(`${total.cases} texts, ${total.queries} queries, ${total.wrong} answers differ`);
