// bun-fuzz: when a style rule's selector list has to be split into one rule
// per selector because the targets support neither the selectors as written
// nor `:is()`, the minifier moved the selectors out of the list one at a time
// from the front and drained the two follow-up lists the same way. Each removal
// shifted the rest of the list, so a rule with n such selectors was O(n^2).
// Every selector of a nested rule is target-incompatible when nesting has to
// be compiled away, which the default `bun build` targets require, so a 120 KB
// nested rule with 16k selectors took 6 s to build.
//
// The nested rule is timed against the same selector list as a top-level rule
// (nothing to split), so the check does not depend on machine speed.
import { cssInternals } from "bun:internal-for-testing";
import { expect, test } from "bun:test";

// Supports neither CSS nesting nor :is(), like the default bundler targets.
const OLD_TARGETS = { chrome: 80 << 16 };

/** Best-of timing; repeats while cheap so release builds get several samples. */
function bench(run: () => unknown, maxRuns = 5, budgetMs = 2000): number {
  let best = Infinity;
  let spent = 0;
  for (let i = 0; i < maxRuns && spent < budgetMs; i++) {
    const start = performance.now();
    run();
    const elapsed = performance.now() - start;
    best = Math.min(best, elapsed);
    spent += elapsed;
  }
  return best;
}

test("splitting a long nested selector list into separate rules is linear", () => {
  const n = 60_000;
  const list = Array.from({ length: n }, (_, i) => ".c" + i.toString(36)).join(",");
  const nested = ".a{" + list + "{top:0}}";
  const flat = ".a{.b{top:0}}" + list + "{top:0}";

  const out = cssInternals.minifyTest(nested, "", OLD_TARGETS);
  expect(out).toStartWith(".a .c0{top:0}.a .c1{top:0}.a .c2{top:0}");
  expect(out).toEndWith(`.a .c${(n - 1).toString(36)}{top:0}`);
  expect(cssInternals.minifyTest(flat, "", OLD_TARGETS)).toStartWith(".a .b{top:0}.c0,.c1,.c2,");

  const flatMs = bench(() => cssInternals.minifyTest(flat, "", OLD_TARGETS));
  const nestedMs = bench(() => cssInternals.minifyTest(nested, "", OLD_TARGETS));
  // 2x to 4x with the fix (the nested rule emits n rules instead of one);
  // 20x (debug) to 1000x+ (release) before it.
  expect(nestedMs / flatMs).toBeLessThan(8);
}, 90_000);
