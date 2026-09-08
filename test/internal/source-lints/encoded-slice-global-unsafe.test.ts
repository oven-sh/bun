import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// https://github.com/oven-sh/bun/issues/31968
//
// `EncodedSlice::utf16_global` (formerly `ZigString::from16_slice`) sets the
// global ptr-tag, which tells the C++ consumer that it owns the buffer and
// must free it through the default allocator. Before #31968 it was a safe
// `fn` over a borrowed `&[u16]`, so entirely safe Rust could tag a `Vec`'s
// storage as globally owned and hand it off for an invalid free. The fix
// marks it `unsafe fn` with a documented ownership contract; `mark()` is
// private, so this is the only way to set the global tag from outside the
// module.
//
// The `compile_fail` doctest on `utf16_global` is the compiler-enforced guard
// (`cargo test -p bun_core --doc utf16_global`). This lint pins the same
// invariant at the source-text layer so it runs in the regular suite.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const sourcePath = "src/bun_core/string/mod.rs";
const source = readFileSync(path.join(root, sourcePath), "utf8").replace(/\s+/g, " ");

// Extract just `pub [unsafe] fn <name>(...)` so a failure prints the
// offending signature instead of the whole file.
function signature(fnName: string): string {
  const match = source.match(new RegExp(`pub (?:unsafe )?(?:const )?fn ${fnName}\\([^)]*\\)`));
  return match?.[0] ?? `fn ${fnName} not found in ${sourcePath}`;
}

test("EncodedSlice::utf16_global is declared unsafe (soundness invariant for #31968)", () => {
  expect(signature("utf16_global")).toStartWith("pub unsafe fn");
});

test("EncodedSlice::mark stays private so the global tag cannot be set from safe code (#31968)", () => {
  // `utf16_global` is the only public way to set `TAG_GLOBAL_BIT`. If
  // `mark` became `pub`, safe code could set the bit directly and bypass
  // the `unsafe` contract above.
  expect(source).toMatch(/\bfn mark\(&mut self, bit: usize\)/);
  expect(source).not.toMatch(/\bpub(?:\([^)]*\))? (?:unsafe )?fn mark\(/);
});
