// Fills in the results in cases.json.gz from the Bun that runs this script, and lists those that changed, as the
// fixture does not show in a diff:
//
//   <a build of 52cf8bebe> record.ts [new-cases.json]
//   bun bd record.ts --accept [new-cases.json]
//
// The results in the repository are those of 52cf8bebe, which had zlib-ng 2.3.3. So the first form is the one to add
// cases with. The second is for after a change that is meant: it records the code under test.
//
// new-cases.json replaces the cases. It is a `Cases` of observe.ts, in which a result may be empty.
import { fixture, library, loadCases, nameOf, observeDamaged, observeDeflate, WRONG, type Cases } from "./observe";

const args = process.argv.slice(2);
const zlibNg = "12731092979c6d07f42da27da673a9f6c7b13586";
if (process.versions.zlib !== zlibNg && !args.includes("--accept")) {
  throw new Error(
    `Bun ${Bun.revision} does not have zlib-ng 2.3.3, which the results were recorded with. ` +
      "Run it with a build of 52cf8bebe, or pass --accept after a change that is meant.",
  );
}
const [newCases] = args.filter(arg => arg !== "--accept");
const cases: Cases = newCases ? await Bun.file(newCases).json() : await loadCases();

const changed: string[] = [];
function noted(name: string, before: string, after: string) {
  if (after.includes(WRONG)) throw new Error(`${name} does not inflate to its input: ${after}`);
  if (before !== after) changed.push(`${name}\n--- before\n${before}--- after\n${after}`);
  return after;
}
for (const c of [...cases.whole, ...cases.steps, ...cases.rare]) {
  c.result = noted(nameOf(c), c.result, observeDeflate(c));
}
for (const c of cases.damaged) {
  c.results = observeDamaged(c).map((after, i) => noted(`${c.stream} damage ${i}`, c.results[i], after));
}

await Bun.write(fixture, Bun.gzipSync(Buffer.from(JSON.stringify(cases)), { level: 12, library }));
console.log(`${changed.join("\n")}\n${changed.length} changed with Bun ${Bun.revision}`);
