import { generateCases } from "/Users/dylanc/code/bun-regex-tests/test/js/web/regex/differential/generator.mjs";
import { executeCase, canonicalJson } from "/Users/dylanc/code/bun-regex-tests/test/js/web/regex/differential/execute.mjs";
const out = typeof print === "function" ? print : console.log;
const caps = JSON.parse(globalThis.CAPS).capabilities;
const cases = generateCases(globalThis.SEED, globalThis.IDX + 1, { capabilities: caps });
out(canonicalJson(executeCase(cases[globalThis.IDX])));
