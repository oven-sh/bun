// jsc-shell wrapper for run.mjs's generator/executor: same case stream, engine = this jsc.
import { probeCapabilities } from "/Users/dylanc/code/bun-regex-tests/test/js/web/regex/differential/capabilities.mjs";
import { canonicalJson, executeCase } from "/Users/dylanc/code/bun-regex-tests/test/js/web/regex/differential/execute.mjs";
import { generateCases } from "/Users/dylanc/code/bun-regex-tests/test/js/web/regex/differential/generator.mjs";
const [seed, count, capsJson] = [Number(globalThis.SEED), Number(globalThis.COUNT), globalThis.CAPS];
const capabilities = capsJson ? JSON.parse(capsJson).capabilities : probeCapabilities();
print(canonicalJson({ capabilities, seed, count }));
const cases = generateCases(seed, count, { capabilities });
for (let i = 0; i < cases.length; i++) print(canonicalJson({ index: i, record: executeCase(cases[i]) }));
