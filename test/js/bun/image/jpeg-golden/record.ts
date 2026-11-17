// Fills in the `result` of every case in cases.json.gz from the Bun that runs this script:
//
//   <a build of 8653dfbae0> record.ts [new-cases.json]
//   bun bd record.ts --accept=<why> [new-cases.json]
//
// The results in the repository are those of 8653dfbae0, which read and wrote JPEG with libjpeg-turbo 3.2.0, but for
// the cases with an `unlikeLibjpegTurbo`. So the first form is the one to add cases with. It leaves those cases as they
// are. The second is for after a change that is meant: it records the code under test, and lists the cases it changed,
// which get `unlikeLibjpegTurbo: <why>`.
//
// new-cases.json replaces the cases. It is a `Cases` of observe.ts, in which `result` may be left out.
import { join } from "node:path";
import { loadCases } from "../png-golden/observe";
import { observable, type Cases } from "./observe";

const args = process.argv.slice(2);
const why = args.find(arg => arg.startsWith("--accept="))?.slice("--accept=".length);
if (!Bun.revision.startsWith("8653dfbae0") && !why) {
  throw new Error(
    `This is Bun ${Bun.revision}, not the one the results were recorded with. ` +
      "Run it with a build of 8653dfbae0, or pass --accept=<why> after a change that is meant.",
  );
}
const fixture = join(import.meta.dir, "cases.json.gz");
const [newCases] = args.filter(arg => !arg.startsWith("--accept="));
const cases: Cases = newCases ? await Bun.file(newCases).json() : await loadCases(fixture);

// The fixture does not show in a diff, so say which results are no longer the recorded ones.
const changed: string[] = [];
const all = Object.values(observable(cases)).flat();
for (const { recorded, name, observe } of all) {
  if (!why && recorded.unlikeLibjpegTurbo !== undefined) continue;
  if (why && recorded.result === undefined) throw new Error(`Record ${name} with a build of 8653dfbae0 first.`);
  const result = await observe();
  if (recorded.result !== undefined && recorded.result !== result) {
    changed.push(name);
    recorded.unlikeLibjpegTurbo = why;
  }
  recorded.result = result;
}

await Bun.write(fixture, Bun.gzipSync(Buffer.from(JSON.stringify(cases)), { level: 9 }));
console.log(`recorded ${all.length} cases with Bun ${Bun.revision}`);
console.log(`${changed.length} changed\n${changed.join("\n")}`);
