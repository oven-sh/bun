// Source-text consistency check for oven-sh/bun#31968.
//
// `ZigString::from16` / `from16_slice` tag the wrapped buffer as owned by
// the default (global) allocator, and `deinit_global` frees the tagged
// pointer through that allocator. Before #31968 all three were safe `fn`s,
// so entirely safe Rust could wrap a `Vec<u16>`'s storage and then request
// an invalid `mi_free` of it. The fix marks them `unsafe fn` with documented
// ownership contracts and removes the `From<&[u16]> for String` arm that
// routed borrowed slices through the global-owning constructor.
//
// The compile_fail doctests on `from16_slice` and `deinit_global` are the
// compiler-enforced guard (`cargo test -p bun_core --doc from16` and
// `... --doc deinit_global` fail if the `unsafe` keyword is ever dropped).
// This file pins the same invariant at
// the source-text layer so it runs in the regular test suite — the same
// pattern and test/internal/ placement as `ban-words.test.ts`: a
// coding-convention lint, not a behavioral test.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sourcePath = "src/bun_core/string/mod.rs";
const source = readFileSync(join(import.meta.dir, "..", "..", sourcePath), "utf8").replace(/\s+/g, " ");

// Extract just `pub [unsafe] fn <name>(...)` so a failure prints the
// offending signature instead of the whole file. `\(` anchors the name, so
// `from16` cannot match `from16_slice(`.
function signature(fnName: string): string {
  const match = source.match(new RegExp(`pub (?:unsafe )?(?:const )?fn ${fnName}\\([^)]*\\)`));
  return match?.[0] ?? `fn ${fnName} not found in ${sourcePath}`;
}

test("ZigString::from16_slice is declared unsafe (soundness invariant for #31968)", () => {
  expect(signature("from16_slice")).toStartWith("pub unsafe fn");
});

test("ZigString::from16 is declared unsafe (#31968)", () => {
  expect(signature("from16")).toStartWith("pub unsafe fn");
});

test("ZigString::deinit_global is declared unsafe (#31968)", () => {
  expect(signature("deinit_global")).toStartWith("pub unsafe fn");
});

test("no safe From<&[u16]> arm marks borrowed storage as globally owned (#31968)", () => {
  // A safe `From` over a borrowed slice cannot uphold the "owned by the
  // default allocator" contract that `from16_slice` now requires, so the
  // arm must not exist at all.
  const fromImpl = source.match(/impl\s+From\s*<\s*&\s*\[\s*u16\s*\]\s*>\s*for\s+String\b/);
  expect(fromImpl?.[0] ?? null).toBeNull();
});
