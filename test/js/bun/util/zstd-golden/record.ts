// Fills in the results in cases.json.gz from the Bun that runs this script, and lists those that changed, as the
// fixture does not show in a diff:
//
//   bun bd record.ts [new-cases.json]
//
// new-cases.json replaces the cases. It is a `Cases` of observe.ts, in which a result may be empty.
import { fixture, loadCases, observeDecode, observeEncode, type Cases } from "./observe";

const [newCases] = process.argv.slice(2);
const cases: Cases = newCases ? await Bun.file(newCases).json() : await loadCases();

const changed: string[] = [];
function noted(name: string, before: string, after: string) {
  if (before !== after) changed.push(`${name}\n--- before\n${before}\n--- after\n${after}`);
  return after;
}
for (const c of cases.encode) c.result = noted(c.name, c.result, await observeEncode(c));
for (const c of cases.decode) c.result = noted(c.name, c.result, await observeDecode(c));

await Bun.write(fixture, Bun.gzipSync(Buffer.from(JSON.stringify(cases)), { level: 9 }));
console.log(`${changed.join("\n")}\n${changed.length} changed with Bun ${Bun.revision}`);
