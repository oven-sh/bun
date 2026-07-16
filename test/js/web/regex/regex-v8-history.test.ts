// RegExp cases mined from V8's bug-fix history: 323 concrete assertions
// from 118 fix commits (v8-history/cases.generated.mjs), each carrying its
// originating V8 commit and test file. bun must match the recorded V8
// behaviour, except the handful of documented divergences in
// v8-history/known-bun-results.generated.json (real JSC bugs / limit
// differences, tracked in test/js/third_party/v8-regexp/KNOWN-DIVERGENCES.md),
// which are asserted at their CURRENT bun value so a fix surfaces as a change.
//
//   bun test/js/web/regex/v8-history/report.mjs        # list current divergences
//   node test/js/web/regex/v8-history/report.mjs       # oracle sanity check
import { describe, expect, test } from "bun:test";
import { v8HistoryCases } from "./v8-history/cases.generated.mjs";
import knownBunResults from "./v8-history/known-bun-results.generated.json";
import { tryEvaluateHistoryCase } from "./v8-history/v8-history-eval.mjs";

const known = knownBunResults as Record<string, unknown>;

describe("V8 regexp fix-history corpus", () => {
  for (const c of v8HistoryCases) {
    test(`${c.name} (v8 ${c.v8Commit})`, () => {
      const got = tryEvaluateHistoryCase(c);
      const actual = JSON.stringify(got.value !== undefined ? got.value : { error: got.error });
      if (c.name in known) {
        // Documented bun/JSC divergence: assert it is unchanged (a change means
        // the engine bug was fixed -- drop it from known-bun-results and it
        // must then match the V8 expectation).
        expect(actual).toBe(JSON.stringify(known[c.name]));
        return;
      }
      expect(actual).toBe(JSON.stringify(c.expected));
    });
  }
});
