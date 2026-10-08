// Compares `bun-lint types dump-fixtures` with `dump-types.ts`.
//
//   bun compare-types.ts <ours> <typescript's> [--verbose] [--rule=r] [--limit=n]
//
// A line of ours is `[start, end, "expr" | "pat" | "type", "<type>"]`. It is compared with the ESTree
// node that has the same range and is of that sort.

import { readFileSync } from "node:fs";

const flag = (name: string) => process.argv.find(a => a.startsWith(name))?.slice(name.length);
const [oursPath, theirsPath] = process.argv.slice(2).filter(a => !a.startsWith("--"));
const isVerbose = process.argv.includes("--verbose");
const onlyRule = flag("--rule=");
const limit = Number(flag("--limit=") ?? 40);

function sections(path: string) {
  const all = new Map<string, any[]>();
  for (const section of readFileSync(path, "utf8").split(/^(?=# )/m)) {
    if (!section) continue;
    const [header, ...lines] = section.trimEnd().split("\n");
    all.set(header.slice(2), lines.map(line => JSON.parse(line)));
  }
  return all;
}

const isPattern = (type: string) =>
  ["Identifier", "ObjectPattern", "ArrayPattern", "AssignmentPattern", "RestElement"].includes(type);
const isType = (type: string) => /^TS.*(Type|Keyword|Reference|Query|Predicate|Operator|Literal|Heritage|Implements)$/.test(type) || type === "TSTypeLiteral" || type === "TSExpressionWithTypeArguments";
const isStatementLike = (type: string) =>
  /(Statement|Declaration|Declarator|Clause|Case|Specifier|Definition|Property|Body|Element|Annotation|Instantiation|Member|Signature|Attribute|Text|Parameter|Decorator|Quasi)$/.test(type) &&
  !["JSXElement", "TSNonNullExpression"].includes(type);

const ours = sections(oursPath);
const theirs = sections(theirsPath);
let [same, different, unmatched, failedCases] = [0, 0, 0, 0];
const byPair = new Map<string, { count: number; example: string }>();
const perRule = new Map<string, [number, number]>();
let shown = 0;

for (const [header, lines] of ours) {
  const rule = header.split(" ")[0];
  if (onlyRule && rule !== onlyRule) continue;
  const expected = theirs.get(header);
  if (!expected || typeof expected[0] === "string" || typeof lines[0] === "string") {
    failedCases++;
    if (isVerbose) console.log(`${header}: ours ${JSON.stringify(lines[0])?.slice(0, 80)}, theirs ${JSON.stringify(expected?.[0])?.slice(0, 160)}`);
    continue;
  }
  const byRange = new Map<string, [string, string][]>();
  for (const [start, end, type, text] of expected) {
    const key = `${start},${end}`;
    byRange.set(key, [...(byRange.get(key) ?? []), [type, text]]);
  }
  const tally = perRule.get(rule) ?? [0, 0];
  perRule.set(rule, tally);
  for (const [start, end, sort, text] of lines) {
    const candidates = (byRange.get(`${start},${end}`) ?? []).filter(([type]) =>
      sort === "pat" ? isPattern(type) : sort === "type" ? isType(type) : !isType(type) && !isStatementLike(type),
    );
    if (candidates.length === 0) {
      unmatched++;
      continue;
    }
    if (candidates.some(candidate => candidate[1] === text)) {
      same++;
      tally[0]++;
      continue;
    }
    different++;
    tally[1]++;
    const pair = `${sort} ${candidates[0][0]}: ours ${text.slice(0, 100)} | theirs ${candidates[0][1].slice(0, 100)}`;
    const entry = byPair.get(pair) ?? { count: 0, example: `${header} @${start}-${end}` };
    entry.count++;
    byPair.set(pair, entry);
    if (isVerbose && shown++ < limit) console.log(`${header} @${start}-${end} ${pair}`);
  }
}

console.log(`${same} same, ${different} different, ${unmatched} without a counterpart, ${failedCases} cases not compared`);
const worst = [...byPair].sort((a, b) => b[1].count - a[1].count).slice(0, limit);
for (const [pair, { count, example }] of worst) console.log(`${String(count).padStart(5)}  ${pair}   (${example})`);
if (process.argv.includes("--rules")) {
  for (const [rule, [ok, bad]] of [...perRule].sort((a, b) => b[1][1] - a[1][1])) if (bad) console.log(`${rule}: ${bad} of ${ok + bad}`);
}
