// Compares the output of `bun-lint utils-core dump` with that of `dump.ts`.
//
//   bun compare.ts cases.jsonl expected.jsonl actual.jsonl [--show=<fact>] [--limit=<n>]
//
// A fact is compared if both sides have one of its name for the same node (type and range). A `node` fact of `bun lint` must
// exist in ESLint's.

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

const split = (fact: string) => {
  let at = -1;
  for (let i = 0; i < 4; i++) at = fact.indexOf("|", at + 1);
  return [fact.slice(0, at), fact.slice(at + 1)];
};
const tally = new Map<string, { same: number; different: number; examples: string[] }>();
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
  for (const fact of ours.facts) {
    const [key, value] = split(fact);
    const name = key.slice(0, key.indexOf("|"));
    const want = wanted.get(key);
    if (want === undefined && name !== "node") continue;
    let entry = tally.get(name);
    if (!entry) tally.set(name, (entry = { same: 0, different: 0, examples: [] }));
    if (want === value) entry.same++;
    else {
      entry.different++;
      if (entry.examples.length < limit) {
        entry.examples.push(`  #${id} ${cases.get(id).filename} ${key}\n    ours ${value}\n    want ${want}\n    ${JSON.stringify(cases.get(id).code)}`);
      }
    }
  }
}
console.log(`${compared} cases compared, ${parsedByOne} that only one side parses`);
for (const [name, entry] of [...tally].sort()) {
  console.log(`${name.padEnd(20)} ${entry.same} same, ${entry.different} different`);
  if (show === name || show === "all") console.log(entry.examples.join("\n"));
}
