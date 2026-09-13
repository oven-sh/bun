// Print the normalized result of every regression + neighborhood + error
// corpus case as JSON lines. Run twice with different engine configuration
// (e.g. BUN_JSC_useRegExpJIT=0 vs default) and compare the streams: the JIT
// and bytecode-interpreter tiers of the regex engine must agree exactly.
import { errorCorpus } from "./error-corpus.mjs";
import { neighbors } from "./neighbors.generated.mjs";
import { tryEvaluate } from "./regressions-eval.mjs";
import { cases, knownBunFailures } from "./regressions.mjs";

for (const c of [...cases, ...knownBunFailures, ...neighbors]) {
  const got = tryEvaluate(c);
  console.log(JSON.stringify({ name: c.name, result: got.value !== undefined ? got.value : { error: got.error } }));
}
for (const [source, flags] of errorCorpus) {
  let result;
  try {
    const re = new RegExp(source, flags);
    result = { ok: String(re) };
  } catch (e) {
    result = { error: e && e.constructor ? e.constructor.name : String(e) };
  }
  console.log(JSON.stringify({ source, flags, result }));
}
