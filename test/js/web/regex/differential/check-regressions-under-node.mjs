// Validate regressions.mjs expectations against node (V8): every `cases`
// entry must produce exactly its `expected`, and every `knownBunFailures`
// entry must produce its `expected` under node too (proving the expectation
// is the spec/V8 behaviour and only bun diverges).
//
//   node test/js/web/regex/differential/check-regressions-under-node.mjs

import { cases, knownBunFailures } from "./regressions.mjs";
import { tryEvaluate } from "./regressions-eval.mjs";

let failures = 0;
for (const c of [...cases, ...knownBunFailures]) {
  const got = tryEvaluate(c);
  const gotJson = JSON.stringify(got.value !== undefined ? got.value : { error: got.error });
  const wantJson = JSON.stringify(c.expected);
  if (gotJson !== wantJson) {
    failures++;
    console.log(`MISMATCH ${c.name}: /${c.source}/${c.flags} ${JSON.stringify(c.input)} op=${c.op}`);
    console.log(`  expected: ${wantJson}`);
    console.log(`  node    : ${gotJson}`);
  }
}
if (failures) {
  console.log(`\n${failures} expectation(s) disagree with node`);
  process.exit(1);
}
console.log(`all ${cases.length + knownBunFailures.length} expectations match node`);
