// Source-text soundness lint for oven-sh/bun#31974.
//
// `bun_http::zlib::put(&mut MutableString)` was a safe `pub fn` that
// reinterpreted its argument as the `data` field of an `ObjectPool` node
// (`#[repr(transparent)]` cast, then `ObjectPool::release_value`, which
// rebuilds the parent `Node<T>` pointer with `from_field_ptr!` offset
// arithmetic) and linked it into the pool's free list. Calling it with any
// `MutableString` that did not come from that pool is undefined behavior:
// out-of-bounds pointer arithmetic, a `next`-link write through the bogus
// node pointer, and eventually `Box::from_raw` on memory that was never a
// `Node<T>` allocation. `ObjectPool::release_value` itself had the same
// defect one layer down: a safe `pub fn` whose correctness depended on an
// unchecked "points into a live pool node" contract.
//
// Both functions had zero callers, so the fix deletes them (along with the
// whole `http::zlib` module). The remaining ways to hand a value back to an
// `ObjectPool` are `PoolGuard`'s `Drop` and the by-value `push(T)`; the
// node-based `release` stays, but only as an `unsafe fn` with a documented
// contract.
//
// The misuse is only expressible from Rust (nothing reachable from JS calls
// these functions), so there is no runtime reproduction to test. This file
// pins the invariant at the source-text layer instead — same pattern and
// `test/internal/` placement as `ban-words.test.ts`.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");

// Whitespace-tolerant: only the presence/absence of the signatures matters,
// not formatting.
function normalizedSource(relative: string): string {
  return readFileSync(join(repoRoot, relative), "utf8").replace(/\s+/g, " ");
}

test("ObjectPool has no safe release-by-reference API (#31974)", () => {
  const pool = normalizedSource("src/collections/pool.rs");

  // Recovering a Node<T> from a caller-supplied &mut T cannot be a safe fn:
  // nothing checks that the reference actually points into a pool node.
  expect(pool).not.toMatch(/\bpub\s+fn\s+release_value\b/);

  // The node-based release keeps its unchecked precondition, so it must stay
  // `unsafe fn`. (`\brelease\b` does not match `release_value`: `_` is a word
  // character, so there is no word boundary between them.)
  expect(pool).toMatch(/\bpub\s+unsafe\s+fn\s+release\b/);
  expect(pool).not.toMatch(/\bpub\s+fn\s+release\b/);
});

test("bun_http does not declare the zlib buffer-pool module (#31974)", () => {
  // The module's release path (`put`) safely adopted arbitrary
  // `&mut MutableString` values as pool entries; it had zero callers and was
  // deleted. Asserted via the module declaration in lib.rs rather than the
  // existence of src/http/zlib.rs: a file on disk that no `mod` declaration
  // references is not part of the crate (and stash/checkout round-trips can
  // leave stray copies of deleted files in the working tree). If the module
  // is ever reintroduced, its release path must take ownership (PoolGuard or
  // by-value) instead of adopting a caller-supplied reference — then update
  // this lint.
  const lib = normalizedSource("src/http/lib.rs");
  expect(lib).not.toMatch(/\bmod\s+zlib\b/);
});
