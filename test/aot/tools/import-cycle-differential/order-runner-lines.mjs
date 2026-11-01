// Usage: bun order-runner-lines.mjs <results.json>...   Puts the lines of the test runner behind the lines of the program and decides the state again.
import { readFileSync, writeFileSync } from "node:fs";
for (const file of process.argv.slice(2)) {
  const results = JSON.parse(readFileSync(file, "utf8"));
  const order = text => {
    const lines = text.split("\n");
    const exit = lines.pop();
    const ofRunner = line => /^(\((pass|fail)\)|error|\s+at )/.test(line);
    return [...lines.filter(line => !ofRunner(line)), ...lines.filter(ofRunner), exit].join("\n");
  };
  for (const r of results) {
    if (!r.plain) continue;
    r.plain = order(r.plain);
    r.aot = order(r.aot);
    r.state = r.plain === r.aot ? "same" : "different";
  }
  writeFileSync(file, JSON.stringify(results, null, 1));
  console.log(file, results.filter(r => r.state === "same").length, "same", results.filter(r => r.state === "different").length, "different");
}
