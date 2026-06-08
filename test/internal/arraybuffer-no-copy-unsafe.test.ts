// Source-text consistency check for oven-sh/bun#31970.
//
// `make_array_buffer_with_bytes_no_copy` and
// `make_typed_array_with_bytes_no_copy` hand a caller-provided raw pointer,
// length, and deallocator/ctx pair to JSC, which adopts the memory as the
// backing store of a JS-visible ArrayBuffer/TypedArray (every JS read/write
// dereferences the pointer; GC invokes the deallocator). Before #31970 they
// were safe `pub fn`s, so entirely safe Rust could mint a JS object backed by
// a dangling pointer. The fix marks them (and `ArrayBuffer::to_js_with_context`,
// which forwards a caller-supplied deallocator/ctx pair to them) `unsafe fn`
// with documented contracts.
//
// The compiler is the primary guard: reverting any signature to safe makes
// every caller's `unsafe { }` block trip `unused_unsafe` (denied via
// `warnings = "deny"`), and clippy's deny-level `not_unsafe_ptr_arg_deref`
// re-fires on `to_js_with_context`. This file is a belt-and-suspenders lint
// that pins the same invariant at the source-text layer, same pattern and
// test/internal/ placement as `ban-words.test.ts` — a coding-convention
// lint, not a behavioral test. Not placed under `test/regression/issue/`
// because the functions were unsound from the day the Rust port landed;
// there is no prior release where the contract held, so it doesn't meet the
// "regression" bar per CLAUDE.md.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// test/internal/ is two levels under the repo root.
const source = readFileSync(join(import.meta.dir, "..", "..", "src", "jsc", "array_buffer.rs"), "utf8")
  // Whitespace-tolerant so benign reformatting doesn't break the lint; the
  // only thing asserted is the `unsafe` keyword on each signature.
  .replace(/\s+/g, " ");

const signatures = [
  "make_array_buffer_with_bytes_no_copy",
  "make_typed_array_with_bytes_no_copy",
  "to_js_with_context",
] as const;

test.each([...signatures])("%s is declared unsafe (soundness invariant for #31970)", name => {
  expect(source).toMatch(new RegExp(String.raw`\bpub\s+unsafe\s+fn\s+${name}\b`));
  expect(source).not.toMatch(new RegExp(String.raw`\bpub\s+fn\s+${name}\b`));
});

test("the adopting FFI imports are not declared `safe`", () => {
  // The raw externs must stay unsafe-to-call; the validity obligation is the
  // `# Safety` contract of the public wrappers, not the extern block.
  for (const symbol of ["Bun__makeArrayBufferWithBytesNoCopy", "Bun__makeTypedArrayWithBytesNoCopy"]) {
    expect(source).not.toMatch(new RegExp(String.raw`\bsafe\s+fn\s+${symbol}\b`));
    expect(source).toMatch(new RegExp(String.raw`\bfn\s+${symbol}\b`));
  }
});
