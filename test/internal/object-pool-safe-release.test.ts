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
// Both functions had zero callers, so the fix deletes them. The remaining
// ways to hand a value back to an `ObjectPool` are `PoolGuard`'s `Drop` and
// the by-value `push(T)`; the node-based `release` stays, but only as an
// `unsafe fn` with a documented contract.
//
// The misuse is only expressible from Rust (nothing reachable from JS calls
// these functions), so there is no runtime reproduction to test. This file
// pins the invariant at the source-text layer instead — same pattern and
// `test/internal/` placement as `ban-words.test.ts`.

import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");

// Whitespace-tolerant: only the presence/absence of the signatures matters,
// not formatting.
function normalizedSource(absolute: string): string {
  return readFileSync(absolute, "utf8").replace(/\s+/g, " ");
}

test("ObjectPool has no safe release-by-reference API (#31974)", () => {
  const pool = normalizedSource(join(repoRoot, "src/collections/pool.rs"));

  // Recovering a Node<T> from a caller-supplied &mut T cannot be a safe fn:
  // nothing checks that the reference actually points into a pool node.
  expect(pool).not.toMatch(/\bpub\s+fn\s+release_value\b/);

  // The node-based release keeps its unchecked precondition, so it must stay
  // `unsafe fn`. (`\brelease\b` does not match `release_value`: `_` is a word
  // character, so there is no word boundary between them.)
  expect(pool).toMatch(/\bpub\s+unsafe\s+fn\s+release\b/);
  expect(pool).not.toMatch(/\bpub\s+fn\s+release\b/);
});

test("http zlib buffer pool with a safe put(&mut MutableString) stays deleted (#31974)", () => {
  const zlib = join(repoRoot, "src/http/zlib.rs");
  if (!existsSync(zlib)) {
    // Deleted — the fixed state. (The module had zero callers.)
    return;
  }
  // If a pooled-buffer module comes back, its release path must not be a safe
  // fn that adopts an arbitrary `&mut MutableString` as a pool entry.
  expect(normalizedSource(zlib)).not.toMatch(/\bpub\s+fn\s+put\s*\(\s*\w+\s*:\s*&\s*mut\s+MutableString\b/);
});
