// bun-fuzz: when a style rule's selector list has to be split into one rule
// per selector because the targets support neither the selectors as written
// nor `:is()`, the minifier moved the selectors out of the list one at a time
// from the front and drained the two follow-up lists the same way. Each removal
// shifted the rest of the list, so a rule with n such selectors was O(n^2).
// Every selector of a nested rule is target-incompatible when nesting has to
// be compiled away, which the default `bun build` targets require, so a 120 KB
// nested rule with 16k selectors took 6 s to build.
import { cssInternals } from "bun:internal-for-testing";
import { expect, test } from "bun:test";

const { minifyTest } = cssInternals;

// Supports neither CSS nesting nor :is(), like the default bundler targets.
const OLD_TARGETS = { chrome: 80 << 16 };

/**
 * Best-of timing. Repeats only while a run is cheap, so a release build takes
 * several samples and a debug build takes one.
 */
function bench(run: () => string): { ms: number; out: string } {
  let ms = Infinity;
  let spent = 0;
  let out = "";
  for (let i = 0; i < 5 && spent < 400; i++) {
    const start = performance.now();
    out = run();
    const elapsed = performance.now() - start;
    ms = Math.min(ms, elapsed);
    spent += elapsed;
  }
  return { ms, out };
}

test("splitting target-incompatible selectors out of a rule keeps both halves in source order", () => {
  // Chrome 60 supports neither :is() nor :focus-visible.
  expect(minifyTest(".a,.b:focus-visible,.c,.d:focus-visible,.e{color:red}", "", { chrome: 60 << 16 })).toBe(
    ".a,.c,.e{color:red}.b:focus-visible{color:red}.d:focus-visible{color:red}",
  );
  expect(minifyTest(".p{.a,.b:focus-visible,.c{color:red}}", "", { chrome: 60 << 16 })).toBe(
    ".p .a{color:red}.p .b:focus-visible{color:red}.p .c{color:red}",
  );
});

test("splitting a long nested selector list into separate rules is linear", () => {
  // The nested rule is timed against the same selector list as a top-level
  // rule, which has nothing to split, so the check does not depend on how fast
  // the machine is.
  const n = 50_000;
  // ".c0,.c1,…": join() formats the numbers natively. Building 50k strings in
  // a JS loop takes over a second in a debug build.
  const list = ".c" + [...Array(n).keys()].join(",.c");
  const flat = bench(() => minifyTest(".a{.b{top:0}}" + list + "{top:0}", "", OLD_TARGETS));
  const nested = bench(() => minifyTest(".a{" + list + "{top:0}}", "", OLD_TARGETS));

  expect(flat.out).toStartWith(".a .b{top:0}.c0,.c1,.c2,");
  expect(nested.out).toStartWith(".a .c0{top:0}.a .c1{top:0}.a .c2{top:0}");
  expect(nested.out).toEndWith(`.a .c${n - 1}{top:0}`);

  // 2x to 4x with the fix (the nested rule emits n rules instead of one);
  // 19x (debug) to 1000x+ (release) before it.
  expect(nested.ms / flat.ms).toBeLessThan(8);
});
