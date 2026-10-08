// Compares `bun_lint::utils::fix_tracker::FixTracker` with ESLint's: for each source text, the fixes that
// `retainEnclosingFunction(node).remove(node)` and `retainSurroundingTokens(node).replaceTextRange(node.range, "X")` make for
// its statements, expressions and functions. Nodes are matched by their range.
//
//   bun fix-tracker.ts --bin <bun-lint> --eslint <checkout> --typescript-eslint <checkout> --fixtures <conformance/fixtures>
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { casesFromArguments, loadParsers, option, parse } from "../tokens/corpus";

const args = process.argv.slice(2);
const eslint = option(args, "--eslint") ?? process.env.ESLINT_DIR!;
const parsers = loadParsers(args);
const { SourceCode } = require(join(eslint, "lib/languages/js/source-code"));
const FixTracker = require(join(eslint, "lib/rules/utils/fix-tracker"));
const fixer = { replaceTextRange: (range: [number, number], text: string) => ({ range, text }) };

type Answers = Map<string, Set<string>>;
const put = (into: Answers, key: string, answer: string) => (into.get(key) ?? into.set(key, new Set()).get(key)!).add(answer);

// Offsets are compared as they are: in ASCII, a byte is a UTF-16 code unit.
const cases = casesFromArguments(args).filter(it => /^[\0-\x7f]*$/.test(it.code));
const expected: (Answers | null)[] = cases.map(it => {
  let ast: any;
  try {
    ast = parse(parsers, it);
  } catch {
    return null;
  }
  const sourceCode = new SourceCode({ text: it.code, ast });
  const answers: Answers = new Map();
  const visit = (node: any, parent: any) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(child => visit(child, parent));
    if (typeof node.type !== "string" || !node.range) return;
    node.parent = parent;
    if (node.type !== "Program") {
      const enclosing = new FixTracker(fixer, sourceCode).retainEnclosingFunction(node).remove(node);
      const surrounding = new FixTracker(fixer, sourceCode).retainSurroundingTokens(node).replaceTextRange(node.range, "X");
      put(answers, `retainEnclosingFunction ${node.range}`, `${enclosing.range} ${enclosing.text}`);
      put(answers, `retainSurroundingTokens ${node.range}`, `${surrounding.range} ${surrounding.text}`);
    }
    for (const key in node) if (key !== "parent" && key !== "tokens" && key !== "comments") visit(node[key], node);
  };
  visit(ast, null);
  return answers;
});

const directory = mkdtempSync(join(tmpdir(), "utils-small-"));
const input = join(directory, "cases.jsonl");
writeFileSync(input, cases.map(it => JSON.stringify({ path: it.path, code: it.code })).join("\n") + "\n");
const { stdout } = spawnSync(option(args, "--bin")!, ["utils-small", "fix-tracker", input], { encoding: "utf8", maxBuffer: 1 << 30 });
rmSync(directory, { recursive: true, force: true });

let [compared, wrong, unparsed, unmatched, shown] = [0, 0, 0, 0, 0];
stdout.split("\n").forEach((line, i) => {
  const upstream = expected[i];
  if (!line || !upstream) return;
  const all: [string, number, number, number, number, string][] | null = JSON.parse(line);
  if (!all) return void unparsed++;
  const answers: Answers = new Map();
  for (const [method, start, end, fixStart, fixEnd, text] of all) put(answers, `${method} ${start},${end}`, `${fixStart},${fixEnd} ${text}`);
  for (const [key, actual] of answers) {
    const wanted = upstream.get(key);
    if (!wanted) {
      unmatched++;
      continue;
    }
    compared++;
    if ([...actual].every(it => wanted.has(it))) continue;
    wrong++;
    if (shown++ < 15) console.log(`${cases[i].id} ${cases[i].path}\n${cases[i].code}\n  ${key}\n  expected ${JSON.stringify([...wanted])}\n  actual   ${JSON.stringify([...actual])}`);
  }
});
console.log(`${cases.length} texts, ${unparsed} that only ESLint parses, ${compared} fixes compared, ${wrong} wrong, ${unmatched} of nodes that ESTree does not have`);
process.exit(wrong === 0 ? 0 : 1);
