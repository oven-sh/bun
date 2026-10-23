// Fills in the expected results of cases.json.gz from the Bun that runs this script:
//
//   bun record.ts [new-cases.json]
//
// The results in the repository come from the last Bun that read tarballs with libarchive (1.4.4).
import { join } from "node:path";
import { install, type Case } from "./install";

const fixture = join(import.meta.dir, "cases.json.gz");
const cases: Case[] = process.argv[2]
  ? await Bun.file(process.argv[2]).json()
  : JSON.parse(Buffer.from(Bun.gunzipSync(await Bun.file(fixture).bytes())).toString());
const numbered = cases.map((c, id) => ({ ...c, id }));

// Nothing is installed when one tarball is refused, so those are found first.
const first = await install(process.execPath, numbered, false);
const accepted = numbered.filter(c => first.trees.get(c.id) !== null);
const second = await install(process.execPath, accepted, false);
if (second.exitCode !== 0) throw new Error(second.stderr);

const recorded: Case[] = numbered.map(({ id, data, mac, win }) => ({
  data,
  mac,
  win,
  tree: second.trees.get(id) ?? null,
}));
await Bun.write(fixture, Bun.gzipSync(Buffer.from(JSON.stringify(recorded)), { level: 9 }));
console.log(`recorded ${recorded.length} cases, ${accepted.length} of them accepted, with Bun ${Bun.version}`);
