// Compares the results of run-directory.js with those of run-in-browsers.js, test by test.
//
//   bun compare-with-browsers.js <bun:dom results, made with --all-subtests> <browser results> [--differences]
import { readResults } from "./summarize.js";

const [ourFile, browserFile] = process.argv.slice(2).filter(argument => !argument.startsWith("--"));
const listDifferences = process.argv.includes("--differences");
const read = readResults;

const ours = new Map(read(ourFile).filter(result => result.subtests).map(result => [result.test, result]));
const browsers = Map.groupBy(read(browserFile), result => result.browser);
const names = result => result.subtests.map(subtest => subtest.name).sort().join("\n");
const passes = result => result.subtests.filter(subtest => subtest.status === "PASS").length;

console.log("browser | files | all pass | subtests | PASS | same subtest names as bun:dom | same names and results");
for (const [browser, results] of browsers) {
  const ran = results.filter(result => result.status !== "SKIPPED" && ours.has(result.test));
  const sameNames = ran.filter(result => names(result) === names(ours.get(result.test)));
  const status = result => JSON.stringify(result.subtests.map(subtest => [subtest.name, subtest.status]).sort());
  console.log(
    [
      browser,
      ran.length,
      ran.filter(result => result.status === "OK" && passes(result) === result.subtests.length).length,
      ran.reduce((sum, result) => sum + result.subtests.length, 0),
      ran.reduce((sum, result) => sum + passes(result), 0),
      sameNames.length,
      sameNames.filter(result => status(result) === status(ours.get(result.test))).length,
    ].join(" | "),
  );
}

if (listDifferences) {
  for (const [test, result] of [...ours].sort()) {
    const others = [...browsers.values()].map(results => results.find(other => other.test === test)).filter(Boolean);
    for (const subtest of result.subtests) {
      if (subtest.status === "PASS") continue;
      const verdicts = others.map(other => `${other.browser.split(" ")[0]} ${other.subtests.find(({ name }) => name === subtest.name)?.status ?? "-"}`);
      console.log(`${test} | ${subtest.name} | bun:dom ${subtest.status} | ${verdicts.join(" | ")}`);
    }
  }
}
