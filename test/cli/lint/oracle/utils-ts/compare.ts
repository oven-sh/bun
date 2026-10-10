// Compares the output of `bun-lint utils-ts batch cases.jsonl` with `expected.jsonl` of `oracle.ts`.
//
//   bun compare.ts <directory with cases.jsonl and expected.jsonl> <actual.jsonl> [function] [how many to show]
//
// A row is compared if both sides have one for the function and the range. Many nodes exist on one side only: an
// `Identifier` that is a name and not an expression, the `a, b` of `a, b, c`.

import { openSync, readSync } from "node:fs";
import { join } from "node:path";

const [directory, actualPath, only = "", show = "5"] = process.argv.slice(2);
// The files can be larger than a string can be.
function* lines(path: string) {
  const file = openSync(path, "r");
  const chunk = Buffer.alloc(1 << 24);
  let rest = Buffer.alloc(0);
  for (let size; (size = readSync(file, chunk, 0, chunk.length, null)) > 0; ) {
    rest = Buffer.concat([rest, chunk.subarray(0, size)]);
    for (let end; (end = rest.indexOf(10)) >= 0; rest = rest.subarray(end + 1)) yield rest.toString("utf8", 0, end);
  }
}
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
let total = 0;
for (;;) {
  const [caseLine, wantLine, gotLine] = [cases.next(), expected.next(), actual.next()];
  if (wantLine.done) break;
  const i = total++;
  const [it, want, got] = [JSON.parse(caseLine.value), JSON.parse(wantLine.value), gotLine.done ? undefined : JSON.parse(gotLine.value)];
  if (!got || got.error) {
    errors++;
    continue;
  }
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
        console.log(`--- ${name} #${i} (${it.rule}, ${it.filename}, ${it.sourceType})\n${it.code.length < 2000 ? it.code : "(long)"}`);
        console.log(`  at ${start}..${end}: ${JSON.stringify(it.code.slice(Number(start), Number(end)))}`);
        console.log(`  expected: ${value}\n  actual:   ${b.get(key)}`);
      }
    }
  }
  for (const key of b.keys()) {
    if (!a.has(key)) count(key.split("\t")[0]).extra++;
  }
}
console.log(`${total} cases, ${errors} that do not parse here`);
for (const [name, it] of [...counts].sort()) {
  console.log(`${String(it.differ).padStart(7)} differ, ${String(it.same).padStart(8)} same, ${String(it.missing).padStart(7)} only upstream, ${String(it.extra).padStart(7)} only here: ${name}`);
}
