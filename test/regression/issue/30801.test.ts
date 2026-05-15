// Regression test for https://github.com/oven-sh/bun/issues/30801
//
// `MultiArrayList` exposes safe `&self` methods that mutate the backing
// bytes via raw pointers (`zero`, `sort`, `sort_span`, `sort_unstable`,
// `sort_span_unstable`). The Rust port originally declared
// `unsafe impl<T: Sync, A: Allocator + Sync> Sync for MultiArrayList<T, A>`,
// which let two threads race through those writes via a shared reference —
// a data race (UB) reachable through a fully safe API.
//
// The fix removes the `unsafe impl Sync`. This test guards the source so a
// future refactor doesn't silently reintroduce it.
//
// Soundness is enforced at the type level, not at runtime — no observable
// behaviour change is reachable from JS — so this test statically
// inspects the Rust source. The build side of the invariant is also
// encoded as a compile-time `__sync_check` module in the same file: if
// `unsafe impl Sync` is re-added, `cargo check` (and therefore `bun bd`)
// fails with a "conflicting impls" error.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dir, "..", "..", "..", "src", "collections", "multi_array_list.rs");

test("MultiArrayList does not declare `unsafe impl Sync`", () => {
  const source = readFileSync(SRC, "utf-8");

  // Strip // line comments and /* */ block comments so a comment documenting
  // the decision ("do NOT add unsafe impl Sync") doesn't false-match.
  const stripped = source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

  // Any `unsafe impl ... Sync for MultiArrayList<...>` in real code is a
  // soundness regression: see the type's doc comment and issue #30801.
  const syncImpl = /unsafe\s+impl\s*(?:<[^>]*>)?\s+Sync\s+for\s+MultiArrayList\b/;
  expect(stripped).not.toMatch(syncImpl);
});

test("MultiArrayList keeps `unsafe impl Send` (the list is still movable)", () => {
  const source = readFileSync(SRC, "utf-8");
  const stripped = source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

  // The fix only drops Sync; Send must remain so owned lists can still be
  // moved between threads (e.g. handed off to worker threads).
  const sendImpl = /unsafe\s+impl\s*(?:<[^>]*>)?\s+Send\s+for\s+MultiArrayList\b/;
  expect(stripped).toMatch(sendImpl);
});
