// Compares `bun-lint types dump-fixtures --ts-nodes` with `dump-types.ts --ts-nodes`: the nodes of
// TypeScript's tree, and the type and the symbol at each.
//
//   bun compare-ts-nodes.ts <ours> <typescript's> [--limit=n] [--rule=r]

import { readFileSync } from "node:fs";

const flag = (name: string) => process.argv.find(a => a.startsWith(name))?.slice(name.length);
const [oursPath, theirsPath] = process.argv.slice(2).filter(a => !a.startsWith("--"));
const onlyRule = flag("--rule=");
const limit = Number(flag("--limit=") ?? 30);

function sections(path: string) {
  const all = new Map<string, any[]>();
  for (const section of readFileSync(path, "utf8").split(/^(?=# )/m)) {
    if (!section) continue;
    const [header, ...lines] = section.trimEnd().split("\n");
    all.set(header.slice(2), lines.map(line => JSON.parse(line)));
  }
  return all;
}

// `ts.SyntaxKind[kind]` gives the last name of a number that has several.
const sameKind: Record<string, string> = {
  FirstLiteralToken: "NumericLiteral",
  FirstTemplateToken: "NoSubstitutionTemplateLiteral",
  LastTemplateToken: "TemplateTail",
  FirstStatement: "VariableStatement",
  FirstNode: "QualifiedName",
  FirstTypeNode: "TypePredicate",
  LastTypeNode: "ImportType",
  FirstAssignment: "EqualsToken",
  FirstBinaryOperator: "LessThanToken",
  FirstPunctuation: "OpenBraceToken",
  FirstContextualKeyword: "AbstractKeyword",
  FirstFutureReservedWord: "ImplementsKeyword",
  LastFutureReservedWord: "YieldKeyword",
  FirstKeyword: "BreakKeyword",
  LastKeyword: "DeferKeyword",
  LastContextualKeyword: "DeferKeyword",
  LastAssignment: "CaretEqualsToken",
  LastBinaryOperator: "CaretEqualsToken",
  LastPunctuation: "CaretEqualsToken",
  FirstCompoundAssignment: "PlusEqualsToken",
  LastCompoundAssignment: "CaretEqualsToken",
  LastReservedWord: "WithKeyword",
  FirstReservedWord: "BreakKeyword",
  LastStatement: "DebuggerStatement",
  LastLiteralToken: "NoSubstitutionTemplateLiteral",
};

const tally = { nodes: 0, missing: 0, extra: 0, types: 0, symbols: 0, flags: 0, declarations: 0 };
const groups = new Map<string, Map<string, { count: number; example: string }>>();
function note(group: string, what: string, example: string) {
  const all = groups.get(group) ?? new Map();
  groups.set(group, all);
  const entry = all.get(what) ?? { count: 0, example };
  entry.count++;
  all.set(what, entry);
}

const ours = sections(oursPath);
const theirs = sections(theirsPath);
for (const [header, lines] of ours) {
  if (onlyRule && header.split(" ")[0] !== onlyRule) continue;
  const expected = theirs.get(header);
  if (!expected || typeof expected[0] === "string" || typeof lines[0] === "string") {
    note("cases", `ours ${JSON.stringify(lines[0])?.slice(0, 40)}`, header);
    continue;
  }
  const key = (line: any[]) => `${line[0]},${line[1]},${sameKind[line[2]] ?? line[2]}`;
  const found = new Map(lines.map(line => [key(line), line]));
  const wanted = new Map(expected.map(line => [key(line), line]));
  for (const [at, line] of found) if (!wanted.has(at)) (tally.extra++, note("extra", line[2], `${header} @${at}`));
  for (const [at, want] of wanted) {
    const kind = sameKind[want[2]] ?? want[2];
    const have = found.get(at);
    if (!have) {
      tally.missing++;
      note("missing", kind, `${header} @${at}`);
      continue;
    }
    tally.nodes++;
    if (have[3] !== want[3]) {
      tally.types++;
      note("types", `${kind}: ours ${have[3].slice(0, 70)} | theirs ${want[3].slice(0, 70)}`, `${header} @${at}`);
    }
    const [a, b] = [have[4], want[4]];
    if ((a === null) !== (b === null) || (a && a[0] !== b[0])) {
      tally.symbols++;
      note("symbols", `${kind}: ours ${a?.[0] ?? null} | theirs ${b?.[0] ?? null}`, `${header} @${at}`);
    } else if (a) {
      if (a[1] !== b[1]) (tally.flags++, note("flags", `${kind} ${a[0]}: ours ${a[1]} | theirs ${b[1]}`, `${header} @${at}`));
      if (JSON.stringify(a[2]) !== JSON.stringify(b[2])) {
        tally.declarations++;
        note("declarations", `${kind} ${a[0]}: ours ${JSON.stringify(a[2]).slice(0, 80)} | theirs ${JSON.stringify(b[2]).slice(0, 80)}`, `${header} @${at}`);
      }
    }
  }
}
console.log(tally);
for (const [group, all] of groups) {
  console.log(`\n── ${group}`);
  for (const [what, { count, example }] of [...all].sort((a, b) => b[1].count - a[1].count).slice(0, limit)) {
    console.log(`${String(count).padStart(6)}  ${what}   (${example})`);
  }
}
