// https://github.com/oven-sh/bun/issues/30772

import { cssInternals } from "bun:internal-for-testing";
import { expect, test } from "bun:test";

test("IdentOrRef::hash distinguishes distinct refs and is invariant over debug-only ptrbits", () => {
  const [h_a, h_a_dup, h_b, h_b_dup] = cssInternals.identOrRefHashRefs(
    /* aInner  */ 1,
    /* aSource */ 0,
    /* bInner  */ 2,
    /* bSource */ 0,
  );

  // Equal refs must hash identically — in debug builds this is only true if
  // the hash ignores the per-construction debug-ident heap address.
  expect(h_a).toBe(h_a_dup);
  expect(h_b).toBe(h_b_dup);

  // Distinct refs must hash distinctly. The binding folds each hash to 30
  // bits (~2^-30 per-pair collision probability), and the inputs are
  // deterministic, so a passing run stays passing.
  expect(h_a).not.toBe(h_b);
});

test("IdentOrRef::hash over many distinct refs yields many distinct hashes", () => {
  const hashes = new Set<number>();
  for (let i = 1; i <= 16; i++) {
    const [h] = cssInternals.identOrRefHashRefs(i, 0, i, 0);
    hashes.add(h);
  }
  expect(hashes.size).toBe(16);
});
