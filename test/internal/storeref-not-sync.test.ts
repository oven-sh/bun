// Source-level guard for the `StoreRef` soundness contract (oven-sh/bun#30800).
//
// `StoreRef::data_mut(&self) -> &mut Data` hands out a mutable borrow through
// a shared, clonable handle. Combined with `unsafe impl Sync for StoreRef`,
// two threads sharing `&StoreRef` could each mint `&mut Data` to the same
// heap allocation through a safe API — immediate UB. The fix keeps `Send`
// (move-based cross-thread use), drops `Sync`, makes `data_mut` an
// `unsafe fn` whose precondition is borrow exclusivity, and adds the
// `__store_ref_not_sync` compile-time trip-wire so a future
// `unsafe impl Sync for StoreRef` fails the build with conflicting impls.
//
// The trip-wire catches regressions at compile time; this test is the
// suite-level projection of the same invariants, with a readable failure
// message instead of a rustc diagnostic. Like
// `test/internal/dead-code-escapes.test.ts`, it asserts on the source text.
// (Booleans are extracted first so a failure prints `true`/`false`, not the
// whole file.)

import { expect, test } from "bun:test";
import path from "path";

const root = path.resolve(import.meta.dir, "..", "..");
const source = await Bun.file(path.join(root, "src", "jsc", "webcore_types.rs")).text();

test("StoreRef does not implement Sync", () => {
  // The original #30800 hole. Cross-thread mutation must go through cloned
  // (moved) handles whose call sites discharge `data_mut`'s exclusivity
  // precondition — never through a shared `&StoreRef`.
  //
  // Anchored to the start of a line (`^\s*unsafe`) so `// `-prefixed prose —
  // e.g. the trip-wire comment in `webcore_types.rs`, which quotes the exact
  // phrase — can never match.
  const hasSyncImpl = /^\s*unsafe impl\s+Sync\s+for\s+StoreRef\b/m.test(source);
  expect(hasSyncImpl).toBe(false);
});

test("StoreRef::data_mut is an unsafe fn", () => {
  // The precondition-bearing signature: every call site must assert, in an
  // `unsafe` block, that no aliasing `&`/`&mut` to the pointee is live.
  const hasUnsafeDataMut = /pub unsafe fn data_mut\s*\(\s*&self\s*\)/.test(source);
  expect(hasUnsafeDataMut).toBe(true);
  // And the pre-#30800 safe spelling must not come back.
  const hasSafeDataMut = /pub fn data_mut\s*\(\s*&self\s*\)/.test(source);
  expect(hasSafeDataMut).toBe(false);
});

test("the __store_ref_not_sync compile-time trip-wire is present", () => {
  // If `StoreRef` ever gains `Sync`, both blanket impls of `_NotSyncCheck`
  // apply and the trip-wire const fails to compile with conflicting impls.
  const hasTripWireModule = source.includes("mod __store_ref_not_sync");
  expect(hasTripWireModule).toBe(true);
  const hasTripWireConst = /<StoreRef as _NotSyncCheck<_>>::OK/.test(source);
  expect(hasTripWireConst).toBe(true);
});
