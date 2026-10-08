// Compares the tokens and comments of `bun-lint tokens batch` with those of the parser that ESLint uses: espree for
// JavaScript, typescript-estree for TypeScript.
//
//   bun tokens.ts --bin <bun-lint> --eslint <checkout> --typescript-eslint <checkout> --scratch <dir>
//                 [--fixtures <conformance/fixtures>].. [--files <dir>].. [--strings-of <file.js>].. [--listed edge-cases.txt] [--jobs N] [--examples N] [--rejected] [--compare-rejected] [--parsers]
//
// `--rejected` lists the cases that only `bun lint` rejects, `--compare-rejected` compares them nevertheless. `--parsers` compares typescript-estree with espree on the JavaScript cases instead: how the two differ.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Case, casesFromArguments, loadParsers, option, parse } from "./corpus";

const TYPES = [
  "Boolean", "Identifier", "JSXIdentifier", "JSXText", "Keyword", "Null", "Numeric", "PrivateIdentifier", "Punctuator",
  "RegularExpression", "String", "Template", "Line", "Block", "Shebang",
]; // prettier-ignore

const args = process.argv.slice(2);
const scratch = option(args, "--scratch") ?? ".";
const shard = option(args, "--shard");
const jobs = Number(option(args, "--jobs") ?? 16);
const comparesParsers = args.includes("--parsers");

type Difference = { kind: string; id: string; context: string };
type Result = { cases: number; rejectedByOracle: number; rejectedByBun: number; wrong: number; tokens: number; differences: Difference[]; rejected: string[] };

const flat = (tokens: any[]) => tokens.flatMap(t => [TYPES.indexOf(t.type), t.range[0], t.range[1]]);

/** The first place where the lists differ. */
function compare(it: Case, what: string, expected: number[], actual: number[]): Difference | undefined {
  for (let i = 0; i < Math.max(expected.length, actual.length); i += 3) {
    const [et, es, ee] = expected.slice(i, i + 3);
    const [at, as, ae] = actual.slice(i, i + 3);
    if (et === at && es === as && ee === ae) continue;
    const text = (s?: number, e?: number) => (s === undefined ? "nothing" : JSON.stringify(it.code.slice(s, Math.min(e!, s + 30))));
    const kind =
      es === as && ee === ae
        ? `${what}: ${TYPES[et]} expected, got ${TYPES[at]}: ${/^(Keyword|Identifier|JSXIdentifier|Boolean|Null)$/.test(TYPES[et]) ? text(es, ee) : ""}`
        : `${what}: ${TYPES[et]} ${es === undefined || ee! - es > 4 ? "" : text(es, ee)} expected, got ${TYPES[at]} ${as === undefined || ae! - as > 4 ? "" : text(as, ae)}`;
    const from = Math.max(0, Math.min(es ?? as, as ?? es) - 40);
    return { kind, id: it.id, context: JSON.stringify(it.code.slice(from, from + 90)) + ` expected ${text(es, ee)}@${es} got ${text(as, ae)}@${as}` };
  }
}

function run(cases: Case[], name: string): Result {
  const parsers = loadParsers(args);
  const result: Result = { cases: 0, rejectedByOracle: 0, rejectedByBun: 0, wrong: 0, tokens: 0, differences: [], rejected: [] };
  const accepted: { it: Case; tokens: number[]; comments: number[] }[] = [];
  for (const it of cases) {
    try {
      const ast = parse(parsers, it);
      accepted.push({ it, tokens: flat(ast.tokens), comments: flat(ast.comments) });
    } catch {
      result.rejectedByOracle++;
    }
  }
  let actual: { errors: boolean; tokens: number[]; comments: number[] }[];
  if (comparesParsers) {
    actual = accepted.map(({ it }) => {
      try {
        const ast = parse(parsers, it, "typescript");
        return { errors: false, tokens: flat(ast.tokens), comments: flat(ast.comments) };
      } catch {
        return { errors: true, tokens: [], comments: [] };
      }
    });
  } else {
    const input = join(scratch, `cases-${name}.jsonl`);
    writeFileSync(input, accepted.map(({ it }) => JSON.stringify({ path: it.path, code: it.code, ecmaVersion: it.ecmaVersion, sourceType: it.sourceType }) + "\n").join(""));
    const ran = spawnSync(option(args, "--bin")!, ["tokens", "batch", input], { maxBuffer: 1 << 30, encoding: "utf8" });
    const lines = ran.stdout.split("\n").filter(Boolean);
    if (lines.length !== accepted.length) {
      const it = accepted[lines.length]?.it;
      throw new Error(`bun-lint stopped (${ran.signal ?? ran.status}) at ${it?.id}: ${JSON.stringify(it?.code.slice(0, 300))}\n${ran.stderr.slice(-2000)}`);
    }
    actual = lines.map(line => JSON.parse(line));
  }
  accepted.forEach(({ it, tokens, comments }, i) => {
    if (actual[i].errors) {
      result.rejected.push(`${it.id} ${it.sourceType} ${it.ecmaVersion} ${JSON.stringify(it.code.slice(0, 150))}`);
      result.rejectedByBun++;
      if (!args.includes("--compare-rejected")) return;
    }
    result.cases++;
    result.tokens += tokens.length / 3;
    const difference = compare(it, "token", tokens, actual[i].tokens) ?? compare(it, "comment", comments, actual[i].comments);
    if (difference) {
      result.wrong++;
      result.differences.push(difference);
    }
  });
  return result;
}

let all = casesFromArguments(args);
if (comparesParsers) all = all.filter(it => it.parser === "espree");
if (shard !== undefined) {
  const mine = all.filter((_, i) => i % jobs === Number(shard));
  writeFileSync(join(scratch, `result-${shard}.json`), JSON.stringify(run(mine, shard)));
  process.exit(0);
}

mkdirSync(scratch, { recursive: true });
const children = Array.from({ length: jobs }, (_, i) =>
  Bun.spawn([process.execPath, import.meta.path, ...args, "--shard", String(i)], { stdout: "inherit", stderr: "inherit" }),
);
const codes = await Promise.all(children.map(child => child.exited));
if (codes.some(code => code !== 0)) process.exit(1);
const total: Result = { cases: 0, rejectedByOracle: 0, rejectedByBun: 0, wrong: 0, tokens: 0, differences: [], rejected: [] };
for (let i = 0; i < jobs; i++) {
  const part: Result = JSON.parse(readFileSync(join(scratch, `result-${i}.json`), "utf8"));
  for (const key of ["cases", "rejectedByOracle", "rejectedByBun", "wrong", "tokens"] as const) total[key] += part[key];
  total.differences.push(...part.differences);
  total.rejected.push(...part.rejected);
}
if (args.includes("--rejected")) console.log(total.rejected.sort().join("\n"));
const ranked = Map.groupBy(total.differences, it => it.kind);
const examples = Number(option(args, "--examples") ?? 3);
for (const [kind, list] of [...ranked].sort((a, b) => a[1].length - b[1].length)) {
  console.log(`${list.length} × ${kind}`);
  for (const it of list.slice(0, examples)) console.log(`    ${it.id}\n      ${it.context}`);
}
console.log(
  `${total.cases} cases compared (${total.tokens} tokens), ${total.wrong} differ. ` +
    `Not compared: ${total.rejectedByOracle} that the reference parser rejects, ${total.rejectedByBun} that only ${comparesParsers ? "typescript-estree" : "bun"} rejects.`,
);
