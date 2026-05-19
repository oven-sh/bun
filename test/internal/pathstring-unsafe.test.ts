// Source-text consistency check for oven-sh/bun#30719.
//
// `bun_core::PathString` is a `(ptr, len)` packed int that erases its
// backing slice's lifetime. Before #30719 both `PathString::init` and
// `dir_iterator::next()` were safe `fn`s, so entirely safe Rust could
// produce a dangling `PathString`. The fix marks them `unsafe fn` with
// documented outlives contracts.
//
// The compile_fail doctests on those methods are the *primary* guard:
// `cargo test -p bun_core --doc init` / `-p bun_sys --doc` / `-p bun_runtime
// --doc next` will fail the build if the `unsafe` keyword is ever dropped.
// This file is a belt-and-suspenders lint that pins the same invariant at
// the source-text layer so a reviewer can see it without running cargo.
//
// Same pattern + test/internal/ placement as `ban-words.test.ts` — a
// coding-convention lint, not a behavioral test (no bun APIs are
// exercised). Not placed under `test/regression/issue/` because
// `PathString::init` was unsound from the day the Rust port landed; there
// is no prior release where it worked, so it doesn't meet the "regression"
// bar per CLAUDE.md.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// test/internal/ is one level under repo root (unlike test/regression/issue/).
const repoRoot = join(import.meta.dir, "..", "..");

function normalizedSource(relative: string): string {
  return readFileSync(join(repoRoot, relative), "utf8").replace(/\s+/g, " ");
}

// Whitespace-tolerant so benign refactors don't break the lint; the only
// thing asserted is the `unsafe` keyword on the signature.
const INIT_UNSAFE = /\bpub\s+unsafe\s+fn\s+init\s*\(\s*\w+\s*:\s*&\s*\[\s*u8\s*\]\s*\)\s*->\s*Self\b/;
const INIT_SAFE = /\bpub\s+fn\s+init\s*\(\s*\w+\s*:\s*&\s*\[\s*u8\s*\]\s*\)\s*->\s*Self\b/;

const BUN_SYS_NEXT_UNSAFE =
  /\bpub\s+unsafe\s+fn\s+next\s*\(\s*&\s*mut\s+self\s*\)\s*->\s*Result\s*<\s*Option\s*<\s*IteratorResult\s*>\s*>/;
const BUN_SYS_NEXT_SAFE =
  /\bpub\s+fn\s+next\s*\(\s*&\s*mut\s+self\s*\)\s*->\s*Result\s*<\s*Option\s*<\s*IteratorResult\s*>\s*>/;

// `Result` for POSIX and `ResultW` for Windows — `W?` covers both.
const NODE_DIR_NEXT_UNSAFE = /\bpub\s+unsafe\s+fn\s+next\s*\(\s*&\s*mut\s+self\s*\)\s*->\s*ResultW?\b/;
const NODE_DIR_NEXT_SAFE = /\bpub\s+fn\s+next\s*\(\s*&\s*mut\s+self\s*\)\s*->\s*ResultW?\b/;

test("PathString::init is declared unsafe (soundness invariant for #30719)", () => {
  const normalized = normalizedSource("src/bun_core/string/PathString.rs");
  expect(normalized).toMatch(INIT_UNSAFE);
  expect(normalized).not.toMatch(INIT_SAFE);
});

test("bun_sys::dir_iterator::WrappedIterator::next is declared unsafe (#30719)", () => {
  // Returns an `IteratorResult` whose `name: PathString` borrows the
  // iterator's scratch buffer. Marking `next()` unsafe encodes the
  // streaming-iterator contract.
  const normalized = normalizedSource("src/sys/lib.rs");
  expect(normalized).toMatch(BUN_SYS_NEXT_UNSAFE);
  expect(normalized).not.toMatch(BUN_SYS_NEXT_SAFE);
});

test("runtime/node/dir_iterator NewWrappedIterator::next is declared unsafe (#30719)", () => {
  // POSIX returns `Result`, Windows `ResultW`. Reverting any of these to
  // safe `pub fn` would only produce `unused_unsafe` warnings at callers
  // and re-open the streaming-iterator hole — hence the assertion is
  // source-textual and independent of the `bun_sys` one.
  const normalized = normalizedSource("src/runtime/node/dir_iterator.rs");
  expect(normalized).toMatch(NODE_DIR_NEXT_UNSAFE);
  expect(normalized).not.toMatch(NODE_DIR_NEXT_SAFE);
});
