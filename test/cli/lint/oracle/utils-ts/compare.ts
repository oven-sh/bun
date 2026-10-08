// Compares the output of `bun-lint utils-ts batch cases.jsonl` with `expected.jsonl` of `oracle.ts`.
//
//   bun compare.ts <directory with cases.jsonl and expected.jsonl> <actual.jsonl> [function] [how many to show]
//
// A row is compared if both sides have one for the function and the range. Many nodes exist on one side only: an
// `Identifier` that is a name and not an expression, the `a, b` of `a, b, c`.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const [directory, actualPath, only = "", show = "5"] = process.argv.slice(2);
const lines = (path: string) => readFileSync(path, "utf8").split("\n").filter(Boolean).map(it => JSON.parse(it));
const cases = lines(join(directory, "cases.jsonl"));
const expected = lines(join(directory, "expected.jsonl"));
const actual = lines(actualPath);

type Count = { same: number; differ: number; missing: number; extra: number };
const counts = new Map<string, Count>();
const count = (name: string) => counts.get(name) ?? counts.set(name, { same: 0, differ: 0, missing: 0, extra: 0 }).get(name)!;
// `undefined` for a range that has several nodes with different results.
function index(rows: unknown[][]) {
  const all = new Map<string, string | undefined>();
  for (const [name, start, end, value] of rows) {
    const key = `${name}\t${start}\t${end}`;
    const text = JSON.stringify(value);
    all.set(key, all.has(key) && all.get(key) !== text ? undefined : text);
  }
  return all;
}
let errors = 0;
let shown = 0;
expected.forEach((want, i) => {
  const got = actual[i];
  if (!got || got.error) return void errors++;
  const [a, b] = [index(want.rows), index(got.rows)];
  for (const [key, value] of a) {
    const [name, start, end] = key.split("\t");
    if (!b.has(key)) {
      count(name).missing++;
    } else if (value === undefined || b.get(key) === undefined) {
      continue;
    } else if (b.get(key) === value) {
      count(name).same++;
    } else {
      count(name).differ++;
      if ((!only || only === name) && shown++ < Number(show)) {
        console.log(`--- ${name} #${i} (${cases[i].rule}, ${cases[i].filename}, ${cases[i].sourceType})\n${cases[i].code}`);
        console.log(`  at ${start}..${end}: ${JSON.stringify(cases[i].code.slice(Number(start), Number(end)))}`);
        console.log(`  expected: ${value}\n  actual:   ${b.get(key)}`);
      }
    }
  }
  for (const key of b.keys()) {
    if (!a.has(key)) count(key.split("\t")[0]).extra++;
  }
});
console.log(`${expected.length} cases, ${errors} that do not parse here`);
for (const [name, it] of [...counts].sort()) {
  console.log(`${String(it.differ).padStart(7)} differ, ${String(it.same).padStart(8)} same, ${String(it.missing).padStart(7)} only upstream, ${String(it.extra).padStart(7)} only here: ${name}`);
}
