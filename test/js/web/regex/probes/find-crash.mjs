import { generateCases } from "/Users/dylanc/code/bun-regex-tests/test/js/web/regex/differential/generator.mjs";
import { executeCase } from "/Users/dylanc/code/bun-regex-tests/test/js/web/regex/differential/execute.mjs";
const caps = JSON.parse(globalThis.CAPS).capabilities;
const cases = generateCases(globalThis.SEED, globalThis.COUNT, { capabilities: caps });
for (let i = globalThis.FROM; i < cases.length; i++) {
  // Announce BEFORE running so the last printed case is the killer.
  print("CASE " + i + " " + JSON.stringify({ source: cases[i].source, flags: cases[i].flags, inputs: cases[i].inputs }));
  executeCase(cases[i]);
}
print("ALL DONE");
