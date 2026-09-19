// Run the generated neighborhood corpus in the CURRENT engine and report every
// case whose result differs from the recorded (node/V8) expectation. Used to
// (re)compute the known-divergence list consumed by regex-neighbors.test.ts.
//
//   bun check-neighbors.mjs         # human-readable report
//   bun check-neighbors.mjs --json  # machine-readable list of names

import { neighbors } from "./neighbors.generated.mjs";
import { tryEvaluate } from "./regressions-eval.mjs";

const json = process.argv.includes("--json");
const divergent = [];
for (const c of neighbors) {
  const got = tryEvaluate(c);
  const gotJson = JSON.stringify(got.value !== undefined ? got.value : { error: got.error });
  if (gotJson !== JSON.stringify(c.expected)) {
    divergent.push({
      name: c.name,
      source: c.source,
      flags: c.flags,
      input: c.input,
      op: c.op,
      expected: c.expected,
      actual: got.value !== undefined ? got.value : { error: got.error },
    });
  }
}
if (json) {
  console.log(JSON.stringify(divergent, null, 1));
} else {
  for (const d of divergent) {
    console.log(`${d.name}: /${d.source}/${d.flags} on ${JSON.stringify(d.input)} (${d.op})`);
    console.log(`  expected(v8): ${JSON.stringify(d.expected)}`);
    console.log(`  actual      : ${JSON.stringify(d.actual)}`);
  }
  console.log(`\n${divergent.length}/${neighbors.length} neighbors diverge`);
}
