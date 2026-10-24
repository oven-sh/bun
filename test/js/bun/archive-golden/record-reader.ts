// Fills reader.json.gz with what the tar reader of the Bun that runs this script reports about the
// archives of cases.json.gz, in every mode:
//
//   bun record-reader.ts --accept
//
// No Bun that read archives with libarchive has `readTar`. The logs in the repository were compared
// with what libarchive itself reports, line by line, when they were recorded. Only the wording
// behind `error:` and `refused:` is Bun's own.
import { readTar } from "bun:internal-for-testing";
import { join } from "node:path";
import { loadCases, readerModes, type Case, type ReaderFixture } from "./observe";

if (!process.argv.includes("--accept")) {
  throw new Error("This records the code under test. Pass --accept after a change that is meant.");
}

const cases = await loadCases<Case>(join(import.meta.dir, "cases.json.gz"));
const indexes = new Map<string, number>();
const fixture: ReaderFixture = { modes: readerModes, logs: [], cases: [] };
for (const { data } of cases) {
  const archive = Buffer.from(data, "base64");
  fixture.cases.push(
    readerModes.map(mode => {
      const log = readTar(archive, mode);
      if (!indexes.has(log)) indexes.set(log, fixture.logs.push(log) - 1);
      return indexes.get(log)!;
    }),
  );
}
await Bun.write(
  join(import.meta.dir, "reader.json.gz"),
  Bun.gzipSync(Buffer.from(JSON.stringify([fixture])), { level: 9 }),
);
console.log(`recorded ${cases.length} cases in ${readerModes.length} modes, ${fixture.logs.length} different logs`);
