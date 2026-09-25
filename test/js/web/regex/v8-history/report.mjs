// Run the V8 fix-history corpus in the CURRENT engine and report every case
// whose result differs from the recorded V8 expectation.
//
//   node report.mjs          # oracle sanity: only requiresNewerV8 cases should differ
//   bun  report.mjs          # bun/JSC divergences (candidates for known-failures)
//   bun  report.mjs --json   # machine-readable
import { v8HistoryCases } from "./cases.generated.mjs";
import { tryEvaluateHistoryCase } from "./v8-history-eval.mjs";

const json = process.argv.includes("--json");
const rows = [];
for (const c of v8HistoryCases) {
  const got = tryEvaluateHistoryCase(c);
  const actual = got.value !== undefined ? got.value : { error: got.error };
  if (JSON.stringify(actual) !== JSON.stringify(c.expected)) {
    rows.push({
      name: c.name,
      source: c.source,
      flags: c.flags,
      input: c.input,
      op: c.op,
      expected: c.expected,
      actual,
      requiresNewerV8: !!c.requiresNewerV8,
      v8Test: c.v8Test,
      v8Commit: c.v8Commit,
    });
  }
}
if (json) {
  console.log(JSON.stringify(rows, null, 1));
} else {
  for (const r of rows) {
    console.log(
      `${r.requiresNewerV8 ? "[newer-v8] " : ""}${r.name}: /${r.source}/${r.flags} ${JSON.stringify(r.input)} ${r.op}`,
    );
    console.log(`    expected: ${JSON.stringify(r.expected)}`);
    console.log(`    actual  : ${JSON.stringify(r.actual)}`);
  }
  console.log(`\n${rows.length}/${v8HistoryCases.length} cases differ from the V8 expectation`);
}
