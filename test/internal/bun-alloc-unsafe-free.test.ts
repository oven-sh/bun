// Guards the soundness contract from https://github.com/oven-sh/bun/issues/31967
//
// `StdAllocator::free(&self, bytes: &[u8])` was a safe public method: safe
// Rust could hand it any shared byte slice (stack, static, borrowed) and it
// would cast the slice to `&mut [u8]` and forward it to the allocator vtable's
// `free` — i.e. `mi_free` on a stack pointer, reachable with zero `unsafe`.
//
// The fix makes `free` (and the `raw_free` it forwards to) `unsafe fn` with a
// documented precondition, and `free` now takes `(*mut u8, len)` so the
// aliasing `&[u8] -> &mut [u8]` cast is gone. Soundness is enforced at the
// type level, not at runtime — no observable behavior change is reachable
// from JS — so this test statically inspects the Rust source to keep a future
// refactor from silently reintroducing a safe deallocation entry point.
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
// don't leak onto other types in the same file. Works on comment-stripped
// source; the impl block under test contains no string literals, so brace
// counting is exact.
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

// A safe `pub fn <name>(` / `pub(crate) fn <name>(` declaration. `unsafe fn`
// never matches: `fn` must directly follow the visibility (modulo whitespace).
// `\(` keeps `free(` from matching e.g. `free_only(`.
const VIS = "pub(?:\\s*\\([^)]*\\))?";
const safeDecl = (name: string) => new RegExp(`\\b${VIS}\\s+fn\\s+${name}\\s*\\(`);
const unsafeDecl = (name: string) => new RegExp(`\\b${VIS}\\s+unsafe\\s+fn\\s+${name}\\s*\\(`);

test("StdAllocator buffer-consuming methods are unsafe fn", () => {
  const src = implBlock(strippedSource("src/bun_alloc/lib.rs"), "impl StdAllocator");
  for (const name of ["free", "raw_free"]) {
    expect(src).not.toMatch(safeDecl(name));
    expect(src).toMatch(unsafeDecl(name));
  }
});

test("StdAllocator::free takes a raw pointer, not a borrowed slice", () => {
  const src = implBlock(strippedSource("src/bun_alloc/lib.rs"), "impl StdAllocator");
  expect(src).toMatch(/unsafe\s+fn\s+free\s*\(\s*&self\s*,\s*ptr\s*:\s*\*mut\s+u8\s*,\s*len\s*:\s*usize\s*\)/);
  // The old shape minted a `&mut [u8]` from a shared borrow's pointer.
  expect(src).not.toMatch(/fn\s+free\s*\(\s*&self\s*,\s*\w+\s*:\s*&\s*\[u8\]\s*\)/);
});
