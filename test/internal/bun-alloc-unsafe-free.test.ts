// Guards the soundness contract from https://github.com/oven-sh/bun/issues/31967
//
// `StdAllocator::free(&self, bytes: &[u8])` was a safe public method: safe
// Rust could hand it any shared byte slice (stack, static, borrowed) and it
// would cast the slice to `&mut [u8]` and forward it to the allocator vtable's
// `free` — i.e. `mi_free` on a stack pointer, reachable with zero `unsafe`.
// The sibling entry points `raw_free` / `raw_resize` / `raw_remap`,
// `NullableAllocator::free`, and the `fallback` allocator twins had the same
// shape: safe signatures over pointer-provenance-sensitive operations.
//
// The fix makes every buffer-consuming allocator-handle method `unsafe fn`
// with a documented precondition (and `free` now takes `(*mut u8, len)`, so
// the aliasing `&[u8] -> &mut [u8]` cast is gone). Soundness is enforced at
// the type level, not at runtime — no observable behavior change is reachable
// from JS — so this test statically inspects the Rust source to keep a future
// refactor from silently reintroducing a safe deallocation entry point.
//
// `FixedBufferAllocator` and `MaxHeapAllocator` are intentionally not listed:
// their `free`/`resize` bodies never dereference or deallocate the passed
// buffer (offset arithmetic and no-ops only), so their safe signatures are
// sound.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

function strippedSource(relative: string): string {
  const source = readFileSync(join(ROOT, relative), "utf-8");
  // Strip // line comments (incl. /// docs) and /* */ block comments so
  // prose mentioning the old signatures doesn't false-match.
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

// Extract the body of the inherent `impl <Type> { ... }` block so assertions
// don't leak onto other types in the same file (e.g. `FixedBufferAllocator`
// also has a `free` in lib.rs). Works on comment-stripped source; the impl
// blocks under test contain no string literals, so brace counting is exact.
function implBlock(src: string, header: string): string {
  const start = src.indexOf(header);
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  let i = src.indexOf("{", start);
  const open = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return src.slice(open, i + 1);
}

// A safe `pub fn <name>(` declaration. `unsafe fn` never matches: `fn` must be
// directly preceded by `pub` (modulo whitespace). `\(` keeps `free(` from
// matching e.g. `free_only(`.
const safeDecl = (name: string) => new RegExp(`\\bpub\\s+fn\\s+${name}\\s*\\(`);
const unsafeDecl = (name: string) => new RegExp(`\\bpub\\s+unsafe\\s+fn\\s+${name}\\s*\\(`);

test("StdAllocator buffer-consuming methods are unsafe fn", () => {
  const src = implBlock(strippedSource("src/bun_alloc/lib.rs"), "impl StdAllocator");
  for (const name of ["free", "raw_free", "raw_resize", "raw_remap"]) {
    expect(src).not.toMatch(safeDecl(name));
    expect(src).toMatch(unsafeDecl(name));
  }
  // `raw_alloc` returns fresh memory and has no caller precondition — it must
  // stay safe so this test also catches accidental over-tightening.
  expect(src).toMatch(safeDecl("raw_alloc"));
});

test("NullableAllocator::free is unsafe fn", () => {
  const src = implBlock(strippedSource("src/bun_alloc/NullableAllocator.rs"), "impl NullableAllocator");
  expect(src).not.toMatch(safeDecl("free"));
  expect(src).toMatch(unsafeDecl("free"));
});

test("fallback allocator twins are unsafe fn", () => {
  const cAlloc = implBlock(strippedSource("src/bun_alloc/fallback.rs"), "impl CAllocator");
  for (const name of ["raw_free", "raw_resize"]) {
    expect(cAlloc).not.toMatch(safeDecl(name));
    expect(cAlloc).toMatch(unsafeDecl(name));
  }

  const z = implBlock(strippedSource("src/bun_alloc/fallback/z.rs"), "impl Z");
  for (const name of ["free", "resize"]) {
    expect(z).not.toMatch(safeDecl(name));
    expect(z).toMatch(unsafeDecl(name));
  }
});
