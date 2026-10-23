// Pinned RegExp regression corpus. Every case in differential/regressions.mjs
// is a real engine divergence found by the differential harness (or a
// documented invariant), with a spec-correct `expected` that is mechanically
// verified against node/V8 by check-regressions-under-node.mjs.
import { describe, expect, test } from "bun:test";
import { tryEvaluate } from "./differential/regressions-eval.mjs";
import { cases, knownBunFailures } from "./differential/regressions.mjs";

describe("regex regressions", () => {
  for (const c of cases) {
    test(`${c.name}: /${c.source}/${c.flags} on ${JSON.stringify(c.input)}`, () => {
      const got = tryEvaluate(c);
      expect(got.error).toBeUndefined();
      expect(got.value).toEqual(c.expected);
    });
  }
});

// Documented current failures. Each asserts the CURRENT (wrong) bun result so
// the suite stays green while the bug exists, and flips to a failure the day
// the engine is fixed -- at which point move the case into `cases` above.
describe("regex known bun/JSC divergences", () => {
  for (const c of knownBunFailures) {
    test(`(known failure) ${c.name}: /${c.source}/${c.flags} on ${JSON.stringify(c.input)}`, () => {
      const got = tryEvaluate(c);
      const actual = JSON.stringify(got.value);
      if (c.tierDependent) {
        // JIT and interpreter disagree; accept either the fixed or the broken
        // result but never anything else.
        expect([JSON.stringify(c.expected), JSON.stringify(c.currentBun)]).toContain(actual);
        return;
      }
      // Compare canonical JSON: results include values like a 2^64
      // lastIndex that do not survive structural equality on doubles.
      expect(actual).toBe(JSON.stringify(c.currentBun));
    });
  }
});
