// Source-level guard for the `Store::data_mut` soundness contract
// (oven-sh/bun#30800).
//
// `Store::data_mut(this: &RefPtr<Store>) -> &mut Data` hands out a mutable
// borrow through a shared, clonable handle; `Store` is `Send + Sync`, so
// cloned handles on two threads could each mint `&mut Data` to the same heap
// allocation through a safe API — immediate UB. The fix makes `data_mut` an
// `unsafe fn` whose precondition is borrow exclusivity, discharged in writing
// at every call site. Like its sibling `dead-code-escapes.test.ts`, this test
// asserts on the source text: a readable failure message for a contract the
// type system cannot express.
// (Booleans are extracted first so a failure prints `true`/`false`, not the
// whole file.)

import { expect, test } from "bun:test";
import path from "path";

const root = path.resolve(import.meta.dir, "..", "..", "..");
const source = await Bun.file(path.join(root, "src", "jsc", "webcore_types.rs")).text();

test("Store::data_mut is an unsafe fn", () => {
  // The precondition-bearing signature: every call site must assert, in an
  // `unsafe` block, that no aliasing `&`/`&mut` to the pointee is live.
  const hasUnsafeDataMut = /pub unsafe fn data_mut\s*\(\s*this\s*:\s*&RefPtr<Store>\s*\)/.test(source);
  expect(hasUnsafeDataMut).toBe(true);
});

test("the pre-#30800 safe data_mut spelling is absent", () => {
  // Anchored to the start of a line (`^\s*pub fn`) so `// `-prefixed prose
  // can never match.
  const hasSafeDataMut = /^\s*pub fn data_mut\s*\(/m.test(source);
  expect(hasSafeDataMut).toBe(false);
});
