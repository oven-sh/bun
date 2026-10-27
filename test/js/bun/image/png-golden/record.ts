// Fills in the `result` of every case in cases.json.gz from the Bun that runs this script:
//
//   <a build of 92e819d895> record.ts [new-cases.json]
//   bun bd record.ts --accept [new-cases.json]
//
// The results in the repository are those of 92e819d895, which read and wrote PNG with libspng. So the first form
// is the one to add cases with. The second records the code under test, for after a change that is meant, and
// lists the cases it changed.
//
// new-cases.json replaces the cases. It is a `Cases` of observe.ts, in which `result` may be left out.
import { join } from "node:path";
import { loadCases, observeDecode, observeEncode, type Cases } from "./observe";

const args = process.argv.slice(2);
if (!Bun.revision.startsWith("92e819d895") && !args.includes("--accept")) {
  throw new Error(
    `This is Bun ${Bun.revision}, not the one the results were recorded with. ` +
      "Run it with a build of 92e819d895, or pass --accept after a change that is meant.",
  );
}
const fixture = join(import.meta.dir, "cases.json.gz");
const [newCases] = args.filter(arg => arg !== "--accept");
const cases: Cases = newCases ? await Bun.file(newCases).json() : await loadCases(fixture);

const files = new Map(cases.decode.map(c => [c.name, Buffer.from(c.data, "base64")]));
// The fixture does not show in a diff, so say which results are no longer the recorded ones.
const changed: string[] = [];
function record(c: { result?: string }, name: string, result: string) {
  const exceptCompression = (text: string) => text.replace(/^file .*\n/m, "");
  if (c.result !== undefined && exceptCompression(c.result) !== exceptCompression(result)) changed.push(name);
  c.result = result;
}
for (const c of cases.decode) record(c, c.name, await observeDecode(files.get(c.name)!, c.maxPixels));
for (const c of cases.encode) {
  record(c, `${c.source} ${JSON.stringify(c.options)}`, await observeEncode(files.get(c.source)!, c.options));
}

await Bun.write(fixture, Bun.gzipSync(Buffer.from(JSON.stringify(cases)), { level: 9 }));
console.log(`recorded ${cases.decode.length} + ${cases.encode.length} cases with Bun ${Bun.revision}`);
console.log(`${changed.length} changed in more than how zlib compressed them\n${changed.join("\n")}`);
