import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/30840
//
// `AtomicCell<*mut T>` / `AtomicCell<Option<NonNull<T>>>` were used as an
// ad-hoc `AtomicPtr<T>`, routing pointers through the generic width-
// dispatched `Atom` machinery instead of the standard type designed for
// atomic pointers. The fix adds `bun_core::AtomicPtrCell<T>` (a thin
// `#[repr(transparent)]` newtype over `core::sync::atomic::AtomicPtr<T>`)
// and **removes** the pointer `Atom` impls so `AtomicCell<ptr>` no longer
// compiles.
//
// This is a semantics-preserving refactor — the old impls already routed
// straight to `AtomicPtr` with identical orderings — so there is no
// runtime-observable difference to assert. The observable change is at
// compile time: pointer types are no longer `Atom`. This test enforces
// that invariant at the source level (same spirit as `ban-words.test.ts`)
// so the pattern can't regress.

const atomicCellPath = join(import.meta.dir, "../../src/bun_core/atomic_cell.rs");
const src = readFileSync(atomicCellPath, "utf8");

test("pointer types are not Atom (use AtomicPtrCell instead)", () => {
  // `unsafe impl<U> Atom for *mut U` / `*const U` / `Option<NonNull<U>>`
  // must not exist — pointers go through `AtomicPtrCell<T>` which wraps
  // `core::sync::atomic::AtomicPtr<T>` directly. Match is whitespace-
  // tolerant so `cargo fmt` reflows don't produce false negatives.
  const ptrAtomImpl = /impl\s*<[^>]*>\s*Atom\s+for\s+(?:\*\s*(?:mut|const)|Option\s*<\s*NonNull)/;
  expect(src).not.toMatch(ptrAtomImpl);
});

test("AtomicPtrCell<T> is the pointer counterpart to AtomicCell", () => {
  // The dedicated type must exist and wrap `AtomicPtr<T>` transparently —
  // that's what makes the storage the purpose-built std type rather than
  // an `UnsafeCell` + width dispatch.
  expect(src).toMatch(/pub\s+struct\s+AtomicPtrCell\s*<\s*T\s*>\s*\(\s*AtomicPtr\s*<\s*T\s*>\s*\)/);
});
