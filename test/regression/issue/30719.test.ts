// https://github.com/oven-sh/bun/issues/30719
//
// `bun_core::PathString::init` packs a `&[u8]`'s (ptr, len) into the
// backing int and returns a `Copy + 'static` value — the backing slice's
// lifetime is erased. With `init` declared as a safe `fn`, entirely safe
// Rust could construct a `PathString` whose `slice()` read freed memory:
//
//   let test = Box::new(*b"Hello World");
//   let init = PathString::init(&*test);
//   drop(test);
//   init.slice();  // UB — dangling &[u8]
//
// The fix makes `init` an `unsafe fn` with a documented outlives
// contract, plus closes the parallel hole in `dir_iterator::next()`
// (which hands out `IteratorResult { name: PathString }` bound to the
// iterator's scratch buffer, invalidated on the next call).
//
// This test asserts both signatures stay `unsafe`. Any revert (or
// accidental un-unsafe-ing) trips this test before review.
//
// Runtime assertion on the source (rather than a JS-observable behavior
// check) because the bug is an API-surface soundness hole — every
// in-tree call site was already sound in practice. The regression
// guarded here is "someone removes `unsafe` and reopens the hole".

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// This test file lives at test/regression/issue/30719.test.ts; the repo
// root is three levels up (issue → regression → test → root).
const repoRoot = join(import.meta.dir, "..", "..", "..");

function normalizedSource(relative: string): string {
  return readFileSync(join(repoRoot, relative), "utf8").replace(/\s+/g, " ");
}

// Regex patterns are intentionally whitespace-tolerant and parameter-name-
// agnostic so benign refactors (rename, reformat) don't break the test;
// the only thing being asserted is the `unsafe` keyword on the signature.
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

  // Positive: unsafe signature is present.
  expect(normalized).toMatch(INIT_UNSAFE);

  // Negative: the plain-safe signature (the bug) is NOT present. If
  // someone drops the `unsafe` keyword, this assertion fires.
  expect(normalized).not.toMatch(INIT_SAFE);
});

test("dir_iterator::next() is declared unsafe (parallel soundness hole for #30719)", () => {
  // `bun_sys::dir_iterator::WrappedIterator::next()` returns an
  // `IteratorResult` whose `name: PathString` borrows the iterator's
  // internal getdents scratch. Calling `next()` again overwrites that
  // buffer. Marking `next()` `unsafe` forces callers to acknowledge the
  // streaming-iterator contract.
  const normalized = normalizedSource("src/sys/lib.rs");

  expect(normalized).toMatch(BUN_SYS_NEXT_UNSAFE);
  expect(normalized).not.toMatch(BUN_SYS_NEXT_SAFE);
});

test("runtime/node/dir_iterator NewWrappedIterator::next is declared unsafe (#30719)", () => {
  // The parallel hole at the higher-tier iterator: `NewWrappedIterator::next`
  // (POSIX `-> Result`, Windows `-> ResultW`) wraps the per-platform
  // `NewIterator::next`. Reverting any of these to safe `pub fn` would
  // only produce `unused_unsafe` warnings at callers and would re-open
  // the streaming-iterator hole — hence this assertion is source-textual,
  // independent of the `bun_sys` one above.
  const normalized = normalizedSource("src/runtime/node/dir_iterator.rs");

  // POSIX / FreeBSD / Linux / macOS / WASI all hit `NewWrappedIterator<false>`.
  expect(normalized).toMatch(NODE_DIR_NEXT_UNSAFE);
  // Ensure no safe counterpart reappears.
  expect(normalized).not.toMatch(NODE_DIR_NEXT_SAFE);
});
