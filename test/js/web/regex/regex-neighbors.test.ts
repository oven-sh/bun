// Neighborhood corpus: variants derived around every pinned regression case
// (adjacent flags, quantifier tweaks, anchors, greedy/lazy, capture toggles,
// input perturbations), with expectations recorded from node/V8 by
// differential/expand-neighbors.mjs.
//
// Two lineages:
//  - neighbors of the PASSING corpus must match V8 exactly;
//  - neighbors of KNOWN bun failures (name starts with "known:") map the
//    extent of each engine bug: each must be either V8's answer (the bug got
//    fixed for that variant) or its recorded current-bun answer from
//    known-lineage-current.generated.json. Any third result is a change in
//    behaviour that must be looked at.
//
// Regenerate after editing regressions.mjs:
//   node test/js/web/regex/differential/expand-neighbors.mjs \
//     > test/js/web/regex/differential/neighbors.generated.mjs
//   bun test/js/web/regex/differential/check-neighbors.mjs --json | \
//     <update known-lineage-current.generated.json>
import { expect, test } from "bun:test";
import knownLineageCurrent from "./differential/known-lineage-current.generated.json";
import { neighbors } from "./differential/neighbors.generated.mjs";
import { tryEvaluate } from "./differential/regressions-eval.mjs";

const recorded = knownLineageCurrent as Record<string, unknown>;

test("regex neighborhood corpus matches node/V8", () => {
  const mismatches: string[] = [];
  const nowFixed: string[] = [];
  for (const c of neighbors) {
    const got = tryEvaluate(c);
    const actual = JSON.stringify(got.value !== undefined ? got.value : { error: got.error });
    const expected = JSON.stringify(c.expected);
    if (actual === expected) {
      // A known-lineage neighbor that now matches V8 means part of that bug is
      // fixed: report it so the recorded value can be dropped.
      if (c.name in recorded) nowFixed.push(c.name);
      continue;
    }
    if (c.name in recorded) {
      if (actual !== JSON.stringify(recorded[c.name])) {
        mismatches.push(
          `${c.name}: /${c.source}/${c.flags} on ${JSON.stringify(c.input)} (${c.op}) changed:\n` +
            `    v8      : ${expected}\n    recorded: ${JSON.stringify(recorded[c.name])}\n    actual  : ${actual}`,
        );
      }
      continue;
    }
    mismatches.push(
      `${c.name}: /${c.source}/${c.flags} on ${JSON.stringify(c.input)} (${c.op})\n` +
        `    expected: ${expected}\n    actual  : ${actual}`,
    );
  }
  if (nowFixed.length) {
    console.warn(
      `note: ${nowFixed.length} known-lineage neighbor(s) now match V8 (engine improved); ` +
        `drop them from known-lineage-current.generated.json:\n  ${nowFixed.join("\n  ")}`,
    );
  }
  expect(mismatches).toEqual([]);
});
