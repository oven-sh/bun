// Fills in the expected results of cases.json.gz from the Bun that runs this script:
//
//   bun record.ts [--accept] [new-cases.json]
//
// The results in the repository come from the last Bun that read and wrote PNG with libspng, 92e819d895.
import { join } from "node:path";
import { loadCases, observeDecode, observeEncode, type Cases } from "./observe";

const args = process.argv.slice(2);
if (!Bun.revision.startsWith("92e819d895") && !args.includes("--accept")) {
  throw new Error(
    `Bun ${Bun.revision} does not use libspng, so this would record the code under test. ` +
      "Run it with a build of 92e819d895, or pass --accept after a change that is meant.",
  );
}
const fixture = join(import.meta.dir, "cases.json.gz");
const [newCases] = args.filter(arg => arg !== "--accept");
const cases: Cases = newCases ? await Bun.file(newCases).json() : await loadCases(fixture);

const files = new Map(cases.decode.map(c => [c.name, Buffer.from(c.data, "base64")]));
for (const c of cases.decode) c.result = await observeDecode(files.get(c.name)!, c.maxPixels);
for (const c of cases.encode) c.result = await observeEncode(files.get(c.source)!, c.options);

await Bun.write(fixture, Bun.gzipSync(Buffer.from(JSON.stringify(cases)), { level: 9 }));
console.log(`recorded ${cases.decode.length} + ${cases.encode.length} cases with Bun ${Bun.revision}`);
