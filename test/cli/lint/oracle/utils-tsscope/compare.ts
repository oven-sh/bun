// Compares the output of `bun-lint utils-tsscope batch cases.jsonl` with `expected.jsonl` of `oracle.ts`.
//
//   bun compare.ts <directory with cases.jsonl and expected.jsonl> <actual.jsonl> [section] [how many to show]

import { readFileSync } from "node:fs";
import { join } from "node:path";

const [directory, actualPath, only, show = "5"] = process.argv.slice(2);
const lines = (path: string) => readFileSync(path, "utf8").split("\n").filter(Boolean).map(it => JSON.parse(it));
const cases = lines(join(directory, "cases.jsonl"));
const expected = lines(join(directory, "expected.jsonl"));
const actual = lines(actualPath);
const sections = ["functions", "unused", "used", "members", "globals"].filter(it => !only || it === only);
let errors = 0;
const wrong = Object.fromEntries(sections.map(it => [it, 0]));
let shown = 0;
expected.forEach((want, i) => {
  const got = actual[i];
  if (!got || got.error) return void errors++;
  for (const section of sections) {
    const [a, b] = [want[section].map((it: unknown) => JSON.stringify(it)), got[section].map((it: unknown) => JSON.stringify(it))];
    if (a.join() === b.join()) continue;
    wrong[section]++;
    if (shown++ < Number(show)) {
      console.log(`--- ${section} #${i} (${cases[i].rule}, ${cases[i].filename}, ${cases[i].languageOptions.sourceType})\n${cases[i].code.length > 600 ? "(long)" : cases[i].code}`);
      console.log("  missing:", a.filter((it: string) => !b.includes(it)).join(" "));
      console.log("  extra:  ", b.filter((it: string) => !a.includes(it)).join(" "));
    }
  }
});
console.log(`${expected.length} cases, ${errors} that do not parse here;`, sections.map(it => `${it}: ${wrong[it]} differ`).join(", "));
