// Compares `bun-lint types dump-fixtures --profiles` with `dump-types.ts --profiles`, field by field.
//
//   bun compare-profiles.ts <ours> <typescript's> [--limit=n] [--rule=r] [--field=f]

import { readFileSync } from "node:fs";

const flag = (name: string) => process.argv.find(a => a.startsWith(name))?.slice(name.length);
const [oursPath, theirsPath] = process.argv.slice(2).filter(a => !a.startsWith("--"));
const onlyRule = flag("--rule=");
const onlyField = flag("--field=");
const limit = Number(flag("--limit=") ?? 8);

function sections(path: string) {
  const all = new Map<string, any[]>();
  for (const section of readFileSync(path, "utf8").split(/^(?=# )/m)) {
    if (!section) continue;
    const [header, ...lines] = section.trimEnd().split("\n");
    all.set(header.slice(2), lines.map(line => JSON.parse(line)));
  }
  return all;
}

const sameKind: Record<string, string> = {
  FirstLiteralToken: "NumericLiteral",
  FirstTemplateToken: "NoSubstitutionTemplateLiteral",
};
const ours = sections(oursPath);
const theirs = sections(theirsPath);
const fields = new Map<string, { same: number; different: Map<string, { count: number; example: string }> }>();
let [compared, missing] = [0, 0];
for (const [header, lines] of ours) {
  if (onlyRule && header.split(" ")[0] !== onlyRule) continue;
  const expected = theirs.get(header);
  if (!expected || typeof expected[0] === "string" || typeof lines[0] === "string") continue;
  const key = (line: any[]) => `${line[0]},${line[1]},${sameKind[line[2]] ?? line[2]}`;
  const wanted = new Map(expected.map(line => [key(line), line[3]]));
  for (const line of lines) {
    const want = wanted.get(key(line));
    if (!want) {
      missing++;
      continue;
    }
    // Where the types differ, everything does.
    if (want.type !== line[3].type) continue;
    compared++;
    for (const [name, value] of Object.entries(line[3])) {
      if (onlyField && name !== onlyField) continue;
      const entry = fields.get(name) ?? { same: 0, different: new Map() };
      fields.set(name, entry);
      // TypeScript 7 prints the `new` of a construct signature without being told that it is one.
      const plain = (text: string) => (name === "construct" || name === "resolved" ? text?.replace(/"new /g, '"') : text);
      const [a, b] = [plain(JSON.stringify(value)), JSON.stringify(want[name])];
      if (a === b) {
        entry.same++;
        continue;
      }
      const what = `${want.type.slice(0, 50)}: ours ${a.slice(0, 110)} | theirs ${b?.slice(0, 110)}`;
      const difference = entry.different.get(what) ?? { count: 0, example: `${header} @${key(line)}` };
      difference.count++;
      entry.different.set(what, difference);
    }
  }
}
console.log(`${compared} expressions compared, ${missing} without a counterpart`);
for (const [name, { same, different }] of fields) {
  const count = [...different.values()].reduce((sum, it) => sum + it.count, 0);
  console.log(`\n── ${name}: ${same} same, ${count} different`);
  for (const [what, { count, example }] of [...different].sort((a, b) => b[1].count - a[1].count).slice(0, limit)) {
    console.log(`${String(count).padStart(6)}  ${what}   (${example})`);
  }
}
