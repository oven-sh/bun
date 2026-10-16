// Writes expectations.json, which wpt.test.ts reads, from the results of run-directory.js.
//
//   bun update-expectations.js <results.jsonl or .jsonl.gz>... [--out=<file>]
//
// A test is kept when it finishes (harness status OK) and at least half of its subtests pass, or when it is a crash test
// that ends normally. The others are about something bun:dom does not have, and many cost a timeout each.
// With an expectations file already there, only the tests in the results are replaced.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readResults } from "./summarize.js";

const files = process.argv.slice(2).filter(argument => !argument.startsWith("--"));
const out = process.argv.find(argument => argument.startsWith("--out="))?.slice(6) ?? join(import.meta.dir, "expectations.json");

const expectations = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : {};
for (const result of files.flatMap(readResults)) {
  if (typeof expectations[result.test] === "string") continue; // "skip: ..." is written by hand.
  delete expectations[result.test];
  const total = Object.values(result.counts).reduce((sum, count) => sum + count, 0);
  if (result.status !== "OK" || (total ? result.counts.PASS * 2 < total || !result.counts.PASS : result.kind !== "crashtest")) continue;
  expectations[result.test] = Object.fromEntries(result.failures.map(failure => [failure.name, failure.status]));
}

const sorted = Object.fromEntries(Object.entries(expectations).sort(([a], [b]) => (a < b ? -1 : 1)));
writeFileSync(out, JSON.stringify(sorted, null, 1) + "\n");
console.log(`${Object.keys(sorted).length} tests, ${Object.values(sorted).reduce((sum, entry) => sum + Object.keys(entry).length, 0)} subtests that do not pass`);
