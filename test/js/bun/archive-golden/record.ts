// Fills in the expected results of cases.json.gz from the Bun that runs this script:
//
//   bun record.ts [--accept] [new-cases.json]
//
// The results in the repository come from the last Bun that read archives with libarchive (1.4.4).
import { tempDir } from "harness";
import { join } from "node:path";
import { loadCases, observeExtract, observeFiles, recordArguments, type Case } from "./observe";

const fixture = join(import.meta.dir, "cases.json.gz");
const [newCases] = recordArguments();
const cases: Case[] = newCases ? await Bun.file(newCases).json() : await loadCases<Case>(fixture);

process.umask(0o022);
using dir = tempDir("archive-golden", {});
const recorded: Case[] = [];
for (const [index, { data, mac, win }] of cases.entries()) {
  const archive = Buffer.from(data, "base64");
  recorded.push({
    data,
    mac,
    win,
    files: await observeFiles(archive),
    extract: await observeExtract(archive, join(String(dir), String(index))),
  });
}
await Bun.write(fixture, Bun.gzipSync(Buffer.from(JSON.stringify(recorded)), { level: 9 }));
console.log(`recorded ${recorded.length} cases with Bun ${Bun.version}`);
