// Fills in the results in cases.json.gz from the Bun that runs this script, and lists those that changed, as the
// fixture does not show in a diff:
//
//   <bun> record.ts [new-cases.json]
//
// For a new version of ICU, src/icu/README.md says how to get a Bun with ICU4C, which is the one to record with.
// new-cases.json replaces the cases. It is a `Cases` of observe.ts, in which a result may be empty.
import { fixture, loadCases, observeIn, type Case, type Cases } from "./observe";

const [newCases] = process.argv.slice(2);
const cases: Cases = newCases ? await Bun.file(newCases).json() : await loadCases();

const changed: string[] = [];
function fillIn(some: Case[], results: string[]) {
  for (const [i, c] of some.entries()) {
    if (results[i] !== c[1]) changed.push(`${c[0]}\n--- before\n${c[1]}\n--- after\n${results[i]}`);
    c[1] = results[i];
  }
}

const sourcesOf = (some: Case[]) => some.map(([source]) => source);
for (const some of Object.values(cases.anywhere)) fillIn(some, await observeIn("TZ=UTC", sourcesOf(some)));
for (const [environment, some] of Object.entries(cases.environments)) {
  fillIn(some, await observeIn(environment, sourcesOf(some)));
}

await Bun.write(fixture, Bun.gzipSync(Buffer.from(JSON.stringify(cases)), { level: 9 }));
console.log(`${changed.join("\n")}\n${changed.length} changed with Bun ${Bun.revision}`);
