// Neighborhood corpus: variants derived around every pinned regression case
// (adjacent flags, quantifier tweaks, anchors, greedy/lazy, capture toggles,
// input perturbations), with expectations recorded from node/V8 by
// differential/expand-neighbors.mjs. Regenerate the corpus with:
//
//   node test/js/web/regex/differential/expand-neighbors.mjs \
//     > test/js/web/regex/differential/neighbors.generated.mjs
//
// and see which entries the current bun disagrees with via
// `bun test/js/web/regex/differential/check-neighbors.mjs`.
import { expect, test } from "bun:test";
import { neighbors } from "./differential/neighbors.generated.mjs";
import { tryEvaluate } from "./differential/regressions-eval.mjs";

// Neighbors known to hit current bun/JSC bugs (name -> current wrong result).
// Empty today; entries added here are asserted to still be wrong so that an
// engine fix flips them to an unexpected pass.
const knownDivergent: Record<string, unknown> = {};

test("regex neighborhood corpus matches node/V8", () => {
  const mismatches: string[] = [];
  for (const c of neighbors) {
    const got = tryEvaluate(c);
    const actual = got.value !== undefined ? got.value : { error: got.error };
    const expected = c.name in knownDivergent ? knownDivergent[c.name] : c.expected;
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      mismatches.push(
        `${c.name}: /${c.source}/${c.flags} on ${JSON.stringify(c.input)} (${c.op})\n` +
          `    expected: ${JSON.stringify(expected)}\n    actual  : ${JSON.stringify(actual)}`,
      );
    }
  }
  expect(mismatches).toEqual([]);
});
