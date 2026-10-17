// Prints a table of the results that run-directory.js wrote: one row per directory, then the files that did not finish.
// "only WebKit" counts the subtests that pass in WebKit's own `-expected.txt` and not here.
//
//   bun summarize.js <results.jsonl or .jsonl.gz>... [--depth=<number>] [--failures] [--only-webkit]
import { readFileSync } from "node:fs";

const files = process.argv.slice(2).filter(argument => !argument.startsWith("--"));
const depth = Number(process.argv.find(argument => argument.startsWith("--depth="))?.split("=")[1] ?? Infinity);
const listFailures = process.argv.includes("--failures");
const onlyWebKit = process.argv.includes("--only-webkit");

export function readResults(file) {
  const bytes = readFileSync(file);
  const text = file.endsWith(".gz") ? new TextDecoder().decode(Bun.gunzipSync(bytes)) : bytes.toString();
  return text.split("\n").filter(Boolean).map(line => JSON.parse(line));
}

if (import.meta.main) {
  const results = files.flatMap(readResults).sort((a, b) => (a.test < b.test ? -1 : 1));
  const columns = ["files", "skipped", "not OK", "subtests", "PASS", "FAIL", "TIMEOUT", "NOTRUN", "WebKit subtests", "WebKit PASS", "only WebKit"];
  const rows = new Map();
  const rowFor = name => rows.getOrInsertComputed(name, () => Object.fromEntries(columns.map(column => [column, 0])));

  for (const result of results) {
    const directory = result.test.slice(1, result.test.lastIndexOf("/")).split("/").slice(0, depth).join("/");
    for (const row of [rowFor(directory), rowFor("total")]) {
      if (result.status === "SKIPPED") {
        row.skipped++;
        continue;
      }
      row.files++;
      if (result.status !== "OK") row["not OK"]++;
      for (const [status, count] of Object.entries(result.counts)) {
        row.subtests += count;
        if (status in row) row[status] += count;
      }
      row["WebKit subtests"] += result.webkit?.total ?? 0;
      row["WebKit PASS"] += result.webkit?.passed ?? 0;
      row["only WebKit"] += result.failures.filter(failure => failure.webkit === "PASS").length + (result.webkit?.missingHere.length ?? 0);
    }
  }

  const total = rows.get("total");
  rows.delete("total");
  rows.set("total", total);
  const width = Math.max(...[...rows.keys()].map(name => name.length));
  console.log(["directory".padEnd(width), ...columns].join(" | "));
  for (const [name, row] of rows) console.log([name.padEnd(width), ...columns.map(column => String(row[column]).padStart(column.length))].join(" | "));

  if (listFailures) {
    for (const result of results) {
      if (result.status === "SKIPPED") continue;
      const failures = result.failures.filter(failure => !onlyWebKit || failure.webkit === "PASS");
      const missing = result.webkit?.missingHere ?? [];
      if (!failures.length && !missing.length && (result.status === "OK" || onlyWebKit)) continue;
      console.log(`\n${result.test}: ${result.status}${result.message ? ` (${result.message.split("\n")[0].slice(0, 150)})` : ""}, ${result.counts.PASS ?? 0} pass`);
      for (const failure of failures) console.log(`  ${failure.status} [WebKit ${failure.webkit}] ${failure.name}: ${String(failure.message).split("\n")[0].slice(0, 220)}`);
      if (missing.length) console.log(`  never reported here, pass in WebKit: ${missing.length} (${missing.slice(0, 3).join(" | ").slice(0, 200)})`);
    }
  }
}
