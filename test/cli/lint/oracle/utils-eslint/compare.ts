// Compares the output of `bun-lint utils-eslint dump` with that of `dump.ts`.
//
//   bun compare.ts cases.jsonl expected.jsonl actual.jsonl [--show=<fact or all>] [--limit=<n>]
//
// A fact is compared if both sides have one of its name for the same node (type and range). The facts of the reference
// tracker are compared both ways: one that is missing from either side is a difference.
//
// A static value that `bun lint` does not compute where upstream does is counted apart: "unknown" if upstream's value is
// one that `StaticValue` cannot represent, "missing" otherwise.

import { readFileSync } from "node:fs";

const [casesPath, expectedPath, actualPath, ...flags] = process.argv.slice(2);
const show = flags.find(it => it.startsWith("--show="))?.slice(7);
const limit = Number(flags.find(it => it.startsWith("--limit="))?.slice(8) ?? 10);
const read = (path: string) =>
  new Map(
    readFileSync(path, "utf8")
      .split("\n")
      .filter(Boolean)
      .map(line => JSON.parse(line))
      .map(it => [it.id, it]),
  );
const [cases, expected, actual] = [read(casesPath), read(expectedPath), read(actualPath)];

const split = (fact: string): [string, string] => {
  let at = -1;
  for (let i = 0; i < 4; i++) at = fact.indexOf("|", at + 1);
  return [fact.slice(0, at), fact.slice(at + 1)];
};
const tally = new Map<string, { same: number; different: number; examples: string[] }>();
function count(name: string, id: number, key: string, ours: string | undefined, want: string | undefined) {
  if (ours !== want && ours === "none" && /^(static|string)/.test(name)) name += want!.includes("<other>") ? " unknown" : " missing";
  let entry = tally.get(name);
  if (!entry) tally.set(name, (entry = { same: 0, different: 0, examples: [] }));
  if (want === ours) return void entry.same++;
  entry.different++;
  if (entry.examples.length < limit) {
    const it = cases.get(id);
    entry.examples.push(`  #${id} ${it.filename} ${key}\n    ours ${ours}\n    want ${want}\n    ${JSON.stringify(it.code)}`);
  }
}
let parsedByOne = 0;
let compared = 0;
for (const [id, theirs] of expected) {
  const ours = actual.get(id);
  if (!ours) continue;
  if (theirs.error || ours.error) {
    if (!theirs.error !== !ours.error) parsedByOne++;
    continue;
  }
  compared++;
  const wanted = new Map<string, string>(theirs.facts.map(split));
  const found = new Map<string, string>(ours.facts.map(split));
  for (const [key, value] of found) {
    const name = key.slice(0, key.indexOf("|"));
    const want = wanted.get(key);
    if (want !== undefined || name.startsWith("track")) count(name, id, key, value, want);
  }
  for (const [key, want] of wanted) {
    if (key.startsWith("track") && !found.has(key)) count(key.slice(0, key.indexOf("|")), id, key, undefined, want);
  }
}
console.log(`${compared} cases compared, ${parsedByOne} that only one side parses`);
for (const [name, entry] of [...tally].sort()) {
  console.log(`${name.padEnd(24)} ${entry.same} same, ${entry.different} different`);
  if (show === "all" || (show && name.startsWith(show))) console.log(entry.examples.join("\n"));
}
