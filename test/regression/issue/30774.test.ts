// https://github.com/oven-sh/bun/issues/30774
//
// `ThreadPool::Batch::pop` used to pointer-cast `&raw const self.len` (a plain
// `usize` field) to `*const AtomicUsize` and call `.load(Ordering::Relaxed)`.
// That's a mechanical port of Zig's `@atomicLoad(usize, &this.len, .monotonic)`,
// but it is UB under Rust's memory model: `AtomicUsize` wraps
// `UnsafeCell<usize>` and the two types are not interchangeable via a pointer
// cast for atomic operations — even at `Ordering::Relaxed`. `Batch` is not
// shared across threads (`pop` takes `&mut self`; all mutations of `len` go
// through `&mut self`), so the atomic is unnecessary to begin with.
//
// This UB is latent: relaxed atomic load of a `usize` compiles to the same
// machine code as a plain load on x86 and AArch64, so there is no runtime
// reproducer a black-box test can drive. To still guard the fix against a
// mechanical-port regression, this test inspects `src/threading/ThreadPool.rs`
// directly and asserts the UB construct is absent from `Batch::pop`. Unit
// tests in `src/threading/ThreadPool.rs` (`batch_tests`) cover the functional
// behavior of `Batch::pop` / `Batch::push`.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

test("Batch::pop does not cast &self.len to *const AtomicUsize for the zero check", () => {
  const src = readFileSync(
    join(import.meta.dir, "../../../src/threading/ThreadPool.rs"),
    "utf8",
  );

  // Narrow to the `Batch::pop` function body. `pub struct Batch` precedes
  // `impl Batch`; `pub fn pop` is the first fn inside.
  const popMatch = src.match(
    /impl Batch\s*\{[\s\S]*?pub fn pop\([^)]*\)[^{]*\{([\s\S]*?)^    \}/m,
  );
  expect(popMatch, "could not locate Batch::pop in ThreadPool.rs").not.toBeNull();
  const popBody = popMatch![1];

  // The UB pattern: `(&raw const self.len).cast::<AtomicUsize>()` — forming an
  // AtomicUsize reference from the plain-usize `len` field for an atomic load.
  expect(popBody).not.toMatch(/&raw const self\.len.*cast::<AtomicUsize>/s);
  expect(popBody).not.toMatch(/\.cast::<AtomicUsize>\(\)\s*\)\s*\.load/s);

  // Positive: the fix reads `self.len` directly.
  expect(popBody).toMatch(/let\s+len\s*=\s*self\.len\s*;/);
});
